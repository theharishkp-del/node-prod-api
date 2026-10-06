# syntax=docker/dockerfile:1

# ---- deps: install production dependencies only ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_DIR=/app/logs
WORKDIR /app

# tini: proper PID 1 (forwards SIGTERM, reaps zombies) so graceful shutdown works
RUN apk add --no-cache tini

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
RUN mkdir -p /app/logs && chown -R node:node /app/logs

# Run as the unprivileged "node" user that ships with the official image
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
