import cors from "cors";
import "dotenv/config";
import express from "express";
import transcriptionRoutes from "./routes/transcriptionRoutes.js";
import summaryRoutes from "./routes/summaryRoutes.js";

const app = express();
app.use(cors());
app.use(
  express.json({
    // Summaries can include large transcripts; keep room for long bodies.
    limit: process.env.JSON_BODY_LIMIT || "12mb",
  }),
);
const BASE_PORT = Number(process.env.PORT || 3000);
const PORT_HUNT_LIMIT = Number(process.env.PORT_HUNT_LIMIT || 10);

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "Transcript server running" });
});


app.use(transcriptionRoutes);
app.use(summaryRoutes);

function listenWithPortHunt(startPort) {
  const maxPort = startPort + Math.max(0, PORT_HUNT_LIMIT);

  const tryListen = (port) => {
    const server = app.listen(port, () => {
      console.log(`Transcript server listening on http://localhost:${port}`);
    });

    server.on("error", (err) => {
      if (err?.code === "EADDRINUSE" && port < maxPort) {
        console.warn(
          `Port ${port} is already in use; trying ${port + 1}...`,
        );
        tryListen(port + 1);
        return;
      }
      console.error("Server failed to start:", err);
      process.exitCode = 1;
    });
  };

  tryListen(startPort);
}

listenWithPortHunt(Number.isFinite(BASE_PORT) ? BASE_PORT : 3000);
