---
name: monocloud-management-dotnet
description: Use when calling the MonoCloud Management API from .NET — installing or configuring the `MonoCloud.Management` NuGet package, constructing `MonoCloudManagementClient` (direct or via DI with `AddMonoCloudManagementClient`), calling resource clients (`Users`, `Clients`, `Groups`, `Resources`, `Keys`, `Logs`, `Options`, `Branding`, `TrustStores`), reading `MonoCloudResponse<T>.Data` (and `PageData` for paginated lists), handling `MonoCloudException` subclasses, or troubleshooting `MonoCloud:Management:Domain` / `MonoCloud:Management:ApiKey` / 401 / 403 / validation errors.
license: MIT
---

# MonoCloud Management .NET SDK (`MonoCloud.Management`)

Typed .NET SDK for the MonoCloud Management API. Use it to programmatically manage users, applications, groups, API resources, sign-in options, branding, logs, keys, and trust stores from .NET (Framework 4.6.2+, .NET Standard 2.0, or modern .NET).

## Package identity — read this first

**Use:** `MonoCloud.Management` NuGet package.

This is **not** the same as:

- `MonoCloud.AspNetCore.Authentication` family (user-facing OIDC auth — outside this skill).
- `MonoCloud.Cedar` (policy / authorization engine — outside this skill).

If code references `MonoCloud.Management.Core` directly, that's the internal core package. App code should depend only on `MonoCloud.Management` — the core types (`MonoCloudConfig`, `MonoCloudResponse<T>`, `MonoCloudException`, etc.) are accessible via `using MonoCloud.Management;`.

## Installation

```powershell
Install-Package MonoCloud.Management
```

```bash
dotnet add package MonoCloud.Management
```

Supported targets: **`.NET Framework 4.6.2+`**, **`.NET Standard 2.0`**, **`.NET 6.0+`** (anything that consumes netstandard2.0).

## Authentication — Management API key

A **Management API key** (generated in the MonoCloud dashboard → Settings → API Keys) is required. Treat it like a root credential:

- Never check it into source control.
- Read it from `IConfiguration` (`appsettings.json` + environment variables / User Secrets / Key Vault / etc.).
- A Management API key is tenant-scoped with full admin permissions.

## Configuration keys

The recommended path is `IConfiguration` + the DI extension. Configuration is read from the section **`MonoCloud:Management`**.

| Key                            | Required? | Purpose                                          |
| ------------------------------ | --------- | ------------------------------------------------ |
| `MonoCloud:Management:Domain`  | yes       | Tenant URL, e.g. `https://acme.us.monocloud.com` |
| `MonoCloud:Management:ApiKey`  | yes       | Management API key                               |
| `MonoCloud:Management:Timeout` | no        | Request timeout in **seconds**                   |

In Linux/CI environments, set these via env vars using the standard ASP.NET Core mapping:

- `MonoCloud__Management__Domain`
- `MonoCloud__Management__ApiKey`
- `MonoCloud__Management__Timeout`

Never hardcode the API key in `appsettings.json` that ships with the app. Use User Secrets locally and a secret manager in production.

## Quick start — DI (recommended)

`appsettings.Development.json` (local dev only; use User Secrets for the API key):

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
    return Results.Ok(response.Data);
});

app.Run();
```

Inject `MonoCloudManagementClient` anywhere it's needed. The DI extension registers it as **transient**, backed by `IHttpClientFactory` (so connection pooling, retries, etc. layer cleanly on top).

## Quick start — direct construction

For console apps, background workers, or scenarios without DI:

```csharp
using MonoCloud.Management;
using MonoCloud.Management.Core.Base;   // MonoCloudConfig

var config = new MonoCloudConfig(
    domain: "https://your-tenant.us.monocloud.com",   // or read from your own settings
    apiKey: "your-management-api-key",
    timeout: TimeSpan.FromSeconds(30)                 // optional; defaults to 10s
);

