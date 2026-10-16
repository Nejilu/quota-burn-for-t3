FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV PATH="/app/node_modules/.bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates libatomic1 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libatomic1 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production QP_HOST=0.0.0.0 QP_DATA_DIR=/data QP_WATCHDOG_MODE=external
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4317
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:4317/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
