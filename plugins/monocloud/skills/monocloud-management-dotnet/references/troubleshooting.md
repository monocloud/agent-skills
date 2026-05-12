# Troubleshooting — `MonoCloud.Management`

Quick reference for the most common issues calling the MonoCloud Management API from .NET. Each entry is **symptom → root cause → fix**.

## 401 Unauthorized on every call

**Symptom:** Every Management call throws `MonoCloudUnauthorizedException`, even read-only ones.

**Cause:** The API key isn't reaching the client, or it belongs to a different tenant than `MonoCloud:Management:Domain`.

**Fix:**

1. Confirm the key is bound: in `Program.cs`, log `builder.Configuration["MonoCloud:Management:ApiKey"]?[..4]` once at startup. If null, the binding is wrong.
2. Common binding failures: wrong section name (`MonoCloud:Management` vs `MonoCloudManagement`), or the secret is in User Secrets for a different project (User Secrets keys to the `<UserSecretsId>` in the `.csproj`).
3. Confirm the tenant matches the key — keys are tenant-scoped. A dev-tenant key against the prod `Domain` returns 401.

## `ArgumentNullException` at startup mentioning `Domain` or `ApiKey`

**Symptom:** App fails to start: `The domain for the MonoCloud Management client has not been set.` or `The api key for the MonoCloud Management client has not been set.`

**Cause:** `AddMonoCloudManagementClient` was registered but neither the `IConfiguration` nor the `Action<MonoCloudManagementOptions>` provided the required values.

**Fix:** Either pass `builder.Configuration` and make sure `appsettings*.json` / User Secrets / env vars supply `MonoCloud:Management:Domain` and `MonoCloud:Management:ApiKey`, or pass values explicitly:

```csharp
builder.Services.AddMonoCloudManagementClient(options =>
{
    options.Domain = builder.Configuration["MonoCloud:Management:Domain"];
    options.ApiKey = builder.Configuration["Secrets:MonoCloudApiKey"];
});
```

For env vars in Linux/CI use the standard ASP.NET Core convention: `MonoCloud__Management__Domain`, `MonoCloud__Management__ApiKey` (double underscores).

## API key in `appsettings.json`

**Symptom:** Secret-scanner (GitHub Push Protection, GitLeaks, etc.) flags a real `ApiKey` value committed to `appsettings.json` or `appsettings.Production.json`.

**Cause:** The key was put in the JSON file for convenience instead of in User Secrets / Key Vault / env vars.

**Fix:**

- **Local dev:** `dotnet user-secrets init` then `dotnet user-secrets set "MonoCloud:Management:ApiKey" "<key>"`. User Secrets is read automatically by `IConfiguration` in Development.
- **Production:** Read from your platform's secret manager (Azure Key Vault, AWS Secrets Manager, env vars on the host). Keep only `Domain` and `Timeout` in `appsettings.json`.
- **After the fact:** rotate the key in the MonoCloud dashboard immediately — assume the committed value is compromised.

## Domain with `/api` appended

**Symptom:** Every call 404s, even though credentials are correct.

**Cause:** `MonoCloud:Management:Domain` contains `/api` or `/api/v1`. The SDK appends `/api/<resource>` itself — duplicating the prefix gives `…/api/api/users`.

**Fix:** Pass the bare tenant URL: `https://acme.us.monocloud.com`. The SDK appends paths.

## How `Timeout` is interpreted across the three configuration paths

`AddMonoCloudManagementClient` accepts an `IConfiguration`, an `Action<MonoCloudManagementOptions>`, or both. All three places where you can set the timeout collapse to the same integer-seconds value internally, so they are equivalent:

| Source | Field / property | Unit |
|---|---|---|
| `IConfiguration` | `MonoCloud:Management:Timeout` (string parsed as `int`) | seconds |
| `Action<MonoCloudManagementOptions>` | `options.Timeout` (`TimeSpan?`) | uses `TotalSeconds`, so any `TimeSpan` works as written |
| Direct construction | `new MonoCloudConfig(domain, apiKey, TimeSpan.FromSeconds(N))` | `TimeSpan` is used as-is |

Pick whichever fits the call site. There is no precision loss — `TimeSpan.FromSeconds(90)` through DI gives a 90-second timeout, and `"Timeout": 90` in `appsettings.json` gives the same.

