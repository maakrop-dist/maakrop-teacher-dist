FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY package.json release-manifest.json ./
COPY scripts/ ./scripts/

# Download & verify (Ed25519 + SHA-256) the exact @vercel/nft standalone bundle
# Automatically installs matching sharp binary when building on linux/arm64
RUN node scripts/fetch-release-bundle.mjs

EXPOSE 3000
CMD ["sh", "-c", "node scripts/self-hosted-migrate.mjs --optional && node server.js"]
