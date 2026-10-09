# API surface — `@monocloud/auth-web-js`

Verified against `@monocloud/auth-web-js@0.2.9` (`monocloud/auth-js` @ `30d7d98`).

## Exports

### `@monocloud/auth-web-js`

| Kind | Exports |
| --- | --- |
| Classes | `MonoCloudWebJSClient`, `MonoCloudOidcClient` (low-level OIDC client), `LocalStorage`, `SessionStorage`, `MemoryStorage` |
| Errors | `MonoCloudAuthBaseError`, `MonoCloudOPError`, `MonoCloudValidationError`, `MonoCloudTokenError`, `MonoCloudHttpError`, `MonoCloudJsError` |
| Types (this package) | `MonoCloudWebJSClientOptions`, `DefaultAuthParams`, `Indicator`, `IStorage`, `InteractionMode`, `ApplicationState`, `OnSessionCreating`, `PostCallback`, `CallbackState`, `SignInOptions`, `SignInSilentOptions`, `SignOutOptions`, `RefreshOptions`, `GetTokensOptions`, `MonoCloudTokens` |
| Types (from `@monocloud/auth-core`) | `MonoCloudSession`, `MonoCloudUser`, `AccessToken`, `IdTokenClaims`, `UserinfoResponse`, `Address`, `Group`, `AuthState`, `AuthorizationParams`, `Authenticators`, `CallbackParams`, `ClientAuthMethod`, `CodeChallengeMethod`, `DisplayOptions`, `EndSessionParameters`, `IssuerMetadata`, `Jwk`, `Jwks`, `JwsHeaderParameters`, `MtlsEndpointAliases`, `ParResponse`, `Prompt`, `PushedAuthorizationParams`, `ResponseModes`, `ResponseTypes`, `SecurityAlgorithms`, `Tokens`, `AuthenticateOptions`, `MonoCloudClientOptionsBase`, `RefreshGrantOptions`, `RefreshSessionOptions`, `RefetchUserInfoOptions` |

Not exported here: `MonoCloudRawResponse`, `MonoCloudTokenErrorCode`, `JwtClaims`, `IsUserInGroupOptions`, `MonoCloudOidcBackendClient`. No default export.

### Subpaths

| Import | Contents |
| --- | --- |
| `@monocloud/auth-web-js/utils` | `isUserInGroup(user, groups, groupsClaim = 'groups', matchAll = false)`, `parseCallbackParams`, `generateState`, `generateNonce`, `generatePKCE`, `encrypt` / `decrypt`, `encryptSession` / `decryptSession`, `encryptAuthState` / `decryptAuthState` |
| `@monocloud/auth-web-js/internal` | SDK-internal helpers — not for application code |

No other subpaths exist (`/client`, `/react`, `/browser` are not real).

## `MonoCloudWebJSClient`

