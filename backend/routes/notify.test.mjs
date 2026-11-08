import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serve } from "../testutil.mjs";
import { register } from "./notify.mjs";

const id = randomUUID();
const n8n = { subscribeUrl: "http://n8n.test/sub", eventUrl: "http://n8n.test/evt", secret: "s3cret" };

function fakeFetch({ ok = true, status = ok ? 200 : 500, throws = false, json = { ok: true }, text = "" } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw new Error("network");
    return { ok, status, json: async () => json, text: async () => text };
  };
  f.calls = calls;
  return f;
}

async function withApp(deps, fn) {
  const s = await serve((app) => register(app, deps));
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

const sub = { action: "subscribe", learnerId: id, consent: true, userName: "Ryan", theirName: "Lily", contactEmail: "lily@example.com" };

test("subscribe forwards the validated fields with the secret header", async () => {
  const f = fakeFetch();
  await withApp({ n8n, fetch: f }, async (s) => {
    const r = await s.post("/api/subscribe", { ...sub, junk: "ignored" });
    assert.deepEqual(r.body, { ok: true });
    assert.equal(f.calls[0].url, n8n.subscribeUrl);
    assert.equal(f.calls[0].init.headers["X-Handshake-Secret"], "s3cret");
    const forwarded = JSON.parse(f.calls[0].init.body);
    assert.ok(Number.isFinite(Date.parse(forwarded.requestedAt)));
    const { requestedAt, ...fields } = forwarded;
    assert.deepEqual(fields, {
      action: "subscribe", learnerId: id, userName: "Ryan", theirName: "Lily", contactEmail: "lily@example.com",
    });
  });
});

test("subscribe without consent, without any email, or with a bad name is a 400 and sends nothing", async () => {
  const f = fakeFetch();
  await withApp({ n8n, fetch: f }, async (s) => {
    assert.equal((await s.post("/api/subscribe", { ...sub, consent: false })).status, 400);
    assert.equal((await s.post("/api/subscribe", { ...sub, contactEmail: undefined })).status, 400);
    assert.equal((await s.post("/api/subscribe", { ...sub, userName: "<script>" })).status, 400);
    assert.equal((await s.post("/api/subscribe", { ...sub, contactEmail: "not-an-email" })).status, 400);
    assert.equal(f.calls.length, 0);
  });
});

test("unsubscribe forwards the action, learner id and server ordering timestamp", async () => {
  const f = fakeFetch();
  await withApp({ n8n, fetch: f }, async (s) => {
    const r = await s.post("/api/subscribe", { action: "unsubscribe", learnerId: id });
    assert.deepEqual(r.body, { ok: true });
    const { requestedAt, ...fields } = JSON.parse(f.calls[0].init.body);
    assert.ok(Number.isFinite(Date.parse(requestedAt)));
    assert.deepEqual(fields, { action: "unsubscribe", learnerId: id });
  });
});

test("lesson-complete forwards to the event webhook and validates fields", async () => {
  const f = fakeFetch();
  await withApp({ n8n, fetch: f }, async (s) => {
    const r = await s.post("/api/lesson-complete", { learnerId: id, lessonId: "1.2", xp: 20 });
    assert.deepEqual(r.body, { ok: true });
    assert.equal(f.calls[0].url, n8n.eventUrl);
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { learnerId: id, lessonId: "1.2", xp: 20 });
    assert.equal((await s.post("/api/lesson-complete", { learnerId: id, lessonId: "x", xp: 20 })).status, 400);
    assert.equal((await s.post("/api/lesson-complete", { learnerId: id, lessonId: "1.2", xp: 5000 })).status, 400);
    // Free text is never forwarded: n8n derives the title from lessonId.
    await s.post("/api/lesson-complete", { learnerId: id, lessonId: "1.2", lessonTitle: "Open http://evil.example/x", userName: "Ryan", xp: 5 });
    assert.deepEqual(JSON.parse(f.calls[1].init.body), { learnerId: id, lessonId: "1.2", xp: 5 });
    assert.equal(f.calls.length, 2);
  });
});

