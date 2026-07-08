#!/usr/bin/env node
// Diagnostic for MonoCloud.Management .NET integrations.
// Usage: node skills/monocloud-management-dotnet/scripts/verify.js [project-dir]
// Cross-platform: pure Node — no .NET tooling required to run.
//
// Grounded in MonoCloud.Management v0.2.10:
//   - PackageReference id:   MonoCloud.Management
//   - Config section:        MonoCloud:Management  (keys: Domain, ApiKey, Timeout)
//   - DI extension:          AddMonoCloudManagementClient(...)
//   - Direct construction:   new MonoCloudManagementClient(config | httpClient)
// The SDK reads NO MONOCLOUD_MANAGEMENT_* env vars of its own — config flows
// through the standard .NET IConfiguration providers (appsettings, User Secrets,
// Key Vault, or the MonoCloud__Management__* double-underscore env-var form).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PACKAGE_ID = 'MonoCloud.Management';

const findings = [];
const pass = (m) => findings.push(['pass', m]);
const warn = (m) => findings.push(['warn', m]);
const fail = (m) => findings.push(['fail', m]);

function listFiles(dir, ext, depth = 4) {
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

// 2. Check each .csproj for the MonoCloud.Management PackageReference.
//    Match Include="MonoCloud.Management" but NOT "MonoCloud.Management.Core"
//    (the transitive core package) — the app should reference the top package.
let installed = false;
for (const f of csprojs) {
  const t = safeRead(f) || '';
  if (new RegExp(`PackageReference\\s+Include="${PACKAGE_ID}"`).test(t)) {
    installed = true;
    const m = t.match(new RegExp(`Include="${PACKAGE_ID}"[^>]*Version="([^"]+)"`));
    pass(`${path.relative(ROOT, f)} references ${PACKAGE_ID}${m ? ` (${m[1]})` : ''}`);
  }
}
if (csprojs.length && !installed) {
  // Distinguish "only the Core package is present" from "nothing at all".
  const coreOnly = csprojs.some((f) => /PackageReference\s+Include="MonoCloud\.Management\.Core"/.test(safeRead(f) || ''));
  if (coreOnly) {
    warn(`Only MonoCloud.Management.Core is referenced (a transitive dependency). Add the top-level package: dotnet add package ${PACKAGE_ID}`);
  } else {
    fail(`${PACKAGE_ID} not referenced in any .csproj. Run: dotnet add package ${PACKAGE_ID}`);
  }
}

// 3. Inspect appsettings*.json for the MonoCloud:Management section.
const settingsFiles = listFiles(ROOT, '.json').filter((f) => /appsettings(\..+)?\.json$/i.test(path.basename(f)));
let domainConfigured = false;
let apiKeyInAppsettings = false;
for (const f of settingsFiles) {
  const t = safeRead(f);
  if (!t) continue;
  let cfg;
  try { cfg = JSON.parse(t); } catch { continue; }
  const section = cfg && cfg.MonoCloud && cfg.MonoCloud.Management;
  if (!section) continue;
  const rel = path.relative(ROOT, f);
  pass(`MonoCloud:Management section found in ${rel}`);

  if (typeof section.Domain === 'string' && section.Domain.trim()) {
    pass(`  Domain set: ${section.Domain}`);
    if (!/^https?:\/\//i.test(section.Domain)) {
      warn('  Domain does not start with http(s):// — the SDK prepends https:// but set it explicitly.');
    }
    if (/\/api(\/|$)/i.test(section.Domain)) {
      warn('  Domain contains /api — pass the bare tenant URL (e.g. https://<tenant>.us.monocloud.com); the SDK appends /api/ itself.');
    }
    domainConfigured = true;
  }

  if (typeof section.ApiKey === 'string' && section.ApiKey.trim()) {
    apiKeyInAppsettings = true;
    warn(`  ApiKey is a literal value in ${rel} — move it to User Secrets / Key Vault / an env var. Management API keys are tenant-admin credentials and must never be committed.`);
  }

  if (section.Timeout !== undefined && !(typeof section.Timeout === 'number' || (typeof section.Timeout === 'string' && /^\d+$/.test(section.Timeout)))) {
    warn('  Timeout should be an integer number of seconds (parsed via int.TryParse); defaults to 10s when unset/unparseable.');
  }
}

// 4. Env-var (standard .NET IConfiguration double-underscore form).
const envDomain = process.env.MonoCloud__Management__Domain;
if (envDomain) pass(`Domain via env var MonoCloud__Management__Domain: ${envDomain}`);
if (!domainConfigured && !envDomain) {
  warn('No MonoCloud:Management:Domain found in appsettings or environment. Set it via appsettings.json, User Secrets, or the MonoCloud__Management__Domain env var — or pass it directly through AddMonoCloudManagementClient(options => options.Domain = ...).');
}

const envApiKey = process.env.MonoCloud__Management__ApiKey;
if (envApiKey) pass('ApiKey via env var MonoCloud__Management__ApiKey present');
if (!apiKeyInAppsettings && !envApiKey) {
  warn('No ApiKey detected in appsettings or env. Recommended: `dotnet user-secrets set "MonoCloud:Management:ApiKey" "..."` (dev) or Key Vault / the MonoCloud__Management__ApiKey env var (prod).');
}

// 5. Wiring: DI registration or direct construction, across all .cs sources.
const csFiles = listFiles(ROOT, '.cs');
let diCall = false;
let directCtor = false;
let importsSdk = false;
for (const f of csFiles) {
  const t = safeRead(f);
  if (!t) continue;
  if (/using\s+MonoCloud\.Management/.test(t)) importsSdk = true;
  if (/AddMonoCloudManagementClient\s*\(/.test(t)) diCall = true;
  if (/new\s+MonoCloudManagementClient\s*\(/.test(t)) directCtor = true;
}

if (csFiles.length === 0) {
  warn('No .cs source files found to scan for wiring.');
} else {
  pass(`Scanned ${csFiles.length} .cs source file(s).`);
  if (diCall) {
    pass('Found AddMonoCloudManagementClient(...) — client registered via DI (inject MonoCloudManagementClient).');
  }
  if (directCtor) {
    pass('Found new MonoCloudManagementClient(...) — client constructed directly.');
  }
  if (!diCall && !directCtor) {
    warn('No AddMonoCloudManagementClient(...) call or new MonoCloudManagementClient(...) found. Register via builder.Services.AddMonoCloudManagementClient(builder.Configuration) or construct directly with a MonoCloudConfig / HttpClient.');
  }
  if (importsSdk && installed === false) {
    warn('Source uses "using MonoCloud.Management" but the package is not referenced — add the PackageReference so it restores.');
  }
}

// Report
const tag = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
for (const [k, m] of findings) console.log(`[${tag[k]}] ${m}`);
const failed = findings.filter(([k]) => k === 'fail').length;
const warned = findings.filter(([k]) => k === 'warn').length;
console.log(`\n${findings.length} checks — ${failed} failed, ${warned} warning(s).`);
process.exit(failed > 0 ? 1 : 0);
