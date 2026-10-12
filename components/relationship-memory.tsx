"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Feedback, MemorySnapshot } from "../lib/relationship-memory";
import { discoveryDomains } from "../lib/discovery";
import { dimensions, labels, learnedPreferences, preferenceLabel, type PreferenceSignal } from "../lib/practical-preferences";
import { ExperienceReviewCard, type ExperienceAction } from "./experience-review";
import { memorySignalLabel } from "../lib/preference-memory";
import { domainLabel, tasteSignalLabel } from "../lib/i18n";
import { useLanguage } from "./language-provider";

export function ExplorationTaste({ memory }: { memory: MemorySnapshot | null }) {
  const { locale, t } = useLanguage();
  const learned = learnedPreferences(memory?.discoveryPractical ?? []);
  return <article className="memory-bucket"><h3>{t("taste.exploreTitle")}</h3>{learned.length ? <div className="signal-tags">{learned.map(state => <span key={state.dimension}>{preferenceLabel(state, locale)}<small>{t("taste.exploreNext")}</small></span>)}</div> : <p>{t("taste.exploreEmpty")}</p>}<p>{t("taste.exploreNote")}</p></article>;
}

export function PracticalFeedback({ chapterId, category, count, feedback, busy, onSave }: { chapterId: string; category: string; count: number; feedback: Feedback | null; busy: boolean; onSave: (chapterId: string, feedback: Feedback, reflection?: string, preference?: PreferenceSignal) => Promise<boolean> }) {
  const { locale, t } = useLanguage();
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const relevant = category === "book" ? ["pace", "setting", "planning"] as const : count % 2 ? ["crowds", "quiet", "budget"] as const : ["setting", "planning", "pace"] as const;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? dimensions : relevant;
  async function save(preference?: PreferenceSignal) {
    setSaved("");
    if (await onSave(chapterId, feedback ?? "neutral", preference ? undefined : note, preference)) { setSaved(t("feedback.saved")); if (!preference) setNote(""); }
  }
  return <div className="practical-feedback"><p>{t("feedback.nextFeel")} <small>{t("common.optional")}</small></p>{shown.map(dimension => <div className="memory-feedback" key={dimension} aria-label={`${preferenceLabel({ dimension, score: -1, count: 0, weight: 0 }, locale)} / ${preferenceLabel({ dimension, score: 1, count: 0, weight: 0 }, locale)}`}>{labels[dimension].map((label, index) => <button key={label} disabled={busy} onClick={() => save({ dimension, value: index === 0 ? -1 : 1 })}>{preferenceLabel({ dimension, score: index === 0 ? -1 : 1, count: 0, weight: 0 }, locale)}</button>)}</div>)}<button className="text-action" onClick={() => setExpanded(!expanded)}>{expanded ? t("feedback.fewer") : t("feedback.other")}</button><label className="preference-note">{t("feedback.note")}<input value={note} maxLength={2000} placeholder={t("feedback.notePlaceholder")} onChange={event => setNote(event.target.value)}/></label><button className="text-action" disabled={busy || !note.trim()} onClick={() => save()}>{t("feedback.saveNote")}</button><p role="status">{saved}</p></div>;
}

export const feedbackLabels: Record<Feedback, string> = { liked: "Feels like us", good_surprise: "Good surprise", neutral: "Not sure yet", not_for_us: "Not for us" };

export function FeedbackButtons({ value, busy, onChange }: { value: Feedback | null; busy: boolean; onChange: (feedback: Feedback) => void }) {
  const { t } = useLanguage();
  const localized: Record<Feedback, string> = { liked: t("feedback.liked"), good_surprise: t("feedback.goodSurprise"), neutral: t("feedback.neutral"), not_for_us: t("feedback.notForUs") };
  return <div className="memory-feedback" aria-label={t("feedback.optionalAria")}>{(["liked", "good_surprise", "not_for_us"] as Feedback[]).map(feedback => <button key={feedback} aria-pressed={value === feedback} disabled={busy} onClick={() => onChange(feedback)}>{localized[feedback]}</button>)}</div>;
}

