FROM node:22.22.0-bookworm-slim
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY apps/web-app/package.json apps/web-app/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/adapters/package.json packages/adapters/package.json
RUN npm ci
RUN npx playwright install --with-deps chromium
COPY . .
RUN npm run build && mkdir -p /data /browser-profiles /diagnostics /output /resources && chown -R node:node /app/apps/web-app/.next /data /browser-profiles /diagnostics /output /resources
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "start", "--workspace", "@aaa/web"]
