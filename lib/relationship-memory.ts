import { domainDirections, explorationHistory, type DiscoveryRecord, type DomainHistory } from "./discovery";
import { canExperience, experienceContext, experienceExplanation, experienceWeight, type ExperienceReview } from "./post-experience";
import { derivePreferenceMemory, layeredMemoryExplanation, type PreferenceMemory } from "./preference-memory";
import { domainLabel, tasteSignalLabel, type Locale } from "./i18n";

export type Person = "you" | "partner";
export type Feedback = "liked" | "good_surprise" | "neutral" | "not_for_us";
export type GroundedEntity = { id: string; name: string; type: string; participant: Person; confidence: number; provenance: "explicit" | "inferred"; why: string };
export type TasteParticipant = { id: Person; label: string; likes: string[]; dislikes: string[]; emotionalContext: string[] };
export type MemoryChapter = {
  id: string;
  pairId: string;
  scope?: "solo";
  timestamp: string;
  inputs: { you: string; partner: string };
  entities: GroundedEntity[];
  reactions: Array<{ person: Person; label: string; entityIds: string[]; tags: string[]; dislikes: string[] }>;
  recommendation: { id: string; name: string; category: string; description: string; place: string; rationale: string };
  state: "LIVE";
  feedback: Feedback | null;
  reflection: string;
  discovery?: DiscoveryRecord;
  experiencedAt?: string;
  experienceReviews?: ExperienceReview[];
  soloPreferences?: import("./practical-preferences").PreferenceEvidence[];
};
export type Signal = { tag: string; count: number; chapterIds: string[]; weight?: number; postExperienceCount?: number };
export type TasteProfile = {
  chapters: number;
  shared: Signal[];
  different: { you: Signal[]; partner: Signal[] };
  unexplored: Array<{ category: string; label: string; evidence: string[]; sourceChapterIds: string[] }>;
  exploration: DomainHistory[];
  avoided: string[];
};
export type MemorySnapshot = { chapters: MemoryChapter[]; profile: TasteProfile; practical?: import("./practical-preferences").PreferenceState[]; discoveryPractical?: import("./practical-preferences").PreferenceState[]; layers?: PreferenceMemory; asOf?: string; persistence: "D1" | "unavailable" };

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
  discovery?: DiscoveryRecord;
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
    ...(input.discovery ? { discovery: input.discovery } : {}),
  };
}

