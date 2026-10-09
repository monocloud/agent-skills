# API surface — `@monocloud/auth-nextjs`

Verified against `@monocloud/auth-nextjs@0.2.10` (`monocloud/auth-js` @ `30d7d98`).

Every export per subpath, with condensed signatures. Protection-helper option types and behavior are in [protecting.md](protecting.md).

## `@monocloud/auth-nextjs` (root)

### Functions

Each delegates to a lazily created `MonoCloudNextClient` singleton configured from env vars; the same methods exist on your own instance.

| Export | Call shapes → result |
| --- | --- |
| `authMiddleware` | `(options?: MonoCloudMiddlewareOptions)` → `NextMiddleware \| NextProxy`; or `(req: NextRequest, evt: NextFetchEvent)` → `NextMiddlewareResult` (call it inside your own middleware) |
| `monoCloudAuth` | `(options?: MonoCloudAuthOptions)` → `MonoCloudAuthHandler` — catch-all route handler for App and Pages Router |
| `getSession` | `(options?)` · `(req, options?)` · `(req, res, options?)` → `Promise<MonoCloudSession \| undefined>`; `options: GetSessionOptions` |
| `getTokens` | same shapes, `options: GetTokensOptions` → `Promise<MonoCloudTokens>` |
| `isAuthenticated` | `()` · `(req, res?)` · Pages `(req, res)` → `Promise<boolean>` |
| `isUserInGroup` | `(groups, options?)` · `(req, groups, options?)` · `(req, res, groups, options?)` → `Promise<boolean>`; `options: IsUserInGroupOptions` (`groupsClaim?`, `matchAll?`); `false` without a session |
| `protect` | `(options?: ProtectOptions)` → `Promise<void>` — App Router only |
| `protectApi` | `(handler: AppRouterApiHandlerFn, options?: ProtectApiAppOptions)` · `(handler: NextApiHandler, options?: ProtectApiPageOptions)` → wrapped handler |
| `protectPage` | `(component: ProtectedAppServerComponent, options?: ProtectAppPageOptions)` → `AppRouterPageHandler` · `(options?: ProtectPagePageOptions<P, Q>)` → `getServerSideProps` |
| `redirectToSignIn` | `(options?: RedirectToSignInOptions)` → `Promise<void>` — App Router only; never resolves (`redirect()`) |
| `redirectToSignOut` | `(options?: RedirectToSignOutOptions)` → `Promise<void>` — App Router only; never resolves |

- `req`/`res`: Web `Request`/`NextRequest` + `Response`/`NextResponse`, or Pages Router `NextApiRequest`/`IncomingMessage` + `NextApiResponse`/`ServerResponse` (both required). With no `req`, the helpers use `next/headers` cookies.
- Malformed arguments throw `MonoCloudValidationError` (e.g. `Invalid parameters passed to getSession()`, `Invalid pages router request and response`).
- `RedirectToSignInOptions` = `ExtraAuthParams & { returnUrl? }`; `RedirectToSignOutOptions` = `{ postLogoutRedirectUri?, federated? }` (sent as `post_logout_url` / `federated`).
- `MonoCloudAuthOptions = { onError?: OnError }` — `AppOnError` `(req, ctx, error)` or `PageOnError` `(req, res, error)`; `authMiddleware({ onError })` takes `(req, evt, error)`. It runs for failures in sign-in, callback, userinfo, sign-out and back-channel logout and must return a `NextResponse` or throw (App Router) or send a response (Pages Router), otherwise the request hangs.

### `MonoCloudNextClient`

```ts
class MonoCloudNextClient {
  constructor(options?: MonoCloudOptions); // missing/invalid config only warns here; auth routes throw on first use
  get coreClient(): MonoCloudCoreClient;   // framework-agnostic client from @monocloud/auth-node-core
  get oidcClient(): MonoCloudOidcClient;   // raw OIDC client from @monocloud/auth-core
  // plus every function above as an instance method:
  // authMiddleware, monoCloudAuth, getSession, getTokens, isAuthenticated, isUserInGroup,
  // protect, protectApi, protectPage, redirectToSignIn, redirectToSignOut
}
```

