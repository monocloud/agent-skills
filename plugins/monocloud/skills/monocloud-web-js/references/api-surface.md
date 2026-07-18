# API surface — `@monocloud/auth-web-js`

Exhaustive export list, verified against `packages/web-js/src/index.ts`. Method signatures are condensed; TypeScript intellisense (`go-to-definition`) is the source of truth for full request/response model fields.

## Quick reference

- Entry point: `new MonoCloudWebJSClient(options)` — one shared instance per app.
- Most-used methods: `processCallback`, `signIn`, `signOut`, `signInSilent`, `refreshSession`, `refetchUserInfo`, `getTokens`, `getSession`.
- Storage adapters (default `LocalStorage`): `LocalStorage`, `SessionStorage`, `MemoryStorage`, or your own `IStorage`.
- Errors (all extend `MonoCloudAuthBaseError`): `MonoCloudOPError`, `MonoCloudValidationError`, `MonoCloudTokenError`, `MonoCloudHttpError`, `MonoCloudJsError`.
- No environment variables. **All configuration is constructor-driven.**

## Top-level exports

```ts
import {
  // Main client
  MonoCloudWebJSClient,

  // Storage adapters
  LocalStorage,
  SessionStorage,
  MemoryStorage,

  // Errors
  MonoCloudJsError,             // browser/environment failure (this package)
  MonoCloudOPError,             // re-exported from @monocloud/auth-core
  MonoCloudValidationError,
  MonoCloudTokenError,
  MonoCloudHttpError,
  MonoCloudAuthBaseError,

  // Low-level OIDC client (advanced)
  MonoCloudOidcClient,
} from '@monocloud/auth-web-js';

import type {
  // Client / option types
  MonoCloudWebJSClientOptions,
  DefaultAuthParams,
  Indicator,
  IStorage,
  InteractionMode,
  ApplicationState,
  OnSessionCreating,
  PostCallback,
  CallbackState,

  // Per-call option shapes
  SignInOptions,
  SignInSilentOptions,
  SignOutOptions,
  RefreshOptions,
  GetTokensOptions,
  MonoCloudTokens,

  // Re-exported from @monocloud/auth-core
  AccessToken,
  AuthenticateOptions,
  ClientAuthMethod,
  MonoCloudClientOptionsBase,
  PushedAuthorizationParams,
  RefreshSessionOptions,
  AuthState,
  Authenticators,
  AuthorizationParams,
  CallbackParams,
  JwsHeaderParameters,
  EndSessionParameters,
  Group,
  IdTokenClaims,
  IssuerMetadata,
  SecurityAlgorithms,
  Jwk,
  Jwks,
  MonoCloudSession,
  MonoCloudUser,
  Tokens,
  Address,
  UserinfoResponse,
  CodeChallengeMethod,
  DisplayOptions,
  Prompt,
  ResponseModes,
  ResponseTypes,
  RefreshGrantOptions,
  RefetchUserInfoOptions,
  ParResponse,
} from '@monocloud/auth-web-js';
```

There is no separate subpath you need to import for normal use. The package also exposes `@monocloud/auth-web-js/utils` and `@monocloud/auth-web-js/internal`, which re-export helpers from `@monocloud/auth-core`; you only need them if you are writing custom OIDC logic on top of the SDK.

## `MonoCloudWebJSClient`

```ts
class MonoCloudWebJSClient {
  readonly oidcClient: MonoCloudOidcClient; // low-level OIDC client (advanced use)

  constructor(options: MonoCloudWebJSClientOptions);

  processCallback(): Promise<void>;

  signIn(options?: SignInOptions): Promise<void>;
  signOut(options?: SignOutOptions): Promise<void>;
  signInSilent(options?: SignInSilentOptions): Promise<MonoCloudSession>;

  refreshSession(options?: RefreshOptions): Promise<void>;
  refetchUserInfo(): Promise<void>;

  getTokens(options?: GetTokensOptions): Promise<MonoCloudTokens>;
  getSession(): Promise<MonoCloudSession | undefined>;
}
```

### Method semantics

