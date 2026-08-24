---
name: monocloud-auth-express
description: Use when integrating MonoCloud access-token validation into an Express API — installing or configuring `@monocloud/backend-node/express`, wiring the `protectApi()` middleware factory, validating JWT or opaque (introspection) bearer tokens, enforcing scopes/groups, attaching `claims` to `req` via `AuthenticatedExpressRequest`, or troubleshooting `MONOCLOUD_BACKEND_*` env vars / audience / JWKS / mTLS certificate binding.
license: MIT
---

# MonoCloud Express API protection (`@monocloud/backend-node/express`)

Backend SDK for validating MonoCloud-issued access tokens in Express APIs. Handles JWT signature verification (via JWKS) and opaque-token introspection automatically based on token format.

## Package identity — read this first

**Use:** `@monocloud/backend-node` with the `/express` subpath. This is a single npm package that also ships `/fastify`.

This is **not** the same SDK as `@monocloud/auth-nextjs` (frontend, user sessions) or `@monocloud/auth-node-core` (server-side auth flows). This package is purely for **API protection** — validating tokens issued elsewhere, not signing users in.

If you see any of these symbols, they belong to a different package or an older SDK — do not use them here:

- `expressJwt`, `expressOAuth2BearerToken`, `passport-*` (other libraries)
- `requireAuth`, `requireScopes` as standalone functions (this SDK uses one chained call)
- Importing from `@monocloud/backend-node` root for Express middleware (use the `/express` subpath)

## Installation

```bash
npm install @monocloud/backend-node
```

## Environment variables

Required:

| Variable                          | Purpose                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `MONOCLOUD_BACKEND_TENANT_DOMAIN` | MonoCloud tenant URL, e.g. `https://acme.us.monocloud.com` |
| `MONOCLOUD_BACKEND_AUDIENCE`      | Expected audience claim, e.g. `https://api.example.com`    |

Required only when validating **opaque tokens** (or when `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true`):

| Variable                               | Purpose                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MONOCLOUD_BACKEND_CLIENT_ID`          | Client used to call the introspection endpoint                                                                                                         |
| `MONOCLOUD_BACKEND_CLIENT_SECRET`      | Client secret. When `clientAuthMethod` is `private_key_jwt`, provide the private-key JWK as a JSON string (parsed and validated automatically).         |
| `MONOCLOUD_BACKEND_CLIENT_AUTH_METHOD` | One of `client_secret_basic`, `client_secret_post` (default), `client_secret_jwt`, `private_key_jwt`, `tls_client_auth`, `self_signed_tls_client_auth`, `spiffe_jwt`, `spiffe_x509` |

Required only when authenticating with a mutual-TLS client auth method (`tls_client_auth`, `self_signed_tls_client_auth`, `spiffe_x509`):

| Variable                            | Purpose                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MONOCLOUD_BACKEND_TRUST_STORE_ID`  | Selects a specific trust store's endpoints from `mtls_additional_endpoint_aliases`. When omitted, the default `mtls_endpoint_aliases` are used.   |

Optional tuning:

| Variable                                    | Default | Purpose                                                    |
| ------------------------------------------- | ------- | ---------------------------------------------------------- |
| `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS`   | `false` | If `true`, skip local JWT validation and always introspect |
| `MONOCLOUD_BACKEND_CLOCK_SKEW`              | `0`     | Allowed clock drift (seconds)                              |
| `MONOCLOUD_BACKEND_CLOCK_TOLERANCE`         | `60`    | Extra tolerance on time-based claims (seconds)             |
| `MONOCLOUD_BACKEND_GROUPS_CLAIM`            | `groups` | Claim name that carries group memberships                  |
| `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL`        | `false` | If `true`, all listed groups must match                    |
| `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION`     | `300`   | Seconds to cache the JWKS                                  |
| `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` | `300`   | Seconds to cache the OIDC discovery doc                    |
| `MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING` | `when_present` | Certificate-binding mode: `when_present`, `required`, or `dangerously_ignore` |
| `MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION` | `300`   | Seconds to cache introspection results (`0` disables caching) |
| `MONOCLOUD_BACKEND_RESPONSE_TIMEOUT`        | `10000` | Milliseconds before discovery / JWKS / introspection requests are aborted (min `1000`) |

## Basic wiring

