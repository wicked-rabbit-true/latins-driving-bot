# Use Node.js 20 as base image
FROM node:20-slim

# Install Chromium for WhatsApp Web.js
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libgbm1 \
    libasound2t64 \
    libpangocairo-1.0-0 \
    libxss1 \
    libgtk-3-0 \
    libxshmfence1 \
    libglu1 \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/db/package.json ./lib/db/
COPY lib/api-zod/package.json ./lib/api-zod/

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY artifacts/api-server ./artifacts/api-server
COPY lib ./lib

# Build the API server
WORKDIR /app/artifacts/api-server
RUN pnpm run build

# Environment variables
ENV NODE_ENV=production
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

# Start the application
CMD ["node", "dist/index.mjs"]