| Method            | What it does                                                                                                  | Throws (typical)                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `processCallback` | Detects a pending sign-in or sign-out callback in the current URL and completes it. No-op otherwise.          | `MonoCloudValidationError` (bad callback state), `MonoCloudOPError`    |
| `signIn`          | Starts an authorization request. `mode: 'redirect'` (default) or `'popup'`. `signUp: true` => `prompt=create`. | `MonoCloudJsError` (popup blocked, redirect from iframe)               |
| `signOut`         | Ends the session locally; when `federatedSignOut`, also signs the user out of MonoCloud.                      | `MonoCloudJsError`                                                     |
| `signInSilent`    | Hidden-iframe `prompt=none` authorization. Returns the new session.                                           | `MonoCloudOPError` (`login_required`, `interaction_required`), `MonoCloudJsError` (cross-origin-isolated context, window timeout) |
| `refreshSession`  | Runs the Refresh Token Grant. Requires `offline_access` at sign-in.                                           | `MonoCloudValidationError` (no session, no refresh token)              |
| `refetchUserInfo` | Calls the UserInfo endpoint with the default access token and updates `session.user`.                         | `MonoCloudValidationError` (no session, no default token)              |
| `getTokens`       | Returns matching tokens, auto-refreshing when expired or missing (`{ forceRefresh: true }` to always refresh).| `MonoCloudValidationError`                                             |
| `getSession`      | Returns the persisted session (or `undefined`). Does **not** refresh.                                          | —                                                                      |

`signInSilent`, `refreshSession`, `refetchUserInfo`, and `getTokens` are wrapped in cross-tab + in-flight dedupe locks (`navigator.locks` in secure contexts, `browser-tabs-lock` otherwise) so concurrent callers collapse onto a single network round-trip.

## `MonoCloudWebJSClientOptions`

```ts
interface MonoCloudWebJSClientOptions {
  // Identity (required)
  tenantDomain: string;          // e.g. "https://acme.us.monocloud.com"
  clientId: string;

  // Routes / origin
  appUrl?: string;               // default: window.location.origin — used for redirect URIs + cross-origin postMessage validation
  callbackPath?: string;         // default "/"
  signOutPath?: string;          // default "/"

  // Behavior toggles
  validateIdToken?: boolean;     // default true
  fetchUserinfo?: boolean;       // default true
  federatedSignOut?: boolean;    // default true

  // Time-based settings (seconds)
  authWindowTimeout?: number;    // default 600
  clockSkew?: number;            // default 0 (was 60 in <0.1.2); applied to all time-based claim validations
  clockTolerance?: number;       // default 60; additional tolerance for ALL time-based ID-token claims (exp / nbf / auth_time + maxAge)

  // Popup dimensions (pixels)
  popupWindowWidth?: number;     // default 375
  popupWindowHeight?: number;    // default 600

  // ID token / claims
  filteredIdTokenClaims?: string[]; // default: protocol claims
  idTokenSigningAlgorithm?: SecurityAlgorithms; // default 'RS256' — also selects the SHA digest used to verify at_hash / s_hash in implicit flows; applies to public SPAs, not just confidential clients

  // Authorization defaults (per-request overrides win)
  defaultAuthParams?: DefaultAuthParams;
  resources?: Indicator[];

  // Confidential-client extras (DO NOT use in a normal SPA)
  clientSecret?: string | Jwk;
  clientAuthMethod?: ClientAuthMethod;

  // Caching (seconds)
  jwksCacheDuration?: number;
  metadataCacheDuration?: number;

  // Persistence + integration
  storage?: IStorage;            // default new LocalStorage()
  sessionKey?: string;           // disambiguate same-clientId instances
  postCallback?: PostCallback;   // router integration hook
  onSessionCreating?: OnSessionCreating;
}
```

### `DefaultAuthParams`

```ts
type DefaultAuthParams = Pick<
  AuthorizationParams,
  | 'scopes'
  | 'resource'
  | 'responseType'   // 'code' (default), 'token', 'id_token', 'id_token token',
                     // 'code id_token', 'code token', 'code id_token token'
  | 'prompt'
  | 'display'
  | 'uiLocales'
  | 'acrValues'
  | 'maxAge'
  | 'loginHint'
  | 'authenticatorHint'
  | 'audience'
  | 'idTokenHint'
>;
```

Per-request values (`state`, `nonce`, `codeChallenge`, `codeChallengeMethod`, `redirectUri`) are owned by the SDK and cannot be set here.

For **hybrid response types** (`code id_token`, `code token`, `code id_token token`), the SDK always completes the back-channel authorization code exchange and uses those tokens. The front-channel `id_token` / `access_token` returned in the URL fragment are checked for presence but not validated or stored — the authoritative tokens come from the code exchange.

### `Indicator`

```ts
interface Indicator {
  resource: string;        // space-separated resource indicators
  scopes?: string;         // optional scopes specifically for this resource
}
```

Use `resources` when the app talks to multiple APIs with different audiences. `getTokens({ resource })` then knows which scope set to ask for.

## Per-call option types

### `SignInOptions`

