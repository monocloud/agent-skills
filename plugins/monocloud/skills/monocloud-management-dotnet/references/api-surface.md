# `MonoCloud.Management` — API surface

Verified against `MonoCloud.Management@0.3.0` (`monocloud/management-dotnet` @ `b99754f`).

Entry points, envelopes, exceptions, and every resource-client method. For the fields of request/response models, use go-to-definition on the `MonoCloud.Management.Models` types.

## Namespaces

| Namespace | Types |
|---|---|
| `MonoCloud.Management` | `MonoCloudManagementClient`, `MonoCloudManagementOptions`, `MonoCloudManagementServiceExtensions` |
| `MonoCloud.Management.Clients` | `UsersClient`, `ClientsClient`, `GroupsClient`, `ResourcesClient`, `KeysClient`, `LogsClient`, `NetworkZonesClient`, `OptionsClient`, `BrandingClient`, `TrustStoresClient` |
| `MonoCloud.Management.Models` | Request/response models and enums (`User`, `CreateUserRequest`, `Application`, `PatchApplicationRequest`, `Group`, `Log`, `ApplicationTypes`, `GrantTypes`, `ExternalAuthenticators`, …) |
| `MonoCloud.Management.Core.Base` | `MonoCloudConfig`, `MonoCloudResponse`, `MonoCloudResponse<TResult>`, `MonoCloudResponse<TResult, TPage>`, `MonoCloudClientBase` |
| `MonoCloud.Management.Core.Exception` | `MonoCloudException` and its subclasses, `ValidationExceptionTypes` |
| `MonoCloud.Management.Core.Models` | `ProblemDetails`, `IdentityValidationProblemDetails`, `KeyValidationProblemDetails`, `IdentityError` |
| `MonoCloud.Management.Core.Helpers` | `PageModel`, `Optional<T>`, `IOptional`, `PatchConverter<T>`, `SnakeCaseNamingPolicy`, epoch `DateTime` converters |

The package adds no global usings to consuming projects; import the namespaces you use.

## Entry points

```csharp
// namespace MonoCloud.Management
public class MonoCloudManagementClient
{
    public MonoCloudManagementClient(MonoCloudConfig configuration);
    public MonoCloudManagementClient(HttpClient httpClient);

    public BrandingClient Branding { get; }
    public ClientsClient Clients { get; }
    public GroupsClient Groups { get; }
    public KeysClient Keys { get; }
    public LogsClient Logs { get; }
    public NetworkZonesClient NetworkZones { get; }
    public OptionsClient Options { get; }
    public ResourcesClient Resources { get; }
    public TrustStoresClient TrustStores { get; }
    public UsersClient Users { get; }
}

public class MonoCloudManagementOptions
{
    public string? Domain { get; set; }
    public string? ApiKey { get; set; }
    public TimeSpan? Timeout { get; set; }
}

public static class MonoCloudManagementServiceExtensions
{
    public static IServiceCollection AddMonoCloudManagementClient(this IServiceCollection services, IConfiguration configuration);
    public static IServiceCollection AddMonoCloudManagementClient(this IServiceCollection services, Action<MonoCloudManagementOptions> options);
    public static IServiceCollection AddMonoCloudManagementClient(this IServiceCollection services, IConfiguration? configuration, Action<MonoCloudManagementOptions>? options);
}

// namespace MonoCloud.Management.Core.Base
public class MonoCloudConfig
{
    public MonoCloudConfig(string domain, string apiKey, TimeSpan? timeout = null);

    public string Domain { get; }     // "https://" prepended unless it already starts with it; one trailing "/" removed
    public string ApiKey { get; }
    public TimeSpan Timeout { get; }  // TimeSpan.FromSeconds(10) when timeout is null
}
```

| Construction | Validation | HTTP setup |
|---|---|---|
| `new MonoCloudManagementClient(MonoCloudConfig)` | `null` config → `MonoCloudException("Configuration is required")`; blank `ApiKey` → `MonoCloudException("API Key is required")`. `MonoCloudConfig` itself doesn't validate (see [troubleshooting](troubleshooting.md#startup-and-construction-exceptions) for bad domains) | Each of the ten resource clients creates its own `HttpClient`: `BaseAddress = {Domain}/api/`, `Timeout`, `X-API-KEY` default header |
| `new MonoCloudManagementClient(HttpClient)` | `null` → `MonoCloudException("HttpClient is required")` | The one client is shared as-is: you set `BaseAddress` (`…/api/`, trailing slash) and `X-API-KEY`; its own `Timeout` applies |
| `AddMonoCloudManagementClient(…)` | Reads `MonoCloud:Management` → `Domain`, `ApiKey`, `Timeout` (`int.TryParse`, seconds); non-null option values override (`Timeout` cast to whole seconds); empty `Domain` / `ApiKey` → `ArgumentNullException` at registration | Named client `"MonoCloudManagementClient"` (base address, timeout, header); `MonoCloudManagementClient` registered **transient** as `new MonoCloudManagementClient(factory.CreateClient("MonoCloudManagementClient"))` |

