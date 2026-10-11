import type { MemoryChapter } from "./relationship-memory";
import { canExperience, type ExperienceReview, type SignalClass } from "./post-experience";
import { dimensions, labels, type PreferenceState } from "./practical-preferences";
import { tasteSignalLabel, translate, type Locale } from "./i18n";

export const memoryPolicy = { version: 1, stableWeight: 4, uncertainWeight: 2, contextualWeight: 1, confidencePriorWeight: 2, minimumNetWeight: 4, minimumConfidence: 0.5, minimumChapters: 2, recentChapters: 3, contextDays: 30, recentDecay: [1, 0.5, 0.25], recentScale: 0.75 } as const;
export type MemoryObservation = {
  person: "A" | "B"; kind: "taste" | "practical"; signal: string; direction: number;
  signalClass: SignalClass; evidence: string; chapterId: string; firstSeen: string; lastSeen: string;
  expiresAt: string; futurePreference: boolean; longTermWeight: number;
};
export type EnduringPreference = {
  person: "A" | "B" | "pair"; kind: "taste" | "practical"; signal: string; direction: number;
  confidence: number; cumulativeWeight: number; netWeight: number; chapterCount: number; occurrenceCount: number;
  firstSeen: string; lastSeen: string; chapterIds: string[]; stable: boolean;
  promotionSource: "explicit_stable" | "repeated_chapters" | null;
};
export type PreferenceMemory = {
  policyVersion: number; longTerm: EnduringPreference[]; stillLearning: EnduringPreference[];
  recentContext: Array<MemoryObservation & { modifierWeight: number }>;
};

export function derivePreferenceMemory(chapters: MemoryChapter[], now = new Date().toISOString()): PreferenceMemory {
  const unique = [...new Map(chapters.filter(chapter => canExperience(chapter) && chapter.experiencedAt).map(chapter => [chapter.id, chapter])).values()];
  const observations: MemoryObservation[] = unique.flatMap(chapter => (chapter.experienceReviews ?? []).filter(review => review.source === "post_experience" && review.chapterId === chapter.id && review.entityId === chapter.recommendation.id).flatMap(review => {
    const common = { person: review.person, chapterId: chapter.id, firstSeen: chapter.experiencedAt!, lastSeen: review.reviewedAt, expiresAt: new Date(Date.parse(chapter.experiencedAt!) + memoryPolicy.contextDays * 86400000).toISOString() };
    const row = (signal: ExperienceReview["taste"][number] | ExperienceReview["practical"][number]) => ({ ...common, signalClass: signal.signalClass ?? "uncertain", evidence: signal.evidence, futurePreference: signal.futurePreference ?? false, longTermWeight: signal.signalClass === "stable_preference" ? memoryPolicy.stableWeight : signal.signalClass === "contextual_reaction" || signal.futurePreference ? memoryPolicy.contextualWeight : memoryPolicy.uncertainWeight });
    return [...review.taste.map(signal => ({ ...row(signal), kind: "taste" as const, signal: signal.tag, direction: signal.sentiment === "positive" ? 1 : signal.sentiment === "negative" ? -1 : 0 })),
      ...review.practical.map(signal => ({ ...row(signal), kind: "practical" as const, signal: signal.dimension, direction: signal.value }))];
  }));
  const deduplicated = [...new Map(observations.map(item => [`${item.chapterId}:${item.person}:${item.kind}:${item.signal}`, item])).values()];
  const groups = new Map<string, MemoryObservation[]>();
  for (const item of deduplicated) { const key = `${item.person}:${item.kind}:${item.signal}`; groups.set(key, [...(groups.get(key) ?? []), item]); }
  const accumulated: EnduringPreference[] = [...groups.values()].map(items => {
    const signed = items.reduce((total, item) => total + item.direction * item.longTermWeight, 0);
    const direction = Math.sign(signed);
    const cumulativeWeight = items.reduce((total, item) => total + item.longTermWeight, 0);
    const confidence = Math.abs(signed) / (cumulativeWeight + memoryPolicy.confidencePriorWeight);
    const agreeing = items.filter(item => item.direction === direction && direction !== 0);
    const explicit = agreeing.some(item => item.signalClass === "stable_preference");
    const repeats = new Set(agreeing.map(item => item.chapterId)).size >= memoryPolicy.minimumChapters;
    const stable = Math.abs(signed) >= memoryPolicy.minimumNetWeight && confidence >= memoryPolicy.minimumConfidence && (explicit || repeats);
    return { person: items[0].person, kind: items[0].kind, signal: items[0].signal, direction, confidence, cumulativeWeight, netWeight: Math.abs(signed), chapterCount: new Set(items.map(item => item.chapterId)).size, occurrenceCount: items.length,
      firstSeen: items.map(item => item.firstSeen).sort()[0], lastSeen: items.map(item => item.lastSeen).sort().at(-1)!, chapterIds: [...new Set(items.map(item => item.chapterId))].sort(), stable,
      promotionSource: stable ? explicit ? "explicit_stable" as const : "repeated_chapters" as const : null };
  });
  const longTerm = accumulated.filter(item => item.stable);
  const shared: EnduringPreference[] = longTerm.filter(item => item.person === "A").flatMap(first => {
    const second = longTerm.find(item => item.person === "B" && item.kind === first.kind && item.signal === first.signal && item.direction === first.direction);
    return second ? [{ ...first, person: "pair" as const, confidence: Math.min(first.confidence, second.confidence), netWeight: Math.min(first.netWeight, second.netWeight), cumulativeWeight: first.cumulativeWeight + second.cumulativeWeight,
      chapterIds: [...new Set([...first.chapterIds, ...second.chapterIds])].sort(), chapterCount: new Set([...first.chapterIds, ...second.chapterIds]).size, occurrenceCount: first.occurrenceCount + second.occurrenceCount,
      firstSeen: [first.firstSeen, second.firstSeen].sort()[0], lastSeen: [first.lastSeen, second.lastSeen].sort().at(-1)!, promotionSource: first.promotionSource === "explicit_stable" && second.promotionSource === "explicit_stable" ? "explicit_stable" as const : "repeated_chapters" as const }] : [];
  });
  const recentIds = unique.sort((first, second) => second.experiencedAt!.localeCompare(first.experiencedAt!) || second.id.localeCompare(first.id)).slice(0, memoryPolicy.recentChapters).map(chapter => chapter.id);
  const recentContext = deduplicated.filter(item => item.signalClass !== "stable_preference" && recentIds.includes(item.chapterId) && Date.parse(item.expiresAt) > Date.parse(now)).map(item => ({ ...item, modifierWeight: memoryPolicy.recentDecay[recentIds.indexOf(item.chapterId)] * (item.futurePreference ? 2 : 1) }));
  return { policyVersion: memoryPolicy.version, longTerm: [...longTerm, ...shared], stillLearning: accumulated.filter(item => !item.stable), recentContext };
}

