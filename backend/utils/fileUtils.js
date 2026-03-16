import fs from "node:fs";

export function safeUnlink(filePath) {
  fs.unlink(filePath, () => {});
}

export function safeRmDir(dirPath) {
  fs.rm(dirPath, { recursive: true, force: true }, () => {});
}