Each resource client (namespace `MonoCloud.Management.Clients`) derives from `MonoCloudClientBase` and has the same public `(MonoCloudConfig)` and `(HttpClient)` constructors, so one can also be used on its own.

## Response envelopes

```csharp
// namespace MonoCloud.Management.Core.Base
public class MonoCloudResponse
{
    public int Status { get; }
    public IDictionary<string, IEnumerable<string>> Headers { get; }   // response + content headers
}

public class MonoCloudResponse<TResult> : MonoCloudResponse
{
    public TResult Data { get; }
}

public class MonoCloudResponse<TResult, TPage> : MonoCloudResponse<TResult> where TPage : PageModel
{
    public TPage PageData { get; }   // TPage is PageModel on every paginated method
}

// namespace MonoCloud.Management.Core.Helpers
public class PageModel
{
    public int PageSize { get; set; }
    public int CurrentPage { get; set; }
    public int TotalCount { get; set; }
    public bool HasPrevious { get; set; }
    public bool HasNext { get; set; }
}
```

`PageData` is parsed from the JSON `x-pagination` response header; without the header it is a zero-valued `PageModel`. A 2xx body that deserializes to `null` throws `MonoCloudException("Invalid response body")`.

## Exceptions

```csharp
// namespace MonoCloud.Management.Core.Exception
public class MonoCloudException : System.Exception { }

public class MonoCloudRequestException : MonoCloudException              // protected constructors
{
    public ProblemDetails? Response { get; }   // null when the body wasn't application/problem+json
}

public abstract class MonoCloudCodedException : MonoCloudRequestException
{
    public string? ErrorCode => Response?.ErrorCode;
}

public class MonoCloudBadRequestException : MonoCloudCodedException { }          // 400
public class MonoCloudPaymentRequiredException : MonoCloudCodedException { }     // 402
public class MonoCloudForbiddenException : MonoCloudCodedException { }           // 403
public class MonoCloudNotFoundException : MonoCloudCodedException { }            // 404
public class MonoCloudConflictException : MonoCloudCodedException { }            // 409
public class MonoCloudUnauthorizedException : MonoCloudRequestException { }      // 401
public class MonoCloudIdentityValidationException : MonoCloudRequestException    // 422
{
    public IEnumerable<IdentityError> Errors { get; set; }   // IdentityError: string Code, string Description
}
public class MonoCloudKeyValidationException : MonoCloudRequestException         // 422
{
    public IDictionary<string, string[]> Errors { get; set; }   // field → messages
}
public class MonoCloudModelStateException : MonoCloudRequestException { }        // 422, non-problem+json body
public class MonoCloudResourceExhaustedException : MonoCloudRequestException { } // 429
public class MonoCloudServerException : MonoCloudRequestException { }            // >= 500

// namespace MonoCloud.Management.Core.Models — read with the SDK's case-sensitive snake_case policy
public class ProblemDetails
{
    public string Type { get; set; }         // Type, Title, Detail, Instance, TraceId default to string.Empty
    public string Title { get; set; }
    public int Status { get; set; }
    public string Detail { get; set; }
    public string Instance { get; set; }
    public string? ErrorCode { get; set; }   // "error_code"
    public string TraceId { get; set; }      // "trace_id"
    [JsonExtensionData]
    public IDictionary<string, object> ExtensionData { get; set; }   // any other member, as a JsonElement
}
```

How a non-2xx response is mapped:

- **`application/problem+json` body** — mapped on the body's `status`: 400/401/402/403/404/409/429/≥ 500 as above. A 422 becomes `MonoCloudIdentityValidationException` when `type` is `https://httpstatuses.io/422#identity-validation-error` and `MonoCloudKeyValidationException` when it is `https://httpstatuses.io/422#validation-error` (constants in `ValidationExceptionTypes`). The message is `Title`; the validation exceptions append the serialized `Errors`.
- **Any other body** — mapped on the HTTP status (422 → `MonoCloudModelStateException`); `Response` is `null` and the message is the response text, or the status name when the body is empty.
- **Unmapped** — any other status, or a 422 problem with a different `type`, throws a plain `System.Exception`.
- **Not wrapped** — `HttpRequestException`, timeout `TaskCanceledException`, and `JsonException` (malformed JSON) propagate as-is. `MonoCloudException` itself is thrown for construction errors, a `null` success body (`"Invalid response body"`), and a `null` problem body (`"Invalid body"`).

