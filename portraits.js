import crypto from "crypto";
import fs from "fs";
import path from "path";

export const MAX_PORTRAIT_BYTES = 300 * 1024;
const MAX_PORTRAITS = 200;

let root = null;
export function setPortraitsDir(dir) {
  root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
}

const dirFor = (code) => path.join(root, code.replace(/[^A-Z0-9]/g, ""));
const FILE = /^[a-f0-9]{12}\.(png|jpg|webp|gif)$/;
export const portraitPath = (code, file) => (FILE.test(file) ? path.join(dirFor(code), file) : null);
export const portraitType = (file) => ({ png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" })[file.split(".").pop()];

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  return null;
}

export function savePortrait(code, buf) {
  if (!buf?.length) throw new Error("That file is empty.");
  if (buf.length > MAX_PORTRAIT_BYTES) throw new Error("That picture is too big.");
  const ext = sniff(buf);
  if (!ext) throw new Error("That isn't a picture this can show (use PNG, JPEG, WebP or GIF).");
  fs.mkdirSync(dirFor(code), { recursive: true });
  if (fs.readdirSync(dirFor(code)).length >= MAX_PORTRAITS) throw new Error(`A session can hold up to ${MAX_PORTRAITS} portraits.`);
  const file = `${crypto.randomBytes(6).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(dirFor(code), file), buf);
  return file;
}

export function deleteSessionPortraits(code) {
  if (root) fs.rmSync(dirFor(code), { recursive: true, force: true });
}
