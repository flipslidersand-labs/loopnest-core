# syntax=docker/dockerfile:1
# Multi-stage build for the LoopNest Core API.
#
# Build context must be the monorepo root (loopnest-core/), because the API
# depends on the workspace package packages/bizcore-db via a file: dependency.
#
#   docker build -f apps/api/Dockerfile -t loopnest-api .

# ---- build stage -------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /repo

# Prisma needs openssl at generate/runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Build the workspace dependency first (prisma client + tsc output).
COPY packages/bizcore-db/package.json packages/bizcore-db/
WORKDIR /repo/packages/bizcore-db
RUN npm install --no-audit --no-fund
COPY packages/bizcore-db/ ./
RUN npx prisma generate && npm run build

# Build the API. Its file: dependency resolves to the sibling package above.
WORKDIR /repo/apps/api
COPY apps/api/package.json ./
RUN npm install --no-audit --no-fund
COPY apps/api/ ./
RUN npm run build

# ---- runtime stage -----------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /repo/apps/api
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

# Built workspace dependency + its production node_modules (incl. generated
# Prisma client) and the built API with its node_modules.
COPY --from=build /repo/packages/bizcore-db /repo/packages/bizcore-db
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./

# Run as the unprivileged user shipped with the node image.
USER node

EXPOSE 3000

# Liveness probe target for orchestrators that honor HEALTHCHECK.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/src/server.js"]
