import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { probeDurationSeconds, segmentAudioToParts, transcribeLocalAudioFile } from "../services/transcriptionService.js";
import { chunkJobs, CHUNK_SECONDS } from "../jobs/chunkJobsStore.js";
import { safeUnlink, safeRmDir } from "../utils/fileUtils.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// POST /transcribe - multipart/form-data with field "audio"
router.post("/transcribe", upload.single("audio"), async (req, res) => {
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
    safeUnlink(tempPath);
  }
});

// POST /transcribe/start - multipart/form-data with field "audio"
router.post("/transcribe/start", upload.single("audio"), async (req, res) => {
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
router.post("/transcribe/part", async (req, res) => {
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
router.post("/transcribe/finalize", async (req, res) => {
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

export default router;

