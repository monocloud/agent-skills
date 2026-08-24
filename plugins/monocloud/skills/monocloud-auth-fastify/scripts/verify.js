#!/usr/bin/env node
// Diagnostic for @monocloud/backend-node/fastify integrations.
// Usage: node skills/monocloud-auth-fastify/scripts/verify.js [project-dir]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PKG_NAME = '@monocloud/backend-node';
const REQUIRED_ENV = [
  'MONOCLOUD_BACKEND_TENANT_DOMAIN',
  'MONOCLOUD_BACKEND_AUDIENCE',
];
const INTROSPECTION_ENV = [
  'MONOCLOUD_BACKEND_CLIENT_ID',
  'MONOCLOUD_BACKEND_CLIENT_SECRET',
];

const findings = [];
const pass = (m) => findings.push(['pass', m]);
const warn = (m) => findings.push(['warn', m]);
const fail = (m) => findings.push(['fail', m]);

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function parseEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const pkg = readJson(path.join(ROOT, 'package.json'));
if (!pkg) {
  fail('No package.json at project root');
} else {
  pass(`Found package.json (${pkg.name || 'unnamed'})`);
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps[PKG_NAME]) pass(`${PKG_NAME} declared (${deps[PKG_NAME]})`);
  else fail(`${PKG_NAME} not in dependencies. Run: npm install ${PKG_NAME}`);
  if (!deps.fastify) warn('"fastify" not declared — this skill targets Fastify.');
  else pass(`fastify present (${deps.fastify})`);
}

const envFileExists = fs.existsSync(path.join(ROOT, '.env')) || fs.existsSync(path.join(ROOT, '.env.local'));
const env = { ...parseEnvFile(path.join(ROOT, '.env')), ...parseEnvFile(path.join(ROOT, '.env.local')) };
for (const name of REQUIRED_ENV) {
  if (process.env[name] || env[name]) pass(`${name} set`);
  else warn(`${name} not found in process env${envFileExists ? ' or .env/.env.local' : ' and no .env/.env.local present'}. Set it via your runtime (Docker, systemd, PaaS, --env-file, etc.) before starting the app.`);
}

const introspectAll = String(process.env.MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS || env.MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS || '').trim().toLowerCase() === 'true';
if (introspectAll) {
  for (const name of INTROSPECTION_ENV) {
    if (process.env[name] || env[name]) pass(`${name} set`);
    else warn(`${name} not found but INTROSPECT_JWT_TOKENS=true — introspection will fail unless this is injected at runtime.`);
  }
} else {
  for (const name of INTROSPECTION_ENV) {
    if (process.env[name] || env[name]) pass(`${name} set (needed only for opaque tokens / introspection)`);
  }
}

const CERT_BINDING_MODES = ['when_present', 'required', 'dangerously_ignore'];
const certBinding = String(process.env.MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING || env.MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING || '').trim();
if (!certBinding) {
  pass('MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING unset — defaults to "when_present": tokens carrying a cnf/x5t#S256 thumbprint ARE validated, so wire a certificateResolver.');
} else if (CERT_BINDING_MODES.includes(certBinding)) {
  pass(`MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING=${certBinding}`);
} else {
  fail(`MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING must be one of ${CERT_BINDING_MODES.join(', ')} — any other value throws MonoCloudValidationError at startup.`);
}

const responseTimeout = parseInt(String(process.env.MONOCLOUD_BACKEND_RESPONSE_TIMEOUT || env.MONOCLOUD_BACKEND_RESPONSE_TIMEOUT || '').trim(), 10);
if (!Number.isNaN(responseTimeout)) {
  if (responseTimeout < 1000) fail('MONOCLOUD_BACKEND_RESPONSE_TIMEOUT must be >= 1000 (milliseconds) — smaller values throw MonoCloudValidationError at startup.');
  else pass(`MONOCLOUD_BACKEND_RESPONSE_TIMEOUT set (${responseTimeout}ms)`);
}

const introspectionCacheDuration = parseInt(String(process.env.MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION || env.MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION || '').trim(), 10);
if (!Number.isNaN(introspectionCacheDuration)) {
  if (introspectionCacheDuration < 0) fail('MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION must be >= 0 — negative values throw MonoCloudValidationError at startup.');
  else if (introspectionCacheDuration === 0) warn('MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION=0 — introspection caching is disabled; every opaque token hits the introspection endpoint.');
  else pass(`MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION set (${introspectionCacheDuration}s)`);
}

const tag = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
for (const [k, m] of findings) console.log(`[${tag[k]}] ${m}`);
const failed = findings.filter(([k]) => k === 'fail').length;
console.log(`\n${findings.length} checks — ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
