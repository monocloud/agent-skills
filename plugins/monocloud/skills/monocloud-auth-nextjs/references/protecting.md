# Protecting routes, pages, and APIs

Full option shapes and behavior for every protection helper in `@monocloud/auth-nextjs`. All signatures verified against `packages/nextjs/src/`.

## Decision table

| Surface | Helper | Default unauthenticated behavior | Default group-denied behavior |
|---|---|---|---|
| Middleware/proxy | `authMiddleware({ protectedRoutes, ... })` | Redirect to sign-in (or `401` for `/api/*`) | `403 "forbidden"` (or text `403` for non-`/api`) |
| App Router page | `protectPage(Component, options?)` | Redirect to sign-in | Render `"Access Denied"` |
| Pages Router page | `protectPage(options?)` (returns a `getServerSideProps`) | Redirect to sign-in | Render with `groupAccessDenied: true` prop |
| App Router API | `protectApi(handler, options?)` | `401 {"message": "unauthorized"}` | `403 {"message": "forbidden"}` |
| Pages Router API | `protectApi(handler, options?)` | `401 {"message": "unauthorized"}` | `403 {"message": "forbidden"}` |
| Imperative (App Router) | `await protect(options?)` | `redirect()` to sign-in | `redirect()` to sign-in (group check failure is treated as not authorized) |
| Client Component page | `protectClientPage(Component, options?)` | Window-level redirect to sign-in URL | Render `"Access Denied"` |
| Inline client JSX | `<Protected fallback groups>` | Render `fallback` | Render `onGroupAccessDenied(user)` |

All `groups` checks honor `groupsClaim` (defaults to env `MONOCLOUD_AUTH_GROUPS_CLAIM`, then `"groups"`) and `matchAll` (defaults to `false` — user must belong to **any** listed group).

## `authMiddleware(options?)`

```ts
import type { NextRequest, NextFetchEvent, NextResponse } from 'next/server';

interface MonoCloudMiddlewareOptions {
  protectedRoutes?:
    | (string | RegExp | { routes: (string | RegExp)[]; groups: string[] })[]
    | ((req: NextRequest) => boolean | Promise<boolean>);
  groupsClaim?: string;
  matchAll?: boolean;
  onAccessDenied?: (req: NextRequest, evt: NextFetchEvent) =>
    | NextResponse | Response | null | undefined | void
    | Promise<NextResponse | Response | null | undefined | void>;
  onGroupAccessDenied?: (req: NextRequest, evt: NextFetchEvent, user: MonoCloudUser) =>
    | NextResponse | Response | null | undefined | void
    | Promise<NextResponse | Response | null | undefined | void>;
  onError?: (req: NextRequest, evt: NextFetchEvent, error: Error) =>
    NextResponse | void | Promise<NextResponse | void>;
}
```

Behavior:

- If `protectedRoutes` is **omitted**, every route matched by `config.matcher` requires authentication.
- If `protectedRoutes` is `[]`, no routes are protected (but auth routes still work).
- Matchers in the array are evaluated with `new RegExp(...)`, so plain strings act as patterns. Use `^` / `$` if you need anchoring (e.g. `'^/admin$'`).
- Group object form (`{ routes, groups }`): the first matching entry sets the required groups for that request.
- For unauthenticated `/api/*` paths, the default response is `401 JSON`. For other paths, the user is redirected to sign-in with `return_url` set to the original path.

## `protectPage` — App Router

```ts
function protectPage(
  component: (props: {
    user: MonoCloudUser;
    params?: Record<string, string | string[]>;
    searchParams?: Record<string, string | string[] | undefined>;
  }) => JSX.Element | Promise<JSX.Element>,
  options?: ProtectAppPageOptions,
): AppRouterPageHandler;

interface ProtectAppPageOptions {
  returnUrl?: string;                   // defaults to current URL
  groups?: string[];                    // required groups (any-of by default)
  groupsClaim?: string;
  matchAll?: boolean;                   // require all groups
  authParams?: ExtraAuthParams;         // applied to the sign-in URL when redirecting
  onAccessDenied?: (props) => JSX.Element | Promise<JSX.Element>;
  onGroupAccessDenied?: (props & { user }) => JSX.Element | Promise<JSX.Element>;
}
```

The protected component receives `user: MonoCloudUser` in props, plus whatever `params`/`searchParams` Next.js passes.

## `protectPage` — Pages Router

When called **without** a function argument, returns a `getServerSideProps` wrapper.

```ts
function protectPage<P, Q>(
  options?: ProtectPagePageOptions<P, Q>,
): (ctx: GetServerSidePropsContext<Q>) =>
    Promise<GetServerSidePropsResult<P & { user: MonoCloudUser; accessDenied?: boolean }>>;

interface ProtectPagePageOptions<P, Q> {
  returnUrl?: string;
  groups?: string[];
  groupsClaim?: string;
  matchAll?: boolean;
  authParams?: ExtraAuthParams;
  getServerSideProps?: GetServerSideProps<P, Q>; // runs after auth/group checks
  onAccessDenied?: (ctx) => GetServerSidePropsResult<P> | Promise<...>;
  onGroupAccessDenied?: (ctx & { user }) => GetServerSidePropsResult<P> | Promise<...>;
}
```

