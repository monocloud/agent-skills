# API surface — `@monocloud/auth-react`

Exhaustive export list, verified against `packages/react/src/index.ts`. The package adds a React layer on top of `@monocloud/auth-web-js` and re-exports the same client, storage adapters, and error classes from it. Signatures are condensed; TypeScript intellisense (`go-to-definition`) is the source of truth for full type bodies.

## Quick reference

- Entry point: `<MonoCloudAuthProvider tenantDomain clientId>` constructs one `MonoCloudWebJSClient` and exposes it via React context.
- Hooks: `useAuth()` (state + actions), `useClient()` (raw client).
- Components: `<SignIn>`, `<SignUp>`, `<SignOut>`, `<Protected>`, `<ProcessCallback>`.
- Errors / storage / client / types are re-exported verbatim from `@monocloud/auth-web-js` — same identities, same instanceof checks work.
- Every file in the package is `'use client'`. Don't import from a Server Component.

## Top-level exports

```ts
import {
  // Provider + hooks
  MonoCloudAuthProvider,
  useAuth,
  useClient,

  // Components
  SignIn,
  SignUp,
  SignOut,
  Protected,
  ProcessCallback,

  // Re-exported from @monocloud/auth-web-js
  MonoCloudWebJSClient,
  LocalStorage,
  SessionStorage,
  MemoryStorage,
  MonoCloudAuthBaseError,
  MonoCloudJsError,
  MonoCloudOPError,
  MonoCloudValidationError,
  MonoCloudTokenError,
  MonoCloudHttpError,
} from '@monocloud/auth-react';

import type {
  // React-specific
  AuthState,
  MonoCloudAuth,
  MonoCloudAuthProviderProps,
  ProcessCallbackProps,
  SignInProps,
  SignUpProps,
  SignOutProps,
  ProtectedComponentProps,

  // Re-exported from @monocloud/auth-web-js
  MonoCloudWebJSClientOptions,
  IStorage,
  Indicator,
  DefaultAuthParams,
  AuthorizationParams,
  Jwk,
  SignInOptions,
  SignInSilentOptions,
  SignOutOptions,
  RefreshOptions,
  RefreshGrantOptions,
  GetTokensOptions,
  MonoCloudSession,
  MonoCloudTokens,
  AccessToken,
  MonoCloudUser,
  UserinfoResponse,
  IdTokenClaims,
  Address,
  CallbackState,
  ApplicationState,
  PostCallback,
  OnSessionCreating,
  InteractionMode,
  Authenticators,
  ClientAuthMethod,
  Prompt,
  DisplayOptions,
  ResponseTypes,
  ResponseModes,
  CodeChallengeMethod,
  SecurityAlgorithms,
  Group,
} from '@monocloud/auth-react';
```

There is no separate subpath. Everything ships from the package root.

## `<MonoCloudAuthProvider>`

```tsx
interface MonoCloudAuthProviderProps extends MonoCloudWebJSClientOptions {
  children: ReactNode;
  autoProcessCallback?: boolean;   // default true
}

function MonoCloudAuthProvider(props: MonoCloudAuthProviderProps): JSX.Element;
```

Behavior:

1. On first render, instantiates `new MonoCloudWebJSClient(clientOptions)` via `useState(initializer)` — the client is created **once per provider instance** and never re-created when props change.
2. On mount, runs either:
   - `processCallback()` (when `autoProcessCallback` is `true`, default) followed by `syncSession()`, or
   - just `syncSession()` (when `autoProcessCallback` is `false`).
   The provider sets `isLoading: true` during the bootstrap and flips it to `false` once done.
3. Wraps children in three contexts: `MonoCloudAuthContext` (state + actions), `MonoCloudClientContext` (raw client), and an internal `MonoCloudProcessCallbackContext` (used by `<ProcessCallback>`).
4. Uses a `useRef` initialization guard so React `<StrictMode>`'s double-invocation does not run `processCallback()` twice.

