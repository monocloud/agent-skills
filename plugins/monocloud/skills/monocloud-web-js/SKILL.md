---
name: monocloud-web-js
description: Use when integrating MonoCloud authentication into a vanilla JavaScript / TypeScript single-page or browser app — installing or configuring `@monocloud/auth-web-js`, constructing `MonoCloudWebJSClient` with `tenantDomain` + `clientId` + `appUrl`, wiring `processCallback()` at app startup, calling `signIn()` / `signOut()` / `signInSilent()` / `refreshSession()` / `refetchUserInfo()` / `getTokens()` / `getSession()`, swapping storage with `LocalStorage` / `SessionStorage` / `MemoryStorage`, handling popup vs redirect vs silent (iframe) modes, integrating with a client-side router via `postCallback`, or troubleshooting callback routes, popup blockers, iframe / cross-origin-isolation issues, or `login_required` from silent sign-in.
license: MIT
---

# MonoCloud Web SDK (`@monocloud/auth-web-js`)

Browser-side authentication SDK for single-page applications and any vanilla JavaScript / TypeScript app running in the browser. Implements OAuth 2.0 / OpenID Connect with PKCE, handles redirect / popup / silent (iframe) flows, manages sessions and tokens, and acts as the foundation for higher-level framework SDKs (React, Vue, Angular, Svelte, etc.).

## Package identity — read this first

**Use:** `@monocloud/auth-web-js` (this skill). The exported class is `MonoCloudWebJSClient`.

This is **not** the same as:

- `@monocloud/auth-nextjs` — server-side session auth for Next.js (skill: `monocloud-auth-nextjs`).
- `@monocloud/backend-node` — API token validation on Express / Fastify (skills: `monocloud-auth-express`, `monocloud-auth-fastify`).
- `@monocloud/management` — server-only Management API client (skill: `monocloud-management-js`).
- `@monocloud/auth-core` — internal core used by this SDK. App code should import from `@monocloud/auth-web-js`; types and error classes (`MonoCloudOPError`, `MonoCloudValidationError`, etc.) are re-exported from the public package.

Use this SDK when you are building a browser app **without** a server-rendered framework — pure HTML/JS, Vite, Parcel, webpack-bundled SPA, or a custom framework integration on top of MonoCloud. If your project ships with Next.js, prefer `@monocloud/auth-nextjs` instead — it gives you cookie-based sessions and server-side helpers that this SDK does not.

## Installation

```bash
npm install @monocloud/auth-web-js
```

No environment variables. **All configuration is passed to the constructor**.

## Prerequisites (in the MonoCloud dashboard)

The client in your MonoCloud tenant must be configured as a **Single Page Application** with:

- **Allowed Callback URLs:** the full URL matching `appUrl + callbackPath` (e.g. `http://localhost:5173/callback`).
- **Allowed Sign-out URLs:** the full URL matching `appUrl + signOutPath` (e.g. `http://localhost:5173/logout`).
- **Allowed Origins (CORS):** the bare origin of `appUrl` (e.g. `http://localhost:5173`).
- **Scopes:** at minimum `openid`, `profile`, `email`. Add `offline_access` if you want refresh tokens.

Browser SPAs are public clients — **never** ship a `clientSecret`. The `clientSecret` option on `MonoCloudWebJSClient` exists only for advanced confidential-client setups; for a normal SPA, omit it.

## Quick start

Create one shared client and reuse it across the app.

```ts
// src/auth.ts
import { MonoCloudWebJSClient } from '@monocloud/auth-web-js';

export const client = new MonoCloudWebJSClient({
  tenantDomain: 'https://<your-tenant>.us.monocloud.com',
  clientId: '<your-client-id>',
  appUrl: 'http://localhost:5173',
  callbackPath: '/callback',
  signOutPath: '/logout',
  defaultAuthParams: {
    scopes: 'openid profile email offline_access', // offline_access => refresh tokens
  },
});
```

Bootstrap the app by completing any in-flight callback **before** rendering:

```ts
// src/main.ts
import { client } from './auth';

async function init() {
  await client.processCallback(); // no-op when the current URL is not a callback
  // ...mount your UI
}

init();
```

Sign in / sign out:

