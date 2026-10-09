---
name: monocloud-auth-react
description: Use when integrating MonoCloud authentication into a React single-page application — installing or configuring `@monocloud/auth-react`, wrapping the tree in `<MonoCloudAuthProvider>` (`tenantDomain`, `clientId`, `appUrl`), reading `useAuth()` state (`isLoading`, `isAuthenticated`, `user`, `session`, `error`) and actions (`signIn`, `signOut`, `signInSilent`, `refreshSession`, `refetchUserInfo`, `getTokens`), rendering `<SignIn>` / `<SignUp>` / `<SignOut>` buttons or `<Protected groups=…>` gates, mounting `<ProcessCallback>` on a callback route with `autoProcessCallback={false}`, reaching the underlying `MonoCloudWebJSClient` via `useClient()`, React Router navigation via `postCallback`, or troubleshooting "useAuth() can only be used inside a <MonoCloudAuthProvider>", StrictMode double callbacks, `signIn` errors landing in `error`, render loops after `getTokens()`, popup blockers, `login_required` from silent sign-in, or `Session does not contain refresh token`.
license: MIT
---

# MonoCloud React SDK (`@monocloud/auth-react`)

React provider, hooks and components for single-page apps, built on `@monocloud/auth-web-js` (OIDC Authorization Code + PKCE in the browser). It re-exports that package's client, storage adapters, error classes and most types.

## Package identity — read first

Check `package.json` before suggesting code. Use **`@monocloud/auth-react`** for React SPAs without a server framework (Vite and similar).

| Project | Use instead | Skill |
| --- | --- | --- |
| Next.js | `@monocloud/auth-nextjs` — its own `useAuth` is in `@monocloud/auth-nextjs/client`; never mix the two packages | `monocloud-auth-nextjs` |
| Non-React browser app | `@monocloud/auth-web-js` | `monocloud-web-js` |
| API validating bearer tokens | `@monocloud/backend-node` | `monocloud-auth-express`, `monocloud-auth-fastify` |
| Server calling the Management API | `@monocloud/management` | `monocloud-management-js` |

- One entry point: import from `@monocloud/auth-react` — there are no subpaths (`/client`, `/components`, …). `MonoCloudOidcClient` and the `/utils` helpers are not re-exported; import those from `@monocloud/auth-web-js` (kept on the same release).
- Not exported: `AuthProvider`, `MonoCloudProvider`, `useUser`, `useSession`, `useMonoCloud`, `withAuth`, `withAuthenticationRequired`, `loginWithRedirect`, `getAccessTokenSilently` — those are other SDKs' APIs.
- No environment variables: configuration is provider props (with Vite, pass your own `import.meta.env.VITE_*` values).
- Client-only: the entry is marked `'use client'` and all work happens in effects and event handlers.

## Install and dashboard setup

```bash
npm install @monocloud/auth-react
```

Peer dependencies: `react` `^18.0.0 || ^19.2.3`, `react-dom` `^18.3.1 || ^19.2.3`.

Create a **Single Page Application** client (public — never pass `clientSecret`) and register:

- **Callback URLs**: `appUrl + callbackPath` with any trailing `/` removed — by default just the origin, e.g. `http://localhost:5173`.
- **Sign-out URLs**: `appUrl + signOutPath` (default: the origin).
- **Cross-Origin URLs**: the origin.
- The SDK's example app also enables **Allow Access Tokens via the Browser** and **Allow Offline Access** (required for `offline_access` refresh tokens).

## Quick start

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MonoCloudAuthProvider } from '@monocloud/auth-react';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MonoCloudAuthProvider
      tenantDomain="https://<your-tenant-domain>"
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
import { useAuth, SignIn, SignUp, SignOut } from '@monocloud/auth-react';

