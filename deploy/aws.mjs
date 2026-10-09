import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export const REGION = "us-west-2";

export function credentials() {
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

export async function signedFetch({ service, host, method = "GET", uri = "/", headers: extra = {}, body = "" }, creds) {
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payload = sha256(body);
  const headers = { ...extra, host, "x-amz-date": amzDate, "x-amz-content-sha256": payload, ...(creds.token ? { "x-amz-security-token": creds.token } : {}) };
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonical = [method, uri, "", names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payload].join("\n");
  const scope = `${day}/${REGION}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = [service, "aws4_request"].reduce(hmac, hmac(hmac(`AWS4${creds.secret}`, day), REGION));
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  lower.authorization = `AWS4-HMAC-SHA256 Credential=${creds.id}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete lower.host;
  return fetch(`https://${host}${uri}`, { method, headers: lower, body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(60_000) });
}
