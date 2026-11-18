# Build the React dashboard
FROM node:22-bookworm-slim AS frontend-build

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Install backend production dependencies, including the native SQLite module
FROM node:22-bookworm-slim AS backend-deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm ci --omit=dev

# One runtime image serves both the API and the built dashboard
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4101 \
    DATABASE_PATH=/app/data/monitor.db

WORKDIR /app

RUN mkdir -p /app/data /app/wwwroot && chown -R node:node /app

COPY --from=backend-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node backend/package*.json ./
COPY --chown=node:node backend/src ./src
COPY --chown=root:root backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=frontend-build --chown=node:node /frontend/dist ./wwwroot

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4101

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4101/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
