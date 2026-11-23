import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RETRYABLE_WIN_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

export function sha256Text(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Atomically writes a file by writing to a sibling temporary file, fsyncing,
 * and renaming into place with short Windows EPERM/EBUSY retries.
 */
export function atomicWriteFile(targetPath: string, content: string): void {
  const resolved = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmpPath = `${resolved}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;

  const fd = fs.openSync(tmpPath, "w", 0o600);
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.renameSync(tmpPath, resolved);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      lastError = error;
      if (!code || !RETRYABLE_WIN_CODES.has(code) || attempt === 4) {
        break;
      }
      sleepSync(25 * (attempt + 1));
    }
  }

  try {
    fs.unlinkSync(tmpPath);
  } catch {
    // Best-effort cleanup
  }
  throw lastError;
}