```ts
interface SignInOptions {
  mode?: 'redirect' | 'popup';        // default 'redirect'
  signUp?: boolean;                   // true => prompt=create (wins over `prompt`)
  prompt?: Prompt;
  loginHint?: string;
  authenticatorHint?: Authenticators;
  uiLocales?: string;
  display?: DisplayOptions;
  acrValues?: string[];
  maxAge?: number;
  scopes?: string;                    // merged with defaultAuthParams.scopes
  resource?: string;                  // merged with defaultAuthParams.resource
  audience?: string;                  // target API (audience) for the issued access token
  idTokenHint?: string;               // previously issued ID token, sent as id_token_hint
  returnUrl?: string;                 // surfaced to postCallback
  appState?: ApplicationState;        // surfaced to onSessionCreating
}
```

### `SignInSilentOptions`

```ts
interface SignInSilentOptions {
  maxAge?: number;
  loginHint?: string;
  acrValues?: string[];
  scopes?: string;
  resource?: string;
  appState?: ApplicationState;
}
```

Always runs with `prompt=none` and through a hidden iframe.

### `SignOutOptions`

```ts
interface SignOutOptions {
  idTokenHint?: string;               // sent as id_token_hint; overrides the current session's ID token
  mode?: 'redirect' | 'popup';
  federatedSignOut?: boolean;         // overrides the client-level setting per call
  postLogoutRedirectUri?: string;     // must be registered in the dashboard
  returnUrl?: string;
}
```

### `RefreshOptions`

```ts
interface RefreshOptions {
  refreshGrantOptions?: RefreshGrantOptions;
}

interface RefreshGrantOptions {
  resource?: string;
  scopes?: string;
}
```

### `GetTokensOptions`

```ts
interface GetTokensOptions extends RefreshGrantOptions {
  forceRefresh?: boolean;             // refresh even if the token is still valid
  refetchUserInfo?: boolean;          // re-call UserInfo after refresh
}
```

### `MonoCloudTokens`

```ts
interface MonoCloudTokens extends AccessToken {
  idToken?: string;
  refreshToken?: string;
  isExpired: boolean;                 // true when accessTokenExpiration - 30s < now
}
```

## Session shape

`MonoCloudSession` is re-exported from `@monocloud/auth-core`:

```ts
interface MonoCloudSession {
  user: MonoCloudUser;                // ID-token claims + UserInfo claims (filtered)
  idToken?: string;
  accessTokens?: AccessToken[];
  refreshToken?: string;
  authorizedScopes?: string;          // space-separated
}

interface AccessToken {
  accessToken: string;
  scopes: string;                     // space-separated, actually granted
  requestedScopes?: string;           // space-separated, what we asked for
  resource?: string;                  // audience / resource indicator
  accessTokenExpiration: number;      // unix seconds
}
```

A session can carry multiple `AccessToken`s — one per `(resource, scope-set)`. `getTokens({ resource, scopes })` picks the right one.

## Storage adapter contract

```ts
interface IStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

class LocalStorage   implements IStorage {}
class SessionStorage implements IStorage {}
class MemoryStorage  implements IStorage {}
```

Built-in adapters:

| Class            | Backing                  | Survives tab close? | Shared between tabs? |
| ---------------- | ------------------------ | ------------------- | -------------------- |
| `LocalStorage`   | `window.localStorage`    | yes                 | yes (same origin)    |
| `SessionStorage` | `window.sessionStorage`  | no                  | no                   |
| `MemoryStorage`  | in-memory object         | no                  | no                   |

All three methods **must** return promises. Synchronous backends should wrap with `Promise.resolve(...)`.

### Internal storage keys

| Purpose                        | Key shape                                                                  | Storage backend                  |
| ------------------------------ | -------------------------------------------------------------------------- | -------------------------------- |
| Session                        | `mc.session.<clientId>[.<sessionKey>]`                                     | configured `IStorage` (default `LocalStorage`) |
| Callback state (pre-redirect)  | `mc.state.<clientId>`                                                      | `window.sessionStorage` (always) |
| Lock key for cross-tab dedupe  | `mc.lock.<clientId>[.<sessionKey>]`                                        | `navigator.locks` or `browser-tabs-lock` |

The callback state lives in `sessionStorage` regardless of which `IStorage` you configure — it must survive a redirect but doesn't need to persist beyond the tab.

## Callback hooks

### `PostCallback`

```ts
type PostCallback = (state: CallbackState) => Promise<void> | void;

interface CallbackState extends Partial<AuthState> {
  signOut?: boolean;              // true when this is a sign-out callback
  mode: 'popup' | 'redirect' | 'silent';
  returnUrl?: string;
  appState?: ApplicationState;
  responseType?: ResponseTypes;
}
```

