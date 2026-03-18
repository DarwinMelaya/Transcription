const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 503;
}

function isNonRetryableQuotaError(status, data) {
  if (status !== 429) return false;
  const msg = String(data?.error || "").toLowerCase();
  // If the project is genuinely out of quota / billing disabled, retries only waste time.
  return msg.includes("plan") || msg.includes("billing") || msg.includes("out of quota");
}

async function fetchJsonWithTimeout(url, options = {}) {
  const {
    timeoutMs = 120_000,
    maxRetries = 2,
    retryBaseDelayMs = 800,
    ...fetchOptions
  } = options;

  let attempt = 0;
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const t = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(data.error || "Request failed.");
        err.status = res.status;
        err.data = data;
        if (
          isRetryableStatus(res.status) &&
          !isNonRetryableQuotaError(res.status, data) &&
          attempt < maxRetries
        ) {
          const delay = Math.min(8000, retryBaseDelayMs * 2 ** attempt);
          await sleep(delay);
          attempt += 1;
          continue;
        }
        throw err;
      }

      return { res, data };
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      if ((isAbort || err?.status == null) && attempt < maxRetries) {
        const delay = Math.min(8000, retryBaseDelayMs * 2 ** attempt);
        await sleep(delay);
        attempt += 1;
        continue;
      }
      throw err;
    } finally {
      window.clearTimeout(t);
    }
  }

  throw new Error("Request failed after retries.");
}

/**
 * Send an audio file to the backend for transcription.
 * @param {File} file - Audio file (e.g. from input type="file")
 * @returns {Promise<{ transcript: string }>}
 * @throws {Error} On non-OK response or network error
 */
export async function transcribeAudio(file) {
  const formData = new FormData();
  formData.append("audio", file);

  const { data } = await fetchJsonWithTimeout(`${API_BASE}/transcribe`, {
    method: "POST",
    body: formData,
    timeoutMs: 15 * 60_000,
    maxRetries: 2,
  });

  return { transcript: data.transcript ?? "", modelUsed: data.modelUsed ?? null };
}

/**
 * Start a chunked transcription job (backend splits into 30-minute parts).
 * @param {File} file
 * @returns {Promise<{ jobId: string, totalParts: number, chunkSeconds: number, durationSeconds: number | null }>}
 */
export async function startChunkedTranscription(file) {
  const formData = new FormData();
  formData.append("audio", file);

  const { data } = await fetchJsonWithTimeout(`${API_BASE}/transcribe/start`, {
    method: "POST",
    body: formData,
    timeoutMs: 15 * 60_000,
    maxRetries: 2,
  });

  return {
    jobId: data.jobId,
    totalParts: data.totalParts ?? 0,
    chunkSeconds: data.chunkSeconds ?? 1800,
    durationSeconds:
      typeof data.durationSeconds === "number" ? data.durationSeconds : null,
  };
}

/**
 * Transcribe a single chunk part of a job.
 * @param {string} jobId
 * @param {number} partIndex
 * @returns {Promise<{ transcriptPart: string, partIndex: number, totalParts: number, done: boolean, completedParts: number, progressPercent: number, modelUsed: string | null }>}
 */
export async function transcribeChunkPart(jobId, partIndex) {
  const { data } = await fetchJsonWithTimeout(`${API_BASE}/transcribe/part`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, partIndex }),
    timeoutMs: 15 * 60_000,
    maxRetries: 3,
  });

  return {
    transcriptPart: data.transcriptPart ?? "",
    partIndex: data.partIndex ?? partIndex,
    totalParts: data.totalParts ?? 0,
    done: Boolean(data.done),
    completedParts: typeof data.completedParts === "number" ? data.completedParts : 0,
    progressPercent:
      typeof data.progressPercent === "number" ? data.progressPercent : 0,
    modelUsed: data.modelUsed ?? null,
  };
}

/**
 * Finalize a chunked transcription job by merging parts on the backend.
 * @param {string} jobId
 * @returns {Promise<{ transcript: string }>}
 */
export async function finalizeChunkedTranscription(jobId) {
  const { data } = await fetchJsonWithTimeout(`${API_BASE}/transcribe/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
    timeoutMs: 120_000,
    maxRetries: 1,
  });

  return { transcript: data.transcript ?? "" };
}

/**
 * Generate a concise, professional summary from a transcript.
 * @param {string} transcript
 * @param {{ documentType?: string, responseStyle?: string, extraNotes?: string, builtInPrompt?: string }} [options]
 * @returns {Promise<{ summary: string }>}
 * @throws {Error}
 */
export async function summarizeTranscript(transcript, options = {}) {
  const { data } = await fetchJsonWithTimeout(`${API_BASE}/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      documentType: options.documentType,
      responseStyle: options.responseStyle,
      extraNotes: options.extraNotes,
      builtInPrompt: options.builtInPrompt,
    }),
    timeoutMs: 5 * 60_000,
    maxRetries: 2,
  });

  return {
    summary: data.summary ?? "",
    modelUsed: data.modelUsed ?? null,
    condensed: Boolean(data.condensed),
    condensedChunks:
      typeof data.condensedChunks === "number" ? data.condensedChunks : 0,
  };
}

/**
 * Export a summary as a designed PDF.
 * @param {string} summary
 * @param {{ title?: string }} [options]
 * @returns {Promise<Blob>}
 */
export async function exportSummaryPdf(summary, options = {}) {
  const res = await fetch(`${API_BASE}/summary/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary,
      title: options.title,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to export summary PDF.");
  }

  return await res.blob();
}

/**
 * Generate compact notes from a transcript.
 * @param {string} transcript
 * @returns {Promise<{ notes: string, modelUsed: string | null, condensed: boolean, condensedChunks: number }>}
 */
export async function summarizeNotes(transcript) {
  const { data } = await fetchJsonWithTimeout(`${API_BASE}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
    timeoutMs: 5 * 60_000,
    maxRetries: 2,
  });

  return {
    notes: data.notes ?? "",
    modelUsed: data.modelUsed ?? null,
    condensed: Boolean(data.condensed),
    condensedChunks:
      typeof data.condensedChunks === "number" ? data.condensedChunks : 0,
  };
}
