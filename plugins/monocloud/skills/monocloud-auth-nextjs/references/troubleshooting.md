# Troubleshooting — `@monocloud/auth-nextjs`

Symptom → cause → fix. The auth-route contract and every env var are in [api-surface.md](api-surface.md); helper defaults are in [protecting.md](protecting.md).

## First steps

- Run `node scripts/verify.js <project-dir>` from this skill's directory ([verify.js](../scripts/verify.js)): it checks dependencies, the proxy/middleware file and matcher, env vars, and SDK imports.
- Auth-route failures return an empty `500` and are logged with `console.error`; read the server log. Pass `onError` to `authMiddleware()` / `monoCloudAuth()` to render your own response.
- `DEBUG=@monocloud:auth-nextjs` turns on the SDK's debug logging.

## Auth routes return 404

- **Wrong file name.** Next.js 16+ runs `proxy.ts`; Next.js 13–15 only runs `middleware.ts` and ignores `proxy.ts`. Check `next` in `package.json` and rename — the body is the same.
- **Matcher excludes them.** `/((?!api|_next/static|…).*)` skips every `/api` path. Use `/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)` or otherwise cover the auth routes.
- **Nothing mounted.** Without middleware, add the `monoCloudAuth()` catch-all (`app/api/auth/[...monocloud]/route.ts` exporting `GET` and `POST`, or `pages/api/auth/[...monocloud].ts`).

## Config warning at startup, then `500` from the auth routes

**Symptom:** `WARNING: One or more configuration options were not provided for MonoCloudClient.`, often followed by `Missing: tenantDomain - Set MONOCLOUD_AUTH_TENANT_DOMAIN environment variable in your .env file.`; sign-in then answers `500` and logs a `MonoCloudValidationError`.

**Cause:** the constructor only warns; validation throws on the first auth-route request. A `Missing:` line is printed for a required value that is absent **or invalid** (e.g. a tenant domain without `https://`).

| Logged message | Fix |
| --- | --- |
| `"<key>" is required` | set the required `MONOCLOUD_AUTH_*` variable |
| `"tenantDomain" must be a valid uri` | `MONOCLOUD_AUTH_TENANT_DOMAIN=https://<tenant>` |
| `Scope must contain openid` | add `openid` to `MONOCLOUD_AUTH_SCOPES` |
| `Cookie must be set to secure when app url protocol is https.` | remove `MONOCLOUD_AUTH_SESSION_COOKIE_SECURE=false` / `_STATE_COOKIE_SECURE=false` — `Secure` must match the `MONOCLOUD_AUTH_APP_URL` scheme (setting `true` on an `http:` URL is rejected too) |
| `Resource must be a valid URL without query or hash parameters` | `MONOCLOUD_AUTH_RESOURCE` must be space-separated absolute URLs |
| `clientSecret must be a valid JWK when clientAuthMethod is 'private_key_jwt'` | put the private-key JWK JSON (with `kty`) in `MONOCLOUD_AUTH_CLIENT_SECRET` |
| `The state cookie name must be different from the session cookie name` (or `… must not start with …`) | rename one of the cookies |

Numeric limits are enforced the same way: `MONOCLOUD_AUTH_SESSION_MAX_DURATION` must exceed `MONOCLOUD_AUTH_SESSION_DURATION` (default max `604800`), `MONOCLOUD_AUTH_STATE_DURATION` ≥ `300`, `MONOCLOUD_AUTH_STATE_MAX_CONCURRENT` `1`–`20`, `MONOCLOUD_AUTH_RESPONSE_TIMEOUT` ≥ `1000`.

## Boolean or numeric env vars have no effect

Booleans accept only `true`/`false` (case-insensitive) — `1`, `yes`, `on` are ignored. Numbers go through `parseInt`; a non-numeric value is ignored. Either way the default applies silently. Booleans: `USE_PAR`, `FEDERATED_SIGNOUT`, `ALLOW_QUERY_PARAM_OVERRIDES`, `FETCH_USER_INFO`, `REFETCH_USER_INFO`, `REFETCH_STRICT_PROFILE_SYNC`, `SESSION_SLIDING`, `SESSION_COOKIE_HTTP_ONLY`, `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_PERSISTENT`, `STATE_COOKIE_SECURE` (all prefixed `MONOCLOUD_AUTH_`).

