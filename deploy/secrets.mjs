import fs from "fs";
import path from "path";
import { REGION, credentials, signedFetch } from "./aws.mjs";

const PARAMS = { OPENROUTER_API_KEY: "/mothership/openrouter-api-key", DISCORD_BOT_TOKEN: "/mothership/discord-bot-token" };

async function ssm(target, payload, creds) {
  const res = await signedFetch({ service: "ssm", host: `ssm.${REGION}.amazonaws.com`, method: "POST", headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AmazonSSM.${target}` }, body: JSON.stringify(payload) }, creds);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${target}: ${res.status} ${data.__type || ""} ${data.message || data.Message || ""}`.trim()), { type: data.__type || "" });
  return data;
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: node deploy/secrets.mjs <env file>");
  const creds = credentials();
  const lines = [];
  for (const [env, name] of Object.entries(PARAMS)) {
    try {
      const { Parameter } = await ssm("GetParameter", { Name: name, WithDecryption: true }, creds);
      const value = String(Parameter?.Value ?? "").trim();
      if (!/^[\x21-\x7e]+$/.test(value)) throw new Error(`${name} is empty or has spaces or odd characters`);
      lines.push(`${env}=${value}`);
      console.log(`  secret ${env}: set from ${name}`);
    } catch (err) {
      if (!String(err.type).endsWith("ParameterNotFound")) throw err;
      console.log(`  secret ${env}: ${name} not found, left unset`);
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  const tmp = `${out}.tmp`;
  fs.writeFileSync(tmp, lines.map((l) => `${l}\n`).join(""), { mode: 0o600 });
  fs.renameSync(tmp, out);
}

main().catch((err) => {
  console.error(`  secrets: ${err.message}`);
  process.exit(1);
});
