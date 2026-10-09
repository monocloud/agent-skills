# API surface — `@monocloud/backend-node/fastify`

Verified against `@monocloud/backend-node@0.3.10` (`monocloud/auth-js` @ `30d7d98`).

## Entry points

| Import path | Exports |
| --- | --- |
| `@monocloud/backend-node/fastify` | `protectApi`; types `ProtectHook`, `AuthenticatedFastifyRequest`; the shared exports |
| `@monocloud/backend-node` | The shared exports plus type `MtlsEndpointAliases` (root only); no `protectApi` |
| `@monocloud/backend-node/express` | Express `protectApi`, `ProtectMiddleware`, `AuthenticatedExpressRequest`; the shared exports |
| `@monocloud/backend-node/utils` | Re-export of `@monocloud/auth-core/utils`: `isUserInGroup(claims, groups, groupsClaim = 'groups', matchAll = false)`; the other helpers (`parseCallbackParams`, `generateState`, `generateNonce`, `generatePKCE`, `encrypt` / `decrypt`, `encryptSession` / `decryptSession`, `encryptAuthState` / `decryptAuthState`) serve sign-in flows |
| `@monocloud/backend-node/internal` | Re-export of `@monocloud/auth-core/internal` — SDK internals, not for application code |

**Shared exports.** Classes: `MonoCloudBackendNodeClient`, `MonoCloudOidcBackendClient`, `MonoCloudAuthBaseError`, `MonoCloudValidationError`, `MonoCloudTokenError`, `MonoCloudOPError`, `MonoCloudHttpError`. Types: `MonoCloudBackendNodeClientOptions`, `ValidateAccessTokenOptions`, `ProtectOptions`, `ProtectApiRequestOptions`, `TokenResolver`, `ClientCertificateResolver`, `IIntrospectionCache`, `AccessTokenClaims`, `JwtClaims`, `CertificateBindingValidation`, `ClientAuthMethod`, `MonoCloudTokenErrorCode`, `MonoCloudRawResponse`, `IntrospectOptions`, `ValidateJwtAccessTokenOptions`, `IsUserInGroupOptions`, `MonoCloudOidcBackendClientOptions`, `Jwk`, `Jwks`, `JwsHeaderParameters`, `IssuerMetadata`. Nothing else is exported (no Fastify plugin, no error mapper, no bearer-token parser).

## `protectApi`

```ts
function protectApi(options?: ProtectApiRequestOptions<FastifyRequest>): ProtectHook;
function protectApi(client: MonoCloudBackendNodeClient, options?: ProtectApiRequestOptions<FastifyRequest>): ProtectHook;

type ProtectHook = (options?: ProtectOptions) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type AuthenticatedFastifyRequest = FastifyRequest & { claims: AccessTokenClaims };

interface ProtectOptions { scopes?: string[]; groups?: string[] } // Omit<ValidateAccessTokenOptions, 'clientCertificate'>

interface ProtectApiRequestOptions<T> {
  tokenResolver?: TokenResolver<T>;
  certificateResolver?: ClientCertificateResolver<T>;
}
type TokenResolver<T> = (req: T) => Promise<string | undefined>;
type ClientCertificateResolver<T> = (req: T) => Promise<string | undefined>; // PEM, BEGIN/END lines optional
```

