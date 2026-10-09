# API surface — `@monocloud/auth-react`

Verified against `@monocloud/auth-react@0.2.9` (`monocloud/auth-js` @ `30d7d98`).

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
- Import from `@monocloud/auth-web-js` instead (same release): `MonoCloudOidcClient` (e.g. static `decodeJwt`), `/utils` helpers such as `isUserInGroup`, and lower-level types (`Jwks`, `IssuerMetadata`, `Tokens`, `CallbackParams`, `EndSessionParameters`, …).
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
3. Mount effect, run once (a ref guard absorbs StrictMode's double invoke): `autoProcessCallback` → `processCallback()` then `syncSession()`; otherwise only `syncSession()`.
4. `syncSession()` = `client.getSession()` → `{ isLoading: false, isAuthenticated: !!session, user: session?.user, session, error: undefined }`.
5. A failed `processCallback()` sets `{ isLoading: false, isAuthenticated: false, user: undefined, session: undefined, error }` and rethrows to `<ProcessCallback>` (the automatic run swallows it).
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
| `signIn` | `isLoading: true` | `syncSession()` | `{ ...previous, isLoading: false, error }` — resolves, never rejects |
| `signOut` | `isLoading: true` | `syncSession()` | same as `signIn` |
| `signInSilent` | — | `syncSession()`; returns the session | rejects; state unchanged |
| `refreshSession`, `refetchUserInfo` | — | `syncSession()` | rejects |
| `getTokens` | — | `syncSession()`; returns the tokens | rejects |

- Actions are `useCallback`-memoized and stable. Each successful action publishes a new state object with freshly parsed `user` / `session` objects.
- A redirect `signIn` / `signOut` resolves (and syncs) just before the page unloads.
- Outside the provider: `MonoCloudJsError: useAuth() can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.`

## `useClient()`

```ts
function useClient(): MonoCloudWebJSClient;
```

Returns the provider's client. Direct calls don't update context — use it for operations `useAuth()` lacks, such as `client.oidcClient.revokeToken(token, 'access_token' | 'refresh_token')` (the stored session keeps the revoked token until it expires or is refreshed). Outside the provider: `MonoCloudJsError: useClient() can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.`

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

`isUserInGroup` (from `@monocloud/auth-web-js/utils`) compares each required group with the claim's entries — strings by equality, `{ id, name }` objects by `id` or `name`. An empty `groups` array allows everyone.

## `<ProcessCallback>`

```ts
interface ProcessCallbackProps {
  loading?: ReactNode;                           // default null
  error?: ReactNode | ((error: Error) => ReactNode);
  children?: ReactNode;                          // default null
}
```

On mount (once, StrictMode-guarded) it runs the provider's `processCallback` — `isLoading: true`, `client.processCallback()`, `syncSession()` — and renders `loading`, then `children` on success or `error` on failure (nothing if `error` is omitted). It never navigates. Outside the provider: `MonoCloudJsError: <ProcessCallback /> can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.`

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
