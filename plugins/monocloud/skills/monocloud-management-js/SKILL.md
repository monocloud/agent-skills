---
name: monocloud-management-js
description: Use when calling the MonoCloud Management API from Node.js or TypeScript with `@monocloud/management`, creating `MonoCloudManagementClient` via the static `init()` factory (`domain`, `apiKey`, `config.timeout`, custom `fetcher`), calling its `users`, `clients`, `groups`, `resources`, `keys`, `logs`, `options`, `branding`, `networkZones` and `trustStores` clients (applications, API access policies, PKI/SPIFFE trust stores, sessions, grants and tokens), reading `.result` and paging via `MonoCloudPageResponse.pageData`, catching `MonoCloudException` subclasses (`MonoCloudNotFoundException`, `MonoCloudUnauthorizedException`, `MonoCloudForbiddenException`, `MonoCloudPaymentRequiredException`, `MonoCloudIdentityValidationException`) and their `errorCode` / `trace_id`, or troubleshooting `MONOCLOUD_MANAGEMENT_DOMAIN`, `MONOCLOUD_MANAGEMENT_API_KEY`, `MONOCLOUD_MANAGEMENT_TIMEOUT`, `Tenant Domain is required`, `Something went wrong.` and 401/402/403/422 errors.
license: MIT
---

# MonoCloud Management JS SDK (`@monocloud/management`)

Typed Node.js / TypeScript client for the MonoCloud Management API: users, applications, groups, API resources and access policies, tenant options, branding, logs, signing keys, network zones, and PKI/SPIFFE trust stores.

## Package identity — read first

Check `package.json` for **`@monocloud/management`** before writing code. These are different SDKs with their own skills:

- `@monocloud/auth-nextjs` (Next.js sign-in) → `monocloud-auth-nextjs`; `@monocloud/auth-web-js` (browser SPA) → `monocloud-web-js`.
- `@monocloud/backend-node` (validating access tokens in an API) → `monocloud-auth-express` / `monocloud-auth-fastify`.
- `MonoCloud.Management` (NuGet; `.Data`, PascalCase, DI registration) → `monocloud-management-dotnet`.

`@monocloud/management-core` is the internal runtime this package depends on. Import everything from `@monocloud/management`; don't add or import the core package.

## Install

```bash
npm install @monocloud/management
```

