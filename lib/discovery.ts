import type { MemoryChapter, TasteProfile } from "./relationship-memory";
import { rerankCandidates, type PracticalCandidate, type PreferenceState } from "./practical-preferences";
import { canExperience, experienceExplanation, experienceWeight } from "./post-experience";

export const discoveryDomains = [
  { id: "movie", label: "Movies", type: "urn:entity:movie", cues: ["film", "cinema", "movie", "story", "atmosphere", "immersive"] },
  { id: "tv_show", label: "TV", type: "urn:entity:tv_show", cues: ["show", "story", "drama", "film"] },
  { id: "artist", label: "Music", type: "urn:entity:artist", cues: ["music", "jazz", "sound", "atmosphere", "emotion"] },
  { id: "food", label: "Cafés & food", type: "urn:entity:place", cues: ["food", "coffee", "café", "cafe", "jazz", "music", "atmosphere", "calm"] },
  { id: "book", label: "Books", type: "urn:entity:book", cues: ["book", "story", "reflection", "literary", "emotion"] },
  { id: "culture", label: "Art & culture", type: "urn:entity:place", cues: ["art", "museum", "architecture", "atmosphere", "wonder", "beauty"] },
  { id: "outdoor", label: "Outdoor & nature", type: "urn:entity:place", cues: ["nature", "forest", "green", "outdoor", "garden", "quiet", "wonder"] },
  { id: "place", label: "Local places", type: "urn:entity:place", cues: ["place", "city", "music", "atmosphere", "architecture"] },
  { id: "destination", label: "Travel & destinations", type: "urn:entity:destination", cues: ["travel", "nature", "architecture", "city", "explore", "wonder"] },
] as const;

export type DiscoveryDomain = typeof discoveryDomains[number]["id"];
export const discoveryCapabilities = [
  ...discoveryDomains.map(domain => ({ domain: domain.id, label: domain.label, qlooType: domain.type, enabled: true, grounding: domain.type === "urn:entity:place" && domain.id !== "place" ? "Qloo-verified classification filter, primary classification tag or primary subject description" : "Exact Qloo entity type" })),
  { domain: "camping", label: "Camping", qlooType: "urn:entity:place", enabled: false, grounding: "No dedicated camping type; campground places may appear under Outdoor when metadata supports them" },
  { domain: "fishing", label: "Fishing", qlooType: "urn:entity:place", enabled: false, grounding: "No dedicated fishing type; fishing places may appear under Outdoor when metadata supports them" },
  { domain: "events", label: "Local events", qlooType: "urn:entity:place", enabled: false, grounding: "Venues can be grounded; event dates and tickets are not verified" },
  { domain: "videogame", label: "Games", qlooType: "urn:entity:videogame", enabled: false, grounding: "Documented Qloo type; discovery stays experimental until account-level live verification" },
];
export type DiscoveryWhy = { known: string; new: string; fits: string };
export type DiscoveryRecord = { domain: DiscoveryDomain; status: "suggested" | "tried" | "skipped"; sourceChapterIds: string[]; why: DiscoveryWhy; location: string; categoryEvidence?: string };
export type DomainHistory = { domain: DiscoveryDomain; count: number; tried: number; lastSeen: string; feedback: number };

export function chapterDomain(chapter: MemoryChapter): DiscoveryDomain | undefined {
  const value = chapter.discovery?.domain ?? chapter.recommendation.category;
  return discoveryDomains.find(domain => domain.id === value)?.id;
}

export function explorationHistory(chapters: MemoryChapter[]): DomainHistory[] {
  const unique = [...new Map(chapters.filter(chapter => chapter.state === "LIVE").map(chapter => [chapter.id, chapter])).values()];
  return discoveryDomains.flatMap(domain => {
    const seen = unique.filter(chapter => chapterDomain(chapter) === domain.id);
    return seen.length ? [{ domain: domain.id, count: seen.length, tried: seen.filter(chapter => chapter.discovery?.status === "tried").length,
      lastSeen: seen.map(chapter => chapter.timestamp).sort().at(-1)!,
      feedback: seen.reduce((total, chapter) => {
        const prior = chapter.feedback === "good_surprise" ? 2 : chapter.feedback === "liked" ? 1 : chapter.feedback === "not_for_us" ? -4 : 0;
        const reviews = canExperience(chapter) && chapter.experiencedAt ? chapter.experienceReviews ?? [] : [];
        const actual = reviews.reduce((sum, review) => sum + (review.overall === "loved" ? 2 : review.overall === "liked" ? 1 : review.overall === "not_for_me" ? -4 : 0) * experienceWeight, 0);
        return total + (prior + actual) / (1 + reviews.length * experienceWeight);
      }, 0) / seen.length }] : [];
  });
}