export function memorySignalLabel(item: Pick<EnduringPreference, "kind" | "signal" | "direction">, locale: Locale = "en") {
  if (item.kind === "practical") return locale === "ja" ? translate(locale, `practical.${item.signal}.${item.direction < 0 ? "low" : "high"}`) : labels[item.signal as typeof dimensions[number]][item.direction < 0 ? 0 : 1].toLowerCase();
  return locale === "ja" ? `${tasteSignalLabel(locale, item.signal)}${item.direction < 0 ? "をあまり求めない" : "を楽しむ"}` : `${item.direction < 0 ? "less" : "enjoying"} ${item.signal}`;
}

export function layeredPracticalProfile(memory: PreferenceMemory, prior: PreferenceState[] = []): PreferenceState[] {
  return dimensions.flatMap(dimension => {
    const stable = memory.longTerm.filter(item => item.person !== "pair" && item.kind === "practical" && item.signal === dimension);
    const recent = memory.recentContext.filter(item => item.kind === "practical" && item.signal === dimension);
    const baseline = stable.length ? stable.reduce((total, item) => total + item.direction * item.confidence * 2, 0) / stable.length : 0;
    const temporary = Math.max(-1.5, Math.min(1.5, recent.reduce((total, item) => total + item.direction * item.modifierWeight * memoryPolicy.recentScale, 0) / Math.max(1, new Set(recent.map(item => item.person)).size)));
    const original = prior.find(item => item.dimension === dimension);
    const score = Math.max(-2, Math.min(2, baseline + temporary + (original ? original.score * 0.25 : 0)));
    return stable.length || recent.length || original ? [{ dimension, score, layer: "stable_context" as const, count: stable.reduce((total, item) => total + item.occurrenceCount, 0) + recent.length + (original?.count ?? 0), weight: stable.reduce((total, item) => total + item.netWeight, 0) + recent.reduce((total, item) => total + item.modifierWeight, 0) + (original?.weight ?? 0) }] : [];
  });
}

export function layeredMemoryExplanation(chapters: MemoryChapter[], now?: string, locale: Locale = "en") {
  const memory = derivePreferenceMemory(chapters, now);
  const pair = memory.longTerm.filter(item => item.person === "pair");
  const stable = memory.longTerm.filter(item => item.person === "pair" || !pair.some(shared => shared.kind === item.kind && shared.signal === item.signal));
  const enduring = stable.slice(0, 4).map(item => locale === "ja"
    ? `${item.person === "pair" ? "ふたり" : item.person}には、${memorySignalLabel(item, locale)}${item.promotionSource === "explicit_stable" && item.chapterCount === 1 ? "という明確な言葉" : "という繰り返しの根拠"}があります。`
    : `${item.person === "pair" ? "You both" : item.person} ${item.promotionSource === "explicit_stable" && item.chapterCount === 1 ? "explicitly described" : `${item.person === "pair" ? "have" : "has"} recurring evidence for`} ${memorySignalLabel(item, locale)}.`);
  const recent = memory.recentContext.slice(0, 6).map(item => locale === "ja" ? `${item.person}: ${item.evidence}（最近の状況${item.futurePreference ? "・次回への希望" : ""}）。` : `${item.person}: ${item.evidence} (recent context${item.futurePreference ? "; next-time request" : ""}).`);
  return locale === "ja"
    ? [...enduring, ...(recent.length ? [`最近大事だったこと: ${recent.join(" ")} これらの一時的な観察だけで、長く続く好みとは判断しません。`] : []), ...(enduring.length || recent.length ? ["Togetherは長く続く好みを土台にし、最近の状況を一時的な補正として使います。候補の条件には、その候補自身の根拠が必要です。"] : [])].join(" ")
    : [...enduring, ...(recent.length ? [`What mattered recently: ${recent.join(" ")} These temporary observations do not establish a lasting preference.`] : []), ...(enduring.length || recent.length ? ["Together uses enduring preferences as a baseline and recent context as a temporary modifier. Candidate conditions still require their own evidence."] : [])].join(" ");
}
