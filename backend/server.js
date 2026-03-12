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
    // Upload audio file to Gemini
    const uploadedFile = await ai.files.upload({
      file: tempPath,
      config: { mimeType },
    });

    // Ask Gemini to transcribe and lightly clean the text with deterministic settings
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

    if (!rawTranscript) {
      return res
        .status(500)
        .json({ error: "No transcript returned from model." });
    }

    // Basic cleanup to make the text look neat
    const cleanedTranscript = rawTranscript
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n\n");

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
    fs.unlink(tempPath, () => {});
  }
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
