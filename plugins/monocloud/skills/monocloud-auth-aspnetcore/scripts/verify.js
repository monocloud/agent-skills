#!/usr/bin/env node
// Diagnostic for MonoCloud.Authentication.Api — MonoCloud access-token validation in ASP.NET Core APIs.
// Usage: node scripts/verify.js [project-dir]
// Pure Node, no dependencies, no .NET SDK needed. Static, heuristic checks of:
//   *.csproj           PackageReference MonoCloud.Authentication.Api; TargetFramework net8.0 or later
//   *.cs               AddAuthentication(...).AddMonoCloudAuthentication(...), middleware order, introspection
//                      settings (ClientId + ClientAuth), IIntrospectionCache lifetime, ValidateCertificateBinding,
//                      group/role/claim usage, and options or APIs that do not exist
//   appsettings*.json  the MonoCloud section: Authority / Audience values, committed secrets, bound options
// The SDK reads no environment variables; it is configured by the options action or IConfiguration binding.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PACKAGE_ID = 'MonoCloud.Authentication.Api';
const CLIENT_AUTH_TYPES = ['ClientSecretAuth', 'JwtAssertionAuth', 'TlsAuth', 'SpiffeJwtAuth', 'SpiffeX509Auth'];
const BINDING_MODES = ['WhenPresent', 'Required', 'DangerouslyIgnore'];
const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', 'TestResults']);

const findings = [];
const pass = (m) => findings.push(['PASS', m]);
const warn = (m) => findings.push(['WARN', m]);
const fail = (m) => findings.push(['FAIL', m]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function listFiles(dir, test, depth = 6) {
  const out = [];
  (function walk(d, left) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (left > 0) walk(full, left - 1); } else if (test(e.name)) out.push(full);
    }
  })(dir, depth);
  return out;
}

const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/^﻿/, ''); } catch { return null; } };
const rel = (p) => path.relative(ROOT, p) || path.basename(p);
const isPlaceholder = (v) => /[<>]|\byour[-_ ]/i.test(String(v));
const lower = (v) => String(v).toLowerCase();

// Index just past the literal starting at i (C# regular, verbatim, interpolated, raw and char literals).
function skipLiteral(src, i, cs) {
  const q = src[i];
  if (cs && src.startsWith('"""', i)) {
    let n = 0;
    while (src[i + n] === '"') n++;
    const end = src.indexOf('"'.repeat(n), i + n);
    return end < 0 ? src.length : end + n;
  }
  const verbatim = cs && q === '"' && (src[i - 1] === '@' || (src[i - 1] === '$' && src[i - 2] === '@'));
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (verbatim) {
      if (ch === '"') { if (src[j + 1] === '"') { j += 2; continue; } return j + 1; }
    } else if (ch === '\\') { j += 2; continue; } else if (ch === q || ch === '\n') return j + 1;
    j++;
  }
  return j;
}

// Drop // and /* */ comments but keep literals (cs: C# rules; otherwise JSON rules).
function stripComments(src, cs) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; out += ' '; continue; }
    if (c === '"' || (cs && c === '\'')) { const end = skipLiteral(src, i, cs); out += src.slice(i, end); i = end; continue; }
    out += c;
    i++;
  }
  return out;
}

// .NET configuration JSON allows comments and trailing commas.
function parseJsonc(text) {
  try { return JSON.parse(stripComments(text, false).replace(/,(\s*[}\]])/g, '$1')); } catch { return undefined; }
}

// Configuration keys are case-insensitive.
function getKey(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  const key = Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : obj[key];
}

// First object-valued section whose key contains "MonoCloud" (depth-first).
function findMonoCloudSection(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj)) if (/monocloud/i.test(k) && v && typeof v === 'object') return v;
  for (const v of Object.values(obj)) {
    const s = v && typeof v === 'object' ? findMonoCloudSection(v) : null;
    if (s) return s;
  }
  return null;
}

