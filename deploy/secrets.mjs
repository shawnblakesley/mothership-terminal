// Fetches the app's secrets from SSM Parameter Store into a root-only env file
// that the systemd unit loads (EnvironmentFile). Run by update.sh as root:
//
//   node deploy/secrets.mjs /etc/mothership/secrets.env
//
// No AWS CLI or SDK on the server: this signs the request itself (SigV4) with
// the credentials the Systems Manager agent keeps in /root/.aws/credentials
// (role mothership-server-ssm, which may read only these parameters; see
// MothershipStack in monster-land). Values are never printed.
// A parameter that doesn't exist is left out (its feature stays off).
// Exits 1 on any other failure without touching the file, so a deploy keeps
// the secrets it had.
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const REGION = "us-west-2";
// env var -> parameter name
const PARAMS = { OPENROUTER_API_KEY: "/mothership/openrouter-api-key" };

function credentials() {
  const e = process.env;
  if (e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY) {
    return { id: e.AWS_ACCESS_KEY_ID, secret: e.AWS_SECRET_ACCESS_KEY, token: e.AWS_SESSION_TOKEN };
  }
  const file = e.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), ".aws", "credentials");
  const profile = e.AWS_PROFILE || "default";
  let section = "", out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const head = line.match(/^\s*\[([^\]]+)\]/);
    if (head) { section = head[1].trim(); continue; }
    const kv = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (kv && section === profile) out[kv[1].toLowerCase()] = kv[2];
  }
  if (!out.aws_access_key_id) throw new Error(`no "${profile}" credentials in ${file}`);
  return { id: out.aws_access_key_id, secret: out.aws_secret_access_key, token: out.aws_session_token };
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();

// One SSM API call, SigV4-signed.
async function ssm(target, payload, creds) {
  const host = `ssm.${REGION}.amazonaws.com`;
  const body = JSON.stringify(payload);
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers = {
    "content-type": "application/x-amz-json-1.1",
    host,
    "x-amz-date": amzDate,
    "x-amz-target": `AmazonSSM.${target}`,
    ...(creds.token ? { "x-amz-security-token": creds.token } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const canonical = ["POST", "/", "", canonicalHeaders, names.join(";"), sha256(body)].join("\n");
  const scope = `${day}/${REGION}/ssm/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = ["ssm", "aws4_request"].reduce(hmac, hmac(hmac(`AWS4${creds.secret}`, day), REGION));
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.id}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete headers.host;
  const res = await fetch(`https://${host}/`, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
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
