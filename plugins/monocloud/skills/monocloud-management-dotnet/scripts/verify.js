#!/usr/bin/env node
// Diagnostic for MonoCloud.Management (.NET) integrations.
// Usage: node scripts/verify.js [project-dir]
// Pure Node, zero dependencies, cross-platform; no .NET tooling needed.
//
// Checks:
//   - MonoCloud.Management is referenced (*.csproj, Directory.Packages.props, packages.config)
//     and MonoCloud.Management.Core is not referenced directly (it comes transitively).
//   - MonoCloud:Management settings in appsettings*.json, launchSettings.json and the environment:
//     Domain must be a bare https:// tenant URL (the SDK prepends "https://" to anything else and
//     appends "/api/" itself); Timeout must be a positive whole number of seconds (int.TryParse);
//     ApiKey must not be committed.
//   - The SDK reads no MONOCLOUD_MANAGEMENT_* variables; .NET maps MonoCloud__Management__* instead.
//   - Wiring: AddMonoCloudManagementClient(...) or new MonoCloudManagementClient(...).

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PACKAGE_ID = 'MonoCloud.Management';
const CORE_ID = 'MonoCloud.Management.Core';
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'packages']);
const KEYS = {
  domain: 'monocloud:management:domain',
  apiKey: 'monocloud:management:apikey',
  timeout: 'monocloud:management:timeout',
};

const findings = [];
const pass = (m) => findings.push(['pass', m]);
const warn = (m) => findings.push(['warn', m]);
const fail = (m) => findings.push(['fail', m]);

const read = (p) => {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
};
const rel = (p) => path.relative(ROOT, p) || path.basename(p);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nonEmpty = (v) => v !== undefined && v !== null && String(v).trim() !== '';

function listFiles(dir, match, depth = 5) {
  const out = [];
  (function walk(d, left) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (left > 0) walk(full, left - 1);
      } else if (match(e.name)) {
        out.push(full);
      }
    }
  })(dir, depth);
  return out;
}

// MSBuild looks for Directory.Packages.props in the project folder and its ancestors.
function findUp(name, from) {
  const found = [];
  for (let d = from; ; d = path.dirname(d)) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) found.push(p);
    if (path.dirname(d) === d) return found;
  }
}

// .NET's JSON configuration accepts a BOM, comments and trailing commas; strip them outside strings.
function parseJsonc(text) {
  const src = text.replace(/^\uFEFF/, '');
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inString) {
      out += c;
      if (c === '\\' && next !== undefined) { out += next; i++; }
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++;
    } else if (c === '}' || c === ']') {
      out = out.replace(/,\s*$/, '') + c;
    } else {
      out += c;
    }
  }
  try { return JSON.parse(out); } catch { return undefined; }
}

