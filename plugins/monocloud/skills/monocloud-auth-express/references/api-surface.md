# API surface — `@monocloud/backend-node/express`

Every export available from the Express subpath, verified against `packages/node-backend/src/frameworks/express/index.ts` and re-exports.

## Quick reference

The surface most apps actually reach for — full signatures and types follow below.

- `protectApi(options?)` / `protectApi(client, options?)` — returns a `ProtectMiddleware` factory; call it per route with `ProtectOptions` (`scopes`, `groups`). Certificate binding is configured once on the client (`validateCertificateBinding`), not per route.
- `AuthenticatedExpressRequest` — cast `req` after `protectApi` to read `req.claims`.
- `MonoCloudBackendNodeClient` — use when you need a shared instance or call `validateAccessToken` directly.
- Errors: `MonoCloudTokenError` (→ 401 by default, → 403 when `code` is `insufficient_scope`/`insufficient_groups`), `MonoCloudValidationError` and `MonoCloudOPError` (→ 500), `MonoCloudHttpError` (→ 503 when status is undefined / ≥500 / 429, else 500).

## Imports — what comes from where

```ts
// Everything below is importable from this subpath:
import { ... } from '@monocloud/backend-node/express';
```

The root `@monocloud/backend-node` exports the shared types and the client class, but **not** `protectApi` (that lives in the framework subpaths). The root is also the only entry point that exports `MtlsEndpointAliases` — import that one type from `@monocloud/backend-node`, not from `/express`.

The package also ships two helper subpaths that re-export from `@monocloud/auth-core`:

- `@monocloud/backend-node/utils` — re-exports `@monocloud/auth-core/utils` (e.g. `isUserInGroup`, `parseCallbackParams`, `generateState`, `generatePKCE`, `generateNonce`, plus session/state encryption helpers). The one most relevant to bearer-token APIs is `isUserInGroup` — useful when you want to re-check membership outside the middleware, or build custom guards.
- `@monocloud/backend-node/internal` — re-exports `@monocloud/auth-core/internal` (e.g. `getBoolean` and other coercion helpers). Most apps will not need this; reach for it only when probing edge cases.

## Functions

### `protectApi`

Two overloads. Both return a factory that you then call per-route with `ProtectOptions` to get an Express `RequestHandler`.

```ts
function protectApi(
  options?: ProtectApiRequestOptions<Request>,
): ProtectMiddleware;

function protectApi(
  client: MonoCloudBackendNodeClient,
  options?: ProtectApiRequestOptions<Request>,
): ProtectMiddleware;

type ProtectMiddleware = (options?: ProtectOptions) => RequestHandler;
```

Without a `client`, `protectApi()` constructs a `MonoCloudBackendNodeClient` from the `MONOCLOUD_BACKEND_*` environment variables **eagerly, at the moment `protectApi()` is called** — not lazily on the first request. Missing or invalid configuration therefore throws `MonoCloudValidationError` at startup rather than per request. (Discovery metadata and the JWKS are still fetched lazily, on the first token validation.)

## Types — framework-specific

### `AuthenticatedExpressRequest`

```ts
type AuthenticatedExpressRequest = Request & {
  claims: AccessTokenClaims;
};
```

Cast `req` to this inside protected handlers to access `req.claims`.

### `ProtectMiddleware`

```ts
type ProtectMiddleware = (options?: ProtectOptions) => RequestHandler;
```

The factory that `protectApi()` returns.

## Types — shared (also re-exported)

### `ProtectApiRequestOptions<T>`

Passed to `protectApi()` itself (controls token/cert extraction across all routes).

```ts
interface ProtectApiRequestOptions<T> {
  tokenResolver?: TokenResolver<T>;             // overrides default Authorization: Bearer extraction; the returned token is trimmed before validation
  certificateResolver?: ClientCertificateResolver<T>;
}

type TokenResolver<T> = (req: T) => Promise<string | undefined>;
type ClientCertificateResolver<T> = (req: T) => Promise<string | undefined>;
```

### `ProtectOptions`

Passed to each per-route call of the factory.

```ts
// Declared as Omit<ValidateAccessTokenOptions, 'clientCertificate'>
interface ProtectOptions {
  scopes?: string[];                    // AND — token must carry all
  groups?: string[];                    // OR by default (matchAll flips)
}
```

That is the whole per-route surface. The client certificate comes from the `certificateResolver` passed to `protectApi()`, and the certificate-binding **mode** comes from the client's `validateCertificateBinding` option — neither can be overridden per route.

### `MonoCloudBackendNodeClientOptions`

