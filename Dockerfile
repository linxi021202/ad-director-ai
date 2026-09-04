FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    STORAGE_ROOT=/app/storage \
    REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      chromium \
      dumb-init \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# better-auth currently declares an optional Zod 4 peer while the app still
# validates its workflow payloads with Zod 3. Keep the lockfile resolution
# deterministic across newer npm releases used by hosted builders.
RUN npm ci --include=dev --legacy-peer-deps

COPY . .
RUN npm run build \
    && npm prune --omit=dev --legacy-peer-deps \
    && npm cache clean --force \
    && mkdir -p /app/storage

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start"]
