import fs from "fs";
import path from "path";
import { REGION, credentials, signedFetch } from "./aws.mjs";

// The character creation roll tables (made by scripts/extract-psg-tables.mjs) aren't in git: they're kept under rules/
// in the private bucket (the sound pack's) and fetched into DATA_DIR/tables on each deploy.
const BUCKET = process.env.SOUNDS_BUCKET || "mothership-sounds-773206830395";
const OUT = path.join(process.env.DATA_DIR || "/var/lib/mothership", "tables", "psg-tables.json");

async function main() {
  const res = await signedFetch({ service: "s3", host: `${BUCKET}.s3.${REGION}.amazonaws.com`, uri: "/rules/psg-tables.json" }, credentials());
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).match(/<Code>([^<]+)/)?.[1] || ""}`.trim());
  const body = Buffer.from(await res.arrayBuffer());
  JSON.parse(body);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(`${OUT}.tmp`, body);
  fs.renameSync(`${OUT}.tmp`, OUT);
  console.log(`  tables: ${OUT}`);
}

main().catch((err) => {
  console.error(`  tables: ${err.message}`);
  process.exit(1);
});
