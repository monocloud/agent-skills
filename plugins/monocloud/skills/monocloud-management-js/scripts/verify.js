#!/usr/bin/env node
// Diagnostic for @monocloud/management integrations.
// Usage: node scripts/verify.js [project-dir]
// Pure Node, no dependencies, cross-platform.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG = '@monocloud/management';
const CORE_PKG = '@monocloud/management-core';
const DOMAIN = 'MONOCLOUD_MANAGEMENT_DOMAIN';
const API_KEY = 'MONOCLOUD_MANAGEMENT_API_KEY';
const TIMEOUT = 'MONOCLOUD_MANAGEMENT_TIMEOUT';
const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local'];
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);
const PUBLIC = '(?:NEXT_PUBLIC_|VITE_|REACT_APP_|NUXT_PUBLIC_|EXPO_PUBLIC_|GATSBY_|PUBLIC_)\\w*MONOCLOUD_MANAGEMENT_\\w*';
const BROWSER_DEPS = ['vite', 'react-scripts', '@angular/core', 'vue', 'svelte', 'preact', 'solid-js'];
const SERVER_DEPS = ['next', 'nuxt', '@sveltejs/kit', '@remix-run/node', '@react-router/node', 'astro', 'express', 'fastify', 'koa', 'hono', '@nestjs/core', '@hapi/hapi', 'h3'];
// Exported only by the internal core package, not by @monocloud/management.
const CORE_ONLY = new Set(['MonoCloudPageResponse', 'PageModel', 'ProblemDetails', 'MonoCloudCodedException', 'MonoCloudClientBase', 'MonoCloudRequest', 'MonoCloudEvent']);
// Resource-client methods exposed by MonoCloudManagementClient, per accessor.
const METHODS = {
  branding: 'findPageBrandingOptions patchPageBrandingOptions findEmailBrandingOptions patchEmailBrandingOptions findSmsBrandingOptions patchSmsBrandingOptions',
  clients: 'getAllApplications createApplication findApplicationById patchApplication deleteApplication getAllApplicationSecrets createApplicationSecret findApplicationSecretById deleteApplicationSecret getAllApplicationGroups findApplicationGroup assignGroupToApplication removeGroupFromApplication getAllGroupAssignedApplications',
  groups: 'getAllGroups createGroup findGroupById patchGroup deleteGroup',
  keys: 'getAllKeyMaterials rotateKey revokeKey',
  logs: 'getAllLogs findLogById',
  networkZones: 'getAllNetworkZones createIpNetworkZone findIpNetworkZoneById patchIpNetworkZone deleteIpNetworkZone createRegionalNetworkZone findRegionalNetworkZoneById patchRegionalNetworkZone deleteRegionalNetworkZone',
  options: 'findAuthenticationOptions patchAuthenticationOptions findCommunicationOptions patchCommunicationOptions getAllSignUpCustomFields createSignUpCustomField findSignUpCustomField patchSignUpCustomField deleteSignUpCustomField getAllExternalAuthenticators createExternalProvider findExternalProvider patchExternalProvider deleteExternalProvider',
  resources: 'getAllApiResources createApiResource findApiResourceById patchApiResource deleteApiResource getAllApiResourceSecrets createApiResourceSecret findApiResourceSecretById deleteApiResourceSecret getAllApiScopes createApiScope findApiScopeById patchApiScope deleteApiScope getAllApiAccessPolicies createApiAccessBasicPolicy findApiAccessBasicPolicyById patchApiAccessBasicPolicy deleteApiAccessBasicPolicy convertApiAccessBasicToAdvancedPolicy createApiAccessAdvancedPolicy findApiAccessAdvancedPolicyById patchApiAccessAdvancedPolicy deleteApiAccessAdvancedPolicy getAllScopes createScope findScopeById patchScope deleteScope getAllClaimResources createClaimResource findClaimResourceById patchClaimResource deleteClaimResource',
  trustStores: 'getAllPkiTrustStores createPkiTrustStore findPkiTrustStoreById patchPkiTrustStore deletePkiTrustStore setPkiTrustStoreDefault getAllRevocations addCertificateRevocation findCertificateRevocation removeCertificateRevocation getAllPkiBannedCertificates banPkiTrustStoreCertificate unbanPkiTrustStoreCertificate getAllSpiffeTrustStores createSpiffeTrustStore findSpiffeTrustStoreById patchSpiffeTrustStore deleteSpiffeTrustStore setSpiffeTrustStoreDefault getAllSpiffeBannedSvids banSpiffeTrustStoreSvid unbanSpiffeTrustStoreSvid',
  users: 'getAllUsers createUser findUserById deleteUser enableUser disableUser unblockUser updateUsername removeUsername addEmail removeEmail setPrimaryEmail setEmailVerified setEmailUnverified verifyEmail addPhone removePhone setPrimaryPhone setPhoneVerified setPhoneUnverified removePasskey setPassword removePassword setPasswordResetRequired removePasswordResetRequired resetPassword changePassword patchClaims getPrivateData patchPrivateData getPublicData patchPublicData getAllBlockedIps unblockIp getAllUserSessions findUserSession revokeUserSession externalAuthenticatorDisconnect getAllUserGroups findUserGroup assignUserToGroup removeUserFromGroup getAllGroupAssignedUsers getAllUserClientGrants getAllUserConsents getAllReferenceTokens getAllRefreshTokens getAllAuthorizationCodes revokeUserClientGrants revokeUserConsent revokeReferenceToken revokeRefreshToken revokeAuthorizationCode',
};
const KNOWN = Object.fromEntries(Object.entries(METHODS).map(([k, v]) => [k, new Set(v.split(' '))]));
const ACCESSORS = Object.keys(METHODS).join('|');

