# API surface — `@monocloud/auth-nextjs`

Exhaustive export list per subpath, verified against `packages/nextjs/src/`. Signatures are condensed; protection-helper option types are in `protecting.md`.

## Quick reference

The surface most apps actually reach for — full signatures and types follow below.

- `authMiddleware()` — gate routes in `proxy.ts` / `middleware.ts`.
- `getSession()` / `getTokens()` — read the current session / access tokens in server contexts.
- `isAuthenticated()` / `isUserInGroup(groups)` — boolean checks for routes and middleware.
- `protect()` / `protectApi(handler)` / `protectPage(component)` — App Router enforcement helpers.
- `redirectToSignIn()` / `redirectToSignOut()` — server-side redirects.
- `monoCloudAuth()` — catch-all route handler factory (only when middleware can't be used).
- `useAuth()` / `protectClientPage(Component)` — Client Component hook + HOC (from `/client`).
- `<SignIn>` / `<SignUp>` / `<SignOut>` — link components (from `/components`).
- `<Protected>` / `<RedirectToSignIn>` — Client Component variants (from `/components/client`).
- Errors: `MonoCloudValidationError`, `MonoCloudOPError`, `MonoCloudTokenError`, `MonoCloudHttpError`, `MonoCloudAuthBaseError`.

## `@monocloud/auth-nextjs` (root)

### Functions

| Export | Signature (summary) |
|---|---|
| `authMiddleware` | `(options?) => NextMiddleware \| NextProxy` — also callable as `(req, evt) => Promise<NextMiddlewareResult>` for composition |
| `monoCloudAuth` | `(options?) => MonoCloudAuthHandler` — catch-all route handler factory; use only when you can't use `authMiddleware()` |
| `getSession` | `() / (req) / (req, res) / (req, res, options)` → `Promise<MonoCloudSession \| undefined>` |
| `getTokens` | Same overload shape as `getSession` → `Promise<MonoCloudTokens>`; throws `MonoCloudValidationError` if no session |
| `isAuthenticated` | `() / (req, res?)` → `Promise<boolean>` |
| `isUserInGroup` | `(groups[]) / (req, groups[]) / (req, res, groups[])` → `Promise<boolean>` |
| `protect` | `(options?) => Promise<void>` — App Router only; redirects if not authenticated/authorized |
| `protectApi` | `(handler, options?)` — wraps an App Router or Pages Router handler |
| `protectPage` | `(component, options?)` (App Router) **or** `(options?)` (Pages Router — returns `getServerSideProps`) |
| `redirectToSignIn` | `(options?) => Promise<void>` — App Router only |
| `redirectToSignOut` | `(options?) => Promise<void>` — App Router only |

### Class

```ts
class MonoCloudNextClient {
  constructor(options?: MonoCloudOptions);
  readonly coreClient: MonoCloudCoreClient;     // framework-agnostic client
  readonly oidcClient: MonoCloudOidcClient;     // raw OIDC client

  // Same methods as the function exports above:
  authMiddleware(...): ...;
  monoCloudAuth(options?): MonoCloudAuthHandler;
  getSession(...): Promise<MonoCloudSession | undefined>;
  getTokens(...): Promise<MonoCloudTokens>;
  isAuthenticated(...): Promise<boolean>;
  isUserInGroup(...): Promise<boolean>;
  protect(options?): Promise<void>;
  protectApi(handler, options?): handler;
  protectPage(componentOrOptions, options?): handler;
  redirectToSignIn(options?): Promise<void>;
  redirectToSignOut(options?): Promise<void>;
}
```

Use the class when you need multiple configurations, dependency injection, or explicit lifecycle control. Otherwise prefer the function exports (they share a lazily-initialized singleton).

### Constructor Options

`MonoCloudNextClient(options?: MonoCloudOptions)` forwards configuration to `@monocloud/auth-node-core`. Env vars cover the common scalar values, but constructor-only objects such as `session.store`, `onBackChannelLogout`, `onSetApplicationState`, and `onSessionCreating` must be passed in code.

```ts
interface MonoCloudOptions {
  // Identity
  clientId?: string;
  clientSecret?: string;
  tenantDomain?: string;
  appUrl?: string;
  cookieSecret?: string;

  // Routes
  routes?: Partial<MonoCloudRoutes>;

  // OIDC / authorization
  defaultAuthParams?: AuthorizationParams;
  resources?: Indicator[];
  usePar?: boolean;
  postLogoutRedirectUri?: string;
  federatedSignOut?: boolean;
  fetchUserInfo?: boolean;
  refetchUserInfo?: boolean;
  allowQueryParamOverrides?: boolean;
  strictProfileSync?: boolean;

  // Tokens / signing
  idTokenSigningAlg?: SecurityAlgorithms;
  filteredIdTokenClaims?: string[];
  clockSkew?: number;        // seconds
  responseTimeout?: number;  // ms

  // Caching
  jwksCacheDuration?: number;      // seconds (default 300)
  metadataCacheDuration?: number;  // seconds (default 300)

  // Session & state
  session?: MonoCloudSessionOptions;
  state?: MonoCloudStatePartialOptions;

  // Diagnostics / branding
  debugger?: string;
  userAgent?: string;

  // Hooks
  onBackChannelLogout?: OnBackChannelLogout;
  onSetApplicationState?: OnSetApplicationState;
  onSessionCreating?: OnSessionCreating;
}

interface MonoCloudRoutes {
  callback: string;          // default '/api/auth/callback'
  backChannelLogout: string; // default '/api/auth/backchannel-logout'
  signIn: string;            // default '/api/auth/signin'
  signOut: string;           // default '/api/auth/signout'
  userInfo: string;          // default '/api/auth/userinfo'
}

interface AuthorizationParams {
  state?: string;
  scopes?: string;                       // space-separated; default 'openid profile email'
  redirectUri?: string;
  responseType?: ResponseTypes;          // default 'code'
  responseMode?: ResponseModes;          // 'form_post' | 'query' | 'fragment'
  codeChallenge?: string;
  codeChallengeMethod?: CodeChallengeMethod; // 'plain' | 'S256'
  authenticatorHint?: Authenticators;
  maxAge?: number;                       // seconds since last auth
  loginHint?: string;
  request?: string;                      // signed JWT request object
  acrValues?: string[];
  nonce?: string;
  uiLocales?: string;
  display?: DisplayOptions;              // 'page' | 'popup' | 'touch' | 'wap'
  prompt?: Prompt;                       // 'none' | 'login' | 'consent' | 'select_account' | 'create'
  requestUri?: string;                   // PAR — set by SDK after pushing
  resource?: string;                     // space-separated audience URIs
}

interface ExtraAuthParams extends Pick<
  AuthorizationParams,
  | 'scopes' | 'resource' | 'prompt' | 'display' | 'uiLocales'
  | 'acrValues' | 'authenticatorHint' | 'maxAge' | 'loginHint'
> {}

interface Indicator {
  resource: string;
  scopes?: string;
}

interface MonoCloudSessionOptions {
  cookie?: Partial<MonoCloudCookieOptions>;
  sliding?: boolean;            // default false
  duration?: number;            // seconds; default 86400 (1 day)
  maximumDuration?: number;     // seconds; default 604800 (7 days; only when sliding)
  store?: MonoCloudSessionStore;
}

interface MonoCloudStatePartialOptions {
  cookie?: Partial<MonoCloudCookieOptions>;
}

interface MonoCloudCookieOptions {
  name: string;                 // session: 'session'; state: 'state'
  path: string;                 // default '/'
  domain?: string;
  httpOnly: boolean;            // default true (always true for state cookies)
  secure: boolean;              // inferred from appUrl scheme when not set
  sameSite: SameSiteValues;     // 'strict' | 'lax' | 'none'; default 'lax'
  persistent: boolean;          // session default true; state default false
}

interface MonoCloudSessionStore {
  get(key: string): Promise<MonoCloudSession | undefined | null>;
  set(key: string, data: MonoCloudSession, lifetime: SessionLifetime): Promise<void>;
  delete(key: string): Promise<void>;
}

interface SessionLifetime {
  c: number;       // created (epoch seconds)
  u: number;       // last updated (epoch seconds)
  e?: number;      // expiry (epoch seconds, optional)
}

type OnSessionCreating = (
  session: MonoCloudSession,
  idToken?: Partial<IdTokenClaims>,
  userInfo?: UserinfoResponse,
  state?: ApplicationState,
) => Promise<void> | void;

type OnBackChannelLogout = (sub?: string, sid?: string) => Promise<void> | void;

type OnSetApplicationState = (req: MonoCloudRequest) => Promise<ApplicationState> | ApplicationState;

interface ApplicationState extends Record<string, any> {}

type SecurityAlgorithms =
  | 'RS256' | 'RS384' | 'RS512'
  | 'PS256' | 'PS384' | 'PS512'
  | 'ES256' | 'ES384' | 'ES512';

type SameSiteValues = 'strict' | 'lax' | 'none';

type Authenticators =
  | 'password' | 'passkey' | 'email' | 'phone'
  | 'google' | 'apple' | 'facebook' | 'microsoft' | 'github'
  | 'gitlab' | 'discord' | 'twitter' | 'linkedin' | 'xero';
```

`session.store` persists session data outside cookie-only storage, for example in Redis or a database. It is constructor-only; there is no `MONOCLOUD_AUTH_*` env var for a custom store.

### Session, user, and token models

```ts
interface MonoCloudSession {
  user: MonoCloudUser;
  idToken?: string;
  authorizedScopes?: string;            // space-separated
  accessTokens?: AccessToken[];         // one per (resource, scopes) tuple
  refreshToken?: string;
  [key: string]: unknown;               // free-form (added via onSessionCreating)
}

interface MonoCloudUser extends UserinfoResponse {
  amr?: string[];                       // authentication methods used
  idp?: string;                         // upstream IdP id
}

interface AccessToken {
  accessToken: string;
  accessTokenExpiration: number;        // epoch seconds
  scopes: string;                       // space-separated
  resource?: string;
  requestedScopes?: string;
}

interface MonoCloudTokens extends AccessToken {
  idToken?: string;
  refreshToken?: string;
  isExpired: boolean;
}

interface GetSessionOptions {
  refetchUserInfo?: boolean;
}

interface GetTokensOptions {
  forceRefresh?: boolean;
  refetchUserInfo?: boolean;
  resource?: string;                    // space-separated audience(s)
  scopes?: string;                      // space-separated
}
```

### Errors (re-exported from `@monocloud/auth-node-core`)

- `MonoCloudAuthBaseError`
- `MonoCloudValidationError`
- `MonoCloudHttpError`
- `MonoCloudOPError`
- `MonoCloudTokenError`

### Types

**SDK-defined (`./types`)**:

`MonoCloudAuthOptions`, `MonoCloudMiddlewareOptions`, `MonoCloudAuthHandler`, `NextMiddlewareResult`, `NextMiddlewareOnAccessDenied`, `NextMiddlewareOnGroupAccessDenied`, `ProtectedRoutes`, `ProtectedRouteMatcher`, `CustomProtectedRouteMatcher`, `OnError`, `AppOnError`, `PageOnError`, `AppRouterContext`, `AppRouterApiHandlerFn`, `AppRouterPageHandler`, `ExtraAuthParams`, `GroupOptions`, `IsUserInGroupOptions`, `ProtectOptions`, `RedirectToSignInOptions`, `RedirectToSignOutOptions`, `ProtectApiAppOptions`, `ProtectApiPageOptions`, `ProtectAppPageOptions`, `ProtectPagePageOptions`, `ProtectPagePageReturnType`, `ProtectPagePageOnAccessDeniedType`, `ProtectPagePageOnGroupAccessDeniedType`, `ProtectPageGetServerSidePropsContext`, `ProtectedAppServerComponent`, `ProtectedAppServerComponentProps`, `AppRouterApiOnAccessDeniedHandler`, `AppRouterApiOnGroupAccessDeniedHandler`, `PageRouterApiOnAccessDeniedHandler`, `PageRouterApiOnGroupAccessDeniedHandler`.

**Re-exported from `@monocloud/auth-node-core`**:

`MonoCloudOptions`, `MonoCloudSession`, `MonoCloudUser`, `MonoCloudTokens`, `AccessToken`, `GetSessionOptions`, `GetTokensOptions`, `ApplicationState`, `MonoCloudRequest`, `Indicator`, `MonoCloudSessionOptions`, `MonoCloudSessionOptionsBase`, `MonoCloudSessionStore`, `MonoCloudCookieOptions`, `SessionLifetime`, `SameSiteValues`, `UserinfoResponse`, `Address`, `Authenticators`, `DisplayOptions`, `AuthorizationParams`, `MonoCloudRoutes`, `MonoCloudStateOptions`, `MonoCloudStatePartialOptions`, `IdTokenClaims`, `Group`, `Jwk`, `Prompt`, `CodeChallengeMethod`, `ResponseTypes`, `ResponseModes`, `SecurityAlgorithms`, `OnSessionCreating`, `OnBackChannelLogout`, `OnSetApplicationState`.

## `@monocloud/auth-nextjs/client`

```ts
// Hook
function useAuth(): AuthenticationState;

interface AuthenticationState {
  isLoading: boolean;
  isAuthenticated: boolean;
  error?: Error;
  user?: MonoCloudUser;
  refetch: (refresh?: boolean) => void;   // refresh=true forces a userinfo refresh
}

// HOC
function protectClientPage<P>(
  Component: ComponentType<P & { user: MonoCloudUser }>,
  options?: ProtectClientPageOptions,
): React.FC<P>;

interface ProtectClientPageOptions {
  returnUrl?: string;
  groups?: string[];
  groupsClaim?: string;
  matchAll?: boolean;
  authParams?: ExtraAuthParams;
  onAccessDenied?: () => React.ReactNode;
  onGroupAccessDenied?: (user: MonoCloudUser) => React.ReactNode;
  onError?: (error: Error) => React.ReactNode;
}
```

`useAuth()` requires no provider. It fetches `process.env.NEXT_PUBLIC_MONOCLOUD_AUTH_USER_INFO_URL ?? '/api/auth/userinfo'` via SWR.

## `@monocloud/auth-nextjs/components`

Server-or-client safe components that render as `<a>` tags. All accept arbitrary `<a>` props in addition to those listed.

```ts
function SignIn(props: SignInProps & React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element;
interface SignInProps extends ExtraAuthParams {
  children: React.ReactNode;
  returnUrl?: string;
}

function SignUp(props: SignUpProps & React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element;
interface SignUpProps extends Omit<ExtraAuthParams, 'authenticatorHint' | 'loginHint' | 'prompt'> {
  returnUrl?: string;
  // children is part of the AnchorHTMLAttributes intersection
}

function SignOut(props: SignOutProps & React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element;
interface SignOutProps {
  children: React.ReactNode;
  postLogoutUrl?: string;
  federated?: boolean;
}
```

`<SignUp>` is implemented as a `<SignIn>` with `prompt=create` baked in — that's why it omits the params that would conflict with sign-up.

## `@monocloud/auth-nextjs/components/client`

Client-only components.

```ts
function RedirectToSignIn(props: RedirectToSignInProps): null;
interface RedirectToSignInProps extends ExtraAuthParams {
  returnUrl?: string;
}

function Protected(props: ProtectedComponentProps): React.ReactNode | null;
interface ProtectedComponentProps {
  children: React.ReactNode;
  groups?: string[];
  groupsClaim?: string;
  matchAllGroups?: boolean;             // note: not `matchAll`
  fallback?: React.ReactNode;
  onGroupAccessDenied?: (user: MonoCloudUser) => React.ReactNode;
}
```

## Default auth routes

| Logical route | Default path | Override env | Public mirror (for client components) |
|---|---|---|---|
| Sign-in | `/api/auth/signin` | `MONOCLOUD_AUTH_SIGNIN_URL` | `NEXT_PUBLIC_MONOCLOUD_AUTH_SIGNIN_URL` |
| Callback | `/api/auth/callback` | `MONOCLOUD_AUTH_CALLBACK_URL` | `NEXT_PUBLIC_MONOCLOUD_AUTH_CALLBACK_URL` |
| Userinfo | `/api/auth/userinfo` | `MONOCLOUD_AUTH_USER_INFO_URL` | `NEXT_PUBLIC_MONOCLOUD_AUTH_USER_INFO_URL` |
| Sign-out | `/api/auth/signout` | `MONOCLOUD_AUTH_SIGNOUT_URL` | `NEXT_PUBLIC_MONOCLOUD_AUTH_SIGNOUT_URL` |
| Back-channel logout | `/api/auth/backchannel-logout` | `MONOCLOUD_AUTH_BACK_CHANNEL_LOGOUT_URL` | n/a |

Any `NEXT_PUBLIC_MONOCLOUD_AUTH_*` variable is also copied into its private counterpart at client init, so you only need to set the `NEXT_PUBLIC_` form when you want both the server middleware and the client helpers to agree on a custom path.

## Default option values

From `packages/node-core/src/options/defaults.ts`:

```ts
{
  routes: {
    callback: '/api/auth/callback',
    backChannelLogout: '/api/auth/backchannel-logout',
    signIn: '/api/auth/signin',
    signOut: '/api/auth/signout',
    userInfo: '/api/auth/userinfo',
  },
  clockSkew: 60,                         // seconds
  responseTimeout: 10000,                // ms
  usePar: false,
  fetchUserInfo: true,
  refetchUserInfo: false,
  federatedSignOut: true,
  defaultAuthParams: { scopes: 'openid profile email', responseType: 'code' },
  allowQueryParamOverrides: true,
  strictProfileSync: false,
  filteredIdTokenClaims: ['iss','exp','nbf','aud','nonce','iat','auth_time','c_hash','at_hash','s_hash'],
  session: {
    cookie: { httpOnly: true, name: 'session', path: '/', sameSite: 'lax', persistent: true },
    sliding: false,
    duration: 24 * 60 * 60,              // 1 day
    maximumDuration: 7 * 24 * 60 * 60,   // 7 days
  },
  state: {
    cookie: { httpOnly: true, name: 'state', path: '/', sameSite: 'lax', persistent: false },
  },
  idTokenSigningAlg: 'RS256',
}
```

The shared OIDC base also defaults `jwksCacheDuration` and `metadataCacheDuration` to **300 seconds** (5 minutes).

## Environment variables

Every scalar option has a `MONOCLOUD_AUTH_*` env var alias (constructor options always win).

| Env var | Maps to | Notes |
|---|---|---|
| `MONOCLOUD_AUTH_CLIENT_ID` | `clientId` | Required |
| `MONOCLOUD_AUTH_CLIENT_SECRET` | `clientSecret` | Required for confidential clients |
| `MONOCLOUD_AUTH_TENANT_DOMAIN` | `tenantDomain` | Required |
| `MONOCLOUD_AUTH_APP_URL` | `appUrl` | Required |
| `MONOCLOUD_AUTH_COOKIE_SECRET` | `cookieSecret` | Required. Validator only enforces ≥ 8 chars but you should use a 32-byte (64 hex char) secret from `openssl rand -hex 32`. |
| `MONOCLOUD_AUTH_SCOPES` | `defaultAuthParams.scopes` | Space-separated |
| `MONOCLOUD_AUTH_RESOURCE` | `defaultAuthParams.resource` | Default audience |
| `MONOCLOUD_AUTH_USE_PAR` | `usePar` | Boolean |
| `MONOCLOUD_AUTH_CLOCK_SKEW` | `clockSkew` | Seconds |
| `MONOCLOUD_AUTH_RESPONSE_TIMEOUT` | `responseTimeout` | Milliseconds |
| `MONOCLOUD_AUTH_FEDERATED_SIGNOUT` | `federatedSignOut` | Boolean |
| `MONOCLOUD_AUTH_ALLOW_QUERY_PARAM_OVERRIDES` | `allowQueryParamOverrides` | Boolean |
| `MONOCLOUD_AUTH_POST_LOGOUT_REDIRECT_URI` | `postLogoutRedirectUri` | |
| `MONOCLOUD_AUTH_FETCH_USER_INFO` | `fetchUserInfo` | Boolean |
| `MONOCLOUD_AUTH_REFETCH_USER_INFO` | `refetchUserInfo` | Boolean |
| `MONOCLOUD_AUTH_ID_TOKEN_SIGNING_ALG` | `idTokenSigningAlg` | e.g. `RS256` |
| `MONOCLOUD_AUTH_FILTERED_ID_TOKEN_CLAIMS` | `filteredIdTokenClaims` | Space-separated |
| `MONOCLOUD_AUTH_CALLBACK_URL` | `routes.callback` | |
| `MONOCLOUD_AUTH_SIGNIN_URL` | `routes.signIn` | |
| `MONOCLOUD_AUTH_SIGNOUT_URL` | `routes.signOut` | |
| `MONOCLOUD_AUTH_USER_INFO_URL` | `routes.userInfo` | |
| `MONOCLOUD_AUTH_BACK_CHANNEL_LOGOUT_URL` | `routes.backChannelLogout` | |
| `MONOCLOUD_AUTH_SESSION_COOKIE_NAME` | `session.cookie.name` | |
| `MONOCLOUD_AUTH_SESSION_COOKIE_PATH` | `session.cookie.path` | |
| `MONOCLOUD_AUTH_SESSION_COOKIE_DOMAIN` | `session.cookie.domain` | |
| `MONOCLOUD_AUTH_SESSION_COOKIE_HTTP_ONLY` | `session.cookie.httpOnly` | Boolean |
| `MONOCLOUD_AUTH_SESSION_COOKIE_SECURE` | `session.cookie.secure` | Boolean |
| `MONOCLOUD_AUTH_SESSION_COOKIE_SAME_SITE` | `session.cookie.sameSite` | `strict` / `lax` / `none` |
| `MONOCLOUD_AUTH_SESSION_COOKIE_PERSISTENT` | `session.cookie.persistent` | Boolean |
| `MONOCLOUD_AUTH_SESSION_SLIDING` | `session.sliding` | Boolean |
| `MONOCLOUD_AUTH_SESSION_DURATION` | `session.duration` | Seconds |
| `MONOCLOUD_AUTH_SESSION_MAX_DURATION` | `session.maximumDuration` | Seconds (sliding only) |
| `MONOCLOUD_AUTH_STATE_COOKIE_NAME` | `state.cookie.name` | |
| `MONOCLOUD_AUTH_STATE_COOKIE_PATH` | `state.cookie.path` | |
| `MONOCLOUD_AUTH_STATE_COOKIE_DOMAIN` | `state.cookie.domain` | |
| `MONOCLOUD_AUTH_STATE_COOKIE_SECURE` | `state.cookie.secure` | Boolean |
| `MONOCLOUD_AUTH_STATE_COOKIE_SAME_SITE` | `state.cookie.sameSite` | `strict` / `lax` / `none` |
| `MONOCLOUD_AUTH_STATE_COOKIE_PERSISTENT` | `state.cookie.persistent` | Boolean |
| `MONOCLOUD_AUTH_JWKS_CACHE_DURATION` | `jwksCacheDuration` | Seconds |
| `MONOCLOUD_AUTH_METADATA_CACHE_DURATION` | `metadataCacheDuration` | Seconds |
| `MONOCLOUD_AUTH_GROUPS_CLAIM` | (server default for `groupsClaim`) | Used by `protect*` / `isUserInGroup` when `groupsClaim` is not passed |
| `NEXT_PUBLIC_MONOCLOUD_AUTH_GROUPS_CLAIM` | (client default for `groupsClaim`) | Used by `protectClientPage` / `<Protected>` when `groupsClaim` is not passed |

Hooks (`onSessionCreating`, `onBackChannelLogout`, `onSetApplicationState`) and constructor-only objects (`session.store`, custom `defaultAuthParams.acrValues`, etc.) have no env-var alias.
