const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const dns = require('dns');
const { Resolver } = require('dns').promises;
const { spawn, exec } = require('child_process');
const { URL } = require('url');

// Configure global custom DNS & DoH resolver to bypass local ISP DNS blocks
const customResolver = new Resolver();
customResolver.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9']);
const dnsCache = new Map();

async function universalLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  // Check in-memory DNS cache
  if (dnsCache.has(hostname)) {
    const cached = dnsCache.get(hostname);
    if (options && options.all) return callback(null, [{ address: cached, family: 4 }]);
    return callback(null, cached, 4);
  }

  // 1. Try public secure UDP resolver (1.1.1.1, 8.8.8.8)
  try {
    const addresses = await customResolver.resolve4(hostname);
    if (addresses && addresses.length > 0) {
      const ip = addresses[0];
      dnsCache.set(hostname, ip);
      if (options && options.all) return callback(null, [{ address: ip, family: 4 }]);
      return callback(null, ip, 4);
    }
  } catch (err) {}

  // 2. Try DNS-over-HTTPS (DoH) via Cloudflare to bypass ISP port 53 interception
  try {
    const dohRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { 'Accept': 'application/dns-json' },
      signal: AbortSignal.timeout(3500)
    });
    if (dohRes.ok) {
      const json = await dohRes.json();
      if (json.Answer && json.Answer.length > 0) {
        const aRecord = json.Answer.find(a => a.type === 1);
        if (aRecord && aRecord.data) {
          const ip = aRecord.data;
          dnsCache.set(hostname, ip);
          if (options && options.all) return callback(null, [{ address: ip, family: 4 }]);
          return callback(null, ip, 4);
        }
      }
    }
  } catch (dohErr) {}

  // 3. Fallback to OS system dns.lookup
  dns.lookup(hostname, options, callback);
}

const globalHttpsAgent = new https.Agent({
  lookup: universalLookup,
  maxSockets: 128,
  maxFreeSockets: 64,
  keepAlive: true,
  keepAliveMsecs: 30000
});

const globalHttpAgent = new http.Agent({
  lookup: universalLookup,
  maxSockets: 128,
  maxFreeSockets: 64,
  keepAlive: true,
  keepAliveMsecs: 30000
});

https.globalAgent = globalHttpsAgent;
http.globalAgent = globalHttpAgent;

process.on('uncaughtException', (err) => {
  console.error('[Process Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Unhandled Rejection]:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Trust cloud reverse proxies (Vercel, Cloudflare, Render, Railway, Fly.io, etc.)
app.set('trust proxy', 1);

// Directories & Binaries (Supports Vercel serverless /tmp and standard environments)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
const ROOT_DIR = __dirname;
const BIN_DIR = isServerless ? path.join(os.tmpdir(), 'bin') : path.join(ROOT_DIR, 'bin');
const DOWNLOADS_DIR = isServerless ? path.join(os.tmpdir(), 'downloads') : path.join(ROOT_DIR, 'downloads');

try {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
} catch (e) {}

// ─── Cross-Platform Binary Resolution (Windows & Linux / Vercel) ───
let ffmpegStaticPath = null;
try {
  ffmpegStaticPath = require('ffmpeg-static');
} catch (e) {}

function getFfmpegPath() {
  const localWin = path.join(BIN_DIR, 'ffmpeg.exe');
  const localLinux = path.join(BIN_DIR, 'ffmpeg');
  const tmpLinux = path.join(os.tmpdir(), 'bin', 'ffmpeg');
  if (process.platform === 'win32' && fs.existsSync(localWin)) {
    return localWin;
  }
  if (fs.existsSync(localLinux)) {
    return localLinux;
  }
  if (fs.existsSync(tmpLinux)) {
    return tmpLinux;
  }
  if (ffmpegStaticPath && fs.existsSync(ffmpegStaticPath)) {
    return ffmpegStaticPath;
  }
  return 'ffmpeg';
}

function getYtdlpPath() {
  const localWin = path.join(BIN_DIR, 'yt-dlp.exe');
  const localLinux = path.join(BIN_DIR, 'yt-dlp');
  const tmpLinux = path.join(os.tmpdir(), 'bin', 'yt-dlp');
  if (process.platform === 'win32' && fs.existsSync(localWin)) {
    return localWin;
  }
  if (fs.existsSync(localLinux)) {
    return localLinux;
  }
  if (fs.existsSync(tmpLinux)) {
    return tmpLinux;
  }
  return 'yt-dlp';
}

// Check command availability
function isBinaryAvailable(binPath) {
  if (fs.existsSync(binPath)) return true;
  try {
    const { execSync } = require('child_process');
    execSync(`"${binPath}" --version`, { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch (e) {
    return false;
  }
}

// Auto-download yt-dlp Linux standalone binary if missing on cloud container or Vercel
async function ensureYtdlpBinary() {
  if (process.platform === 'win32') return;
  const targetBinDir = isServerless ? path.join(os.tmpdir(), 'bin') : BIN_DIR;
  const linuxPath = path.join(targetBinDir, 'yt-dlp');
  if (fs.existsSync(linuxPath)) {
    try { fs.chmodSync(linuxPath, '755'); } catch (e) {}
    return;
  }
  if (isBinaryAvailable('yt-dlp')) return;

  console.log('[Cloud/Vercel Setup] Installing standalone yt-dlp binary for Linux...');
  try {
    if (!fs.existsSync(targetBinDir)) fs.mkdirSync(targetBinDir, { recursive: true });
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(linuxPath);
      https.get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (redirectRes) => {
            redirectRes.pipe(file);
            file.on('finish', () => { file.close(resolve); });
          }).on('error', reject);
        } else {
          res.pipe(file);
          file.on('finish', () => { file.close(resolve); });
        }
      }).on('error', reject);
    });
    fs.chmodSync(linuxPath, '755');
    console.log('[Cloud/Vercel Setup] yt-dlp installed successfully.');
  } catch (err) {
    console.warn('[Cloud/Vercel Setup Warning] Auto-download of yt-dlp skipped:', err.message);
  }
}
ensureYtdlpBinary().catch(() => {});

// ─── K37 Security: Comprehensive Production Security Headers ───
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: blob:; media-src 'self' data: blob: https:; connect-src 'self' ws: wss:;"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// ─── K37 Security: SSRF Protection & Private IP Range Blocker ───
function isPrivateOrLocalUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return true;
  try {
    const trimmed = targetUrl.trim();
    if (trimmed.length > 2048) return true;

    const parsed = new URL(trimmed);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') {
      return true; // Block file://, gopher://, dict://, etc.
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // Localhost & Loopback addresses
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('0.')
    ) {
      return true;
    }

    // Cloud Metadata & Instance Data endpoints
    if (
      host === '169.254.169.254' ||
      host === '100.100.100.200' ||
      host.startsWith('metadata.google') ||
      host === 'instance-data' ||
      host.startsWith('169.254.')
    ) {
      return true;
    }

    // Private IPv4 ranges (RFC 1918)
    if (
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return true;
    }

    // Private / Reserved IPv6
    if (
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.includes('::ffff:127.') ||
      host.includes('::ffff:10.') ||
      host.includes('::ffff:192.168.')
    ) {
      return true;
    }

    // Special & Internal domain names
    if (
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.localhost') ||
      host.endsWith('.lan') ||
      host.endsWith('.home') ||
      host.endsWith('.corp') ||
      host.endsWith('.test') ||
      host.endsWith('.example') ||
      host.endsWith('.invalid')
    ) {
      return true;
    }

    // Block non-standard dangerous internal ports
    const port = parsed.port ? parseInt(parsed.port, 10) : (proto === 'https:' ? 443 : 80);
    const blockedPorts = [22, 23, 25, 110, 143, 3306, 5432, 6379, 27017, 11211, 9200];
    if (blockedPorts.includes(port)) {
      return true;
    }

    return false;
  } catch (e) {
    return true;
  }
}

// ─── K37 Security: Strict Path Traversal Prevention ───
function safeResolveDownloadPath(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename');
  }
  const cleanName = filename.replace(/\0/g, ''); // Strip null bytes
  const safeName = path.basename(cleanName);
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('Access denied: Invalid filename.');
  }
  const resolved = path.resolve(DOWNLOADS_DIR, safeName);
  const baseResolved = path.resolve(DOWNLOADS_DIR);
  if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
    throw new Error('Access denied: Path traversal detected.');
  }
  return { safeName, resolved };
}

// ─── K37 Cloud Storage Guard: Ephemeral Disk Cleanup ───
const PRUNE_INTERVAL_MS = 10 * 60 * 1000; // Run every 10 minutes
const MAX_FILE_AGE_MS = 45 * 60 * 1000;  // Keep files max 45 minutes

function pruneOldDownloads() {
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) return;
    const now = Date.now();
    const files = fs.readdirSync(DOWNLOADS_DIR);
    for (const file of files) {
      const fullPath = path.join(DOWNLOADS_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && (now - stat.mtimeMs > MAX_FILE_AGE_MS)) {
          fs.unlinkSync(fullPath);
          console.log(`[Storage GC] Pruned expired cloud file: ${file}`);
        }
      } catch (e) {}
    }
  } catch (err) {
    console.warn('[Storage GC Warning]:', err.message);
  }
}
setInterval(pruneOldDownloads, PRUNE_INTERVAL_MS);

app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(express.static(path.join(ROOT_DIR, 'public')));

// ─── K37 Cloud Rate Limiting & Abuse Defense Architecture ───
function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  const realIp = req.headers['x-real-ip'];
  const forwarded = req.headers['x-forwarded-for'];
  let ip = cfIp || realIp;
  if (!ip && forwarded && typeof forwarded === 'string') {
    ip = forwarded.split(',')[0].trim();
  }
  if (!ip) {
    ip = req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  }
  return typeof ip === 'string' ? ip.replace(/^::ffff:/, '') : '127.0.0.1';
}

function createJsonLimiter({ windowMs, max, message, code }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true, // draft-6 / draft-7 combined: RateLimit-*
    legacyHeaders: true,   // X-RateLimit-*
    validate: { trustProxy: false, keyGeneratorIpFallback: false },
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
    handler: (req, res, next, options) => {
      const resetTime = req.rateLimit?.resetTime?.getTime ? req.rateLimit.resetTime.getTime() : (Date.now() + windowMs);
      const retryAfter = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
      res.setHeader('Retry-After', retryAfter.toString());
      res.status(options.statusCode || 429).json({
        ok: false,
        error: message || 'Too many requests. Rate limit exceeded. Please wait before trying again.',
        code: code || 'RATE_LIMIT_EXCEEDED',
        retryAfter: retryAfter,
        limit: options.limit,
        windowSec: Math.ceil(windowMs / 1000)
      });
    }
  });
}

// Tier 1: Global Shield (Protects entire API against volumetric DDoS / fuzzers)
const globalRateLimiter = createJsonLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX, 10) || 200,
  message: 'Global rate limit exceeded: Too many requests from your IP. Please slow down.',
  code: 'GLOBAL_RATE_LIMIT_EXCEEDED'
});

// Tier 2: Video Analysis Probing (Heavy CPU / scraping prevention)
const analyzeRateLimiter = createJsonLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_ANALYZE_MAX, 10) || 20,
  message: 'Rate limit exceeded: Too many video analysis requests. Please wait a few seconds before analyzing another URL.',
  code: 'ANALYZE_RATE_LIMIT_EXCEEDED'
});

// Tier 3: Download Initiation (Spawns heavy yt-dlp/ffmpeg worker processes)
const downloadRateLimiter = createJsonLimiter({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_DOWNLOAD_MAX, 10) || 25,
  message: 'Rate limit exceeded: Download quota reached. Please wait before starting new downloads.',
  code: 'DOWNLOAD_RATE_LIMIT_EXCEEDED'
});

// Tier 4: Image Thumbnail Proxy (Outbound HTTP proxying / SSRF rate guard)
const proxyRateLimiter = createJsonLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_PROXY_MAX, 10) || 45,
  message: 'Rate limit exceeded: Too many thumbnail preview requests. Please try again shortly.',
  code: 'PROXY_RATE_LIMIT_EXCEEDED'
});

// Tier 5: High-Bandwidth File Streaming (Protects socket & disk bandwidth)
const fileDeliveryLimiter = createJsonLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_FILE_MAX, 10) || 30,
  message: 'Rate limit exceeded: Too many file downloads in a short period. Please wait.',
  code: 'FILE_RATE_LIMIT_EXCEEDED'
});

// Tier 6: Lightweight Status & Progress Polling
const pollingRateLimiter = createJsonLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_POLL_MAX, 10) || 120,
  message: 'Rate limit exceeded: Too many status/polling requests.',
  code: 'POLL_RATE_LIMIT_EXCEEDED'
});

// ─── IP Concurrency Guard for Cloud Compute Starvation Defense ───
const activeDownloadsPerIp = new Map();
const downloadIdToIp = new Map();
const MAX_CONCURRENT_DOWNLOADS_PER_IP = parseInt(process.env.RATE_LIMIT_CONCURRENT_MAX, 10) || 2;

