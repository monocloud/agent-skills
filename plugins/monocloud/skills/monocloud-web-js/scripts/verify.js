#!/usr/bin/env node
// Diagnostic for @monocloud/auth-web-js integrations.
// Usage: node skills/monocloud-web-js/scripts/verify.js [project-dir]
// Cross-platform: pure Node. No external deps.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG_NAME = '@monocloud/auth-web-js';

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

// 1. Package.json + SDK dependency
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

  // Warn if a higher-level MonoCloud SDK is also present — the framework SDK is probably the right one.
  if (deps['@monocloud/auth-nextjs']) {
    warn('@monocloud/auth-nextjs is also installed. For Next.js apps prefer monocloud-auth-nextjs; the web-js SDK is for vanilla browser SPAs.');
  }
  if (deps['@monocloud/auth-react']) {
    warn('@monocloud/auth-react is also installed. For React SPAs prefer monocloud-auth-react (<MonoCloudAuthProvider> / useAuth); web-js is the underlying SDK it wraps.');
  }
  if (deps['@monocloud/backend-node']) {
    warn('@monocloud/backend-node is installed. That SDK is for server-side API token validation, not browser sign-in — unrelated to web-js.');
  }
  if (deps['@monocloud/management']) {
    warn('@monocloud/management is installed. Management keys are tenant-admin and must only run server-side — never reference them from the same bundle that uses web-js.');
  }

  // Note useful frontend bundler/framework signals without erroring.
  const bundlers = ['vite', 'parcel', 'webpack', 'rollup', 'esbuild', '@rspack/core'];
  const bundler = bundlers.find((b) => deps[b]);
  if (bundler) pass(`Bundler detected: ${bundler}`);

  if (deps.react && !deps['@monocloud/auth-react']) warn('React detected — @monocloud/auth-react wraps this SDK with <MonoCloudAuthProvider>, useAuth(), and components (skill: monocloud-auth-react). Prefer it for React SPAs.');
  if (deps.vue)     warn('Vue detected — consider a Vue-specific SDK if/when one becomes available.');
  if (deps['@angular/core']) warn('Angular detected — consider an Angular-specific SDK if/when one becomes available.');
  if (deps.svelte)  warn('Svelte detected — consider a Svelte-specific SDK if/when one becomes available.');
}

// 2. Source scan: look for clientSecret references (a sign of misconfigured public client).
const sourceFiles = walkSource(ROOT, ['.ts', '.tsx', '.js', '.jsx', '.mjs']);
let clientSecretHits = 0;
let webJsImportFound = false;
let processCallbackFound = false;
for (const file of sourceFiles) {
  const text = safeRead(file);
  if (!text) continue;
  if (text.includes(PKG_NAME)) webJsImportFound = true;
  if (/\bprocessCallback\s*\(/.test(text)) processCallbackFound = true;
  // Match `clientSecret:` in an object literal — avoids false positives in comments/strings most of the time.
  if (/\bclientSecret\s*:/.test(text)) clientSecretHits += 1;
}

if (sourceFiles.length === 0) {
  warn('No source files found to scan (looked for *.ts/*.tsx/*.js/*.jsx/*.mjs).');
} else {
  pass(`Scanned ${sourceFiles.length} source file(s).`);

  if (webJsImportFound) {
    pass(`Found at least one import of ${PKG_NAME} in source.`);
  } else if (pkg && (pkg.dependencies || pkg.devDependencies)?.[PKG_NAME]) {
    warn(`${PKG_NAME} is installed but no source file imports it yet.`);
  }

  if (webJsImportFound && !processCallbackFound) {
    warn('No processCallback() call found in source. Call it once at app startup so sign-in / sign-out callbacks complete (it is a no-op when the URL is not a callback).');
  }

  if (clientSecretHits > 0) {
    warn(`Found ${clientSecretHits} reference(s) to "clientSecret" in source. Browser SPAs are public clients — clientSecret cannot be safely shipped to the browser. Remove it unless you genuinely have a confidential-client setup.`);
  }
}

// Report
const tag = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
for (const [k, m] of findings) console.log(`[${tag[k]}] ${m}`);
const failed = findings.filter(([k]) => k === 'fail').length;
console.log(`\n${findings.length} checks — ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
