# Troubleshooting — `@monocloud/backend-node/express`

Quick reference for the most common things that go wrong when validating MonoCloud-issued access tokens in an Express API. Most issues fall into one of three buckets: **audience mismatch**, **token-format/introspection mis-config**, or **scope/group enforcement quirks**.

## 401 `invalid_audience`

**Symptom:** Every request fails with `WWW-Authenticate: Bearer error="invalid_token", error_description="aud"` or a JSON error mentioning the audience.

**Cause:** The token's `aud` claim doesn't match `MONOCLOUD_BACKEND_AUDIENCE`.

**Fix:**

1. Decode the token at [jwt.io](https://jwt.io) (or `node -e 'console.log(JSON.parse(Buffer.from(t.split(".")[1], "base64")))'`).
2. Compare the `aud` claim with the env value. It must match **exactly**, including scheme.
3. If the API resource you registered in MonoCloud has audience `https://api.example.com`, set `MONOCLOUD_BACKEND_AUDIENCE=https://api.example.com`. Common trailing-slash gotcha: `https://api.example.com/` ≠ `https://api.example.com`.

## 401 on opaque tokens but JWTs work fine

**Symptom:** Tokens shorter than ~150 chars (no dots) fail with "introspection failed" or "client credentials required."

**Cause:** Opaque (reference) tokens must be introspected, which requires `MONOCLOUD_BACKEND_CLIENT_ID` and `MONOCLOUD_BACKEND_CLIENT_SECRET`.

**Fix:** Set both env vars to a confidential client that has the introspection scope in the MonoCloud dashboard. If you don't issue opaque tokens, no action needed.

## Want to introspect every token (including JWTs)

**Symptom:** You need real-time revocation — local JWT validation is too "stale."

**Fix:** Set `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true`. The SDK will skip local JWKS validation and call introspection on every request. **Cost:** an extra network hop per request — set `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` and `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` to reasonable values, and consider caching the introspection result yourself if traffic is high.

## `req.claims is undefined` inside a route handler

**Symptom:** TypeScript: `Property 'claims' does not exist on type 'Request'`. At runtime: undefined access.

**Cause:** The handler doesn't import `AuthenticatedExpressRequest`, or `protect()` middleware isn't wired in front of the route.

**Fix:**

```ts
import {
  protectApi,
  type AuthenticatedExpressRequest,
} from "@monocloud/backend-node/express";

const protect = protectApi();

app.get("/api/me", protect(), (req, res) => {
  const { claims } = req as AuthenticatedExpressRequest;
  res.json({ sub: claims.sub });
});
```

Both pieces matter: `protect()` populates `claims`, and the cast tells TypeScript so.

## Wrong import path

**Symptom:** "Module not found" for `protectApi` or `AuthenticatedExpressRequest`.

**Cause:** Imported from the package root instead of the `/express` subpath.

**Fix:** Always import from `@monocloud/backend-node/express`, never from `@monocloud/backend-node`.

## Scopes are checked but the token does have them

**Symptom:** `protect({ scopes: ['posts:write'] })` returns 403, but the token's `scope` claim clearly contains `posts:write`.

**Cause:** Scope claims are space-separated in OIDC. The SDK splits them. If a custom claim name was used, the SDK won't find it.

**Fix:** The standard claim is `scope` (a string) or `scp` (sometimes an array). MonoCloud uses `scope`. If you've customized claim mapping, ensure the access token still carries scopes under `scope`. Decode the token and verify.

## Groups never match

**Symptom:** `protect({ groups: ['admin'] })` always returns 403 even for admin users.

**Cause:** The SDK doesn't know which claim carries groups. It defaults to no group check unless you tell it.

**Fix:** Set `MONOCLOUD_BACKEND_GROUPS_CLAIM=groups` (or whatever your custom claim is). Decode a token and inspect — the group memberships are usually under `groups` but can be customized per tenant.

If `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true`, **every** group in the call must match. By default any one match is enough.

## `protect()` rebuilt per request

**Symptom:** Slow first request, intermittent 5xx, "too many JWKS fetches" warnings.

**Cause:** Calling `protectApi()` inside a route handler instead of once at startup. Every call refetches discovery + JWKS.

**Fix:** Build it **once**, reuse the result:

```ts
const protect = protectApi(); // module scope or app startup

app.get('/a', protect(), ...);
app.get('/b', protect({ scopes: ['x'] }), ...);
```

## mTLS-bound tokens rejected

**Symptom:** Tokens that work elsewhere fail here with `mtls_binding_mismatch` or `certificate_thumbprint_mismatch`.

**Cause:** The token was issued with `tls_client_auth` or `self_signed_tls_client_auth`. The SDK checks that the client cert presented to this API matches the `cnf` (confirmation) claim in the token. Either no cert was presented, or it's the wrong one.

**Fix:** Terminate TLS in front of the Node process (nginx, ALB) **with client-cert forwarding**, then pass the certificate through to Node (via a header or `req.socket.getPeerCertificate()`). The SDK reads it from the request. If you don't use mTLS, this error shouldn't occur — verify the token issuer.

## Boolean env vars silently ignored

**Symptom:** `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=1` doesn't flip group matching to AND. `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=yes` doesn't force introspection. The values appear in `process.env` but nothing changes.

**Cause:** The boolean coercion helper (`getBoolean` in `@monocloud/auth-core/internal`) only accepts the literal strings `true` or `false` (case-insensitive). Any other value (`1`, `0`, `yes`, `no`, `on`, `off`, empty string) returns `undefined` and falls back to the option default. There's no warning.

**Fix:** Use the exact strings `true` or `false`:

```
MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true
MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true
```

## Tenant domain trailing slash

**Symptom:** `Failed to load OIDC metadata: 404`. Or signature verification fails on otherwise valid tokens.

**Cause:** `MONOCLOUD_BACKEND_TENANT_DOMAIN` ends with `/` or includes `/.well-known/...`.

**Fix:** Pass the bare tenant URL: `https://acme.us.monocloud.com`. The SDK appends `/.well-known/openid-configuration` itself.

## Diagnostic

```bash
node skills/monocloud-auth-express/scripts/verify.js
```
