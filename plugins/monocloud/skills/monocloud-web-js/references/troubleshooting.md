# Troubleshooting — `@monocloud/auth-web-js`

Quick reference for the most common things that go wrong when integrating MonoCloud authentication into a browser SPA. Each entry is **symptom → root cause → fix**.

## Sign-in callback never completes (URL stays on `/callback`)

**Symptom:** After signing in, the browser lands on `/callback` (or whatever `callbackPath` you configured), shows whatever your app renders there, but `getSession()` still returns `undefined` and the URL stays at `…/callback?code=…&state=…`.

**Cause:** `processCallback()` was never called at app startup, or was gated behind a route guard that skipped it on the callback path.

**Fix:** Call `processCallback()` unconditionally during bootstrap, **before** rendering the UI:

```ts
async function init() {
  await client.processCallback();        // no-op when URL isn't a callback
  // mount your app
}
```

Don't dispatch on the path yourself — the SDK matches the URL against `appUrl + callbackPath` / `appUrl + signOutPath` internally. There is no need for a dedicated callback page or route component.

## Callback URL not allowed (popup shows MonoCloud error page)

**Symptom:** Sign-in redirects (or the popup) to MonoCloud, then MonoCloud renders an error page mentioning the redirect URI or "callback URL not allowed."

**Cause:** The full URL formed from `appUrl + callbackPath` does not appear in the client's **Allowed Callback URLs** in the MonoCloud dashboard. Common slip-ups: `http` vs `https`, missing port (e.g. `:5173`), or a path mismatch.

**Fix:** In the dashboard, open the SPA client and add the exact URL. Same for `signOutPath` under **Allowed Sign-out URLs**, and for the `appUrl` origin under **Allowed Origins (CORS)**.

```
Allowed Callback URLs:  http://localhost:5173/callback
Allowed Sign-out URLs:  http://localhost:5173/logout
Allowed Origins (CORS): http://localhost:5173
```

If you change `appUrl` or the paths in code, mirror the change in the dashboard.

> **Trailing slashes are forgiving.** Since 0.1.1 the SDK trims trailing slashes both when constructing redirect URIs and when matching the current URL inside `processCallback()`. Registering `http://localhost:5173/callback/` (with slash) and using `callbackPath: '/callback'` (without) will still match. Likewise `appUrl: 'http://localhost:5173/'` is normalized to `http://localhost:5173`.

## Popup blocked

**Symptom:** `client.signIn({ mode: 'popup' })` throws `MonoCloudJsError: Could not open popup`. Or no error, but no window appears.

**Cause:** Browsers block popups that aren't opened from a direct **user gesture** (click, key press). If the call is awaited inside an async chain that started elsewhere — e.g. inside `useEffect` or after a non-user-triggered timer — the gesture is "lost."

**Fix:** Call `signIn({ mode: 'popup' })` directly in the click handler, not inside a deferred await:

```ts
// good — popup opens during the click event
button.addEventListener('click', () => {
  client.signIn({ mode: 'popup' }).catch(console.error);
});

// bad — async work before the popup loses the user gesture
button.addEventListener('click', async () => {
  await fetch('/api/something');         // gesture is gone by the time signIn runs
  await client.signIn({ mode: 'popup' });
});
```

If you can't avoid pre-popup async work, switch to `mode: 'redirect'` instead.

## Popup / silent window never returns a callback

**Symptom:** `signIn({ mode: 'popup' })` (or `signOut({ mode: 'popup' })`) rejects with `MonoCloudJsError: Window closed by user`, or — after a long wait — `MonoCloudJsError: Authentication window timed out`.

**Cause:** The SDK polls the popup every 100 ms and rejects as soon as it is closed before posting its callback; a separate timer rejects once the window outlives `authWindowTimeout` (default `600` seconds). `signInSilent()` uses the same machinery, so a hidden iframe that never reaches the callback URL times out with the identical error.

**Fix:** Treat both as user/environment conditions rather than bugs — catch `MonoCloudJsError` and re-offer the sign-in button. Lower `authWindowTimeout` if 10 minutes of a stuck popup is too long for your UX.

```ts
try {
  await client.signIn({ mode: 'popup' });
} catch (e) {
  if (e instanceof MonoCloudJsError) {
    // window closed, blocked, or timed out — show the sign-in button again
  } else {
    throw e;
  }
}
```

## Silent sign-in always rejects with `login_required`

**Symptom:** `signInSilent()` throws `MonoCloudOPError` with `error: 'login_required'`, even when the user is signed in elsewhere with the same tenant.

**Cause(s)** (in order of likelihood):

1. The user has no active session at the **MonoCloud IdP** (different from a local app session) — silent only works when MonoCloud already has a session cookie.
2. Third-party cookies are blocked. Hidden-iframe `prompt=none` flows post the OP's session cookie cross-origin; modern browsers (Safari ITP, Firefox ETP, Chrome 3rd-party cookie deprecation) block this for many configurations.
3. The MonoCloud tenant domain is on a completely different eTLD+1 from the app — third-party cookie restrictions apply more strictly there.

