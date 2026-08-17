# API surface — `@monocloud/backend-node/fastify`

Every export available from the Fastify subpath, verified against `packages/node-backend/src/frameworks/fastify/index.ts` and re-exports.

## Quick reference

The surface most apps actually reach for — full signatures and types follow below.

- `protectApi(options?)` / `protectApi(client, options?)` — returns a `ProtectHook` factory; call it per route with `ProtectOptions` and register via `{ onRequest: protect(...) }` or `fastify.addHook('onRequest', protect(...))`.
- `AuthenticatedFastifyRequest` — cast `request` after `protectApi` to read `request.claims`.
- `MonoCloudBackendNodeClient` — use when you need a shared instance or call `validateAccessToken` directly.
- Errors: same hierarchy as the Express skill — `MonoCloudTokenError` (mapped by its `code`: `insufficient_scope`/`insufficient_groups` → 403, `invalid_token` → 401), `MonoCloudValidationError` / `MonoCloudOPError` → 500, `MonoCloudHttpError` → 503 (network/5xx/429) or 500 (4xx). See the Errors section below for the full mapping.

## Imports — what comes from where

```ts
// Everything below is importable from this subpath:
import { ... } from '@monocloud/backend-node/fastify';
```

The root `@monocloud/backend-node` exports the same shared types and the client class, but **not** `protectApi` (that lives in the framework subpaths).

The package also ships two helper subpaths that re-export from `@monocloud/auth-core`:

- `@monocloud/backend-node/utils` — re-exports `@monocloud/auth-core/utils` (e.g. `isUserInGroup`, `parseCallbackParams`, `generateState`, `generatePKCE`, `generateNonce`, plus session/state encryption helpers). The one most relevant to bearer-token APIs is `isUserInGroup` — useful when you want to re-check membership outside the hook, or build custom guards.
- `@monocloud/backend-node/internal` — re-exports `@monocloud/auth-core/internal` (e.g. `getBoolean` and other coercion helpers). Most apps will not need this; reach for it only when probing edge cases.

## Functions

### `protectApi`

Two overloads. Both return a factory that you then call per-route with `ProtectOptions` to get a Fastify `onRequest` hook.

```ts
function protectApi(
  options?: ProtectApiRequestOptions<FastifyRequest>,
): ProtectHook;

function protectApi(
  client: MonoCloudBackendNodeClient,
  options?: ProtectApiRequestOptions<FastifyRequest>,
): ProtectHook;

type ProtectHook = (
  options?: ProtectOptions,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
```

Without a `client`, a new `MonoCloudBackendNodeClient` is constructed from environment variables on first call.

## Types — framework-specific

### `AuthenticatedFastifyRequest`

```ts
type AuthenticatedFastifyRequest = FastifyRequest & {
  claims: AccessTokenClaims;
};
```

Cast `request` to this inside protected handlers to access `request.claims`.

### `ProtectHook`

```ts
type ProtectHook = (
  options?: ProtectOptions,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
```

The factory that `protectApi()` returns. Attach the result to `{ onRequest: protect(...) }` or via `fastify.addHook('onRequest', protect(...))`.

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
  clientSecret?: string | Jwk;         // string, or a JWK; for private_key_jwt pass the private-key JWK (JSON string via env, or object in code); for spiffe_jwt pass the SPIFFE JWT-SVID string
  clientAuthMethod?: ClientAuthMethod; // default 'client_secret_post'
  trustStoreId?: string;               // env MONOCLOUD_BACKEND_TRUST_STORE_ID; selects mtls_additional_endpoint_aliases[trustStoreId]
  metadataResolver?: () => IssuerMetadata | Promise<IssuerMetadata>; // out-of-band issuer metadata (code-only, no env var)
  jwksResolver?: () => Jwks | Promise<Jwks>;                         // out-of-band JWKS (code-only, no env var)
  groupOptions?: { groupsClaim?: string; matchAll?: boolean };
  clockSkew?: number;                  // default 0
  clockTolerance?: number;             // default 60 (seconds)
  jwksCacheDuration?: number;          // seconds
  metadataCacheDuration?: number;      // seconds
  introspectJwtTokens?: boolean;       // default false — force introspection for JWTs
  cache?: IIntrospectionCache;         // constructor-only introspection-results cache
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

