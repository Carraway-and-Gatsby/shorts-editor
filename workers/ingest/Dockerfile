FROM node:22-alpine
RUN apk add --no-cache ffmpeg
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile --filter @shorts/worker-ingest...
RUN pnpm --filter @shorts/worker-ingest... run build

ENV NODE_ENV=production
EXPOSE 8081
CMD ["node", "workers/ingest/dist/index.js"]