```ts
import express from "express";
import {
  protectApi,
  type AuthenticatedExpressRequest,
} from "@monocloud/backend-node/express";

const app = express();

// Reads MONOCLOUD_BACKEND_* env vars. Build it once and reuse.
const protect = protectApi();

// Bare protection — any valid token works
app.get("/api/me", protect(), (req, res) => {
  const { claims } = req as AuthenticatedExpressRequest;
  res.json({ sub: claims.sub });
});

// Scope-gated
app.post("/api/posts", protect({ scopes: ["posts:write"] }), (req, res) => {
  res.status(201).end();
});

// Group-gated (uses MONOCLOUD_BACKEND_GROUPS_CLAIM or override per call)
app.delete("/api/posts/:id", protect({ groups: ["admin"] }), (req, res) => {
  res.status(204).end();
});

app.listen(3000);
```

Two-call pattern: `protectApi()` builds a **factory** once (parses env, loads JWKS lazily); calling the factory with options returns the actual middleware. Build the factory outside the request hook, call the factory inline per route.

## What `protect(options)` accepts

`options` (all optional):

```ts
interface ProtectOptions {
  scopes?: string[]; // require all listed scopes
  groups?: string[]; // require group membership (any-of by default)
}
// Declared as Omit<ValidateAccessTokenOptions, 'clientCertificate'> —
// certificate binding is now a CLIENT option, not a per-route one.
```