Because the client is bootstrapped at first render, prop changes after that are **ignored** for client-config props. To reconfigure, unmount/remount the provider — typically by giving it a different `key`.

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
  signIn:          (options?: SignInOptions)        => Promise<void>;
  signOut:         (options?: SignOutOptions)       => Promise<void>;
  signInSilent:    (options?: SignInSilentOptions)  => Promise<MonoCloudSession>;
  refreshSession:  (options?: RefreshOptions)       => Promise<void>;
  refetchUserInfo: ()                                => Promise<void>;
  getTokens:       (options?: GetTokensOptions)     => Promise<MonoCloudTokens>;
}
```

Action semantics (all stable across renders via `useCallback`):

| Action            | Side effect on context state                                                                                                  | Throws?                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `signIn`          | Sets `isLoading: true`, awaits `client.signIn`, then syncs. On error, sets `error` and resolves (**does not throw**).         | No (errors go to `state.error`).         |
| `signOut`         | Same shape as `signIn` — sets loading, awaits, syncs. On error, sets `error` and resolves.                                    | No.                                      |
| `signInSilent`    | Awaits `client.signInSilent`, syncs, returns the session.                                                                     | **Yes** — bubbles up (e.g. `MonoCloudOPError('login_required')`). |
| `refreshSession`  | Awaits `client.refreshSession`, syncs.                                                                                        | **Yes**.                                 |
| `refetchUserInfo` | Awaits `client.refetchUserInfo`, syncs.                                                                                       | **Yes**.                                 |
| `getTokens`       | Awaits `client.getTokens`, syncs, returns the tokens.                                                                         | **Yes**.                                 |

`syncSession` = `client.getSession() → setState({ isLoading: false, isAuthenticated: !!session, user, session, error: undefined })`. It is called after every successful action so `useAuth()` reads always reflect the latest persisted session.

`useAuth()` thrown error if no provider above:

```
MonoCloudJsError: useAuth() can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.
```

## `useClient()`

```ts
function useClient(): MonoCloudWebJSClient;
```

Returns the underlying `MonoCloudWebJSClient` instance (the same one the provider built). Use for operations not surfaced on `useAuth()` — typically `client.oidcClient.revokeToken(...)`, or the static `MonoCloudOidcClient.decodeJwt(...)`, etc.

> Calling mutating methods directly on this client (e.g. `client.signOut()`) bypasses the context's `syncSession`. Prefer the `useAuth()` action; only fall through to `useClient()` when you genuinely need an operation the hook does not expose.

Throws `MonoCloudJsError` with the same "outside provider" message when used outside `<MonoCloudAuthProvider>`.

## `<SignIn>` / `<SignUp>`

```ts
interface SignInProps
  extends Omit<SignInOptions, 'signUp'>,
          ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

interface SignUpProps
  extends Omit<SignInOptions, 'signUp' | 'authenticatorHint' | 'loginHint' | 'prompt'>,
          ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}
```

Both render a `<button type="button">` that, on click, calls `signIn(options)` (with `signUp: true` for `<SignUp>`). All non-option props (`className`, `style`, `disabled`, `aria-*`, `data-*`, etc.) are forwarded to the button. They do not render an `<a>` — if you need a link, call `signIn` from your own component.

Props passthrough to the underlying `signIn()` call: `authenticatorHint`, `maxAge`, `loginHint`, `uiLocales`, `mode`, `acrValues`, `display`, `prompt`, `resource`, `audience`, `idTokenHint`, `returnUrl`, `scopes`, `appState` (and `signUp` is hard-coded for `<SignUp>`).

## `<SignOut>`

```ts
interface SignOutProps
  extends SignOutOptions,
          ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}
```

Renders a `<button type="button">` that calls `signOut({ idTokenHint, postLogoutRedirectUri, mode, federatedSignOut, returnUrl })` on click. `idTokenHint` supplies a manual `id_token_hint` that overrides the current session's ID token on the logout request. Other button props are forwarded.

## `<Protected>`

```ts
interface ProtectedComponentProps {
  children: ReactNode;
  groups?: string[];                          // require membership in any (or all) of these
  groupsClaim?: string;                       // default 'groups'
  matchAllGroups?: boolean;                   // default false (any-of); true => all-of
  fallback?: ReactNode;                       // shown when unauthenticated or errored
  onGroupAccessDenied?: (user: MonoCloudUser) => ReactNode; // shown when authed but groups missing
}
```

Render decision:

```
if (isLoading)                                 return null
if (error || !isAuthenticated || !user)        return fallback ?? null
if (no groups prop)                            return children
if (isUserInGroup(user, groups, groupsClaim, matchAllGroups))
                                               return children
                                               return onGroupAccessDenied(user)