function claimIpDownloadSlot(ip, downloadId) {
  if (!ip || !downloadId) return;
  const current = activeDownloadsPerIp.get(ip) || 0;
  activeDownloadsPerIp.set(ip, current + 1);
  downloadIdToIp.set(downloadId, ip);
}

function releaseIpDownloadSlot(downloadId) {
  if (!downloadId) return;
  const ip = downloadIdToIp.get(downloadId);
  if (!ip) return;
  downloadIdToIp.delete(downloadId);
  const count = activeDownloadsPerIp.get(ip) || 0;
  if (count <= 1) {
    activeDownloadsPerIp.delete(ip);
  } else {
    activeDownloadsPerIp.set(ip, count - 1);
  }
}

// Mount Global Rate Limiter across all routes
app.use(globalRateLimiter);

// In-Memory store for active downloads & SSE progress listeners
const activeDownloads = new Map();
const progressListeners = new Map();
const activeProcesses = new Map();

// Helper: Format duration in seconds to HH:MM:SS or MM:SS
function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Helper: Format bytes into readable format
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return 'Standard Size';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper: Clean filename for safety across Windows & browser download managers
function sanitizeFilename(name) {
  return (name || 'video')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[^\x20-\x7E]/g, '') // Keep clean ASCII for Windows filesystem and HTTP headers
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 120);
}

// ============================================================================
// Specialized Decryption Engine for XHamster & Mirror Domains
// ============================================================================
function int32(val) {
  return val | 0;
}

class ByteGenerator {
  constructor(algoId, seed) {
    this.algoId = algoId;
    this.s = int32(seed);
  }

  next() {
    let s = this.s;
    if (this.algoId === 1) {
      s = this.s = int32(Math.imul(s, 1664525) + 1013904223);
      return s & 0xff;
    } else if (this.algoId === 2) {
      s = int32(s ^ (s << 13));
      s = int32(s ^ (s >>> 17));
      s = this.s = int32(s ^ (s << 5));
      return s & 0xff;
    } else if (this.algoId === 3) {
      s = this.s = int32(s + 0x9e3779b9);
      s = int32(s ^ (s >>> 16));
      s = int32(Math.imul(s, 0x85ebca77));
      s = int32(s ^ (s >>> 13));
      s = int32(Math.imul(s, 0xc2b2ae3d));
      return int32(s ^ (s >>> 16)) & 0xff;
    } else if (this.algoId === 4) {
      s = this.s = int32(s + 0x6d2b79f5);
      s = int32((s << 7) | (s >>> 25)); // ROL 7
      s = int32(s + 0x9e3779b9);
      s = int32(s ^ (s >>> 11));
      return int32(Math.imul(s, 0x27d4eb2d)) & 0xff;
    } else if (this.algoId === 5) {
      s = int32(s ^ (s << 7));
      s = int32(s ^ (s >>> 9));
      s = int32(s ^ (s << 8));
      s = this.s = int32(s + 0xa5a5a5a5);
      return s & 0xff;
    } else if (this.algoId === 6) {
      s = this.s = int32(Math.imul(s, 0x2c9277b5) + 0xac564b05);
      const s2 = int32(s ^ (s >>> 18));
      const shift = (s >>> 27) & 31;
      return int32(s2 >>> shift) & 0xff;
    } else if (this.algoId === 7) {
      s = this.s = int32(s + 0x9e3779b9);
      let e = int32(s ^ (s << 5));
      e = int32(Math.imul(e, 0x7feb352d));
      e = int32(e ^ (e >>> 15));
      return int32(Math.imul(e, 0x846ca68b)) & 0xff;
    }
    throw new Error('Unknown algorithm: ' + this.algoId);
  }
}

function decipherHexString(hexString) {
  if (!hexString || typeof hexString !== 'string') return null;
  const cleaned = hexString.trim();
  if (!/^[0-9a-fA-F]{12,}$/.test(cleaned)) return null;

  try {
    const buf = Buffer.from(cleaned, 'hex');
    if (buf.length < 6) return null;
    const algoId = buf[0];
    const seed = buf.readInt32LE(1);
    const gen = new ByteGenerator(algoId, seed);
    const out = Buffer.alloc(buf.length - 5);
    for (let i = 5; i < buf.length; i++) {
      out[i - 5] = buf[i] ^ gen.next();
    }
    return out.toString('latin1');
  } catch (e) {
    return null;
  }
}

function decipherFormatUrl(formatUrl) {
  if (!formatUrl || typeof formatUrl !== 'string') return null;
  if (/^[0-9a-fA-F]{12,}$/.test(formatUrl)) {
    return decipherHexString(formatUrl);
  }
  try {
    const parsed = new URL(formatUrl);
    const m = parsed.pathname.match(/^\/([0-9a-fA-F]{12,})([/,].+)$/);
    if (m) {
      const deciphered = decipherHexString(m[1]);
      if (deciphered) {
        parsed.pathname = `/${deciphered}${m[2]}`;
        return parsed.toString();
      }
    }
  } catch (e) {}
  return formatUrl;
}

function fetchText(targetUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(e); }
    const client = parsed.protocol === 'https:' ? https : http;
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers
    };

    const req = client.get(targetUrl, {
      headers: reqHeaders,
      lookup: universalLookup,
      agent: parsed.protocol === 'https:' ? globalHttpsAgent : globalHttpAgent,
      timeout: 12000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(new URL(res.headers.location, targetUrl).toString(), headers));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} on ${targetUrl}`));
      }
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(body));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

function isXHamsterUrl(url) {
  if (!url) return false;
  return /xhamster|xhnetwork|xhms|xhday|xhvid|xhcdn/i.test(url) || /\/videos\/[a-zA-Z0-9_-]+-xh[a-zA-Z0-9]+/i.test(url);
}

// ============================================================================
// High-Speed Multi-Threaded HLS Downloader (16 Parallel Connection Pool)
// ============================================================================
function fetchBuffer(targetUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(e); }
    const client = parsed.protocol === 'https:' ? https : http;
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': `${parsed.protocol}//${parsed.hostname}/`,
      ...headers
    };

    const req = client.get(targetUrl, {
      headers: reqHeaders,
      lookup: universalLookup,
      agent: parsed.protocol === 'https:' ? globalHttpsAgent : globalHttpAgent,
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchBuffer(new URL(res.headers.location, targetUrl).toString(), headers));
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return reject(new Error(`HTTP ${res.statusCode} on segment`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Segment timeout'));
    });
    req.on('error', reject);
  });
}

function stripDummyHeader(buf) {
  if (!buf || buf.length < 188) return buf;
  if (
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
    (buf[0] === 0xff && buf[1] === 0xd8) ||
    (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) ||
    (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) ||
    buf[0] !== 0x47
  ) {
    for (let i = 0; i < Math.min(4096, buf.length - 188 * 3); i++) {
      if (buf[i] === 0x47 && buf[i + 188] === 0x47 && buf[i + 376] === 0x47) {
        return buf.subarray(i);
      }
    }
  }
  return buf;
}

async function downloadHLSParallel(m3u8Url, outputPath, isAudio = false, onProgress = null, abortController = null, customHeaders = {}) {
  console.log(`[Parallel HLS Downloader] Fetching manifest: ${m3u8Url}`);
  let targetM3u8 = m3u8Url;
  let manifest = await fetchText(targetM3u8, customHeaders);
  
  // If master playlist with multiple variant streams, resolve best/target variant stream
  if (manifest.includes('#EXT-X-STREAM-INF:')) {
    const lines = manifest.split('\n');
    let bestStreamUrl = null;
    let maxBw = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        const nextLine = lines[i + 1]?.trim();
        if (nextLine && !nextLine.startsWith('#')) {
          if (!bestStreamUrl || bw >= maxBw) {
            maxBw = bw;
            bestStreamUrl = new URL(nextLine, targetM3u8).toString();
          }
        }
      }
    }
    if (bestStreamUrl) {
      targetM3u8 = bestStreamUrl;
      manifest = await fetchText(targetM3u8, customHeaders);
    }
  }

  const segmentUrls = manifest.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => new URL(l, targetM3u8).toString());

  if (segmentUrls.length === 0) {
    throw new Error('No video segments found in playlist.');
  }

  const totalSegments = segmentUrls.length;
  console.log(`[Parallel HLS Downloader] Downloading ${totalSegments} segments in 16 parallel threads...`);

  const tempTsPath = outputPath + `.temp_${Date.now()}.ts`;
  const outStream = fs.createWriteStream(tempTsPath);

  const segments = segmentUrls.map((url, index) => ({
    index,
    url,
    status: 'pending',
    attempts: 0,
    buffer: null
  }));

  let nextToWrite = 0;
  let downloadedCount = 0;
  let totalBytesReceived = 0;
  let activeWorkers = 0;
  let isFinished = false;
  let hasError = false;
  const concurrency = 16;
  const startTime = Date.now();

  await new Promise((resolve, reject) => {
    function finish(err) {
      if (isFinished) return;
      isFinished = true;
      try { outStream.end(); } catch (e) {}
      if (err) {
        hasError = true;
        try { fs.unlinkSync(tempTsPath); } catch (e) {}
        return reject(err);
      }
      resolve();
    }

    function pump() {
      if (isFinished || hasError) return;

      if (abortController?.signal?.aborted) {
        return finish(new Error('CANCELLED'));
      }

      if (nextToWrite === totalSegments) {
        return finish();
      }

      while (activeWorkers < concurrency) {
        const nextItem = segments.find(s => s.status === 'pending');
        if (!nextItem) break;

        nextItem.status = 'downloading';
        nextItem.attempts++;
        activeWorkers++;

        fetchBuffer(nextItem.url, customHeaders)
          .then((buf) => {
            activeWorkers--;
            if (isFinished || hasError) return;

            const cleanBuf = stripDummyHeader(buf);
            nextItem.buffer = cleanBuf;
            nextItem.status = 'done';
            downloadedCount++;
            totalBytesReceived += cleanBuf.length;

            // Flush completed buffers to disk sequentially
            while (nextToWrite < totalSegments && segments[nextToWrite].status === 'done') {
              outStream.write(segments[nextToWrite].buffer);
              segments[nextToWrite].buffer = null; // Free memory
              nextToWrite++;
            }

            if (onProgress) {
              const pct = (downloadedCount / totalSegments) * 100;
              const elapsedSec = (Date.now() - startTime) / 1000;
              const speedBytesSec = elapsedSec > 0 ? totalBytesReceived / elapsedSec : 0;
              const speedFormatted = (speedBytesSec / (1024 * 1024)).toFixed(2) + ' MB/s';
              const remainingSegments = totalSegments - downloadedCount;
              const segsPerSec = elapsedSec > 0 ? downloadedCount / elapsedSec : 1;
              const etaSec = segsPerSec > 0 ? Math.round(remainingSegments / segsPerSec) : 0;
              const etaFormatted = `${Math.floor(etaSec / 60)}m ${etaSec % 60}s`;

              onProgress({
                percent: pct,
                speed: speedFormatted,
                eta: etaFormatted,
                totalSize: formatBytes(totalBytesReceived * (totalSegments / Math.max(1, downloadedCount)))
              });
            }

            pump();
          })
          .catch((err) => {
            activeWorkers--;
            if (isFinished || hasError) return;

            if (nextItem.attempts < 5) {
              nextItem.status = 'pending';
              setTimeout(pump, 500);
            } else {
              finish(new Error(`Failed to download segment ${nextItem.index}: ${err.message}`));
            }
          });
      }
    }

    pump();
  });

  // Remux TS stream to clean MP4 or MP3 using FFmpeg
  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-fflags', '+genpts+discardcorrupt',
      '-i', tempTsPath
    ];

    if (isAudio) {
      ffmpegArgs.push('-vn', '-c:a', 'libmp3lame', '-q:a', '0', '-y', outputPath);
    } else {
      ffmpegArgs.push(
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-bsf:a', 'aac_adtstoasc',
        '-movflags', '+faststart',
        '-y', outputPath
      );
    }

    const proc = spawn(getFfmpegPath(), ffmpegArgs);
    proc.on('close', (code) => {
      try { fs.unlinkSync(tempTsPath); } catch (e) {}
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg remuxing failed with exit code: ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

// ============================================================================
// Multi-Connection Parallel HTTP Range Downloader (16 Parallel Sockets)
// ============================================================================
function getUrlFileSize(targetUrl, headers = {}) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return resolve({ size: 0, acceptsRanges: false }); }
    const client = parsed.protocol === 'https:' ? https : http;
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity;q=1, *;q=0',
      'Referer': `${parsed.protocol}//${parsed.hostname}/`,
      'Origin': `${parsed.protocol}//${parsed.hostname}`,
      'Sec-Fetch-Dest': 'video',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      'Range': 'bytes=0-1',
      ...headers
    };

    // Direct GET with Range: bytes=0-1 reliably bypasses HEAD blocks and reveals total file size
    const req = client.get(targetUrl, {
      headers: defaultHeaders,
      lookup: universalLookup,
      agent: parsed.protocol === 'https:' ? globalHttpsAgent : globalHttpAgent,
      timeout: 12000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        return resolve(getUrlFileSize(new URL(res.headers.location, targetUrl).toString(), headers));
      }

      const cr = res.headers['content-range'];
      if (cr) {
        const match = cr.match(/\/(\d+)/);
        if (match) {
          req.destroy();
          return resolve({ size: parseInt(match[1], 10), acceptsRanges: true });
        }
      }

      const len = parseInt(res.headers['content-length'] || '0', 10);
      const acceptsRanges = res.headers['accept-ranges'] === 'bytes' || res.statusCode === 206;
      req.destroy();
      resolve({ size: len > 0 ? len : 0, acceptsRanges: acceptsRanges || len > 0 });
    });

    req.on('timeout', () => { req.destroy(); resolve({ size: 0, acceptsRanges: false }); });
    req.on('error', () => resolve({ size: 0, acceptsRanges: false }));
  });
}

