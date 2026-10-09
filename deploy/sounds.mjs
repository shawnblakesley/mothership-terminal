import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { REGION, credentials, signedFetch } from "./aws.mjs";
import { KIT_FILES } from "../sounds.js";

const BUCKET = process.env.SOUNDS_BUCKET || "mothership-sounds-773206830395";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "sounds");

async function main() {
  const missing = KIT_FILES.filter((f) => !fs.statSync(path.join(DIR, f), { throwIfNoEntry: false })?.size);
  if (!missing.length) return console.log("  sounds: all here");
  const creds = credentials();
  fs.mkdirSync(DIR, { recursive: true });
  for (const file of missing) {
    const res = await signedFetch({ service: "s3", host: `${BUCKET}.s3.${REGION}.amazonaws.com`, uri: `/sounds/${encodeURIComponent(file)}` }, creds);
    if (!res.ok) throw new Error(`${file}: ${res.status} ${(await res.text()).match(/<Code>([^<]+)/)?.[1] || ""}`.trim());
    const tmp = path.join(DIR, `${file}.tmp`);
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(tmp, path.join(DIR, file));
    console.log(`  sounds: ${file}`);
  }
}

main().catch((err) => {
  console.error(`  sounds: ${err.message}`);
  process.exit(1);
});
