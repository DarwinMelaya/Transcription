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