The constructor also copies every `NEXT_PUBLIC_MONOCLOUD_AUTH_*` env var over its server counterpart (`MONOCLOUD_AUTH_*`).

### Errors

All extend `MonoCloudAuthBaseError` (extends `Error`, `raw?: { status, statusText, headers, body }` of the failing HTTP response).

| Class | Thrown for | Extra fields |
| --- | --- | --- |
| `MonoCloudValidationError` | invalid config/arguments, `getTokens()` without a session, callback state problems | — |
| `MonoCloudOPError` | OAuth error from MonoCloud (callback `error=`, token/PAR/revocation `400`/`401`) | `error`, `errorDescription` |
| `MonoCloudTokenError` | ID-token or logout-token validation failure; UserInfo rejecting the access token (`401`/`403`); expired access token with no refresh token | `code` (`'invalid_token'`, `'insufficient_scope'`, …) |
| `MonoCloudHttpError` | network failure, timeout, unexpected status, unparsable body | `status`, `statusText` |

### Types

SDK-defined: `MonoCloudAuthOptions`, `MonoCloudMiddlewareOptions`, `MonoCloudAuthHandler`, `NextMiddlewareResult`, `NextMiddlewareOnAccessDenied`, `NextMiddlewareOnGroupAccessDenied`, `ProtectedRoutes`, `ProtectedRouteMatcher`, `CustomProtectedRouteMatcher`, `OnError`, `AppOnError`, `PageOnError`, `AppRouterContext`, `AppRouterApiHandlerFn`, `AppRouterPageHandler`, `ExtraAuthParams`, `GroupOptions`, `IsUserInGroupOptions`, `ProtectOptions`, `RedirectToSignInOptions`, `RedirectToSignOutOptions`, `ProtectApiAppOptions`, `ProtectApiPageOptions`, `ProtectAppPageOptions`, `ProtectPagePageOptions`, `ProtectPagePageReturnType`, `ProtectPagePageOnAccessDeniedType`, `ProtectPagePageOnGroupAccessDeniedType`, `ProtectPageGetServerSidePropsContext`, `ProtectedAppServerComponent`, `ProtectedAppServerComponentProps`, `AppRouterApiOnAccessDeniedHandler`, `AppRouterApiOnGroupAccessDeniedHandler`, `PageRouterApiOnAccessDeniedHandler`, `PageRouterApiOnGroupAccessDeniedHandler`.

Re-exported from `@monocloud/auth-node-core`: `MonoCloudOptions`, `MonoCloudSession`, `MonoCloudUser`, `MonoCloudTokens`, `AccessToken`, `GetSessionOptions`, `GetTokensOptions`, `ApplicationState`, `MonoCloudRequest`, `Indicator`, `MonoCloudSessionOptions`, `MonoCloudSessionOptionsBase`, `MonoCloudSessionStore`, `MonoCloudCookieOptions`, `MonoCloudStateCookieOptions`, `SessionLifetime`, `SameSiteValues`, `UserinfoResponse`, `Address`, `Authenticators`, `DisplayOptions`, `AuthorizationParams`, `MonoCloudRoutes`, `MonoCloudStateOptions`, `MonoCloudStatePartialOptions`, `IdTokenClaims`, `Group`, `Jwk`, `Jwks`, `IssuerMetadata`, `MtlsEndpointAliases`, `Prompt`, `CodeChallengeMethod`, `ResponseTypes`, `ResponseModes`, `SecurityAlgorithms`, `OnSessionCreating`, `OnBackChannelLogout`, `OnSetApplicationState`.

`ClientAuthMethod`, `MonoCloudCoreClient` and `MonoCloudOidcClient` are not exported from this package.

## `MonoCloudOptions` (constructor)

