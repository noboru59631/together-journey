"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { archetypes, soloChapterArchetype, soloRationale, type Archetype, type SoloProfile } from "../lib/solo-partner";
import { discoveryDomains } from "../lib/discovery";
import { domainLabel } from "../lib/i18n";
import { ExperienceReviewCard, type ExperienceAction } from "./experience-review";
import { LanguageToggle, useLanguage } from "./language-provider";
import { RecoveryPanel } from "./recovery-panel";

type Interest = { name: string; type: string; reaction: string };
type Result = { title: string; category: string; mode: string; archetype: Archetype; discovery: { why: { known: string; new: string; fits: string } }; memory: { chapterId: string; explanation: string }; trace: { qlooApiCalls: unknown[] } };
const blankInterest = (): Interest => ({ name: "", type: "urn:entity:movie", reaction: "" });

export function SoloApp({ onSwitch }: { onSwitch: () => void }) {
  const { locale, t } = useLanguage();
  const [profile, setProfile] = useState<SoloProfile | null>(null);
  const [interests, setInterests] = useState<Interest[]>([blankInterest(), blankInterest()]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/solo", { cache: "no-store", signal });
    if (!response.ok) throw new Error(t("error.memoryUnavailable"));
    const next = await response.json() as SoloProfile;
    if (!signal?.aborted) setProfile(next);
  }, [t]);
  useEffect(() => { const controller = new AbortController(); void fetch("/api/solo", { cache: "no-store", signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); const next = await response.json() as SoloProfile; if (!controller.signal.aborted) setProfile(next); }).catch(() => { if (!controller.signal.aborted) setError(t("error.memoryLoad")); }); return () => controller.abort(); }, [t]);
  async function chooseArchetype(archetype: Archetype) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/solo", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archetype", archetype }) });
      if (!response.ok) throw new Error();
      setProfile(await response.json());
    } catch { setError(t("error.feedbackRetry")); } finally { setBusy(false); }
  }
  async function discover() {
    if (!profile || busy) return;
    const supplied = interests.filter(interest => interest.name.trim()).map(interest => ({ ...interest, name: interest.name.trim() }));
    if (!profile.seeds.length && !supplied.length) { setError(t("solo.error.interest")); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/adventure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "solo_discovery", requestId: crypto.randomUUID(), ...(profile.seeds.length ? {} : { interests: supplied }), locale }) });
      const data = await response.json() as Result & { error?: string };
      if (!response.ok || data.mode !== "LIVE") { setError(data.error ?? t("error.discovery")); return; }
      setResult(data); await load();
    } catch { setError(t("error.discovery")); } finally { setBusy(false); }
  }
  async function saveExperience(action: ExperienceAction) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/solo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action.action === "review" ? { ...action, locale } : action) });
      if (!response.ok) throw new Error();
      setProfile(await response.json()); return true;
    } catch { setError(t("error.reactionRetry")); return false; } finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/solo", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setProfile(await response.json()); setResult(null); setInterests([blankInterest(), blankInterest()]); setConfirmReset(false);
    } catch { setError(t("error.reset")); } finally { setBusy(false); }
  }
  return <main className="app-shell"><div className="aurora one"/><div className="aurora two"/><section className="phone-stage" aria-label={t("solo.title")}>
    <header className="topbar"><div/><div className="brand"><span><Sparkles size={13}/></span>Together</div><div className="topbar-actions"><LanguageToggle/><span className="mode-pill live">SOLO</span></div></header>
    <div className="screen-frame"><div className="solo-screen">
      <span className="eyebrow">{t("solo.mode.solo")}</span><h1>{t("solo.title")}</h1><p>{t("solo.description")}</p>
      {error && <p role="alert" className="save-error">{error}</p>}
      <section className="memory-bucket"><h2>{t("solo.archetype.label")}</h2><div className="solo-styles">{archetypes.map(archetype => <button key={archetype} aria-pressed={profile?.archetype === archetype} disabled={busy || !profile} onClick={() => void chooseArchetype(archetype)}><strong>{t(`solo.archetype.${archetype}`)}</strong><small>{t(`solo.archetype.${archetype}.description`)}</small></button>)}</div></section>
      {!profile?.seeds.length && <section className="memory-bucket"><h2>{t("solo.interest.title")}</h2><p>{t("solo.interest.hint")}</p>{interests.map((interest, index) => <div className="solo-interest" key={index}><label>{index ? t("solo.interest.second") : t("solo.interest.name")}<input value={interest.name} maxLength={120} onChange={event => setInterests(current => current.map((item, at) => at === index ? { ...item, name: event.target.value } : item))}/></label><select aria-label={t("talk.kind")} value={interest.type} onChange={event => setInterests(current => current.map((item, at) => at === index ? { ...item, type: event.target.value } : item))}>{discoveryDomains.filter(domain => ["movie", "artist", "book", "tv_show", "place", "destination"].includes(domain.id)).map(domain => <option key={domain.id} value={domain.type}>{domainLabel(locale, domain.id, domain.label)}</option>)}</select><label>{t("solo.interest.reaction")}<input value={interest.reaction} maxLength={240} onChange={event => setInterests(current => current.map((item, at) => at === index ? { ...item, reaction: event.target.value } : item))}/></label></div>)}</section>}
      <button className="primary-action full" disabled={busy || !profile} onClick={() => void discover()}>{busy ? t("next.finding") : profile?.seeds.length ? t("solo.discover.next") : t("solo.interest.find")}</button>
      {result && <article className="memory-bucket solo-result"><span className="eyebrow">{t(`solo.archetype.${result.archetype}`)} · Qloo LIVE</span><h2>{result.title}</h2><p>{profile ? soloRationale({ ...profile, archetype: result.archetype, chapters: profile.chapters.filter(chapter => chapter.id !== result.memory.chapterId) }, result.category as typeof discoveryDomains[number]["id"], locale) : result.memory.explanation}</p><small>{domainLabel(locale, result.category)}</small></article>}
      <section className="memory-bucket"><h2>{t("solo.memory.title")}</h2>{!profile?.chapters.length && <p>{t("solo.memory.empty")}</p>}{profile?.chapters.map(chapter => <article className="solo-chapter" key={chapter.id}><h3>{chapter.recommendation.name}</h3><small>{domainLabel(locale, chapter.discovery?.domain ?? chapter.recommendation.category)}</small><p>{soloRationale({ ...profile, archetype: soloChapterArchetype(chapter), chapters: profile.chapters.filter(item => item.timestamp < chapter.timestamp) }, chapter.discovery?.domain ?? "place", locale)}</p><ExperienceReviewCard chapter={chapter} busy={busy} onSave={saveExperience}/></article>)}{profile?.layers.longTerm.filter(item => item.person === "A").map(item => <p key={`${item.kind}:${item.signal}`}>{item.signal}</p>)}</section>
      <RecoveryPanel currentType="solo"/>
      <div className="memory-reset"><button className="text-action" onClick={onSwitch}>{t("solo.mode.switch")}</button><p>{t("solo.mode.warning")}</p>{confirmReset ? <><p>{t("solo.memory.confirm")}</p><button className="secondary-action" disabled={busy} onClick={() => void reset()}>{t("solo.memory.delete")}</button><button className="text-action" onClick={() => setConfirmReset(false)}>{t("timeline.keep")}</button></> : <button className="text-action" disabled={busy || !profile} onClick={() => setConfirmReset(true)}>{t("solo.memory.reset")}</button>}</div>
    </div></div></section></main>;
}