## `new MonoCloudManagementClient(...)` inside a controller / handler

**Symptom:** Slow first request per route, JWKS thrash warnings, occasional `SocketException` under load.

**Cause:** A new `MonoCloudManagementClient` (and the underlying `HttpClient`) is being constructed per request. `HttpClient` instances aren't free — Microsoft's guidance is that they should be long-lived, which is exactly what `IHttpClientFactory` provides.

**Fix:** Use `AddMonoCloudManagementClient` and inject `MonoCloudManagementClient` as a constructor / route-handler parameter. Don't `new` it inside the handler.

```csharp
// Program.cs
builder.Services.AddMonoCloudManagementClient(builder.Configuration);

// Route handler
app.MapGet("/users", async (MonoCloudManagementClient mgmt) => {
    var r = await mgmt.Users.GetAllUsersAsync(1, 25);
    return Results.Ok(r.Data);
});
```

The DI extension registers the client as transient on top of `IHttpClientFactory`, so connection pooling Just Works.

## Catching `Exception` everywhere

**Symptom:** Errors collapse into a single branch and you can't tell `NotFound` (404) from `Conflict` (409) from a validation failure (422). Or `ex.StatusCode` is unresolvable at compile time.

**Cause:** The handler is `catch (Exception)` against the base type. The SDK throws a typed hierarchy that gets discarded. Also, `MonoCloudException` itself has no `StatusCode` property — status is exposed via the specific subclass or via `MonoCloudRequestException.Response?.Status` (the parsed problem-details payload).

**Fix:** Catch the specific subclass you care about, fall through to `MonoCloudRequestException` for problem-details access, then `MonoCloudException` as the absolute base, then rethrow:

```csharp
try
{
    await mgmt.Users.CreateUserAsync(req);
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
    logger.LogError(ex, "Management API call failed: {Status} {Title}",
        ex.Response?.Status, ex.Response?.Title);
    throw;
}
catch (MonoCloudException ex)
{
    // Network / timeout / deserialization failures land here.
    logger.LogError(ex, "Management API call failed (non-HTTP)");
    throw;
}
```

## Importing from `MonoCloud.Management.Core`

**Symptom:** Build error: `The type or namespace 'MonoCloud.Management.Core' could not be found.`

**Cause:** App code adds a using or `<PackageReference>` to the internal core package. Only `MonoCloud.Management` is meant to be referenced by consumers.

**Fix:**

```csharp
// wrong
using MonoCloud.Management.Core;

// right
using MonoCloud.Management;
```

`MonoCloudConfig`, `MonoCloudResponse`, `MonoCloudException`, and the entire exception hierarchy are accessible under `MonoCloud.Management`. Remove the core package reference if `dotnet add package MonoCloud.Management.Core` was run by mistake.

## Only the first page of results

**Symptom:** `GetAllUsersAsync()` returns 10 rows; the tenant has thousands.

**Cause:** Default `size` is small. The method returns one page at a time — you need to loop on `PageData.HasNext`.

**Fix:**

```csharp
async IAsyncEnumerable<UserSummary> EachUserAsync(MonoCloudManagementClient mgmt, [EnumeratorCancellation] CancellationToken ct = default)
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

## Older training-data SDK ghosts

**Symptom:** Code references types or methods that don't compile: `MonoCloudClient` (singular), `.ManagementApi.UsersClient(...)`, `.ListUsersAsync(...)`, `.GetUsers(...)`.

**Cause:** The agent is pattern-matching against a different or imagined SDK from training data.

**Fix:** Always check the actual surface in [`api-surface.md`](api-surface.md). The real entry point is `MonoCloudManagementClient` (DI-registered or `new`-constructed with `MonoCloudConfig`); resource clients are direct properties (`.Users`, `.Clients`, `.Groups`, `.Resources`, etc.); methods follow `Get* / Find*ById / Create* / Patch* / Delete* / Disable* / Enable*` naming and end in `Async`.

## Diagnostic

```bash
node skills/monocloud-management-dotnet/scripts/verify.js /path/to/project
```

The verify script is pure Node (no .NET required) — it parses `*.csproj` for the `MonoCloud.Management` PackageReference, scans `appsettings*.json` for the `MonoCloud:Management` section, warns if an `ApiKey` literal is found in JSON, and checks `Program.cs` for `AddMonoCloudManagementClient`.
