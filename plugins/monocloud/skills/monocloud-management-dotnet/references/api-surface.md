# `MonoCloud.Management` — API surface

Exhaustive surface for the `MonoCloud.Management` NuGet package, verified against `src/management/` and `src/core/`. Method signatures are listed verbatim with default parameter values. IDE intellisense (go-to-definition) is the source of truth for request/response DTO fields under `MonoCloud.Management.Models`.

## Quick reference

The surface most apps actually reach for — full method lists, request types, and gotchas follow below.

- Entry points: `new MonoCloudManagementClient(MonoCloudConfig)` (or `HttpClient` overload), or the DI extension `services.AddMonoCloudManagementClient(IConfiguration | Action<MonoCloudManagementOptions>)`.
- Resource clients: `.Users`, `.Clients`, `.Groups`, `.Resources`, `.Keys`, `.Logs`, `.Options`, `.Branding`, `.TrustStores`.
- Most-used methods: `Users.GetAllUsersAsync / CreateUserAsync / FindUserByIdAsync / PatchPrivateDataAsync / PatchPublicDataAsync / PatchClaimsAsync / DisableUserAsync / EnableUserAsync`, `Clients.GetAllApplicationsAsync / CreateApplicationAsync / PatchApplicationAsync`, `Groups.GetAllGroupsAsync / CreateGroupAsync`, `Keys.GetAllKeyMaterialsAsync`, `Logs.GetAllLogsAsync`.
- Response wrappers: `MonoCloudResponse<T>` (`.Data`, `.Status`, `.Headers`) and `MonoCloudResponse<T, TPage>` (adds `.PageData`). Body is **`Data`** (not `Result`); status is **`Status`** (not `StatusCode`).
- Errors: subclasses of `MonoCloudRequestException` — `MonoCloudNotFoundException`, `MonoCloudConflictException`, `MonoCloudIdentityValidationException`, … Base `MonoCloudException` has no `StatusCode`; branch with `catch (MonoCloudNotFoundException) { ... }` or read `(ex as MonoCloudRequestException)?.Response?.Status`.
- Common gotchas: `Clients.*` methods are `*Application*` (not `*Client*`); see troubleshooting for the rest.

## Namespaces

The public surface is split across these namespaces (the package does **not** publish a single global `using`):

| Namespace | Types |
|---|---|
| `MonoCloud.Management` | `MonoCloudManagementClient`, `MonoCloudManagementOptions`, `MonoCloudManagementServiceExtensions` |
| `MonoCloud.Management.Core.Base` | `MonoCloudConfig`, `MonoCloudResponse`, `MonoCloudResponse<T>`, `MonoCloudResponse<T, TPage>`, `MonoCloudClientBase` |
| `MonoCloud.Management.Core.Exception` | `MonoCloudException` and every `MonoCloud*Exception` subclass, plus `ProblemDetails`, `IdentityValidationProblemDetails`, `KeyValidationProblemDetails`, `IdentityError` |
| `MonoCloud.Management.Core.Helpers` | `PageModel` |
| `MonoCloud.Management.Clients` | `UsersClient`, `ClientsClient`, `GroupsClient`, `ResourcesClient`, `KeysClient`, `LogsClient`, `OptionsClient`, `BrandingClient`, `TrustStoresClient` |
| `MonoCloud.Management.Models` | All request / response DTOs (`User`, `CreateUserRequest`, `Application`, `Group`, `ApiResource`, `Log`, `KeyMaterial`, `TrustStore`, etc.) and enums (`ExternalAuthenticators`, `ApplicationTypes`, `GrantTypes`, …) |

Most consumer files will need at least `MonoCloud.Management`, `MonoCloud.Management.Core.Base`, `MonoCloud.Management.Core.Exception`, and `MonoCloud.Management.Models`. Project-wide `global using` declarations (.NET 6+) are the usual way to keep this tidy.

## Top-level types