// Flatten like Microsoft.Extensions.Configuration: nested keys joined with ':', compared case-insensitively.
function flatten(value, prefix = '', out = new Map()) {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}:${k}` : k, out);
  } else if (prefix) {
    out.set(prefix.toLowerCase(), value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Package reference
// ---------------------------------------------------------------------------
const csprojs = listFiles(ROOT, (n) => n.endsWith('.csproj'));
const packagesConfigs = listFiles(ROOT, (n) => n.toLowerCase() === 'packages.config');
const cpmFiles = [...new Set([
  ...findUp('Directory.Packages.props', ROOT),
  ...listFiles(ROOT, (n) => n === 'Directory.Packages.props'),
])];

if (!csprojs.length) fail(`No .csproj found under ${ROOT}`);
else pass(`Found ${csprojs.length} .csproj file(s)`);

const referenceRe = (id) => new RegExp(
  `<PackageReference\\b[^>]*\\bInclude\\s*=\\s*"${esc(id)}"[^>]*?(?:/>|>([\\s\\S]*?)</PackageReference>)`, 'i');
const versionOf = (element) =>
  (element.match(/\bVersion(?:Override)?\s*=\s*"([^"]+)"/i) || element.match(/<Version>\s*([^<\s]+)\s*<\/Version>/i) || [])[1];

let installed = false;
let unversioned = false;
for (const f of csprojs) {
  const t = read(f) || '';
  const m = t.match(referenceRe(PACKAGE_ID));
  if (m) {
    installed = true;
    const v = versionOf(m[0]);
    if (!v) unversioned = true;
    pass(`${rel(f)} references ${PACKAGE_ID}${v ? ` (${v})` : ''}`);
  }
  if (referenceRe(CORE_ID).test(t)) {
    warn(`${rel(f)} references ${CORE_ID} directly — remove it; it comes transitively with ${PACKAGE_ID}.`);
  }
}
for (const f of packagesConfigs) {
  const m = (read(f) || '').match(new RegExp(`<package\\b[^>]*\\bid\\s*=\\s*"${esc(PACKAGE_ID)}"[^>]*>`, 'i'));
  if (m) {
    installed = true;
    const v = (m[0].match(/\bversion\s*=\s*"([^"]+)"/i) || [])[1];
    pass(`${rel(f)} lists ${PACKAGE_ID}${v ? ` (${v})` : ''}`);
  }
}
if (unversioned) {
  let pinned = false;
  for (const f of cpmFiles) {
    const m = (read(f) || '').match(new RegExp(`<PackageVersion\\b[^>]*\\bInclude\\s*=\\s*"${esc(PACKAGE_ID)}"[^>]*>`, 'i'));
    if (m) {
      pinned = true;
      pass(`${rel(f)} pins ${PACKAGE_ID} (${versionOf(m[0]) || 'no version'})`);
    }
  }
  if (!pinned) warn(`${PACKAGE_ID} is referenced without a version and no Directory.Packages.props entry was found.`);
}
if (csprojs.length && !installed) {
  fail(`${PACKAGE_ID} is not referenced. Run: dotnet add package ${PACKAGE_ID}`);
}

// ---------------------------------------------------------------------------
// 2. Configuration: appsettings*.json, launchSettings.json, environment
// ---------------------------------------------------------------------------
const config = { domain: [], apiKey: [], timeout: [] }; // entries: { source, value }

function collect(map, source) {
  for (const [name, key] of Object.entries(KEYS)) {
    if (map.has(key)) config[name].push({ source, value: map.get(key) });
  }
  for (const key of map.keys()) {
    if (/^(monocloud|management|monocloudmanagement|monocloud_management):(domain|apikey|api_key|timeout)$/.test(key)) {
      warn(`${source}: "${key}" is not read — the SDK reads the MonoCloud:Management section (MonoCloud:Management:Domain / ApiKey / Timeout).`);
    }
  }
}

function checkJsStyleEnv(names, source) {
  const js = names.filter((k) => /^MONOCLOUD_MANAGEMENT_/i.test(k));
  if (js.length) {
    warn(`${source} sets ${js.join(', ')} — this SDK doesn't read those. Use MonoCloud__Management__Domain / MonoCloud__Management__ApiKey / MonoCloud__Management__Timeout.`);
  }
}

const settingsFiles = listFiles(ROOT, (n) => /^appsettings(\..+)?\.json$/i.test(n));
for (const f of settingsFiles) {
  const json = parseJsonc(read(f) || '');
  if (json === undefined) {
    warn(`${rel(f)} could not be parsed as JSON — skipped.`);
    continue;
  }
  const map = flatten(json);
  if ([...map.keys()].some((k) => k.startsWith('monocloud:management:'))) {
    pass(`MonoCloud:Management settings found in ${rel(f)}`);
  }
  collect(map, rel(f));
}

for (const f of listFiles(ROOT, (n) => n.toLowerCase() === 'launchsettings.json')) {
  const json = parseJsonc(read(f) || '');
  const profiles = json && typeof json.profiles === 'object' && json.profiles ? json.profiles : {};
  for (const [name, profile] of Object.entries(profiles)) {
    const vars = profile && typeof profile.environmentVariables === 'object' ? profile.environmentVariables : null;
    if (!vars) continue;
    const source = `${rel(f)} (profile "${name}")`;
    collect(new Map(Object.entries(vars).map(([k, v]) => [k.replace(/__/g, ':').toLowerCase(), v])), source);
    checkJsStyleEnv(Object.keys(vars), source);
  }
}

collect(new Map(Object.entries(process.env)
  .filter(([k]) => /^monocloud__management__/i.test(k))
  .map(([k, v]) => [k.replace(/__/g, ':').toLowerCase(), v])), 'environment');
checkJsStyleEnv(Object.keys(process.env), 'environment');

function checkDomain(value, source) {
  const d = String(value).trim();
  if (/^https:\/\//.test(d)) pass(`${source}: Domain ${d}`);
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(d)) {
    warn(`${source}: Domain "${d}" must start with lowercase "https://" — the SDK prepends "https://" to anything else, producing "https://${d}".`);
  } else pass(`${source}: Domain ${d} (the SDK prepends https://)`);
  if (/\/api(\/|$)/i.test(d.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''))) {
    warn(`${source}: Domain contains /api — use the bare tenant URL (e.g. https://<tenant>.us.monocloud.com); the SDK appends /api/ itself.`);
  }
}

const domains = config.domain.filter(({ value }) => nonEmpty(value));
if (!domains.length) {
  warn('No MonoCloud:Management:Domain value found in appsettings, launchSettings or the environment. Set it there, or set options.Domain in AddMonoCloudManagementClient(...).');
}
for (const { source, value } of domains) checkDomain(value, source);