function fetchRangeBuffer(targetUrl, start, end, headers = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(e); }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity;q=1, *;q=0',
        'Referer': `${parsed.protocol}//${parsed.hostname}/`,
        'Origin': `${parsed.protocol}//${parsed.hostname}`,
        'Sec-Fetch-Dest': 'video',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'Range': `bytes=${start}-${end}`,
        ...headers
      },
      lookup: universalLookup,
      agent: parsed.protocol === 'https:' ? globalHttpsAgent : globalHttpAgent,
      timeout: 25000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchRangeBuffer(new URL(res.headers.location, targetUrl).toString(), start, end, headers));
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return reject(new Error(`HTTP ${res.statusCode} on range chunk`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Range request timeout')); });
    req.on('error', reject);
  });
}

async function downloadDirectSingleHTTP(directUrl, outputPath, onProgress = null, abortController = null) {
  console.log(`[Single HTTP Downloader] Streaming direct file: ${directUrl}`);
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(directUrl); } catch (e) { return reject(e); }
    const client = parsed.protocol === 'https:' ? https : http;
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity;q=1, *;q=0',
      'Referer': `${parsed.protocol}//${parsed.hostname}/`,
      'Origin': `${parsed.protocol}//${parsed.hostname}`,
      'Sec-Fetch-Dest': 'video',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site'
    };

    const req = client.get(directUrl, {
      headers: defaultHeaders,
      lookup: universalLookup,
      agent: parsed.protocol === 'https:' ? globalHttpsAgent : globalHttpAgent,
      timeout: 30000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadDirectSingleHTTP(new URL(res.headers.location, directUrl).toString(), outputPath, onProgress, abortController));
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return reject(new Error(`HTTP ${res.statusCode} from stream source`));
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      const tempFilePath = outputPath + `.temp_${Date.now()}.part`;
      const fileStream = fs.createWriteStream(tempFilePath);
      let downloaded = 0;
      const startTime = Date.now();

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        fileStream.write(chunk);
        if (onProgress) {
          const pct = totalBytes > 0 ? Math.min(99.9, (downloaded / totalBytes) * 100) : 50;
          const elapsedSec = (Date.now() - startTime) / 1000;
          const speedBytesSec = elapsedSec > 0 ? downloaded / elapsedSec : 0;
          const speedFormatted = (speedBytesSec / (1024 * 1024)).toFixed(2) + ' MB/s';
          const remainingBytes = totalBytes > downloaded ? totalBytes - downloaded : 0;
          const etaSec = speedBytesSec > 0 && remainingBytes > 0 ? Math.round(remainingBytes / speedBytesSec) : 0;
          const etaFormatted = etaSec > 0 ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s` : '--';

          onProgress({
            percent: pct,
            speed: speedFormatted,
            eta: etaFormatted,
            totalSize: totalBytes > 0 ? formatBytes(totalBytes) : formatBytes(downloaded)
          });
        }
      });

      res.on('end', () => {
        fileStream.close();
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch (e) {}
        }
        try { fs.renameSync(tempFilePath, outputPath); } catch (e) {}
        resolve();
      });

      res.on('error', (err) => {
        fileStream.close();
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
        reject(err);
      });
    });

    if (abortController) {
      abortController.signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('CANCELLED'));
      });
    }

    req.on('timeout', () => { req.destroy(); reject(new Error('Stream download timed out.')); });
    req.on('error', reject);
  });
}

async function downloadDirectParallelHTTP(directUrl, outputPath, onProgress = null, abortController = null) {
  console.log(`[Parallel HTTP Downloader] Probing file size: ${directUrl}`);
  const { size: totalBytes, acceptsRanges } = await getUrlFileSize(directUrl);
  if (!totalBytes || totalBytes < 1024 * 1024 || !acceptsRanges) {
    console.log('[Parallel HTTP Downloader] Range chunking unsupported or small file; streaming direct...');
    return downloadDirectSingleHTTP(directUrl, outputPath, onProgress, abortController);
  }

  // 16 to 24 parallel worker threads to multiply speed and bypass 60kbps connection rate limits
  const concurrency = 16;
  const chunkSize = 2 * 1024 * 1024; // 2MB chunk slices
  const numChunks = Math.ceil(totalBytes / chunkSize);
  console.log(`[Parallel HTTP Downloader] Downloading ${formatBytes(totalBytes)} across ${numChunks} chunks (${concurrency} parallel workers)...`);

  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(totalBytes - 1, (i + 1) * chunkSize - 1);
    chunks.push({ index: i, start, end, total: end - start + 1, status: 'pending', attempts: 0 });
  }

  const tempFilePath = outputPath + `.temp_${Date.now()}.part`;
  const fd = fs.openSync(tempFilePath, 'w');
  try {
    fs.ftruncateSync(fd, totalBytes);
  } catch (e) {}

  let completedBytes = 0;
  let activeWorkers = 0;
  let isFinished = false;
  let hasError = false;
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    function finish(err) {
      if (isFinished) return;
      isFinished = true;
      try { fs.closeSync(fd); } catch (e) {}
      if (err) {
        hasError = true;
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
        return reject(err);
      }
      try {
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch (e) {}
        }
        fs.renameSync(tempFilePath, outputPath);
      } catch (e) {
        return reject(e);
      }
      resolve();
    }

    function pump() {
      if (isFinished || hasError) return;

      if (abortController?.signal?.aborted) {
        return finish(new Error('CANCELLED'));
      }

      if (completedBytes >= totalBytes) {
        return finish();
      }

      while (activeWorkers < concurrency) {
        const nextChunk = chunks.find(c => c.status === 'pending');
        if (!nextChunk) break;

        nextChunk.status = 'downloading';
        nextChunk.attempts++;
        activeWorkers++;

        fetchRangeBuffer(directUrl, nextChunk.start, nextChunk.end)
          .then((buf) => {
            activeWorkers--;
            if (isFinished || hasError) return;

            try {
              fs.writeSync(fd, buf, 0, buf.length, nextChunk.start);
              nextChunk.status = 'done';
              completedBytes += buf.length;

              if (onProgress) {
                const pct = Math.min(99.9, (completedBytes / totalBytes) * 100);
                const elapsedSec = (Date.now() - startTime) / 1000;
                const speedBytesSec = elapsedSec > 0 ? completedBytes / elapsedSec : 0;
                const speedFormatted = (speedBytesSec / (1024 * 1024)).toFixed(2) + ' MB/s';
                const remainingBytes = Math.max(0, totalBytes - completedBytes);
                const etaSec = speedBytesSec > 0 && remainingBytes > 0 ? Math.round(remainingBytes / speedBytesSec) : 0;
                const etaFormatted = etaSec > 0 ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s` : '--';

                onProgress({
                  percent: pct,
                  speed: speedFormatted,
                  eta: etaFormatted,
                  totalSize: formatBytes(totalBytes)
                });
              }

              pump();
            } catch (writeErr) {
              finish(writeErr);
            }
          })
          .catch((err) => {
            activeWorkers--;
            if (isFinished || hasError) return;

            console.warn(`[Retry Range Chunk ${nextChunk.index} (attempt ${nextChunk.attempts})]:`, err.message);
            if (nextChunk.attempts > 6) {
              console.warn('[Parallel Downloader] Chunk failed 6 times; falling back to single stream...');
              finish(new Error('PARALLEL_FAILED'));
            } else {
              nextChunk.status = 'pending';
              setTimeout(pump, 400);
            }
          });
      }

      if (activeWorkers === 0 && completedBytes < totalBytes && !chunks.some(c => c.status === 'pending' || c.status === 'downloading')) {
        finish(new Error('Download incomplete'));
      }
    }

    pump();
  }).catch((err) => {
    if (err.message === 'CANCELLED') throw err;
    console.log('[Parallel Downloader fallback]: Falling back to single-stream download...');
    return downloadDirectSingleHTTP(directUrl, outputPath, onProgress, abortController);
  });
}

