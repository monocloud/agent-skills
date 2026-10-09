---
name: monocloud-auth-nextjs
description: Use when adding MonoCloud authentication to a Next.js app (App/Pages Router) — installing/configuring `@monocloud/auth-nextjs`, wiring `authMiddleware()` in `proxy.ts`/`middleware.ts` or a `monoCloudAuth()` `[...monocloud]` catch-all, a shared `MonoCloudNextClient` (`session.store`, `onSessionCreating`, `onBackChannelLogout`), reading sessions with `getSession()`/`useAuth()`, protecting routes/pages/APIs/actions with `protect()`/`protectApi()`/`protectPage()`/`protectClientPage()`/`isUserInGroup()`, rendering `<SignIn>`/`<SignUp>`/`<SignOut>`/`<Protected>`/`<RedirectToSignIn>`, calling `getTokens()`/`redirectToSignIn()`/`redirectToSignOut()`, or troubleshooting `MONOCLOUD_AUTH_*` / `NEXT_PUBLIC_MONOCLOUD_AUTH_*` env vars, cookie sessions, back-channel logout, auth routes (`/api/auth/signin`, `/callback`, `/userinfo`, `/signout`, `/backchannel-logout`), `MonoCloudValidationError`, `Invalid Authentication State`, `can only be used in App Router server environments`, or `Request to … timed out` errors.
license: MIT
---

# MonoCloud Next.js SDK (`@monocloud/auth-nextjs`)

Server-side OIDC authentication for Next.js — App Router and Pages Router, Node and Edge runtimes. A middleware/proxy serves the auth routes and gates pages; sessions live in encrypted cookies (optionally backed by your own store); server helpers, React components and a hook cover the rest.

## Package identity — read this first

**Use:** `@monocloud/auth-nextjs` (this skill). Check `package.json` for it before suggesting code.

This is **not** the same SDK as:

- `@monocloud/auth-react` — React SPA SDK with `<MonoCloudAuthProvider>` and a provider-bound `useAuth` (skill: `monocloud-auth-react`). Don't use it in Next.js; this SDK's `useAuth` comes from `@monocloud/auth-nextjs/client` and needs no provider.
- `@monocloud/auth-web-js` — vanilla browser SPA SDK (skill: `monocloud-web-js`).
- `@monocloud/backend-node` — bearer-token validation for APIs (skills: `monocloud-auth-express`, `monocloud-auth-fastify`).

These names do **not** exist in `@monocloud/auth-nextjs`: `MonoCloudAuthProvider`, `UserProvider`, `useUser`, `useMonoCloudAuth`, `monoCloudMiddleware`, `handleAuth`, `withPageAuthRequired`, `withApiAuthRequired`, `protectServerAction`, or a `protectPage` export from `/client` (the client HOC is `protectClientPage`). A hand-written `app/api/auth/[...monocloud]/route.ts` is not the default setup — `authMiddleware()` serves the auth routes.

## Install

```bash
npm install @monocloud/auth-nextjs
```

Requires Node.js ≥ 20. Peers: `next` `^13.5.11 || ^14.2.35 || ~15.0.7 || ~15.1.11 || ~15.2.8 || ~15.3.8 || ~15.4.10 || ~15.5.9 || ^16.0.10`; `react` `^18.0.0 || ^19.2.3`; `react-dom` `^18.3.1 || ^19.2.3`.

## Subpath exports

| Import path | Use in | Contains |
| --- | --- | --- |
| `@monocloud/auth-nextjs` | Server: RSC, Server Actions, Route Handlers, middleware/proxy, Pages API, `getServerSideProps` | `authMiddleware`, `monoCloudAuth`, `getSession`, `getTokens`, `isAuthenticated`, `isUserInGroup`, `protect`, `protectApi`, `protectPage`, `redirectToSignIn`, `redirectToSignOut`, `MonoCloudNextClient`, error classes, types |
| `@monocloud/auth-nextjs/client` | Client Components | `useAuth`, `protectClientPage` |
| `@monocloud/auth-nextjs/components` | Server or Client Components | `<SignIn>`, `<SignUp>`, `<SignOut>` (render `<a>`) |
| `@monocloud/auth-nextjs/components/client` | Client Components | `<Protected>`, `<RedirectToSignIn>` |

## Environment variables

