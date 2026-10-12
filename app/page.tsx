"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { ArrowLeft, BookOpen, ChevronRight, Compass, Film, Heart, MapPin, MessageCircleMore, Music2, Sparkles, Users, X } from "lucide-react";
import { FeedbackButtons, ExplorationTaste, PracticalFeedback, MemoryInvitation, MemoryTimeline, NextDiscovery, OurTaste } from "../components/relationship-memory";
import { discoveryDomains, type DiscoveryRecord } from "../lib/discovery";
import type { PreferenceSignal } from "../lib/practical-preferences";
import { practicalChips, type PracticalMetadata } from "../lib/practical-metadata";
import { deriveProfile, type Feedback, type MemorySnapshot } from "../lib/relationship-memory";
import { ExperienceReviewCard, type ExperienceAction } from "../components/experience-review";
import { LanguageProvider, LanguageToggle, useLanguage } from "../components/language-provider";
import { categoryLabel, domainLabel, statusExplanation, statusToken, translate, type Locale } from "../lib/i18n";
import { SoloApp } from "../components/solo-app";
import { modeStorageKey, resolveEntryMode, type EntryMode } from "../lib/entry-mode";
import { RecoveryPanel } from "../components/recovery-panel";

type View = "journey" | "taste" | "talk" | "spark" | "reveal" | "return";
type Participant = { id: "you" | "partner"; label: string; likes: string[]; dislikes: string[]; emotionalContext: string[]; entities: Array<{ name: string; type: string; why: string; confidence: number; provenance: "explicit" | "inferred" }> };
type Extraction = { experience: { title: string; category: string }; participants: Participant[]; sharedSpark: { title: string; summary: string }; location: { query: string; provenance: "explicit" | "none" }; confidence: number };
type AdventureMode = "LIVE" | "DEMO" | "FALLBACK" | "NEEDS_INPUT";
type Adventure = {
  id: string;
  title: string;
  category: string;
  eyebrow: string;
  description: string;
  place: string;
  detail: string;
  qlooEntityId?: string;
  discovery?: DiscoveryRecord;
  practicalMetadata?: PracticalMetadata;
  mode: AdventureMode;
  reason: string;
  question?: string | null;
  memory?: { saved: boolean; chapterId: string | null; priorChapters: number; explanation: string; persistence: string };
  trace: {
    reflections: string[];
    extraction: Extraction | null;
    extractionMode: "LIVE" | "DEMO" | "FALLBACK";
    extractionModel: string | null;
    resolvedEntities: Array<{ id: string; name: string; type: string; participant: "you" | "partner"; confidence: number; provenance: "explicit" | "inferred"; why: string }>;
    unresolvedEntities: Array<{ name: string; type: string; reason: string }>;
    candidateCount: number;
    knownFilteredCount: number;
    candidateCategories: Array<{ category: string; count: number; samples: string[] }>;
    qlooApiCalls: Array<{ stage: "search" | "insights" | "tags"; category: string; status: number; resultCount: number }>;
    explanation: { input: string; qloo: string; selection: string; llm: string };
  };
};

type Conversation = { experienceTitle: string; category: string; partnerName: string; location: string; you: string; partner: string };

const initialConversation: Conversation = {
  experienceTitle: "Princess Mononoke",
  category: "movie",
  partnerName: "Mika",
  location: "Tokyo",
  you: "I loved the ancient forest and the uneasy feeling that nature was watching us. I would happily visit somewhere quiet and green.",
  partner: "Joe Hisaishi's music stayed with me. I liked the wonder, but I do not want anything crowded or overly touristy.",
};

