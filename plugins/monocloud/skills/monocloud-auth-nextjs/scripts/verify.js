#!/usr/bin/env node
// Diagnose an @monocloud/auth-nextjs integration in a Next.js project.
// Usage: node scripts/verify.js [project-dir]
// Pure Node, no dependencies, cross-platform. Exits with code 1 when any check fails.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG = '@monocloud/auth-nextjs';

const findings = [];
const pass = (m) => findings.push(['PASS', m]);
const warn = (m) => findings.push(['WARN', m]);
const fail = (m) => findings.push(['FAIL', m]);

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// What the installed SDK declares. Names and subpaths found there exist in that release even
// when the lists below don't know them yet, so they are never reported as missing.
const INSTALLED_DIR = path.join(ROOT, 'node_modules', ...PKG.split('/'));
const INSTALLED_PKG = readJson(path.join(INSTALLED_DIR, 'package.json'));
const INSTALLED_DECLS = (() => {
  const chunks = [];
  (function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4 && e.name !== 'node_modules') walk(full, depth + 1); }
      else if (/\.d\.[cm]?ts$/.test(e.name)) chunks.push(read(full) || '');
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
const installedSubpath = (from) => !!(INSTALLED_PKG && INSTALLED_PKG.exports
  && Object.prototype.hasOwnProperty.call(INSTALLED_PKG.exports, `.${from.slice(PKG.length)}`));

// ---------------------------------------------------------------- SDK facts
const ENV = 'MONOCLOUD_AUTH_';
const KNOWN_ENV = new Set([
  'CLIENT_ID', 'CLIENT_SECRET', 'CLIENT_AUTH_METHOD', 'TRUST_STORE_ID', 'TENANT_DOMAIN', 'APP_URL',
  'COOKIE_SECRET', 'SCOPES', 'RESOURCE', 'CALLBACK_URL', 'BACK_CHANNEL_LOGOUT_URL', 'SIGNIN_URL',
  'SIGNOUT_URL', 'USER_INFO_URL', 'CLOCK_SKEW', 'CLOCK_TOLERANCE', 'RESPONSE_TIMEOUT', 'USE_PAR',
  'POST_LOGOUT_REDIRECT_URI', 'FEDERATED_SIGNOUT', 'FETCH_USER_INFO', 'REFETCH_USER_INFO',
  'ALLOW_QUERY_PARAM_OVERRIDES', 'REFETCH_STRICT_PROFILE_SYNC', 'SESSION_COOKIE_NAME',
  'SESSION_COOKIE_PATH', 'SESSION_COOKIE_DOMAIN', 'SESSION_COOKIE_HTTP_ONLY', 'SESSION_COOKIE_SECURE',
  'SESSION_COOKIE_SAME_SITE', 'SESSION_COOKIE_PERSISTENT', 'SESSION_SLIDING', 'SESSION_DURATION',
  'SESSION_MAX_DURATION', 'STATE_COOKIE_NAME', 'STATE_COOKIE_PATH', 'STATE_COOKIE_DOMAIN',
  'STATE_COOKIE_SECURE', 'STATE_COOKIE_SAME_SITE', 'STATE_DURATION', 'STATE_MAX_CONCURRENT',
  'ID_TOKEN_SIGNING_ALG', 'FILTERED_ID_TOKEN_CLAIMS', 'JWKS_CACHE_DURATION', 'METADATA_CACHE_DURATION',
  'GROUPS_CLAIM',
].map((k) => ENV + k));
const REQUIRED_ENV = ['TENANT_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET', 'APP_URL', 'COOKIE_SECRET'];
const BOOLEAN_ENV = ['USE_PAR', 'FEDERATED_SIGNOUT', 'FETCH_USER_INFO', 'REFETCH_USER_INFO',
  'ALLOW_QUERY_PARAM_OVERRIDES', 'REFETCH_STRICT_PROFILE_SYNC', 'SESSION_COOKIE_HTTP_ONLY',
  'SESSION_COOKIE_SECURE', 'SESSION_COOKIE_PERSISTENT', 'SESSION_SLIDING', 'STATE_COOKIE_SECURE'];
const NUMBER_ENV = ['CLOCK_SKEW', 'CLOCK_TOLERANCE', 'RESPONSE_TIMEOUT', 'SESSION_DURATION',
  'SESSION_MAX_DURATION', 'STATE_DURATION', 'STATE_MAX_CONCURRENT', 'JWKS_CACHE_DURATION',
  'METADATA_CACHE_DURATION'];
const ROUTE_ENV = ['SIGNIN_URL', 'CALLBACK_URL', 'USER_INFO_URL', 'SIGNOUT_URL', 'BACK_CHANNEL_LOGOUT_URL'];
const CLIENT_MIRRORED = {
  SIGNIN_URL: '<SignIn>, <SignUp>, <RedirectToSignIn> and protectClientPage',
  SIGNOUT_URL: '<SignOut>',
  USER_INFO_URL: 'useAuth()',
  GROUPS_CLAIM: '<Protected> and protectClientPage',
};
const SECRET_ENV = ['CLIENT_SECRET', 'COOKIE_SECRET'];
const AUTH_METHODS = ['client_secret_basic', 'client_secret_post', 'client_secret_jwt', 'private_key_jwt',
  'tls_client_auth', 'self_signed_tls_client_auth', 'spiffe_jwt', 'spiffe_x509'];
const SIGNING_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'];

const ROOT_FUNCTIONS = ['authMiddleware', 'monoCloudAuth', 'getSession', 'getTokens', 'isAuthenticated',
  'isUserInGroup', 'protect', 'protectApi', 'protectPage', 'redirectToSignIn', 'redirectToSignOut'];
const ROOT_EXPORTS = [...ROOT_FUNCTIONS, 'MonoCloudNextClient', 'MonoCloudAuthBaseError',
  'MonoCloudValidationError', 'MonoCloudHttpError', 'MonoCloudOPError', 'MonoCloudTokenError',
  // types re-exported from @monocloud/auth-node-core
  'SecurityAlgorithms', 'MonoCloudOptions', 'OnSessionCreating', 'OnBackChannelLogout', 'OnSetApplicationState',
  'MonoCloudSession', 'MonoCloudUser', 'MonoCloudTokens', 'AccessToken', 'GetSessionOptions', 'GetTokensOptions',
  'ApplicationState', 'MonoCloudRequest', 'Indicator', 'MonoCloudSessionOptions', 'MonoCloudSessionOptionsBase',
  'MonoCloudSessionStore', 'MonoCloudCookieOptions', 'MonoCloudStateCookieOptions', 'SessionLifetime',
  'SameSiteValues', 'UserinfoResponse', 'Address', 'Authenticators', 'DisplayOptions', 'AuthorizationParams',
  'MonoCloudRoutes', 'MonoCloudStateOptions', 'MonoCloudStatePartialOptions', 'IdTokenClaims', 'Group', 'Jwk',
  'Jwks', 'IssuerMetadata', 'MtlsEndpointAliases', 'Prompt', 'CodeChallengeMethod', 'ResponseTypes', 'ResponseModes',
  // SDK-defined types
  'ProtectPagePageReturnType', 'ProtectOptions', 'MonoCloudMiddlewareOptions', 'IsUserInGroupOptions',
  'ExtraAuthParams', 'MonoCloudAuthOptions', 'OnError', 'AppRouterContext', 'AppRouterApiHandlerFn', 'AppOnError',
  'PageOnError', 'GroupOptions', 'ProtectedRoutes', 'ProtectedRouteMatcher', 'MonoCloudAuthHandler',
  'ProtectedAppServerComponent', 'AppRouterPageHandler', 'CustomProtectedRouteMatcher',
  'NextMiddlewareOnAccessDenied', 'NextMiddlewareResult', 'ProtectApiAppOptions', 'ProtectApiPageOptions',
  'RedirectToSignInOptions', 'RedirectToSignOutOptions', 'ProtectAppPageOptions',
  'PageRouterApiOnAccessDeniedHandler', 'ProtectPagePageOptions', 'AppRouterApiOnAccessDeniedHandler',
  'ProtectPagePageOnAccessDeniedType', 'NextMiddlewareOnGroupAccessDenied',
  'AppRouterApiOnGroupAccessDeniedHandler', 'PageRouterApiOnGroupAccessDeniedHandler',
  'ProtectPagePageOnGroupAccessDeniedType', 'ProtectPageGetServerSidePropsContext',
  'ProtectedAppServerComponentProps'];
const SUBPATH_EXPORTS = {
  [PKG]: new Set(ROOT_EXPORTS),
  [`${PKG}/client`]: new Set(['useAuth', 'protectClientPage', 'AuthenticationState', 'ProtectClientPageOptions']),
  [`${PKG}/components`]: new Set(['SignIn', 'SignUp', 'SignOut', 'SignInProps', 'SignUpProps', 'SignOutProps']),
  [`${PKG}/components/client`]: new Set(['Protected', 'RedirectToSignIn', 'ProtectedComponentProps',
    'RedirectToSignInProps']),
};
const NONEXISTENT = {
  useUser: 'useAuth from "@monocloud/auth-nextjs/client"',
  useMonoCloudAuth: 'useAuth from "@monocloud/auth-nextjs/client"',
  MonoCloudAuthProvider: 'no provider (useAuth needs none)',
  UserProvider: 'no provider (useAuth needs none)',
  monoCloudMiddleware: 'authMiddleware',
  handleAuth: 'authMiddleware() (or monoCloudAuth() in a catch-all route)',
  withPageAuthRequired: 'protectPage',
  withApiAuthRequired: 'protectApi',
  protectServerAction: 'protect() inside the action',
};

// ---------------------------------------------------------------- helpers
function nextInPeerRange([a, b, c]) {
  if (a === 13) return b > 5 || (b === 5 && c >= 11);
  if (a === 14) return b > 2 || (b === 2 && c >= 35);
  if (a === 15) {
    const min = { 0: 7, 1: 11, 2: 8, 3: 8, 4: 10, 5: 9 }[b];
    return min !== undefined && c >= min;
  }
  if (a === 16) return b > 0 || c >= 10;
  return false;
}

function parseEnvFile(file) {
  const text = read(file);
  if (text === null) return null;
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const quoted = /^(['"`])([\s\S]*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim();
    out[m[1]] = value;
  }
  return out;
}

function isGitIgnored(file, text) {
  let ignored = false;
  for (const raw of text.split(/\r?\n/)) {
    let pattern = raw.trim();
    if (!pattern || pattern.startsWith('#') || pattern.endsWith('/')) continue;
    const negate = pattern.startsWith('!');
    if (negate) pattern = pattern.slice(1);
    pattern = pattern.replace(/^\//, '').replace(/^\*\*\//, '');
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
    if (re.test(file)) ignored = !negate;
  }
  return ignored;
}

// ---------------------------------------------------------------- 1. package.json
const pkg = readJson(path.join(ROOT, 'package.json'));
let nextMajor = null;
if (!pkg) {
  fail(`No readable package.json in ${ROOT}`);
} else {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps[PKG]) pass(`${PKG} is declared (${deps[PKG]})`);
  else fail(`${PKG} is not a dependency — run: npm install ${PKG}`);
  for (const spa of ['@monocloud/auth-react', '@monocloud/auth-web-js']) {
    if (deps[spa]) warn(`${spa} is a browser-SPA SDK; a Next.js app needs only ${PKG}`);
  }
  if (!deps.next) {
    warn('"next" is not a dependency — this skill targets Next.js projects');
  } else {
    const installed = readJson(path.join(ROOT, 'node_modules', 'next', 'package.json'));
    const exact = installed && installed.version ? installed.version : deps.next;
    const full = /^v?(\d+)\.(\d+)\.(\d+)/.exec(exact);
    const major = /^[\^~>=<v\s]*(\d+)/.exec(deps.next);
    nextMajor = full ? Number(full[1]) : major ? Number(major[1]) : null;
    if (nextMajor === null) {
      warn(`Could not read a Next.js version from "${deps.next}" — skipping version checks`);
    } else if (nextMajor < 13) {
      fail(`Next.js ${deps.next} is too old — ${PKG} supports Next.js 13.5.11 and later`);
    } else if (full && !nextInPeerRange(full.slice(1).map(Number))) {
      warn(`next ${full[0]} is outside ${PKG}'s peer range (^13.5.11 || ^14.2.35 || ~15.0.7 || ~15.1.11 || ~15.2.8 || ~15.3.8 || ~15.4.10 || ~15.5.9 || ^16.0.10)`);
    } else {
      pass(`Next.js ${full ? full[0] : deps.next} detected`);
    }
  }
}
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) warn(`${PKG} requires Node.js >= 20 (this shell runs ${process.versions.node})`);

// ---------------------------------------------------------------- 2. source scan
const appInSrc = isDir(path.join(ROOT, 'src', 'app')) || isDir(path.join(ROOT, 'src', 'pages'));
const appAtRoot = isDir(path.join(ROOT, 'app')) || isDir(path.join(ROOT, 'pages'));
const usesAppRouter = isDir(path.join(ROOT, 'app')) || isDir(path.join(ROOT, 'src', 'app'));
const PAGES_FILE = /^(src\/)?pages\//;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);
const sourceFiles = [];
(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (sourceFiles.length >= 5000) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(full);
    } else if (/\.(m|c)?[jt]sx?$/.test(e.name) && !/\.d\.[mc]?ts$/.test(e.name)) {
      sourceFiles.push(full);
    }
  }
})(ROOT);

