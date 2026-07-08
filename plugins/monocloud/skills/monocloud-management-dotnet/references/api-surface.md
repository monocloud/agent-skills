# `MonoCloud.Management` — API surface

Exhaustive method-by-method surface for the `MonoCloud.Management` NuGet package, verified against `src/management/src/` and `src/core/` on **`MonoCloud.Management@0.2.10`** (repo HEAD `269ae64`, tag `v0.2.10`, clean tree). Signatures are listed **verbatim** from the client source, including default parameter values and the trailing `CancellationToken cancellationToken = default`. IDE intellisense (go-to-definition) is the source of truth for the fields of request/response DTOs under `MonoCloud.Management.Models`.

## Quick reference

The surface most apps actually reach for — full method lists and gotchas follow below.

- Entry points: `new MonoCloudManagementClient(MonoCloudConfig)` (or the `HttpClient` overload), or the DI extension `services.AddMonoCloudManagementClient(IConfiguration | Action<MonoCloudManagementOptions>)`.
- Resource clients (10): `.Users`, `.Clients`, `.Groups`, `.Resources`, `.Keys`, `.Logs`, `.NetworkZones`, `.Options`, `.Branding`, `.TrustStores`.
- Most-used methods: `Users.GetAllUsersAsync / CreateUserAsync / FindUserByIdAsync / PatchClaimsAsync / PatchPrivateDataAsync / PatchPublicDataAsync / DisableUserAsync / EnableUserAsync / ChangePasswordAsync`, `Clients.GetAllApplicationsAsync / CreateApplicationAsync / PatchApplicationAsync`, `Groups.GetAllGroupsAsync / CreateGroupAsync`, `Keys.GetAllKeyMaterialsAsync`, `Logs.GetAllLogsAsync`, `Resources.GetAllApiResourcesAsync`.
- Response wrappers: `MonoCloudResponse<T>` (`.Data`, `.Status`, `.Headers`) and `MonoCloudResponse<T, TPage>` (adds `.PageData`). Body is **`Data`** (not `Result`); status is **`Status`** (not `StatusCode`).
- Errors: subclasses of `MonoCloudRequestException` — `MonoCloudNotFoundException`, `MonoCloudConflictException`, `MonoCloudIdentityValidationException`, … Base `MonoCloudException` has no `StatusCode`; branch with `catch (MonoCloudNotFoundException) { … }` or read `(ex as MonoCloudRequestException)?.Response?.Status`.
- **No environment variables.** The .NET SDK does no env fallback — config comes from the `MonoCloud:Management` config section, a `MonoCloudManagementOptions` action, or a directly-built `MonoCloudConfig`. (You may still feed those values from env through standard .NET `IConfiguration` providers.)
- Common gotchas: `Clients.*` methods operate on the **`Application`** model (there is no `Client` model); every `Patch…Request` uses `Optional<T>` so PATCH is a true partial update; identifier params are path-only and never in the patch body; some `Resources` methods take `(scopeId, apiId)` / `(secretId, apiId)` order — copy signatures verbatim.

## Namespaces

The public surface is split across these namespaces (the package does **not** publish a single global `using`):

| Namespace | Types |
|---|---|
| `MonoCloud.Management` | `MonoCloudManagementClient`, `MonoCloudManagementOptions`, `MonoCloudManagementServiceExtensions` |
| `MonoCloud.Management.Core.Base` | `MonoCloudConfig`, `MonoCloudResponse`, `MonoCloudResponse<T>`, `MonoCloudResponse<T, TPage>`, `MonoCloudClientBase` |
| `MonoCloud.Management.Core.Exception` | `MonoCloudException` and every `MonoCloud*Exception` subclass |
| `MonoCloud.Management.Core.Models` | `ProblemDetails`, `IdentityValidationProblemDetails`, `KeyValidationProblemDetails`, `IdentityError` |
| `MonoCloud.Management.Core.Helpers` | `PageModel`, `Optional<T>`, `IOptional` (plus JSON converters — rarely referenced directly) |
| `MonoCloud.Management.Clients` | `UsersClient`, `ClientsClient`, `GroupsClient`, `ResourcesClient`, `KeysClient`, `LogsClient`, `NetworkZonesClient`, `OptionsClient`, `BrandingClient`, `TrustStoresClient` |
| `MonoCloud.Management.Models` | All request / response DTOs (`User`, `CreateUserRequest`, `Application`, `Group`, `ApiResource`, `Log`, `KeyMaterial`, …) and enums (`ApplicationTypes`, `GrantTypes`, `ExternalAuthenticators`, …) — 242 model files |

Most consumer files will need at least `MonoCloud.Management`, `MonoCloud.Management.Core.Base`, `MonoCloud.Management.Core.Exception`, and `MonoCloud.Management.Models`. Project-wide `global using` declarations (.NET 6+) keep this tidy.

## Top-level exports

.NET has no barrel/index file — every `public` type across the `MonoCloud.Management` assembly and the referenced `MonoCloud.Management.Core` assembly is exported. The handful you actually reference by name:

