# Kitten TTS 2 sidecar for tts.js: reads {"id", "text", "voice"} JSON lines on stdin and answers
# {"id", "wav": base64} or {"id", "error"} on stdout; prints {"ready": true} once the model is loaded.
# Needs: pip install kittenml soundfile   (https://github.com/KittenML/KittenTTS)
import base64
import io
import json
import os
import sys

out = sys.stdout
sys.stdout = sys.stderr  # library logs and progress bars must not reach the JSON channel

import soundfile as sf
from kittenml import KittenTTS

weights = os.environ.get("KITTEN_WEIGHTS")  # "emb4" is the smaller (506 MiB) download
model = KittenTTS(os.environ.get("KITTEN_MODEL", "KittenML/kitten-tts-2"), **({"weights": weights} if weights else {}))


def send(msg):
    out.write(json.dumps(msg) + "\n")
    out.flush()


send({"ready": True})
for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    try:
        text = req["text"]
        expressive = any(c in text for c in "[<(")
        audio = model.generate(text, voice=req.get("voice") or "Bruno", **({"preset": "expressive"} if expressive else {}))
        buf = io.BytesIO()
        sf.write(buf, audio, model.sample_rate, format="WAV", subtype="PCM_16")
        send({"id": req.get("id"), "wav": base64.b64encode(buf.getvalue()).decode("ascii")})
    except Exception as err:  # one bad line must not stop the voice
        send({"id": req.get("id"), "error": str(err)[:300]})
