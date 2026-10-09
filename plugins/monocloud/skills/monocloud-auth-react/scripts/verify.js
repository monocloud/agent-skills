#!/usr/bin/env node
// Diagnostic for @monocloud/auth-react integrations.
// Usage (from the skill folder): node scripts/verify.js [project-dir]
// Pure Node, no dependencies, cross-platform. Exits 1 when a check fails.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG = '@monocloud/auth-react';
const WEB_JS = '@monocloud/auth-web-js';

// Everything the package exports (values and types). It has a single "." entry — no subpaths.
const EXPORTS = new Set([
  'MonoCloudAuthProvider', 'useAuth', 'useClient', 'SignIn', 'SignUp', 'SignOut', 'Protected', 'ProcessCallback',
  'MonoCloudAuthProviderProps', 'AuthState', 'MonoCloudAuth', 'SignInProps', 'SignUpProps', 'SignOutProps',
  'ProtectedComponentProps', 'ProcessCallbackProps',
  'MonoCloudWebJSClient', 'LocalStorage', 'SessionStorage', 'MemoryStorage', 'MonoCloudAuthBaseError',
  'MonoCloudJsError', 'MonoCloudOPError', 'MonoCloudValidationError', 'MonoCloudTokenError', 'MonoCloudHttpError',
  'MonoCloudWebJSClientOptions', 'IStorage', 'Indicator', 'DefaultAuthParams', 'AuthorizationParams', 'Jwk',
  'SignInOptions', 'SignInSilentOptions', 'SignOutOptions', 'RefreshOptions', 'RefreshGrantOptions',
  'GetTokensOptions', 'MonoCloudSession', 'MonoCloudTokens', 'AccessToken', 'MonoCloudUser', 'UserinfoResponse',
  'IdTokenClaims', 'Address', 'CallbackState', 'ApplicationState', 'PostCallback', 'OnSessionCreating',
  'InteractionMode', 'Authenticators', 'ClientAuthMethod', 'Prompt', 'DisplayOptions', 'ResponseTypes',
  'ResponseModes', 'CodeChallengeMethod', 'SecurityAlgorithms', 'Group',
]);
// Exported by @monocloud/auth-web-js but not re-exported here.
const WEB_JS_ONLY = new Set(['MonoCloudOidcClient', 'isUserInGroup', 'Jwks', 'IssuerMetadata', 'Tokens',
  'CallbackParams', 'EndSessionParameters', 'JwsHeaderParameters', 'RefetchUserInfoOptions']);

// Supported peer ranges: react ^18.0.0 || ^19.2.3, react-dom ^18.3.1 || ^19.2.3 (minimum minor.patch per major).
const PEERS = { react: { 18: [0, 0], 19: [2, 3], range: '^18.0.0 || ^19.2.3' }, 'react-dom': { 18: [3, 1], 19: [2, 3], range: '^18.3.1 || ^19.2.3' } };

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor']);
const SOURCE_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const PLACEHOLDER = /<your-(tenant|tenant-domain|domain|client-id)>/;
const PUBLIC_ENV = /^(VITE_|REACT_APP_|NEXT_PUBLIC_|PUBLIC_|EXPO_PUBLIC_)/;
const VITE_BUILTIN_ENV = new Set(['MODE', 'BASE_URL', 'PROD', 'DEV', 'SSR']);
const ACTIONS = /\b(getTokens|refetchUserInfo|refreshSession|signInSilent)\s*\(/;

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

// Returns a message when a simple version spec can't resolve to a supported version; null when fine or not evaluable.
function peerIssue(name, spec) {
  const m = /^\s*([~^]|=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?\s*$/.exec(String(spec));
  if (!m) return null; // ranges with ||, >=, tags, workspace:/file: links — not evaluated
  const op = m[1] || '';
  const major = Number(m[2]);
  const minor = /^\d+$/.test(m[3] || '') ? Number(m[3]) : null;
  const patch = /^\d+$/.test(m[4] || '') ? Number(m[4]) : null;
  const msg = `${name} "${spec}" is outside the supported peer range ${PEERS[name].range}`;
  if (major < 18) return msg;
  if (major > 19) return null;
  const [minMinor, minPatch] = PEERS[name][major];
  if (op === '^' || minor === null) return null;                     // whole major available
  if (op === '~' || patch === null) return minor >= minMinor ? null : msg; // any patch of that minor
  return minor > minMinor || (minor === minMinor && patch >= minPatch) ? null : msg; // exact version
}

// Text between the "(" at openIdx and its matching ")", skipping strings and comments; null if unbalanced.
function callArgs(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) return null;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) return null;
      i++;
    } else if (c === '(' || c === '{' || c === '[') {
      depth++;
    } else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

