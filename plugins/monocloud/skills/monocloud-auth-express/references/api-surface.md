# API surface — `@monocloud/backend-node/express`

Every export available from the Express subpath, verified against `packages/node-backend/src/frameworks/express/index.ts` and re-exports.

## Quick reference

The surface most apps actually reach for — full signatures and types follow below.

- `protectApi(options?)` / `protectApi(client, options?)` — returns a `ProtectMiddleware` factory; call it per route with `ProtectOptions` (`scopes`, `groups`, `validateCertificateBinding`).
- `AuthenticatedExpressRequest` — cast `req` after `protectApi` to read `req.claims`.
- `MonoCloudBackendNodeClient` — use when you need a shared instance or call `validateAccessToken` directly.
- Errors: `MonoCloudTokenError` (→ 401 by default, → 403 for "missing required scopes/groups"), `MonoCloudValidationError`, `MonoCloudOPError`, `MonoCloudHttpError`.

## Imports — what comes from where

```ts
// Everything below is importable from this subpath:
import { ... } from '@monocloud/backend-node/express';
```

The root `@monocloud/backend-node` exports the same shared types and the client class, but **not** `protectApi` (that lives in the framework subpaths).

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

Without a `client`, a new `MonoCloudBackendNodeClient` is constructed from environment variables on first call.

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
  tokenResolver?: TokenResolver<T>;             // overrides default Authorization: Bearer extraction
  certificateResolver?: ClientCertificateResolver<T>;
}

type TokenResolver<T> = (req: T) => Promise<string | undefined>;
type ClientCertificateResolver<T> = (req: T) => Promise<string | undefined>;
```

### `ProtectOptions`

Passed to each per-route call of the factory.

```ts
interface ProtectOptions {
  scopes?: string[];                    // AND — token must carry all
  groups?: string[];                    // OR by default (matchAll flips)
  validateCertificateBinding?: boolean; // mTLS-bound token check
}
```

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
  cache?: IIntrospectionCache;          // constructor-only introspection-results cache
  fetcher?: typeof fetch;              // i.e. (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

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
interface ValidateAccessTokenOptions {
  scopes?: string[];
  groups?: string[];
  validateCertificateBinding?: boolean;
  clientCertificate?: string;          // PEM, optionally without BEGIN/END delimiters
}
```

### `IIntrospectionCache`

Implement for Redis, in-memory, etc. Only introspection results are cached (opaque tokens, and JWTs when `introspectJwtTokens` is `true`); locally-validated JWTs are never cached. The client keys on the raw token string and respects `claims.exp`.

```ts
interface IIntrospectionCache {
  get(key: string): Promise<AccessTokenClaims | null | undefined>;
  set(key: string, claims: AccessTokenClaims, expiresAt: number): Promise<void>;
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
- No built-in `cache` (no claims caching helper).
- `clientAuthMethod` defaults to **`'client_secret_basic'`** (the OIDC spec default), **not** `'client_secret_post'` as it does on `MonoCloudBackendNodeClient`. If you switch from the wrapper to the parent class without re-specifying this, introspection requests change auth method and may start returning 401s from the OP.

If you find yourself reaching for the parent class to "simplify," reconsider — `MonoCloudBackendNodeClient` is the supported path.

## Errors (re-exported from `@monocloud/auth-core`)

```ts
class MonoCloudAuthBaseError extends Error {}
class MonoCloudValidationError extends MonoCloudAuthBaseError {}  // bad config / empty token
class MonoCloudTokenError extends MonoCloudAuthBaseError {}       // token invalid / missing scopes/groups
class MonoCloudOPError extends MonoCloudAuthBaseError {           // OP returned an OAuth error
  error: string;                                                   // OAuth `error` code (e.g. 'invalid_token')
  errorDescription?: string;                                       // optional `error_description` from the OP
}
class MonoCloudHttpError extends MonoCloudAuthBaseError {}        // network / unexpected status
```

`MonoCloudTokenError` messages the middleware specifically maps to 403 (instead of the default 401):

- `'Token is missing required scopes'`
- `'Token is missing required groups'`

Any other `MonoCloudTokenError` becomes 401.

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
//      IntrospectOptions, ValidateJwtAccessTokenOptions, MonoCloudOidcBackendClientOptions
```

For mTLS / certificate-bound tokens, the `cnf` claim is accessed via the index signature as `claims['cnf']`. The validator checks `cnf['x5t#S256']` against the SHA-256 hash of the presented client certificate when `validateCertificateBinding` is `true`.

## Defaults

From `packages/node-backend/src/options/defaults.ts`:

```ts
{
  clockSkew: 0,
  clockTolerance: 60,
  clientAuthMethod: 'client_secret_post',
  introspectJwtTokens: false,
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

Constructor options always win over env vars.

There is no env var for `cache`; pass an `IIntrospectionCache` implementation to the constructor when you need Redis, in-memory, or another shared introspection-results cache.
