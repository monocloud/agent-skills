#!/usr/bin/env node
// Diagnostic for @monocloud/management integrations.
// Usage: node skills/monocloud-management-js/scripts/verify.js [project-dir]
// Cross-platform: pure Node. No external deps.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG_NAME = '@monocloud/management';
const REQUIRED_ENV = [
  'MONOCLOUD_MANAGEMENT_DOMAIN',
  'MONOCLOUD_MANAGEMENT_API_KEY',
];

const findings = [];
const pass = (m) => findings.push(['pass', m]);
const warn = (m) => findings.push(['warn', m]);
const fail = (m) => findings.push(['fail', m]);

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
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

function walkSource(dir, exts, depth = 4) {
  const out = [];
  (function walk(d, left) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name === 'out' || entry.name === 'coverage') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (left > 0) walk(full, left - 1);
      } else if (exts.some((e) => entry.name.endsWith(e))) {
        out.push(full);
      }
    }
  })(dir, depth);
  return out;
}

// 1. package.json + SDK dependency
const pkgPath = path.join(ROOT, 'package.json');
const pkg = readJson(pkgPath);
if (!pkg) {
  fail(`No package.json at ${pkgPath}`);
} else {
  pass(`Found package.json (${pkg.name || 'unnamed'})`);
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  if (deps[PKG_NAME]) {
    pass(`${PKG_NAME} declared (${deps[PKG_NAME]})`);
  } else {
    fail(`${PKG_NAME} not in dependencies. Run: npm install ${PKG_NAME}`);
  }

  // Steer away from similarly-named / wrong-layer SDKs.
  if (deps['@monocloud/auth-web-js'] || deps['@monocloud/auth-nextjs']) {
    warn('A MonoCloud browser/auth SDK is also installed. The management SDK holds a tenant-admin API key and must run server-side only — never import @monocloud/management from browser-shipped code.');
  }
  if (deps['@monocloud/backend-node']) {
    warn('@monocloud/backend-node is also installed. That SDK validates incoming access tokens; @monocloud/management calls the admin API. Different jobs — make sure you are reaching for the right one.');
  }
}

// 2. Required configuration: domain + api key (env or .env files).
const env = { ...parseEnvFile(path.join(ROOT, '.env')), ...parseEnvFile(path.join(ROOT, '.env.local')) };
for (const name of REQUIRED_ENV) {
  const v = process.env[name] || env[name];
  if (v) {
    pass(`${name} set`);
    if (name === 'MONOCLOUD_MANAGEMENT_DOMAIN') {
      if (/\/api(\/|$)/.test(v)) {
        warn(`${name} contains "/api" — pass the bare tenant domain (e.g. example.us.monocloud.com); the SDK appends /api/ automatically.`);
      }
      if (/^https?:\/\//.test(v)) {
        // The SDK prepends https:// itself when the scheme is missing, so a scheme is fine but not required.
        pass(`${name} includes an explicit scheme (optional; the SDK prepends https:// otherwise).`);
      }
    }
  } else {
    fail(`${name} missing (set env or add to .env / .env.local). init() falls back to these env vars when the corresponding init() option is omitted.`);
  }
}

// Optional timeout env var — must parse to a positive integer (milliseconds) or the SDK ignores it.
const timeoutRaw = process.env.MONOCLOUD_MANAGEMENT_TIMEOUT || env.MONOCLOUD_MANAGEMENT_TIMEOUT;
if (timeoutRaw !== undefined && timeoutRaw !== '') {
  const n = parseInt(timeoutRaw, 10);
  if (Number.isInteger(n) && n > 0) {
    pass(`MONOCLOUD_MANAGEMENT_TIMEOUT set (${n} ms).`);
  } else {
    warn(`MONOCLOUD_MANAGEMENT_TIMEOUT="${timeoutRaw}" is not a positive integer; the SDK will ignore it and use the 10000 ms default.`);
  }
}

// 3. Guard: an admin API key must never ship to the browser.
const apiKey = process.env.MONOCLOUD_MANAGEMENT_API_KEY || env.MONOCLOUD_MANAGEMENT_API_KEY;
if (apiKey && pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.next || deps.react || deps.vue || deps['@angular/core'] || deps.svelte) {
    warn('A frontend framework is present — make sure MONOCLOUD_MANAGEMENT_API_KEY is only read server-side (API routes / server actions), never exposed via a NEXT_PUBLIC_/VITE_ prefix or bundled into client code.');
  }
}

// 4. Source scan: usage patterns and common mistakes.
const sourceFiles = walkSource(ROOT, ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
let sdkImportFound = false;
let initFound = false;
let newConstructorHits = 0;
let hardcodedKeyHits = 0;
let dotDataHits = 0;
for (const file of sourceFiles) {
  const text = safeRead(file);
  if (!text) continue;
  if (text.includes(PKG_NAME)) sdkImportFound = true;
  if (/MonoCloudManagementClient\s*\.\s*init\s*\(/.test(text)) initFound = true;
  // Constructor is private — construction must go through the static init() factory.
  if (/new\s+MonoCloudManagementClient\s*\(/.test(text)) newConstructorHits += 1;
  // apiKey: '...literal...' — a hardcoded management key in source.
  if (/apiKey\s*:\s*['"][^'"\s]{12,}['"]/.test(text)) hardcodedKeyHits += 1;
  // .data on a management response is the .NET field; the JS SDK uses .result.
  if (/MonoCloudManagementClient|@monocloud\/management/.test(text) && /\.\s*data\b/.test(text)) dotDataHits += 1;
}

if (sourceFiles.length === 0) {
  warn('No source files found to scan (looked for *.ts/*.tsx/*.js/*.jsx/*.mjs/*.cjs).');
} else {
  pass(`Scanned ${sourceFiles.length} source file(s).`);

  if (sdkImportFound) {
    pass(`Found at least one reference to ${PKG_NAME} in source.`);
  } else if (pkg && { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }[PKG_NAME]) {
    warn(`${PKG_NAME} is installed but no source file imports it yet.`);
  }

  if (sdkImportFound && !initFound) {
    warn('No MonoCloudManagementClient.init(...) call found. Construct the client via the static factory — the constructor is private, so `new MonoCloudManagementClient()` will not compile.');
  }

  if (newConstructorHits > 0) {
    fail(`Found ${newConstructorHits} use(s) of \`new MonoCloudManagementClient(...)\`. The constructor is private — use \`MonoCloudManagementClient.init(options?, fetcher?)\` instead.`);
  }

  if (hardcodedKeyHits > 0) {
    warn(`Found ${hardcodedKeyHits} likely hardcoded \`apiKey:\` literal(s) in source. Read the API key from an env var / secret store instead of committing it.`);
  }

  if (dotDataHits > 0) {
    warn(`Found ${dotDataHits} file(s) reading \`.data\` near management usage. The JS SDK returns the body on \`response.result\` (\`.data\`/\`.pageData\` are the .NET SDK's field names).`);
  }
}

// Report
const tag = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
for (const [k, m] of findings) console.log(`[${tag[k]}] ${m}`);
const failed = findings.filter(([k]) => k === 'fail').length;
const warned = findings.filter(([k]) => k === 'warn').length;
console.log(`\n${findings.length} checks — ${failed} failed, ${warned} warning(s).`);
process.exit(failed > 0 ? 1 : 0);
