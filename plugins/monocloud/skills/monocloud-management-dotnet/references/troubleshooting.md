# Troubleshooting — `MonoCloud.Management`

Symptom → cause → fix. The exception table is in [SKILL.md](../SKILL.md#errors); signatures are in [api-surface.md](api-surface.md).

## 401 on every call

**Symptom:** every call throws `MonoCloudUnauthorizedException`, including reads such as `Users.GetAllUsersAsync`.

**Cause:** the `X-API-KEY` header is missing or wrong — the key isn't bound, or it belongs to a different tenant than `Domain`. With `new MonoCloudManagementClient(HttpClient)` the header is yours to add.

**Fix:**

1. Check the binding without printing the secret: `builder.Configuration["MonoCloud:Management:ApiKey"] is null` means it isn't bound.
2. Usual binding mistakes: a different section name (`MonoCloudManagement`), User Secrets set on another project (they follow the startup project's `<UserSecretsId>`), or an environment variable with single underscores (use `MonoCloud__Management__ApiKey`).
3. Use a key and a `Domain` from the same tenant.

## Startup and construction exceptions

| Exception and message | Cause | Fix |
|---|---|---|
| `ArgumentNullException`: "The domain for the MonoCloud Management client has not been set." / "The api key for the MonoCloud Management client has not been set." | `AddMonoCloudManagementClient` found no `Domain` / `ApiKey` in configuration or options | Supply `MonoCloud:Management:Domain` / `ApiKey` (appsettings, User Secrets, `MonoCloud__Management__*` env vars) or set them in the options action |
| `MonoCloudException`: "API Key is required" / "Configuration is required" / "HttpClient is required" | Direct construction with a blank key, a `null` `MonoCloudConfig`, or a `null` `HttpClient` | Pass real values |
| `NullReferenceException` from the `MonoCloudConfig` constructor | `domain` was `null` | Pass the tenant URL |
| `UriFormatException`: "Invalid URI: The hostname could not be parsed." | `domain` was blank (it normalizes to `https://`) | Pass the tenant URL |
| `ArgumentOutOfRangeException` when the client is constructed or resolved | `Timeout` of zero or less — including an options `TimeSpan` under one second, which truncates to `0` | Use a positive number of seconds |

## `MONOCLOUD_MANAGEMENT_*` environment variables are ignored

**Symptom:** `MONOCLOUD_MANAGEMENT_DOMAIN` / `MONOCLOUD_MANAGEMENT_API_KEY` (the Node.js SDK's names) are set, but registration still reports a missing domain or key.

**Cause:** this SDK reads no environment variables itself; values reach it only through `IConfiguration`, `MonoCloudManagementOptions`, or `MonoCloudConfig`.

**Fix:** use the .NET configuration mapping — `MonoCloud__Management__Domain`, `MonoCloud__Management__ApiKey`, `MonoCloud__Management__Timeout` (double underscores; `WebApplication.CreateBuilder` and `Host.CreateDefaultBuilder` include the environment-variables provider) — or read your own variable and pass it through the options action.

## Every call 404s or can't connect

**Symptom:** calls 404, or throw `HttpRequestException` (host not found), even though the key is right.

**Cause:** a malformed `Domain` or base address:

- `Domain` ends in `/api` → requests go to `…/api/api/…`.
- `Domain` starts with `http://` → it becomes `https://http://…`, whose host is `http`.
- A custom `HttpClient` whose `BaseAddress` lacks the trailing slash (`…/api`) → relative paths resolve outside `/api/`.

**Fix:** use the bare `https://` tenant URL (`https://your-tenant.us.monocloud.com`). For a custom `HttpClient`, set `BaseAddress = new Uri("https://your-tenant.us.monocloud.com/api/")`.

## Requests time out

**Symptom:** long list or bulk calls throw `TaskCanceledException` after about 10 seconds.

**Cause:** the default timeout is 10 s, and timeouts aren't wrapped in a `MonoCloudException`. Configuration values that `int.TryParse` rejects (`"30s"`, `30.5`) silently keep the default.

**Fix:** raise it — `"Timeout": 60` (seconds) under `MonoCloud:Management`, `options.Timeout = TimeSpan.FromSeconds(60)`, or `new MonoCloudConfig(domain, apiKey, TimeSpan.FromSeconds(60))`. A custom `HttpClient` uses its own `Timeout` (100 s unless changed). Pass a `CancellationToken` for per-call limits.

## Socket exhaustion or slow calls under load

**Symptom:** `SocketException`s or rising latency under load.

**Cause:** `new MonoCloudManagementClient(config)` per request — every instance creates ten new `HttpClient`s.

**Fix:** register with `AddMonoCloudManagementClient` and inject `MonoCloudManagementClient` (transient over `IHttpClientFactory`), or create one instance and reuse it.

## API key exposed

**Symptom:** a secret scanner flags the key in `appsettings*.json` or `launchSettings.json`, or the key shows up in browser or mobile code.

**Cause:** the key was stored in committed configuration or used outside trusted server code. It is a tenant-management credential.

**Fix:** rotate the key in the MonoCloud dashboard. Keep it in User Secrets for development (`dotnet user-secrets set "MonoCloud:Management:ApiKey" "<key>"`) and in a secret manager or host environment variable in production; leave only `Domain` / `Timeout` in `appsettings.json`. Call the Management API only from server code — browser and mobile sign-in use the MonoCloud auth SDKs (e.g. `@monocloud/auth-web-js`, `@monocloud/auth-react`, `@monocloud/auth-nextjs`).

## Exception handling doesn't compile or misses errors

- **`ex.StatusCode` doesn't exist** (CS1061). Catch the specific type, or read `ex.Response?.Status` on a `MonoCloudRequestException`.
- **CS0160** ("A previous catch clause already catches all exceptions of this or of a super type"). Order `catch` blocks most-derived first: concrete classes, then `MonoCloudCodedException`, then `MonoCloudRequestException`, then `MonoCloudException`.
- **`catch (MonoCloudException)` misses errors.** Network errors (`HttpRequestException`), timeouts (`TaskCanceledException`), malformed JSON (`JsonException`), and statuses outside the mapped set (plain `System.Exception`) aren't `MonoCloudException`s — handle them separately if needed.

## `ErrorCode` is null or doesn't compile, or `TraceId` is empty

**Cause:**

1. **Wrong type.** Only the `MonoCloudCodedException` subclasses — `MonoCloudBadRequestException`, `MonoCloudPaymentRequiredException`, `MonoCloudForbiddenException`, `MonoCloudNotFoundException`, `MonoCloudConflictException` — have `ErrorCode`. The 401/422/429/5xx exceptions, and variables typed `MonoCloudRequestException` / `MonoCloudException`, don't (CS1061).
2. **No code was sent.** The API reported the status without a code, or the body wasn't `application/problem+json` (then `Response` is `null`). That alone isn't a problem.
3. **Member names.** `ErrorCode` / `TraceId` bind only the `error_code` / `trace_id` members (case-sensitive); any other member, such as `traceId`, lands in `ex.Response.ExtensionData` as a `JsonElement`.

**Fix:** catch a coded type before reading `ErrorCode`, treat it as nullable, and compare only against codes you've observed — the SDK has no constants for them. For logging, read `ex.Response?.ErrorCode`, `ex.Response?.TraceId`, and if needed `ex.Response?.ExtensionData`.

## Type or namespace not found

**Symptom:** `MonoCloudConfig`, `MonoCloudResponse<T>`, `MonoCloudNotFoundException`, or `PageModel` can't be found, or a `MonoCloud.Management.Core` package reference was added to "fix" it.

**Cause:** these types live in `MonoCloud.Management.Core.*` namespaces that need their own `using` directives; the package adds no global usings.

**Fix:** add the `using` block from [SKILL.md](../SKILL.md#client-surface) and remove any direct `MonoCloud.Management.Core` reference — it comes with `MonoCloud.Management`.

## Only the first page of results

**Symptom:** `GetAllUsersAsync()` returns 10 items on a large tenant.

**Cause:** paginated methods default to `page = 1, size = 10` and return a single page.

**Fix:** loop until `response.PageData.HasNext` is `false` (see the [pagination loop](../SKILL.md#responses-and-pagination)). The six unpaged lists, such as `GetAllApplicationSecretsAsync`, return everything in `Data` and have no `PageData`.

## PATCH questions

- **Will unset fields be cleared?** No. `Patch*Request` properties are `Optional<T>`, and only assigned ones are sent. Assign `null` to clear a nullable field.
- **CS0117 "'PatchApiResourceRequest' does not contain a definition for 'Audience'"** (or `ClientId`, `Name`, …). Ids are path parameters, not body properties: pass the id as the method argument. To change an immutable value — an API audience, or the `Name` of a scope or claim — delete and recreate the resource.

## `Resources` call hits the wrong resource

**Symptom:** a `Resources.*` secret or scope call compiles but 404s.

**Cause:** both ids are `string`, and `FindApiResourceSecretByIdAsync(secretId, apiId)` and `Find`/`Patch`/`DeleteApiScopeAsync(scopeId, apiId, …)` take the child id first, unlike `DeleteApiResourceSecretAsync(apiId, secretId)` and the access-policy methods.

**Fix:** use named arguments, e.g. `FindApiScopeByIdAsync(scopeId: scopeId, apiId: apiId)`. Signatures: [api-surface.md](api-surface.md#resources--resourcesclient).

## Rejected for subscription tier

**Symptom:** a call that compiles fails at runtime with `MonoCloudForbiddenException` (403).

**Cause:** the method, or a request field you set, needs a higher plan — see the [method tiers](../SKILL.md#subscription-tiers) and [field-level gates](api-surface.md#field-level-subscription-gates).

**Fix:** confirm the tenant's plan, or stop sending the gated field. Show operators `ex.Response?.Detail` and `ex.ErrorCode`.

## Diagnostic script

From the skill directory: `node scripts/verify.js /path/to/project` ([source](../scripts/verify.js)). Pure Node, no .NET needed. It checks the `MonoCloud.Management` reference (`*.csproj`, `Directory.Packages.props`, `packages.config`), the `MonoCloud:Management` section of `appsettings*.json` (domain format, timeout value, committed API keys), `launchSettings.json` and environment variables, User Secrets, and the DI or direct-construction wiring in `*.cs` files.
