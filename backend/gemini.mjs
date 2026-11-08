export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const TRANSIENT = new Set([500, 502, 503, 504]);
const cooldowns = new WeakMap();
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;

function quotaDelay(error) {
  // The Google SDK's ApiError keeps the provider JSON in message. Never log it.
  let payload;
  try { payload = JSON.parse(error?.message); } catch { /* use default below */ }
  const details = payload?.error?.details ?? payload?.details ?? error?.details;
  if (!Array.isArray(details)) return DEFAULT_COOLDOWN_MS;
  const delays = details.filter(d => d?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo')
    .map(d => typeof d.retryDelay === 'string' && /^\d+(?:\.\d+)?s$/.test(d.retryDelay)
      ? Number(d.retryDelay.slice(0, -1)) * 1000 : NaN)
    .filter(ms => Number.isFinite(ms) && ms > 0);
  return Math.min(MAX_COOLDOWN_MS, Math.max(DEFAULT_COOLDOWN_MS, ...delays));
}

// Log allowlisted metadata only. Provider messages, request URLs, and prompts may contain secrets.
export function logGeminiError(error, attempt, retrying, logger = entry => console.warn(JSON.stringify(entry))) {
  const status = Number(error?.status ?? error?.code);
  logger({ event: 'gemini_request_failed', status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    reason: error?.name === 'TimeoutError' ? 'timeout' : 'api_failure', attempt, retrying });
}

export async function generateWithRetry(ai, request, {
  timeoutMs = 12000, attemptTimeoutMs = 6000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random,
  logger, beforeAttempt = () => {}, now = Date.now,
} = {}) {
  let models = cooldowns.get(ai);
  if (!models) { models = new Map(); cooldowns.set(ai, models); }
  const model = request.model ?? DEFAULT_GEMINI_MODEL;
  const deadline = performance.now() + timeoutMs;
  for (let attempt = 0; attempt <= 3; attempt++) {
    if ((models.get(model) ?? 0) > now()) {
      throw Object.assign(new Error('Gemini requests paused after quota error'), { status: 429 });
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new DOMException('Gemini deadline exceeded', 'TimeoutError');
    beforeAttempt();
    const controller = new AbortController();
    let timer;
    try {
      // Disable SDK retries: this loop owns the four-attempt cap and total deadline.
      return await Promise.race([
        ai.models.generateContent({ ...request, config: { ...request.config,
          abortSignal: controller.signal, httpOptions: { retryOptions: { attempts: 1 } } } }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          const error = new DOMException('Gemini attempt timed out', 'TimeoutError');
          reject(error); controller.abort(error);
        }, Math.min(remaining, attemptTimeoutMs)); }),
      ]);
    } catch (error) {
      if (Number(error?.status ?? error?.code) === 429) {
        models.set(model, Math.max(models.get(model) ?? 0, now() + quotaDelay(error)));
      }
      const retrying = attempt < 3 && performance.now() < deadline &&
        (TRANSIENT.has(Number(error?.status ?? error?.code)) || error?.name === 'TimeoutError');
      logGeminiError(error, attempt + 1, retrying, logger);
      if (!retrying) throw error;
    } finally { clearTimeout(timer); }
    const delay = Math.floor(random() * Math.min(1600, 200 * 2 ** attempt));
    if (performance.now() + delay >= deadline) throw new DOMException('Gemini deadline exceeded', 'TimeoutError');
    await sleep(delay);
  }
}
