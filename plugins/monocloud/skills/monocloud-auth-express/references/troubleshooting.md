# Troubleshooting — `@monocloud/backend-node/express`

Quick reference for the most common things that go wrong when validating MonoCloud-issued access tokens in an Express API. Most issues fall into one of three buckets: **audience mismatch**, **token-format/introspection mis-config**, or **scope/group enforcement quirks**.

## 401 on audience mismatch (`invalid_token`)

**Symptom:** Every request fails with `401 { "message": "unauthorized" }` and a `WWW-Authenticate: Bearer error="invalid_token"` header. The mismatch is thrown internally as `MonoCloudTokenError('Invalid audience claim')`; the HTTP body is always the generic `{ "message": "unauthorized" }` (no `error_description`, no audience detail).

**Cause:** The token's `aud` claim doesn't match `MONOCLOUD_BACKEND_AUDIENCE`.

**Fix:**

1. Decode the token at [jwt.io](https://jwt.io) (or `node -e 'console.log(JSON.parse(Buffer.from(t.split(".")[1], "base64")))'`).
2. Compare the `aud` claim with the env value. It must match **exactly**, including scheme.
3. If the API resource you registered in MonoCloud has audience `https://api.example.com`, set `MONOCLOUD_BACKEND_AUDIENCE=https://api.example.com`. Common trailing-slash gotcha: `https://api.example.com/` ≠ `https://api.example.com`.

## 500/503 on opaque tokens but JWTs work fine

**Symptom:** Opaque (no-dot) tokens fail with `500 { "message": "internal server error" }` (missing or invalid introspection config) or `503 { "message": "service unavailable" }` (auth server unreachable), while JWTs validate locally.

**Cause:** Opaque (reference) tokens must be introspected, which requires `MONOCLOUD_BACKEND_CLIENT_ID` and `MONOCLOUD_BACKEND_CLIENT_SECRET`. With no `clientId`, validation now fails immediately with `MonoCloudValidationError: Token introspection is not configured` (→ 500). Wrong credentials make the OP return a 401 → `MonoCloudOPError('invalid_client')` (→ 500); an outage / 5xx / 429 → 503.

**Fix:** Set both env vars to a confidential client that has the introspection scope in the MonoCloud dashboard. If you don't issue opaque tokens, no action needed.

## Want to introspect every token (including JWTs)

**Symptom:** You need real-time revocation — local JWT validation is too "stale."

**Fix:** Set `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true`. The SDK will skip local JWKS validation and call introspection on every request. **Cost:** an extra network hop per request — set `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` and `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` to reasonable values, and pass an `IIntrospectionCache` to the client so results are reused for up to `MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION` seconds (default `300`; `0` disables caching). Mind the trade-off: caching blunts exactly the real-time revocation you turned introspection on for, so lower the duration — or leave the `cache` out — when freshness matters more than latency.

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

**Fix:** The SDK reads the token's `scope` claim **only** — a string split on whitespace. It does **not** fall back to an `scp` array claim, and there is no option to change the scope claim name (unlike groups, which have `MONOCLOUD_BACKEND_GROUPS_CLAIM`). Decode the token and confirm every required scope appears in the space-separated `scope` string; a single missing scope throws `MonoCloudTokenError('Token is missing required scopes', 'insufficient_scope')` → 403.

## Groups never match

**Symptom:** `protect({ groups: ['admin'] })` always returns 403 even for admin users.

**Cause:** By default the SDK looks for group memberships in the `groups` claim. If the token carries groups under a different claim name (or carries no matching claim at all), the check fails.

**Fix:** If your groups live under the default `groups` claim, no config is needed. If they live under a custom claim, set `MONOCLOUD_BACKEND_GROUPS_CLAIM=<your-claim>`. Decode a token and inspect — the group memberships default to `groups` but can be customized per tenant.

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

**Symptom:** Tokens that work elsewhere fail here with `401 { "message": "unauthorized" }` and `WWW-Authenticate: Bearer error="invalid_token"`. The underlying `MonoCloudTokenError` message is one of:

| Message | Meaning |
| --- | --- |
| `Client certificate is not present` | No certificate reached the validator — usually no `certificateResolver` wired, or it returned `undefined`. With the default `'when_present'` mode this now fires for any token carrying a `cnf` thumbprint; under `'required'` it fires for every token |
| `Client certificate is malformed` | The resolved value is not valid base64 / PEM |
| `Access token does not contain a 'cnf' (confirmation) claim for certificate binding` | The token was not issued as certificate-bound |
| `Malformed 'cnf' claim for certificate binding` / `The 'cnf' claim could not be parsed` | `cnf` is not a JSON object |
| `The 'cnf' claim does not contain an 'x5t#S256' member specifying the certificate hash for binding` | `cnf` present but has no thumbprint |
| `The certificate hash in the access token does not match the presented client certificate (certificate binding validation failed)` | Wrong certificate presented |

There are no `mtls_binding_mismatch` / `certificate_thumbprint_mismatch` codes — every one of the above is a plain `MonoCloudTokenError` with `code: 'invalid_token'`, so the HTTP body is always the generic `{ "message": "unauthorized" }`.

**Cause:** The SDK compares the `cnf['x5t#S256']` thumbprint in the token against the SHA-256 hash of the presented client certificate. Since 0.3.8 the check is driven by the **client-level** `validateCertificateBinding` mode (`MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING`), not a per-route flag, and it defaults to `'when_present'` — so a certificate-bound token (one whose `cnf` carries an `x5t#S256` thumbprint) is now validated **automatically**. The certificate is still only fetched from a `certificateResolver` you supply — **the SDK never reads the certificate off the request by itself** — so an app upgraded from an earlier version that never asked for binding validation can suddenly start failing with `Client certificate is not present`. Under `'required'` every token is checked, including ones with no `cnf` at all.

**Fix:** Terminate TLS in front of the Node process (nginx, ALB) **with client-cert forwarding**, then wire a `certificateResolver` so the SDK can see it:

```ts
import {
  protectApi,
  MonoCloudBackendNodeClient,
} from "@monocloud/backend-node/express";

const protect = protectApi(
  // 'when_present' is the default; use 'required' to reject tokens that aren't certificate-bound
  new MonoCloudBackendNodeClient({ validateCertificateBinding: "required" }),
  {
    certificateResolver: async (req) => req.headers["x-client-cert"] as string,
  },
);

app.get("/api/secure", protect(), handler);
```

Without a `certificateResolver`, every checked token fails with `Client certificate is not present` — always under `'required'`, and under the default `'when_present'` as soon as the token carries a `cnf` thumbprint. If your API must accept certificate-bound tokens without verifying the binding (for example TLS is terminated without client-cert forwarding), set `MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING=dangerously_ignore` — the name is a warning.

## Boolean env vars silently ignored

**Symptom:** `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=1` doesn't flip group matching to AND. `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=yes` doesn't force introspection. The values appear in `process.env` but nothing changes.

**Cause:** The boolean coercion helper (`getBoolean` in `@monocloud/auth-core/internal`) only accepts the literal strings `true` or `false` (case-insensitive). Any other value (`1`, `0`, `yes`, `no`, `on`, `off`, empty string) returns `undefined` and falls back to the option default. There's no warning.

**Fix:** Use the exact strings `true` or `false`:

```
MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true
MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true
```

`MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING` is **not** in this club — it is no longer a boolean. It takes `when_present` (default), `required`, or `dangerously_ignore`, and anything else — `true` / `false` included — is rejected by Joi and throws `MonoCloudValidationError` when the client is constructed instead of being silently ignored.

## App crashes at startup with `MonoCloudValidationError`

**Symptom:** `protectApi()` (or `new MonoCloudBackendNodeClient()`) throws at module load, before any request arrives — e.g. `MonoCloudValidationError: "tenantDomain" is required` or `MonoCloudValidationError: "audience" must be a valid uri`.

**Cause:** Configuration is validated eagerly when the client is constructed. `tenantDomain` and `audience` are both **required** and both must be **absolute URIs**, so a bare identifier such as `MONOCLOUD_BACKEND_AUDIENCE=my-api` is rejected even though it is a legal OAuth audience string. Only the first validation error is included in the thrown message, so fix them one at a time. This also fires when `protectApi()` runs before your `.env` file is loaded. The 0.3.8 options carry their own constraints and fail the same way: `validateCertificateBinding` must be `when_present` / `required` / `dangerously_ignore`, `responseTimeout` must be a number **≥ 1000** (milliseconds), and `introspectionCacheDuration` must be a number ≥ 0 (seconds).

**Fix:** Load env vars *before* the module that calls `protectApi()` (e.g. `import 'dotenv/config'` as the first import, or `node --env-file=.env`), and give both values a scheme:

```
MONOCLOUD_BACKEND_TENANT_DOMAIN=https://acme.us.monocloud.com
MONOCLOUD_BACKEND_AUDIENCE=https://api.example.com
```

## Metadata 404, or `Invalid Issuer` on otherwise valid tokens

**Symptom:** Every request fails with `500 { "message": "internal server error" }`, the underlying error being `MonoCloudHttpError: Error while fetching metadata. Unexpected status code: 404`. Or tokens fail with `401` and an internal `MonoCloudTokenError('Invalid Issuer')`.

**Cause:** `MONOCLOUD_BACKEND_TENANT_DOMAIN` points at the wrong URL. Note what the SDK *does* normalize: it strips a single trailing `/`, so `https://acme.us.monocloud.com/` is **not** a problem. What does break things is putting a path on the value (e.g. `.../.well-known/openid-configuration`) — the SDK appends the discovery path itself — or pointing at a host that isn't the token's issuer.

`Invalid Issuer` is a strict string comparison of the token's `iss` claim against the normalized tenant domain, so the two must be the same host (this is separate from the `aud`/`MONOCLOUD_BACKEND_AUDIENCE` check above).

**Fix:** Pass the bare tenant origin — `MONOCLOUD_BACKEND_TENANT_DOMAIN=https://acme.us.monocloud.com` — and confirm it equals the `iss` claim of a decoded token. Confirm `https://<tenant-domain>/.well-known/openid-configuration` returns 200 with `curl`. The value must parse as an absolute URI (Joi `uri()`), so a bare host with no scheme is rejected at startup — see the `MonoCloudValidationError` section above.

## Every request 503s after ~10 seconds

**Symptom:** Under a slow network or a degraded authorization server, requests hang for about ten seconds and then return `503 { "message": "service unavailable" }`.

**Cause:** `responseTimeout` (default `10000` ms, env `MONOCLOUD_BACKEND_RESPONSE_TIMEOUT`) bounds the discovery, JWKS and introspection requests made while validating an access token. When it elapses the request is aborted and a `MonoCloudHttpError: Request to <url> timed out after 10000ms` is thrown with **no** status, which `mapProtectError` maps to 503.

**Fix:** Raise `MONOCLOUD_BACKEND_RESPONSE_TIMEOUT` (minimum `1000`) if your OP is legitimately slow, or lower it to fail fast. Cutting round-trips helps more: keep `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` / `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` generous, and supply an `IIntrospectionCache` when you validate opaque tokens.

## A revoked token keeps working (or a rejected one keeps failing) for a few minutes

**Symptom:** After revoking a token the API still accepts it, or a token that was inactive keeps returning 401 after it was reinstated — both for up to five minutes.

**Cause:** When an `IIntrospectionCache` is configured, introspection results are cached as soon as they return, until `min(claims.exp, now() + introspectionCacheDuration)`; `introspectionCacheDuration` defaults to `300` seconds. `active: false` verdicts are cached too and replayed as `MonoCloudTokenError('Token is not active. A cached introspection result reported active=false', 'inactive_token')` → 401 without contacting the OP.

**Fix:** Lower `MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION`, set it to `0` to disable caching entirely, or `delete(token)` from your cache implementation on revocation. Scope, group and certificate-binding checks always run per route against the cached claims, so they are never the cause here.

## Diagnostic

```bash
node skills/monocloud-auth-express/scripts/verify.js
```
