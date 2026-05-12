#!/usr/bin/env node
// Diagnostic for MonoCloud.Management .NET integrations.
// Usage: node skills/monocloud-management-dotnet/scripts/verify.js [project-dir]
// Cross-platform: pure Node — no .NET tooling required to run.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PACKAGE_ID = 'MonoCloud.Management';

const findings = [];
const pass = (m) => findings.push(['pass', m]);
const warn = (m) => findings.push(['warn', m]);
const fail = (m) => findings.push(['fail', m]);

function listFiles(dir, ext, depth = 3) {
  const out = [];
  (function walk(d, left) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (left > 0) walk(full, left - 1);
      } else if (entry.name.endsWith(ext)) {
        out.push(full);
      }
    }
  })(dir, depth);
  return out;
}

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// 1. Find .csproj files
const csprojs = listFiles(ROOT, '.csproj');
if (!csprojs.length) {
  fail(`No .csproj found under ${ROOT}`);
} else {
  pass(`Found ${csprojs.length} .csproj file(s)`);
}

// 2. Check each .csproj for MonoCloud.Management PackageReference
let installed = false;
for (const f of csprojs) {
  const t = safeRead(f) || '';
  if (new RegExp(`PackageReference\\s+Include="${PACKAGE_ID}"`).test(t)) {
    installed = true;
    pass(`${path.relative(ROOT, f)} references ${PACKAGE_ID}`);
  }
}
if (csprojs.length && !installed) {
  fail(`${PACKAGE_ID} not referenced in any .csproj. Run: dotnet add package ${PACKAGE_ID}`);
}

// 3. Inspect appsettings*.json for MonoCloud:Management section
const settingsFiles = listFiles(ROOT, '.json').filter((f) => /appsettings(\..+)?\.json$/i.test(path.basename(f)));
let domainConfigured = false;
let apiKeyInAppsettings = false;
for (const f of settingsFiles) {
  const t = safeRead(f);
  if (!t) continue;
  let cfg;
  try { cfg = JSON.parse(t); } catch { continue; }
  const section = cfg?.MonoCloud?.Management;
  if (!section) continue;
  pass(`MonoCloud:Management section found in ${path.relative(ROOT, f)}`);
  if (typeof section.Domain === 'string' && section.Domain.trim()) {
    pass(`  Domain set: ${section.Domain}`);
    if (!/^https?:\/\//.test(section.Domain)) warn('  Domain does not start with http(s)://');
    if (/\/api(\/|$)/.test(section.Domain)) warn('  Domain contains /api — pass bare tenant URL.');
    domainConfigured = true;
  }
  if (typeof section.ApiKey === 'string' && section.ApiKey.trim()) {
    apiKeyInAppsettings = true;
    warn(`  ApiKey is literal in ${path.relative(ROOT, f)} — move it to User Secrets / Key Vault / env var.`);
  }
}

// 4. Env-var fallback for domain (ASP.NET Core IConfiguration env-var form)
const envDomain = process.env.MonoCloud__Management__Domain;
if (envDomain) pass(`Domain via env var: ${envDomain}`);
if (!domainConfigured && !envDomain) {
  warn('No MonoCloud:Management:Domain found in appsettings or environment. Set it via appsettings.json, User Secrets, or the MonoCloud__Management__Domain env var.');
}

const envApiKey = process.env.MonoCloud__Management__ApiKey;
if (envApiKey) pass('ApiKey via env var present');
if (!apiKeyInAppsettings && !envApiKey) {
  warn('No ApiKey detected in appsettings or env. Recommended: `dotnet user-secrets set "MonoCloud:Management:ApiKey" "..."` (dev) or Key Vault / MonoCloud__Management__ApiKey env var (prod).');
}

// 5. Program.cs / Startup.cs hint
const programCs = listFiles(ROOT, '.cs').find((f) => /Program\.cs$/i.test(path.basename(f)));
if (programCs) {
  const t = safeRead(programCs) || '';
  if (/AddMonoCloudManagementClient/.test(t)) pass('Program.cs calls AddMonoCloudManagementClient');
  else warn('Program.cs found but no AddMonoCloudManagementClient(...) call detected.');
}

const tag = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
for (const [k, m] of findings) console.log(`[${tag[k]}] ${m}`);
const failed = findings.filter(([k]) => k === 'fail').length;
console.log(`\n${findings.length} checks — ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
