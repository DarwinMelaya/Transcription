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