When the group check fails and `onGroupAccessDenied` is not provided, the page still renders with `props: { groupAccessDenied: true }` so you can render an inline access-denied UI inside the page component.

## `protectApi` — App Router

```ts
function protectApi(
  handler: (req: NextRequest | Request, ctx: { params: ... }) =>
    Response | NextResponse | Promise<Response | NextResponse>,
  options?: ProtectApiAppOptions,
): typeof handler;

interface ProtectApiAppOptions {
  groups?: string[];
  groupsClaim?: string;
  matchAll?: boolean;
  onAccessDenied?: (req, ctx) => Response | Promise<Response>;
  onGroupAccessDenied?: (req, ctx, user) => Response | Promise<Response>;
}
```

Default denial: `NextResponse.json({ message: 'unauthorized' }, { status: 401 })` / `{ message: 'forbidden' }, 403`.

## `protectApi` — Pages Router

Overload selected by handler shape (`NextApiHandler` vs App Router handler).

```ts
function protectApi(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>,
  options?: ProtectApiPageOptions,
): NextApiHandler;

interface ProtectApiPageOptions {
  groups?: string[];
  groupsClaim?: string;
  matchAll?: boolean;
  onAccessDenied?: (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>;
  onGroupAccessDenied?: (req, res, user) => unknown | Promise<unknown>;
}
```

The on-denied handlers must **send** a response via `res` themselves; returning a value does not end the request.

## `protect(options?)` — App Router only

```ts
function protect(options?: ProtectOptions): Promise<void>;

interface ProtectOptions {
  returnUrl?: string;
  groups?: string[];
  groupsClaim?: string;
  matchAll?: boolean;
  authParams?: ExtraAuthParams;
}
```

- Returns silently if the user is authenticated and (when `groups` is set) belongs to one of them.
- Otherwise calls `next/navigation.redirect()` to the sign-in URL — execution stops.
- Throws "can only be used in App Router server environments" if called outside RSC/route handlers/server actions.

## `protectClientPage(Component, options?)` — Client Component HOC

```ts
function protectClientPage<P extends object>(
  Component: React.ComponentType<P & { user: MonoCloudUser }>,
  options?: ProtectClientPageOptions,
): React.FC<P>;

interface ProtectClientPageOptions {
  returnUrl?: string;
  groups?: string[];
  groupsClaim?: string;
  matchAll?: boolean;
  authParams?: ExtraAuthParams;
  onAccessDenied?: () => React.ReactNode;
  onGroupAccessDenied?: (user: MonoCloudUser) => React.ReactNode;
  onError?: (error: Error) => React.ReactNode;
}
```

Without `onAccessDenied`, the wrapped component performs `window.location.assign(<signin-url>?return_url=...)` when no user is loaded.

## `<Protected>` — inline client gating

```tsx
import { Protected } from '@monocloud/auth-nextjs/components/client';

interface ProtectedComponentProps {
  children: React.ReactNode;
  groups?: string[];
  groupsClaim?: string;
  matchAllGroups?: boolean;            // note the name — not `matchAll`
  fallback?: React.ReactNode;          // rendered when unauthenticated
  onGroupAccessDenied?: (user) => React.ReactNode;
}
```

Renders `null` while loading. Does **not** prevent the browser from receiving the children — for true server-side gating, use `protectPage`/`protect`.

## `ExtraAuthParams` (used by every `authParams` option)

Subset of OIDC authorization parameters supported by client-side helpers and protection HOCs:

```ts
interface ExtraAuthParams {
  scopes?: string;
  resource?: string;
  prompt?: 'none' | 'login' | 'consent' | 'select_account' | 'create';
  display?: 'page' | 'popup' | 'touch' | 'wap';
  uiLocales?: string;
  acrValues?: string[];
  authenticatorHint?: string;
  maxAge?: number;
  loginHint?: string;
}
```

## Server-action protection — patterns, not a dedicated helper

There is no `protectServerAction` HOC. Three idiomatic patterns:

```ts
'use server';
import { protect, getSession, redirectToSignIn, isUserInGroup } from '@monocloud/auth-nextjs';

// 1) Hardest, simplest — redirect if not signed in
export async function deletePost(id: string) {
  await protect({ groups: ['admin'] });
  // ... your logic
}

// 2) Soft — return a typed error instead of redirecting
export async function publishPost(id: string) {
  const session = await getSession();
  if (!session) return { ok: false, reason: 'unauthenticated' } as const;
  if (!(await isUserInGroup(['editor']))) return { ok: false, reason: 'forbidden' } as const;
  // ... your logic
  return { ok: true } as const;
}

// 3) Explicit redirect with custom return URL
export async function startCheckout() {
  const session = await getSession();
  if (!session) await redirectToSignIn({ returnUrl: '/checkout' });
  // ... your logic
}
```
