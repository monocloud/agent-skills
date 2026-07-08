# Troubleshooting — `@monocloud/management`

Quick reference for the most common things that go wrong when calling the MonoCloud Management API from Node.js. Each entry is **symptom → cause → fix**. Every symbol below is grounded in `@monocloud/management@0.2.10`; the full method surface lives in [`api-surface.md`](api-surface.md).

## `init()` throws before any request is made

**Symptom:** `MonoCloudManagementClient.init(...)` throws `MonoCloudException: Tenant Domain is required` or `Api Key is required` (or `Configuration is required`) — you never even reach the network.

**Cause:** `init()` falls back to env vars when an option is omitted, then validates. If both the option and its env var are empty, it throws immediately: `domain` ← `MONOCLOUD_MANAGEMENT_DOMAIN`, `apiKey` ← `MONOCLOUD_MANAGEMENT_API_KEY`. Empty strings count as missing.

**Fix:** Ensure exactly one source supplies each value, and confirm the env vars are visible to the Node process:

```bash
node -e 'console.log(!!process.env.MONOCLOUD_MANAGEMENT_DOMAIN, !!process.env.MONOCLOUD_MANAGEMENT_API_KEY)'
# expect: true true
```

The constructor is **private** — you cannot `new MonoCloudManagementClient()`. Always use the static factory `MonoCloudManagementClient.init(options?, fetcher?)`.

## 401 Unauthorized on every call

**Symptom:** Every Management call throws `MonoCloudUnauthorizedException`, even read-only ones.

**Cause:** The API key is present but wrong, revoked, or scoped to a different tenant. The key is sent as the `X-API-KEY` header; a dev-tenant key against a prod-tenant `MONOCLOUD_MANAGEMENT_DOMAIN` returns 401.

**Fix:**

1. Confirm the key is reaching Node: `node -e 'console.log(process.env.MONOCLOUD_MANAGEMENT_API_KEY?.slice(0,4))'` should print the first 4 chars (not `undefined`).
2. Confirm the tenant matches the key — keys are scoped to a single tenant.
3. Generate a fresh key in the MonoCloud dashboard, paste it into the env var, and restart the process.

## "Cannot find module '@monocloud/management-core'"

**Symptom:** Build / runtime fails with a missing-module error for `@monocloud/management-core`.

**Cause:** Application code imports from `@monocloud/management-core` directly. That is the internal core package; the public package is `@monocloud/management`.

**Fix:** Import from the public package. The client, `MonoCloudResponse`, `MonoCloudConfig`, `Fetcher`, `IdentityError`, and the **entire exception hierarchy** are all re-exported from `@monocloud/management`:

```ts
// wrong
import { MonoCloudException } from "@monocloud/management-core";

// right
import { MonoCloudException } from "@monocloud/management";
```

## `MonoCloudPageResponse` / `PageModel` cannot be imported from the package root

**Symptom:** `import { MonoCloudPageResponse } from "@monocloud/management"` (or `PageModel`, or `ProblemDetails`) resolves to `undefined` / a type error — even though these names appear in method return-type signatures.

**Cause:** These types live in `@monocloud/management-core` and are **not** re-exported from the `@monocloud/management` barrel. Only `MonoCloudResponse` and the exception/config/`Fetcher`/`IdentityError` symbols are surfaced at the root.

**Fix:** Don't name the paginated envelope explicitly — let inference do it, or destructure the fields you need:

```ts
// no explicit type needed; the method return type carries it
const { result, pageData } = await client.users.getAllUsers(1, 50);
//      ^ UserSummary[]     ^ PageModel  (page_size, current_page, total_count, has_previous, has_next)
```

If you genuinely need the named type in an annotation, import it from `@monocloud/management-core` — but inference is almost always enough.

## Domain with `/api` appended

**Symptom:** Every call 404s even though credentials are correct.

