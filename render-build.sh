#!/usr/bin/env bash
# Exit on error
set -o errexit

echo "Installing Node dependencies..."
npm install --omit=dev

echo "Installing yt-dlp Linux binary..."
mkdir -p bin
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod a+rx bin/yt-dlp

echo "Build completed successfully."
