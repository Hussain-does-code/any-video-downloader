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
      path: `/v1alpha/${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${API_KEY}`,
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

async function listSources() {
  const res = await apiRequest('sources');
  return res.data;
}

async function listSessions() {
  const res = await apiRequest('sessions');
  return res.data;
}

async function getSession(sessionId) {
  const res = await apiRequest(`sessions/${sessionId}`);
  return res.data;
}

async function listActivities(sessionId) {
  const res = await apiRequest(`sessions/${sessionId}/activities`);
  return res.data;
}

async function createSession(source, branch, prompt, title) {
  const payload = {
    prompt: prompt,
    title: title || prompt.substring(0, 50),
    sourceContext: {
      source: source,
      githubRepoContext: {
        startingBranch: branch || 'main'
      }
    }
  };

  const res = await apiRequest('sessions', 'POST', payload);
  return res;
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
      const sources = await listSources();
      console.log(`📦 Connected GitHub Sources:`, JSON.stringify(sources, null, 2));
    } else if (action === 'sources') {
      const sources = await listSources();
      console.log(`📦 Sources:`, JSON.stringify(sources, null, 2));
    } else if (action === 'list') {
      const sessions = await listSessions();
      console.log(`📋 Active Sessions:`, JSON.stringify(sessions, null, 2));
    } else if (action === 'create') {
      const source = process.argv[3];
      const branch = process.argv[4] || 'main';
      const prompt = process.argv[5];
      const title = process.argv[6] || 'Cloud Task';
      if (!source || !prompt) {
        console.error('Usage: node jules_client.js create <source> <branch> <prompt> [title]');
        process.exit(1);
      }
      console.log(`🚀 Creating Jules Cloud Session for ${source}...`);
      const res = await createSession(source, branch, prompt, title);
      console.log(`Result:`, JSON.stringify(res, null, 2));
    } else if (action === 'get') {
      const sessionId = process.argv[3];
      if (!sessionId) {
        console.error('Usage: node jules_client.js get <sessionId>');
        process.exit(1);
      }
      const session = await getSession(sessionId);
      console.log(`Session ${sessionId}:`, JSON.stringify(session, null, 2));
    }
  } catch (err) {
    console.error(`❌ Request Error:`, err.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = { apiRequest, getApiKey, listSources, listSessions, createSession, getSession, listActivities };
