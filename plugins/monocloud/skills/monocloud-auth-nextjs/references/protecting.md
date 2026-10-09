# Protecting routes, pages, and APIs

Option shapes and default behavior of every protection helper in `@monocloud/auth-nextjs`. Server helpers come from the root import; `protectClientPage` from `/client`; `<Protected>` from `/components/client`.

## Default behavior

| Helper | Not signed in | Signed in, not in `groups` |
| --- | --- | --- |
| `authMiddleware({ protectedRoutes })` | `307` to sign-in, `return_url` = path + query; paths starting with `/api` → `401 {"message":"unauthorized"}` | `/api…` → `403 {"message":"forbidden"}`; other paths → `403` plain-text `forbidden` |
| `protectPage(Component, options?)` — App Router | `redirect()` to sign-in | renders the text `Access Denied` |
| `protectPage(options?)` — Pages Router `getServerSideProps` | `{ redirect: { destination: <sign-in URL>, permanent: false } }` | `props: { groupAccessDenied: true }` (no `user`) |
| `protectApi(handler, options?)` — App or Pages Router | `401 {"message":"unauthorized"}` | `403 {"message":"forbidden"}` |
| `protect(options?)` — App Router only | `redirect()` to sign-in | `redirect()` to sign-in as well |
| `protectClientPage(Component, options?)` | `window.location.assign(<sign-in>?return_url=<current URL>)` | renders `<div>Access Denied</div>` |
| `<Protected groups? fallback?>` | renders `fallback` (default `null`) | renders `onGroupAccessDenied(user)` (default: nothing) |

The two client helpers render `null` while `useAuth()` loads and only control rendering — anything passed to them still reaches the browser. Gate data with the server helpers.

## Groups

- Groups come from `session.user[groupsClaim]`; entries may be strings or `{ id, name }` objects, and a required group matches an entry's string, `id` or `name`. An empty `groups` array imposes no requirement.
- Any-of by default; `matchAll: true` requires every group (`<Protected matchAllGroups>`). `authMiddleware()` accepts `matchAll` but does not apply it — middleware group checks are always any-of, so enforce all-of with `protect({ groups, matchAll: true })` or `protectPage(…, { groups, matchAll: true })`.
- Claim name — server helpers: per-call `groupsClaim` → `MonoCloudOptions.groupsClaim` → `MONOCLOUD_AUTH_GROUPS_CLAIM` → `groups`. Client helpers: per-call `groupsClaim` → `NEXT_PUBLIC_MONOCLOUD_AUTH_GROUPS_CLAIM` → `groups`.

## `authMiddleware()` options

```ts
interface MonoCloudMiddlewareOptions {
  protectedRoutes?: ProtectedRouteMatcher[] | ((req: NextRequest) => boolean | Promise<boolean>);
  groupsClaim?: string;
  matchAll?: boolean; // accepted but not applied (see Groups)
  onAccessDenied?: (req: NextRequest, evt: NextFetchEvent) => NextMiddlewareResult | Promise<NextMiddlewareResult>;
  onGroupAccessDenied?: (req: NextRequest, evt: NextFetchEvent, user: MonoCloudUser) => NextMiddlewareResult | Promise<NextMiddlewareResult>;
  onError?: (req: NextRequest, evt: NextFetchEvent, error: Error) => NextResponse | void | Promise<NextResponse | void>;
}
type ProtectedRouteMatcher = string | RegExp | { routes: (string | RegExp)[]; groups: string[] };
type NextMiddlewareResult = NextResponse | Response | null | undefined | void;
```

Request flow:

1. A request carrying an `x-middleware-subrequest` header gets `403 {"message":"forbidden"}`.
2. A path equal to a configured auth route is served (sign-in, callback, userinfo, sign-out, back-channel logout) — never blocked, even by `protectedRoutes: ['.*']`. Failures there go to `onError`.
3. `protectedRoutes` decides whether the path is protected: omitted → every matched path; `[]` → none; array entries are tested in order with `new RegExp(entry).test(pathname)` (unanchored — use `^…$`) and evaluation stops at the first match; if that is a `{ routes, groups }` entry, its groups are required.
4. Session check, then group check, with the defaults above. A response returned from `onAccessDenied` / `onGroupAccessDenied` is used (cookies the SDK set are merged in); returning nothing lets the request continue. `onGroupAccessDenied` never falls back to `onAccessDenied`.