export function deriveProfile(chapters: MemoryChapter[]): TasteProfile {
  const unique = [...new Map(chapters.filter(chapter => chapter.state === "LIVE").map(chapter => [chapter.id, chapter])).values()];
  const signals = { you: new Map<string, Set<string>>(), partner: new Map<string, Set<string>>() };
  const sharedChapters = new Map<string, Set<string>>();
  const scores = { you: new Map<string, number>(), partner: new Map<string, number>() };
  const experienced = { you: new Map<string, Set<string>>(), partner: new Map<string, Set<string>>() };
  const masses = { you: new Map<string, number>(), partner: new Map<string, number>() };
  const avoided = new Set<string>();
  for (const chapter of unique) {
    if (chapter.feedback === "not_for_us") avoided.add(chapter.recommendation.id);
    for (const reaction of chapter.reactions) {
      for (const tag of tags(reaction.tags)) {
        const evidence = signals[reaction.person].get(tag) ?? new Set<string>();
        evidence.add(chapter.id);
        signals[reaction.person].set(tag, evidence);
        scores[reaction.person].set(tag, (scores[reaction.person].get(tag) ?? 0) + 1);
        masses[reaction.person].set(tag, (masses[reaction.person].get(tag) ?? 0) + 1);
      }
      for (const tag of reaction.dislikes) avoided.add(`${reaction.person}: ${normalizeTag(tag)}`);
    }
    if (canExperience(chapter) && chapter.experiencedAt) for (const review of chapter.experienceReviews ?? []) {
      const person = review.person === "A" ? "you" : "partner";
      if (review.overall === "not_for_me") avoided.add(`${person}: ${chapter.recommendation.id}`);
      for (const signal of review.taste) {
        const tag = normalizeTag(signal.tag);
        const score = signal.sentiment === "positive" ? experienceWeight : signal.sentiment === "negative" ? -experienceWeight : 0;
        scores[person].set(tag, (scores[person].get(tag) ?? 0) + score);
        masses[person].set(tag, (masses[person].get(tag) ?? 0) + experienceWeight);
        const evidence = signals[person].get(tag) ?? new Set<string>();
        evidence.add(chapter.id); signals[person].set(tag, evidence);
        const actual = experienced[person].get(tag) ?? new Set<string>();
        actual.add(chapter.id); experienced[person].set(tag, actual);
      }
    }
  }
  for (const person of ["you", "partner"] as const) for (const tag of signals[person].keys()) {
    if ((scores[person].get(tag) ?? 0) / (masses[person].get(tag) ?? 1) < 0.5) signals[person].delete(tag);
  }
  for (const [tag, evidence] of signals.you) {
    const partnerEvidence = signals.partner.get(tag);
    if (partnerEvidence) sharedChapters.set(tag, new Set([...evidence, ...partnerEvidence]));
  }
  const toSignals = (values: Map<string, Set<string>>, person?: Person) => [...values].map(([tag, evidence]) => ({ tag, count: evidence.size, chapterIds: [...evidence].sort(),
    weight: person ? scores[person].get(tag) ?? 0 : Math.min(scores.you.get(tag) ?? 0, scores.partner.get(tag) ?? 0),
    postExperienceCount: person ? experienced[person].get(tag)?.size ?? 0 : new Set([...(experienced.you.get(tag) ?? []), ...(experienced.partner.get(tag) ?? [])]).size,
  })).sort((first, second) => second.weight - first.weight || second.count - first.count || first.tag.localeCompare(second.tag));
  const shared = toSignals(sharedChapters);
  const sharedTags = new Set(shared.map(signal => signal.tag));
  const profile: TasteProfile = {
    chapters: unique.length, shared,
    different: { you: toSignals(signals.you, "you").filter(signal => !sharedTags.has(signal.tag)), partner: toSignals(signals.partner, "partner").filter(signal => !sharedTags.has(signal.tag)) },
    unexplored: [], exploration: explorationHistory(unique),
    avoided: [...avoided].sort(),
  };
  profile.unexplored = domainDirections(profile, unique).filter(direction => !direction.explored).map(({ category, label, evidence, sourceChapterIds }) => ({ category, label, evidence, sourceChapterIds }));
  return profile;
}

export function discoveryTasteProfile(chapters: MemoryChapter[]) {
  const layers = derivePreferenceMemory(chapters);
  return deriveProfile(chapters.map(chapter => ({ ...chapter, experienceReviews: chapter.experienceReviews?.map(review => ({ ...review, taste: review.taste.filter(signal =>
    layers.longTerm.some(item => item.person === review.person && item.kind === "taste" && item.signal === signal.tag) ||
    layers.recentContext.some(item => item.chapterId === chapter.id && item.person === review.person && item.kind === "taste" && item.signal === signal.tag)) })) })));
}

export function memoryContext(chapters: MemoryChapter[]) {
  const profile = discoveryTasteProfile(chapters);
  return {
    chapterCount: profile.chapters,
    actualExperiences: experienceContext(chapters),
    longTerm: derivePreferenceMemory(chapters).longTerm,
    recentContext: derivePreferenceMemory(chapters).recentContext,
    shared: profile.shared.slice(0, 6).map(signal => ({ tag: signal.tag, observations: signal.count })),
    different: { you: profile.different.you.slice(0, 6).map(signal => signal.tag), partner: profile.different.partner.slice(0, 6).map(signal => signal.tag) },
    unexplored: profile.unexplored.map(opportunity => opportunity.label),
    avoid: profile.avoided.slice(0, 12),
    previousRecommendations: chapters.slice(0, 12).map(chapter => ({ name: chapter.recommendation.name, category: chapter.recommendation.category, feedback: chapter.feedback })),
  };
}

