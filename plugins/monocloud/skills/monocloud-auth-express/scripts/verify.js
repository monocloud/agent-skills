#!/usr/bin/env node
'use strict';
// Diagnoses a @monocloud/backend-node integration in an Express (or framework-free) Node.js project.
// Usage: node scripts/verify.js [project-dir]
// Pure Node.js, no dependencies. Exits 1 when any check fails.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG = '@monocloud/backend-node';
const SUBPATH = '@monocloud/backend-node/express';
const P = 'MONOCLOUD_BACKEND_';
const AUTH_METHODS = ['client_secret_basic', 'client_secret_post', 'client_secret_jwt', 'private_key_jwt', 'tls_client_auth', 'self_signed_tls_client_auth', 'spiffe_jwt', 'spiffe_x509'];
const MTLS_METHODS = ['tls_client_auth', 'self_signed_tls_client_auth', 'spiffe_x509'];
const SECRET_REQUIRED = ['client_secret_jwt', 'private_key_jwt', 'spiffe_jwt'];
const BINDING_MODES = ['when_present', 'required', 'dangerously_ignore'];
const STRING_VARS = ['TENANT_DOMAIN', 'AUDIENCE', 'CLIENT_ID', 'CLIENT_SECRET', 'CLIENT_AUTH_METHOD', 'TRUST_STORE_ID', 'GROUPS_CLAIM', 'VALIDATE_CERTIFICATE_BINDING'];
const BOOL_VARS = ['INTROSPECT_JWT_TOKENS', 'GROUPS_MATCH_ALL'];
const NUMBER_VARS = { CLOCK_SKEW: 0, CLOCK_TOLERANCE: 0, JWKS_CACHE_DURATION: 0, METADATA_CACHE_DURATION: 0, INTROSPECTION_CACHE_DURATION: 0, RESPONSE_TIMEOUT: 1000 };
const KNOWN_VARS = new Set([...STRING_VARS, ...BOOL_VARS, ...Object.keys(NUMBER_VARS)].map((k) => P + k));
const CLIENT_OPTIONS = 'tenantDomain|audience|clientId|clientSecret|clientAuthMethod|trustStoreId|groupOptions|clockSkew|clockTolerance|jwksCacheDuration|metadataCacheDuration|introspectJwtTokens|validateCertificateBinding|introspectionCacheDuration|responseTimeout|cache|metadataResolver|jwksResolver|fetcher';

const findings = [];
const add = (level) => (msg) => findings.push([level, msg]);
const pass = add('PASS');
const info = add('INFO');
const warn = add('WARN');
const fail = add('FAIL');

const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const installedVersion = (name) => (readJson(path.join(ROOT, 'node_modules', ...name.split('/'), 'package.json')) || {}).version;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(['"`]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    env[m[1]] = v;
  }
  return env;
}

// --- Runtime and dependencies ---------------------------------------------------------------
if (Number(process.versions.node.split('.')[0]) < 20) warn(`Node.js ${process.versions.node} — ${PKG} requires Node.js >= 20.`);

const pkg = readJson(path.join(ROOT, 'package.json'));
const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
if (!pkg) {
  fail(`No readable package.json in ${ROOT}`);
} else {
  const installed = installedVersion(PKG);
  if (deps[PKG]) pass(`${PKG} declared (${deps[PKG]})${installed ? `, installed ${installed}` : ' — not installed yet (npm install)'}`);
  else fail(`${PKG} is not a dependency — run: npm install ${PKG}`);
  if (deps['@monocloud/node-backend']) fail('"@monocloud/node-backend" is the wrong package name — depend on "@monocloud/backend-node".');
  if (deps.express) {
    const v = installedVersion('express');
    const [major, minor] = (v || '').split('.').map(Number);
    if (v && !(major === 5 || (major === 4 && minor >= 17))) warn(`express ${v} installed — ${SUBPATH} supports express ^4.17.0 || ^5.0.0.`);
    else pass(`express declared (${deps.express})`);
    if (deps.typescript && !deps['@types/express']) warn('TypeScript project without @types/express — add it for Request / RequestHandler and AuthenticatedExpressRequest typings.');
  } else if (deps.fastify) {
    warn('fastify (not express) is a dependency — use the monocloud-auth-fastify skill and its verify.js.');
  } else {
    info(`No express dependency — validate tokens with the root MonoCloudBackendNodeClient.validateAccessToken() (SKILL.md, "Without Express").`);
  }
}

// --- Environment ----------------------------------------------------------------------------
const fileEnv = {};
const envFiles = ['.env', '.env.local'].filter((f) => {
  const text = readText(path.join(ROOT, f));
  if (text === null) return false;
  Object.assign(fileEnv, parseEnv(text));
  return true;
});
const has = (name) => process.env[name] !== undefined || fileEnv[name] !== undefined;
const val = (name) => String(process.env[name] !== undefined ? process.env[name] : fileEnv[name] ?? '');
const sources = envFiles.length ? `process env or ${envFiles.join(' / ')}` : 'process env (no .env file found)';

