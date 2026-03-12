import { useState } from "react";
import {
  finalizeChunkedTranscription,
  startChunkedTranscription,
  summarizeTranscript,
  transcribeAudio,
  transcribeChunkPart,
} from "../../utils/api";
import TranscribingModal from "../../Components/Modals/TranscribingModal";

const Home = () => {
  const [file, setFile] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chunkJob, setChunkJob] = useState(null); // { jobId, totalParts }
  const [chunkPartIndex, setChunkPartIndex] = useState(0);
  const [chunkParts, setChunkParts] = useState([]); // transcript parts
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [chunked, setChunked] = useState(false);

  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  const [builtInPrompt, setBuiltInPrompt] = useState(
    "Executive Minutes (Lite)",
  );
  const [documentType, setDocumentType] = useState("Executive Meeting Minute");
  const [responseStyle, setResponseStyle] = useState("Concise, professional");
  const [extraNotes, setExtraNotes] = useState("");

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
    setSummary("");
    setSummaryError("");
    setChunkJob(null);
    setChunkPartIndex(0);
    setChunkParts([]);
    setAwaitingNext(false);
    setChunked(false);
  };

  const getAudioDurationSeconds = (f) =>
    new Promise((resolve) => {
      try {
        const audio = document.createElement("audio");
        const url = URL.createObjectURL(f);
        audio.preload = "metadata";
        audio.onloadedmetadata = () => {
          const dur = Number.isFinite(audio.duration) ? audio.duration : null;
          URL.revokeObjectURL(url);
          resolve(dur);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        audio.src = url;
      } catch {
        resolve(null);
      }
    });

  const transcribeNextChunk = async () => {
    if (!chunkJob?.jobId) return;

    setLoading(true);
    setError("");
    setAwaitingNext(false);

    try {
      const { transcriptPart } = await transcribeChunkPart(
        chunkJob.jobId,
        chunkPartIndex,
      );

      setChunkParts((prev) => {
        const next = [...prev];
        next[chunkPartIndex] = transcriptPart || "";
        return next;
      });

      const nextIndex = chunkPartIndex + 1;
      setChunkPartIndex(nextIndex);

      if (nextIndex < chunkJob.totalParts) {
        setAwaitingNext(true);
        return;
      }

      const { transcript: merged } = await finalizeChunkedTranscription(
        chunkJob.jobId,
      );
      setTranscript(merged || "");
      setChunkJob(null);
      setChunked(false);
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setAwaitingNext(true);
    } finally {
      setLoading(false);
    }
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
    setSummary("");
    setSummaryError("");
    setChunkJob(null);
    setChunkPartIndex(0);
    setChunkParts([]);
    setAwaitingNext(false);
    setChunked(false);

    try {
      const durationSeconds = await getAudioDurationSeconds(file);

      if (typeof durationSeconds === "number" && durationSeconds > 30 * 60) {
        const started = await startChunkedTranscription(file);

        if (!started.totalParts || !started.jobId) {
          throw new Error("Failed to start chunked transcription.");
        }

        setChunked(true);
        setChunkJob({ jobId: started.jobId, totalParts: started.totalParts });
        setChunkParts(Array(started.totalParts).fill(""));
        setChunkPartIndex(0);
        setAwaitingNext(true);
        return;
      }

      const { transcript: text } = await transcribeAudio(file);
      setTranscript(text || "");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore (clipboard permissions)
    }
  };

  const handleDownload = (text, filenameBase) => {
    if (!text) return;
    const safeBase =
      (filenameBase ? filenameBase.replace(/\.[^/.]+$/, "") : "export") ||
      "export";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeBase}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleGenerateSummary = async () => {
    if (!transcript.trim()) {
      setSummaryError("Please generate a transcript first.");
      return;
    }

    setSummaryLoading(true);
    setSummaryError("");
    setSummary("");

    try {
      const { summary: s } = await summarizeTranscript(transcript, {
        builtInPrompt,
        documentType,
        responseStyle,
        extraNotes,
      });
      setSummary(s || "");
    } catch (err) {
      setSummaryError(err.message || "Failed to generate summary.");
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleClear = () => {
    setTranscript("");
    setError("");
    setFile(null);
    setSummary("");
    setSummaryError("");
    setChunkJob(null);
    setChunkPartIndex(0);
    setChunkParts([]);
    setAwaitingNext(false);
    setChunked(false);
  };

  const transcriptBaseName = file?.name
    ? file.name.replace(/\.[^/.]+$/, "")
    : "transcript";

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <TranscribingModal
        open={loading || awaitingNext}
        fileName={file?.name}
        subtitle={
          chunked
            ? loading
              ? "Transcribing this 30-minute part…"
              : "Ready for the next 30-minute part"
            : "Converting your audio to text…"
        }
        progressLabel={
          chunked && chunkJob?.totalParts
            ? `Part ${Math.min(chunkPartIndex + (loading ? 1 : 0), chunkJob.totalParts)} of ${chunkJob.totalParts}`
            : null
        }
        actionLabel={awaitingNext ? "Transcribe next 30 minutes" : null}
        onAction={awaitingNext ? transcribeNextChunk : null}
        actionDisabled={loading}
      />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-[-14rem] h-[30rem] w-[55rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-600/25 via-sky-500/20 to-emerald-500/15 blur-3xl" />
        <div className="absolute bottom-[-18rem] right-[-12rem] h-[34rem] w-[34rem] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),rgba(255,255,255,0)_45%)]" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-white/60">
              TRANSCRIPT • SUMMARY
            </p>
            <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight">
              Convert audio to transcript, then generate a clean executive
              summary
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
              Upload an audio file to transcribe. Then convert the transcript
              into a concise, professional Markdown summary with optional extra
              notes.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {/* Left panel */}
          <div className="rounded-3xl border border-white/10 bg-white/5 shadow-[0_20px_80px_-40px_rgba(0,0,0,0.9)] backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <p className="text-xs font-semibold text-white/50">
                  TRANSCRIPTION
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  Transcript Studio
                </h2>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(transcript)}
                  disabled={!transcript}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload(transcript, transcriptBaseName)}
                  disabled={!transcript}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Download
                </button>
              </div>
            </div>

            <div className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold">
                        {file ? file.name : "Drop a file or browse to begin"}
                      </p>
                      <p className="mt-1 text-xs text-white/55">
                        {file
                          ? `${formatBytes(file.size)} • ${
                              file.type || "audio/*"
                            }`
                          : "Tip: clearer audio = better transcript."}
                      </p>
                    </div>

                    <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-sky-400 focus-within:ring-offset-2 focus-within:ring-offset-[#070A12]">
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

                {error && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#070A12] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {loading && (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#070A12]/40 border-t-[#070A12]" />
                    )}
                    {loading ? "Transcribing..." : "Transcribe Audio"}
                  </button>

                  <button
                    type="button"
                    onClick={handleClear}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/10 sm:w-auto"
                  >
                    Reset
                  </button>
                </div>
              </form>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-white/50">OUTPUT</p>
                  <p className="text-xs text-white/40">
                    {transcript
                      ? `${transcript.length.toLocaleString()} chars`
                      : "—"}
                  </p>
                </div>

                <div className="mt-3">
                  {transcript ? (
                    <div className="max-h-[26rem] overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/80 whitespace-pre-wrap">
                      {transcript}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/15 bg-black/10 p-10 text-center">
                      <p className="text-sm font-semibold text-white/80">
                        Waiting for transcript
                      </p>
                      <p className="mt-1 text-xs text-white/50">
                        Upload an audio file, then click Transcribe Audio.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div className="rounded-3xl border border-white/10 bg-white/5 shadow-[0_20px_80px_-40px_rgba(0,0,0,0.9)] backdrop-blur">
            <div className="border-b border-white/10 px-6 py-5">
              <p className="text-xs font-semibold text-white/50">
                LOGIC ARCHITECT
              </p>
              <h2 className="mt-1 text-lg font-semibold">Summary Builder</h2>
              <p className="mt-1 text-xs text-white/55">
                Configure the intelligence layer and processing parameters for
                your output.
              </p>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold tracking-widest text-white/40">
                    BUILT-IN PROMPT
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {["Executive Minutes (Lite)", "Action Items (Lite)"].map(
                      (opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setBuiltInPrompt(opt)}
                          className={[
                            "rounded-xl border px-3 py-2 text-xs font-semibold",
                            opt === builtInPrompt
                              ? "border-sky-400/40 bg-sky-500/15 text-white"
                              : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
                          ].join(" ")}
                        >
                          {opt}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold tracking-widest text-white/40">
                    EXTRA NOTES (OPTIONAL)
                  </p>
                  <textarea
                    value={extraNotes}
                    onChange={(e) => setExtraNotes(e.target.value)}
                    placeholder="e.g., Focus on budget, timelines, and assigned owners…"
                    className="mt-2 h-[76px] w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/20"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold tracking-widest text-white/40">
                    DOCUMENT TYPE
                  </p>
                  <select
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80 outline-none focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/20"
                  >
                    <option
                      className="bg-[#070A12]"
                      value="Executive Meeting Minute"
                    >
                      Executive Meeting Minute
                    </option>
                    <option
                      className="bg-[#070A12]"
                      value="Project Update Summary"
                    >
                      Project Update Summary
                    </option>
                    <option
                      className="bg-[#070A12]"
                      value="Technical Call Notes"
                    >
                      Technical Call Notes
                    </option>
                  </select>
                </div>

                <div>
                  <p className="text-[11px] font-semibold tracking-widest text-white/40">
                    RESPONSE STYLE
                  </p>
                  <select
                    value={responseStyle}
                    onChange={(e) => setResponseStyle(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80 outline-none focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/20"
                  >
                    <option
                      className="bg-[#070A12]"
                      value="Concise, professional"
                    >
                      Concise, professional
                    </option>
                    <option
                      className="bg-[#070A12]"
                      value="Detailed, professional"
                    >
                      Detailed, professional
                    </option>
                    <option
                      className="bg-[#070A12]"
                      value="Bullet-heavy, professional"
                    >
                      Bullet-heavy, professional
                    </option>
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] font-semibold tracking-widest text-white/40">
                  SPECIAL DIRECTIVES (LITE)
                </p>
                <p className="mt-2 text-xs leading-5 text-white/60">
                  Write meeting minutes in Markdown. Do not invent details. If
                  missing:{" "}
                  <span className="font-semibold text-white/70">
                    Not specified
                  </span>
                  . Include: Title, Date, Attendees, Agenda, Executive Summary,
                  Key Points, Decisions, Action Items, Risks, Next Steps.
                </p>
              </div>

              {summaryError && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {summaryError}
                </div>
              )}

              <button
                type="button"
                onClick={handleGenerateSummary}
                disabled={summaryLoading || !transcript}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#070A12] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {summaryLoading && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#070A12]/40 border-t-[#070A12]" />
                )}
                Generate Summary
              </button>

              <div className="pt-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-white/50">SUMMARY</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(summary)}
                      disabled={!summary}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDownload(summary, `${transcriptBaseName}-summary`)
                      }
                      disabled={!summary}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Download
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  {summary ? (
                    <div className="max-h-[22rem] overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/80 whitespace-pre-wrap">
                      {summary}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/15 bg-black/10 p-8 text-center">
                      <p className="text-sm font-semibold text-white/80">
                        No summary yet
                      </p>
                      <p className="mt-1 text-xs text-white/50">
                        Generate a transcript first, then click Generate
                        Summary.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
