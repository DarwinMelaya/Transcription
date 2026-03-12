import {
  GoogleGenAI,
  createPartFromUri,
  createUserContent,
} from "@google/genai";
import cors from "cors";
import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import puppeteer from "puppeteer";
import { marked } from "marked";

// Basic validation for API key
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set in .env");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const app = express();
app.use(cors());
app.use(
  express.json({
    limit: "2mb",
  }),
);
const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 3000;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// In-memory jobs (ephemeral). For production, persist in Redis/DB.
const chunkJobs = new Map(); // jobId -> { dir, mimeType, parts: string[], transcripts: string[], createdAt }
const CHUNK_SECONDS = 30 * 60;
const JOB_TTL_MS = 1000 * 60 * 60; // 1 hour

function safeUnlink(filePath) {
  fs.unlink(filePath, () => {});
}

function safeRmDir(dirPath) {
  fs.rm(dirPath, { recursive: true, force: true }, () => {});
}

function cleanupExpiredJobs() {
  const now = Date.now();
  for (const [jobId, job] of chunkJobs.entries()) {
    if (now - job.createdAt > JOB_TTL_MS) {
      safeRmDir(job.dir);
      chunkJobs.delete(jobId);
    }
  }
}

setInterval(cleanupExpiredJobs, 60_000).unref?.();

function probeDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata?.format?.duration;
      if (!Number.isFinite(duration)) return resolve(null);
      resolve(duration);
    });
  });
}

function segmentAudioToParts({ inputPath, outputDir }) {
  return new Promise((resolve, reject) => {
    const pattern = path.join(outputDir, "part-%03d.wav");

    ffmpeg(inputPath)
      .outputOptions([
        "-f segment",
        `-segment_time ${CHUNK_SECONDS}`,
        "-reset_timestamps 1",
        "-ac 1",
        "-ar 16000",
      ])
      .output(pattern)
      .on("end", () => {
        const files = fs
          .readdirSync(outputDir)
          .filter((f) => f.startsWith("part-") && f.endsWith(".wav"))
          .sort()
          .map((f) => path.join(outputDir, f));
        resolve(files);
      })
      .on("error", reject)
      .run();
  });
}

async function transcribeLocalAudioFile({ filePath, mimeType }) {
  // Upload audio file to Gemini
  const uploadedFile = await ai.files.upload({
    file: filePath,
    config: { mimeType },
  });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
    },
    contents: createUserContent([
      createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
      "You are a professional meeting transcription engine similar to Plaud AI. " +
        "Transcribe this audio as accurately and verbatim as possible. The audio may be in Tagalog, English, or a mix of both; " +
        "preserve Tagalog and English words and sentences exactly as spoken and do NOT translate or summarize. " +
        "Lightly clean the transcript only by fixing capitalization and punctuation and removing obvious filler interjections like “uh/um” or repeated stutters when they are not meaningful. " +
        "Keep sentence order and speaker wording faithful to the original audio. " +
        "Return only the cleaned transcript text, without any explanations or extra formatting.",
    ]),
  });

  const rawTranscript = response.text?.trim?.() ?? "";
  if (!rawTranscript) return "";

  return rawTranscript
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n");
}

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "Transcript server running" });
});

// POST /transcribe - multipart/form-data with field "audio"
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ error: "No audio file uploaded. Use field name 'audio'." });
  }

  const tempPath = req.file.path;
  const mimeType = req.file.mimetype || "audio/mpeg";

  try {
    const cleanedTranscript = await transcribeLocalAudioFile({
      filePath: tempPath,
      mimeType,
    });

    if (!cleanedTranscript) {
      return res
        .status(500)
        .json({ error: "No transcript returned from model." });
    }

    res.json({ transcript: cleanedTranscript });
  } catch (err) {
    console.error("Transcription error:", err);

    // Surface clearer errors to the client
    if (err.status === 503) {
      return res.status(503).json({
        error:
          "The transcription model is temporarily overloaded (503). Please wait a bit and try again.",
      });
    }

    res.status(500).json({
      error:
        "Failed to transcribe audio. Please try again or use a shorter clip.",
    });
  } finally {
    // Clean up temp file
    safeUnlink(tempPath);
  }
});

