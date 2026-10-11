"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, BookOpen, ChevronRight, Compass, Film, Heart, MapPin, MessageCircleMore, Music2, Sparkles, Users, X } from "lucide-react";
import { FeedbackButtons, ExplorationTaste, PracticalFeedback, MemoryInvitation, MemoryTimeline, NextDiscovery, OurTaste } from "../components/relationship-memory";
import { discoveryDomains, type DiscoveryRecord } from "../lib/discovery";
import type { PreferenceSignal } from "../lib/practical-preferences";
import { practicalChips, type PracticalMetadata } from "../lib/practical-metadata";
import { deriveProfile, type Feedback, type MemorySnapshot } from "../lib/relationship-memory";

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

const demoAdventure: Adventure = {
  id: "demo-listening-room",
  title: "A hidden listening room",
  category: "place",
  eyebrow: "A PREPARED ADVENTURE",
  description: "Choose one album you each love, find a quiet listening room, and trade the story behind your pick.",
  place: "Choose somewhere close to home",
  detail: "Prepared demo · no live AI or Qloo result",
  mode: "DEMO",
  reason: "The LLM connection is not configured, so Together did not claim to understand this free-form conversation.",
  question: "Connect the Conversation Engine to turn free-form reflections into verified cultural signals.",
  trace: {
    reflections: [], extraction: null, extractionMode: "DEMO", extractionModel: null, resolvedEntities: [], unresolvedEntities: [], candidateCount: 0, knownFilteredCount: 0, candidateCategories: [], qlooApiCalls: [],
    explanation: { input: "No verified entities were sent to Qloo.", qloo: "No live Qloo inference was used.", selection: "This prepared activity is shown only to demonstrate the flow.", llm: "No LLM extraction was available." },
  },
};

const nodes = [
  { label: "A shared experience", icon: Film, x: 20, y: 73, active: true },
  { label: "Your reflection", icon: Heart, x: 44, y: 55 },
  { label: "Their reflection", icon: MessageCircleMore, x: 68, y: 38 },
  { label: "Unknown", icon: Sparkles, x: 84, y: 18, unknown: true },
];

declare global { interface Document { modelContext?: { registerTool: (tool: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean>; execute: (input: unknown) => unknown }, options?: { signal?: AbortSignal }) => void | Promise<void> } } }

