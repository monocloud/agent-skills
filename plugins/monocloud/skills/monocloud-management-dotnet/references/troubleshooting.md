# Troubleshooting — `MonoCloud.Management`

Quick reference for the most common issues calling the MonoCloud Management API from .NET, grounded in `MonoCloud.Management@0.2.11`. Each entry is **symptom → root cause → fix**.

## 401 Unauthorized on every call

**Symptom:** Every Management call throws `MonoCloudUnauthorizedException`, even read-only ones like `Users.GetAllUsersAsync`.

**Cause:** The `X-API-KEY` header isn't reaching the server, or the key belongs to a different tenant than `MonoCloud:Management:Domain`. The SDK sends the configured `ApiKey` as the `X-API-KEY` request header; a missing/invalid key yields HTTP 401, which the SDK maps to `MonoCloudUnauthorizedException`.

**Fix:**

1. Confirm the key is bound: in `Program.cs`, log the first few chars of `builder.Configuration["MonoCloud:Management:ApiKey"]` once at startup. If null, the binding is wrong.
2. Common binding failures: wrong section name (`MonoCloud:Management` vs `MonoCloudManagement`), or the secret lives in User Secrets for a different project (User Secrets keys to the `<UserSecretsId>` in the `.csproj`).
3. Keys are tenant-scoped. A dev-tenant key against the prod `Domain` returns 401. Confirm the key and `Domain` belong to the same tenant.

## `MonoCloudException` at startup mentioning `Domain` or `ApiKey`

**Symptom:** App fails to start or the first `new MonoCloudManagementClient(config)` throws a `MonoCloudException` such as *the domain has not been set* / *the api key has not been set*. Via DI, `AddMonoCloudManagementClient` throws `ArgumentNullException`.

**Cause:** `MonoCloudClientBase` validates that `MonoCloudConfig.Domain` and `MonoCloudConfig.ApiKey` are non-empty; the DI extension throws `ArgumentNullException` if either is missing/empty after merging configuration with the options action. Neither `IConfiguration` nor the `Action<MonoCloudManagementOptions>` supplied the required values.

**Fix:** Either pass `builder.Configuration` and make sure `appsettings*.json` / User Secrets / env providers supply `MonoCloud:Management:Domain` and `MonoCloud:Management:ApiKey`, or set them in code:

```csharp
builder.Services.AddMonoCloudManagementClient(options =>
{
    options.Domain = builder.Configuration["MonoCloud:Management:Domain"];
    options.ApiKey = builder.Configuration["Secrets:MonoCloudApiKey"];
});
```

When you pass both an `IConfiguration` and an options action, **options values override configuration values** where set.

## Expecting `MONOCLOUD_MANAGEMENT_*` environment variables to be read

**Symptom:** You set `MONOCLOUD_MANAGEMENT_DOMAIN` / `MONOCLOUD_MANAGEMENT_API_KEY` (as the JS SDK uses) and the .NET client still throws that `Domain`/`ApiKey` is unset.

**Cause:** The .NET SDK reads **no** environment variables of its own — there is no `MONOCLOUD_MANAGEMENT_*` fallback anywhere in `MonoCloud.Management@0.2.11` (unlike the JS SDK). Config comes only from the `MonoCloud:Management` configuration section, the `MonoCloudManagementOptions` action, or a directly-constructed `MonoCloudConfig`.

**Fix:** Feed env values through the standard .NET configuration pipeline. On Linux/CI use the ASP.NET Core double-underscore convention so the environment-variables provider maps them into the `MonoCloud:Management` section:

```
MonoCloud__Management__Domain=https://acme.us.monocloud.com
MonoCloud__Management__ApiKey=<key>
```

## API key committed to `appsettings.json`

**Symptom:** A secret scanner (GitHub Push Protection, GitLeaks, etc.) flags a real `ApiKey` value committed to `appsettings.json` or `appsettings.Production.json`.