var management = new MonoCloudManagementClient(config);
var response = await management.Users.GetAllUsersAsync(1, 25);
```

The .NET SDK does **not** read environment variables on its own — that's the DI extension's job (via `IConfiguration`). For direct construction, source the values however you normally configure secrets in your app: `IConfiguration`, user-secrets, a key vault, `Environment.GetEnvironmentVariable("MonoCloud__Management__Domain")` if you want to reuse the DI convention, etc.

`MonoCloudManagementClient` also accepts an `HttpClient` directly — useful for integration tests with a test server:

```csharp
var http = new HttpClient { BaseAddress = new Uri("https://example.com/api/") };
http.DefaultRequestHeaders.Add("X-API-KEY", "test-key");
var management = new MonoCloudManagementClient(http);
```

Authentication happens via the `X-API-KEY` header — the SDK adds it automatically when you use `MonoCloudConfig`.

## Mixing DI options with code

`AddMonoCloudManagementClient` also takes an `Action<MonoCloudManagementOptions>` (alone, or alongside `IConfiguration`). The action's values override the configuration.

```csharp
builder.Services.AddMonoCloudManagementClient(builder.Configuration, options =>
{
    options.ApiKey = builder.Configuration["Secrets:MonoCloudApiKey"];
    options.Timeout = TimeSpan.FromSeconds(60);
});
```

## Client surface

`MonoCloudManagementClient` exposes one property per Management API resource area:

| Property       | Resource           | Backing type        |
| -------------- | ------------------ | ------------------- |
| `.Branding`    | Branding           | `BrandingClient`    |
| `.Clients`     | OAuth applications | `ClientsClient`     |
| `.Groups`      | Groups             | `GroupsClient`      |
| `.Keys`        | Signing keys       | `KeysClient`        |
| `.Logs`        | Audit logs         | `LogsClient`        |
| `.Options`     | Tenant options     | `OptionsClient`     |
| `.Resources`   | API resources      | `ResourcesClient`   |
| `.TrustStores` | mTLS trust stores  | `TrustStoresClient` |
| `.Users`       | Users              | `UsersClient`       |

Each method on a resource client returns `Task<MonoCloudResponse<T>>` or `Task<MonoCloudResponse<T, PageModel>>` for paginated lists, plus a `CancellationToken` parameter. See [`references/api-surface.md`](references/api-surface.md) for the full method index.

## Response shape

```csharp
public class MonoCloudResponse
{
    public int Status { get; }
    public IDictionary<string, IEnumerable<string>> Headers { get; }
}

public class MonoCloudResponse<T> : MonoCloudResponse
{
    public T Data { get; }
}

// Paginated variant adds .PageData
public class MonoCloudResponse<T, TPage> : MonoCloudResponse<T> where TPage : PageModel
{
    public TPage PageData { get; }   // always present (zero-valued PageModel if the server omits the header)
}

public class PageModel
{
    public int PageSize { get; set; }
    public int CurrentPage { get; set; }
    public int TotalCount { get; set; }
    public bool HasPrevious { get; set; }
    public bool HasNext { get; set; }
}
```

> The body property is **`Data`** (not `Result`), the status property is **`Status`** (not `StatusCode`), and `Headers` is `IDictionary<string, IEnumerable<string>>` (multi-valued, not a flat string map).

## Pagination

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

List methods share the `(page, size, filter, sort, cancellationToken)` shape:

- `page` — 1-indexed (defaults to 1).
- `size` — items per page (defaults to 10).
- `filter` — Lucene-style expression (per-endpoint; see API docs).
- `sort` — `"<field>:<1|-1>"` (1 ascending, -1 descending).
- `cancellationToken` — optional.

## Common operations

### Create a user

```csharp
var created = await management.Users.CreateUserAsync(new CreateUserRequest
{
    Email = "alice@example.com",
    EmailVerified = true,
    Name = "Alice Example",
});
var userId = created.Data.UserId; // identifier field is UserId, not Id
```

### Patch metadata (merge semantics)

```csharp
await management.Users.PatchPrivateDataAsync(userId, new UpdatePrivateDataRequest
{
    PrivateData = new Dictionary<string, object?> { ["onboarded"] = true, ["plan"] = "pro" }
});
```

Patch is field-level merge: omitted properties are left alone; properties set to `null` are removed.

### Lookup with not-found handling

```csharp
try
{
    var response = await management.Users.FindUserByIdAsync(id);
    return response.Data;
}
catch (MonoCloudNotFoundException)
{
    return null;
}
```

### Disable a user

```csharp
await management.Users.DisableUserAsync(id, new DisableUserRequest { /* options */ });
```

### List applications

```csharp
// The property is .Clients, but the methods talk about Application*.
var apps = await management.Clients.GetAllApplicationsAsync(page: 1, size: 50);
foreach (var app in apps.Data) { /* ... */ }
```

## Errors

Every non-2xx response throws a typed exception that derives from `MonoCloudException`:

| Class                                  | Thrown for                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `MonoCloudBadRequestException`         | 400                                                                              |
| `MonoCloudUnauthorizedException`       | 401                                                                              |
| `MonoCloudPaymentRequiredException`    | 402                                                                              |
| `MonoCloudForbiddenException`          | 403                                                                              |
| `MonoCloudNotFoundException`           | 404                                                                              |
| `MonoCloudConflictException`           | 409                                                                              |
| `MonoCloudIdentityValidationException` | 422 (identity validation) — `.Errors` is `IEnumerable<IdentityError>`            |
| `MonoCloudKeyValidationException`      | 422 (key/value validation) — `.Errors` is `IDictionary<string, string[]>`        |
| `MonoCloudModelStateException`         | 422 (other)                                                                      |
| `MonoCloudResourceExhaustedException`  | 429                                                                              |
| `MonoCloudServerException`             | 5xx                                                                              |
| `MonoCloudRequestException`            | base for all of the above — exposes `.Response` (`ProblemDetails?`)              |
| `MonoCloudException`                   | base (`Exception`) — also thrown for non-HTTP failures (deserialization, etc.)   |

`MonoCloudException` does not have a `StatusCode` property. Branch on the subclass with `catch (MonoCloudNotFoundException)`, or read `(ex as MonoCloudRequestException)?.Response?.Status` for the underlying problem-details status.

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
    return Results.UnprocessableEntity(ex.Errors);
}
catch (MonoCloudRequestException ex)
{
    logger.LogError(ex, "MonoCloud Management API call failed: {Status} {Title}",
        ex.Response?.Status, ex.Response?.Title);
    throw;
}
```

