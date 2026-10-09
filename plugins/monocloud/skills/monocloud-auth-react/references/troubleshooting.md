# Troubleshooting — `@monocloud/auth-react`

Symptom → cause → fix for React-specific problems. The provider wraps `MonoCloudWebJSClient`, so browser-client issues — callback URL mismatches, `Could not open popup`, `Window closed by user`, silent sign-in, `Sign in callback states mismatch`, ID-token validation messages — are covered in the `monocloud-web-js` skill's [troubleshooting.md](../../monocloud-web-js/references/troubleshooting.md).

## `MonoCloudJsError: useAuth() can only be used inside a <MonoCloudAuthProvider>...</MonoCloudAuthProvider>.`

Also `useClient() can only be used inside …` and `<ProcessCallback /> can only be used inside …`.

**Cause:** the component renders outside the provider's subtree — the provider wraps only one branch, sits inside a portal target, or a test renders the component bare.

**Fix:** make `<MonoCloudAuthProvider>` an ancestor of every consumer; in tests, wrap the component in the provider (or mock the hook module).

## `isLoading` never becomes `false`

**Cause:** bootstrap failures don't cause this — they set `isLoading: false` and `error`. A promise that never settles does: a custom `postCallback` that never resolves (the client awaits it), or a custom `IStorage` whose `getItem` never resolves.

**Fix:** let `postCallback` return after navigating; make every `IStorage` method resolve (`getItem` → `null` on a miss).

During a popup `signIn` / `signOut`, `isLoading` is `true` until the popup completes, is closed, or hits `authWindowTimeout` — render the page normally rather than a full-screen spinner if that matters.

## Brief signed-out state while returning from MonoCloud

**Cause:** `<ProcessCallback>` is mounted while `autoProcessCallback` is on. Both run `processCallback()`; the one that finds nothing pending finishes first and publishes `isLoading: false` with the old (signed-out) state, and route guards may redirect before the real exchange completes.

**Fix:** pick one: the default (no `<ProcessCallback>`), or `autoProcessCallback={false}` plus `<ProcessCallback>` on the callback routes. StrictMode alone is fine — both code paths guard their mount effect.

## Callbacks never complete with `autoProcessCallback={false}`

**Cause:** with automatic processing off, only `<ProcessCallback>` completes flows. A missing component, a route that doesn't render it at `callbackPath` / `signOutPath`, or a popup/silent flow landing on such a route all leave the flow unfinished (popups and silent sign-in end with `Window closed by user` or `Authentication window timed out`).

**Fix:** render `<ProcessCallback>` on every path MonoCloud returns to (set `signOutPath` to the same route if convenient), and give the provider a `postCallback` that navigates away.

## `await signIn()` never throws

**Cause:** the hook's `signIn` and `signOut` catch failures and store them in `error`; only `signInSilent`, `refreshSession`, `refetchUserInfo` and `getTokens` reject.

**Fix:**

```tsx
const { error } = useAuth();
useEffect(() => {
  if (error) toast.error(error.message);
}, [error]);
```

For throw semantics, call the client from `useClient()` — the context then won't refresh until the next `useAuth()` action.

## Endless re-renders or repeated token/UserInfo requests

**Cause:** every `useAuth()` action ends by re-reading storage and publishing new `user` / `session` objects. An effect that lists `user` or `session` as a dependency and calls `getTokens()`, `refetchUserInfo()`, `refreshSession()` or `signInSilent()` re-triggers itself forever.

**Fix:** depend on primitives:

```tsx
const { isAuthenticated, user, getTokens } = useAuth();
const userId = user?.sub;
useEffect(() => {
  if (!isAuthenticated) return;
  getTokens().then(({ accessToken }) => loadProfile(accessToken));
}, [isAuthenticated, userId, getTokens]);
```

## Provider prop changes have no effect

**Cause:** the client is created once from the first render's props; later values of any prop — including `postCallback`, `onSessionCreating`, `storage`, `autoProcessCallback` — are ignored, and function props keep first-render closures.

**Fix:** remount on purpose with `key` (`<MonoCloudAuthProvider key={tenantDomain} …>`); for changing data inside callbacks, read it from a ref. A different audience usually needs `getTokens({ resource })`, not a new client.

## `useNavigate() may be used only in the context of a <Router> component.`

**Cause:** the component that creates the provider (to pass `navigate` into `postCallback`) renders above `<BrowserRouter>` / `<RouterProvider>`.