const IMPORT_RE = /import\s+(type\s+)?([^'";]*?)\s*from\s*['"](@monocloud\/[\w.-]+(?:\/[\w./-]+)?)['"]/g;
const USE_CLIENT_RE = /^\uFEFF?(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/;
const instanceFiles = [];
const rootFunctionFiles = [];
const catchAllFiles = [];
let importIssues = 0;
let sdkImportFiles = 0;

for (const file of sourceFiles) {
  const src = read(file);
  if (!src || src.length > 1024 * 1024) continue;
  const name = rel(file);
  if (/new\s+MonoCloudNextClient\s*\(\s*[^)\s]/.test(src)) instanceFiles.push(name);
  if (/\bmonoCloudAuth\s*\(/.test(src) && !/(^|\/)(proxy|middleware)\.[mc]?[jt]s$/.test(name)) catchAllFiles.push({ name, src });

  let usesSdk = false;
  let clientWarned = false;
  for (const m of src.matchAll(IMPORT_RE)) {
    const [, typeOnly, clause, from] = m;
    if (from === '@monocloud/auth-react' || from === '@monocloud/auth-web-js') {
      warn(`${name}: imports ${from} (browser-SPA SDK) — use ${PKG} in Next.js`);
      continue;
    }
    if (from !== PKG && !from.startsWith(`${PKG}/`)) continue;
    usesSdk = true;
    const allowed = SUBPATH_EXPORTS[from];
    if (!allowed) {
      if (installedSubpath(from)) continue;
      fail(`${name}: "${from}" is not an export of ${PKG} — use ${Object.keys(SUBPATH_EXPORTS).join(', ')}`);
      importIssues++;
      continue;
    }
    const braces = /\{([^}]*)\}/.exec(clause);
    const defaultPart = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (defaultPart && !defaultPart.startsWith('*')) {
      fail(`${name}: ${from} has no default export — use named imports`);
      importIssues++;
    }
    const names = (braces ? braces[1].split(',') : []).map((s) => s.trim()).filter(Boolean)
      .map((s) => ({ type: !!typeOnly || /^type\s/.test(s), id: s.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim() }));
    for (const { id } of names) {
      if (allowed.has(id)) continue;
      const home = Object.keys(SUBPATH_EXPORTS).find((sp) => SUBPATH_EXPORTS[sp].has(id));
      if (!home && !NONEXISTENT[id] && declaredByInstalledSdk(id)) continue;
      importIssues++;
      if (id === 'protectPage' && from === `${PKG}/client`) fail(`${name}: the client HOC is protectClientPage (protectPage is the server helper from "${PKG}")`);
      else if (home) fail(`${name}: import ${id} from "${home}", not "${from}"`);
      else if (NONEXISTENT[id]) fail(`${name}: ${id} does not exist in ${PKG} — use ${NONEXISTENT[id]}`);
      else fail(`${name}: ${id} is not exported by "${from}"`);
    }
    const values = names.filter((n) => !n.type && allowed.has(n.id)).map((n) => n.id);
    if (!clientWarned && usesAppRouter && !PAGES_FILE.test(name) && values.length
      && (from === `${PKG}/client` || from === `${PKG}/components/client`) && !USE_CLIENT_RE.test(src)) {
      clientWarned = true;
      warn(`${name}: uses ${values.join(', ')} from "${from}" but does not start with "use client"`);
    }
    if (from === PKG) {
      if (values.some((v) => ROOT_FUNCTIONS.includes(v))) rootFunctionFiles.push(name);
      const appOnly = values.filter((v) => ['protect', 'redirectToSignIn', 'redirectToSignOut'].includes(v));
      if (appOnly.length && PAGES_FILE.test(name)) {
        fail(`${name}: ${appOnly.join(', ')} can only be used in the App Router — in the Pages Router use protectPage()/protectApi() or getSession(req, res)`);
      }
    }
  }
  if (usesSdk) sdkImportFiles++;
}
if (sdkImportFiles && !importIssues) pass(`SDK imports in ${sdkImportFiles} file(s) use valid subpaths and names`);
if (instanceFiles.length && rootFunctionFiles.length) {
  warn(`new MonoCloudNextClient(...) is configured in ${instanceFiles[0]}, but ${rootFunctionFiles.slice(0, 3).join(', ')} import root function exports — those use a separate env-only singleton, so options passed to your instance (session.store, hooks, resources) don't apply there. Call the instance's methods instead.`);
}

// ---------------------------------------------------------------- 3. proxy / middleware
const findFiles = (base) => ['', 'src/'].flatMap((dir) => ['ts', 'js', 'mts', 'mjs'].map((ext) => `${dir}${base}.${ext}`))
  .filter((f) => fs.existsSync(path.join(ROOT, f)));
const proxyFiles = findFiles('proxy');
const middlewareFiles = findFiles('middleware');
const mwFiles = [...proxyFiles, ...middlewareFiles];
let mwServesAuth = false;

if (!mwFiles.length) {
  if (catchAllFiles.length) pass(`No proxy/middleware; auth routes served by monoCloudAuth() in ${catchAllFiles[0].name}`);
  else fail('No proxy.ts/middleware.ts and no monoCloudAuth() catch-all — /api/auth/* is not served. Add `export default authMiddleware()` (see SKILL.md)');
} else {
  if (proxyFiles.length && middlewareFiles.length) warn(`Both ${proxyFiles[0]} and ${middlewareFiles[0]} exist — keep only the one your Next.js version uses`);
  if (nextMajor !== null && nextMajor < 16 && proxyFiles.length && !middlewareFiles.length) {
    fail(`${proxyFiles[0]}: Next.js ${nextMajor} only runs middleware.ts — rename it (proxy.ts requires Next.js 16+)`);
  }
  if (nextMajor !== null && nextMajor >= 16 && middlewareFiles.length && !proxyFiles.length) {
    warn(`${middlewareFiles[0]}: Next.js ${nextMajor} uses proxy.ts (middleware.ts is the pre-16 file name)`);
  }
  for (const f of mwFiles) {
    if ((appInSrc || appAtRoot) && appInSrc !== f.startsWith('src/')) {
      fail(`${f}: Next.js only picks it up next to your app/pages directory — move it ${appInSrc ? 'into src/' : 'to the project root'}`);
    }
    const src = read(path.join(ROOT, f)) || '';
    if (/authMiddleware\s*\(/.test(src)) {
      mwServesAuth = true;
      pass(`${f} calls authMiddleware()`);
    } else {
      warn(`${f} does not call authMiddleware() — it neither serves /api/auth/* nor protects routes`);
    }
    const at = src.search(/\bmatcher\b/);
    if (at !== -1) {
      if (/\(\?![^)]*\bapi\b/.test(src.slice(at, at + 800))) {
        fail(`${f}: config.matcher excludes /api, so /api/auth/* never reaches authMiddleware() — use "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"`);
      } else {
        pass(`${f}: config.matcher does not exclude /api`);
      }
    }
  }
}
for (const { name, src } of catchAllFiles) {
  if (mwServesAuth) warn(`${name}: monoCloudAuth() is mounted while authMiddleware() already serves /api/auth/* — the middleware answers first, so remove one`);
  if (/(^|\/)route\.[mc]?[jt]s$/.test(name) && !/\bPOST\b/.test(src)) {
    warn(`${name}: export the handler as POST too (form_post callbacks and back-channel logout arrive as POST)`);
  }
}

// ---------------------------------------------------------------- 4. environment
// next dev precedence: process env > .env.development.local > .env.local > .env.development > .env
const ENV_FILES = ['.env', '.env.development', '.env.local', '.env.development.local'];
const env = {};
const envFilesFound = [];
for (const f of ENV_FILES) {
  const vars = parseEnvFile(path.join(ROOT, f));
  if (vars) { envFilesFound.push(f); Object.assign(env, vars); }
}
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith(ENV) || k.startsWith(`NEXT_PUBLIC_${ENV}`)) env[k] = v;
}
if (envFilesFound.length) pass(`Read ${envFilesFound.join(', ')}`);
else warn('No .env / .env.local / .env.development(.local) file found — checking the process environment only');

// The SDK copies NEXT_PUBLIC_MONOCLOUD_AUTH_* over MONOCLOUD_AUTH_* when a client is constructed.
const val = (key) => {
  const v = env[`NEXT_PUBLIC_${ENV}${key}`] !== undefined ? env[`NEXT_PUBLIC_${ENV}${key}`] : env[ENV + key];
  return v === undefined || v === '' ? undefined : v;
};

for (const k of Object.keys(env)) {
  const base = k.startsWith('NEXT_PUBLIC_') ? k.slice('NEXT_PUBLIC_'.length) : k;
  if ((k.startsWith(ENV) || k.startsWith(`NEXT_PUBLIC_${ENV}`)) && !KNOWN_ENV.has(base)) {
    warn(`${k} is not a variable ${PKG} reads — check the name`);
  }
}
for (const key of SECRET_ENV) {
  if (env[`NEXT_PUBLIC_${ENV}${key}`] !== undefined) fail(`NEXT_PUBLIC_${ENV}${key} exposes a secret to the browser bundle — remove it and set ${ENV}${key} instead`);
}
for (const key of REQUIRED_ENV) {
  if (SECRET_ENV.includes(key) ? env[ENV + key] : val(key)) pass(`${ENV}${key} is set`);
  else fail(`${ENV}${key} is missing (set it in .env.local or the environment)`);
}

const tenant = val('TENANT_DOMAIN');
if (tenant && !tenant.startsWith('https://')) {
  fail(`${ENV}TENANT_DOMAIN must include https:// (e.g. https://acme.us.monocloud.com); got "${tenant}"`);
} else if (tenant && /^https:\/\/[^/]+\/./.test(tenant)) {
  warn(`${ENV}TENANT_DOMAIN has a path — it must equal the token issuer (scheme + host)`);
}

let appHttps = null;
const appUrl = val('APP_URL');
if (appUrl) {
  try {
    const u = new URL(appUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
    appHttps = u.protocol === 'https:';
  } catch {
    fail(`${ENV}APP_URL must be an absolute http(s) URL such as http://localhost:3000; got "${appUrl}"`);
  }
}

const secret = val('COOKIE_SECRET');
if (secret && secret.length < 8) fail(`${ENV}COOKIE_SECRET is shorter than the 8-character minimum — generate one with: openssl rand -hex 32`);
else if (secret && secret.length < 32) warn(`${ENV}COOKIE_SECRET is short — generate one with: openssl rand -hex 32`);

const scopes = val('SCOPES');
if (scopes && !scopes.split(/\s+/).includes('openid')) fail(`${ENV}SCOPES must include "openid"; got "${scopes}"`);

const resource = val('RESOURCE');
if (resource) {
  for (const part of resource.split(/\s+/).filter(Boolean)) {
    let ok = false;
    try { const u = new URL(part); ok = !u.search && !u.hash; } catch { ok = false; }
    if (!ok) fail(`${ENV}RESOURCE entries must be absolute URLs without query or hash; got "${part}"`);
  }
}

const method = val('CLIENT_AUTH_METHOD');
if (method && !AUTH_METHODS.includes(method)) fail(`${ENV}CLIENT_AUTH_METHOD "${method}" is not one of ${AUTH_METHODS.join(', ')}`);
if (method === 'private_key_jwt' && val('CLIENT_SECRET')) {
  let jwk = null;
  try { jwk = JSON.parse(val('CLIENT_SECRET')); } catch { jwk = null; }
  if (!jwk || typeof jwk.kty !== 'string') fail(`${ENV}CLIENT_SECRET must be a private-key JWK (JSON with "kty") when CLIENT_AUTH_METHOD is private_key_jwt`);
}

const alg = val('ID_TOKEN_SIGNING_ALG');
if (alg && !SIGNING_ALGS.includes(alg)) fail(`${ENV}ID_TOKEN_SIGNING_ALG "${alg}" is not one of ${SIGNING_ALGS.join(', ')}`);

for (const key of ['SESSION_COOKIE_SAME_SITE', 'STATE_COOKIE_SAME_SITE']) {
  const v = val(key);
  if (v && !['strict', 'lax', 'none'].includes(v)) fail(`${ENV}${key} must be strict, lax or none (lowercase); got "${v}"`);
}

const bools = {};
for (const key of BOOLEAN_ENV) {
  const v = val(key);
  if (v === undefined) continue;
  const t = v.trim().toLowerCase();
  if (t === 'true' || t === 'false') bools[key] = t === 'true';
  else warn(`${ENV}${key}="${v}" is ignored — booleans must be exactly true or false`);
}
for (const key of ['SESSION_COOKIE_SECURE', 'STATE_COOKIE_SECURE']) {
  if (bools[key] !== undefined && appHttps !== null && bools[key] !== appHttps) {
    fail(`${ENV}${key}=${bools[key]} contradicts ${ENV}APP_URL (${appHttps ? 'https' : 'http'}) — Secure must match the app URL scheme; remove it`);
  }
}

const nums = {};
for (const key of NUMBER_ENV) {
  const v = val(key);
  if (v === undefined) continue;
  const n = parseInt(v.trim(), 10);
  if (Number.isNaN(n)) warn(`${ENV}${key}="${v}" is ignored — not a number`);
  else nums[key] = n;
}
const limit = (key, ok, rule) => { if (nums[key] !== undefined && !ok(nums[key])) fail(`${ENV}${key}=${nums[key]} — ${rule}`); };
limit('RESPONSE_TIMEOUT', (n) => n >= 1000, 'must be at least 1000 (ms)');
limit('CLOCK_SKEW', (n) => n >= 0, 'must be >= 0');
limit('CLOCK_TOLERANCE', (n) => n >= 0, 'must be >= 0');
limit('STATE_DURATION', (n) => n >= 300, 'must be at least 300 (s)');
limit('STATE_MAX_CONCURRENT', (n) => n >= 1 && n <= 20, 'must be between 1 and 20');
limit('SESSION_DURATION', (n) => n >= 1, 'must be at least 1 (s)');
const duration = nums.SESSION_DURATION !== undefined ? nums.SESSION_DURATION : 86400;
const maxDuration = nums.SESSION_MAX_DURATION !== undefined ? nums.SESSION_MAX_DURATION : 604800;
if (maxDuration <= duration) {
  fail(`Session maximum duration (${maxDuration}s) must be greater than the session duration (${duration}s) — raise ${ENV}SESSION_MAX_DURATION`);
}

for (const key of ROUTE_ENV) {
  const v = val(key);
  if (v && /^[a-z][a-z0-9+.-]*:/i.test(v)) fail(`${ENV}${key} must be a relative path such as /api/auth/...; got "${v}"`);
}
for (const [key, readers] of Object.entries(CLIENT_MIRRORED)) {
  const server = env[ENV + key];
  const pub = env[`NEXT_PUBLIC_${ENV}${key}`];
  if (server && pub === undefined) {
    warn(`${ENV}${key} is set but NEXT_PUBLIC_${ENV}${key} is not — ${readers} won't see the change`);
  } else if (server && pub !== undefined && server !== pub) {
    warn(`NEXT_PUBLIC_${ENV}${key} ("${pub}") differs from ${ENV}${key} ("${server}") — the public value overwrites the server one at runtime`);
  }
}

// ---------------------------------------------------------------- 5. secrets kept out of git
const gitignore = read(path.join(ROOT, '.gitignore'));
for (const f of envFilesFound) {
  const content = read(path.join(ROOT, f)) || '';
  if (!/^\s*(export\s+)?MONOCLOUD_AUTH_(CLIENT_SECRET|COOKIE_SECRET)\s*=\s*\S/m.test(content)) continue;
  if (gitignore === null) warn(`${f} contains MonoCloud secrets and the project has no .gitignore`);
  else if (!isGitIgnored(f, gitignore)) warn(`${f} contains MonoCloud secrets but is not ignored by .gitignore`);
}

// ---------------------------------------------------------------- report
for (const [kind, msg] of findings) console.log(`[${kind}] ${msg}`);
const failed = findings.filter(([k]) => k === 'FAIL').length;
const warned = findings.filter(([k]) => k === 'WARN').length;
console.log(`\n${findings.length} checks — ${failed} failed, ${warned} warnings.`);
process.exit(failed ? 1 : 0);