ESM and CommonJS builds, with types. `engines` allows Node `>= 11`, but the built-in transport uses global `fetch`, `Headers` and `AbortSignal.timeout`, so it needs Node 18+; elsewhere pass a [custom fetcher](#custom-fetcher).

## Configuration

`MonoCloudManagementClient.init(options?, fetcher?)` uses each option, falling back to its env var when the option is `undefined`:

| Env var | Option | Required | Value |
| --- | --- | --- | --- |
| `MONOCLOUD_MANAGEMENT_DOMAIN` | `domain` | yes | Tenant host, e.g. `acme.us.monocloud.com` or `https://acme.us.monocloud.com` |
| `MONOCLOUD_MANAGEMENT_API_KEY` | `apiKey` | yes | Management API key, sent as the `X-API-KEY` header |
| `MONOCLOUD_MANAGEMENT_TIMEOUT` | `config.timeout` | no | Per-request timeout in **milliseconds** (default `10000`) |

- **Domain:** the SDK prepends `https://` unless the value starts with `https://`, strips one trailing `/`, and appends `/api/`. Never include `/api` (calls go to `/api/api/…` and 404) or `http://` (it becomes `https://http//…` and every call fails with `Something went wrong.`).
- **Timeout:** the env var is read only when `options.config` is omitted — passing any `config` object, even `{}`, ignores it. It is parsed with `parseInt(value, 10)` and used only if positive, so `30s` means 30 ms. `config.timeout: 0` aborts every request; there is no "no timeout" value.
- **Validation:** an empty `domain` or `apiKey` makes `init()` throw `MonoCloudException` (`Tenant Domain is required`, then `Api Key is required`). An explicit `''` does not fall back to the env var. `init()` reads `process.env` when called, so load env files first.
- **TypeScript:** `MonoCloudConfig` requires `domain` and `apiKey`, so `init({ config: { timeout } })` alone doesn't compile — pass all three, or set the env vars and call `init()`.
- **Secrets:** the API key administers the tenant. Keep every call server-side, read the key from env or a secret store, and never hard-code it or expose it via `NEXT_PUBLIC_` / `VITE_` variables.

## Quick start

```ts
import { MonoCloudManagementClient } from '@monocloud/management';

// Env-driven: MONOCLOUD_MANAGEMENT_DOMAIN, MONOCLOUD_MANAGEMENT_API_KEY (+ optional _TIMEOUT)
const management = MonoCloudManagementClient.init();

// Or explicit:
// MonoCloudManagementClient.init({
//   domain: process.env.MONOCLOUD_MANAGEMENT_DOMAIN!,
//   apiKey: process.env.MONOCLOUD_MANAGEMENT_API_KEY!,
//   config: { timeout: 30_000 }, // ms
// });

const { result: users, pageData } = await management.users.getAllUsers(1, 25);
for (const user of users) console.log(user.user_id);
console.log(`${pageData.total_count} users in total`);
```

`init()` is the only way to construct the client: the constructor is `private` in TypeScript, and in plain JS `new MonoCloudManagementClient()` skips the env fallbacks (with no argument it throws `Configuration is required`). Create one client at startup and reuse it.

## Resource clients

| Accessor | Class | Covers |
| --- | --- | --- |
| `users` | `UsersClient` | User lifecycle, emails/phones/username, passwords, claims, public/private data, blocked IPs, sessions, group membership, grants/tokens |
| `clients` | `ClientsClient` | Applications (OAuth/OIDC clients), their secrets and group assignments |
| `groups` | `GroupsClient` | Groups (membership is managed from `users` / `clients`) |
| `resources` | `ResourcesClient` | API resources with their secrets, scopes and access policies; identity scopes; claim resources |
| `keys` | `KeysClient` | Signing keys: list, rotate, revoke |
| `logs` | `LogsClient` | Audit / event logs (read-only) |
| `options` | `OptionsClient` | Authentication and communication options, sign-up custom fields, external identity providers |
| `branding` | `BrandingClient` | Page, email and SMS branding |
| `networkZones` | `NetworkZonesClient` | IP and regional network zones |
| `trustStores` | `TrustStoresClient` | PKI and SPIFFE (mTLS) trust stores, CRL revocations, banned certificates / SVIDs |

Methods take positional arguments only (no per-call options, headers or `AbortSignal`) and resolve to `MonoCloudResponse<T>`, or `MonoCloudPageResponse<T[]>` for paginated lists. Names follow `getAll*`, `find*` / `find*ById`, `create*`, `patch*`, `delete*`, plus actions such as `disableUser`, `rotateKey`, `setPkiTrustStoreDefault`. Full per-method signatures, return types and plan gates: [`references/api-surface.md`](references/api-surface.md).

## Response shape

```ts
class MonoCloudResponse<T> { status: number; headers: Record<string, any>; result: T } // body is .result, not .data
class MonoCloudPageResponse<T> extends MonoCloudResponse<T> { pageData: PageModel }
interface PageModel { page_size: number; current_page: number; total_count: number; has_previous: boolean; has_next: boolean }
```

- `pageData` is parsed from the `x-pagination` response header (zeros / `false` if it is missing). `headers` keys are lower-case.
- Empty responses (every `delete*`, several actions) resolve with `result === null`.
- `MonoCloudPageResponse`, `PageModel` and `ProblemDetails` are core-only and not exported from `@monocloud/management`. Rely on inference, or derive them:

```ts
import type { MonoCloudManagementClient, MonoCloudRequestException } from '@monocloud/management';

type UsersPage = Awaited<ReturnType<MonoCloudManagementClient['users']['getAllUsers']>>; // MonoCloudPageResponse<UserSummary[]>
type PageModel = UsersPage['pageData'];
type ProblemDetails = NonNullable<MonoCloudRequestException['response']>;
```

## Pagination

List methods take parent ids first, then optional `page?`, `size?` and, where supported, `filter?` (or `clientId?` / `sessionId?`) and `sort?`. Arguments left `undefined` are omitted and the server applies its defaults. Pages start at `1`. `sort` is `"<field>:1"` (ascending) or `"<field>:-1"` (descending) using the fields listed in [api-surface](references/api-surface.md#sort-fields); `filter` is a Lucene-style expression. Query values and path ids are URL-encoded by the SDK — pass raw strings.

```ts
async function* allUsers(management: MonoCloudManagementClient) {
  for (let page = 1; ; page++) {
    const { result, pageData } = await management.users.getAllUsers(page, 100);
    yield* result;
    if (!pageData.has_next) return;
  }
}
```

Six list methods are **not** paginated — they take no paging arguments and return `MonoCloudResponse<T[]>` without `pageData`: `clients.getAllApplicationSecrets`, `resources.getAllApiResourceSecrets`, `options.getAllSignUpCustomFields`, `options.getAllExternalAuthenticators`, `trustStores.getAllPkiBannedCertificates`, `trustStores.getAllSpiffeBannedSvids`.

## Common operations

```ts
import { MonoCloudNotFoundException } from '@monocloud/management';

const { result: user } = await management.users.createUser({ email: 'alice@example.com', name: 'Alice' });

// 404 → MonoCloudNotFoundException
async function userOrNull(userId: string) {
  try {
    return (await management.users.findUserById(userId)).result;
  } catch (e) {
    if (e instanceof MonoCloudNotFoundException) return null;
    throw e;
  }
}

// Partial updates: sent keys are written, omitted keys are untouched, `null` removes a key.
await management.users.patchPrivateData(user.user_id, { private_data: { plan: 'pro', trial_ends: null } });
await management.users.patchClaims(user.user_id, { given_name: 'Alice' });

await management.users.disableUser(user.user_id, { revoke_sessions: true });
await management.users.assignUserToGroup(user.user_id, groupId); // group membership lives on `users`
const { result: apps } = await management.clients.getAllApplications(1, 50, undefined, 'client_name:1');
const { result: logs } = await management.logs.getAllLogs(1, 50, undefined, 'time_stamp:-1');
```

- `.clients` methods and models say **`Application`** (`getAllApplications`, `findApplicationById(clientId)`, `PatchApplicationRequest`); the id parameter is still `clientId`.
- `ResourcesClient` takes the **child id first** in `findApiResourceSecretById(secretId, apiId)`, `findApiScopeById(scopeId, apiId)`, `patchApiScope(scopeId, apiId, body)` and `deleteApiScope(scopeId, apiId)`, but `apiId` first everywhere else (e.g. `deleteApiResourceSecret(apiId, secretId)`, all policy methods).
- Updates are `patch*` merges; no method replaces a whole resource. Identifiers are absent from the `Patch*Request` types (`audience` on API resources; `name` on API scopes, scopes and claim resources) — delete and recreate to change them.

## Errors

Every non-2xx response throws; all classes extend `MonoCloudException` (→ `Error`) and are exported from `@monocloud/management`.

| Status | Class | `errorCode` |
| --- | --- | --- |
| 400 | `MonoCloudBadRequestException` | yes |
| 401 | `MonoCloudUnauthorizedException` | — |
| 402 | `MonoCloudPaymentRequiredException` | yes |
| 403 | `MonoCloudForbiddenException` | yes |
| 404 | `MonoCloudNotFoundException` | yes |
| 409 | `MonoCloudConflictException` | yes |
| 422 | `MonoCloudIdentityValidationException` (`errors: IdentityError[]`), `MonoCloudKeyValidationException` (`errors: Record<string, string[]>`), otherwise `MonoCloudModelStateException` | — |
| 429 | `MonoCloudResourceExhaustedException` | — |
| 500 | `MonoCloudServerException` | — |
| any other status, network error, timeout | `MonoCloudException` | — |

- HTTP classes extend `MonoCloudRequestException`, whose `response?: ProblemDetails` is the parsed `application/problem+json` body (`type`, `title`, `status`, `detail`, `instance`, `error_code?`, `trace_id?`, plus any extra members). For other error bodies `.response` is `undefined` and `.message` is the body text (or status text).
- There is no `statusCode` property; branch with `instanceof`. 502/503/504 are plain `MonoCloudException`, not `MonoCloudServerException`.
- `errorCode` (= `response?.error_code`) exists only on the 400/402/403/404/409 classes and may be `undefined`. Codes are opaque API strings — the SDK has no enum of them; never invent values. Log `response?.trace_id` for support requests.
- Network, DNS and TLS failures and unparsable responses become `MonoCloudException('Something went wrong.')`; a timeout becomes a `MonoCloudException` carrying the runtime's abort message (Node: `The operation was aborted due to timeout`). The original error is not attached, and the SDK never retries.

```ts
import {
  MonoCloudConflictException,
  MonoCloudException,
  MonoCloudIdentityValidationException,
  MonoCloudRequestException,
} from '@monocloud/management';

try {
  await management.users.createUser(body);
} catch (e) {
  if (e instanceof MonoCloudConflictException) return { status: 409, code: e.errorCode };
  if (e instanceof MonoCloudIdentityValidationException) return { status: 422, errors: e.errors }; // [{ code, description }]
  if (e instanceof MonoCloudRequestException) {
    logger.error({ status: e.response?.status, code: e.response?.error_code, traceId: e.response?.trace_id }, e.message);
  } else if (e instanceof MonoCloudException) {
    logger.error(e.message); // timeout, network failure, unmapped status
  }
  throw e;
}
```

## Subscription plans

Plan gates are enforced by the server, not the SDK; the source marks them with `@note` JSDoc tags (visible in IntelliSense). A gated call or request field on a lower plan is rejected — handle both `MonoCloudForbiddenException` (403) and `MonoCloudPaymentRequiredException` (402), and surface `response?.detail` / `errorCode`.

| Plan | Gated methods |
| --- | --- |
| Pro | `groups.createGroup` beyond two groups; `users.getAllUserSessions` / `findUserSession` / `revokeUserSession`; `users.getAllUserClientGrants` |
| Secure+ | `users.getAllUserConsents` / `getAllReferenceTokens` / `getAllRefreshTokens` / `getAllAuthorizationCodes`; `users.revokeUserClientGrants` / `revokeUserConsent` / `revokeReferenceToken` / `revokeRefreshToken` / `revokeAuthorizationCode` |
| ScaleX | `clients.assignGroupToApplication` / `removeGroupFromApplication`; `networkZones.createIpNetworkZone` / `patchIpNetworkZone` / `createRegionalNetworkZone` / `patchRegionalNetworkZone`; `resources.createApiResourceSecret` |

Request fields are gated too (consents, PAR/JAR, front-/back-channel logout, reference tokens, session binding, …): see [field-level plan gates](references/api-surface.md#field-level-plan-gates).

## Custom fetcher

`init(options?, fetcher?)` accepts `Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>`. A fetcher **replaces the whole transport**: the SDK then skips `domain` / `apiKey` validation and adds no base URL, `X-API-KEY` / `Content-Type` headers, or timeout. It is called with a path relative to `/api/` (e.g. `users?page=1&size=25`) and `{ method, body }` (`body` is a JSON string), and must return a WHATWG `Response`. Use it for retries, logging, proxies or tests — see the [example](references/api-surface.md#custom-fetcher). Errors it throws surface as `Something went wrong.` unless they are a `MonoCloudException` or named `TimeoutError`.

## Things that don't exist

- `new MonoCloudManagementClient(...)` → use `MonoCloudManagementClient.init(...)`.
- `.data`, `.Data`, `.PageData` (.NET names) → `.result` and `.pageData`.
- `clients.getAllClients()`, `logs.getLogs()`, `users.listUsers()` / `getUser()` / `updateUser()`, `MonoCloudClient`, `.managementApi` → check [api-surface](references/api-surface.md) before calling any method.
- `e.statusCode`; `errorCode` on 401/422/429/500 classes; error-code constants.
- Streaming / `subscribe` / `watch` methods (e.g. live logs): there is no public streaming API — page through `logs.getAllLogs`.
- Importing `MonoCloudPageResponse`, `PageModel`, `ProblemDetails` or `MonoCloudCodedException` from `@monocloud/management`.
- A DI registration (`AddMonoCloudManagementClient` is the .NET SDK).

## Verify an integration

```bash
node scripts/verify.js [project-dir]
```

[`scripts/verify.js`](scripts/verify.js) checks the dependency, env vars (domain format, timeout parsing, public-prefixed keys), client construction, core-only imports, client-side usage, `.data` reads, and calls to methods that don't exist on a resource client.

## References

- [`references/api-surface.md`](references/api-surface.md) — exports, every resource-client method (signature, result type, pagination, plan gate), field-level plan gates, sort fields, exception classes, custom fetcher example.
- [`references/troubleshooting.md`](references/troubleshooting.md) — symptom → cause → fix for config errors, 401/403/402/404/422/429, timeouts, `Something went wrong.`, missing `errorCode`, imports, paging, and patch surprises.
