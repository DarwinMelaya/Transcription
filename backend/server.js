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

app.listen(PORT, () => {
  console.log(`Transcript server listening on http://localhost:${PORT}`);
});