Every field is optional; precedence is constructor value → env var → default. Env names are in [Environment variables](#environment-variables).

```ts
interface MonoCloudOptions {
  tenantDomain?: string;                  // https:// URL; must equal the token issuer
  clientId?: string;
  clientSecret?: string | Jwk;            // JWK for 'private_key_jwt'; the JWT-SVID for 'spiffe_jwt'
  clientAuthMethod?: ClientAuthMethod;    // 'client_secret_basic'
  trustStoreId?: string;                  // mTLS methods: use mtls_additional_endpoint_aliases[trustStoreId]
  appUrl?: string;
  cookieSecret?: string;
  routes?: Partial<MonoCloudRoutes>;      // { signIn, callback, userInfo, signOut, backChannelLogout } — relative paths
  defaultAuthParams?: AuthorizationParams; // { scopes: 'openid profile email', responseType: 'code' }
  resources?: Indicator[];                // extra { resource, scopes? } requested at sign-in; getTokens({ resource }) looks up its scopes here
  usePar?: boolean;                       // false — Pushed Authorization Requests
  postLogoutRedirectUri?: string;         // absolute or relative; default appUrl
  federatedSignOut?: boolean;             // true — sign-out also ends the MonoCloud session
  fetchUserInfo?: boolean;                // true — call UserInfo after the code exchange
  refetchUserInfo?: boolean;              // false — re-fetch UserInfo on every userinfo-route call and token refresh
  allowQueryParamOverrides?: boolean;     // true — honor the query params listed under Auth routes
  strictProfileSync?: boolean;            // false — replace (not merge) session.user when the profile is refreshed
  idTokenSigningAlg?: SecurityAlgorithms; // 'RS256' — also required of logout tokens
  filteredIdTokenClaims?: string[];       // dropped from session.user: iss exp nbf aud nonce iat auth_time c_hash at_hash s_hash
  groupsClaim?: string;                   // 'groups'
  clockSkew?: number;                     // 0 s, >= 0 — added to "now" in token time checks
  clockTolerance?: number;                // 60 s, >= 0 — leeway for exp / nbf / auth_time + max_age
  responseTimeout?: number;               // 10000 ms, >= 1000 — aborts any request to MonoCloud
  jwksCacheDuration?: number;             // 300 s
  metadataCacheDuration?: number;         // 300 s
  session?: MonoCloudSessionOptions;
  state?: MonoCloudStatePartialOptions;
  fetcher?: typeof fetch;                 // used for every request to MonoCloud
  metadataResolver?: () => IssuerMetadata | Promise<IssuerMetadata>; // replaces discovery
  jwksResolver?: () => Jwks | Promise<Jwks>;                          // replaces the JWKS fetch
  userAgent?: string;                     // '@monocloud/auth-nextjs@<version>'; not sent as a request header
  debugger?: string;                      // debug namespace, '@monocloud:auth-nextjs'
  onSessionCreating?: OnSessionCreating;
  onSetApplicationState?: OnSetApplicationState;
  onBackChannelLogout?: OnBackChannelLogout;
}

interface AuthorizationParams {
  scopes?: string;               // space-separated; must include 'openid' in defaultAuthParams
  resource?: string;             // space-separated absolute URLs, no query/hash
  audience?: string;             // sent as `audience`
  prompt?: Prompt;               // 'none' | 'login' | 'consent' | 'select_account' | 'create' | string
  display?: DisplayOptions;      // 'page' | 'popup' | 'touch' | 'wap' | string
  uiLocales?: string;
  acrValues?: string[];
  authenticatorHint?: Authenticators; // 'password' | 'passkey' | 'email' | 'phone' | connection name
  maxAge?: number;               // seconds; the ID token must then carry auth_time
  loginHint?: string;
  idTokenHint?: string;          // sent as `id_token_hint`
  responseType?: ResponseTypes;  // defaultAuthParams accepts only 'code'
  responseMode?: ResponseModes;  // defaultAuthParams accepts 'query' | 'form_post'
  redirectUri?: string; state?: string; nonce?: string; codeChallenge?: string; // normally left to the SDK
  codeChallengeMethod?: CodeChallengeMethod; request?: string; requestUri?: string;
}

type ExtraAuthParams = Pick<AuthorizationParams,
  'scopes' | 'resource' | 'prompt' | 'display' | 'uiLocales' | 'acrValues'
  | 'authenticatorHint' | 'maxAge' | 'loginHint' | 'audience' | 'idTokenHint'>;

interface Indicator { resource: string; scopes?: string } // both space-separated

interface MonoCloudSessionOptions {
  cookie?: Partial<MonoCloudCookieOptions>;
  sliding?: boolean;         // false
  duration?: number;         // 86400 s — absolute lifetime, or idle timeout when sliding
  maximumDuration?: number;  // 604800 s — hard cap from creation; must be greater than duration
  store?: MonoCloudSessionStore;
}

interface MonoCloudCookieOptions {
  name: string;          // session: 'session' (split into session.0, session.1, … above ~4 KB)
  path: string;          // '/'
  domain?: string;
  httpOnly: boolean;     // true
  secure: boolean;       // defaults to (appUrl is https:) and must equal it
  sameSite: SameSiteValues; // 'strict' | 'lax' | 'none'; default 'lax'
  persistent: boolean;   // true; false = browser-session cookie
}

interface MonoCloudStatePartialOptions {
  cookie?: Partial<MonoCloudStateCookieOptions>; // = MonoCloudCookieOptions without `persistent`; name 'state', httpOnly always true
  duration?: number;      // 900 s, integer >= 300 — lifetime of a sign-in transaction
  maxConcurrent?: number; // 5, integer 1–20 — pending sign-ins kept (oldest evicted; 1 = sequential)
}
// One cookie per pending sign-in, named `<state cookie name>.<hash>`; SameSite=None when responseMode is 'form_post'.
// The state and session cookie names must differ, and neither may start with "<other name>.".

interface MonoCloudSessionStore {
  get(key: string): Promise<MonoCloudSession | undefined | null>;
  set(key: string, data: MonoCloudSession, lifetime: SessionLifetime): Promise<void>;
  delete(key: string): Promise<void>;
}
interface SessionLifetime { c: number; u: number; e?: number } // created / updated / expires, epoch seconds

type OnSessionCreating = (session: MonoCloudSession, idToken?: Partial<IdTokenClaims>,
  userInfo?: UserinfoResponse, state?: ApplicationState) => Promise<void> | void; // mutate `session` to add fields
type OnSetApplicationState = (req: MonoCloudRequest) => ApplicationState | Promise<ApplicationState>; // must return an object
type OnBackChannelLogout = (sub?: string, sid?: string) => Promise<void> | void;
interface ApplicationState extends Record<string, any> {}
type SecurityAlgorithms = 'RS256' | 'RS384' | 'RS512' | 'PS256' | 'PS384' | 'PS512' | 'ES256' | 'ES384' | 'ES512';
```

- With a `store`, the cookie holds only `{ key, lifetime }`; the key is a random UUID per sign-in. Without one, the whole session is encrypted into the cookie (AES-GCM, key derived from `cookieSecret` via PBKDF2).
- `ApplicationState` returned by `onSetApplicationState` at sign-in is handed back as the 4th argument of `onSessionCreating` after the callback.
- mTLS methods (`tls_client_auth`, `self_signed_tls_client_auth`, `spiffe_x509`) send only `client_id`; the client certificate must be presented at the TLS layer of the `fetcher` you supply.

## Session, user and token models

```ts
interface MonoCloudSession {
  user: MonoCloudUser;
  idToken?: string;
  authorizedScopes?: string;
  accessTokens?: AccessToken[];   // one per resource/scope combination
  refreshToken?: string;
  [key: string]: unknown;         // fields added in onSessionCreating
}

interface MonoCloudUser extends UserinfoResponse { amr?: string[]; idp?: string }
// UserinfoResponse: sub, name, given_name, family_name, email, email_verified, picture, groups?: Group[], … [key: string]: unknown
type Group = string | { id: string; name: string };

interface AccessToken {
  accessToken: string;
  accessTokenExpiration: number;  // epoch seconds
  scopes: string;                 // granted
  resource?: string;
  requestedScopes?: string;
}
interface MonoCloudTokens extends AccessToken { idToken?: string; refreshToken?: string; isExpired: boolean }

interface GetSessionOptions { refetchUserInfo?: boolean }  // throws 'Access token not found' if no default token
interface GetTokensOptions {
  forceRefresh?: boolean;
  refetchUserInfo?: boolean;
  resource?: string;  // must have been granted at sign-in; scopes default to the matching `resources` entry
  scopes?: string;
}
```

## `@monocloud/auth-nextjs/client`

```ts
function useAuth(): AuthenticationState;
interface AuthenticationState {
  isLoading: boolean;
  isAuthenticated: boolean;
  error?: Error;                         // 'Failed to fetch user' for non-2xx responses
  user?: MonoCloudUser;
  refetch: (refresh?: boolean) => void;  // true → ?refresh=true; no-op until a user has loaded
}

function protectClientPage<P extends object>(
  Component: React.ComponentType<P & { user: MonoCloudUser }>,
  options?: ProtectClientPageOptions,
): React.FC<P>;
interface ProtectClientPageOptions extends GroupOptions { // groups?, groupsClaim?, matchAll?
  returnUrl?: string;
  authParams?: ExtraAuthParams;
  onAccessDenied?: () => React.ReactNode;
  onGroupAccessDenied?: (user: MonoCloudUser) => React.ReactNode;
  onError?: (error: Error) => React.ReactNode; // without it, a useAuth() error is thrown during render
}
```

Client helpers resolve routes from `NEXT_PUBLIC_MONOCLOUD_AUTH_USER_INFO_URL` / `_SIGNIN_URL` / `_SIGNOUT_URL`, else the Next.js `basePath` + the default path. A `NEXT_PUBLIC_` value is used verbatim — include the `basePath` yourself.

## `@monocloud/auth-nextjs/components`

Render `<a href="…">`; other anchor attributes pass through. Return `React.ReactNode`.

```ts
function SignIn(props: SignInProps & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'resource'>): React.ReactNode;
interface SignInProps extends ExtraAuthParams { children: React.ReactNode; returnUrl?: string }

function SignUp(props: SignUpProps & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'resource'>): React.ReactNode;
interface SignUpProps extends Omit<ExtraAuthParams, 'authenticatorHint' | 'loginHint' | 'prompt'> { returnUrl?: string }
// always adds prompt=create

function SignOut(props: SignOutProps & React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactNode;
interface SignOutProps {
  children: React.ReactNode;
  postLogoutUrl?: string;  // → post_logout_url
  federated?: boolean;     // → federated
  idTokenHint?: string;    // → id_token_hint; overrides the session's ID token
}
```

## `@monocloud/auth-nextjs/components/client`

```ts
function RedirectToSignIn(props: RedirectToSignInProps): null; // window.location.assign(...) on mount
interface RedirectToSignInProps extends ExtraAuthParams { returnUrl?: string } // default return URL: current page

function Protected(props: ProtectedComponentProps): React.ReactNode | null;
interface ProtectedComponentProps {
  children: React.ReactNode;
  groups?: string[];
  groupsClaim?: string;
  matchAllGroups?: boolean;   // not `matchAll`
  fallback?: React.ReactNode; // shown when signed out or on error
  onGroupAccessDenied?: (user: MonoCloudUser) => React.ReactNode; // default renders nothing
}
```

## Auth routes

Served by `authMiddleware()` (before any protection check) or `monoCloudAuth()`. Any other method → `405`. Unhandled errors → empty `500` plus `console.error`, unless `onError` is supplied.

| Route (default) | Env override | Client mirror (read by) | Contract |
| --- | --- | --- | --- |
| `/api/auth/signin` | `MONOCLOUD_AUTH_SIGNIN_URL` | `NEXT_PUBLIC_MONOCLOUD_AUTH_SIGNIN_URL` (`<SignIn>`, `<SignUp>`, `<RedirectToSignIn>`, `protectClientPage`) | `GET` → `307` to MonoCloud. Query: `return_url`, `prompt`, `login_hint`, `authenticator_hint`, `scope`, `resource`, `audience`, `id_token_hint`, `acr_values`, `display`, `ui_locales`, `max_age` |
| `/api/auth/callback` | `MONOCLOUD_AUTH_CALLBACK_URL` | — | `GET` or `POST` (`form_post`) → sets the session, `307` to `return_url` |
| `/api/auth/userinfo` | `MONOCLOUD_AUTH_USER_INFO_URL` | `NEXT_PUBLIC_MONOCLOUD_AUTH_USER_INFO_URL` (`useAuth`) | `GET` → `200` user JSON, `204` without a session. Query: `refresh=true` |
| `/api/auth/signout` | `MONOCLOUD_AUTH_SIGNOUT_URL` | `NEXT_PUBLIC_MONOCLOUD_AUTH_SIGNOUT_URL` (`<SignOut>`) | `GET` → clears the session, `307` to MonoCloud's end-session endpoint (federated) or the post-logout URL. Query: `post_logout_url`, `federated`, `id_token_hint` |
| `/api/auth/backchannel-logout` | `MONOCLOUD_AUTH_BACK_CHANNEL_LOGOUT_URL` | — | `POST` form `logout_token` → `204`; `404` without `onBackChannelLogout`; `400 {"error":"invalid_request","error_description":"The logout token is missing or invalid."}` |

- Query parameters are honored only while `allowQueryParamOverrides` is `true`; `scope`/`resource` from the query replace the configured defaults for that sign-in.
- `return_url` must be relative or share `appUrl`'s origin, otherwise the user lands on `appUrl`. The post-logout URL precedence is `post_logout_url` query → `postLogoutRedirectUri` → `appUrl`; without a session, sign-out just redirects there.
- A completed sign-in or a sign-out discards every other pending sign-in transaction.

## Environment variables

Constructor options win over env vars. Booleans accept only `true`/`false` (case-insensitive); numbers are parsed with `parseInt`; other values are ignored and the default applies.

| Env var | Option | Default / rules |
| --- | --- | --- |
| `MONOCLOUD_AUTH_TENANT_DOMAIN` | `tenantDomain` | **Required.** `https://` URL equal to the issuer |
| `MONOCLOUD_AUTH_CLIENT_ID` | `clientId` | **Required** |
| `MONOCLOUD_AUTH_CLIENT_SECRET` | `clientSecret` | **Required** for every auth method. JSON with a string `kty` is parsed as a JWK |
| `MONOCLOUD_AUTH_CLIENT_AUTH_METHOD` | `clientAuthMethod` | `client_secret_basic` · `client_secret_post` · `client_secret_jwt` · `private_key_jwt` · `tls_client_auth` · `self_signed_tls_client_auth` · `spiffe_jwt` · `spiffe_x509` |
| `MONOCLOUD_AUTH_TRUST_STORE_ID` | `trustStoreId` | — (mTLS methods) |
| `MONOCLOUD_AUTH_APP_URL` | `appUrl` | **Required.** Absolute URL; a trailing `/` is dropped |
| `MONOCLOUD_AUTH_COOKIE_SECRET` | `cookieSecret` | **Required.** ≥ 8 chars; use 32 random bytes |
| `MONOCLOUD_AUTH_SCOPES` | `defaultAuthParams.scopes` | `openid profile email`; must contain `openid` |
| `MONOCLOUD_AUTH_RESOURCE` | `defaultAuthParams.resource` | — |
| `MONOCLOUD_AUTH_USE_PAR` | `usePar` | `false` |
| `MONOCLOUD_AUTH_CLOCK_SKEW` | `clockSkew` | `0` (s) |
| `MONOCLOUD_AUTH_CLOCK_TOLERANCE` | `clockTolerance` | `60` (s) |
| `MONOCLOUD_AUTH_RESPONSE_TIMEOUT` | `responseTimeout` | `10000` (ms), ≥ `1000` |
| `MONOCLOUD_AUTH_FEDERATED_SIGNOUT` | `federatedSignOut` | `true` |
| `MONOCLOUD_AUTH_ALLOW_QUERY_PARAM_OVERRIDES` | `allowQueryParamOverrides` | `true` |
| `MONOCLOUD_AUTH_POST_LOGOUT_REDIRECT_URI` | `postLogoutRedirectUri` | `appUrl` |
| `MONOCLOUD_AUTH_FETCH_USER_INFO` | `fetchUserInfo` | `true` |
| `MONOCLOUD_AUTH_REFETCH_USER_INFO` | `refetchUserInfo` | `false` |
| `MONOCLOUD_AUTH_REFETCH_STRICT_PROFILE_SYNC` | `strictProfileSync` | `false` |
| `MONOCLOUD_AUTH_ID_TOKEN_SIGNING_ALG` | `idTokenSigningAlg` | `RS256` |
| `MONOCLOUD_AUTH_FILTERED_ID_TOKEN_CLAIMS` | `filteredIdTokenClaims` | space-separated; replaces the default list |
| `MONOCLOUD_AUTH_GROUPS_CLAIM` | `groupsClaim` | `groups` |
| `MONOCLOUD_AUTH_SIGNIN_URL` · `_CALLBACK_URL` · `_USER_INFO_URL` · `_SIGNOUT_URL` · `_BACK_CHANNEL_LOGOUT_URL` | `routes.*` | see [Auth routes](#auth-routes) |
| `MONOCLOUD_AUTH_SESSION_COOKIE_NAME` | `session.cookie.name` | `session` |
| `MONOCLOUD_AUTH_SESSION_COOKIE_PATH` | `session.cookie.path` | `/` |
| `MONOCLOUD_AUTH_SESSION_COOKIE_DOMAIN` | `session.cookie.domain` | — |
| `MONOCLOUD_AUTH_SESSION_COOKIE_HTTP_ONLY` | `session.cookie.httpOnly` | `true` |
| `MONOCLOUD_AUTH_SESSION_COOKIE_SECURE` | `session.cookie.secure` | `true` iff `appUrl` is `https:` (must match) |
| `MONOCLOUD_AUTH_SESSION_COOKIE_SAME_SITE` | `session.cookie.sameSite` | `lax` |
| `MONOCLOUD_AUTH_SESSION_COOKIE_PERSISTENT` | `session.cookie.persistent` | `true` |
| `MONOCLOUD_AUTH_SESSION_SLIDING` | `session.sliding` | `false` |
| `MONOCLOUD_AUTH_SESSION_DURATION` | `session.duration` | `86400` (s) |
| `MONOCLOUD_AUTH_SESSION_MAX_DURATION` | `session.maximumDuration` | `604800` (s), > duration |
| `MONOCLOUD_AUTH_STATE_COOKIE_NAME` · `_PATH` · `_DOMAIN` · `_SECURE` · `_SAME_SITE` | `state.cookie.*` | `state`, `/`, —, as session, `lax` |
| `MONOCLOUD_AUTH_STATE_DURATION` | `state.duration` | `900` (s), ≥ `300` |
| `MONOCLOUD_AUTH_STATE_MAX_CONCURRENT` | `state.maxConcurrent` | `5`, `1`–`20` |
| `MONOCLOUD_AUTH_JWKS_CACHE_DURATION` | `jwksCacheDuration` | `300` (s) |
| `MONOCLOUD_AUTH_METADATA_CACHE_DURATION` | `metadataCacheDuration` | `300` (s) |
| `NEXT_PUBLIC_MONOCLOUD_AUTH_SIGNIN_URL` · `_SIGNOUT_URL` · `_USER_INFO_URL` | client route URLs | see [Auth routes](#auth-routes) |
| `NEXT_PUBLIC_MONOCLOUD_AUTH_GROUPS_CLAIM` | client `groupsClaim` | `groups` (`<Protected>`, `protectClientPage`) |
| `DEBUG` | — | `@monocloud:auth-nextjs` enables the SDK's debug logs |

No env alias exists for `session.store`, `resources`, `fetcher`, `metadataResolver`, `jwksResolver`, the hooks, or `defaultAuthParams` fields other than `scopes`/`resource`.