Only 400, 402, 403, 404, and 409 carry an `error_code`. Codes are opaque strings; the SDK defines no constants for them.

`MonoCloudClientBase` has `protected virtual void ThrowProblem(ProblemDetails problem)`, a seam for SDKs built on this core to throw narrower exceptions (which must derive from `MonoCloudException`); if an override returns without throwing, a generic `MonoCloudException` is thrown for the status. Application code doesn't call it.

## Requests and JSON

- **PATCH bodies.** Top-level `Patch*Request` types and `UpdateClaimsRequest` carry `[JsonConverter(typeof(PatchConverter<T>))]`, and their properties are `Optional<T>` (`readonly struct`: `HasValue`, `Value`, implicit conversion from `T`). Only assigned properties are written, so unassigned fields stay unchanged and an assigned `null` clears the field. Nested `Patch*Request` objects (e.g. `PatchAuthenticatorOptionsRequest` inside `PatchAuthenticationOptionsRequest`) behave the same; `PatchScopeClaimRequest`, the item type of `PatchScopeRequest.UserClaims`, is a plain class.
- **Ids are path-only.** No patch request has an id property. `ApiResource.Audience` and the `Name` of API scopes, identity scopes, and claim resources can't be patched; `PatchGroupRequest.Name` exists, so groups can be renamed.
- **User data.** `UpdatePrivateDataRequest.PrivateData` / `UpdatePublicDataRequest.PublicData` are `Dictionary<string, object>`: the keys you send are merged and a `null` value removes a key. `UpdateClaimsRequest` removes a claim that is set to `null`.
- **Other request bodies** omit `null` properties (`JsonIgnoreCondition.WhenWritingNull`).
- **Conventions.** Property names are snake_case (`SnakeCaseNamingPolicy`, case-sensitive when reading); enums are snake_case strings (`ApplicationTypes.WebApp` ↔ `"web_app"`; numeric values are rejected); `DateTime` values are Unix epoch seconds, read back as UTC.

## Ids

`groupId`, `identifierId`, and `logId` are `Guid`; every other id parameter is a `string`.

| Parameter | Value comes from |
|---|---|
| `userId` | `User.UserId` / `UserSummary.UserId` |
| `clientId` | `Application.Id` |
| `groupId` (`Guid`) | `Group.GroupId`, `UserGroup.GroupId`, `ApplicationGroup.GroupId` |
| `identifierId` (`Guid`) | `UserEmail.Id` / `UserPhone.Id` (in `User.Emails` / `User.PhoneNumbers`) |
| `logId` (`Guid`) | `Log.Id` |
| `sessionId`, `passkeyId` | `UserSession.SessionId`, `UserPasskey.PasskeyId` |
| `claimName`, `providerName` | `SignUpCustomField.ClaimName`, `ExternalProvider.Name` |
| `apiId`, `scopeId`, `claimId`, `secretId`, `policyId`, `keyId`, `zoneId`, `trustStoreId`, `revocationId`, `banId`, `consentId`, `tokenId`, `codeId` | The `Id` property of the corresponding model |

## Methods

Signatures are verbatim from source, minus the trailing `CancellationToken cancellationToken = default` that every method takes. **Returns** is the awaited type: a type `T` stands for `MonoCloudResponse<T>`, `(paged)` for `MonoCloudResponse<T, PageModel>`, and `—` for the bare `MonoCloudResponse` (no `Data`). **[Pro]**, **[Secure+]**, and **[ScaleX]** mark the subscription notes in source; unmarked methods carry none.

### `Users` — `UsersClient`

- `CreateUserAsync` enforces the tenant's sign-up policies unless the request sets `SkipPasswordPolicyChecks`, `SkipIdentifierRestrictionChecks` (identifier blocklist), or `SkipConformanceChecks`.
- `VerifyEmailAsync` emails the user a verification link; `SetEmailVerifiedAsync` marks the address verified directly.
- `RevokeUserSessionAsync` ends the session but leaves issued tokens valid unless the application binds tokens to sessions.
- `GetAllGroupAssignedUsersAsync(groupId, …)` is the group-side membership view.