export function OurTaste({ memory, busy = false, onDiscover }: { memory: MemorySnapshot | null; busy?: boolean; onDiscover?: (domain?: string, surprise?: boolean) => void }) {
  const { locale, t } = useLanguage();
  const profile = memory?.profile;
  const pairStable = memory?.layers?.longTerm.filter(item => item.person === "pair") ?? [];
  const stable = memory?.layers?.longTerm.filter(item => item.person === "pair" || !pairStable.some(shared => shared.kind === item.kind && shared.signal === item.signal)) ?? [];
  const recent = memory?.layers?.recentContext ?? [];
  return <section className="taste-memory" aria-label={t("taste.aria")}>
    <span className="eyebrow">{t("taste.eyebrow")}</span><h2>{t("taste.title")}</h2>
    {!profile?.chapters ? <p>{t("taste.empty")}</p> : <>
      <p>{t("taste.from", { count: profile.chapters, chapters: profile.chapters === 1 ? t("common.chapter") : t("common.chapters") })}</p>
      <article className="memory-bucket"><h3>{t("taste.stick")}</h3>{stable.length ? <div className="signal-tags">{stable.slice(0, 8).map(item => <span key={`${item.person}:${item.kind}:${item.signal}`}>{item.person === "pair" ? t("common.both") : t("common.person", { person: item.person })} · {memorySignalLabel(item, locale)}<small>{item.chapterCount} {item.chapterCount === 1 ? t("taste.explicit") : t("taste.recurring")}</small></span>)}</div> : <p>{t("taste.stickEmpty")}</p>}</article>
      <article className="memory-bucket"><h3>{t("taste.recent")}</h3>{recent.length ? recent.slice(0, 6).map(item => <p key={`${item.chapterId}:${item.person}:${item.kind}:${item.signal}`}>{t("common.person", { person: item.person })} · {item.evidence}{item.futurePreference ? ` · ${t("common.forNextTime")}` : ""}</p>) : <p>{t("taste.recentEmpty")}</p>}<p>{t("taste.recentNote")}</p></article>
      <article className="memory-bucket"><h3>{t("taste.shared")}</h3>{profile.shared.length ? <div className="signal-tags">{profile.shared.slice(0, 8).map(signal => <span key={signal.tag}>{tasteSignalLabel(locale, signal.tag)}<small>{signal.count} {signal.count === 1 ? t("common.chapter") : t("common.chapters")}</small></span>)}</div> : <p>{t("taste.sharedEmpty")}</p>}</article>
      <article className="memory-bucket"><h3>{t("taste.different")}</h3><div className="different-columns">{(["you", "partner"] as const).map(person => <div key={person}><b>{person === "you" ? t("taste.you") : t("taste.partner")}</b><div className="signal-tags">{profile.different[person].slice(0, 6).map(signal => <span key={signal.tag}>{tasteSignalLabel(locale, signal.tag)}<small>{signal.count} {t("common.chapters")}</small></span>)}</div></div>)}</div><p>{t("taste.differentNote")}</p></article>
      <article className="memory-bucket"><h3>{t("taste.unexplored")}</h3><p>{t("taste.unexploredText")}</p>
        {profile.unexplored.slice(0, 4).map(opportunity => <div className="discovery-direction" key={opportunity.category}><b>{domainLabel(locale, opportunity.category, opportunity.label)}</b><p>{t("taste.connected", { evidence: opportunity.evidence.slice(0, 2).map(signal => tasteSignalLabel(locale, signal)).join(" · ") })}</p><button className="text-action" disabled={busy || !onDiscover} onClick={() => onDiscover?.(opportunity.category)}>{t("taste.tryDirection")}</button></div>)}
        {!profile.unexplored.length && <p>{t("taste.unexploredEmpty")}</p>}
      </article>
      <article className="memory-bucket"><h3>{t("taste.discoveries")}</h3><div className="signal-tags">{profile.exploration.map(item => <span key={item.domain}>{domainLabel(locale, item.domain, discoveryDomains.find(domain => domain.id === item.domain)?.label)}<small>{t("taste.discoveryCount", { count: item.count, tried: item.tried })}</small></span>)}</div><p>{t("taste.discoveryNote")}</p></article>
    </>}
  </section>;
}

