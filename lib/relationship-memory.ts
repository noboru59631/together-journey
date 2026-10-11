export type Person = "you" | "partner";
export type Feedback = "liked" | "neutral" | "not_for_us";
export type GroundedEntity = { id: string; name: string; type: string; participant: Person; confidence: number; provenance: "explicit" | "inferred"; why: string };
export type TasteParticipant = { id: Person; label: string; likes: string[]; dislikes: string[]; emotionalContext: string[] };
export type MemoryChapter = {
  id: string;
  pairId: string;
  timestamp: string;
  inputs: { you: string; partner: string };
  entities: GroundedEntity[];
  reactions: Array<{ person: Person; label: string; entityIds: string[]; tags: string[]; dislikes: string[] }>;
  recommendation: { id: string; name: string; category: string; description: string; place: string; rationale: string };
  state: "LIVE";
  feedback: Feedback | null;
  reflection: string;
};
export type Signal = { tag: string; count: number; chapterIds: string[] };
export type TasteProfile = {
  chapters: number;
  shared: Signal[];
  different: { you: Signal[]; partner: Signal[] };
  unexplored: Array<{ category: string; label: string }>;
  avoided: string[];
};
export type MemorySnapshot = { chapters: MemoryChapter[]; profile: TasteProfile; persistence: "D1" | "unavailable" };

const opportunities = [
  { category: "place", label: "Places, gardens & architecture" },
  { category: "book", label: "Books & stories" },
  { category: "destination", label: "Destinations & neighborhoods" },
  { category: "artist", label: "Music & live performance" },
  { category: "movie", label: "Film & immersive worlds" },
];

export function normalizeTag(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function tags(values: string[]) {
  return [...new Set(values.map(normalizeTag).filter(Boolean))].slice(0, 10);
}

export function createChapter(input: {
  id: string; pairId: string; timestamp: string; inputs: MemoryChapter["inputs"];
  mode: string; entities: GroundedEntity[]; participants: TasteParticipant[];
  recommendation: MemoryChapter["recommendation"];
}): MemoryChapter | null {
  if (input.mode !== "LIVE" || new Set(input.entities.map(entity => entity.id)).size < 2) return null;
  if (!["you", "partner"].every(person => input.entities.some(entity => entity.participant === person))) return null;
  const entities = input.entities.filter((entity, index, all) => all.findIndex(other => other.id === entity.id && other.participant === entity.participant) === index);
  return {
    id: input.id, pairId: input.pairId, timestamp: input.timestamp, inputs: input.inputs, entities,
    reactions: input.participants.map(participant => {
      const dislikes = tags(participant.dislikes);
      return { person: participant.id, label: participant.label, entityIds: entities.filter(entity => entity.participant === participant.id).map(entity => entity.id), tags: tags([...participant.likes, ...participant.emotionalContext]).filter(tag => !dislikes.includes(tag)), dislikes };
    }),
    recommendation: input.recommendation, state: "LIVE", feedback: null, reflection: "",
  };
}

export function deriveProfile(chapters: MemoryChapter[]): TasteProfile {
  const unique = [...new Map(chapters.filter(chapter => chapter.state === "LIVE").map(chapter => [chapter.id, chapter])).values()];
  const signals = { you: new Map<string, Set<string>>(), partner: new Map<string, Set<string>>() };
  const sharedChapters = new Map<string, Set<string>>();
  const domains = new Set<string>();
  const avoided = new Set<string>();
  for (const chapter of unique) {
    for (const entity of chapter.entities) domains.add(entity.type.replace("urn:entity:", ""));
    if (chapter.feedback === "liked") domains.add(chapter.recommendation.category);
    if (chapter.feedback === "not_for_us") avoided.add(chapter.recommendation.id);
    for (const reaction of chapter.reactions) {
      for (const tag of tags(reaction.tags)) {
        const evidence = signals[reaction.person].get(tag) ?? new Set<string>();
        evidence.add(chapter.id);
        signals[reaction.person].set(tag, evidence);
      }
      for (const tag of reaction.dislikes) avoided.add(`${reaction.person}: ${normalizeTag(tag)}`);
    }
    const you = chapter.reactions.find(reaction => reaction.person === "you")?.tags ?? [];
    const partner = chapter.reactions.find(reaction => reaction.person === "partner")?.tags ?? [];
    for (const tag of tags(you).filter(tag => tags(partner).includes(tag))) {
      const evidence = sharedChapters.get(tag) ?? new Set<string>();
      evidence.add(chapter.id);
      sharedChapters.set(tag, evidence);
    }
  }
  const toSignals = (values: Map<string, Set<string>>) => [...values].map(([tag, evidence]) => ({ tag, count: evidence.size, chapterIds: [...evidence].sort() })).sort((first, second) => second.count - first.count || first.tag.localeCompare(second.tag));
  const shared = toSignals(sharedChapters);
  const sharedTags = new Set(shared.map(signal => signal.tag));
  return {
    chapters: unique.length, shared,
    different: { you: toSignals(signals.you).filter(signal => !sharedTags.has(signal.tag)), partner: toSignals(signals.partner).filter(signal => !sharedTags.has(signal.tag)) },
    unexplored: unique.length ? opportunities.filter(opportunity => !domains.has(opportunity.category)) : [],
    avoided: [...avoided].sort(),
  };
}

export function memoryContext(chapters: MemoryChapter[]) {
  const profile = deriveProfile(chapters);
  return {
    chapterCount: profile.chapters,
    shared: profile.shared.slice(0, 6).map(signal => ({ tag: signal.tag, observations: signal.count })),
    different: { you: profile.different.you.slice(0, 6).map(signal => signal.tag), partner: profile.different.partner.slice(0, 6).map(signal => signal.tag) },
    unexplored: profile.unexplored.map(opportunity => opportunity.label),
    avoid: profile.avoided.slice(0, 12),
    previousRecommendations: chapters.slice(0, 12).map(chapter => ({ name: chapter.recommendation.name, category: chapter.recommendation.category, feedback: chapter.feedback })),
  };
}

export function memoryExplanation(chapters: MemoryChapter[], category: string) {
  if (!chapters.length) return "This is your first chapter. Together will remember your two reflections after this grounded reveal.";
  const profile = deriveProfile(chapters);
  const shared = profile.shared.slice(0, 2).map(signal => signal.tag).join(" and ");
  const you = profile.different.you.slice(0, 2).map(signal => signal.tag).join(" and ");
  const partner = profile.different.partner.slice(0, 2).map(signal => signal.tag).join(" and ");
  const overlap = shared ? `you both responded to ${shared}` : "your earlier reflections opened different doors";
  const difference = you && partner ? `, while A responded to ${you} and B to ${partner}` : "";
  const newDomain = profile.unexplored.some(opportunity => opportunity.category === category);
  return `Because ${overlap}${difference}, Together connected your current signals with earlier Qloo-verified interests${newDomain ? ` and explored a new ${category} domain` : ""}. Earlier recommendations were excluded.${chapters.some(chapter => chapter.feedback === "not_for_us") ? " Recommendations marked Not for us were not reused as positive signals." : ""}`;
}

export function historicalEntities(chapters: MemoryChapter[]) {
  return chapters.filter(chapter => chapter.feedback !== "not_for_us").flatMap(chapter => chapter.entities).filter((entity, index, all) => all.findIndex(other => other.id === entity.id) === index).slice(0, 6);
}