function createDemoAdventure(locale: Locale): Adventure { return {
  id: "demo-listening-room",
  title: translate(locale, "api.demo.title"),
  category: "place",
  eyebrow: translate(locale, "api.demo.eyebrow"),
  description: translate(locale, "api.demo.description"),
  place: translate(locale, "api.demo.place"),
  detail: translate(locale, "api.demo.detail"),
  mode: "DEMO",
  reason: translate(locale, "api.demo.reason"),
  question: translate(locale, "api.demo.question"),
  trace: {
    reflections: [], extraction: null, extractionMode: "DEMO", extractionModel: null, resolvedEntities: [], unresolvedEntities: [], candidateCount: 0, knownFilteredCount: 0, candidateCategories: [], qlooApiCalls: [],
    explanation: { input: translate(locale, "api.trace.noInput"), qloo: translate(locale, "api.trace.noQloo"), selection: translate(locale, "api.trace.demoSelection"), llm: translate(locale, "api.trace.noLlm") },
  },
}; }

declare global { interface Document { modelContext?: { registerTool: (tool: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean>; execute: (input: unknown) => unknown }, options?: { signal?: AbortSignal }) => void | Promise<void> } } }

export default function Home() {
  return <LanguageProvider><ModeEntry/></LanguageProvider>;
}

function ModeEntry() {
  const { t } = useLanguage();
  const mode = useSyncExternalStore(subscribeMode, readMode, () => null);
  const choose = (next: EntryMode | null) => { if (next) localStorage.setItem(modeStorageKey, next); else localStorage.removeItem(modeStorageKey); window.dispatchEvent(new Event("together-mode")); };
  if (mode === "pair") return <TogetherApp onSwitch={() => choose(null)}/>;
  if (mode === "solo") return <SoloApp onSwitch={() => choose(null)}/>;
  return <main className="app-shell"><div className="aurora one"/><div className="aurora two"/><section className="phone-stage"><header className="topbar"><div/><div className="brand"><span><Sparkles size={13}/></span>Together</div><LanguageToggle/></header><div className="screen-frame"><div className="mode-entry"><span className="eyebrow">Together</span><h1>{t("solo.mode.title")}</h1><p>{t("solo.mode.warning")}</p><button className="mode-choice" onClick={() => choose("pair")}><Users size={23}/><strong>{t("solo.mode.pair")}</strong></button><button className="mode-choice" onClick={() => choose("solo")}><Sparkles size={23}/><strong>{t("solo.mode.solo")}</strong></button><small>{t("solo.mode.separate")}</small><RecoveryPanel onRecovered={recovered => { choose(recovered); window.location.reload(); }}/></div></div></section></main>;
}
function subscribeMode(callback: () => void) { window.addEventListener("storage", callback); window.addEventListener("together-mode", callback); return () => { window.removeEventListener("storage", callback); window.removeEventListener("together-mode", callback); }; }
function readMode(): EntryMode | null { return resolveEntryMode(localStorage.getItem(modeStorageKey)); }