export default function App() {
  const { isLoading, isAuthenticated, user, error } = useAuth();

  if (isLoading) return <p>Loading…</p>;
  if (!isAuthenticated) {
    return (
      <>
        <SignIn>Sign in</SignIn> <SignUp>Sign up</SignUp>
        {error && <p>{error.message}</p>}
      </>
    );
  }
  return (
    <>
      <p>Hi {user?.email}</p>
      <SignOut>Sign out</SignOut>
    </>
  );
}
```

On mount the provider runs `processCallback()` (finishing any sign-in or sign-out the browser is returning from) and loads the stored session; `isLoading` stays `true` until then. StrictMode's double effect is guarded, so the callback is processed once.

## `<MonoCloudAuthProvider>` props

`MonoCloudAuthProviderProps` = every `MonoCloudWebJSClientOptions` field + `children` + `autoProcessCallback`.

| Prop | Default | Notes |
| --- | --- | --- |
| `tenantDomain`, `clientId` | required | Tenant URL (must equal the ID token's `iss`) and SPA client ID. |
| `appUrl` | `window.location.origin` | Base for redirect URIs; popup/iframe messages must come from its origin. |
| `callbackPath` / `signOutPath` | `/` | Where MonoCloud returns after sign-in / sign-out. |
| `autoProcessCallback` | `true` | `false` hands callback processing to `<ProcessCallback>`. |
| `defaultAuthParams` | — | Only `scopes`, `resource`, `responseType` are applied; pass `prompt`, `audience`, `loginHint`, … per call or as `<SignIn>` props. |
| `resources` | — | Extra `{ resource, scopes? }` indicators: merged into sign-in, used by `getTokens({ resource })`. |
| `storage` | `new LocalStorage()` | `SessionStorage`, `MemoryStorage`, or a custom `IStorage`. |
| `postCallback` | URL cleanup, or a full page load to `returnUrl` | Router navigation — see [below](#react-router-navigation-postcallback). |
| `onSessionCreating` | — | Mutate the session before it is stored. |
| `federatedSignOut` | `true` | `false`: sign-out clears only the local session. |
| `fetchUserinfo` / `validateIdToken` | `true` | |
| `authWindowTimeout` | `600` s | Popup / silent-iframe timeout. |

Also accepted with the web-js defaults: `idTokenSigningAlgorithm`, `clockSkew`, `clockTolerance`, `popupWindowWidth`, `popupWindowHeight`, `sessionKey`, `filteredIdTokenClaims`, `jwksCacheDuration`, `metadataCacheDuration` (see the `monocloud-web-js` skill).

The client is built **once**, on first render: later prop changes — including `postCallback`, `onSessionCreating`, `storage`, `autoProcessCallback` — are ignored, and function props keep their first-render closures. Remount with a new `key` to reconfigure.

**Scopes:** `openid profile email` is requested only when no scopes are configured anywhere. Once you set `defaultAuthParams.scopes`, a per-call `scopes`, or `resources[].scopes`, include `openid profile email` (and `offline_access`) yourself.

## `useAuth()`

| Member | Notes |
| --- | --- |
| `isLoading` | `true` during bootstrap and while `signIn` / `signOut` run. |
| `isAuthenticated` | A session exists in storage. |
| `user` / `session` | `MonoCloudUser` / `MonoCloudSession` (`idToken`, `accessTokens[]`, `refreshToken`, `authorizedScopes`). Replaced by new objects after every action. |
| `error` | Last failure of callback processing, `signIn` or `signOut`; cleared by the next successful action. |
| `signIn(o?)` / `signOut(o?)` | Web-js options (`mode`, `returnUrl`, `scopes`, …). **Never reject** — failures go to `error`. |
| `signInSilent(o?)` | Resolves to the session; **rejects** (`MonoCloudOPError` `login_required`, …). |
| `refreshSession(o?)` / `refetchUserInfo()` | Reject on failure. |
| `getTokens(o?)` | `{ accessToken, idToken, refreshToken, isExpired, … }`, refreshing first when needed; rejects on failure. |

Every successful action re-reads the session and publishes it to context. The actions are stable across renders. Outside the provider it throws `MonoCloudJsError: useAuth() can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.`

```tsx
const { getTokens } = useAuth();

async function loadThings() {
  const { accessToken } = await getTokens(); // refreshes when missing or expiring within 30 s
  return fetch('https://api.example.com/things', { headers: { Authorization: `Bearer ${accessToken}` } });
}
```

For a second API, add `resources={[{ resource: 'https://api.example.com', scopes: 'read:data' }]}` to the provider and call `getTokens({ resource: 'https://api.example.com' })`.

Restore an existing MonoCloud (SSO) session once at startup — `login_required` simply means "not signed in at MonoCloud" (or third-party cookies are blocked):

```tsx
import { useEffect, useRef } from 'react';
import { useAuth, MonoCloudOPError } from '@monocloud/auth-react';

