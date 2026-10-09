---
name: monocloud-auth-fastify
description: Use when protecting a Fastify API with MonoCloud access tokens — installing `@monocloud/backend-node/fastify`, wiring the `protectApi()` `onRequest` hook factory (`protect()` as a route `onRequest` hook, `fastify.addHook('onRequest', protect())`, `protect({ scopes, groups })`), validating JWT (JWKS) or opaque (introspection) bearer tokens, reading `request.claims` via `AuthenticatedFastifyRequest`, custom `tokenResolver` / `certificateResolver`, an `IIntrospectionCache`, or mTLS certificate binding (`validateCertificateBinding` `when_present` / `required` / `dangerously_ignore`, `cnf` / `x5t#S256`); also for troubleshooting `MONOCLOUD_BACKEND_*` env vars (`MONOCLOUD_BACKEND_TENANT_DOMAIN`, `MONOCLOUD_BACKEND_AUDIENCE`), 401 `invalid_token` / 403 `insufficient_scope` / 500 / 503 responses, or errors like `Invalid audience claim`, `Token introspection is not configured`, `Client certificate is not present`.
license: MIT
---

# MonoCloud API protection for Fastify (`@monocloud/backend-node/fastify`)

Validates MonoCloud-issued bearer access tokens in a Fastify `onRequest` hook: JWTs (three dot-separated segments) locally against the tenant's JWKS, any other (opaque) token through token introspection (RFC 7662), then enforces scopes, groups and mTLS certificate binding. It only validates tokens — it does not sign users in or keep sessions. The Express middleware (skill `monocloud-auth-express`) runs the same engine.

## Package identity — read first

Check `package.json` before suggesting code. There is one package, `@monocloud/backend-node`:

| Import from | Provides |
| --- | --- |
| `@monocloud/backend-node/fastify` | `protectApi`, `AuthenticatedFastifyRequest`, `ProtectHook`, plus the client, errors and types |
| `@monocloud/backend-node` | `MonoCloudBackendNodeClient`, errors, types — **no `protectApi`** |
| `@monocloud/backend-node/express` | The Express middleware — use the `monocloud-auth-express` skill |
| `@monocloud/backend-node/utils` | `isUserInGroup()` for custom group checks |

Requires Node.js `>=20` and `fastify` `^4.0.0 || ^5.0.0`.

Do not mix up:

- `@monocloud/auth-nextjs` / `@monocloud/auth-node-core` — user sign-in and sessions, configured with `MONOCLOUD_AUTH_*`. The package name is `@monocloud/backend-node`, not `@monocloud/node-backend`.
- Other libraries' APIs: `@fastify/jwt` (`request.jwtVerify()`), `@fastify/auth`, a `fastify.authenticate` decorator. `protectApi()` is **not** a Fastify plugin — never `fastify.register()` it. Validated claims are on `request.claims`, not `request.user`.

## Install and configure

```bash
npm install @monocloud/backend-node
```

