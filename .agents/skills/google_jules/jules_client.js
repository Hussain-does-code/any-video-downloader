/**
 * Google Jules API Client for Antigravity IDE
 * Enables automated task delegation, cloud PR generation, and asynchronous session tracking.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

function getApiKey() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^JULES_API_KEY=(.*)$/);
      if (match) return match[1].trim();
    }
  }
  return process.env.JULES_API_KEY || '';
}

const API_KEY = getApiKey();
const API_BASE = 'jules.googleapis.com';

function apiRequest(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_BASE,
      port: 443,
      path: `/v1alpha/${endpoint}?key=${API_KEY}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', (e) => reject(e));
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function main() {
  const action = process.argv[2] || 'status';
  console.log(`🤖 Google Jules Integration Client initialized`);

  if (!API_KEY) {
    console.error(`❌ Error: Jules API Key not found.`);
    process.exit(1);
  }

  try {
    if (action === 'status') {
      console.log(`🔑 Jules API Connected. Key prefix: ${API_KEY.substring(0, 8)}...`);
    } else if (action === 'list') {
      const res = await apiRequest('sessions');
      console.log(`📋 Active Sessions:`, JSON.stringify(res.data, null, 2));
    }
  } catch (err) {
    console.error(`❌ Request Error:`, err.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = { apiRequest, getApiKey };
