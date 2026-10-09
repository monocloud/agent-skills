#!/usr/bin/env node
// Diagnostic for @monocloud/auth-web-js integrations.
// Usage (from the skill folder): node scripts/verify.js [project-dir]
// Pure Node, no dependencies, cross-platform. Exits 1 when a check fails.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG = '@monocloud/auth-web-js';

// Everything the package root exports (values and types).
const EXPORTS = new Set([
  'MonoCloudWebJSClient', 'MonoCloudOidcClient', 'LocalStorage', 'SessionStorage', 'MemoryStorage',
  'MonoCloudAuthBaseError', 'MonoCloudOPError', 'MonoCloudValidationError', 'MonoCloudTokenError',
  'MonoCloudHttpError', 'MonoCloudJsError',
  'MonoCloudWebJSClientOptions', 'DefaultAuthParams', 'Indicator', 'IStorage', 'InteractionMode',
  'ApplicationState', 'OnSessionCreating', 'PostCallback', 'CallbackState', 'SignInOptions',
  'SignInSilentOptions', 'SignOutOptions', 'RefreshOptions', 'GetTokensOptions', 'MonoCloudTokens',
  'AccessToken', 'AuthenticateOptions', 'ClientAuthMethod', 'MonoCloudClientOptionsBase',
  'PushedAuthorizationParams', 'RefreshSessionOptions', 'AuthState', 'Authenticators',
  'AuthorizationParams', 'CallbackParams', 'JwsHeaderParameters', 'EndSessionParameters', 'Group',
  'IdTokenClaims', 'IssuerMetadata', 'MtlsEndpointAliases', 'SecurityAlgorithms', 'Jwk', 'Jwks',
  'MonoCloudSession', 'MonoCloudUser', 'Tokens', 'Address', 'UserinfoResponse', 'CodeChallengeMethod',
  'DisplayOptions', 'Prompt', 'ResponseModes', 'ResponseTypes', 'RefreshGrantOptions',
  'RefetchUserInfoOptions', 'ParResponse',
]);
const SUBPATHS = new Set(['utils', 'internal']);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor']);
const SOURCE_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.html'];
const PLACEHOLDER = /<your-(tenant|tenant-domain|domain|client-id)>/;
const PUBLIC_ENV = /^(VITE_|REACT_APP_|NEXT_PUBLIC_|PUBLIC_|NUXT_PUBLIC_|EXPO_PUBLIC_)/;
const VITE_BUILTIN_ENV = new Set(['MODE', 'BASE_URL', 'PROD', 'DEV', 'SSR']);

const findings = [];
const pass = (m) => findings.push(['PASS', m]);
const warn = (m) => findings.push(['WARN', m]);
const fail = (m) => findings.push(['FAIL', m]);

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const rel = (p) => path.relative(ROOT, p) || p;
const list = (arr, n = 5) => arr.slice(0, n).join(', ') + (arr.length > n ? `, … (+${arr.length - n})` : '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// What the installed SDK declares. Names and subpaths exported there exist in that release even
// when the lists below don't know them yet, so they are never reported as missing.
const INSTALLED_DIR = path.join(ROOT, 'node_modules', ...PKG.split('/'));
const INSTALLED_PKG = (() => { try { return JSON.parse(fs.readFileSync(path.join(INSTALLED_DIR, 'package.json'), 'utf8')); } catch { return null; } })();
const INSTALLED_DECLS = (() => {
  const chunks = [];
  (function walkDecls(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4 && e.name !== 'node_modules') walkDecls(full, depth + 1); }
      else if (/\.d\.[cm]?ts$/.test(e.name)) { try { chunks.push(fs.readFileSync(full, 'utf8')); } catch { /* unreadable */ } }
    }
  })(INSTALLED_DIR, 0);
  return chunks.join('\n');
})();
const declaredByInstalledSdk = (id) => {
  if (!INSTALLED_DECLS) return false;
  const n = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`export\\s+(declare\\s+)?(abstract\\s+)?(function|const|let|var|class|interface|type|enum|namespace)\\s+${n}\\b`).test(INSTALLED_DECLS)
    || new RegExp(`export\\s*(type\\s*)?\\{[^}]*\\b${n}\\b[^}]*\\}`).test(INSTALLED_DECLS);
};
const installedSubpath = (sub) => !!(INSTALLED_PKG && INSTALLED_PKG.exports
  && Object.prototype.hasOwnProperty.call(INSTALLED_PKG.exports, `./${sub}`));

