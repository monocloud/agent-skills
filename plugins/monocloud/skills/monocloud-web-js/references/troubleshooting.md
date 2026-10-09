# Troubleshooting — `@monocloud/auth-web-js`

Symptom → cause → fix. Error strings are quoted exactly as the SDK throws them.

## Back from MonoCloud, but still signed out

**Symptom:** after the redirect the URL shows `?code=…&state=…` (or `getSession()` returns `undefined`) and nothing happens.

**Causes:**

- `processCallback()` isn't called on that page load, or only on some routes.
- The flow started on another origin than it returned to (`appUrl` vs the page's real origin — `localhost` vs `127.0.0.1`, a proxy). The pending state lives in the starting origin's `sessionStorage`.
- The flow returned in a different tab than it started in (pending state is per tab).

**Fix:** call `await client.processCallback()` unconditionally at startup, before rendering; set `appUrl` to the origin users actually load.

## MonoCloud rejects the redirect / callback URL

**Cause:** the registered **Callback URLs** / **Sign-out URLs** entry differs from what the SDK sends: `appUrl + callbackPath` (or `signOutPath`) with a trailing `/` removed — the defaults give the bare origin, e.g. `http://localhost:5173`. Typical slips: `http` vs `https`, missing port, different path.

**Fix:** register the exact strings, plus the origin under **Cross-Origin URLs**:

```
Callback URLs:     http://localhost:5173/callback   (callbackPath: '/callback')
Sign-out URLs:     http://localhost:5173            (default signOutPath)
Cross-Origin URLs: http://localhost:5173
```

## `signIn()` rejects with `MonoCloudHttpError` before any redirect

**Cause:** the discovery request (`<tenantDomain>/.well-known/openid-configuration`) failed. No `status` and a browser message such as `Failed to fetch` → the app origin isn't in **Cross-Origin URLs**, or `tenantDomain` is wrong/unreachable. `Error while fetching metadata. Unexpected status code: 404` → wrong `tenantDomain`.

**Fix:** use the tenant URL from the dashboard and add the app origin to Cross-Origin URLs.

## `MonoCloudValidationError: Sign in callback states mismatch`

Also `Sign out states mismatch`.

**Cause:** the callback path loaded while another attempt's state was pending — typically the user left the MonoCloud page with Back and landed on a `callbackPath` of `/` (no `code` / `state` in the URL), or an older callback URL was reopened during a newer sign-in. That call consumes the pending state, so the next load is clean.

**Fix:** catch errors from `processCallback()` and continue rendering signed-out; prefer a dedicated `callbackPath` such as `/callback` so ordinary page loads never match it.

## `MonoCloudJsError: Could not open popup`

**Cause:** the popup wasn't opened from a user gesture — `signIn({ mode: 'popup' })` ran after another `await`, in a timer, or on load.

**Fix:** call it first thing in the click handler (the SDK opens the window synchronously); otherwise use redirect mode.

```ts
button.addEventListener('click', () => {
  client.signIn({ mode: 'popup' }).catch(console.error); // ✓ window opens during the click
});
```

## `Window closed by user` / `Authentication window timed out`

**Symptom:** a popup (`signIn` / `signOut` with `mode: 'popup'`) or `signInSilent()` rejects with one of these `MonoCloudJsError`s.

**Causes:**

- The user closed the popup (checked every 100 ms).
- The returning page never reported back: the app at `callbackPath` / `signOutPath` didn't load or didn't call `processCallback()` — for the silent iframe, also your own framing protections (`X-Frame-Options`, CSP `frame-ancestors`) on that page.
- `appUrl`'s origin differs from the page's real origin, so the `postMessage` is dropped.
- Popup sign-out with a `postLogoutRedirectUri` other than `appUrl + signOutPath`.
- Timeout after `authWindowTimeout` (default 600 s).

**Fix:** treat closing as a user action (show the button again); make the callback page load the app and call `processCallback()`; align `appUrl`; lower `authWindowTimeout` for faster failure.

## `signInSilent()` rejects with `login_required`

**Cause:** no MonoCloud session cookie reached the hidden iframe — the user isn't signed in at MonoCloud, or the browser blocks or partitions third-party cookies (Safari and Firefox do by default), especially when the tenant is on a different site than the app.

**Fix:** treat `MonoCloudOPError` (`login_required`, `interaction_required`) as "show the sign-in button". Keep the app's own session alive with refresh tokens (`offline_access` + `getTokens()`), which don't depend on third-party cookies.

## `Cannot create iframe in a cross-origin-isolated context`

**Cause:** the page is cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`), which rules out the silent-sign-in iframe.

**Fix:** drop isolation for these pages, or skip `signInSilent()` and rely on refresh tokens.

## `Cannot start a redirect sign-in from inside an iframe: …`

Also `Cannot start a redirect sign-out from inside an iframe: …` (federated sign-out only; the local session is kept).

**Cause:** your app is itself rendered inside an iframe; MonoCloud's pages can't be displayed framed.

**Fix:** use `mode: 'popup'`, or run the app top-level.

## `MonoCloudJsError: Failed to acquire lock…`

**Cause:** `signInSilent`, `refreshSession`, `refetchUserInfo` and `getTokens` share one lock per client (across tabs); a call waited more than 5 s — e.g. `getTokens()` while a slow `signInSilent()` runs. Non-secure origins use the `browser-tabs-lock` fallback.

**Fix:** don't fire token calls while a silent sign-in is pending; retry after it settles.

## No refresh token

**Symptom:** `refreshSession()` → `MonoCloudValidationError: Refresh token not found. Sign in with offline_access scope to get the refresh token.`; `getTokens()` (once the token is missing or expiring, or with `forceRefresh`) → `MonoCloudValidationError: Session does not contain refresh token`.

**Cause:** `offline_access` wasn't granted at sign-in (scope not requested, or offline access not allowed on the client).

**Fix:** add `offline_access` to `defaultAuthParams.scopes`, enable offline access on the client, and sign in again — refresh tokens are issued only at authorization.

## Refresh fails with `MonoCloudOPError` (`invalid_grant`)

**Cause:** the refresh token expired or was revoked.

**Fix:** catch it and start a new sign-in (`signIn()` or `signInSilent()`).

## `session.user` is empty, or `Fetching userinfo requires the openid scope`

**Cause:** scopes were configured (per call, `defaultAuthParams.scopes` or `resources[].scopes`) without `openid` — the `openid profile email` default only applies when no scopes are configured anywhere.

**Fix:** `defaultAuthParams: { scopes: 'openid profile email offline_access' }`.

## The API rejects the access token

**Causes:** the token is for a different `resource`/audience; the API's scopes weren't requested at sign-in; or `getTokens()` without arguments returned the sign-in token, not the API's.

**Fix:**

```ts
new MonoCloudWebJSClient({
  // …
  defaultAuthParams: { scopes: 'openid profile email offline_access' },
  resources: [{ resource: 'https://api.example.com', scopes: 'read:data write:data' }], // added to sign-in
});

const { accessToken } = await client.getTokens({ resource: 'https://api.example.com' });
```

## ID-token validation errors (`MonoCloudTokenError`)

| Message | Cause → fix |
| --- | --- |
| `Invalid Issuer` | `tenantDomain` differs from the token's `iss` (e.g. default vs custom domain) → use the issuer URL. |
| `Invalid audience claim` | `clientId` doesn't match the client that issued the token. |
| `Invalid signing alg` | Token header `alg` ≠ `idTokenSigningAlgorithm` (default `RS256`) → set it to the client's algorithm. |
| `JWT signature verification failed` | Token not signed by the tenant's keys (wrong tenant, tampered token). |
| `Nonce mismatch` | Callback from another attempt or replayed → restart sign-in. |
| `Unexpected JWT "exp" (expiration time) claim value, timestamp is <= now()` / `Unexpected JWT "nbf" (not before) claim value, timestamp is > now()` | Device clock off by more than `clockTolerance` (60 s) → fix the clock, raise `clockTolerance`, or offset a known drift with `clockSkew`. |
| `Too much time has elapsed since the last End-User authentication` | `maxAge` exceeded. |
| `Failed to parse JWT Header` / `Failed to parse JWT Payload` | Header or payload isn't base64url-encoded UTF-8 JSON. |
| `Could not parse payload. Malformed payload` | Same, from `MonoCloudOidcClient.decodeJwt()` (used when `validateIdToken: false`, and to re-read the stored ID token when a refresh returns none). |

UserInfo 401/403 also raises `MonoCloudTokenError` (message `<error>: <description>`; `.code` `'insufficient_scope'` or `'invalid_token'`).

## Session lost on reload, or a full page load after sign-in

**Causes:**

- `storage: new MemoryStorage()` — memory is cleared by every full page load; `SessionStorage` doesn't carry over to new tabs.
- The default `postCallback` performs a full page load when `returnUrl` is set (with `MemoryStorage` this wipes the session it just stored).

**Fix:** keep `LocalStorage`, or pass a `postCallback` that navigates with your router.

## `returnUrl` is ignored

**Symptom:** `console.warn: Ignoring returnUrl "…" because it resolves to a different origin than appUrl.`

**Cause:** the default `postCallback` only follows same-origin `returnUrl`s (open-redirect protection).

**Fix:** use relative paths such as `/dashboard`. For deliberate cross-origin hops, navigate in a custom `postCallback` with a value you control.

## The app navigates after `signInSilent()` or a popup sign-in

**Cause:** a custom `postCallback` navigates unconditionally; it runs for `mode` `'silent'` and `'popup'` too.

**Fix:** navigate only when `state.mode === 'redirect'` or `state.returnUrl` is set.

## Two clients overwrite each other's session

**Cause:** same `clientId` (even with different `tenantDomain`s) → same key `mc.session.<clientId>`.

**Fix:** give each a distinct `sessionKey`. Pending-flow state stays keyed by `clientId` only, so don't run two redirect flows for the same `clientId` at once.

## `MonoCloudOPError: access_denied` from `processCallback()`

**Cause:** the user cancelled or declined, or a MonoCloud policy denied access.

**Fix:** catch it and show a "sign-in cancelled" state; `e.errorDescription` has the server's text.

## `clientSecret` flagged in the bundle

**Cause:** `clientSecret` was set on the client. Browser code is public.

**Fix:** remove it and use a Single Page Application (public) client — PKCE is automatic with `responseType: 'code'`.

## APIs that don't exist

`UserManager`, `signinRedirect()`, `signinCallback()`, `getUser()` (oidc-client-ts), `MonoCloudAuthProvider`, `useAuth`, `useUser`, `useMonoCloud`, `handleRedirectCallback()`, `loginWithRedirect()`, and subpaths other than `/utils` / `/internal` are not part of this SDK. The real calls are `new MonoCloudWebJSClient(options)`, `processCallback()`, `signIn()`, `signOut()`, `getSession()`, `getTokens()` — see [api-surface.md](api-surface.md).

## Diagnostic

```bash
node scripts/verify.js [project-dir]   # run from the skill folder
```

[`../scripts/verify.js`](../scripts/verify.js) fails when the dependency is missing or the code imports names or subpaths the package doesn't export, and warns about a missing `processCallback()` call, placeholder values, `clientSecret`, MonoCloud secrets in browser-exposed `.env*` variables, `MONOCLOUD_AUTH_*` variables (never read by this SDK), non-`VITE_` `import.meta.env` reads, `MemoryStorage` without `postCallback`, token calls without `offline_access`, and projects better served by `@monocloud/auth-react` or `@monocloud/auth-nextjs`.
