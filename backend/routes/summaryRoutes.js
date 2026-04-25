import express from "express";
import puppeteer from "puppeteer";
import {
  buildSummaryHtml,
  condenseTranscriptForSummary,
  summarizeTranscriptMarkdown,
  summarizeTranscriptNotes,
  toSafePdfFilename,
} from "../services/summaryService.js";

const router = express.Router();

function extractRetryAfterSeconds(err) {
  // Gemini errors often include "Please retry in 8.53s." in the message.
  const msg = String(err?.message || "");
  const m = msg.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  }

  // Some errors also include google.rpc.RetryInfo with retryDelay like "8s".
  const details = err?.details || err?.error?.details;
  if (Array.isArray(details)) {
    const retryInfo = details.find((d) => typeof d?.retryDelay === "string");
    const s = String(retryInfo?.retryDelay || "");
    const ms = s.match(/^(\d+)(?:\.(\d+))?s$/i);
    if (ms) {
      const whole = Number(ms[1]);
      if (Number.isFinite(whole) && whole > 0) return whole;
    }
  }

  return null;
}

// POST /summarize - application/json body: { transcript, documentType, responseStyle, extraNotes, builtInPrompt }
router.post("/summarize", async (req, res) => {
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

  // Keep a hard stop far above normal usage to avoid memory abuse.
  // Express JSON body limit (default 12mb) is the primary protection.
  if (text.length > 6_000_000) {
    return res.status(413).json({
      error:
        "Transcript is too large for a single request. Please split it or increase JSON_BODY_LIMIT on the server.",
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

  let transcriptLabel = "TRANSCRIPT:";
  let transcriptTextForModel = text;

  const narrativeRequested =
    /narrative\s*report/i.test(safeBuiltIn) ||
    /narrative\s*report/i.test(safeDocType) ||
    /forum\s*narrative/i.test(safeDocType);

  // If it's long, condense it first (chunk notes) so we don't hit model limits.
  // This also fulfills "use a shorter transcript" automatically.
  const SHOULD_CONDENSE_OVER_CHARS = 180_000;
  const condensedMeta = { condensed: false, condensedChunks: 0 };
  try {
    if (text.length > SHOULD_CONDENSE_OVER_CHARS) {
      const { condensed, chunks } = await condenseTranscriptForSummary({
        transcript: text,
      });
      if (condensed && condensed.trim()) {
        transcriptLabel = "CONDENSED NOTES FROM FULL TRANSCRIPT (auto-generated):";
        transcriptTextForModel = condensed.trim();
        condensedMeta.condensed = true;
        condensedMeta.condensedChunks = chunks;
      }
    }
  } catch (err) {
    // If condensing fails, fall back to trying direct summarization.
    console.warn("Condense step failed; falling back to direct summarization:", err);
  }

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
    ...(narrativeRequested
      ? [
          "OUTPUT FORMAT (Markdown):",
          "## I. INTRODUCTION",
          "## II. PRELIMINARIES",
          "## III. FORUM DETAILS",
          "### A. Participants",
          "### B. Resource Speakers",
          "### C. Topic Discussed",
          "### D. Forum Methodologies",
          "## IV. CONCLUSION",
        ]
      : [
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
        ]),
    "",
    transcriptLabel,
    transcriptTextForModel,
  );

  try {
    const { summary, modelUsed } = await summarizeTranscriptMarkdown({
      directivesText: directives.join("\n"),
    });
    if (!summary) {
      return res.status(500).json({ error: "No summary returned from model." });
    }

    return res.json({ summary, modelUsed, ...condensedMeta });
  } catch (err) {
    if (err.status === 429) {
      console.warn("Summarization rate-limited (429).");
      const retryAfterSeconds = extractRetryAfterSeconds(err);
      return res.status(429).json({
        error:
          "Summarization is rate-limited or out of quota (429). Please wait a bit and try again, or check your Gemini API plan/billing.",
        retryAfterSeconds,
      });
    }

    if (err.status === 503) {
      console.warn("Summarization overloaded (503).");
      return res.status(503).json({
        error:
          "The summarization model is temporarily overloaded (503). Please wait a bit and try again.",
      });
    }

    console.error("Summarization error:", err);
    return res.status(500).json({
      error: "Failed to summarize transcript. Please try again.",
    });
  }
});

// POST /notes - application/json body: { transcript }
router.post("/notes", async (req, res) => {
  const { transcript } = req.body ?? {};
  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "Transcript text is required." });
  }

  // Keep a hard stop far above normal usage to avoid memory abuse.
  if (text.length > 6_000_000) {
    return res.status(413).json({
      error:
        "Transcript is too large for a single request. Please split it or increase JSON_BODY_LIMIT on the server.",
    });
  }

  try {
    const { notes, modelUsed, condensed, condensedChunks } =
      await summarizeTranscriptNotes({ transcript: text });
    if (!notes) {
      return res.status(500).json({ error: "No notes returned from model." });
    }
    return res.json({
      notes,
      modelUsed: modelUsed || null,
      condensed: Boolean(condensed),
      condensedChunks: typeof condensedChunks === "number" ? condensedChunks : 0,
    });
  } catch (err) {
    if (err.status === 429) {
      console.warn("Notes rate-limited (429).");
      const retryAfterSeconds = extractRetryAfterSeconds(err);
      return res.status(429).json({
        error:
          "Notes generation is rate-limited or out of quota (429). Please wait a bit and try again, or check your Gemini API plan/billing.",
        retryAfterSeconds,
      });
    }
    if (err.status === 503) {
      console.warn("Notes overloaded (503).");
      return res.status(503).json({
        error:
          "The notes summarization model is temporarily overloaded (503). Please wait a bit and try again.",
      });
    }
    console.error("Notes summarization error:", err);
    return res.status(500).json({
      error: "Failed to generate notes. Please try again.",
    });
  }
});

// POST /summary/pdf - application/json body: { summary, title? }
router.post("/summary/pdf", async (req, res) => {
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

export default router;

