# Railway service: indexer + keeper + alerts + radar (build from repo root: docker build -f services/Dockerfile .)
FROM node:22-slim
WORKDIR /app
RUN npm i -g pnpm@9
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --filter @lockwatch/services... --frozen-lockfile
WORKDIR /app/services
CMD ["pnpm", "start"]