const committedKeys = config.apiKey.filter(({ source, value }) => source !== 'environment' && nonEmpty(value));
for (const { source } of committedKeys) {
  warn(`${source}: ApiKey is a literal value — move it to User Secrets or a secret manager, and rotate it if the file was ever committed.`);
}
const envKey = config.apiKey.some(({ source, value }) => source === 'environment' && nonEmpty(value));
if (envKey) pass('ApiKey supplied by the MonoCloud__Management__ApiKey environment variable');
if (!committedKeys.length && !envKey) {
  const userSecrets = csprojs.some((f) => /<UserSecretsId>\s*[^<\s]+\s*<\/UserSecretsId>/i.test(read(f) || ''));
  if (userSecrets) {
    pass('No ApiKey in appsettings, launchSettings or the environment; the project has a <UserSecretsId>, so it is expected in User Secrets (check with: dotnet user-secrets list).');
  } else {
    warn('No ApiKey found. Development: dotnet user-secrets init, then dotnet user-secrets set "MonoCloud:Management:ApiKey" "<key>". Production: a secret manager or the MonoCloud__Management__ApiKey environment variable.');
  }
}

for (const { source, value } of config.timeout) {
  const s = String(value ?? '').trim();
  const n = /^[+-]?\d+$/.test(s) ? Number(s) : NaN;
  if (!Number.isSafeInteger(n) || n > 2147483647 || n < -2147483648) {
    warn(`${source}: Timeout "${value}" is not a whole number — int.TryParse rejects it and the SDK silently uses the 10-second default.`);
  } else if (n <= 0) {
    warn(`${source}: Timeout ${n} must be positive — HttpClient rejects a zero or negative timeout when the client is created.`);
  } else if (n >= 1000) {
    warn(`${source}: Timeout ${n} is in seconds (${(n / 3600).toFixed(1)} hours) — milliseconds are not supported here.`);
  } else {
    pass(`${source}: Timeout ${n}s`);
  }
}

// ---------------------------------------------------------------------------
// 3. Wiring in .cs sources
// ---------------------------------------------------------------------------
const csFiles = listFiles(ROOT, (n) => n.endsWith('.cs'));
const isTest = (p) => /(^|[\\/])[^\\/]*tests?([\\/.]|$)/i.test(rel(p));
let diCall = false;
let importsSdk = false;
const directCtors = [];
for (const f of csFiles) {
  const t = read(f);
  if (!t) continue;
  if (/\busing\s+MonoCloud\.Management\b/.test(t)) importsSdk = true;
  if (/\bAddMonoCloudManagementClient\s*\(/.test(t)) diCall = true;
  if (/\bnew\s+MonoCloudManagementClient\s*\(/.test(t)) directCtors.push(f);
  for (const m of t.matchAll(/\bnew\s+MonoCloudConfig\s*\(\s*(?:domain\s*:\s*)?"([^"]*)"\s*(,\s*(?:apiKey\s*:\s*)?"[^"]+")?/g)) {
    if (m[1].trim()) checkDomain(m[1], `${rel(f)} (MonoCloudConfig)`);
    if (m[2] && !isTest(f)) warn(`${rel(f)}: MonoCloudConfig receives a literal API key — load it from configuration or a secret store.`);
  }
}

if (!csFiles.length) {
  warn('No .cs files found to check the wiring.');
} else {
  pass(`Scanned ${csFiles.length} .cs file(s)`);
  if (diCall) pass('AddMonoCloudManagementClient(...) found — inject MonoCloudManagementClient where it is needed.');
  if (directCtors.length) pass(`new MonoCloudManagementClient(...) found in ${directCtors.map(rel).join(', ')}`);
  const appCtors = directCtors.filter((f) => !isTest(f));
  if (diCall && appCtors.length) {
    warn(`DI registration exists, but ${appCtors.map(rel).join(', ')} also constructs MonoCloudManagementClient — inject the registered client instead; every new instance creates its own HttpClients.`);
  }
  if (!diCall && !directCtors.length) {
    warn('No AddMonoCloudManagementClient(...) or new MonoCloudManagementClient(...) found. Register it with builder.Services.AddMonoCloudManagementClient(builder.Configuration).');
  }
  if (importsSdk && !installed) {
    warn(`Code imports MonoCloud.Management namespaces, but no ${PACKAGE_ID} reference was found.`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const tag = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
for (const [kind, message] of findings) console.log(`[${tag[kind]}] ${message}`);
const failed = findings.filter(([k]) => k === 'fail').length;
const warned = findings.filter(([k]) => k === 'warn').length;
console.log(`\n${findings.length} checks — ${failed} failed, ${warned} warning(s).`);
process.exit(failed > 0 ? 1 : 0);
