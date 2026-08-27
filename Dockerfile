FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.server.json tsconfig.web.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000 NJV_DATA_FILE=/data/config.enc
WORKDIR /app
RUN addgroup -S viewer && adduser -S -G viewer viewer && mkdir /data && chown viewer:viewer /data
COPY --from=build --chown=viewer:viewer /app/package.json /app/package-lock.json ./
COPY --from=build --chown=viewer:viewer /app/node_modules ./node_modules
COPY --from=build --chown=viewer:viewer /app/dist-server ./dist-server
COPY --from=build --chown=viewer:viewer /app/dist ./dist
USER viewer
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist-server/server.js"]
