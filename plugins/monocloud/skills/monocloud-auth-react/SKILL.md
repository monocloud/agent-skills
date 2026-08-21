---
name: monocloud-auth-react
description: Use when integrating MonoCloud authentication into a React single-page application — installing or configuring `@monocloud/auth-react`, wrapping the tree in `<MonoCloudAuthProvider>` with `tenantDomain` / `clientId` / `appUrl`, reading auth state with `useAuth()` (`isLoading`, `isAuthenticated`, `user`, `session`) and calling its actions (`signIn`, `signOut`, `signInSilent`, `refreshSession`, `refetchUserInfo`, `getTokens`), rendering `<SignIn>` / `<SignUp>` / `<SignOut>` buttons (with `audience` / `idTokenHint` auth params) or `<Protected groups=…>` gates, mounting `<ProcessCallback>` on a dedicated callback route with `autoProcessCallback={false}`, accessing the underlying `MonoCloudWebJSClient` with `useClient()`, integrating with React Router via `postCallback`, or troubleshooting "useAuth used outside provider", StrictMode double-callbacks, popup-blocker / iframe issues, or `login_required` from silent sign-in.
license: MIT
---

# MonoCloud React SDK (`@monocloud/auth-react`)

Authentication SDK for React single-page applications. Provides a context provider (`<MonoCloudAuthProvider>`), hooks (`useAuth`, `useClient`), and components (`<SignIn>`, `<SignUp>`, `<SignOut>`, `<Protected>`, `<ProcessCallback>`) wrapped around the browser implementation from `@monocloud/auth-web-js`.

## Package identity — read this first

**Use:** `@monocloud/auth-react` (this skill). The provider is `<MonoCloudAuthProvider>` and the hook is `useAuth`.

This is **not** the same SDK as:

- `@monocloud/auth-web-js` — the underlying browser SDK this package wraps (skill: `monocloud-web-js`). Use it directly for non-React SPAs.
- `@monocloud/auth-nextjs` — Next.js SDK with cookie-based server sessions, middleware, route protection (skill: `monocloud-auth-nextjs`). Has its own `useAuth` hook from `@monocloud/auth-nextjs/client` — **don't** mix the two; one or the other.
- `@monocloud/backend-node` — server-side API token validation (skills: `monocloud-auth-express`, `monocloud-auth-fastify`).
- `@monocloud/management` — server-only Management API client (skill: `monocloud-management-js`).

Pick this SDK for **React SPAs built with Vite / Create React App / a custom React setup that has no SSR/server framework**. If the app is Next.js, use `@monocloud/auth-nextjs` instead — it gives you cookie sessions, middleware, and server helpers this SDK doesn't have.

## Installation

```bash
npm install @monocloud/auth-react
```

Peer deps: `react ^18.0.0 || ^19.2.3`, `react-dom ^18.3.1 || ^19.2.3`. Engines: Node `>=16`.

No environment variables — **all configuration is passed as props to `<MonoCloudAuthProvider>`**, which forwards them to the underlying `MonoCloudWebJSClient`.

## Prerequisites (in the MonoCloud dashboard)

Configure the client as a **Single Page Application** with:

- **Allowed Callback URLs:** the full URL the OP should redirect back to. If you use `autoProcessCallback` (default) this is typically just the app root (e.g. `http://localhost:5173`). If you mount `<ProcessCallback>` on a dedicated route, register `appUrl + callbackPath` (e.g. `http://localhost:5173/callback`).
- **Allowed Sign-out URLs:** matches `appUrl + signOutPath` (or the app root if you didn't set one).
- **Allowed Origins (CORS):** the bare origin of the app (e.g. `http://localhost:5173`).
- **Scopes:** at minimum `openid`, `profile`, `email`. Add `offline_access` to get refresh tokens.

SPAs are public clients — **never** ship a `clientSecret` prop in production. The option exists on the underlying client only for advanced confidential-client setups.

## Quick start

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MonoCloudAuthProvider } from '@monocloud/auth-react';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MonoCloudAuthProvider
      tenantDomain="https://<your-tenant>.us.monocloud.com"
      clientId="<your-client-id>"
      defaultAuthParams={{ scopes: 'openid profile email offline_access' }}
    >
      <App />
    </MonoCloudAuthProvider>
  </StrictMode>,
);
```

```tsx
// src/App.tsx
import { SignIn, SignOut, Protected, useAuth } from '@monocloud/auth-react';

