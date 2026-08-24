# Troubleshooting — `@monocloud/backend-node/fastify`

Quick reference for the most common issues validating MonoCloud-issued access tokens in a Fastify API. Most issues fall into **audience mismatch**, **token-format/introspection mis-config**, or **scope/group enforcement quirks** — the same engine as the Express adapter.

## 401 on audience mismatch (`invalid_token`)

**Symptom:** Every request returns `401 { "message": "unauthorized" }` (with `WWW-Authenticate: Bearer error="invalid_token"`). The response body carries no `error_description` — decode the token to confirm it is the audience.

**Cause:** The token's `aud` claim doesn't match `MONOCLOUD_BACKEND_AUDIENCE`.

**Fix:** Decode the token, compare the `aud` claim with the env var exactly (no trailing slash). The API resource's audience in the MonoCloud dashboard must match the env value byte-for-byte.

## 500 / 503 on opaque tokens

**Symptom:** Reference (non-JWT) tokens fail. Missing introspection credentials now surface as `500 { "message": "internal server error" }` (`MonoCloudValidationError: Token introspection is not configured`); an introspection endpoint that rejects the client (`invalid_client`) or any other 4xx also surfaces as 500, while a network failure / 5xx / 429 from the endpoint surfaces as `503 { "message": "service unavailable" }`. (A genuinely inactive/invalid opaque token is still a 401.)

**Cause:** Opaque tokens require introspection. Without `MONOCLOUD_BACKEND_CLIENT_ID` + `MONOCLOUD_BACKEND_CLIENT_SECRET`, the SDK now fails immediately with a configuration error instead of a misleading 401.

**Fix:** Set both env vars to a confidential client that has the introspection scope. If you only issue JWTs, this won't apply.

## Forcing introspection on JWTs

To skip local JWKS validation and introspect every token (e.g. for real-time revocation):

```
MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true
MONOCLOUD_BACKEND_CLIENT_ID=...
MONOCLOUD_BACKEND_CLIENT_SECRET=...
```

This adds one network round-trip per request. Tune `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` / `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` if traffic is high.

## `request.claims is undefined`

**Symptom:** TypeScript complains, or `request.claims` is undefined at runtime.

**Cause:** Either `protect()` isn't wired as an `onRequest` hook, or the handler doesn't cast to `AuthenticatedFastifyRequest`.

**Fix:**

```ts
import {
  protectApi,
  type AuthenticatedFastifyRequest,
} from "@monocloud/backend-node/fastify";

const protect = protectApi();

fastify.get("/me", { onRequest: protect() }, async (request) => {
  const { claims } = request as AuthenticatedFastifyRequest;
  return { sub: claims.sub };
});
```

Both are required: the hook populates `claims`, the cast tells TypeScript.

## Wrong import path

**Symptom:** "Module not found" for `protectApi` / `AuthenticatedFastifyRequest`.

**Cause:** Imported from the package root rather than the `/fastify` subpath.

**Fix:** Always `from '@monocloud/backend-node/fastify'`.

## Trying to register it as a Fastify plugin

**Symptom:** `fastify.register(protectApi)` does nothing useful, or throws.

**Cause:** `protectApi()` is **not** a Fastify plugin. It returns a per-route `onRequest` hook factory.

**Fix:** Pass `protect()` inside the route options' `onRequest`:

```ts
fastify.get("/route", { onRequest: protect() }, handler);
```

For an app-wide guard, register the hook globally:

```ts
const protect = protectApi();
fastify.addHook("onRequest", protect());
```

…but be aware this protects **every** route including health checks — usually you want per-route protection instead.

## Scopes not enforced even though they're in the token

**Symptom:** `protect({ scopes: ['posts:write'] })` returns 403 despite the token containing the scope.

**Cause:** Scope claims are space-separated in the `scope` claim. MonoCloud uses `scope`. If you customized claim mapping, this may be missing.

**Fix:** Decode the token and confirm `scope` (string) is present with the expected values. Custom claim mapping must keep `scope` populated for the SDK to read it.

## Groups never match

**Symptom:** `protect({ groups: ['admin'] })` always 403s, even for admins.

**Cause:** The token doesn't carry group memberships under the claim name the SDK is reading. `groupsClaim` defaults to `groups` when `MONOCLOUD_BACKEND_GROUPS_CLAIM` is unset, so group checks are still enforced — they just read the `groups` claim, which your token may populate under a different name (or not at all).

**Fix:** Set `MONOCLOUD_BACKEND_GROUPS_CLAIM=groups` (or whatever your tenant uses). Decode a token and verify the claim name. If `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true`, every listed group must match (default is any).

## `protectApi()` called per request

**Symptom:** Slow first request, JWKS fetched repeatedly, occasional 5xx.

**Cause:** Building the factory inside a handler. `protectApi()` constructs a fresh `MonoCloudBackendNodeClient` on every call, and the discovery-metadata / JWKS caches live on the client instance — so each new client re-fetches the discovery document and JWKS on the first request it validates. Build it once.

**Fix:** Build at module scope or in your bootstrap function and reuse:

```ts
const protect = protectApi();
fastify.get('/a', { onRequest: protect() }, ...);
fastify.get('/b', { onRequest: protect({ scopes: ['x'] }) }, ...);
```

## mTLS certificate-binding errors

