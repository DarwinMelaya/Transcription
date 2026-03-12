const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Send an audio file to the backend for transcription.
 * @param {File} file - Audio file (e.g. from input type="file")
 * @returns {Promise<{ transcript: string }>}
 * @throws {Error} On non-OK response or network error
 */
export async function transcribeAudio(file) {
  const formData = new FormData();
  formData.append("audio", file);

  const res = await fetch(`${API_BASE}/transcribe`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Failed to transcribe audio.");
  }

  return { transcript: data.transcript ?? "" };
}

/**
 * Start a chunked transcription job (backend splits into 30-minute parts).
 * @param {File} file
 * @returns {Promise<{ jobId: string, totalParts: number, chunkSeconds: number, durationSeconds: number | null }>}
 */
export async function startChunkedTranscription(file) {
  const formData = new FormData();
  formData.append("audio", file);

  const res = await fetch(`${API_BASE}/transcribe/start`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to start chunked transcription.");
  }

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
 * @returns {Promise<{ transcriptPart: string, partIndex: number, totalParts: number, done: boolean }>}
 */
export async function transcribeChunkPart(jobId, partIndex) {
  const res = await fetch(`${API_BASE}/transcribe/part`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, partIndex }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to transcribe chunk part.");
  }

  return {
    transcriptPart: data.transcriptPart ?? "",
    partIndex: data.partIndex ?? partIndex,
    totalParts: data.totalParts ?? 0,
    done: Boolean(data.done),
  };
}

/**
 * Finalize a chunked transcription job by merging parts on the backend.
 * @param {string} jobId
 * @returns {Promise<{ transcript: string }>}
 */
export async function finalizeChunkedTranscription(jobId) {
  const res = await fetch(`${API_BASE}/transcribe/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to finalize chunked transcription.");
  }

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
  const res = await fetch(`${API_BASE}/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      documentType: options.documentType,
      responseStyle: options.responseStyle,
      extraNotes: options.extraNotes,
      builtInPrompt: options.builtInPrompt,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Failed to summarize transcript.");
  }

  return { summary: data.summary ?? "" };
}
