# API surface — `@monocloud/auth-react`

Verified against `@monocloud/auth-react@0.2.11` (`monocloud/auth-js` @ `3cfea90`).

Single entry point (`exports: { ".": … }`), marked `'use client'`. There are no subpaths.

## Exports

| Kind | Exports |
| --- | --- |
| Provider and hooks | `MonoCloudAuthProvider`, `useAuth`, `useClient` |
| Components | `SignIn`, `SignUp`, `SignOut`, `Protected`, `ProcessCallback` |
| React types | `MonoCloudAuthProviderProps`, `AuthState`, `MonoCloudAuth`, `SignInProps`, `SignUpProps`, `SignOutProps`, `ProtectedComponentProps`, `ProcessCallbackProps` |
| Re-exported classes | `MonoCloudWebJSClient`, `LocalStorage`, `SessionStorage`, `MemoryStorage`, `MonoCloudAuthBaseError`, `MonoCloudJsError`, `MonoCloudOPError`, `MonoCloudValidationError`, `MonoCloudTokenError`, `MonoCloudHttpError` |
| Re-exported types | `MonoCloudWebJSClientOptions`, `DefaultAuthParams`, `Indicator`, `IStorage`, `SignInOptions`, `SignInSilentOptions`, `SignOutOptions`, `RefreshOptions`, `RefreshGrantOptions`, `GetTokensOptions`, `MonoCloudTokens`, `MonoCloudSession`, `MonoCloudUser`, `AccessToken`, `UserinfoResponse`, `IdTokenClaims`, `Address`, `Group`, `CallbackState`, `ApplicationState`, `PostCallback`, `OnSessionCreating`, `InteractionMode`, `AuthorizationParams`, `Authenticators`, `ClientAuthMethod`, `Prompt`, `DisplayOptions`, `ResponseTypes`, `ResponseModes`, `CodeChallengeMethod`, `SecurityAlgorithms`, `Jwk` |

- `AuthState` here is the React state shape below — not the OIDC transaction `AuthState` (`state`, `nonce`, …) that `@monocloud/auth-web-js` exports.
- Import from `@monocloud/auth-web-js` instead (same release): `MonoCloudOidcClient` (e.g. static `decodeJwt`), `/utils` helpers such as `isUserInGroup`, the `SessionChangeListener` type, and lower-level types (`Jwks`, `IssuerMetadata`, `Tokens`, `CallbackParams`, `EndSessionParameters`, …).
- Client options, method semantics, token selection, storage keys and error messages are documented in the `monocloud-web-js` skill ([api-surface](../../monocloud-web-js/references/api-surface.md)); they apply unchanged to the client the provider builds.

## `<MonoCloudAuthProvider>`

```ts
interface MonoCloudAuthProviderProps extends MonoCloudWebJSClientOptions {
  children: ReactNode;
  autoProcessCallback?: boolean;   // default true
}
const MonoCloudAuthProvider: (props: MonoCloudAuthProviderProps) => React.JSX.Element;
```

Lifecycle:

