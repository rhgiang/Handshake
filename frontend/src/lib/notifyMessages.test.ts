import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFY_MESSAGES, NOTIFY_REASONS, failureMessage, parseNotifyState, statusView,
  type LastAction, type NotifyState, type StatusSource,
} from "./notifyMessages.ts";

const state = (o: Partial<NotifyState> = {}): NotifyState => ({ contact: "none", recap: "none", expired: false, delivery: "ok", ...o });
const CONTACTS = ["none", "awaiting_confirmation", "confirmed", "stopped"] as const;
const RECAPS = ["none", "requested", "stopped"] as const;
const SOURCES: StatusSource[] = ["server", "local", "unavailable"];
const ACTIONS: LastAction[] = [null, "saved", "saved_recap", "stopped"];

function* allViews() {
  for (const contact of [...CONTACTS, "bogus" as never]) for (const recap of RECAPS) for (const expired of [false, true])
    for (const delivery of ["ok", "pending"] as const) for (const source of SOURCES) for (const action of ACTIONS)
      yield { contact, source, v: statusView({ contact, recap, expired, delivery }, source, action) };
  for (const source of SOURCES) for (const action of ACTIONS) yield { contact: null, source, v: statusView(null, source, action) };
}

test("every string in the SAVE and STOP tables is calm: no '!' and no 'correct'", () => {
  for (const [action, table] of Object.entries(NOTIFY_MESSAGES)) for (const r of NOTIFY_REASONS) {
    const m = table[r];
    assert.ok(m && m.length > 10, `${action}/${r}`);
    assert.ok(!m.includes("!") && !/correct/i.test(m), `${action}/${r}`);
  }
  for (const a of ["save", "stop"] as const) assert.ok(failureMessage(undefined, a).length > 10 && !failureMessage(undefined, a).includes("!"));
});

test("no message claims 'nothing was saved' or 'was not saved' (a timeout may still have saved)", () => {
  for (const table of Object.values(NOTIFY_MESSAGES)) for (const m of Object.values(table)) assert.ok(!/nothing was saved|was not saved/.test(m), m);
});

test("specific wording for limits, failed delivery and unavailable automation", () => {
  assert.match(failureMessage("confirmation_limit", "save"), /no new confirmation email was sent/);
  assert.match(failureMessage("delivery_pending", "save"), /still being sent/);
  assert.match(failureMessage("delivery_failed", "save"), /Nothing is confirmed until your contact confirms/);
  assert.match(failureMessage("automation_unavailable", "save"), /could not confirm that it was saved/);
  assert.match(failureMessage("automation_unavailable", "stop"), /may still be on/);
});

test("statusView output never has '!' or 'correct' for any combination", () => {
  for (const { v } of allViews()) for (const s of [v.label, ...v.detail]) assert.ok(!s.includes("!") && !/correct/i.test(s), s);
});

test("property: label is Confirmed iff source is server and contact is confirmed", () => {
  for (const { contact, source, v } of allViews()) assert.equal(v.label === "Confirmed", source === "server" && contact === "confirmed");
});

test("statusView: server states map to the exact labels; unknown contact is never 'Not set up'", () => {
  assert.equal(statusView(state({ contact: "none" }), "server", null).label, "Not set up");
  assert.equal(statusView(state({ contact: "awaiting_confirmation" }), "server", null).label, "Awaiting confirmation");
  assert.equal(statusView(state({ contact: "confirmed" }), "server", null).label, "Confirmed");
  assert.equal(statusView(state({ contact: "stopped" }), "server", null).label, "Stopped");
  assert.equal(statusView(state({ contact: "bogus" as never }), "server", null).label, "Status unavailable");
});

test("statusView: expired shows only the expiry line; pending delivery shows its own line", () => {
  const exp = statusView(state({ contact: "awaiting_confirmation", expired: true, delivery: "pending" }), "server", null);
  assert.equal(exp.tone, "waiting");
  assert.ok(exp.detail.includes("The confirmation link has expired. Save again to send a new one."));
  assert.ok(!exp.detail.includes("The confirmation email is still being sent."));
  const pend = statusView(state({ contact: "awaiting_confirmation", delivery: "pending" }), "server", null);
  assert.ok(pend.detail.includes("The confirmation email is still being sent."));
  assert.equal(statusView(state({ contact: "awaiting_confirmation" }), "server", null).detail.length, 1);
});

test("statusView: recap lines", () => {
  assert.ok(statusView(state({ recap: "requested" }), "server", null).detail.some((d) => d.startsWith("Weekly recap: requested")));
  assert.ok(statusView(state({ recap: "stopped" }), "server", null).detail.includes("Weekly recap: stopped."));
  assert.ok(!statusView(state(), "server", null).detail.some((d) => d.includes("Weekly recap")));
});

test("statusView: unavailable wording depends on what the learner did this session", () => {
  const saved = statusView(null, "unavailable", "saved");
  assert.equal(saved.label, "Status unavailable");
  assert.equal(saved.tone, "unknown");
  assert.equal(saved.detail.join(" "), "Your last action here: saved. We can't check whether your contact confirmed.");
  assert.equal(statusView(null, "unavailable", "saved_recap").detail.join(" "), "Your last action here: saved a weekly recap request. We can't check the status right now.");
  assert.equal(statusView(null, "unavailable", "stopped").detail.join(" "), "Your last action here: stopped.");
  assert.equal(statusView(null, "unavailable", null).detail.join(" "), "We can't check the notification status right now.");
});

test("statusView: local source is awaiting and pending only for a saved contact", () => {
  const v = statusView(state({ contact: "awaiting_confirmation" }), "local", "saved");
  assert.equal(v.label, "Awaiting confirmation");
  assert.equal(v.pending, true);
  assert.equal(v.detail.at(-1), "This is from your last save. Checking the server now.");
  assert.notEqual(statusView(state({ contact: "none", recap: "requested" }), "local", "saved_recap").label, "Awaiting confirmation");
});

test("parseNotifyState accepts the contract and rejects unknown or missing fields", () => {
  const ok = { ok: true, contact: "confirmed", recap: "none", expired: false, delivery: "ok" };
  assert.deepEqual(parseNotifyState(ok), { contact: "confirmed", recap: "none", expired: false, delivery: "ok" });
  for (const bad of [
    { ...ok, contact: "maybe" }, { ...ok, recap: "x" }, { ...ok, delivery: "late" }, { ...ok, expired: "no" },
    { ...ok, ok: false }, { ok: true, contact: "none" }, null, "text",
  ]) assert.equal(parseNotifyState(bad), null);
});