```ts
class MonoCloudWebJSClient {
  constructor(options: MonoCloudWebJSClientOptions);
  readonly oidcClient: MonoCloudOidcClient;

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

| Method | Behavior | Throws (message) |
| --- | --- | --- |
| `processCallback()` | Reads and clears the pending state. Sign-in state on `appUrl + callbackPath`: validates, exchanges the code (or reads the fragment for implicit types), stores the session, awaits `postCallback`. Sign-out state on `appUrl + signOutPath`: clears the session, checks `state`, awaits `postCallback`. Anything else: no-op. In an SDK-opened popup/iframe it posts the URL to the opener/parent instead. | `MonoCloudValidationError` (`Sign in callback states mismatch`, `Sign out states mismatch`, `Response is missing 'code'`, …), `MonoCloudOPError` (`error` in the callback URL), `MonoCloudTokenError`, `MonoCloudHttpError` |
| `signIn(o?)` | Builds the authorize request (PKCE `S256`, `state`, `nonce`). Redirect: saves pending state, `location.assign()`, resolves before unload. Popup: opens `about:blank` synchronously, completes the flow in this page, stores the session, awaits `postCallback`. | `MonoCloudJsError` (`Cannot start a redirect sign-in from inside an iframe: …`, `Could not open popup`, `Window closed by user`, `Authentication window timed out`); popup mode also the callback errors above |
| `signOut(o?)` | Clears the local session first. Non-federated: done. Federated: end-session URL with `id_token_hint` (`o.idTokenHint` ?? session ID token), `post_logout_redirect_uri` (`o.postLogoutRedirectUri` ?? `appUrl + signOutPath`) and `state`, by redirect or popup. | `MonoCloudJsError` (`Cannot start a redirect sign-out from inside an iframe: …` — thrown before clearing; popup errors as above), `MonoCloudValidationError` (`Sign out states mismatch`) |
| `signInSilent(o?)` | Hidden iframe, `prompt=none`; resolves to the stored session. A failure leaves the existing session as is. | `MonoCloudOPError` (`login_required`, `interaction_required`, …), `MonoCloudJsError` (`Cannot create iframe in a cross-origin-isolated context`, `Authentication window timed out`) |
| `refreshSession(o?)` | Refresh-token grant with `o.refreshGrantOptions` (`resource`, `scope`); UserInfo when `fetchUserinfo`; stores the session. | `MonoCloudValidationError` (`Ensure the user is authenticated before refreshing the session`, `Refresh token not found. Sign in with offline_access scope to get the refresh token.`), `MonoCloudOPError` (`invalid_grant`, …) |
| `refetchUserInfo()` | UserInfo with the stored default access token (matching `defaultAuthParams.resource` and the session's `authorizedScopes`; not refreshed), merged into `session.user`. | `MonoCloudValidationError` (`Ensure the user is authenticated before refetching userinfo`, `Default token not found`, `Fetching userinfo requires the openid scope`), `MonoCloudTokenError` (UserInfo 401/403) |
| `getTokens(o?)` | Returns a stored access token, refreshing first when none matches, it expires within 30 s, or `o.forceRefresh`. See [Token selection](#token-selection-in-gettokens). | `MonoCloudValidationError` (`Session does not exist`, `Session does not contain refresh token`), refresh-grant errors |
| `getSession()` | Reads and parses the stored session; never refreshes or validates. | storage errors; `SyntaxError` for a corrupted stored value |

### Token selection in `getTokens()`

- `resource` = `o.resource` ?? `defaultAuthParams.resource`.
- `scopes` = `o.scopes`; if `o.resource` is given without `o.scopes`, the `scopes` of the `resources` entry with the same resource set.
- With neither `o.resource` nor `o.scopes`, the token requested at sign-in (`session.authorizedScopes`) is used.
- Matching is set-equality on the token's `resource` and `requestedScopes`.
- A refresh sends `resource` / `scopes` as the grant's `resource` / `scope`, stores the new token alongside the others (one per resource + scope set), and fetches UserInfo only when `o.refetchUserInfo` is `true`.
- Result: the token's fields plus `idToken`, `refreshToken`, `isExpired` (`accessTokenExpiration - 30 < now`).

### Locking

`signInSilent`, `refreshSession`, `refetchUserInfo` and `getTokens` run inside a deduplicating lock:

- Concurrent calls in the same tab with identical arguments share one in-flight promise (so React StrictMode's double effects don't double-fire).
- All four share one lock per client — `mc.lock.<clientId>[.<sessionKey>]` via `navigator.locks` in secure contexts, `browser-tabs-lock` otherwise — so they run one at a time, across tabs too.
- Waiting more than 5 s for the lock rejects with `MonoCloudJsError` (`Failed to acquire lock: …` or `Failed to acquire lock.`), e.g. a `getTokens()` issued while a slow `signInSilent()` holds it.

## `MonoCloudWebJSClientOptions`

```ts
interface MonoCloudWebJSClientOptions {
  tenantDomain: string;            // 'https://acme.us.monocloud.com' — 'https://' prepended if missing, trailing '/' removed
  clientId: string;
  appUrl?: string;                 // default window.location.origin; trailing '/' removed; may include a base path
  callbackPath?: string;           // default '/'; leading '/' added if missing
  signOutPath?: string;            // default '/'
  defaultAuthParams?: DefaultAuthParams;
  resources?: Indicator[];         // { resource: string; scopes?: string } — both space-separated
  storage?: IStorage;              // default new LocalStorage()
  sessionKey?: string;             // suffix for session + lock keys
  postCallback?: PostCallback;
  onSessionCreating?: OnSessionCreating;
  federatedSignOut?: boolean;      // default true
  fetchUserinfo?: boolean;         // default true
  validateIdToken?: boolean;       // default true
  idTokenSigningAlgorithm?: SecurityAlgorithms; // default 'RS256'; RS/PS/ES 256|384|512
  filteredIdTokenClaims?: string[]; // removed from session.user; default iss, exp, nbf, aud, nonce, iat, auth_time, c_hash, at_hash, s_hash
  clockSkew?: number;              // seconds added to "now" for ID-token checks; default 0
  clockTolerance?: number;         // seconds of leeway for exp / nbf / auth_time + max_age; default 60
  authWindowTimeout?: number;      // seconds, popup + silent iframe; default 600
  popupWindowWidth?: number;       // px, default 375
  popupWindowHeight?: number;      // px, default 600
  jwksCacheDuration?: number;      // seconds, default 300
  metadataCacheDuration?: number;  // seconds, default 300
  clientSecret?: string | Jwk;     // confidential clients only — never in a browser bundle
  clientAuthMethod?: ClientAuthMethod; // default 'client_secret_basic'
}
```

The ID token must also carry `iss` equal to the normalized `tenantDomain`, `aud` containing `clientId`, and a header `alg` equal to `idTokenSigningAlgorithm`.

### `DefaultAuthParams`

Typed as `Pick<AuthorizationParams, 'scopes' | 'resource' | 'responseType' | 'prompt' | 'display' | 'uiLocales' | 'acrValues' | 'maxAge' | 'loginHint' | 'authenticatorHint' | 'audience' | 'idTokenHint'>`, but the client reads only:

| Key | Effect |
| --- | --- |
| `scopes` | Merged (deduplicated) with per-call `scopes` and every `resources[].scopes`. Only when all are empty is `'openid profile email'` used. |
| `resource` | Merged with per-call `resource` and every `resources[].resource` on the authorize request; also the `resource` for the code exchange, `getTokens()` and `refetchUserInfo()` defaults. |
| `responseType` | Default `'code'`. Also `'token'`, `'id_token'`, `'id_token token'`, `'code id_token'`, `'code token'`, `'code id_token token'`. |

The other keys are not sent — pass `prompt`, `display`, `uiLocales`, `acrValues`, `maxAge`, `loginHint`, `authenticatorHint`, `audience`, `idTokenHint` to `signIn()`. `state`, `nonce`, `codeChallenge`, `codeChallengeMethod` (`S256`) and `redirectUri` are always generated by the SDK.

### Response types

Keep `'code'` (Authorization Code + PKCE). Hybrid types always complete the back-channel code exchange and use those tokens; the front-channel `id_token` / `access_token` are only checked for presence. Implicit types (`token`, `id_token`, `id_token token`) are read from the URL fragment; with `validateIdToken`:

- `'id_token token'` requires a matching `at_hash` → otherwise `MonoCloudValidationError: Invalid 'at_hash' in id token`.
- An `s_hash`, when present, must match the `state` → `Invalid 's_hash' in id token`.
- Both hashes use the SHA size of `idTokenSigningAlgorithm` (`RS256` → SHA-256, `RS384` → SHA-384, …).

Implicit access tokens also need `expires_in` in the callback (`The 'expires_in' parameter is missing from the callback`) and, with `fetchUserinfo`, the `openid` scope (`Fetching userinfo requires the openid scope`).

## Per-call options

```ts
interface SignInOptions {
  mode?: InteractionMode;              // 'redirect' (default) | 'popup'
  signUp?: boolean;                    // prompt=create; wins over `prompt`
  returnUrl?: string;                  // relative URL handed to postCallback
  appState?: ApplicationState;         // Record<string, unknown>; JSON-serializable (redirects keep it in sessionStorage); 4th arg of onSessionCreating
  scopes?: string;                     // merged with defaultAuthParams.scopes + resources[].scopes
  resource?: string;                   // merged with defaultAuthParams.resource + resources[].resource
  audience?: string;
  prompt?: Prompt;                     // 'none' | 'login' | 'consent' | 'select_account' | 'create' | string
  loginHint?: string;
  authenticatorHint?: Authenticators;  // 'password' | 'passkey' | 'email' | 'phone' | connection name
  uiLocales?: string;
  display?: DisplayOptions;            // 'page' | 'popup' | 'touch' | 'wap' | string
  acrValues?: string[];
  maxAge?: number;                     // seconds; also enforced against the ID token's auth_time
  idTokenHint?: string;
}