```

`isUserInGroup` (from `@monocloud/auth-web-js/utils`) matches each expected group against the user's `groups` claim entries (string equality, or `{id|name}` for object entries). With `matchAllGroups: true`, the user must be in every entry of `groups`; otherwise membership in any single entry passes.

## `<ProcessCallback>`

```ts
interface ProcessCallbackProps {
  loading?: ReactNode;                         // shown while processing (default null)
  error?: ReactNode | ((error: Error) => ReactNode);
  children?: ReactNode;                        // shown after success (default null)
}
```

Mounted on a dedicated callback route — and **only** with `autoProcessCallback={false}` on the provider, otherwise the provider also runs `processCallback()` and you get duplicate work.

State machine: `processing → done | error`. The component runs `processCallback()` exactly once on mount (StrictMode-guarded with `useRef`). It renders no UI itself beyond the three slots; navigation after success is the provider-level `postCallback`'s job.

## Errors

All errors re-exported from `@monocloud/auth-web-js`:

```ts
class MonoCloudAuthBaseError extends Error {}

class MonoCloudOPError extends MonoCloudAuthBaseError {
  error: string;                                // OAuth error code (e.g. 'login_required')
  errorDescription?: string;
}

class MonoCloudValidationError extends MonoCloudAuthBaseError {}
class MonoCloudTokenError      extends MonoCloudAuthBaseError {}
class MonoCloudHttpError       extends MonoCloudAuthBaseError {}
class MonoCloudJsError         extends MonoCloudAuthBaseError {}
```

No status-code field. Branch with `instanceof`; for `MonoCloudOPError`, also branch on `.error` (`login_required`, `interaction_required`, `access_denied`, `invalid_grant`, etc.).

This package itself throws `MonoCloudJsError` in two specific cases:

1. `useAuth()` / `useClient()` called outside `<MonoCloudAuthProvider>`.
2. `<ProcessCallback>` rendered outside `<MonoCloudAuthProvider>`.

All other errors come from the underlying `MonoCloudWebJSClient` and bubble through unchanged.

## Underlying client

Re-exported: `MonoCloudWebJSClient`, `LocalStorage`, `SessionStorage`, `MemoryStorage`, plus every type listed at the top of this file (including the full `MonoCloudWebJSClientOptions` accepted by the provider).

For full details on the underlying client — constructor option shapes, method semantics, internal storage keys, cross-tab dedupe locks, hybrid response types, etc. — see the [`monocloud-web-js`](../../monocloud-web-js/references/api-surface.md) skill's `api-surface.md`. Everything that applies to `MonoCloudWebJSClient` directly also applies to the client constructed by `<MonoCloudAuthProvider>`.

## Defaults summary (this package only)

| Setting                | Default                                     |
| ---------------------- | ------------------------------------------- |
| `autoProcessCallback`  | `true`                                      |
| `<Protected>` `matchAllGroups` | `false` (any-of)                    |
| `<Protected>` `groupsClaim`    | `'groups'`                          |
| `<Protected>` `fallback`       | `null`                              |
| `<Protected>` `onGroupAccessDenied` | `() => <></>`                  |
| `<ProcessCallback>` `loading` / `children` | `null`                  |

All other defaults (storage, scopes, response type, popup dimensions, clock skew, etc.) come from `MonoCloudWebJSClient` and are listed in [`monocloud-web-js/references/api-surface.md`](../../monocloud-web-js/references/api-surface.md).

## What this SDK does **not** do

- It does not render UI beyond `<button>` (for sign-in/up/out) and slotting (`<Protected>`, `<ProcessCallback>`). No modals, no styled components.
- It does not provide a router. `postCallback` is the integration seam; navigation happens in your router.
- It does not provide server-side helpers. There is no `getSession()` for SSR — this is a client-only package. Use `@monocloud/auth-nextjs` if you need server sessions.
- It does not validate access tokens. APIs verify their own tokens (see `monocloud-auth-express` / `monocloud-auth-fastify`).
