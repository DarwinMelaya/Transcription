const TranscribingModal = ({
  open,
  fileName,
  subtitle,
  progressLabel,
  progressPercent,
  modelLabel,
  actionLabel,
  onAction,
  actionDisabled = false,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Transcribing audio"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0B1020]/90 p-6 shadow-[0_30px_120px_-60px_rgba(0,0,0,0.95)]">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white/90" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-widest text-white/50">
              TRANSCRIBING
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">
              {subtitle || "Converting your audio to text…"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-white/60">
              {fileName ? (
                <>
                  File:{" "}
                  <span className="font-semibold text-white/75">{fileName}</span>
                </>
              ) : (
                "Please keep this tab open while we process your audio."
              )}
            </p>

            <div className="mt-2 space-y-1">
              {progressLabel && (
                <p className="text-xs font-semibold text-white/55">
                  {progressLabel}
                </p>
              )}
              <div className="space-y-1">
                {typeof progressPercent === "number" && (
                  <p className="text-[11px] font-semibold text-white/55">
                    {progressPercent}% complete
                  </p>
                )}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full bg-sky-400 ${
                      typeof progressPercent === "number"
                        ? ""
                        : "animate-pulse"
                    }`}
                    style={
                      typeof progressPercent === "number"
                        ? {
                            width: `${Math.min(
                              100,
                              Math.max(0, progressPercent),
                            )}%`,
                          }
                        : { width: "40%" }
                    }
                  />
                </div>
              </div>
            </div>

            {modelLabel && (
              <p className="mt-2 text-xs font-semibold text-white/45">
                Model: <span className="text-white/65">{modelLabel}</span>
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs font-semibold text-white/70">Tip</p>
          <p className="mt-1 text-xs leading-5 text-white/55">
            Longer audio files can take a few minutes. Avoid refreshing to
            prevent losing progress.
          </p>
        </div>

        {actionLabel && onAction && (
          <div className="mt-5">
            <button
              type="button"
              onClick={onAction}
              disabled={actionDisabled}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#070A12] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {actionLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TranscribingModal;
