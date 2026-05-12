# API surface — `@monocloud/backend-node/fastify`

Every export available from the Fastify subpath, verified against `packages/node-backend/src/frameworks/fastify/index.ts` and re-exports.

## Quick reference

The surface most apps actually reach for — full signatures and types follow below.

- `protectApi(options?)` / `protectApi(client, options?)` — returns a `ProtectHook` factory; call it per route with `ProtectOptions` and register via `{ onRequest: protect(...) }` or `fastify.addHook('onRequest', protect(...))`.
- `AuthenticatedFastifyRequest` — cast `request` after `protectApi` to read `request.claims`.
- `MonoCloudBackendNodeClient` — use when you need a shared instance or call `validateAccessToken` directly.
- Errors: same hierarchy as the Express skill — `MonoCloudTokenError` (→ 401 by default, → 403 for "missing required scopes/groups"), `MonoCloudValidationError`, `MonoCloudOPError`, `MonoCloudHttpError`.

## Imports — what comes from where

```ts
// Everything below is importable from this subpath:
import { ... } from '@monocloud/backend-node/fastify';
```

The root `@monocloud/backend-node` exports the same shared types and the client class, but **not** `protectApi` (that lives in the framework subpaths).

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
  clientSecret?: string;
  clientAuthMethod?: ClientAuthMethod; // default 'client_secret_post'
  groupOptions?: { groupsClaim?: string; matchAll?: boolean };
  clockSkew?: number;                  // default 0
  clockTolerance?: number;             // default 300
  jwksCacheDuration?: number;          // seconds
  metadataCacheDuration?: number;      // seconds
  introspectJwtTokens?: boolean;       // default false — force introspection for JWTs
  cache?: ICache;                       // constructor-only token-claims cache
  fetcher?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

type ClientAuthMethod =
  | 'client_secret_basic'
  | 'client_secret_post'
  | 'client_secret_jwt'
  | 'private_key_jwt'
  | 'tls_client_auth'
  | 'self_signed_tls_client_auth';
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

### `ICache`

Implement for Redis, in-memory, etc. The client keys on the raw token string and respects `claims.exp`.

```ts
interface ICache {
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

  // Auto-detects JWT (3 segments) vs opaque and dispatches. Caches if ICache is set.
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

## Errors (re-exported from `@monocloud/auth-core`)

```ts
class MonoCloudAuthBaseError extends Error {}
class MonoCloudValidationError extends MonoCloudAuthBaseError {}  // bad config / empty token
class MonoCloudTokenError extends MonoCloudAuthBaseError {}       // token invalid / missing scopes/groups
class MonoCloudOPError extends MonoCloudAuthBaseError {}          // OP returned an OAuth error
class MonoCloudHttpError extends MonoCloudAuthBaseError {}        // network / unexpected status
```

`MonoCloudTokenError` messages the hook specifically maps to 403 (instead of the default 401):

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
  clockTolerance: 300,
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
| `MONOCLOUD_BACKEND_GROUPS_CLAIM` | `groupOptions.groupsClaim` | |
| `MONOCLOUD_BACKEND_GROUPS_MATCH_ALL` | `groupOptions.matchAll` | Coerced to boolean |
| `MONOCLOUD_BACKEND_CLOCK_SKEW` | `clockSkew` | Coerced to number |
| `MONOCLOUD_BACKEND_CLOCK_TOLERANCE` | `clockTolerance` | Coerced to number |
| `MONOCLOUD_BACKEND_JWKS_CACHE_DURATION` | `jwksCacheDuration` | Coerced to number |
| `MONOCLOUD_BACKEND_METADATA_CACHE_DURATION` | `metadataCacheDuration` | Coerced to number |
| `MONOCLOUD_BACKEND_INTROSPECT_JWT_TOKENS` | `introspectJwtTokens` | Coerced to boolean |

Constructor options always win over env vars.

There is no env var for `cache`; pass an `ICache` implementation to the constructor when you need Redis, in-memory, or another shared token-claims cache.