// ============================================================================
// Metadata Extractor
// ============================================================================
async function extractXHamsterData(pageUrl) {
  console.log(`[XHamster Native Extractor] Probing: ${pageUrl}`);
  const html = await fetchText(pageUrl);

  const initialsMatch = html.match(/window\.initials\s*=\s*({.+?})\s*;\s*<\/script>/s) ||
                        html.match(/window\.initials\s*=\s*({.+?})\s*;/s);

  if (!initialsMatch) {
    throw new Error('Could not find player metadata on page.');
  }

  const initials = JSON.parse(initialsMatch[1]);
  const videoModel = initials.videoModel || {};
  const xplayerSettings = initials.xplayerSettings || {};
  const sources = xplayerSettings.sources || videoModel.sources || {};

  const title = videoModel.title || initials.videoTitle || 'Video';
  const thumbnail = videoModel.thumbURL || (videoModel.thumbs && videoModel.thumbs[videoModel.thumbs.length - 1]?.url) || '';
  const duration = videoModel.duration || 0;
  const uploader = (videoModel.author && videoModel.author.name) || (initials.videoEntity && initials.videoEntity.user && initials.videoEntity.user.name) || 'Creator';
  const views = videoModel.views || null;

  const videoFormats = [];
  const seenHeights = new Set();

  function parseHeight(q) {
    if (!q) return 0;
    const m = String(q).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  const hlsSources = sources.hls || {};
  const hlsUrlRaw = (hlsSources.h264 && (hlsSources.h264.url || hlsSources.h264.fallback)) ||
                    (hlsSources.av1 && (hlsSources.av1.url || hlsSources.av1.fallback)) ||
                    hlsSources.url ||
                    hlsSources.all;

  let masterHlsUrl = decipherFormatUrl(hlsUrlRaw);

  if (masterHlsUrl) {
    try {
      const m3u8Content = await fetchText(masterHlsUrl, { Referer: pageUrl });
      const streamLines = m3u8Content.split('\n');
      let currentRes = null;
      let currentBandwidth = 0;

      for (let i = 0; i < streamLines.length; i++) {
        const line = streamLines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
          const nameMatch = line.match(/NAME=["']?(\d+)[pP]?["']?/i);
          const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
          if (resMatch) {
            const w = parseInt(resMatch[1], 10);
            const h = parseInt(resMatch[2], 10);
            currentRes = (w > 0 && h > 0) ? (w > h ? h : w) : (h || w);
          } else if (nameMatch) {
            currentRes = parseInt(nameMatch[1], 10);
          }
          currentBandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        } else if (line && !line.startsWith('#')) {
          const fullStreamUrl = new URL(line, masterHlsUrl).toString();
          let height = currentRes;

          if (!height) {
            const urlMatch = fullStreamUrl.match(/(?:_|\/|-|\.|\b)(4320|2160|1440|1080|720|480|360)[pP]?(?:\.|\/|_|-|\b|$)/i);
            if (urlMatch) height = parseInt(urlMatch[1], 10);
          }

          if (!height) {
            if (currentBandwidth >= 7000000) height = 2160;
            else if (currentBandwidth >= 4500000) height = 1440;
            else if (currentBandwidth >= 2800000) height = 1080;
            else if (currentBandwidth >= 1400000) height = 720;
            else if (currentBandwidth >= 700000) height = 480;
            else if (currentBandwidth > 0) height = 360;
            else height = 1080;
          }

          if (!seenHeights.has(height)) {
            seenHeights.add(height);

            const is8k = height >= 4320;
            const is4k = height >= 2160;
            const is2k = height >= 1440;
            const is1080 = height >= 1080;
            const label = is8k ? '8K Ultra HD (4320p)' :
                          is4k ? '4K Ultra HD (2160p)' :
                          is2k ? '2K Quad HD (1440p)' :
                          is1080 ? 'Full HD (1080p)' :
                          height >= 720 ? 'HD (720p)' :
                          `SD (${height}p)`;

            const badge = is8k ? '8K' : is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : height >= 720 ? 'HD' : 'SD';
            const approxBytes = duration > 0 && currentBandwidth > 0 ? Math.round((currentBandwidth / 8) * duration) : null;

            videoFormats.push({
              formatId: `hls-${height}`,
              height: height,
              fps: null,
              label: label,
              badge: badge,
              tbr: currentBandwidth / 1000,
              ext: 'mp4',
              vcodec: 'h264',
              hasAudio: true,
              size: approxBytes,
              sizeFormatted: formatBytes(approxBytes),
              directUrl: fullStreamUrl,
              isHls: true
            });
          }
          currentRes = null;
        }
      }
    } catch (hlsErr) {
      console.warn('[XHamster HLS Parse Warning]:', hlsErr.message);
    }
  }

  // Also parse direct MP4 sources for 1080p, 720p, 480p, 4K if available
  const mp4Sources = sources.mp4 || sources.download || sources.progressive || sources.standard || (videoModel.sources && videoModel.sources.mp4) || {};
  if (typeof mp4Sources === 'object' && mp4Sources !== null) {
    for (const [qualityKey, rawUrl] of Object.entries(mp4Sources)) {
      if (!rawUrl) continue;
      let qHeight = parseHeight(qualityKey);
      if (!qHeight) {
        if (/4320|8k/i.test(qualityKey)) qHeight = 4320;
        else if (/2160|4k/i.test(qualityKey)) qHeight = 2160;
        else if (/1440|2k/i.test(qualityKey)) qHeight = 1440;
        else if (/1080/i.test(qualityKey)) qHeight = 1080;
        else if (/720/i.test(qualityKey)) qHeight = 720;
        else if (/480/i.test(qualityKey)) qHeight = 480;
        else if (/360/i.test(qualityKey)) qHeight = 360;
      }
      if (qHeight && !seenHeights.has(qHeight)) {
        const directDeciphered = decipherFormatUrl(typeof rawUrl === 'string' ? rawUrl : (rawUrl.url || rawUrl.fallback || ''));
        if (directDeciphered) {
          seenHeights.add(qHeight);
          const is8k = qHeight >= 4320;
          const is4k = qHeight >= 2160;
          const is2k = qHeight >= 1440;
          const is1080 = qHeight >= 1080;
          const label = is8k ? '8K Ultra HD (4320p)' :
                        is4k ? '4K Ultra HD (2160p)' :
                        is2k ? '2K Quad HD (1440p)' :
                        is1080 ? 'Full HD (1080p)' :
                        qHeight >= 720 ? 'HD (720p)' : `SD (${qHeight}p)`;
          const badge = is8k ? '8K' : is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : qHeight >= 720 ? 'HD' : 'SD';
          videoFormats.push({
            formatId: `direct-${qHeight}`,
            height: qHeight,
            fps: null,
            label: label,
            badge: badge,
            tbr: null,
            ext: 'mp4',
            vcodec: 'h264',
            hasAudio: true,
            size: null,
            sizeFormatted: 'Direct High-Speed Stream',
            directUrl: directDeciphered,
            isHls: directDeciphered.includes('.m3u8')
          });
        }
      }
    }
  }

  videoFormats.sort((a, b) => b.height - a.height);

  const audioFormats = [
    {
      formatId: 'bestaudio',
      ext: 'mp3',
      quality: '320 kbps',
      abr: 320,
      size: duration > 0 ? Math.round((320000 / 8) * duration) : null,
      sizeFormatted: formatBytes(duration > 0 ? Math.round((320000 / 8) * duration) : null),
      container: 'mp3',
      codec: 'mp3',
      directUrl: videoFormats[0]?.directUrl
    }
  ];

  return {
    title,
    thumbnail,
    duration,
    durationFormatted: formatDuration(duration),
    uploader,
    uploaderUrl: '',
    viewCount: views ? views.toLocaleString() : null,
    site: 'XHamster',
    webpageUrl: pageUrl,
    videoFormats,
    audioFormats,
    originalFormatsCount: videoFormats.length
  };
}

// ─── Cloud Gateway & Direct Stream Fallback Extractor (Bypasses ISP/DNS Blocks without VPN) ───
// JS Unpacker (eval(function(p,a,c,k,e,d)...))
function unpackJS(code) {
  try {
    const match = code.match(/eval\((function\(p,a,c,k,e,d\)[\s\S]*?)\)\s*;?\s*<\/script>/i) || 
                  code.match(/eval\((function\(p,a,c,k,e,d\)[\s\S]*)\)/i);
    if (match) {
      const fn = new Function('return (' + match[1] + ')');
      return fn();
    }
  } catch (e) {}
  return null;
}

// Cloud Gateway HTML & Stream Fetcher (Bypasses ISP/DNS filter)
async function fetchViaGateway(targetUrl, headers = {}) {
  const gateways = [
    `https://proxy.cors.sh/${targetUrl}`,
    `https://corsproxy.org/?${encodeURIComponent(targetUrl)}`,
    targetUrl
  ];

  for (const gw of gateways) {
    try {
      const res = await fetch(gw, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...headers
        },
        signal: AbortSignal.timeout(9000)
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 100) {
          return text;
        }
      }
    } catch (e) {}
  }
  return null;
}

// Parse Master M3U8 for individual resolution variants
async function parseMasterM3u8Streams(masterUrl, referer = '') {
  const formats = [];
  try {
    const manifest = await fetchText(masterUrl, referer ? { Referer: referer } : {});
    if (!manifest) return formats;

    if (manifest.includes('#EXT-X-STREAM-INF:')) {
      const lines = manifest.split('\n');
      let currentRes = null;
      let currentBw = 0;
      let seenHeights = new Set();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
          const nameMatch = line.match(/NAME=["']?(\d+)[pP]?["']?/i);
          const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
          if (resMatch) {
            const w = parseInt(resMatch[1], 10);
            const h = parseInt(resMatch[2], 10);
            currentRes = (w > 0 && h > 0) ? (w > h ? h : w) : (h || w);
          } else if (nameMatch) {
            currentRes = parseInt(nameMatch[1], 10);
          }
          currentBw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        } else if (line && !line.startsWith('#')) {
          const subUrl = new URL(line, masterUrl).toString();
          let height = currentRes;

          // Infer resolution from subUrl if not found in headers
          if (!height) {
            const urlMatch = subUrl.match(/(?:_|\/|-|\.|\b)(4320|2160|1440|1080|720|480|360)[pP]?(?:\.|\/|_|-|\b|$)/i);
            if (urlMatch) {
              height = parseInt(urlMatch[1], 10);
            }
          }

          // Fallback to bandwidth heuristics
          if (!height) {
            if (currentBw >= 7000000) height = 2160;
            else if (currentBw >= 4500000) height = 1440;
            else if (currentBw >= 2800000) height = 1080;
            else if (currentBw >= 1400000) height = 720;
            else if (currentBw >= 700000) height = 480;
            else if (currentBw > 0) height = 360;
            else height = 1080;
          }

          if (!seenHeights.has(height)) {
            seenHeights.add(height);
            const is8k = height >= 4320;
            const is4k = height >= 2160;
            const is2k = height >= 1440;
            const is1080 = height >= 1080;
            const label = is8k ? '8K Ultra HD (4320p)' :
                          is4k ? '4K Ultra HD (2160p)' :
                          is2k ? '2K Quad HD (1440p)' :
                          is1080 ? 'Full HD (1080p)' :
                          height >= 720 ? 'HD (720p)' : `SD (${height}p)`;
            const badge = is8k ? '8K' : is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : height >= 720 ? 'HD' : 'SD';

            formats.push({
              formatId: `hls-${height}`,
              height: height,
              fps: 30,
              label: label,
              badge: badge,
              tbr: currentBw ? Math.round(currentBw / 1000) : null,
              ext: 'mp4',
              vcodec: 'h264',
              hasAudio: true,
              size: null,
              sizeFormatted: currentBw ? `~${Math.round(currentBw / 8 / 1024 / 1024 * 60)} MB/min` : 'Adaptive HD Stream',
              directUrl: subUrl,
              isHls: true
            });
          }
          currentRes = null;
        }
      }
    }
  } catch (e) {}
  return formats;
}

// ─── Embed Resolvers for Popular Tube Hosts ───

// Vidhide / Vidhidepro / Vidhidepre / Movearnpre / Filelions
async function resolveVidhideEmbed(embedUrl) {
  try {
    console.log('[Resolver:Vidhide] Probing embed:', embedUrl);
    const html = await fetchViaGateway(embedUrl);
    if (!html) return null;

    let unpacked = '';
    const scripts = html.match(/<script[\s\S]*?<\/script>/gi) || [];
    for (const s of scripts) {
      if (s.includes('eval(function(p,a,c,k,e,d)')) {
        const res = unpackJS(s);
        if (res) unpacked += res + '\n';
      }
    }

    const combined = html + '\n' + unpacked;
    const linksMatch = combined.match(/var\s+links\s*=\s*({[^}]+})/i) || combined.match(/links\s*=\s*({[^}]+})/i);
    let masterM3u8 = null;

    if (linksMatch) {
      try {
        const parsed = JSON.parse(linksMatch[1]);
        masterM3u8 = parsed.hls2 || parsed.hls3 || parsed.hls4 || parsed.hls;
      } catch (e) {
        const m = linksMatch[1].match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
        if (m) masterM3u8 = m[1];
      }
    }

    if (!masterM3u8) {
      const directM3u8 = combined.match(/['"](https?:\/\/[^'"\s<>]+\.m3u8[^'"\s<>]*)['"]/i);
      if (directM3u8) masterM3u8 = directM3u8[1];
    }

    if (masterM3u8) {
      console.log('[Resolver:Vidhide] Found master m3u8:', masterM3u8);
      return {
        provider: 'VidHide',
        streamUrl: masterM3u8,
        isHls: true
      };
    }
  } catch (err) {
    console.warn('[Resolver:Vidhide Error]:', err.message);
  }
  return null;
}