## Common pitfalls

1. **Hardcoding the API key in `appsettings.json`.** Use User Secrets (`dotnet user-secrets set "MonoCloud:Management:ApiKey" "..."`) for dev and a secret manager (Azure Key Vault, AWS Secrets Manager, etc.) in production.
2. **Trailing `/api/v1` on `Domain`.** Pass the bare tenant URL — the SDK appends `/api/`.
3. **Mixing seconds vs milliseconds for timeout.** `MonoCloud:Management:Timeout` is **seconds**, mirroring `TimeSpan.FromSeconds`. Don't use ms here.
5. **Catching `Exception` everywhere.** Catch the specific `MonoCloudException` subclass — status-driven branching is the point.
6. **Reading `ex.StatusCode`.** `MonoCloudException` has no `StatusCode` property; use `instanceof` against the subclass or read `(ex as MonoCloudRequestException)?.Response?.Status`.
7. **Reading `response.Result`.** The body property is `Data`, not `Result`. Status is `Status`, not `StatusCode`. Headers is `IDictionary<string, IEnumerable<string>>`.
8. **Creating a new `MonoCloudManagementClient` per request when using DI.** `AddMonoCloudManagementClient` already registers it transient over `IHttpClientFactory`. Don't `new` it inside controllers.
9. **Calling `MonoCloud.Management.Core` types directly.** The core types are re-exported under `using MonoCloud.Management;` — don't add a project reference to the core package.

## Onboarding checklist

1. `dotnet add package MonoCloud.Management`.
2. Create a Management API key in the MonoCloud dashboard.
3. Configure `MonoCloud:Management:Domain` (in `appsettings.json` or config) and `MonoCloud:Management:ApiKey` (in User Secrets / Key Vault / env var).
4. `Program.cs`: `builder.Services.AddMonoCloudManagementClient(builder.Configuration)`.
5. Inject `MonoCloudManagementClient` and call resource APIs.
6. Wrap calls in `try/catch` against the specific `MonoCloudException` subclass(es) you handle.
7. Run `node skills/monocloud-management-dotnet/scripts/verify.js` to confirm config + package installation.

## Deeper reference

- [`references/api-surface.md`](references/api-surface.md) — resource-by-resource method index.
- [`references/troubleshooting.md`](references/troubleshooting.md) — symptom → cause → fix index for the most common failure modes (401s, missing `Domain`/`ApiKey` at startup, secret leaks in `appsettings.json`, hand-`new`ed clients vs DI, generic `catch (Exception)`, single-page reads).