```ts
await client.signIn();                       // redirect (default)
await client.signIn({ mode: 'popup' });      // popup window
await client.signIn({ signUp: true });       // open sign-up instead of sign-in
await client.signOut();                      // federated sign-out by default
```

Read the session:

```ts
const session = await client.getSession();
if (session) {
  console.log(session.user, session.accessTokens, session.idToken);
}
```

## Constructor options

`new MonoCloudWebJSClient(options: MonoCloudWebJSClientOptions)`.

Required:

| Option         | Purpose                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| `tenantDomain` | Your MonoCloud tenant URL, e.g. `https://acme.us.monocloud.com`                        |
| `clientId`     | OIDC client id (SPA application registered in the dashboard)                           |

Common optional:

| Option                | Default                  | Purpose                                                                                          |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `appUrl`              | `window.location.origin` | Public origin of the app, e.g. `http://localhost:5173`. Used to build redirect URIs and to validate cross-origin postMessages from popups / iframes. Provide it explicitly if the app is served from multiple origins or behind a reverse proxy where `window.location.origin` does not match the registered callback. |
| `callbackPath`        | `/`                      | Relative path where MonoCloud redirects after sign-in. Must be in **Allowed Callback URLs**.     |
| `signOutPath`         | `/`                      | Relative path where MonoCloud redirects after sign-out. Must be in **Allowed Sign-out URLs**.    |
| `defaultAuthParams`   | —                        | Pre-set `scopes` / `resource` / `responseType` / `prompt` etc. for every auth request.           |
| `resources`           | —                        | Additional `Indicator[]` (resource + scopes) requestable via `getTokens()`.                      |
| `storage`             | `new LocalStorage()`     | Session persistence — `LocalStorage`, `SessionStorage`, `MemoryStorage`, or your own `IStorage`. |
| `postCallback`        | full-page reload to `returnUrl` | Hook to integrate with a client-side router instead of a hard navigation.                 |
| `onSessionCreating`   | —                        | Async hook to mutate the session as it is being created (e.g. attach app-specific claims).       |
| `federatedSignOut`    | `true`                   | When `false`, `signOut()` only clears the local session without sending the user to MonoCloud.   |
| `fetchUserinfo`       | `true`                   | When `false`, skip the UserInfo call after authentication (user object will only carry ID-token claims). |
| `validateIdToken`     | `true`                   | When `false`, skip ID token signature/claims validation. Not recommended.                         |
| `authWindowTimeout`   | `600` (sec)              | Timeout for popup / iframe auth windows.                                                          |
| `popupWindowWidth`    | `375`                    | Popup width in pixels.                                                                            |
| `popupWindowHeight`   | `600`                    | Popup height in pixels.                                                                           |
| `clockSkew`           | `0` (sec)                | Maximum allowed clock skew, applied to all time-based ID-token claim validations. Must be `>= 0`. |
| `clockTolerance`      | `60` (sec)               | Additional tolerance applied to all time-based ID-token claim validations (`exp`, `nbf`, `auth_time + maxAge`) — not just `nbf`/`auth_time`. Must be `>= 0`. |
| `idTokenSigningAlgorithm` | `'RS256'`            | Expected signing algorithm for ID-token validation. Also selects the SHA digest used for `at_hash` / `s_hash` checks in implicit flows — so it applies to **public SPAs**, not just confidential clients. |
| `sessionKey`          | —                        | Extra suffix on the internal storage key. Use when you need multiple `MonoCloudWebJSClient` instances with the same `clientId` in the same tab. |
| `filteredIdTokenClaims` | protocol claims set     | Override the list of claims stripped from the user object.                                        |
| `clientSecret`, `clientAuthMethod` | — | Confidential-client extras. **Do not use in a normal SPA** — secrets cannot be safely shipped to a browser. |

Pre-configurable subset of authorization params (via `defaultAuthParams`): `scopes`, `resource`, `responseType`, `prompt`, `display`, `uiLocales`, `acrValues`, `maxAge`, `loginHint`, `authenticatorHint`, `audience`, `idTokenHint`. Per-request values (`state`, `nonce`, `codeChallenge`, `codeChallengeMethod`, `redirectUri`) are managed internally and cannot be overridden.

## `processCallback()` — wire this once at startup

