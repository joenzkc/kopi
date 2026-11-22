# Stage 1: Install deps & build Vite PWA frontend
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN bun install

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

RUN bun run build:client

# Stage 2: Minimal Bun runtime
FROM oven/bun:1-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5008
ENV DATA_DIR=/data
ENV TZ=Asia/Singapore

RUN apk add --no-cache tzdata ca-certificates

COPY package.json ./
RUN bun install --production

COPY --from=builder /app/dist/client ./dist/client
COPY src/server ./src/server
COPY src/shared ./src/shared

RUN mkdir -p /data && chown -R bun:bun /app /data
USER bun

EXPOSE 5008

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5008/api/health || exit 1

CMD ["bun", "src/server/index.ts"]
