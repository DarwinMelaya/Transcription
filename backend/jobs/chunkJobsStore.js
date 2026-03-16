import { safeRmDir } from "../utils/fileUtils.js";

export const CHUNK_SECONDS = 30 * 60;
export const JOB_TTL_MS = 1000 * 60 * 60; // 1 hour

export const chunkJobs = new Map();

function cleanupExpiredJobs() {
  const now = Date.now();
  for (const [jobId, job] of chunkJobs.entries()) {
    if (now - job.createdAt > JOB_TTL_MS) {
      if (job.dir) {
        safeRmDir(job.dir);
      }
      chunkJobs.delete(jobId);
    }
  }
}

setInterval(cleanupExpiredJobs, 60_000).unref?.();