`processCallback()` inspects the current URL plus the persisted callback state (`mc.state.<clientId>` in `sessionStorage`) and automatically finishes a pending sign-in or sign-out flow. It is a no-op when the URL is not a callback — so it is safe (and recommended) to call unconditionally during app bootstrap.

```ts
await client.processCallback();
```

Do **not** dispatch on the route yourself — the SDK matches the URL against `appUrl + callbackPath` / `appUrl + signOutPath` internally and knows which side of the flow it is on. There is no need to mount a special "callback" page or route component — the same entrypoint works for every page.

If the app is loaded inside a popup or iframe (because the SDK opened it), `processCallback()` forwards the callback URL back to the main window via `postMessage` and returns; the main window's pending `signIn()` / `signOut()` promise resolves there.

## Sign-in modes

`signIn(options?: SignInOptions)`.

```ts
await client.signIn();                                  // redirect (default)
await client.signIn({ mode: 'popup' });                 // popup window
await client.signIn({ signUp: true });                  // open sign-up (prompt=create)
await client.signIn({
  returnUrl: '/dashboard',                              // where to go after callback
  loginHint: 'alice@example.com',
  scopes: 'openid profile email offline_access',        // overrides defaults for this call
  resource: 'https://api.example.com',
  appState: { from: 'pricing-page' },                   // arbitrary state — surfaced to onSessionCreating
});
```

| Mode       | When to use it                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `redirect` | Default. Full-page redirect to MonoCloud, comes back via `callbackPath`.                        |
| `popup`    | Keep the user on the current page. Requires the call to happen in a **user-initiated event** (click handler) — otherwise the popup is blocked. |

Silent sign-in (SSO restore at bootstrap, no UI):

```ts
import { MonoCloudOPError } from '@monocloud/auth-web-js';

try {
  const session = await client.signInSilent();
  console.log('Restored session for:', session.user);
} catch (e) {
  if (e instanceof MonoCloudOPError && e.error === 'login_required') {
    // MonoCloud has no active IdP session — user needs to sign in interactively.
  } else {
    throw e;
  }
}
```

`signInSilent()` runs a full `prompt=none` authorization round-trip through a hidden iframe. If MonoCloud has a valid session it resolves with the new `MonoCloudSession`; otherwise it rejects with `MonoCloudOPError` (`login_required`, `interaction_required`, etc.).

## Sign out

`signOut(options?: SignOutOptions)`.

```ts
await client.signOut();                                       // federated (clears local + MonoCloud session)
await client.signOut({ mode: 'popup' });
await client.signOut({ federatedSignOut: false });            // local-only — keeps the MonoCloud session
await client.signOut({ postLogoutRedirectUri: 'https://example.com/bye' });
await client.signOut({ idTokenHint: '<id-token>' });          // override the session's id_token_hint
```

When `federatedSignOut` is `true` (the default) the SDK sends the user to MonoCloud's end-session endpoint, then back to `signOutPath`. When `false` the local session is cleared without contacting MonoCloud — useful when you want to log the user out of this app while leaving any other apps signed in.

## Reading tokens

```ts
const tokens = await client.getTokens();
// { accessToken, scopes, requestedScopes, resource, accessTokenExpiration,
//   idToken, refreshToken, isExpired }

await client.getTokens({ forceRefresh: true });

await client.getTokens({
  resource: 'https://api.example.com',
  scopes: 'read:things write:things',
});
```

`getTokens()` returns the matching access token from the current session. If it is missing or about to expire (30-second buffer) it transparently runs the OAuth 2.0 Refresh Token Grant first and stores the new tokens. Throws `MonoCloudValidationError` when there is no session.

Refresh-token flow needs `offline_access` in `scopes` at sign-in time — the authorization server only issues a refresh token when that scope is granted.

`refreshSession()` is the imperative refresh; `getTokens()` is the right call for "give me a usable access token now."

```ts
await client.refreshSession();                                // refresh with the default audience/scope
await client.refreshSession({
  refreshGrantOptions: {
    resource: 'https://api.example.com',
    scopes: 'read:data',
  },
});
```

`refetchUserInfo()` re-calls the UserInfo endpoint with the default access token and updates `session.user`:

```ts
await client.refetchUserInfo();
const session = await client.getSession();
```