Create an **API** in the MonoCloud dashboard; its **Audience** is `MONOCLOUD_BACKEND_AUDIENCE`, and tokens must be issued for it (e.g. `resource=<audience>` on the token request).

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONOCLOUD_BACKEND_TENANT_DOMAIN` | required | Tenant origin, e.g. `https://acme.us.monocloud.com` — must equal the token's `iss` |
| `MONOCLOUD_BACKEND_AUDIENCE` | required | API audience URI, e.g. `https://api.example.com` — must be in the token's `aud` |
| `MONOCLOUD_BACKEND_CLIENT_ID` | — | Client used for introspection; required for opaque tokens (and for every token when `INTROSPECT_JWT_TOKENS=true`) |
| `MONOCLOUD_BACKEND_CLIENT_SECRET` | — | Its secret; for `private_key_jwt`, the private JWK as a JSON string |
| `MONOCLOUD_BACKEND_CLIENT_AUTH_METHOD` | `client_secret_post` | `client_secret_basic`, `client_secret_post`, `client_secret_jwt`, `private_key_jwt`, `tls_client_auth`, `self_signed_tls_client_auth`, `spiffe_jwt`, `spiffe_x509` |
| `MONOCLOUD_BACKEND_TRUST_STORE_ID` | — | mTLS client auth only: use `mtls_additional_endpoint_aliases[id]` instead of `mtls_endpoint_aliases` |
| `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS` | `false` | `true` introspects JWTs too (server-side revocation; one extra request per uncached token) |
| `MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING` | `when_present` | `when_present`, `required` or `dangerously_ignore` — see [Certificate-bound tokens](#certificate-bound-mtls-tokens) |
| `MONOCLOUD_BACKEND_GROUPS_CLAIM` | `groups` | Claim holding group memberships |
| `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL` | `false` | `true` requires every listed group |
| `MONOCLOUD_BACKEND_CLOCK_SKEW` | `0` | Seconds added to the local clock for `exp` / `nbf` checks |
| `MONOCLOUD_BACKEND_CLOCK_TOLERANCE` | `60` | Leeway in seconds on `exp` / `nbf` |
| `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` | `300` | Seconds the JWKS is cached |
| `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` | `300` | Seconds the discovery document is cached |
| `MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION` | `300` | Max seconds an introspection result stays in your `cache`; `0` disables caching |
| `MONOCLOUD_BACKEND_RESPONSE_TIMEOUT` | `10000` | Milliseconds (min `1000`) before discovery / JWKS / introspection requests abort |

Booleans accept only `true` / `false` (any case) and numbers are read with `parseInt`; anything else is silently ignored and the default applies. Building the client (which `protectApi()` does) throws `MonoCloudValidationError` for a missing or non-URI tenant domain / audience, an unknown auth method or binding mode (case-sensitive), a number below its minimum, an **empty** string variable (a blank `MONOCLOUD_BACKEND_CLIENT_ID=` line), or a non-JWK secret with `private_key_jwt`. Options passed to `new MonoCloudBackendNodeClient({...})` override env vars.

## Protect routes

```ts
import "dotenv/config"; // load MONOCLOUD_BACKEND_* before protectApi() runs
import Fastify from "fastify";
import { protectApi, type AuthenticatedFastifyRequest } from "@monocloud/backend-node/fastify";

const fastify = Fastify();
const protect = protectApi(); // once, at startup: builds the client from env (throws on bad config)

fastify.get("/health", async () => "ok"); // no hook → public

fastify.get("/api/me", { onRequest: protect() }, async (request) => {
  const { claims } = request as AuthenticatedFastifyRequest;
  return { sub: claims.sub, scope: claims.scope };
});
fastify.post("/api/posts", { onRequest: protect({ scopes: ["posts:write"] }) }, async (_request, reply) => reply.code(201).send());
fastify.delete("/api/posts/:id", { onRequest: protect({ groups: ["admin"] }) }, async (_request, reply) => reply.code(204).send());

// Every route of an encapsulated plugin:
fastify.register(async (admin) => {
  admin.addHook("onRequest", protect({ groups: ["admin"] }));
  admin.get("/users", async () => []);
}, { prefix: "/admin" });

// App-wide (also guards health checks and CORS preflight): fastify.addHook("onRequest", protect());

await fastify.listen({ port: 3000 });
```

`protectApi()` returns a factory; **call** it (`protect()`, `protect({...})`) to get the hook. `{ onRequest: protect }` hands Fastify the factory itself — a TypeScript error; in JavaScript the factory never calls `done`, so requests hang.

`protect(options?)` accepts only `ProtectOptions`:

- `scopes?: string[]` — **all** required, matched against the space-separated `scope` claim (no `scp` fallback; the claim name is fixed).
- `groups?: string[]` — **any one** by default, all when `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true`. Read from the `groups` claim (`MONOCLOUD_BACKEND_GROUPS_CLAIM`); entries may be strings or `{ id, name }` objects (either field matches).

Empty arrays require nothing. There is no per-route certificate option: the binding mode is the client's `validateCertificateBinding` and the certificate comes from `certificateResolver`.

## Responses

| Outcome | Status | JSON body | `WWW-Authenticate` |
| --- | --- | --- | --- |
| No token (`Authorization` absent or not exactly `Bearer <token>`, or `tokenResolver` returned a blank string) | 401 | `{"message":"unauthorized"}` | `Bearer` |
| Token rejected — `MonoCloudTokenError` `invalid_token` / `inactive_token` (signature, `iss`, `aud`, `exp`, inactive, certificate binding…) | 401 | `{"message":"unauthorized"}` | `Bearer error="invalid_token"` |
| Missing scope or group — `insufficient_scope` / `insufficient_groups` | 403 | `{"message":"forbidden"}` | `Bearer error="insufficient_scope"` |
| `MonoCloudHttpError` with no status (network failure, `responseTimeout`), a 5xx or a 429 | 503 | `{"message":"service unavailable"}` | — |
| `MonoCloudValidationError`, `MonoCloudOPError`, any other `MonoCloudHttpError` | 500 | `{"message":"internal server error"}` | — |
| Any other thrown error (a resolver or cache throws, unsupported `alg`, no matching JWKS key) | 401 | `{"message":"unauthorized"}` | `Bearer error="invalid_token"` |

On success `request.claims` is set and the request continues; on failure the hook sends the reply, so later hooks and the handler are skipped. The cause is never exposed — see [Find the real error](references/troubleshooting.md#find-the-real-error).

`request.claims` is `AccessTokenClaims` (`iss`, `sub`, `aud`, `exp`, `iat`, `nbf?`, `scope?`, `client_id?`, `jti?`, plus custom claims via an index signature). Instead of casting to `AuthenticatedFastifyRequest`, you can augment Fastify once:

```ts
import type { AccessTokenClaims } from "@monocloud/backend-node/fastify";

declare module "fastify" {
  interface FastifyRequest { claims?: AccessTokenClaims }
}
```

## Shared client, custom token source, caching

```ts
import { protectApi, MonoCloudBackendNodeClient } from "@monocloud/backend-node/fastify";

const client = new MonoCloudBackendNodeClient({
  cache: introspectionCache,       // optional IIntrospectionCache — object with exactly get/set/delete
  introspectionCacheDuration: 120, // any option overrides its MONOCLOUD_BACKEND_* variable
});

const protect = protectApi(client, {
  // Default source: Authorization: Bearer <token>. Returning undefined falls back to it.
  tokenResolver: async (request) => request.cookies?.access_token, // register @fastify/cookie first
});
```

- `protectApi(options)` without a client reads only `tokenResolver` / `certificateResolver`; client options passed there are ignored.
- One client can back several factories and shares their discovery / JWKS caches.
- Only introspection results are cached, keyed by the raw token, for at most `introspectionCacheDuration` seconds; scope, group and binding checks still run on every request. Contract, shape rules and an example: [`IIntrospectionCache`](references/api-surface.md#iintrospectioncache).

## Certificate-bound (mTLS) tokens

Tokens issued to mTLS clients carry `cnf: { "x5t#S256": "<base64url SHA-256 of the client certificate>" }`. The client option `validateCertificateBinding` (`MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING`) decides when the binding is checked:

| Mode | Checked when |
| --- | --- |
| `when_present` (default) | the token's `cnf` contains `x5t#S256`; a `cnf` that is not a JSON object is also checked (and rejected) |
| `required` | every request — tokens without `cnf` are rejected |
| `dangerously_ignore` | never |

A checked request needs the certificate from `certificateResolver` — PEM with or without the `BEGIN`/`END` lines, or base64 DER. The SDK never reads the TLS socket or headers itself; without a certificate the request gets 401 (`Client certificate is not present`).

```ts
import type { FastifyRequest } from "fastify";
import type { TLSSocket } from "node:tls";

// TLS terminated by Fastify (Fastify({ https: { ..., requestCert: true } }))
const fromSocket = async (request: FastifyRequest) =>
  (request.raw.socket as TLSSocket).getPeerCertificate?.().raw?.toString("base64");

// TLS terminated by a proxy: read only a header the proxy sets (and strips from incoming requests)
const fromProxy = async (request: FastifyRequest) => {
  const cert = request.headers["x-client-cert"];
  return typeof cert === "string" ? decodeURIComponent(cert) : undefined; // proxies often URL-encode the PEM
};

const protect = protectApi(client, { certificateResolver: fromProxy });
```

The resolver runs on every request; returning `undefined` is fine when no binding check applies.

## Common pitfalls

1. **Root import** — `protectApi` and `AuthenticatedFastifyRequest` exist only in `@monocloud/backend-node/fastify`.
2. **Build the factory once, after env is loaded** — `protectApi()` constructs and validates the client immediately; per-request calls create new clients that refetch discovery and JWKS. Load env first (`import "dotenv/config"` as the first import, or `node --env-file=.env`).
3. **Hook scope** — `fastify.addHook("onRequest", protect())` guards every route in that encapsulation context, including health checks and CORS preflight (`OPTIONS`, sent without a token). Register it inside a plugin to scope it, and let CORS answer preflight first (e.g. register `@fastify/cors` before adding the hook).
4. **Exact audience and issuer** — the token's `aud` must contain `MONOCLOUD_BACKEND_AUDIENCE` verbatim (trailing slash included); `iss` must equal the `https://` tenant domain (one trailing `/` is ignored).
5. **Opaque tokens need introspection credentials** — without `MONOCLOUD_BACKEND_CLIENT_ID` they get 500 (`Token introspection is not configured`). JWTs need none.
6. **Certificate-bound tokens are checked by default** — wire `certificateResolver` wherever clients send `cnf`-bound tokens.
7. **Blank env lines crash startup** — e.g. `MONOCLOUD_BACKEND_CLIENT_SECRET=` throws `"clientSecret" is not allowed to be empty`; delete unused lines.

## References

- [references/api-surface.md](references/api-surface.md) — every export and signature, options ↔ env vars with validation rules, the `validateAccessToken` flow, the `IIntrospectionCache` contract, error classes.
- [references/troubleshooting.md](references/troubleshooting.md) — error-message index and symptom → cause → fix.
- [scripts/verify.js](scripts/verify.js) — `node scripts/verify.js [project-dir]` checks dependencies, `MONOCLOUD_BACKEND_*` values and common code mistakes.
