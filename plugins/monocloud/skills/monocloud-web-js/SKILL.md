---
name: monocloud-web-js
description: Use when integrating MonoCloud authentication into a vanilla JavaScript / TypeScript browser app or SPA — installing or configuring `@monocloud/auth-web-js`, constructing `MonoCloudWebJSClient` (`tenantDomain`, `clientId`, `appUrl`, `callbackPath`, `defaultAuthParams`, `resources`), wiring `processCallback()` at startup, calling `signIn()` / `signOut()` / `signInSilent()` / `refreshSession()` / `refetchUserInfo()` / `getTokens()` / `getSession()`, popup vs redirect vs silent (iframe) modes, `LocalStorage` / `SessionStorage` / `MemoryStorage` / custom `IStorage`, router integration via `postCallback`, `onSessionCreating`, or troubleshooting callback URL mismatches, `Could not open popup`, `Window closed by user`, `Authentication window timed out`, cross-origin-isolated iframes, `login_required` from silent sign-in, `Sign in callback states mismatch`, `Session does not contain refresh token`, or `MonoCloudOPError` / `MonoCloudTokenError` / `MonoCloudJsError`.
license: MIT
---

# MonoCloud Web SDK (`@monocloud/auth-web-js`)

Browser-only OAuth 2.0 / OpenID Connect client (Authorization Code + PKCE) for single-page apps and any JavaScript running in a page: redirect, popup and silent (hidden-iframe) sign-in, sign-out, session and token storage, refresh, and cross-tab locking. `@monocloud/auth-react` is a thin layer over this same client.

## Package identity — read first

Check `package.json` before suggesting code. Use **`@monocloud/auth-web-js`**; the entry point is the class **`MonoCloudWebJSClient`**.

| Project | Use instead | Skill |
| --- | --- | --- |
| React SPA | `@monocloud/auth-react` — provider, hooks and components over this client | `monocloud-auth-react` |
| Next.js | `@monocloud/auth-nextjs` — cookie sessions, middleware, server helpers | `monocloud-auth-nextjs` |
| API validating bearer tokens | `@monocloud/backend-node` | `monocloud-auth-express`, `monocloud-auth-fastify` |
| Server calling the Management API | `@monocloud/management` | `monocloud-management-js` |

- Import everything (client, storage adapters, errors, types, `MonoCloudOidcClient`) from `@monocloud/auth-web-js`; `@monocloud/auth-core` is an internal dependency. The only subpaths are `/utils` and `/internal`.
- The SDK reads **no environment variables** — `MONOCLOUD_AUTH_*` belongs to `@monocloud/auth-nextjs`. Pass values to the constructor (with Vite, from your own `import.meta.env.VITE_*` variables).
- Not part of this package: `MonoCloudAuthProvider`, `useAuth`, `useUser`, `useMonoCloud` (React lives in `@monocloud/auth-react`), and the `oidc-client-ts` API (`UserManager`, `signinRedirect()`, `signinCallback()`, `getUser()`).

## Install and dashboard setup

```bash
npm install @monocloud/auth-web-js
```

Create a **Single Page Application** client in the MonoCloud dashboard. It is a public client — never put a `clientSecret` in browser code. Register:

| Setting | Value |
| --- | --- |
| Callback URLs | `appUrl + callbackPath` exactly as sent — the SDK strips a trailing `/`, so the default `callbackPath` (`/`) yields the bare origin, e.g. `http://localhost:5173` |
| Sign-out URLs | `appUrl + signOutPath` (same rule) |
| Cross-Origin URLs | the app origin — discovery, token and UserInfo requests are made from the browser |

The SDK's example apps also turn on refresh tokens — **Allow Offline Access**, required for `offline_access` — and **Allow Access Tokens via the Browser**.

## Quick start

```ts
// src/auth.ts — one shared client for the whole app
import { MonoCloudWebJSClient } from '@monocloud/auth-web-js';

export const client = new MonoCloudWebJSClient({
  tenantDomain: 'https://<your-tenant-domain>',
  clientId: '<your-client-id>',
  defaultAuthParams: { scopes: 'openid profile email offline_access' }, // offline_access → refresh token
});
```

