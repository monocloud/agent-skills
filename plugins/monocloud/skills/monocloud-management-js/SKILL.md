---
name: monocloud-management-js
description: Use when calling the MonoCloud Management API from Node.js / TypeScript — installing or configuring `@monocloud/management`, initializing `MonoCloudManagementClient` with `domain` + `apiKey`, calling resource clients (`users`, `clients`, `groups`, `resources`, `keys`, `logs`, `options`, `branding`, `trustStores`), reading paginated results via `MonoCloudPageResponse`, handling `MonoCloudException` subclasses, or troubleshooting `MONOCLOUD_MANAGEMENT_DOMAIN` / `MONOCLOUD_MANAGEMENT_API_KEY` / 401 / 403 / validation errors.
license: MIT
---

# MonoCloud Management JS SDK (`@monocloud/management`)

Typed JavaScript / TypeScript SDK for the MonoCloud Management API. Use it to programmatically manage users, applications, groups, API resources, sign-in options, branding, logs, keys, and trust stores in a MonoCloud tenant.

## Package identity — read this first

**Use:** `@monocloud/management` (this skill).

This is **not** the same SDK as:

- `@monocloud/auth-nextjs` — frontend user sessions (different skill: `monocloud-auth-nextjs`).
- `@monocloud/backend-node` — API token validation (different skills: `monocloud-auth-express`, `monocloud-auth-fastify`).

If you see imports from `@monocloud/management-core` directly, that's the internal core package — applications should import from `@monocloud/management`. The core types (`MonoCloudConfig`, `MonoCloudResponse`, `MonoCloudException`, etc.) are re-exported from `@monocloud/management`.

## Installation

```bash
npm install @monocloud/management
```

Supported Node.js: `>= 11.0.0`.

## Authentication — Management API key

You need a **Management API key** generated in the MonoCloud dashboard (Settings → API Keys). Treat it like a root credential:

- Never ship it to a browser or commit it to source control.
- Always read it from `process.env`.
- A management key is **tenant-scoped** and has full admin permissions.

## Environment variables (and config keys)

The SDK can be configured by environment variables **or** explicit options. Options always win.

| Env var                 | Option           | Required? | Purpose                                          |
| ----------------------- | ---------------- | --------- | ------------------------------------------------ |
| `MONOCLOUD_MANAGEMENT_DOMAIN`  | `domain`         | yes       | Tenant URL, e.g. `https://acme.us.monocloud.com` |
| `MONOCLOUD_MANAGEMENT_API_KEY` | `apiKey`         | yes       | Management API key                               |
| `MONOCLOUD_MANAGEMENT_TIMEOUT` | `config.timeout` | no        | Per-request timeout in **milliseconds**          |

The `domain` value should be the bare tenant URL (no `/api`, no trailing slash). The SDK appends `/api/...` internally.

## Quick start — env-driven

```ts
import { MonoCloudManagementClient } from "@monocloud/management";

// Reads MONOCLOUD_MANAGEMENT_DOMAIN and MONOCLOUD_MANAGEMENT_API_KEY from process.env.
const management = MonoCloudManagementClient.init();

const { result, status, pageData } = await management.users.getAllUsers(1, 25);
console.log(`Page ${pageData.current_page} of ${pageData.total_count} users`);
for (const user of result) console.log(user.user_id, user.username?.username);
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

**Never inline the API key as a string literal.** Always read from `process.env` (or an equivalent secret store).

## Client surface

`MonoCloudManagementClient` exposes one property per Management API resource area:

| Property       | Resource                             | Source file (in this SDK)     |
| -------------- | ------------------------------------ | ----------------------------- |
| `.branding`    | `BrandingClient`                     | `clients/branding-api.ts`     |
| `.clients`     | `ClientsClient` (OAuth applications) | `clients/clients-api.ts`      |
| `.groups`      | `GroupsClient`                       | `clients/groups-api.ts`       |
| `.keys`        | `KeysClient`                         | `clients/keys-api.ts`         |
| `.logs`        | `LogsClient`                         | `clients/logs-api.ts`         |
| `.options`     | `OptionsClient` (tenant settings)    | `clients/options-api.ts`      |
| `.resources`   | `ResourcesClient` (API resources)    | `clients/resources-api.ts`    |
| `.trustStores` | `TrustStoresClient`                  | `clients/trust-stores-api.ts` |
| `.users`       | `UsersClient`                        | `clients/users-api.ts`        |

Each resource client method returns `Promise<MonoCloudResponse<T>>` (or `Promise<MonoCloudPageResponse<T>>` for paginated lists). The response object always has `.result`, `.status`, and (for paginated calls) `.pageData`.

See [`references/api-surface.md`](references/api-surface.md) for the full method-by-method surface.

## Response shape

```ts
interface MonoCloudResponse<T> {
  result: T;
  status: number;
  headers: Record<string, string>;
}