**Fix:**

- Treat `login_required` as the normal "user needs to sign in interactively" signal. Catch it and fall back to `signIn()`:

  ```ts
  try {
    await client.signInSilent();
  } catch (e) {
    if (e instanceof MonoCloudOPError && e.error === 'login_required') {
      // Show the sign-in button — silent restore isn't possible.
    } else {
      throw e;
    }
  }
  ```

- For long-lived sessions across reloads, prefer refresh tokens (`offline_access`) over silent: refresh tokens don't depend on third-party cookies.

## `signInSilent()` throws "Cannot create iframe in a cross-origin-isolated context"

**Symptom:** `MonoCloudJsError: Cannot create iframe in a cross-origin-isolated context`.

**Cause:** Your app sets `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (often to enable `SharedArrayBuffer` / WebAssembly threads). In that mode, the hidden iframe the SDK uses for `prompt=none` is blocked.

**Fix:** Either drop cross-origin isolation for the auth flow, or skip silent sign-in entirely and use refresh tokens (`offline_access`) + `getTokens()` to keep the session alive.

## "Cannot start a redirect sign-in from inside an iframe"

**Symptom:** `MonoCloudJsError: Cannot start a redirect sign-in from inside an iframe…`. Happens when the app itself is framed in another site.

**Cause:** MonoCloud's hosted sign-in page sets framing protections — it can't be rendered in a child frame. The SDK detects the framed context and throws before navigating.

**Fix:** Either:

- Use `signIn({ mode: 'popup' })` — the popup opens at the top level and is allowed.
- Move the redirect to the top window via `window.top.location` (only works if the parent is same-origin; otherwise the popup approach is the right call).

The same restriction applies to `signOut()` when `federatedSignOut` is `true`.

## `MonoCloudValidationError: Refresh token not found`

**Symptom:** `refreshSession()` throws `MonoCloudValidationError: Refresh token not found. Sign in with offline_access scope to get the refresh token.` The auto-refresh inside `getTokens()` has no pre-check of its own, so it surfaces the core client's message instead: `MonoCloudValidationError: Session does not contain refresh token`. Same cause, two different strings.

**Cause:** The authorization server only issues a refresh token when `offline_access` is in the granted scopes. Missing it is the most common cause.

**Fix:** Add `offline_access` to the scopes — either globally on the client or per-call:

```ts
new MonoCloudWebJSClient({
  // ...
  defaultAuthParams: { scopes: 'openid profile email offline_access' },
});

// or per-call
await client.signIn({ scopes: 'openid profile email offline_access' });
```

Then sign in again — refresh tokens are issued at the original authorization, not retroactively.

## `getTokens()` returns a token but the API still 401s

**Symptom:** `getTokens({ resource: 'https://api.example.com' })` resolves, but the API rejects the token with 401 / `invalid_audience`.

**Cause(s):**

1. The audience the API expects doesn't match the `resource` you requested.
2. You configured `resource` on `defaultAuthParams` but the API expects a different one — `getTokens()` falls back to that default when you don't pass `resource`.
3. The scope the API requires wasn't requested at sign-in (and `offline_access` isn't enough — it needs the API's scope too).

**Fix:**

- Confirm the API resource indicator string and required scopes from the MonoCloud dashboard's **API Resources** area.
- Pre-register the audience in `resources`:

  ```ts
  new MonoCloudWebJSClient({
    // ...
    defaultAuthParams: { scopes: 'openid profile email offline_access' },
    resources: [{ resource: 'https://api.example.com', scopes: 'read:data write:data' }],
  });

  const { accessToken } = await client.getTokens({ resource: 'https://api.example.com' });
  ```

- Or request them on the sign-in call:

  ```ts
  await client.signIn({
    scopes: 'openid profile email offline_access read:data write:data',
    resource: 'https://api.example.com',
  });
  ```

## Session vanishes on every page reload

**Symptom:** `getSession()` returns `undefined` after a hard refresh, even though the user just signed in.

**Cause:** `storage` is set to `MemoryStorage` (in-memory only). Reloading the tab wipes it. The same happens if a previous `signIn()` used the default `postCallback`, which does a full page reload — combined with `MemoryStorage` it drops the freshly created session.

**Fix:** Either use `LocalStorage` (default — survives reload, shared across tabs) / `SessionStorage` (per-tab), or pair `MemoryStorage` with a custom `postCallback` that uses your client-side router (no reload):

```ts
new MonoCloudWebJSClient({
  // ...
  storage: new MemoryStorage(),
  postCallback: state => router.push(state.returnUrl ?? '/'),
});
```

## `returnUrl` is silently ignored after callback

**Symptom:** You pass `returnUrl: '/dashboard'` to `signIn()`, callback completes, but the user stays on the current URL — with a `console.warn` mentioning origin mismatch.

**Cause:** The default `postCallback` resolves `returnUrl` against `appUrl` and refuses to navigate to a different origin (security hardening — prevents open-redirects via crafted `returnUrl`).

**Fix:** Make sure `returnUrl` is **relative** (e.g. `/dashboard`) or starts with the same origin as `appUrl`. Cross-origin redirects are intentional to disallow.

If you need to navigate to a different origin after callback, do it in a custom `postCallback`:

```ts
postCallback: state => {
  if (state.returnUrl) window.location.href = state.returnUrl;
}
```

…but only if you trust the source of `returnUrl` — never use an attacker-controlled value.

## Default `postCallback` triggers a full page reload

**Symptom:** After sign-in, the page does a hard reload. In-memory app state (Redux store, React state, etc.) is wiped.

**Cause:** The default `postCallback` does `window.location.href = returnUrl` when a `returnUrl` is set, which is a full navigation. This is intentional for plain-HTML apps but undesirable for SPAs with a client-side router.

**Fix:** Pass a custom `postCallback` and use your router's push API:

```ts
import { router } from './router';