// { body, deps } for every useEffect(...) call; deps is the inline dependency list or null.
function effects(text) {
  const out = [];
  for (const m of text.matchAll(/\buseEffect\s*\(/g)) {
    const args = callArgs(text, m.index + m[0].length - 1);
    if (args === null) continue;
    const d = /,\s*\[([^\]]*)\]\s*,?\s*$/.exec(args);
    out.push(d ? { body: args.slice(0, d.index), deps: d[1] } : { body: args, deps: null });
  }
  return out;
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

  for (const peer of ['react', 'react-dom']) {
    if (!deps[peer]) { warn(`"${peer}" is not a dependency — ${PKG} needs ${peer} ${PEERS[peer].range}.`); continue; }
    const issue = peerIssue(peer, deps[peer]);
    if (issue) warn(issue);
    else pass(`${peer} ${deps[peer]}`);
  }

  if (deps.next || deps['@monocloud/auth-nextjs']) {
    warn('Next.js project — use @monocloud/auth-nextjs (skill monocloud-auth-nextjs); its useAuth lives in @monocloud/auth-nextjs/client. Don\'t mix it with @monocloud/auth-react.');
  }
  if (deps[WEB_JS]) {
    warn(`${WEB_JS} is also a direct dependency — fine for MonoCloudOidcClient or /utils, but keep it on the same release as ${PKG} so only one copy is installed (otherwise instanceof checks across the two can fail).`);
  }
  const bundler = ['vite', 'parcel', 'webpack', 'rollup', 'esbuild', '@rspack/core', 'react-scripts'].find((b) => deps[b]);
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
    warn(`${f}: ${list(authVars, 3)} — ${PKG} reads no environment variables (MONOCLOUD_AUTH_* is the @monocloud/auth-nextjs convention). Pass values as <MonoCloudAuthProvider> props${deps.vite ? ', e.g. from VITE_* variables via import.meta.env' : ''}.`);
  }
}
if (envFiles.length) pass(`Checked env file(s): ${list(envFiles)}`);