## Callback fails: `Invalid Authentication State`

The callback looks for the cookie of that sign-in transaction (`state.<hash>`); if it is missing or unreadable:

- The sign-in started on a different origin than `MONOCLOUD_AUTH_APP_URL` (`127.0.0.1` vs `localhost`, a preview-deployment URL). The callback goes to the `appUrl` host, where the cookie doesn't exist — browse via the configured origin.
- The transaction ended: older than `state.duration` (15 min), evicted beyond `state.maxConcurrent` pending sign-ins, cleared because another tab completed sign-in or signed out, or the callback URL was opened twice (the cookie is consumed).
- `MONOCLOUD_AUTH_COOKIE_SECRET` changed between sign-in and callback.
- `responseMode: 'form_post'` over plain `http`: the state cookie becomes `SameSite=None` without `Secure`, which browsers drop.

## Callback fails with a token or OP error

| Error | Cause / fix |
| --- | --- |
| `MonoCloudOPError` (`error` = e.g. `access_denied`, `login_required`) | MonoCloud returned an error to the callback — check `errorDescription` |
| `Invalid Issuer` | `MONOCLOUD_AUTH_TENANT_DOMAIN` must equal the issuer exactly (scheme + host) |
| `Invalid signing alg` | `MONOCLOUD_AUTH_ID_TOKEN_SIGNING_ALG` differs from the application's ID-token algorithm |
| `Invalid audience claim` | `MONOCLOUD_AUTH_CLIENT_ID` belongs to another application |
| `Unexpected JWT "exp"` / `"nbf"` claim value | server clock drift — fix NTP or raise `MONOCLOUD_AUTH_CLOCK_TOLERANCE` |
| `Failed to parse JWT Header` / `Failed to parse JWT Payload` | the token's header/payload is not valid UTF-8 JSON |

## `Request to https://<tenant>/… timed out after 10000ms`

A `MonoCloudHttpError`: every request to MonoCloud (discovery, JWKS, token, userinfo, PAR, revocation) is aborted after `responseTimeout` ms — default `10000`, minimum `1000`. Slow networks or egress proxies usually trip discovery/JWKS first. Raise `MONOCLOUD_AUTH_RESPONSE_TIMEOUT` (or `responseTimeout` in the constructor).

## `useAuth()` never shows a user