// Streamtape
async function resolveStreamtapeEmbed(embedUrl) {
  try {
    console.log('[Resolver:Streamtape] Probing embed:', embedUrl);
    let standardEmbed = embedUrl;
    if (embedUrl.includes('/v/')) {
      standardEmbed = embedUrl.replace('/v/', '/e/');
    }
    const html = await fetchViaGateway(standardEmbed);
    if (!html || html.includes('Video not found') || html.includes('deleted by the creator')) {
      return null;
    }

    const match = html.match(/document\.getElementById\(['"](robotlink|botlink|videolink)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*['"]([^'"]+)['"]/i);
    if (match) {
      let streamUrl = match[2] + match[3];
      if (streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;
      console.log('[Resolver:Streamtape] Found direct stream:', streamUrl);
      return {
        provider: 'Streamtape',
        streamUrl,
        isHls: false
      };
    }
  } catch (err) {
    console.warn('[Resolver:Streamtape Error]:', err.message);
  }
  return null;
}

// Streamwish / Strwish / Flaswish / Streamruby
async function resolveStreamwishEmbed(embedUrl) {
  try {
    console.log('[Resolver:Streamwish] Probing embed:', embedUrl);
    let standardEmbed = embedUrl;
    if (embedUrl.includes('/v/')) standardEmbed = embedUrl.replace('/v/', '/e/');
    const html = await fetchViaGateway(standardEmbed);
    if (!html) return null;

    let unpacked = '';
    const scripts = html.match(/<script[\s\S]*?<\/script>/gi) || [];
    for (const s of scripts) {
      if (s.includes('eval(function(p,a,c,k,e,d)')) {
        const res = unpackJS(s);
        if (res) unpacked += res + '\n';
      }
    }

    const combined = html + '\n' + unpacked;
    const match = combined.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i) ||
                  combined.match(/['"](https?:\/\/[^'"\s<>]+\.m3u8[^'"\s<>]*)['"]/i);
    if (match) {
      return {
        provider: 'Streamwish',
        streamUrl: match[1],
        isHls: true
      };
    }
  } catch (err) {
    console.warn('[Resolver:Streamwish Error]:', err.message);
  }
  return null;
}

// Doodstream / Dood
async function resolveDoodstreamEmbed(embedUrl) {
  try {
    console.log('[Resolver:Doodstream] Probing embed:', embedUrl);
    let standardEmbed = embedUrl;
    if (embedUrl.includes('/d/')) standardEmbed = embedUrl.replace('/d/', '/e/');
    const html = await fetchViaGateway(standardEmbed);
    if (!html) return null;

    const passMatch = html.match(/\/pass_md5\/[a-zA-Z0-9_\-\/]+/i);
    if (passMatch) {
      const passUrl = new URL(passMatch[0], standardEmbed).toString();
      const token = await fetchViaGateway(passUrl, { Referer: standardEmbed });
      if (token && token.startsWith('http')) {
        const directUrl = token.trim() + '~' + Array.from({length: 10}, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('') + '?token=' + passMatch[0].split('/').pop();
        return {
          provider: 'Doodstream',
          streamUrl: directUrl,
          isHls: false
        };
      }
    }
  } catch (err) {}
  return null;
}

// Generic Embed Resolver (HTML5 / JWPlayer / VideoJS)
async function resolveGenericEmbed(embedUrl) {
  try {
    const html = await fetchViaGateway(embedUrl);
    if (!html) return null;

    let unpacked = '';
    const scripts = html.match(/<script[\s\S]*?<\/script>/gi) || [];
    for (const s of scripts) {
      if (s.includes('eval(function(p,a,c,k,e,d)')) {
        const res = unpackJS(s);
        if (res) unpacked += res + '\n';
      }
    }
    const combined = html + '\n' + unpacked;

    const m3u8Match = combined.match(/['"](https?:\/\/[^'"\s<>]+\.m3u8[^'"\s<>]*)['"]/i);
    if (m3u8Match) {
      return {
        provider: 'HLS Media',
        streamUrl: m3u8Match[1],
        isHls: true
      };
    }

    const mp4Match = combined.match(/['"](https?:\/\/[^'"\s<>]+\.(?:mp4|webm)[^'"\s<>]*)['"]/i);
    if (mp4Match && !mp4Match[1].includes('/v/') && !mp4Match[1].includes('preview') && !mp4Match[1].includes('thumb')) {
      return {
        provider: 'Direct Media',
        streamUrl: mp4Match[1],
        isHls: false
      };
    }
  } catch (e) {}
  return null;
}

// ─── Cloud Gateway & Direct Stream Fallback Extractor (Bypasses ISP/DNS Blocks without VPN) ───
async function extractCloudFallback(targetUrl) {
  const isActualDirectMedia = /\.(?:mp4|webm|m3u8|mkv|mov|mp3|m4a)(?:[/?#]|$)/i.test(targetUrl) && 
                              !targetUrl.includes('/v/') && 
                              !targetUrl.includes('/watch') &&
                              !targetUrl.includes('streamtape') &&
                              !targetUrl.includes('youtube.com');

  if (isActualDirectMedia) {
    let height = 1080;
    if (/2160|4[kK]/i.test(targetUrl)) height = 2160;
    else if (/1440|2[kK]/i.test(targetUrl)) height = 1440;
    else if (/1080/i.test(targetUrl)) height = 1080;
    else if (/720/i.test(targetUrl)) height = 720;
    else if (/480/i.test(targetUrl)) height = 480;

    const is4k = height >= 2160;
    const is2k = height >= 1440;
    const is1080 = height >= 1080;
    const badge = is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : height >= 720 ? 'HD' : 'SD';
    const label = is4k ? '4K Ultra HD (2160p)' :
                  is2k ? '2K Quad HD (1440p)' :
                  is1080 ? 'Full HD (1080p)' :
                  height >= 720 ? 'HD (720p)' : `SD (${height}p)`;

    let parsedName = 'Direct Video Stream';
    try {
      const u = new URL(targetUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        parsedName = decodeURIComponent(parts[parts.length - 1]).replace(/\.(mp4|webm|m3u8|mkv)/gi, '').replace(/[_-]/g, ' ').trim();
      }
    } catch (e) {}

    return {
      title: parsedName || 'Direct Video Stream',
      thumbnail: '',
      duration: 0,
      durationFormatted: '--:--',
      uploader: 'Direct Stream',
      uploaderUrl: '',
      viewCount: null,
      site: 'Direct Media',
      webpageUrl: targetUrl,
      videoFormats: [
        {
          formatId: `direct-${height}`,
          height: height,
          fps: null,
          label: label,
          badge: badge,
          tbr: null,
          ext: 'mp4',
          vcodec: 'h264',
          hasAudio: true,
          size: null,
          sizeFormatted: 'Original Quality',
          directUrl: targetUrl,
          isHls: targetUrl.includes('.m3u8')
        }
      ],
      audioFormats: [
        {
          formatId: 'bestaudio',
          ext: 'mp3',
          quality: '320 kbps (High Quality)',
          abr: 320,
          size: null,
          sizeFormatted: 'Standard Size',
          container: 'mp3',
          codec: 'mp3',
          directUrl: targetUrl
        }
      ],
      originalFormatsCount: 1
    };
  }

  // Scrape page via cloud gateways
  const html = await fetchViaGateway(targetUrl);
  if (!html) throw new Error('Cloud fallback could not retrieve webpage.');

  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let title = titleMatch ? titleMatch[1].replace(/[-|_|\s]*Free.*$/i, '').replace(/[-|_|\s]*HD Porn.*$/i, '').trim() : 'Video';

  // Extract thumbnail
  const thumbMatch = html.match(/poster=['"]([^'"]+)['"]/i) || 
                     html.match(/preview_url\s*:\s*['"]([^'"]+)['"]/i) ||
                     html.match(/<meta\s+property=['"]og:image['"]\s+content=['"]([^'"]+)['"]/i) ||
                     html.match(/https?:\/\/img\.[^'"\s<>]+\.(?:jpg|png|webp)/i) ||
                     html.match(/https?:\/\/[^'"\s<>]+\/uploads\/[^'"\s<>]+\.(?:jpg|png|webp)/i);
  let rawThumb = thumbMatch ? (thumbMatch[1] || thumbMatch[0]) : '';
  const thumbnail = rawThumb ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : '';

  // Extract duration if available
  let duration = 0;
  const durMatch = html.match(/duration\s*:\s*['"]?(\d+)['"]?/i) || html.match(/length\s*=\s*['"]?(\d+)['"]?/i);
  if (durMatch) duration = parseInt(durMatch[1], 10);

  const videoFormats = [];
  const seenDirectUrls = new Set();
  const seenHeights = new Set();

  // 1. KVS & Tube Flashvars / Direct Player Config Parser
  const fvMatch = html.match(/var\s+flashvars\s*=\s*\{([\s\S]*?)\};/i) || html.match(/flashvars\s*=\s*\{([\s\S]*?)\};/i);
  if (fvMatch) {
    const fv = {};
    const entries = [...fvMatch[1].matchAll(/([a-zA-Z0-9_]+)\s*:\s*['"]([^'"]+)['"]/g)];
    entries.forEach(e => { fv[e[1]] = e[2]; });

    function determineHeight(urlKey, textKey, fhdKey, hdKey, previewHeightKey) {
      if (fv[textKey]) {
        const m = fv[textKey].match(/(\d+)/);
        if (m) return parseInt(m[1], 10);
        if (/4k|2160/i.test(fv[textKey])) return 2160;
        if (/2k|1440/i.test(fv[textKey])) return 1440;
        if (/fhd|1080/i.test(fv[textKey])) return 1080;
        if (/hd|720/i.test(fv[textKey])) return 720;
      }
      if (fv[fhdKey] === '1' || fv[fhdKey] === 1) return 1080;
      if (fv['video_url_4k'] === '1' && urlKey === 'video_url') return 2160;
      if (fv[previewHeightKey]) {
        const ph = parseInt(fv[previewHeightKey], 10);
        if (ph >= 360) return ph;
      }
      if (fv[hdKey] === '1' || fv[hdKey] === 1) return 720;

      const u = fv[urlKey] || '';
      if (/2160|4k/i.test(u)) return 2160;
      if (/1440|2k/i.test(u)) return 1440;
      if (/1080/i.test(u)) return 1080;
      if (/720/i.test(u)) return 720;
      if (/480/i.test(u)) return 480;
      if (/360/i.test(u)) return 360;

      return 1080;
    }

    const candidateUrls = [
      { urlKey: 'video_url', textKey: 'video_url_text', fhdKey: 'video_url_fhd', hdKey: 'video_url_hd', phKey: 'preview_height1' },
      { urlKey: 'video_alt_url', textKey: 'video_alt_url_text', fhdKey: 'video_alt_url_fhd', hdKey: 'video_alt_url_hd', phKey: 'preview_height2' },
      { urlKey: 'video_alt_url2', textKey: 'video_alt_url2_text', fhdKey: 'video_alt_url2_fhd', hdKey: 'video_alt_url2_hd', phKey: 'preview_height3' },
      { urlKey: 'video_alt_url3', textKey: 'video_alt_url3_text', fhdKey: 'video_alt_url3_fhd', hdKey: 'video_alt_url3_hd', phKey: 'preview_height4' },
      { urlKey: 'video_alt_url4', textKey: 'video_alt_url4_text', fhdKey: 'video_alt_url4_fhd', hdKey: 'video_alt_url4_hd', phKey: 'preview_height5' }
    ];

    for (const c of candidateUrls) {
      const directStreamUrl = fv[c.urlKey];
      if (directStreamUrl && (directStreamUrl.startsWith('http') || directStreamUrl.startsWith('//'))) {
        const fullStreamUrl = directStreamUrl.startsWith('//') ? `https:${directStreamUrl}` : directStreamUrl;
        const height = determineHeight(c.urlKey, c.textKey, c.fhdKey, c.hdKey, c.phKey);
        if (!seenHeights.has(height)) {
          seenHeights.add(height);
          const is8k = height >= 4320;
          const is4k = height >= 2160;
          const is2k = height >= 1440;
          const is1080 = height >= 1080;
          const badge = is8k ? '8K' : is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : height >= 720 ? 'HD' : 'SD';
          const label = is8k ? '8K Ultra HD (4320p)' :
                        is4k ? '4K Ultra HD (2160p)' :
                        is2k ? '2K Quad HD (1440p)' :
                        is1080 ? 'Full HD (1080p)' :
                        height >= 720 ? 'HD (720p)' : `SD (${height}p)`;

          videoFormats.push({
            formatId: `kvs-${height}`,
            height: height,
            fps: 30,
            label: label,
            badge: badge,
            tbr: null,
            ext: 'mp4',
            vcodec: 'h264',
            hasAudio: true,
            size: null,
            sizeFormatted: 'Direct High Quality Stream',
            directUrl: fullStreamUrl,
            isHls: fullStreamUrl.includes('.m3u8')
          });
        }
      }
    }
  }

  // 2. Gather all embedded iframe and host URLs
  const iframes = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  const candidateEmbeds = new Set(iframes);

  const generalLinks = html.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const l of generalLinks) {
    if (/streamtape|vidhide|movearnpre|filelions|dood|streamwish|strwish|flaswish|mixdrop|voe\.sx|streamruby/i.test(l)) {
      candidateEmbeds.add(l);
    }
  }

  console.log(`[Cloud Fallback] Found ${candidateEmbeds.size} embed candidates to probe...`);

  for (const embedUrl of candidateEmbeds) {
    let resolved = null;
    if (/vidhide|movearnpre|filelions|vidembed/i.test(embedUrl)) {
      resolved = await resolveVidhideEmbed(embedUrl);
    } else if (/streamtape/i.test(embedUrl)) {
      resolved = await resolveStreamtapeEmbed(embedUrl);
    } else if (/streamwish|strwish|flaswish|streamruby/i.test(embedUrl)) {
      resolved = await resolveStreamwishEmbed(embedUrl);
    } else if (/dood/i.test(embedUrl)) {
      resolved = await resolveDoodstreamEmbed(embedUrl);
    } else {
      resolved = await resolveGenericEmbed(embedUrl);
    }

    if (resolved && resolved.streamUrl && !seenDirectUrls.has(resolved.streamUrl)) {
      seenDirectUrls.add(resolved.streamUrl);
      console.log(`[Cloud Fallback] Successfully resolved provider [${resolved.provider}]:`, resolved.streamUrl);

      // If it's an HLS master playlist, parse sub-variants
      if (resolved.isHls) {
        const subFormats = await parseMasterM3u8Streams(resolved.streamUrl, embedUrl);
        for (const sf of subFormats) {
          if (!seenHeights.has(sf.height)) {
            seenHeights.add(sf.height);
            videoFormats.push(sf);
          }
        }
      }

      // If no sub-variants were parsed (or direct single stream), detect best quality from stream & page
      if (videoFormats.length === 0 || !resolved.isHls) {
        const combined = `${resolved.streamUrl} ${embedUrl} ${title} ${html}`;
        let height = 1080;
        if (/\b(?:8[kK]|4320[pP]?)\b/i.test(combined)) height = 4320;
        else if (/\b(?:4[kK]|2160[pP]?|UHD)\b/i.test(combined)) height = 2160;
        else if (/\b(?:2[kK]|1440[pP]?|QHD)\b/i.test(combined)) height = 1440;
        else if (/\b(?:1080[pP]?|Full\s*HD|FHD)\b/i.test(combined)) height = 1080;
        else if (/\b(?:720[pP]?|HD)\b/i.test(combined)) height = 720;
        else if (/\b(?:480[pP]?)\b/i.test(combined)) height = 480;
        else if (/\b(?:360[pP]?)\b/i.test(combined)) height = 360;

        if (!seenHeights.has(height)) {
          seenHeights.add(height);
          const is8k = height >= 4320;
          const is4k = height >= 2160;
          const is2k = height >= 1440;
          const is1080 = height >= 1080;
          const badge = is8k ? '8K' : is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : height >= 720 ? 'HD' : 'SD';
          const label = is8k ? '8K Ultra HD (4320p)' :
                        is4k ? '4K Ultra HD (2160p)' :
                        is2k ? '2K Quad HD (1440p)' :
                        is1080 ? 'Full HD (1080p)' :
                        height >= 720 ? 'HD (720p)' : `SD (${height}p)`;

          videoFormats.push({
            formatId: `cloud-${height}`,
            height: height,
            fps: 30,
            label: label,
            badge: badge,
            tbr: null,
            ext: 'mp4',
            vcodec: 'h264',
            hasAudio: true,
            size: null,
            sizeFormatted: 'Best Available HD Quality',
            directUrl: resolved.streamUrl,
            isHls: resolved.isHls
          });
        }
      }
    }
  }

  // 2. Direct page media fallback (video tags & inline m3u8) if embeds gave nothing
  if (videoFormats.length === 0) {
    const directMatches = html.matchAll(/['"](https?:\/\/[^'"\s<>]*(?:\/get_file\/|\.mp4|\.m3u8)[^'"\s<>]*)['"]/gi);
    for (const match of directMatches) {
      const streamUrl = match[1];
      if (
        seenDirectUrls.has(streamUrl) || 
        streamUrl.includes('preview') || 
        streamUrl.includes('thumb') || 
        streamUrl.includes('screenshots') ||
        streamUrl.includes('screenshot') ||
        streamUrl.includes('mediabook') ||
        streamUrl.includes('timeline') ||
        streamUrl.includes('storyboard') ||
        streamUrl.includes('trailer') ||
        streamUrl.includes('poster') ||
        streamUrl.includes('/v/') ||
        streamUrl.includes('streamtape')
      ) {
        continue;
      }
      seenDirectUrls.add(streamUrl);

      const combined = `${streamUrl} ${title} ${html}`;
      let height = 1080;
      if (/\b(?:8[kK]|4320[pP]?)\b/i.test(combined)) height = 4320;
      else if (/\b(?:4[kK]|2160[pP]?|UHD)\b/i.test(combined)) height = 2160;
      else if (/\b(?:2[kK]|1440[pP]?|QHD)\b/i.test(combined)) height = 1440;
      else if (/\b(?:1080[pP]?|Full\s*HD|FHD)\b/i.test(combined)) height = 1080;
      else if (/\b(?:720[pP]?|HD)\b/i.test(combined)) height = 720;
      else if (/\b(?:480[pP]?)\b/i.test(combined)) height = 480;
      else if (/\b(?:360[pP]?)\b/i.test(combined)) height = 360;

      if (!seenHeights.has(height)) {
        seenHeights.add(height);
        const is8k = height >= 4320;
        const is4k = height >= 2160;
        const is2k = height >= 1440;
        const is1080 = height >= 1080;
        const badge = is8k ? '8K' : is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : height >= 720 ? 'HD' : 'SD';
        const label = is8k ? '8K Ultra HD (4320p)' :
                      is4k ? '4K Ultra HD (2160p)' :
                      is2k ? '2K Quad HD (1440p)' :
                      is1080 ? 'Full HD (1080p)' :
                      height >= 720 ? 'HD (720p)' : `SD (${height}p)`;

        videoFormats.push({
          formatId: `cloud-${height}`,
          height: height,
          fps: null,
          label: label,
          badge: badge,
          tbr: null,
          ext: 'mp4',
          vcodec: 'h264',
          hasAudio: true,
          size: null,
          sizeFormatted: 'Original Quality',
          directUrl: streamUrl,
          isHls: streamUrl.includes('.m3u8')
        });
      }
    }
  }

  videoFormats.sort((a, b) => b.height - a.height);

  return {
    title,
    thumbnail,
    duration,
    durationFormatted: formatDuration(duration),
    uploader: 'Web Video Stream',
    uploaderUrl: '',
    viewCount: null,
    site: 'Cloud Extractor',
    webpageUrl: targetUrl,
    videoFormats,
    audioFormats: [
      {
        formatId: 'bestaudio',
        ext: 'mp3',
        quality: '320 kbps (High Quality)',
        abr: 320,
        size: duration > 0 ? Math.round((320000 / 8) * duration) : null,
        sizeFormatted: formatBytes(duration > 0 ? Math.round((320000 / 8) * duration) : null),
        container: 'mp3',
        codec: 'mp3',
        directUrl: videoFormats[0]?.directUrl
      }
    ],
    originalFormatsCount: videoFormats.length
  };
}

// API: Proxy Image (Bypasses ISP image CDN blocking)
app.get('/api/proxy-image', proxyRateLimiter, async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).send('Invalid URL');
  }

  let decoded;
  try {
    decoded = decodeURIComponent(url).trim();
  } catch (e) {
    return res.status(400).send('Malformed URL');
  }

  if (isPrivateOrLocalUrl(decoded)) {
    return res.status(400).send('Restricted or invalid image URL');
  }

  const gateways = [
    `https://proxy.cors.sh/${decoded}`,
    `https://corsproxy.org/?${encodeURIComponent(decoded)}`,
    decoded
  ];

  for (const gw of gateways) {
    try {
      const response = await fetch(gw, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': decoded.startsWith('http') ? new URL(decoded).origin + '/' : ''
        },
        signal: AbortSignal.timeout(6000)
      });
      if (response.ok) {
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        if (!contentType.startsWith('image/')) {
          continue;
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buf = Buffer.from(await response.arrayBuffer());
        if (buf.length > 10 * 1024 * 1024) { // Max 10MB image limit
          return res.status(413).send('Image too large');
        }
        return res.send(buf);
      }
    } catch (e) {}
  }

  res.redirect('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="%23141b2d"/><text x="50%" y="50%" fill="%23818cf8" font-size="20" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">▶ Video Stream</text></svg>');
});

// API: Status
app.get('/api/status', pollingRateLimiter, (req, res) => {
  res.json({
    ok: true,
    ytdlpAvailable: isBinaryAvailable(getYtdlpPath()),
    ffmpegAvailable: isBinaryAvailable(getFfmpegPath()),
    downloadsDir: DOWNLOADS_DIR,
    version: '3.4.0'
  });
});

// API: Analyze Video URL (Calculates exact sizes for all formats)
app.post('/api/analyze', analyzeRateLimiter, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || isPrivateOrLocalUrl(url.trim())) {
    return res.status(400).json({ ok: false, error: 'Please provide a valid public video URL.' });
  }

  const trimmedUrl = url.trim();
  console.log(`[Analyze] Probing URL: ${trimmedUrl}`);

  // 1. Direct XHamster / Mirror Extractor
  if (isXHamsterUrl(trimmedUrl)) {
    try {
      const data = await extractXHamsterData(trimmedUrl);
      if (data.videoFormats && data.videoFormats.length > 0) {
        return res.json({ ok: true, data });
      }
    } catch (xhErr) {
      console.warn('[XHamster Direct Extractor Failed, falling back to yt-dlp]:', xhErr.message);
    }
  }

  // 2. Universal yt-dlp Extractor
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--ffmpeg-location', getFfmpegPath(),
    '--extractor-args', 'youtube:player_client=default,web,android,ios,mweb',
    '--js-runtimes', 'node',
    '-j',
    trimmedUrl
  ];

  const ytdlp = spawn(getYtdlpPath(), args);
  let stdoutData = '';
  let stderrData = '';

  ytdlp.stdout.on('data', (chunk) => {
    stdoutData += chunk.toString();
  });

  ytdlp.stderr.on('data', (chunk) => {
    stderrData += chunk.toString();
  });

  ytdlp.on('close', async (code) => {
    if (code !== 0 || !stdoutData.trim()) {
      console.warn(`[yt-dlp Failed (code ${code})]: Attempting Automated Cloud Fallback Extractor for ${trimmedUrl}...`);
      let cloudSuccess = false;
      let cloudHtmlFetched = false;
      
      try {
        const cloudData = await extractCloudFallback(trimmedUrl);
        if (cloudData) {
          cloudHtmlFetched = true;
          if (cloudData.videoFormats && cloudData.videoFormats.length > 0) {
            console.log(`[Cloud Fallback Success]: Extracted ${cloudData.videoFormats.length} video stream formats without VPN!`);
            return res.json({ ok: true, data: cloudData });
          }
        }
      } catch (cloudErr) {
        console.warn('[Cloud Fallback Also Failed]:', cloudErr.message);
      }

      console.error(`[Analyze Error] code ${code}: ${stderrData}`);
      let userError = cloudHtmlFetched
        ? 'No playable video stream found on this webpage. This page appears to be an ad portal or thumbnail preview without an embedded video file. Please use a direct video link from a supported provider.'
        : 'Could not fetch video information. Please make sure the link is public and accessible.';
      
      if (
        stderrData.includes('Failed to resolve') ||
        stderrData.includes('getaddrinfo failed') ||
        stderrData.includes('Name or service not known') ||
        stderrData.includes('nodename nor servname provided') ||
        stderrData.includes('DNS operation refused') ||
        stderrData.includes('11001') ||
        stderrData.includes('WSAHOST_NOT_FOUND')
      ) {
        userError = 'DNS Resolution Blocked: The website domain cannot be reached. It is blocked by your ISP, local network, or DNS filter (RCODE_REFUSED / Errno 11001). Please use a full VPN (e.g. ProtonVPN, NordVPN) or check if your DNS filter/WARP mode is blocking adult domains.';
      } else if (
        stderrData.includes('Connection was reset') ||
        stderrData.includes('ECONNRESET') ||
        stderrData.includes('ConnectionResetError') ||
        stderrData.includes('10054') ||
        stderrData.includes('forcibly closed by the remote host') ||
        stderrData.includes('Connection aborted') ||
        stderrData.includes('Recv failure') ||
        stderrData.includes('connection reset by peer') ||
        stderrData.includes('WSAECONNRESET') ||
        stderrData.includes('RemoteDisconnected')
      ) {
        userError = 'Connection Forcibly Reset (Error 10054 / ECONNRESET): The connection was intercepted and closed by your ISP or network firewall. Cloudflare WARP in DNS-only mode or Family mode does not bypass this DPI filter. Please use a full encrypted VPN (such as ProtonVPN, Windscribe, or WARP in full tunnel mode) or try a different website.';
      } else if (
        stderrData.includes('timed out') ||
        stderrData.includes('ETIMEDOUT') ||
        stderrData.includes('timed out after') ||
        stderrData.includes('10060') ||
        stderrData.includes('WSAETIMEDOUT')
      ) {
        userError = 'Connection Timed Out (Error 10060): The video host took too long to respond. The server may be overloaded or blocked by a firewall.';
      } else if (
        stderrData.includes('ConnectionRefusedError') ||
        stderrData.includes('10061') ||
        stderrData.includes('WSAECONNREFUSED')
      ) {
        userError = 'Connection Refused (Error 10061): The remote host actively refused the connection.';
      } else if (
        stderrData.includes('SSL/TLS') ||
        stderrData.includes('CERTIFICATE_VERIFY_FAILED') ||
        stderrData.includes('handshake failed') ||
        stderrData.includes('SSLError')
      ) {
        userError = 'SSL/TLS Handshake Error: Secure connection failed or was intercepted by a network filter.';
      } else if (stderrData.includes('Private video')) {
        userError = 'This video is private and cannot be downloaded.';
      } else if (
        stderrData.includes('Sign in') ||
        stderrData.includes('requires login') ||
        stderrData.includes('age-restricted')
      ) {
        userError = 'This video requires login or is age-restricted.';
      } else if (stderrData.includes('HTTP Error 403') || stderrData.includes('Forbidden')) {
        userError = 'Access Forbidden (HTTP 403). The server denied access to this stream.';
      } else if (stderrData.includes('HTTP Error 404') || stderrData.includes('Not Found')) {
        userError = 'Video not found (HTTP 404). Please verify the link.';
      } else if (
        stderrData.includes('not available in your country') ||
        stderrData.includes('Georestricted') ||
        stderrData.includes('geo-restricted')
      ) {
        userError = 'Geo-Restricted: This video is not available in your region. A VPN in a supported country is required.';
      } else if (stderrData.includes('Unsupported URL')) {
        userError = 'Unsupported URL. Please check the link.';
      }
      
      return res.status(400).json({ ok: false, error: userError, details: stderrData });
    }

    try {
      let info = null;
      const lines = stdoutData.trim().split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && (parsed.formats || parsed.url || parsed.title)) {
            if (!info || (parsed.formats && parsed.formats.length > (info.formats?.length || 0))) {
              info = parsed;
            }
          }
        } catch (e) {}
      }
      if (!info && lines.length > 0) {
        info = JSON.parse(lines[0]);
      }
      if (!info) {
        throw new Error('Failed to parse yt-dlp output');
      }

      const rawFormats = info.formats || [];
      const duration = info.duration || 0;

      const videoOptions = [];
      const audioOptions = [];
      const seenHeights = new Map();

      const bestAudio = rawFormats
        .filter((f) => f.vcodec === 'none' && f.acodec !== 'none')
        .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];

      let bestAudioSize = bestAudio ? (bestAudio.filesize || bestAudio.filesize_approx || 0) : 0;
      if (!bestAudioSize && bestAudio && duration > 0) {
        const abr = bestAudio.abr || bestAudio.tbr || 128;
        bestAudioSize = Math.round((abr * 1000 / 8) * duration);
      }

      for (const f of rawFormats) {
        // Skip storyboard image strips, invalid URLs and non-video formats
        if (
          !f ||
          f.ext === 'mhtml' ||
          f.format_note === 'storyboard' ||
          f.vcodec === 'images' ||
          (f.vcodec === 'none' && f.acodec === 'none') ||
          (f.url && (f.url.includes("'+") || f.url.includes("video_url") || !f.url.startsWith('http')))
        ) {
          continue;
        }

        if (f.vcodec === 'none' && f.acodec !== 'none') {
          const abr = Math.round(f.abr || f.tbr || 128);
          let audioSize = f.filesize || f.filesize_approx || 0;
          if (!audioSize && duration > 0 && abr > 0) {
            audioSize = Math.round((abr * 1000 / 8) * duration);
          }

          audioOptions.push({
            formatId: f.format_id,
            ext: f.ext === 'webm' ? 'mp3' : (f.ext || 'mp3'),
            quality: `${abr} kbps`,
            abr: abr,
            size: audioSize,
            sizeFormatted: formatBytes(audioSize),
            container: f.container || f.ext,
            codec: f.acodec
          });
          continue;
        }

        let height = f.height || 0;
        if (!height && f.resolution) {
          const m = f.resolution.match(/(\d+)x(\d+)/);
          if (m) {
            const w = parseInt(m[1], 10);
            const h = parseInt(m[2], 10);
            height = (w > 0 && h > 0) ? (w > h ? h : w) : (h || w);
          }
        }
        if (!height && f.format_note) {
          const m = f.format_note.match(/(\d+)[pP]/);
          if (m) height = parseInt(m[1], 10);
        }
        if (!height && f.format) {
          const m = f.format.match(/(\d+)[pP]/);
          if (m) height = parseInt(m[1], 10);
        }
        if (!height && f.width && f.height) {
          height = Math.min(f.width, f.height);
        }

        // Infer resolution from URL, format_id, format_note, or title
        if (!height) {
          const combinedStr = `${f.url || ''} ${f.format_id || ''} ${f.format_note || ''} ${f.format || ''} ${info.title || ''}`;
          if (/\b(?:8[kK]|4320[pP]?)\b/i.test(combinedStr)) height = 4320;
          else if (/\b(?:4[kK]|2160[pP]?|UHD)\b/i.test(combinedStr)) height = 2160;
          else if (/\b(?:2[kK]|1440[pP]?|QHD)\b/i.test(combinedStr)) height = 1440;
          else if (/\b(?:1080[pP]?|Full\s*HD|FHD)\b/i.test(combinedStr)) height = 1080;
          else if (/\b(?:720[pP]?|HD)\b/i.test(combinedStr)) height = 720;
          else if (/\b(?:480[pP]?)\b/i.test(combinedStr)) height = 480;
          else if (/\b(?:360[pP]?)\b/i.test(combinedStr)) height = 360;
          else height = info.height || 1080;
        }

        const fps = (f.fps && f.fps > 30) ? Math.round(f.fps) : null;
        const is60fps = fps && fps >= 50;
        const label = height >= 4320 ? `8K Ultra HD (4320p${is60fps ? ' 60fps' : ''})` :
                      height >= 2160 ? `4K Ultra HD (2160p${is60fps ? ' 60fps' : ''})` :
                      height >= 1440 ? `2K Quad HD (1440p${is60fps ? ' 60fps' : ''})` :
                      height >= 1080 ? `Full HD (1080p${is60fps ? ' 60fps' : ''})` :
                      height >= 720  ? `HD (720p${is60fps ? ' 60fps' : ''})` :
                      height >= 480  ? 'SD (480p)' :
                      height >= 360  ? 'SD (360p)' :
                      `${height}p`;

        let approxSize = f.filesize || f.filesize_approx || 0;
        const currentTbr = f.tbr || f.vbr || 0;
        if (!approxSize && duration > 0 && currentTbr > 0) {
          approxSize = Math.round((currentTbr * 1000 / 8) * duration);
        } else if (f.acodec === 'none' && approxSize > 0 && bestAudioSize > 0) {
          approxSize += bestAudioSize;
        }

        const qualityBadge = height >= 4320 ? '8K' :
                             height >= 2160 ? '4K' :
                             height >= 1440 ? '2K' :
                             height >= 1080 ? '1080P' :
                             height >= 720  ? 'HD' : 'SD';

        const existing = seenHeights.get(height);

        const isDirectHls = f.url && f.url.includes('.m3u8');
        const isStandaloneFile = (info.extractor_key === 'HTML5MediaEmbed' || info.extractor_key === 'generic' || !info.extractor_key) && 
          f.url && 
          (f.url.includes('.mp4') || f.url.includes('.webm')) && 
          !f.url.includes('googlevideo.com') &&
          !f.url.includes('youtube.com');

        const validDirectUrl = isDirectHls ? f.url : (isStandaloneFile ? f.url : null);

        // Keep highest bitrate and preferred format for this height
        if (!existing || (currentTbr > (existing.tbr || 0)) || (f.ext === 'mp4' && existing.ext !== 'mp4' && currentTbr >= (existing.tbr || 0) * 0.75)) {
          seenHeights.set(height, {
            formatId: f.format_id,
            height: height,
            fps: fps,
            label: label,
            badge: qualityBadge,
            tbr: currentTbr,
            ext: 'mp4',
            vcodec: f.vcodec,
            hasAudio: f.acodec !== 'none',
            size: approxSize,
            sizeFormatted: formatBytes(approxSize),
            directUrl: validDirectUrl
          });
        }
      }

      let sortedVideos = Array.from(seenHeights.values()).sort((a, b) => b.height - a.height);

      // Fallback: If no video formats were parsed from formats list, synthesize best video option
      if (sortedVideos.length === 0) {
        if (info.url && (info.url.includes("'+") || info.url.includes("video_url") || !info.url.startsWith('http'))) {
          info.url = null;
        }

        if (!info.url && (info.extractor_key === 'HTML5MediaEmbed' || info.extractor_key === 'generic' || !info.extractor_key)) {
          console.warn('[yt-dlp found no valid stream URL]: Attempting Cloud Fallback Extractor...');
          try {
            const cloudData = await extractCloudFallback(trimmedUrl);
            if (cloudData && cloudData.videoFormats && cloudData.videoFormats.length > 0) {
              return res.json({ ok: true, data: cloudData });
            }
          } catch (e) {}

          return res.status(400).json({
            ok: false,
            error: 'No playable video stream found on this page. The host server has no active media stream for this movie entry. Please use a direct mirror link.'
          });
        }

        let fallbackHeight = info.height || 0;
        const titleAndUrl = `${info.title || ''} ${info.url || ''} ${trimmedUrl}`;
        if (!fallbackHeight) {
          if (/\b8[kK]\b|4320[pP]?/i.test(titleAndUrl)) fallbackHeight = 4320;
          else if (/\b4[kK]\b|2160[pP]?/i.test(titleAndUrl)) fallbackHeight = 2160;
          else if (/\b2[kK]\b|1440[pP]?/i.test(titleAndUrl)) fallbackHeight = 1440;
          else if (/1080[pP]?/i.test(titleAndUrl)) fallbackHeight = 1080;
          else if (/720[pP]?/i.test(titleAndUrl)) fallbackHeight = 720;
          else fallbackHeight = 1080;
        }

        const is8k = fallbackHeight >= 4320;
        const is4k = fallbackHeight >= 2160;
        const is2k = fallbackHeight >= 1440;
        const is1080 = fallbackHeight >= 1080;

        const badge = is8k ? '8K' : is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : 'BEST';
        const label = is8k ? '8K Ultra HD (4320p)' :
                      is4k ? '4K Ultra HD (2160p)' :
                      is2k ? '2K Quad HD (1440p)' :
                      is1080 ? 'Full HD (1080p)' :
                      'Original Video (Best Available)';

        const isDirectHlsFallback = info.url && info.url.includes('.m3u8');
        const isStandaloneFileFallback = (info.extractor_key === 'HTML5MediaEmbed' || info.extractor_key === 'generic' || !info.extractor_key) && 
          info.url && 
          (info.url.includes('.mp4') || info.url.includes('.webm')) && 
          !info.url.includes('googlevideo.com') &&
          !info.url.includes('youtube.com');

        const validDirectUrlFallback = isDirectHlsFallback ? info.url : (isStandaloneFileFallback ? info.url : null);

        sortedVideos.push({
          formatId: info.format_id || 'best',
          height: fallbackHeight,
          fps: info.fps || null,
          label: label,
          badge: badge,
          tbr: info.tbr || 0,
          ext: 'mp4',
          vcodec: info.vcodec || 'h264',
          hasAudio: true,
          size: info.filesize || info.filesize_approx || null,
          sizeFormatted: formatBytes(info.filesize || info.filesize_approx || null),
          directUrl: validDirectUrlFallback
        });
      }

      // Ensure at least one Audio option exists
      if (audioOptions.length === 0) {
        audioOptions.push({
          formatId: 'bestaudio',
          ext: 'mp3',
          quality: '320 kbps (High Fidelity)',
          abr: 320,
          size: duration > 0 ? Math.round((320000 / 8) * duration) : null,
          sizeFormatted: formatBytes(duration > 0 ? Math.round((320000 / 8) * duration) : null),
          container: 'mp3',
          codec: 'mp3'
        });
      }

      const sortedAudios = audioOptions.sort((a, b) => (b.abr || 0) - (a.abr || 0));

      let thumbnail = info.thumbnail || (info.thumbnails && info.thumbnails[info.thumbnails.length - 1]?.url) || '';
      if (!thumbnail) {
        try {
          const pageHtml = await fetchText(trimmedUrl);
          const metaImg = pageHtml.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/i) ||
                          pageHtml.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i) ||
                          pageHtml.match(/<link\s+rel=["'](?:image_src|thumbnail)["']\s+href=["']([^"']+)["']/i) ||
                          pageHtml.match(/<img[^>]+(?:class=["'][^"']*(?:poster|thumb|img-responsive)[^"']*["']|id=["']poster["'])[^>]+src=["']([^"']+)["']/i);
          if (metaImg && metaImg[1]) {
            thumbnail = metaImg[1].startsWith('//') ? 'https:' + metaImg[1] : (metaImg[1].startsWith('/') ? new URL(metaImg[1], trimmedUrl).toString() : metaImg[1]);
          }
        } catch (e) {}
      }

      res.json({
        ok: true,
        data: {
          title: info.title || 'Untitled Video',
          thumbnail: thumbnail,
          duration: info.duration,
          durationFormatted: formatDuration(info.duration),
          uploader: info.uploader || info.channel || 'Unknown Creator',
          uploaderUrl: info.uploader_url || info.channel_url || '',
          viewCount: info.view_count ? info.view_count.toLocaleString() : null,
          site: info.extractor_key || info.extractor || 'Web',
          webpageUrl: info.webpage_url || trimmedUrl,
          videoFormats: sortedVideos,
          audioFormats: sortedAudios,
          originalFormatsCount: rawFormats.length
        }
      });
    } catch (parseErr) {
      console.error('[Analyze Parse Error]:', parseErr);
      res.status(500).json({ ok: false, error: 'Failed to parse video metadata.' });
    }
  });
});

// ============================================================================
// POST /api/download (Starts turbo background worker with live SSE progress)
// ============================================================================
app.post('/api/download', downloadRateLimiter, async (req, res) => {
  const { url, title, formatId, height, isAudio, directUrl, ext } = req.body;
  if (!url && !directUrl) {
    return res.status(400).json({ ok: false, error: 'Video URL is required.' });
  }

  if ((url && isPrivateOrLocalUrl(url)) || (directUrl && isPrivateOrLocalUrl(directUrl))) {
    return res.status(400).json({ ok: false, error: 'Invalid or restricted video URL.' });
  }

  const clientIp = getClientIp(req);
  const currentConcurrent = activeDownloadsPerIp.get(clientIp) || 0;
  if (currentConcurrent >= MAX_CONCURRENT_DOWNLOADS_PER_IP) {
    return res.status(429).json({
      ok: false,
      error: `Concurrency limit reached: You currently have ${currentConcurrent} active download task(s) in progress. Please wait for them to finish or cancel one before starting a new download.`,
      code: 'CONCURRENCY_LIMIT_EXCEEDED',
      limit: MAX_CONCURRENT_DOWNLOADS_PER_IP
    });
  }

  const downloadId = Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
  claimIpDownloadSlot(clientIp, downloadId);

  const isAudioFlag = isAudio === true || isAudio === 'true';
  const cleanExt = (isAudioFlag ? 'mp3' : (ext || 'mp4')).toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || (isAudioFlag ? 'mp3' : 'mp4');
  const safeTitle = sanitizeFilename(title || 'video');
  const cleanFilename = `${safeTitle}.${cleanExt}`;
  const localSavedPath = path.join(DOWNLOADS_DIR, cleanFilename);

  const safeFormatId = (formatId && typeof formatId === 'string' && /^[a-zA-Z0-9_+./-]+$/.test(formatId.trim())) ? formatId.trim() : null;
  const safeHeight = (height && parseInt(height, 10) > 0 && parseInt(height, 10) <= 10000) ? parseInt(height, 10) : null;

  const downloadState = {
    id: downloadId,
    title: safeTitle,
    filename: cleanFilename,
    status: 'downloading',
    percent: 0,
    speed: '-- MB/s',
    eta: '--',
    totalSize: '--',
    outputFile: cleanFilename,
    fileUrl: `/api/file/${downloadId}`
  };

  activeDownloads.set(downloadId, downloadState);
  res.json({ ok: true, downloadId, filename: cleanFilename });

  const notifyProgress = (data) => {
    Object.assign(downloadState, data);
    const client = progressListeners.get(downloadId);
    if (client) {
      client.write(`data: ${JSON.stringify(downloadState)}\n\n`);
    }
  };

  // 1. Direct HLS Multi-Threaded Engine (16 connections, 3.5+ MB/s)
  if (directUrl && directUrl.includes('.m3u8')) {
    const abortController = new AbortController();
    activeProcesses.set(downloadId, { abortController, path: localSavedPath });

    try {
      await downloadHLSParallel(directUrl, localSavedPath, isAudioFlag, (p) => {
        notifyProgress({
          status: 'downloading',
          percent: p.percent,
          speed: p.speed,
          eta: p.eta,
          totalSize: p.totalSize
        });
      }, abortController);

      activeProcesses.delete(downloadId);
      releaseIpDownloadSlot(downloadId);
      notifyProgress({
        status: 'completed',
        percent: 100,
        speed: 'Finished',
        eta: '0s'
      });
      return;
    } catch (hlsErr) {
      activeProcesses.delete(downloadId);
      releaseIpDownloadSlot(downloadId);
      if (hlsErr.message === 'CANCELLED') {
        notifyProgress({ status: 'cancelled', speed: 'Cancelled', eta: '--' });
      } else {
        console.error('[Parallel HLS Error]:', hlsErr);
        notifyProgress({ status: 'error', error: hlsErr.message });
      }
      return;
    }
  }

  // 2. Direct HTTP Multi-Socket Engine for direct MP4/video files (16 parallel connections)
  if (
    directUrl && 
    !isAudioFlag && 
    (directUrl.startsWith('http://') || directUrl.startsWith('https://')) &&
    !directUrl.includes('googlevideo.com') &&
    !directUrl.includes('youtube.com') &&
    !directUrl.includes('youtu.be')
  ) {
    const abortController = new AbortController();
    activeProcesses.set(downloadId, { abortController, path: localSavedPath });

    try {
      await downloadDirectParallelHTTP(directUrl, localSavedPath, (p) => {
        notifyProgress({
          status: 'downloading',
          percent: p.percent,
          speed: p.speed,
          eta: p.eta,
          totalSize: p.totalSize
        });
      }, abortController);

      activeProcesses.delete(downloadId);
      releaseIpDownloadSlot(downloadId);
      notifyProgress({
        status: 'completed',
        percent: 100,
        speed: 'Finished',
        eta: '0s'
      });
      return;
    } catch (parallelErr) {
      activeProcesses.delete(downloadId);
      if (parallelErr.message === 'CANCELLED') {
        releaseIpDownloadSlot(downloadId);
        notifyProgress({ status: 'cancelled', speed: 'Cancelled', eta: '--' });
        return;
      }
      console.warn('[Direct Parallel HTTP Downloader skipped/fallback]:', parallelErr.message);
      // Fall through to yt-dlp seamlessly (IP download slot remains claimed)
    }
  }

  // 3. Universal yt-dlp Multi-Threaded Downloader (-N 16 & chunk buffers & anti-throttle)
  const ytdlpArgs = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '-N', '16',
    '--concurrent-fragments', '16',
    '--http-chunk-size', '10M',
    '--throttled-rate', '100K',
    '--buffer-size', '64M',
    '--retries', '10',
    '--fragment-retries', '10',
    '--ffmpeg-location', getFfmpegPath(),
    '--extractor-args', 'youtube:player_client=default,web,android,ios,mweb',
    '--js-runtimes', 'node',
    '-o', localSavedPath
  ];

  if (isAudioFlag) {
    ytdlpArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    if (safeFormatId && !safeFormatId.startsWith('hls-') && !safeFormatId.startsWith('mp4-')) {
      if (safeHeight) {
        ytdlpArgs.push('-f', `${safeFormatId}/${safeFormatId}+bestaudio/bestvideo[height=${safeHeight}]+bestaudio/bestvideo[height<=${safeHeight}]+bestaudio/best[height=${safeHeight}]/best[height<=${safeHeight}]/bestvideo+bestaudio/best`);
      } else {
        ytdlpArgs.push('-f', `${safeFormatId}/${safeFormatId}+bestaudio/bestvideo+bestaudio/best`);
      }
      ytdlpArgs.push('--merge-output-format', 'mp4');
    } else if (safeHeight) {
      ytdlpArgs.push('-f', `bestvideo[height=${safeHeight}]+bestaudio/bestvideo[height<=${safeHeight}]+bestaudio/best[height=${safeHeight}]/best[height<=${safeHeight}]/bestvideo+bestaudio/best`);
      ytdlpArgs.push('--merge-output-format', 'mp4');
    } else {
      ytdlpArgs.push('-f', 'bestvideo+bestaudio/best');
      ytdlpArgs.push('--merge-output-format', 'mp4');
    }
  }

  // Add Referer and User-Agent headers to yt-dlp to bypass bot protection
  const targetDownloadUrl = directUrl || url;
  try {
    const parsedTarget = new URL(targetDownloadUrl);
    ytdlpArgs.push('--add-header', `Referer:${parsedTarget.protocol}//${parsedTarget.hostname}/`);
    ytdlpArgs.push('--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  } catch (e) {}

  ytdlpArgs.push(targetDownloadUrl);

  const proc = spawn(getYtdlpPath(), ytdlpArgs);
  activeProcesses.set(downloadId, { proc, path: localSavedPath });

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    const match = text.match(/\[download\]\s+([\d\.]+)%\s+of\s+~?([\d\.]+\w+)\s+at\s+([\d\.]+\w+\/s)\s+ETA\s+([\d:]+)/i) ||
                  text.match(/\[download\]\s+([\d\.]+)%\s+of\s+~?([\d\.]+\w+)/i);

    if (match) {
      notifyProgress({
        status: 'downloading',
        percent: parseFloat(match[1]),
        totalSize: match[2] || '--',
        speed: match[3] || '--',
        eta: match[4] || '--'
      });
    }

    if (text.includes('[Merger]') || text.includes('[ExtractAudio]')) {
      notifyProgress({ status: 'merging', percent: 98 });
    }
  });

  let downloadStderr = '';
  proc.stderr.on('data', (chunk) => {
    downloadStderr += chunk.toString();
  });

  proc.on('close', (code) => {
    activeProcesses.delete(downloadId);
    releaseIpDownloadSlot(downloadId);
    if (code === 0 && fs.existsSync(localSavedPath)) {
      notifyProgress({
        status: 'completed',
        percent: 100,
        speed: 'Finished',
        eta: '0s'
      });
    } else {
      const state = activeDownloads.get(downloadId);
      if (state && state.status !== 'cancelled') {
        let errMsg = 'Download failed from provider.';
        if (
          downloadStderr.includes('Failed to resolve') ||
          downloadStderr.includes('getaddrinfo failed') ||
          downloadStderr.includes('DNS operation refused') ||
          downloadStderr.includes('11001')
        ) {
          errMsg = 'Download failed: Domain blocked by ISP / DNS filter.';
        } else if (
          downloadStderr.includes('Connection was reset') ||
          downloadStderr.includes('ECONNRESET') ||
          downloadStderr.includes('Recv failure') ||
          downloadStderr.includes('10054') ||
          downloadStderr.includes('forcibly closed') ||
          downloadStderr.includes('Connection aborted') ||
          downloadStderr.includes('RemoteDisconnected')
        ) {
          errMsg = 'Blocked by ISP Firewall (Connection Reset 10054): This video stream is hosted directly on a blocked domain. Please enable a VPN (e.g. ProtonVPN/WARP) to download from this specific site.';
        } else if (downloadStderr.includes('HTTP Error 403') || downloadStderr.includes('Forbidden')) {
          errMsg = 'Download failed: Access forbidden (HTTP 403).';
        } else if (downloadStderr.includes('HTTP Error 404') || downloadStderr.includes('Not Found')) {
          errMsg = 'Download failed: Video stream not found (HTTP 404).';
        }
        notifyProgress({ status: 'error', error: errMsg });
      }
    }
  });
});

// API: Cancel / Stop Active Download
app.post('/api/download/cancel/:id', (req, res) => {
  const { id } = req.params;
  const item = activeProcesses.get(id);
  const downloadState = activeDownloads.get(id);

  console.log(`[Cancel Download] Cancelling download ID: ${id}`);
  releaseIpDownloadSlot(id);

  if (item) {
    if (item.abortController) {
      try { item.abortController.abort(); } catch (e) {}
    }
    if (item.proc) {
      try {
        item.proc.kill('SIGKILL');
      } catch (e) {
        try { exec(`taskkill /pid ${item.proc.pid} /T /F`); } catch (err) {}
      }
    }
    if (item.path) {
      setTimeout(() => {
        try {
          if (fs.existsSync(item.path + '.part')) fs.unlinkSync(item.path + '.part');
          if (fs.existsSync(item.path + '.ytdl')) fs.unlinkSync(item.path + '.ytdl');
          const dir = path.dirname(item.path);
          const base = path.basename(item.path);
          fs.readdirSync(dir).forEach(f => {
            if (f.startsWith(base) && (f.includes('.part') || f.includes('.temp'))) {
              try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
            }
          });
        } catch (e) {}
      }, 500);
    }
    activeProcesses.delete(id);
  }

  if (downloadState) {
    downloadState.status = 'cancelled';
    downloadState.speed = 'Cancelled';
    downloadState.eta = '--';
    const client = progressListeners.get(id);
    if (client) {
      client.write(`data: ${JSON.stringify(downloadState)}\n\n`);
      setTimeout(() => {
        try { client.end(); } catch (e) {}
        progressListeners.delete(id);
      }, 500);
    }
  }

  res.json({ ok: true, message: 'Download cancelled successfully.' });
});

// SSE Endpoint for Live Real-Time Progress
app.get('/api/progress/:id', pollingRateLimiter, (req, res) => {
  const { id } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  progressListeners.set(id, res);

  const current = activeDownloads.get(id);
  if (current) {
    res.write(`data: ${JSON.stringify(current)}\n\n`);
  }

  req.on('close', () => {
    progressListeners.delete(id);
  });
});

// API: Deliver Downloaded File to Browser (RFC 5987 compliant header)
app.get('/api/file/:id', fileDeliveryLimiter, (req, res) => {
  const { id } = req.params;
  const item = activeDownloads.get(id);
  if (!item) {
    return res.status(404).send('Download not found.');
  }

  try {
    const { resolved } = safeResolveDownloadPath(item.filename);
    if (!fs.existsSync(resolved)) {
      return res.status(404).send('File not found on disk.');
    }

    const stat = fs.statSync(resolved);
    const asciiFilename = (item.filename || 'video.mp4').replace(/[^\x20-\x7E]/g, '_').replace(/_+/g, '_');
    const encodedFilename = encodeURIComponent(item.filename || 'video.mp4');

    res.setHeader('Content-Type', item.filename.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
    );

    const stream = fs.createReadStream(resolved);
    stream.pipe(res);
  } catch (err) {
    res.status(400).send('Invalid file request.');
  }
});

// API: Download History
app.get('/api/history', pollingRateLimiter, (req, res) => {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const history = [];

    for (const file of files) {
      const fullPath = path.join(DOWNLOADS_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.size > 10000 && !file.includes('.temp_')) {
          history.push({
            filename: file,
            cleanName: file,
            size: stat.size,
            sizeFormatted: formatBytes(stat.size),
            createdAt: stat.birthtimeMs || stat.mtimeMs,
            downloadUrl: `/api/download-file/${encodeURIComponent(file)}`
          });
        }
      } catch (e) {}
    }

    history.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ ok: true, history: history.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not load download history.' });
  }
});

app.get('/api/download-file/:filename', fileDeliveryLimiter, (req, res) => {
  try {
    const { resolved, safeName } = safeResolveDownloadPath(req.params.filename);
    if (!fs.existsSync(resolved)) {
      return res.status(404).send('File not found.');
    }
    res.download(resolved, safeName);
  } catch (err) {
    res.status(400).send('Invalid file request.');
  }
});

app.post('/api/open-folder', (req, res) => {
  try {
    if (process.platform === 'win32') {
      exec(`explorer.exe "${DOWNLOADS_DIR}"`, () => {});
      return res.json({ ok: true, path: DOWNLOADS_DIR });
    } else if (process.platform === 'darwin') {
      exec(`open "${DOWNLOADS_DIR}"`, () => {});
      return res.json({ ok: true, path: DOWNLOADS_DIR });
    } else {
      exec(`xdg-open "${DOWNLOADS_DIR}"`, () => {});
      return res.json({ ok: true, path: DOWNLOADS_DIR });
    }
  } catch (err) {
    res.json({ ok: true, path: DOWNLOADS_DIR });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Apex Video Downloader (v3.4) — Live Progress & High Speed Direct Engine`);
    console.log(`🌐 Local Web App URL: http://localhost:${PORT}`);
    console.log(`📁 Downloads Directory: ${DOWNLOADS_DIR}`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