**Cause:** The key was placed in the JSON file for convenience instead of a secret store.

**Fix:**

- **Local dev:** `dotnet user-secrets init`, then `dotnet user-secrets set "MonoCloud:Management:ApiKey" "<key>"`. User Secrets is read automatically by `IConfiguration` in Development.
- **Production:** read from your platform's secret manager (Azure Key Vault, AWS Secrets Manager, host env vars). Keep only `Domain` and `Timeout` in `appsettings.json`.
- **After the fact:** rotate the key in the MonoCloud dashboard immediately — assume the committed value is compromised.

## Management API key shipped to a client / browser / mobile app

**Symptom:** The Management key appears in a front-end bundle, a mobile binary, or any code that runs on an end-user device.

**Cause:** The `MonoCloud.Management` SDK is a **server-side admin SDK**. A Management API key is tenant-scoped with full admin permissions — it is not an end-user credential and there is no per-user scoping. Anyone who extracts it controls the whole tenant.

**Fix:** Call `MonoCloudManagementClient` only from trusted server code (an API, a background worker, an admin tool). For browser/SPA/mobile authentication use the auth SDKs (`@monocloud/auth-web-js`, `@monocloud/auth-nextjs`, or the ASP.NET Core auth packages) — never the Management key. If a key ever reached a client, rotate it.

## `Domain` with `/api` appended

**Symptom:** Every call 404s even though credentials are correct.

**Cause:** `MonoCloud:Management:Domain` contains `/api` (or `/api/v1`). Each resource client sets `BaseAddress = {Domain}/api/` itself, so a duplicated prefix produces `…/api/api/users`.

**Fix:** Pass the bare tenant URL: `https://acme.us.monocloud.com`. `MonoCloudConfig` sanitizes it (adds `https://` if missing, strips a trailing `/`) and the SDK appends `/api/<resource>`.

## `Timeout` too short for long-running admin calls

**Symptom:** Large list/export or bulk operations throw a `TaskCanceledException`/`OperationCanceledException` (surfaced through `MonoCloudException`) after ~10 seconds.

**Cause:** `MonoCloudConfig.Timeout` defaults to `TimeSpan.FromSeconds(10)` when unset, and that value is applied to the underlying `HttpClient`.

**Fix:** Raise it via whichever configuration path you use — all three collapse to the same effective timeout:

| Source | Field / property | Unit |
|---|---|---|
| `IConfiguration` | `MonoCloud:Management:Timeout` (string parsed as `int` via `int.TryParse`) | seconds |
| `Action<MonoCloudManagementOptions>` | `options.Timeout` (`TimeSpan?`) | any `TimeSpan` |
| Direct construction | `new MonoCloudConfig(domain, apiKey, TimeSpan.FromSeconds(N))` | `TimeSpan` |

For example, `"Timeout": 90` in `appsettings.json` and `options.Timeout = TimeSpan.FromSeconds(90)` both give a 90-second timeout. Prefer a per-call `CancellationToken` for finer control — every method takes a trailing `CancellationToken cancellationToken = default`.

## `new MonoCloudManagementClient(...)` inside a controller / handler

**Symptom:** Slow first request per route and occasional `SocketException` (socket exhaustion) under load.

**Cause:** A new `MonoCloudManagementClient` — and its underlying `HttpClient` — is being constructed per request. `HttpClient` instances are meant to be long-lived; that's exactly what `IHttpClientFactory` provides.

**Fix:** Register once with `AddMonoCloudManagementClient` and inject `MonoCloudManagementClient`. The DI extension registers a named `HttpClient` (`"MonoCloudManagementClient"`) and the client as **Transient** on top of `IHttpClientFactory`, so connection pooling Just Works.

```csharp
// Program.cs
builder.Services.AddMonoCloudManagementClient(builder.Configuration);

// Route handler
app.MapGet("/users", async (MonoCloudManagementClient mgmt) =>
{
    var r = await mgmt.Users.GetAllUsersAsync(1, 25);
    return Results.Ok(r.Data);
});
```