new MonoCloudWebJSClient({
  // ...
  postCallback: state => {
    router.push(state.returnUrl ?? '/');
  },
});
```

`state.signOut` distinguishes a sign-out callback from a sign-in callback if you need different behavior.

## Multiple `MonoCloudWebJSClient` instances trampling each other's session

**Symptom:** You instantiate two clients (e.g. for two different tenants or two audiences). Signing in with one wipes the other's session.

**Cause:** Both instances share the same `clientId`, so they hash to the same storage key (`mc.session.<clientId>`).

**Fix:** If the two clients also share `clientId`, pass distinct `sessionKey` strings:

```ts
const admin = new MonoCloudWebJSClient({ /* ... */ clientId: 'app', sessionKey: 'admin' });
const user  = new MonoCloudWebJSClient({ /* ... */ clientId: 'app', sessionKey: 'user'  });
```

When the `clientId`s already differ, this isn't necessary — the SDK keys storage by `clientId` automatically.

If the two clients use **different `tenantDomain`s** but the same `clientId`, you still need a `sessionKey` — the storage key only includes `clientId`, not the domain.

## Custom `IStorage` causes "Promise expected" or stale reads

**Symptom:** A custom storage adapter is being used and methods on the client either reject with type errors or return stale data even after `setItem`.

**Cause:** `IStorage.getItem` / `setItem` / `removeItem` **must** return promises. Returning a raw value works under TypeScript only because the type permits the union — at runtime the SDK awaits the return value.

**Fix:** Wrap synchronous backends with `Promise.resolve(...)`:

```ts
class SyncBackedStorage implements IStorage {
  getItem(key: string)  { return Promise.resolve(myMap.get(key) ?? null); }
  setItem(key, value)   { myMap.set(key, value); return Promise.resolve(); }
  removeItem(key)       { myMap.delete(key); return Promise.resolve(); }
}
```

For truly async backends (IndexedDB, encrypted store), `async` methods are fine — return the promise that resolves once the write is durable.

## `MonoCloudOPError: access_denied` after sign-in

**Symptom:** Callback completes but `processCallback()` throws `MonoCloudOPError` with `error: 'access_denied'`.

**Cause:** The user cancelled the sign-in (closed the consent screen or hit "Decline"), or a policy on the MonoCloud side denied access.

**Fix:** Treat as a user-facing condition, not a bug:

```ts
try {
  await client.processCallback();
} catch (e) {
  if (e instanceof MonoCloudOPError && e.error === 'access_denied') {
    // show "sign-in was cancelled" UI
  } else {
    throw e;
  }
}
```

## `clientSecret` warning / leaked in the bundle

**Symptom:** A secret-scanner flags `clientSecret` shipping in the SPA bundle, or you notice it in DevTools network calls.

**Cause:** `MonoCloudWebJSClient` exposes `clientSecret` / `clientAuthMethod` for advanced confidential-client setups, but a normal browser SPA is a **public client** and cannot keep a secret. If you've set `clientSecret`, it is in the bundle.

**Fix:** Drop `clientSecret`. Use a public-client configuration in the MonoCloud dashboard (Single Page Application preset), and rely on PKCE (handled automatically by the SDK for the default `responseType: 'code'`).

## Older training-data SDK ghosts

**Symptom:** Code references `MonoCloudAuthProvider`, `useUser`, `useMonoCloud`, a `signinRedirect()` / `signinCallback()` pair, or treats this SDK as if it were `oidc-client-ts`. None of those exist here.

**Cause:** The agent is pattern-matching against an older or unrelated SDK from training data.

**Fix:** Always check the actual surface in [`api-surface.md`](api-surface.md). The real entry is `new MonoCloudWebJSClient(options)`; sign-in is `signIn()`; the callback is `processCallback()`; there is no React provider or hook in this package (use a framework-specific SDK if you want one).

## Diagnostic

```bash
node skills/monocloud-web-js/scripts/verify.js [project-dir]
```

Checks that `@monocloud/auth-web-js` is in `package.json`, warns if `clientSecret` is referenced anywhere in source (a sign of a misconfigured public client), and warns when the project also has a framework SDK installed (where the framework SDK is probably the right choice instead).