Constructor options for `MonoCloudBackendNodeClient`. Inherits from `MonoCloudOidcBackendClientOptions`.

```ts
interface MonoCloudBackendNodeClientOptions {
  tenantDomain: string;                // required (or env MONOCLOUD_BACKEND_TENANT_DOMAIN)
  audience: string;                    // required (or env MONOCLOUD_BACKEND_AUDIENCE)
  clientId?: string;                   // required for introspection
  clientSecret?: string | Jwk;         // JSON-string JWK required when clientAuthMethod is 'private_key_jwt'
  clientAuthMethod?: ClientAuthMethod; // default 'client_secret_post'
  trustStoreId?: string;               // mTLS: selects trust store from mtls_additional_endpoint_aliases
  metadataResolver?: () => IssuerMetadata | Promise<IssuerMetadata>; // supply issuer metadata out-of-band
  jwksResolver?: () => Jwks | Promise<Jwks>;                         // supply JWKS out-of-band
  groupOptions?: { groupsClaim?: string; matchAll?: boolean };
  clockSkew?: number;                  // default 0
  clockTolerance?: number;             // default 60 (seconds)
  jwksCacheDuration?: number;          // seconds
  metadataCacheDuration?: number;      // seconds
  introspectJwtTokens?: boolean;       // default false — force introspection for JWTs
  validateCertificateBinding?: CertificateBindingValidation; // default 'when_present'
  introspectionCacheDuration?: number; // seconds, default 300 — caps cache entries; 0 disables caching
  responseTimeout?: number;            // ms, default 10000, min 1000 — aborts discovery/JWKS/introspection requests
  cache?: IIntrospectionCache;          // constructor-only introspection-results cache
  fetcher?: typeof fetch;              // i.e. (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

type CertificateBindingValidation =
  | 'when_present'        // default — validate only when the token's cnf claim carries an x5t#S256 thumbprint
  | 'required'            // always validate, rejecting tokens without a cnf claim
  | 'dangerously_ignore'; // never validate, even when the token carries a cnf claim

type ClientAuthMethod =
  | 'client_secret_basic'
  | 'client_secret_post'
  | 'client_secret_jwt'
  | 'private_key_jwt'
  | 'tls_client_auth'
  | 'self_signed_tls_client_auth'
  | 'spiffe_jwt'
  | 'spiffe_x509';
```

mTLS endpoint aliases (RFC 8705): when `clientAuthMethod` is `tls_client_auth`, `self_signed_tls_client_auth`, or `spiffe_x509`, the token / introspection / revocation / device-authorization / PAR endpoints are resolved from `mtls_endpoint_aliases` in the issuer metadata (or from `mtls_additional_endpoint_aliases[trustStoreId]` when `trustStoreId` is set). If no matching alias is published, a `MonoCloudValidationError` is thrown — there is no silent fallback to the non-mTLS endpoint.

### `ValidateAccessTokenOptions`

Used when calling `client.validateAccessToken()` directly.

```ts
// Declared as Omit<IntrospectOptions, 'validateCertificateBinding'>
interface ValidateAccessTokenOptions {
  scopes?: string[];
  groups?: string[];
  clientCertificate?: string;          // PEM, optionally without BEGIN/END delimiters
}
```

The `Omit` is deliberate: `validateCertificateBinding` cannot be overridden per call on `MonoCloudBackendNodeClient` — the client-level mode is applied to both the JWT and the introspection path. The parent class's own `IntrospectOptions` / `ValidateJwtAccessTokenOptions` do still accept `validateCertificateBinding` per call.

### `IIntrospectionCache`

Implement for Redis, in-memory, etc. Only introspection results are cached (opaque tokens, and JWTs when `introspectJwtTokens` is `true`); locally-validated JWTs are never cached. The client keys on the raw token string and writes each entry with `expiresAt = min(claims.exp, now() + introspectionCacheDuration)` (default `300` s), so no entry outlives `introspectionCacheDuration`. `active: false` verdicts are cached as well (for `introspectionCacheDuration` seconds) and replayed as `MonoCloudTokenError(…, 'inactive_token')` without re-introspecting. When `introspectionCacheDuration` is `0`, the cache is neither read nor written.

```ts
interface IIntrospectionCache {
  get(key: string): Promise<AccessTokenClaims | null | undefined>;
  set(key: string, claims: AccessTokenClaims, expiresAt: number): Promise<void>;
  delete(key: string): Promise<void>;
}
```

## Class

### `MonoCloudBackendNodeClient`