function walk(dir, depth, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) walk(full, depth - 1, out); }
    else if (SOURCE_EXT.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

// Names imported from the package root: ESM named/default imports, `export … from`, and require() destructuring.
function importsFrom(text, spec) {
  const s = escapeRe(spec);
  const names = [];
  let hasDefault = false;
  const esm = new RegExp(`\\bimport\\s+(?:type\\s+)?([\\w$]+)?\\s*,?\\s*(\\{[^}]*\\}|\\*\\s*as\\s+[\\w$]+)?\\s*from\\s*['"]${s}['"]`, 'g');
  const reexport = new RegExp(`\\bexport\\s+(?:type\\s+)?(\\{[^}]*\\})\\s*from\\s*['"]${s}['"]`, 'g');
  const cjs = new RegExp(`\\b(?:const|let|var)\\s*(\\{[^}]*\\})\\s*=\\s*require\\(\\s*['"]${s}['"]\\s*\\)`, 'g');
  const fromBraces = (braces, sep) => braces.slice(1, -1).split(',')
    .map((n) => n.trim().replace(/^type\s+/, '').split(sep)[0].trim())
    .filter(Boolean)
    .forEach((n) => names.push(n));
  let m;
  while ((m = esm.exec(text))) {
    if (m[1]) hasDefault = true;
    if (m[2] && m[2].startsWith('{')) fromBraces(m[2], /\s+as\s+/);
  }
  while ((m = reexport.exec(text))) fromBraces(m[1], /\s+as\s+/);
  while ((m = cjs.exec(text))) fromBraces(m[1], ':');
  return { names, hasDefault };
}

// ---------------------------------------------------------------- package.json
const pkgPath = path.join(ROOT, 'package.json');
const pkgText = read(pkgPath);
let pkg = null;
if (pkgText === null) fail(`No package.json at ${pkgPath}`);
else {
  try { pkg = JSON.parse(pkgText); } catch { fail(`package.json is not valid JSON (${pkgPath})`); }
}
const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};

if (pkg) {
  pass(`Found package.json (${pkg.name || 'unnamed'})`);
  if (deps[PKG]) pass(`${PKG} declared (${deps[PKG]})`);
  else fail(`${PKG} is not a dependency — run: npm install ${PKG}`);

  if (deps.next || deps['@monocloud/auth-nextjs']) {
    warn('Next.js project — use @monocloud/auth-nextjs (skill monocloud-auth-nextjs) for server sessions and middleware; this SDK is for plain browser apps.');
  }
  if (deps['@monocloud/auth-react']) {
    warn('@monocloud/auth-react is also a dependency — it re-exports this client with a provider and hooks; keep both on the same release so a single copy of @monocloud/auth-web-js is installed.');
  } else if (deps.react) {
    warn('React detected — @monocloud/auth-react wraps this client with <MonoCloudAuthProvider>, useAuth() and components (skill monocloud-auth-react).');
  }
  const bundler = ['vite', 'parcel', 'webpack', 'rollup', 'esbuild', '@rspack/core'].find((b) => deps[b]);
  if (bundler) pass(`Bundler detected: ${bundler}`);
}

// ---------------------------------------------------------------- .env files
const envFiles = (() => { try { return fs.readdirSync(ROOT).filter((f) => /^\.env(\..+)?$/.test(f)); } catch { return []; } })();
const envTexts = [];
for (const f of envFiles) {
  const text = read(path.join(ROOT, f)) || '';
  envTexts.push(text);
  const vars = [...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]);
  for (const v of vars) {
    if (PUBLIC_ENV.test(v) && /MONOCLOUD/i.test(v) && /(SECRET|API_KEY|PRIVATE)/i.test(v)) {
      warn(`${f}: ${v} is exposed to browser code by its prefix — never ship MonoCloud secrets or API keys to the browser.`);
    }
  }
  const authVars = vars.filter((v) => /^MONOCLOUD_AUTH_/.test(v));
  if (authVars.length && !deps['@monocloud/auth-nextjs']) {
    warn(`${f}: ${list(authVars, 3)} — ${PKG} reads no environment variables (MONOCLOUD_AUTH_* is the @monocloud/auth-nextjs convention). Pass values to the MonoCloudWebJSClient constructor${deps.vite ? ', e.g. from VITE_* variables via import.meta.env' : ''}.`);
  }
}
if (envFiles.length) pass(`Checked env file(s): ${list(envFiles)}`);

