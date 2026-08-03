FROM node:22-alpine
RUN apk add --no-cache ffmpeg
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile --filter @shorts/worker-render...
RUN pnpm --filter @shorts/worker-render... run build

ENV NODE_ENV=production
EXPOSE 8082
CMD ["node", "workers/render/dist/index.js"]
