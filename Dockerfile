# Mothership terminal: one container serving every session.
# Debian (not Alpine): the neural voice runtime (onnxruntime) needs glibc.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Bake the human-voice model (~90 MB) into the image so the first line isn't a download.
RUN node -e "import('kokoro-js').then(({ KokoroTTS }) => KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })).then(() => console.log('voice model cached'))"

COPY . .

# Sessions are saved here; mount a volume to keep them across restarts/deploys.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+(process.env.BASE_PATH||'')+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
