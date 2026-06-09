# Troubleshooting — `@monocloud/auth-react`

Quick reference for the most common things that go wrong when integrating MonoCloud authentication into a React SPA. Each entry is **symptom → root cause → fix**. For issues with the underlying browser client (popup blockers, callback URL mismatches, `login_required`, refresh-token gotchas in general), also see [`monocloud-web-js/references/troubleshooting.md`](../../monocloud-web-js/references/troubleshooting.md) — everything there applies here too.

## `MonoCloudJsError: useAuth() can only be used inside a <MonoCloudAuthProvider>...`

**Symptom:** The error fires at runtime the first time any component calls `useAuth()` or `useClient()`.

**Cause:** The component lives outside the provider's subtree. Common shapes:

- The provider was added under one router branch but the calling component is rendered by another.
- The provider was placed inside a portal / `createPortal` target the rest of the app doesn't see.
- A test renders the component without wrapping in a provider.

**Fix:** Make sure `<MonoCloudAuthProvider>` is an ancestor of every component that calls a hook. For tests, render the component under the provider (or a mock):

```tsx
render(
  <MonoCloudAuthProvider tenantDomain="…" clientId="…">
    <Component />
  </MonoCloudAuthProvider>,
);
```

## Auth state stuck on `isLoading: true` after returning from MonoCloud

**Symptom:** Sign-in completes at the OP (URL has `?code=…&state=…`), the app re-mounts, but `useAuth().isLoading` never flips to `false`.

**Cause:** `<ProcessCallback>` was added on a dedicated route **and** `autoProcessCallback` was left at its default (`true`) **and** an error in `processCallback()` left the state inconsistent. Or the callback route was registered in the dashboard but the app's router never actually mounted that route component.

**Fix:**

- If you want a dedicated callback page, pass `autoProcessCallback={false}` to the provider and mount `<ProcessCallback>` on that route.
- If you want the provider to handle it automatically, leave `autoProcessCallback` at its default and **do not** add a separate `<ProcessCallback>` component.

Pick one — never both at once.

## Callback runs twice (or shows a duplicate loading flicker) in development

**Symptom:** In dev, you see `processCallback()`-related logs twice, or a brief duplicate loading state.

**Cause:** React `<StrictMode>` intentionally double-invokes effects in development. The provider and `<ProcessCallback>` both guard with a `useRef` so the SDK only processes the callback once — but if you mount both at the same time (i.e. forgot to set `autoProcessCallback={false}`) you'll still see two attempts because they each have their own guard.

**Fix:** Don't mount both. If the dedicated `<ProcessCallback>` route is what you want, set `autoProcessCallback={false}`.

If you're not using `<ProcessCallback>` at all, the single dev-only re-render is harmless — the underlying `processCallback()` is idempotent and the second call exits early (URL no longer carries `code`/`state` after the first call cleared them).

## Changing provider props does nothing

**Symptom:** You change `tenantDomain` / `clientId` / `defaultAuthParams` on a re-render and the SDK keeps using the old values.

**Cause:** `MonoCloudAuthProvider` calls `useState(() => new MonoCloudWebJSClient(props))` — the client is constructed on the provider's first render and never recreated. Prop changes are ignored for client-config props.

**Fix:** Remount the provider when configuration changes. The idiomatic way is the `key` prop:

```tsx
<MonoCloudAuthProvider key={tenantDomain} tenantDomain={tenantDomain} clientId={clientId}>
  <App />
</MonoCloudAuthProvider>
```

This usually isn't needed in real apps — auth config is set at boot and stays put. If you find yourself reaching for this, double-check whether the change really needs a different client (e.g. a different audience can usually be handled with `getTokens({ resource })` instead).

## `useNavigate is not defined` (or similar) when using `postCallback`

