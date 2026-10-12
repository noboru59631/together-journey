"use client";

import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import type { RecoveryType } from "../lib/recovery";
import { useLanguage } from "./language-provider";

export function RecoveryPanel({ currentType, onRecovered }: { currentType?: RecoveryType; onRecovered?: (type: RecoveryType) => void }) {
  const { locale, t } = useLanguage();
  const [type, setType] = useState<RecoveryType>(currentType ?? "pair");
  const [active, setActive] = useState(false);
  const [code, setCode] = useState("");
  const [entry, setEntry] = useState("");
  const [open, setOpen] = useState(Boolean(currentType));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!currentType) return;
    const controller = new AbortController();
    void fetch(`/api/recovery?type=${currentType}`, { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() as Promise<{ active?: boolean }> : Promise.reject()).then(value => setActive(Boolean(value.active))).catch(() => undefined);
    return () => controller.abort();
  }, [currentType]);

  async function act(action: "create" | "revoke" | "redeem") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, type, ...(action === "redeem" ? { code: entry } : {}), locale }) });
      const value = await response.json() as { active?: boolean; code?: string; error?: string };
      if (!response.ok) throw new Error(value.error ?? t("recovery.error.generic"));
      if (action === "create") { setCode(value.code ?? ""); setActive(true); }
      if (action === "revoke") { setCode(""); setActive(false); }
      if (action === "redeem") onRecovered?.(type);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("recovery.error.generic"));
    } finally { setBusy(false); }
  }

  if (!open) return <button className="text-action recovery-open" onClick={() => setOpen(true)}><KeyRound size={16}/>{t(currentType ? "recovery.title" : "recovery.continue")}</button>;
  return <section className="recovery-panel">
    <span className="recovery-icon"><ShieldCheck size={18}/></span>
    <h2>{t(currentType ? "recovery.title" : "recovery.continue")}</h2>
    <p>{t("recovery.description")}</p>
    {!currentType && <div className="recovery-types"><button aria-pressed={type === "pair"} onClick={() => setType("pair")}>{t("recovery.pair")}</button><button aria-pressed={type === "solo"} onClick={() => setType("solo")}>{t("recovery.solo")}</button></div>}
    {currentType ? <>
      {code ? <div className="recovery-code"><small>{t("recovery.once")}</small><strong>{code}</strong><p>{t("recovery.keyWarning")}</p><button className="text-action" onClick={() => { setCode(""); setOpen(false); }}>{t("recovery.saved")}</button></div> : <>
        <p className="recovery-warning">{t(active ? "recovery.active" : "recovery.optional")}</p>
        <div className="recovery-actions"><button className="secondary-action" disabled={busy} onClick={() => void act("create")}>{t(active ? "recovery.rotate" : "recovery.create")}</button>{active && <button className="text-action" disabled={busy} onClick={() => void act("revoke")}>{t("recovery.revoke")}</button>}</div>
      </>}
    </> : <>
      <label className="recovery-entry">{t("recovery.codeLabel")}<input value={entry} maxLength={64} autoComplete="off" spellCheck={false} placeholder="TG-XXXX-XXXX-XXXX-XXXX" onChange={event => setEntry(event.target.value)}/></label>
      <button className="primary-action full" disabled={busy || !entry.trim()} onClick={() => void act("redeem")}>{t("recovery.continueAction")}</button>
    </>}
    {error && <p role="alert" className="save-error">{error}</p>}
    {!code && <button className="text-action" onClick={() => setOpen(false)}>{t("recovery.close")}</button>}
  </section>;
}
