# Troubleshooting — `@monocloud/management`

Quick reference for the most common things that go wrong when calling the MonoCloud Management API from Node.js. Each entry is **symptom → root cause → fix**.

## 401 Unauthorized on every call

**Symptom:** Every Management call throws `MonoCloudUnauthorizedException`, even read-only ones.

**Cause:** The API key is missing, wrong, or revoked. Often the env var is set in your shell but not exported to the Node process; or you have separate dev / prod keys mixed up.

**Fix:**

1. Confirm the key is reaching Node: `node -e 'console.log(process.env.MONOCLOUD_MANAGEMENT_API_KEY?.slice(0,4))'` should print the first 4 chars (not `undefined`).
2. Confirm the tenant matches the key — keys are scoped to a single tenant. A dev-tenant key against a prod-tenant `MONOCLOUD_MANAGEMENT_DOMAIN` returns 401.
3. Generate a fresh key in the MonoCloud dashboard → Settings → API Keys, paste into the env var, restart the process.

## "Cannot find module '@monocloud/management-core'"

**Symptom:** Build / runtime fails with a missing module error for `@monocloud/management-core`.

**Cause:** Application code is importing from `@monocloud/management-core` directly. That's the internal package; the public package is `@monocloud/management`.

**Fix:** Replace the import:

```ts
// wrong
import { MonoCloudException } from "@monocloud/management-core";

// right
import { MonoCloudException } from "@monocloud/management";
```

All core types (`MonoCloudConfig`, `MonoCloudResponse`, the entire exception hierarchy, `Fetcher`) are re-exported from `@monocloud/management`.

## Domain with `/api` appended

**Symptom:** Every call 404s, even though credentials are correct.

**Cause:** `MONOCLOUD_MANAGEMENT_DOMAIN` (or the `domain` option) contains `/api` or `/api/v1`. The SDK appends `/api/<resource>` internally — duplicating the prefix gives `…/api/api/users`.

**Fix:** Pass the bare tenant URL only:

```bash
# wrong
MONOCLOUD_MANAGEMENT_DOMAIN=https://acme.us.monocloud.com/api/v1

# right
MONOCLOUD_MANAGEMENT_DOMAIN=https://acme.us.monocloud.com
```

Same applies if you're passing `domain` to `MonoCloudManagementClient.init({ domain })` in code.

## API key ends up in a browser bundle

**Symptom:** Linter, secret-scanner, or runtime error flags an API key leaking to client-side code. Or you notice the value of `MONOCLOUD_MANAGEMENT_API_KEY` is visible in DevTools.

**Cause:** Management code (or its env var) was imported from a frontend route — most commonly a Next.js `app/` or `pages/` file that has both server and client paths.

**Fix:** Management keys must **only** run in server contexts. In Next.js:

- Never reference `MONOCLOUD_MANAGEMENT_API_KEY` from a Client Component or any file marked `"use client"`.
- Don't prefix the env var with `NEXT_PUBLIC_` — that's the bridge into the browser bundle.
- Keep all `MonoCloudManagementClient` calls inside Server Actions, Route Handlers, `getServerSideProps`, or a separate backend service.

If you need to expose Management functionality to the browser, build a thin server-side endpoint and authorize the user against it. Never ship the key.

## `patch*` deleting fields you didn't touch

**Symptom:** After `patchPrivateData(id, { private_data: { onboarded: true } })`, the user's other private-data fields are gone.

**Cause:** Most likely the entire `private_data` object is being replaced, not merged. `patch*` is **field-level merge**: keys you include are written; keys you omit are left alone. But the _value_ you provide replaces what was there.

**Fix:** When updating a nested object, send only the keys you want to change:

```ts
// merges onto existing private_data; leaves other keys alone
await client.users.patchPrivateData(id, {
  private_data: { onboarded: true },
});

// to clear a specific key, send it as null
await client.users.patchPrivateData(id, {
  private_data: { secret_question: null },
});
```

If you want a full **replace**, that's the `put*` endpoint (where one exists) — `patch*` semantics are always merge.

## Catching `Error` and losing status info

**Symptom:** All errors collapse into a single "something failed" branch and you can't tell 404 from 409 from 422. Or `e.statusCode` is `undefined` even though the call clearly failed with a specific status.

**Cause:** The handler is `catch (e) { ... }` against `Error`. The SDK throws a typed hierarchy, but you've discarded it. Note also that `MonoCloudException` itself has no `statusCode` property — only `Error.message`. Status information is only available either via `instanceof` against the specific subclass (`MonoCloudNotFoundException`, etc.) or via `(e as MonoCloudRequestException).response?.status` when the server returned `application/problem+json`.

**Fix:** Catch the specific subclasses you care about, fall through to `MonoCloudRequestException` for the problem-details payload, then `MonoCloudException` as the absolute base, then re-throw or log:

```ts
import {
  MonoCloudNotFoundException,
  MonoCloudConflictException,
  MonoCloudIdentityValidationException,
  MonoCloudRequestException,
  MonoCloudException,
} from "@monocloud/management";

try {
  await client.users.createUser(req);
} catch (e) {
  if (e instanceof MonoCloudConflictException) return "duplicate";
  if (e instanceof MonoCloudIdentityValidationException)
    return { errors: e.errors };
  if (e instanceof MonoCloudNotFoundException) return null;
  if (e instanceof MonoCloudRequestException) {
    // .response is the parsed application/problem+json payload (when present).
    logger.error({ status: e.response?.status, title: e.response?.title }, "Management call failed");
  } else if (e instanceof MonoCloudException) {
    logger.error({ message: e.message }, "Management call failed (network/timeout/parse)");
  }
  throw e;
}
```

## Only the first page of results

**Symptom:** `getAllUsers()` returns ~10 results when you know there are hundreds.

**Cause:** `getAll*` returns the **first page** by default (`size` defaults to a small number, often 10). You need to loop using `pageData.has_next`.

**Fix:**

```ts
let page = 1;
while (true) {
  const { result, pageData } = await client.users.getAllUsers(page, 100);
  for (const u of result) yield u;
  if (!pageData.has_next) break;
  page += 1;
}
```

Tune `size` to balance round-trips against per-call payload size.

## `timeout` interpreted wrong

**Symptom:** Calls time out long before / long after the value you set.

**Cause:** `config.timeout` is in **milliseconds**. People reach for seconds out of habit.

**Fix:** Pass milliseconds:

```ts
MonoCloudManagementClient.init({
  config: { timeout: 30_000 }, // 30 seconds
});
```

Same applies if you're reading the timeout from `MONOCLOUD_MANAGEMENT_TIMEOUT` — set it to a millisecond value.

## "Older training-data SDK ghosts"

**Symptom:** Code references `MonoCloudClient` (singular), a `.managementApi` property, or method names like `listUsers` / `getUsers`. These don't exist.

**Cause:** The agent is pattern-matching against a different or imagined SDK from training data.

**Fix:** Always check the actual surface in [`api-surface.md`](api-surface.md). The real entry point is `MonoCloudManagementClient.init(...)`; resource clients hang off it (`.users`, `.clients`, `.groups`, etc.) and method names use the SDK's convention (`getAllUsers`, `findUserById`, `createUser`, `patchPrivateData`, `disableUser`).

## Diagnostic

```bash
node skills/monocloud-management-js/scripts/verify.js [project-dir]
```

Checks `@monocloud/management` is in `package.json`, env vars are set, the domain doesn't contain `/api`, and warns if the project also has a frontend framework (where the key must never be referenced).