```csharp
using MonoCloud.Management;                 // MonoCloudManagementClient, MonoCloudManagementOptions,
                                            // MonoCloudManagementServiceExtensions (DI)
using MonoCloud.Management.Core.Base;       // MonoCloudConfig, MonoCloudResponse<…>
using MonoCloud.Management.Core.Exception;  // MonoCloudException + subclasses
using MonoCloud.Management.Core.Helpers;    // PageModel, Optional<T>
using MonoCloud.Management.Models;          // request/response DTOs + enums
using MonoCloud.Management.Clients;         // UsersClient, etc. (only if referenced by name)
```

## Main client

```csharp
public class MonoCloudManagementClient   // namespace MonoCloud.Management
{
    public MonoCloudManagementClient(MonoCloudConfig configuration);
    public MonoCloudManagementClient(HttpClient httpClient);

    public BrandingClient     Branding     { get; }
    public ClientsClient      Clients      { get; }
    public GroupsClient       Groups       { get; }
    public KeysClient         Keys         { get; }
    public LogsClient         Logs         { get; }
    public NetworkZonesClient NetworkZones { get; }
    public OptionsClient      Options      { get; }
    public ResourcesClient    Resources    { get; }
    public TrustStoresClient  TrustStores  { get; }
    public UsersClient        Users        { get; }
}
```

- `MonoCloudManagementClient(MonoCloudConfig configuration)` — `configuration` must be non-null with non-empty `Domain` and `ApiKey` (validated in `MonoCloudClientBase`; otherwise `MonoCloudException`). Builds an internal `HttpClient` with `BaseAddress = "{Domain}/api/"`, `Timeout = config.Timeout`, and header `X-API-KEY: {ApiKey}`.
- `MonoCloudManagementClient(HttpClient httpClient)` — bring your own `HttpClient`; a null argument throws `MonoCloudException`. You own `BaseAddress` (must end with `/api/`) and the `X-API-KEY` header — `MonoCloudConfig` validation/setup is bypassed. Useful for custom handlers, Polly policies, proxies, mTLS, or test doubles.

Every resource client derives from the (public, but protected-constructor) `MonoCloudClientBase` in `MonoCloud.Management.Core.Base` — only relevant if you implement a custom subclass.

## Configuration

```csharp
public class MonoCloudConfig   // namespace MonoCloud.Management.Core.Base
{
    public MonoCloudConfig(string domain, string apiKey, TimeSpan? timeout = null);

    public string   Domain  { get; }   // normalized: prepends https:// if missing, strips trailing slash
    public string   ApiKey  { get; }
    public TimeSpan Timeout { get; }    // defaults to TimeSpan.FromSeconds(10) when null
}

public class MonoCloudManagementOptions   // namespace MonoCloud.Management
{
    public string?   Domain  { get; set; }
    public string?   ApiKey  { get; set; }
    public TimeSpan? Timeout { get; set; }
}
```

## DI extension

```csharp
public static class MonoCloudManagementServiceExtensions   // namespace MonoCloud.Management
{
    public static IServiceCollection AddMonoCloudManagementClient(
        this IServiceCollection services, IConfiguration configuration);

    public static IServiceCollection AddMonoCloudManagementClient(
        this IServiceCollection services, Action<MonoCloudManagementOptions> options);

    public static IServiceCollection AddMonoCloudManagementClient(
        this IServiceCollection services,
        IConfiguration? configuration,
        Action<MonoCloudManagementOptions>? options);
}
```

Behavior:

- Reads the `MonoCloud:Management` section (`Domain`, `ApiKey`, `Timeout` — the latter an integer **seconds**, parsed via `int.TryParse`).
- When both a configuration and an options action are supplied, **the options values override configuration** when set.
- Throws `ArgumentNullException` at startup if `Domain` or `ApiKey` is missing/empty after merging.
- Registers a named `HttpClient` (`"MonoCloudManagementClient"`) via `AddHttpClient`, configured with `BaseAddress = "{Domain}/api/"`, `Timeout`, and the `X-API-KEY` header.
- Registers `MonoCloudManagementClient` as **Transient**, built from `IHttpClientFactory.CreateClient("MonoCloudManagementClient")`.

Consume it by injecting `MonoCloudManagementClient` into your services/controllers.

## Response envelopes

```csharp
// namespace MonoCloud.Management.Core.Base
public class MonoCloudResponse
{
    public int Status { get; }                                         // HTTP status code
    public IDictionary<string, IEnumerable<string>> Headers { get; }   // merged response headers
}

public class MonoCloudResponse<TResult> : MonoCloudResponse
{
    public TResult Data { get; }   // deserialized response body
}

public class MonoCloudResponse<TResult, TPage> : MonoCloudResponse<TResult>
    where TPage : PageModel
{
    public TPage PageData { get; }   // pagination metadata; TPage is always PageModel
}
```

> The body property is **`Data`**, not `Result`. The status property is **`Status`**, not `StatusCode`. `Headers` is `IDictionary<string, IEnumerable<string>>`, not a flat string map. Void/no-body operations (Delete/Revoke/Rotate/Ban-removal) return the bare `MonoCloudResponse` — read `.Status`/`.Headers` only, there is no `.Data`.

