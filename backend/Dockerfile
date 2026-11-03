# syntax=docker/dockerfile:1

# Stage 1: install production dependencies (native better-sqlite3 build)
FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: minimal runtime image. The entrypoint repairs volume ownership when
# running as root, then drops privileges to the unprivileged "node" user.
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4101 \
    DATABASE_PATH=/app/data/monitor.db

WORKDIR /app

RUN mkdir -p /app/data && chown -R node:node /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node src ./src
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4101

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4101/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