## Catching `Exception` and losing the HTTP status

**Symptom:** Errors collapse into one branch and you can't tell `NotFound` (404) from `Conflict` (409) from a validation failure (422). `ex.StatusCode` doesn't compile.

**Cause:** The handler is `catch (Exception)` against the base type, discarding the typed hierarchy. `MonoCloudException` has **no** `StatusCode` property — status lives on the specific subclass or on `MonoCloudRequestException.Response` (the parsed `ProblemDetails`, whose `Status` you can read).

**Fix:** Branch on the specific subclass, fall through to `MonoCloudRequestException` for problem-details access, then `MonoCloudException` as the base:

```csharp
try
{
    await mgmt.Users.CreateUserAsync(req);
}
catch (MonoCloudConflictException)                       // 409
{
    return Results.Conflict();
}
catch (MonoCloudIdentityValidationException ex)          // 422 identity-validation-error
{
    return Results.UnprocessableEntity(ex.Errors);       // IEnumerable<IdentityError>
}
catch (MonoCloudKeyValidationException ex)               // 422 validation-error
{
    return Results.UnprocessableEntity(ex.Errors);       // IDictionary<string, string[]>
}
catch (MonoCloudRequestException ex)                     // any other HTTP status
{
    logger.LogError(ex, "Management API call failed: {Status}", ex.Response?.Status);
    throw;
}
catch (MonoCloudException ex)                            // config / transport / deserialization
{
    logger.LogError(ex, "Management API call failed (non-HTTP)");
    throw;
}
```

The full set: `MonoCloudBadRequestException` (400), `MonoCloudUnauthorizedException` (401), `MonoCloudPaymentRequiredException` (402), `MonoCloudForbiddenException` (403), `MonoCloudNotFoundException` (404), `MonoCloudConflictException` (409), `MonoCloudIdentityValidationException` / `MonoCloudKeyValidationException` / `MonoCloudModelStateException` (422), `MonoCloudResourceExhaustedException` (429), `MonoCloudServerException` (≥ 500).

## `using MonoCloud.Management.Core` doesn't resolve

**Symptom:** Build error: `The type or namespace 'MonoCloud.Management.Core' could not be found`, or a spurious `<PackageReference>` to the core package.

**Cause:** App code adds a using/reference to the internal core package directly. Consumers reference only `MonoCloud.Management`; it pulls in `MonoCloud.Management.Core` transitively.

**Fix:** The public types live under sub-namespaces you import explicitly:

```csharp
using MonoCloud.Management;                    // client, options, DI extension
using MonoCloud.Management.Core.Base;          // MonoCloudConfig, MonoCloudResponse<T>
using MonoCloud.Management.Core.Exception;     // MonoCloud*Exception
using MonoCloud.Management.Models;             // request/response DTOs + enums
```

Remove any manual `dotnet add package MonoCloud.Management.Core`.

## Only the first page of results

**Symptom:** `GetAllUsersAsync()` returns 10 rows; the tenant has thousands.

**Cause:** The default `size` is 10 and each `GetAll*` returns one page. Paginated methods return `MonoCloudResponse<List<T>, PageModel>` — you loop on `PageData.HasNext`.

**Fix:**

```csharp
async IAsyncEnumerable<UserSummary> EachUserAsync(
    MonoCloudManagementClient mgmt,
    [EnumeratorCancellation] CancellationToken ct = default)
{
    var page = 1;
    while (true)
    {
        var response = await mgmt.Users.GetAllUsersAsync(page, 100, cancellationToken: ct);
        foreach (var u in response.Data) yield return u;
        if (!response.PageData.HasNext) yield break;
        page++;
    }
}
```

