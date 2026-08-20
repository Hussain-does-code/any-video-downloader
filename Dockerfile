# Production Docker Image for Apex Universal Video Downloader
FROM node:20-bullseye-slim

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Install system dependencies: Python 3, FFmpeg, curl, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Create working directory
WORKDIR /app

# Install npm dependencies first for optimal layer caching
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application files (excluding patterns in .dockerignore)
COPY . .

# Create downloads directory and ensure full permissions
RUN mkdir -p /app/downloads && chmod -R 777 /app

# Expose server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/status || exit 1

# Start the application
CMD ["node", "server.js"]
