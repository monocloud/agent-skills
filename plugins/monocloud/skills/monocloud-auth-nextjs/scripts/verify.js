#!/usr/bin/env node
// Diagnostic for @monocloud/auth-nextjs integrations.
// Usage: node skills/monocloud-auth-nextjs/scripts/verify.js [project-dir]
// Cross-platform: pure Node. No external deps.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG_NAME = '@monocloud/auth-nextjs';
const REQUIRED_ENV = [
  'MONOCLOUD_AUTH_TENANT_DOMAIN',
  'MONOCLOUD_AUTH_CLIENT_ID',
  'MONOCLOUD_AUTH_CLIENT_SECRET',
  'MONOCLOUD_AUTH_APP_URL',
  'MONOCLOUD_AUTH_COOKIE_SECRET',
];
const OPTIONAL_ENV = [
  'MONOCLOUD_AUTH_SCOPES',
  'MONOCLOUD_AUTH_RESOURCE',
  'MONOCLOUD_AUTH_GROUPS_CLAIM',
];

const findings = [];
const pass = (m) => findings.push(['pass', m]);
const warn = (m) => findings.push(['warn', m]);
const fail = (m) => findings.push(['fail', m]);

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function parseEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

// 1. Package.json + SDK dependency
const pkgPath = path.join(ROOT, 'package.json');
const pkg = readJson(pkgPath);
if (!pkg) {
  fail(`No package.json at ${pkgPath}`);
} else {
  pass(`Found package.json (${pkg.name || 'unnamed'})`);
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps[PKG_NAME]) {
    pass(`${PKG_NAME} is declared (${deps[PKG_NAME]})`);
  } else {
    fail(`${PKG_NAME} not in dependencies. Run: npm install ${PKG_NAME}`);
  }
  if (!deps.next) warn('"next" not in dependencies — this skill targets Next.js.');
  else pass(`Next.js detected (${deps.next})`);
}

// 2. Middleware / proxy file
const midCandidates = [
  'src/proxy.ts', 'src/proxy.js', 'proxy.ts', 'proxy.js',
  'src/middleware.ts', 'src/middleware.js', 'middleware.ts', 'middleware.js',
];
const foundMid = midCandidates.find((c) => fs.existsSync(path.join(ROOT, c)));
if (foundMid) pass(`Middleware/proxy file present: ${foundMid}`);
else warn('No proxy.ts/middleware.ts found. Add `export default authMiddleware()` per the skill.');

// 3. Env vars: process + .env.local
const envFile = parseEnvFile(path.join(ROOT, '.env.local'));
for (const name of REQUIRED_ENV) {
  const v = process.env[name] || envFile[name];
  if (v) pass(`${name} set`);
  else fail(`${name} missing (set in .env.local or process env)`);
}
for (const name of OPTIONAL_ENV) {
  const v = process.env[name] || envFile[name];
  if (v) pass(`${name} set (optional)`);
}

// 4. .env.local gitignored?
if (fs.existsSync(path.join(ROOT, '.env.local'))) {
  const gi = fs.existsSync(path.join(ROOT, '.gitignore'))
    ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
    : '';
  if (!/\.env\.local/.test(gi)) warn('.env.local exists but is not listed in .gitignore.');
}

// 5. Cookie-secret sanity
const cookieSecret = process.env.MONOCLOUD_AUTH_COOKIE_SECRET || envFile.MONOCLOUD_AUTH_COOKIE_SECRET;
if (cookieSecret && cookieSecret.length < 32) {
  warn('MONOCLOUD_AUTH_COOKIE_SECRET looks short. Generate with: openssl rand -hex 32');
}

// Report
const tag = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
for (const [k, m] of findings) console.log(`[${tag[k]}] ${m}`);
const failed = findings.filter(([k]) => k === 'fail').length;
console.log(`\n${findings.length} checks — ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
