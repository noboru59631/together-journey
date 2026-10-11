"use client";

import { useState } from "react";
import type { MemoryChapter } from "../lib/relationship-memory";
import { canExperience, experienceChipLabel, overallLabel, overallReactions, relevantChips, whatWeLearned, type ReviewInput } from "../lib/post-experience";
import { useLanguage } from "./language-provider";

export type ExperienceAction = { action: "experienced"; chapterId: string } | { action: "review"; chapterId: string; review: ReviewInput };

export function ExperienceReviewCard({ chapter, busy, onSave }: { chapter: MemoryChapter; busy: boolean; onSave: (action: ExperienceAction) => Promise<boolean> }) {
  const { locale, t } = useLanguage();
  const [editing, setEditing] = useState<"A" | "B" | null>(null);
  const [overall, setOverall] = useState<ReviewInput["overall"] | null>(null);
  const [note, setNote] = useState("");
  const [chips, setChips] = useState<ReviewInput["chips"]>([]);
  if (!canExperience(chapter)) return null;
  const reviews = chapter.experienceReviews ?? [];
  const learned = whatWeLearned(reviews, locale);
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
    {!chapter.experiencedAt ? <><button className="secondary-action" disabled={busy} onClick={() => onSave({ action: "experienced", chapterId: chapter.id })}>{t("experience.try")}</button><p className="experience-hint">{t("experience.hint")}</p></> : <>
      <span className="eyebrow">{t("experience.eyebrow")}</span><p>{t("experience.question")}</p>
      <div className="experience-people">{(chapter.scope === "solo" ? ["A"] as const : ["A", "B"] as const).map(person => {
        const review = reviews.find(item => item.person === person);
        return <button key={person} className="secondary-action" disabled={busy} onClick={() => edit(person)} aria-expanded={editing === person}>{chapter.scope === "solo" ? t("solo.review.you") : t("common.person", { person })}<small>{review ? overallLabel(review.overall, locale) : t("experience.add")}</small></button>;
      })}</div>
      {editing && <div className="experience-form"><h4>{t("experience.reaction", { person: editing })}</h4><div className="memory-feedback">{overallReactions.map(value => <button key={value} aria-pressed={overall === value} disabled={busy} onClick={() => setOverall(value)}>{overallLabel(value, locale)}</button>)}</div>
        <label className="preference-note">{t("experience.note")} <small>{t("common.optional")}</small><input value={note} maxLength={1000} placeholder={t("experience.notePlaceholder")} onChange={event => setNote(event.target.value)}/></label>
        <div className="memory-feedback" aria-label={t("experience.detailsAria")}>{choices.map(chip => <button key={chip} aria-pressed={chips.includes(chip)} disabled={busy} onClick={() => setChips(current => current.includes(chip) ? current.filter(value => value !== chip) : [...current, chip])}>{experienceChipLabel(chip, locale)}</button>)}</div>
        {reviews.some(review => review.person === editing) && <p className="experience-hint">{t("experience.replace")}</p>}
        <button className="text-action" disabled={busy || !overall} onClick={save}>{t("experience.save", { person: editing })}</button><button className="text-action" disabled={busy} onClick={() => setEditing(null)}>{t("experience.cancel")}</button>
        <p className="experience-hint">{t("experience.privacy")}</p>
      </div>}
      {learned.length ? <article className="memory-bucket learned-experience"><h3>{t("experience.learned")}</h3>{learned.map(line => <p key={line}>{line}</p>)}</article> : <p className="experience-hint">{reviews.length ? t("experience.waiting", { person: reviews[0].person }) : t("experience.empty")}</p>}
    </>}
  </div>;
}
