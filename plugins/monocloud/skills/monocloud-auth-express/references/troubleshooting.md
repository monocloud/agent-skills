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
| `Client certificate is not present` | No certificate reached the validator — usually no `certificateResolver` wired, or it returned `undefined` |
| `Client certificate is malformed` | The resolved value is not valid base64 / PEM |
| `Access token does not contain a 'cnf' (confirmation) claim for certificate binding` | The token was not issued as certificate-bound |
| `Malformed 'cnf' claim for certificate binding` / `The 'cnf' claim could not be parsed` | `cnf` is not a JSON object |
| `The 'cnf' claim does not contain an 'x5t#S256' member specifying the certificate hash for binding` | `cnf` present but has no thumbprint |
| `The certificate hash in the access token does not match the presented client certificate (certificate binding validation failed)` | Wrong certificate presented |

There are no `mtls_binding_mismatch` / `certificate_thumbprint_mismatch` codes — every one of the above is a plain `MonoCloudTokenError` with `code: 'invalid_token'`, so the HTTP body is always the generic `{ "message": "unauthorized" }`.

**Cause:** The SDK compares the `cnf['x5t#S256']` thumbprint in the token against the SHA-256 hash of the presented client certificate. This check only runs when you pass `validateCertificateBinding: true`, and the certificate is only fetched from a `certificateResolver` you supply — **the SDK never reads the certificate off the request by itself**.

**Fix:** Terminate TLS in front of the Node process (nginx, ALB) **with client-cert forwarding**, then wire a `certificateResolver` so the SDK can see it:

```ts
const protect = protectApi({
  certificateResolver: async (req) => req.headers["x-client-cert"] as string,
});

app.get("/api/secure", protect({ validateCertificateBinding: true }), handler);
```

Without `certificateResolver`, `validateCertificateBinding: true` always fails with `Client certificate is not present`. If you don't use mTLS, don't set `validateCertificateBinding`.

## Boolean env vars silently ignored

**Symptom:** `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=1` doesn't flip group matching to AND. `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=yes` doesn't force introspection. The values appear in `process.env` but nothing changes.

**Cause:** The boolean coercion helper (`getBoolean` in `@monocloud/auth-core/internal`) only accepts the literal strings `true` or `false` (case-insensitive). Any other value (`1`, `0`, `yes`, `no`, `on`, `off`, empty string) returns `undefined` and falls back to the option default. There's no warning.

**Fix:** Use the exact strings `true` or `false`:

```
MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true
MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true
```

## App crashes at startup with `MonoCloudValidationError`

**Symptom:** `protectApi()` (or `new MonoCloudBackendNodeClient()`) throws at module load, before any request arrives — e.g. `MonoCloudValidationError: "tenantDomain" is required` or `MonoCloudValidationError: "audience" must be a valid uri`.

**Cause:** Configuration is validated eagerly when the client is constructed. `tenantDomain` and `audience` are both **required** and both must be **absolute URIs**, so a bare identifier such as `MONOCLOUD_BACKEND_AUDIENCE=my-api` is rejected even though it is a legal OAuth audience string. Only the first validation error is included in the thrown message, so fix them one at a time. This also fires when `protectApi()` runs before your `.env` file is loaded.

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

## Diagnostic

```bash
node skills/monocloud-auth-express/scripts/verify.js
```
