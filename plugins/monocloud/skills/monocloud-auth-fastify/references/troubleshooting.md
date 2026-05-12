# Troubleshooting — `@monocloud/backend-node/fastify`

Quick reference for the most common issues validating MonoCloud-issued access tokens in a Fastify API. Most issues fall into **audience mismatch**, **token-format/introspection mis-config**, or **scope/group enforcement quirks** — the same engine as the Express adapter.

## 401 `invalid_audience`

**Symptom:** Every request returns 401 with `error_description` mentioning the audience.

**Cause:** The token's `aud` claim doesn't match `MONOCLOUD_BACKEND_AUDIENCE`.

**Fix:** Decode the token, compare the `aud` claim with the env var exactly (no trailing slash). The API resource's audience in the MonoCloud dashboard must match the env value byte-for-byte.

## 401 on opaque tokens

**Symptom:** Reference (non-JWT) tokens fail with "introspection failed" or "client credentials required."

**Cause:** Opaque tokens require introspection. Without `MONOCLOUD_BACKEND_CLIENT_ID` + `MONOCLOUD_BACKEND_CLIENT_SECRET`, the SDK can't introspect.

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

**Cause:** `MONOCLOUD_BACKEND_GROUPS_CLAIM` isn't set. The SDK doesn't enforce group checks without it.

**Fix:** Set `MONOCLOUD_BACKEND_GROUPS_CLAIM=groups` (or whatever your tenant uses). Decode a token and verify the claim name. If `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true`, every listed group must match (default is any).

## `protectApi()` called per request

**Symptom:** Slow first request, JWKS fetched repeatedly, occasional 5xx.

**Cause:** Building the factory inside a handler. `protectApi()` triggers OIDC discovery + JWKS fetch — do it once.

**Fix:** Build at module scope or in your bootstrap function and reuse:

```ts
const protect = protectApi();
fastify.get('/a', { onRequest: protect() }, ...);
fastify.get('/b', { onRequest: protect({ scopes: ['x'] }) }, ...);
```

## mTLS certificate-binding errors

**Symptom:** Tokens that work in other clients fail with `mtls_binding_mismatch`.

**Cause:** The token was issued with a `cnf` confirmation claim binding it to a specific client certificate. The cert presented to this API doesn't match.

**Fix:** Terminate TLS with client-cert forwarding (nginx, ALB, etc.) and route the cert into Fastify so the SDK can compare its SHA-256 thumbprint to `cnf.x5t#S256`. If you don't issue mTLS-bound tokens, this error shouldn't appear — verify the issuing client config.

## Boolean env vars silently ignored

**Symptom:** `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=1` doesn't flip group matching to AND. `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=yes` doesn't force introspection. The values appear in `process.env` but nothing changes.

**Cause:** The boolean coercion helper (`getBoolean` in `@monocloud/auth-core/internal`) only accepts the literal strings `true` or `false` (case-insensitive). Any other value (`1`, `0`, `yes`, `no`, `on`, `off`, empty string) returns `undefined` and falls back to the option default. There's no warning.

**Fix:** Use the exact strings `true` or `false`:

```
MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true
MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true
```

## Tenant domain trailing slash

**Symptom:** Discovery 404s, or all tokens fail signature verification.

**Cause:** `MONOCLOUD_BACKEND_TENANT_DOMAIN` ends with `/` or includes `/.well-known/...`.

**Fix:** Pass the bare URL: `https://acme.us.monocloud.com`. The SDK appends the discovery path.

## Diagnostic

```bash
node skills/monocloud-auth-fastify/scripts/verify.js
```