test("answers ok:false when n8n is off, down, or rejects", async () => {
  await withApp({ n8n: null, fetch: fakeFetch() }, async (s) => {
    assert.deepEqual((await s.post("/api/subscribe", sub)).body, { ok: false, reason: "disabled" });
    assert.deepEqual((await s.post("/api/lesson-complete", { learnerId: id, lessonId: "1.2", xp: 1 })).body, { ok: false, reason: "disabled" });
  });
  await withApp({ n8n, fetch: fakeFetch({ throws: true }) }, async (s) => {
    assert.deepEqual((await s.post("/api/subscribe", sub)).body, { ok: false, reason: "automation_unavailable" });
  });
  await withApp({ n8n, fetch: fakeFetch({ ok: false, status: 502 }) }, async (s) => {
    assert.deepEqual((await s.post("/api/lesson-complete", { learnerId: id, lessonId: "1.2", xp: 1 })).body, { ok: false, reason: "automation_unavailable" });
  });
});


test("subscription ordering timestamp is minted by the server, never accepted from the browser", async () => {
  const f = fakeFetch();
  const before = Date.now();
  await withApp({ n8n, fetch: f }, async (s) => {
    await s.post("/api/subscribe", { ...sub, requestedAt: "2099-01-01T00:00:00.000Z" });
    const requestedAt = Date.parse(JSON.parse(f.calls[0].init.body).requestedAt);
    assert.ok(requestedAt >= before && requestedAt <= Date.now());
  });
});

const REASON_TABLE = [
  [429, "confirmation_limit"], [503, "delivery_pending"], [409, "stale_request"], [400, "bad_request"], [422, "bad_request"],
  [500, "delivery_failed"], [502, "automation_unavailable"], [504, "automation_unavailable"], [404, "automation_unavailable"],
  [401, "automation_unavailable"], [403, "automation_unavailable"], [507, "automation_unavailable"],
];

async function captureErrors(fn) {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try { await fn(); } finally { console.error = orig; }
  return logged;
}

test("upstream status maps to a specific reason on both routes, with no upstream body and generic logs", async () => {
  const logged = await captureErrors(async () => {
    for (const [status, reason] of REASON_TABLE) {
      const f = fakeFetch({ ok: false, status, text: "SECRET lily@example.com", json: { leak: "lily@example.com" } });
      await withApp({ n8n, fetch: f }, async (s) => {
        assert.deepEqual((await s.post("/api/subscribe", sub)).body, { ok: false, reason }, `subscribe ${status}`);
        assert.deepEqual((await s.post("/api/lesson-complete", { learnerId: id, lessonId: "1.2", xp: 1 })).body, { ok: false, reason }, `lesson ${status}`);
      });
    }
  });
  assert.ok(logged.length > 0);
  for (const line of logged) assert.match(line, /^n8n forwarding failed: [a-z_]+$/);
});

test("timeout and abort errors are automation_unavailable", async () => {
  const f = async () => { throw new DOMException("timed out", "TimeoutError"); };
  await withApp({ n8n, fetch: f }, async (s) => {
    assert.deepEqual((await s.post("/api/subscribe", sub)).body, { ok: false, reason: "automation_unavailable" });
  });
});

const statusBody = { ok: true, contact: "awaiting_confirmation", recap: "requested", expired: false, delivery: "pending" };
const n8nStatus = { ...n8n, statusUrl: "http://n8n.test/status" };

