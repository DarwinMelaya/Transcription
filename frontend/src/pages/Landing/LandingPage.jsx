import { Link } from "react-router-dom";

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-[-14rem] h-[30rem] w-[55rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-600/25 via-sky-500/20 to-emerald-500/15 blur-3xl" />
        <div className="absolute bottom-[-18rem] right-[-12rem] h-[34rem] w-[34rem] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),rgba(255,255,255,0)_45%)]" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <section className="w-full rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_20px_80px_-40px_rgba(0,0,0,0.9)] backdrop-blur sm:p-10 lg:p-12">
          <p className="text-xs font-semibold tracking-widest text-white/60">
            WELCOME
          </p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            DOST - Marinduque Transcript Summarizer
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65 sm:text-base">
            Transform long recordings into clear and actionable insights. Upload
            audio or video, generate transcripts, and create professional
            summaries quickly with a workflow designed for efficient reporting.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold tracking-widest text-white/40">
                STEP 1
              </p>
              <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-white/90">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4 text-cyan-300"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 16V6" />
                  <path d="m8.5 9.5 3.5-3.5 3.5 3.5" />
                  <path d="M4 14.5v2A2.5 2.5 0 0 0 6.5 19h11A2.5 2.5 0 0 0 20 16.5v-2" />
                </svg>
                Upload File
              </p>
              <p className="mt-1 text-xs text-white/55">
                Add your meeting, interview, or activity recording.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold tracking-widest text-white/40">
                STEP 2
              </p>
              <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-white/90">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4 text-violet-300"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M6 10.5a6 6 0 0 0 12 0" />
                  <path d="M12 16.5V21" />
                  <path d="M8.5 21h7" />
                </svg>
                Transcribe
              </p>
              <p className="mt-1 text-xs text-white/55">
                Convert spoken content into readable text accurately.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold tracking-widest text-white/40">
                STEP 3
              </p>
              <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-white/90">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4 text-emerald-300"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 5.5h12" />
                  <path d="M6 10h12" />
                  <path d="M6 14.5h8" />
                  <path d="m15.5 18 2 2 4-4" />
                </svg>
                Build Summary
              </p>
              <p className="mt-1 text-xs text-white/55">
                Generate concise outputs ready for reporting and review.
              </p>
            </div>
          </div>

          <div className="mt-8">
            <Link
              to="/home"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-400 via-teal-400 to-green-400 px-5 py-3 text-sm font-semibold text-[#070A12] hover:from-blue-500 hover:to-green-500 hover:opacity-90 transition"
            >
              Click to direct to the Transcript Summarizer
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
};

export default LandingPage;