export function memoryExplanation(chapters: MemoryChapter[], category: string, locale: Locale = "en") {
  if (!chapters.length) return locale === "ja" ? "これは最初のチャプターです。根拠のある結果を表示したあと、Togetherがふたりの感想を記憶します。" : "This is your first chapter. Together will remember your two reflections after this grounded reveal.";
  const profile = discoveryTasteProfile(chapters);
  const separator = locale === "ja" ? "と" : " and ";
  const shared = profile.shared.slice(0, 2).map(signal => tasteSignalLabel(locale, signal.tag)).join(separator);
  const you = profile.different.you.slice(0, 2).map(signal => tasteSignalLabel(locale, signal.tag)).join(separator);
  const partner = profile.different.partner.slice(0, 2).map(signal => tasteSignalLabel(locale, signal.tag)).join(separator);
  const overlap = locale === "ja" ? shared ? `ふたりとも${shared}に反応したこと` : "以前の感想から、それぞれ違う入口が見えたこと" : shared ? `you both responded to ${shared}` : "your earlier reflections opened different doors";
  const difference = locale === "ja" ? you && partner ? `、さらにAは${you}、Bは${partner}に反応したこと` : "" : you && partner ? `, while A responded to ${you} and B to ${partner}` : "";
  const newDomain = profile.unexplored.some(opportunity => opportunity.category === category);
  return locale === "ja"
    ? `${layeredMemoryExplanation(chapters, undefined, locale)} ${experienceExplanation(chapters, locale)}${experienceContext(chapters).length ? " " : ""}${overlap}${difference}をもとに、現在の手がかりと以前Qlooで確認した興味をつなげました${newDomain ? `。まだ試していない${domainLabel(locale, category, category)}の方向も探しました` : ""}。以前のおすすめは候補から除外しています。${chapters.some(chapter => chapter.feedback === "not_for_us") ? "「今回は違う」とした候補は、前向きな手がかりとして再利用していません。" : ""}`
    : `${layeredMemoryExplanation(chapters, undefined, locale)} ${experienceExplanation(chapters, locale)}${experienceContext(chapters).length ? " " : ""}Because ${overlap}${difference}, Together connected your current signals with earlier Qloo-verified interests${newDomain ? ` and looked for discovery in your still-unexplored ${category} domain` : ""}. Earlier recommendations were excluded.${chapters.some(chapter => chapter.feedback === "not_for_us") ? " Recommendations marked Not for us were not reused as positive signals." : ""}`;
}

export function historicalEntities(chapters: MemoryChapter[]) {
  const actual = chapters.filter(chapter => canExperience(chapter) && chapter.experiencedAt).flatMap(chapter => (chapter.experienceReviews ?? [])
    .filter(review => review.overall === "loved" || review.overall === "liked")
    .map(review => ({ id: review.entityId, name: review.entityName, type: qlooType(chapter.discovery?.domain ?? chapter.recommendation.category), participant: review.person === "A" ? "you" as const : "partner" as const, confidence: 1, provenance: "explicit" as const, why: "Confirmed positive post-experience reaction" })));
  const prior = chapters.filter(chapter => chapter.feedback !== "not_for_us").flatMap(chapter => chapter.entities);
  const eligible = [...actual, ...prior].filter((entity, index, all) => all.findIndex(other => other.id === entity.id && other.participant === entity.participant) === index &&
    !chapters.flatMap(chapter => chapter.experienceReviews ?? []).some(review => review.entityId === entity.id && review.person === (entity.participant === "you" ? "A" : "B") && review.overall === "not_for_me"));
  return ["you", "partner"].flatMap(person => eligible.filter(entity => entity.participant === person).slice(0, 3));
}

function qlooType(domain: string) {
  return `urn:entity:${["food", "culture", "outdoor"].includes(domain) ? "place" : domain}`;
}
