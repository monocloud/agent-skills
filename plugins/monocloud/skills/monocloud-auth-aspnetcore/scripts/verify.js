#!/usr/bin/env node
// Diagnostic for MonoCloud.Authentication.Api (ASP.NET Core API authentication).
// Usage: node skills/monocloud-auth-aspnetcore/scripts/verify.js [project-dir]
// Cross-platform: pure Node — no .NET tooling required to run.
//
// Grounded in MonoCloud.Authentication.Api v0.1.3:
//   - PackageReference id:   MonoCloud.Authentication.Api
//   - Default scheme:        "MonoCloud" (MonoCloudAuthenticationDefaults.AuthenticationScheme)
//   - DI extension:          AddAuthentication(scheme).AddMonoCloudAuthentication(options => { ... })
//   - Pipeline:              app.UseAuthentication(); app.UseAuthorization();
//   - Options base:          MonoCloudAuthenticationOptions : JwtBearerOptions (tenant domain set via inherited Authority)
//   - Cache abstraction:     IIntrospectionCache (MUST be registered as a singleton)
// This is an ASP.NET Core authentication HANDLER/scheme (built on JwtBearer), not a
// middleware you write and not a management client. Authorization is done through the
// STANDARD ASP.NET Core policy system ([Authorize(Policy=...)], RequireClaim), NOT a
// MonoCloud-specific factory. The SDK reads NO environment variables of its own —
// config flows through the options action or IConfiguration binding of
// MonoCloudAuthenticationOptions.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const PACKAGE_ID = 'MonoCloud.Authentication.Api';

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

// ---------------------------------------------------------------------------
// 1. Find .csproj files and confirm the package reference.
// ---------------------------------------------------------------------------
const csprojs = listFiles(ROOT, '.csproj');
if (!csprojs.length) {
  fail(`No .csproj found under ${ROOT} — is this an ASP.NET Core project directory?`);
} else {
  pass(`Found ${csprojs.length} .csproj file(s)`);
}

// Match Include="MonoCloud.Authentication.Api" exactly — the id is a prefix of
// nothing else the SDK ships, but anchor on the closing quote to be safe.
let installed = false;
for (const f of csprojs) {
  const t = safeRead(f) || '';
  if (new RegExp(`PackageReference\\s+Include="${PACKAGE_ID.replace(/\./g, '\\.')}"`).test(t)) {
    installed = true;
    const m = t.match(new RegExp(`Include="${PACKAGE_ID.replace(/\./g, '\\.')}"[^>]*Version="([^"]+)"`));
    pass(`${path.relative(ROOT, f)} references ${PACKAGE_ID}${m ? ` (${m[1]})` : ''}`);
  }
}
if (csprojs.length && !installed) {
  fail(`${PACKAGE_ID} not referenced in any .csproj. Run: dotnet add package ${PACKAGE_ID}`);
}

// ---------------------------------------------------------------------------
// 2. Scan .cs sources for wiring.
// ---------------------------------------------------------------------------
const csFiles = listFiles(ROOT, '.cs');
// Concatenate for cross-file checks; keep per-file where a filename matters.
let allCs = '';
let importsSdk = false;
for (const f of csFiles) {
  const t = safeRead(f);
  if (!t) continue;
  allCs += '\n' + t;
  if (/using\s+MonoCloud\.Authentication\.Api/.test(t)) importsSdk = true;
}

if (csFiles.length === 0) {
  warn('No .cs source files found to scan for wiring.');
} else {
  pass(`Scanned ${csFiles.length} .cs source file(s).`);
}

