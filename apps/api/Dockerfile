FROM node:22-alpine AS build
WORKDIR /workspace
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --workspace @agent-platform/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build --workspace @agent-platform/api

FROM node:22-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --omit=dev --workspace @agent-platform/api --include-workspace-root
COPY --from=build /workspace/apps/api/dist apps/api/dist
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