**Cause:** `MONOCLOUD_MANAGEMENT_DOMAIN` (or the `domain` option) contains `/api` or `/api/v1`. The SDK sanitizes the domain (prepends `https://` if missing, strips a trailing `/`) and then appends `/api/` itself — a duplicated prefix yields `…/api/api/users`.

**Fix:** Pass the bare tenant host only:

```bash
# wrong
MONOCLOUD_MANAGEMENT_DOMAIN=https://acme.us.monocloud.com/api/v1

# right — with or without the scheme, both work
MONOCLOUD_MANAGEMENT_DOMAIN=acme.us.monocloud.com
```

Same applies when passing `domain` to `MonoCloudManagementClient.init({ domain })` in code.

## API key ends up in a browser bundle

**Symptom:** A secret-scanner or linter flags the API key leaking to client code, or you see the value of `MONOCLOUD_MANAGEMENT_API_KEY` in DevTools.

**Cause:** Management code (or its env var) was imported from a browser-shipped path. The Management SDK holds a **tenant-admin** key and is server-only.

**Fix:** Keep every `MonoCloudManagementClient` call in a server context:

- Never reference `MONOCLOUD_MANAGEMENT_API_KEY` from a `"use client"` component or any browser-bundled module.
- Never prefix the env var with `NEXT_PUBLIC_` / `VITE_` — that is the bridge into the client bundle.
- In Next.js keep calls inside Server Actions, Route Handlers, or `getServerSideProps`; elsewhere put them behind a backend endpoint that authorizes the user first.

## `patch*` deleting fields you didn't touch

**Symptom:** After `patchPrivateData(id, { private_data: { onboarded: true } })`, the user's other private-data fields are gone.

**Cause:** The whole nested object was replaced rather than merged. Every update method on this SDK is a `patch*` (partial merge) — there are **no** PUT / full-replace methods on the public surface. Top-level keys you include are written and keys you omit are left alone, but the *value* you supply replaces the previous value for that key.

**Fix:** Send only the keys you intend to change; to clear one, send it as `null`:

```ts
// merges onto existing private_data; leaves other keys alone
await client.users.patchPrivateData(id, { private_data: { onboarded: true } });

// clear a single key
await client.users.patchPrivateData(id, { private_data: { secret_question: null } });
```

## Catching `Error` and losing status info

**Symptom:** Every failure collapses into one generic branch and you can't tell 404 from 409 from 422. Or `e.statusCode` is `undefined` even though the call clearly failed with a specific status.

**Cause:** The handler catches bare `Error`. The SDK throws a typed hierarchy, but the type was discarded. Note there is **no** `statusCode` property on any of these exceptions — the base `MonoCloudException` extends `Error` and only carries `.message`. Status information comes from either an `instanceof` check against the specific subclass or from `(e as MonoCloudRequestException).response?.status` (the parsed `application/problem+json` body).

The full mapping (status → class), all extending `MonoCloudRequestException` except the base:

| Status | Exception |
| --- | --- |
| 400 | `MonoCloudBadRequestException` |
| 401 | `MonoCloudUnauthorizedException` |
| 402 | `MonoCloudPaymentRequiredException` |
| 403 | `MonoCloudForbiddenException` |
| 404 | `MonoCloudNotFoundException` |
| 409 | `MonoCloudConflictException` |
| 422 | `MonoCloudIdentityValidationException` / `MonoCloudKeyValidationException` / `MonoCloudModelStateException` |
| 429 | `MonoCloudResourceExhaustedException` |
| 500 | `MonoCloudServerException` |
| config / timeout / unknown | `MonoCloudException` (base) |

The two validation subclasses additionally expose `.errors: IdentityError[]`. All request exceptions expose `.response?` (fields `status`, `title`, `detail`, `type`, `instance`).

**Fix:** Branch on the specific subclasses, fall through to `MonoCloudRequestException` for the problem-details payload, then `MonoCloudException` as the absolute base:

```ts
import {
  MonoCloudConflictException,
  MonoCloudIdentityValidationException,
  MonoCloudNotFoundException,
  MonoCloudRequestException,
  MonoCloudException,
} from "@monocloud/management";

try {
  await client.users.createUser(req);
} catch (e) {
  if (e instanceof MonoCloudConflictException) return "duplicate";
  if (e instanceof MonoCloudIdentityValidationException) return { errors: e.errors };
  if (e instanceof MonoCloudNotFoundException) return null;
  if (e instanceof MonoCloudRequestException) {
    // .response is the parsed problem+json body (when the server sent one)
    logger.error({ status: e.response?.status, title: e.response?.title }, "Management call failed");
  } else if (e instanceof MonoCloudException) {
    // config error, timeout, or "Something went wrong." (network/parse)
    logger.error({ message: e.message }, "Management call failed (no HTTP response)");
  }
  throw e;
}
```

## Only the first page of results

**Symptom:** `getAllUsers()` returns a small slice when you know there are far more records.

**Cause:** `getAll*` methods return **one page**. `page`/`size` have no client-side defaults — when omitted they are dropped from the query string and the server applies its own (small) page size. You have to iterate using `pageData.has_next`.

**Fix:**

```ts
let page = 1;
for (;;) {
  const { result, pageData } = await client.users.getAllUsers(page, 100);
  for (const u of result) handle(u);
  if (!pageData.has_next) break;
  page += 1;
}
```

Note a handful of list methods are **non-paginated** and return `MonoCloudResponse<T[]>` (no `pageData`): `clients.getAllApplicationSecrets`, `resources.getAllApiResourceSecrets`, `options.getAllSignUpCustomFields`, `trustStores.getAllPkiBannedCertificates`, `trustStores.getAllSpiffeBannedSvids`. Don't reach for `pageData` on those.

## Reading `.data` instead of `.result`

**Symptom:** `res.data` is `undefined`; TypeScript reports no `data` property on `MonoCloudResponse`.

**Cause:** `.data` / `.pageData` are the **.NET** SDK's field names. In the JS/TS SDK the deserialized body is on `.result`, and `MonoCloudResponse` also carries `.status` and `.headers`. Empty responses (e.g. `deleteUser`) resolve to `MonoCloudResponse<null>` with `result === null`.

**Fix:**

```ts
const res = await client.users.findUserById(id);
res.result;   // User        (not res.data)
res.status;   // number
res.headers;  // Record<string, any>
```

## `timeout` interpreted wrong / not applied

**Symptom:** Calls abort long before / after the value you set, or your `MONOCLOUD_MANAGEMENT_TIMEOUT` seems ignored.

**Cause:** Two things. First, `config.timeout` is in **milliseconds** (default `10000`), and people reach for seconds out of habit. Second, `init()`'s env-var wiring uses a quirky ternary, so `MONOCLOUD_MANAGEMENT_TIMEOUT` doesn't reliably reach the fetcher.

**Fix:** Pass the timeout explicitly in `options.config`, in milliseconds:

```ts
MonoCloudManagementClient.init({ config: { timeout: 30_000 } }); // 30s
```

A timeout surfaces as a base `MonoCloudException` (there is no dedicated timeout class); the underlying error's `name === 'TimeoutError'` and its message is forwarded.

## TypeScript error: identifier field not on a `Patch…Request`

**Symptom:** A patch call fails type-checking on a field like `audience` (`PatchApiResourceRequest`) or `name` (`PatchApiScopeRequest`, `PatchScopeRequest`, `PatchClaimResourceRequest`) — "Object literal may only specify known properties".

**Cause:** Those identifier fields are simply **not part of the `Patch…Request` interfaces** in this SDK — you cannot change them via a patch. In v0.2.10, for example, `PatchApiResourceRequest` exposes `display_name` and `allow_multi_audience` but no `audience`, and the scope/claim patch types expose `display_name` but no `name`. Older code (or stale training data) treats them as updatable.

**Fix:** Drop the identifier from the patch body and send only mutable fields:

```ts
// ❌ does not compile — `name` is not a patchable field
await client.resources.patchApiScope(scopeId, apiId, { name: "new-name", display_name: "New" });

// ✅ patch mutable fields only
await client.resources.patchApiScope(scopeId, apiId, { display_name: "New" });
```