export function App() {
  const { isLoading, isAuthenticated, user } = useAuth();
  if (isLoading) return <p>Loading…</p>;
  return (
    <>
      {!isAuthenticated ? <SignIn>Sign In</SignIn> : <SignOut>Sign Out</SignOut>}
      <Protected fallback={<p>Sign in to view.</p>}>
        <p>Hi {user?.email}</p>
      </Protected>
    </>
  );
}
```

By default the provider mounts, the SDK runs `processCallback()` once, and the auth state lights up automatically when the user returns from the OP.

## Surface at a glance

| Export                          | Kind        | Purpose                                                                                      |
| ------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `<MonoCloudAuthProvider>`       | Component   | Boots a single `MonoCloudWebJSClient` and exposes state + actions via context.               |
| `useAuth()`                     | Hook        | Reads the auth state (`isLoading`, `isAuthenticated`, `user`, `session`, `error`) and exposes actions (`signIn`, `signOut`, `signInSilent`, `refreshSession`, `refetchUserInfo`, `getTokens`). |
| `useClient()`                   | Hook        | Returns the underlying `MonoCloudWebJSClient` for low-level operations (e.g. `client.oidcClient.revokeToken`). |
| `<SignIn>` / `<SignUp>`         | Component   | Renders a `<button>` that calls `signIn()` (with `signUp: true` for `<SignUp>`).             |
| `<SignOut>`                     | Component   | Renders a `<button>` that calls `signOut()`.                                                 |
| `<Protected>`                   | Component   | Client-side conditional render based on auth + optional group membership.                    |
| `<ProcessCallback>`             | Component   | For dedicated callback routes. Use with `autoProcessCallback={false}` on the provider.       |
| Re-exported from `auth-web-js`  | —           | `MonoCloudWebJSClient`, `LocalStorage`, `MemoryStorage`, `SessionStorage`, all 6 error classes, and the client/session/option types listed in `references/api-surface.md`. **Not** re-exported: `MonoCloudOidcClient` and the lower-level protocol types (`Jwks`, `IssuerMetadata`, `Tokens`, `CallbackParams`, `EndSessionParameters`, …) — import those from `@monocloud/auth-web-js`. |

Everything in `@monocloud/auth-react` is client-only (every file starts with `'use client';`). Don't import from this package in a Server Component / RSC.

## `<MonoCloudAuthProvider>` — provider props

`MonoCloudAuthProviderProps` extends `MonoCloudWebJSClientOptions` (from `@monocloud/auth-web-js`), so every option the underlying client accepts can be passed as a prop.

Required:

| Prop           | Purpose                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| `tenantDomain` | Your MonoCloud tenant URL, e.g. `https://acme.us.monocloud.com`.                              |
| `clientId`     | OIDC client id (SPA client registered in the dashboard).                                      |
| `children`     | The subtree that should see the auth context.                                                 |

Common optional:

| Prop                   | Default                  | Purpose                                                                                                    |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `appUrl`               | `window.location.origin` (recommended to pass explicitly) | Used to build redirect URIs and validate cross-origin postMessages. |
| `callbackPath`         | `/`                      | Relative path where MonoCloud redirects after sign-in. Must be in **Allowed Callback URLs**.               |
| `signOutPath`  | `/`                      | Relative path where MonoCloud redirects after sign-out. Must be in **Allowed Sign-out URLs**.              |
| `autoProcessCallback`  | `true`                   | When `true`, the provider runs `processCallback()` once on mount. Set to `false` to handle the callback on a dedicated route with `<ProcessCallback>`. |
| `defaultAuthParams`    | —                        | Pre-set `scopes` / `resource` / `responseType` / `prompt`, etc., on every auth request.                   |
| `resources`            | —                        | Additional `Indicator[]` for `getTokens()`.                                                                |
| `storage`              | `new LocalStorage()`     | Session persistence: `LocalStorage`, `SessionStorage`, `MemoryStorage`, or your own `IStorage`.            |
| `postCallback`         | full-page reload to `returnUrl` | Hook to integrate with a client-side router (React Router, TanStack Router, etc.) instead of a hard navigation. |
| `onSessionCreating`    | —                        | Async hook to mutate the session as it is being created.                                                   |
| `federatedSignOut`     | `true`                   | When `false`, `signOut()` only clears the local session without sending the user to MonoCloud.             |
| `fetchUserinfo`        | `true`                   | When `false`, skip the UserInfo call after authentication.                                                 |
| `validateIdToken`      | `true`                   | When `false`, skip ID token signature/claims validation. Not recommended.                                  |
| `authWindowTimeout`    | `600` (sec)              | Timeout for popup / iframe auth windows.                                                                   |
| `popupWindowWidth` / `popupWindowHeight` | `375` / `600` | Popup dimensions.                                                                           |
| `clockSkew` / `clockTolerance` | `0` / `60` (sec) | ID token clock skew / tolerance.                                                                       |