All four methods (`signInSilent`, `refreshSession`, `refetchUserInfo`, `getTokens`) are wrapped in **cross-tab + in-flight dedupe locks** so concurrent callers in the same tab — or across tabs — collapse onto a single network round-trip.

## Storage adapters

Sessions persist via an `IStorage` implementation.

| Class            | Backed by                | When to use                                                          |
| ---------------- | ------------------------ | -------------------------------------------------------------------- |
| `LocalStorage`   | `window.localStorage`    | Default. Survives tab closes; shared across tabs on the same origin. |
| `SessionStorage` | `window.sessionStorage`  | Cleared when the tab closes; not shared between tabs.                |
| `MemoryStorage`  | in-memory object         | Lost on reload. Useful for testing or strict-privacy modes.          |
| Custom           | implements `IStorage`    | Encrypted store, IndexedDB wrapper, custom secure-cookie helper, etc. |

```ts
import { MonoCloudWebJSClient, MemoryStorage } from '@monocloud/auth-web-js';

export const client = new MonoCloudWebJSClient({
  tenantDomain: 'https://<your-tenant>',
  clientId: '<your-client-id>',
  appUrl: 'http://localhost:5173',
  storage: new MemoryStorage(),
});
```

Custom adapter (note: methods are `async` — return promises):

```ts
import type { IStorage } from '@monocloud/auth-web-js';

class IndexedDbStorage implements IStorage {
  async getItem(key: string): Promise<string | null> { /* ... */ }
  async setItem(key: string, value: string): Promise<void> { /* ... */ }
  async removeItem(key: string): Promise<void> { /* ... */ }
}
```

If you swap to `MemoryStorage`, the default `postCallback` performs a full-page reload to `returnUrl` and **wipes the session** — provide a custom `postCallback` that uses your router instead (see next section).

## Integrating with a client-side router

The default `postCallback` performs `window.location.href = returnUrl` (a full page reload). That works in most setups but throws away in-memory state and disqualifies `MemoryStorage`. If you use a client-side router, override it:

```ts
import { MonoCloudWebJSClient } from '@monocloud/auth-web-js';
import { router } from './router';

export const client = new MonoCloudWebJSClient({
  tenantDomain: 'https://<your-tenant>',
  clientId: '<your-client-id>',
  appUrl: 'http://localhost:5173',
  callbackPath: '/callback',
  postCallback: state => {
    // state.returnUrl, state.appState, state.signOut, state.mode are available.
    router.push(state.returnUrl ?? '/dashboard');
  },
});
```

`postCallback` runs after both sign-in and sign-out callbacks (`state.signOut` distinguishes them) and only on the main window (not inside the popup/iframe).

## Errors

All errors extend `MonoCloudAuthBaseError` (which extends `Error`). Use `instanceof` to branch; there is no `statusCode` field.

| Class                       | Thrown for                                                                     |
| --------------------------- | ------------------------------------------------------------------------------ |
| `MonoCloudOPError`          | OAuth/OIDC error from the authorization server. Exposes `.error` (code) and `.errorDescription`. Examples: `login_required`, `interaction_required`, `access_denied`, `invalid_grant`. |
| `MonoCloudValidationError`  | Bad state — no session when one is required, missing parameters in a callback, scopes/response_type mismatch. Also thrown by `processCallback()` in implicit flows on hash validation failures: `Invalid 'at_hash' in id token` (when `responseType` is `'id_token token'` and the SDK can compute `at_hash` from the access token but the id token's claim does not match) and `Invalid 's_hash' in id token` (any implicit flow where the id token's `s_hash` does not match the callback state). |
| `MonoCloudTokenError`       | Token operation failed (e.g. validation of an ID token).                       |
| `MonoCloudHttpError`        | Network / unexpected HTTP response talking to MonoCloud.                       |
| `MonoCloudJsError`          | Browser-environment failure (popup blocked, iframe in cross-origin-isolated context, window timeout, redirect attempted from inside an iframe, etc.). |
| `MonoCloudAuthBaseError`    | Base class — catch this when you want to handle any SDK error generically.      |

```ts
import {
  MonoCloudOPError,
  MonoCloudValidationError,
  MonoCloudJsError,
} from '@monocloud/auth-web-js';

try {
  await client.signInSilent();
} catch (e) {
  if (e instanceof MonoCloudOPError && e.error === 'login_required') return;
  if (e instanceof MonoCloudJsError) { /* popup blocked, iframe issue */ }
  throw e;
}
```