- **scopes**: AND semantics — the token must carry every listed scope (string match against the `scope` claim).
- **groups**: OR by default; flip with `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true` (or per-client `groupOptions.matchAll`). The claim name comes from `MONOCLOUD_BACKEND_GROUPS_CLAIM`.
- **certificate binding is not a per-route option any more.** It moved to the client: `validateCertificateBinding?: CertificateBindingValidation` (env `MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING`), with three modes — `'when_present'` (**default**: validate whenever the token's `cnf` claim carries an `x5t#S256` thumbprint), `'required'` (always validate, rejecting tokens with no `cnf` claim), `'dangerously_ignore'` (never validate, even when the token carries a `cnf` claim). Because the default is `'when_present'`, certificate-bound tokens are now validated automatically — wire a `certificateResolver` (see "Advanced" below) or they fail with `Client certificate is not present`.

## Client constructor options

`new MonoCloudBackendNodeClient(options)` accepts the backend-node option shape. Use this when you need a shared client, non-env configuration, or a custom token-claims cache:

```ts
interface MonoCloudBackendNodeClientOptions {
  tenantDomain: string;
  audience: string;
  clientId?: string;
  clientSecret?: string | Jwk;        // JSON-string JWK when clientAuthMethod is 'private_key_jwt'
  clientAuthMethod?: ClientAuthMethod;
  trustStoreId?: string;               // mTLS: pick trust store from mtls_additional_endpoint_aliases
  metadataResolver?: () => IssuerMetadata | Promise<IssuerMetadata>; // supply issuer metadata out-of-band
  jwksResolver?: () => Jwks | Promise<Jwks>;                         // supply JWKS out-of-band
  groupOptions?: { groupsClaim?: string; matchAll?: boolean };
  clockSkew?: number;
  clockTolerance?: number;
  jwksCacheDuration?: number;
  metadataCacheDuration?: number;
  introspectJwtTokens?: boolean;
  validateCertificateBinding?: CertificateBindingValidation; // 'when_present' (default) | 'required' | 'dangerously_ignore'
  introspectionCacheDuration?: number;  // seconds, default 300 — caps cached introspection results; 0 disables caching
  responseTimeout?: number;             // ms, default 10000 (min 1000) — aborts discovery / JWKS / introspection requests
  cache?: IIntrospectionCache;
  fetcher?: typeof fetch;              // (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}
```

`cache?: IIntrospectionCache` is constructor-only; pass it in code to cache introspection results by raw token. An entry expires at `min(claims.exp, now() + introspectionCacheDuration)` — so no entry outlives `introspectionCacheDuration` (default `300` s) however long the token lives — and `introspectionCacheDuration: 0` disables caching entirely even when a `cache` is supplied. Only tokens validated via introspection are cached (opaque tokens, and JWTs when `introspectJwtTokens` is `true`); locally-validated JWTs are never cached. An `active: false` verdict is cached too and replayed as `MonoCloudTokenError('Token is not active. A cached introspection result reported active=false', 'inactive_token')` → 401 until it expires. The result is cached as soon as introspection returns it; the requested `scopes`, `groups` and the client-level certificate-binding check then run **per route** against those claims — cached or fresh — so a cached entry never bypasses per-route authorization.

## Default responses

- No `Authorization: Bearer <token>` header (and no custom `tokenResolver`): `401 { "message": "unauthorized" }` with a `WWW-Authenticate: Bearer` header.
- Token validation fails (signature, audience, issuer, expiry, mismatched cnf, etc.): `401 { "message": "unauthorized" }` with `WWW-Authenticate: Bearer error="invalid_token"`.
- Introspection reports the token inactive (`active: false`), or a still-fresh cached `active: false` verdict is replayed: `401 { "message": "unauthorized" }` — a `MonoCloudTokenError` with `code: 'inactive_token'` (mapped to 401, not 403).
- A discovery / JWKS / introspection request exceeds `responseTimeout` (default `10000` ms): the request is aborted and a `MonoCloudHttpError` with **no** status is thrown → `503 { "message": "service unavailable" }`.
- Token is valid but missing required scopes or groups: `403 { "message": "forbidden" }` with `WWW-Authenticate: Bearer error="insufficient_scope"`.
- Authorization-server unreachable / 5xx / 429 (network or outage): `503 { "message": "service unavailable" }` (no `WWW-Authenticate`).
- Introspection or config failure (`MonoCloudValidationError`, `MonoCloudOPError`, or a non-5xx `MonoCloudHttpError`): `500 { "message": "internal server error" }`.

The middleware does not call `next(err)` — it sends the response directly. If you want custom error responses, wrap the middleware or implement your own using `MonoCloudBackendNodeClient.validateAccessToken()`.

## Reading the validated claims

After `protect()` runs successfully, `req.claims` is populated with `AccessTokenClaims`. Cast the request:

```ts
import type { AuthenticatedExpressRequest } from "@monocloud/backend-node/express";

app.get("/api/me", protect(), (req, res) => {
  const { claims } = req as AuthenticatedExpressRequest;
  // claims.sub, claims.scope, claims.exp, claims.iat, etc.
  res.json(claims);
});
```

Alternatively, declare a global Express namespace augmentation if you don't want to cast per-route:

```ts
import type { AccessTokenClaims } from "@monocloud/backend-node";
declare global {
  namespace Express {
    interface Request {
      claims?: AccessTokenClaims;
    }
  }
}
```

## Advanced: shared client, custom resolvers, caching

```ts
import {
  protectApi,
  MonoCloudBackendNodeClient,
  type AuthenticatedExpressRequest,
  type IIntrospectionCache,
} from "@monocloud/backend-node/express";

// Build a client explicitly when you need a cache or non-env config
const client = new MonoCloudBackendNodeClient({
  tenantDomain: "https://acme.us.monocloud.com",
  audience: "https://api.example.com",
  cache: redisCache, // your IIntrospectionCache implementation
  introspectionCacheDuration: 300, // seconds; caps every cache entry (0 disables caching)
  introspectJwtTokens: false,
  responseTimeout: 10000, // ms; bounds discovery / JWKS / introspection requests
  validateCertificateBinding: "required", // 'when_present' (default) | 'required' | 'dangerously_ignore'
});

const protect = protectApi(client, {
  // Pull token from somewhere other than Authorization: Bearer
  tokenResolver: async (req) => req.cookies.access_token,
  // Required whenever certificate binding is validated — the SDK never reads the cert off the request itself
  certificateResolver: async (req) => req.headers["x-client-cert"] as string,
});

app.get("/api/secure", protect(), (req, res) => {
  res.json((req as AuthenticatedExpressRequest).claims);
});
```

`IIntrospectionCache` interface (implement for Redis, in-memory, etc.):

```ts
interface IIntrospectionCache {
  get(token: string): Promise<AccessTokenClaims | null | undefined>;
  set(
    token: string,
    claims: AccessTokenClaims,
    expiresAt: number,
  ): Promise<void>;
  delete(token: string): Promise<void>;
}
```

Caching is keyed on the raw token string. Entries are written with `expiresAt = min(claims.exp, now() + introspectionCacheDuration)` (or `now() + introspectionCacheDuration` when the claims carry no `exp`), so `introspectionCacheDuration` — default `300` s — is the hard ceiling on any entry's life. On read, the validity check is `cached.exp > now() + clockSkew - clockTolerance`, i.e. a cached entry stays valid until `claims.exp + clockTolerance - clockSkew < now()`. With the defaults (`clockSkew: 0`, `clockTolerance: 60`) the cache will keep returning a claim for up to ~60 seconds **past** the token's `exp`. Lower `clockTolerance` (e.g. to `0`) for strict expiry; raise it for higher hit rates at the cost of accepting slightly-expired tokens. A cached `active: false` entry short-circuits differently: while its own `exp` is still in the future it throws `inactive_token` immediately — no `clockSkew`/`clockTolerance` grace, no re-introspection.

## JWT vs. introspection — how the SDK decides

- If the token has three dot-separated parts (`xxx.yyy.zzz`) **and** `introspectJwtTokens` is false (default): the SDK validates the JWT locally using JWKS fetched from the tenant. No network call per request after the JWKS cache warms.
- Otherwise (opaque tokens, or `introspectJwtTokens=true`): the SDK calls the OIDC introspection endpoint. Requires `clientId` + `clientSecret` (or another `clientAuthMethod`).

This means: **JWT tokens don't require client credentials.** Opaque tokens do. If you see `MonoCloudValidationError: Token introspection is not configured` when receiving opaque tokens, set the introspection env vars. A token requiring introspection now fails immediately when no `clientId` is configured, and the middleware surfaces this as **500**, not 401.

## Common pitfalls

1. **Wrong import path.** `protectApi` must be imported from `@monocloud/backend-node/express`, not the root. The root only exports the framework-agnostic `MonoCloudBackendNodeClient` class.
2. **Audience mismatch.** `MONOCLOUD_BACKEND_AUDIENCE` must exactly match the `aud` claim minted by your authorization server for this API. A trailing slash or http vs https difference will fail validation.
3. **Building the factory per request.** `protectApi()` is meant to be called **once** at startup. Calling it inside a route handler creates a new client per request and re-fetches the JWKS each time.
4. **Forgetting to install body-parser before protect.** `protect()` doesn't read the body, but if your route does, register body parsers normally. Order doesn't matter for the auth middleware.
5. **Calling `next()` after the auth middleware sent a 401/403.** The middleware sends the response synchronously on failure and doesn't call `next`. If you wrap it, check `res.headersSent`.
6. **Group claim missing.** If `groups` is set but the token doesn't carry the claim named by `MONOCLOUD_BACKEND_GROUPS_CLAIM` (or the default), the request is forbidden. Configure the claim in the MonoCloud dashboard or set `groupsClaim` explicitly.
7. **Local JWT validation suddenly hitting the network.** If you set `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true`, every JWT request also calls introspection. Usually unwanted; only enable if you specifically need server-side revocation checks.

## Onboarding checklist

1. `npm install @monocloud/backend-node`.
2. Add `MONOCLOUD_BACKEND_TENANT_DOMAIN` and `MONOCLOUD_BACKEND_AUDIENCE` to your env. If you'll accept opaque tokens, also add `MONOCLOUD_BACKEND_CLIENT_ID` and `MONOCLOUD_BACKEND_CLIENT_SECRET`.
3. Register an **API** (audience) in the MonoCloud dashboard matching `MONOCLOUD_BACKEND_AUDIENCE`.
4. Build the factory once: `const protect = protectApi();`
5. Apply per-route: `app.get('/path', protect({ scopes: [...] }), handler);`
6. Cast `req` to `AuthenticatedExpressRequest` inside handlers to read `claims`.

## Related types and errors

Re-exported from `@monocloud/auth-core` via `@monocloud/backend-node`:

- `AccessTokenClaims`, `JwtClaims`, `Jwk`, `Jwks`, `IssuerMetadata`, `ClientAuthMethod`, `CertificateBindingValidation`, `MonoCloudTokenErrorCode`
- `MonoCloudAuthBaseError`, `MonoCloudValidationError`, `MonoCloudOPError`, `MonoCloudHttpError`, `MonoCloudTokenError`

A failed scope/group check throws `MonoCloudTokenError` with `code` `'insufficient_scope'` or `'insufficient_groups'` (messages `'Token is missing required scopes'` / `'Token is missing required groups'`) — the middleware maps those two **codes** (not the message strings) to 403. The full `MonoCloudTokenErrorCode` union is `'invalid_token' | 'inactive_token' | 'insufficient_scope' | 'insufficient_groups'`; anything other than the two above becomes 401, including the new `'inactive_token'` raised when introspection returns `active: false`. `MonoCloudValidationError` and `MonoCloudOPError` now map to **500**, and a `MonoCloudHttpError` with no status / a 5xx / a 429 maps to **503**.

## Deeper reference

- `references/api-surface.md` — every export from `@monocloud/backend-node/express`, full type signatures, env-var → option mapping, defaults.
- `references/troubleshooting.md` — symptom → cause → fix index for the most common failure modes (audience mismatch, opaque-token introspection config, scope/group enforcement quirks, mTLS binding errors, JWKS thrash).