```ts
// src/main.ts
import { client } from './auth';

async function start() {
  await client.processCallback();             // completes a returning sign-in / sign-out; otherwise a no-op
  const session = await client.getSession();  // MonoCloudSession | undefined — reads storage, never refreshes
  renderUser(session?.user);                  // your UI
}

document.getElementById('sign-in')!.addEventListener('click', () => client.signIn()); // redirect
document.getElementById('sign-in-popup')!.addEventListener('click', async () => {
  await client.signIn({ mode: 'popup' });     // must start inside the click handler, before any other await
  renderUser((await client.getSession())?.user);
});
document.getElementById('sign-out')!.addEventListener('click', () => client.signOut()); // federated

start();
```

## Constructor options

`new MonoCloudWebJSClient(options: MonoCloudWebJSClientOptions)` — `tenantDomain` and `clientId` are required.

| Option | Default | Notes |
| --- | --- | --- |
| `tenantDomain` | — | e.g. `https://acme.us.monocloud.com` (`https://` added if missing). Must equal the ID token's `iss`. |
| `clientId` | — | SPA client ID; also namespaces storage keys. |
| `appUrl` | `window.location.origin` | Base for redirect URIs and the origin required on popup/iframe messages. May include a base path. |
| `callbackPath` / `signOutPath` | `/` | Where MonoCloud returns after sign-in / sign-out. |
| `defaultAuthParams` | — | Only `scopes`, `resource` and `responseType` (default `'code'`) are applied. Other keys the type accepts are ignored — pass them per `signIn()` call. |
| `resources` | — | `Indicator[]` (`{ resource, scopes? }`): merged into every sign-in request; `getTokens({ resource })` uses the matching entry's `scopes`. |
| `storage` | `new LocalStorage()` | `SessionStorage`, `MemoryStorage`, or a custom `IStorage`. |
| `postCallback` | URL cleanup, or same-origin `returnUrl` page load | Router hook — see [Router integration](#router-integration-postcallback). |
| `onSessionCreating` | — | `(session, idTokenClaims?, userInfo?, appState?)` — mutate `session` before it is stored. |
| `federatedSignOut` | `true` | `false`: `signOut()` only clears the local session. |
| `fetchUserinfo` | `true` | Call UserInfo after sign-in and in `refreshSession()`. |
| `validateIdToken` | `true` | ID-token signature and claim checks. Keep on. |
| `idTokenSigningAlgorithm` | `'RS256'` | Must match the token header `alg`. |
| `clockSkew` / `clockTolerance` | `0` / `60` s | ID-token time checks (`exp`, `nbf`, `auth_time` + `max_age`). |
| `authWindowTimeout` | `600` s | Popup / silent-iframe timeout. |
| `popupWindowWidth` / `popupWindowHeight` | `375` / `600` px | |
| `sessionKey` | — | Key suffix when several clients share one `clientId`. |

Also: `filteredIdTokenClaims`, `jwksCacheDuration`, `metadataCacheDuration`, `clientSecret`, `clientAuthMethod` — see [API surface](references/api-surface.md#monocloudwebjsclientoptions).

**Scopes:** `openid profile email` is requested only when no scopes are configured anywhere (per call, `defaultAuthParams.scopes`, `resources[].scopes`). Once any are set, the request carries exactly the merged list — put `openid profile email` (plus `offline_access`) in `defaultAuthParams.scopes`.

## `processCallback()` — every page load

Call it unconditionally before rendering; don't dispatch on the route yourself. It reads and clears the pending-flow state (`mc.state.<clientId>` in `sessionStorage`) and, when the URL is `appUrl + callbackPath` (sign-in) or `appUrl + signOutPath` (sign-out), completes that flow: checks `state`, exchanges the code, validates the ID token, stores the session, then awaits `postCallback`. With nothing pending it does nothing.

Inside the popup or hidden iframe the SDK opened, it instead posts the URL back to the opening window and returns — so the page at `callbackPath` / `signOutPath` must load your app and call `processCallback()`.

## Signing in and out

| Call | Behavior |
| --- | --- |
| `signIn()` | Full-page redirect (default). Resolves before the page unloads. |
| `signIn({ mode: 'popup' })` | Opens the popup synchronously — call it directly in a click handler or it is blocked. Resolves after the session is stored. |
| `signIn({ signUp: true })` | Registration screen (`prompt=create`; wins over `prompt`). |
| `signInSilent(opts?)` | `prompt=none` in a hidden iframe; resolves to the new `MonoCloudSession`, rejects with `MonoCloudOPError` (`login_required`, `interaction_required`, …). Leaves an existing session untouched on failure. |
| `signOut()` | Clears the local session, then sends the user to MonoCloud's end-session endpoint and back to `signOutPath`. |
| `signOut({ federatedSignOut: false })` | Local session only; no navigation, no `postCallback`. |
| `signOut({ mode: 'popup' })` | End-session in a popup. |

`signIn` options: `mode`, `signUp`, `returnUrl`, `appState` (JSON-serializable, handed to `onSessionCreating`), `scopes` / `resource` (merged with the configured ones), `audience`, `prompt`, `loginHint`, `authenticatorHint`, `uiLocales`, `display`, `acrValues`, `maxAge`, `idTokenHint`. `signOut` options: `mode`, `federatedSignOut`, `postLogoutRedirectUri`, `idTokenHint`, `returnUrl`.

Restore an existing MonoCloud (SSO) session without UI — needs MonoCloud's cookie in a third-party iframe, so browsers that block third-party cookies answer `login_required`:

```ts
import { MonoCloudOPError } from '@monocloud/auth-web-js';

if (!(await client.getSession())) {
  try {
    await client.signInSilent();
  } catch (e) {
    if (!(e instanceof MonoCloudOPError)) throw e; // login_required etc. → show the sign-in button
  }
}
```

## Tokens

```ts
const { accessToken } = await client.getTokens();                       // sign-in token, refreshed if needed
await client.getTokens({ resource: 'https://api.example.com' });        // scopes from the matching `resources` entry
await client.getTokens({ resource: 'https://api.example.com', scopes: 'read:data' });
await client.getTokens({ forceRefresh: true, refetchUserInfo: true });

await fetch('https://api.example.com/data', { headers: { Authorization: `Bearer ${accessToken}` } });
```

- `getTokens()` returns `{ accessToken, accessTokenExpiration, scopes, requestedScopes?, resource?, idToken?, refreshToken?, isExpired }`. When no stored token matches, it expires within 30 s, or `forceRefresh` is set, it runs the refresh-token grant first and stores the result. Without a refresh token that throws `MonoCloudValidationError: Session does not contain refresh token`; with no session, `Session does not exist`.
- `refreshSession({ refreshGrantOptions: { resource, scopes } })` — explicit refresh grant (`Refresh token not found. Sign in with offline_access scope to get the refresh token.` without one).
- `refetchUserInfo()` — calls UserInfo with the stored default access token (not refreshed first) and merges the result into `session.user`.
- `signInSilent`, `refreshSession`, `refetchUserInfo` and `getTokens` share one lock per client: identical concurrent calls in a tab share a promise, and calls across tabs run one at a time.

## Storage

| Adapter | Backed by | Lifetime |
| --- | --- | --- |
| `LocalStorage` (default) | `window.localStorage` | Survives reloads; shared by tabs of the origin; readable by any script on the page |
| `SessionStorage` | `window.sessionStorage` | Per tab; survives reloads |
| `MemoryStorage` | in-memory object | Lost on every full page load |
| custom `IStorage` | `getItem` / `setItem` / `removeItem`, each returning a `Promise` | IndexedDB, encrypted store, … |

The session lives under `mc.session.<clientId>[.<sessionKey>]`. Pending-flow state always uses `sessionStorage` (`mc.state.<clientId>`), whichever adapter you choose.

## Router integration (`postCallback`)

After a completed sign-in or federated sign-out, the SDK awaits `postCallback(state)` in the main window. The default: no `returnUrl` → removes the query string and hash (`history.replaceState`, no reload); `returnUrl` on `appUrl`'s origin → full-page navigation to it (another origin is ignored with a `console.warn`).

A custom `postCallback` replaces that behavior entirely, and it also runs after **popup and silent** sign-ins and popup sign-outs — check `state.mode` before navigating:

```ts
import { router } from './router'; // your client-side router

export const client = new MonoCloudWebJSClient({
  tenantDomain: 'https://<your-tenant-domain>',
  clientId: '<your-client-id>',
  postCallback: state => {
    // state: { mode: 'redirect' | 'popup' | 'silent', signOut?, returnUrl?, appState?, … }
    if (state.mode === 'redirect' || state.returnUrl) {
      router.replace(state.returnUrl ?? '/'); // also removes ?code=…&state=… from the address bar
    }
  },
});
```

## Errors

All extend `MonoCloudAuthBaseError` (→ `Error`) and are exported from `@monocloud/auth-web-js`; branch with `instanceof`.

| Class | Raised for |
| --- | --- |
| `MonoCloudOPError` | Authorization-server errors. `.error` (also the `message`: `login_required`, `access_denied`, `invalid_grant`, …), `.errorDescription`. |
| `MonoCloudValidationError` | SDK checks: no session, no refresh token, callback `state` mismatch, missing `code`, implicit-flow hash mismatch. |
| `MonoCloudTokenError` | ID-token validation (`Invalid Issuer`, `Invalid audience claim`, `Nonce mismatch`, …) and UserInfo 401/403; `.code` is `'invalid_token'` or `'insufficient_scope'`. |
| `MonoCloudHttpError` | Unexpected status or network failure; `.status` / `.statusText` are `undefined` for network and CORS failures. |
| `MonoCloudJsError` | Browser environment: popup blocked or closed, window timeout, iframe in a cross-origin-isolated page, redirect from inside an iframe, lock timeout. |

Errors built from an HTTP response carry `.raw` (`{ status, statusText, headers, body }`) — it can contain sensitive values, so don't log it verbatim.

## Common pitfalls

1. **`processCallback()` not called on every load** (or gated on a route) — returning sign-ins never complete.
2. **Dashboard URLs differ from what the SDK sends** (`appUrl + callbackPath`, trailing `/` stripped), or the origin is missing from Cross-Origin URLs — MonoCloud rejects the redirect, or browser calls fail with a status-less `MonoCloudHttpError`.
3. **`scopes` set without `openid`** — the `openid profile email` default disappears once any scope is configured; the session gets no ID token or profile.
4. **No `offline_access`** — no refresh token, so `getTokens()` fails once the access token expires.
5. **Expecting `defaultAuthParams.prompt` / `audience` / `loginHint` / … to apply** — only `scopes`, `resource`, `responseType` are read.
6. **Popup sign-in after an `await` or from a timer** — the browser blocks it (`Could not open popup`).
7. **A custom `postCallback` that always navigates** — it also fires after `signInSilent()` and popup sign-ins.
8. **`MemoryStorage` with the default `postCallback` and a `returnUrl`** — the full page load wipes the session it just stored.
9. **`appUrl` ≠ the page's real origin** (`localhost` vs `127.0.0.1`, proxies) — popup/iframe messages are dropped and redirect callbacks find no pending state.
10. **A `clientSecret` in browser code** — it ships in the bundle; SPA clients are public and rely on PKCE.

## Verify and go deeper

- [`scripts/verify.js`](scripts/verify.js) — run `node scripts/verify.js [project-dir]` from this skill's folder: checks the dependency, named imports and subpaths against the real exports, `processCallback()` wiring, leftover placeholders, `clientSecret`, browser-exposed secrets in `.env*`, Vite env usage, `MemoryStorage` and `offline_access`.
- [`references/api-surface.md`](references/api-surface.md) — every export, option, method (with the messages it throws), token selection, storage keys, hooks, `oidcClient`, error classes.
- [`references/troubleshooting.md`](references/troubleshooting.md) — symptom → cause → fix, including exact error strings.