interface MonoCloudPageResponse<T> extends MonoCloudResponse<T> {
  pageData: {
    total_count: number;
    page_size: number;
    current_page: number;
    has_next: boolean;
    has_previous: boolean;
  };
}
```

Pagination metadata is returned in the `X-Pagination` response header and parsed onto `pageData`.

## Pagination — idiomatic loop

```ts
async function* eachUser(client: MonoCloudManagementClient) {
  let page = 1;
  while (true) {
    const { result, pageData } = await client.users.getAllUsers(page, 100);
    for (const u of result) yield u;
    if (!pageData.has_next) break;
    page += 1;
  }
}
```

Most list endpoints accept `(page, size, filter, sort)`:

- `page` — 1-indexed.
- `size` — items per page.
- `filter` — Lucene-style expression (varies per endpoint; see API reference).
- `sort` — `"<field>:<1 | -1>"` (1 = asc, -1 = desc).

## Common operations

### Create a user

```ts
const { result: user } = await management.users.createUser({
  email: "alice@example.com",
  email_verified: true,
  name: "Alice Example",
  // see CreateUserRequest in the SDK types for the full field set
});
```

### Patch user metadata

```ts
await management.users.patchPrivateData(user.user_id, {
  private_data: { onboarded: true, plan: "pro" },
});

await management.users.patchPublicData(user.user_id, {
  public_data: { display_name: "Alice" },
});
```

`patch*` requests are field-level merge: keys you omit are left alone, keys you set to `null` are removed.

### Look up a user

```ts
try {
  const { result: user } = await management.users.findUserById(userId);
  return user;
} catch (e) {
  if (e instanceof MonoCloudNotFoundException) return null;
  throw e;
}
```

### List applications

```ts
const { result: apps, pageData } =
  await management.clients.getAllApplications(1, 50);
```

The property on the client is `.clients` (OAuth clients), but the REST resource and method names use `application` — e.g. `getAllApplications`, `createApplication`, `findApplicationById`, `patchApplication`, `deleteApplication`.

### Logs

```ts
const { result: logs } = await management.logs.getAllLogs(1, 50);
```

## Errors

Every non-2xx response throws a typed exception that extends `MonoCloudException`:

| Class                                  | Thrown for                                                              |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `MonoCloudBadRequestException`         | 400                                                                     |
| `MonoCloudUnauthorizedException`       | 401 (bad / missing API key)                                             |
| `MonoCloudPaymentRequiredException`    | 402                                                                     |
| `MonoCloudForbiddenException`          | 403                                                                     |
| `MonoCloudNotFoundException`           | 404                                                                     |
| `MonoCloudConflictException`           | 409                                                                     |
| `MonoCloudIdentityValidationException` | 422 (identity validation) — has `.errors: IdentityError[]`              |
| `MonoCloudKeyValidationException`      | 422 (key validation) — has `.errors: Record<string, string[]>`          |
| `MonoCloudModelStateException`         | 422 (any other model-state validation)                                  |
| `MonoCloudResourceExhaustedException`  | 429                                                                     |
| `MonoCloudServerException`             | 5xx                                                                     |
| `MonoCloudRequestException`            | base for all of the above — exposes `.response?: ProblemDetails`        |
| `MonoCloudException`                   | base class (`extends Error`) — also thrown for network / timeout errors |

`MonoCloudException` itself has no `statusCode` property. To branch on status, use `instanceof` against the specific subclass; to read the original problem-details payload, use `(e as MonoCloudRequestException).response?.status` / `.title` / `.detail`.

Always catch the most specific you care about; fall through to `MonoCloudException` for unexpected cases.

```ts
import {
  MonoCloudConflictException,
  MonoCloudIdentityValidationException,
  MonoCloudNotFoundException,
  MonoCloudRequestException,
} from "@monocloud/management";