| Method | Returns |
|---|---|
| `GetAllUsersAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<UserSummary>` (paged) |
| `CreateUserAsync(CreateUserRequest createUserRequest)` | `User` |
| `FindUserByIdAsync(string userId)` | `User` |
| `DeleteUserAsync(string userId)` | — |
| `EnableUserAsync(string userId)` | `User` |
| `DisableUserAsync(string userId, DisableUserRequest disableUserRequest)` | `User` |
| `UnblockUserAsync(string userId)` | `User` |
| `UpdateUsernameAsync(string userId, UpdateUsernameRequest updateUsernameRequest)` | `User` |
| `RemoveUsernameAsync(string userId)` | `User` |
| `AddEmailAsync(string userId, AddEmailRequest addEmailRequest)` | `User` |
| `RemoveEmailAsync(string userId, Guid identifierId)` | `User` |
| `SetPrimaryEmailAsync(string userId, Guid identifierId)` | `User` |
| `SetEmailVerifiedAsync(string userId, Guid identifierId)` | `User` |
| `SetEmailUnverifiedAsync(string userId, Guid identifierId)` | `User` |
| `VerifyEmailAsync(string userId, Guid identifierId, VerifyEmailRequest verifyEmailRequest)` | `VerifyEmailResponse` |
| `AddPhoneAsync(string userId, AddPhoneRequest addPhoneRequest)` | `User` |
| `RemovePhoneAsync(string userId, Guid identifierId)` | `User` |
| `SetPrimaryPhoneAsync(string userId, Guid identifierId)` | `User` |
| `SetPhoneVerifiedAsync(string userId, Guid identifierId)` | `User` |
| `SetPhoneUnverifiedAsync(string userId, Guid identifierId)` | `User` |
| `RemovePasskeyAsync(string userId, string passkeyId)` | — |
| `SetPasswordAsync(string userId, SetPasswordRequest setPasswordRequest)` | `User` |
| `RemovePasswordAsync(string userId)` | — |
| `SetPasswordResetRequiredAsync(string userId)` | `User` |
| `RemovePasswordResetRequiredAsync(string userId)` | `User` |
| `ResetPasswordAsync(string userId, ResetPasswordRequest resetPasswordRequest)` | `ResetPasswordResponse` |
| `ChangePasswordAsync(string userId, ChangePasswordRequest changePasswordRequest)` | `User` |
| `PatchClaimsAsync(string userId, UpdateClaimsRequest updateClaimsRequest)` | `User` |
| `GetPrivateDataAsync(string userId)` | `UserPrivateData` |
| `PatchPrivateDataAsync(string userId, UpdatePrivateDataRequest updatePrivateDataRequest)` | `UserPrivateData` |
| `GetPublicDataAsync(string userId)` | `UserPublicData` |
| `PatchPublicDataAsync(string userId, UpdatePublicDataRequest updatePublicDataRequest)` | `UserPublicData` |
| `GetAllBlockedIpsAsync(string userId, int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<UserIpAccessDetails>` (paged) |
| `UnblockIpAsync(string userId, UnblockIpRequest unblockIpRequest)` | `User` |
| `GetAllUserSessionsAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sort = default)` **[Pro]** | `List<UserSession>` (paged) |
| `FindUserSessionAsync(string userId, string sessionId)` **[Pro]** | `UserSession` |
| `RevokeUserSessionAsync(string userId, string sessionId)` **[Pro]** | — |
| `ExternalAuthenticatorDisconnectAsync(string userId, ExternalAuthenticatorDisconnectRequest externalAuthenticatorDisconnectRequest)` | `User` |
| `GetAllUserGroupsAsync(string userId, int? page = 1, int? size = 10, string? sort = default)` | `List<UserGroup>` (paged) |
| `FindUserGroupAsync(string userId, Guid groupId)` | `UserGroup` |
| `AssignUserToGroupAsync(string userId, Guid groupId)` | `UserGroup` |
| `RemoveUserFromGroupAsync(string userId, Guid groupId)` | — |
| `GetAllGroupAssignedUsersAsync(Guid groupId, int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<UserSummary>` (paged) |
| `GetAllUserClientGrantsAsync(string userId, int? page = 1, int? size = 10)` **[Pro]** | `List<UserClientGrants>` (paged) |
| `GetAllUserConsentsAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sort = default)` **[Secure+]** | `List<UserConsent>` (paged) |
| `GetAllReferenceTokensAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sessionId = default, string? sort = default)` **[Secure+]** | `List<ReferenceToken>` (paged) |
| `GetAllRefreshTokensAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sessionId = default, string? sort = default)` **[Secure+]** | `List<RefreshToken>` (paged) |
| `GetAllAuthorizationCodesAsync(string userId, int? page = 1, int? size = 10, string? clientId = default, string? sessionId = default, string? sort = default)` **[Secure+]** | `List<AuthorizationCode>` (paged) |
| `RevokeUserClientGrantsAsync(string userId, string clientId)` **[Secure+]** | — |
| `RevokeUserConsentAsync(string userId, string consentId)` **[Secure+]** | — |
| `RevokeReferenceTokenAsync(string userId, string tokenId)` **[Secure+]** | — |
| `RevokeRefreshTokenAsync(string userId, string tokenId)` **[Secure+]** | — |
| `RevokeAuthorizationCodeAsync(string userId, string codeId)` **[Secure+]** | — |

