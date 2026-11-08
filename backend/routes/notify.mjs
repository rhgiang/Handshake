import express from "express";
import { rateLimit } from "../limit.mjs";
import { UUID_RE, LESSON_RE, NAME_RE, isEmail } from "../validate.mjs";

const bad = (res) => res.status(400).json({ error: "bad_request" });
const STATUS = {
  contact: ["none", "awaiting_confirmation", "confirmed", "stopped"],
  recap: ["none", "requested", "stopped"],
  delivery: ["ok", "pending"],
};
const limit = () => rateLimit({ windowMs: 60_000, max: 10 });

// Names and emails leave the server only here, only for n8n, only with consent (the client form requires the checkbox).
export function register(app, { n8n, fetch: f = fetch, statusGlobalMax = 60 }) {
  // One shared bucket for every caller: n8n Cloud bills an execution per status call.
  const globalStatusLimit = rateLimit({ windowMs: 60_000, max: statusGlobalMax, key: () => "notify-status" });
  // Upstream HTTP status -> stable client-facing reason. Upstream bodies are never forwarded.
  // Caveat: a 500 can also be a generic workflow error rather than an SMTP failure, and 429/503 are only
  // trustworthy when they come from our own workflow (a proxy or n8n platform limit could send them too).
  const REASONS = { 429: "confirmation_limit", 503: "delivery_pending", 409: "stale_request", 400: "bad_request", 422: "bad_request", 500: "delivery_failed" };
  const fail = (reason) => {
    console.error(`n8n forwarding failed: ${reason}`);
    return { ok: false, reason };
  };
  async function call(url, body) {
    try {
      const r = await f(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Handshake-Secret": n8n.secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      return r.ok ? { r } : { err: fail(REASONS[r.status] ?? "automation_unavailable") };
    } catch {
      return { err: fail("automation_unavailable") };
    }
  }
  async function forward(url, body) {
    const { err } = await call(url, body);
    return err ?? { ok: true };
  }

  app.get("/api/notify-status", limit(), globalStatusLimit, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const learnerId = req.query.learnerId;
    if (typeof learnerId !== "string" || !UUID_RE.test(learnerId)) return bad(res);
    if (!n8n) return res.json({ ok: false, reason: "disabled" });
    if (!n8n.statusUrl) return res.json({ ok: false, reason: "status_unavailable" });
    const { r, err } = await call(n8n.statusUrl, { learnerId });
    if (err) return res.json(err);
    let u;
    try {
      u = await r.json();
    } catch {
      return res.json(fail("automation_unavailable"));
    }
    const valid =
      u && u.ok === true && STATUS.contact.includes(u.contact) && STATUS.recap.includes(u.recap) &&
      typeof u.expired === "boolean" && STATUS.delivery.includes(u.delivery);
    if (!valid) return res.json(fail("automation_unavailable"));
    res.json({ ok: true, contact: u.contact, recap: u.recap, expired: u.expired, delivery: u.delivery });
  });

  app.post("/api/subscribe", limit(), express.json({ limit: "16kb" }), async (req, res) => {
    const b = req.body ?? {};
    if (!UUID_RE.test(b.learnerId)) return bad(res);
    let payload;
    if (b.action === "unsubscribe") {
      payload = { action: "unsubscribe", learnerId: b.learnerId };
    } else if (b.action === "subscribe") {
      const names = ["userName", "theirName"].filter((k) => b[k] !== undefined);
      const emails = ["learnerEmail", "contactEmail"].filter((k) => b[k] !== undefined);
      const valid =
        b.consent === true && emails.length > 0 &&
        names.every((k) => typeof b[k] === "string" && NAME_RE.test(b[k])) && emails.every((k) => isEmail(b[k]));
      if (!valid) return bad(res);
      payload = { action: "subscribe", learnerId: b.learnerId };
      for (const k of [...names, ...emails]) payload[k] = b[k];
    } else {
      return bad(res);
    }
    // Trusted ordering marker: delayed subscribe must not undo a later Stop.
    // Generated here rather than copied from browser input.
    payload.requestedAt = new Date().toISOString();
    if (!n8n) return res.json({ ok: false, reason: "disabled" });
    res.json(await forward(n8n.subscribeUrl, payload));
  });

  app.post("/api/lesson-complete", limit(), express.json({ limit: "16kb" }), async (req, res) => {
    const { learnerId, lessonId, xp } = req.body ?? {}; // no free text: n8n maps lessonId to a fixed title
    const valid =
      UUID_RE.test(learnerId) && LESSON_RE.test(lessonId) &&
      Number.isInteger(xp) && xp >= 0 && xp <= 1000;
    if (!valid) return bad(res);
    if (!n8n) return res.json({ ok: false, reason: "disabled" });
    res.json(await forward(n8n.eventUrl, { learnerId, lessonId, xp }));
  });
}