interface SignInSilentOptions {        // always prompt=none in a hidden iframe
  scopes?: string;
  resource?: string;
  maxAge?: number;
  loginHint?: string;
  acrValues?: string[];
  appState?: ApplicationState;
}

interface SignOutOptions {
  mode?: InteractionMode;              // default 'redirect'
  federatedSignOut?: boolean;          // overrides the client setting for this call
  postLogoutRedirectUri?: string;      // replaces appUrl + signOutPath; must be a registered Sign-out URL
  idTokenHint?: string;                // overrides the session's ID token
  returnUrl?: string;                  // handed to postCallback
}

interface RefreshOptions { refreshGrantOptions?: RefreshGrantOptions }
interface RefreshGrantOptions { resource?: string; scopes?: string }    // must be within what was granted
interface GetTokensOptions extends RefreshGrantOptions {
  forceRefresh?: boolean;
  refetchUserInfo?: boolean;           // fetch UserInfo when a refresh happens
}
interface MonoCloudTokens extends AccessToken { idToken?: string; refreshToken?: string; isExpired: boolean }
```

A popup sign-out can only finish on `appUrl + signOutPath`; with a different `postLogoutRedirectUri`, use redirect mode (a popup ends with `Window closed by user` or a timeout).

## Session shape

```ts
interface MonoCloudSession {
  user: MonoCloudUser;                 // ID-token claims (minus filteredIdTokenClaims) merged with UserInfo
  idToken?: string;
  accessTokens?: AccessToken[];        // one per resource + scope set
  refreshToken?: string;
  authorizedScopes?: string;           // scopes requested at sign-in
  [key: string]: unknown;              // custom fields added in onSessionCreating
}

