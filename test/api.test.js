/**
 * Automated Security & API Test Suite for Apex Video Downloader
 * Tests API Endpoints, Input Validation, SSRF Safety, Path Traversal, and Security Headers.
 */

const http = require('http');
const assert = require('assert');
const app = require('../server');

let BASE_URL = '';
let serverInstance = null;

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
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