## Multiple clients in the same app

Each `MonoCloudWebJSClient` keys its persisted state by `clientId`. If you have **two clients with the same `clientId`** (rare — e.g. switching audiences/tenants from one app), pass a unique `sessionKey` so they don't trample each other's session in storage:

```ts
const adminClient = new MonoCloudWebJSClient({ /* ... */ clientId: 'app', sessionKey: 'admin' });
const userClient  = new MonoCloudWebJSClient({ /* ... */ clientId: 'app', sessionKey: 'user' });
```

For different `clientId`s, this is unnecessary — the SDK already namespaces by `clientId`.

## Common pitfalls

1. **Calling `processCallback()` only on a specific route.** Don't gate it on the URL — the SDK does that itself. Call it once at app bootstrap.
2. **Forgetting `offline_access`.** No refresh token is issued. `refreshSession()` and the auto-refresh in `getTokens()` will throw `MonoCloudValidationError`. Add `offline_access` to `defaultAuthParams.scopes` (or to the per-call `signIn({ scopes })`).
3. **Calling `signIn({ mode: 'popup' })` outside a user gesture.** Browsers block the popup. Call it inside a click handler.
4. **Mismatched callback URLs in the dashboard.** `appUrl + callbackPath` must exactly match an entry in the client's **Allowed Callback URLs** — including scheme, host, port, and path. Same for sign-out.
5. **Missing CORS origin.** MonoCloud rejects token / userinfo requests from origins that aren't in **Allowed Origins (CORS)**.
6. **Shipping a `clientSecret` in a SPA.** Browser bundles are public. Use a public client — leave `clientSecret` unset.
7. **`MemoryStorage` + default `postCallback`.** The default `postCallback` does a full page reload, which empties memory and drops the just-created session. Either keep `LocalStorage`/`SessionStorage` or pass a `postCallback` that hands control to your router instead.
8. **Redirect sign-in from inside an iframe.** Throws `MonoCloudJsError` — MonoCloud's sign-in page can't render framed. Switch to `mode: 'popup'` or perform the redirect from the top window.
9. **Wrong `returnUrl` origin.** The default `postCallback` ignores `returnUrl` values that resolve to a different origin than `appUrl` (and logs a warning) — that's intentional, not a bug.
10. **Custom `IStorage` returning sync values.** All three methods (`getItem`, `setItem`, `removeItem`) must return promises. Wrap synchronous backends with `Promise.resolve(...)`.

## Onboarding checklist for a fresh integration

1. `npm install @monocloud/auth-web-js`.
2. In the MonoCloud dashboard, configure the client as a **Single Page Application** and register Callback URL, Sign-out URL, and Allowed Origin matching your local dev origin (e.g. `http://localhost:5173`).
3. Create a `src/auth.ts` (or similar) that constructs and exports a single `MonoCloudWebJSClient` instance — pass `tenantDomain`, `clientId`, `appUrl`, `callbackPath`, `signOutPath`, and `defaultAuthParams.scopes = 'openid profile email offline_access'`.
4. In your app entry (`main.ts` / `index.ts`), `await client.processCallback()` **before** mounting the UI.
5. Wire `signIn()` / `signOut()` to buttons. Use `mode: 'popup'` if you want to avoid full-page redirects.
6. Optionally call `signInSilent()` at bootstrap to restore SSO without prompting; catch `MonoCloudOPError` for `login_required`.
7. For protected fetches, call `getTokens()` and forward `accessToken` in the `Authorization` header. Refresh is automatic; pass `{ resource, scopes }` for audience-specific tokens.
8. Run `node skills/monocloud-web-js/scripts/verify.js` to sanity-check that the package is installed and constructor options look plausible.

## Deeper reference

- [`references/api-surface.md`](references/api-surface.md) — every export, with constructor option shapes, method signatures, and storage adapter contracts.
- [`references/troubleshooting.md`](references/troubleshooting.md) — extended symptom → cause → fix index covering popup blockers, iframe / cross-origin issues, callback URL mismatches, `login_required` on silent, refresh-token gotchas, custom storage pitfalls, and training-data SDK ghosts.