### `Clients` — `ClientsClient`

Applications use the `Application` model (there is no `Client` model); `clientId` is `Application.Id`. `GetAllGroupAssignedApplicationsAsync(groupId, …)` is the group-side view.

| Method | Returns |
|---|---|
| `GetAllApplicationsAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<Application>` (paged) |
| `CreateApplicationAsync(CreateApplicationRequest createApplicationRequest)` | `Application` |
| `FindApplicationByIdAsync(string clientId)` | `Application` |
| `PatchApplicationAsync(string clientId, PatchApplicationRequest patchApplicationRequest)` | `Application` |
| `DeleteApplicationAsync(string clientId)` | — |
| `GetAllApplicationSecretsAsync(string clientId)` | `List<Secret>` |
| `CreateApplicationSecretAsync(string clientId, CreateSecretRequest createSecretRequest)` | `Secret` |
| `FindApplicationSecretByIdAsync(string clientId, string secretId)` | `Secret` |
| `DeleteApplicationSecretAsync(string clientId, string secretId)` | — |
| `GetAllApplicationGroupsAsync(string clientId, int? page = 1, int? size = 10, string? sort = default)` | `List<ApplicationGroup>` (paged) |
| `FindApplicationGroupAsync(string clientId, Guid groupId)` | `ApplicationGroup` |
| `AssignGroupToApplicationAsync(string clientId, Guid groupId)` **[ScaleX]** | — |
| `RemoveGroupFromApplicationAsync(string clientId, Guid groupId)` **[ScaleX]** | — |
| `GetAllGroupAssignedApplicationsAsync(Guid groupId, int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<Application>` (paged) |

### `Groups` — `GroupsClient`

CRUD only. Membership is managed from `Users` (`AssignUserToGroupAsync`, …) and `Clients` (`AssignGroupToApplicationAsync`, …).

| Method | Returns |
|---|---|
| `GetAllGroupsAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<Group>` (paged) |
| `CreateGroupAsync(CreateGroupRequest createGroupRequest)` **[Pro: >2 groups]** | `Group` |
| `FindGroupByIdAsync(Guid groupId)` | `Group` |
| `PatchGroupAsync(Guid groupId, PatchGroupRequest patchGroupRequest)` | `Group` |
| `DeleteGroupAsync(Guid groupId)` | — |

### `Resources` — `ResourcesClient`

- Argument order: `FindApiResourceSecretByIdAsync` and the API-scope find/patch/delete methods take the child id before `apiId`; every other method takes `apiId` first.
- Basic access policies are structured: one `ClientId`, the `Scopes` it may request (empty means all), and `Actions` (`ApiAccessPolicyActions`). Advanced policies hold Cedar source in `Cedar`, plus `Actions` and an optional denial message `Error`. `IsPermitted` on a returned policy says whether it grants access when matched.
- `GetAllApiAccessPoliciesAsync` returns `ApiAccessPolicy` summaries; use `Type` (`PolicyTypes.Basic` / `Advanced`) to choose `FindApiAccessBasicPolicyByIdAsync` or `FindApiAccessAdvancedPolicyByIdAsync`.
- `ConvertApiAccessBasicToAdvancedPolicyAsync` is irreversible: the policy keeps its id, gets generated Cedar source, and loses its basic-only fields (client, scopes).
- `PatchClaimResourceAsync` applies to custom claims only; built-in claims can't be modified.