1. First render: `useState(() => new MonoCloudWebJSClient(clientOptions))` — one client per provider instance; later prop changes are ignored.
2. Initial state: `{ isLoading: true, isAuthenticated: false }`.
3. Session effect: `client.onSessionChange(session => setState({ isLoading: false, isAuthenticated: !!session, user: session?.user, session, error: undefined }))`, unsubscribed on unmount. It delivers the stored session once — after any in-flight callback exchange settles, and on a redirect callback URL only once `processCallback()` has run (until then `isLoading` stays `true`) — then every session the client writes, whoever triggered it: `useAuth()` actions, `<ProcessCallback>`, or direct calls on the `useClient()` client.
4. Mount effect, run once (a ref guard absorbs StrictMode's double invoke): with `autoProcessCallback`, runs the provider's `processCallback` and swallows its rejection (the error stays in state).
5. The provider's `processCallback` (also behind `<ProcessCallback>`): `isLoading: true` → `client.processCallback()` → `isLoading: false`. On failure: `{ ...previous, isLoading: false, error }` — the current session is kept — then rethrows. Concurrent runs share one code exchange.
6. Provides three contexts: the client (`useClient`), the provider's `processCallback` (`<ProcessCallback>`), and state + actions (`useAuth`).

Without a `postCallback` prop the web-js default applies (strip query/hash; full page load to a same-origin `returnUrl`).

## `useAuth()`

```ts
function useAuth(): MonoCloudAuth;

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  error?: Error;
  user?: MonoCloudUser;
  session?: MonoCloudSession;
}

interface MonoCloudAuth extends AuthState {
  signIn: (signInOptions?: SignInOptions) => Promise<void>;
  signOut: (signOutOptions?: SignOutOptions) => Promise<void>;
  signInSilent: (signInSilentOptions?: SignInSilentOptions) => Promise<MonoCloudSession>;
  refreshSession: (refreshOptions?: RefreshOptions) => Promise<void>;
  refetchUserInfo: () => Promise<void>;
  getTokens: (options?: GetTokensOptions) => Promise<MonoCloudTokens>;
}
```

| Action | Before | On success | On failure |
| --- | --- | --- | --- |
| `signIn` | `isLoading: true` | `isLoading: false` | `{ ...previous, isLoading: false, error }` — resolves, never rejects |
| `signOut` | `isLoading: true` | `isLoading: false` | same as `signIn` |
| `signInSilent`, `refreshSession`, `refetchUserInfo`, `getTokens` | — | the client call's result (the session for `signInSilent`, the tokens for `getTokens`) | rejects; state unchanged |

- `isAuthenticated`, `user` and `session` change only through the session effect: every write publishes freshly parsed `user` / `session` objects, sets `isLoading: false` and clears `error`. Calls that write nothing — `getTokens()` returning a stored token, a failed refresh — leave state untouched and don't re-render.
- Actions are `useCallback`-memoized and stable.
- A redirect `signIn` / `signOut` resolves just before the page unloads; `signOut` clears the local session — and so the context — first.
- Outside the provider: `MonoCloudJsError: useAuth() can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.`

## `useClient()`

```ts
function useClient(): MonoCloudWebJSClient;
```

Returns the provider's client, for operations `useAuth()` lacks — such as `client.oidcClient.revokeToken(token, 'access_token' | 'refresh_token')` (the stored session keeps the revoked token until it expires or is refreshed) or an extra `client.onSessionChange()` subscription. Session writes made through it still reach `useAuth()` via the provider's subscription; only the hook's `signIn` / `signOut` set `isLoading` and turn failures into `error` (direct calls reject instead). Outside the provider: `MonoCloudJsError: useClient() can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.`

## Buttons

```ts
interface SignInProps extends Omit<SignInOptions, 'signUp'>, React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}
interface SignUpProps
  extends Omit<SignInOptions, 'signUp' | 'authenticatorHint' | 'loginHint' | 'prompt'>,
    React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}
interface SignOutProps extends SignOutOptions, React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}
```

- `<SignIn>` calls `useAuth().signIn({ authenticatorHint, maxAge, loginHint, uiLocales, mode, acrValues, display, prompt, resource, audience, idTokenHint, returnUrl, scopes, appState })`.
- `<SignUp>` calls `signIn({ signUp: true, maxAge, uiLocales, mode, acrValues, display, resource, audience, idTokenHint, returnUrl, scopes, appState })`.
- `<SignOut>` calls `signOut({ idTokenHint, postLogoutRedirectUri, mode, federatedSignOut, returnUrl })`.
- Each renders `<button {...rest} type="button" onClick={…}>` — remaining attributes are forwarded, but `type` and `onClick` are always the component's own. Errors land in `useAuth().error`.

## `<Protected>`

```ts
interface ProtectedComponentProps {
  children: React.ReactNode;
  groups?: string[];
  groupsClaim?: string;                                     // default 'groups'
  matchAllGroups?: boolean;                                 // default false (any of `groups`)
  fallback?: React.ReactNode;                               // default null
  onGroupAccessDenied?: (user: MonoCloudUser) => React.ReactNode; // default: renders nothing
}
```

```
isLoading                          → null
error || !isAuthenticated || !user → fallback || null
!groups                            → children
isUserInGroup(user, groups, groupsClaim, matchAllGroups) ? children : onGroupAccessDenied(user)
```

`isUserInGroup` (from `@monocloud/auth-web-js/utils`) compares each required group with the claim's entries — strings by equality, `{ id, name }` objects by `id` or `name`. An empty `groups` array allows everyone; in plain JS a bare string counts as one group.

## `<ProcessCallback>`

```ts
interface ProcessCallbackProps {
  loading?: ReactNode;                           // default null
  error?: ReactNode | ((error: Error) => ReactNode);
  children?: ReactNode;                          // default null
}
```

On mount (once, StrictMode-guarded) it runs the provider's `processCallback` — `isLoading: true`, `client.processCallback()`, `isLoading: false`, with the session arriving through the provider's subscription — and renders `loading`, then `children` on success or `error` on failure (nothing if `error` is omitted). If `autoProcessCallback` is also on, both runs share the one exchange. It never navigates. Outside the provider: `MonoCloudJsError: <ProcessCallback /> can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.`

## Errors

Same classes as `@monocloud/auth-web-js`:

```ts
class MonoCloudAuthBaseError extends Error {
  readonly raw?: { status: number; statusText: string; headers: Record<string, string>; body: string };
}
class MonoCloudOPError extends MonoCloudAuthBaseError { error: string; errorDescription?: string } // message === error
class MonoCloudValidationError extends MonoCloudAuthBaseError {}
class MonoCloudTokenError extends MonoCloudAuthBaseError {
  readonly code: 'invalid_token' | 'inactive_token' | 'insufficient_scope' | 'insufficient_groups'; // browser: invalid_token | insufficient_scope
}
class MonoCloudHttpError extends MonoCloudAuthBaseError { get status(): number | undefined; get statusText(): string | undefined }
class MonoCloudJsError extends MonoCloudAuthBaseError {}
```

This package itself throws only `MonoCloudJsError`, for `useAuth()`, `useClient()` or `<ProcessCallback>` used outside the provider. Everything else comes from the underlying client.

## Scope of the SDK

- UI is limited to the three buttons and the two render gates — no modals or styling.
- No router: navigation goes through `postCallback`.
- No server-side session access: everything runs in the browser (use `@monocloud/auth-nextjs` for server sessions).
- No access-token validation — APIs validate tokens themselves (`@monocloud/backend-node`).
