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

    // Ask Gemini to transcribe and lightly clean the text
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: createUserContent([
        createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
        "Transcribe this audio as accurately as possible. The audio may be in Tagalog, English, or a mix of both; preserve Tagalog words and sentences exactly as spoken and do not translate. Then lightly clean the transcript: fix capitalization and punctuation, remove obvious filler sounds like “uh/um” when they are not meaningful, and merge broken sentences so it reads like a clean meeting transcript. Return only the cleaned transcript text.",
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

app.listen(PORT, () => {
  console.log(`Transcript server listening on http://localhost:${PORT}`);
});