// ---------------------------------------------------------------- source scan
const files = walk(ROOT, 6, []);
if (!files.length) {
  warn(`No source files found to scan (${SOURCE_EXT.join(' ')}).`);
} else {
  pass(`Scanned ${files.length} source file(s).`);

  const importers = [];
  const badNames = [];
  const webJsOnly = [];
  const badDefault = [];
  const badSubpaths = [];
  const secretFiles = [];
  const placeholderFiles = [];
  const viteEnvMisses = [];
  const clientMutations = [];
  const loopingEffects = [];
  const popupEffects = [];
  const serverComponentFiles = [];
  let providerFound = false;
  let processCallbackComponent = false;
  let autoProcessOff = false;
  let memoryStorageFile = null;
  let postCallbackFound = false;
  let tokenCalls = false;
  let offlineAccess = envTexts.some((t) => t.includes('offline_access'));

  for (const file of files) {
    const text = read(file) || '';
    const usesSdk = new RegExp(`['"]${escapeRe(PKG)}(/[^'"]*)?['"]`).test(text);
    if (usesSdk) {
      importers.push(file);
      const { names, hasDefault } = importsFrom(text, PKG);
      for (const n of names) {
        if (EXPORTS.has(n) || declaredByInstalledSdk(n)) continue;
        if (WEB_JS_ONLY.has(n)) webJsOnly.push(`${n} (${rel(file)})`);
        else badNames.push(`${n} (${rel(file)})`);
      }
      if (hasDefault) badDefault.push(rel(file));
      for (const m of text.matchAll(new RegExp(`['"]${escapeRe(PKG)}/([^'"]+)['"]`, 'g'))) if (!installedSubpath(m[1])) badSubpaths.push(`${PKG}/${m[1]} (${rel(file)})`);
      if (deps.next && /(^|[\\/])app[\\/]/.test(rel(file)) && !/^\s*(\/\/[^\n]*\n\s*)*['"]use client['"]/.test(text) && /\b(useAuth|useClient)\s*\(/.test(text)) {
        serverComponentFiles.push(rel(file));
      }
    }
    if (/<MonoCloudAuthProvider[\s>]/.test(text)) providerFound = true;
    if (/<ProcessCallback[\s/>]/.test(text)) processCallbackComponent = true;
    if (/autoProcessCallback\s*(=\s*\{\s*false\s*\}|=\s*false\b|:\s*false\b)/.test(text)) autoProcessOff = true;
    if ((usesSdk || /<MonoCloudAuthProvider[\s>]/.test(text)) && /\bclientSecret\s*[:=]/.test(text)) secretFiles.push(rel(file));
    if (PLACEHOLDER.test(text)) placeholderFiles.push(rel(file));
    if (/new\s+MemoryStorage\s*\(/.test(text)) memoryStorageFile = memoryStorageFile || rel(file);
    if (/\bpostCallback\b/.test(text)) postCallbackFound = true;
    if (/\b(getTokens|refreshSession)\s*\(/.test(text)) tokenCalls = true;
    if (text.includes('offline_access')) offlineAccess = true;

    // State-changing calls on the raw client bypass the provider's context sync.
    for (const m of text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*useClient\s*\(\s*\)/g)) {
      if (new RegExp(`\\b${escapeRe(m[1])}\\.(signIn|signOut|signInSilent|refreshSession|refetchUserInfo|processCallback)\\s*\\(`).test(text)) {
        clientMutations.push(rel(file));
      }
    }
    for (const { body, deps: effectDeps } of effects(text)) {
      if (effectDeps !== null && ACTIONS.test(body) && /\b(user|session)\b(?!\s*\??\.)/.test(effectDeps)) loopingEffects.push(rel(file));
      if (/\bsignIn\s*\(\s*\{[^}]*mode\s*:\s*['"]popup['"]/.test(body)) popupEffects.push(rel(file));
    }
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
  if (webJsOnly.length) fail(`Imported from ${PKG} but only exported by ${WEB_JS}: ${list(webJsOnly)} — import these from '${WEB_JS}' (or '${WEB_JS}/utils' for isUserInGroup).`);
  if (badDefault.length) fail(`Default import of ${PKG} in ${list(badDefault)} — the package has no default export; use named imports.`);
  if (badSubpaths.length) fail(`Subpath import(s) ${list(badSubpaths)} — ${PKG} has a single entry point; import from '${PKG}'.`);

  if (importers.length) {
    if (providerFound) pass('<MonoCloudAuthProvider> is rendered.');
    else warn('No <MonoCloudAuthProvider> found — wrap the app root so useAuth() / useClient() / components work.');
  }
  if (processCallbackComponent && !autoProcessOff) warn('<ProcessCallback> is rendered but autoProcessCallback={false} is not set — both run processCallback(), and the duplicate briefly publishes a signed-out state mid-callback.');
  if (autoProcessOff && !processCallbackComponent) warn('autoProcessCallback={false} is set but no <ProcessCallback> is rendered — sign-in/sign-out callbacks will never complete.');
  if (clientMutations.length) warn(`State-changing calls on the useClient() client in ${list(clientMutations)} — they don't update useAuth() state; use the useAuth() actions instead.`);
  if (loopingEffects.length) warn(`useEffect with user/session dependencies calls a useAuth() action in ${list(loopingEffects)} — each action publishes new user/session objects, so the effect loops. Depend on isAuthenticated or user?.sub.`);
  if (popupEffects.length) warn(`Popup sign-in started inside useEffect in ${list(popupEffects)} — browsers block popups not opened from a click; trigger it from an event handler or use <SignIn mode="popup">.`);
  if (serverComponentFiles.length) warn(`Hooks from ${PKG} in app/ files without "use client": ${list(serverComponentFiles)}.`);
  if (secretFiles.length) warn(`clientSecret passed in browser code (${list(secretFiles)}) — SPA clients are public; remove it and rely on PKCE.`);
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
