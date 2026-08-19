# 🌐 Production Cloud Deployment Guide

This guide explains how to deploy **Apex Universal Video Downloader** to the internet so that it runs 24/7 online, completely free, and accessible from any computer, tablet, or phone without needing your laptop running.

---

## ⚡ Option 1: Render (Recommended — 100% Free & Easy)

Render provides free hosting with automatic HTTPS SSL certificates and full Docker support.

### Steps:
1. **Push your code to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Deploy Apex Video Downloader"
   # Create a repository on github.com, then:
   git remote add origin https://github.com/YOUR_USERNAME/any-video-downloader.git
   git branch -M main
   git push -u origin main
   ```
2. **Log into [render.com](https://render.com)** (sign up with GitHub).
3. Click **New +** → **Web Service**.
4. Select your **`any-video-downloader`** repository.
5. Render will automatically detect the **`Dockerfile`** (or `render.yaml`).
   - **Environment**: `Docker`
   - **Plan**: `Free`
6. Click **Deploy Web Service**.
7. In ~2 minutes, your live URL will be active (e.g. `https://apex-video-downloader.onrender.com`)!

---

## 🚀 Option 2: Railway (1-Click Deployment)

Railway provides fast deployment with zero configuration.

### Steps:
1. Push your repository to GitHub.
2. Go to [railway.app](https://railway.app) and click **New Project** → **Deploy from GitHub repo**.
3. Select your repository. Railway will detect `nixpacks.toml` and `Dockerfile`.
4. Click **Settings** → **Networking** → **Generate Domain**.
5. Your app is live at `https://your-app.up.railway.app`!

---

## ✈️ Option 3: Fly.io (Global Edge Deployment)

1. Install Fly CLI: `winget install flyctl` (Windows) or `curl -L https://fly.io/install.sh | sh` (Linux/Mac).
2. Run `fly launch` in this project folder.
3. Run `fly deploy`.
4. Your app is live at `https://apex-video-downloader.fly.dev`!

---

## 🐳 Option 4: VPS / Any Cloud Server (Docker)

If you have a Linux VPS (DigitalOcean, Hetzner, AWS, Linode):
```bash
# Build and run container
docker build -t video-downloader .
docker run -d -p 80:3000 --restart always --name video-downloader video-downloader
```

---

## 🛡️ Built-in K37 Security & Cloud Features

- **SSRF Blocker**: Rejects unauthorized access to internal network or cloud metadata.
- **Path Traversal Protection**: Ensures file operations remain strictly sandboxed.
- **Security Headers**: HSTS, CSP, X-Frame-Options, X-Content-Type-Options active.
- **Auto-Pruning GC**: Automatically cleans up completed video files older than 45 minutes to prevent out-of-disk crashes on cloud hosts.
- **High-Speed Engine**: 16-connection parallel chunk streaming with live SSE progress.