// ---------------------------------------------------------------- source scan
const files = walk(ROOT, 6, []);
const texts = files.map((f) => [f, read(f) || '']);
if (!files.length) {
  warn(`No source files found to scan (${SOURCE_EXT.join(' ')}).`);
} else {
  pass(`Scanned ${files.length} source file(s).`);

  const importers = [];
  const badNames = [];
  const badDefault = [];
  const badSubpaths = [];
  const secretFiles = [];
  const placeholderFiles = [];
  const viteEnvMisses = [];
  let processCallbackFound = false;
  let memoryStorageFile = null;
  let postCallbackFound = false;
  let tokenCalls = false;
  let offlineAccess = envTexts.some((t) => t.includes('offline_access'));

  for (const [file, text] of texts) {
    const usesSdk = text.includes(PKG);
    if (usesSdk) {
      const { names, hasDefault } = importsFrom(text, PKG);
      if (new RegExp(`['"]${escapeRe(PKG)}(/[^'"]*)?['"]`).test(text)) importers.push(file);
      for (const n of names) if (!EXPORTS.has(n) && !declaredByInstalledSdk(n)) badNames.push(`${n} (${rel(file)})`);
      if (hasDefault) badDefault.push(rel(file));
      for (const m of text.matchAll(new RegExp(`['"]${escapeRe(PKG)}/([^'"]+)['"]`, 'g'))) {
        if (!SUBPATHS.has(m[1]) && !installedSubpath(m[1])) badSubpaths.push(`${PKG}/${m[1]} (${rel(file)})`);
      }
    }
    if (/\bprocessCallback\s*\(/.test(text)) processCallbackFound = true;
    if ((usesSdk || /MonoCloudWebJSClient\s*\(/.test(text)) && /\bclientSecret\s*[:=]/.test(text)) secretFiles.push(rel(file));
    if (PLACEHOLDER.test(text)) placeholderFiles.push(rel(file));
    if (/new\s+MemoryStorage\s*\(/.test(text)) memoryStorageFile = memoryStorageFile || rel(file);
    if (/\bpostCallback\b/.test(text)) postCallbackFound = true;
    if (/\b(getTokens|refreshSession)\s*\(/.test(text)) tokenCalls = true;
    if (text.includes('offline_access')) offlineAccess = true;
    if (deps.vite) {
      for (const m of text.matchAll(/import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        if (!m[1].startsWith('VITE_') && !VITE_BUILTIN_ENV.has(m[1])) viteEnvMisses.push(`${m[1]} (${rel(file)})`);
      }
    }
  }

  if (importers.length) pass(`${PKG} imported in ${importers.length} file(s).`);
  else if (deps[PKG]) warn(`${PKG} is a dependency but no source file imports it yet.`);

  if (badNames.length) fail(`Imports that ${PKG} does not export: ${list(badNames)}. See references/api-surface.md for the real surface.`);
  else if (importers.length) pass('All named imports exist in the package.');
  if (badDefault.length) fail(`Default import of ${PKG} in ${list(badDefault)} — the package has no default export; use import { MonoCloudWebJSClient } from '${PKG}'.`);
  if (badSubpaths.length) fail(`Unknown subpath import(s): ${list(badSubpaths)} — only ${PKG}/utils and ${PKG}/internal exist.`);

  if (importers.length) {
    if (processCallbackFound) pass('processCallback() is called.');
    else warn('No processCallback() call found — call `await client.processCallback()` on every page load (it completes returning sign-ins/sign-outs and is otherwise a no-op).');
  }
  if (secretFiles.length) warn(`clientSecret set in browser code (${list(secretFiles)}) — SPA clients are public; remove it and rely on PKCE.`);
  if (placeholderFiles.length) warn(`Placeholder values (<your-…>) still present in ${list(placeholderFiles)} — use your tenant domain and client ID.`);
  if (memoryStorageFile && !postCallbackFound) warn(`MemoryStorage used (${memoryStorageFile}) without a postCallback — the default postCallback does a full page load when returnUrl is set, which wipes an in-memory session.`);
  if (tokenCalls && !offlineAccess) warn('getTokens()/refreshSession() used but `offline_access` is never requested — without a refresh token they fail once the access token expires (Session does not contain refresh token).');
  if (viteEnvMisses.length) warn(`import.meta.env reads without the VITE_ prefix: ${list(viteEnvMisses)} — Vite exposes only VITE_* variables to client code, so these are undefined.`);
}

// ---------------------------------------------------------------- report
for (const [k, m] of findings) console.log(`[${k}] ${m}`);
const failed = findings.filter(([k]) => k === 'FAIL').length;
const warned = findings.filter(([k]) => k === 'WARN').length;
console.log(`\n${findings.length} checks — ${failed} failed, ${warned} warning(s).`);
process.exit(failed > 0 ? 1 : 0);
