#!/usr/bin/env node
// Diagnostic for @monocloud/auth-react integrations.
// Usage: node skills/monocloud-auth-react/scripts/verify.js [project-dir]
// Cross-platform: pure Node. No external deps.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG_NAME = '@monocloud/auth-react';

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

  // React peer-dep sanity. SDK supports react ^18 || ^19.2.3.
  if (deps.react) {
    pass(`react detected (${deps.react})`);
    const m = String(deps.react).match(/(\d+)/);
    const major = m ? Number(m[1]) : null;
    if (major !== null && major < 18) {
      warn(`React ${deps.react} looks pre-18. ${PKG_NAME} requires react ^18.0.0 || ^19.2.3.`);
    }
  } else {
    warn('"react" not in dependencies — this SDK requires React >=18.');
  }
  if (!deps['react-dom']) {
    warn('"react-dom" not in dependencies — required peer dep.');
  }

  // Warn if a higher-priority MonoCloud SDK is also installed.
  if (deps.next || deps['@monocloud/auth-nextjs']) {
    warn('Next.js / @monocloud/auth-nextjs is present. For Next.js apps prefer monocloud-auth-nextjs — this SDK is for plain React SPAs.');
  }
  if (deps['@monocloud/auth-web-js']) {
    warn('@monocloud/auth-web-js is also installed directly. @monocloud/auth-react already depends on it; usually you only need to install the react package.');
  }
  if (deps['@monocloud/backend-node']) {
    warn('@monocloud/backend-node is installed. That SDK is for server-side API token validation — unrelated to react sign-in but make sure secrets stay server-side.');
  }
  if (deps['@monocloud/management']) {
    warn('@monocloud/management is installed. Management keys are tenant-admin and must only run server-side — never reference them from the same bundle that uses @monocloud/auth-react.');
  }

  // Bundler signal — useful confidence that this is a real SPA.
  const bundlers = ['vite', 'parcel', 'webpack', 'rollup', 'esbuild', '@rspack/core', 'react-scripts'];
  const bundler = bundlers.find((b) => deps[b]);
  if (bundler) pass(`Bundler detected: ${bundler}`);
}

// 2. Source scan.
const sourceFiles = walkSource(ROOT, ['.ts', '.tsx', '.js', '.jsx', '.mjs']);
let sdkImportFound = false;
let providerFound = false;
let useAuthFound = false;
let processCallbackComponentFound = false;
let autoProcessCallbackFalseFound = false;
let clientSecretHits = 0;
const useAuthInServerFiles = [];

for (const file of sourceFiles) {
  const text = safeRead(file);
  if (!text) continue;

  const importsSdk = text.includes(PKG_NAME);
  if (importsSdk) sdkImportFound = true;
  if (/<MonoCloudAuthProvider[\s>]/.test(text)) providerFound = true;
  if (/\buseAuth\s*\(/.test(text) && importsSdk) useAuthFound = true;
  if (/<ProcessCallback[\s/>]/.test(text)) processCallbackComponentFound = true;
  if (/autoProcessCallback\s*=\s*\{\s*false\s*\}/.test(text) || /autoProcessCallback\s*=\s*false/.test(text)) {
    autoProcessCallbackFalseFound = true;
  }
  if (/\bclientSecret\s*[:=]/.test(text)) clientSecretHits += 1;

  // Hint: a Next.js Server Component file (no "use client" at top) that imports the react SDK.
  if (importsSdk && /\.(tsx|jsx)$/.test(file)) {
    const head = text.split('\n').slice(0, 5).join('\n');
    const hasUseClient = /['"]use client['"]/.test(head);
    if (!hasUseClient && /\bapp\//.test(file) && !/pages\//.test(file)) {
      useAuthInServerFiles.push(path.relative(ROOT, file));
    }
  }
}

if (sourceFiles.length === 0) {
  warn('No source files found to scan (looked for *.ts/*.tsx/*.js/*.jsx/*.mjs).');
} else {
  pass(`Scanned ${sourceFiles.length} source file(s).`);

  if (sdkImportFound) {
    pass(`Found at least one import of ${PKG_NAME} in source.`);
  } else if (pkg && (pkg.dependencies || pkg.devDependencies)?.[PKG_NAME]) {
    warn(`${PKG_NAME} is installed but no source file imports it yet.`);
  }

  if (sdkImportFound && !providerFound) {
    warn('No <MonoCloudAuthProvider> usage found. Wrap your app root with the provider so useAuth() / useClient() work.');
  }

  if (sdkImportFound && providerFound && !useAuthFound) {
    warn('Provider mounted but no useAuth() call found — your components have no way to read the auth state yet.');
  }

  if (processCallbackComponentFound && !autoProcessCallbackFalseFound) {
    warn('<ProcessCallback /> is mounted but autoProcessCallback={false} was not found on the provider. Pick one path — both run processCallback() and the duplicate causes a loading flicker.');
  }

  if (clientSecretHits > 0) {
    warn(`Found ${clientSecretHits} reference(s) to "clientSecret" in source. SPAs are public clients — clientSecret cannot be safely shipped to the browser. Remove it unless you genuinely have a confidential-client setup.`);
  }

  if (useAuthInServerFiles.length > 0) {
    warn(`Found ${PKG_NAME} imports in files under app/ that do NOT start with "use client":\n  ${useAuthInServerFiles.slice(0, 5).join('\n  ')}\nEvery file in @monocloud/auth-react is client-only — add "use client" at the top, or move the import. (If this is a Next.js project, you probably want @monocloud/auth-nextjs instead.)`);
  }
}

// Report
const tag = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
for (const [k, m] of findings) console.log(`[${tag[k]}] ${m}`);
const failed = findings.filter(([k]) => k === 'fail').length;
console.log(`\n${findings.length} checks — ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