| Method | Returns |
|---|---|
| `GetAllApiResourcesAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<ApiResource>` (paged) |
| `CreateApiResourceAsync(CreateApiResourceRequest createApiResourceRequest)` | `ApiResource` |
| `FindApiResourceByIdAsync(string apiId)` | `ApiResource` |
| `PatchApiResourceAsync(string apiId, PatchApiResourceRequest patchApiResourceRequest)` | `ApiResource` |
| `DeleteApiResourceAsync(string apiId)` | — |
| `GetAllApiResourceSecretsAsync(string apiId)` | `List<Secret>` |
| `CreateApiResourceSecretAsync(string apiId, CreateSecretRequest createSecretRequest)` **[ScaleX]** | `Secret` |
| `FindApiResourceSecretByIdAsync(string secretId, string apiId)` | `Secret` |
| `DeleteApiResourceSecretAsync(string apiId, string secretId)` | — |
| `GetAllApiScopesAsync(string apiId, int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<ApiScope>` (paged) |
| `CreateApiScopeAsync(string apiId, CreateApiScopeRequest createApiScopeRequest)` | `ApiScope` |
| `FindApiScopeByIdAsync(string scopeId, string apiId)` | `ApiScope` |
| `PatchApiScopeAsync(string scopeId, string apiId, PatchApiScopeRequest patchApiScopeRequest)` | `ApiScope` |
| `DeleteApiScopeAsync(string scopeId, string apiId)` | — |
| `GetAllApiAccessPoliciesAsync(string apiId, int? page = 1, int? size = 10, string? sort = default)` | `List<ApiAccessPolicy>` (paged) |
| `CreateApiAccessBasicPolicyAsync(string apiId, CreateApiAccessBasicPolicyRequest createApiAccessBasicPolicyRequest)` | `BasicApiAccessPolicy` |
| `FindApiAccessBasicPolicyByIdAsync(string apiId, string policyId)` | `BasicApiAccessPolicy` |
| `PatchApiAccessBasicPolicyAsync(string apiId, string policyId, PatchApiAccessBasicPolicyRequest patchApiAccessBasicPolicyRequest)` | `BasicApiAccessPolicy` |
| `DeleteApiAccessBasicPolicyAsync(string apiId, string policyId)` | — |
| `ConvertApiAccessBasicToAdvancedPolicyAsync(string apiId, string policyId)` | `AdvancedApiAccessPolicy` |
| `CreateApiAccessAdvancedPolicyAsync(string apiId, CreateApiAccessAdvancedPolicyRequest createApiAccessAdvancedPolicyRequest)` | `AdvancedApiAccessPolicy` |
| `FindApiAccessAdvancedPolicyByIdAsync(string apiId, string policyId)` | `AdvancedApiAccessPolicy` |
| `PatchApiAccessAdvancedPolicyAsync(string apiId, string policyId, PatchApiAccessAdvancedPolicyRequest patchApiAccessAdvancedPolicyRequest)` | `AdvancedApiAccessPolicy` |
| `DeleteApiAccessAdvancedPolicyAsync(string apiId, string policyId)` | — |
| `GetAllScopesAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<Scope>` (paged) |
| `CreateScopeAsync(CreateScopeRequest createScopeRequest)` | `Scope` |
| `FindScopeByIdAsync(string scopeId)` | `Scope` |
| `PatchScopeAsync(string scopeId, PatchScopeRequest patchScopeRequest)` | `Scope` |
| `DeleteScopeAsync(string scopeId)` | — |
| `GetAllClaimResourcesAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<ClaimResource>` (paged) |
| `CreateClaimResourceAsync(CreateClaimResourceRequest createClaimResourceRequest)` | `ClaimResource` |
| `FindClaimResourceByIdAsync(string claimId)` | `ClaimResource` |
| `PatchClaimResourceAsync(string claimId, PatchClaimResourceRequest patchClaimResourceRequest)` | `ClaimResource` |
| `DeleteClaimResourceAsync(string claimId)` | — |

### `Keys` — `KeysClient`

There is no create or find method. `RotateKeyAsync` promotes a new signing key and keeps the previous one for validating issued tokens; `RevokeKeyAsync` makes the key untrusted immediately. Both are irreversible.

| Method | Returns |
|---|---|
| `GetAllKeyMaterialsAsync(int? page = 1, int? size = 10)` | `List<KeyMaterial>` (paged) |
| `RotateKeyAsync(string keyId)` | — |
| `RevokeKeyAsync(string keyId)` | — |

### `Logs` — `LogsClient`

Sortable fields: `time_stamp`, `category`, `code`, `type`, `name` (e.g. `sort: "time_stamp:-1"`).

| Method | Returns |
|---|---|
| `GetAllLogsAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<Log>` (paged) |
| `FindLogByIdAsync(Guid logId)` | `Log` |

### `NetworkZones` — `NetworkZonesClient`

`GetAllNetworkZonesAsync` returns `INetworkZone` items deserialized as `IpNetworkZone` (`IpRanges`) or `RegionalNetworkZone` (`Countries`) by the `type` discriminator (`"ip"` / `"regional"`) — use type patterns (`zone is IpNetworkZone ip`). Enums: `NetworkZoneCategory` (`Trusted`, `Blocked`) and `NetworkZoneOperator` (`In`, `NotIn`). Source `<note>`s mark only create/patch as ScaleX, but the SDK maintainers' notes describe all network-zone endpoints as ScaleX.