for (const name of Object.keys(fileEnv)) {
  if (name.startsWith(P) && !KNOWN_VARS.has(name)) warn(`${name} is not read by ${PKG} — check the spelling against the env table in SKILL.md.`);
}
const authVars = Object.keys(fileEnv).filter((n) => n.startsWith('MONOCLOUD_AUTH_'));
if (authVars.length) info(`${authVars.join(', ')}: MONOCLOUD_AUTH_* configure the sign-in SDKs; ${PKG} reads only MONOCLOUD_BACKEND_*.`);

for (const key of STRING_VARS) {
  if (has(P + key) && val(P + key).trim() === '') fail(`${P + key} is set but empty — client construction throws MonoCloudValidationError; delete the line or give it a value.`);
}

const tenant = val(P + 'TENANT_DOMAIN').trim();
if (!has(P + 'TENANT_DOMAIN')) {
  warn(`${P}TENANT_DOMAIN not found in ${sources} — unless set at runtime, protectApi() throws "tenantDomain" is required.`);
} else if (tenant) {
  let url = null;
  try { url = new URL(tenant); } catch { /* reported below */ }
  if (!tenant.startsWith('https://')) {
    fail(/^[a-z][a-z0-9+.-]*:/i.test(tenant)
      ? `${P}TENANT_DOMAIN="${tenant}" must start with https:// (lower-case) — other values get https:// prepended, so discovery and the issuer check fail.`
      : `${P}TENANT_DOMAIN="${tenant}" has no scheme — construction throws "tenantDomain" must be a valid uri. Use https://<tenant-domain>.`);
  } else if (!url) {
    fail(`${P}TENANT_DOMAIN="${tenant}" is not a valid URL.`);
  } else if (url.pathname.includes('.well-known')) {
    fail(`${P}TENANT_DOMAIN must be the bare origin — the SDK appends /.well-known/openid-configuration itself.`);
  } else if (url.pathname.replace(/\/$/, '') !== '' || url.search || url.hash) {
    warn(`${P}TENANT_DOMAIN="${tenant}" has a path — it must equal the token's iss (normally the bare https:// origin).`);
  } else {
    pass(`${P}TENANT_DOMAIN=${tenant}`);
  }
}

const audience = val(P + 'AUDIENCE').trim();
if (!has(P + 'AUDIENCE')) {
  warn(`${P}AUDIENCE not found in ${sources} — unless set at runtime, protectApi() throws "audience" is required.`);
} else if (audience) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(audience)) fail(`${P}AUDIENCE="${audience}" is not a URI — construction throws "audience" must be a valid uri. Use the API's Audience exactly as configured, e.g. https://api.example.com.`);
  else pass(`${P}AUDIENCE=${audience} (must match the token's aud exactly)`);
}

const method = has(P + 'CLIENT_AUTH_METHOD') ? val(P + 'CLIENT_AUTH_METHOD').trim() : 'client_secret_post';
const methodValid = AUTH_METHODS.includes(method);
if (method && !methodValid) fail(`${P}CLIENT_AUTH_METHOD="${method}" is invalid — use one of ${AUTH_METHODS.join(', ')} (case-sensitive); construction throws otherwise.`);

const envMode = val(P + 'VALIDATE_CERTIFICATE_BINDING').trim();
if (envMode && !BINDING_MODES.includes(envMode)) fail(`${P}VALIDATE_CERTIFICATE_BINDING="${envMode}" is invalid — use ${BINDING_MODES.join(' | ')} (case-sensitive, not a boolean); construction throws otherwise.`);

for (const key of BOOL_VARS) {
  const raw = val(P + key).trim();
  if (has(P + key) && raw.toLowerCase() !== 'true' && raw.toLowerCase() !== 'false') warn(`${P + key}="${raw}" is ignored — only "true" or "false" are recognized (default false applies).`);
}

for (const [key, min] of Object.entries(NUMBER_VARS)) {
  if (!has(P + key)) continue;
  const raw = val(P + key).trim();
  const n = parseInt(raw, 10);
  const readAs = String(n) !== raw ? ` (read as ${n} by parseInt)` : '';
  if (raw === '' || Number.isNaN(n)) warn(`${P + key}="${raw}" is not a number — ignored, the default applies.`);
  else if (n < min) fail(`${P + key}="${raw}"${readAs} is below the minimum ${min}${key === 'RESPONSE_TIMEOUT' ? ' ms' : ''} — construction throws MonoCloudValidationError.`);
  else if (readAs) warn(`${P + key}="${raw}"${readAs}.`);
  else if (key === 'INTROSPECTION_CACHE_DURATION' && n === 0) info(`${P + key}=0 — introspection caching is disabled.`);
}

