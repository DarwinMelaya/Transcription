import express from "express";
import puppeteer from "puppeteer";
import { buildSummaryHtml, summarizeTranscriptMarkdown, toSafePdfFilename } from "../services/summaryService.js";

const router = express.Router();

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
    const { summary, modelUsed } = await summarizeTranscriptMarkdown({
      directivesText: directives.join("\n"),
    });
    if (!summary) {
      return res.status(500).json({ error: "No summary returned from model." });
    }

    return res.json({ summary, modelUsed });
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