| Method | Returns |
|---|---|
| `GetAllNetworkZonesAsync(int? page = 1, int? size = 10, string? filter = default, string? sort = default)` | `List<INetworkZone>` (paged) |
| `CreateIpNetworkZoneAsync(CreateIpNetworkZoneRequest createIpNetworkZoneRequest)` **[ScaleX]** | `IpNetworkZone` |
| `FindIpNetworkZoneByIdAsync(string zoneId)` | `IpNetworkZone` |
| `PatchIpNetworkZoneAsync(string zoneId, PatchIpNetworkZoneRequest patchIpNetworkZoneRequest)` **[ScaleX]** | `IpNetworkZone` |
| `DeleteIpNetworkZoneAsync(string zoneId)` | — |
| `CreateRegionalNetworkZoneAsync(CreateRegionalNetworkZoneRequest createRegionalNetworkZoneRequest)` **[ScaleX]** | `RegionalNetworkZone` |
| `FindRegionalNetworkZoneByIdAsync(string zoneId)` | `RegionalNetworkZone` |
| `PatchRegionalNetworkZoneAsync(string zoneId, PatchRegionalNetworkZoneRequest patchRegionalNetworkZoneRequest)` **[ScaleX]** | `RegionalNetworkZone` |
| `DeleteRegionalNetworkZoneAsync(string zoneId)` | — |

### `Options` — `OptionsClient`

- `AuthenticationOptions` groups `PushedAuthorization`, `AccountProtection`, `Authenticators` (password, passkey, email, phone), `Identifiers`, `RecoveryMethods`, `Session`, `Logout`, and `SignUp`; `CommunicationOptions` groups `Email` and `Sms`. Patch them through the nested `Patch*Request` objects of `PatchAuthenticationOptionsRequest` / `PatchCommunicationOptionsRequest`.
- External identity providers are keyed by `providerName` (`ExternalProvider.Name`); the list method is `GetAllExternalAuthenticatorsAsync`, and it returns `List<ExternalProvider>`. Provider kinds are the `ExternalAuthenticators` enum.

| Method | Returns |
|---|---|
| `FindAuthenticationOptionsAsync()` | `AuthenticationOptions` |
| `PatchAuthenticationOptionsAsync(PatchAuthenticationOptionsRequest patchAuthenticationOptionsRequest)` | `AuthenticationOptions` |
| `FindCommunicationOptionsAsync()` | `CommunicationOptions` |
| `PatchCommunicationOptionsAsync(PatchCommunicationOptionsRequest patchCommunicationOptionsRequest)` | `CommunicationOptions` |
| `GetAllSignUpCustomFieldsAsync()` | `List<SignUpCustomField>` |
| `CreateSignUpCustomFieldAsync(CreateSignUpCustomFieldRequest createSignUpCustomFieldRequest)` | `SignUpCustomField` |
| `FindSignUpCustomFieldAsync(string claimName)` | `SignUpCustomField` |
| `PatchSignUpCustomFieldAsync(string claimName, PatchSignUpCustomFieldRequest patchSignUpCustomFieldRequest)` | `SignUpCustomField` |
| `DeleteSignUpCustomFieldAsync(string claimName)` | — |
| `GetAllExternalAuthenticatorsAsync()` | `List<ExternalProvider>` |
| `CreateExternalProviderAsync(CreateExternalProviderRequest createExternalProviderRequest)` | `ExternalProvider` |
| `FindExternalProviderAsync(string providerName)` | `ExternalProvider` |
| `PatchExternalProviderAsync(string providerName, PatchExternalProviderRequest patchExternalProviderRequest)` | `ExternalProvider` |
| `DeleteExternalProviderAsync(string providerName)` | — |

### `Branding` — `BrandingClient`

Page, email, and SMS branding each have one `Find…` and one `Patch…` method.

| Method | Returns |
|---|---|
| `FindPageBrandingOptionsAsync()` | `PageBrandingOptions` |
| `PatchPageBrandingOptionsAsync(PatchPageBrandingOptionsRequest patchPageBrandingOptionsRequest)` | `PageBrandingOptions` |
| `FindEmailBrandingOptionsAsync()` | `EmailBrandingOptions` |
| `PatchEmailBrandingOptionsAsync(PatchEmailBrandingOptionsRequest patchEmailBrandingOptionsRequest)` | `EmailBrandingOptions` |
| `FindSmsBrandingOptionsAsync()` | `SmsBrandingOptions` |
| `PatchSmsBrandingOptionsAsync(PatchSmsBrandingOptionsRequest patchSmsBrandingOptionsRequest)` | `SmsBrandingOptions` |

### `TrustStores` — `TrustStoresClient`

- PKI (mTLS) stores are created from a PEM `CertChain`; SPIFFE stores from a `SpiffeBundleEndpoint` URL.
- `Set…TrustStoreDefaultAsync` sets the store used when an mTLS endpoint doesn't select one.
- PKI revocations are CRLs in PEM (`AddCertificateRevocationRequest.Value`). `ICertificateRevocation` is deserialized as `BaseCertificateRevocation` or `DeltaCertificateRevocation` by `type` (`"base"` / `"delta"`); the list returns `RevocationGrouped` items with their `Deltas`.
- PKI bans identify a certificate by `BannedCertificateType` (`Thumbprint`, `SerialNumber`, `Subject`) and `Value`; SPIFFE bans take an SVID `Value`.