// POST /transcribe/start - multipart/form-data with field "audio"
// For >30 minutes audio, backend splits into 30-min chunks and returns a jobId.
app.post("/transcribe/start", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ error: "No audio file uploaded. Use field name 'audio'." });
  }

  const tempPath = req.file.path;
  const originalMime = req.file.mimetype || "audio/mpeg";

  try {
    const durationSeconds = await probeDurationSeconds(tempPath);

    const jobId = crypto.randomUUID();
    const jobDir = path.join("uploads", `job-${jobId}`);
    fs.mkdirSync(jobDir, { recursive: true });

    const parts = await segmentAudioToParts({
      inputPath: tempPath,
      outputDir: jobDir,
    });

    if (!parts.length) {
      safeRmDir(jobDir);
      return res.status(500).json({ error: "Failed to split audio into parts." });
    }

    // We convert to wav segments above.
    const mimeType = "audio/wav";

    chunkJobs.set(jobId, {
      dir: jobDir,
      mimeType,
      parts,
      transcripts: Array(parts.length).fill(""),
      createdAt: Date.now(),
      durationSeconds: durationSeconds ?? null,
      originalMime,
    });

    return res.json({
      jobId,
      totalParts: parts.length,
      chunkSeconds: CHUNK_SECONDS,
      durationSeconds: durationSeconds ?? null,
    });
  } catch (err) {
    console.error("Start chunked transcription error:", err);
    return res.status(500).json({
      error: "Failed to prepare chunked transcription. Please try again.",
    });
  } finally {
    safeUnlink(tempPath);
  }
});

// POST /transcribe/part - application/json body: { jobId, partIndex }
// Returns transcript for the given part. Call this repeatedly for Next.
app.post("/transcribe/part", async (req, res) => {
  const { jobId, partIndex } = req.body ?? {};
  const idx = Number(partIndex);

  if (typeof jobId !== "string" || !jobId.trim()) {
    return res.status(400).json({ error: "jobId is required." });
  }
  if (!Number.isInteger(idx) || idx < 0) {
    return res.status(400).json({ error: "partIndex must be a non-negative integer." });
  }

  const job = chunkJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found or expired." });
  }
  if (idx >= job.parts.length) {
    return res.status(400).json({ error: "partIndex out of range." });
  }

  try {
    if (!job.transcripts[idx]) {
      const t = await transcribeLocalAudioFile({
        filePath: job.parts[idx],
        mimeType: job.mimeType,
      });
      job.transcripts[idx] = t || "";
      chunkJobs.set(jobId, job);
    }

    return res.json({
      partIndex: idx,
      totalParts: job.parts.length,
      transcriptPart: job.transcripts[idx] ?? "",
      done: job.transcripts.filter(Boolean).length === job.parts.length,
    });
  } catch (err) {
    console.error("Chunk part transcription error:", err);

    if (err.status === 503) {
      return res.status(503).json({
        error:
          "The transcription model is temporarily overloaded (503). Please wait a bit and try again.",
      });
    }

    return res.status(500).json({
      error: "Failed to transcribe this part. Please try again.",
    });
  }
});

// POST /transcribe/finalize - application/json body: { jobId }
// Merges all transcript parts on the backend and cleans up job files.
app.post("/transcribe/finalize", async (req, res) => {
  const { jobId } = req.body ?? {};
  if (typeof jobId !== "string" || !jobId.trim()) {
    return res.status(400).json({ error: "jobId is required." });
  }

  const job = chunkJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found or expired." });
  }

  const missing = job.transcripts.findIndex((t) => !t);
  if (missing !== -1) {
    return res.status(400).json({
      error: `Not all parts are transcribed yet. Missing partIndex: ${missing}`,
    });
  }

  const merged = job.transcripts.filter(Boolean).join("\n\n");
  safeRmDir(job.dir);
  chunkJobs.delete(jobId);

  return res.json({ transcript: merged });
});

