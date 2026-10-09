# Troubleshooting — `@monocloud/backend-node/express`

`protectApi()` answers every failure with a generic body (`{"message":"unauthorized"}`, …) and never logs or returns the cause. Reproduce with the client first.

## Find the real error

```js
// debug-token.mjs — run: node --env-file=.env debug-token.mjs "<access token>"
import { MonoCloudBackendNodeClient } from "@monocloud/backend-node";

const client = new MonoCloudBackendNodeClient(); // same MONOCLOUD_BACKEND_* env as the app
try {
  console.log(await client.validateAccessToken(process.argv[2] /* , { scopes: [...], groups: [...] } */));
} catch (e) {
  console.error(e.constructor.name, e.code ?? "", e.message);
}
```

Decode a JWT without verifying it, then compare `iss`, `aud`, `exp`, `scope`, groups and `cnf` with your configuration:

```bash
node -e 'console.log(JSON.parse(Buffer.from(process.argv[1].split(".")[1], "base64url")))' "$TOKEN"
```

Static checks of a project: `node scripts/verify.js /path/to/app` from the skill directory ([verify.js](../scripts/verify.js)).

## Error message index

| Message | Class / code | Status | Meaning → fix |
| --- | --- | --- | --- |
| `Invalid audience claim` | `MonoCloudTokenError` | 401 | `aud` lacks `MONOCLOUD_BACKEND_AUDIENCE` → [audience / issuer](#401-on-every-request-audience-or-issuer) |
| `Invalid Issuer` | `MonoCloudTokenError` | 401 | `iss` ≠ tenant domain → [audience / issuer](#401-on-every-request-audience-or-issuer) |
| `Unexpected "exp" (expiration time) claim value, timestamp is <= now()` | `MonoCloudTokenError` | 401 | Expired beyond `clockTolerance` → new token; check the server clock |
| `Unexpected "nbf" (not before) claim value, timestamp is > now()` | `MonoCloudTokenError` | 401 | Server clock behind → sync it or set `MONOCLOUD_BACKEND_CLOCK_SKEW` |
| `Unexpected "exp" (expiration time) claim type`, `Unexpected "nbf" (not before) claim type`, `Invalid subject` | `MonoCloudTokenError` | 401 | Malformed claims |
| `JWT signature verification failed` | `MonoCloudTokenError` | 401 | Not signed by this tenant's keys (other tenant, tampered token) |
| `Failed to parse JWT Header`, `Failed to parse JWT Payload` | `MonoCloudTokenError` | 401 | Segment is not base64url-encoded UTF-8 JSON (truncated or not a JWT) |
| `JWT Header must be a top level object`, `JWT Payload must be a top level object` | `MonoCloudTokenError` | 401 | Segment is JSON but not an object |
| `Unexpected JWT "crit" header parameter` | `MonoCloudTokenError` | 401 | `crit` headers are not supported |
| `Token is not active. The introspection endpoint returned active=false` | `MonoCloudTokenError` `inactive_token` | 401 | Revoked, expired or not issued for this API |
| `Token is not active. A cached introspection result reported active=false` | `MonoCloudTokenError` `inactive_token` | 401 | Cached negative verdict → [caching](#revoked-token-still-accepted-or-reinstated-token-still-rejected) |
| `Client certificate is not present` and the other binding messages | `MonoCloudTokenError` | 401 | → [certificate binding](#certificate-bound-tokens-rejected) |
| `Token is missing required scopes` | `MonoCloudTokenError` `insufficient_scope` | 403 | → [scopes / groups](#403-although-the-token-has-the-scope-or-group) |
| `Token is missing required groups` | `MonoCloudTokenError` `insufficient_groups` | 403 | → [scopes / groups](#403-although-the-token-has-the-scope-or-group) |
| `unsupported JWS "alg" identifier` | plain `Error` | 401 | Token not signed with `RS*` / `PS*` / `ES*` (e.g. `HS256`, `none`) |
| `error when selecting a JWT verification key, multiple applicable keys found, a "kid" JWT Header Parameter is required` | plain `Error` | 401 | Zero or several cached JWKS keys match the token's `kid` / `alg` → [key change](#valid-jwts-rejected-after-a-signing-key-change) |
| `Invalid Client Authentication Method`, `unsupported JWS algorithm` | plain `Error` | 401 | Introspection client auth misconfigured → [opaque tokens](#opaque-tokens-fail-jwts-work) |
| `Token introspection is not configured` | `MonoCloudValidationError` | 500 | Opaque token (or `INTROSPECT_JWT_TOKENS=true`) without `MONOCLOUD_BACKEND_CLIENT_ID` |
| `introspection_endpoint endpoint is required but not available in the issuer metadata` (also `jwks_uri …`) | `MonoCloudValidationError` | 500 | Discovery document (or your `metadataResolver`) lacks it |
| `mTLS introspection_endpoint is required but not available in the issuer metadata` (or `… for trust store '<id>' …`) | `MonoCloudValidationError` | 500 | mTLS auth method without a matching alias → check `MONOCLOUD_BACKEND_TRUST_STORE_ID` |
| `invalid_client` (or another OAuth `error`) | `MonoCloudOPError` | 500 | Introspection rejected the client credentials / auth method |
| `Error while fetching metadata. Unexpected status code: 404` | `MonoCloudHttpError` | 500 | Wrong tenant domain → [audience / issuer](#401-on-every-request-audience-or-issuer) |
| `Error while performing token introspection. Unexpected status code: <n>`, `Error while fetching JWKS. Unexpected status code: <n>` | `MonoCloudHttpError` | 503 (5xx, 429) / 500 | Authorization server error |
| `Request to <url> timed out after <ms>ms`, network errors (e.g. `fetch failed`) | `MonoCloudHttpError` (no status) | 503 | → [503](#503-service-unavailable) |
| `Access token must be a valid non-empty string` | `MonoCloudValidationError` | — | Empty token passed to `validateAccessToken` directly |

Errors thrown while constructing the client: [startup crash](#app-crashes-at-startup-with-monocloudvalidationerror).

## 401 on every request: audience or issuer

- `aud` (string or array) must contain `MONOCLOUD_BACKEND_AUDIENCE` exactly — scheme, host, path and trailing slash included. Use the API's **Audience** from the dashboard and request tokens for it (`resource=<audience>` on the token request).
- `iss` must equal `MONOCLOUD_BACKEND_TENANT_DOMAIN` after normalization: one trailing `/` is removed and `https://` is prepended to any value not starting with `https://` (so an `http://` value never matches). Use the bare origin, e.g. `https://acme.us.monocloud.com`.
- A path on the tenant domain (such as `/.well-known/openid-configuration`, which the SDK appends itself) breaks discovery → 500, `Error while fetching metadata. Unexpected status code: 404`.

## App crashes at startup with `MonoCloudValidationError`

`protectApi()` / `new MonoCloudBackendNodeClient()` validates configuration immediately and throws the first problem:

| Message | Fix |
| --- | --- |
| `"tenantDomain" is required`, `"audience" is required` | Env not loaded yet — `import "dotenv/config"` before any module that calls `protectApi()`, or `node --env-file=.env` |
| `"tenantDomain" must be a valid uri`, `"audience" must be a valid uri` | Include the scheme: `https://acme.us.monocloud.com`, `https://api.example.com` |
| `"<option>" is not allowed to be empty` | Blank line such as `MONOCLOUD_BACKEND_CLIENT_ID=` — remove it or set a value |
| `"clientAuthMethod" must be one of [...]` | Exact lower-case method name |
| `"validateCertificateBinding" must be one of [when_present, required, dangerously_ignore]` | A mode, not a boolean; lower-case |
| `"responseTimeout" must be greater than or equal to 1000` | Milliseconds, at least `1000` |
| `"<duration or clock option>" must be greater than or equal to 0` | No negative values |
| `clientSecret must be a valid JWK when clientAuthMethod is 'private_key_jwt'` | Secret must be the private JWK (JSON with `kty`) |
| `"clientSecret" must be a string` | A JWK is accepted only with `private_key_jwt` |
| `"cache.<name>" is not allowed`, `"cache.get" is required` | `cache` must be an object with exactly `get` / `set` / `delete` |

## Opaque tokens fail, JWTs work

Opaque tokens — and every token when `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true` — are introspected:

- **500, `Token introspection is not configured`** — set `MONOCLOUD_BACKEND_CLIENT_ID` and `MONOCLOUD_BACKEND_CLIENT_SECRET` (the API client's credentials).
- **500, `MonoCloudOPError` `invalid_client`** — wrong secret, or `MONOCLOUD_BACKEND_CLIENT_AUTH_METHOD` doesn't match how the client is configured.
- **401 for every opaque token, `Invalid Client Authentication Method`** — `client_secret_jwt` / `spiffe_jwt` without a string secret, or `private_key_jwt` without a usable JWK (`unsupported JWS algorithm` when the JWK has no supported `alg`).
- **mTLS client auth** (`tls_client_auth`, `self_signed_tls_client_auth`, `spiffe_x509`) — needs the mTLS endpoint alias in discovery (500 if missing; check `MONOCLOUD_BACKEND_TRUST_STORE_ID`) and a `fetcher` that presents your client certificate; the SDK sends only `client_id`.
- **503** — the introspection endpoint is unreachable, timed out, or returned 5xx / 429.

## 403 although the token has the scope or group

- **Scopes** — only the space-separated `scope` string claim is read, and every listed scope must be present (exact, case-sensitive). There is no `scp` fallback and no option to rename the claim.
- **Groups** — read from `MONOCLOUD_BACKEND_GROUPS_CLAIM` (default `groups`), which must be an array of strings or `{ id, name }` objects. One match is enough unless `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL=true`. A missing claim means 403.
- Both send `{"message":"forbidden"}` with `WWW-Authenticate: Bearer error="insufficient_scope"`.

## Certificate-bound tokens rejected

401 (`invalid_token`) with one of:

| Message | Cause |
| --- | --- |
| `Client certificate is not present` | No `certificateResolver`, or it returned nothing |
| `Client certificate is malformed` | Not PEM / base64 DER — often a URL-encoded PEM from a proxy header |
| `Access token does not contain a 'cnf' (confirmation) claim for certificate binding` | Mode `required`, token not certificate-bound |
| `The 'cnf' claim could not be parsed` | `cnf` is not a JSON object (e.g. a JSON-encoded string or an array) |
| `The 'cnf' claim does not contain an 'x5t#S256' member specifying the certificate hash for binding` | `cnf` has no usable thumbprint |
| `The certificate hash in the access token does not match the presented client certificate (certificate binding validation failed)` | Different certificate than the one the token was issued to |

- The default `when_present` checks every token whose `cnf` carries `x5t#S256` — on every route — so wire `certificateResolver` wherever such tokens arrive.
- The resolver is the only certificate source. Return PEM (with or without `BEGIN` / `END` lines) or base64 DER; `decodeURIComponent` URL-encoded proxy headers; read only a header your TLS-terminating proxy sets and strips from incoming requests (otherwise callers can supply any certificate).
- To accept bound tokens without checking (e.g. TLS terminates without client-certificate forwarding): `MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING=dangerously_ignore` — this gives up the protection binding provides.
- `protect()` has no certificate options; set the mode on the client (or env).

## Revoked token still accepted, or reinstated token still rejected

- Locally validated JWTs stay valid until `exp` (+ `clockTolerance`); revocation is only seen through introspection (`MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS=true`).
- With a `cache`, introspection results — including `active: false` verdicts — are reused until their `expiresAt`: at most `MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION` seconds (default `300`), never past the token's `exp` if your store honors `expiresAt`. Lower the duration, set `0` to disable caching, or `delete(token)` from your cache on revocation. Scope, group and binding checks always run on cached claims.

## Every opaque token gets 401 after adding a cache

Errors thrown by `get` / `set` propagate and become 401. Typical causes: a class instance with `#private` fields (the client keeps a shallow copy, which lacks them) or the cache backend being down. Use an object literal and catch errors inside `get` / `set` (return `undefined` on failure).

## 503 service unavailable

Discovery, JWKS and introspection requests abort after `MONOCLOUD_BACKEND_RESPONSE_TIMEOUT` ms (default `10000`), giving a `MonoCloudHttpError` without status → 503; network errors, 5xx and 429 do the same. Raise the timeout (minimum `1000`) on slow networks or lower it to fail fast; keep `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` / `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` generous and add a `cache` for opaque tokens. A custom `fetcher` must pass `init.signal` through or the timeout cannot abort it.

## Valid JWTs rejected after a signing-key change

The JWKS is cached for `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` seconds (default `300`) and is **not** refetched when a token's `kid` is unknown; until it expires those tokens fail with `error when selecting a JWT verification key…` (401). Wait for the cache to expire, lower the duration, or restart.

## Requests hang, or routes are unexpectedly public

- **Hang** — the factory was passed instead of the middleware (`app.use(protect)`, `app.get(path, protect, handler)`); use `protect()`.
- **Public by accident** — `app.use(protect())` covers only routes registered after it.
- **Exempting paths** — wrap the middleware: `const guard = protect(); app.use((req, res, next) => (req.path === "/health" ? next() : guard(req, res, next)));`
- **CORS** — browser preflight `OPTIONS` requests carry no token, so a global `protect()` answers 401; register `cors()` before it.
- **Cookie tokens** — `req.cookies` is filled only by `cookie-parser`; without it a cookie `tokenResolver` finds nothing (or throws, giving 401).
- **Slow / repeated discovery** — `protectApi()` called per request builds a new client each time; create it once at startup.

## `req.claims` is undefined or untyped

- It is set only after `protect()` succeeded for that request — it is absent on unprotected routes.
- TypeScript: cast with `AuthenticatedExpressRequest` (from `@monocloud/backend-node/express`) or add the `Express.Request` augmentation shown in SKILL.md.

## A setting has no effect

- Booleans accept only `true` / `false` — `1`, `yes`, `on` are ignored.
- Numbers go through `parseInt`: non-numeric values are ignored and `"10s"` reads as `10`.
- Misspelled names are ignored — see the [option ↔ env var table](api-surface.md#options--monocloudbackendnodeclientoptions). `MONOCLOUD_AUTH_*` variables configure the sign-in SDKs, not this one.
- Constructor options beat env vars, and `protectApi({...})` ignores client options — pass a `MonoCloudBackendNodeClient` instead.
