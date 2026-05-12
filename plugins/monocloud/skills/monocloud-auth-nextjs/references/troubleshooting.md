# Troubleshooting — `@monocloud/auth-nextjs`

Quick reference for the most common things that go wrong when integrating MonoCloud authentication into a Next.js application. Each entry is **what the symptom looks like → root cause → fix**.

## Wrong file name (`proxy.ts` vs `middleware.ts`)

**Symptom:** Auth routes 404 (`/api/auth/signin` → "page not found"); no redirect loop, just a normal 404.

**Cause:** `proxy.ts` is only valid on Next.js **16+**. On Next.js 13–15 the file must be named `middleware.ts`. Next.js silently ignores `proxy.ts` on older versions.

**Fix:** Check `next` in `package.json`. If the major is `<16`, rename the file:

```bash
mv src/proxy.ts src/middleware.ts   # or proxy.ts -> middleware.ts at root
```

The export body is identical (`export default authMiddleware()` + `export const config`). Only the filename differs.

## Double-mounted auth routes (middleware + catch-all)

**Symptom:** Sign-in redirects bounce in a loop. `/api/auth/callback` returns weird state errors. `useAuth()` sometimes returns the wrong user.

**Cause:** Both `authMiddleware()` in `proxy.ts`/`middleware.ts` **and** `monoCloudAuth()` in `app/api/auth/[...monocloud]/route.ts` are mounted. They both try to handle the same routes.

**Fix:** Pick one. The recommended path is `authMiddleware()`. Only mount `monoCloudAuth()` on a catch-all when middleware genuinely can't be used (rare infrastructure constraint). Delete the catch-all route if `authMiddleware()` is present.

## `useAuth()` returns no user after sign-in

**Symptom:** Sign-in completes (session cookie is set, server-side `getSession()` works), but in a client component `useAuth()` returns `{ user: null, isAuthenticated: false }`.

**Cause:** The `config.matcher` on the middleware excludes `/api/auth/userinfo`, so the userinfo endpoint isn't intercepted.

**Fix:** Use the recommended matcher (it covers `/api/auth/*` by negation, not by enumeration):

```ts
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
```

If you've narrowed the matcher, ensure the path mapped by `MONOCLOUD_AUTH_USER_INFO_URL` (default `/api/auth/userinfo`) is included.

## `protect()` / `redirectToSignIn()` throws "App Router only"

**Symptom:** Server-side error: "`protect()` can only be used in App Router server context."

**Cause:** Called from a Pages Router file (`pages/...`) or from a client component.

**Fix (Pages Router):** Use `protectPage()` for `getServerSideProps` or `protectApi()` for API routes; or call `getSession(req, res)` and respond yourself. The `protect()`/`redirectToSignIn()`/`redirectToSignOut()` helpers are App-Router-only.

**Fix (client component):** Use `<RedirectToSignIn />` from `@monocloud/auth-nextjs/components/client`.

## `protectApi()` returns 401/403 with no redirect

**Symptom:** A protected API endpoint returns JSON 401, but the user is not redirected to sign in.

**Cause:** This is by design — `protectApi()` is for API handlers, which return JSON, not redirects. The browser does not follow JSON 401s.

**Fix:** If you want redirect-on-fail, do the redirect from a page (`protectPage`) or middleware (`authMiddleware`). For SPAs that consume the API directly, handle the 401 in the client.

## `<Protected>` / `useAuth()` used in a Server Component

**Symptom:** Build error: "useAuth must be used in a Client Component" or similar.

**Cause:** Both helpers require `"use client"`. They depend on React Context.

**Fix:** Use `getSession()` for server-side conditional rendering. Reserve `<Protected>` and `useAuth()` for components that have `"use client"` at the top.

## `MONOCLOUD_AUTH_COOKIE_SECRET` is missing or too short

**Symptom:** Crash on first request mentioning the cookie secret, or sessions that decrypt locally but fail in production (different secret across deployments).

**Cause:** The cookie secret is the encryption key for the session cookie. The SDK's option validator only enforces a minimum of **8 characters** (`.min(8)` in `node-core/src/options/validation.ts`), but 8 chars is nowhere near enough entropy for cookie encryption. PBKDF2 derives a key from whatever you give it, so a weak secret silently produces a weak cookie.

**Fix:** Always generate a high-entropy secret regardless of what the validator allows. The conventional choice is 32 random bytes encoded as 64 hex characters:

```bash
openssl rand -hex 32
```

Put it in `.env.local` (dev) and your hosting platform's secret manager (prod). Use the **same** value across every instance that needs to read the cookie — secrets that drift between deployments invalidate live sessions. Never commit it.

## Cookie refresh lost when calling `getSession()` in middleware

**Symptom:** Intermittent "session expired" errors mid-flow even though refresh tokens are valid.

**Cause:** `getSession()` may rotate the cookie on a successful refresh. If you call it inside middleware without passing the response object, those rotations don't get serialized back.

**Fix:** In middleware/route handler integration, pass `req, res`:

```ts
const session = await getSession(req, res);
return res; // <- must return the response object the SDK wrote to
```