To change an immutable identifier, delete and recreate the resource. Which specific fields are patchable is defined by each `Patch…Request` type — trust the type, and consult <https://www.monocloud.com/docs> rather than assuming a field is settable.

## Call rejected because of the subscription tier (402)

**Symptom:** A method that exists on the typed client — `networkZones.createIpNetworkZone`, `users.getAllUserConsents`, `groups.createGroup`, etc. — throws `MonoCloudPaymentRequiredException`. Or setting a gated property (e.g. a consent field on `PatchApplicationRequest`) is rejected.

**Cause:** Many features are subscription-tier-gated even though the SDK surface is identical for every tenant. The server enforces the gate with HTTP **402**, which the SDK maps to `MonoCloudPaymentRequiredException`. There is no client-side enforcement and no env-var override.

**Method-level gates:**

| Tier | Gated methods |
| --- | --- |
| ScaleX | `clients.assignGroupToApplication` / `removeGroupFromApplication`; `networkZones.createIpNetworkZone` / `patchIpNetworkZone` / `createRegionalNetworkZone` / `patchRegionalNetworkZone`; `resources.createApiResourceSecret` |
| Pro | `groups.createGroup` (only beyond two groups); `users.getAllUserSessions` / `findUserSession` / `revokeUserSession`; `users.getAllUserClientGrants` |
| Secure+ | `users.getAllUserConsents` / `getAllReferenceTokens` / `getAllRefreshTokens` / `getAllAuthorizationCodes` and the matching `revoke*` methods |

**Field-level gates** (properties you may set in create/patch requests): Secure+ covers consents, JWT request objects (JAR), Pushed Authorization Requests (PAR), back-channel logout; Pro covers authenticator restrictions, front-channel logout, sign-up restrictions; ScaleX covers UserInfo access, multi-audience tokens, long refresh-token lifetimes, API secret generation, reference tokens, and session binding.

**Fix:** Confirm the tenant's tier before wiring these features. Catch `MonoCloudPaymentRequiredException` (or read `.response?.detail`) and surface a clear upgrade message — the only remedy is upgrading the plan.

## Older training-data SDK ghosts

**Symptom:** Code references `MonoCloudClient` (singular), a `.managementApi` property, `new MonoCloudManagementClient(...)`, or method names like `listUsers` / `getUsers`. None of these exist.

**Cause:** The agent is pattern-matching a different or imagined SDK.

**Fix:** The real entry point is the static factory `MonoCloudManagementClient.init(...)`; ten resource clients hang off it — `branding`, `clients`, `groups`, `keys`, `logs`, `networkZones`, `options`, `resources`, `trustStores`, `users` (both `networkZones` and `trustStores` are camelCase). Method names follow the SDK convention (`getAllUsers`, `findUserById`, `createUser`, `patchPrivateData`, `disableUser`, `createIpNetworkZone`). Watch two naming quirks: the `clients` accessor / `ClientsClient` uses **`Application`** models and methods (`getAllApplications`, `createApplication`, `PatchApplicationRequest`) while the path param stays `clientId`; and several `ResourcesClient` secret/scope methods take the **child id first** (`findApiScopeById(scopeId, apiId)`, `patchApiScope(scopeId, apiId, body)`, `findApiResourceSecretById(secretId, apiId)`). Check [`api-surface.md`](api-surface.md) before writing a call.

## Diagnostic

```bash
node skills/monocloud-management-js/scripts/verify.js [project-dir]
```

Checks that `@monocloud/management` is in `package.json`, that the env vars are set, that `MONOCLOUD_MANAGEMENT_DOMAIN` doesn't contain `/api`, and that `MONOCLOUD_MANAGEMENT_TIMEOUT` (if set) is a positive integer. It also warns when a browser/auth SDK or frontend framework is present (the admin key must stay server-side) and when source reads `.data` instead of `.result`.
