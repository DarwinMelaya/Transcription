import cors from "cors";
import "dotenv/config";
import express from "express";
import transcriptionRoutes from "./routes/transcriptionRoutes.js";
import summaryRoutes from "./routes/summaryRoutes.js";

const app = express();
app.use(cors());
app.use(
  express.json({
    limit: "2mb",
  }),
);
const PORT = process.env.PORT || 3000;

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "Transcript server running" });
});


app.use(transcriptionRoutes);
app.use(summaryRoutes);

app.listen(PORT, () => {
  console.log(`Transcript server listening on http://localhost:${PORT}`);
});