```csharp
public class PageModel   // namespace MonoCloud.Management.Core.Helpers
{
    public int  PageSize    { get; set; }
    public int  CurrentPage { get; set; }
    public int  TotalCount  { get; set; }
    public bool HasPrevious { get; set; }
    public bool HasNext     { get; set; }
}
```

`PageData` is populated from the `x-pagination` response header (JSON). When the header is absent, `PageData` is a default (zeroed) `PageModel` — never `null`.

## Exception hierarchy

All live in `MonoCloud.Management.Core.Exception`.

```csharp
public class MonoCloudException : System.Exception { }              // base; config/transport/deserialization errors
public class MonoCloudRequestException : MonoCloudException          // base for HTTP-status errors (protected ctors)
{
    public ProblemDetails? Response { get; }   // set when the server sent application/problem+json
}

public class MonoCloudBadRequestException        : MonoCloudRequestException { }   // 400
public class MonoCloudUnauthorizedException      : MonoCloudRequestException { }   // 401 (bad/missing X-API-KEY)
public class MonoCloudPaymentRequiredException   : MonoCloudRequestException { }   // 402 (subscription/billing)
public class MonoCloudForbiddenException         : MonoCloudRequestException { }   // 403 (feature not on plan)
public class MonoCloudNotFoundException          : MonoCloudRequestException { }   // 404
public class MonoCloudConflictException          : MonoCloudRequestException { }   // 409

public class MonoCloudIdentityValidationException : MonoCloudRequestException      // 422 (identity-validation-error)
{
    public IEnumerable<IdentityError> Errors { get; }   // Code + Description
}
public class MonoCloudKeyValidationException     : MonoCloudRequestException       // 422 (validation-error)
{
    public IDictionary<string, string[]> Errors { get; }   // field -> messages
}
public class MonoCloudModelStateException        : MonoCloudRequestException { }   // 422 (non-problem+json fallback)
public class MonoCloudResourceExhaustedException : MonoCloudRequestException { }   // 429 (rate limited)
public class MonoCloudServerException            : MonoCloudRequestException { }   // >= 500
```

`MonoCloudException` exposes the standard `.Message` only — it has **no** `StatusCode` property. Branch on the subclass (`catch (MonoCloudNotFoundException) { … }`) or read `(ex as MonoCloudRequestException)?.Response?.Status`. The `Response` (`ProblemDetails`) and the two 422 `Errors` shapes live in `MonoCloud.Management.Core.Models` (`ProblemDetails`, `IdentityValidationProblemDetails`, `KeyValidationProblemDetails`, `IdentityError`).

## Method conventions

