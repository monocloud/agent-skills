# Troubleshooting — `@monocloud/management`

Symptom → cause → fix. Exception classes and handling are in [`SKILL.md` → Errors](../SKILL.md#errors); every method signature is in [`api-surface.md`](api-surface.md).

## `init()` throws `Tenant Domain is required` / `Api Key is required`

**Cause:** when `init()` ran, the option was `undefined` and its env var (`MONOCLOUD_MANAGEMENT_DOMAIN` / `MONOCLOUD_MANAGEMENT_API_KEY`) was empty. Usually the client is created at import time, before `dotenv` (or the framework) loads the env file; or the variable exists only in another environment. An explicit `domain: ''` never falls back to the env var.

**Fix:** load env before creating the client (`import 'dotenv/config'` first in the entry point) or create it lazily on first use, and log `Boolean(process.env.MONOCLOUD_MANAGEMENT_DOMAIN)` just before `init()` to confirm. `Configuration is required` means plain-JS `new MonoCloudManagementClient()` — use `init()`.

## Every call throws `MonoCloudException: Something went wrong.`

**Cause:** no usable HTTP response reached the SDK, and it discards the original error. Typical reasons: DNS / TLS / connection failure or a blocking proxy; a domain with another scheme (only a lowercase `https://` prefix is recognized, so `http://acme…` is requested as `https://http//acme…`); Node < 18 without global `fetch` / `AbortSignal.timeout`; a negative or `NaN` `config.timeout`; a 2xx body that isn't JSON; or a custom fetcher that throws.

**Fix:** set the domain to `acme.us.monocloud.com` or `https://acme.us.monocloud.com`, check reachability with `curl -H "X-API-KEY: $MONOCLOUD_MANAGEMENT_API_KEY" "https://<tenant-host>/api/users?size=1"`, and to see the underlying error, temporarily pass a [custom fetcher](api-surface.md#custom-fetcher) that logs before rethrowing.

## Every call throws `MonoCloudNotFoundException` (404)

**Cause:** the domain includes a path such as `/api` or `/api/v1`; the SDK appends `/api/` itself, producing `…/api/api/users`.

**Fix:** use the bare tenant host. A 404 from a single `find*` / `patch*` / `delete*` call usually means a wrong id instead — e.g. `user.id` (the field is `user_id`) or transposed `ResourcesClient` ids (`findApiScopeById(scopeId, apiId)` takes the child id first).

## Every call throws `MonoCloudUnauthorizedException` (401)

**Cause:** the `X-API-KEY` header is wrong, revoked, belongs to another tenant than `domain`, or is missing because a custom fetcher doesn't set it.

**Fix:** generate a key for this tenant in the MonoCloud dashboard, update the env var, and restart the process.

## `MonoCloudForbiddenException` (403) or `MonoCloudPaymentRequiredException` (402) on specific calls

**Cause:** the method, or a field you set, requires a higher plan ([method gates](../SKILL.md#subscription-plans), [field gates](api-surface.md#field-level-plan-gates)), or the API key isn't allowed to perform the operation. The SDK has no client-side check; the server rejects the request.

**Fix:** read `e.errorCode` and `e.response?.detail`, then upgrade the plan, use a permitted key, or remove the gated field. Handle both classes when you surface "upgrade required" messages.

## 422 validation errors

- `MonoCloudIdentityValidationException`: `e.errors` is `{ code, description }[]` from the identity system.
- `MonoCloudKeyValidationException`: `e.errors` is `Record<string, string[]>`, keyed by request field.
- `MonoCloudModelStateException`: any other 422; details are in `e.response?.detail` (or `e.message` when the body isn't problem+json).

Map `errors` to your inputs rather than string-matching `e.message` (which embeds them as JSON). For user migrations, `CreateUserRequest` accepts `password_hash` + `password_hash_algorithm` and the `skip_password_policy_checks`, `skip_identifier_restriction_checks` and `skip_conformance_checks` flags.

## `MonoCloudResourceExhaustedException` (429)

**Cause:** rate limited. The SDK never retries, and exceptions don't expose response headers such as `Retry-After`.

**Fix:** back off and retry in your code, or retry inside a custom fetcher ([example](api-surface.md#custom-fetcher)); fetch larger pages instead of many small calls.

## Timeouts fire too early, too late, or the env var is ignored

- `config.timeout` and `MONOCLOUD_MANAGEMENT_TIMEOUT` are **milliseconds** (default `10000`): `30` means 30 ms.
- The env var applies only when `options.config` is omitted, and is read with `parseInt(value, 10)`: `30s` → 30 ms, `0` / `abc` → ignored (10000 ms).
- `config.timeout: 0` aborts every request — there is no "disable timeout" value; use a large number.
- In TypeScript, `init({ config: { timeout } })` without `domain` and `apiKey` doesn't compile; pass all three or use the env var.
- A timeout throws a base `MonoCloudException` (not a `MonoCloudRequestException`) with the runtime's abort message (Node: `The operation was aborted due to timeout`); there is no timeout class.

## `errorCode` is `undefined` or doesn't type-check

**Cause:** only the 400/402/403/404/409 classes have `errorCode` — not 401/422/429/500, and not a variable typed `MonoCloudRequestException` / `MonoCloudException`. On those classes it is `undefined` when the server sent no code or the body wasn't `application/problem+json` (`.response` is then `undefined` too).

**Fix:** narrow to a concrete class with `instanceof` and treat the code as optional, or read `e.response?.error_code` generically. The SDK ships no list of codes: compare only against codes you have observed or that MonoCloud documents.

## Import errors for `MonoCloudPageResponse`, `PageModel`, `ProblemDetails`, `MonoCloudCodedException` or `@monocloud/management-core`

**Symptom:** `Module '"@monocloud/management"' has no exported member …`, an ESM "does not provide an export named" error, or `Cannot find module '@monocloud/management-core'`.

**Cause:** these types are core-only, and the core package is an internal dependency that strict installs (e.g. pnpm) don't expose to app code.

**Fix:** import only from `@monocloud/management` and derive the types from method return types ([snippet](../SKILL.md#response-shape)); for coded errors use the concrete classes or `e.response?.error_code`.

## Only one page of results

`getAll*` methods return a single page — loop until `pageData.has_next` is `false` ([loop](../SKILL.md#pagination)). Six list methods are not paginated and have no `pageData`. A `pageData` of zeros means the response carried no `x-pagination` header (e.g. a custom fetcher or proxy dropped it).

## `res.data` is `undefined`

The body is on `.result` (and paging info on `.pageData`); `.Data` / `.PageData` belong to the .NET SDK. Empty responses resolve with `result === null`.

## Patch calls don't do what you expected

- **TypeScript rejects `audience` or `name`** ("Object literal may only specify known properties"): identifiers aren't part of `PatchApiResourceRequest`, `PatchApiScopeRequest`, `PatchScopeRequest` or `PatchClaimResourceRequest`. Delete and recreate to change them.
- **Value unchanged:** only keys present in the body are written; `undefined` keys are dropped when the body is serialized.
- **Value removed:** sending `null` for a key (e.g. inside `private_data`) removes it.
- **Built-in claim can't be patched:** `patchClaimResource` only modifies custom claims.

## The management API key reaches the browser

**Cause:** management code or its env var is imported into a client bundle.

**Fix:** call the SDK only from server code (route handlers, server actions, backend services); never import it in a `"use client"` module, and never prefix the variable with `NEXT_PUBLIC_` / `VITE_`. Rotate any key that has shipped to a browser.

## Code calls methods or classes that don't exist

`MonoCloudClient`, `.managementApi`, `users.listUsers()` / `getUser()` / `updateUser()`, `clients.getAllClients()`, `logs.getLogs()`, `stream*` / `subscribe*` / `watch*` methods — none exist. The entry point is `MonoCloudManagementClient.init()`; the `clients` accessor uses `Application` names; there is no public streaming API. Look methods up in [`api-surface.md`](api-surface.md); the diagnostic below flags unknown resource-client calls.

## Diagnostic

```bash
node scripts/verify.js [project-dir]
```

Run from the skill directory ([`scripts/verify.js`](../scripts/verify.js)). It checks the dependency, required env vars, the domain format, `MONOCLOUD_MANAGEMENT_TIMEOUT` parsing, public-prefixed or client-side use of the key, `new MonoCloudManagementClient(…)`, core-only imports, `.data` / `.PageData` reads, and calls to methods that don't exist on a resource client.