// Argument text of every call whose opening is matched by `opener` (balanced parentheses, literals skipped).
function callArgs(src, opener) {
  const spans = [];
  const re = new RegExp(opener.source, 'g');
  while (re.exec(src)) {
    let depth = 1;
    let j = re.lastIndex;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === '"' || ch === '\'') { j = skipLiteral(src, j, true); continue; }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      j++;
    }
    spans.push(src.slice(re.lastIndex, Math.max(re.lastIndex, j - 1)));
  }
  return spans;
}

// Right-hand side of `Name = …` (ignoring `==`, `=>` and TokenValidationParameters.Name), or null.
function assignment(src, name) {
  const m = new RegExp(`(?<!TokenValidationParameters\\s*\\.\\s*)\\b${name}\\s*=(?![=>])\\s*([^;\\n]*)`).exec(src);
  return m ? m[1].trim() : null;
}
const literal = (rhs) => (rhs ? (/^@?"([^"]*)"/.exec(rhs) || [])[1] : undefined);

// ---------------------------------------------------------------------------
// 1. Project files: package reference and target framework.
// ---------------------------------------------------------------------------
const csprojs = listFiles(ROOT, (n) => n.endsWith('.csproj'));
if (!csprojs.length) fail(`No .csproj under ${ROOT} — pass the ASP.NET Core project directory.`);