test("notify-status validates learnerId, is no-store, and posts only the learner id", async () => {
  const f = fakeFetch({ json: statusBody });
  await withApp({ n8n: n8nStatus, fetch: f }, async (s) => {
    for (const q of ["", "?learnerId=nope", `?learnerId=${id}&learnerId=${id}`]) {
      const r = await s.request("GET", `/api/notify-status${q}`);
      assert.equal(r.status, 400);
    }
    assert.equal(f.calls.length, 0);
    const r = await s.request("GET", `/api/notify-status?learnerId=${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.deepEqual(r.body, statusBody);
    assert.equal(f.calls[0].url, n8nStatus.statusUrl);
    assert.equal(f.calls[0].init.headers["X-Handshake-Secret"], "s3cret");
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { learnerId: id });
  });
});

test("notify-status reports disabled and status_unavailable", async () => {
  await withApp({ n8n: null, fetch: fakeFetch() }, async (s) => {
    assert.deepEqual((await s.get(`/api/notify-status?learnerId=${id}`)).body, { ok: false, reason: "disabled" });
  });
  const f = fakeFetch();
  await withApp({ n8n, fetch: f }, async (s) => {
    assert.deepEqual((await s.get(`/api/notify-status?learnerId=${id}`)).body, { ok: false, reason: "status_unavailable" });
    assert.equal(f.calls.length, 0);
  });
});

test("notify-status whitelists the upstream reply and rebuilds exactly five keys", async () => {
  await withApp({ n8n: n8nStatus, fetch: fakeFetch({ json: { ...statusBody, email: "lily@example.com", token: "t" } }) }, async (s) => {
    assert.deepEqual(Object.keys((await s.get(`/api/notify-status?learnerId=${id}`)).body).sort(), ["contact", "delivery", "expired", "ok", "recap"]);
  });
  const bad = [
    { ...statusBody, contact: "weird" }, { ...statusBody, recap: "x" }, { ...statusBody, expired: "no" },
    { ...statusBody, delivery: "late" }, { ...statusBody, ok: false }, { contact: "none" }, null, "text",
  ];
  const logged = await captureErrors(async () => {
    for (const json of bad) {
      await withApp({ n8n: n8nStatus, fetch: fakeFetch({ json }) }, async (s) => {
        assert.deepEqual((await s.get(`/api/notify-status?learnerId=${id}`)).body, { ok: false, reason: "automation_unavailable" });
      });
    }
  });
  assert.ok(logged.every((l) => !l.includes("lily") && !l.includes("s3cret")));
});

test("notify-status maps upstream failures like the other routes and survives non-JSON bodies", async () => {
  await captureErrors(async () => {
    for (const [status, reason] of [[429, "confirmation_limit"], [500, "delivery_failed"], [404, "automation_unavailable"]]) {
      await withApp({ n8n: n8nStatus, fetch: fakeFetch({ ok: false, status }) }, async (s) => {
        assert.deepEqual((await s.get(`/api/notify-status?learnerId=${id}`)).body, { ok: false, reason });
      });
    }
    await withApp({ n8n: n8nStatus, fetch: fakeFetch({ throws: true }) }, async (s) => {
      assert.deepEqual((await s.get(`/api/notify-status?learnerId=${id}`)).body, { ok: false, reason: "automation_unavailable" });
    });
    const f = fakeFetch(); const orig = f;
    const broken = async (...a) => ({ ...(await orig(...a)), json: async () => { throw new Error("bad json"); } });
    await withApp({ n8n: n8nStatus, fetch: broken }, async (s) => {
      assert.deepEqual((await s.get(`/api/notify-status?learnerId=${id}`)).body, { ok: false, reason: "automation_unavailable" });
    });
  });
});

test("notify-status is rate limited", async () => {
  await withApp({ n8n: n8nStatus, fetch: fakeFetch({ json: statusBody }) }, async (s) => {
    let last;
    for (let i = 0; i < 11; i++) last = await s.get(`/api/notify-status?learnerId=${id}`);
    assert.equal(last.status, 429);
  });
});

test("notify-status has a global cap shared across callers", async () => {
  const f = fakeFetch({ json: statusBody });
  await withApp({ n8n: n8nStatus, fetch: f, statusGlobalMax: 3 }, async (s) => {
    const rs = [];
    for (let i = 0; i < 5; i++) rs.push(await s.get(`/api/notify-status?learnerId=${id}`));
    assert.deepEqual(rs.map((r) => r.status), [200, 200, 200, 429, 429]);
    assert.equal(f.calls.length, 3);
  });
});