export function useSilentSignIn() {
  const { isLoading, isAuthenticated, signInSilent } = useAuth();
  const tried = useRef(false);
  useEffect(() => {
    if (isLoading || isAuthenticated || tried.current) return;
    tried.current = true;
    signInSilent().catch(e => {
      if (!(e instanceof MonoCloudOPError)) console.error(e);
    });
  }, [isLoading, isAuthenticated, signInSilent]);
}
```

## Components

| Component | Renders | Props |
| --- | --- | --- |
| `<SignIn>` | `<button type="button">` → `signIn()` | `SignInOptions` except `signUp`: `mode`, `returnUrl`, `appState`, `scopes`, `resource`, `audience`, `prompt`, `loginHint`, `authenticatorHint`, `uiLocales`, `display`, `acrValues`, `maxAge`, `idTokenHint`; plus button attributes |
| `<SignUp>` | button → `signIn({ signUp: true })` | as `<SignIn>` minus `authenticatorHint`, `loginHint`, `prompt` |
| `<SignOut>` | button → `signOut()` | `mode`, `federatedSignOut`, `postLogoutRedirectUri`, `idTokenHint`, `returnUrl`; plus button attributes |
| `<Protected>` | `children` when allowed | `fallback`, `groups`, `matchAllGroups`, `groupsClaim` (default `'groups'`), `onGroupAccessDenied(user)` |
| `<ProcessCallback>` | `loading`, then `children` or `error` | see [Dedicated callback route](#dedicated-callback-route) |

```tsx
<SignIn mode="popup" authenticatorHint="google">Continue with Google</SignIn>
<SignIn returnUrl="/dashboard" audience="https://api.example.com">Sign in</SignIn>
<SignOut federatedSignOut={false}>Sign out of this app only</SignOut>

<Protected fallback={<p>Please sign in.</p>}>
  <Dashboard />
</Protected>
<Protected groups={['admin', 'billing']} matchAllGroups onGroupAccessDenied={user => <p>{user.email} lacks access.</p>}>
  <Billing />
</Protected>
```

- The buttons set `type="button"` and their own `onClick` (a passed `onClick` is ignored); `className`, `disabled`, `aria-*` and other attributes are forwarded. For custom click logic, call `useAuth().signIn()` yourself.
- `<Protected>` renders nothing while loading; `fallback` (or nothing) when signed out or `error` is set; with `groups`, `children` only when the user's groups claim has any listed group (all of them with `matchAllGroups`), otherwise `onGroupAccessDenied(user)` (default: nothing). It only hides UI — enforce authorization in your API.

## Dedicated callback route

With the default `autoProcessCallback`, callbacks are processed on whatever route loads — no callback page needed. For a "Completing sign in…" page:

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { MonoCloudAuthProvider, ProcessCallback } from '@monocloud/auth-react';

function Callback() {
  return (
    <ProcessCallback loading={<p>Completing sign in…</p>} error={err => <p>Sign-in failed: {err.message}</p>}>
      <p>Done.</p>
    </ProcessCallback>
  );
}

const router = createBrowserRouter([
  { path: '/callback', element: <Callback /> },
  // …other routes
]);

createRoot(document.getElementById('root')!).render(
  <MonoCloudAuthProvider
    tenantDomain="https://<your-tenant-domain>"
    clientId="<your-client-id>"
    callbackPath="/callback"
    signOutPath="/callback"
    autoProcessCallback={false}
    postCallback={state => {
      if (state.mode === 'redirect' || state.returnUrl) router.navigate(state.returnUrl ?? '/', { replace: true });
    }}
  >
    <RouterProvider router={router} />
  </MonoCloudAuthProvider>,
);
```

- With `autoProcessCallback={false}` nothing else processes callbacks: every path MonoCloud returns to (`callbackPath` and `signOutPath`; popup and silent flows land there too) must render `<ProcessCallback>`.
- Never combine it with `autoProcessCallback` on: the second run finds nothing pending and briefly publishes a signed-out, not-loading state while the first is still exchanging the code.
- `<ProcessCallback>` doesn't navigate — without a `postCallback` that does, the user stays on the callback page.

## React Router navigation (`postCallback`)

The default `postCallback` strips `?code=…&state=…` without reloading, but performs a **full page load** when `returnUrl` is set. To navigate with the router instead, either call a data router's `router.navigate()` (as above), or render the provider inside the router and use `useNavigate()`:

```tsx
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router'; // or 'react-router-dom', matching your setup
import { MonoCloudAuthProvider } from '@monocloud/auth-react';

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <MonoCloudAuthProvider
      tenantDomain="https://<your-tenant-domain>"
      clientId="<your-client-id>"
      postCallback={state => {
        // also called after popup and silent sign-ins — only navigate for redirects or explicit returnUrls
        if (state.mode === 'redirect' || state.returnUrl) navigate(state.returnUrl ?? '/', { replace: true });
      }}
    >
      {children}
    </MonoCloudAuthProvider>
  );
}
```

## `useClient()`

Returns the provider's `MonoCloudWebJSClient`, for operations `useAuth()` doesn't wrap — e.g. `client.oidcClient.revokeToken(accessToken)`. Calls made on it don't update context: after a session-changing call (`client.signOut()`, `client.refreshSession()`, …) the UI stays stale until the next `useAuth()` action, so prefer the hook's actions. Outside the provider: `MonoCloudJsError: useClient() can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.`

## Errors

Re-exported from `@monocloud/auth-web-js` (same classes, so `instanceof` works across both packages):

| Class | Raised for |
| --- | --- |
| `MonoCloudOPError` | Authorization-server errors: `.error` (also the `message` — `login_required`, `access_denied`, `invalid_grant`), `.errorDescription`. |
| `MonoCloudValidationError` | SDK checks: no session, no refresh token, callback `state` mismatch. |
| `MonoCloudTokenError` | ID-token validation (`Invalid Issuer`, `Nonce mismatch`, …) and UserInfo 401/403; `.code`. |
| `MonoCloudHttpError` | Unexpected status or network/CORS failure (`.status` undefined then). |
| `MonoCloudJsError` | Popup blocked/closed, window timeout, iframe restrictions, lock timeout, hooks or `<ProcessCallback>` outside the provider. |
| `MonoCloudAuthBaseError` | Base class; `.raw` (`{ status, statusText, headers, body }`) on HTTP-derived errors. |

## Common pitfalls

1. **Hooks or `<ProcessCallback>` outside `<MonoCloudAuthProvider>`** — throws `MonoCloudJsError`.
2. **`try { await signIn() } catch`** — never catches; read `error` from `useAuth()`.
3. **Effects that depend on `user` / `session` and call an action** (`getTokens`, `refetchUserInfo`, …) — every action publishes new objects, so the effect re-runs forever. Depend on `isAuthenticated` or `user?.sub`.
4. **`<ProcessCallback>` with `autoProcessCallback` on** (transient signed-out state), or **`autoProcessCallback={false}` without `<ProcessCallback>`** on the return routes (callbacks never complete).
5. **Changing provider props at runtime** — ignored; remount with `key`.
6. **Using this package in Next.js** — use `@monocloud/auth-nextjs`.
7. **No `offline_access`**, or **scopes without `openid`** — no refresh token / no profile.
8. **`defaultAuthParams.prompt` / `audience` / `loginHint`** — not applied; pass per call or as `<SignIn>` props.
9. **A `postCallback` that always navigates** — it also fires after `signInSilent()` and popup sign-ins.
10. **`useNavigate()` in a provider wrapper above the router** — React Router throws; put the provider inside the router.
11. **Popup sign-in from `useEffect` or after an `await`** — blocked by the browser; `<SignIn mode="popup">` is fine.
12. **`storage={new MemoryStorage()}` with the default `postCallback` and a `returnUrl`** — the full page load wipes the session.
13. **A `clientSecret` prop** — it ships in the bundle; SPA clients are public.
14. **Treating `<Protected>` as security** — it only hides UI.

## Verify and go deeper

- [`scripts/verify.js`](scripts/verify.js) — run `node scripts/verify.js [project-dir]` from this skill's folder: checks the dependency and React peers, imports against the real exports, provider and `<ProcessCallback>` wiring, `useClient()` misuse, effect loops, popups in effects, placeholders, `clientSecret`, browser-exposed secrets in `.env*`, Vite env usage, `MemoryStorage` and `offline_access`.
- [`references/api-surface.md`](references/api-surface.md) — every export, provider lifecycle, hook and component signatures, errors.
- [`references/troubleshooting.md`](references/troubleshooting.md) — symptom → cause → fix for React-specific issues; browser-client issues (callback URLs, popups, silent sign-in, ID-token errors) are covered by the `monocloud-web-js` skill's troubleshooting.