Framework-agnostic; useful if you want full control or a shared instance across multiple `protectApi()` calls.

```ts
class MonoCloudBackendNodeClient extends MonoCloudOidcBackendClient {
  constructor(options?: Partial<MonoCloudBackendNodeClientOptions>);

  // Auto-detects JWT (3 segments) vs opaque and dispatches. Caches introspection results if an IIntrospectionCache is set.
  validateAccessToken(
    token: string,
    options?: ValidateAccessTokenOptions,
  ): Promise<AccessTokenClaims>;

  // Inherited from MonoCloudOidcBackendClient:
  introspectAccessToken(token: string, options?: IntrospectOptions): Promise<AccessTokenClaims>;
  validateJwtAccessToken(token: string, options?: ValidateJwtAccessTokenOptions): Promise<AccessTokenClaims>;
  setClockSkew(seconds: number): void;
  setClockTolerance(seconds: number): void;

  // Inherited from MonoCloudOidcClientBase:
  getMetadata(forceRefresh?: boolean): Promise<IssuerMetadata>;
  getJwks(forceRefresh?: boolean): Promise<Jwks>;
}
```

`MonoCloudOidcBackendClient` (the parent class) is also re-exported from this subpath for advanced cases — for example, when you want the OIDC token-validation primitives without MonoCloud-specific defaults. Most apps should reach for `MonoCloudBackendNodeClient` instead.

```ts
class MonoCloudOidcBackendClient {
  constructor(
    tenantDomain: string,                // positional
    audience: string,                    // positional — NOT inside options like MonoCloudBackendNodeClient
    options?: MonoCloudOidcBackendClientOptions,
  );
}
```

Key differences vs `MonoCloudBackendNodeClient`:

- `audience` is a **required positional argument**, not a field on the options object.
- No `MONOCLOUD_BACKEND_*` env-var loading — every option you want must be passed in code.
- No built-in `cache` (no claims caching helper), and therefore no `introspectionCacheDuration`.
- No `responseTimeout` default: the parent leaves it `undefined` (no abort timer) unless you pass one, whereas `MonoCloudBackendNodeClient` defaults it to `10000` ms.
- No client-level certificate-binding mode: on the parent, `validateCertificateBinding` is passed **per call** via `IntrospectOptions` / `ValidateJwtAccessTokenOptions` and defaults to `undefined`, which means no binding check at all.
- `clientAuthMethod` defaults to **`'client_secret_basic'`** (the OIDC spec default), **not** `'client_secret_post'` as it does on `MonoCloudBackendNodeClient`. If you switch from the wrapper to the parent class without re-specifying this, introspection requests change auth method and may start returning 401s from the OP.

If you find yourself reaching for the parent class to "simplify," reconsider — `MonoCloudBackendNodeClient` is the supported path.

## Errors (re-exported from `@monocloud/auth-core`)

```ts
class MonoCloudAuthBaseError extends Error {
  readonly raw?: MonoCloudRawResponse;   // { status, statusText, headers, body } — only on errors from an unsuccessful HTTP response (repeated headers comma-joined, set-cookie excluded)
}
class MonoCloudValidationError extends MonoCloudAuthBaseError {}  // bad config / empty token / introspection not configured
class MonoCloudTokenError extends MonoCloudAuthBaseError {        // token invalid / missing scopes/groups
  readonly code: MonoCloudTokenErrorCode;
  // 'invalid_token' | 'inactive_token' | 'insufficient_scope' | 'insufficient_groups' (defaults to 'invalid_token')
}
class MonoCloudOPError extends MonoCloudAuthBaseError {           // OP returned an OAuth error
  error: string;                                                   // OAuth `error` code (401 from introspection → 'invalid_client')
  errorDescription?: string;                                       // optional `error_description` from the OP
}
class MonoCloudHttpError extends MonoCloudAuthBaseError {         // network / unexpected status
  get status(): number | undefined;                                // undefined on network failure
  get statusText(): string | undefined;
}
```

`MonoCloudTokenError.code` values the middleware maps to 403 (instead of the default 401):

- `'insufficient_scope'` (message `'Token is missing required scopes'`)
- `'insufficient_groups'` (message `'Token is missing required groups'`)

Any other `MonoCloudTokenError` becomes 401 — that includes `code: 'invalid_token'` and `code: 'inactive_token'`, the latter thrown by `introspectAccessToken()` when the authorization server returns `active: false` (message `'Token is not active. The introspection endpoint returned active=false'`) and by the client when it replays a cached `active: false` entry (message `'Token is not active. A cached introspection result reported active=false'`). The split is by `code`, not by the message string.