## Overrode an auth route URL but `<SignIn>` / `useAuth()` still uses the old one

**Symptom:** Set `MONOCLOUD_AUTH_SIGNIN_URL=/login` (server side); the server sees the new URL but `<SignIn>` still links to `/api/auth/signin`.

**Cause:** Client-side helpers can't read server-only env vars. They look at the `NEXT_PUBLIC_*` mirror.

**Fix:** Mirror every overridden auth-route env var with its public twin:

```
MONOCLOUD_AUTH_SIGNIN_URL=/login
NEXT_PUBLIC_MONOCLOUD_AUTH_SIGNIN_URL=/login
```

…and update the redirect URI in the MonoCloud dashboard if the callback URL changed.

## Boolean env vars silently fall back to default

**Symptom:** `MONOCLOUD_AUTH_SESSION_SLIDING=1` (or `=yes`, `=on`) doesn't enable sliding sessions. `MONOCLOUD_AUTH_USE_PAR=0` doesn't disable PAR.

**Cause:** The boolean coercion helper (`getBoolean` in `core/src/utils/internal.ts`) only accepts the literal strings `true` or `false` (case-insensitive — `True`, `TRUE`, `FALSE` work). Anything else (`1`, `0`, `yes`, `no`, `on`, `off`, empty string) returns `undefined`, which falls back to the option's default. There's no warning — the variable is silently ignored.

**Fix:** Use the exact strings `true` or `false` in your env files:

```
MONOCLOUD_AUTH_SESSION_SLIDING=true
MONOCLOUD_AUTH_USE_PAR=false
```

This applies to every `MONOCLOUD_AUTH_*` boolean option: `USE_PAR`, `FEDERATED_SIGNOUT`, `ALLOW_QUERY_PARAM_OVERRIDES`, `FETCH_USER_INFO`, `REFETCH_USER_INFO`, `SESSION_SLIDING`, and the cookie flags (`SESSION_COOKIE_HTTP_ONLY`, `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_PERSISTENT`, `STATE_COOKIE_SECURE`, `STATE_COOKIE_PERSISTENT`).

## `getTokens()` in a Server Component silently no-ops the session write

**Symptom:** `getTokens()` returns a fresh access token from a React Server Component, but on the next request the cookie still carries the old token — so the SDK refreshes again. For sliding sessions: the rolling window never advances when most reads happen inside Server Components and the session expires sooner than expected.

**Cause:** When the access token is missing or expired, `getTokens()` calls `oidcClient.refreshSession()` and then `sessionService.updateSession()`. `updateSession` always tries to write the updated session **back to the cookie** to update either the encrypted session payload (no store) or the lifetime metadata (`c`/`u`/`e` — store mode). Next.js App Router forbids `cookies().set()` outside Server Actions, Route Handlers, and middleware, and the SDK's cookie wrapper catches that error and emits a single `console.warn` instead of throwing (see `monocloud-cookie-response.ts`).

The split:

- **No `session.store`** — full session lives in the cookie. The refresh succeeds at the OP, but the new access token, new id token, possibly-rotated refresh token, and bumped `lifetime.u` are all lost. Every subsequent Server Component call re-refreshes from scratch using the same (still-valid) refresh token — wasteful, and if your OP enforces refresh-token rotation it will eventually invalidate the old token and break auth entirely.
- **With `session.store`** — only the session key + lifetime live in the cookie; the payload is in your store. `store.set(key, session, lifetime)` runs against your store directly, so the **new tokens persist correctly**. But the cookie write that would bump `lifetime.u` is the one that fails — so for `sliding: true`, the rolling window doesn't advance from Server Components, even though the data is up to date.

**Fix:** Call `getTokens()` from a context where cookie writes are allowed:

- Route Handler (`app/api/.../route.ts`) — fetch the token there and return it to the page.
- Server Action — call `getTokens()` in the action, then revalidate.
- `authMiddleware()` — runs on every matched request; it can refresh tokens and write cookies. Use this as the steady-state strategy when you want sliding sessions to actually slide.

If you must read a token in a Server Component, accept that it may be re-fetched on the next call. Don't rely on Server Component reads to keep a sliding session alive.

**Verify:** A `console.warn` like `"Cookies can only be modified in a Server Action or Route Handler"` (or similar Next.js wording) in your dev server output is the smoking gun.

## Older training-data SDK ghosts

**Symptom:** Code references `MonoCloudAuthProvider`, `useUser`, `monoCloudMiddleware`, or a developer-written `app/api/auth/[...monocloud]/route.ts` as the default integration. None of those exist in `@monocloud/auth-nextjs`.

**Cause:** The agent is pattern-matching against an older or similarly named MonoCloud package from training data.

**Fix:** Always look up the actual `package.json` first. The exports in `@monocloud/auth-nextjs` are documented in [`api-surface.md`](api-surface.md). The route catch-all is **only** for the edge case where middleware can't be used.

## Diagnostic

Run the bundled verify script to check env + dependency wiring without opening the app:

```bash
node skills/monocloud-auth-nextjs/scripts/verify.js
```
