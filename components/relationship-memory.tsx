"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Feedback, MemorySnapshot } from "../lib/relationship-memory";
import { discoveryDomains } from "../lib/discovery";
import { dimensions, labels, learnedPreferences, preferenceLabel, type PreferenceSignal } from "../lib/practical-preferences";

export function ExplorationTaste({ memory }: { memory: MemorySnapshot | null }) {
  const learned = learnedPreferences(memory?.practical ?? []);
  return <article className="memory-bucket"><h3>How we like to explore</h3>{learned.length ? <div className="signal-tags">{learned.map(state => <span key={state.dimension}>{preferenceLabel(state)}<small>{state.count} {state.count === 1 ? "signal" : "signals"}</small></span>)}</div> : <p>Still learning. Optional feedback helps us find your comfortable pace.</p>}<p>These are shared requests, not assumptions about either person. Contradictory feedback balances the evidence.</p></article>;
}

export function PracticalFeedback({ chapterId, category, count, feedback, busy, onSave }: { chapterId: string; category: string; count: number; feedback: Feedback | null; busy: boolean; onSave: (chapterId: string, feedback: Feedback, reflection?: string, preference?: PreferenceSignal) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const relevant = category === "book" ? ["pace", "setting", "planning"] as const : count % 2 ? ["crowds", "quiet", "budget"] as const : ["setting", "planning", "pace"] as const;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? dimensions : relevant;
  async function save(preference?: PreferenceSignal) {
    setSaved("");
    if (await onSave(chapterId, feedback ?? "neutral", preference ? undefined : note, preference)) { setSaved("Saved for next time"); if (!preference) setNote(""); }
  }
  return <div className="practical-feedback"><p>How would you like next time to feel? <small>Optional</small></p>{shown.map(dimension => <div className="memory-feedback" key={dimension} aria-label={`${dimension} preference`}>{labels[dimension].map((label, index) => <button key={label} disabled={busy} onClick={() => save({ dimension, value: index === 0 ? -1 : 1 })}>{dimension === "crowds" && index === 0 ? "Too crowded" : dimension === "budget" && index === 0 ? "Too expensive" : label}</button>)}</div>)}<button className="text-action" onClick={() => setExpanded(!expanded)}>{expanded ? "Fewer options" : "Other preferences"}</button><label className="preference-note">A small note for next time<input value={note} maxLength={2000} placeholder="More quiet places next time…" onChange={event => setNote(event.target.value)}/></label><button className="text-action" disabled={busy || !note.trim()} onClick={() => save()}>Save note</button><p role="status">{saved}</p></div>;
}

export const feedbackLabels: Record<Feedback, string> = { liked: "Feels like us", good_surprise: "Good surprise", neutral: "Not sure yet", not_for_us: "Not for us" };

export function FeedbackButtons({ value, busy, onChange }: { value: Feedback | null; busy: boolean; onChange: (feedback: Feedback) => void }) {
  return <div className="memory-feedback" aria-label="Optional journey feedback">{(["liked", "good_surprise", "not_for_us"] as Feedback[]).map(feedback => <button key={feedback} aria-pressed={value === feedback} disabled={busy} onClick={() => onChange(feedback)}>{feedbackLabels[feedback]}</button>)}</div>;
}

export function OurTaste({ memory, busy = false, onDiscover }: { memory: MemorySnapshot | null; busy?: boolean; onDiscover?: (domain?: string, surprise?: boolean) => void }) {
  const profile = memory?.profile;
  return <section className="taste-memory" aria-label="Our Taste">
    <span className="eyebrow">OUR TASTE</span><h2>Same world. Different doors.</h2>
    {!profile?.chapters ? <p>Your first grounded journey will begin your taste memory. Nothing has been learned yet.</p> : <>
      <p>From {profile.chapters} grounded {profile.chapters === 1 ? "chapter" : "chapters"}. These signals evolve as you share more.</p>
      <article className="memory-bucket"><h3>Shared</h3>{profile.shared.length ? <div className="signal-tags">{profile.shared.slice(0, 8).map(signal => <span key={signal.tag}>{signal.tag}<small>{signal.count} {signal.count === 1 ? "chapter" : "chapters"}</small></span>)}</div> : <p>Different reasons still matter. Shared wording will emerge with more reflections.</p>}</article>
      <article className="memory-bucket"><h3>Different</h3><div className="different-columns">{(["you", "partner"] as const).map(person => <div key={person}><b>{person === "you" ? "A · You" : "B · Partner"}</b><div className="signal-tags">{profile.different[person].slice(0, 6).map(signal => <span key={signal.tag}>{signal.tag}<small>{signal.count} chapters</small></span>)}</div></div>)}</div><p>Different emphasis, not a compatibility judgment.</p></article>
      <article className="memory-bucket"><h3>Unexplored</h3><p>Connected directions from your earlier reflections. Qloo must return a matching candidate before any reveal.</p>
        {profile.unexplored.slice(0, 4).map(opportunity => <div className="discovery-direction" key={opportunity.category}><b>{opportunity.label}</b><p>Connected through {opportunity.evidence.slice(0, 2).join(" · ")}</p><button className="text-action" disabled={busy || !onDiscover} onClick={() => onDiscover?.(opportunity.category)}>Try this direction</button></div>)}
        {!profile.unexplored.length && <p>No new supported direction yet. Share another reflection to open one.</p>}
      </article>
      <article className="memory-bucket"><h3>Our discoveries</h3><div className="signal-tags">{profile.exploration.map(item => <span key={item.domain}>{discoveryDomains.find(domain => domain.id === item.domain)?.label}<small>{item.count} suggested · {item.tried} tried</small></span>)}</div><p>A suggested chapter is not a confirmed experience.</p></article>
    </>}
  </section>;
}

export function NextDiscovery({ memory, busy, onDiscover, onTalk, onResume }: { memory: MemorySnapshot | null; busy: boolean; onDiscover: (domain?: string, surprise?: boolean) => void; onTalk: () => void; onResume: () => void }) {
  const latest = memory?.chapters[0];
  const ready = memory?.persistence === "D1" && Boolean(memory.profile.unexplored.length || memory.profile.exploration.length);
  const pending = latest?.discovery?.status === "suggested";
  const thisWeek = latest && memory?.asOf && new Date(memory.asOf).getTime() - new Date(latest.timestamp).getTime() < 7 * 24 * 60 * 60 * 1000;
  return <article className="next-discovery memory-bucket" aria-label="Next Discovery"><span className="eyebrow">NEXT DISCOVERY</span><h3>What should we discover next?</h3><p>Together keeps learning what the two of you enjoy — and introduces you to something new each time.</p>
    {latest && <p className="discovery-week">{thisWeek ? "This week’s discovery" : "Your latest discovery"}<b>{latest.recommendation.name}</b><small>{discoveryDomains.find(domain => domain.id === latest.discovery?.domain)?.label ?? latest.recommendation.category} · {latest.discovery?.status ?? "suggested"}</small></p>}
    {pending && <button className="secondary-action full" disabled={busy} onClick={onResume}>Return to this discovery</button>}
    <button className="primary-action full" disabled={busy || !memory} onClick={() => ready ? onDiscover() : onTalk()}>{busy ? "Finding a fresh chapter…" : ready ? "Discover our next chapter" : "Share our first experience"}</button>
    {ready && <button className="text-action" disabled={busy} onClick={() => onDiscover(undefined, true)}>Surprise us</button>}
    <p className="discovery-footnote">Watch · listen · eat · visit · experience. No subscription or notifications.</p>
  </article>;
}

export function MemoryTimeline({ memory, busy, onFeedback, onReset }: { memory: MemorySnapshot | null; busy: boolean; onFeedback: (chapterId: string, feedback: Feedback, reflection?: string, preference?: PreferenceSignal) => Promise<boolean>; onReset: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  return <section className="memory-timeline" aria-label="Recent shared journeys">
    <span className="eyebrow">OUR JOURNEY</span><h3>{memory?.chapters.length ? "The chapters we’re learning from" : "Your story starts here"}</h3>
    <p>{memory?.persistence === "unavailable" ? "Memory storage is unavailable. No learned history is being claimed." : "Your two reflections, grounded interests and optional feedback stay in this browser’s anonymous Journey."}</p>
    {memory?.chapters.slice(0, 8).map(chapter => <article className="memory-chapter" key={chapter.id}>
      <div className="chapter-label"><time dateTime={chapter.timestamp}>{new Date(chapter.timestamp).toLocaleDateString()}</time><span>LIVE · {chapter.discovery?.status ?? "suggested"}</span></div>
      <h3>{chapter.recommendation.name}</h3><span className="domain-badge">{discoveryDomains.find(domain => domain.id === (chapter.discovery?.domain ?? chapter.recommendation.category))?.label ?? chapter.recommendation.category}</span>
      <p>{chapter.entities.map(entity => `${entity.participant === "you" ? "A" : "B"}: ${entity.name}`).join(" · ")}</p>
      <details><summary>What we remembered</summary>
        {chapter.inputs.you || chapter.inputs.partner ? <><p><b>A:</b> {chapter.inputs.you}</p><p><b>B:</b> {chapter.inputs.partner}</p></> : <p>This chapter reused earlier verified interests. No new reflections or taste tags were inferred.</p>}
        <p>{chapter.recommendation.rationale}</p><p>A recommendation is not a confirmed visit. Feedback is optional.</p>
      </details>
      <FeedbackButtons value={chapter.feedback} busy={busy} onChange={feedback => onFeedback(chapter.id, feedback)}/>
      {chapter.id === memory.chapters[0]?.id && <PracticalFeedback key={chapter.id} chapterId={chapter.id} category={chapter.recommendation.category} count={memory.chapters.length} feedback={chapter.feedback} busy={busy} onSave={onFeedback}/>}
    </article>)}
    <div className="memory-reset">{confirmReset ? <><p>Delete this pair’s stored history and reactions? This cannot be undone.</p><button className="secondary-action" disabled={busy} onClick={() => { onReset(); setConfirmReset(false); }}>Delete our memory</button><button className="text-action" onClick={() => setConfirmReset(false)}>Keep our Journey</button></> : <button className="text-action" disabled={busy || !memory || memory.persistence !== "D1"} onClick={() => setConfirmReset(true)}>Reset our journey</button>}</div>
  </section>;
}

export function MemoryInvitation({ count, onTalk }: { count: number; onTalk: () => void }) {
  return <div className="partner-card memory-invitation"><span><Sparkles size={18}/></span><div><b>WHAT SHOULD WE TRY NEXT?</b><p>{count ? "Let’s connect what you share, where you differ, and something still unexplored." : "Start with one thing you both experienced. Different reactions are the useful part."}</p><button className="text-action" onClick={onTalk}>Share what stayed with you</button></div></div>;
}