// --- Source code ----------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor']);
function collectSources(dir, acc, depth) {
  if (acc.length >= 3000 || depth > 10) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) collectSources(full, acc, depth + 1); }
    else if (e.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(e.name) && !/\.d\.[cm]?ts$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const code = { usesSdk: false, loadsDotenv: false, certResolver: false, cookieResolver: false, introspectJwt: false, modes: new Set() };
for (const file of collectSources(ROOT, [], 0)) {
  const raw = readText(file);
  if (!raw || raw.length > 1e6) continue;
  if (/['"]dotenv(?:\/config)?['"]|@dotenvx\/dotenvx|process\.loadEnvFile\s*\(/.test(raw)) code.loadsDotenv = true;
  if (!/@monocloud\/|protectApi|MonoCloudBackendNodeClient/.test(raw)) continue;
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const rel = path.relative(ROOT, file);
  if (/['"]@monocloud\/backend-node(?:\/[\w-]+)?['"]/.test(src)) code.usesSdk = true;
  if (/\bcertificateResolver\b/.test(src)) code.certResolver = true;
  if (/\btokenResolver\b[^\n]{0,160}\.cookies\b/.test(src)) code.cookieResolver = true;
  if (/\bintrospectJwtTokens\s*:\s*true\b/.test(src)) code.introspectJwt = true;

  if (/['"]@monocloud\/node-backend/.test(src)) fail(`${rel}: imports "@monocloud/node-backend" — the package is "@monocloud/backend-node".`);
  const rootImport = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@monocloud\/backend-node['"]|\{([^}]*)\}\s*=\s*require\(\s*['"]@monocloud\/backend-node['"]\s*\)/g;
  for (const m of src.matchAll(rootImport)) {
    const names = (m[1] || m[2]).split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+|\s*:\s*/)[0]);
    for (const name of names) {
      if (['protectApi', 'AuthenticatedExpressRequest', 'ProtectMiddleware'].includes(name)) fail(`${rel}: ${name} is not exported by the package root — import it from "${SUBPATH}".`);
      if (['AuthenticatedFastifyRequest', 'ProtectHook'].includes(name)) fail(`${rel}: ${name} is not exported by the package root — import it from "@monocloud/backend-node/fastify".`);
    }
  }
  for (const m of src.matchAll(/\bvalidateCertificateBinding\s*:\s*(true|false|['"`]([^'"`]*)['"`])/g)) {
    if (!m[2]) fail(`${rel}: validateCertificateBinding: ${m[1]} — it takes a mode ('when_present' | 'required' | 'dangerously_ignore'), not a boolean.`);
    else if (!BINDING_MODES.includes(m[2])) fail(`${rel}: validateCertificateBinding: '${m[2]}' is not a valid mode (${BINDING_MODES.join(' | ')}).`);
  }
  for (const m of src.matchAll(/new\s+MonoCloudBackendNodeClient\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    const mode = /\bvalidateCertificateBinding\s*:\s*['"`]([^'"`]*)['"`]/.exec(m[1]);
    if (mode && BINDING_MODES.includes(mode[1])) code.modes.add(mode[1]);
  }
  if (new RegExp(`\\bprotectApi\\s*\\(\\s*\\{[^}]*\\b(?:${CLIENT_OPTIONS})\\s*[:,}]`).test(src)) {
    fail(`${rel}: protectApi({ ... }) reads only tokenResolver / certificateResolver — client options there are ignored. Pass new MonoCloudBackendNodeClient({ ... }) as the first argument.`);
  }
  if (/\.validateAccessToken\s*\([^)]*\bvalidateCertificateBinding\b/.test(src)) {
    fail(`${rel}: validateAccessToken() options have no validateCertificateBinding — the mode is the client option.`);
  }
  if (/\bcache\s*:\s*new\s+[A-Z][\w$]*/.test(src)) {
    warn(`${rel}: cache is a class instance — the option must be an object whose own properties are exactly get/set/delete (other own fields throw "cache.<name>" is not allowed; #private fields break on the SDK's copy). Prefer an object literal.`);
  }
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*protectApi\s*\(/g)) {
    const f = esc(m[1]);
    if (new RegExp(`\\.(?:use|all|get|post|put|patch|delete|options|head)\\s*\\(\\s*(?:['"\`][^'"\`]*['"\`]\\s*,\\s*)?(?:[\\w$.]+\\s*,\\s*)*${f}\\s*[,)]`).test(src)) {
      fail(`${rel}: "${m[1]}" is passed without calling it — use ${m[1]}() (the factory itself never calls next(), so requests hang).`);
    }
    if (new RegExp(`\\b${f}\\s*\\(\\s*\\{[^}]*\\b(?:validateCertificateBinding|clientCertificate)\\b`).test(src)) {
      fail(`${rel}: ${m[1]}({ ... }) accepts only scopes / groups — set validateCertificateBinding on the client and supply the certificate via certificateResolver.`);
    }
  }
}
if (pkg && !code.usesSdk) warn(`No source file imports ${PKG} yet.`);
if (code.cookieResolver && !deps['cookie-parser']) warn('A tokenResolver reads req.cookies but cookie-parser is not a dependency — req.cookies stays undefined without it.');

const scripts = pkg ? JSON.stringify(pkg.scripts || {}) : '';
if (envFiles.includes('.env') && !code.loadsDotenv && !/--env-file|dotenvx?\b|\bbun\b/.test(scripts)) {
  warn('.env exists but nothing appears to load it (no dotenv import, --env-file flag or process.loadEnvFile()) — the SDK reads process.env when the client is built.');
}

// --- Introspection credentials and certificate binding --------------------------------------
const clientId = has(P + 'CLIENT_ID') && val(P + 'CLIENT_ID').trim() !== '';
const secret = val(P + 'CLIENT_SECRET').trim();
const introspectAll = val(P + 'INTROSPECT_JWT_TOKENS').trim().toLowerCase() === 'true' || code.introspectJwt;
if (!clientId) {
  if (has(P + 'CLIENT_ID')) { /* empty value — reported above */ }
  else if (introspectAll) warn(`JWT introspection is enabled but ${P}CLIENT_ID is not in ${sources} — every request gets 500 (Token introspection is not configured) unless it is set at runtime.`);
  else info(`${P}CLIENT_ID not set — JWTs are validated locally; opaque tokens would get 500 (Token introspection is not configured).`);
} else if (methodValid) {
  pass(`${P}CLIENT_ID set — introspection enabled (${method})`);
  let jwk = null;
  try { const o = JSON.parse(secret); if (o && typeof o === 'object' && typeof o.kty === 'string') jwk = o; } catch { /* plain secret */ }
  if (MTLS_METHODS.includes(method)) {
    info(`${method}: the SDK sends only client_id to the mTLS endpoint alias — pass a fetcher whose transport presents the client certificate.`);
  } else if (!secret) {
    warn(`${P}CLIENT_SECRET not found in ${sources} — ${SECRET_REQUIRED.includes(method) ? `${method} then fails at introspection with "Invalid Client Authentication Method" (401)` : 'the introspection endpoint will reject the client (500)'} unless it is set at runtime.`);
  } else if (method === 'private_key_jwt') {
    if (!jwk) fail(`${P}CLIENT_SECRET must be the private JWK as JSON for private_key_jwt — construction throws "clientSecret must be a valid JWK when clientAuthMethod is 'private_key_jwt'".`);
    else if (jwk.kty === 'oct') fail(`${P}CLIENT_SECRET is a symmetric (oct) JWK — private_key_jwt needs an RSA or EC private key.`);
    else if (!/^(?:RS|PS|ES)(?:256|384|512)$/.test(jwk.alg || '')) fail(`${P}CLIENT_SECRET JWK has no supported "alg" (RS*/PS*/ES*) — introspection fails with "unsupported JWS algorithm" (401).`);
    else pass(`${P}CLIENT_SECRET is a private JWK (${jwk.alg})`);
  } else if (jwk) {
    fail(`${P}CLIENT_SECRET is a JWK, which is accepted only with private_key_jwt — ${method} needs a plain string (construction throws "clientSecret" must be a string).`);
  } else {
    pass(`${P}CLIENT_SECRET set`);
  }
}
if (has(P + 'TRUST_STORE_ID') && methodValid && !MTLS_METHODS.includes(method)) warn(`${P}TRUST_STORE_ID applies only to ${MTLS_METHODS.join(' / ')} — ignored with ${method}.`);

const modes = code.modes.size ? [...code.modes] : [BINDING_MODES.includes(envMode) ? envMode : 'when_present'];
if (!code.certResolver) {
  if (modes.includes('required')) fail('validateCertificateBinding is "required" but no certificateResolver is configured — every request gets 401 (Client certificate is not present).');
  else if (modes.includes('when_present')) info('No certificateResolver — fine unless clients send certificate-bound tokens (cnf.x5t#S256); those are checked by default and would get 401 (Client certificate is not present).');
}
if (modes.includes('dangerously_ignore')) warn('validateCertificateBinding "dangerously_ignore" — certificate-bound tokens are accepted without checking the presented certificate.');

// --- Report ---------------------------------------------------------------------------------
for (const [level, msg] of findings) console.log(`[${level}] ${msg}`);
const count = (level) => findings.filter(([l]) => l === level).length;
console.log(`\n${findings.length} checks — ${count('FAIL')} failed, ${count('WARN')} warnings.`);
process.exit(count('FAIL') ? 1 : 0);
