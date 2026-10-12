import { discoveryDomains, explorationHistory, rankDiscoveries, type DiscoveryDomain } from "./discovery";
import { derivePreferenceMemory } from "./preference-memory";
import type { MemoryChapter } from "./relationship-memory";
import { candidateFacts, type PreferenceState, type PracticalCandidate } from "./practical-preferences";
import { translate, type Locale } from "./i18n";

export const archetypes = ["comfort", "explorer", "opposite", "surprise"] as const;
export type Archetype = typeof archetypes[number];
export const strategyWeights: Record<Archetype, { familiarity: number; novelty: number; contrast: number; repetition: number }> = {
  comfort: { familiarity: 5, novelty: 1, contrast: 0, repetition: 1 },
  explorer: { familiarity: 3, novelty: 4, contrast: 1, repetition: 2 },
  opposite: { familiarity: 1, novelty: 2, contrast: 5, repetition: 2 },
  surprise: { familiarity: 1, novelty: 6, contrast: 2, repetition: 4 },
};

export type SoloSeed = { id: string; name: string; type: string; reaction: string; tags: string[] };
export type SoloProfile = { id: string; archetype: Archetype; seeds: SoloSeed[]; chapters: MemoryChapter[]; exploration: ReturnType<typeof explorationHistory>; layers: ReturnType<typeof derivePreferenceMemory>; practical: PreferenceState[] };

export function soloChapterArchetype(chapter: MemoryChapter): Archetype {
  if (chapter.soloArchetype && archetypes.includes(chapter.soloArchetype)) return chapter.soloArchetype;
  return archetypes.find(archetype => (["en", "ja"] as const).some(locale => chapter.recommendation.rationale.startsWith(translate(locale, `solo.archetype.${archetype}`)))) ?? "explorer";
}

export function soloDirections(profile: SoloProfile) {
  const history = profile.exploration;
  const tags = new Set([...profile.seeds.flatMap(seed => seed.tags), ...profile.layers.longTerm.filter(item => item.person === "A" && item.kind === "taste" && item.direction > 0).map(item => item.signal)]);
  const rejected = new Set(profile.layers.longTerm.filter(item => item.person === "A" && item.kind === "taste" && item.direction < 0).map(item => item.signal));
  const weights = strategyWeights[profile.archetype];
  return discoveryDomains.map(domain => {
    const familiar = domain.cues.filter(cue => [...tags].some(tag => tag.includes(cue))).length;
    const contrast = domain.cues.filter(cue => ![...tags].some(tag => tag.includes(cue)) && ![...rejected].some(tag => tag.includes(cue))).length;
    const historyItem = history.find(item => item.domain === domain.id);
    const seen = historyItem?.count ?? 0;
    const supportedSeed = profile.seeds.some(seed => seed.type === domain.type);
    const score = familiar * weights.familiarity + (seen ? 0 : weights.novelty) + Math.min(contrast, 2) * weights.contrast - seen * weights.repetition + (historyItem?.feedback ?? 0) * 2 + (supportedSeed ? 1 : 0);
    return { ...domain, score, familiar, contrast, seen };
  }).sort((first, second) => second.score - first.score || discoveryDomains.findIndex(domain => domain.id === first.id) - discoveryDomains.findIndex(domain => domain.id === second.id));
}

export function rankSoloCandidates<Candidate extends PracticalCandidate & { entity: { entity_id?: unknown; id?: unknown; name?: unknown; properties?: { description?: unknown } } }>(candidates: Candidate[], profile: SoloProfile, domain: DiscoveryDomain) {
  const hard = profile.chapters.flatMap(chapter => chapter.soloPreferences ?? []);
  const eligible = candidates.filter(candidate => !candidateFacts(candidate).some(fact => hard.some(preference => preference.dimension === fact.dimension && preference.value !== fact.value)));
  const baseline = rankDiscoveries(eligible, profile.chapters, profile.practical);
  const weights = strategyWeights[profile.archetype];
  const seedNames = profile.seeds.map(seed => seed.name.toLowerCase());
  const seen = profile.exploration.find(item => item.domain === domain)?.count ?? 0;
  return { ...baseline, excluded: baseline.excluded + candidates.length - eligible.length, ranked: baseline.ranked.map(item => {
    const description = typeof item.candidate.entity.properties?.description === "string" ? item.candidate.entity.properties.description.toLowerCase() : "";
    const name = typeof item.candidate.entity.name === "string" ? item.candidate.entity.name.toLowerCase() : "";
    const familiar = seedNames.some(seed => description.includes(seed) || name.includes(seed)) ? 1 : 0;
    const contrast = familiar ? 0 : 1;
    const novelty = seen ? 0 : 1;
    return { ...item, familiarity: familiar, novelty, score: item.score + familiar * weights.familiarity + novelty * weights.novelty + contrast * weights.contrast - seen * weights.repetition };
  }).sort((first, second) => second.score - first.score || first.index - second.index) };
}

export function soloRationale(profile: SoloProfile, domain: DiscoveryDomain, locale: Locale) {
  const label = translate(locale, `solo.archetype.${profile.archetype}`);
  if (!profile.chapters.some(chapter => chapter.experiencedAt && chapter.experienceReviews?.length)) return translate(locale, "solo.rationale.first", { label });
  const stable = profile.layers.longTerm.find(item => item.person === "A" && item.kind === "taste" && item.direction > 0);
  return translate(locale, stable ? "solo.rationale.learned" : "solo.rationale.context", { label, taste: stable?.signal ?? "", domain: translate(locale, `domain.${domain}`) });
}
