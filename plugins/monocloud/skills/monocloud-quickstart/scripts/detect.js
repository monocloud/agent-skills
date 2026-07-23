#!/usr/bin/env node
// Framework detector for MonoCloud agent skills.
// Usage: node scripts/detect.js [project-dir]
// Prints: the recommended skill name + reasons, and exits 0.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function safeJson(p) {
  const t = safeRead(p);
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function listFiles(dir, ext, depth = 2) {
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

const reasons = [];
const note = (m) => reasons.push(m);

const pkg = safeJson(path.join(ROOT, 'package.json'));
const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};

let skill = null;

// Highest-confidence signals: an existing MonoCloud package.
if (deps['@monocloud/auth-nextjs']) { skill = 'monocloud-auth-nextjs'; note('package.json declares @monocloud/auth-nextjs'); }
else if (deps['@monocloud/auth-react']) { skill = 'monocloud-auth-react'; note('package.json declares @monocloud/auth-react'); }
else if (deps['@monocloud/auth-web-js']) { skill = 'monocloud-web-js'; note('package.json declares @monocloud/auth-web-js'); }
else if (deps['@monocloud/management']) { skill = 'monocloud-management-js'; note('package.json declares @monocloud/management'); }
else if (deps['@monocloud/backend-node'] && deps.fastify && !deps.express) { skill = 'monocloud-auth-fastify'; note('@monocloud/backend-node + fastify detected'); }
else if (deps['@monocloud/backend-node'] && deps.express) { skill = 'monocloud-auth-express'; note('@monocloud/backend-node + express detected'); }
// Framework-only signals (SDK not installed yet).
else if (deps.next) { skill = 'monocloud-auth-nextjs'; note('Next.js detected via "next" dep'); }
else if (deps.fastify && !deps.express) { skill = 'monocloud-auth-fastify'; note('Fastify detected via "fastify" dep'); }
else if (deps.express) { skill = 'monocloud-auth-express'; note('Express detected via "express" dep'); }
// React SPA (no server framework): bundler + react present.
else if (
  pkg &&
  deps.react &&
  (deps.vite || deps.parcel || deps.webpack || deps.rollup || deps.esbuild || deps['@rspack/core'] || deps['react-scripts']) &&
  !deps.next && !deps.express && !deps.fastify &&
  !deps['@angular/core']
) {
  skill = 'monocloud-auth-react';
  const bundler = ['vite', 'parcel', 'webpack', 'rollup', 'esbuild', '@rspack/core', 'react-scripts'].find((b) => deps[b]);
  note(`React + ${bundler} detected with no server framework — likely a React SPA`);
}
// Vanilla browser SPA: a frontend bundler is present but no server framework and no React/Vue/Angular/Svelte SDK story.
else if (
  pkg &&
  (deps.vite || deps.parcel || deps.webpack || deps.rollup || deps.esbuild || deps['@rspack/core']) &&
  !deps.next && !deps.express && !deps.fastify &&
  !deps['@angular/core']
) {
  skill = 'monocloud-web-js';
  const bundler = ['vite', 'parcel', 'webpack', 'rollup', 'esbuild', '@rspack/core'].find((b) => deps[b]);
  note(`Browser bundler detected (${bundler}) with no server framework — likely a vanilla SPA`);
}

// .NET signals.
const csprojs = listFiles(ROOT, '.csproj', 3);
if (csprojs.length && !skill) {
  note(`Found .csproj files: ${csprojs.length}`);
  const csprojText = csprojs.map((f) => safeRead(f) || '').join('\n');
  const referencesAuth = /MonoCloud\.Authentication\.Api/i.test(csprojText);
  const referencesMgmt = /MonoCloud\.Management/i.test(csprojText);
  const isAspNetWeb = /Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/i.test(csprojText) || /Microsoft\.AspNetCore/i.test(csprojText);
  if (referencesAuth) {
    skill = 'monocloud-auth-aspnetcore';
    note('.csproj references MonoCloud.Authentication.Api');
  } else if (referencesMgmt) {
    skill = 'monocloud-management-dotnet';
    note('.csproj references MonoCloud.Management');
  } else if (isAspNetWeb) {
    skill = 'monocloud-auth-aspnetcore';
    note('ASP.NET Core web/API project detected with no MonoCloud package yet — use auth-aspnetcore to protect the API (use management-dotnet instead if the goal is programmatic tenant/user management).');
  } else {
    skill = 'monocloud-management-dotnet';
    note('.NET project (non-web) detected with no MonoCloud package yet — likely programmatic management; use management-dotnet (or auth-aspnetcore if this is actually an API to protect).');
  }
}

if (!pkg && !csprojs.length) {
  console.log('No package.json or *.csproj found at:', ROOT);
  console.log('Tell me what stack the project uses, then load the matching skill from skills/.');
  process.exit(0);
}

if (!skill) {
  console.log('Could not infer a single framework from project files.');
  console.log('Reasons inspected:');
  reasons.forEach((r) => console.log('  -', r));
  console.log('\nAsk the user which framework they are using, then load the matching skill from skills/.');
  process.exit(0);
}

console.log(`Recommended skill: ${skill}`);
console.log('Reasons:');
reasons.forEach((r) => console.log('  -', r));
console.log(`\nNext: load skills/${skill}/SKILL.md and follow its instructions.`);
