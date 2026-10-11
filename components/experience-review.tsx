"use client";

import { useState } from "react";
import type { MemoryChapter } from "../lib/relationship-memory";
import { canExperience, experienceChips, overallLabels, overallReactions, relevantChips, whatWeLearned, type ReviewInput } from "../lib/post-experience";

export type ExperienceAction = { action: "experienced"; chapterId: string } | { action: "review"; chapterId: string; review: ReviewInput };

export function ExperienceReviewCard({ chapter, busy, onSave }: { chapter: MemoryChapter; busy: boolean; onSave: (action: ExperienceAction) => Promise<boolean> }) {
  const [editing, setEditing] = useState<"A" | "B" | null>(null);
  const [overall, setOverall] = useState<ReviewInput["overall"] | null>(null);
  const [note, setNote] = useState("");
  const [chips, setChips] = useState<ReviewInput["chips"]>([]);
  if (!canExperience(chapter)) return null;
  const reviews = chapter.experienceReviews ?? [];
  const learned = whatWeLearned(reviews);
  const choices = relevantChips(chapter.discovery?.domain ?? chapter.recommendation.category);
  function edit(person: "A" | "B") {
    setEditing(person); setOverall(reviews.find(review => review.person === person)?.overall ?? null); setNote(""); setChips([]);
  }
  async function save() {
    if (!editing || !overall) return;
    if (await onSave({ action: "review", chapterId: chapter.id, review: { person: editing, overall, note, chips } })) {
      setEditing(null); setNote(""); setChips([]);
    }
  }
  return <div className="experience-review">
    {!chapter.experiencedAt ? <><button className="secondary-action" disabled={busy} onClick={() => onSave({ action: "experienced", chapterId: chapter.id })}>We tried this</button><p className="experience-hint">The more you experience together, the better Together understands both of you.</p></> : <>
      <span className="eyebrow">WE TRIED THIS</span><p>How was it for each of you? One reaction is enough to start.</p>
      <div className="experience-people">{(["A", "B"] as const).map(person => {
        const review = reviews.find(item => item.person === person);
        return <button key={person} className="secondary-action" disabled={busy} onClick={() => edit(person)} aria-expanded={editing === person}>Person {person}<small>{review ? overallLabels[review.overall] : "Add reaction"}</small></button>;
      })}</div>
      {editing && <div className="experience-form"><h4>Person {editing} reaction</h4><div className="memory-feedback">{overallReactions.map(value => <button key={value} aria-pressed={overall === value} disabled={busy} onClick={() => setOverall(value)}>{overallLabels[value]}</button>)}</div>
        <label className="preference-note">A small note <small>Optional</small><input value={note} maxLength={1000} placeholder="What stayed with you?" onChange={event => setNote(event.target.value)}/></label>
        <div className="memory-feedback" aria-label="Optional experience details">{choices.map(chip => <button key={chip} aria-pressed={chips.includes(chip)} disabled={busy} onClick={() => setChips(current => current.includes(chip) ? current.filter(value => value !== chip) : [...current, chip])}>{experienceChips[chip]}</button>)}</div>
        {reviews.some(review => review.person === editing) && <p className="experience-hint">Saving replaces your earlier reaction and details. Notes are not kept in full.</p>}
        <button className="text-action" disabled={busy || !overall} onClick={save}>Save Person {editing} reaction</button><button className="text-action" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
        <p className="experience-hint">Optional details are interpreted by OpenAI. We keep structured signals and short supporting quotes. Avoid sensitive information. Reset deletes this pair’s memory.</p>
      </div>}
      {learned.length ? <article className="memory-bucket learned-experience"><h3>What we learned</h3>{learned.map(line => <p key={line}>{line}</p>)}</article> : <p className="experience-hint">{reviews.length ? `Person ${reviews[0].person}’s reaction is saved. We’ll show What we learned when both have reacted.` : "No reactions yet. Your taste has not changed."}</p>}
    </>}
  </div>;
}
