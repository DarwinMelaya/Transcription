import { useState } from "react";
import { transcribeAudio } from "../../utils/api";

const Home = () => {
  const [file, setFile] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024)),
    );
    const value = bytes / 1024 ** i;
    return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] ?? null);
    setTranscript("");
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError("Please choose an audio file first.");
      return;
    }

    setLoading(true);
    setError("");
    setTranscript("");

    try {
      const { transcript: text } = await transcribeAudio(file);
      setTranscript(text || "");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
    } catch {
      // ignore (clipboard permissions)
    }
  };

  const handleDownload = () => {
    if (!transcript) return;
    const safeBase =
      (file?.name ? file.name.replace(/\.[^/.]+$/, "") : "transcript") ||
      "transcript";
    const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeBase}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    setTranscript("");
    setError("");
    setFile(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-sky-200/60 via-indigo-200/40 to-emerald-200/40 blur-3xl" />
          <div className="absolute -bottom-32 right-[-10rem] h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
        </div>

        <div className="relative mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Audio to Text Transcription
              </h1>
              <p className="mt-3 max-w-xl text-pretty text-sm leading-6 text-slate-600 sm:text-base">
                Upload an audio file and get a readable transcript in seconds.
                Simple, secure-by-default, and designed with a clean government
                dashboard feel.
              </p>

              <div className="mt-6 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-slate-900">
                    Accurate output
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Clear formatting for long text.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-slate-900">
                    Fast workflow
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Copy or download as TXT.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-slate-900">
                    Professional UI
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Clean spacing and contrast.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/50">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">
                  Transcription request
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  Supported: any audio format your browser can upload.
                </p>
              </div>

              <div className="p-5">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-700">
                      Upload audio file
                    </label>
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {file ? file.name : "Choose a file to start"}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {file
                              ? `${formatBytes(file.size)} • ${
                                  file.type || "audio/*"
                                }`
                              : "Tip: use clear recordings for best results."}
                          </p>
                        </div>

                        <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 focus-within:outline-none focus-within:ring-2 focus-within:ring-sky-400 focus-within:ring-offset-2">
                          <input
                            type="file"
                            accept="audio/*"
                            onChange={handleFileChange}
                            className="sr-only"
                          />
                          Browse
                        </label>
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      {error}
                    </div>
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="submit"
                      disabled={loading}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      {loading && (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-white" />
                      )}
                      {loading ? "Transcribing..." : "Transcribe"}
                    </button>

                    <button
                      type="button"
                      onClick={handleClear}
                      className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 sm:w-auto"
                    >
                      Reset
                    </button>

                    <div className="sm:ml-auto" />
                  </div>

                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">
                        Step 1
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Upload your audio file.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-900">
                        Step 2
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Click Transcribe.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-900">
                        Step 3
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Copy or download the result.
                      </p>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Transcript
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Your output will appear here. Use the actions to export it.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopy}
                disabled={!transcript}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!transcript}
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download .txt
              </button>
            </div>
          </div>

          <div className="p-5">
            {transcript ? (
              <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 whitespace-pre-wrap">
                {transcript}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                <p className="text-sm font-semibold text-slate-900">
                  No transcript yet
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Upload an audio file and click Transcribe to generate text.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-900">Privacy note</p>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              Your file is only used for transcription. Avoid uploading
              sensitive recordings unless required for your workflow.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-900">
              Better results
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              Use clear speech, reduce background noise, and prefer one speaker
              per recording when possible.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-900">Export-ready</p>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              Copy to clipboard for reports, or download as a `.txt` file for
              archiving.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
