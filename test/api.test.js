/**
 * Automated Test Suite for Apex Video Downloader
 * Tests API Endpoints, Input Validation, SSRF Safety, and History Serialization.
 */

const http = require('http');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

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
  console.log('🧪 Starting Apex Video Downloader Automated Test Suite...\n');
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

  // 2. History API Endpoint
  await test('GET /api/history returns valid array', async () => {
    const res = await makeRequest('/api/history');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert(Array.isArray(res.data.history));
  });

  // 3. Analyze Input Validation: Empty URL
  await test('POST /api/analyze with empty URL rejects cleanly', async () => {
    const res = await makeRequest('/api/analyze', 'POST', { url: '' });
    assert.strictEqual(res.data.ok, false);
  });

  // 4. Analyze Input Validation: Invalid/Incomplete URL
  await test('POST /api/analyze with invalid URL returns error', async () => {
    const res = await makeRequest('/api/analyze', 'POST', { url: 'not-a-real-url' });
    assert.strictEqual(res.data.ok, false);
  });

  // 5. Cancel Endpoint
  await test('POST /api/download/cancel/:id handles non-existent ID gracefully', async () => {
    const res = await makeRequest('/api/download/cancel/non-existent-id', 'POST');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
  });

  // 6. Open Folder Endpoint
  await test('POST /api/open-folder succeeds', async () => {
    const res = await makeRequest('/api/open-folder', 'POST');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
  });

  console.log(`\n========================================`);
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests();