const pkgTag = new RegExp(`<PackageReference\\b[^>]*\\bInclude\\s*=\\s*["']${PACKAGE_ID.replace(/\./g, '\\.')}["'][^>]*>`, 'i');
let installed = false;
for (const f of csprojs) {
  const xml = read(f) || '';
  const tag = pkgTag.exec(xml);
  if (!tag) continue;
  installed = true;
  const version = (/\bVersion\s*=\s*["']([^"']+)["']/i.exec(tag[0]) || [])[1];
  pass(`${rel(f)} references ${PACKAGE_ID}${version ? ` (${version})` : ''}.`);
  const tfms = [...xml.matchAll(/<TargetFrameworks?>([^<]+)<\/TargetFrameworks?>/gi)]
    .flatMap((m) => m[1].split(';')).map((t) => t.trim()).filter((t) => t && !t.includes('$('));
  for (const tfm of tfms) {
    const m = /^net(\d+)\.\d+/i.exec(tfm);
    if (m && Number(m[1]) >= 8) pass(`${rel(f)} targets ${tfm}.`);
    else fail(`${rel(f)} targets ${tfm}. ${PACKAGE_ID} targets net8.0, net9.0 and net10.0, so restore fails (NU1202). Target net8.0 or later.`);
  }
}
if (csprojs.length && !installed) {
  const mgmt = csprojs.some((f) => /Include\s*=\s*["']MonoCloud\.Management["']/i.test(read(f) || ''));
  fail(`${PACKAGE_ID} is not referenced by any .csproj. Run: dotnet add package ${PACKAGE_ID}`
    + (mgmt ? ' (MonoCloud.Management is the Management API client, not the token-validation handler).' : ''));
}

// ---------------------------------------------------------------------------
// 2. Sources and settings.
// ---------------------------------------------------------------------------
const csFiles = listFiles(ROOT, (n) => n.endsWith('.cs'));
const sources = csFiles.map((f) => [f, stripComments(read(f) || '', true)]);
const code = sources.map(([, s]) => s).join('\n');
if (!csFiles.length) warn('No .cs files found to scan.');

const sections = [];
for (const f of listFiles(ROOT, (n) => /^appsettings(\..+)?\.json$/i.test(n))) {
  const cfg = parseJsonc(read(f) || '');
  if (cfg === undefined) { warn(`${rel(f)} is not valid JSON.`); continue; }
  const section = findMonoCloudSection(cfg);
  if (section) sections.push({ file: rel(f), section });
}
const setting = (name) => sections
  .map((s) => ({ file: s.file, value: getKey(s.section, name) }))
  .filter((s) => s.value !== undefined && s.value !== null && s.value !== '');
const settingIs = (name, value) => setting(name).some((s) => lower(s.value) === value);

// Option assignments come from AddMonoCloudAuthentication(...) / Configure<MonoCloudAuthenticationOptions>(...)
// arguments; when those hold no assignments (e.g. a method group), every source file is scanned instead.
const optionSpans = [
  ...callArgs(code, /\bAddMonoCloudAuthentication\s*\(/),
  ...callArgs(code, /\b(?:Post)?Configure\s*<\s*MonoCloudAuthenticationOptions\s*>\s*\(/),
];
const optionsCode = optionSpans.some((s) => /[^=!<>]=[^=>]/.test(s)) ? optionSpans.join('\n') : code;

// ---------------------------------------------------------------------------
// 3. Registration and middleware.
// ---------------------------------------------------------------------------
const hasAddMonoCloud = /\bAddMonoCloudAuthentication\s*\(/.test(code);
if (hasAddMonoCloud) {
  pass('AddMonoCloudAuthentication(...) registers the MonoCloud scheme.');
  if (!/\bAddAuthentication\s*\(/.test(code)) warn('AddMonoCloudAuthentication(...) extends the AuthenticationBuilder returned by services.AddAuthentication(...); start the chain there.');
  if (!/\bMonoCloud\.Authentication\.Api\b/.test(code)) warn('No "using MonoCloud.Authentication.Api;" found — AddMonoCloudAuthentication and MonoCloudAuthenticationDefaults live in that namespace.');
} else if (csFiles.length) {
  fail('No AddMonoCloudAuthentication(...) call. Register the scheme: builder.Services.AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme).AddMonoCloudAuthentication(options => { options.Authority = ...; options.Audience = ...; });');
}

const schemeNames = callArgs(code, /\bAddMonoCloudAuthentication\s*\(/).map((a) => {
  const t = a.trim();
  const named = /^"([^"]*)"\s*(?:,|$)/.exec(t);
  if (named) return named[1];
  if (t === '' || /^MonoCloudAuthenticationDefaults\s*\.\s*AuthenticationScheme\s*(?:,|$)/.test(t) || /^\(?[\w\s,]*\)?\s*=>/.test(t)) return 'MonoCloud';
  return null; // a variable or method group: unknown
}).filter(Boolean);
const duplicate = schemeNames.find((s, i) => schemeNames.indexOf(s) !== i);
if (duplicate) fail(`Scheme "${duplicate}" is registered by more than one AddMonoCloudAuthentication call — InvalidOperationException "Scheme already exists". Use one call per scheme name.`);

const webApp = /\bWebApplication\s*\.\s*Create(?:Slim|Empty)?Builder\s*\(/.test(code);
let callsAuthN = false;
let callsAuthZ = false;
let orderIssue = false;
for (const [f, src] of sources) {
  const n = src.search(/\.\s*UseAuthentication\s*\(/);
  const z = src.search(/\.\s*UseAuthorization\s*\(/);
  const r = src.search(/\.\s*UseRouting\s*\(/);
  callsAuthN = callsAuthN || n >= 0;
  callsAuthZ = callsAuthZ || z >= 0;
  if (n >= 0 && z >= 0 && n > z) { orderIssue = true; fail(`${rel(f)}: UseAuthorization() runs before UseAuthentication(), so authorization sees an anonymous user and valid tokens get 401. Call app.UseAuthentication() first.`); }
  if (r >= 0 && ((n >= 0 && r > n) || (z >= 0 && r > z))) { orderIssue = true; warn(`${rel(f)}: UseRouting() is called after UseAuthentication()/UseAuthorization(). Call both after UseRouting().`); }
}
if (hasAddMonoCloud) {
  if (callsAuthN && callsAuthZ) { if (!orderIssue) pass('app.UseAuthentication() then app.UseAuthorization() are called in order.'); }
  else if (callsAuthN) warn('app.UseAuthentication() is called without app.UseAuthorization(). Add app.UseAuthorization() after it; an automatically added authorization middleware would run before your authentication.');
  else if (!webApp) warn('No app.UseAuthentication()/app.UseAuthorization() found. Outside WebApplication (e.g. a Startup class) call both, between UseRouting() and UseEndpoints().');
  else pass('WebApplication adds the authentication/authorization middleware automatically (no explicit calls found).');
}

// ---------------------------------------------------------------------------
// 4. Authority and Audience.
// ---------------------------------------------------------------------------
const httpsOff = /\bRequireHttpsMetadata\s*=\s*false\b/.test(code) || settingIs('RequireHttpsMetadata', 'false');
function checkValue(name, value, where) {
  if (typeof value !== 'string') return;
  if (isPlaceholder(value)) return warn(`${name} in ${where} is a placeholder ("${value}"). Replace it with the real value.`);
  if (name !== 'Authority') return;
  if (/\.well-known/i.test(value)) fail(`Authority in ${where} is a discovery URL ("${value}"). Set the tenant root (e.g. https://acme.us.monocloud.com); /.well-known/openid-configuration is appended for you.`);
  else if (/^http:\/\//i.test(value) && !httpsOff) fail(`Authority in ${where} uses http://. That throws InvalidOperationException unless RequireHttpsMetadata = false (development only).`);
}
const audienceViaTvp = /\bValidAudiences?\s*=|\bValidateAudience\s*=\s*false\b/.test(code);
for (const name of ['Authority', 'Audience']) {
  const rhs = assignment(optionsCode, name);
  const fromSettings = setting(name);
  if (rhs !== null) { pass(`${name} is set in code.`); checkValue(name, literal(rhs), 'code'); }
  for (const s of fromSettings) { pass(`${name} found in ${s.file}.`); checkValue(name, s.value, s.file); }
  if (rhs !== null || fromSettings.length) continue;
  if (name === 'Authority') {
    const hint = setting('TenantDomain').length ? ' A "TenantDomain" key was found; the option is named Authority.' : '';
    fail(`No Authority found in the MonoCloud options or appsettings. Set options.Authority to the tenant domain (e.g. https://acme.us.monocloud.com); it is the issuer and the discovery base.${hint}`);
  } else if (!audienceViaTvp) {
    warn('No Audience found. Set options.Audience to the API identifier; without an audience, JWT validation fails.');
  }
}

// ---------------------------------------------------------------------------
// 5. Introspection path: ClientId + ClientAuth, and secrets.
// ---------------------------------------------------------------------------
const clientIdSet = assignment(optionsCode, 'ClientId') !== null || setting('ClientId').length > 0;
const clientAuthSet = assignment(optionsCode, 'ClientAuth') !== null;
const authTypes = CLIENT_AUTH_TYPES.filter((t) => new RegExp(`\\bnew\\s+${t}\\s*\\(`).test(code));
const introspectJwt = /\bIntrospectJwtTokens\s*=\s*true\b/.test(optionsCode) || settingIs('IntrospectJwtTokens', 'true');
if (clientIdSet && clientAuthSet) pass(`Introspection configured: ClientId + ClientAuth${authTypes.length ? ` (${authTypes.join(', ')})` : ''}.`);
else if (clientAuthSet) fail('ClientAuth is set without ClientId. Introspection throws ArgumentNullException ("Client ID must be set"). Set options.ClientId.');
else if (clientIdSet) (introspectJwt ? fail : warn)('ClientId is set without ClientAuth, so introspection (opaque tokens) throws ArgumentNullException → 500. Set options.ClientAuth, e.g. new ClientSecretAuth(builder.Configuration["MonoCloud:ClientSecret"]!).');
else if (introspectJwt) fail('IntrospectJwtTokens = true sends every token to introspection, which needs options.ClientId and options.ClientAuth.');
else if (hasAddMonoCloud) pass('No ClientId/ClientAuth: fine for JWT access tokens. Opaque tokens would need both.');

const secretLiteral = /\bnew\s+(ClientSecretAuth|JwtAssertionAuth)\s*\(\s*@?"([^"]+)"/.exec(code);
if (secretLiteral) warn(`Hardcoded secret passed to new ${secretLiteral[1]}(...). Read it from configuration (User Secrets, a vault or an environment variable).`);
for (const s of setting('ClientSecret')) {
  if (!isPlaceholder(s.value)) warn(`ClientSecret has a literal value in ${s.file}. Keep secrets in User Secrets or a vault, not in committed appsettings files.`);
}

// ---------------------------------------------------------------------------
// 6. Options and APIs that do not exist.
// ---------------------------------------------------------------------------
const ghosts = [
  [optionsCode, /\.\s*TenantDomain\s*=(?!=)/, 'options.TenantDomain does not exist. Set options.Authority to the tenant domain.'],
  [code, /\bJwtTokenValidationParameters\b/, 'JwtTokenValidationParameters does not exist. Use the inherited options.TokenValidationParameters.'],
  [code, /\bUseMonoCloud(?:Authentication)?\s*\(/, 'UseMonoCloud()/UseMonoCloudAuthentication() do not exist. Register with AddMonoCloudAuthentication(...) and use app.UseAuthentication()/UseAuthorization().'],
  [code, /\bAddMonoCloud\s*\(/, 'AddMonoCloud() does not exist. Use services.AddAuthentication(...).AddMonoCloudAuthentication(...).'],
  [code, /\[\s*MonoCloudAuthorize\b/, '[MonoCloudAuthorize] does not exist. Use [Authorize(Policy = ...)] or [Authorize(Roles = ...)].'],
  [code, /\bprotectApi\s*\(/, 'protectApi() belongs to the Node SDK. In ASP.NET Core use [Authorize] / RequireAuthorization(...) policies.'],
  [code, /CacheKeyGenerator[\s\S]{0,300}?\.\s*SchemeName\b/, 'MonoCloudAuthenticationOptions.SchemeName is internal (CS0122). Give each scheme a distinct CacheKeyPrefix instead.'],
];
for (const [src, re, msg] of ghosts) if (re.test(src)) fail(msg);
if (optionsCode !== code && /\bClientSecret\s*=(?!=)/.test(optionsCode)) {
  fail('MonoCloudAuthenticationOptions has no ClientSecret. Set options.ClientAuth = new ClientSecretAuth(secret).');
}

// ---------------------------------------------------------------------------
// 7. IIntrospectionCache lifetime.
// ---------------------------------------------------------------------------
const cacheRegistered = (life) => new RegExp(`\\b(?:Try)?Add${life}\\s*(?:<\\s*IIntrospectionCache\\b|\\(\\s*typeof\\s*\\(\\s*IIntrospectionCache\\s*\\))`).test(code);
const cachingOn = /\bEnableCaching\s*=\s*true\b/.test(optionsCode) || settingIs('EnableCaching', 'true');
if (cacheRegistered('Scoped')) fail('IIntrospectionCache is registered as scoped. Register it as a singleton; the SDK\'s singleton post-configure step depends on it, so a scoped registration fails DI scope validation.');
else if (cacheRegistered('Transient')) warn('IIntrospectionCache is registered as transient. The SDK requires a singleton registration.');
else if (cacheRegistered('Singleton')) pass(`IIntrospectionCache is registered as a singleton${cachingOn ? ' and EnableCaching is on' : ''}.`);
else if (cachingOn) fail('EnableCaching = true without an IIntrospectionCache registration. The first request fails with ArgumentException "IIntrospectionCache not found in the services collection". Add services.AddSingleton<IIntrospectionCache, YourCache>().');

// ---------------------------------------------------------------------------
// 8. ValidateCertificateBinding.
// ---------------------------------------------------------------------------
const binding = assignment(code, 'ValidateCertificateBinding');
if (binding !== null) {
  const mode = (/CertificateBindingValidation\s*\.\s*(\w+)/.exec(binding) || [])[1];
  if (binding.includes('=>')) fail(`ValidateCertificateBinding is assigned a delegate (${binding}). It is a CertificateBindingValidation enum, so this does not compile (CS1660). Use CertificateBindingValidation.WhenPresent (default), .Required or .DangerouslyIgnore.`);
  else if (mode === 'DangerouslyIgnore') warn('ValidateCertificateBinding = DangerouslyIgnore accepts certificate-bound (cnf) tokens without checking the client certificate. Use it only if binding is enforced elsewhere.');
  else if (BINDING_MODES.includes(mode)) pass(`ValidateCertificateBinding = ${mode}.`);
  else warn(`ValidateCertificateBinding = ${binding}. It must be CertificateBindingValidation.WhenPresent, .Required or .DangerouslyIgnore; an undefined value throws ArgumentException.`);
}
for (const s of setting('ValidateCertificateBinding')) {
  const ok = BINDING_MODES.some((m) => lower(m) === lower(s.value)) || /^[0-2]$/.test(String(s.value));
  if (!ok) fail(`ValidateCertificateBinding in ${s.file} is "${s.value}". Use "WhenPresent", "Required" or "DangerouslyIgnore".`);
}

// ---------------------------------------------------------------------------
// 9. Claims: groups/roles, scope claim type, mapped claim names.
// ---------------------------------------------------------------------------
const roleRhs = assignment(optionsCode, 'RoleClaimType');
const roleValue = roleRhs !== null ? literal(roleRhs) : (setting('RoleClaimType')[0] || {}).value;
const groupChecks = /RequireClaim\s*\(\s*"groups"/.test(code) || /\bRoles\s*=\s*@?"/.test(code) || /\b(?:RequireRole|IsInRole)\s*\(/.test(code);
if (groupChecks) {
  if (roleValue === 'groups') pass('RoleClaimType = "groups": group objects expand to id + name claims and groups act as roles.');
  else if (/TokenValidationParameters\s*\.\s*RoleClaimType\s*=/.test(code) && roleRhs === null) warn('RoleClaimType is set on TokenValidationParameters only. Set options.RoleClaimType = "groups"; the introspection path reads only the MonoCloud options.');
  else if (roleRhs === null && roleValue === undefined) warn('Group/role checks found but RoleClaimType is not set. Set options.RoleClaimType = "groups": otherwise {id,name} groups stay raw JSON strings and [Authorize(Roles)] / IsInRole do not see groups.');
  else if (roleValue !== undefined) warn(`RoleClaimType is "${roleValue}". MonoCloud groups arrive in the "groups" claim.`);
}
if (/RequireClaim\s*\(\s*"scp"/.test(code) || /identity\/claims\/scope/.test(code)) {
  warn('A policy checks "scp" or the mapped scope URI. MonoCloud scopes arrive as "scope" claims (one per value): use RequireClaim("scope", "<value>").');
}
const mapOff = /\bMapInboundClaims\s*=\s*false\b/.test(code) || settingIs('MapInboundClaims', 'false');
const shortName = /\b(?:FindFirst|FindFirstValue|FindAll|HasClaim)\s*\(\s*"(sub|email|given_name|family_name|role|roles)"/.exec(code);
if (shortName && !mapOff) {
  warn(`Code reads the "${shortName[1]}" claim by its short name while MapInboundClaims is true (the default): on the JWT path it is renamed (e.g. sub → ClaimTypes.NameIdentifier). Set options.MapInboundClaims = false or read the mapped claim type.`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
for (const [tag, msg] of findings) console.log(`[${tag}] ${msg}`);
const failed = findings.filter(([t]) => t === 'FAIL').length;
const warned = findings.filter(([t]) => t === 'WARN').length;
console.log(`\n${findings.length} checks: ${failed} failed, ${warned} warning(s).`);
process.exit(failed ? 1 : 0);
