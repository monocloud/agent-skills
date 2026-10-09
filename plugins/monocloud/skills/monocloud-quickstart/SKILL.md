---
name: monocloud-quickstart
description: Use this skill FIRST whenever a user asks to add MonoCloud (authentication or management) to a project but hasn't said which framework. It detects the project type by reading `package.json`, `*.csproj`, `requirements.txt`, etc., then routes to the correct framework-specific MonoCloud skill (`monocloud-auth-nextjs`, `monocloud-auth-react`, `monocloud-auth-express`, `monocloud-auth-fastify`, `monocloud-auth-aspnetcore`, `monocloud-web-js`, `monocloud-management-js`, `monocloud-management-dotnet`). Also use when the user says "set up MonoCloud", "add MonoCloud login", "integrate MonoCloud", "use the MonoCloud SDK", "protect my API with MonoCloud", or "manage users programmatically with MonoCloud" without naming a stack.
license: MIT
---

# MonoCloud Quickstart Router

This skill detects the project's stack and points you at the correct MonoCloud skill. **Do not try to write integration code from this skill** — load the framework-specific skill and follow its `SKILL.md`.

## Step 1 — Detect the framework

Run the bundled detector. It scans the working directory (or a path you pass) and prints the recommended skill plus its reasoning:

```bash
node scripts/detect.js              # current dir
node scripts/detect.js /path/to/app
```

The detector checks `package.json` (`dependencies` + `devDependencies`) first; the first matching row wins. `*.csproj` files are only consulted when no `package.json` signal matched.

| Signal in project | Skill to use |
|---|---|
| `@monocloud/auth-nextjs` installed | `monocloud-auth-nextjs` |
| `@monocloud/auth-react` installed | `monocloud-auth-react` |
| `@monocloud/auth-web-js` installed | `monocloud-web-js` |
| `@monocloud/management` installed | `monocloud-management-js` |
| `@monocloud/backend-node` + `fastify` (no `express`) | `monocloud-auth-fastify` |
| `@monocloud/backend-node` + `express` | `monocloud-auth-express` |
| `@monocloud/backend-node` with neither framework (plain `node:http`, Koa, Hono, …) | `monocloud-auth-express` — its framework-agnostic `MonoCloudBackendNodeClient.validateAccessToken()` section |
| `next` | `monocloud-auth-nextjs` |
| `fastify` (no `express`) | `monocloud-auth-fastify` |
| `express` | `monocloud-auth-express` |
| `react` + a bundler (`vite`, `parcel`, `webpack`, `rollup`, `esbuild`, `@rspack/core`, `react-scripts`), no server framework, no Angular | `monocloud-auth-react` |
| A bundler with no server framework, no React, no Angular | `monocloud-web-js` |
| `*.csproj` referencing `MonoCloud.Authentication.Api` | `monocloud-auth-aspnetcore` |
| `*.csproj` referencing `MonoCloud.Management` | `monocloud-management-dotnet` |
| ASP.NET Core `*.csproj` (`Sdk="Microsoft.NET.Sdk.Web"` or `Microsoft.AspNetCore.*`) with no MonoCloud package | `monocloud-auth-aspnetcore` to protect the API — `monocloud-management-dotnet` if the goal is programmatic tenant/user management |
| Any other `*.csproj` with no MonoCloud package | `monocloud-management-dotnet` — `monocloud-auth-aspnetcore` if it's actually an API to protect |

If two skills could apply (e.g. an Express API in a Next.js monorepo), prefer the more specific match in the **app or package you're editing**, not the workspace root.

## Step 2 — Confirm with the user (only if ambiguous)

If detection is ambiguous (e.g. multiple `package.json` files in a monorepo, or both `"express"` and `"@monocloud/management"` declared), ask the user which app they want to wire up before proceeding.

## Step 3 — Load the framework skill

Once you know which skill to use, **stop reading this file** and switch to that skill's `SKILL.md`. The framework skill owns:

- Installation command
- Environment variables (these differ per SDK — see "Env-var families" below)
- File layout (middleware/proxy location, DI registration, etc.)
- Code patterns
- Troubleshooting

## Env-var families (for quick reference)

MonoCloud uses **prefix-namespaced** env vars per SDK. Don't mix them.

| Prefix | SDK |
|---|---|
| `MONOCLOUD_AUTH_*` | `@monocloud/auth-nextjs` (Next.js session auth) |
| `MONOCLOUD_BACKEND_*` | `@monocloud/backend-node` — root, `/express`, `/fastify` (API token validation) |
| `MONOCLOUD_MANAGEMENT_*` | `@monocloud/management` (JS Management API SDK) |
| `MonoCloud:Management:*` (configuration keys, not env vars) | `MonoCloud.Management` (.NET Management API SDK) |
| _(none)_ | `MonoCloud.Authentication.Api` — set `Authority`, `Audience`, … in the `AddMonoCloudAuthentication(options => …)` action; the SDK binds no configuration section, so read values from `IConfiguration` yourself |
| _(none)_ | `@monocloud/auth-web-js` — browser SDK, constructor options only |
| _(none)_ | `@monocloud/auth-react` — React SPA SDK, `<MonoCloudAuthProvider>` props only |

## Skills catalog

- [`monocloud-auth-nextjs`](../monocloud-auth-nextjs/SKILL.md) — Sign-in/sign-up, sessions, route protection, components, hooks for Next.js (App + Pages Router).
- [`monocloud-auth-react`](../monocloud-auth-react/SKILL.md) — `@monocloud/auth-react` — React SPA SDK: `<MonoCloudAuthProvider>`, `useAuth`, `<SignIn>`/`<SignOut>`/`<Protected>` components.
- [`monocloud-auth-express`](../monocloud-auth-express/SKILL.md) — JWT / introspection token validation, scope + group enforcement for Express APIs; also covers framework-agnostic validation with the root `MonoCloudBackendNodeClient`.
- [`monocloud-auth-fastify`](../monocloud-auth-fastify/SKILL.md) — Same engine as above, with a Fastify `onRequest` hook.
- [`monocloud-auth-aspnetcore`](../monocloud-auth-aspnetcore/SKILL.md) — `MonoCloud.Authentication.Api` — ASP.NET Core access-token validation (JWT + introspection), scope/group authorization via `[Authorize]` policies, `IIntrospectionCache` caching, mTLS certificate-bound tokens.
- [`monocloud-web-js`](../monocloud-web-js/SKILL.md) — `@monocloud/auth-web-js` — browser SDK for vanilla JS / TS SPAs: redirect/popup/silent flows, sessions, pluggable storage.
- [`monocloud-management-js`](../monocloud-management-js/SKILL.md) — `@monocloud/management` — programmatic admin: users, applications, groups, API resources, keys, logs, options, branding, network zones, trust stores.
- [`monocloud-management-dotnet`](../monocloud-management-dotnet/SKILL.md) — `MonoCloud.Management` NuGet — same surface in .NET with DI registration.

## Don't guess — verify after wiring

After the framework skill has been applied, run that skill's diagnostic:

```bash
node skills/<skill-folder>/scripts/verify.js
```

For example: `node skills/monocloud-auth-nextjs/scripts/verify.js`. Each diagnostic checks that the SDK is declared (`package.json` / `*.csproj`) and that its configuration is present and well-formed.

## Deeper reference

- [`references/concepts.md`](references/concepts.md) — tenant URL per SDK, OIDC vs Management, token types, client types, audiences.
