import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { ai } from "../config/aiClient.js";
import { CHUNK_SECONDS } from "../jobs/chunkJobsStore.js";

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

export function probeDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata?.format?.duration;
      if (!Number.isFinite(duration)) return resolve(null);
      resolve(duration);
    });
  });
}

export function segmentAudioToParts({ inputPath, outputDir }) {
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

export async function transcribeLocalAudioFile({ filePath, mimeType }) {
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
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              fileUri: uploadedFile.uri,
              mimeType: uploadedFile.mimeType,
            },
          },
          {
            text:
              "You are a professional meeting transcription engine similar to Plaud AI. " +
              "Transcribe this audio as accurately and verbatim as possible. The audio may be in Tagalog, English, or a mix of both; " +
              "preserve Tagalog and English words and sentences exactly as spoken and do NOT translate or summarize. " +
              "Lightly clean the transcript only by fixing capitalization and punctuation and removing obvious filler interjections like “uh/um” or repeated stutters when they are not meaningful. " +
              "Keep sentence order and speaker wording faithful to the original audio. " +
              "Return only the cleaned transcript text, without any explanations or extra formatting.",
          },
        ],
      },
    ],
  });

  const rawTranscript = response.text?.trim?.() ?? "";
  if (!rawTranscript) return "";

  return rawTranscript
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n");
}