const findings = [];
const pass = (m) => findings.push(['PASS', m]);
const warn = (m) => findings.push(['WARN', m]);
const fail = (m) => findings.push(['FAIL', m]);
const rel = (f) => path.relative(ROOT, f) || f;
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readText(p)); } catch { return null; } };

// What the installed SDK declares. Methods and exports found there exist in that release even
// when the lists below don't know them yet, so they are never reported as missing.
const INSTALLED_DECLS = (() => {
  const chunks = [];
  (function walkDecls(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4 && e.name !== 'node_modules') walkDecls(full, depth + 1); }
      else if (/\.d\.[cm]?ts$/.test(e.name)) chunks.push(readText(full) || '');
    }
  })(path.join(ROOT, 'node_modules', ...PKG.split('/')), 0);
  return chunks.join('\n');
})();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const methodInInstalledSdk = (name) => !!INSTALLED_DECLS && new RegExp(`\\b${reEsc(name)}\\s*[(<]`).test(INSTALLED_DECLS);
const exportedByInstalledSdk = (name) => !!INSTALLED_DECLS
  && (new RegExp(`export\\s+(declare\\s+)?(abstract\\s+)?(function|const|let|var|class|interface|type|enum)\\s+${reEsc(name)}\\b`).test(INSTALLED_DECLS)
    || new RegExp(`export\\s*(type\\s*)?\\{[^}]*\\b${reEsc(name)}\\b[^}]*\\}`).test(INSTALLED_DECLS));
const escapeId = (s) => s.replace(/\$/g, '\\$');
const list = (items) => [...new Set(items)].join(', ');

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    if (!line || line.startsWith('#') || eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length > 1 && value.endsWith(q)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

function walk(dir, depth, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) walk(full, depth - 1, out); }
    else if (SOURCE_EXTS.some((x) => e.name.endsWith(x)) && !e.name.endsWith('.d.ts') && full !== __filename) out.push(full);
  }
  return out;
}

// 1. Package and runtime
const pkg = readJson(path.join(ROOT, 'package.json'));
const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
if (!pkg) {
  fail(`No readable package.json in ${ROOT}.`);
} else if (!deps[PKG]) {
  fail(`${PKG} is not in package.json. Run: npm install ${PKG}`);
} else {
  const installed = readJson(path.join(ROOT, 'node_modules', PKG, 'package.json'));
  if (installed) pass(`${PKG} declared (${deps[PKG]}), installed ${installed.version}.`);
  else warn(`${PKG} is declared (${deps[PKG]}) but not installed in node_modules. Run your package manager's install.`);
}
if (deps[CORE_PKG]) warn(`${CORE_PKG} is a direct dependency. It is the SDK's internal runtime; import everything from ${PKG}.`);
if (BROWSER_DEPS.some((d) => deps[d]) && !SERVER_DEPS.some((d) => deps[d])) {
  warn('This looks like a browser-only app. The management SDK holds a tenant admin API key and must run on a server, never in a client bundle.');
}
if (Number(process.versions.node.split('.')[0]) < 18) {
  warn(`Node ${process.versions.node}: the SDK's built-in transport needs global fetch and AbortSignal.timeout (Node 18+), or a custom fetcher.`);
}

