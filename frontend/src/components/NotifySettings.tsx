import { useEffect, useRef, useState } from "react";
import { notifyStatus, subscribe } from "../lib/api";
import { learnerId } from "../lib/learner";
import { failureMessage, statusView, type LastAction, type NotifyState, type StatusSource } from "../lib/notifyMessages";
import { isNotifyOn, setNotifyOn } from "../lib/track";
import { NotifyStatus } from "./NotifyStatus";
import "./notify.css";

// enabled: undefined = still loading. statusEnabled: the server has a status workflow (features.notifyStatus).
// Known limit: the server reports "stopped" only after a full Stop; a contact who used their own
// unsubscribe link appears as "none".
type Props = { enabled?: boolean; statusEnabled?: boolean };
type View = { state: NotifyState | null; source: StatusSource };

const NONE: NotifyState = { contact: "none", recap: "none", expired: false, delivery: "ok" };

export function NotifySettings({ enabled, statusEnabled }: Props) {
  const [contactEmail, setContactEmail] = useState("");
  const [learnerEmail, setLearnerEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [on, setOn] = useState(isNotifyOn);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction>(null); // this session only
  const canCheck = !!enabled && !!statusEnabled;
  const [view, setView] = useState<View>({ state: null, source: "unavailable" });
  const [checked, setChecked] = useState(false); // first server answer received
  const [refreshing, setRefreshing] = useState(false);
  const reqId = useRef(0); // only the newest status request may set state; unmount invalidates all

  async function refresh() {
    const id = ++reqId.current;
    setRefreshing(true);
    const r = await notifyStatus(learnerId());
    if (id !== reqId.current) return;
    setView(r.ok ? { state: r, source: "server" } : { state: null, source: "unavailable" });
    setChecked(true);
    setRefreshing(false);
  }

  useEffect(() => {
    if (canCheck) void refresh();
    return () => { reqId.current++; };
  }, [canCheck]);

  if (enabled === undefined) return <section><h2>Notifications</h2><p role="status">Loading…</p></section>;
  if (!enabled && !on) return <section><h2>Notifications</h2><p>{failureMessage("disabled", "save")}</p></section>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !consent || !(contactEmail || learnerEmail)) return;
    setBusy(true); setError(""); setNote("");
    try {
      const r = await subscribe({
        action: "subscribe", learnerId: learnerId(), consent: true,
        ...(contactEmail && { contactEmail }), ...(learnerEmail && { learnerEmail }),
      }).catch(() => ({ ok: false as const, reason: "automation_unavailable" as const }));
      if (!r.ok) { setError(failureMessage(r.reason, "save")); return; }
      setNotifyOn(true);
      setOn(true);
      setLastAction("saved");
      setNote(contactEmail
        ? "Saved. A confirmation email was requested for your contact. Nothing is sent to them until they confirm."
        : "Saved. A weekly recap was requested for your own address.");
      if (canCheck) {
        // optimistic, clearly labelled as local until the server answers
        setView({ state: { ...NONE, contact: contactEmail ? "awaiting_confirmation" : "none", recap: learnerEmail ? "requested" : "none" }, source: "local" });
        void refresh();
      } else {
        setView({ state: null, source: "unavailable" });
      }
    } finally { setBusy(false); }
  }

  async function stop() {
    if (busy) return;
    setBusy(true); setError(""); setNote("");
    try {
      const r = await subscribe({ action: "unsubscribe", learnerId: learnerId() })
        .catch(() => ({ ok: false as const, reason: "automation_unavailable" as const }));
      if (!r.ok) { setError(failureMessage(r.reason, "stop")); return; }
      setNotifyOn(false);
      setOn(false);
      setLastAction("stopped");
      setNote("Notifications stopped.");
      if (canCheck) void refresh();
      else setView({ state: { ...NONE, contact: "stopped" }, source: "server" }); // the server acknowledged the Stop
    } finally { setBusy(false); }
  }

  const showStatus = canCheck || on || view.state !== null;
  const model = statusView(view.state, view.source, lastAction);

  return (
    <section aria-labelledby="notify-h">
      <h2 id="notify-h">Notifications</h2>
      <p>The person you are learning for must confirm their email before receiving lesson updates. They can unsubscribe from any update without opening the app.</p>
      <p>Weekly recaps are for your own email address only. That address is not verified yet.</p>
      {showStatus && (canCheck && !checked
        ? <p role="status" aria-live="polite">Checking status…</p>
        : <NotifyStatus view={model} refreshing={refreshing} onRefresh={canCheck ? () => void refresh() : undefined} />)}
      <form onSubmit={save}>
        {enabled && <><label>
          Email of the person you're learning for (optional)
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Your email for a weekly recap (optional)
          <input type="email" value={learnerEmail} onChange={(e) => setLearnerEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Send these email addresses to our n8n automation (no names are sent)
        </label>
        <button type="submit" disabled={busy || !consent || !(contactEmail || learnerEmail)} aria-describedby="notify-hint">Save</button>
        <span id="notify-hint" className="muted"> Tick the box and enter at least one email.</span></>}
        {(on || enabled) && <button type="button" disabled={busy} onClick={stop}>Stop notifications</button>}
      </form>
      <p role="status" aria-live="polite">{note}</p>
      {error && <p role="alert" className="notify-error">{error}</p>}
    </section>
  );
}
