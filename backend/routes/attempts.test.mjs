import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serve } from "../testutil.mjs";
import { register } from "./attempts.mjs";

const id = randomUUID();
const NOW = 1_800_000_000_000;

function fakeDb({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    insertAttempts: async (learnerId, rows) => {
      if (fail) throw new Error("db down");
      calls.push({ learnerId, rows });
    },
    stats: async () => ({ daily: [{ day: "2026-11-07", attempts: 3, accuracy: 0.5 }], items: [] }),
  };
}

async function withApp(deps, fn) {
  const s = await serve((app) => register(app, { now: () => NOW, ...deps }));
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

test("stores a valid batch and answers 204", async () => {
  const db = fakeDb();
  await withApp({ db }, async (s) => {
    const r = await s.post("/api/attempts", {
      learnerId: id,
      attempts: [{ item: "L", correct: true }, { item: "I", correct: false, codes: ["thumb:placement"] }],
    });
    assert.equal(r.status, 204);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].learnerId, id);
    assert.deepEqual(db.calls[0].rows.map((x) => x.item), ["L", "I"]);
    assert.deepEqual(db.calls[0].rows[1].codes, ["thumb:placement"]);
  });
});

test("rejects the whole batch when an item is a fingerspelled word", async () => {
  const db = fakeDb();
  await withApp({ db }, async (s) => {
    const r = await s.post("/api/attempts", { learnerId: id, attempts: [{ item: "L", correct: true }, { item: "fs:LILY", correct: true }] });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: "bad_request" });
    assert.equal(db.calls.length, 0);
  });
});

test("rejects a bad learner id, an empty batch and a bad code", async () => {
  await withApp({ db: fakeDb() }, async (s) => {
    assert.equal((await s.post("/api/attempts", { learnerId: "x", attempts: [{ item: "L", correct: true }] })).status, 400);
    assert.equal((await s.post("/api/attempts", { learnerId: id, attempts: [] })).status, 400);
    assert.equal((await s.post("/api/attempts", { learnerId: id, attempts: [{ item: "L", correct: true, codes: ["DROP TABLE"] }] })).status, 400);
  });
});

test("replaces an old or future timestamp with now and keeps a recent one", async () => {
  const db = fakeDb();
  await withApp({ db }, async (s) => {
    await s.post("/api/attempts", {
      learnerId: id,
      attempts: [{ item: "L", correct: true, ts: 1 }, { item: "I", correct: true, ts: NOW + 99_999 }, { item: "O", correct: true, ts: NOW - 60_000 }],
    });
    const [old, future, recent] = db.calls[0].rows.map((r) => r.ts.getTime());
    assert.equal(old, NOW);
    assert.equal(future, NOW);
    assert.equal(recent, NOW - 60_000);
  });
});

test("answers 204 without a db (off state) and when the db fails", async () => {
  await withApp({ db: null }, async (s) => {
    assert.equal((await s.post("/api/attempts", { learnerId: id, attempts: [{ item: "L", correct: true }] })).status, 204);
  });
  await withApp({ db: fakeDb({ fail: true }) }, async (s) => {
    assert.equal((await s.post("/api/attempts", { learnerId: id, attempts: [{ item: "L", correct: true }] })).status, 204);
  });
});

test("stats returns the db result, or empty lists without a db", async () => {
  await withApp({ db: fakeDb() }, async (s) => {
    const r = await s.get(`/api/stats/${id}`);
    assert.equal(r.body.daily[0].attempts, 3);
    assert.equal((await s.get("/api/stats/nope")).status, 400);
  });
  await withApp({ db: null }, async (s) => {
    assert.deepEqual((await s.get(`/api/stats/${id}`)).body, { daily: [], items: [] });
  });
});

test("rejects malformed and oversized batches atomically; ignores extra personal fields", async () => {
  const db = fakeDb();
  await withApp({ db }, async (s) => {
    for (const body of [null, [], {}, { learnerId: [id], attempts: [{ item: "L", correct: true }] },
      { learnerId: id, attempts: Array.from({ length: 51 }, () => ({ item: "L", correct: true })) },
      ...[null, {}, { item: "L", correct: "true" }, { item: "L", correct: true, codes: [4] },
        { item: "L", correct: true, codes: null },
        { item: "L", correct: true, codes: Array(6).fill("thumb:curl") }].map((a) => ({ learnerId: id, attempts: [a] })),
    ]) {
      assert.equal((await s.post("/api/attempts", body)).status, 400, JSON.stringify(body));
    }
    assert.equal(db.calls.length, 0);
    assert.equal((await s.post("/api/attempts", { learnerId: id, userName: "private", email: "x@y.co",
      attempts: [{ item: "L", correct: true, name: "private", snapshot: "secret" }] })).status, 204);
    assert.deepEqual(Object.keys(db.calls[0]).sort(), ["learnerId", "rows"]);
    assert.deepEqual(Object.keys(db.calls[0].rows[0]).sort(), ["codes", "correct", "item", "ts"]);
  });
});

test("a database failure returns 503 instead of empty history and logs no provider secrets", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));
  const failure = async () => { throw new Error("postgres://private:password@host/db"); };
  await withApp({ db: { insertAttempts: failure, stats: failure } }, async (s) => {
    assert.equal((await s.post("/api/attempts", { learnerId: id, attempts: [{ item: "L", correct: true }] })).status, 204);
    const stats = await s.get(`/api/stats/${id}`);
    assert.equal(stats.status, 503);
    assert.deepEqual(stats.body, { error: "stats_unavailable" });
  });
  assert.equal(logs.length, 2);
  assert.doesNotMatch(logs.join(" "), /private|password|postgres:/);
});

test("attempt and stats rate limits are separate and run before validation", async () => {
  await withApp({ db: null }, async (s) => {
    for (let i = 0; i < 120; i++) assert.equal((await s.post("/api/attempts", {})).status, 400);
    assert.deepEqual(await s.post("/api/attempts", {}), { status: 429, body: { error: "rate_limited" } });
    for (let i = 0; i < 60; i++) assert.equal((await s.get("/api/stats/nope")).status, 400);
    assert.equal((await s.get(`/api/stats/${id}`)).status, 429);
  });
});

test("malformed JSON is rate-limited before body parsing", async () => {
  await withApp({ db: null }, async (s) => {
    for (let i = 0; i < 120; i++) {
      const response = await fetch(s.base + "/api/attempts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "bad_request" });
    }
    const response = await fetch(s.base + "/api/attempts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: "rate_limited" });
  });
});


test('a reachable database with no practice history returns a successful empty result', async () => {
  await withApp({ db: { stats: async () => ({ daily: [], items: [] }) } }, async s => {
    const r = await s.get(`/api/stats/${id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { daily: [], items: [] });
  });
});