- Every resource-client method is `async`, PascalCase + `Async`, with a trailing `CancellationToken cancellationToken = default`.
- Pagination parameters are `int? page = 1, int? size = 10`. `filter` and `sort` (where supported) are `string?` defaulting to `null`.
- Paginated lists return `MonoCloudResponse<List<T>, PageModel>`; non-paginated lists return `MonoCloudResponse<List<T>>` (no `PageData`); single objects return `MonoCloudResponse<T>`; void operations return `MonoCloudResponse`.
- Subscription gates are annotated inline as **[Pro]**, **[Secure+]**, or **[ScaleX]** — see [Subscription tiers](#subscription-tiers). Unannotated methods carry no tier gate in source.

---

## `client.Users` — `UsersClient`

Users: CRUD, enable/disable/unblock, identifiers (email/phone/username), passkeys, passwords, claims, private/public data, blocked IPs, sessions, group membership, and grants/tokens.

Lifecycle:

- `GetAllUsersAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<UserSummary>, PageModel>>`
- `CreateUserAsync(CreateUserRequest createUserRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `FindUserByIdAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `DeleteUserAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`
- `EnableUserAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `DisableUserAsync(string userId, DisableUserRequest disableUserRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `UnblockUserAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`

Username:

- `UpdateUsernameAsync(string userId, UpdateUsernameRequest updateUsernameRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `RemoveUsernameAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`

Emails (identifier id is a `Guid`):

- `AddEmailAsync(string userId, AddEmailRequest addEmailRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `RemoveEmailAsync(string userId, Guid identifierId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `SetPrimaryEmailAsync(string userId, Guid identifierId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `SetEmailVerifiedAsync(string userId, Guid identifierId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `SetEmailUnverifiedAsync(string userId, Guid identifierId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `VerifyEmailAsync(string userId, Guid identifierId, VerifyEmailRequest verifyEmailRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<VerifyEmailResponse>>`

Phones (identifier id is a `Guid`):

- `AddPhoneAsync(string userId, AddPhoneRequest addPhoneRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `RemovePhoneAsync(string userId, Guid identifierId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `SetPrimaryPhoneAsync(string userId, Guid identifierId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `SetPhoneVerifiedAsync(string userId, Guid identifierId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `SetPhoneUnverifiedAsync(string userId, Guid identifierId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`

Passkeys / passwords:

- `RemovePasskeyAsync(string userId, string passkeyId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`
- `SetPasswordAsync(string userId, SetPasswordRequest setPasswordRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `RemovePasswordAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`
- `SetPasswordResetRequiredAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `RemovePasswordResetRequiredAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `ResetPasswordAsync(string userId, ResetPasswordRequest resetPasswordRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ResetPasswordResponse>>`
- `ChangePasswordAsync(string userId, ChangePasswordRequest changePasswordRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`

Claims / public / private data:

- `PatchClaimsAsync(string userId, UpdateClaimsRequest updateClaimsRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`
- `GetPrivateDataAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<UserPrivateData>>`
- `PatchPrivateDataAsync(string userId, UpdatePrivateDataRequest updatePrivateDataRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<UserPrivateData>>`
- `GetPublicDataAsync(string userId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<UserPublicData>>`
- `PatchPublicDataAsync(string userId, UpdatePublicDataRequest updatePublicDataRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<UserPublicData>>`

Blocked IPs:

- `GetAllBlockedIpsAsync(string userId, int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<UserIpAccessDetails>, PageModel>>`
- `UnblockIpAsync(string userId, UnblockIpRequest unblockIpRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>`

Sessions **[Pro]**:

- `GetAllUserSessionsAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<UserSession>, PageModel>>` **[Pro]**
- `FindUserSessionAsync(string userId, string sessionId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<UserSession>>` **[Pro]**
- `RevokeUserSessionAsync(string userId, string sessionId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>` **[Pro]**

External authenticator:

- `ExternalAuthenticatorDisconnectAsync(string userId, ExternalAuthenticatorDisconnectRequest externalAuthenticatorDisconnectRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<User>>` — `req.Authenticator` is an `ExternalAuthenticators` enum.

Group membership (queryable from both sides; `groupId` is a `Guid`):

- `GetAllUserGroupsAsync(string userId, int? page = 1, int? size = 10, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<UserGroup>, PageModel>>`
- `FindUserGroupAsync(string userId, Guid groupId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<UserGroup>>`
- `AssignUserToGroupAsync(string userId, Guid groupId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<UserGroup>>`
- `RemoveUserFromGroupAsync(string userId, Guid groupId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`
- `GetAllGroupAssignedUsersAsync(Guid groupId, int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<UserSummary>, PageModel>>` — group-side view.

Grants / consents / tokens / codes:

- `GetAllUserClientGrantsAsync(string userId, int? page = 1, int? size = 10, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<UserClientGrants>, PageModel>>` **[Pro]**
- `GetAllUserConsentsAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<UserConsent>, PageModel>>` **[Secure+]**
- `GetAllReferenceTokensAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sessionId = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<ReferenceToken>, PageModel>>` **[Secure+]**
- `GetAllRefreshTokensAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sessionId = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<RefreshToken>, PageModel>>` **[Secure+]**
- `GetAllAuthorizationCodesAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sessionId = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<AuthorizationCode>, PageModel>>` **[Secure+]**
- `RevokeUserClientGrantsAsync(string userId, string clientId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>` **[Secure+]**
- `RevokeUserConsentAsync(string userId, string consentId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>` **[Secure+]**
- `RevokeReferenceTokenAsync(string userId, string tokenId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>` **[Secure+]**
- `RevokeRefreshTokenAsync(string userId, string tokenId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>` **[Secure+]**
- `RevokeAuthorizationCodeAsync(string userId, string codeId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>` **[Secure+]**

## `client.Clients` — `ClientsClient`

OAuth/OIDC applications. The accessor is `.Clients`, but the resource is the **`Application`** model — every method is named `*Application*` and there is no `Client` model. The path param is named `clientId` (a `string`).

Applications:

- `GetAllApplicationsAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<Application>, PageModel>>`
- `CreateApplicationAsync(CreateApplicationRequest createApplicationRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Application>>`
- `FindApplicationByIdAsync(string clientId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Application>>`
- `PatchApplicationAsync(string clientId, PatchApplicationRequest patchApplicationRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Application>>`
- `DeleteApplicationAsync(string clientId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

> `PatchApplicationRequest` exposes ~40+ mutable `Optional<T>` fields (`Enabled`, `AppType`, `TechType`, `ClientName`, `RedirectUris`, token lifetimes, consent flags, …) but no `ClientId`. Some fields carry their own subscription gate at the property level — e.g. `EnableConsent` (**Secure+**), PAR/JAR, back-channel logout, reference tokens, and extended refresh-token lifetimes — documented in the model's XML `<note>` comments. See [Subscription tiers](#subscription-tiers).

Application secrets:

- `GetAllApplicationSecretsAsync(string clientId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<Secret>>>` (not paginated)
- `CreateApplicationSecretAsync(string clientId, CreateSecretRequest createSecretRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Secret>>`
- `FindApplicationSecretByIdAsync(string clientId, string secretId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Secret>>`
- `DeleteApplicationSecretAsync(string clientId, string secretId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

Application ↔ group mapping (`groupId` is a `Guid`):

- `GetAllApplicationGroupsAsync(string clientId, int? page = 1, int? size = 10, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<ApplicationGroup>, PageModel>>`
- `FindApplicationGroupAsync(string clientId, Guid groupId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ApplicationGroup>>`
- `AssignGroupToApplicationAsync(string clientId, Guid groupId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>` **[ScaleX]**
- `RemoveGroupFromApplicationAsync(string clientId, Guid groupId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>` **[ScaleX]**
- `GetAllGroupAssignedApplicationsAsync(Guid groupId, int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<Application>, PageModel>>` — group-side view.

## `client.Groups` — `GroupsClient`

Group CRUD. Membership assignment lives on `UsersClient` / `ClientsClient`, not here — there are no `AddGroupMember` / `RemoveGroupMember` methods. `groupId` is a `Guid`.

- `GetAllGroupsAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<Group>, PageModel>>`
- `CreateGroupAsync(CreateGroupRequest createGroupRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Group>>` **[Pro — only when creating more than two groups]**
- `FindGroupByIdAsync(Guid groupId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Group>>`
- `PatchGroupAsync(Guid groupId, PatchGroupRequest patchGroupRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Group>>`
- `DeleteGroupAsync(Guid groupId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

## `client.Resources` — `ResourcesClient`

API resources (audiences) + secrets, API scopes, API access policies (basic/advanced), plus tenant-wide identity scopes and claim resources.

> **Parameter-order gotchas:** `FindApiResourceSecretByIdAsync(secretId, apiId, …)` and the API-scope find/patch/delete methods take `(scopeId, apiId, …)` — the scope/secret id comes **before** `apiId` — whereas `DeleteApiResourceSecretAsync(apiId, secretId, …)` and the create methods take `apiId` first. Copy signatures verbatim.

API resources:

- `GetAllApiResourcesAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<ApiResource>, PageModel>>`
- `CreateApiResourceAsync(CreateApiResourceRequest createApiResourceRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ApiResource>>`
- `FindApiResourceByIdAsync(string apiId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ApiResource>>`
- `PatchApiResourceAsync(string apiId, PatchApiResourceRequest patchApiResourceRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ApiResource>>`
- `DeleteApiResourceAsync(string apiId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

API resource secrets:

- `GetAllApiResourceSecretsAsync(string apiId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<Secret>>>` (not paginated)
- `CreateApiResourceSecretAsync(string apiId, CreateSecretRequest createSecretRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Secret>>` **[ScaleX]**
- `FindApiResourceSecretByIdAsync(string secretId, string apiId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Secret>>` — note order: `(secretId, apiId)`.
- `DeleteApiResourceSecretAsync(string apiId, string secretId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>` — note order: `(apiId, secretId)`.

API scopes (resource-scoped; find/patch/delete take `(scopeId, apiId)`):

- `GetAllApiScopesAsync(string apiId, int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<ApiScope>, PageModel>>`
- `CreateApiScopeAsync(string apiId, CreateApiScopeRequest createApiScopeRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ApiScope>>`
- `FindApiScopeByIdAsync(string scopeId, string apiId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ApiScope>>`
- `PatchApiScopeAsync(string scopeId, string apiId, PatchApiScopeRequest patchApiScopeRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ApiScope>>`
- `DeleteApiScopeAsync(string scopeId, string apiId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

API access policies (per resource). Basic policies use structured conditions; advanced policies use the policy-expression DSL. `ConvertApiAccessBasicToAdvancedPolicyAsync` turns a basic policy into an advanced one (one-way):

- `GetAllApiAccessPoliciesAsync(string apiId, int? page = 1, int? size = 10, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<ApiAccessPolicy>, PageModel>>` — returns the union; branch on `Type`.
- `CreateApiAccessBasicPolicyAsync(string apiId, CreateApiAccessBasicPolicyRequest createApiAccessBasicPolicyRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<BasicApiAccessPolicy>>`
- `FindApiAccessBasicPolicyByIdAsync(string apiId, string policyId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<BasicApiAccessPolicy>>`
- `PatchApiAccessBasicPolicyAsync(string apiId, string policyId, PatchApiAccessBasicPolicyRequest patchApiAccessBasicPolicyRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<BasicApiAccessPolicy>>`
- `DeleteApiAccessBasicPolicyAsync(string apiId, string policyId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`
- `ConvertApiAccessBasicToAdvancedPolicyAsync(string apiId, string policyId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<AdvancedApiAccessPolicy>>`
- `CreateApiAccessAdvancedPolicyAsync(string apiId, CreateApiAccessAdvancedPolicyRequest createApiAccessAdvancedPolicyRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<AdvancedApiAccessPolicy>>`
- `FindApiAccessAdvancedPolicyByIdAsync(string apiId, string policyId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<AdvancedApiAccessPolicy>>`
- `PatchApiAccessAdvancedPolicyAsync(string apiId, string policyId, PatchApiAccessAdvancedPolicyRequest patchApiAccessAdvancedPolicyRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<AdvancedApiAccessPolicy>>`
- `DeleteApiAccessAdvancedPolicyAsync(string apiId, string policyId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

Identity scopes (tenant-wide):

- `GetAllScopesAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<Scope>, PageModel>>`
- `CreateScopeAsync(CreateScopeRequest createScopeRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Scope>>`
- `FindScopeByIdAsync(string scopeId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Scope>>`
- `PatchScopeAsync(string scopeId, PatchScopeRequest patchScopeRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Scope>>`
- `DeleteScopeAsync(string scopeId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

Claim resources:

- `GetAllClaimResourcesAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<ClaimResource>, PageModel>>`
- `CreateClaimResourceAsync(CreateClaimResourceRequest createClaimResourceRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ClaimResource>>`
- `FindClaimResourceByIdAsync(string claimId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ClaimResource>>`
- `PatchClaimResourceAsync(string claimId, PatchClaimResourceRequest patchClaimResourceRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ClaimResource>>`
- `DeleteClaimResourceAsync(string claimId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

## `client.Keys` — `KeysClient`

Signing key material: list, rotate, revoke. There is no `CreateKeyAsync` / `FindKeyByIdAsync`.

- `GetAllKeyMaterialsAsync(int? page = 1, int? size = 10, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<KeyMaterial>, PageModel>>`
- `RotateKeyAsync(string keyId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`
- `RevokeKeyAsync(string keyId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

## `client.Logs` — `LogsClient`

Audit/event logs. `logId` is a `Guid`.

- `GetAllLogsAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<Log>, PageModel>>`
- `FindLogByIdAsync(Guid logId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<Log>>`

## `client.NetworkZones` — `NetworkZonesClient`

IP-based and region-based network zones referenced by API access policies. The whole feature is **[ScaleX]**; the create/patch endpoints carry the source-level note explicitly. `GetAllNetworkZonesAsync` returns the polymorphic `INetworkZone` union — branch on `Type` (concrete `IpNetworkZone` / `RegionalNetworkZone`).

- `GetAllNetworkZonesAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<INetworkZone>, PageModel>>`

IP zones:

- `CreateIpNetworkZoneAsync(CreateIpNetworkZoneRequest createIpNetworkZoneRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<IpNetworkZone>>` **[ScaleX]**
- `FindIpNetworkZoneByIdAsync(string zoneId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<IpNetworkZone>>`
- `PatchIpNetworkZoneAsync(string zoneId, PatchIpNetworkZoneRequest patchIpNetworkZoneRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<IpNetworkZone>>` **[ScaleX]**
- `DeleteIpNetworkZoneAsync(string zoneId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

Regional zones:

- `CreateRegionalNetworkZoneAsync(CreateRegionalNetworkZoneRequest createRegionalNetworkZoneRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<RegionalNetworkZone>>` **[ScaleX]**
- `FindRegionalNetworkZoneByIdAsync(string zoneId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<RegionalNetworkZone>>`
- `PatchRegionalNetworkZoneAsync(string zoneId, PatchRegionalNetworkZoneRequest patchRegionalNetworkZoneRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<RegionalNetworkZone>>` **[ScaleX]**
- `DeleteRegionalNetworkZoneAsync(string zoneId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

`NetworkZoneCategory` and `NetworkZoneOperator` are enums on the request/response models — refer to IDE intellisense for valid values.

## `client.Options` — `OptionsClient`

Tenant-wide options: authentication options, communication (email/SMS provider) options, and sign-up custom field CRUD. Per-provider authenticator/MFA *option shapes* ride on the option models rather than as discrete methods.

- `FindAuthenticationOptionsAsync(CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<AuthenticationOptions>>`
- `PatchAuthenticationOptionsAsync(PatchAuthenticationOptionsRequest patchAuthenticationOptionsRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<AuthenticationOptions>>`
- `FindCommunicationOptionsAsync(CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<CommunicationOptions>>`
- `PatchCommunicationOptionsAsync(PatchCommunicationOptionsRequest patchCommunicationOptionsRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<CommunicationOptions>>`

Sign-up custom fields (keyed by `claimName`):

- `GetAllSignUpCustomFieldsAsync(CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<SignUpCustomField>>>` (not paginated)
- `CreateSignUpCustomFieldAsync(CreateSignUpCustomFieldRequest createSignUpCustomFieldRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<SignUpCustomField>>`
- `FindSignUpCustomFieldByNameAsync(string claimName, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<SignUpCustomField>>`
- `PatchSignUpCustomFieldAsync(string claimName, PatchSignUpCustomFieldRequest patchSignUpCustomFieldRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<SignUpCustomField>>`
- `DeleteSignUpCustomFieldAsync(string claimName, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

## `client.Branding` — `BrandingClient`

Branding options for hosted pages, emails, and SMS. Three surfaces, each `Find* / Patch*`; there is no umbrella `GetBrandingAsync`.

- `FindPageBrandingOptionsAsync(CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<PageBrandingOptions>>`
- `PatchPageBrandingOptionsAsync(PatchPageBrandingOptionsRequest patchPageBrandingOptionsRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<PageBrandingOptions>>`
- `FindEmailBrandingOptionsAsync(CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<EmailBrandingOptions>>`
- `PatchEmailBrandingOptionsAsync(PatchEmailBrandingOptionsRequest patchEmailBrandingOptionsRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<EmailBrandingOptions>>`
- `FindSmsBrandingOptionsAsync(CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<SmsBrandingOptions>>`
- `PatchSmsBrandingOptionsAsync(PatchSmsBrandingOptionsRequest patchSmsBrandingOptionsRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<SmsBrandingOptions>>`

## `client.TrustStores` — `TrustStoresClient`

Two independent trust-store families — **PKI** (X.509 / mTLS) and **SPIFFE** — each with its own CRUD and default-selection surface, plus certificate revocations and a ban list on the PKI side and a banned-SVID list on the SPIFFE side.

PKI trust stores:

- `GetAllPkiTrustStoresAsync(int? page = 1, int? size = 10, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<PkiTrustStoreSummary>, PageModel>>`
- `CreatePkiTrustStoreAsync(CreatePkiTrustStoreRequest createPkiTrustStoreRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<PkiTrustStore>>`
- `FindPkiTrustStoreByIdAsync(string trustStoreId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<PkiTrustStore>>`
- `PatchPkiTrustStoreAsync(string trustStoreId, PatchPkiTrustStoreRequest patchPkiTrustStoreRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<PkiTrustStore>>`
- `DeletePkiTrustStoreAsync(string trustStoreId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`
- `SetPkiTrustStoreDefaultAsync(string trustStoreId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<PkiTrustStore>>`

Certificate revocations (PKI). `AddCertificateRevocationAsync` / `FindCertificateRevocationAsync` return the polymorphic `ICertificateRevocation` (`BaseCertificateRevocation` / `DeltaCertificateRevocation`); `RevocationGrouped` (+ `RevocationGroupedDelta`) is the paginated list shape:

- `GetAllRevocationsAsync(string trustStoreId, int? page = 1, int? size = 10, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<RevocationGrouped>, PageModel>>`
- `AddCertificateRevocationAsync(string trustStoreId, AddCertificateRevocationRequest addCertificateRevocationRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ICertificateRevocation>>`
- `FindCertificateRevocationAsync(string trustStoreId, string revocationId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<ICertificateRevocation>>`
- `RemoveCertificateRevocationAsync(string trustStoreId, string revocationId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

Banned certificates (PKI):

- `GetAllPkiBannedCertificatesAsync(string trustStoreId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<BannedCertificate>>>` (not paginated)
- `BanPkiTrustStoreCertificateAsync(string trustStoreId, BanTrustStoreCertificateRequest banTrustStoreCertificateRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<BannedCertificate>>`
- `UnbanPkiTrustStoreCertificateAsync(string trustStoreId, string banId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

SPIFFE trust stores:

- `GetAllSpiffeTrustStoresAsync(int? page = 1, int? size = 10, string? sort = default, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<SpiffeTrustStoreSummary>, PageModel>>`
- `CreateSpiffeTrustStoreAsync(CreateSpiffeTrustStoreRequest createSpiffeTrustStoreRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<SpiffeTrustStore>>`
- `FindSpiffeTrustStoreByIdAsync(string trustStoreId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<SpiffeTrustStore>>`
- `PatchSpiffeTrustStoreAsync(string trustStoreId, PatchSpiffeTrustStoreRequest patchSpiffeTrustStoreRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<SpiffeTrustStore>>`
- `DeleteSpiffeTrustStoreAsync(string trustStoreId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`
- `SetSpiffeTrustStoreDefaultAsync(string trustStoreId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<SpiffeTrustStore>>`

Banned SVIDs (SPIFFE):

- `GetAllSpiffeBannedSvidsAsync(string trustStoreId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<List<BannedSvid>>>` (not paginated)
- `BanSpiffeTrustStoreSvidAsync(string trustStoreId, BanTrustStoreSvidRequest banTrustStoreSvidRequest, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse<BannedSvid>>`
- `UnbanSpiffeTrustStoreSvidAsync(string trustStoreId, string banId, CancellationToken cancellationToken = default)` → `Task<MonoCloudResponse>`

Trust-store sources include S3 (added in 0.2.8). Key models: `PkiTrustStore` / `PkiTrustStoreSummary` / `PkiTrustStoreOptions`, `SpiffeTrustStore` / `SpiffeTrustStoreSummary` / `SpiffeTrustStoreOptions`, the `Create…` / `Patch…` `Pki` / `Spiffe` `TrustStore(Options)Request` types, `BannedCertificate`, `BannedSvid`, `BanTrustStoreCertificateRequest`, `BanTrustStoreSvidRequest`, `AddCertificateRevocationRequest`, `ICertificateRevocation` (+ `BaseCertificateRevocation` / `DeltaCertificateRevocation`), and `RevocationGrouped` (+ `RevocationGroupedDelta`).

---

## Subscription tiers

The server returns `MonoCloudForbiddenException` (403) — or `MonoCloudPaymentRequiredException` (402) — when the tenant's plan is insufficient. Gates are grounded in the `<note>` XML comments in `src/management/src/Clients/*.cs`. Methods not listed here carry no tier gate in source.

| Tier | Gated methods |
|---|---|
| **Pro** | `Groups.CreateGroupAsync` (only when creating **more than two** groups); `Users.GetAllUserSessionsAsync`, `Users.FindUserSessionAsync`, `Users.RevokeUserSessionAsync`; `Users.GetAllUserClientGrantsAsync` |
| **Secure+** | `Users.GetAllUserConsentsAsync`, `GetAllReferenceTokensAsync`, `GetAllRefreshTokensAsync`, `GetAllAuthorizationCodesAsync`; `Users.RevokeUserClientGrantsAsync`, `RevokeUserConsentAsync`, `RevokeReferenceTokenAsync`, `RevokeRefreshTokenAsync`, `RevokeAuthorizationCodeAsync` |
| **ScaleX** | All `NetworkZones` create/patch endpoints (`CreateIpNetworkZoneAsync`, `PatchIpNetworkZoneAsync`, `CreateRegionalNetworkZoneAsync`, `PatchRegionalNetworkZoneAsync`); `Clients.AssignGroupToApplicationAsync`, `RemoveGroupFromApplicationAsync`; `Resources.CreateApiResourceSecretAsync` |

> **Field-level gates.** Some request *fields* require a higher tier even on otherwise-free endpoints — e.g. `EnableConsent` (Secure+, on `CreateApplicationRequest` / `PatchApplicationRequest`), PAR/JAR, back-channel logout, session binding, multi-audience tokens, reference tokens, and extended refresh-token lifetimes. These are documented in individual model-property XML `<note>` comments; treat those as the source of truth.

## PATCH semantics

Every `Patch…Request` property is `Optional<T>` (namespace `MonoCloud.Management.Core.Helpers`). Only properties you explicitly assign are serialized (a custom `PatchConverter` plus `JsonIgnoreCondition.WhenWritingNull` omit unset ones), so PATCH is a **true partial update** — unset fields are left unchanged, and `Optional<string?>` lets you distinguish "set to null" from "not provided".

Resource identifiers are **path-only** and never appear in a patch body, so they cannot be changed via PATCH: `clientId` (Application), `apiId` (ApiResource), `groupId` (Group), `zoneId` (NetworkZone), `trustStoreId`, `scopeId`, `claimId`, and `claimName` (sign-up custom field).

## Filter / sort / pagination

- Pagination params are `int? page = 1` (1-indexed) and `int? size = 10`. `PageData` (pagination metadata) arrives in the `x-pagination` response header, not the body.
- `filter` (where present) is a server-side query string; `sort` is a server-side sort expression. Both are `string?` defaulting to `null`. Some list endpoints scope the query further via a typed param instead of `filter` — e.g. `clientId` / `sessionId` on the session/grant/token lists.
- **Non-paginated lists** (no `PageData`) return `MonoCloudResponse<List<T>>`: `GetAllApplicationSecretsAsync`, `GetAllApiResourceSecretsAsync`, `GetAllSignUpCustomFieldsAsync`, `GetAllPkiBannedCertificatesAsync`, `GetAllSpiffeBannedSvidsAsync`. Everything else with a `GetAll…` name is paginated.

## GUID vs string ids

Group ids and user-identifier ids are `Guid` (`groupId`, `identifierId`, `logId`). User / application / resource / zone / trust-store / session ids are `string`.

## Defaults

- `Timeout`: `TimeSpan.FromSeconds(10)` when `MonoCloudConfig` is built without an explicit value — raise it (via `Timeout` config/option) for long-running admin calls.
- Pagination is 1-indexed; the server picks its own default `size` per endpoint (typically 10).
- JSON conventions: snake_case property naming (`SnakeCaseNamingPolicy`), enums serialized snake_case via `JsonStringEnumConverter`, and epoch/unix-seconds datetimes via `EpochDateTimeConverter`.

## Environment variables / configuration

**The .NET SDK (v0.2.10) reads no environment variables.** There is no `MONOCLOUD_MANAGEMENT_*` fallback anywhere in source (unlike the JS SDK). Config comes only from the `MonoCloud:Management` config section, a `MonoCloudManagementOptions` action, or a directly-constructed `MonoCloudConfig`.

| Source | Key / property | Required? | Purpose |
|---|---|---|---|
| `IConfiguration` | `MonoCloud:Management:Domain` | yes | Tenant URL (no `/api`; `https://` prepended if missing) |
| `IConfiguration` | `MonoCloud:Management:ApiKey` | yes | Management API key (sent as `X-API-KEY`) |
| `IConfiguration` | `MonoCloud:Management:Timeout` | no | Integer **seconds**, parsed via `int.TryParse`; falls back to the 10s default |
| Options action | `MonoCloudManagementOptions.Domain` | yes* | Overrides the config value when set |
| Options action | `MonoCloudManagementOptions.ApiKey` | yes* | Overrides the config value when set |
| Options action | `MonoCloudManagementOptions.Timeout` | no | A `TimeSpan`; overrides the config value when set |

\* Either the config section or the options action must supply `Domain` and `ApiKey`; DI throws `ArgumentNullException` at startup if both leave them empty. You can still feed these from environment variables through standard .NET `IConfiguration` providers (e.g. the environment-variables provider maps `MonoCloud__Management__Domain` → `MonoCloud:Management:Domain`) — that is a .NET configuration feature, not an SDK env fallback.