```csharp
using MonoCloud.Management;
using MonoCloud.Management.Core.Base;     // MonoCloudConfig
using MonoCloud.Management.Clients;       // UsersClient, etc. (only if you reference them by name)

// Client
public class MonoCloudManagementClient
{
    public MonoCloudManagementClient(MonoCloudConfig configuration);
    public MonoCloudManagementClient(HttpClient httpClient);

    public BrandingClient    Branding    { get; }
    public ClientsClient     Clients     { get; }
    public GroupsClient      Groups      { get; }
    public KeysClient        Keys        { get; }
    public LogsClient        Logs        { get; }
    public OptionsClient     Options     { get; }
    public ResourcesClient   Resources   { get; }
    public TrustStoresClient TrustStores { get; }
    public UsersClient       Users       { get; }
}
```

`MonoCloudClientBase` (the abstract parent of every resource client) lives in `MonoCloud.Management.Core.Base` and is useful only when implementing custom subclasses.

## Configuration

```csharp
public class MonoCloudConfig
{
    public MonoCloudConfig(string domain, string apiKey, TimeSpan? timeout = null);

    public string  Domain  { get; }   // normalized: forces https://, strips trailing slash
    public string  ApiKey  { get; }
    public TimeSpan Timeout { get; }  // defaults to TimeSpan.FromSeconds(10)
}

public class MonoCloudManagementOptions
{
    public string?   Domain  { get; set; }
    public string?   ApiKey  { get; set; }
    public TimeSpan? Timeout { get; set; }   // any TimeSpan; reduced to whole seconds internally
}
```

When constructed from `MonoCloudConfig`, the client creates an internal `HttpClient` with:

- `BaseAddress = "{Domain}/api/"` — `/api/` is appended automatically. Do **not** include `/api` in `Domain`.
- `Timeout = config.Timeout`.
- `DefaultRequestHeaders.Add("X-API-KEY", apiKey)`.

When constructed from an external `HttpClient`, the SDK uses it as-is and does **not** add the `X-API-KEY` header itself — you own that wiring (helpful for integration tests).

## DI extension

```csharp
public static class MonoCloudManagementServiceExtensions
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

- Reads `MonoCloud:Management:Domain`, `MonoCloud:Management:ApiKey`, and `MonoCloud:Management:Timeout` (integer **seconds**, parsed by `int.TryParse`) from `IConfiguration`.
- If `Action<MonoCloudManagementOptions>` is also provided, its values override the configuration; `options.Timeout` is read as `TotalSeconds` (so any `TimeSpan` value lands intact).
- Throws `ArgumentNullException` at startup if `Domain` or `ApiKey` is missing.
- Registers a named `HttpClient` (`"MonoCloudManagementClient"`) via `AddHttpClient`, configured with `BaseAddress = "{Domain}/api/"`, `Timeout`, and the `X-API-KEY` header.
- Registers `MonoCloudManagementClient` as **transient** backed by `IHttpClientFactory`.

## Response envelopes

```csharp
public class MonoCloudResponse
{
    public int Status { get; }
    public IDictionary<string, IEnumerable<string>> Headers { get; }
}

public class MonoCloudResponse<TResult> : MonoCloudResponse
{
    public TResult Data { get; }
}

public class MonoCloudResponse<TResult, TPage> : MonoCloudResponse<TResult>
    where TPage : PageModel
{
    public TPage PageData { get; }   // always present; populated from the X-Pagination header
}
```

> The body property is **`Data`**, not `Result`. The status property is **`Status`**, not `StatusCode`. `Headers` is `IDictionary<string, IEnumerable<string>>`, not a flat string-to-string map.

```csharp
public class PageModel
{
    public int  PageSize     { get; set; }
    public int  CurrentPage  { get; set; }
    public int  TotalCount   { get; set; }
    public bool HasPrevious  { get; set; }
    public bool HasNext      { get; set; }
}
```

When the `X-Pagination` header is missing, `PageData` is a `PageModel` with all defaults (`0` / `false`) — not `null`.

## Exception hierarchy

```csharp
public class MonoCloudException : Exception
{
    public MonoCloudException(string message);