**Fix:** render that wrapper inside the router (with `createBrowserRouter`, in the root route's element), or keep the provider outside and call the data router's `router.navigate()` from `postCallback`.

## The app jumps to `/` after `signInSilent()` or a popup sign-in

**Cause:** `postCallback` runs for `mode` `'silent'` and `'popup'` too, and the custom implementation always navigates.

**Fix:** `if (state.mode === 'redirect' || state.returnUrl) navigate(state.returnUrl ?? '/', { replace: true });`

## Full page reload after sign-in, or the session disappears with `MemoryStorage`

**Cause:** the default `postCallback` does `window.location.href = returnUrl` when `returnUrl` is set (`signIn({ returnUrl })`, `<SignIn returnUrl=…>`), and it logs a warning about `MemoryStorage`. The reload resets React state and empties `MemoryStorage`.

**Fix:** pass a router-based `postCallback`, or keep `LocalStorage` / `SessionStorage`.

## `signInSilent()` rejects with `login_required`

**Cause:** no MonoCloud session cookie reached the hidden iframe (not signed in at MonoCloud, or the browser blocks or partitions third-party cookies).

**Fix:** treat `MonoCloudOPError` as "show `<SignIn>`". Keep the app's own session fresh with `offline_access` + `getTokens()`, which needs no third-party cookies. Run silent sign-in once at startup (see the hook in SKILL.md), not on every `isAuthenticated` change — after a local-only sign-out it would sign the user straight back in.

## `getTokens()` rejects with `Session does not contain refresh token`

**Cause:** the token is missing or expiring (or `forceRefresh` was passed) and the session has no refresh token — `offline_access` wasn't granted.

**Fix:** `defaultAuthParams={{ scopes: 'openid profile email offline_access' }}`, enable offline access on the client, then sign in again.

## `<Protected groups>` hides content from users who are in the group

**Cause:** `user` has no claim named `groupsClaim` (default `groups`), or the entries don't match by string / `id` / `name`.

**Fix:** inspect `useAuth().user` and set `groupsClaim` to the claim that carries the groups. With `matchAllGroups`, every listed group must be present.

## `<Protected>` "leaks" protected data

**Cause:** it only decides what renders; the code ships in the bundle, and an API that doesn't check authorization serves whoever calls it.

**Fix:** enforce authorization in the API (`monocloud-auth-express` / `monocloud-auth-fastify` skills).

## `onClick` on `<SignIn>` / `<SignUp>` / `<SignOut>` never runs

**Cause:** the components set their own `onClick` (and `type="button"`) after spreading your props.

**Fix:** use a plain button that calls `useAuth().signIn()` alongside your handler.

## Hydration mismatch under SSR

**Cause:** the provider resolves auth state in effects, so server HTML always has `isLoading: true` and no user.

**Fix:** render auth-dependent UI only on the client (gate on `isLoading`), or use `@monocloud/auth-nextjs`, which reads sessions on the server.

## `clientSecret` flagged in the bundle

**Cause:** `clientSecret` was passed to the provider; every prop goes to the browser client.

**Fix:** remove it and use a Single Page Application (public) client — PKCE is automatic with `responseType: 'code'`.

## APIs that don't exist

`AuthProvider`, `MonoCloudProvider`, `useUser`, `useSession`, `useMonoCloud`, `withAuth`, `withAuthenticationRequired`, `loginWithRedirect`, `getAccessTokenSilently`, and any `@monocloud/auth-react/…` subpath are not exported. The real surface is `<MonoCloudAuthProvider>`, `useAuth()`, `useClient()`, `<SignIn>`, `<SignUp>`, `<SignOut>`, `<Protected>`, `<ProcessCallback>` — see [api-surface.md](api-surface.md).

## Diagnostic

```bash
node scripts/verify.js [project-dir]   # run from the skill folder
```

[`../scripts/verify.js`](../scripts/verify.js) fails when `@monocloud/auth-react` is missing or the code imports names or subpaths the package doesn't export; it warns about React / React DOM versions outside the peer ranges, Next.js projects, a missing provider, `<ProcessCallback>` / `autoProcessCallback` mismatches, state-changing calls on `useClient()`, effects that loop on `user` / `session`, popup sign-in inside effects, placeholders, `clientSecret`, MonoCloud secrets in browser-exposed `.env*` variables, `MONOCLOUD_AUTH_*` variables (never read by this SDK), non-`VITE_` `import.meta.env` reads, `MemoryStorage` without `postCallback`, and token calls without `offline_access`.