- `error.message === 'Failed to fetch user'`: the userinfo route answered non-2xx — usually a 404 because the matcher or file name is wrong (see [Auth routes return 404](#auth-routes-return-404)).
- `user` is `undefined` with no error: the route answered `204` (no session cookie reached it). After a route override, set `NEXT_PUBLIC_MONOCLOUD_AUTH_USER_INFO_URL` (including any `basePath`).
- `refetch()` does nothing while no user is loaded — re-mount or reload after signing in.

## `… can only be used in App Router server environments (RSC, route handlers, or server actions)`

Thrown by `protect()`, `redirectToSignIn()` and `redirectToSignOut()` outside the App Router server (Pages Router files, client code). In the Pages Router use `protectPage()` / `protectApi()` or `getSession(req, res)`; on the client render `<RedirectToSignIn />`. For `protect()` the same message also replaces any error thrown while reading the session — if you are in an RSC already, check the config and cookie secret.

## Protection responds differently than expected

- `protectApi()` returns JSON `401`/`403`, never a redirect — redirect from a page helper or the middleware instead, or handle `401` in the client.
- `protect()` redirects to sign-in on a group failure as well; use `isUserInGroup()` and answer `403` yourself.
- Middleware group rules are any-of even with `matchAll: true`; enforce all-of in the page/route.
- Unanchored `protectedRoutes` strings match anywhere in the path (`'/admin'` also matches `/x/admin`); use `^…`.
- A request with an `x-middleware-subrequest` header always gets `403 {"message":"forbidden"}` from the middleware.

## Client helpers in Server Components

`useAuth`, `protectClientPage`, `<Protected>` and `<RedirectToSignIn>` are client code — use them in files that start with `"use client"`, and use `getSession()` / server helpers in Server Components. They only hide UI; the data still reaches the browser.

## Overridden route, but `<SignIn>` / `<SignOut>` / `useAuth()` use the default

Client code reads only the `NEXT_PUBLIC_` mirrors. Set `NEXT_PUBLIC_MONOCLOUD_AUTH_SIGNIN_URL` / `_SIGNOUT_URL` / `_USER_INFO_URL` (and `_GROUPS_CLAIM`) to the same value as the server variable — the public value overwrites the server one when a client is constructed — and update the callback / sign-out URLs in the dashboard.

## Sessions disappear after deploys or across instances

The session cookie (the whole session, or only the store key when `session.store` is set) is encrypted with `MONOCLOUD_AUTH_COOKIE_SECRET` (AES-GCM, PBKDF2-derived key). A cookie that fails to decrypt is treated as signed-out and deleted — so every instance must share the same secret, and rotating it signs everyone out. The validator accepts 8 characters, but use `openssl rand -hex 32`.

## Store-backed sessions look missing, or hooks/`resources` don't apply

The root function exports use their own env-only singleton. If you created `new MonoCloudNextClient({ session: { store }, … })`, use **its** methods everywhere (`monoCloud.authMiddleware()`, `monoCloud.getSession()`, `monoCloud.protectPage()`, …). The root `getSession()` cannot read store-backed sessions (the cookie holds only the store key).

## `getTokens()` errors

| Error | Meaning |
| --- | --- |
| `MonoCloudValidationError: Session does not exist` | not signed in — check `isAuthenticated()` first |
| `MonoCloudValidationError: Session does not contain refresh token` | no token for that resource/scopes yet and no refresh token to get one |
| `MonoCloudTokenError: No refresh token available to refresh the expired access token` | the access token expired and the session has no refresh token — sign in again |
| `MonoCloudOPError` (e.g. `invalid_grant`) | MonoCloud rejected the refresh token or the requested resource/scopes (they must have been granted at sign-in) |
| `Invalid resource "…": …` / `Scopes must be a space-separated string` | invalid `resource` / `scopes` argument |

## Refreshed tokens or sliding expiry not persisted from Server Components

**Symptom:** `getTokens()` in a Server Component returns a fresh token, but the next request refreshes again; or a sliding session expires although the user is active. A one-time `console.warn` with Next.js's "Cookies can only be modified in a Server Action or Route Handler" message appears.

**Cause:** refreshing tokens and sliding the expiry both rewrite the session cookie, which Next.js forbids during Server Component rendering; the SDK swallows the error with a single warning. Without a store the new tokens are lost; with a store the tokens persist but the cookie's lifetime does not advance.

**Fix:** call `getTokens()` from a Route Handler, Server Action or middleware (which can write cookies), and rely on the middleware — not Server Component reads — to keep sliding sessions alive.

## Back-channel logout returns 404, 405, 400 or 500

- `404`: no `onBackChannelLogout` on the instance whose `authMiddleware()` / `monoCloudAuth()` is mounted (it is constructor-only — env vars can't enable it); with the catch-all, also a request to the default path after the route was overridden.
- `405`: not a `POST`. An App Router catch-all must export the handler as `POST` too. The callback check runs first, so an unconfigured route answers `404` for any method.
- `400 {"error":"invalid_request","error_description":"The logout token is missing or invalid."}`: no `logout_token` form field, or validation failed — bad signature, `alg` ≠ `MONOCLOUD_AUTH_ID_TOKEN_SIGNING_ALG`, wrong issuer/audience, missing `iat`, expired, no `sub` and no `sid`, a `nonce` present, or no back-channel-logout `events` claim.
- `500`: invalid config, discovery/JWKS failure, or `onBackChannelLogout` threw.

With `onError` supplied, the `400` and `500` cases go to it instead (a missing token as `MonoCloudValidationError`, an invalid one as `MonoCloudTokenError`) and you must send the response. Keep the route inside `config.matcher` and register its URL in the dashboard.

## Code uses names that don't exist

`MonoCloudAuthProvider`, `UserProvider`, `useUser`, `useMonoCloudAuth`, `monoCloudMiddleware`, `handleAuth`, `withPageAuthRequired`, `withApiAuthRequired` are not part of `@monocloud/auth-nextjs` — they come from other SDKs or stale examples. Use `authMiddleware`, `useAuth` (from `/client`), `protectPage`, `protectApi`; see [api-surface.md](api-surface.md).
