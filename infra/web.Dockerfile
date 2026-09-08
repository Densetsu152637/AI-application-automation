FROM node:22.22.0-bookworm-slim
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/adapters/package.json packages/adapters/package.json
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /data /output && chown -R node:node /app/apps/web/.next /data /output
ENV NODE_ENV=production
USER node
CMD ["sh", "-c", "./node_modules/.bin/tsx scripts/web-start.ts && exec npm run start --workspace @aaa/web"]