Composing with your own middleware — call it with `(req, evt)` and return its result:

```ts
// proxy.ts / middleware.ts
import { authMiddleware } from "@monocloud/auth-nextjs";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

export default async function proxy(req: NextRequest, evt: NextFetchEvent) {
  if (req.nextUrl.pathname.startsWith("/public")) return NextResponse.next();
  return authMiddleware(req, evt); // still serves /api/auth/* and protects the rest
}
```

`authMiddleware(req, evt)` uses default options; with options, call `authMiddleware({ protectedRoutes })(req, evt)`. Don't route only some paths to it unless `/api/auth/*` is among them — otherwise sign-in breaks.

## `protectPage` — App Router

```ts
function protectPage(
  component: (props: { user: MonoCloudUser; params?; searchParams? }) => JSX.Element | Promise<JSX.Element>,
  options?: ProtectAppPageOptions,
): AppRouterPageHandler;

interface ProtectAppPageOptions {
  returnUrl?: string;        // default: the `x-monocloud-path` request header, else '/'
  groups?: string[];
  groupsClaim?: string;
  matchAll?: boolean;
  authParams?: ExtraAuthParams;
  onAccessDenied?: (props: { params?; searchParams? }) => JSX.Element | Promise<JSX.Element>;
  onGroupAccessDenied?: (props: { user: MonoCloudUser; params?; searchParams? }) => JSX.Element | Promise<JSX.Element>;
}
```

The wrapped component receives Next's page props plus `user`.

`authMiddleware()` sets `x-monocloud-path` on its *response*, not on the forwarded request, so `headers()` normally can't see it and the `returnUrl` default resolves to `/` (same for `protect()`). Pass `returnUrl` explicitly to send users back to the page they asked for.

## `protectPage` — Pages Router

Called without a component it returns a `getServerSideProps`:

```ts
function protectPage<P, Q>(options?: ProtectPagePageOptions<P, Q>):
  (ctx: GetServerSidePropsContext<Q>) => Promise<GetServerSidePropsResult<P & { user: MonoCloudUser; accessDenied?: boolean }>>;

interface ProtectPagePageOptions<P, Q> {
  returnUrl?: string;        // default: ctx.resolvedUrl
  groups?: string[];
  groupsClaim?: string;
  matchAll?: boolean;
  authParams?: ExtraAuthParams;
  getServerSideProps?: GetServerSideProps<P, Q>; // runs after the checks; its props are merged over { user }
  onAccessDenied?: (ctx: GetServerSidePropsContext<Q>) => GetServerSidePropsResult<P> | Promise<GetServerSidePropsResult<P>>;
  onGroupAccessDenied?: (ctx: GetServerSidePropsContext<Q> & { user: MonoCloudUser }) => GetServerSidePropsResult<P> | Promise<GetServerSidePropsResult<P>>;
}
```

On a group failure without `onGroupAccessDenied`, the page renders with `groupAccessDenied: true` (the return type names the flag `accessDenied`, but the runtime prop is `groupAccessDenied`).

## `protectApi`

The overload is chosen from the request at runtime (Web `Request` → App Router).

```ts
// App Router route handler
function protectApi(
  handler: (req: NextRequest | Request, ctx: AppRouterContext) => Response | Promise<Response>,
  options?: ProtectApiAppOptions,
): AppRouterApiHandlerFn;
interface ProtectApiAppOptions {
  groups?: string[]; groupsClaim?: string; matchAll?: boolean;
  onAccessDenied?: (req: NextRequest, ctx: AppRouterContext) => Response | Promise<Response>;
  onGroupAccessDenied?: (req: NextRequest, ctx: AppRouterContext, user: MonoCloudUser) => Response | Promise<Response>;
}

// Pages Router API route
function protectApi(handler: NextApiHandler, options?: ProtectApiPageOptions): NextApiHandler;
interface ProtectApiPageOptions {
  groups?: string[]; groupsClaim?: string; matchAll?: boolean;
  onAccessDenied?: (req: NextApiRequest, res: NextApiResponse) => unknown; // must send the response via `res`
  onGroupAccessDenied?: (req: NextApiRequest, res: NextApiResponse, user: MonoCloudUser) => unknown;
}
```