interface AccessToken {
  accessToken: string;
  accessTokenExpiration: number;       // epoch seconds
  scopes: string;                      // granted
  requestedScopes?: string;
  resource?: string;
}

interface MonoCloudUser extends UserinfoResponse { amr?: string[]; idp?: string }
// UserinfoResponse: sub, name, given_name, family_name, email, email_verified, picture, groups?: Group[], …, [claim: string]: unknown
// Group = string | { id: string; name: string }
```

## Storage

```ts
interface IStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

`LocalStorage` (default), `SessionStorage` and `MemoryStorage` implement it.

| Key | Location | Content |
| --- | --- | --- |
| `mc.session.<clientId>[.<sessionKey>]` | configured `IStorage` | JSON session |
| `mc.state.<clientId>` | always `window.sessionStorage` | pending flow (`state`, `nonce`, PKCE verifier, `scopes`, `mode`, `returnUrl`, `appState`, …) — keyed by `clientId` only, not `sessionKey` |
| `mc.lock.<clientId>[.<sessionKey>]` | `navigator.locks` / `browser-tabs-lock` | operation lock |

## Hooks

```ts
type PostCallback = (state: CallbackState) => Promise<void> | void;

interface CallbackState extends Partial<AuthState> {  // AuthState: state, nonce, codeVerifier?, maxAge?, resource?, scopes
  mode: 'popup' | 'redirect' | 'silent';
  signOut?: boolean;
  returnUrl?: string;
  appState?: ApplicationState;
  responseType?: ResponseTypes;
}

type OnSessionCreating = (
  session: MonoCloudSession,           // mutate in place; stored afterwards
  idToken?: Partial<IdTokenClaims>,
  userInfo?: UserinfoResponse,
  state?: ApplicationState,            // appState — sign-in flows only
) => Promise<void> | void;
```

