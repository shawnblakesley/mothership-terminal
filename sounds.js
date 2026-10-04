// The Warden's sound library: audio files uploaded to a session (monster
// growls, attacks, ambience...) that the Warden plays on the players' screens.
// Files live on disk under DATA_DIR/sounds/<CODE>/; the list is in the session.
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const MAX_SOUND_BYTES = Number(process.env.MAX_SOUND_MB || 10) * 1024 * 1024;
export const MAX_SESSION_SOUND_BYTES = Number(process.env.MAX_SESSION_SOUNDS_MB || 100) * 1024 * 1024;
export const MAX_SOUNDS = 80;

let root = null;
export function setSoundsDir(dir) {
  root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
}

const dirFor = (code) => path.join(root, code.replace(/[^A-Z0-9]/g, ""));
export const soundPath = (code, sound) => path.join(dirFor(code), `${sound.id}.${sound.ext}`);

// What kind of audio file is this? Checked from its first bytes (not its name),
// so only real audio is stored and served.
export function sniff(buf) {
  const ascii = (a, b) => buf.subarray(a, b).toString("latin1");
  if (buf.length < 12) return null;
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { ext: "wav", type: "audio/wav" };
  if (ascii(0, 4) === "OggS") return { ext: "ogg", type: "audio/ogg" };
  if (ascii(0, 4) === "fLaC") return { ext: "flac", type: "audio/flac" };
  if (ascii(4, 8) === "ftyp") return { ext: "m4a", type: "audio/mp4" };
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return { ext: "webm", type: "audio/webm" };
  if (ascii(0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: "mp3", type: "audio/mpeg" };
  return null;
}

// Store an uploaded file. Returns the sound's record, or throws with a message for the Warden.
export function saveSound(code, existing, buf, name, seconds) {
  if (!buf?.length) throw new Error("That file is empty.");
  if (buf.length > MAX_SOUND_BYTES) throw new Error(`Sounds can be up to ${MAX_SOUND_BYTES / 1048576} MB each.`);
  const kind = sniff(buf);
  if (!kind) throw new Error("That isn't an audio file this can play (use MP3, WAV, OGG, M4A, FLAC or WebM).");
  if (existing.length >= MAX_SOUNDS) throw new Error(`A session can hold up to ${MAX_SOUNDS} sounds. Delete some first.`);
  const used = existing.reduce((n, s) => n + (s.bytes || 0), 0);
  if (used + buf.length > MAX_SESSION_SOUND_BYTES) throw new Error(`This session's sounds are limited to ${MAX_SESSION_SOUND_BYTES / 1048576} MB in total. Delete some first.`);
  const sound = {
    id: crypto.randomBytes(6).toString("hex"),
    name: cleanName(name) || "Sound",
    ext: kind.ext,
    type: kind.type,
    bytes: buf.length,
    seconds: Math.max(0, Math.min(3600, Number(seconds) || 0)), // as measured by the console (0 = unknown)
    volume: 0.8,
  };
  fs.mkdirSync(dirFor(code), { recursive: true });
  fs.writeFileSync(soundPath(code, sound), buf);
  return sound;
}

export function deleteSoundFile(code, sound) {
  fs.rmSync(soundPath(code, sound), { force: true });
}

export function deleteSessionSounds(code) {
  if (root) fs.rmSync(dirFor(code), { recursive: true, force: true });
}

export const cleanName = (n) => String(n || "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