## Token-claim types (re-exported from `@monocloud/auth-core`)

```ts
interface JwtClaims {
  iss: string;                         // issuer (validated to match tenantDomain)
  sub: string;                         // subject
  aud: string | string[];              // audience (validated to include options.audience)
  exp: number;                         // expiration (epoch seconds)
  iat: number;                         // issued at (epoch seconds)
  nbf?: number;                        // not-before (optional)
  [claim: string]: unknown;            // open: includes mTLS cnf.x5t#S256, custom claims, etc.
}

interface AccessTokenClaims extends JwtClaims {
  scope?: string;                      // space-delimited
  client_id?: string;
  jti?: string;
}

// Plus: Jwk, Jwks, JwsHeaderParameters, IssuerMetadata, IsUserInGroupOptions,
//      IntrospectOptions, ValidateJwtAccessTokenOptions, MonoCloudOidcBackendClientOptions,
//      MonoCloudTokenErrorCode, MonoCloudRawResponse
```

For mTLS / certificate-bound tokens, the `cnf` claim is accessed via the index signature as `claims['cnf']`. The validator checks `cnf['x5t#S256']` against the SHA-256 hash of the presented client certificate according to the client's `validateCertificateBinding` mode: `'when_present'` (the default) runs the check as soon as the token's `cnf` carries an `x5t#S256` thumbprint, `'required'` always runs it and rejects tokens with no `cnf`, and `'dangerously_ignore'` never runs it. A `cnf` that cannot be parsed counts as certificate-bound, so validation runs and rejects it rather than silently skipping a broken claim.

## Defaults

From `packages/node-backend/src/options/defaults.ts`:

```ts
{
  clockSkew: 0,
  clockTolerance: 60,
  clientAuthMethod: 'client_secret_post',
  introspectJwtTokens: false,
  validateCertificateBinding: 'when_present',
  responseTimeout: 10000,          // milliseconds
  introspectionCacheDuration: 300, // seconds
}
```

`jwksCacheDuration` and `metadataCacheDuration` default to **300 seconds** (5 minutes) in the underlying `MonoCloudOidcClientBase`. Override per environment via `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` / `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` or the constructor options.

## Environment-variable → option mapping

| Env var | Option | Notes |
|---|---|---|
| `MONOCLOUD_BACKEND_TENANT_DOMAIN` | `tenantDomain` | Required |
| `MONOCLOUD_BACKEND_AUDIENCE` | `audience` | Required |
| `MONOCLOUD_BACKEND_CLIENT_ID` | `clientId` | Required for introspection |
| `MONOCLOUD_BACKEND_CLIENT_SECRET` | `clientSecret` | JSON-string JWK when `clientAuthMethod` is `private_key_jwt` (parsed automatically) |
| `MONOCLOUD_BACKEND_CLIENT_AUTH_METHOD` | `clientAuthMethod` | |
| `MONOCLOUD_BACKEND_TRUST_STORE_ID` | `trustStoreId` | mTLS: selects trust store from `mtls_additional_endpoint_aliases` |
| `MONOCLOUD_BACKEND_GROUPS_CLAIM` | `groupOptions.groupsClaim` | |
| `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL` | `groupOptions.matchAll` | Coerced to boolean |
| `MONOCLOUD_BACKEND_CLOCK_SKEW` | `clockSkew` | Coerced to number |
| `MONOCLOUD_BACKEND_CLOCK_TOLERANCE` | `clockTolerance` | Coerced to number |
| `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` | `jwksCacheDuration` | Coerced to number |
| `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` | `metadataCacheDuration` | Coerced to number |
| `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS` | `introspectJwtTokens` | Coerced to boolean |
| `MONOCLOUD_BACKEND_VALIDATE_CERTIFICATE_BINDING` | `validateCertificateBinding` | One of `when_present` (default) / `required` / `dangerously_ignore`; any other value fails Joi validation and throws `MonoCloudValidationError` at construction |
| `MONOCLOUD_BACKEND_INTROSPECTION_CACHE_DURATION` | `introspectionCacheDuration` | Coerced to number (seconds, min `0`); default `300`, `0` disables introspection caching |
| `MONOCLOUD_BACKEND_RESPONSE_TIMEOUT` | `responseTimeout` | Coerced to number (milliseconds, min `1000`); default `10000` |

Constructor options always win over env vars.

There is no env var for `cache`; pass an `IIntrospectionCache` implementation to the constructor when you need Redis, in-memory, or another shared introspection-results cache.
