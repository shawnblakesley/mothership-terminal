// A fingerprint of the browser code. Pages compare it on every (re)connect and
// reload when it changes, so a terminal left open across a deploy picks up the
// new code instead of running the old script against the new server.
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