`PageModel` exposes `PageSize`, `CurrentPage`, `TotalCount`, `HasPrevious`, `HasNext` (populated from the `x-pagination` header). Note a few list endpoints are **not** paginated — `GetAllApplicationSecretsAsync`, `GetAllApiResourceSecretsAsync`, `GetAllSignUpCustomFieldsAsync`, `GetAllPkiBannedCertificatesAsync`, `GetAllSpiffeBannedSvidsAsync` return `MonoCloudResponse<List<T>>` with no `PageData`.

## Worried a `Patch*` call will clear untouched fields

**Symptom:** You avoid PATCH, or read-modify-write the whole object, for fear of wiping fields you didn't set.

**Cause:** Misunderstanding the request shape. Every property on a `Patch*Request` is `Optional<T>` (namespace `MonoCloud.Management.Core.Helpers`). A custom `PatchConverter` serializes **only** the properties you explicitly assign, so PATCH is a true partial update — unset fields are left unchanged.

**Fix:** Set only what you want to change:

```csharp
await mgmt.Clients.PatchApplicationAsync(clientId, new PatchApplicationRequest
{
    ClientName = "Renamed app"    // everything else is untouched
});
```

To *clear* a nullable field, assign it `null` explicitly (`Optional<string?>` distinguishes "set to null" from "not provided"). Assigning a property — even to an empty/default value — sends it; leaving it unassigned does not.

## Compile error: identifier field is not a member of a `Patch*Request`

**Symptom:** Code (often AI-generated from another SDK) sets `ClientId`, `Audience`, `Name`, `ZoneId`, etc. on a patch request and won't build: `'X' is not a member of 'Patch…Request'`.

**Cause:** Resource identifiers are **path-only** and are never part of the patch body — they are immutable and therefore not exposed as request properties. `PatchApplicationRequest`, for instance, has ~40 mutable `Optional<T>` fields (`Enabled`, `AppType`, `ClientName`, `RedirectUris`, token lifetimes, consent flags, …) but no `ClientId`.

**Fix:** Pass the id as the method's path argument and drop it from the body. Identifiers that are path-only include:

| Method (examples) | Path-only id(s) |
|---|---|
| `PatchApplicationAsync` | `clientId` |
| `PatchApiResourceAsync` | `apiId` |
| `PatchApiScopeAsync` | `scopeId`, `apiId` |
| `PatchScopeAsync` / `PatchClaimResourceAsync` | `scopeId` / `claimId` |
| `PatchGroupAsync` | `groupId` (`Guid`) |
| `PatchIpNetworkZoneAsync` / `PatchRegionalNetworkZoneAsync` | `zoneId` |
| `PatchPkiTrustStoreAsync` / `PatchSpiffeTrustStoreAsync` | `trustStoreId` |
| `PatchSignUpCustomFieldAsync` | `claimName` |

