import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "./app.mjs";
import { serve } from "./testutil.mjs";
import { registerIntegrations } from "./integrations.mjs";

test("unconfigured database leaves Gemini and stats endpoints usable", async () => {
  const s = await serve((app) => { registerIntegrations(app, {}); app.use(createApp()); });
  try {
    assert.deepEqual((await s.get("/api/features")).body, { stats: false, notify: false, notifyStatus: false, agent: false });
    const id = randomUUID();
    assert.equal((await s.post("/api/attempts", { learnerId: id, attempts: [{ item: "L", correct: true }] })).status, 204);
    assert.deepEqual((await s.get(`/api/stats/${id}`)).body, { daily: [], items: [] });
    assert.equal(typeof (await s.post("/api/coach", { target: "L" })).body.tip, "string");
    assert.ok(Array.isArray((await s.post("/api/words", { knownLetters: ["L", "I", "Y"] })).body.words));
  } finally { await s.close(); }
});

test("N8N_STATUS_URL is optional and only toggles notifyStatus", async () => {
  const base = { N8N_SUBSCRIBE_URL: "https://n/s", N8N_EVENT_URL: "https://n/e", N8N_SECRET: "x" };
  for (const [env, want] of [[base, false], [{ ...base, N8N_STATUS_URL: "https://n/st" }, true]]) {
    const s = await serve((app) => registerIntegrations(app, env));
    try {
      assert.deepEqual((await s.get("/api/features")).body, { stats: false, notify: true, notifyStatus: want, agent: false });
    } finally { await s.close(); }
  }
});

test("configured database enables stats; failed connection falls back without disabling practice", async () => {
  let integrations;
  const s = await serve((app) => {
    integrations = registerIntegrations(app, { DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/db" });
  });
  try {
    assert.deepEqual((await s.get("/api/features")).body, { stats: true, notify: false, notifyStatus: false, agent: false });
    const id = randomUUID();
    const stats = await s.get(`/api/stats/${id}`);
    assert.equal(stats.status, 503);
    assert.deepEqual(stats.body, { error: "stats_unavailable" });
    assert.equal((await s.post("/api/attempts", { learnerId: id, attempts: [{ item: "L", correct: true }] })).status, 204);
    assert.equal((await s.post("/api/attempts", { learnerId: id, attempts: [{ item: "fs:LILY", correct: true }] })).status, 400);
  } finally { await s.close(); await integrations.db.close(); }
});

test("assembled API rate-limits malformed JSON before Gemini's global parser", async () => {
  const s = await serve((app) => { registerIntegrations(app, {}); app.use(createApp()); });
  try {
    const oversized = await fetch(s.base + "/api/attempts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unused: "x".repeat(310_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: "body_too_large" });
    for (let i = 0; i < 119; i++) {
      const response = await fetch(s.base + "/api/attempts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
      });
      assert.equal(response.status, 400);
      await response.json();
    }
    assert.equal((await s.post("/api/attempts", {})).status, 429);
    // The independent stats allowance and existing Gemini API remain available.
    assert.equal((await s.get(`/api/stats/${randomUUID()}`)).status, 200);
    assert.equal(typeof (await s.post("/api/coach", { target: "L" })).body.tip, "string");
  } finally { await s.close(); }
});

test("disabled sponsor endpoints retain local planning and reject missing consent", async () => {
  const s = await serve(app => registerIntegrations(app, {}));
  const id = randomUUID();
  try {
    assert.equal((await s.post("/api/subscribe", { action: "subscribe", learnerId: id, contactEmail: "a@example.com" })).status, 400);
    assert.deepEqual((await s.post("/api/subscribe", { action: "subscribe", learnerId: id, consent: true, contactEmail: "a@example.com" })).body,
      { ok: false, reason: "disabled" });
    const plan = await s.post("/api/plan", { learnerId: id, candidates: [{ id: "1.1", letters: ["L"] }], knownLetters: [] });
    assert.equal(plan.body.source, "local");
    assert.equal(plan.body.lessonId, "1.1");
  } finally { await s.close(); }
});

test("TRUST_PROXY_HOPS sets Express trust proxy; a malformed value fails at startup", () => {
  const settings = (env) => { const app = { set: (k, v) => (app[k] = v), get: () => {}, post: () => {}, put: () => {}, delete: () => {}, use: () => {} }; registerIntegrations(app, env); return app["trust proxy"]; };
  assert.equal(settings({ TRUST_PROXY_HOPS: "2" }), 2);
  assert.equal(settings({}), undefined);
  assert.throws(() => settings({ TRUST_PROXY_HOPS: "x" }), /positive integer/);
});

