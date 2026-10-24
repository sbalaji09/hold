# Voice server image (Fly.io). The Next app and Convex are deployed separately.
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# Moss's embedding model, copied in by scripts/deployVoice.sh so a fresh machine doesn't spend
# minutes downloading it before the first call. Platform-independent ONNX files.
RUN set -e; \
  if [ -d .model-cache/moss-minilm ]; then \
    dest="$(ls -d node_modules/.pnpm/@huggingface+transformers@*/node_modules/@huggingface/transformers | head -1)/.cache"; \
    mkdir -p "$dest" && cp -r .model-cache/moss-minilm "$dest/"; \
  fi; \
  rm -rf .model-cache

ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "voice/src/main.ts"]