To change an immutable value (e.g. an API audience or a scope's `Name`), delete and recreate the resource.

## Wrong parameter order in `Resources` secret / scope methods

**Symptom:** A `Resources.*` call compiles but 404s, or you pass ids in the "obvious" order and hit the wrong resource.

**Cause:** A few `ResourcesClient` methods take the child id **before** `apiId`, unlike the create/delete siblings.

**Fix:** Copy these signatures verbatim:

- `FindApiResourceSecretByIdAsync(string secretId, string apiId, …)` — secretId first.
- `FindApiScopeByIdAsync` / `PatchApiScopeAsync` / `DeleteApiScopeAsync` — `(string scopeId, string apiId, …)` — scopeId first.
- But `CreateApiResourceSecretAsync(string apiId, …)` and `DeleteApiResourceSecretAsync(string apiId, string secretId, …)` — apiId first.

See [`api-surface.md`](api-surface.md) for the full list.

## Call rejected due to subscription tier (402 / 403)

**Symptom:** A method that exists on the typed client throws `MonoCloudForbiddenException` (403) or `MonoCloudPaymentRequiredException` (402), often mentioning a required subscription.

**Cause:** Several features are subscription-gated on the server even though the SDK surface is identical for every tenant. The client compiles and sends the request; the API rejects it based on plan.

| Feature / method | Required tier |
|---|---|
| `Groups.CreateGroupAsync` — creating **more than two** groups | Pro |
| `Users.GetAllUserSessionsAsync` / `FindUserSessionAsync` / `RevokeUserSessionAsync` | Pro |
| `Users.GetAllUserClientGrantsAsync` (grant/token info) | Pro |
| `Users.GetAllUserConsentsAsync` / `GetAllReferenceTokensAsync` / `GetAllRefreshTokensAsync` / `GetAllAuthorizationCodesAsync` | Secure+ |
| `Users.RevokeUserClientGrantsAsync` / `RevokeUserConsentAsync` / `RevokeReferenceTokenAsync` / `RevokeRefreshTokenAsync` / `RevokeAuthorizationCodeAsync` | Secure+ |
| `NetworkZones` create/patch (`CreateIpNetworkZoneAsync`, `PatchIpNetworkZoneAsync`, `CreateRegionalNetworkZoneAsync`, `PatchRegionalNetworkZoneAsync`) | ScaleX |
| `Clients.AssignGroupToApplicationAsync` / `RemoveGroupFromApplicationAsync` | ScaleX |
| `Resources.CreateApiResourceSecretAsync` | ScaleX |
| `CreateApplicationRequest.EnableConsent` / `PatchApplicationRequest.EnableConsent` (field-level) | Secure+ |

There are also **field-level** gates on otherwise-free endpoints — PAR/JAR, back-channel logout, session binding, multi-audience tokens, reference tokens, and extended refresh-token lifetimes — that may require ScaleX/Secure+. These are documented in the individual model property XML notes, not on the method.

**Fix:** Confirm the tenant's plan before wiring these features. There is no SDK-level toggle; upgrading the tenant is the only path. Catch `MonoCloudForbiddenException` / `MonoCloudPaymentRequiredException` (or read `(ex as MonoCloudRequestException)?.Response?.Detail`) and surface a clear message to operators.

## Older training-data SDK ghosts

**Symptom:** Code references types or methods that don't compile: `MonoCloudClient` (singular), `.ManagementApi`, `.ListUsersAsync(...)`, `.GetUsers(...)`, `response.Result`, `response.StatusCode`, or a `.NetworkZonesApi` property.

**Cause:** The agent is pattern-matching against a different or imagined SDK from stale training data.

**Fix:** The real surface (see [`api-surface.md`](api-surface.md)):

- Entry point is `MonoCloudManagementClient` (DI-registered or `new`-constructed with `MonoCloudConfig`).
- Resource clients are direct properties: `.Users`, `.Clients`, `.Groups`, `.Resources`, `.Keys`, `.Logs`, `.Options`, `.Branding`, `.TrustStores`, `.NetworkZones` (10 total). There is no `*Api` accessor.
- `Clients.*` methods operate on the **`Application`** model (`GetAllApplicationsAsync`, `CreateApplicationAsync`, `PatchApplicationRequest`) — there is no `Client` model.
- Methods follow `GetAll* / Find*ById / Create* / Patch* / Delete* / Enable* / Disable*` naming and always end in `Async`, with a trailing `CancellationToken`.
- Read the body via `response.Data` (not `.Result`) and the code via `response.Status` (not `.StatusCode`). API access policies live under `.Resources` (e.g. `Resources.GetAllApiAccessPoliciesAsync`), not a separate client.

## Diagnostic

```bash
node skills/monocloud-management-dotnet/scripts/verify.js /path/to/project
```

The verify script is pure Node (no .NET required) — it parses `*.csproj` for the `MonoCloud.Management` `PackageReference`, scans `appsettings*.json` for the `MonoCloud:Management` section, warns if an `ApiKey` literal is found in JSON, and checks `Program.cs` for `AddMonoCloudManagementClient`.
