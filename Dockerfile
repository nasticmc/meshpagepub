FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    MESHPAGEPUB_DATA_DIR=/var/lib/meshpagepub

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/*.js ./
COPY --from=build --chown=node:node /app/*.html /app/*.css ./
COPY --from=build --chown=node:node /app/assets ./assets

RUN mkdir -p /var/lib/meshpagepub && chown -R node:node /app /var/lib/meshpagepub

USER node
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js", "--host", "0.0.0.0", "--port", "8000"]