- **Construction.** Without a client, `protectApi()` runs `new MonoCloudBackendNodeClient()` immediately, so env is read and validated at that moment; discovery and the JWKS are fetched lazily on the first validation. The first argument is treated as a client only if it is a `MonoCloudBackendNodeClient` instance — otherwise it is read as `ProtectApiRequestOptions`, and client options in it (`tenantDomain`, `cache`, …) are ignored.
- **Per request**, in order: `certificateResolver` runs (if set); the token is the `tokenResolver` result, or the `Authorization` header when the resolver is absent or returns `undefined` / `null` (the header must be exactly `Bearer <token>`, scheme case-insensitive); the token is trimmed, and an empty one gets 401 with `WWW-Authenticate: Bearer`; then `client.validateAccessToken(token, { scopes, groups, clientCertificate })`.
- The hook is an async `onRequest` hook (route option `onRequest`, or `addHook('onRequest', …)`). Success sets `request.claims` and resolves, so the request continues. Any failure — including a resolver that throws — sends the mapped reply ([Responses](../SKILL.md#responses)) and returns it, so later hooks and the handler are skipped.

## `MonoCloudBackendNodeClient`

```ts
class MonoCloudBackendNodeClient extends MonoCloudOidcBackendClient {
  constructor(options?: Partial<MonoCloudBackendNodeClientOptions>); // options override MONOCLOUD_BACKEND_* env
  validateAccessToken(accessToken: string, options?: ValidateAccessTokenOptions): Promise<AccessTokenClaims>;

  // inherited
  validateJwtAccessToken(accessToken: string, options?: ValidateJwtAccessTokenOptions): Promise<AccessTokenClaims>;
  introspectAccessToken(accessToken: string, options?: IntrospectOptions): Promise<AccessTokenClaims>;
  getMetadata(forceRefresh?: boolean): Promise<IssuerMetadata>;
  getJwks(forceRefresh?: boolean): Promise<Jwks>;
  setClockSkew(clockSkew: number): void;
  setClockTolerance(clockTolerance: number): void;
  static decodeJwt(jwt: string): JwtClaims; // decodes the payload WITHOUT verifying it
}

interface IntrospectOptions {
  scopes?: string[]; groups?: string[]; clientCertificate?: string;
  validateCertificateBinding?: CertificateBindingValidation;
}
interface ValidateJwtAccessTokenOptions { /* IntrospectOptions fields */ jwks?: Jwks } // jwks: pre-fetched key set
interface ValidateAccessTokenOptions extends Omit<IntrospectOptions, 'validateCertificateBinding'> {} // scopes, groups, clientCertificate
```

The constructor throws `MonoCloudValidationError` on invalid configuration ([Options](#options--monocloudbackendnodeclientoptions)). `getMetadata()` / `getJwks()` can warm the caches at startup and fail fast on a wrong tenant domain.

**`validateAccessToken` flow**

1. Blank token → `MonoCloudValidationError('Access token must be a valid non-empty string')`.
2. Exactly three dot-separated segments and `introspectJwtTokens` off → local JWT validation: header (no `crit`), `RS*` / `PS*` / `ES*` signature against the cached JWKS (key chosen by `kid` / `alg`), payload, claim checks, scopes / groups, then certificate binding with the client's mode. Never cached.
3. Otherwise introspection: no `clientId` → `MonoCloudValidationError('Token introspection is not configured')`; cache lookup ([`IIntrospectionCache`](#iintrospectioncache)); `POST` `token` + `token_type_hint=access_token` to the introspection endpoint, authenticated per `clientAuthMethod`; `active: false` → `MonoCloudTokenError(…, 'inactive_token')`; claim checks; cache write; scopes / groups; certificate binding.

**Claim checks (both paths):** `iss` equals the normalized tenant domain; `aud` (string or array) contains `audience`; if present, `exp > now + clockSkew − clockTolerance` and `nbf ≤ now + clockSkew + clockTolerance`; `sub`, if present, is a string. Introspected claims are the response minus `active`.

The inherited `validateJwtAccessToken` / `introspectAccessToken` skip the cache and check certificate binding only when you pass `validateCertificateBinding` — prefer `validateAccessToken`. `introspectAccessToken` without a `clientId` throws `MonoCloudValidationError('The clientId option must be configured to introspect access tokens')`.

## Options — `MonoCloudBackendNodeClientOptions`

| Option | Env var (`MONOCLOUD_BACKEND_` + …) | Default | Rules |
| --- | --- | --- | --- |
| `tenantDomain` | `TENANT_DOMAIN` | required | URI starting with `https://` (anything else gets `https://` prepended, so `http://x` becomes `https://http://x`); one trailing `/` is removed; must then equal the token's `iss` |
| `audience` | `AUDIENCE` | required | URI with a scheme (`https://…`, `urn:…`); must be in the token's `aud` |
| `clientId` | `CLIENT_ID` | — | Enables introspection |
| `clientSecret` | `CLIENT_SECRET` | — | `string \| Jwk` — see [Client authentication](#client-authentication) |
| `clientAuthMethod` | `CLIENT_AUTH_METHOD` | `client_secret_post` | `ClientAuthMethod` (8 values below) |
| `trustStoreId` | `TRUST_STORE_ID` | — | mTLS client auth: endpoints from `mtls_additional_endpoint_aliases[trustStoreId]` instead of `mtls_endpoint_aliases` |
| `groupOptions.groupsClaim` | `GROUPS_CLAIM` | `groups` | Claim holding groups (array of strings or `{ id, name }`) |
| `groupOptions.matchAll` | `GROUPS_MATCH_ALL` | `false` | `true` = every listed group |
| `introspectJwtTokens` | `INTROSPECT_JWT_TOKENS` | `false` | Introspect JWTs instead of validating locally |
| `validateCertificateBinding` | `VALIDATE_CERTIFICATE_BINDING` | `when_present` | `'when_present' \| 'required' \| 'dangerously_ignore'` |
| `clockSkew` | `CLOCK_SKEW` | `0` | ≥ 0 seconds added to the local clock |
| `clockTolerance` | `CLOCK_TOLERANCE` | `60` | ≥ 0 seconds of leeway on `exp` / `nbf` |
| `jwksCacheDuration` | `JWKS_CACHE_DURATION` | `300` | ≥ 0 seconds |
| `metadataCacheDuration` | `METADATA_CACHE_DURATION` | `300` | ≥ 0 seconds |
| `introspectionCacheDuration` | `INTROSPECTION_CACHE_DURATION` | `300` | ≥ 0 seconds; `0` disables `cache` |
| `responseTimeout` | `RESPONSE_TIMEOUT` | `10000` | ≥ 1000 ms; aborts discovery, JWKS and introspection requests |
| `cache` | — | — | [`IIntrospectionCache`](#iintrospectioncache) |
| `metadataResolver` | — | — | `() => IssuerMetadata \| Promise<IssuerMetadata>` — replaces the discovery request (cached for `metadataCacheDuration`) |
| `jwksResolver` | — | — | `() => Jwks \| Promise<Jwks>` — replaces the JWKS request (cached for `jwksCacheDuration`) |
| `fetcher` | — | global `fetch` | `typeof fetch` for discovery, JWKS and introspection; pass `init` through (its `signal` enforces `responseTimeout`) |

Env values: strings are used verbatim, and an **empty** string fails validation (`"clientId" is not allowed to be empty`); booleans must be `true` / `false` (any case) and numbers are `parseInt(value, 10)` — anything unparseable is ignored and the default applies (`"10s"` reads as `10`). Enum values are case-sensitive. The merged options are validated and only the first error message is thrown.

### Client authentication

`ClientAuthMethod` and what `clientSecret` must be (only introspection authenticates):

| `clientAuthMethod` | `clientSecret` |
| --- | --- |
| `client_secret_basic`, `client_secret_post` | The client secret string |
| `client_secret_jwt` | The secret string; an HS256 client assertion is signed with it. A JWK object is rejected (`"clientSecret" must be a string`) |
| `private_key_jwt` | A private JWK object (env: JSON string, parsed when it has a string `kty`) with `alg` (`RS*`, `PS*` or `ES*`); its `kid` goes into the assertion header. Anything else → `clientSecret must be a valid JWK when clientAuthMethod is 'private_key_jwt'` |
| `spiffe_jwt` | The SPIFFE JWT-SVID string, sent as `client_assertion` |
| `tls_client_auth`, `self_signed_tls_client_auth`, `spiffe_x509` | Unused. Only `client_id` is sent, to the mTLS endpoint alias (missing alias → `MonoCloudValidationError`). The SDK attaches no TLS client certificate — supply a `fetcher` whose transport presents it |

A missing or wrong-typed secret for `client_secret_jwt`, `private_key_jwt` or `spiffe_jwt` is only detected at introspection time, as a plain `Error('Invalid Client Authentication Method')` (→ 401); a JWK without a supported `alg` fails with `Error('unsupported JWS algorithm')`.

## `IIntrospectionCache`

```ts
interface IIntrospectionCache {
  get(key: string): Promise<AccessTokenClaims | null | undefined>;
  set(key: string, claims: AccessTokenClaims, expiresAt: number): Promise<void>; // expiresAt: Unix seconds
  delete(key: string): Promise<void>;
}
```

Used only when `cache` is set **and** `introspectionCacheDuration > 0`; locally validated JWTs never touch it.

- **Key** — the raw access token. Hash it inside your implementation if the store is shared.
- **Write** — after a successful introspection, before the route's scope / group / binding checks (a request rejected for scope still caches): `set(token, claims, min(claims.exp, now + introspectionCacheDuration))`, or `now + introspectionCacheDuration` when there is no `exp`.
- **Negative write** — an `active: false` result stores `{ active: false, exp: now + duration }` (expiring then); while that `exp` is in the future, reads throw `MonoCloudTokenError('Token is not active. A cached introspection result reported active=false', 'inactive_token')` without contacting the server. Transport and OP errors are not cached.
- **Read** — a returned entry is used if it has no `exp` or `exp > now + clockSkew − clockTolerance` (an entry whose `exp` is not a number is ignored); claim, scope / group and binding checks still run on it.
- The SDK calls only `get` and `set`; `delete` is for your own eviction (e.g. after revoking a token). `get` must return `null` / `undefined` once `expiresAt` has passed — the client's own check allows `clockTolerance` past `exp` and trusts entries without `exp`.
- Errors thrown by `get` / `set` propagate (`protectApi` → 401). Catch them inside your implementation to fall back to introspection.
- **Shape** — the option is validated as an object whose own properties are exactly `get`, `set` and `delete`, and the client keeps a shallow copy. Extra own properties throw at construction (`"cache.redis" is not allowed` for a class that stores `this.redis`), and `#private` class fields are lost on the copy (calls then throw → 401). Use an object literal that closes over the store:

```ts
import type { AccessTokenClaims, IIntrospectionCache } from "@monocloud/backend-node/fastify";

const entries = new Map<string, { claims: AccessTokenClaims; expiresAt: number }>(); // per process
const introspectionCache: IIntrospectionCache = {
  async get(key) {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now() / 1000) return hit.claims;
    entries.delete(key);
    return undefined;
  },
  async set(key, claims, expiresAt) { entries.set(key, { claims, expiresAt }); },
  async delete(key) { entries.delete(key); },
};
```

For a shared store (Redis, Memcached), serialize `claims` as JSON — negative entries carry `active: false` — and expire the key at `expiresAt`.

## Certificate binding

`CertificateBindingValidation` is a client option only; `ProtectOptions` and `ValidateAccessTokenOptions` don't accept it (the lower-level `validateJwtAccessToken` / `introspectAccessToken` take it per call, default: no check). When a check runs ([modes](../SKILL.md#certificate-bound-mtls-tokens)), it fails with the first matching `MonoCloudTokenError` (`invalid_token`, 401):

1. Certificate missing or blank → `Client certificate is not present`
2. PEM body (or the whole string) is not base64 → `Client certificate is malformed`
3. No `cnf` claim → `Access token does not contain a 'cnf' (confirmation) claim for certificate binding`
4. `cnf` is not a JSON object (a string, array, number…) → `The 'cnf' claim could not be parsed`
5. `cnf['x5t#S256']` missing or empty → `The 'cnf' claim does not contain an 'x5t#S256' member specifying the certificate hash for binding`
6. base64url SHA-256 of the certificate's DER bytes ≠ `x5t#S256` → `The certificate hash in the access token does not match the presented client certificate (certificate binding validation failed)`

Under `when_present`, a `cnf` object without `x5t#S256` (another confirmation method) is not checked.

## Errors

```ts
class MonoCloudAuthBaseError extends Error { readonly raw?: MonoCloudRawResponse }
class MonoCloudValidationError extends MonoCloudAuthBaseError {} // configuration or usage problem
class MonoCloudTokenError extends MonoCloudAuthBaseError { readonly code: MonoCloudTokenErrorCode } // default 'invalid_token'
class MonoCloudOPError extends MonoCloudAuthBaseError { error: string; errorDescription?: string }
class MonoCloudHttpError extends MonoCloudAuthBaseError { get status(): number | undefined; get statusText(): string | undefined }

type MonoCloudTokenErrorCode = 'invalid_token' | 'inactive_token' | 'insufficient_scope' | 'insufficient_groups';
interface MonoCloudRawResponse { status: number; statusText: string; headers: Record<string, string>; body: string }
```

- `raw` exists only on errors built from an HTTP response; `headers` excludes `set-cookie`. Body and headers are verbatim — don't log them as-is.
- `MonoCloudOPError` — the introspection endpoint answered 400 / 401. `error` comes from the body, else `invalid_client` (401) or `introspection_failed` (400); `errorDescription` defaults to `Token introspection failed`; `message` equals `error`.
- `MonoCloudHttpError` — `status` is `undefined` for network failures and timeouts (`Request to <url> timed out after <ms>ms`); otherwise it is the unexpected status (`Error while fetching metadata. Unexpected status code: <n>`, `Error while fetching JWKS. …`, `Error while performing token introspection. …`) or the 200 whose body wasn't JSON (`Failed to parse response body as JSON…`).
- Some failures are plain `Error`s (unsupported JWS `alg`, no single matching JWKS key, client-authentication misconfiguration); `protectApi` answers them with 401. Every message: [troubleshooting](troubleshooting.md#error-message-index).

## Claim types

```ts
interface JwtClaims { iss: string; sub: string; aud: string | string[]; exp: number; iat: number; nbf?: number; [claim: string]: unknown }
interface AccessTokenClaims extends JwtClaims { scope?: string; client_id?: string; jti?: string }
```

`scope` is space-delimited. Groups, `cnf` and custom claims are read through the index signature (`claims.groups`, `claims.cnf`).

## `MonoCloudOidcBackendClient` (parent class)

Exported for low-level use; prefer `MonoCloudBackendNodeClient`. Differences:

- `new MonoCloudOidcBackendClient(tenantDomain, audience, options?: MonoCloudOidcBackendClientOptions)` — positional arguments, no env vars, no option validation. Options: `clientId`, `clientSecret`, `clientAuthMethod`, `clockSkew`, `clockTolerance`, `groupOptions`, `jwksCacheDuration`, `metadataCacheDuration`, `responseTimeout`, `fetcher`, `trustStoreId`, `metadataResolver`, `jwksResolver`.
- No `validateAccessToken` (no JWT / opaque routing), no `cache`, no client-level binding mode (pass `validateCertificateBinding` per call; default: no check).
- `clientAuthMethod` defaults to `client_secret_basic`; `responseTimeout` has no default, so requests are never aborted.
