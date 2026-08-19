/**
 * Automated Secret Scanner for Vibe Coding
 * Run before git commits or deploys to detect accidental secret leakage.
 */

const fs = require('fs');
const path = require('path');

const SECRET_PATTERNS = [
  { name: 'OpenAI API Key', regex: /sk-[a-zA-Z0-9]{20,T3BlbkFJ[a-zA-Z0-9]{20,}/g },
  { name: 'Anthropic API Key', regex: /sk-ant-api[a-zA-Z0-9\-_]{20,}/g },
  { name: 'Google AI / Gemini Key', regex: /AIzaSy[a-zA-Z0-9_\-]{33}/g },
  { name: 'GitHub Personal Access Token', regex: /(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g },
  { name: 'Stripe Secret Key', regex: /sk_(live|test)_[a-zA-Z0-9]{24,}/g },
  { name: 'AWS Access Key ID', regex: /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g },
  { name: 'Private Key Block', regex: /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP|PRIVATE) KEY/g },
  { name: 'Generic Password/Secret Assignment', regex: /(password|secret|api_key|apikey|auth_token)\s*[:=]\s*['"][a-zA-Z0-9_\-!@#$%^&*()+=]{8,}['"]/gi }
];

const IGNORE_DIRS = ['node_modules', '.git', 'downloads', 'bin', '.next', 'dist', 'build', '.gemini'];

function scanDirectory(dirPath) {
  let issues = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORE_DIRS.includes(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      issues = issues.concat(scanDirectory(fullPath));
    } else if (entry.isFile()) {
      if (entry.name === '.env' || entry.name.startsWith('.env.')) {
        issues.push({
          file: fullPath,
          line: 1,
          name: 'Committed .env File',
          snippet: `Found ${entry.name} in repository directory. Ensure it is added to .gitignore.`
        });
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const pattern of SECRET_PATTERNS) {
            pattern.regex.lastIndex = 0;
            if (pattern.regex.test(line)) {
              issues.push({
                file: fullPath,
                line: i + 1,
                name: pattern.name,
                snippet: line.trim().substring(0, 80)
              });
            }
          }
        }
      } catch (e) {
        // Skip binary or unreadable files
      }
    }
  }
  return issues;
}

const rootDir = process.cwd();
console.log(`🔍 Scanning project for secrets: ${rootDir}\n`);
const findings = scanDirectory(rootDir);

if (findings.length === 0) {
  console.log('✅ No exposed secrets detected in source files!');
} else {
  console.log(`🚨 Found ${findings.length} potential secret issue(s):\n`);
  findings.forEach((f) => {
    console.log(`  [${f.name}] in ${f.file}:${f.line}`);
    console.log(`    Snippet: ${f.snippet}\n`);
  });
}
