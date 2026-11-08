import type { StatusViewModel } from "../lib/notifyMessages";
import "./notify.css";

// Shape + text + colour: the tone is never carried by colour alone.
function Shape({ tone }: { tone: StatusViewModel["tone"] }) {
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true, focusable: false } as const;
  switch (tone) {
    case "waiting": return <svg {...common}><circle cx="12" cy="12" r="9" strokeDasharray="2 3.5" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>;
    case "ok": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "stopped": return <svg {...common}><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="9" strokeDasharray="3 3" /></svg>;
  }
}

type Props = { view: StatusViewModel; refreshing?: boolean; onRefresh?: () => void };

export function NotifyStatus({ view, refreshing = false, onRefresh }: Props) {
  const canRefresh = !!onRefresh && (view.tone === "waiting" || view.tone === "unknown");
  return (
    <div className={`notify-status notify-${view.tone}`} role="status" aria-live="polite">
      <Shape tone={view.tone} />
      <div className="notify-status-body">
        <p className="notify-status-label">{view.label}</p>
        {view.detail.map((d) => <p key={d} className="notify-status-detail">{d}</p>)}
        {canRefresh && <button type="button" className="notify-refresh" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Checking..." : "Check again"}</button>}
      </div>
    </div>
  );
}