// POST /summarize - application/json body: { transcript, documentType, responseStyle, extraNotes, builtInPrompt }
app.post("/summarize", async (req, res) => {
  const {
    transcript,
    documentType = "Executive Meeting Minute",
    responseStyle = "Concise, professional",
    extraNotes = "",
    builtInPrompt = "Executive Minutes (Lite)",
  } = req.body ?? {};

  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "Transcript text is required." });
  }

  // Keep request size under control (Gemini can handle large text, but this prevents accidental huge payloads)
  if (text.length > 200_000) {
    return res.status(413).json({
      error: "Transcript is too long. Please use a shorter transcript.",
    });
  }

  const safeExtraNotes =
      typeof extraNotes === "string" ? extraNotes.trim() : "";
  const safeDocType =
      typeof documentType === "string" ? documentType.trim() : "Document";
  const safeStyle =
      typeof responseStyle === "string"
        ? responseStyle.trim()
        : "Concise, professional";
  const safeBuiltIn =
      typeof builtInPrompt === "string"
        ? builtInPrompt.trim()
        : "Executive Minutes (Lite)";

  const directives = [
    `DOCUMENT TYPE: ${safeDocType}`,
    `RESPONSE STYLE: ${safeStyle}`,
    `BUILT-IN PROMPT: ${safeBuiltIn}`,
    "",
    "SPECIAL DIRECTIVES (LITE):",
    "- Write the output in Markdown.",
    "- Do not invent details. If information is missing, state 'Not specified'.",
    "- Keep it structured and skimmable.",
    "- If the transcript is mixed Tagalog/English, keep names/terms as-is.",
  ];

  if (safeExtraNotes) {
    directives.push("", "EXTRA NOTES (USER):", safeExtraNotes);
  }

  directives.push(
    "",
    "OUTPUT FORMAT (Markdown):",
    "## Title",
    "## Date/Time",
    "## Attendees",
    "## Agenda",
    "## Executive Summary",
    "## Key Points",
    "## Decisions",
    "## Action Items",
    "## Risks / Blockers",
    "## Next Steps",
    "",
    "TRANSCRIPT:",
    text,
  );

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
      contents: createUserContent([directives.join("\n")]),
    });

    const summary = response.text?.trim?.() ?? "";
    if (!summary) {
      return res.status(500).json({ error: "No summary returned from model." });
    }

    return res.json({ summary });
  } catch (err) {
    console.error("Summarization error:", err);

    if (err.status === 503) {
      return res.status(503).json({
        error:
          "The summarization model is temporarily overloaded (503). Please wait a bit and try again.",
      });
    }

    return res.status(500).json({
      error: "Failed to summarize transcript. Please try again.",
    });
  }
});

function toSafePdfFilename(name) {
  const base = typeof name === "string" ? name.trim() : "";
  const cleaned = (base || "summary")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${cleaned || "summary"}.pdf`;
}

function buildSummaryHtml({ title = "Executive Summary", markdown = "" }) {
  const md = typeof markdown === "string" ? markdown : "";
  const safeTitle = typeof title === "string" && title.trim() ? title.trim() : "Executive Summary";

  // Render markdown into HTML (GitHub-ish). We keep it simple and style it ourselves.
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

    <div class="footer">
      <div><span class="dot"></span>Confidential summary</div>
      <div class="pageNumber"></div>
    </div>
  </body>
</html>`;
}

// POST /summary/pdf - application/json body: { summary, title? }
// Returns: application/pdf
app.post("/summary/pdf", async (req, res) => {
  const { summary, title } = req.body ?? {};
  const md = typeof summary === "string" ? summary.trim() : "";
  if (!md) {
    return res.status(400).json({ error: "Summary text is required." });
  }

  try {
    const html = buildSummaryHtml({
      title: typeof title === "string" ? title : "Executive Summary",
      markdown: md,
    });

    const browser = await puppeteer.launch({
      // These flags help in restricted environments; safe on Windows too.
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdfData = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: false,
        margin: {
          top: "18mm",
          right: "16mm",
          bottom: "18mm",
          left: "16mm",
        },
      });

      const pdfBuffer = Buffer.from(pdfData);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${toSafePdfFilename(title)}"`,
      );
      res.setHeader("Content-Length", String(pdfBuffer.length));
      return res.status(200).send(pdfBuffer);
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error("PDF export error:", err);
    return res.status(500).json({
      error: "Failed to generate PDF. Please try again.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Transcript server listening on http://localhost:${PORT}`);
});
