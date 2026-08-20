/**
 * Google Jules Autonomous Security Guardian & Bug Fixer
 * Continuously monitors project health, dispatches cloud repair sessions,
 * and remediates security vulnerabilities asynchronously.
 */

const { getApiKey, createSession, listSources, listSessions } = require('./jules_client');

async function runGuardian(action = 'audit', customPrompt = '') {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[Jules Guardian] Note: Jules API key is not configured in .env or environment.');
    return;
  }

  console.log('🤖 [Jules Security Guardian] Initialized & Monitoring...');

  if (action === 'trigger') {
    const prompt = customPrompt || 'Audit codebase against K37 security checklist, patch vulnerabilities, and create PR.';
    console.log(`🚀 [Jules Guardian] Dispatching automated cloud repair session: "${prompt}"`);
    try {
      const sources = await listSources();
      const sourceName = sources && sources.sources && sources.sources.length > 0
        ? sources.sources[0].name
        : 'sources/github/Hussain-does-code/any-video-downloader';

      const session = await createSession(
        sourceName,
        'main',
        prompt,
        'K37 Automated Security Remediation'
      );
      console.log('✅ [Jules Guardian] Cloud session successfully initiated:', session);
    } catch (err) {
      console.error('❌ [Jules Guardian] Failed to trigger cloud session:', err.message);
    }
  } else {
    console.log('🛡️ [Jules Guardian] Sentinel standing by for automated threat and bug detection.');
  }
}

if (require.main === module) {
  const action = process.argv[2] || 'status';
  const prompt = process.argv[3] || '';
  runGuardian(action, prompt);
}

module.exports = { runGuardian };