export function domainDirections(profile: Pick<TasteProfile, "chapters" | "shared" | "different">, chapters: MemoryChapter[], practical: PreferenceState[] = [], surprise = false) {
  if (!profile.chapters) return [];
  const history = explorationHistory(chapters);
  const recent = [...chapters].filter(chapter => chapter.state === "LIVE").sort((first, second) => second.timestamp.localeCompare(first.timestamp) || second.id.localeCompare(first.id));
  const eligible = chapters.filter(chapter => chapter.state === "LIVE" && chapter.feedback !== "not_for_us");
  const ids = [...new Set(eligible.flatMap(chapter => chapter.entities.map(entity => entity.id)))];
  const people = new Set(eligible.flatMap(chapter => chapter.entities.map(entity => entity.participant)));
  if (ids.length < 2 || people.size < 2) return [];
  const evidenceIds = new Set(eligible.map(chapter => chapter.id));
  return discoveryDomains.flatMap(domain => {
    const matching = (signals: TasteProfile["shared"]) => signals.filter(signal => signal.chapterIds.some(id => evidenceIds.has(id)) && domain.cues.some(cue => signal.tag.includes(cue)));
    const shared = matching(profile.shared);
    const different = matching([...profile.different.you, ...profile.different.partner]);
    if (!shared.length && !different.length) return [];
    const seen = history.find(item => item.domain === domain.id);
    const explored = Boolean(seen) || eligible.some(chapter => chapter.entities.some(entity => entity.type === domain.type && domain.id === entity.type.replace("urn:entity:", "")));
    const sourceChapterIds = [...new Set([...shared, ...different].flatMap(signal => signal.chapterIds).filter(id => evidenceIds.has(id)))];
    let streak = 0;
    for (const chapter of recent) { if (chapterDomain(chapter) !== domain.id) break; streak += 1; }
    const setting = practical.find(state => state.dimension === "setting" && Math.abs(state.score) >= 0.5);
    const practicalScore = domain.id === "outdoor" && setting ? setting.score : 0;
    const contributors = {
      shared: Math.min(shared.length, 3) * 2, different: Math.min(different.length, 3),
      unexplored: explored ? 0 : surprise ? 5 : 3, repetition: -2 * Math.min(seen?.count ?? 0, 5),
      streak: -4 * Math.min(streak, 3), feedback: seen?.feedback ?? 0, practical: practicalScore,
      postExperience: 2 * Math.min([...shared, ...different].reduce((total, signal) => total + (signal.postExperienceCount ?? 0), 0), 3),
    };
    return [{ category: domain.id, label: domain.label, type: domain.type, sourceChapterIds,
      evidence: [...new Set([...shared, ...different].map(signal => signal.tag))],
      explored, score: Object.values(contributors).reduce((total, value) => total + value, 0), contributors }];
  }).sort((first, second) => second.score - first.score || discoveryDomains.findIndex(domain => domain.id === first.category) - discoveryDomains.findIndex(domain => domain.id === second.category));
}

type ClassifiedEntity = { name?: unknown; properties?: { description?: unknown }; tags?: unknown };

export function placeClassificationTags(tags: unknown[], domain: DiscoveryDomain): string[] {
  const kinds: Partial<Record<DiscoveryDomain, RegExp>> = {
    food: /^(caf[eé]s?|coffee shops?|restaurants?|baker(?:y|ies)|listening bars?|jazz bars?)$/i,
    culture: /^(?:art |history |science )?(museums?|galleries|gallery|art centers?|cultural centers?)$/i,
    outdoor: /^(?:botanical |national |city |public |nature )?(gardens?|parks?|forests?|nature reserves?|campgrounds?|fishing lakes?|fishing piers?|hiking trails?)$/i,
  };
  const pattern = kinds[domain];
  if (!pattern) return [];
  return [...new Set(tags.flatMap(tag => {
    const id = typeof tag === "string" ? tag : tag && typeof tag === "object" && "tag_id" in tag && typeof tag.tag_id === "string" ? tag.tag_id : "";
    return /^urn:tag:(category|genre):place:/i.test(id) && pattern.test(id.split(":").at(-1)!.replaceAll("_", " ")) ? [id] : [];
  }))];
}

