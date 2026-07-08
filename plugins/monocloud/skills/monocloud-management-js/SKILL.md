---
name: monocloud-management-js
description: Use when calling the MonoCloud Management API from Node.js / TypeScript — installing or configuring `@monocloud/management`, initializing `MonoCloudManagementClient` via the static `init()` factory with `domain` + `apiKey`, calling the ten resource clients (`users`, `clients`, `groups`, `resources`, `keys`, `logs`, `options`, `branding`, `networkZones`, `trustStores`) — including IP/regional network zones, PKI & SPIFFE (mTLS) trust stores, API access policies, external authenticators, and grants/tokens — reading `.result` and looping paginated lists via `MonoCloudPageResponse.pageData`, handling `MonoCloudException` / `MonoCloudUnauthorizedException` / `MonoCloudPaymentRequiredException` / `MonoCloudIdentityValidationException` subclasses, or troubleshooting `MONOCLOUD_MANAGEMENT_DOMAIN` / `MONOCLOUD_MANAGEMENT_API_KEY` / `MONOCLOUD_MANAGEMENT_TIMEOUT` / 401 / 402 / 403 / 422 validation errors.
license: MIT
---

# MonoCloud Management JS SDK (`@monocloud/management`)

Typed JavaScript / TypeScript SDK for the MonoCloud Management API. Use it to programmatically manage users, applications, groups, API resources, tenant options, branding, logs, signing keys, PKI/SPIFFE trust stores, and network zones in a MonoCloud tenant.

## Package identity — read this first

**Use:** `@monocloud/management` (this skill). Check `package.json` before writing code — confirm this is the dependency and note its version.

This is **not** the same SDK as:

- `@monocloud/auth-nextjs` — Next.js user sessions (different skill: `monocloud-auth-nextjs`).
- `@monocloud/auth-web-js` — browser SPA sessions (different skill: `monocloud-web-js`).
- `@monocloud/backend-node` — API bearer-token validation (different skills: `monocloud-auth-express`, `monocloud-auth-fastify`).
- `MonoCloud.Management` — the .NET Management SDK (different skill: `monocloud-management-dotnet`; it uses `.Data` / `.PageData` and PascalCase, not the JS conventions below).