Default implementation: on sign-in, strip `?…` and `#…` from the current URL with `history.replaceState`; if a `returnUrl` is set, do a full page reload to it (origin-checked against `appUrl`). Provide a custom `postCallback` to use your router instead.

### `OnSessionCreating`

```ts
type OnSessionCreating = (
  session: MonoCloudSession,
  idToken?: Partial<IdTokenClaims>,
  userInfo?: UserinfoResponse,
  state?: ApplicationState,
) => Promise<void> | void;
```

Fires every time the SDK is about to persist a new or updated session — after sign-in callback processing, after `refreshSession`, after `refetchUserInfo`, and on silent sign-in. Mutate `session` in place to attach app-specific data.

## Errors

```ts
class MonoCloudAuthBaseError extends Error {}

class MonoCloudOPError extends MonoCloudAuthBaseError {
  error: string;                      // OAuth error code (e.g. 'login_required')
  errorDescription?: string;
}

class MonoCloudValidationError extends MonoCloudAuthBaseError {}
class MonoCloudTokenError      extends MonoCloudAuthBaseError {}
class MonoCloudHttpError       extends MonoCloudAuthBaseError {}
class MonoCloudJsError         extends MonoCloudAuthBaseError {}
```

No status-code field. Use `instanceof` to branch; for `MonoCloudOPError`, also branch on `.error` (`login_required`, `interaction_required`, `access_denied`, `invalid_grant`, etc.).

## Response types and the auth code default

`defaultAuthParams.responseType` defaults to `'code'` (Authorization Code with PKCE). The SDK supports the seven OIDC response types:

`'code'`, `'token'`, `'id_token'`, `'id_token token'`, `'code id_token'`, `'code token'`, `'code id_token token'`.

For normal SPAs, stick with the default — it is the most secure and avoids the front-channel-fragment validation gaps noted in `defaultAuthParams` above.

### Implicit-flow `at_hash` / `s_hash` validation

When `validateIdToken` is `true` (the default) and an implicit-flow response type is used, `processCallback()` runs two additional ID-token integrity checks against the front-channel response:

- **`at_hash`** — required for `responseType: 'id_token token'`. The SDK hashes the front-channel `access_token` using the digest implied by `idTokenSigningAlgorithm` (default `'RS256'` → SHA-256, `'RS384'` → SHA-384, etc.) and compares the result against the ID token's `at_hash` claim. Mismatch or absence throws `MonoCloudValidationError("Invalid 'at_hash' in id token")`.
- **`s_hash`** — when an `s_hash` claim is present on the ID token in any implicit flow, the SDK compares it against the persisted callback `state`. Mismatch throws `MonoCloudValidationError("Invalid 's_hash' in id token")`.

This is why `idTokenSigningAlgorithm` matters even for **public SPAs**: it controls which SHA digest the implicit-flow hash validators use, not just confidential-client signature verification.

## What this SDK does **not** do

- It is browser-only. There are no Node entry points; the constructor references `window`, `document`, `history`, and `navigator`.
- It does not render UI. No buttons, modals, or hosted widget — you call `signIn()` / `signOut()` from your own handlers.
- It does not manage server-side sessions. Cookies are the OP's; tokens live in `IStorage`.
- It does not validate access tokens. That is the API's job (see `@monocloud/backend-node` for Express/Fastify, or implement validation in your server).

## Defaults summary

| Setting               | Default                                            |
| --------------------- | -------------------------------------------------- |
| `appUrl`              | `window.location.origin`                           |
| `storage`             | `new LocalStorage()`                               |
| `callbackPath` / `signOutPath` | `"/"`                                     |
| `validateIdToken`     | `true`                                             |
| `fetchUserinfo`       | `true`                                             |
| `federatedSignOut`    | `true`                                             |
| `authWindowTimeout`   | `600` (sec)                                        |
| `clockSkew`           | `0` (sec) — was `60` in <0.1.2                     |
| `clockTolerance`      | `60` (sec) — applies to all time-based ID-token claims (`exp`, `nbf`, `auth_time + maxAge`) |
| `idTokenSigningAlgorithm` | `'RS256'` — also selects the SHA digest for `at_hash` / `s_hash` |
| `popupWindowWidth`    | `375`                                              |
| `popupWindowHeight`   | `600`                                              |
| `defaultAuthParams.responseType` | `'code'`                                |
| Default scopes when none configured | `'openid profile email'`             |
| Filtered ID-token claims | `iss, exp, nbf, aud, nonce, iat, auth_time, c_hash, at_hash, s_hash` |
