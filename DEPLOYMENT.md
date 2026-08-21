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

## 🛡️ Built-in K37 Security & Rate Limiting Controls

- **Multi-Tier Strict Rate Limiting**: Dedicated rate limits for analysis, video downloads, thumbnail proxies, file streaming, and status polling with RFC/IETF `RateLimit-*` and `Retry-After` headers.
- **Per-IP Concurrency Guard**: Caps simultaneous heavy downloads per IP (default: 2) to protect cloud CPU and memory from crashing.
- **SSRF Blocker**: Rejects unauthorized access to internal networks, localhost, or cloud instance metadata.
- **Path Traversal Sandboxing**: Ensures file operations remain strictly inside the downloads directory.
- **Security Headers**: Production-grade CSP, HSTS, X-Frame-Options, X-Content-Type-Options active.
- **Auto-Pruning GC**: Automatically cleans up completed video files older than 45 minutes to prevent out-of-disk crashes on cloud hosts.

### ⚙️ Optional Rate Limiting Environment Variables

You can configure any of these in your cloud provider's dashboard (Render, Railway, Fly.io, etc.):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `RATE_LIMIT_GLOBAL_MAX` | `200` | Max total API requests per minute per IP |
| `RATE_LIMIT_ANALYZE_MAX` | `20` | Max video URL analysis probes per minute per IP |
| `RATE_LIMIT_DOWNLOAD_MAX` | `25` | Max download pipeline requests per 15 min per IP |
| `RATE_LIMIT_PROXY_MAX` | `45` | Max thumbnail image proxy requests per minute per IP |
| `RATE_LIMIT_FILE_MAX` | `30` | Max file stream delivery downloads per minute per IP |
| `RATE_LIMIT_POLL_MAX` | `120` | Max SSE progress & status polling requests per min |
| `RATE_LIMIT_CONCURRENT_MAX`| `2` | Max concurrent active downloading processes per IP |