`@monocloud/management-core` is the internal core package. Applications import from `@monocloud/management`; the public types (`MonoCloudConfig`, `MonoCloudResponse`, `Fetcher`, `IdentityError`, and the `MonoCloud*Exception` classes) are re-exported from the main package. **`MonoCloudPageResponse`, `PageModel`, and `ProblemDetails` are NOT re-exported from `@monocloud/management`** — they live in the core package (see [Response shape](#response-shape)).

Do not invent method names from stale training data. The client is created with a **static factory** (`MonoCloudManagementClient.init()`), the constructor is private, and the deserialized body lives on **`.result`** (not `.data`).

## Installation

```bash
npm install @monocloud/management
```

Supported Node.js: `>= 11.0.0`. Requires a global `fetch` (Node 18+ has it built in; on older runtimes supply your own via the [custom fetcher](#replacing-the-http-layer-optional)).

## Authentication — Management API key

You need a **Management API key** generated in the MonoCloud dashboard. Treat it like a root credential:

- Never ship it to a browser or commit it to source control.
- Always read it from `process.env` (or an equivalent secret store).
- A management key is **tenant-scoped** with full admin permissions.

The key is sent on every request as the `X-API-KEY` header (the SDK sets this for you).

## Environment variables (and config keys)

The SDK can be configured by environment variables **or** explicit options passed to `init()`. Explicit options always win; each env var is only consulted when the matching option is omitted.

| Env var                        | Option           | Required? | Purpose                                                  |
| ------------------------------ | ---------------- | --------- | -------------------------------------------------------- |
| `MONOCLOUD_MANAGEMENT_DOMAIN`  | `domain`         | yes       | Bare tenant URL, e.g. `https://acme.us.monocloud.com`    |
| `MONOCLOUD_MANAGEMENT_API_KEY` | `apiKey`         | yes       | Management API key (sent as `X-API-KEY`)                 |
| `MONOCLOUD_MANAGEMENT_TIMEOUT` | `config.timeout` | no        | Per-request timeout in **milliseconds** (default `10000`)|

The `domain` value should be the bare tenant URL — **no `/api`, no trailing slash**. The SDK sanitizes it (prepends `https://` if missing, strips a trailing `/`, then appends `/api/`) and builds request paths itself.

Missing `domain` throws `MonoCloudException` (`Tenant Domain is required`); missing `apiKey` throws `MonoCloudException` (`Api Key is required`).

> The env-var wiring for `MONOCLOUD_MANAGEMENT_TIMEOUT` is finicky. For a reliable timeout, pass `config: { timeout }` explicitly in `init()` options rather than relying on the env var.

## Quick start — env-driven

```ts
import { MonoCloudManagementClient } from "@monocloud/management";

// Reads MONOCLOUD_MANAGEMENT_DOMAIN and MONOCLOUD_MANAGEMENT_API_KEY from process.env.
const management = MonoCloudManagementClient.init();

const { result, status, pageData } = await management.users.getAllUsers(1, 25);
console.log(`Page ${pageData.current_page} of ${pageData.total_count} users`);
for (const user of result) console.log(user.user_id);
```

## Quick start — explicit options

```ts
import { MonoCloudManagementClient } from "@monocloud/management";

const management = MonoCloudManagementClient.init({
  domain: process.env.MONOCLOUD_MANAGEMENT_DOMAIN!,
  apiKey: process.env.MONOCLOUD_MANAGEMENT_API_KEY!,
  config: { timeout: 30_000 }, // optional, milliseconds
});
```

`MonoCloudManagementClient.init(options?, fetcher?)` is the **only** way to construct the client — the constructor is private, so `new MonoCloudManagementClient()` will not compile. Create one shared client at startup and reuse it. **Never inline the API key as a string literal.**

## Client surface

`MonoCloudManagementClient` exposes ten read-only resource-client accessors — one per Management API area:

| Accessor        | Client class          | Resource area                                                                           | Source file                    |
| --------------- | --------------------- | --------------------------------------------------------------------------------------- | ------------------------------ |
| `.branding`     | `BrandingClient`      | Page / email / SMS branding options (read + patch)                                      | `clients/branding-api.ts`      |
| `.clients`      | `ClientsClient`       | OAuth/OIDC applications, secrets, app↔group assignments (models named `Application`)     | `clients/clients-api.ts`       |
| `.groups`       | `GroupsClient`        | Groups (RBAC / membership)                                                              | `clients/groups-api.ts`        |
| `.keys`         | `KeysClient`          | Signing key materials — list, rotate, revoke                                            | `clients/keys-api.ts`          |
| `.logs`         | `LogsClient`          | Tenant audit / event logs                                                               | `clients/logs-api.ts`          |
| `.networkZones` | `NetworkZonesClient`  | IP & regional network zones (**ScaleX**)                                                 | `clients/network-zones-api.ts` |
| `.options`      | `OptionsClient`       | Tenant authentication & communication options, sign-up custom fields                    | `clients/options-api.ts`       |
| `.resources`    | `ResourcesClient`     | API resources, secrets, scopes, **API access policies**, standalone scopes, claim resources | `clients/resources-api.ts` |
| `.trustStores`  | `TrustStoresClient`   | PKI & SPIFFE (mTLS) trust stores, revocations, banned certs/SVIDs                        | `clients/trust-stores-api.ts`  |
| `.users`        | `UsersClient`         | Full user lifecycle, identifiers, passwords, data, sessions, grants/tokens              | `clients/users-api.ts`         |

`networkZones` and `trustStores` accessors are camelCase. Each method returns `Promise<MonoCloudResponse<T>>`, or `Promise<MonoCloudPageResponse<T>>` for paginated `getAll*` lists.

See [`references/api-surface.md`](references/api-surface.md) for the full method-by-method surface.

## Response shape

Every call resolves to a `MonoCloudResponse<T>` (a class, not a plain object):

```ts
class MonoCloudResponse<T> {
  result: T; // deserialized body — NOT `.data`
  status: number;
  headers: Record<string, any>;
}

// Returned by all paginated getAll* methods (extends MonoCloudResponse):
class MonoCloudPageResponse<T> extends MonoCloudResponse<T> {
  pageData: {
    page_size: number;
    current_page: number;
    total_count: number;
    has_next: boolean;
    has_previous: boolean;
  };
}
```

`pageData` is parsed from the `x-pagination` response header. Empty / no-content responses (e.g. `delete*`) resolve to `MonoCloudResponse<null>` with `result === null`.

> `MonoCloudPageResponse` and its `PageModel` are exported from `@monocloud/management-core`, **not** from `@monocloud/management`. Don't `import { MonoCloudPageResponse } from "@monocloud/management"` — it will be `undefined`. Rely on the method's inferred return type, or import from `@monocloud/management-core` if you need the explicit annotation.

## Pagination — idiomatic loop

Paginated list methods take `(page?, size?, filter?, sort?)`. All four are optional and simply omitted from the query string when `undefined` (the server applies its own defaults), so pass `page`/`size` explicitly when you page.

```ts
async function* eachUser(management: MonoCloudManagementClient) {
  let page = 1;
  while (true) {
    const { result, pageData } = await management.users.getAllUsers(page, 100);
    for (const u of result) yield u;
    if (!pageData.has_next) break;
    page += 1;
  }
}
```

- `page` — 1-indexed.
- `size` — items per page.
- `filter` — filter expression (varies per endpoint; see the API reference).
- `sort` — `"<field>:<1 | -1>"` (1 = asc, -1 = desc).

A few list methods are **non-paginated** and return `MonoCloudResponse<T[]>` (no `pageData`): `clients.getAllApplicationSecrets`, `resources.getAllApiResourceSecrets`, `options.getAllSignUpCustomFields`, `trustStores.getAllPkiBannedCertificates`, `trustStores.getAllSpiffeBannedSvids`.

## Common operations

### Create a user

```ts
const { result: user } = await management.users.createUser({
  // shape defined by CreateUserRequest in the SDK types
  email: "alice@example.com",
  name: "Alice Example",
});
```

### Look up a user

```ts
import { MonoCloudNotFoundException } from "@monocloud/management";

try {
  const { result: user } = await management.users.findUserById(userId);
  return user;
} catch (e) {
  if (e instanceof MonoCloudNotFoundException) return null;
  throw e;
}
```

### Patch user data and claims

```ts
await management.users.patchPrivateData(user.user_id, {
  private_data: { onboarded: true, plan: "pro" },
});

await management.users.patchPublicData(user.user_id, {
  public_data: { display_name: "Alice" },
});
```

All update methods are `patch*` (partial merge): keys you omit are left alone. There are no PUT / full-replace methods on the public surface.

### List applications

```ts
const { result: apps, pageData } =
  await management.clients.getAllApplications(1, 50);
```

The accessor is `.clients`, but its methods and models say **`Application`**: `getAllApplications`, `createApplication`, `findApplicationById(clientId)`, `patchApplication`, `deleteApplication`. The path/id parameter is still `clientId`.

### Read logs

```ts
const { result: logs, pageData } = await management.logs.getAllLogs(1, 50);
const { result: log } = await management.logs.findLogById(logId);
```

### Assign a user to a group

```ts
const { result: membership } =
  await management.users.assignUserToGroup(userId, groupId);
```

## Errors

Every non-2xx response throws a typed exception. All extend `MonoCloudException` (which extends the native `Error`); every HTTP-error class extends `MonoCloudRequestException`.

| Class                                  | Thrown for                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `MonoCloudBadRequestException`         | 400                                                                              |
| `MonoCloudUnauthorizedException`       | 401 (bad / missing API key)                                                      |
| `MonoCloudPaymentRequiredException`    | 402 (feature needs a higher subscription tier — Pro / Secure+ / ScaleX)          |
| `MonoCloudForbiddenException`          | 403                                                                              |
| `MonoCloudNotFoundException`           | 404                                                                              |
| `MonoCloudConflictException`           | 409                                                                              |
| `MonoCloudIdentityValidationException` | 422 identity validation — has `errors: IdentityError[]`                          |
| `MonoCloudKeyValidationException`      | 422 key validation — has `errors: Record<string, string[]>`                      |
| `MonoCloudModelStateException`         | 422 (any other model-state / unprocessable-entity validation)                    |
| `MonoCloudResourceExhaustedException`  | 429 (rate limited)                                                               |
| `MonoCloudServerException`             | 500                                                                              |
| `MonoCloudRequestException`            | base for all HTTP-error classes — exposes `response?: ProblemDetails`            |
| `MonoCloudException`                   | base class — also thrown for missing config, timeouts, and unmapped status codes |

`MonoCloudException` has **no** `statusCode` property. Branch on status with `instanceof` against a subclass, and read the server problem-details body via `(e as MonoCloudRequestException).response?.status` / `.title` / `.detail`. Timeouts surface as a plain `MonoCloudException` (the underlying error's `name === 'TimeoutError'`), not a dedicated class.

```ts
import {
  MonoCloudConflictException,
  MonoCloudIdentityValidationException,
  MonoCloudPaymentRequiredException,
  MonoCloudRequestException,
} from "@monocloud/management";

try {
  await management.users.createUser(body);
} catch (e) {
  if (e instanceof MonoCloudConflictException) return { code: 409, error: "duplicate" };
  if (e instanceof MonoCloudIdentityValidationException) return { code: 422, errors: e.errors };
  if (e instanceof MonoCloudPaymentRequiredException) return { code: 402, error: "upgrade required" };
  if (e instanceof MonoCloudRequestException) {
    console.error("Management API call failed", e.response?.status, e.response);
  }
  throw e;
}
```

## Subscription tiers (402 gating)

Some methods and request/option fields require a higher tenant subscription and return **402 → `MonoCloudPaymentRequiredException`** otherwise. Verify the tenant's plan before wiring these into production.

| Tier    | Gated methods (examples)                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------- |
| ScaleX  | `clients.assignGroupToApplication` / `removeGroupFromApplication`; all `networkZones` create/patch; `resources.createApiResourceSecret` |
| Pro     | `groups.createGroup` (beyond 2 groups); `users.getAllUserSessions` / `findUserSession` / `revokeUserSession`; `users.getAllUserClientGrants` |
| Secure+ | `users.getAllUserConsents` / `getAllReferenceTokens` / `getAllRefreshTokens` / `getAllAuthorizationCodes` and the matching `revoke*` methods |

Field-level gates also exist (e.g. application consent fields need Secure+; generating API secrets and reference tokens need ScaleX). See [`references/api-surface.md`](references/api-surface.md) for the per-method annotations.

## Replacing the HTTP layer (optional)

`MonoCloudManagementClient.init(options?, fetcher?)` accepts a second argument of type `Fetcher`:

```ts
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
```

When you supply a `fetcher`, it **fully replaces** the built-in pipeline — the SDK will no longer add the base URL (`/api/`), the `X-API-KEY` / `Content-Type` headers, or the timeout `AbortSignal`. Your fetcher must handle base-URL resolution, auth headers, and timeouts itself. Use it for custom transports, retries, logging, proxies, or non-standard runtimes; for ordinary code prefer the built-in fetcher and set `config.timeout`.

(This is the JS/TS SDK — there is no DI container registration here. `AddMonoCloudManagementClient` belongs to the .NET SDK; see `monocloud-management-dotnet`.)

## Common pitfalls

1. **`new MonoCloudManagementClient()`.** The constructor is private — always use the static `MonoCloudManagementClient.init(...)`.
2. **Reading `.data`.** The JS SDK puts the body on `.result`; `.data` / `.PageData` are the .NET SDK's names.
3. **Putting the API key in browser code.** Management keys are full-tenant admin and must run server-side only.
4. **Trailing `/api` on `domain`.** Pass the bare tenant URL — the SDK appends `/api/` itself; duplicating it yields 404s.
5. **Importing `MonoCloudPageResponse` / `PageModel` / `ProblemDetails` from `@monocloud/management`.** They aren't re-exported there — rely on inferred return types or import from `@monocloud/management-core`.
6. **`clients.getAllClients()` / `logs.getLogs()`.** Real names are `clients.getAllApplications(...)` and `logs.getAllLogs(...)`. The `.clients` accessor exists, but its methods and models say `Application`.
7. **Transposing ResourcesClient id params.** `findApiResourceSecretById(secretId, apiId)`, `findApiScopeById(scopeId, apiId)`, `patchApiScope(scopeId, apiId, body)`, and `deleteApiScope(scopeId, apiId)` take the **child id first**, whereas `createApiResourceSecret(apiId, body)`, `deleteApiResourceSecret(apiId, secretId)`, `getAllApiScopes(apiId, ...)`, and `createApiScope(apiId, body)` take **`apiId` first**. Easy to reverse.
8. **Treating `patch*` as full replace.** Patches merge; omitted fields are untouched. Identifier fields (e.g. an API resource's `audience`, a scope's `name`) are absent from the `Patch*Request` types by design and cannot be changed — TypeScript flags them at the call site.
9. **Catching `Error` instead of `MonoCloudException`.** The typed hierarchy lets you branch on 404 vs 409 vs 422 without string-matching.
10. **Reading `e.statusCode`.** It doesn't exist. Use `instanceof` or `(e as MonoCloudRequestException).response?.status`.
11. **Forgetting pagination.** `getAll*` returns one page. Loop on `pageData.has_next`.
12. **Timeout units.** `config.timeout` is **milliseconds** (default `10000`), not seconds.
13. **Narrowing discriminated unions.** `INetworkZone` and `ICertificateRevocation` are unions — narrow on the `type` field (`'ip'`/`'regional'`, `'base'`/`'delta'`) before touching subtype fields.

## Onboarding checklist

1. `npm install @monocloud/management`.
2. Create a Management API key in the MonoCloud dashboard.
3. Set `MONOCLOUD_MANAGEMENT_DOMAIN` and `MONOCLOUD_MANAGEMENT_API_KEY` in a server-only, `.gitignore`d env file.
4. `import { MonoCloudManagementClient } from '@monocloud/management'`; create one shared client with `init()` and reuse it.
5. Read results from `.result` (and `.pageData` for lists); wrap calls in `try/catch` against the specific `MonoCloudException` subclasses you expect.
6. Run `node skills/monocloud-management-js/scripts/verify.js` to confirm env + dependency wiring.

## Deeper reference

- [`references/api-surface.md`](references/api-surface.md) — resource-by-resource method index, parameter orders, subscription-tier annotations, and model names.
- [`references/troubleshooting.md`](references/troubleshooting.md) — symptom → cause → fix index for the common failure modes (401 / 402 / 403, domain `/api` duplication, browser-side key leaks, `patch*` merge semantics, `catch (Error)`, single-page reads, millisecond timeouts).