// Gather source facts (used by the configuration checks too).
const texts = walk(ROOT, 8, []).map((f) => [f, readText(f) || '']);
const usesSdk = (t) => t.includes(PKG) || t.includes('MonoCloudManagementClient');
const clientIds = new Set();
const initOptions = [];
for (const [f, t] of texts) {
  const assign = /([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>|\s]+?)?\s*(?:\?\?|\|\|)?=\s*(?:await\s+)?MonoCloudManagementClient\s*\.\s*init\s*\(/g;
  for (const m of t.matchAll(assign)) clientIds.add(m[1]);
  for (const m of t.matchAll(/MonoCloudManagementClient\s*\.\s*init\s*\(\s*(\{[\s\S]{0,800}?\})\s*[,)]/g)) initOptions.push([f, m[1]]);
}
const passesOption = (key) => initOptions.some(([, o]) => new RegExp(`\\b${key}\\b`).test(o));

// 2. Configuration (process env + env files)
const sources = [{ name: 'process env', vars: process.env }];
for (const file of ENV_FILES) {
  const text = readText(path.join(ROOT, file));
  if (text !== null) sources.push({ name: file, vars: parseEnv(text) });
}
const values = (name) => sources.filter((s) => s.vars[name]).map((s) => ({ src: s.name, v: s.vars[name] }));

const publicKey = new RegExp(`^${PUBLIC}$`);
for (const s of sources) {
  for (const key of Object.keys(s.vars).filter((k) => publicKey.test(k))) {
    (key.includes('API_KEY') ? fail : warn)(`${s.name}: ${key} has a browser-exposed prefix. Use the server-only ${key.slice(key.indexOf('MONOCLOUD_MANAGEMENT_'))}.`);
  }
}

for (const [name, option, error] of [[DOMAIN, 'domain', 'Tenant Domain is required'], [API_KEY, 'apiKey', 'Api Key is required']]) {
  const found = values(name);
  if (!found.length) {
    if (passesOption(option)) warn(`${name} not found in process env or ${ENV_FILES.join(', ')}; init() receives \`${option}\` explicitly, so make sure that value is set at runtime.`);
    else fail(`${name} not set (checked process env and ${ENV_FILES.join(', ')}). init() throws "${error}" without it.`);
    continue;
  }
  pass(`${name} set (${list(found.map((x) => x.src))}).`);
  if (name !== DOMAIN) continue;
  for (const { src, v } of found) {
    if (v.includes('://') && !v.startsWith('https://')) {
      fail(`${src}: ${name}="${v}". Only a lowercase "https://" prefix is recognized; the SDK prepends another one (e.g. http://host becomes https://http//host), so every call fails with "Something went wrong.". Use the bare host or https://host.`);
      continue;
    }
    const urlPath = v.replace(/^https:\/\//, '').replace(/\/+$/, '').split('/').slice(1).join('/');
    if (/^api(\/|$)/i.test(urlPath)) fail(`${src}: ${name}="${v}" includes /api. The SDK appends /api/ itself, so calls would go to /api/api/... and 404.`);
    else if (urlPath) warn(`${src}: ${name}="${v}" includes a path. Pass only the tenant host.`);
  }
}

const timeouts = values(TIMEOUT);
for (const { src, v } of timeouts) {
  const n = parseInt(v, 10);
  if (!(Number.isInteger(n) && n > 0)) warn(`${src}: ${TIMEOUT}="${v}" is not a positive integer, so the SDK ignores it and uses 10000 ms.`);
  else if (String(n) !== v.trim()) warn(`${src}: ${TIMEOUT}="${v}" is read as ${n} ms (parseInt stops at the first non-digit). Use a plain number of milliseconds.`);
  else if (n < 1000) warn(`${src}: ${TIMEOUT}=${n} means ${n} ms. The value is milliseconds, not seconds.`);
  else pass(`${TIMEOUT} = ${n} ms (${src}).`);
}
if (timeouts.length && passesOption('config')) warn(`${TIMEOUT} is set, but init() is passed a \`config\` object, so the SDK ignores the env var.`);

// 3. Source checks
const hits = { newCtor: [], core: [], coreOnly: [], useClient: [], publicRef: [], hardKey: [], tsOptions: [], unknown: [], dotData: [] };
const ids = [...clientIds].map(escapeId).join('|');
const dot = '\\s*!?\\s*\\??\\.\\s*'; // ".", "!.", "?."
const callRe = ids && new RegExp(`\\b(?:${ids})${dot}(${ACCESSORS})${dot}([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
const awaitCall = `await\\s+(?:${ids})${dot}(?:${ACCESSORS})${dot}`;
for (const [f, t] of texts) {
  for (const m of t.matchAll(new RegExp(`\\b${PUBLIC}`, 'g'))) hits.publicRef.push(`${rel(f)} (${m[0]})`);
  if (ids) {
    for (const m of t.matchAll(callRe)) if (!KNOWN[m[1]].has(m[2]) && !methodInInstalledSdk(m[2])) hits.unknown.push(`${rel(f)}: .${m[1]}.${m[2]}()`);
    const vars = [...t.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${awaitCall}`, 'g'))].map((m) => escapeId(m[1]));
    const viaVar = vars.length > 0 && new RegExp(`\\b(?:${vars.join('|')})\\s*\\.\\s*(?:data|Data|PageData)\\b`).test(t);
    const viaParen = new RegExp(`\\(\\s*${awaitCall}\\s*\\w+\\s*\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)\\s*\\)\\s*\\.\\s*(?:data|Data|PageData)\\b`).test(t);
    const viaDestructure = [...t.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${awaitCall}`, 'g'))]
      .some((m) => m[1].split(',').some((p) => /^(?:data|Data|PageData)$/.test(p.split(':')[0].trim())));
    if (viaVar || viaParen || viaDestructure) hits.dotData.push(rel(f));
  }
  if (!usesSdk(t)) continue;
  if (/new\s+MonoCloudManagementClient\s*\(/.test(t)) hits.newCtor.push(rel(f));
  if (t.includes(`'${CORE_PKG}'`) || t.includes(`"${CORE_PKG}"`)) hits.core.push(rel(f));
  const named = [
    ...t.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@monocloud\/management['"]/g),
    ...t.matchAll(/\{([^}]*)\}\s*=\s*require\(\s*['"]@monocloud\/management['"]\s*\)/g),
  ].flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+|\s*:\s*/)[0]));
  const bad = named.filter((n) => CORE_ONLY.has(n) && !exportedByInstalledSdk(n));
  if (bad.length) hits.coreOnly.push(`${rel(f)} (${list(bad)})`);
  if (t.includes(PKG) && t.split(/\r?\n/).slice(0, 5).some((l) => /^\s*['"]use client['"]/.test(l))) hits.useClient.push(rel(f));
  if (/\bapiKey\s*:\s*['"][^'"\s]{12,}['"]/.test(t)) hits.hardKey.push(rel(f));
}
for (const [f, o] of initOptions) {
  if (/\.[mc]?tsx?$/.test(f) && !o.includes('...') && !(/\bdomain\b/.test(o) && /\bapiKey\b/.test(o))) hits.tsOptions.push(rel(f));
}

const sdkFiles = texts.filter(([, t]) => usesSdk(t)).length;
const initFiles = texts.filter(([, t]) => /MonoCloudManagementClient\s*\.\s*init\s*\(/.test(t)).length;
if (!texts.length) warn(`No source files found to scan (${SOURCE_EXTS.join(', ')}).`);
else if (!sdkFiles) warn(`Scanned ${texts.length} source file(s); none uses ${PKG} yet.`);
else {
  pass(`Scanned ${texts.length} source file(s); ${sdkFiles} use ${PKG}.`);
  if (initFiles) pass(`MonoCloudManagementClient.init() called in ${initFiles} file(s).`);
  else warn('No MonoCloudManagementClient.init(...) call found. init() is the only way to create the client.');
}
const report = (items, fn) => { if (items.length) fn(list(items)); };
report(hits.newCtor, (l) => fail(`new MonoCloudManagementClient(...) in ${l}. The constructor is private; use MonoCloudManagementClient.init(options?, fetcher?).`));
report(hits.coreOnly, (l) => fail(`Core-only names imported from ${PKG}: ${l}. They are not exported; derive the types from method return types.`));
report(hits.core, (l) => warn(`${CORE_PKG} imported in ${l}. Import from ${PKG} instead.`));
report(hits.useClient, (l) => fail(`${PKG} imported in "use client" module(s): ${l}. Management calls must run server-side only.`));
report(hits.publicRef, (l) => fail(`Management env var with a browser-exposed prefix referenced in ${l}. Use the unprefixed, server-only variable.`));
report(hits.hardKey, (l) => warn(`Likely hard-coded apiKey literal in ${l}. Read the key from an env var or secret store.`));
report(hits.tsOptions, (l) => warn(`MonoCloudManagementClient.init({ ... }) without both domain and apiKey in ${l}. MonoCloudConfig requires both whenever options are passed, so this does not type-check.`));
report(hits.unknown, (l) => fail(`Calls to methods that don't exist on the resource client: ${l}. See references/api-surface.md.`));
report(hits.dotData, (l) => warn(`Management response read via .data / .Data / .PageData in ${l}. The JS SDK returns the body on .result and paging info on .pageData.`));

// Report
for (const [k, m] of findings) console.log(`[${k}] ${m}`);
const failed = findings.filter(([k]) => k === 'FAIL').length;
const warned = findings.filter(([k]) => k === 'WARN').length;
console.log(`\n${findings.length} checks: ${failed} failed, ${warned} warning(s).`);
process.exit(failed ? 1 : 0);