- `postCallback` runs in the main window, and is awaited, after: redirect sign-in (via `processCallback()`), popup and silent sign-in, redirect and popup federated sign-out. Never after a non-federated sign-out or a refresh.
- Default `postCallback`: no `returnUrl` → strip query and hash with `history.replaceState`; `returnUrl` resolving to `appUrl`'s origin → `window.location.href = …` (full load, logging a warning about `MemoryStorage`); other origins → `console.warn('Ignoring returnUrl "…" because it resolves to a different origin than appUrl.')`, no navigation.
- `onSessionCreating` runs before each session write that builds a session: sign-in (all modes), `refreshSession()`, the refresh inside `getTokens()`, and `refetchUserInfo()` (with `idToken` undefined).

## `client.oidcClient` (`MonoCloudOidcClient`)

Low-level OIDC client sharing the tenant, `clientId` and metadata/JWKS caches. Calling it directly bypasses session storage.

| Member | Purpose |
| --- | --- |
| `revokeToken(token, tokenType?)` | Revoke a token (`tokenType`: `'access_token'` \| `'refresh_token'`). The stored session is not changed. |
| `userinfo(accessToken)` | Raw UserInfo call. |
| `getMetadata(forceRefresh?)` / `getJwks(forceRefresh?)` | Discovery document / JWKS, cached for `metadataCacheDuration` / `jwksCacheDuration`. |
| `MonoCloudOidcClient.decodeJwt(jwt)` (static) | Decodes a JWT payload **without verifying it**; throws `MonoCloudTokenError` (`JWT does not contain payload`, `Payload is not an object`, `Could not parse payload. Malformed payload`). |

Also present (used internally by `MonoCloudWebJSClient`): `authorizationUrl`, `exchangeAuthorizationCode`, `authenticate`, `refreshGrant`, `refreshSession`, `refetchUserInfo`, `endSessionUrl`, `validateIdToken`, `pushedAuthorizationRequest`, device-flow methods.

## Errors

```ts
class MonoCloudAuthBaseError extends Error {
  readonly raw?: { status: number; statusText: string; headers: Record<string, string>; body: string };
}
class MonoCloudOPError extends MonoCloudAuthBaseError { error: string; errorDescription?: string } // message === error
class MonoCloudValidationError extends MonoCloudAuthBaseError {}
class MonoCloudTokenError extends MonoCloudAuthBaseError {
  readonly code: 'invalid_token' | 'inactive_token' | 'insufficient_scope' | 'insufficient_groups';
}
class MonoCloudHttpError extends MonoCloudAuthBaseError {
  get status(): number | undefined;
  get statusText(): string | undefined;
}
class MonoCloudJsError extends MonoCloudAuthBaseError {}
```

- `raw` is set only on errors built from an HTTP response (headers exclude `set-cookie`). Its type `MonoCloudRawResponse` is not exported — inline the shape.
- In the browser `MonoCloudTokenError.code` is `'insufficient_scope'` (UserInfo `WWW-Authenticate: error="insufficient_scope"`) or `'invalid_token'`; `'inactive_token'` / `'insufficient_groups'` come from backend token validation.
- `MonoCloudOPError` sources: `error` in the callback URL; token or revocation endpoint 400/401 (`code_grant_failed`, `refresh_grant_failed` or `revocation_failed` when the body has no `error`).
- `MonoCloudHttpError` messages: `Error while fetching metadata. Unexpected status code: <n>` (likewise JWKS, userinfo, `token grant`, `refresh token grant`); the browser's fetch error text on network/CORS failure (no `status`); `Failed to parse response body as JSON…`.
- ID-token validation messages are listed in [troubleshooting.md](troubleshooting.md#id-token-validation-errors-monocloudtokenerror).

## Scope of the SDK

- Browser only: flows use `window`, `document`, `history`, `sessionStorage` and Web Locks.
- No UI: wire `signIn()` / `signOut()` to your own controls (React components live in `@monocloud/auth-react`).
- No server sessions and no access-token validation — APIs validate tokens themselves (`@monocloud/backend-node`).
