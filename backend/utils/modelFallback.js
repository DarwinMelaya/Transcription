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

export async function runWithModelFallback({ models, run }) {
  const list = normalizeModels(models);
  if (!list.length) {
    throw new Error("No models configured for fallback.");
  }

  const errors = [];
  for (const model of list) {
    try {
      const result = await run(model);
      return { result, modelUsed: model, attemptedModels: list };
    } catch (err) {
      errors.push({ model, err });
      if (!isRetryableModelError(err)) {
        throw err;
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

