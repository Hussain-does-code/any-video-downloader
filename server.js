const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const dns = require('dns');
const { Resolver } = require('dns').promises;
const { spawn, exec } = require('child_process');
const { URL } = require('url');

// Configure global custom DNS resolver to bypass local ISP DNS blocks
const customResolver = new Resolver();
customResolver.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);
const dnsCache = new Map();

async function universalLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  if (dnsCache.has(hostname)) {
    const cached = dnsCache.get(hostname);
    if (options && options.all) return callback(null, [{ address: cached, family: 4 }]);
    return callback(null, cached, 4);
  }

  try {
    const addresses = await customResolver.resolve4(hostname);
    if (addresses && addresses.length > 0) {
      const ip = addresses[0];
      dnsCache.set(hostname, ip);
      if (options && options.all) return callback(null, [{ address: ip, family: 4 }]);
      return callback(null, ip, 4);
    }
  } catch (err) {}

  dns.lookup(hostname, options, callback);
}

https.globalAgent.options.lookup = universalLookup;
http.globalAgent.options.lookup = universalLookup;

process.on('uncaughtException', (err) => {
  console.error('[Process Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Unhandled Rejection]:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Trust cloud reverse proxies (Cloudflare, Render, Railway, Fly.io, etc.)
app.set('trust proxy', 1);

// Directories & Binaries
const ROOT_DIR = __dirname;
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// ─── Cross-Platform Binary Resolution (Windows & Linux) ───
let ffmpegStaticPath = null;
try {
  ffmpegStaticPath = require('ffmpeg-static');
} catch (e) {}

function getFfmpegPath() {
  const localWin = path.join(BIN_DIR, 'ffmpeg.exe');
  const localLinux = path.join(BIN_DIR, 'ffmpeg');
  if (process.platform === 'win32' && fs.existsSync(localWin)) {
    return localWin;
  }
  if (fs.existsSync(localLinux)) {
    return localLinux;
  }
  if (ffmpegStaticPath && fs.existsSync(ffmpegStaticPath)) {
    return ffmpegStaticPath;
  }
  return 'ffmpeg';
}

function getYtdlpPath() {
  const localWin = path.join(BIN_DIR, 'yt-dlp.exe');
  const localLinux = path.join(BIN_DIR, 'yt-dlp');
  if (process.platform === 'win32' && fs.existsSync(localWin)) {
    return localWin;
  }
  if (fs.existsSync(localLinux)) {
    return localLinux;
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

// Auto-download yt-dlp Linux standalone binary if missing on cloud container
async function ensureYtdlpBinary() {
  if (process.platform === 'win32') return;
  const linuxPath = path.join(BIN_DIR, 'yt-dlp');
  if (fs.existsSync(linuxPath)) {
    try { fs.chmodSync(linuxPath, '755'); } catch (e) {}
    return;
  }
  if (isBinaryAvailable('yt-dlp')) return;

  console.log('[Cloud Setup] Installing standalone yt-dlp binary for Linux...');
  try {
    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
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
    console.log('[Cloud Setup] yt-dlp installed successfully.');
  } catch (err) {
    console.warn('[Cloud Setup Warning] Auto-download of yt-dlp skipped:', err.message);
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
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// ─── K37 Security: SSRF Protection & Private IP Range Blocker ───
function isPrivateOrLocalUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return true;
  try {
    const parsed = new URL(targetUrl);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') {
      return true; // Block file://, gopher://, dict://, etc.
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
      return true;
    }
    if (host === '169.254.169.254' || host.startsWith('metadata.google') || host === 'instance-data') {
      return true; // Cloud metadata attack prevention
    }
    if (
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.localhost')
    ) {
      return true; // Private network address
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
  const safeName = path.basename(filename);
  const resolved = path.resolve(DOWNLOADS_DIR, safeName);
  const baseResolved = path.resolve(DOWNLOADS_DIR);
  if (!resolved.startsWith(baseResolved)) {
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
app.use(express.json());
app.use(express.static(path.join(ROOT_DIR, 'public')));

// Rate Limiting Defense (Manny's Rule: Protect against automated flooding & DoS)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 60;     // Max 60 requests per min per IP

app.use('/api/', (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const clientData = requestCounts.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + RATE_LIMIT_WINDOW_MS;
  } else {
    clientData.count++;
  }

  requestCounts.set(ip, clientData);

  if (clientData.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      ok: false,
      error: 'Too many requests. Rate limit exceeded. Please wait a moment before trying again.'
    });
  }

  next();
});

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
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers
    };

    const req = client.get(targetUrl, { headers: reqHeaders, timeout: 12000 }, (res) => {
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
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://xhnetwork.life/',
        ...headers
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchBuffer(new URL(res.headers.location, targetUrl).toString(), headers));
      }
      if (res.statusCode !== 200) {
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

async function downloadHLSParallel(m3u8Url, outputPath, isAudio = false, onProgress = null, abortController = null) {
  console.log(`[Parallel HLS Downloader] Fetching manifest: ${m3u8Url}`);
  const manifest = await fetchText(m3u8Url, { Referer: 'https://xhnetwork.life/' });
  
  const segmentUrls = manifest.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => new URL(l, m3u8Url).toString());

  if (segmentUrls.length === 0) {
    throw new Error('No video segments found in playlist.');
  }

  const totalSegments = segmentUrls.length;
  console.log(`[Parallel HLS Downloader] Downloading ${totalSegments} segments in 16 parallel threads...`);

  const tempTsPath = outputPath + `.temp_${Date.now()}.ts`;
  const outStream = fs.createWriteStream(tempTsPath);

  const buffers = new Map();
  let nextToWrite = 0;
  let downloadedCount = 0;
  let totalBytesReceived = 0;
  let active = 0;
  let nextToFetch = 0;
  const concurrency = 16;
  const startTime = Date.now();

  await new Promise((resolve, reject) => {
    function schedule() {
      if (abortController?.signal?.aborted) {
        try { outStream.end(); fs.unlinkSync(tempTsPath); } catch (e) {}
        return reject(new Error('CANCELLED'));
      }
      if (nextToWrite === totalSegments) {
        outStream.end();
        return resolve();
      }

      while (active < concurrency && nextToFetch < totalSegments) {
        const idx = nextToFetch++;
        active++;

        fetchBuffer(segmentUrls[idx])
          .then((buf) => {
            active--;
            downloadedCount++;
            totalBytesReceived += buf.length;
            buffers.set(idx, buf);

            // Write downloaded buffers to disk in strict sequence
            while (buffers.has(nextToWrite)) {
              outStream.write(buffers.get(nextToWrite));
              buffers.delete(nextToWrite);
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

            schedule();
          })
          .catch((err) => {
            active--;
            console.warn(`[Retry Segment ${idx}]:`, err.message);
            nextToFetch = Math.min(nextToFetch, idx);
            setTimeout(schedule, 500);
          });
      }
    }
    schedule();
  });

  // Remux TS stream to clean MP4 or MP3 using FFmpeg
  return new Promise((resolve, reject) => {
    const ffmpegArgs = ['-i', tempTsPath];

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
      'Referer': `${parsed.protocol}//${parsed.hostname}/`,
      'Origin': `${parsed.protocol}//${parsed.hostname}`,
      ...headers
    };

    const req = client.request(targetUrl, {
      method: 'HEAD',
      headers: defaultHeaders,
      timeout: 10000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(getUrlFileSize(new URL(res.headers.location, targetUrl).toString(), headers));
      }
      const len = parseInt(res.headers['content-length'], 10);
      const acceptsRanges = res.headers['accept-ranges'] === 'bytes' || !isNaN(len);
      if (len > 0) {
        return resolve({ size: len, acceptsRanges });
      }

      // Fallback: Try GET with Range bytes=0-10
      const getProbe = client.request(targetUrl, {
        method: 'GET',
        headers: { ...defaultHeaders, 'Range': 'bytes=0-10' },
        timeout: 10000
      }, (probeRes) => {
        const cr = probeRes.headers['content-range'];
        if (cr) {
          const match = cr.match(/\/(\d+)/);
          if (match) {
            return resolve({ size: parseInt(match[1], 10), acceptsRanges: true });
          }
        }
        const cl = parseInt(probeRes.headers['content-length'], 10);
        resolve({ size: cl > 0 ? cl : 0, acceptsRanges: probeRes.statusCode === 206 });
      });
      getProbe.on('error', () => resolve({ size: 0, acceptsRanges: false }));
      getProbe.on('timeout', () => { getProbe.destroy(); resolve({ size: 0, acceptsRanges: false }); });
      getProbe.end();
    });
    req.on('timeout', () => { req.destroy(); resolve({ size: 0, acceptsRanges: false }); });
    req.on('error', () => resolve({ size: 0, acceptsRanges: false }));
    req.end();
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
        'Referer': `${parsed.protocol}//${parsed.hostname}/`,
        'Origin': `${parsed.protocol}//${parsed.hostname}`,
        'Range': `bytes=${start}-${end}`,
        ...headers
      },
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
      'Referer': `${parsed.protocol}//${parsed.hostname}/`,
      'Origin': `${parsed.protocol}//${parsed.hostname}`
    };

    const req = client.get(directUrl, {
      headers: defaultHeaders,
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
  if (!totalBytes || totalBytes < 2 * 1024 * 1024 || !acceptsRanges) {
    console.log('[Parallel HTTP Downloader] Range chunking unsupported; falling back to direct stream download...');
    return downloadDirectSingleHTTP(directUrl, outputPath, onProgress, abortController);
  }

  console.log(`[Parallel HTTP Downloader] Downloading ${formatBytes(totalBytes)} across 6 parallel workers...`);
  const concurrency = 6;
  const chunkSize = 4 * 1024 * 1024;
  const numChunks = Math.ceil(totalBytes / chunkSize);
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
            if (nextChunk.attempts > 5) {
              console.warn('[Parallel Downloader] Chunk failed 5 times; falling back to single stream...');
              finish(new Error('PARALLEL_FAILED'));
            } else {
              nextChunk.status = 'pending';
              setTimeout(pump, 500);
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
          const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
          if (resMatch) {
            currentRes = parseInt(resMatch[2], 10);
            currentBandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
          }
        } else if (line && !line.startsWith('#') && currentRes) {
          const fullStreamUrl = new URL(line, masterHlsUrl).toString();
          if (!seenHeights.has(currentRes)) {
            seenHeights.add(currentRes);

            const is4k = currentRes >= 2160;
            const is2k = currentRes >= 1440;
            const is1080 = currentRes >= 1080;
            const label = is4k ? '4K Ultra HD (2160p)' :
                          is2k ? '2K Quad HD (1440p)' :
                          is1080 ? 'Full HD (1080p)' :
                          currentRes >= 720 ? 'HD (720p)' :
                          `SD (${currentRes}p)`;

            const badge = is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : currentRes >= 720 ? 'HD' : 'SD';
            const approxBytes = duration > 0 && currentBandwidth > 0 ? Math.round((currentBandwidth / 8) * duration) : null;

            videoFormats.push({
              formatId: `hls-${currentRes}`,
              height: currentRes,
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
async function extractCloudFallback(targetUrl) {
  const isDirectFile = /\.(?:mp4|webm|m3u8|mkv|mov|mp3|m4a)(?:[/?#]|$)/i.test(targetUrl) || targetUrl.includes('/get_file/');
  if (isDirectFile) {
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
          directUrl: targetUrl
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
  const gateways = [
    `https://proxy.cors.sh/${targetUrl}`,
    `https://corsproxy.org/?${encodeURIComponent(targetUrl)}`,
    `https://html-preview.github.io/?url=${encodeURIComponent(targetUrl)}`
  ];

  let html = null;
  for (const gw of gateways) {
    try {
      const res = await fetch(gw, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 500) {
          html = text;
          break;
        }
      }
    } catch (e) {}
  }

  if (!html) throw new Error('Cloud fallback could not retrieve webpage.');

  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let title = titleMatch ? titleMatch[1].replace(/[-|_|\s]*Free.*$/i, '').trim() : 'Video';

  // Extract thumbnail
  const thumbMatch = html.match(/poster=['"]([^'"]+)['"]/i) || 
                     html.match(/preview_url\s*:\s*['"]([^'"]+)['"]/i) ||
                     html.match(/<meta\s+property=['"]og:image['"]\s+content=['"]([^'"]+)['"]/i) ||
                     html.match(/https?:\/\/img\.[^'"\s<>]+\.(?:jpg|png|webp)/i);
  let rawThumb = thumbMatch ? (thumbMatch[1] || thumbMatch[0]) : '';
  const thumbnail = rawThumb ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : '';

  // Extract video streams
  const videoFormats = [];
  const seenUrls = new Set();
  const seenHeights = new Set();

  const streamMatches = html.matchAll(/['"](https?:\/\/[^'"\s<>]*(?:\/get_file\/|\.mp4|\.m3u8)[^'"\s<>]*)['"]/gi);
  
  for (const match of streamMatches) {
    const streamUrl = match[1];
    if (seenUrls.has(streamUrl) || streamUrl.includes('preview') || streamUrl.includes('thumb') || streamUrl.includes('screenshots')) {
      continue;
    }
    seenUrls.add(streamUrl);

    let height = 720;
    if (/2160|4[kK]/i.test(streamUrl)) height = 2160;
    else if (/1440|2[kK]/i.test(streamUrl)) height = 1440;
    else if (/1080/i.test(streamUrl)) height = 1080;
    else if (/720/i.test(streamUrl)) height = 720;
    else if (/480/i.test(streamUrl)) height = 480;
    else if (/360/i.test(streamUrl)) height = 360;

    if (!seenHeights.has(height)) {
      seenHeights.add(height);
      const is4k = height >= 2160;
      const is2k = height >= 1440;
      const is1080 = height >= 1080;
      const badge = is4k ? '4K' : is2k ? '2K' : is1080 ? '1080P' : height >= 720 ? 'HD' : 'SD';
      const label = is4k ? '4K Ultra HD (2160p)' :
                    is2k ? '2K Quad HD (1440p)' :
                    is1080 ? 'Full HD (1080p)' :
                    height >= 720 ? 'HD (720p)' :
                    `SD (${height}p)`;

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
        sizeFormatted: 'Best Quality',
        directUrl: streamUrl
      });
    }
  }

  videoFormats.sort((a, b) => b.height - a.height);

  return {
    title,
    thumbnail,
    duration: 0,
    durationFormatted: '--:--',
    uploader: 'Web Video',
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
        size: null,
        sizeFormatted: 'Standard Size',
        container: 'mp3',
        codec: 'mp3',
        directUrl: videoFormats[0]?.directUrl
      }
    ],
    originalFormatsCount: videoFormats.length
  };
}

// API: Proxy Image (Bypasses ISP image CDN blocking)
app.get('/api/proxy-image', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).send('Invalid URL');
  }

  const decoded = decodeURIComponent(url);
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
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buf = Buffer.from(await response.arrayBuffer());
        return res.send(buf);
      }
    } catch (e) {}
  }

  res.redirect('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="%23141b2d"/><text x="50%" y="50%" fill="%23818cf8" font-size="20" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">▶ Video Stream</text></svg>');
});

// API: Status
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    ytdlpAvailable: isBinaryAvailable(getYtdlpPath()),
    ffmpegAvailable: isBinaryAvailable(getFfmpegPath()),
    downloadsDir: DOWNLOADS_DIR,
    version: '3.4.0'
  });
});

// API: Analyze Video URL (Calculates exact sizes for all formats)
app.post('/api/analyze', async (req, res) => {
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
    '--extractor-args', 'youtube:player-client=default,tv_simply',
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
      
      try {
        const cloudData = await extractCloudFallback(trimmedUrl);
        if (cloudData && cloudData.videoFormats && cloudData.videoFormats.length > 0) {
          console.log(`[Cloud Fallback Success]: Extracted ${cloudData.videoFormats.length} video stream formats without VPN!`);
          return res.json({ ok: true, data: cloudData });
        }
      } catch (cloudErr) {
        console.warn('[Cloud Fallback Also Failed]:', cloudErr.message);
      }

      console.error(`[Analyze Error] code ${code}: ${stderrData}`);
      let userError = 'Could not fetch video information. Please make sure the link is public and accessible.';
      
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
      const info = JSON.parse(stdoutData);
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
        // Skip storyboard image strips and invalid non-video formats
        if (
          f.ext === 'mhtml' ||
          f.format_note === 'storyboard' ||
          f.vcodec === 'images' ||
          (f.vcodec === 'none' && f.acodec === 'none')
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
        if (!height && f.format_note) {
          const m = f.format_note.match(/(\d+)[pP]/);
          if (m) height = parseInt(m[1], 10);
        }
        if (!height && f.resolution) {
          const m = f.resolution.match(/(\d+)x(\d+)/);
          if (m) height = parseInt(m[2], 10);
        }
        if (!height && f.format) {
          const m = f.format.match(/(\d+)[pP]/);
          if (m) height = parseInt(m[1], 10);
        }

        // Infer resolution from URL, format_id, format_note, or title
        if (!height) {
          const combinedStr = `${f.url || ''} ${f.format_id || ''} ${f.format_note || ''} ${f.format || ''} ${info.title || ''}`;
          if (/\b8[kK]\b|4320[pP]?/i.test(combinedStr)) height = 4320;
          else if (/\b4[kK]\b|2160[pP]?/i.test(combinedStr)) height = 2160;
          else if (/\b2[kK]\b|1440[pP]?/i.test(combinedStr)) height = 1440;
          else if (/1080[pP]?/i.test(combinedStr)) height = 1080;
          else if (/720[pP]?/i.test(combinedStr)) height = 720;
          else if (/480[pP]?/i.test(combinedStr)) height = 480;
          else if (/360[pP]?/i.test(combinedStr)) height = 360;
          else height = info.height || 1080; // Fallback to 1080p if video stream exists without explicit height
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

        if (!existing || (f.ext === 'mp4' && existing.ext !== 'mp4') || (currentTbr > 0 && (!existing.tbr || currentTbr < existing.tbr * 3))) {
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

      res.json({
        ok: true,
        data: {
          title: info.title || 'Untitled Video',
          thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails[info.thumbnails.length - 1]?.url) || '',
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
app.post('/api/download', async (req, res) => {
  const { url, title, formatId, height, isAudio, directUrl, ext } = req.body;
  if (!url && !directUrl) {
    return res.status(400).json({ ok: false, error: 'Video URL is required.' });
  }

  if ((url && isPrivateOrLocalUrl(url)) || (directUrl && isPrivateOrLocalUrl(directUrl))) {
    return res.status(400).json({ ok: false, error: 'Invalid or restricted video URL.' });
  }

  const downloadId = Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
  const isAudioFlag = isAudio === true || isAudio === 'true';
  const fileExt = isAudioFlag ? 'mp3' : (ext || 'mp4');
  const safeTitle = sanitizeFilename(title || 'video');
  const cleanFilename = `${safeTitle}.${fileExt}`;
  const localSavedPath = path.join(DOWNLOADS_DIR, cleanFilename);

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
      notifyProgress({
        status: 'completed',
        percent: 100,
        speed: 'Finished',
        eta: '0s'
      });
      return;
    } catch (hlsErr) {
      activeProcesses.delete(downloadId);
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
        notifyProgress({ status: 'cancelled', speed: 'Cancelled', eta: '--' });
        return;
      }
      console.warn('[Direct Parallel HTTP Downloader skipped/fallback]:', parallelErr.message);
      // Fall through to yt-dlp seamlessly
    }
  }

  // 3. Universal yt-dlp Multi-Threaded Downloader (-N 16 & chunk buffers)
  const ytdlpArgs = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '-N', '16',
    '--concurrent-fragments', '16',
    '--buffer-size', '64M',
    '--ffmpeg-location', getFfmpegPath(),
    '--extractor-args', 'youtube:player-client=default,tv_simply',
    '--js-runtimes', 'node',
    '-o', localSavedPath
  ];

  if (isAudioFlag) {
    ytdlpArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    const h = height && parseInt(height, 10) > 0 ? parseInt(height, 10) : null;
    if (formatId && !formatId.startsWith('hls-') && !formatId.startsWith('mp4-')) {
      if (h) {
        ytdlpArgs.push('-f', `${formatId}/${formatId}+bestaudio/bestvideo[height=${h}]+bestaudio/bestvideo[height<=${h}]+bestaudio/best[height=${h}]/best[height<=${h}]/bestvideo+bestaudio/best`);
      } else {
        ytdlpArgs.push('-f', `${formatId}/${formatId}+bestaudio/bestvideo+bestaudio/best`);
      }
      ytdlpArgs.push('--merge-output-format', 'mp4');
    } else if (h) {
      ytdlpArgs.push('-f', `bestvideo[height=${h}]+bestaudio/bestvideo[height<=${h}]+bestaudio/best[height=${h}]/best[height<=${h}]/bestvideo+bestaudio/best`);
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
          downloadStderr.includes('DNS operation refused')
        ) {
          errMsg = 'Download failed: Domain blocked by ISP / DNS filter.';
        } else if (
          downloadStderr.includes('Connection was reset') ||
          downloadStderr.includes('ECONNRESET') ||
          downloadStderr.includes('Recv failure')
        ) {
          errMsg = 'Download failed: Connection reset / blocked by ISP. Try using a VPN.';
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
app.get('/api/progress/:id', (req, res) => {
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
app.get('/api/file/:id', (req, res) => {
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
app.get('/api/history', (req, res) => {
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

app.get('/api/download-file/:filename', (req, res) => {
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