export function NextDiscovery({ memory, busy, onDiscover, onTalk, onResume }: { memory: MemorySnapshot | null; busy: boolean; onDiscover: (domain?: string, surprise?: boolean) => void; onTalk: () => void; onResume: () => void }) {
  const { locale, t } = useLanguage();
  const latest = memory?.chapters[0];
  const ready = memory?.persistence === "D1" && Boolean(memory.profile.unexplored.length || memory.profile.exploration.length);
  const pending = latest?.discovery?.status === "suggested";
  const thisWeek = latest && memory?.asOf && new Date(memory.asOf).getTime() - new Date(latest.timestamp).getTime() < 7 * 24 * 60 * 60 * 1000;
  const status = latest?.discovery?.status ?? "suggested";
  return <article className="next-discovery memory-bucket" aria-label={t("next.aria")}><span className="eyebrow">{t("next.eyebrow")}</span><h3>{t("next.title")}</h3><p>{t("next.text")}</p>
    {latest && <p className="discovery-week">{thisWeek ? t("next.thisWeek") : t("next.latest")}<b>{latest.recommendation.name}</b><small>{domainLabel(locale, latest.discovery?.domain ?? latest.recommendation.category, discoveryDomains.find(domain => domain.id === latest.discovery?.domain)?.label ?? latest.recommendation.category)} · {t(`common.${status}`)}</small></p>}
    {pending && <button className="secondary-action full" disabled={busy} onClick={onResume}>{t("next.return")}</button>}
    <button className="primary-action full" disabled={busy || !memory} onClick={() => ready ? onDiscover() : onTalk()}>{busy ? t("next.finding") : ready ? t("next.discover") : t("next.first")}</button>
    {ready && <button className="text-action" disabled={busy} onClick={() => onDiscover(undefined, true)}>{t("next.surprise")}</button>}
    <p className="discovery-footnote">{t("next.footnote")}</p>
  </article>;
}

export function MemoryTimeline({ memory, busy, onFeedback, onExperience, onReset }: { memory: MemorySnapshot | null; busy: boolean; onFeedback: (chapterId: string, feedback: Feedback, reflection?: string, preference?: PreferenceSignal) => Promise<boolean>; onExperience: (action: ExperienceAction) => Promise<boolean>; onReset: () => void }) {
  const { locale, t } = useLanguage();
  const [confirmReset, setConfirmReset] = useState(false);
  return <section className="memory-timeline" aria-label={t("timeline.aria")}>
    <span className="eyebrow">{t("timeline.eyebrow")}</span><h3>{memory?.chapters.length ? t("timeline.title") : t("timeline.emptyTitle")}</h3>
    <p>{memory?.persistence === "unavailable" ? t("timeline.unavailable") : t("timeline.storage")}</p>
    {memory?.chapters.slice(0, 8).map(chapter => <article className="memory-chapter" key={chapter.id}>
      <div className="chapter-label"><time dateTime={chapter.timestamp}>{new Date(chapter.timestamp).toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US")}</time><span>LIVE · {t(`common.${chapter.discovery?.status ?? "suggested"}`)}</span></div>
      <h3>{chapter.recommendation.name}</h3><span className="domain-badge">{domainLabel(locale, chapter.discovery?.domain ?? chapter.recommendation.category, discoveryDomains.find(domain => domain.id === (chapter.discovery?.domain ?? chapter.recommendation.category))?.label ?? chapter.recommendation.category)}</span>
      <p>{chapter.entities.map(entity => `${entity.participant === "you" ? "A" : "B"}: ${entity.name}`).join(" · ")}</p>
      <details><summary>{t("timeline.remembered")}</summary>
        {chapter.inputs.you || chapter.inputs.partner ? <><p><b>A:</b> {chapter.inputs.you}</p><p><b>B:</b> {chapter.inputs.partner}</p></> : <p>{t("timeline.reused")}</p>}
        <p>{t("timeline.summary", { name: chapter.recommendation.name })}</p><p>{t("timeline.notConfirmed")}</p>
      </details>
      <FeedbackButtons value={chapter.feedback} busy={busy} onChange={feedback => onFeedback(chapter.id, feedback)}/>
      <ExperienceReviewCard chapter={chapter} busy={busy} onSave={onExperience}/>
      {chapter.id === memory.chapters[0]?.id && <PracticalFeedback key={chapter.id} chapterId={chapter.id} category={chapter.recommendation.category} count={memory.chapters.length} feedback={chapter.feedback} busy={busy} onSave={onFeedback}/>}
    </article>)}
    <div className="memory-reset">{confirmReset ? <><p>{t("timeline.deleteConfirm")}</p><button className="secondary-action" disabled={busy} onClick={() => { onReset(); setConfirmReset(false); }}>{t("timeline.delete")}</button><button className="text-action" onClick={() => setConfirmReset(false)}>{t("timeline.keep")}</button></> : <button className="text-action" disabled={busy || !memory || memory.persistence !== "D1"} onClick={() => setConfirmReset(true)}>{t("timeline.reset")}</button>}</div>
  </section>;
}

export function MemoryInvitation({ count, onTalk }: { count: number; onTalk: () => void }) {
  const { t } = useLanguage();
  return <div className="partner-card memory-invitation"><span><Sparkles size={18}/></span><div><b>{t("invitation.title")}</b><p>{count ? t("invitation.returning") : t("invitation.first")}</p><button className="text-action" onClick={onTalk}>{t("invitation.cta")}</button></div></div>;
}
