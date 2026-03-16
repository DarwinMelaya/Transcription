import { GoogleGenAI } from "@google/genai";

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set in .env");
  process.exit(1);
}

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