In the App Router, cookies refreshed while reading the session are merged into the handler's response.

## `protect()` — App Router only

```ts
function protect(options?: ProtectOptions): Promise<void>;
interface ProtectOptions {
  returnUrl?: string;        // default: the `x-monocloud-path` request header, else '/'
  groups?: string[]; groupsClaim?: string; matchAll?: boolean;
  authParams?: ExtraAuthParams;
}
```

- Resolves when the user is signed in (and in `groups`); otherwise calls `redirect()` to sign-in — pass `returnUrl` explicitly (see [`protectPage`](#protectpage--app-router)) — for group failures too. To answer `403` instead, check `isUserInGroup()` yourself.
- Outside RSC / Server Actions / Route Handlers it throws `protect() can only be used in App Router server environments (RSC, route handlers, or server actions)`. Any error raised while reading the session surfaces with the same message.

## `protectClientPage()` — Client Component HOC

```ts
function protectClientPage<P extends object>(
  Component: React.ComponentType<P & { user: MonoCloudUser }>,
  options?: ProtectClientPageOptions, // returnUrl?, groups?, groupsClaim?, matchAll?, authParams?, onAccessDenied?, onGroupAccessDenied?, onError?
): React.FC<P>;
```

- Signed out without `onAccessDenied`: redirects the browser to the sign-in route with `return_url` = `returnUrl` or the current URL (the current query string is carried along).
- A `useAuth()` error renders `onError(error)`, or is thrown if `onError` is missing.

## `<Protected>` — inline client gating

```tsx
"use client";
import { Protected } from "@monocloud/auth-nextjs/components/client";

<Protected groups={["admin", "billing"]} matchAllGroups fallback={<p>Sign in to continue</p>}
  onGroupAccessDenied={(user) => <p>{user.email} lacks access</p>}>
  <BillingSettings />
</Protected>;
```

Props: `children`, `groups?`, `groupsClaim?`, `matchAllGroups?` (not `matchAll`), `fallback?` (also shown on a `useAuth()` error), `onGroupAccessDenied?`.

## Which helpers forward which `authParams`

Everything is sent as query parameters on the sign-in route and honored only while `allowQueryParamOverrides` is `true` (default). `scopes`/`resource` replace the configured defaults for that sign-in — keep `openid` in `scopes`.

| Param | `<SignIn>` | `<SignUp>` | `protect`, `protectPage`, `redirectToSignIn`, `protectClientPage`, `<RedirectToSignIn>` |
| --- | --- | --- | --- |
| `scopes`, `resource`, `acrValues`, `display`, `uiLocales`, `maxAge` | ✓ | ✓ | ✓ |
| `prompt`, `loginHint`, `authenticatorHint` | ✓ | — (`prompt=create`) | ✓ |
| `audience`, `idTokenHint` | ✓ | ✓ | ✗ dropped |

## Server Actions

There is no dedicated HOC; use the helpers inside the action:

```ts
"use server";
import { protect, getSession, isUserInGroup, redirectToSignIn } from "@monocloud/auth-nextjs";

export async function deletePost(id: string) {
  await protect({ groups: ["admin"] }); // redirects unless signed in and in the group
  // …
}

export async function publishPost(id: string) {
  if (!(await getSession())) return { ok: false, reason: "unauthenticated" } as const;
  if (!(await isUserInGroup(["editor"]))) return { ok: false, reason: "forbidden" } as const;
  // …
  return { ok: true } as const;
}

export async function startCheckout() {
  if (!(await getSession())) await redirectToSignIn({ returnUrl: "/checkout" });
  // …
}
```
