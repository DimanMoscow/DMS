import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function canonicalSource(value, label = "Apps Script source") {
  const source = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  const normalized = source.replace(/\r\n/g, "\n");
  if (normalized.includes("\r")) {
    throw new Error(`${label}: lone carriage return is not allowed`);
  }
  return normalized;
}

export function readCanonicalSource(filePath) {
  return canonicalSource(fs.readFileSync(filePath), filePath);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sourceTreeSha256(directory, fileNames) {
  const hash = crypto.createHash("sha256");
  for (const fileName of [...fileNames].sort()) {
    hash.update(fileName);
    hash.update("\0");
    hash.update(readCanonicalSource(path.join(directory, fileName)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
