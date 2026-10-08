# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile -t blr-api .
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/model/package.json packages/model/
COPY packages/shared/package.json packages/shared/
COPY packages/mapdata/package.json packages/mapdata/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts -w @blr/api && npm cache clean --force

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/model/package.json packages/model/
COPY packages/model/src packages/model/src
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/mapdata/package.json packages/mapdata/index.mjs packages/mapdata/map.json packages/mapdata/
COPY apps/api/package.json apps/api/
COPY apps/api/src apps/api/src
USER node
EXPOSE 8080
CMD ["node", "apps/api/src/main.mjs"]
