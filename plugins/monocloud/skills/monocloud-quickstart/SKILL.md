---
name: monocloud-quickstart
description: Use this skill FIRST whenever a user asks to add MonoCloud (authentication or management) to a project but hasn't said which framework. It detects the project type by reading `package.json`, `*.csproj`, `requirements.txt`, etc., then routes to the correct framework-specific MonoCloud skill (`monocloud-auth-nextjs`, `monocloud-auth-react`, `monocloud-auth-express`, `monocloud-auth-fastify`, `monocloud-auth-aspnetcore`, `monocloud-web-js`, `monocloud-management-js`, `monocloud-management-dotnet`). Also use when the user says "set up MonoCloud", "add MonoCloud login", "integrate MonoCloud", "use the MonoCloud SDK", or "manage users programmatically with MonoCloud" without naming a stack.
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

The detector handles these signals:

| Signal in project | Skill to use |
|---|---|
| `"next"` in `package.json` dependencies | `monocloud-auth-nextjs` |
| `"@monocloud/auth-nextjs"` already installed | `monocloud-auth-nextjs` |
| `"@monocloud/auth-react"` already installed | `monocloud-auth-react` |
| `"@monocloud/auth-web-js"` already installed | `monocloud-web-js` |
| `"@monocloud/management"` already installed | `monocloud-management-js` |
| `"fastify"` in `package.json` (no `next`) | `monocloud-auth-fastify` |
| `"express"` in `package.json` (no `next`/`fastify`) | `monocloud-auth-express` |
| `"react"` + browser bundler (vite/CRA/parcel/webpack) and no server framework | `monocloud-auth-react` |
| Browser SPA with `vite`/`parcel`/`webpack`/`rollup` and no server framework (no React) | `monocloud-web-js` |
| `*.csproj` referencing `MonoCloud.Authentication.Api` | `monocloud-auth-aspnetcore` |
| `*.csproj` referencing `MonoCloud.Management` | `monocloud-management-dotnet` |
| `*.csproj` with no MonoCloud package — ASP.NET Core web/API project (`Sdk="Microsoft.NET.Sdk.Web"` / references `Microsoft.AspNetCore.*`) | `monocloud-auth-aspnetcore` (to protect the API) — use `monocloud-management-dotnet` instead if the goal is programmatic tenant/user management |
| Any other `*.csproj` (no MonoCloud yet, non-web .NET) | `monocloud-management-dotnet` (likely programmatic management) — use `monocloud-auth-aspnetcore` if it's actually an API to protect |

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
| `MONOCLOUD_AUTH_*` | `@monocloud/auth-nextjs` (frontend / Next.js session auth) |
| `MONOCLOUD_BACKEND_*` | `@monocloud/backend-node/{express,fastify}` (API token validation) |
| `MONOCLOUD_MANAGEMENT_*` | `@monocloud/management` (JS Management API SDK) |
| `MonoCloud:Management:*` (config keys, not env) | `MonoCloud.Management` (.NET Management API SDK) |
| _(none)_ | `MonoCloud.Authentication.Api` — ASP.NET Core API auth, configured via `AddMonoCloudAuthentication(options => …)` / `IConfiguration` binding only |
| _(none)_ | `@monocloud/auth-web-js` — pure browser SDK, configured via constructor options only |
| _(none)_ | `@monocloud/auth-react` — React SPA SDK, configured via `<MonoCloudAuthProvider>` props only |

## Skills catalog

- [`monocloud-auth-nextjs`](../monocloud-auth-nextjs/SKILL.md) — Sign-in/sign-up, sessions, route protection, components, hooks for Next.js (App + Pages Router).
- [`monocloud-auth-react`](../monocloud-auth-react/SKILL.md) — `@monocloud/auth-react` — React SPA SDK: `<MonoCloudAuthProvider>`, `useAuth`, `<SignIn>`/`<SignOut>`/`<Protected>` components.
- [`monocloud-auth-express`](../monocloud-auth-express/SKILL.md) — JWT / introspection token validation, scope + group enforcement for Express APIs.
- [`monocloud-auth-fastify`](../monocloud-auth-fastify/SKILL.md) — Same engine as above, with a Fastify `onRequest` hook.
- [`monocloud-auth-aspnetcore`](../monocloud-auth-aspnetcore/SKILL.md) — `MonoCloud.Authentication.Api` — ASP.NET Core access-token validation (JWT + introspection), scope/group authorization via `[Authorize]` policies, `IIntrospectionCache` caching, mTLS certificate-bound tokens.
- [`monocloud-web-js`](../monocloud-web-js/SKILL.md) — `@monocloud/auth-web-js` — browser SDK for vanilla JS / TS SPAs: redirect/popup/silent flows, sessions, pluggable storage.
- [`monocloud-management-js`](../monocloud-management-js/SKILL.md) — `@monocloud/management` — programmatic admin: users, clients, groups, resources, keys, logs, options, branding, trust stores.
- [`monocloud-management-dotnet`](../monocloud-management-dotnet/SKILL.md) — `MonoCloud.Management` NuGet — same surface in .NET with DI registration.

## Don't guess — verify after wiring

After the framework skill has been applied, run that skill's diagnostic:

```bash
node skills/<skill-folder>/scripts/verify.js
```

For example: `node skills/monocloud-auth-nextjs/scripts/verify.js`. The diagnostic checks env vars and that the SDK appears in `package.json`.

## Deeper reference

- [`references/concepts.md`](references/concepts.md) — tenant URL, OIDC vs Management APIs, public vs confidential clients.