Implement for Redis, in-memory, etc. Caches introspection results only (opaque tokens, and JWTs when `introspectJwtTokens` is `true`); locally-validated JWTs are not cached. The client keys on the raw token string and respects `claims.exp`.

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
- No built-in `cache` (no claims caching helper).
- `clientAuthMethod` defaults to **`'client_secret_basic'`** (the OIDC spec default), **not** `'client_secret_post'` as it does on `MonoCloudBackendNodeClient`. If you switch from the wrapper to the parent class without re-specifying this, introspection requests change auth method and may start returning 401s from the OP.

If you find yourself reaching for the parent class to "simplify," reconsider — `MonoCloudBackendNodeClient` is the supported path.

## Errors (re-exported from `@monocloud/auth-core`)

```ts
class MonoCloudAuthBaseError extends Error {
  readonly raw?: MonoCloudRawResponse;   // { status, statusText, headers, body } — only on errors from an unsuccessful HTTP response (repeated headers comma-joined; set-cookie excluded)
}
class MonoCloudValidationError extends MonoCloudAuthBaseError {}  // bad config / empty token
class MonoCloudTokenError extends MonoCloudAuthBaseError {        // token invalid / missing scopes/groups
  readonly code: MonoCloudTokenErrorCode; // 'invalid_token' | 'insufficient_scope' | 'insufficient_groups'
}
class MonoCloudOPError extends MonoCloudAuthBaseError {           // OP returned an OAuth error
  error: string;                                                   // OAuth `error` code (e.g. 'invalid_token'); a 401 from the introspection endpoint is 'invalid_client'
  errorDescription?: string;                                       // optional `error_description` from the OP
}
class MonoCloudHttpError extends MonoCloudAuthBaseError {         // network / unexpected status
  get status(): number | undefined;                                // response status; undefined on network failure
  get statusText(): string | undefined;
}
```

`MonoCloudTokenError` carries a `code` discriminator, and the hook maps it to a status by `code` — not by message string:

- `code: 'insufficient_scope'` (message `'Token is missing required scopes'`) → 403
- `code: 'insufficient_groups'` (message `'Token is missing required groups'`) → 403
- `code: 'invalid_token'` (any other token error) → 401

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
| `MONOCLOUD_BACKEND_CLIENT_SECRET` | `clientSecret` | |
| `MONOCLOUD_BACKEND_CLIENT_AUTH_METHOD` | `clientAuthMethod` | |
| `MONOCLOUD_BACKEND_TRUST_STORE_ID` | `trustStoreId` | Selects `mtls_additional_endpoint_aliases[trustStoreId]` for mutual-TLS client auth; default uses `mtls_endpoint_aliases` |
| `MONOCLOUD_BACKEND_GROUPS_CLAIM` | `groupOptions.groupsClaim` | |
| `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL` | `groupOptions.matchAll` | Coerced to boolean |
| `MONOCLOUD_BACKEND_CLOCK_SKEW` | `clockSkew` | Coerced to number |
| `MONOCLOUD_BACKEND_CLOCK_TOLERANCE` | `clockTolerance` | Coerced to number |
| `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` | `jwksCacheDuration` | Coerced to number |
| `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` | `metadataCacheDuration` | Coerced to number |
| `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS` | `introspectJwtTokens` | Coerced to boolean |

Constructor options always win over env vars.

There is no env var for `cache`, `metadataResolver`, or `jwksResolver` — pass those to the constructor in code. `cache` takes an `IIntrospectionCache` implementation (Redis, in-memory, etc.); `metadataResolver` / `jwksResolver` supply the issuer metadata / JWKS out-of-band (e.g. for a private trust store not in the public discovery document or JWKS).