function TogetherApp({ onSwitch }: { onSwitch: () => void }) {
  const { locale, t } = useLanguage();
  const [view, setView] = useState<View>("journey");
  const [conversation, setConversation] = useState<Conversation>(initialConversation);
  const [adventure, setAdventure] = useState<Adventure>(() => createDemoAdventure("en"));
  const [loading, setLoading] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [planned, setPlanned] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [formError, setFormError] = useState("");
  const [memory, setMemory] = useState<MemorySnapshot | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState("");

  const refreshMemory = useCallback(async () => {
    try {
      const response = await fetch(`/api/memory?locale=${locale}`, { cache: "no-store" });
      setMemory(await response.json());
      if (!response.ok) setMemoryError(t("error.memoryUnavailable"));
    } catch { setMemoryError(t("error.memoryLoad")); }
  }, [locale, t]);

  useEffect(() => {
    const lifecycle = new AbortController();
    void fetch(`/api/memory?locale=${locale}`, { cache: "no-store", signal: lifecycle.signal }).then(async response => {
      const result: MemorySnapshot = await response.json();
      if (!lifecycle.signal.aborted) {
        setMemory(result);
        if (!response.ok) setMemoryError(t("error.memoryUnavailable"));
      }
    }).catch(() => { if (!lifecycle.signal.aborted) { setMemory({ chapters: [], profile: deriveProfile([]), persistence: "unavailable" }); setMemoryError(t("error.memoryLoad")); } });
    return () => lifecycle.abort();
  }, [locale, t]);

  const feedbackMemory = useCallback(async (chapterId: string, feedback: Feedback, reflection?: string, preference?: PreferenceSignal, status?: "tried" | "skipped") => {
    setMemoryBusy(true); setMemoryError("");
    try {
      const response = await fetch("/api/memory", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapterId, feedback, reflection, preference, status, locale }) });
      if (!response.ok) { const result = await response.json() as { error?: string }; setMemoryError(result.error ?? t("error.feedbackSave")); return false; }
      setMemory(await response.json());
      return true;
    } catch { setMemoryError(t("error.feedbackRetry")); return false; }
    finally { setMemoryBusy(false); }
  }, [locale, t]);

  const saveExperience = useCallback(async (action: ExperienceAction) => {
    setMemoryBusy(true); setMemoryError("");
    try {
      const response = await fetch("/api/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...action, locale }) });
      const result = await response.json() as MemorySnapshot & { error?: string };
      if (!response.ok) { setMemoryError(result.error ?? t("error.reactionSave")); return false; }
      setMemory(result); return true;
    } catch { setMemoryError(t("error.reactionRetry")); return false; }
    finally { setMemoryBusy(false); }
  }, [locale, t]);

  const resetMemory = useCallback(async () => {
    setMemoryBusy(true); setMemoryError("");
    try {
      const response = await fetch(`/api/memory?locale=${locale}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Reset unavailable");
      setMemory(await response.json()); setAdventure(createDemoAdventure(locale)); setPlanned(false); setView("journey");
    } catch { setMemoryError(t("error.reset")); }
    finally { setMemoryBusy(false); }
  }, [locale, t]);

  const findAdventure = useCallback(async () => {
    if (loading || memoryBusy) return;
    if (!memory) { setFormError(t("error.memoryLoading")); return; }
    if (!conversation.experienceTitle.trim() || conversation.you.trim().length < 8 || conversation.partner.trim().length < 8) {
      setFormError(t("error.reflectionsRequired"));
      return;
    }
    setFormError(""); setMemoryError(""); setLoading(true); setPlanned(false); setSaveError(false); setView("spark");
    try {
      const response = await fetch("/api/adventure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          experience: { title: conversation.experienceTitle, category: conversation.category },
          reflections: [
            { who: "you", label: "You", text: conversation.you },
            { who: "partner", label: conversation.partnerName || "Partner", text: conversation.partner },
          ],
          location: conversation.location,
          locale,
        }),
      });
      if (!response.ok) throw new Error("Unavailable");
      const result: Adventure = await response.json();
      setAdventure(result);
      if (result.memory?.saved) await refreshMemory();
      else if (result.mode === "LIVE") setMemoryError(t("error.groundedNotSaved"));
    } catch {
      setAdventure({ ...createDemoAdventure(locale), mode: "FALLBACK", reason: statusExplanation(locale, "FALLBACK") });
    } finally {
      setLoading(false);
    }
  }, [conversation, loading, memoryBusy, memory, refreshMemory, locale, t]);

  const discoverNext = useCallback(async (domain?: string, surprise = false) => {
    if (loading || memoryBusy || !memory) return;
    setMemoryError(""); setLoading(true); setPlanned(false); setSaveError(false); setView("spark");
    try {
      const response = await fetch("/api/adventure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "next_discovery", requestId: crypto.randomUUID(), domain, surprise, location: conversation.location, locale }) });
      if (!response.ok) throw new Error("Discovery unavailable");
      const result: Adventure = await response.json();
      setAdventure(result); setView("reveal");
      if (result.memory?.saved) await refreshMemory();
    } catch { setMemoryError(t("error.discovery")); setView("journey"); }
    finally { setLoading(false); }
  }, [loading, memoryBusy, memory, conversation.location, refreshMemory, locale, t]);

  const resumeDiscovery = useCallback(() => {
    const chapter = memory?.chapters[0];
    if (!chapter) return;
    setAdventure({ ...createDemoAdventure(locale), id: chapter.recommendation.id, qlooEntityId: chapter.recommendation.id, title: chapter.recommendation.name, category: chapter.recommendation.category,
      description: chapter.recommendation.description, place: chapter.recommendation.place, discovery: chapter.discovery, mode: "LIVE", eyebrow: t("resume.eyebrow"), detail: t("resume.detail"),
      reason: t("resume.reason"), question: null,
      memory: { saved: true, chapterId: chapter.id, priorChapters: memory!.chapters.length - 1, explanation: chapter.recommendation.rationale, persistence: "D1" },
      trace: { ...createDemoAdventure(locale).trace, resolvedEntities: chapter.entities, explanation: { input: t("resume.input"), qloo: t("resume.qloo", { name: chapter.recommendation.name }), selection: t("timeline.summary", { name: chapter.recommendation.name }), llm: t("resume.llm") } } });
    setPlanned(false); setSaveError(false); setView("reveal");
  }, [memory, locale, t]);

  const saveJourney = useCallback(async () => {
    setSaveError(false);
    if (adventure.mode !== "LIVE") return;
    try {
      const emotionalSignals = adventure.trace.extraction?.participants.flatMap(participant => participant.emotionalContext) ?? [];
      const response = await fetch("/api/journey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: adventure.id, qlooEntityId: adventure.qlooEntityId, title: adventure.title, type: adventure.category, reaction: "planned", reflection: "",
          culturalSignals: adventure.trace.resolvedEntities.map(entity => entity.name), emotionalSignals, withWhom: conversation.partnerName, discoveredFrom: conversation.experienceTitle, locale,
        }),
      });
      if (!response.ok) throw new Error("Journey save failed");
      setPlanned(true);
    } catch { setSaveError(true); }
  }, [adventure, conversation.experienceTitle, conversation.partnerName, locale]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({ name: "reveal_next_adventure", title: t("tool.revealTitle"), description: t("tool.revealDescription"), inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async () => { await findAdventure(); return { status: "revealed" }; } }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [findAdventure, t]);

  const visibleAdventure = adventure.mode === "DEMO" ? createDemoAdventure(locale) : adventure;
  const titles: Record<View, string> = { journey: t("view.journey"), taste: t("view.taste"), talk: t("view.talk"), spark: t("view.spark"), reveal: t("view.reveal"), return: t("view.return") };
  return <main className="app-shell">
    <div className="aurora one"/><div className="aurora two"/>
    <section className="phone-stage" aria-label={t("app.aria")}>
      <header className="topbar">
        <button className={`icon-button ${view === "journey" ? "invisible" : ""}`} onClick={() => setView(view === "return" ? "reveal" : view === "reveal" ? "spark" : "journey")} aria-label={t("nav.back")}><ArrowLeft size={19}/></button>
        <div className="brand"><span><Sparkles size={13}/></span>{titles[view]}</div>
        <div className="topbar-actions"><LanguageToggle/><span className={`mode-pill ${loading ? "checking" : visibleAdventure.mode.toLowerCase().replace("_", "-")}`} title={statusExplanation(locale, visibleAdventure.mode)}><i/>{loading ? t("status.listening") : statusToken(visibleAdventure.mode)}</span></div>
      </header>
      <div className="screen-frame">
        {memoryError && <p role="alert" className="save-error memory-notice">{memoryError}</p>}
        {view === "journey" && <><div className="memory-surfaces"><NextDiscovery memory={memory} busy={memoryBusy || loading} onDiscover={discoverNext} onTalk={() => setView("talk")} onResume={resumeDiscovery}/></div><Journey planned={planned} adventureTitle={visibleAdventure.title} onTalk={() => setView("talk")} count={memory?.chapters.length ?? 0}/><div className="memory-surfaces"><button className="secondary-action full" onClick={() => setView("taste")}>{t("taste.open", { count: memory?.profile.chapters ?? 0, chapters: t("common.chapters") })}</button><MemoryTimeline memory={memory} busy={memoryBusy || loading} onFeedback={feedbackMemory} onExperience={saveExperience} onReset={resetMemory}/><RecoveryPanel currentType="pair"/><button className="text-action" onClick={onSwitch}>{t("solo.mode.switch")}</button></div></>}
        {view === "taste" && <div className="memory-surfaces screen-enter"><OurTaste memory={memory} busy={memoryBusy || loading} onDiscover={discoverNext}/><ExplorationTaste memory={memory}/><MemoryInvitation count={memory?.profile.chapters ?? 0} onTalk={() => setView("talk")}/></div>}
        {view === "talk" && <><p className="memory-disclosure">{t("privacy.disclosure")}</p><Talk value={conversation} setValue={setConversation} error={formError} onContinue={findAdventure}/></>}
        {view === "spark" && <SharedSpark adventure={visibleAdventure} loading={loading} onContinue={() => setView("reveal")} onBack={() => setView("talk")}/>}
        {view === "reveal" && visibleAdventure.mode === "LIVE" && visibleAdventure.discovery && <div className="memory-surfaces discovery-why"><span className="domain-badge">{domainLabel(locale, visibleAdventure.discovery.domain, discoveryDomains.find(domain => domain.id === visibleAdventure.discovery?.domain)?.label)}</span><h3>{t("discovery.whyTitle")}</h3><p><b>{t("discovery.known")}</b>{visibleAdventure.discovery.why.known}</p><p><b>{t("discovery.new")}</b>{visibleAdventure.discovery.why.new}</p><p><b>{t("discovery.fits")}</b>{visibleAdventure.discovery.why.fits}</p></div>}
{view === "reveal" && <>{visibleAdventure.memory && <p className="memory-why">{visibleAdventure.memory.explanation}</p>}<Reveal adventure={visibleAdventure} planned={planned} saveError={saveError} onExplain={() => setExplainOpen(true)} onAccept={() => saveJourney()} onReject={() => setView("talk")} onReturn={() => setView("return")}/>{visibleAdventure.memory?.saved && visibleAdventure.memory.chapterId && <div className="memory-surfaces"><p>{t("discovery.feelsRight")} <small>{t("common.optional")}</small></p><FeedbackButtons value={memory?.chapters.find(chapter => chapter.id === visibleAdventure.memory?.chapterId)?.feedback ?? null} busy={memoryBusy} onChange={feedback => feedbackMemory(visibleAdventure.memory!.chapterId!, feedback)}/><PracticalFeedback key={visibleAdventure.memory.chapterId} chapterId={visibleAdventure.memory.chapterId} category={visibleAdventure.category} count={memory?.chapters.length ?? 0} feedback={memory?.chapters.find(chapter => chapter.id === visibleAdventure.memory?.chapterId)?.feedback ?? null} busy={memoryBusy} onSave={feedbackMemory}/>{memory?.chapters.find(chapter => chapter.id === visibleAdventure.memory?.chapterId) && <ExperienceReviewCard key={visibleAdventure.memory.chapterId} chapter={memory.chapters.find(chapter => chapter.id === visibleAdventure.memory?.chapterId)!} busy={memoryBusy} onSave={saveExperience}/>}</div>}</>}
        {view === "return" && <div className="memory-surfaces screen-enter"><Heading eyebrow={t("return.eyebrow")} title={t("return.title")} text={visibleAdventure.title}/>{memory?.chapters.find(chapter => chapter.id === visibleAdventure.memory?.chapterId) ? <ExperienceReviewCard chapter={memory.chapters.find(chapter => chapter.id === visibleAdventure.memory?.chapterId)!} busy={memoryBusy} onSave={saveExperience}/> : <p>{t("return.requiresLive")}</p>}<button className="text-action" onClick={() => setView("journey")}>{t("return.journey")}</button></div>}
      </div>
      <nav className="bottom-nav" aria-label={t("nav.primary")}>
        <button className={view === "journey" ? "active" : ""} onClick={() => setView("journey")}><Compass size={21}/><span>{t("nav.journey")}</span></button>
        <button className={view === "taste" ? "active" : ""} onClick={() => setView("taste")}><b><Heart size={23}/></b><span>{t("nav.taste")}</span></button>
        <button className={view === "reveal" ? "active" : ""} onClick={() => setView("reveal")}><Sparkles size={21}/><span>{t("nav.discovery")}</span></button>
      </nav>
    </section>
    <aside className="desktop-story"><span className="overline">{t("hero.overline")}</span><h1>{t("hero.titleStart")} <em>{t("hero.titleEmphasis")}</em></h1><p>{t("hero.text")}</p><div/><small>{t("hero.footnote")}</small></aside>
    {explainOpen && <Explanation adventure={visibleAdventure} onClose={() => setExplainOpen(false)}/>}
  </main>;
}

function Journey({ planned, adventureTitle, onTalk, count }: { planned: boolean; adventureTitle: string; onTalk: () => void; count: number }) {
  const { t } = useLanguage();
  const nodes = [
    { label: t("journey.node.shared"), icon: Film, x: 20, y: 73, active: true },
    { label: t("journey.node.you"), icon: Heart, x: 44, y: 55 },
    { label: t("journey.node.partner"), icon: MessageCircleMore, x: 68, y: 38 },
    { label: t("journey.node.unknown"), icon: Sparkles, x: 84, y: 18, unknown: true },
  ];
  return <div className={`journey screen-enter ${count ? "has-memory" : ""}`}><div className="journey-intro"><div><span className="eyebrow">{t("journey.eyebrow")}</span><h2>{count ? t("journey.returningTitle") : t("journey.firstTitle")}</h2></div><div className="avatars"><span>Y</span><span>+</span></div></div><p className="memory-promise">{t("journey.promise")}</p><div className="constellation"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M21 73 C31 63 36 61 45 55 S61 45 69 39 S78 27 84 18"/><path className="ghost" d="M45 55 C50 72 68 76 88 64"/></svg>{nodes.map(node => { const Icon = node.icon; const isPlanned = node.unknown && planned; return <div key={node.label} className={`node ${node.active ? "active" : ""} ${node.unknown ? "unknown" : ""} ${isPlanned ? "planned" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%` }}><span><Icon size={node.unknown ? 18 : 15}/></span><small>{isPlanned ? adventureTitle : node.label}</small></div>; })}<i>{count ? t("journey.count", { count, chapters: count === 1 ? t("common.chapter") : t("common.chapters") }) : t("journey.question")}</i></div><MemoryInvitation count={count} onTalk={onTalk}/><button className="primary-action full journey-start" onClick={onTalk}><MessageCircleMore size={18}/>{t("journey.cta")}</button></div>;
}

function Talk({ value, setValue, error, onContinue }: { value: Conversation; setValue: (value: Conversation) => void; error: string; onContinue: () => void }) {
  const { locale, t } = useLanguage();
  const update = (field: keyof Conversation, next: string) => setValue({ ...value, [field]: next });
  return <div className="talk screen-enter"><Heading eyebrow={t("talk.eyebrow")} title={t("talk.title")} text={t("talk.text")}/><div className="conversation-form"><div className="field-row"><label><span>{t("talk.sharedExperience")}</span><input value={value.experienceTitle} onChange={event => update("experienceTitle", event.target.value)} placeholder={t("talk.sharedPlaceholder")}/></label><label className="category-field"><span>{t("talk.kind")}</span><select value={value.category} onChange={event => update("category", event.target.value)}>{["movie", "music", "food", "book", "place", "show", "podcast", "other"].map(option => <option key={option} value={option}>{categoryLabel(locale, option)}</option>)}</select></label></div><div className="field-row"><label><span>{t("talk.partnerName")}</span><input value={value.partnerName} onChange={event => update("partnerName", event.target.value)} placeholder={t("talk.partnerPlaceholder")}/></label><label><span>{t("talk.near")}</span><input value={value.location} onChange={event => update("location", event.target.value)} placeholder={t("talk.locationPlaceholder")}/></label></div><label><span>{t("talk.yourReflection")}</span><textarea value={value.you} onChange={event => update("you", event.target.value)} placeholder={t("talk.yourPlaceholder")}/></label><label><span>{t("talk.theirReflection", { name: value.partnerName || t("talk.partnerPlaceholder") })}</span><textarea value={value.partner} onChange={event => update("partner", event.target.value)} placeholder={t("talk.theirPlaceholder")}/></label></div>{error && <p className="save-error" role="alert">{error}</p>}<div className="signal-preview"><Sparkles size={16}/>{t("talk.signalPreview")}</div><button className="primary-action full talk-continue" onClick={onContinue}>{t("talk.continue")} <ChevronRight size={16}/></button></div>;
}

function SharedSpark({ adventure, loading, onContinue, onBack }: { adventure: Adventure; loading: boolean; onContinue: () => void; onBack: () => void }) {
  const { t } = useLanguage();
  if (loading) return <div className="finding"><span><Sparkles size={24}/></span><p>{t("spark.listening")}</p><h2>{t("spark.finding")}</h2><small>{t("spark.steps")}</small></div>;
  const extraction = adventure.trace.extraction;
  const you = extraction?.participants.find(participant => participant.id === "you");
  const partner = extraction?.participants.find(participant => participant.id === "partner");
  const fallbackTitle = adventure.mode === "DEMO" ? t("spark.demo") : adventure.mode === "FALLBACK" ? t("spark.fallback") : t("spark.more");
  return <div className="spark screen-enter"><Heading eyebrow={adventure.mode === "LIVE" ? t("spark.liveEyebrow") : t("spark.honestEyebrow")} title={extraction?.sharedSpark.title ?? fallbackTitle} text={extraction?.sharedSpark.summary ?? adventure.reason}/><div className="venn"><TasteCircle side="you" label={you?.label ?? "YOU"} title={you?.likes[0] ?? t("spark.yourEdge")} details={[...(you?.emotionalContext ?? []), ...(you?.likes.slice(1) ?? [])]}/><TasteCircle side="mika" label={partner?.label ?? "PARTNER"} title={partner?.likes[0] ?? t("spark.theirEdge")} details={[...(partner?.emotionalContext ?? []), ...(partner?.likes.slice(1) ?? [])]}/><div className="shared"><Sparkles size={19}/><strong>{extraction?.sharedSpark.title ?? t("spark.noMatch")}</strong><small>{adventure.trace.extractionMode === "LIVE" ? t("spark.confidence", { percent: Math.round((extraction?.confidence ?? 0) * 100) }) : t("spark.prepared")}</small></div></div><div className="spark-insight"><span><Heart size={17}/></span><p>{adventure.mode === "LIVE" ? t("spark.verified", { count: adventure.trace.resolvedEntities.length }) : adventure.question ?? t("spark.noClaim")}</p></div><div className="spark-actions"><button className="secondary-action" onClick={onBack}>{t("spark.addDetail")}</button><button className="primary-action" onClick={onContinue}>{adventure.mode === "NEEDS_INPUT" ? t("spark.missing") : t("spark.reveal")}</button></div><p className="privacy"><Users size={14}/>{t("spark.privacy")}</p></div>;
}

function TasteCircle({ side, label, title, details }: { side: "you" | "mika"; label: string; title: string; details: string[] }) {
  return <div className={`taste ${side}`}><small>{label.toUpperCase()}</small><strong>{title}</strong>{details.slice(0, 2).map(detail => <span key={detail}>{detail}</span>)}</div>;
}

function Reveal({ adventure, planned, saveError, onExplain, onAccept, onReject, onReturn }: { adventure: Adventure; planned: boolean; saveError: boolean; onExplain: () => void; onAccept: () => void; onReject: () => void; onReturn: () => void }) {
  const { locale, t } = useLanguage();
  const canSave = adventure.mode === "LIVE";
  return <div className="reveal screen-enter"><article className={`adventure-card ${adventure.mode.toLowerCase().replace("_", "-")}`}>{adventure.mode === "LIVE" ? <div className="live-card-art">{adventure.category === "book" ? <BookOpen size={48}/> : adventure.category === "place" ? <MapPin size={48}/> : <Music2 size={48}/>}</div> : <Image src="/tokyo-listening-bar.png" alt={t("reveal.imageAlt")} fill sizes="(max-width: 850px) 100vw, 470px" priority/>}<div className="scrim"/><div className="adventure-copy"><span className="eyebrow">{adventure.eyebrow}</span><h2>{adventure.title}</h2><p>{adventure.description}</p><PracticalFactChips metadata={canSave ? adventure.practicalMetadata : undefined}/><div className="meta"><span><MapPin size={15}/>{adventure.place}</span><span>{adventure.detail}</span></div></div><div className="status" title={statusExplanation(locale, adventure.mode)}><Sparkles size={14}/>{modeLabel(adventure.mode)}</div></article><button className="why" onClick={onExplain}><span><i><Sparkles size={15}/></i><span><strong>{t("reveal.why")}</strong><small>{t("reveal.whySub")}</small></span></span><ChevronRight size={18}/></button>{saveError && <p role="alert" className="save-error">{t("error.journeySave")}</p>}{!planned ? <div className="reveal-actions"><button onClick={onReject}>{canSave ? t("reveal.change") : t("reveal.clue")}</button><button onClick={onAccept} disabled={!canSave}>{canSave ? t("reveal.go") : t("reveal.notLive")} {canSave && <ChevronRight size={18}/>}</button></div> : <div className="planned-state"><span><Sparkles size={17}/>{t("reveal.added")}</span><button onClick={onReturn}>{t("reveal.report")}</button></div>}</div>;
}

function PracticalFactChips({ metadata }: { metadata?: PracticalMetadata }) {
  const { locale } = useLanguage();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const chips = practicalChips(metadata, now, locale);
  return chips.length ? <div className="practical-fact-chips">{chips.map(chip => <a key={chip.label} href={chip.source} title={chip.detail} target="_blank" rel="noreferrer">{chip.label}</a>)}</div> : null;
}

function Explanation({ adventure, onClose }: { adventure: Adventure; onClose: () => void }) {
  const { t } = useLanguage();
  return <div className="modal-backdrop" onClick={onClose}><section className="explain-sheet" role="dialog" aria-modal="true" aria-label={t("explain.dialog")} onClick={event => event.stopPropagation()}><button className="close" onClick={onClose} aria-label={t("explain.close")}><X size={18}/></button><span className="overline">{adventure.mode === "LIVE" ? t("explain.live") : t("explain.noClaim")}</span><h2>{t("explain.dialog")}</h2><div className="trace-flow"><Trace n="01" title={t("explain.engine")} text={adventure.trace.explanation.llm}/><Trace n="02" title={t("explain.input")} text={adventure.trace.explanation.input}/><Trace n="03" title={t("explain.qloo")} text={adventure.trace.explanation.qloo} highlight={adventure.mode === "LIVE"}/><Trace n="04" title={t("explain.selection")} text={adventure.trace.explanation.selection}/></div>{adventure.trace.unresolvedEntities.length > 0 && <p className="honesty">{t("explain.notUsed", { items: adventure.trace.unresolvedEntities.map(entity => `${entity.name} (${entity.reason})`).join(" · ") })}</p>}<p className="reason">{adventure.reason}</p>{adventure.mode === "LIVE" && <p className="honesty">{t("explain.qlooApi", { calls: adventure.trace.qlooApiCalls.map(call => `${call.stage}/${call.category} ${call.status} (${call.resultCount})`).join(" · ") })}</p>}<p className="honesty">{adventure.mode === "LIVE" ? t("explain.liveNote") : adventure.mode === "DEMO" ? t("explain.demoNote") : adventure.mode === "NEEDS_INPUT" ? t("explain.needsNote") : t("explain.fallbackNote")}</p></section></div>;
}

function modeLabel(mode: AdventureMode) { return mode === "LIVE" ? "Qloo LIVE" : mode; }
function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div className="heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{text}</p></div>; }
function Trace({ n, title, text, highlight = false }: { n: string; title: string; text: string; highlight?: boolean }) { return <div className={`trace ${highlight ? "highlight" : ""}`}><span>{n}</span><div><strong>{title}</strong><p>{text}</p></div></div>; }
