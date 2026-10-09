import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const hash = crypto.createHash("sha256");
for (const f of fs.readdirSync(dir).sort()) {
  const p = path.join(dir, f);
  if (fs.statSync(p).isFile()) hash.update(f).update(fs.readFileSync(p));
}
export const APP_VERSION = hash.digest("hex").slice(0, 12);