const hasAddAuthentication = /\.?AddAuthentication\s*\(/.test(allCs);
const hasAddMonoCloud = /\.?AddMonoCloudAuthentication\s*\(/.test(allCs);

if (hasAddMonoCloud) {
  pass('Found AddMonoCloudAuthentication(...) — the MonoCloud scheme is registered.');
} else if (csFiles.length) {
  fail(`No AddMonoCloudAuthentication(...) call found. Register the handler with `
    + `builder.Services.AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme)`
    + `.AddMonoCloudAuthentication(options => { options.Authority = ...; options.Audience = ...; }).`);
}

if (hasAddAuthentication && !hasAddMonoCloud) {
  warn('AddAuthentication(...) is present but AddMonoCloudAuthentication(...) is not — '
    + 'chain .AddMonoCloudAuthentication(...) onto the AuthenticationBuilder so the MonoCloud scheme is added.');
}
if (hasAddMonoCloud && !hasAddAuthentication) {
  warn('AddMonoCloudAuthentication(...) is present but no AddAuthentication(...) call was found — '
    + 'it is an extension on the AuthenticationBuilder returned by services.AddAuthentication(scheme); make sure the chain starts there.');
}

if (importsSdk && !installed) {
  warn('Source has "using MonoCloud.Authentication.Api" but the package is not referenced — add the PackageReference so it restores.');
}

// ---------------------------------------------------------------------------
// 3. Pipeline order: UseAuthentication() must precede UseAuthorization().
// ---------------------------------------------------------------------------
const authNIdx = allCs.search(/\.?UseAuthentication\s*\(/);
const authZIdx = allCs.search(/\.?UseAuthorization\s*\(/);
const hasUseAuthN = authNIdx >= 0;
const hasUseAuthZ = authZIdx >= 0;

if (csFiles.length) {
  if (hasUseAuthN) pass('app.UseAuthentication() present.');
  else warn('app.UseAuthentication() not found — without it the MonoCloud scheme never runs and every request is anonymous.');

  if (hasUseAuthZ) pass('app.UseAuthorization() present.');
  else warn('app.UseAuthorization() not found — required for [Authorize]/RequireAuthorization policy enforcement.');

  // Order check only makes sense when both appear (approximate: first occurrence,
  // typically both live in Program.cs).
  if (hasUseAuthN && hasUseAuthZ && authNIdx > authZIdx) {
    warn('UseAuthorization() appears before UseAuthentication(). Call app.UseAuthentication() first, then app.UseAuthorization().');
  } else if (hasUseAuthN && hasUseAuthZ) {
    pass('UseAuthentication() precedes UseAuthorization().');
  }
}

// ---------------------------------------------------------------------------
// 4. Authority + Audience configured (options code OR appsettings).
//    The SDK binds MonoCloudAuthenticationOptions; it reads no env vars of its own.
// ---------------------------------------------------------------------------
const optTenantInCode = /\bAuthority\b/.test(allCs);
const optAudienceInCode = /\bAudience\b/.test(allCs);

// Inspect appsettings*.json for a MonoCloud section carrying Authority / Audience.
const settingsFiles = listFiles(ROOT, '.json').filter((f) => /appsettings(\..+)?\.json$/i.test(path.basename(f)));
let tenantInSettings = false;
let audienceInSettings = false;
let secretInSettings = false;

function findKeyDeep(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key) && typeof obj[key] === 'string' && obj[key].trim()) return obj[key];
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findKeyDeep(v, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

for (const f of settingsFiles) {
  const t = safeRead(f);
  if (!t) continue;
  let cfg;
  try { cfg = JSON.parse(t); } catch { continue; }
  const rel = path.relative(ROOT, f);
  if (findKeyDeep(cfg, 'Authority') !== undefined) { tenantInSettings = true; pass(`Authority configured in ${rel}.`); }
  if (findKeyDeep(cfg, 'Audience') !== undefined) { audienceInSettings = true; pass(`Audience configured in ${rel}.`); }
  const secretVal = findKeyDeep(cfg, 'ClientSecret');
  if (secretVal !== undefined) {
    secretInSettings = true;
    warn(`ClientSecret is a literal value in ${rel} — move it to User Secrets / Key Vault / an env var and bind it at runtime. Never commit client secrets.`);
  }
}

if (optTenantInCode && !tenantInSettings) pass('Authority referenced in source (options code).');
if (optAudienceInCode && !audienceInSettings) pass('Audience referenced in source (options code).');

if (!optTenantInCode && !tenantInSettings) {
  warn('No Authority found in options code or appsettings. Set options.Authority to your MonoCloud tenant root (e.g. https://<tenant>.us.monocloud.com) — it is the issuer and the base of the discovery URL. Required.');
}
if (!optAudienceInCode && !audienceInSettings) {
  warn('No Audience found in options code or appsettings. Set options.Audience to your API identifier so incoming tokens are validated against the right audience.');
}

// ---------------------------------------------------------------------------
// 5. Opaque-token / introspection path: needs BOTH ClientId AND a ClientAuth.
// ---------------------------------------------------------------------------
const CLIENT_AUTHS = ['ClientSecretAuth', 'JwtAssertionAuth', 'TlsAuth', 'SpiffeJwtAuth', 'SpiffeX509Auth'];
const hasClientId = /\bClientId\b/.test(allCs) || (settingsFiles.some((f) => { const c = safeRead(f); if (!c) return false; try { return findKeyDeep(JSON.parse(c), 'ClientId') !== undefined; } catch { return false; } }));
const clientAuthUsed = CLIENT_AUTHS.filter((c) => new RegExp(`\\b${c}\\b`).test(allCs));
const hasClientAuthRef = /\bClientAuth\b/.test(allCs) || clientAuthUsed.length > 0;
const introspectJwt = /\bIntrospectJwtTokens\b/.test(allCs);

const opaqueImplied = hasClientId || hasClientAuthRef || introspectJwt;
if (opaqueImplied) {
  if (introspectJwt) {
    warn('IntrospectJwtTokens is referenced — all tokens (even JWTs) go through introspection, which requires Authority + ClientId + a ClientAuth.');
  }
  if (hasClientId && !hasClientAuthRef) {
    warn('ClientId is configured but no ClientAuth is set. The introspection path needs both — set options.ClientAuth (e.g. new ClientSecretAuth("<secret>")). Missing ClientAuth throws ArgumentNullException at request time.');
  } else if (hasClientAuthRef && !hasClientId) {
    warn('A ClientAuth is configured but no ClientId is set. Every ClientAuth implementation needs options.ClientId; introspection throws ArgumentNullException without it.');
  } else if (hasClientId && hasClientAuthRef) {
    pass(`Introspection configured: ClientId + ClientAuth${clientAuthUsed.length ? ` (${clientAuthUsed.join(', ')})` : ''}. Ensure Authority is also set.`);
  }
}

// ---------------------------------------------------------------------------
// 6. Hardcoded client secret literal in source.
// ---------------------------------------------------------------------------
// Flag ClientSecretAuth("literal") / JwtAssertionAuth("literal") with a non-config,
// non-empty string argument — a strong signal of a committed secret.
const secretLiteral = /\b(?:ClientSecretAuth|JwtAssertionAuth)\s*\(\s*"([^"]+)"/.exec(allCs);
if (secretLiteral) {
  warn(`Hardcoded secret literal passed to ${secretLiteral[0].split('(')[0].trim()}(...) in source. Read it from configuration/secrets (e.g. builder.Configuration["MonoCloud:ClientSecret"] or an env var) instead of embedding the value.`);
}

// ---------------------------------------------------------------------------
// 7. Caching: EnableCaching / IIntrospectionCache implies a SINGLETON registration.
// ---------------------------------------------------------------------------
const cachingReferenced = /\bEnableCaching\b/.test(allCs) || /\bIIntrospectionCache\b/.test(allCs);
if (cachingReferenced) {
  const singleton = /AddSingleton\s*<\s*IIntrospectionCache\b/.test(allCs)
    || /AddSingleton\s*\(\s*typeof\s*\(\s*IIntrospectionCache\s*\)/.test(allCs);
  const scopedOrTransient = /Add(?:Scoped|Transient)\s*<\s*IIntrospectionCache\b/.test(allCs)
    || /Add(?:Scoped|Transient)\s*\(\s*typeof\s*\(\s*IIntrospectionCache\s*\)/.test(allCs);

  if (singleton) {
    pass('IIntrospectionCache is registered as a singleton (AddSingleton<IIntrospectionCache, ...>).');
  } else if (scopedOrTransient) {
    fail('IIntrospectionCache is registered as scoped/transient. It MUST be a singleton — PostConfigure resolves it from a singleton, so a scoped/transient registration fails DI scope validation. Use services.AddSingleton<IIntrospectionCache, MyCache>().');
  } else {
    warn('EnableCaching / IIntrospectionCache is referenced but no AddSingleton<IIntrospectionCache, ...> registration was found. With EnableCaching = true and no registered cache, PostConfigure throws ArgumentException at startup. Register your cache as a singleton.');
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const tag = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
for (const [k, m] of findings) console.log(`[${tag[k]}] ${m}`);
const failed = findings.filter(([k]) => k === 'fail').length;
const warned = findings.filter(([k]) => k === 'warn').length;
console.log(`\n${findings.length} checks — ${failed} failed, ${warned} warning(s).`);
process.exit(failed > 0 ? 1 : 0);