try {
  await management.users.createUser({ name });
} catch (e) {
  if (e instanceof MonoCloudConflictException)
    return reply.code(409).send({ error: "duplicate" });
  if (e instanceof MonoCloudIdentityValidationException)
    return reply.code(422).send({ errors: e.errors });
  if (e instanceof MonoCloudRequestException) {
    request.log.error(
      { err: e, status: e.response?.status, problem: e.response },
      "MonoCloud Management API call failed",
    );
    throw e;
  }
  throw e;
}
```

## Replacing the HTTP layer (optional)

`MonoCloudManagementClient.init(options, fetcher?)` accepts a second arg implementing the `Fetcher` interface from `@monocloud/management`. Use it to plug in a custom `fetch` (e.g. for tests, retries, or a non-Node runtime). For production code, prefer the built-in fetcher and configure timeouts via `config.timeout`.

## Common pitfalls

1. **Putting the API key in browser code.** Management keys are full-tenant admin. They must only run server-side.
2. **Trailing `/api/v1` on `domain`.** Pass the bare tenant URL — the SDK appends paths.
3. **Confusing `private_data` and `public_data`.** Public data is exposed in user-facing tokens; private is admin-only. Both are arbitrary JSON.
4. **Treating `patch*` as `put*`.** Patch is **merge**: fields you don't include are left alone. Set a field to `null` to clear it; omit it to leave unchanged.
5. **Catching `Error` instead of `MonoCloudException`.** The typed hierarchy lets you branch on status (404 vs 409 vs 422) without parsing strings.
6. **Reading `e.statusCode`.** `MonoCloudException` doesn't expose status as a property. Use `instanceof` against the subclass (e.g. `MonoCloudNotFoundException`) or read `(e as MonoCloudRequestException).response?.status`.
7. **Forgetting pagination.** `getAll*` returns the first page by default. Loop using `pageData.has_next`.
8. **Calling `getAllClients` or `getLogs`.** Real names are `clients.getAllApplications(...)` and `logs.getAllLogs(...)`. The Clients property exists, but its methods talk about `Application*`.

## Onboarding checklist

1. `npm install @monocloud/management`.
2. Create a Management API key in the MonoCloud dashboard.
3. Set `MONOCLOUD_MANAGEMENT_DOMAIN` and `MONOCLOUD_MANAGEMENT_API_KEY` (in a server-only env file, `.gitignore`d).
4. `import { MonoCloudManagementClient } from '@monocloud/management'`; create one shared client with `init()` and reuse it.
5. Wrap calls in `try/catch` against the specific `MonoCloudException` subclasses you expect.
6. Run `node skills/monocloud-management-js/scripts/verify.js` to confirm env + dependency wiring.

## Deeper reference

- [`references/api-surface.md`](references/api-surface.md) — resource-by-resource method index and request/response shapes.
- [`references/troubleshooting.md`](references/troubleshooting.md) — symptom → cause → fix index for the most common failure modes (401s, domain `/api` duplication, browser-side key leaks, `patch*` merge semantics, generic `catch (Error)`, single-page reads, millisecond vs seconds timeouts).
