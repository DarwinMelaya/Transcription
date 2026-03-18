import { marked } from "marked";
import { ai } from "../config/aiClient.js";
import { modelsFromEnv, runWithModelFallback } from "../utils/modelFallback.js";

const SUMMARIZE_MODELS = modelsFromEnv(process.env.GEMINI_SUMMARIZE_MODELS, [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
]);

export async function summarizeTranscriptMarkdown({ directivesText }) {
  const { result: response, modelUsed } = await runWithModelFallback({
    models: SUMMARIZE_MODELS,
    run: (model) =>
      ai.models.generateContent({
        model,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
        contents: [{ role: "user", parts: [{ text: directivesText }] }],
      }),
  });

  const summary = response.text?.trim?.() ?? "";
  return { summary, modelUsed };
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function splitIntoChunks(text, { maxChars = 24_000, overlapChars = 600 } = {}) {
  const src = typeof text === "string" ? text : "";
  if (!src.trim()) return [];

  const maxC = clampInt(maxChars, 4_000, 120_000);
  const overlap = clampInt(overlapChars, 0, Math.floor(maxC / 3));

  const chunks = [];
  let start = 0;
  while (start < src.length) {
    let end = Math.min(src.length, start + maxC);

    // Prefer cutting on paragraph boundary near the end.
    const windowStart = Math.max(start, end - 1600);
    const slice = src.slice(windowStart, end);
    const boundaryRel = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
    if (boundaryRel > 0) {
      end = windowStart + boundaryRel;
    }

    const chunk = src.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= src.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

async function summarizeChunkNotes({ chunkText, chunkIndex, totalChunks }) {
  const directives = [
    "TASK: Create compact notes from this transcript chunk.",
    "",
    "RULES:",
    "- Output must be Markdown.",
    "- Only extract what is present; never invent details.",
    "- Keep it dense: bullets over paragraphs.",
    "- Preserve names/terms exactly (Tagalog/English mixed is ok).",
    "- Prefer concrete facts: decisions, action items, owners, dates, numbers, risks.",
    "- If something is unclear, write 'Not specified'.",
    "",
    `CHUNK: ${chunkIndex + 1} / ${totalChunks}`,
    "",
    "OUTPUT FORMAT (Markdown):",
    "### Key facts",
    "- ...",
    "",
    "### Decisions",
    "- ...",
    "",
    "### Action items (with owner if mentioned)",
    "- ...",
    "",
    "### Risks / blockers",
    "- ...",
    "",
    "TRANSCRIPT CHUNK:",
    chunkText,
  ].join("\n");

  const { result: response, modelUsed } = await runWithModelFallback({
    models: SUMMARIZE_MODELS,
    run: (model) =>
      ai.models.generateContent({
        model,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 900,
        },
        contents: [{ role: "user", parts: [{ text: directives }] }],
      }),
  });

  return { notes: response.text?.trim?.() ?? "", modelUsed };
}

export async function condenseTranscriptForSummary({
  transcript,
  maxCharsPerChunk = 24_000,
  overlapChars = 600,
  maxTotalChunks = 80,
}) {
  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (!text) return { condensed: "", chunks: 0, modelUsed: null };

  const chunks = splitIntoChunks(text, {
    maxChars: maxCharsPerChunk,
    overlapChars,
  }).slice(0, clampInt(maxTotalChunks, 1, 200));

  let lastModelUsed = null;
  const notesBlocks = [];

  for (let i = 0; i < chunks.length; i += 1) {
    // sequential on purpose (keeps provider happy + easier backpressure)
    const { notes, modelUsed } = await summarizeChunkNotes({
      chunkText: chunks[i],
      chunkIndex: i,
      totalChunks: chunks.length,
    });
    lastModelUsed = modelUsed || lastModelUsed;
    notesBlocks.push(`## Chunk ${i + 1}\n\n${notes || "*No notes returned.*"}`);
  }

  return {
    condensed: notesBlocks.join("\n\n"),
    chunks: chunks.length,
    modelUsed: lastModelUsed,
  };
}

/**
 * Generate compact notes from an entire transcript.
 * - For very long transcripts, returns condensed chunk notes.
 * - For short transcripts, summarizes as a single chunk.
 */
export async function summarizeTranscriptNotes({ transcript }) {
  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (!text) return { notes: "", modelUsed: null, condensed: false, condensedChunks: 0 };

  // Keep a similar threshold as routes use to avoid model limits.
  const SHOULD_CONDENSE_OVER_CHARS = 180_000;
  if (text.length > SHOULD_CONDENSE_OVER_CHARS) {
    const { condensed, chunks, modelUsed } = await condenseTranscriptForSummary({
      transcript: text,
    });
    return {
      notes: condensed || "",
      modelUsed: modelUsed || null,
      condensed: true,
      condensedChunks: typeof chunks === "number" ? chunks : 0,
    };
  }

  // Short transcript: treat as a single chunk of notes.
  const { notes, modelUsed } = await summarizeChunkNotes({
    chunkText: text,
    chunkIndex: 0,
    totalChunks: 1,
  });
  return {
    notes: notes || "",
    modelUsed: modelUsed || null,
    condensed: false,
    condensedChunks: 0,
  };
}

export function toSafePdfFilename(name) {
  const base = typeof name === "string" ? name.trim() : "";
  const cleaned = (base || "summary")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${cleaned || "summary"}.pdf`;
}

export function buildSummaryHtml({
  title = "Executive Summary",
  markdown = "",
}) {
  const md = typeof markdown === "string" ? markdown : "";
  const safeTitle =
    typeof title === "string" && title.trim()
      ? title.trim()
      : "Executive Summary";

  const contentHtml = marked.parse(md, {
    gfm: true,
    breaks: true,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
      :root{
        --ink:#0b1220;
        --muted:#52607a;
        --line:#e6e9f2;
        --accent:#0ea5e9;
        --accent2:#22c55e;
        --paper:#ffffff;
        --chip:#f3f6ff;
      }
      *{ box-sizing:border-box; }
      html,body{ height:100%; }
      body{
        margin:0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
        color:var(--ink);
        background:var(--paper);
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .header{
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap:18px;
        padding: 0 0 10mm 0;
        border-bottom:1px solid var(--line);
        margin-bottom: 8mm;
      }
      .brand{
        display:flex;
        flex-direction:column;
        gap:6px;
      }
      .kicker{
        letter-spacing: .18em;
        font-weight: 700;
        font-size: 10px;
        color: var(--muted);
        text-transform: uppercase;
      }
      .title{
        font-size: 22px;
        line-height: 1.2;
        margin:0;
        font-weight: 800;
      }
      .stamp{
        text-align:right;
        font-size: 11px;
        color: var(--muted);
        white-space: nowrap;
      }
      .stamp .pill{
        display:inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(14,165,233,.14), rgba(34,197,94,.12));
        border: 1px solid rgba(14,165,233,.18);
        color: var(--ink);
        font-weight: 700;
      }
      .content{
        font-size: 12.3px;
        line-height: 1.62;
      }
      .content h1, .content h2, .content h3{
        page-break-after: avoid;
        margin: 0 0 6px 0;
      }
      .content h1{ font-size: 18px; margin-top: 14px; }
      .content h2{
        font-size: 14px;
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px solid var(--line);
      }
      .content h3{ font-size: 12.8px; margin-top: 12px; }
      .content p{ margin: 0 0 10px 0; }
      .content ul, .content ol{ margin: 0 0 10px 18px; padding: 0; }
      .content li{ margin: 4px 0; }
      .content blockquote{
        margin: 12px 0;
        padding: 10px 12px;
        border-left: 3px solid rgba(14,165,233,.45);
        background: #f7faff;
        color: #1f2a44;
        border-radius: 8px;
      }
      .content code{
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        background: #f4f6fb;
        border: 1px solid #e7ebf5;
        border-radius: 6px;
        padding: 1px 6px;
        font-size: 11px;
      }
      .content pre{
        background: #0b1220;
        color: #e9eefc;
        border-radius: 12px;
        padding: 12px 14px;
        overflow: hidden;
        border: 1px solid rgba(11,18,32,.12);
      }
      .content pre code{
        background: transparent;
        border: 0;
        padding: 0;
        color: inherit;
      }
      .content table{
        width: 100%;
        border-collapse: collapse;
        margin: 10px 0 14px 0;
        font-size: 11.8px;
      }
      .content th, .content td{
        border: 1px solid var(--line);
        padding: 8px 10px;
        vertical-align: top;
      }
      .content th{
        background: #f6f8ff;
        text-align: left;
        font-weight: 800;
      }
      .footer{
        position: fixed;
        bottom: 10mm;
        left: 16mm;
        right: 16mm;
        display:flex;
        justify-content:space-between;
        font-size: 10px;
        color: var(--muted);
        border-top: 1px solid var(--line);
        padding-top: 6px;
      }
      .footer .dot{
        display:inline-block;
        width:6px;height:6px;
        border-radius: 999px;
        background: var(--accent);
        margin-right:8px;
        transform: translateY(-1px);
        opacity:.7;
      }
      a{ color: var(--accent); text-decoration: none; }
      hr{ border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="brand">
        <div class="kicker">Transcript • Summary</div>
        <h1 class="title">${safeTitle}</h1>
      </div>
      <div class="stamp">
        <div class="pill">Generated</div>
      </div>
    </div>

    <main class="content">
      ${contentHtml}
    </main>

    
  </body>
</html>`;
}
