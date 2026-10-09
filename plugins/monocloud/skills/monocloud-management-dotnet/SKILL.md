---
name: monocloud-management-dotnet
description: Use when calling the MonoCloud Management API from .NET/C# — installing or configuring the `MonoCloud.Management` NuGet package, constructing `MonoCloudManagementClient` (via `MonoCloudConfig`, `HttpClient`, or DI `AddMonoCloudManagementClient`), calling resource clients (`Users`, `Clients`, `Groups`, `Resources`, `Keys`, `Logs`, `NetworkZones`, `Options`, `Branding`, `TrustStores`) — incl. PKI/SPIFFE (mTLS) trust stores, external identity providers, network zones, API access policies — reading `MonoCloudResponse<T>.Data` / `PageData` (`PageModel`), `Optional<T>` `Patch*Request` updates, catching `MonoCloudException` subclasses (`MonoCloudNotFoundException`, `MonoCloudConflictException`, `MonoCloudForbiddenException`, `MonoCloudUnauthorizedException`, `MonoCloudIdentityValidationException`) and reading `MonoCloudCodedException.ErrorCode` / `ProblemDetails.TraceId`, or troubleshooting `MonoCloud:Management:Domain` / `MonoCloud:Management:ApiKey` / `Timeout` config and 401/403/404/409/422 errors.
license: MIT
---

# MonoCloud Management .NET SDK (`MonoCloud.Management`)

Typed .NET client for the MonoCloud Management API: users, applications, groups, API resources and access policies, tenant options, branding, logs, signing keys, network zones, and PKI/SPIFFE trust stores. Server-side only.

## Package identity — read this first

- **Use** the `MonoCloud.Management` NuGet package. Before writing code, check `*.csproj` (or `packages.config`) for `<PackageReference Include="MonoCloud.Management" … />`. Install with `dotnet add package MonoCloud.Management` (or `Install-Package MonoCloud.Management`). It targets `net462` and `netstandard2.0`.
- `MonoCloud.Management.Core` comes in transitively and holds `MonoCloudConfig`, the response envelopes, the exceptions and `Optional<T>`. Don't reference it directly.
- Different packages: `MonoCloud.Authentication.Api` validates access tokens in an ASP.NET Core API (skill `monocloud-auth-aspnetcore`); `@monocloud/management` is the Node.js SDK (skill `monocloud-management-js`).

None of these exist — don't emit them:

- `MonoCloudClient`, `ManagementApiClient`, `.ManagementApi`, `.UsersApi`, `ListUsersAsync`, `GetUsers` — the entry type is `MonoCloudManagementClient`; resource clients are properties (`.Users`, `.Clients`, …) with `GetAll*Async` / `Find*Async` / `Create*Async` / `Patch*Async` / `Delete*Async` methods.
- `response.Result` / `.Body` / `.Value` / `.StatusCode` — the body is `.Data`, the HTTP status is `.Status`.
- A `Client` model — `.Clients` manages `Application` objects.
- `ex.StatusCode`, or constants for error codes — see [Errors](#errors).
- `MONOCLOUD_MANAGEMENT_*` environment variables — the SDK reads only what reaches it through `IConfiguration`, `MonoCloudManagementOptions`, or `MonoCloudConfig`.

## Configuration

`AddMonoCloudManagementClient(IConfiguration)` reads the `MonoCloud:Management` section:

| Key | Env var (standard .NET mapping) | Required | Value |
|---|---|---|---|
| `MonoCloud:Management:Domain` | `MonoCloud__Management__Domain` | yes | Tenant URL, e.g. `https://your-tenant.us.monocloud.com` — no `/api` |
| `MonoCloud:Management:ApiKey` | `MonoCloud__Management__ApiKey` | yes | Management API key, sent as the `X-API-KEY` header |
| `MonoCloud:Management:Timeout` | `MonoCloud__Management__Timeout` | no | Positive whole number of **seconds** (default `10`); a value `int.TryParse` rejects silently falls back to the default |

- `Domain`: `https://` is prepended unless the value already starts with it (so `http://…` becomes `https://http://…` — always use `https://`), and one trailing `/` is removed. Requests go to `{Domain}/api/…`.
- The API key is a tenant-management credential. Keep it in User Secrets (`dotnet user-secrets set "MonoCloud:Management:ApiKey" "<key>"`) or a secret manager — never in a committed `appsettings*.json`, and never in browser or mobile code.

## Quick start — DI (recommended)

`appsettings.json` (the key comes from User Secrets or the environment):

```json
{
  "MonoCloud": {
    "Management": {
      "Domain": "https://your-tenant.us.monocloud.com",
      "Timeout": 30
    }
  }
}
```

`Program.cs`:

```csharp
using MonoCloud.Management;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddMonoCloudManagementClient(builder.Configuration);

var app = builder.Build();

app.MapGet("/users", async (MonoCloudManagementClient management) =>
{
    var response = await management.Users.GetAllUsersAsync(page: 1, size: 25);
    return Results.Ok(response.Data);   // List<UserSummary>
});

app.Run();
```

- Overloads (static class `MonoCloudManagementServiceExtensions`, namespace `MonoCloud.Management`): `(IConfiguration)`, `(Action<MonoCloudManagementOptions>)`, `(IConfiguration?, Action<MonoCloudManagementOptions>?)`. `MonoCloudManagementOptions` has `string? Domain`, `string? ApiKey`, `TimeSpan? Timeout`; any option you set overrides configuration (`Timeout` is truncated to whole seconds).
- An empty `Domain` or `ApiKey` after merging throws `ArgumentNullException` during registration.
- It registers a named `HttpClient` `"MonoCloudManagementClient"` (base address, timeout, `X-API-KEY`) and `MonoCloudManagementClient` as **transient** on top of `IHttpClientFactory`. Inject the client rather than constructing it. To add handlers or resilience policies, chain onto `builder.Services.AddHttpClient("MonoCloudManagementClient")`.

```csharp
builder.Services.AddMonoCloudManagementClient(builder.Configuration, options =>
{
    options.ApiKey = builder.Configuration["Secrets:MonoCloudApiKey"];   // overrides MonoCloud:Management:ApiKey
    options.Timeout = TimeSpan.FromSeconds(60);
});
```

## Quick start — without DI

```csharp
using MonoCloud.Management;
using MonoCloud.Management.Core.Base;   // MonoCloudConfig

var management = new MonoCloudManagementClient(new MonoCloudConfig(
    domain: "https://your-tenant.us.monocloud.com",
    apiKey: apiKey,                         // from a secret store
    timeout: TimeSpan.FromSeconds(30)));   // optional; default 10 s
```

- Create it once and reuse it: every instance creates a new `HttpClient` for each of its ten resource clients.
- `new MonoCloudManagementClient(HttpClient)` uses the given client as-is: set `BaseAddress` to `{Domain}/api/` (with the trailing slash) and the `X-API-KEY` default header yourself; that client's own `Timeout` applies. Use it for custom handlers, proxies, or test doubles.
- Construction exceptions and their messages: [troubleshooting](references/troubleshooting.md#startup-and-construction-exceptions).

## Client surface

| Property | Type | Manages |
|---|---|---|
| `Users` | `UsersClient` | Users, emails/phones/username, passwords/passkeys, claims, public/private data, blocked IPs, sessions, group membership, grants/tokens |
| `Clients` | `ClientsClient` | Applications (`Application` model), their secrets and group assignments |
| `Groups` | `GroupsClient` | Group CRUD |
| `Resources` | `ResourcesClient` | API resources and secrets, API scopes, API access policies, identity scopes, claim resources |
| `Keys` | `KeysClient` | Signing keys: list, rotate, revoke |
| `Logs` | `LogsClient` | Audit logs: list, find |
| `NetworkZones` | `NetworkZonesClient` | IP and regional network zones |
| `Options` | `OptionsClient` | Authentication and communication options, sign-up custom fields, external identity providers |
| `Branding` | `BrandingClient` | Page, email, and SMS branding |
| `TrustStores` | `TrustStoresClient` | PKI (mTLS) and SPIFFE trust stores, CRL revocations, bans |

Every method returns a `Task`, ends in `Async`, and takes a trailing `CancellationToken cancellationToken = default`. All signatures: [`references/api-surface.md`](references/api-surface.md#methods).

```csharp
using MonoCloud.Management;                 // MonoCloudManagementClient, options, DI extension
using MonoCloud.Management.Core.Base;       // MonoCloudConfig, MonoCloudResponse*
using MonoCloud.Management.Core.Exception;  // MonoCloud*Exception
using MonoCloud.Management.Core.Helpers;    // PageModel, Optional<T>
using MonoCloud.Management.Models;          // request/response models and enums
```

## Responses and pagination

| Return type | Members | Returned by |
|---|---|---|
| `MonoCloudResponse` | `int Status`, `IDictionary<string, IEnumerable<string>> Headers` | No-body operations: every `Delete*`, `Revoke*`, and `Unban*` method, `RotateKeyAsync`, `RemovePasskeyAsync`, `RemovePasswordAsync`, `RemoveUserFromGroupAsync`, `RemoveCertificateRevocationAsync`, `AssignGroupToApplicationAsync`, `RemoveGroupFromApplicationAsync` |
| `MonoCloudResponse<T>` | adds `T Data` | Single objects, plus six unpaged lists: `GetAllApplicationSecretsAsync`, `GetAllApiResourceSecretsAsync`, `GetAllSignUpCustomFieldsAsync`, `GetAllExternalAuthenticatorsAsync`, `GetAllPkiBannedCertificatesAsync`, `GetAllSpiffeBannedSvidsAsync` |
| `MonoCloudResponse<T, PageModel>` | adds `PageModel PageData` | Every other `GetAll*Async` method (`T` is a `List<…>`) |

`PageModel` (`PageSize`, `CurrentPage`, `TotalCount`, `HasPrevious`, `HasNext`) is parsed from the `x-pagination` response header; it is zero-valued, not `null`, when the header is missing. Paginated methods take `int? page = 1, int? size = 10` (1-based) after any parent id. `filter` (Lucene-style) and `sort` (`"field:1"` ascending, `"field:-1"` descending) exist only where the signature has them, and the sortable fields differ per endpoint.

```csharp
async IAsyncEnumerable<UserSummary> EachUserAsync(
    MonoCloudManagementClient management, [EnumeratorCancellation] CancellationToken ct = default)
{
    for (var page = 1; ; page++)
    {
        var response = await management.Users.GetAllUsersAsync(page, size: 100, cancellationToken: ct);
        foreach (var user in response.Data) yield return user;
        if (!response.PageData.HasNext) yield break;
    }
}
```

## Common operations

```csharp
// Create a user — the id property is UserId (string)
var created = await management.Users.CreateUserAsync(new CreateUserRequest
{
    Email = "alice@example.com",
    EmailVerified = true,
    Name = "Alice Example",
});
var userId = created.Data.UserId;

// Look up a user, treating 404 as "not found"
User? user = null;
try { user = (await management.Users.FindUserByIdAsync(userId)).Data; }
catch (MonoCloudNotFoundException) { }

// Partial update: only the Optional<T> properties you assign are sent
await management.Clients.PatchApplicationAsync(clientId, new PatchApplicationRequest { ClientName = "Renamed app" });

// Private/public data: the keys you send are merged; a null value removes that key
await management.Users.PatchPrivateDataAsync(userId, new UpdatePrivateDataRequest
{
    PrivateData = new Dictionary<string, object> { ["plan"] = "pro", ["trial_ends"] = null! },
});

// Disable a user and revoke their sessions
await management.Users.DisableUserAsync(userId, new DisableUserRequest { RevokeSessions = true });

// Group membership — group ids are Guid
await management.Users.AssignUserToGroupAsync(userId, group.GroupId);

// Applications live on .Clients; pass Application.Id wherever a clientId is expected
var apps = await management.Clients.GetAllApplicationsAsync(size: 50, sort: "client_name:1");

// Audit logs, newest first; Log.Id is a Guid
var logs = await management.Logs.GetAllLogsAsync(sort: "time_stamp:-1");
var entry = await management.Logs.FindLogByIdAsync(logs.Data[0].Id);
```

PATCH bodies (`Patch*Request`, and `UpdateClaimsRequest`) use `Optional<T>` properties that are serialized only when assigned; assign `null` to clear a nullable field. Ids are path parameters and never body properties, so they can't be patched: `PatchApplicationRequest` has no client id, `PatchApiResourceRequest` has no `Audience`, and `PatchApiScopeRequest` / `PatchScopeRequest` / `PatchClaimResourceRequest` have no `Name`.

## Errors

| Status | Exception (`MonoCloud.Management.Core.Exception`) | Extra members |
|---|---|---|
| 400 | `MonoCloudBadRequestException` | `ErrorCode` |
| 401 | `MonoCloudUnauthorizedException` | — |
| 402 | `MonoCloudPaymentRequiredException` | `ErrorCode` |
| 403 | `MonoCloudForbiddenException` | `ErrorCode` |
| 404 | `MonoCloudNotFoundException` | `ErrorCode` |
| 409 | `MonoCloudConflictException` | `ErrorCode` |
| 422 | `MonoCloudIdentityValidationException` | `Errors`: `IEnumerable<IdentityError>` (`Code`, `Description`) |
| 422 | `MonoCloudKeyValidationException` | `Errors`: `IDictionary<string, string[]>` (field → messages) |
| 422 | `MonoCloudModelStateException` | — (the body wasn't `application/problem+json`) |
| 429 | `MonoCloudResourceExhaustedException` | — |
| ≥ 500 | `MonoCloudServerException` | — |

- All of these derive from `MonoCloudRequestException` (`ProblemDetails? Response`), which derives from `MonoCloudException`. The 400/402/403/404/409 classes derive from the abstract `MonoCloudCodedException`, the only type with `string? ErrorCode` (`=> Response?.ErrorCode`).
- There is no `StatusCode` property: catch the specific type, or read `ex.Response?.Status`.
- `ErrorCode` is `null` when the API sent no code or the error body wasn't `application/problem+json` (then `Response` is `null` too). The SDK defines no error-code constants — compare against codes you have actually observed; never invent them.
- `ex.Response?.TraceId` (empty string when absent) identifies the failed request — log it and quote it to MonoCloud support.
- Statuses not in the table throw a plain `System.Exception`; network failures and timeouts surface unwrapped (`HttpRequestException`, `TaskCanceledException`).

```csharp
try
{
    await management.Users.CreateUserAsync(request);
}
catch (MonoCloudConflictException ex)              // 409
{
    return Results.Conflict(new { ex.ErrorCode });
}
catch (MonoCloudIdentityValidationException ex)    // 422, e.g. password rules
{
    return Results.UnprocessableEntity(ex.Errors);
}
catch (MonoCloudCodedException ex)                 // other 400 / 402 / 403 / 404
{
    logger.LogWarning(ex, "MonoCloud {Status} {ErrorCode} trace {TraceId}",
        ex.Response?.Status, ex.ErrorCode, ex.Response?.TraceId);
    throw;
}
catch (MonoCloudRequestException ex)               // 401, other 422s, 429, 5xx
{
    logger.LogError(ex, "MonoCloud {Status} {Title} trace {TraceId}",
        ex.Response?.Status, ex.Response?.Title, ex.Response?.TraceId);
    throw;
}
```

Order `catch` blocks most-derived first — C# rejects a subclass after its base (CS0160).

## Subscription tiers

Gated calls compile for every tenant but are rejected at runtime, typically with `MonoCloudForbiddenException`, when the plan lacks the feature. Method-level gates, from the SDK's `<note>` comments:

| Tier | Methods |
|---|---|
| Pro | `Groups.CreateGroupAsync` beyond two groups; `Users.GetAllUserSessionsAsync`, `FindUserSessionAsync`, `RevokeUserSessionAsync`, `GetAllUserClientGrantsAsync` |
| Secure+ | `Users.GetAllUserConsentsAsync`, `GetAllReferenceTokensAsync`, `GetAllRefreshTokensAsync`, `GetAllAuthorizationCodesAsync`, `RevokeUserClientGrantsAsync`, `RevokeUserConsentAsync`, `RevokeReferenceTokenAsync`, `RevokeRefreshTokenAsync`, `RevokeAuthorizationCodeAsync` |
| ScaleX | `NetworkZones.CreateIpNetworkZoneAsync`, `PatchIpNetworkZoneAsync`, `CreateRegionalNetworkZoneAsync`, `PatchRegionalNetworkZoneAsync`; `Clients.AssignGroupToApplicationAsync`, `RemoveGroupFromApplicationAsync`; `Resources.CreateApiResourceSecretAsync` |

Many request fields are gated too (consent, PAR/JAR, front/back-channel logout, session binding, reference tokens, long refresh-token lifetimes, …) — see [field-level gates](references/api-surface.md#field-level-subscription-gates).

## Common pitfalls

1. **`Guid` vs `string` ids.** `groupId`, `identifierId` (`UserEmail.Id` / `UserPhone.Id`) and `logId` are `Guid`; every other id is a `string`. Model id properties vary (`User.UserId`, `Group.GroupId`, `Application.Id`) — see the [id table](references/api-surface.md#ids).
2. **`ResourcesClient` argument order.** `FindApiResourceSecretByIdAsync(secretId, apiId)` and `Find`/`Patch`/`DeleteApiScopeAsync(scopeId, apiId, …)` take the child id first; `DeleteApiResourceSecretAsync(apiId, secretId)` and every access-policy method take `apiId` first.
3. **Timeout units.** `Timeout` in configuration is seconds — `30000` means more than eight hours. `MonoCloudConfig` and `MonoCloudManagementOptions` take a `TimeSpan`.

## Onboarding checklist

1. `dotnet add package MonoCloud.Management`.
2. Create a Management API key in the MonoCloud dashboard; store it as `MonoCloud:Management:ApiKey` in User Secrets or a secret manager.
3. Set `MonoCloud:Management:Domain` to the bare `https://` tenant URL.
4. Call `builder.Services.AddMonoCloudManagementClient(builder.Configuration)` and inject `MonoCloudManagementClient`.
5. Read `.Data` (plus `.PageData` on paginated lists) and catch the specific exception types you handle.
6. Run [`node scripts/verify.js <project-dir>`](scripts/verify.js) to check the package reference, configuration, and wiring.

## Deeper reference

- [`references/api-surface.md`](references/api-surface.md) — namespaces, constructors, envelopes, exception mapping, every resource-client method with tier markers, field-level gates, ids, JSON conventions.
- [`references/troubleshooting.md`](references/troubleshooting.md) — symptom → cause → fix for 401s, construction exceptions, domain and timeout mistakes, `ErrorCode` / `TraceId`, pagination, PATCH, and tier rejections.