    public static MonoCloudException ThrowErr(ProblemDetails problemDetails);   // maps by problemDetails.Status
    public static MonoCloudException ThrowErr(int statusCode, string? message); // maps by raw status
}

public class MonoCloudRequestException : MonoCloudException
{
    public ProblemDetails? Response { get; }   // populated when the server sent application/problem+json
}

public class MonoCloudBadRequestException        : MonoCloudRequestException { }                                 // 400
public class MonoCloudUnauthorizedException      : MonoCloudRequestException { }                                 // 401
public class MonoCloudPaymentRequiredException   : MonoCloudRequestException { }                                 // 402
public class MonoCloudForbiddenException         : MonoCloudRequestException { }                                 // 403
public class MonoCloudNotFoundException          : MonoCloudRequestException { }                                 // 404
public class MonoCloudConflictException          : MonoCloudRequestException { }                                 // 409

public class MonoCloudIdentityValidationException : MonoCloudRequestException                                    // 422 (identity validation)
{
    public IEnumerable<IdentityError> Errors { get; set; }
}

public class MonoCloudKeyValidationException     : MonoCloudRequestException                                     // 422 (key/value validation)
{
    public IDictionary<string, string[]> Errors { get; set; }
}

public class MonoCloudModelStateException        : MonoCloudRequestException { }                                 // 422 (other)
public class MonoCloudResourceExhaustedException : MonoCloudRequestException { }                                 // 429
public class MonoCloudServerException            : MonoCloudRequestException { }                                 // 5xx
```

`MonoCloudException` exposes the standard `.Message` (inherited from `Exception`). It does **not** have a `StatusCode` property — branch on the subclass with `catch (MonoCloudNotFoundException) { ... }`, or read `(ex as MonoCloudRequestException)?.Response?.Status`.

```csharp
public class ProblemDetails
{
    public string Type     { get; set; }
    public string Title    { get; set; }
    public int    Status   { get; set; }
    public string Detail   { get; set; }
    public string Instance { get; set; }
    // arbitrary extension properties via indexer
}

public class IdentityValidationProblemDetails : ProblemDetails
{
    public IEnumerable<IdentityError> Errors { get; set; }
}

public class KeyValidationProblemDetails : ProblemDetails
{
    public IDictionary<string, string[]> Errors { get; set; }
}