Read from `process.env`; constructor options override them. Full list (cookies, sessions, PAR, client-auth methods, caching): [api-surface.md](references/api-surface.md#environment-variables).

| Variable | Required | Notes |
| --- | --- | --- |
| `MONOCLOUD_AUTH_TENANT_DOMAIN` | ✓ | Tenant URL **including `https://`**, e.g. `https://acme.us.monocloud.com` — must equal the token issuer |
| `MONOCLOUD_AUTH_CLIENT_ID` | ✓ | |
| `MONOCLOUD_AUTH_CLIENT_SECRET` | ✓ | For `private_key_jwt`, a private-key JWK as a JSON string |
| `MONOCLOUD_AUTH_APP_URL` | ✓ | Absolute app URL, e.g. `http://localhost:3000`. Its scheme also decides the cookies' `Secure` flag |
| `MONOCLOUD_AUTH_COOKIE_SECRET` | ✓ | Cookie encryption key — `openssl rand -hex 32` (the validator only enforces 8 chars) |
| `MONOCLOUD_AUTH_SCOPES` | | Default `openid profile email`; must include `openid` |
| `MONOCLOUD_AUTH_RESOURCE` | | Default resource(s) for access tokens: space-separated absolute URLs, no query/hash |
| `MONOCLOUD_AUTH_GROUPS_CLAIM` | | Default `groups`; claim read by server-side group checks |
| `MONOCLOUD_AUTH_SIGNIN_URL`, `_CALLBACK_URL`, `_USER_INFO_URL`, `_SIGNOUT_URL`, `_BACK_CHANNEL_LOGOUT_URL` | | Route overrides (defaults: `/api/auth/signin`, `/callback`, `/userinfo`, `/signout`, `/backchannel-logout`) |
| `MONOCLOUD_AUTH_RESPONSE_TIMEOUT` | | ms per request to MonoCloud; default `10000`, minimum `1000` |

- Boolean vars accept only `true`/`false`; numeric vars must parse as integers — anything else is silently ignored.
- Client code can't read server env vars. When you override the sign-in, sign-out or userinfo route (or the groups claim), set the `NEXT_PUBLIC_` twin to the same value (e.g. `NEXT_PUBLIC_MONOCLOUD_AUTH_SIGNIN_URL`). Any `NEXT_PUBLIC_MONOCLOUD_AUTH_*` value is copied over its server counterpart when a client is constructed, so the two must never differ.

In the MonoCloud dashboard (application → Application URLs) register the callback URL `http://localhost:3000/api/auth/callback`, the sign-out URL `http://localhost:3000` (and any other post-logout URL you use), plus `…/api/auth/backchannel-logout` if you use back-channel logout. Update them whenever a route or `MONOCLOUD_AUTH_APP_URL` changes.

## Wire the middleware/proxy

`authMiddleware()` serves the auth routes **before** any protection check and protects every other route it matches. Pick the file name from the `next` major in `package.json`:

- Next.js 16+: `proxy.ts` (`src/proxy.ts` in a `src/` layout)
- Next.js 13–15: `middleware.ts` (`src/middleware.ts`)

```ts
// src/proxy.ts (Next 16+) — identical body in src/middleware.ts (Next 13–15)
import { authMiddleware } from "@monocloud/auth-nextjs";

export default authMiddleware();

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
```

Keep `/api/auth/*` inside the matcher — the common `/((?!api|_next/static|…).*)` pattern excludes it and breaks sign-in.

With no options, **every matched route requires a session**: pages redirect to sign-in with `return_url`, and paths starting with `/api` get `401 {"message":"unauthorized"}`. Narrow it with `protectedRoutes`:

```ts
authMiddleware({ protectedRoutes: ["^/dashboard", /^\/api\/admin(\/.*)?$/] }); // strings are unanchored regex sources
authMiddleware({ protectedRoutes: [] }); // protect nothing; auth routes are still served
authMiddleware({ protectedRoutes: (req) => req.nextUrl.pathname.startsWith("/app") }); // predicate, may be async
authMiddleware({ protectedRoutes: [{ routes: ["^/admin"], groups: ["admin"] }] }); // also require a group (any-of)
```

Group failures return `403` (`{"message":"forbidden"}` under `/api`, plain-text `forbidden` elsewhere). Hooks (`onAccessDenied`, `onGroupAccessDenied`, `onError`) and composing with your own middleware: [protecting.md](references/protecting.md#authmiddleware-options).

## Shared client instance (`MonoCloudNextClient`)

The root function exports (`authMiddleware`, `getSession`, `protectPage`, …) share a lazily created singleton configured **only** from env vars. Code-only options — `session.store`, `onSessionCreating`, `onSetApplicationState`, `onBackChannelLogout`, `resources`, `fetcher` — need your own instance, and then **its** methods must be used everywhere (`monoCloud.authMiddleware()`, `monoCloud.getSession()`, …). Mixing in root exports splits the configuration — e.g. the root `getSession()` cannot see sessions kept in your store.

```ts
// src/lib/monocloud.ts
import { MonoCloudNextClient } from "@monocloud/auth-nextjs";

export const monoCloud = new MonoCloudNextClient({
  session: { store: redisSessionStore }, // { get(key), set(key, session, lifetime), delete(key) }
});
```

## Read the session — server

`getSession()` → `Promise<MonoCloudSession | undefined>`; claims are on `session.user`. Call it with no arguments in Server Components, Server Actions and Route Handlers; pass `req, res` in Pages API routes and `getServerSideProps`, and in custom middleware (so refreshed cookies land on the response you return).

```tsx
// app/page.tsx
import { getSession } from "@monocloud/auth-nextjs";

export default async function Page() {
  const session = await getSession();
  return session ? <p>Hello {session.user.name}</p> : <p>Not signed in</p>;
}
```

```ts
// pages/api/me.ts — getServerSideProps uses the same shape: getSession(ctx.req, ctx.res)
import { getSession } from "@monocloud/auth-nextjs";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession(req, res);
  res.json(session?.user ?? null);
}
```

`isAuthenticated()` and `isUserInGroup(groups, { matchAll?, groupsClaim? }?)` accept the same leading `req[, res]` arguments. `getSession({ refetchUserInfo: true })` re-reads the claims from MonoCloud's UserInfo endpoint and updates the session.

## Read the user — client

```tsx
"use client";
import { useAuth } from "@monocloud/auth-nextjs/client";

export default function Profile() {
  const { user, isLoading, isAuthenticated, error, refetch } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <p>Not signed in</p>;
  return <button onClick={() => refetch(true)}>{user?.email} — refresh profile</button>;
}
```

`useAuth()` fetches the userinfo route with SWR (`204` → signed out); no provider is needed. `refetch()` re-reads the route; `refetch(true)` adds `?refresh=true`, so the server re-fetches claims from MonoCloud and updates the session. `refetch` is a no-op until a user has loaded.

## Sign in, sign up, sign out

```tsx
import { SignIn, SignUp, SignOut } from "@monocloud/auth-nextjs/components";

<SignIn returnUrl="/dashboard" loginHint="user@example.com">Sign in</SignIn>
<SignUp returnUrl="/welcome">Sign up</SignUp> {/* always sends prompt=create */}
<SignOut postLogoutUrl="/goodbye" federated>Sign out</SignOut>
```

They render plain `<a>` links (extra anchor props pass through) and work in Server and Client Components. `<SignIn>` also takes `authenticatorHint`, `prompt`, `scopes`, `resource`, `audience`, `idTokenHint`, `acrValues`, `display`, `uiLocales`, `maxAge`; `<SignOut>` takes `idTokenHint`. These travel as query parameters, honored only while `MONOCLOUD_AUTH_ALLOW_QUERY_PARAM_OVERRIDES` is `true` (default), and `scopes`/`resource` **replace** the configured defaults for that sign-in — include `openid`.

Server-side redirects (App Router only — RSC, Server Actions, Route Handlers) call Next's `redirect()`, so code after them never runs:

```ts
"use server";
import { redirectToSignIn, redirectToSignOut } from "@monocloud/auth-nextjs";

export async function login() { await redirectToSignIn({ returnUrl: "/dashboard" }); }
export async function logout() { await redirectToSignOut({ postLogoutRedirectUri: "/" }); }
```

In a Client Component, render `<RedirectToSignIn returnUrl="…" />` from `/components/client` to redirect on mount.

## Protecting routes — at a glance

| Protecting | Helper | Denied (default) |
| --- | --- | --- |
| Groups of routes | `authMiddleware({ protectedRoutes })` | redirect / `401` under `/api` |
| App Router page | `export default protectPage(Page, options?)` | redirect |
| Pages Router page | `export const getServerSideProps = protectPage(options?)` | redirect |
| App or Pages Router API | `protectApi(handler, options?)` | `401` / `403` JSON |
| RSC / Server Action / Route Handler, inline | `await protect(options?)` (App Router only) | redirect (group failure too) |
| Client page (rendering only) | `export default protectClientPage(Page, options?)` | browser redirect |
| Part of client UI | `<Protected groups? fallback?>` | `fallback` |

The helpers take `groups`, `matchAll` and `groupsClaim` (`<Protected>` uses `matchAllGroups`; middleware group rules are always any-of); the redirecting ones add `returnUrl` and `authParams`; most accept `onAccessDenied` / `onGroupAccessDenied` overrides.

```tsx
import { protectPage, protectApi } from "@monocloud/auth-nextjs";
import { NextResponse } from "next/server";

// app/admin/page.tsx — the wrapped component receives `user`
export default protectPage(({ user }) => <p>Hi {user.email}</p>, { groups: ["admin"] });

// app/api/data/route.ts
export const GET = protectApi(async () => NextResponse.json({ ok: true }));

// pages/account.tsx — the page's props get `user`
export const getServerSideProps = protectPage();
```

Full option shapes, defaults and the server-action patterns: [protecting.md](references/protecting.md).

## Access tokens

`getTokens()` (same argument shapes as `getSession()`) returns `MonoCloudTokens` — `accessToken`, `accessTokenExpiration`, `scopes`, `idToken?`, `refreshToken?`, `isExpired`, … — refreshing the access token when it is missing or within 30 s of expiry.

```ts
import { getTokens } from "@monocloud/auth-nextjs";

const { accessToken } = await getTokens();
await fetch("https://api.example.com/things", { headers: { Authorization: `Bearer ${accessToken}` } });

await getTokens({ forceRefresh: true });
await getTokens({ resource: "https://api.example.com", scopes: "read:things" }); // must have been granted at sign-in
```

It throws `MonoCloudValidationError` (`Session does not exist`) without a session, and needs a refresh token to obtain a missing or expired token. Prefer Route Handlers, Server Actions or middleware: Server Components cannot write cookies, so a refresh there is not persisted for cookie-only sessions.

## Back-channel logout

MonoCloud can `POST` a `logout_token` to `/api/auth/backchannel-logout` (override: `MONOCLOUD_AUTH_BACK_CHANNEL_LOGOUT_URL`). The route answers `404` until an `onBackChannelLogout` callback is set — constructor-only, no env var — on the instance whose `authMiddleware()`/`monoCloudAuth()` is mounted:

```ts
export const monoCloud = new MonoCloudNextClient({
  session: { store: redisSessionStore },
  onBackChannelLogout: async (sub, sid) => {
    // At least one of sub/sid is present. Store keys are random UUIDs, so keep
    // your own sub/sid → key index to find the sessions to delete.
  },
});
// proxy.ts: export default monoCloud.authMiddleware();
```

Responses: `204` handled · `404` no callback · `405` not `POST` · `400 {"error":"invalid_request",…}` missing/invalid token · `500` config, JWKS or callback failure. Pair it with `session.store` (cookie-only sessions have nothing server-side to revoke) and register the URL in the dashboard. Details: [troubleshooting.md](references/troubleshooting.md#back-channel-logout-returns-404-405-400-or-500).

## Alternative: catch-all route

Only when middleware can't be used, mount `monoCloudAuth()` instead — never both (a middleware that matches `/api/auth/*` answers first, so the catch-all would never run):

```ts
// app/api/auth/[...monocloud]/route.ts — POST is needed for form_post callbacks and back-channel logout
import { monoCloudAuth } from "@monocloud/auth-nextjs";
const handler = monoCloudAuth();
export { handler as GET, handler as POST };

// pages/api/auth/[...monocloud].ts — receives every method already
export default monoCloudAuth();
```

## Common pitfalls

1. **Wrong file name for the Next.js major.** Next ≤ 15 ignores `proxy.ts`; Next 16+ uses `proxy.ts`. Check the installed `next` version.
2. **Matcher excludes `/api`.** Auth routes then 404 and `useAuth()` reports `Failed to fetch user`.
3. **Custom `MonoCloudNextClient` mixed with root exports.** Store, hooks and `resources` only apply to the instance's own methods.
4. **`protect()` / `redirectToSignIn()` / `redirectToSignOut()` in the Pages Router or client code.** They throw `… can only be used in App Router server environments …`; use `protectPage()` / `protectApi()` / `getSession(req, res)` or `<RedirectToSignIn>`.
5. **Expecting redirects from `protectApi()` or a 403 from `protect()`.** APIs get JSON `401`/`403`; `protect()` sends group failures to sign-in — use `isUserInGroup()` to answer `403` yourself.
6. **Client helpers in Server Components.** `useAuth`, `protectClientPage`, `<Protected>` and `<RedirectToSignIn>` belong in `"use client"` files, and they only hide UI — gate data with server helpers.
7. **Overridden routes without `NEXT_PUBLIC_` twins.** `<SignIn>`, `<SignOut>`, `useAuth()` keep using the defaults.
8. **Tenant domain without `https://`, or `MONOCLOUD_AUTH_SCOPES` without `openid`.** Config validation fails and the auth routes return `500`.
9. **Back-channel logout stuck on `404`.** `onBackChannelLogout` is constructor-only and must be on the mounted instance.

## Deeper reference

- [references/api-surface.md](references/api-surface.md) — every export with signatures, `MonoCloudOptions`, models, errors, auth-route contract, full env-var table.
- [references/protecting.md](references/protecting.md) — option shapes and default behavior of each protection helper, group rules, which helpers forward which auth params.
- [references/troubleshooting.md](references/troubleshooting.md) — symptom → cause → fix, including config-validation messages and callback errors.
- [scripts/verify.js](scripts/verify.js) — `node scripts/verify.js [project-dir]` checks dependencies, proxy/middleware wiring, env vars and SDK imports.