export default function Home() {
  const [view, setView] = useState<View>("journey");
  const [conversation, setConversation] = useState<Conversation>(initialConversation);
  const [adventure, setAdventure] = useState<Adventure>(demoAdventure);
  const [loading, setLoading] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [planned, setPlanned] = useState(false);
  const [note, setNote] = useState("");
  const [reaction, setReaction] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [formError, setFormError] = useState("");
  const [memory, setMemory] = useState<MemorySnapshot | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState("");

  const refreshMemory = useCallback(async () => {
    try {
      const response = await fetch("/api/memory", { cache: "no-store" });
      setMemory(await response.json());
      if (!response.ok) setMemoryError("Memory is temporarily unavailable. No new learning is being claimed.");
    } catch { setMemoryError("Could not load your memory. Please try again."); }
  }, []);

  useEffect(() => {
    const lifecycle = new AbortController();
    void fetch("/api/memory", { cache: "no-store", signal: lifecycle.signal }).then(async response => {
      const result: MemorySnapshot = await response.json();
      if (!lifecycle.signal.aborted) {
        setMemory(result);
        if (!response.ok) setMemoryError("Memory is temporarily unavailable. No new learning is being claimed.");
      }
    }).catch(() => { if (!lifecycle.signal.aborted) { setMemory({ chapters: [], profile: deriveProfile([]), persistence: "unavailable" }); setMemoryError("Could not load your memory. Please try again."); } });
    return () => lifecycle.abort();
  }, []);

  const feedbackMemory = useCallback(async (chapterId: string, feedback: Feedback, reflection?: string, preference?: PreferenceSignal, status?: "tried" | "skipped") => {
    setMemoryBusy(true); setMemoryError("");
    try {
      const response = await fetch("/api/memory", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapterId, feedback, reflection, preference, status }) });
      if (!response.ok) { const result = await response.json() as { error?: string }; setMemoryError(result.error ?? "Could not save feedback."); return false; }
      setMemory(await response.json());
      return true;
    } catch { setMemoryError("Could not save feedback. Please try again."); return false; }
    finally { setMemoryBusy(false); }
  }, []);

  const resetMemory = useCallback(async () => {
    setMemoryBusy(true); setMemoryError("");
    try {
      const response = await fetch("/api/memory", { method: "DELETE" });
      if (!response.ok) throw new Error("Reset unavailable");
      setMemory(await response.json()); setAdventure(demoAdventure); setPlanned(false); setSaved(false); setNote(""); setReaction(null); setView("journey");
    } catch { setMemoryError("Could not reset your Journey. Your memory is still here; please try again."); }
    finally { setMemoryBusy(false); }
  }, []);

  const findAdventure = useCallback(async () => {
    if (loading || memoryBusy) return;
    if (!memory) { setFormError("Your Journey memory is still loading. Please try again in a moment."); return; }
    if (!conversation.experienceTitle.trim() || conversation.you.trim().length < 8 || conversation.partner.trim().length < 8) {
      setFormError("Add the shared experience and a short reflection from both people.");
      return;
    }
    setFormError(""); setMemoryError(""); setLoading(true); setPlanned(false); setSaved(false); setSaveError(false); setNote(""); setReaction(null); setView("spark");
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
        }),
      });
      if (!response.ok) throw new Error("Unavailable");
      const result: Adventure = await response.json();
      setAdventure(result);
      if (result.memory?.saved) await refreshMemory();
      else if (result.mode === "LIVE") setMemoryError("This grounded reveal was not saved. Your taste memory has not changed.");
    } catch {
      setAdventure({ ...demoAdventure, mode: "FALLBACK", reason: "The adventure service is unavailable. No live recommendation is being claimed." });
    } finally {
      setLoading(false);
    }
  }, [conversation, loading, memoryBusy, memory, refreshMemory]);

  const discoverNext = useCallback(async (domain?: string, surprise = false) => {
    if (loading || memoryBusy || !memory) return;
    setMemoryError(""); setLoading(true); setPlanned(false); setSaved(false); setSaveError(false); setNote(""); setReaction(null); setView("spark");
    try {
      const response = await fetch("/api/adventure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "next_discovery", requestId: crypto.randomUUID(), domain, surprise, location: conversation.location }) });
      if (!response.ok) throw new Error("Discovery unavailable");
      const result: Adventure = await response.json();
      setAdventure(result); setView("reveal");
      if (result.memory?.saved) await refreshMemory();
    } catch { setMemoryError("Could not find your next discovery. Please try again."); setView("journey"); }
    finally { setLoading(false); }
  }, [loading, memoryBusy, memory, conversation.location, refreshMemory]);

  const resumeDiscovery = useCallback(() => {
    const chapter = memory?.chapters[0];
    if (!chapter) return;
    setAdventure({ ...demoAdventure, id: chapter.recommendation.id, qlooEntityId: chapter.recommendation.id, title: chapter.recommendation.name, category: chapter.recommendation.category,
      description: chapter.recommendation.description, place: chapter.recommendation.place, discovery: chapter.discovery, mode: "LIVE", eyebrow: "YOUR NEXT DISCOVERY", detail: "Saved grounded discovery",
      reason: "This is your saved Qloo-grounded chapter. No new recommendation was generated.", question: null,
      memory: { saved: true, chapterId: chapter.id, priorChapters: memory!.chapters.length - 1, explanation: chapter.recommendation.rationale, persistence: "D1" },
      trace: { ...demoAdventure.trace, resolvedEntities: chapter.entities, explanation: { input: "Saved exact-matched Qloo interests.", qloo: `Saved Qloo candidate: ${chapter.recommendation.name}.`, selection: chapter.recommendation.rationale, llm: "Earlier structured reflections; no new interpretation." } } });
    setPlanned(false); setSaved(false); setSaveError(false); setNote(""); setReaction(null); setView("reveal");
  }, [memory]);

  const saveJourney = useCallback(async (nextReaction = "planned") => {
    setSaved(false); setSaveError(false);
    if (adventure.mode !== "LIVE") return;
    if (nextReaction !== "planned" && adventure.memory?.chapterId) {
      const feedback: Feedback = nextReaction === "Loved it" || nextReaction === "Good" ? "liked" : nextReaction === "Never again" ? "not_for_us" : "neutral";
      const result = await feedbackMemory(adventure.memory.chapterId, feedback, note, undefined, "tried");
      setSaved(result); setSaveError(!result); return;
    }
    try {
      const emotionalSignals = adventure.trace.extraction?.participants.flatMap(participant => participant.emotionalContext) ?? [];
      const response = await fetch("/api/journey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: adventure.id, qlooEntityId: adventure.qlooEntityId, title: adventure.title, type: adventure.category, reaction: nextReaction, reflection: note,
          culturalSignals: adventure.trace.resolvedEntities.map(entity => entity.name), emotionalSignals, withWhom: conversation.partnerName, discoveredFrom: conversation.experienceTitle,
        }),
      });
      if (!response.ok) throw new Error("Journey save failed");
      setPlanned(true); setSaved(true);
    } catch { setSaveError(true); }
  }, [adventure, conversation.experienceTitle, conversation.partnerName, note, feedbackMemory]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({ name: "reveal_next_adventure", title: "Reveal the next adventure", description: "Use the current shared reflections to reveal one culturally grounded next adventure.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async () => { await findAdventure(); return { status: "revealed" }; } }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [findAdventure]);

  const titles: Record<View, string> = { journey: "Our Journey", taste: "Our Taste", talk: "Talk", spark: "Shared Spark", reveal: "Next Discovery", return: "After" };
  return <main className="app-shell">
    <div className="aurora one"/><div className="aurora two"/>
    <section className="phone-stage" aria-label="Together journey app">
      <header className="topbar">
        <button className={`icon-button ${view === "journey" ? "invisible" : ""}`} onClick={() => setView(view === "return" ? "reveal" : view === "reveal" ? "spark" : "journey")} aria-label="Go back"><ArrowLeft size={19}/></button>
        <div className="brand"><span><Sparkles size={13}/></span>{titles[view]}</div>
        <span className={`mode-pill ${loading ? "checking" : adventure.mode.toLowerCase().replace("_", "-")}`}><i/>{loading ? "LISTENING" : adventure.mode === "NEEDS_INPUT" ? "MORE INPUT" : adventure.mode}</span>
      </header>
      <div className="screen-frame">
        {memoryError && <p role="alert" className="save-error memory-notice">{memoryError}</p>}
        {view === "journey" && <><div className="memory-surfaces"><NextDiscovery memory={memory} busy={memoryBusy || loading} onDiscover={discoverNext} onTalk={() => setView("talk")} onResume={resumeDiscovery}/></div><Journey planned={planned} adventureTitle={adventure.title} onTalk={() => setView("talk")} count={memory?.chapters.length ?? 0}/><div className="memory-surfaces"><button className="secondary-action full" onClick={() => setView("taste")}>Our Taste · {memory?.profile.chapters ?? 0} chapters</button><MemoryTimeline memory={memory} busy={memoryBusy || loading} onFeedback={feedbackMemory} onReset={resetMemory}/></div></>}
        {view === "taste" && <div className="memory-surfaces screen-enter"><OurTaste memory={memory} busy={memoryBusy || loading} onDiscover={discoverNext}/><ExplorationTaste memory={memory}/><MemoryInvitation count={memory?.profile.chapters ?? 0} onTalk={() => setView("talk")}/></div>}
        {view === "talk" && <><p className="memory-disclosure">Grounded reveals remember both reflections in your anonymous Journey. Reset our journey deletes them. Avoid sensitive personal information.</p><Talk value={conversation} setValue={setConversation} error={formError} onContinue={findAdventure}/></>}
        {view === "spark" && <SharedSpark adventure={adventure} loading={loading} onContinue={() => setView("reveal")} onBack={() => setView("talk")}/>}
        {view === "reveal" && adventure.mode === "LIVE" && adventure.discovery && <div className="memory-surfaces discovery-why"><span className="domain-badge">{discoveryDomains.find(domain => domain.id === adventure.discovery?.domain)?.label}</span><h3>Why this discovery?</h3><p><b>What we know about you two</b>{adventure.discovery.why.known}</p><p><b>Why this is new</b>{adventure.discovery.why.new}</p><p><b>Why it still fits</b>{adventure.discovery.why.fits}</p></div>}
{view === "reveal" && <>{adventure.memory && <p className="memory-why">{adventure.memory.explanation}</p>}<Reveal adventure={adventure} planned={planned} saveError={saveError} onExplain={() => setExplainOpen(true)} onAccept={() => saveJourney()} onReject={() => setView("talk")} onReturn={() => { setSaved(false); setView("return"); }}/>{adventure.memory?.saved && adventure.memory.chapterId && <div className="memory-surfaces"><p>Does this next adventure feel right? <small>Optional</small></p><FeedbackButtons value={memory?.chapters.find(chapter => chapter.id === adventure.memory?.chapterId)?.feedback ?? null} busy={memoryBusy} onChange={feedback => feedbackMemory(adventure.memory!.chapterId!, feedback)}/><PracticalFeedback key={adventure.memory.chapterId} chapterId={adventure.memory.chapterId} category={adventure.category} count={memory?.chapters.length ?? 0} feedback={memory?.chapters.find(chapter => chapter.id === adventure.memory?.chapterId)?.feedback ?? null} busy={memoryBusy} onSave={feedbackMemory}/></div>}</>}
        {view === "return" && <ReturnView adventure={adventure} note={note} setNote={setNote} reaction={reaction} setReaction={setReaction} saved={saved} saveError={saveError} onSave={() => reaction && saveJourney(reaction)} onJourney={() => setView("journey")}/>}
      </div>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <button className={view === "journey" ? "active" : ""} onClick={() => setView("journey")}><Compass size={21}/><span>Journey</span></button>
        <button className={view === "taste" ? "active" : ""} onClick={() => setView("taste")}><b><Heart size={23}/></b><span>Our Taste</span></button>
        <button className={view === "reveal" ? "active" : ""} onClick={() => setView("reveal")}><Sparkles size={21}/><span>Discovery</span></button>
      </nav>
    </section>
    <aside className="desktop-story"><span className="overline">QLOO AGENTIC HACKATHON</span><h1>Don&apos;t show recommendations. <em>Reveal adventures.</em></h1><p>Together remembers how two people experience things differently—and uses that memory to choose what they should discover next.</p><div/><small>AI adds a chapter to an existing relationship. It never replaces the person beside you.</small></aside>
    {explainOpen && <Explanation adventure={adventure} onClose={() => setExplainOpen(false)}/>}
  </main>;
}

function Journey({ planned, adventureTitle, onTalk, count }: { planned: boolean; adventureTitle: string; onTalk: () => void; count: number }) {
  return <div className={`journey screen-enter ${count ? "has-memory" : ""}`}><div className="journey-intro"><div><span className="eyebrow">YOU + SOMEONE YOU CARE ABOUT</span><h2>{count ? "A little more us, with every chapter." : "One conversation away from somewhere new."}</h2></div><div className="avatars"><span>Y</span><span>+</span></div></div><p className="memory-promise">Together learns how two people experience the world together.</p><div className="constellation"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M21 73 C31 63 36 61 45 55 S61 45 69 39 S78 27 84 18"/><path className="ghost" d="M45 55 C50 72 68 76 88 64"/></svg>{nodes.map(node => { const Icon = node.icon; const isPlanned = node.unknown && planned; return <div key={node.label} className={`node ${node.active ? "active" : ""} ${node.unknown ? "unknown" : ""} ${isPlanned ? "planned" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%` }}><span><Icon size={node.unknown ? 18 : 15}/></span><small>{isPlanned ? adventureTitle : node.label}</small></div>; })}<i>{count ? `${count} grounded chapters · still discovering` : "What should we experience next?"}</i></div><MemoryInvitation count={count} onTalk={onTalk}/><button className="primary-action full journey-start" onClick={onTalk}><MessageCircleMore size={18}/>What should we try next?</button></div>;
}

function Talk({ value, setValue, error, onContinue }: { value: Conversation; setValue: (value: Conversation) => void; error: string; onContinue: () => void }) {
  const update = (field: keyof Conversation, next: string) => setValue({ ...value, [field]: next });
  return <div className="talk screen-enter"><Heading eyebrow="START WITH SOMETHING REAL" title="What stayed with each of you?" text="Name specific films, artists, books, food, or places when you can. Together verifies them before Qloo sees them."/><div className="conversation-form"><div className="field-row"><label><span>Shared experience</span><input value={value.experienceTitle} onChange={event => update("experienceTitle", event.target.value)} placeholder="A film, meal, concert, book…"/></label><label className="category-field"><span>Kind</span><select value={value.category} onChange={event => update("category", event.target.value)}>{["movie", "music", "food", "book", "place", "show", "podcast", "other"].map(option => <option key={option}>{option}</option>)}</select></label></div><div className="field-row"><label><span>Their name</span><input value={value.partnerName} onChange={event => update("partnerName", event.target.value)} placeholder="Partner"/></label><label><span>Near</span><input value={value.location} onChange={event => update("location", event.target.value)} placeholder="Optional city"/></label></div><label><span>Your reflection</span><textarea value={value.you} onChange={event => update("you", event.target.value)} placeholder="What did you love, avoid, or feel?"/></label><label><span>{value.partnerName || "Their"} reflection</span><textarea value={value.partner} onChange={event => update("partner", event.target.value)} placeholder="What caught their attention instead?"/></label></div>{error && <p className="save-error" role="alert">{error}</p>}<div className="signal-preview"><Sparkles size={16}/>The Conversation Engine extracts signals; Qloo Search decides which entities are real.</div><button className="primary-action full talk-continue" onClick={onContinue}>Find our Shared Spark <ChevronRight size={16}/></button></div>;
}

function SharedSpark({ adventure, loading, onContinue, onBack }: { adventure: Adventure; loading: boolean; onContinue: () => void; onBack: () => void }) {
  if (loading) return <div className="finding"><span><Sparkles size={24}/></span><p>Listening for the difference…</p><h2>Finding your Shared Spark.</h2><small>Extracting, verifying, then asking Qloo</small></div>;
  const extraction = adventure.trace.extraction;
  const you = extraction?.participants.find(participant => participant.id === "you");
  const partner = extraction?.participants.find(participant => participant.id === "partner");
  const fallbackTitle = adventure.mode === "DEMO" ? "Demo only" : adventure.mode === "FALLBACK" ? "Live path unavailable" : "More signal needed";
  return <div className="spark screen-enter"><Heading eyebrow={adventure.mode === "LIVE" ? "SAME MOMENT · DIFFERENT DOORS" : "HONEST MODE"} title={extraction?.sharedSpark.title ?? fallbackTitle} text={extraction?.sharedSpark.summary ?? adventure.reason}/><div className="venn"><TasteCircle side="you" label={you?.label ?? "YOU"} title={you?.likes[0] ?? "Your edge"} details={[...(you?.emotionalContext ?? []), ...(you?.likes.slice(1) ?? [])]}/><TasteCircle side="mika" label={partner?.label ?? "PARTNER"} title={partner?.likes[0] ?? "Their edge"} details={[...(partner?.emotionalContext ?? []), ...(partner?.likes.slice(1) ?? [])]}/><div className="shared"><Sparkles size={19}/><strong>{extraction?.sharedSpark.title ?? "No invented match"}</strong><small>{adventure.trace.extractionMode === "LIVE" ? `${Math.round((extraction?.confidence ?? 0) * 100)}% extraction confidence` : "prepared mode"}</small></div></div><div className="spark-insight"><span><Heart size={17}/></span><p>{adventure.mode === "LIVE" ? <><strong>{adventure.trace.resolvedEntities.length} cultural entities</strong> were verified in Qloo before the reveal.</> : adventure.question ?? "No live recommendation is being claimed."}</p></div><div className="spark-actions"><button className="secondary-action" onClick={onBack}>Add detail</button><button className="primary-action" onClick={onContinue}>{adventure.mode === "NEEDS_INPUT" ? "See what is missing" : "Reveal one adventure"}</button></div><p className="privacy"><Users size={14}/>Your reflections shape your private pair memory. Reset it anytime.</p></div>;
}

function TasteCircle({ side, label, title, details }: { side: "you" | "mika"; label: string; title: string; details: string[] }) {
  return <div className={`taste ${side}`}><small>{label.toUpperCase()}</small><strong>{title}</strong>{details.slice(0, 2).map(detail => <span key={detail}>{detail}</span>)}</div>;
}

function Reveal({ adventure, planned, saveError, onExplain, onAccept, onReject, onReturn }: { adventure: Adventure; planned: boolean; saveError: boolean; onExplain: () => void; onAccept: () => void; onReject: () => void; onReturn: () => void }) {
  const canSave = adventure.mode === "LIVE";
  return <div className="reveal screen-enter"><article className={`adventure-card ${adventure.mode.toLowerCase().replace("_", "-")}`}>{adventure.mode === "LIVE" ? <div className="live-card-art">{adventure.category === "book" ? <BookOpen size={48}/> : adventure.category === "place" ? <MapPin size={48}/> : <Music2 size={48}/>}</div> : <Image src="/tokyo-listening-bar.png" alt="Illustration representing a prepared Together demo" fill sizes="(max-width: 850px) 100vw, 470px" priority/>}<div className="scrim"/><div className="adventure-copy"><span className="eyebrow">{adventure.eyebrow}</span><h2>{adventure.title}</h2><p>{adventure.description}</p><PracticalFactChips metadata={canSave ? adventure.practicalMetadata : undefined}/><div className="meta"><span><MapPin size={15}/>{adventure.place}</span><span>{adventure.detail}</span></div></div><div className="status"><Sparkles size={14}/>{modeLabel(adventure.mode)}</div></article><button className="why" onClick={onExplain}><span><i><Sparkles size={15}/></i><span><strong>Why this adventure?</strong><small>See LLM, Qloo, and Together separately</small></span></span><ChevronRight size={18}/></button>{saveError && <p role="alert" className="save-error">Could not save to your Journey. Please try again.</p>}{!planned ? <div className="reveal-actions"><button onClick={onReject}>{canSave ? "Change the conversation" : "Add a clearer clue"}</button><button onClick={onAccept} disabled={!canSave}>{canSave ? "Let’s go" : "Not a live adventure"} {canSave && <ChevronRight size={18}/>}</button></div> : <div className="planned-state"><span><Sparkles size={17}/>Added to your Journey</span><button onClick={onReturn}>We went—tell you about it</button></div>}</div>;
}

function PracticalFactChips({ metadata }: { metadata?: PracticalMetadata }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const chips = practicalChips(metadata, now);
  return chips.length ? <div className="practical-fact-chips">{chips.map(chip => <a key={chip.label} href={chip.source} title={chip.detail} target="_blank" rel="noreferrer">{chip.label}</a>)}</div> : null;
}

function Explanation({ adventure, onClose }: { adventure: Adventure; onClose: () => void }) {
  return <div className="modal-backdrop" onClick={onClose}><section className="explain-sheet" role="dialog" aria-modal="true" aria-label="Why this adventure?" onClick={event => event.stopPropagation()}><button className="close" onClick={onClose} aria-label="Close"><X size={18}/></button><span className="overline">{adventure.mode === "LIVE" ? "AUDITABLE LIVE PATH" : "NO LIVE CLAIM"}</span><h2>Why this adventure?</h2><div className="trace-flow"><Trace n="01" title="Conversation Engine" text={adventure.trace.explanation.llm}/><Trace n="02" title="Verified input entities" text={adventure.trace.explanation.input}/><Trace n="03" title="Qloo inference" text={adventure.trace.explanation.qloo} highlight={adventure.mode === "LIVE"}/><Trace n="04" title="Together selection" text={adventure.trace.explanation.selection}/></div>{adventure.trace.unresolvedEntities.length > 0 && <p className="honesty">Not used: {adventure.trace.unresolvedEntities.map(entity => `${entity.name} (${entity.reason})`).join(" · ")}</p>}<p className="reason">{adventure.reason}</p>{adventure.mode === "LIVE" && <p className="honesty">Qloo API: {adventure.trace.qlooApiCalls.map(call => `${call.stage}/${call.category} ${call.status} (${call.resultCount})`).join(" · ")}</p>}<p className="honesty">{adventure.mode === "LIVE" ? "Qloo supplied the revealed candidate. The LLM supplied context, not facts; Together supplied the novelty and practicality choice plus invitation copy." : adventure.mode === "DEMO" ? "OPENAI_API_KEY is not configured. Free-form understanding is not active." : adventure.mode === "NEEDS_INPUT" ? "The LLM ran, but Qloo could not verify enough distinct signals to continue." : "A live dependency failed, so this prepared activity is clearly labeled FALLBACK."}</p></section></div>;
}

function ReturnView({ adventure, note, setNote, reaction, setReaction, saved, saveError, onSave, onJourney }: { adventure: Adventure; note: string; setNote: (value: string) => void; reaction: string | null; setReaction: (value: string) => void; saved: boolean; saveError: boolean; onSave: () => void; onJourney: () => void }) {
  const reactions = ["Loved it", "Good", "Meh", "Never again"];
  return <div className="return screen-enter"><div className="return-photo"><div className="return-art"/><div><span className="eyebrow">AFTER {adventure.title.toUpperCase()}</span><h2>So… how was it?</h2></div></div><div className="reactions">{reactions.map(value => <button key={value} className={reaction === value ? "selected" : ""} onClick={() => setReaction(value)}>{value}</button>)}</div><label className="reflection"><span>Tell me why <small>optional</small></span><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="What stayed with you?"/></label>{saveError && <p role="alert" className="save-error">Could not save to your Journey. Please try again.</p>}{!saved ? <button className="primary-action full" disabled={!reaction} onClick={onSave}>Add this chapter</button> : <div className="saved"><span><Sparkles size={20}/></span><h3>A new node is glowing.</h3><p>Your reaction is saved in the Journey.</p><button className="primary-action full" onClick={onJourney}>See our Journey</button></div>}</div>;
}

function modeLabel(mode: AdventureMode) { return mode === "LIVE" ? "Qloo LIVE" : mode === "NEEDS_INPUT" ? "Needs a real entity" : mode === "FALLBACK" ? "Fallback activity" : "Demo activity"; }
function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div className="heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{text}</p></div>; }
function Trace({ n, title, text, highlight = false }: { n: string; title: string; text: string; highlight?: boolean }) { return <div className={`trace ${highlight ? "highlight" : ""}`}><span>{n}</span><div><strong>{title}</strong><p>{text}</p></div></div>; }
