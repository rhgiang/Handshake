import { rateLimit } from "../limit.mjs";
import { UUID_RE, ITEM_RE, CODE_RE } from "../validate.mjs";
import express from "express";

const DAY = 86_400_000;
const bad = (res) => res.status(400).json({ error: "bad_request" });

export function register(app, { db, now = Date.now }) {
  app.post("/api/attempts", rateLimit({ windowMs: 60_000, max: 120 }), express.json({ limit: "300kb" }), async (req, res) => {
    const { learnerId, attempts } = req.body ?? {};
    if (typeof learnerId !== "string" || !UUID_RE.test(learnerId) || !Array.isArray(attempts) || attempts.length < 1 || attempts.length > 50) return bad(res);
    const t = now();
    const rows = [];
    for (const a of attempts) {
      const codes = a?.codes === undefined ? [] : a.codes;
      const valid =
        typeof a?.item === "string" && ITEM_RE.test(a.item) && typeof a.correct === "boolean" &&
        Array.isArray(codes) && codes.length <= 5 && codes.every((c) => typeof c === "string" && CODE_RE.test(c));
      if (!valid) return bad(res);
      const fresh = Number.isFinite(a.ts) && a.ts <= t && t - a.ts <= DAY;
      rows.push({ ts: new Date(fresh ? a.ts : t), item: a.item, correct: a.correct, codes });
    }
    if (db) {
      try {
        await db.insertAttempts(learnerId, rows);
      } catch {
        console.error("Attempt storage unavailable; local practice is unaffected.");
      }
    }
    res.sendStatus(204);
  });

  app.get("/api/stats/:learnerId", rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
    if (!UUID_RE.test(req.params.learnerId)) return bad(res);
    if (!db) return res.json({ daily: [], items: [] });
    try {
      res.json(await db.stats(req.params.learnerId));
    } catch {
      console.error("Stats unavailable.");
      res.status(503).json({ error: "stats_unavailable" });
    }
  });

  // Keep malformed bodies out of Express's HTML error response/logs.
  app.use((error, req, res, next) => {
    if (req.path !== "/api/attempts") return next(error);
    if (error.type === "entity.parse.failed") return bad(res);
    if (error.type === "entity.too.large") return res.status(413).json({ error: "body_too_large" });
    next(error);
  });
}
