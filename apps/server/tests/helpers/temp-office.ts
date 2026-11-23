import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SOURCE_COMPANY_ROOT = path.resolve(__dirname, "../../../../company");

export function createTempOfficeDirs(): {
  baseDir: string;
  companyRoot: string;
  dataDir: string;
  cleanup: () => void;
} {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "vo-test-"));
  const companyRoot = path.join(baseDir, "company");
  const dataDir = path.join(baseDir, "data");
  fs.cpSync(SOURCE_COMPANY_ROOT, companyRoot, {
    recursive: true,
    filter: (src) => !/(^|[\\/])\.git([\\/]|$)/.test(src),
  });
  fs.mkdirSync(dataDir, { recursive: true });

  return {
    baseDir,
    companyRoot,
    dataDir,
    cleanup: () => {
      fs.rmSync(baseDir, { recursive: true, force: true });
    },
  };
}
