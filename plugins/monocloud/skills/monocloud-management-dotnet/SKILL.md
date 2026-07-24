---
name: monocloud-management-dotnet
description: Use when calling the MonoCloud Management API from .NET — installing or configuring the `MonoCloud.Management` NuGet package, constructing `MonoCloudManagementClient` (direct or via DI with `AddMonoCloudManagementClient`), calling resource clients (`Users`, `Clients`, `Groups`, `Resources`, `Keys`, `Logs`, `NetworkZones`, `Options`, `Branding`, `TrustStores`) — including PKI/SPIFFE (mTLS) trust stores, external identity providers, network zones, and API access policies — reading `MonoCloudResponse<T>.Data` (and `PageData`/`PageModel` for paginated lists), catching `MonoCloudException` subclasses (`MonoCloudUnauthorizedException`, `MonoCloudForbiddenException`, `MonoCloudNotFoundException`, `MonoCloudIdentityValidationException`), or troubleshooting `MonoCloud:Management:Domain` / `MonoCloud:Management:ApiKey` / `Timeout` / 401 / 403 / 422 validation errors.
license: MIT
---

# MonoCloud Management .NET SDK (`MonoCloud.Management`)

Typed .NET SDK for the MonoCloud Management API. Use it to programmatically manage users, applications, groups, API resources, sign-in options, branding, logs, signing keys, network zones, and PKI/SPIFFE trust stores from .NET (Framework 4.6.2+, .NET Standard 2.0, or modern .NET).

## Package identity — read this first

**Use:** the `MonoCloud.Management` NuGet package. Check `*.csproj` / `packages.config` before writing code — confirm the `<PackageReference Include="MonoCloud.Management" ... />` is present and note its version.

This is **not** the same as:

- `MonoCloud.AspNetCore.Authentication` / any auth middleware (user-facing OIDC sign-in — outside this skill).
- `MonoCloud.Management.Core` — the internal core package that `MonoCloud.Management` depends on. Do **not** add a project/package reference to it directly; app code depends only on `MonoCloud.Management`.

Stale-training-data guards — none of these exist in this SDK; do not emit them:

- There is **no** `MonoCloudManagementApi`, `ManagementApiClient`, or `ApiClient` entry type. The entry type is `MonoCloudManagementClient`.
- Response bodies are read from `.Data`, **not** `.Result`, `.Body`, or `.Value`. Status is `.Status`, **not** `.StatusCode`.
- The SDK reads **no** environment variables of its own (no `MONOCLOUD_MANAGEMENT_*` fallback). Config flows through `IConfiguration` / options only.

## Installation

```bash
dotnet add package MonoCloud.Management
```

```powershell
Install-Package MonoCloud.Management
```

Supported targets: **`.NET Framework 4.6.2+`**, **`.NET Standard 2.0`**, and any modern **`.NET 6.0+`** that consumes netstandard2.0.

## Authentication — Management API key

A **Management API key** (generated in the MonoCloud dashboard → Settings → API Keys) is required. It is tenant-scoped with full admin permissions — treat it like a root credential:

- Never check it into source control.
- Read it from `IConfiguration` (`appsettings.json` + environment variables / User Secrets / Key Vault / etc.).

The SDK authenticates by sending the key in the `X-API-KEY` request header. It sets `BaseAddress` to `{Domain}/api/` under the hood.

## Environment variables and configuration keys

The .NET SDK (v0.2.11) reads configuration from the **`MonoCloud:Management`** section of `IConfiguration` — it does **not** read process environment variables on its own. You can still surface env vars through the standard ASP.NET Core configuration mapping (double-underscore).

| Config key                     | Env-var form (ASP.NET Core)      | Required | Purpose                                             |
| ------------------------------ | -------------------------------- | -------- | --------------------------------------------------- |
| `MonoCloud:Management:Domain`  | `MonoCloud__Management__Domain`  | yes      | Tenant URL, e.g. `https://acme.us.monocloud.com`    |
| `MonoCloud:Management:ApiKey`  | `MonoCloud__Management__ApiKey`  | yes      | Management API key                                  |
| `MonoCloud:Management:Timeout` | `MonoCloud__Management__Timeout` | no       | Request timeout in **seconds** (default `10`)       |

`Domain` is sanitized on construction: a missing `https://` prefix is added and a trailing `/` is stripped. Store the API key in User Secrets locally (`dotnet user-secrets set "MonoCloud:Management:ApiKey" "..."`) and a secret manager in production — never in a shipped `appsettings.json`.

## Quick start — DI (recommended)