`<MonoCloudAuthProvider>` constructs the client **once** in `useState(() => new MonoCloudWebJSClient(props))` — props changes after the initial render do **not** rebuild the client. Treat all client-config props as bootstrap-time only. If you genuinely need to swap configuration at runtime, unmount and remount the provider (e.g. by `key`).

## `useAuth()` — state + actions

```tsx
'use client';
import { useAuth } from '@monocloud/auth-react';

export function Profile() {
  const {
    isLoading, isAuthenticated, user, session, error,
    signIn, signOut, signInSilent, refreshSession, refetchUserInfo, getTokens,
  } = useAuth();

  if (isLoading) return <p>Loading…</p>;
  if (error)     return <p>Error: {error.message}</p>;
  if (!isAuthenticated) return <button onClick={() => signIn()}>Sign in</button>;

  return (
    <>
      <p>Hi {user?.email}</p>
      <button onClick={() => signOut()}>Sign out</button>
    </>
  );
}
```

State shape (`AuthState` ⊂ `MonoCloudAuth`):

| Field             | Type                          | Notes                                                                |
| ----------------- | ----------------------------- | -------------------------------------------------------------------- |
| `isLoading`       | `boolean`                     | `true` during bootstrap (`processCallback` + initial `getSession`) and during any in-flight `signIn`/`signOut`. |
| `isAuthenticated` | `boolean`                     | `true` when a session exists.                                        |
| `user`            | `MonoCloudUser \| undefined`  | ID-token claims + UserInfo claims (filtered).                        |
| `session`         | `MonoCloudSession \| undefined` | Includes `idToken`, `accessTokens[]`, `refreshToken`, `authorizedScopes`. |
| `error`           | `Error \| undefined`          | Last error from a `signIn`, `signOut`, or initial `processCallback`. |

Action methods proxy to the underlying client; **all of them re-sync the auth state on success** (i.e., the next `useAuth()` read reflects the new session). They are stable across renders (memoized with `useCallback`).

> `signIn()` and `signOut()` do **not** re-throw caught errors — they put the error on `state.error` and resolve. If you need imperative throw-on-failure semantics, use `useClient()` and call the client directly.

Calling a hook outside the provider throws `MonoCloudJsError: useAuth() can only be used inside a <MonoCloudAuthProvider>...`.

## `useClient()` — escape hatch

For anything `useAuth()` does not cover — usually OIDC-level operations like token revocation, decoding, JWKS, or `client.oidcClient.*` calls — read the underlying `MonoCloudWebJSClient`:

```tsx
'use client';
import { useAuth, useClient } from '@monocloud/auth-react';

export function RevokeButton() {
  const { getTokens } = useAuth();
  const client = useClient();

  const revoke = async () => {
    const tokens = await getTokens();
    await client.oidcClient.revokeToken(tokens.accessToken);
  };

  return <button onClick={revoke}>Revoke access token</button>;
}
```

