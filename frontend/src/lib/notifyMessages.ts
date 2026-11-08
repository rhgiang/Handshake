// Pure copy and validation for the notification settings: no React, no network. Mirrors the backend contract.

export const NOTIFY_REASONS = [
  "disabled", "confirmation_limit", "delivery_pending", "delivery_failed",
  "automation_unavailable", "stale_request", "bad_request", "status_unavailable",
] as const;
export type NotifyReason = (typeof NOTIFY_REASONS)[number];
export const isNotifyReason = (v: unknown): v is NotifyReason => NOTIFY_REASONS.includes(v as NotifyReason);

export type NotifyState = {
  contact: "none" | "awaiting_confirmation" | "confirmed" | "stopped";
  recap: "none" | "requested" | "stopped";
  expired: boolean;
  delivery: "ok" | "pending";
};

const CONTACTS = ["none", "awaiting_confirmation", "confirmed", "stopped"];
const RECAPS = ["none", "requested", "stopped"];
const DELIVERIES = ["ok", "pending"];

/** Never trust the response shape: anything off returns null (the caller reports status_unavailable). */
export function parseNotifyState(j: unknown): NotifyState | null {
  const o = j as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || o.ok !== true) return null;
  if (!CONTACTS.includes(o.contact as string) || !RECAPS.includes(o.recap as string) || !DELIVERIES.includes(o.delivery as string) || typeof o.expired !== "boolean") return null;
  return { contact: o.contact as NotifyState["contact"], recap: o.recap as NotifyState["recap"], expired: o.expired, delivery: o.delivery as NotifyState["delivery"] };
}

export type StatusTone = "none" | "waiting" | "ok" | "stopped" | "unknown";
export type StatusSource = "server" | "local" | "unavailable";
/** What the learner did in this session; null = nothing yet. "saved_recap" = a save with no contact email. */
export type LastAction = "saved" | "saved_recap" | "stopped" | null;
/** pending = optimistic local state: render it aria-busy so it is not announced as a result. */
export type StatusViewModel = { label: string; tone: StatusTone; detail: string[]; pending?: boolean };

const SAVE: Record<NotifyReason, string> = {
  confirmation_limit: "Too many confirmation emails were requested recently, so no new confirmation email was sent. Try again later; the limit eases within 24 hours.",
  delivery_pending: "A confirmation email for this address is still being sent. Wait a while before trying again.",
  delivery_failed: "The automation reported an error while sending. Nothing is confirmed until your contact confirms. Try again later.",
  automation_unavailable: "The email automation can't be reached right now. We could not confirm that it was saved. Try again later.",
  stale_request: "A newer change was already recorded. Check the status below, then try again if needed.",
  bad_request: "Check the email addresses and try again.",
  disabled: "Notifications aren't set up on this server.",
  status_unavailable: "The email automation can't report its status right now. Try again later.",
};
const STOP: Record<NotifyReason, string> = {
  ...SAVE,
  confirmation_limit: "Too many requests were made recently. We can't confirm that notifications stopped. They may still be on. Try again later.",
  delivery_pending: "An earlier email is still being sent. We can't confirm that notifications stopped. They may still be on. Try again in a while.",
  delivery_failed: "The automation reported an error. We can't confirm that notifications stopped. They may still be on. Try again.",
  automation_unavailable: "The email automation can't be reached, so we can't confirm that notifications stopped. They may still be on. Try again.",
  bad_request: "That request could not be read. Try again.",
  status_unavailable: "The email automation can't report its status right now. Try again.",
};
export const NOTIFY_MESSAGES = { save: SAVE, stop: STOP };
const FALLBACK = { save: "We could not confirm that it was saved. Try again later.", stop: "We can't confirm that notifications stopped. They may still be on. Try again." };

export function failureMessage(reason: NotifyReason | undefined, action: "save" | "stop"): string {
  return (reason && NOTIFY_MESSAGES[action][reason]) || FALLBACK[action];
}

function recapLine(recap: NotifyState["recap"]): string[] {
  if (recap === "requested") return ["Weekly recap: requested for your own address (that address is not verified yet)."];
  if (recap === "stopped") return ["Weekly recap: stopped."];
  return [];
}

const UNAVAILABLE: Record<"saved" | "saved_recap" | "stopped", string> = {
  saved: "Your last action here: saved. We can't check whether your contact confirmed.",
  saved_recap: "Your last action here: saved a weekly recap request. We can't check the status right now.",
  stopped: "Your last action here: stopped.",
};

function unavailable(lastAction: LastAction): StatusViewModel {
  return { label: "Status unavailable", tone: "unknown", detail: [lastAction ? UNAVAILABLE[lastAction] : "We can't check the notification status right now."] };
}

/** Known limit: the server reports "stopped" only after a full Stop. A contact who used their own
 *  unsubscribe link appears as "none". "Confirmed" is returned only for a server answer of "confirmed";
 *  any value this switch does not know maps to "Status unavailable", never to "Not set up". */
export function statusView(state: NotifyState | null, source: StatusSource, lastAction: LastAction): StatusViewModel {
  if (source === "unavailable" || !state) return unavailable(lastAction);
  const recap = recapLine(state.recap);
  if (source === "local") {
    return state.contact === "awaiting_confirmation"
      ? { label: "Awaiting confirmation", tone: "waiting", pending: true, detail: ["Your contact has to open the confirmation email and confirm before lesson updates are sent.", "This is from your last save. Checking the server now."] }
      : unavailable(lastAction);
  }
  switch (state.contact) {
    case "awaiting_confirmation":
      return { label: "Awaiting confirmation", tone: "waiting", detail: [
        "Your contact has to open the confirmation email and confirm before lesson updates are sent.",
        ...(state.expired ? ["The confirmation link has expired. Save again to send a new one."]
          : state.delivery === "pending" ? ["The confirmation email is still being sent."] : []),
        ...recap,
      ] };
    case "confirmed":
      return { label: "Confirmed", tone: "ok", detail: ["Your contact confirmed. Lesson updates can be sent. They can unsubscribe from any email.", ...recap] };
    case "stopped":
      return { label: "Stopped", tone: "stopped", detail: ["Notifications are stopped. Save again to restart.", ...recap] };
    case "none":
      return { label: "Not set up", tone: "none", detail: ["No notification contact is saved.", ...recap] };
    default:
      return unavailable(lastAction);
  }
}