**Symptom:** Tokens that work in other clients fail with `401 { "message": "unauthorized" }` (`WWW-Authenticate: Bearer error="invalid_token"`). The underlying `MonoCloudTokenError` message is `The certificate hash in the access token does not match the presented client certificate (certificate binding validation failed)` — or `Client certificate is not present` when binding validation runs but no `certificateResolver` is wired. There is no `mtls_binding_mismatch` code; every binding failure is a plain `MonoCloudTokenError` with `code: 'invalid_token'`.

**Cause:** The token was issued with a `cnf` confirmation claim binding it to a specific client certificate. The cert presented to this API doesn't match.

**Fix:** Terminate TLS with client-cert forwarding (nginx, ALB, etc.) and route the cert into Fastify via `certificateResolver` so the SDK can compare its SHA-256 thumbprint to `cnf.x5t#S256`. If you don't issue mTLS-bound tokens, this error shouldn't appear — verify the issuing client config.

**Binding is now client-level, and on by default.** `validateCertificateBinding` moved off `protect(...)` onto the client (env `MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING`) and is a union, not a boolean:

| Mode | Behaviour |
| ---- | --------- |
| `when_present` (default) | Validates only when the token's `cnf` claim carries an `x5t#S256` thumbprint. |
| `required` | Always validates — a token **without** a `cnf` claim is rejected with `Access token does not contain a 'cnf' (confirmation) claim for certificate binding`. |
| `dangerously_ignore` | Never validates, even when the token carries a `cnf` claim. |

So a certificate-bound token that previously sailed through an unflagged route now fails with `Client certificate is not present` until a `certificateResolver` is wired. `protect({ validateCertificateBinding: true })` is a TypeScript error — delete it and set the mode on the client (or via `MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING`).

## Opaque token 401s with `inactive_token`

**Symptom:** An opaque (or force-introspected) token returns `401 { "message": "unauthorized" }`. The thrown error is `MonoCloudTokenError` with `code: 'inactive_token'` and message `Token is not active. The introspection endpoint returned active=false`.

**Cause:** The introspection endpoint reported `active: false` — the token was revoked, expired server-side, or was issued to a different client/audience.

**Fix:** Re-issue the token. Note the verdict is cached: with an `IIntrospectionCache` wired, an `{ active: false }` entry is stored for `MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION` seconds (default 300), so requests keep 401ing straight from cache (message `Token is not active. A cached introspection result reported active=false`) until the entry lapses. Lower the duration, set it to `0` to disable introspection caching, or `delete(token)` from your cache implementation.

## Requests hang, then 503 after ~10 seconds

**Symptom:** Against a slow or unreachable tenant, requests stall for about ten seconds and return `503 { "message": "service unavailable" }`. The underlying error is `MonoCloudHttpError: Request to <url> timed out after 10000ms`.

**Cause:** `responseTimeout` (env `MONOCLOUD_BACKEND_RESPONSE_TIMEOUT`, default `10000` ms) bounds the discovery, JWKS and introspection requests made while validating an access token. On elapse the request is aborted and the resulting `MonoCloudHttpError` carries no HTTP status, so `mapProtectError` returns 503.

**Fix:** Tune `MONOCLOUD_BACKEND_RESPONSE_TIMEOUT` to your latency budget. The minimum accepted value is `1000`; anything lower throws `MonoCloudValidationError` at startup.

## Boolean env vars silently ignored

**Symptom:** `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=1` doesn't flip group matching to AND. `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=yes` doesn't force introspection. The values appear in `process.env` but nothing changes.

**Cause:** The boolean coercion helper (`getBoolean` in `@monocloud/auth-core/internal`) only accepts the literal strings `true` or `false` (case-insensitive). Any other value (`1`, `0`, `yes`, `no`, `on`, `off`, empty string) returns `undefined` and falls back to the option default. There's no warning.

**Fix:** Use the exact strings `true` or `false`:

```
MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true
MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true
```

## `MonoCloudValidationError` thrown at startup

**Symptom:** The process dies as soon as `protectApi()` (or `new MonoCloudBackendNodeClient()`) runs, with a `MonoCloudValidationError` such as `"tenantDomain" is required`, `"audience" is required`, `"audience" must be a valid uri`, `"validateCertificateBinding" must be one of [when_present, required, dangerously_ignore]`, or `"responseTimeout" must be greater than or equal to 1000` — no request is ever served.

**Cause:** `protectApi()` constructs the client eagerly and options are validated immediately. `tenantDomain` and `audience` are both **required** and must be absolute URIs; a missing or non-URL value throws instead of degrading to a per-request 500.

**Fix:** Ensure `MONOCLOUD_BACKEND_TENANT_DOMAIN` and `MONOCLOUD_BACKEND_AUDIENCE` are full URLs (`https://acme.us.monocloud.com`, `https://api.example.com`) and are already in `process.env` **before** the module that calls `protectApi()` is imported — load the env file first (`node --env-file=.env`, `import 'dotenv/config'`, etc.).

## Tenant domain trailing slash

**Symptom:** Discovery 404s, or all tokens fail signature verification.

**Cause:** `MONOCLOUD_BACKEND_TENANT_DOMAIN` ends with `/` or includes `/.well-known/...`.

**Fix:** Pass the bare URL: `https://acme.us.monocloud.com`. The SDK appends the discovery path.

## Diagnostic

```bash
node skills/monocloud-auth-fastify/scripts/verify.js
```