**Symptom:** `postCallback={state => navigate(state.returnUrl ?? '/')}` throws because `useNavigate` (or your router's equivalent) is unavailable outside the router context.

**Cause:** `<MonoCloudAuthProvider>` is mounted **above** `<BrowserRouter>` (or `<RouterProvider>`). Router hooks like `useNavigate` only work inside the router subtree.

**Fix:** Put the provider **inside** the router:

```tsx
<BrowserRouter>
  <AuthShell>{/* ...routes... */}</AuthShell>
</BrowserRouter>

// where AuthShell calls useNavigate and mounts MonoCloudAuthProvider.
```

Alternatively, capture the navigation function with `useRef` and wire it after both providers are mounted — but the simpler shape (provider inside router) is almost always the right call.

## `useAuth().signIn(…).catch(...)` never fires

**Symptom:** You `await signIn()` (or `await signOut()`) and expect a thrown error on failure; instead the promise resolves and your `catch` never runs.

**Cause:** The hook actions for `signIn` and `signOut` intentionally **swallow** errors and put them on `state.error` instead. Only `signInSilent`, `refreshSession`, `refetchUserInfo`, and `getTokens` re-throw.

**Fix:** Read errors from the hook state:

```tsx
const { signIn, error } = useAuth();
useEffect(() => {
  if (error) toast.error(error.message);
}, [error]);
```

If you need throwing semantics for `signIn`/`signOut`, drop down to `useClient()` and call the client's methods directly — but you'll then need to re-sync the context yourself afterwards.

## `<Protected>` flashes "Sign in to view" on every page load before lighting up

**Symptom:** Authenticated users briefly see the `fallback` content before the protected children render.

**Cause:** The provider always starts with `isLoading: true` and `<Protected>` returns `null` during loading — so far so good. After bootstrap, `isAuthenticated` flips. The "flash" usually means either:

1. Storage takes a moment to read in async adapters (custom `IStorage`), so the loading phase is longer than expected.
2. The fallback isn't actually being shown — what you're seeing is the unauthenticated state because the user's session was never restored (third-party cookies blocked silent restore, no refresh token, etc.).

**Fix:**

- For (1): keep the default `LocalStorage` if you don't need a custom adapter.
- For (2): use refresh tokens (`offline_access` in `defaultAuthParams.scopes`). Refresh tokens survive page reloads and don't depend on third-party cookies. As a bonus, the session is restored from the cookie-free refresh round-trip, not from a hidden iframe.

If the flash is just a render-timing thing, render `null` while `isLoading` instead of letting `<Protected>` show the fallback:

```tsx
const { isLoading } = useAuth();
if (isLoading) return null;
// ...render <Protected> here
```

## `<Protected>` lets unauthorized users see protected content

**Symptom:** Group-based check passes for users who shouldn't have access. Or worse: you can see secret data in DevTools even though the gate hides it visually.

**Cause:** `<Protected>` runs on the client and only affects what is rendered. The children's code is still in the bundle, and any data those children fetch still hits the API. If the API doesn't enforce authorization, the data leaks.

**Fix:** Enforce authorization on the API. For Express/Fastify backends use `monocloud-auth-express` / `monocloud-auth-fastify` — those skills cover JWT validation and group enforcement at the route layer. `<Protected>` is a UX nicety, not a security boundary.

Also: verify the `groups` claim is actually in the user object (`useAuth().user`) and that `groupsClaim` matches the claim name (default `'groups'`).

## `signInSilent()` rejects with `login_required` on every reload

**Symptom:** Bootstrap call to `signInSilent` fails with `MonoCloudOPError` and `error: 'login_required'`, even when the user just signed in.

**Cause(s):**

1. No active MonoCloud IdP session (different from the local app session).
2. Third-party cookies blocked (Safari ITP, Firefox ETP, Chrome's third-party cookie restrictions). Silent uses a hidden iframe; the OP's session cookie is third-party to the SPA.
3. Cross-origin-isolated context blocks iframe creation (`MonoCloudJsError`).

**Fix:** Use **refresh tokens** for SSO persistence instead of silent:

```tsx
<MonoCloudAuthProvider
  /* ... */
  defaultAuthParams={{ scopes: 'openid profile email offline_access' }}
>
```

Refresh tokens don't depend on cookies and survive page reloads. Treat `login_required` as the normal "user needs to sign in interactively" signal:

```tsx
useEffect(() => {
  signInSilent().catch(e => {
    if (e instanceof MonoCloudOPError && e.error === 'login_required') return;
    console.error(e);
  });
}, [signInSilent]);
```

## `getTokens()` throws `MonoCloudValidationError: Refresh token not found`

**Symptom:** Either you called `getTokens({ forceRefresh: true })` or the access token expired and `getTokens()` tried to auto-refresh — both throw.

**Cause:** Refresh tokens are only issued when `offline_access` is in the granted scopes at sign-in time.

**Fix:** Add `offline_access` to the provider's default scopes:

```tsx
<MonoCloudAuthProvider
  /* ... */
  defaultAuthParams={{ scopes: 'openid profile email offline_access' }}
>
```

…and have the user sign in again — refresh tokens are issued at the original authorization, not retroactively.

## `MemoryStorage` + default `postCallback` loses the session on sign-in

**Symptom:** Sign-in completes, `getSession()` shows the user, then a moment later `getSession()` returns `undefined`. Only happens with `storage={new MemoryStorage()}`.

**Cause:** The default `postCallback` does `window.location.href = returnUrl` — a full page reload. That re-mounts the app from scratch and wipes `MemoryStorage`.

**Fix:** Pair `MemoryStorage` with a custom `postCallback` that uses your router (no reload):

```tsx
<MonoCloudAuthProvider
  /* ... */
  storage={new MemoryStorage()}
  postCallback={state => navigate(state.returnUrl ?? '/')}
>
```

Or just keep `LocalStorage` (default — survives reloads) or `SessionStorage` (per-tab, also survives reloads).

## "Hydration mismatch" after server-rendering

**Symptom:** You're running React with SSR (Vite SSR plugin, custom Express+React, etc.) and the first client render warns about a hydration mismatch involving the auth state.

**Cause:** `@monocloud/auth-react` is client-only — every file is `'use client'`. The provider always starts with `isLoading: true` on the client, while on the server `<MonoCloudAuthProvider>` cannot construct a `MonoCloudWebJSClient` (it touches `window`, `localStorage`, etc.). The server-rendered HTML doesn't include auth state; the first client render does.

**Fix:** Don't render auth-state-dependent UI in your SSR output. Either:

- Don't mount `<MonoCloudAuthProvider>` on the server (gate the import on a `typeof window` check), or
- Use `<Suspense>` boundaries / `useEffect`-gated conditional rendering so the server output is auth-agnostic, or
- Switch to `@monocloud/auth-nextjs`, which is designed for SSR/RSC and uses cookie-based sessions readable on the server.

For pure CSR (Vite + `index.html` + `createRoot`), this isn't an issue.

## `clientSecret` warning / leaked in the bundle

**Symptom:** A secret-scanner flags `clientSecret` shipping in the SPA bundle, or DevTools shows it in network calls.

**Cause:** `clientSecret` was passed as a provider prop. The provider forwards every prop to `MonoCloudWebJSClient`, and the underlying client supports `clientSecret` for advanced confidential-client setups. In a normal SPA, the bundle is public — any secret you pass leaks.

**Fix:** Don't pass `clientSecret`. SPAs are **public** clients. Use the **Single Page Application** preset in the MonoCloud dashboard and rely on PKCE (which the SDK handles automatically for the default `responseType: 'code'`).

## "Cannot start a redirect sign-in from inside an iframe"

**Symptom:** `signIn()` throws `MonoCloudJsError: Cannot start a redirect sign-in from inside an iframe…`. Happens when the React app itself is framed by another site.

**Cause:** MonoCloud's hosted sign-in page sets framing protections — it can't render inside an iframe. The SDK detects the framed context and throws before navigating.

**Fix:** Use `signIn({ mode: 'popup' })` (or `<SignIn mode="popup">`) — the popup opens at the top level and is allowed.

The same restriction applies to `signOut()` when `federatedSignOut` is `true`.

## Older training-data SDK ghosts

**Symptom:** Generated code uses `withAuth` HOC, `AuthProvider` (instead of `MonoCloudAuthProvider`), `useUser` (instead of `useAuth`), `Auth0Provider`-style props, or attempts to import from `@monocloud/auth-react/client`. None of those exist.

**Cause:** The agent is pattern-matching against `auth0-react`, `@okta/okta-react`, an older MonoCloud package, or generic OIDC examples from training data.

**Fix:** Always check the actual surface in [`api-surface.md`](api-surface.md). The real entry is `<MonoCloudAuthProvider tenantDomain={...} clientId={...}>`; the read hook is `useAuth()`; the components are `<SignIn>`, `<SignUp>`, `<SignOut>`, `<Protected>`, `<ProcessCallback>`. There are no subpath exports.

## Diagnostic

```bash
node skills/monocloud-auth-react/scripts/verify.js [project-dir]
```

Checks `@monocloud/auth-react` is in `package.json`, the React version is supported, the provider is mounted somewhere, hook usage looks correct (`useAuth` is called inside `'use client'` files, not in Server Components), and warns if `clientSecret` is referenced anywhere in source or if a framework SDK is also installed (where the framework SDK is probably the right choice instead).