public class IdentityError
{
    public string Code        { get; set; }
    public string Description { get; set; }
}
```

## Method conventions

All resource-client methods are async and follow this shape:

```csharp
public Task<MonoCloudResponse<T>>            <Name>Async(<params>, CancellationToken cancellationToken = default);
public Task<MonoCloudResponse<T, PageModel>> <Name>Async(int? page = 1, int? size = 10, ..., CancellationToken cancellationToken = default);
public Task<MonoCloudResponse>               <Name>Async(<params>, CancellationToken cancellationToken = default);   // void responses (DELETEs, revokes)
```

Pagination parameters are `int?` with defaults of `1` / `10`. `filter` and `sort` (where supported) are `string?` with default `null`.

## `Users` — `UsersClient`

User lifecycle and identifiers.

| Method | Returns |
|---|---|
| `GetAllUsersAsync(page=1, size=10, filter=null, sort=null, ct)` | `MonoCloudResponse<List<UserSummary>, PageModel>` |
| `CreateUserAsync(CreateUserRequest req, ct)` | `MonoCloudResponse<User>` |
| `FindUserByIdAsync(string userId, ct)` | `MonoCloudResponse<User>` |
| `DeleteUserAsync(string userId, ct)` | `MonoCloudResponse` |
| `EnableUserAsync(string userId, ct)` | `MonoCloudResponse<User>` |
| `DisableUserAsync(string userId, DisableUserRequest req, ct)` | `MonoCloudResponse<User>` |
| `UnblockUserAsync(string userId, ct)` | `MonoCloudResponse<User>` |
| `UpdateUsernameAsync(string userId, UpdateUsernameRequest req, ct)` | `MonoCloudResponse<User>` |
| `RemoveUsernameAsync(string userId, ct)` | `MonoCloudResponse<User>` |

Emails:

- `AddEmailAsync(userId, AddEmailRequest req, ct)` → `MonoCloudResponse<User>`
- `RemoveEmailAsync(userId, Guid identifierId, ct)` → `MonoCloudResponse<User>`
- `SetPrimaryEmailAsync(userId, Guid identifierId, ct)` → `MonoCloudResponse<User>`
- `SetEmailVerifiedAsync(userId, Guid identifierId, ct)` → `MonoCloudResponse<User>`
- `SetEmailUnverifiedAsync(userId, Guid identifierId, ct)` → `MonoCloudResponse<User>`
- `VerifyEmailAsync(userId, Guid identifierId, VerifyEmailRequest req, ct)` → `MonoCloudResponse<VerifyEmailResponse>`

Phones:

- `AddPhoneAsync(userId, AddPhoneRequest req, ct)` → `MonoCloudResponse<User>`
- `RemovePhoneAsync(userId, Guid identifierId, ct)` → `MonoCloudResponse<User>`
- `SetPrimaryPhoneAsync(userId, Guid identifierId, ct)` → `MonoCloudResponse<User>`
- `SetPhoneVerifiedAsync(userId, Guid identifierId, ct)` → `MonoCloudResponse<User>`
- `SetPhoneUnverifiedAsync(userId, Guid identifierId, ct)` → `MonoCloudResponse<User>`

Passkeys / passwords:

- `RemovePasskeyAsync(userId, string passkeyId, ct)` → `MonoCloudResponse`
- `SetPasswordAsync(userId, SetPasswordRequest req, ct)` → `MonoCloudResponse<User>`
- `RemovePasswordAsync(userId, ct)` → `MonoCloudResponse`
- `SetPasswordResetRequiredAsync(userId, ct)` → `MonoCloudResponse<User>`
- `RemovePasswordResetRequiredAsync(userId, ct)` → `MonoCloudResponse<User>`
- `ResetPasswordAsync(userId, ResetPasswordRequest req, ct)` → `MonoCloudResponse<ResetPasswordResponse>`
- `ChangePasswordAsync(userId, ChangePasswordRequest req, ct)` → `MonoCloudResponse<User>`

Claims / public / private data:

- `PatchClaimsAsync(userId, UpdateClaimsRequest req, ct)` → `MonoCloudResponse<User>`
- `GetPrivateDataAsync(userId, ct)` → `MonoCloudResponse<UserPrivateData>`
- `PatchPrivateDataAsync(userId, UpdatePrivateDataRequest req, ct)` → `MonoCloudResponse<UserPrivateData>`
- `GetPublicDataAsync(userId, ct)` → `MonoCloudResponse<UserPublicData>`
- `PatchPublicDataAsync(userId, UpdatePublicDataRequest req, ct)` → `MonoCloudResponse<UserPublicData>`

IP access:

- `GetAllBlockedIpsAsync(userId, page=1, size=10, filter=null, sort=null, ct)` → `MonoCloudResponse<List<UserIpAccessDetails>, PageModel>`
- `UnblockIpAsync(userId, UnblockIpRequest req, ct)` → `MonoCloudResponse<User>`

Sessions:

- `GetAllUserSessionsAsync(userId, page=1, size=10, clientId=null, sort=null, ct)` → `MonoCloudResponse<List<UserSession>, PageModel>`
- `FindUserSessionAsync(userId, string sessionId, ct)` → `MonoCloudResponse<UserSession>`
- `RevokeUserSessionAsync(userId, string sessionId, ct)` → `MonoCloudResponse`

External authenticator:

- `ExternalAuthenticatorDisconnectAsync(userId, ExternalAuthenticatorDisconnectRequest req, ct)` → `MonoCloudResponse<User>` — `req.Authenticator` is an `ExternalAuthenticators` enum.

Groups (membership lives on the user, queryable from both sides):

- `GetAllUserGroupsAsync(userId, page=1, size=10, sort=null, ct)` → `MonoCloudResponse<List<UserGroup>, PageModel>`
- `FindUserGroupAsync(userId, Guid groupId, ct)` → `MonoCloudResponse<UserGroup>`
- `AssignUserToGroupAsync(userId, Guid groupId, ct)` → `MonoCloudResponse<UserGroup>`
- `RemoveUserFromGroupAsync(userId, Guid groupId, ct)` → `MonoCloudResponse`
- `GetAllGroupAssignedUsersAsync(Guid groupId, page=1, size=10, filter=null, sort=null, ct)` → `MonoCloudResponse<List<UserSummary>, PageModel>` — group-side view.

Grants, consents, tokens, codes:

- `GetAllUserClientGrantsAsync(userId, page=1, size=10, ct)` → `MonoCloudResponse<List<UserClientGrants>, PageModel>`
- `GetAllUserConsentsAsync(userId, page=1, size=10, clientId=null, sort=null, ct)` → `MonoCloudResponse<List<UserConsent>, PageModel>`
- `GetAllReferenceTokensAsync(userId, page=1, size=10, clientId=null, sessionId=null, sort=null, ct)` → `MonoCloudResponse<List<ReferenceToken>, PageModel>`
- `GetAllRefreshTokensAsync(userId, page=1, size=10, clientId=null, sessionId=null, sort=null, ct)` → `MonoCloudResponse<List<RefreshToken>, PageModel>`
- `GetAllAuthorizationCodesAsync(userId, page=1, size=10, clientId=null, sessionId=null, sort=null, ct)` → `MonoCloudResponse<List<AuthorizationCode>, PageModel>`
- `RevokeUserClientGrantsAsync(userId, string clientId, ct)` → `MonoCloudResponse`
- `RevokeUserConsentAsync(userId, string consentId, ct)` → `MonoCloudResponse`
- `RevokeReferenceTokenAsync(userId, string tokenId, ct)` → `MonoCloudResponse`
- `RevokeRefreshTokenAsync(userId, string tokenId, ct)` → `MonoCloudResponse`
- `RevokeAuthorizationCodeAsync(userId, string codeId, ct)` → `MonoCloudResponse`

> The user's identifier on responses is `User.UserId` (string) — the SDK serializes JSON snake_case (`user_id`) into camel-case .NET properties.

## `Clients` — `ClientsClient`

OAuth applications. The property is `.Clients`, but methods are named after the underlying REST resource (`Application`).

| Method | Returns |
|---|---|
| `GetAllApplicationsAsync(page=1, size=10, filter=null, sort=null, ct)` | `MonoCloudResponse<List<Application>, PageModel>` |
| `CreateApplicationAsync(CreateApplicationRequest req, ct)` | `MonoCloudResponse<Application>` |
| `FindApplicationByIdAsync(string clientId, ct)` | `MonoCloudResponse<Application>` |
| `PatchApplicationAsync(string clientId, PatchApplicationRequest req, ct)` | `MonoCloudResponse<Application>` |
| `DeleteApplicationAsync(string clientId, ct)` | `MonoCloudResponse` |

Application secrets:

- `GetAllApplicationSecretsAsync(clientId, ct)` → `MonoCloudResponse<List<Secret>>` (not paginated)
- `CreateApplicationSecretAsync(clientId, CreateSecretRequest req, ct)` → `MonoCloudResponse<Secret>`
- `FindApplicationSecretByIdAsync(clientId, string secretId, ct)` → `MonoCloudResponse<Secret>`
- `DeleteApplicationSecretAsync(clientId, string secretId, ct)` → `MonoCloudResponse`

Application ↔ group mapping:

- `GetAllApplicationGroupsAsync(clientId, page=1, size=10, sort=null, ct)` → `MonoCloudResponse<List<ApplicationGroup>, PageModel>`
- `FindApplicationGroupAsync(clientId, Guid groupId, ct)` → `MonoCloudResponse<ApplicationGroup>`
- `AssignGroupToApplicationAsync(clientId, Guid groupId, ct)` → `MonoCloudResponse`
- `RemoveGroupFromApplicationAsync(clientId, Guid groupId, ct)` → `MonoCloudResponse`
- `GetAllGroupAssignedApplicationsAsync(Guid groupId, page=1, size=10, filter=null, sort=null, ct)` → `MonoCloudResponse<List<Application>, PageModel>`

## `Groups` — `GroupsClient`

| Method | Returns |
|---|---|
| `GetAllGroupsAsync(page=1, size=10, filter=null, sort=null, ct)` | `MonoCloudResponse<List<Group>, PageModel>` |
| `CreateGroupAsync(CreateGroupRequest req, ct)` | `MonoCloudResponse<Group>` |
| `FindGroupByIdAsync(Guid groupId, ct)` | `MonoCloudResponse<Group>` |
| `PatchGroupAsync(Guid groupId, PatchGroupRequest req, ct)` | `MonoCloudResponse<Group>` |
| `DeleteGroupAsync(Guid groupId, ct)` | `MonoCloudResponse` |

Group membership is managed from the user side via `Users.AssignUserToGroupAsync` / `Users.RemoveUserFromGroupAsync`. There are no `AddGroupMember` / `RemoveGroupMember` methods on `GroupsClient`.

## `Resources` — `ResourcesClient`

API resources, scopes, claim resources.

API resources:

- `GetAllApiResourcesAsync(page=1, size=10, filter=null, sort=null, ct)` → `MonoCloudResponse<List<ApiResource>, PageModel>`
- `CreateApiResourceAsync(CreateApiResourceRequest req, ct)` → `MonoCloudResponse<ApiResource>`
- `FindApiResourceByIdAsync(string apiId, ct)` → `MonoCloudResponse<ApiResource>`
- `PatchApiResourceAsync(string apiId, PatchApiResourceRequest req, ct)` → `MonoCloudResponse<ApiResource>`
- `DeleteApiResourceAsync(string apiId, ct)` → `MonoCloudResponse`

API resource secrets:

- `GetAllApiResourceSecretsAsync(string apiId, ct)` → `MonoCloudResponse<List<Secret>>` (not paginated)
- `CreateApiResourceSecretAsync(string apiId, CreateSecretRequest req, ct)` → `MonoCloudResponse<Secret>`
- `FindApiResourceSecretByIdAsync(string secretId, string apiId, ct)` → `MonoCloudResponse<Secret>`
- `DeleteApiResourceSecretAsync(string apiId, string secretId, ct)` → `MonoCloudResponse`

API scopes (resource-scoped):

- `GetAllApiScopesAsync(string apiId, page=1, size=10, filter=null, sort=null, ct)` → `MonoCloudResponse<List<ApiScope>, PageModel>`
- `CreateApiScopeAsync(string apiId, CreateApiScopeRequest req, ct)` → `MonoCloudResponse<ApiScope>`
- `FindApiScopeByIdAsync(string scopeId, string apiId, ct)` → `MonoCloudResponse<ApiScope>`
- `PatchApiScopeAsync(string scopeId, string apiId, PatchApiScopeRequest req, ct)` → `MonoCloudResponse<ApiScope>`
- `DeleteApiScopeAsync(string scopeId, string apiId, ct)` → `MonoCloudResponse`

API resource ↔ client mappings:

- `GetAllApiResourceClientsAsync(string apiId, page=1, size=10, sort=null, ct)` → `MonoCloudResponse<List<ApiResourceClient>, PageModel>`
- `GetAllClientApiResourcesAsync(string clientId, page=1, size=10, sort=null, ct)` → `MonoCloudResponse<List<ApiResourceClient>, PageModel>`
- `CreateApiResourceClientAsync(string apiId, string clientId, CreateApiResourceClientRequest req, ct)` → `MonoCloudResponse<ApiResourceClient>`
- `FindApiResourceClientAsync(string apiId, string clientId, ct)` → `MonoCloudResponse<ApiResourceClient>`
- `PatchApiResourceClientAsync(string apiId, string clientId, PatchApiResourceClientRequest req, ct)` → `MonoCloudResponse<ApiResourceClient>`
- `RemoveApiResourceClientAsync(string apiId, string clientId, ct)` → `MonoCloudResponse`

Identity scopes (tenant-wide):

- `GetAllScopesAsync(page=1, size=10, filter=null, sort=null, ct)` → `MonoCloudResponse<List<Scope>, PageModel>`
- `CreateScopeAsync(CreateScopeRequest req, ct)` → `MonoCloudResponse<Scope>`
- `FindScopeByIdAsync(string scopeId, ct)` → `MonoCloudResponse<Scope>`
- `PatchScopeAsync(string scopeId, PatchScopeRequest req, ct)` → `MonoCloudResponse<Scope>`
- `DeleteScopeAsync(string scopeId, ct)` → `MonoCloudResponse`

Claim resources:

- `GetAllClaimResourcesAsync(page=1, size=10, filter=null, sort=null, ct)` → `MonoCloudResponse<List<ClaimResource>, PageModel>`
- `CreateClaimResourceAsync(CreateClaimResourceRequest req, ct)` → `MonoCloudResponse<ClaimResource>`
- `FindClaimResourceByIdAsync(string claimId, ct)` → `MonoCloudResponse<ClaimResource>`
- `PatchClaimResourceAsync(string claimId, PatchClaimResourceRequest req, ct)` → `MonoCloudResponse<ClaimResource>`
- `DeleteClaimResourceAsync(string claimId, ct)` → `MonoCloudResponse`

## `Keys` — `KeysClient`

- `GetAllKeyMaterialsAsync(page=1, size=10, ct)` → `MonoCloudResponse<List<KeyMaterial>, PageModel>`
- `RotateKeyAsync(string keyId, ct)` → `MonoCloudResponse`
- `RevokeKeyAsync(string keyId, ct)` → `MonoCloudResponse`

There is no `CreateKeyAsync`, `FindKeyByIdAsync`, or `GetAllKeysAsync` — those don't exist in the SDK.

## `Logs` — `LogsClient`

- `GetAllLogsAsync(page=1, size=10, filter=null, sort=null, ct)` → `MonoCloudResponse<List<Log>, PageModel>`
- `FindLogByIdAsync(Guid logId, ct)` → `MonoCloudResponse<Log>`

## `Options` — `OptionsClient`

Tenant-wide settings. The SDK currently exposes `Authentication`, `Communication`, and sign-up-custom-fields. Per-provider external authenticator options and other tenant areas are not surfaced as discrete methods.

- `FindAuthenticationOptionsAsync(ct)` → `MonoCloudResponse<AuthenticationOptions>`
- `PatchAuthenticationOptionsAsync(PatchAuthenticationOptionsRequest req, ct)` → `MonoCloudResponse<AuthenticationOptions>`
- `FindCommunicationOptionsAsync(ct)` → `MonoCloudResponse<CommunicationOptions>`
- `PatchCommunicationOptionsAsync(PatchCommunicationOptionsRequest req, ct)` → `MonoCloudResponse<CommunicationOptions>`

Sign-up custom fields:

- `GetAllSignUpCustomFieldsAsync(ct)` → `MonoCloudResponse<List<SignUpCustomField>>`
- `CreateSignUpCustomFieldAsync(CreateSignUpCustomFieldRequest req, ct)` → `MonoCloudResponse<SignUpCustomField>`
- `FindSignUpCustomFieldByNameAsync(string claimName, ct)` → `MonoCloudResponse<SignUpCustomField>`
- `PatchSignUpCustomFieldAsync(string claimName, PatchSignUpCustomFieldRequest req, ct)` → `MonoCloudResponse<SignUpCustomField>`
- `DeleteSignUpCustomFieldAsync(string claimName, ct)` → `MonoCloudResponse`

## `Branding` — `BrandingClient`

Three distinct surfaces, each with `Find* / Patch*`:

- `FindPageBrandingOptionsAsync(ct)` → `MonoCloudResponse<PageBrandingOptions>`
- `PatchPageBrandingOptionsAsync(PatchPageBrandingOptionsRequest req, ct)` → `MonoCloudResponse<PageBrandingOptions>`
- `FindEmailBrandingOptionsAsync(ct)` → `MonoCloudResponse<EmailBrandingOptions>`
- `PatchEmailBrandingOptionsAsync(PatchEmailBrandingOptionsRequest req, ct)` → `MonoCloudResponse<EmailBrandingOptions>`
- `FindSmsBrandingOptionsAsync(ct)` → `MonoCloudResponse<SmsBrandingOptions>`
- `PatchSmsBrandingOptionsAsync(PatchSmsBrandingOptionsRequest req, ct)` → `MonoCloudResponse<SmsBrandingOptions>`

There is no umbrella `GetBrandingAsync` / `PatchBrandingAsync`.

## `TrustStores` — `TrustStoresClient`

mTLS trust stores, plus revocation and ban lists.

Trust stores:

- `GetAllTrustStoresAsync(page=1, size=10, sort=null, ct)` → `MonoCloudResponse<List<TrustStoreSummary>, PageModel>`
- `CreateTrustStoreAsync(CreateTrustStoreRequest req, ct)` → `MonoCloudResponse<TrustStore>`
- `FindTrustStoreByIdAsync(string trustStoreId, ct)` → `MonoCloudResponse<TrustStore>`
- `PatchTrustStoreAsync(string trustStoreId, PatchTrustStoreRequest req, ct)` → `MonoCloudResponse<TrustStore>`
- `DeleteTrustStoreAsync(string trustStoreId, ct)` → `MonoCloudResponse`
- `SetTrustStoreDefaultAsync(string trustStoreId, ct)` → `MonoCloudResponse<TrustStore>`

Certificate revocations:

- `GetAllRevocationsAsync(string trustStoreId, page=1, size=10, sort=null, ct)` → `MonoCloudResponse<List<RevocationGrouped>, PageModel>`
- `AddCertificateRevocationAsync(string trustStoreId, AddCertificateRevocationRequest req, ct)` → `MonoCloudResponse<CertificateRevocation>`
- `FindCertificateRevocationAsync(string trustStoreId, string revocationId, ct)` → `MonoCloudResponse<CertificateRevocation>`
- `RemoveCertificateRevocationAsync(string trustStoreId, string revocationId, ct)` → `MonoCloudResponse`

Banned certificates:

- `GetAllBannedCertificatesAsync(string trustStoreId, ct)` → `MonoCloudResponse<List<BannedCertificate>>` (not paginated)
- `BanTrustStoreCertificateAsync(string trustStoreId, BanTrustStoreCertificateRequest req, ct)` → `MonoCloudResponse<BannedCertificate>`
- `UnbanTrustStoreCertificateAsync(string trustStoreId, string banId, ct)` → `MonoCloudResponse`

## Defaults

- `Timeout`: `TimeSpan.FromSeconds(10)` when `MonoCloudConfig` is constructed without an explicit value.
- Pagination `page` is 1-indexed; the server picks its own default `size` per endpoint (typically 10).

## Environment-variable / configuration mapping

| Source | Key / Property | Required? | Purpose |
|---|---|---|---|
| `IConfiguration` | `MonoCloud:Management:Domain` | yes | Tenant URL (no `/api`) |
| `IConfiguration` | `MonoCloud:Management:ApiKey` | yes | Management API key (sent as `X-API-KEY`) |
| `IConfiguration` | `MonoCloud:Management:Timeout` | no | Integer **seconds** |
| Environment | `MonoCloud__Management__Domain` | — | Linux/CI mapping for `Domain` |
| Environment | `MonoCloud__Management__ApiKey` | — | Linux/CI mapping for `ApiKey` |
| Environment | `MonoCloud__Management__Timeout` | — | Linux/CI mapping for `Timeout` |

`Action<MonoCloudManagementOptions>` overrides `IConfiguration` when both are supplied. `Timeout` can come from either path with the same semantics — integer seconds in config, `TimeSpan` in the action (read as `TotalSeconds` and truncated to whole seconds internally).