`appsettings.Development.json` (API key comes from User Secrets, not this file):

```json
{
  "MonoCloud": {
    "Management": {
      "Domain": "https://your-tenant.us.monocloud.com",
      "Timeout": "30"
    }
  }
}
```

`Program.cs`:

```csharp
using MonoCloud.Management;

var builder = WebApplication.CreateBuilder(args);

// Reads the MonoCloud:Management section from IConfiguration.
builder.Services.AddMonoCloudManagementClient(builder.Configuration);

var app = builder.Build();

app.MapGet("/users", async (MonoCloudManagementClient management) =>
{
    var response = await management.Users.GetAllUsersAsync(page: 1, size: 25);
    return Results.Ok(response.Data);   // response.Data is List<UserSummary>
});

app.Run();
```

Inject `MonoCloudManagementClient` wherever you need it. `AddMonoCloudManagementClient` registers it as **transient**, backed by a named `IHttpClientFactory` client (`"MonoCloudManagementClient"`), so pooling/retries/policies layer cleanly on top.

### Mixing DI options with code

`AddMonoCloudManagementClient` also accepts an `Action<MonoCloudManagementOptions>` — alone, or alongside `IConfiguration`. When both are supplied, **the options action wins** for any value it sets. Registration throws `ArgumentNullException` if `Domain` or `ApiKey` is empty after merging.

```csharp
builder.Services.AddMonoCloudManagementClient(builder.Configuration, options =>
{
    options.ApiKey = builder.Configuration["Secrets:MonoCloudApiKey"];
    options.Timeout = TimeSpan.FromSeconds(60);
});
```

`MonoCloudManagementOptions` is `{ string? Domain; string? ApiKey; TimeSpan? Timeout; }`.

## Quick start — direct construction

For console apps, background workers, or scenarios without DI:

```csharp
using MonoCloud.Management;
using MonoCloud.Management.Core.Base;   // MonoCloudConfig

var config = new MonoCloudConfig(
    domain: "https://your-tenant.us.monocloud.com",
    apiKey: "your-management-api-key",
    timeout: TimeSpan.FromSeconds(30)   // optional; defaults to 10s
);

var management = new MonoCloudManagementClient(config);
var response = await management.Users.GetAllUsersAsync(1, 25);
```

`MonoCloudConfig` just carries `Domain`, `ApiKey`, and `Timeout` — it does **not** validate on its own. The non-empty `Domain`/`ApiKey` check runs when the **client** is built (in `MonoCloudClientBase`), so a bad config throws `MonoCloudException` (`Tenant Domain is required` / `API Key is required`) at `new MonoCloudManagementClient(config)`, not at `new MonoCloudConfig(...)`.

