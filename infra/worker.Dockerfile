FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ xvfb xauth x11vnc websockify novnc && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY apps/web-app/package.json apps/web-app/package.json
COPY services/worker/package.json services/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/adapters/package.json packages/adapters/package.json
RUN npm ci
COPY . .
RUN mkdir -p /data /browser-profiles /output /diagnostics && chown 1000:1000 /data /browser-profiles /output /diagnostics
ENV NODE_ENV=production
USER 1000:1000
# VNC/websockify are installed but must not start until protected takeover exists.
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x720x24 -nolisten tcp", "./node_modules/.bin/tsx", "services/worker/src/main.ts"]
