# Production image for the API. Built by GitHub Actions (see
# .github/workflows/deploy.yml) and shipped to the server, which never builds
# anything itself — the server has only 1 GB of RAM.

FROM node:22-bookworm-slim AS build
# Prisma picks its engine build by the OpenSSL it finds; install it here too so
# the engine downloaded at build time matches the runtime image's.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
 # Keep only runtime deps, plus the prisma CLI for `prisma migrate deploy`.
 && PRISMA_VERSION=$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version") \
 && npm prune --omit=dev \
 && npm install --omit=dev --no-save --no-audit --no-fund "prisma@${PRISMA_VERSION}"

FROM node:22-bookworm-slim
# DejaVu Sans is the font the download watermark's SVG text asks for; without
# a system font sharp renders it as empty boxes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=5000
COPY --from=build /app/package.json /app/package-lock.json /app/prisma.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
RUN mkdir -p uploads && chown -R node:node uploads
USER node
EXPOSE 5000
CMD ["node", "dist/index.js"]
