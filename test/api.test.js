/**
 * Automated Security & API Test Suite for Apex Video Downloader
 * Tests API Endpoints, Input Validation, SSRF Safety, Path Traversal, and Security Headers.
 */

const http = require('http');
const assert = require('assert');
const app = require('../server');

let BASE_URL = '';
let serverInstance = null;

function makeRequest(path, method = 'GET', body = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...customHeaders
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Apex Video Downloader Automated Security & API Test Suite...\n');
  
  // Start ephemeral test server
  await new Promise((resolve) => {
    serverInstance = app.listen(0, '127.0.0.1', () => {
      const port = serverInstance.address().port;
      BASE_URL = `http://127.0.0.1:${port}`;
      console.log(`📡 Test server running on ${BASE_URL}\n`);
      resolve();
    });
  });

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // 1. Static HTML Serving Test
  await test('GET / returns 200 and loads HTML page', async () => {
    const res = await makeRequest('/');
    assert.strictEqual(res.status, 200);
    assert(res.raw && res.raw.includes('<!DOCTYPE html>'));
  });

  // 2. Production Security Headers Check
  await test('Security Headers (CSP, X-Content-Type-Options, X-Frame-Options) present', async () => {
    const res = await makeRequest('/');
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert(res.headers['content-security-policy']);
  });

  // 3. Status API Endpoint
  await test('GET /api/status returns operational system state', async () => {
    const res = await makeRequest('/api/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert(typeof res.data.version === 'string');
  });

  // 4. History API Endpoint
  await test('GET /api/history returns valid array', async () => {
    const res = await makeRequest('/api/history');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert(Array.isArray(res.data.history));
  });

  // 5. Analyze Input Validation: Empty URL
  await test('POST /api/analyze with empty URL rejects cleanly', async () => {
    const res = await makeRequest('/api/analyze', 'POST', { url: '' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.ok, false);
  });

  // 6. Analyze Input Validation: Invalid/Incomplete URL
  await test('POST /api/analyze with invalid URL returns error', async () => {
    const res = await makeRequest('/api/analyze', 'POST', { url: 'not-a-real-url' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.ok, false);
  });

  // 7. SSRF Protection: Loopback / Localhost on /api/analyze
  await test('POST /api/analyze blocks localhost SSRF', async () => {
    const res = await makeRequest('/api/analyze', 'POST', { url: 'http://127.0.0.1:3000' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.ok, false);
  });

  // 8. SSRF Protection: Cloud Metadata on /api/analyze
  await test('POST /api/analyze blocks cloud metadata IP SSRF (169.254.169.254)', async () => {
    const res = await makeRequest('/api/analyze', 'POST', { url: 'http://169.254.169.254/latest/meta-data' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.ok, false);
  });

  // 9. SSRF Protection: Private Subnet on /api/analyze
  await test('POST /api/analyze blocks private 10.0.0.1 subnet', async () => {
    const res = await makeRequest('/api/analyze', 'POST', { url: 'http://10.0.0.1:8080/internal' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.ok, false);
  });

  // 10. SSRF Protection: /api/proxy-image blocks private IPs
  await test('GET /api/proxy-image blocks SSRF attempts to localhost/internal', async () => {
    const res = await makeRequest('/api/proxy-image?url=' + encodeURIComponent('http://127.0.0.1:3000/internal'));
    assert.strictEqual(res.status, 400);
  });

  // 11. Path Traversal Defense on /api/download-file
  await test('GET /api/download-file/..%2fpackage.json rejects path traversal', async () => {
    const res = await makeRequest('/api/download-file/..%2fpackage.json');
    assert(res.status === 400 || res.status === 404);
  });

  // 12. Cancel Endpoint Graceful Non-Existent ID
  await test('POST /api/download/cancel/:id handles non-existent ID gracefully', async () => {
    const res = await makeRequest('/api/download/cancel/non-existent-id', 'POST');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
  });

  // 13. Open Folder Endpoint
  await test('POST /api/open-folder succeeds', async () => {
    const res = await makeRequest('/api/open-folder', 'POST');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
  });

  // 14. Rate Limiting Headers Verification
  await test('Rate limit headers (RateLimit-* or X-RateLimit-*) are present on API responses', async () => {
    const res = await makeRequest('/api/status', 'GET', null, { 'X-Forwarded-For': '198.51.100.10' });
    assert.strictEqual(res.status, 200);
    const hasLimitHeader = res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit'];
    const hasRemainingHeader = res.headers['ratelimit-remaining'] || res.headers['x-ratelimit-remaining'];
    assert(hasLimitHeader, 'RateLimit-Limit or X-RateLimit-Limit must be set');
    assert(hasRemainingHeader, 'RateLimit-Remaining or X-RateLimit-Remaining must be set');
  });

  // 15. IP Concurrency Guard on /api/download
  await test('POST /api/download enforces concurrency limit (max 2) per IP', async () => {
    const testIp = '198.51.100.25';
    // Start download 1
    const res1 = await makeRequest('/api/download', 'POST', {
      url: 'https://example.com/video1.mp4',
      title: 'Concurrency Test 1'
    }, { 'X-Forwarded-For': testIp });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.data.ok, true);

    // Start download 2
    const res2 = await makeRequest('/api/download', 'POST', {
      url: 'https://example.com/video2.mp4',
      title: 'Concurrency Test 2'
    }, { 'X-Forwarded-For': testIp });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.data.ok, true);

    // Attempt download 3 (should be rejected with 429 Concurrency limit)
    const res3 = await makeRequest('/api/download', 'POST', {
      url: 'https://example.com/video3.mp4',
      title: 'Concurrency Test 3'
    }, { 'X-Forwarded-For': testIp });
    assert.strictEqual(res3.status, 429);
    assert.strictEqual(res3.data.ok, false);
    assert.strictEqual(res3.data.code, 'CONCURRENCY_LIMIT_EXCEEDED');

    // Clean up active test downloads
    if (res1.data.downloadId) {
      await makeRequest(`/api/download/cancel/${res1.data.downloadId}`, 'POST', null, { 'X-Forwarded-For': testIp });
    }
    if (res2.data.downloadId) {
      await makeRequest(`/api/download/cancel/${res2.data.downloadId}`, 'POST', null, { 'X-Forwarded-For': testIp });
    }
  });

  // 16. Strict Rate Limiting on Burst /api/analyze Requests
  await test('POST /api/analyze returns 429 and Retry-After header on burst requests', async () => {
    const burstIp = '198.51.100.88';
    let rateLimitedResponse = null;

    // Send 22 rapid requests to exceed analyze rate limit (20 max)
    for (let i = 0; i < 22; i++) {
      const res = await makeRequest('/api/analyze', 'POST', { url: '' }, { 'X-Forwarded-For': burstIp });
      if (res.status === 429) {
        rateLimitedResponse = res;
        break;
      }
    }

    assert(rateLimitedResponse, 'Expected 429 Rate Limit Exceeded response on burst analyze requests');
    assert.strictEqual(rateLimitedResponse.status, 429);
    assert.strictEqual(rateLimitedResponse.data.ok, false);
    assert(rateLimitedResponse.data.code === 'ANALYZE_RATE_LIMIT_EXCEEDED' || rateLimitedResponse.data.code === 'GLOBAL_RATE_LIMIT_EXCEEDED');
    assert(rateLimitedResponse.headers['retry-after'], 'Retry-After header must be present on 429');
  });

  // 17. PII / Path Leakage Test on /api/status
  await test('GET /api/status does not leak internal filesystem path (downloadsDir)', async () => {
    const res = await makeRequest('/api/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.downloadsDir, undefined, 'downloadsDir must not be exposed in /api/status');
  });

  // 18. SSRF Numeric/Decimal IP Defense on /api/analyze
  await test('POST /api/analyze blocks decimal and hex representation of loopback (2130706433 / 0x7f000001)', async () => {
    const resDecimal = await makeRequest('/api/analyze', 'POST', { url: 'http://2130706433/internal' });
    assert.strictEqual(resDecimal.status, 400);
    assert.strictEqual(resDecimal.data.ok, false);

    const resHex = await makeRequest('/api/analyze', 'POST', { url: 'http://0x7f000001/internal' });
    assert.strictEqual(resHex.status, 400);
    assert.strictEqual(resHex.data.ok, false);
  });

  // 19. SSRF Carrier-Grade NAT (100.64.0.1) Defense
  await test('POST /api/analyze blocks Carrier-Grade NAT 100.64.0.1 range', async () => {
    const res = await makeRequest('/api/analyze', 'POST', { url: 'http://100.64.0.1:8080/cloud' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.ok, false);
  });

  console.log(`\n========================================`);
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (serverInstance) {
    serverInstance.close();
  }

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  if (serverInstance) serverInstance.close();
  process.exit(1);
});
