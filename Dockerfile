# syntax=docker/dockerfile:1
# Construit l'un des deux sites : --build-arg APP=web  ou  --build-arg APP=admin
FROM node:20-bookworm-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS builder
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma packages/db/prisma
RUN npm ci
COPY . .
ARG APP
ENV BUILD_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @rideau/${APP}

# Outil de migration de la base : docker compose run --rm migrate
FROM base AS tools
COPY --from=builder /repo /repo
CMD ["npx", "prisma", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma"]

FROM base AS runner
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 APP=${APP}
COPY --from=builder /repo/apps/${APP}/.next/standalone ./
COPY --from=builder /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=builder /repo/apps/${APP}/public ./apps/${APP}/public
USER node
CMD node apps/${APP}/server.js