export function domainEvidence(entity: ClassifiedEntity, domain: DiscoveryDomain): string | null {
  if (!["food", "culture", "outdoor"].includes(domain)) return `Qloo entity type: ${discoveryDomains.find(item => item.id === domain)?.type}`;
  const tags = Array.isArray(entity.tags) ? entity.tags.flatMap(tag => typeof tag === "string" ? [tag] : tag && typeof tag === "object" && typeof tag.tag_id === "string" ? [tag.tag_id] : []) : [];
  const patterns = {
    food: "caf[eé]|coffee shop|restaurant|bakery|listening bar|jazz bar",
    culture: "museum|gallery|art center|cultural center",
    outdoor: "garden|park|forest|nature reserve|campground|fishing lake|fishing pier|hiking trail",
  };
  const pattern = patterns[domain as keyof typeof patterns];
  const taxonomy = tags.filter(tag => /^urn:tag:(category|genre):place:/i.test(tag));
  const primary = placeClassificationTags(taxonomy, domain)[0];
  if (primary) return `Qloo classification tag: ${primary}`;
  if (taxonomy.some(tag => /^urn:tag:category:place:/i.test(tag))) return null;
  const description = typeof entity.properties?.description === "string" ? entity.properties.description.split(/[.!?]/)[0].trim() : "";
  const adjectives = "quiet|tranquil|peaceful|lively|small|large|local|independent|intimate|historic|historical|modern|contemporary|beautiful|Japanese|Italian|French|botanical|public|national|outdoor|urban|popular|renowned|famous|cozy|cosy|secluded|traditional";
  const subject = new RegExp(`^(?:.{1,100}?\\s(?:is|was)\\s+)?(?:an?\\s+|the\\s+)?(?:(?:${adjectives})[\\s-]+){0,4}(?:${pattern})(?=\\W|$)`, "i").exec(description);
  return subject ? `Qloo primary description: ${subject[0]}` : null;
}

export function fitsDomain(entity: ClassifiedEntity, domain: DiscoveryDomain): boolean {
  return domainEvidence(entity, domain) !== null;
}

export function nameFingerprint(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function repeatedCandidate(entity: { entity_id?: unknown; id?: unknown; name?: unknown }, chapters: MemoryChapter[]) {
  const name = typeof entity.name === "string" ? nameFingerprint(entity.name) : "";
  return chapters.some(chapter => {
    if (chapter.state !== "LIVE") return false;
    if ((entity.entity_id ?? entity.id) === chapter.recommendation.id) return true;
    const prior = nameFingerprint(chapter.recommendation.name);
    if (name === prior) return true;
    const words = new Set(name.split(" "));
    const previous = new Set(prior.split(" "));
    const union = new Set([...words, ...previous]);
    const common = [...words].filter(word => previous.has(word)).length;
    return words.size >= 3 && previous.size >= 3 && common / union.size >= 0.8;
  });
}

export function rankDiscoveries<Candidate extends PracticalCandidate & { entity: ClassifiedEntity & { entity_id?: unknown; id?: unknown } }>(candidates: Candidate[], chapters: MemoryChapter[], practical: PreferenceState[]) {
  const fresh = candidates.filter(candidate => !repeatedCandidate(candidate.entity, chapters));
  const practicalDomains = new Set(["food", "culture", "outdoor", "place", "destination"]);
  const ranked = fresh.map((candidate, index) => {
    const practicalScore = rerankCandidates([candidate], practicalDomains.has(candidate.category) ? practical : []).ranked[0];
    return { candidate, index, contributors: practicalScore.contributors, novelty: 2, familiarity: 1 / (index + 1), score: 3 * practicalScore.score + 2 + 1 / (index + 1) };
  }).sort((first, second) => second.score - first.score || first.index - second.index);
  return { ranked, excluded: candidates.length - fresh.length };
}

export function discoveryWhy(direction: ReturnType<typeof domainDirections>[number], chapters: MemoryChapter[], candidate: string): DiscoveryWhy {
  const evidence = direction.evidence.slice(0, 2).join(" and ");
  return {
    known: experienceExplanation(chapters) || `Your earlier reflections include ${evidence}. These signals come from ${direction.sourceChapterIds.length} grounded chapter${direction.sourceChapterIds.length === 1 ? "" : "s"}.`,
    new: direction.explored ? `A fresh ${direction.label.toLowerCase()} chapter; previous IDs and near-duplicate names were excluded.` : `You have not received a ${direction.label.toLowerCase()} discovery yet. This is a direction to try, not a confirmed preference.`,
    fits: `Qloo returned ${candidate} for your verified cultural interests from both people. Together balanced variety with your available practical evidence.`,
  };
}