`useClient()` returns the same `MonoCloudWebJSClient` instance the provider built; calling its methods directly **bypasses the state sync** that the `useAuth()` actions do. If you mutate the session via the raw client (e.g. you call `client.signOut()` instead of the hook's `signOut`), call any of the `useAuth` actions afterwards to re-sync (or simpler: just use the hook).

## Components

### `<SignIn>` / `<SignUp>`

Render a `<button>` (forwards every `HTMLButtonElement` prop). When clicked it calls `signIn()` (with `signUp: true` for `<SignUp>`).

```tsx
import { SignIn, SignUp, SignOut } from '@monocloud/auth-react';

<SignIn>Sign In</SignIn>
<SignIn mode="popup" loginHint="alice@example.com">Sign in (popup)</SignIn>
<SignIn authenticatorHint="google" className="btn btn-primary">Continue with Google</SignIn>
<SignIn returnUrl="/dashboard">Sign in & go to dashboard</SignIn>
<SignIn audience="https://api.example.com">Sign in (audience-scoped token)</SignIn>
<SignIn idTokenHint={idToken} prompt="none">Silent re-auth</SignIn>
<SignUp returnUrl="/welcome">Create account</SignUp>
```

`<SignIn>` accepts everything `SignInOptions` accepts (except `signUp`) plus button props. `<SignUp>` accepts the same minus `signUp`, `authenticatorHint`, `loginHint`, `prompt` (those are sign-in-only).

### `<SignOut>`

```tsx
<SignOut>Sign Out</SignOut>
<SignOut mode="popup">Sign out (popup)</SignOut>
<SignOut federatedSignOut={false}>Local sign out only</SignOut>
<SignOut postLogoutRedirectUri="https://example.com/bye">Sign out and leave</SignOut>
<SignOut idTokenHint={idToken}>Sign out with explicit id_token_hint</SignOut>
```

Accepts every `SignOutOptions` field plus button props.

> The render is a plain `<button>`. If you need an `<a>` or a custom element, ignore the components and call `signIn()` / `signOut()` from `useAuth()` directly in your own component.

### `<Protected>` — client-side gate with optional groups

```tsx
import { Protected } from '@monocloud/auth-react';

// auth-only
<Protected fallback={<p>Sign in to view.</p>}>
  <SecretContent />
</Protected>

// require ANY of these groups
<Protected
  groups={['admin']}
  onGroupAccessDenied={user => <p>Not authorized: {user.email}</p>}
>
  <AdminPanel />
</Protected>

// require ALL of these groups
<Protected
  groups={['admin', 'billing']}
  matchAllGroups
  onGroupAccessDenied={user => <p>Need both admin AND billing.</p>}
>
  <SensitiveSettings />
</Protected>

// custom claim name (default is "groups")
<Protected groups={['admin']} groupsClaim="roles">
  <AdminPanel />
</Protected>
```

Behavior matrix:

| State                                | Renders                                  |
| ------------------------------------ | ---------------------------------------- |
| `isLoading`                          | `null`                                   |
| Error / unauthenticated / no user    | `fallback` (or `null` if no `fallback`)  |
| Authenticated, no `groups` prop      | `children`                               |
| Authenticated, in required groups    | `children`                               |
| Authenticated, not in required groups | `onGroupAccessDenied(user)` (default: `<></>`) |

> `<Protected>` only affects what is **rendered**. The component tree (children) is still in the bundle, and any data those components fetch will still hit the API. Enforce authorization on the API side as well (see `monocloud-auth-express` / `monocloud-auth-fastify`).

### `<ProcessCallback>` — dedicated callback route

By default, `<MonoCloudAuthProvider>` calls `processCallback()` itself on mount (the `autoProcessCallback` prop defaults to `true`) — there is **no need for a separate callback route** in most apps.

If you do want one (e.g. an isolated `/callback` page that shows a "Completing sign in…" UI), set `autoProcessCallback={false}` on the provider and render `<ProcessCallback>` on that route:

```tsx
// main.tsx
<MonoCloudAuthProvider
  tenantDomain="https://<your-tenant>"
  clientId="<your-client-id>"
  callbackPath="/callback"
  autoProcessCallback={false}
>
  <RouterProvider router={router} />
</MonoCloudAuthProvider>

// pages/Callback.tsx
import { ProcessCallback } from '@monocloud/auth-react';

export default function Callback() {
  return (
    <ProcessCallback
      loading={<p>Completing sign in…</p>}
      error={err => <p>Sign in failed: {err.message}</p>}
    >
      <p>Done — redirecting…</p>
    </ProcessCallback>
  );
}
```

Pick one path — auto vs dedicated. Mounting `<ProcessCallback>` **without** setting `autoProcessCallback={false}` is wasteful (the provider also runs it) and can produce a brief duplicate-processing state.

Where the user lands **after** a successful callback is controlled by the provider-level `postCallback` prop, not by `<ProcessCallback>`. See "Integrating with a client-side router" below.

## Integrating with a client-side router (React Router / TanStack Router)

The default `postCallback` performs a full page reload to `returnUrl` (set via `signIn({ returnUrl })`). That wipes Redux/Zustand/Jotai state and breaks `MemoryStorage`. With a client-side router, pass a `postCallback`:

```tsx
'use client';
import { MonoCloudAuthProvider } from '@monocloud/auth-react';
import { useNavigate } from 'react-router-dom';

export function AuthShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <MonoCloudAuthProvider
      tenantDomain="https://<your-tenant>"
      clientId="<your-client-id>"
      postCallback={state => navigate(state.returnUrl ?? '/')}
    >
      {children}
    </MonoCloudAuthProvider>
  );
}
```

For routers whose navigation hook is only available inside the `<Router>` subtree (the common case), place `<MonoCloudAuthProvider>` **inside** the router, not above it:

```tsx
<BrowserRouter>
  <AuthShell>{/* routes */}</AuthShell>
</BrowserRouter>
```

`postCallback` runs after both sign-in and sign-out callbacks. `state.signOut` tells you which.

## Access tokens for API calls

```tsx
'use client';
import { useAuth } from '@monocloud/auth-react';

export function FetchProtected() {
  const { getTokens } = useAuth();

  const handleClick = async () => {
    const { accessToken } = await getTokens();
    const res = await fetch('/api/things', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    /* ... */
  };

  return <button onClick={handleClick}>Load things</button>;
}
```

`getTokens()` transparently refreshes near-expired tokens via the Refresh Token Grant. It requires `offline_access` to be in the granted scopes at sign-in time — otherwise no refresh token is issued and the auto-refresh path throws `MonoCloudValidationError`. Set it on the provider:

```tsx
<MonoCloudAuthProvider
  /* ... */
  defaultAuthParams={{ scopes: 'openid profile email offline_access' }}
>
```

For audience-specific tokens, pre-register the resource and request via `getTokens`:

```tsx
<MonoCloudAuthProvider
  /* ... */
  resources={[{ resource: 'https://api.example.com', scopes: 'read:data write:data' }]}
>

// ...

const { accessToken } = await getTokens({ resource: 'https://api.example.com' });
```

## Errors

All errors extend `MonoCloudAuthBaseError` (which extends `Error`). They are re-exported from `@monocloud/auth-web-js`. Use `instanceof` to branch. `MonoCloudHttpError` exposes `.status` / `.statusText`, and every error carries a `.raw` (`{ status, statusText, headers, body }`) when it was derived from an unsuccessful HTTP response.

| Class                       | Thrown for                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `MonoCloudOPError`          | OAuth/OIDC error from the authorization server. Exposes `.error` and `.errorDescription`. Most common in this SDK: `login_required` from `signInSilent`, `access_denied` from a cancelled sign-in. |
| `MonoCloudValidationError`  | Bad state — no session, missing refresh token, scopes/responseType mismatch.                |
| `MonoCloudTokenError`       | Token operation failed (e.g. ID token validation).                                          |
| `MonoCloudHttpError`        | Network / unexpected HTTP response talking to MonoCloud.                                    |
| `MonoCloudJsError`          | Browser-environment failure (popup blocked, iframe in cross-origin-isolated context, hooks called outside provider, redirect attempted from inside an iframe, etc.). |
| `MonoCloudAuthBaseError`    | Base class — catch this when you want to handle any SDK error generically.                  |

For `signIn` / `signOut` (the hook actions), errors are surfaced on `state.error` rather than thrown. For `signInSilent` / `refreshSession` / `refetchUserInfo` / `getTokens` (and any direct `useClient()` calls), errors are thrown as usual:

```tsx
import { MonoCloudOPError } from '@monocloud/auth-react';

const { signInSilent } = useAuth();

useEffect(() => {
  signInSilent().catch(e => {
    if (e instanceof MonoCloudOPError && e.error === 'login_required') return;
    console.error(e);
  });
}, [signInSilent]);
```

## Common pitfalls

1. **Using `useAuth()` or `useClient()` outside the provider.** Throws `MonoCloudJsError: useAuth() can only be used inside a <MonoCloudAuthProvider>...`. Make sure the provider is an ancestor of every component that calls a hook.
2. **Trying to reconfigure the provider by changing props.** The underlying `MonoCloudWebJSClient` is created **once** (on the provider's first render). Prop changes are ignored. To swap config, remount the provider with a new `key`.
3. **Mounting `<ProcessCallback>` without `autoProcessCallback={false}`.** Both code paths run `processCallback()` — the second one is a no-op but adds an unnecessary loading flicker. Pick one.
4. **Using this skill in a Next.js app.** Don't. Use `@monocloud/auth-nextjs` instead — it gives cookie sessions, middleware, and server helpers. This SDK is for plain React SPAs.
5. **Forgetting `offline_access`.** Refresh tokens are only issued when `offline_access` is granted. Without it `refreshSession()` and the auto-refresh in `getTokens()` throw `MonoCloudValidationError`. Add it to `defaultAuthParams.scopes` (or pass via `<SignIn scopes="…">`).
6. **`signIn({ mode: 'popup' })` from `useEffect`.** Browsers block popups not opened from a user gesture. Call inside a click handler — the `<SignIn>` component already does this correctly; if you call `signIn` yourself, do it from `onClick`, not `useEffect`.
7. **Mismatched dashboard URLs.** `appUrl + callbackPath` (and `appUrl + signOutPath`) must exactly match the dashboard entries — including scheme, host, port, path. Same for the CORS origin.
8. **`MemoryStorage` + default `postCallback` + a `returnUrl`.** When a `returnUrl` was set, the default `postCallback` does `window.location.href = returnUrl` — a full page reload that empties memory and drops the just-created session (with no `returnUrl` it only strips the callback query params via `history.replaceState`, which is safe). Either keep the default `LocalStorage`/`SessionStorage` or pass a `postCallback` that navigates with your router (no reload).
9. **Wrapping the provider above `<BrowserRouter>` when `postCallback` uses `useNavigate`.** `useNavigate` only works inside `<BrowserRouter>`. Put the provider **inside** the router subtree.
10. **Shipping a `clientSecret` prop.** SPAs are public clients. Don't pass `clientSecret` — the bundle is public and the secret leaks.
11. **Calling `client.signOut()` from `useClient()` and expecting `isAuthenticated` to flip.** The raw client does not re-sync the context — use the hook's `signOut`, or call any other `useAuth` action afterwards to re-sync.
12. **Treating `<Protected>` as a security boundary.** It only gates what is rendered. The children code is still in the bundle, and anything they fetch still hits the API. Enforce on the server.

## Onboarding checklist for a fresh integration

1. `npm install @monocloud/auth-react`.
2. In the MonoCloud dashboard, configure the client as a **Single Page Application** and register the Callback URL, Sign-out URL, and Allowed Origin matching the dev origin (e.g. `http://localhost:5173`). Enable **Allow Access Tokens via the Browser** and **Allow Offline Access** if you need refresh tokens.
3. Wrap the root render in `<MonoCloudAuthProvider tenantDomain={…} clientId={…} defaultAuthParams={{ scopes: 'openid profile email offline_access' }}>`.
4. Read auth state with `useAuth()`; gate UI with `<Protected fallback={…}>`; add `<SignIn>` / `<SignOut>` (or `<SignUp>`) buttons where needed.
5. For protected fetches, call `getTokens()` from `useAuth()` and send `accessToken` in the `Authorization` header.
6. (Optional) For a dedicated callback route, set `autoProcessCallback={false}` and render `<ProcessCallback>` on that route.
7. (Optional) For client-side-router navigation after callbacks, pass `postCallback={state => navigate(state.returnUrl ?? '/')}`.
8. Run `node skills/monocloud-auth-react/scripts/verify.js` to sanity-check dependency wiring and provider/hook usage.

## Deeper reference

- [`references/api-surface.md`](references/api-surface.md) — every export, full provider prop shape, hook return type, component prop shapes, error classes.
- [`references/troubleshooting.md`](references/troubleshooting.md) — extended symptom → cause → fix index covering StrictMode double-callbacks, "useAuth outside provider," popup blockers, iframe / cross-origin issues, refresh-token gotchas, hooks-outside-router pitfalls, and training-data SDK ghosts.