| Method | Returns |
|---|---|
| `GetAllPkiTrustStoresAsync(int? page = 1, int? size = 10, string? sort = default)` | `List<PkiTrustStoreSummary>` (paged) |
| `CreatePkiTrustStoreAsync(CreatePkiTrustStoreRequest createPkiTrustStoreRequest)` | `PkiTrustStore` |
| `FindPkiTrustStoreByIdAsync(string trustStoreId)` | `PkiTrustStore` |
| `PatchPkiTrustStoreAsync(string trustStoreId, PatchPkiTrustStoreRequest patchPkiTrustStoreRequest)` | `PkiTrustStore` |
| `DeletePkiTrustStoreAsync(string trustStoreId)` | — |
| `SetPkiTrustStoreDefaultAsync(string trustStoreId)` | `PkiTrustStore` |
| `GetAllRevocationsAsync(string trustStoreId, int? page = 1, int? size = 10, string? sort = default)` | `List<RevocationGrouped>` (paged) |
| `AddCertificateRevocationAsync(string trustStoreId, AddCertificateRevocationRequest addCertificateRevocationRequest)` | `ICertificateRevocation` |
| `FindCertificateRevocationAsync(string trustStoreId, string revocationId)` | `ICertificateRevocation` |
| `RemoveCertificateRevocationAsync(string trustStoreId, string revocationId)` | — |
| `GetAllPkiBannedCertificatesAsync(string trustStoreId)` | `List<BannedCertificate>` |
| `BanPkiTrustStoreCertificateAsync(string trustStoreId, BanTrustStoreCertificateRequest banTrustStoreCertificateRequest)` | `BannedCertificate` |
| `UnbanPkiTrustStoreCertificateAsync(string trustStoreId, string banId)` | — |
| `GetAllSpiffeTrustStoresAsync(int? page = 1, int? size = 10, string? sort = default)` | `List<SpiffeTrustStoreSummary>` (paged) |
| `CreateSpiffeTrustStoreAsync(CreateSpiffeTrustStoreRequest createSpiffeTrustStoreRequest)` | `SpiffeTrustStore` |
| `FindSpiffeTrustStoreByIdAsync(string trustStoreId)` | `SpiffeTrustStore` |
| `PatchSpiffeTrustStoreAsync(string trustStoreId, PatchSpiffeTrustStoreRequest patchSpiffeTrustStoreRequest)` | `SpiffeTrustStore` |
| `DeleteSpiffeTrustStoreAsync(string trustStoreId)` | — |
| `SetSpiffeTrustStoreDefaultAsync(string trustStoreId)` | `SpiffeTrustStore` |
| `GetAllSpiffeBannedSvidsAsync(string trustStoreId)` | `List<BannedSvid>` |
| `BanSpiffeTrustStoreSvidAsync(string trustStoreId, BanTrustStoreSvidRequest banTrustStoreSvidRequest)` | `BannedSvid` |
| `UnbanSpiffeTrustStoreSvidAsync(string trustStoreId, string banId)` | — |

## Field-level subscription gates

Request fields gated by model `<note>` comments (method-level gates are marked in the tables above):

| Tier | Request fields |
|---|---|
| Pro | Applications: `FrontChannelLogoutUri`, `FrontChannelLogoutSessionRequired`, `AuthenticatorRestrictions`. Options: custom `Expiry` / `CodeLength` for email/phone authenticators, identifier verification, and recovery methods; password `Strength` / `Reuse`; sign-up `ShowTermsAndPrivacyPolicy`, `RequireExplicitUserAgreement`, `TermsUrl`, `PrivacyUrl`; sign-up restrictions (`Enabled`, `Identifiers`). Branding: custom SMS `Template` |
| Secure+ | Applications: consent (`EnableConsent`, `RequireConsent`, `AlwaysRequireConsentForOfflineAccess`, `RememberConsent`, `ShowConsentScopeSelection`, `ConsentLifetime`), JAR (`RequireRequestObject`), PAR (`RequirePushedAuthorizationRequests`, `AllowAnyPushedAuthorizationRedirectUri`), `BackChannelLogoutUri`, `BackChannelLogoutSessionRequired`. Tenant PAR options: `EnablePushedAuthorizationRequests`, `RequirePushedAuthorizationRequests` |
| ScaleX | Session binding (`BindRefreshTokensToSession`, `BindTokensToSession`), `AllowMultiAudience`, `AllowUserInfoAccess`, reference tokens (`AccessTokenType`), `AbsoluteRefreshTokenLifetime` longer than a month, `CreateApiResourceRequest.AutoGenerateSecret` |