`MonoCloudManagementClient` also accepts a pre-built `HttpClient` — useful for integration tests and custom HTTP pipelines (see [DI registration and HTTP-layer replacement](#di-registration-and-http-layer-replacement)):

```csharp
var http = new HttpClient { BaseAddress = new Uri("https://example.com/api/") };
http.DefaultRequestHeaders.Add("X-API-KEY", "test-key");
var management = new MonoCloudManagementClient(http);
```

## Client surface

`MonoCloudManagementClient` exposes 10 resource-client properties:

| Property        | Resource area                                                              | Backing type         |
| --------------- | -------------------------------------------------------------------------- | -------------------- |
| `.Users`        | Users: CRUD, identifiers, passwords, passkeys, claims, sessions, grants    | `UsersClient`        |
| `.Clients`      | OAuth/OIDC **applications** (operates on the `Application` model)           | `ClientsClient`      |
| `.Groups`       | Groups: CRUD                                                               | `GroupsClient`       |
| `.Resources`    | API resources, API scopes, **API access policies**, scopes, claim resources | `ResourcesClient`    |
| `.Keys`         | Signing key material: list, rotate, revoke                                 | `KeysClient`         |
| `.Logs`         | Audit / event logs: list, find                                             | `LogsClient`         |
| `.NetworkZones` | IP + regional network zones (**ScaleX** for create/patch)                  | `NetworkZonesClient` |
| `.Options`      | Tenant options: authentication, communication, sign-up custom fields, external identity providers | `OptionsClient`      |
| `.Branding`     | Branding options for pages, emails, SMS                                    | `BrandingClient`     |
| `.TrustStores`  | PKI (mTLS) + SPIFFE trust stores, revocations, bans                        | `TrustStoresClient`  |

All resource-client classes live in `namespace MonoCloud.Management.Clients` and derive from `MonoCloudClientBase`. Every method is PascalCase, ends in `Async`, and takes a trailing `CancellationToken cancellationToken = default`. See [`references/api-surface.md`](references/api-surface.md) for the full, per-method index (signatures verbatim, including subscription-tier notes).

> **Naming quirk — `Clients` operates on `Application`.** The `.Clients` accessor / `ClientsClient` manages the **`Application`** resource: `GetAllApplicationsAsync`, `CreateApplicationAsync`, `PatchApplicationRequest`, etc. Path params are named `clientId` (a `string`), but there is no `Client` model — do not expect one.

## Response shape

Every method returns one of three envelopes from `namespace MonoCloud.Management.Core.Base`:

```csharp
public class MonoCloudResponse
{
    public int Status { get; }                                           // HTTP status
    public IDictionary<string, IEnumerable<string>> Headers { get; }     // multi-valued
}

public class MonoCloudResponse<T> : MonoCloudResponse
{
    public T Data { get; }                                               // deserialized body
}

// Paginated list variant adds .PageData
public class MonoCloudResponse<T, TPage> : MonoCloudResponse<T> where TPage : PageModel
{
    public TPage PageData { get; }   // TPage is always PageModel; zero-valued if the server omits x-pagination
}

public class PageModel   // namespace MonoCloud.Management.Core.Helpers
{
    public int PageSize { get; set; }
    public int CurrentPage { get; set; }
    public int TotalCount { get; set; }
    public bool HasPrevious { get; set; }
    public bool HasNext { get; set; }
}
```

- The body property is **`Data`** (not `Result`); the status property is **`Status`** (not `StatusCode`).
- **Void-return operations** (Delete / Remove / Revoke / Rotate / ban-removal / `AssignGroupToApplicationAsync`) return the bare `MonoCloudResponse` — there is no `.Data`; read `.Status` / `.Headers`.
- A few list endpoints return `MonoCloudResponse<List<T>>` (no `PageData`): `GetAllApplicationSecretsAsync`, `GetAllApiResourceSecretsAsync`, `GetAllSignUpCustomFieldsAsync`, `GetAllPkiBannedCertificatesAsync`, `GetAllSpiffeBannedSvidsAsync`. Most other list endpoints are paginated (`MonoCloudResponse<List<T>, PageModel>`).

## Pagination

Pagination metadata arrives in the `x-pagination` response header and lands in `.PageData`. Idiomatic drain loop:

```csharp
async IAsyncEnumerable<UserSummary> EachUserAsync(
    MonoCloudManagementClient management,
    [EnumeratorCancellation] CancellationToken ct = default)
{
    var page = 1;
    while (true)
    {
        var response = await management.Users.GetAllUsersAsync(page, size: 100, cancellationToken: ct);
        foreach (var u in response.Data) yield return u;
        if (!response.PageData.HasNext) yield break;
        page++;
    }
}
```

Paginated list methods share the `(int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken)` shape:

- `page` — 1-indexed (defaults to 1).
- `size` — items per page (defaults to 10).
- `filter` — Lucene-style expression (per-endpoint; see the API docs).
- `sort` — `"<field>:<1|-1>"` (1 ascending, -1 descending).

## Common operations

### Create a user

```csharp
var created = await management.Users.CreateUserAsync(new CreateUserRequest
{
    Email = "alice@example.com",
    EmailVerified = true,
    Name = "Alice Example",
});
var userId = created.Data.UserId;   // the identifier field is UserId (string), not Id
```

### Look up a user, handling not-found

```csharp
try
{
    var response = await management.Users.FindUserByIdAsync(userId);
    return response.Data;   // User
}
catch (MonoCloudNotFoundException)
{
    return null;
}
```

### Patch claims / metadata (partial update)

```csharp
await management.Users.PatchPrivateDataAsync(userId, new UpdatePrivateDataRequest
{
    PrivateData = new Dictionary<string, object> { ["onboarded"] = true, ["plan"] = "pro" }
});
```

`Patch*Request` bodies use `Optional<T>` per property — only fields you explicitly assign are serialized, so PATCH is a true partial update. Resource identifiers are path-only and never appear in the patch body (they cannot be changed).

### Disable a user

```csharp
await management.Users.DisableUserAsync(userId, new DisableUserRequest { RevokeSessions = true });
```

### List applications

```csharp
// The accessor is .Clients, but the methods and models talk about Application*.
var apps = await management.Clients.GetAllApplicationsAsync(page: 1, size: 50);
foreach (var app in apps.Data) { /* app is Application */ }
```

### Read audit logs

```csharp
var logs = await management.Logs.GetAllLogsAsync(page: 1, size: 20, sort: "created:-1");
foreach (var log in logs.Data) { /* log is Log */ }

var one = await management.Logs.FindLogByIdAsync(logId);   // logId is a Guid
```

## Errors

Every non-2xx response throws a typed exception. All derive from `MonoCloudException` (`namespace MonoCloud.Management.Core.Exception`); HTTP-status exceptions derive from `MonoCloudRequestException`, which exposes `ProblemDetails? Response`.

| Class                                  | Thrown for                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `MonoCloudBadRequestException`         | 400                                                                               |
| `MonoCloudUnauthorizedException`       | 401 — bad/missing `X-API-KEY`                                                      |
| `MonoCloudPaymentRequiredException`    | 402 — subscription/billing required                                               |
| `MonoCloudForbiddenException`          | 403 — feature not on the current plan / insufficient tier                         |
| `MonoCloudNotFoundException`           | 404                                                                               |
| `MonoCloudConflictException`           | 409                                                                               |
| `MonoCloudIdentityValidationException` | 422 (identity validation) — `.Errors` is `IEnumerable<IdentityError>`             |
| `MonoCloudKeyValidationException`      | 422 (field validation) — `.Errors` is `IDictionary<string, string[]>`            |
| `MonoCloudModelStateException`         | 422 (fallback / non-problem+json body)                                            |
| `MonoCloudResourceExhaustedException`  | 429 — rate limited                                                                |
| `MonoCloudServerException`             | 5xx                                                                               |
| `MonoCloudRequestException`            | base for all HTTP-status exceptions — exposes `.Response` (`ProblemDetails?`)     |
| `MonoCloudException`                   | base (`Exception`) — also thrown for config/transport/deserialization failures    |

`MonoCloudException` has **no** `StatusCode` property. Branch on the subclass, or read `(ex as MonoCloudRequestException)?.Response?.Status` for the problem-details status.

```csharp
try
{
    await management.Users.CreateUserAsync(req);
}
catch (MonoCloudConflictException)
{
    return Results.Conflict();
}
catch (MonoCloudIdentityValidationException ex)
{
    return Results.UnprocessableEntity(ex.Errors);   // IEnumerable<IdentityError>
}
catch (MonoCloudRequestException ex)
{
    logger.LogError(ex, "MonoCloud Management API call failed: {Status} {Title}",
        ex.Response?.Status, ex.Response?.Title);
    throw;
}
```

## Subscription tiers

Some endpoints require a paid tier; the server returns 403 (`MonoCloudForbiddenException`) or 402 (`MonoCloudPaymentRequiredException`) when the tier is insufficient.

| Tier    | Gated operations                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pro     | `Groups.CreateGroupAsync` beyond two groups; `Users` session methods (`GetAllUserSessionsAsync`, `FindUserSessionAsync`, `RevokeUserSessionAsync`); `Users.GetAllUserClientGrantsAsync` |
| Secure+ | `Users` consent/token reads (`GetAllUserConsentsAsync`, `GetAllReferenceTokensAsync`, `GetAllRefreshTokensAsync`, `GetAllAuthorizationCodesAsync`) and the matching `Revoke*` methods; the `EnableConsent` field on `Application` requests |
| ScaleX  | `NetworkZones` create/patch (`CreateIpNetworkZoneAsync`, `PatchIpNetworkZoneAsync`, `CreateRegionalNetworkZoneAsync`, `PatchRegionalNetworkZoneAsync`); `Clients.AssignGroupToApplicationAsync` / `RemoveGroupFromApplicationAsync`; `Resources.CreateApiResourceSecretAsync` |

Several request **fields** (e.g. `EnableConsent`, PAR/JAR, back-channel logout, extended refresh-token lifetimes) also carry tier gates even on otherwise-free endpoints. The `<note>…subscription…</note>` XML comments in the SDK source are the source of truth — see [`references/api-surface.md`](references/api-surface.md).

## DI registration and HTTP-layer replacement

`AddMonoCloudManagementClient` (static class `MonoCloudManagementServiceExtensions`, `namespace MonoCloud.Management`) has three overloads, all returning `IServiceCollection`:

- `AddMonoCloudManagementClient(IConfiguration configuration)` — reads the `MonoCloud:Management` section.
- `AddMonoCloudManagementClient(Action<MonoCloudManagementOptions> options)` — configure in code.
- `AddMonoCloudManagementClient(IConfiguration? configuration, Action<MonoCloudManagementOptions>? options)` — both; options override configuration.

It registers a named `HttpClient` (`"MonoCloudManagementClient"`) with `BaseAddress = {Domain}/api/`, `Timeout = config.Timeout`, and the `X-API-KEY` default header, then registers `MonoCloudManagementClient` as transient over `IHttpClientFactory`.

**Bring-your-own `HttpClient`.** The `MonoCloudManagementClient(HttpClient httpClient)` constructor bypasses `MonoCloudConfig`, so you own the full pipeline (custom `HttpMessageHandler`, Polly policies, proxies, mTLS, test doubles). You **must** set `BaseAddress` (ending in `/api/`) and the `X-API-KEY` header yourself.

## Common pitfalls

1. **Hardcoding the API key in `appsettings.json`.** Use User Secrets for dev and a secret manager (Azure Key Vault, AWS Secrets Manager) in production.
2. **Expecting env-var fallback.** Unlike the JS SDK, this SDK reads **no** `MONOCLOUD_MANAGEMENT_*` env vars itself. Feed values through `IConfiguration` (which can bind env vars via the `MonoCloud__Management__*` mapping) or the options action.
3. **Trailing `/api` on `Domain`.** Pass the bare tenant URL — the SDK appends `/api/`.
4. **Milliseconds vs seconds for timeout.** `MonoCloud:Management:Timeout` is **seconds** (mapped to `TimeSpan.FromSeconds`/`TotalSeconds`). The default is `10` — long-running admin calls may need it raised.
5. **Sending immutable identifiers on `Patch…` requests.** Identifier fields were removed from PATCH request models in 0.2.6 (`Audience` from `PatchApiResourceRequest`; `Name` from `PatchApiScopeRequest`, `PatchScopeRequest`, `PatchClaimResourceRequest`). The C# property is gone — old code that set it won't compile.
6. **Parameter-order gotchas in `ResourcesClient`.** `FindApiResourceSecretByIdAsync(secretId, apiId, …)` and the API-scope find/patch/delete methods take `(scopeId, apiId, …)` — the scope/secret id comes **before** `apiId`. But `DeleteApiResourceSecretAsync(apiId, secretId, …)` and the create methods take `apiId` first. Copy the signatures verbatim from [`references/api-surface.md`](references/api-surface.md).
7. **`Guid` vs `string` ids.** Group ids and user identifier ids are `Guid` (`groupId`, `identifierId`, `logId`); user / application / resource / zone / trust-store / session ids are `string`.
8. **Reading `response.Result` / `ex.StatusCode`.** The body is `.Data`, the status is `.Status`; `MonoCloudException` has no `StatusCode` — branch on the subclass or read `(ex as MonoCloudRequestException)?.Response?.Status`.
9. **`new`-ing `MonoCloudManagementClient` per request under DI.** It's already registered transient over `IHttpClientFactory` — inject it, don't construct it in controllers.
10. **Referencing `MonoCloud.Management.Core` directly.** The core types (`MonoCloudConfig`, `MonoCloudResponse<T>`, exceptions) come transitively with `MonoCloud.Management`; don't add a separate package reference.
11. **Using ScaleX/Secure+ features without the tier.** `NetworkZones` create/patch, application↔group assignment, API-resource-secret creation, and consent/token endpoints throw `MonoCloudForbiddenException` (or 402) on lower plans. Verify the tenant's plan before wiring them into production.

## Onboarding checklist

1. `dotnet add package MonoCloud.Management`.
2. Create a Management API key in the MonoCloud dashboard.
3. Set `MonoCloud:Management:Domain` (in `appsettings.json`/config) and `MonoCloud:Management:ApiKey` (in User Secrets / Key Vault / env var).
4. `Program.cs`: `builder.Services.AddMonoCloudManagementClient(builder.Configuration)`.
5. Inject `MonoCloudManagementClient` and call resource clients (`management.Users.GetAllUsersAsync(...)`, etc.).
6. Read results from `response.Data` (and `response.PageData` for paginated lists).
7. Wrap calls in `try/catch` against the specific `MonoCloudException` subclass(es) you handle.
8. Run `node scripts/verify.js /path/to/project` to confirm package installation + config.

## Deeper reference

- [`references/api-surface.md`](references/api-surface.md) — every resource client and method, with verbatim signatures, response types, and subscription-tier notes.
- [`references/troubleshooting.md`](references/troubleshooting.md) — symptom → cause → fix for the common failure modes (401/403, missing `Domain`/`ApiKey` at startup, secret leaks, hand-`new`ed clients vs DI, generic `catch (Exception)`, single-page reads).
