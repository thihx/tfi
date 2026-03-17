# ============================================================
# TFI — Single-container (Frontend + API + Job Scheduler)
# Multi-stage build: build frontend, build server, run all
# ============================================================

FROM node:20-slim AS base
WORKDIR /app
ENV npm_config_unicode=false
ENV npm_config_progress=false

# ── Stage 1: Build frontend (React SPA) ─────────────────────
FROM base AS frontend-build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npx vite build

# ── Stage 2: Build server (Fastify) ─────────────────────────
FROM base AS server-build
COPY packages/server/package.json packages/server/package-lock.json* ./packages/server/
WORKDIR /app/packages/server
RUN npm ci --ignore-scripts
COPY packages/server/tsconfig.json ./
COPY packages/server/src ./src
RUN npx tsc

# ── Stage 3: Production image ───────────────────────────────
FROM node:20-slim
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY packages/server/package.json packages/server/package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Server compiled output
COPY --from=server-build /app/packages/server/dist ./dist

# Frontend built files → served by Fastify @fastify/static
COPY --from=frontend-build /app/dist ./client

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/index.js"]
