function normalizeModels(models) {
  return (models || [])
    .map((m) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean);
}

export function modelsFromEnv(envValue, defaults) {
  const parsed = normalizeModels(
    typeof envValue === "string" ? envValue.split(",") : [],
  );
  const def = normalizeModels(defaults);
  return parsed.length ? parsed : def;
}

export function isRetryableModelError(err) {
  const status = err?.status;
  if (status === 503 || status === 429) return true;

  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("overloaded") ||
    msg.includes("unavailable") ||
    msg.includes("resource") && msg.includes("exhausted") ||
    msg.includes("try again")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attempt, baseDelayMs, maxDelayMs) {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt));
  const jitter = 0.2 * exp * (Math.random() * 2 - 1); // +/- 20%
  return Math.max(0, Math.round(exp + jitter));
}

export async function runWithModelFallback({
  models,
  run,
  maxRetriesPerModel = 2,
  baseDelayMs = 800,
  maxDelayMs = 8_000,
}) {
  const list = normalizeModels(models);
  if (!list.length) {
    throw new Error("No models configured for fallback.");
  }

  const errors = [];
  for (const model of list) {
    let attempt = 0;
    // Retry the same model a few times for transient errors (503/429/etc).
    while (attempt <= maxRetriesPerModel) {
      try {
        const result = await run(model);
        return { result, modelUsed: model, attemptedModels: list };
      } catch (err) {
        errors.push({ model, err });
        if (!isRetryableModelError(err)) {
          throw err;
        }

        if (attempt >= maxRetriesPerModel) break;
        const delay = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
        await sleep(delay);
        attempt += 1;
      }
    }
  }

  const last = errors[errors.length - 1]?.err;
  if (last) {
    last.attemptedModels = list;
    throw last;
  }

  throw new Error("All models failed.");
}

