# `@monocloud/management` — API surface

Verified against `@monocloud/management@0.4.0` (`monocloud/management-js` @ `c771c71`).

Every public export and resource-client method. Configuration, response handling, pagination and error-handling guidance live in [`SKILL.md`](../SKILL.md); IntelliSense on the named request/response types is authoritative for model fields.

## Exports

```ts
import {
  MonoCloudManagementClient,
  MonoCloudResponse,
  MonoCloudException,
  MonoCloudRequestException,
  MonoCloudBadRequestException,         // 400
  MonoCloudUnauthorizedException,       // 401
  MonoCloudPaymentRequiredException,    // 402
  MonoCloudForbiddenException,          // 403
  MonoCloudNotFoundException,           // 404
  MonoCloudConflictException,           // 409
  MonoCloudIdentityValidationException, // 422
  MonoCloudKeyValidationException,      // 422
  MonoCloudModelStateException,         // 422
  MonoCloudResourceExhaustedException,  // 429
  MonoCloudServerException,             // 500
  IdentityValidationProblemDetails,
  KeyValidationProblemDetails,
} from '@monocloud/management';
import type { MonoCloudConfig, IdentityError, Fetcher } from '@monocloud/management';
```

The package also re-exports the ten client classes (`BrandingClient`, `ClientsClient`, `GroupsClient`, `KeysClient`, `LogsClient`, `NetworkZonesClient`, `OptionsClient`, `ResourcesClient`, `TrustStoresClient`, `UsersClient`) and every model, request type and enum (`User`, `CreateUserRequest`, `Application`, `INetworkZone`, `PolicyTypes`, …). Enums are `as const` objects with matching string-literal types — `AccessTokenTypes.Reference === 'reference'`, `NetworkZoneOperator.NotIn === 'not_in'` — so either the member or the literal type-checks.

Core-only, **not** exported from `@monocloud/management`: `MonoCloudPageResponse`, `PageModel`, `ProblemDetails`, `MonoCloudCodedException`, `MonoCloudClientBase`, `MonoCloudRequest`, `MonoCloudEvent`. Don't import `@monocloud/management-core`; derive types from method return types ([`SKILL.md` → Response shape](../SKILL.md#response-shape)).

## `MonoCloudManagementClient`

```ts
class MonoCloudManagementClient {
  readonly branding: BrandingClient;
  readonly clients: ClientsClient;
  readonly groups: GroupsClient;
  readonly keys: KeysClient;
  readonly logs: LogsClient;
  readonly networkZones: NetworkZonesClient;
  readonly options: OptionsClient;
  readonly resources: ResourcesClient;
  readonly trustStores: TrustStoresClient;
  readonly users: UsersClient;
  private constructor(options: MonoCloudConfig, fetcher?: Fetcher);
  static init(options?: MonoCloudConfig, fetcher?: Fetcher): MonoCloudManagementClient;
}

interface MonoCloudConfig {
  domain: string;
  apiKey: string;
  config?: { timeout?: number }; // milliseconds
}

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
```

Env fallbacks and validation: [`SKILL.md` → Configuration](../SKILL.md#configuration). Without a `fetcher`, every request goes to `https://<domain>/api/<path>` with `X-API-KEY` and `Content-Type: application/json` headers and an `AbortSignal.timeout(config.timeout ?? 10000)` signal. Resource methods pass the transport only `method` and a JSON-string `body`.

### Custom fetcher

A `fetcher` replaces that transport entirely (see [`SKILL.md` → Custom fetcher](../SKILL.md#custom-fetcher)). This one reproduces it and retries 429s:

```ts
import { MonoCloudManagementClient, type Fetcher } from '@monocloud/management';

const baseUrl = 'https://acme.us.monocloud.com/api/'; // must end with /api/
const apiKey = process.env.MONOCLOUD_MANAGEMENT_API_KEY!;

const fetcher: Fetcher = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('X-API-KEY', apiKey);
  headers.set('Content-Type', 'application/json');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(new URL(input, baseUrl), { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(10_000) });
    if (res.status !== 429 || attempt === 2) return res;
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
  }
};

export const management = MonoCloudManagementClient.init(undefined, fetcher); // domain/apiKey are not validated
```

## Exceptions

Status → class table and handling: [`SKILL.md` → Errors](../SKILL.md#errors).

```ts
class MonoCloudException extends Error {}
class MonoCloudRequestException extends MonoCloudException { response?: ProblemDetails }
abstract class MonoCloudCodedException extends MonoCloudRequestException { get errorCode(): string | undefined } // core-only
// extend MonoCloudCodedException:    BadRequest (400), PaymentRequired (402), Forbidden (403), NotFound (404), Conflict (409)
// extend MonoCloudRequestException:  Unauthorized (401), ModelState (422), ResourceExhausted (429), Server (500)
class MonoCloudIdentityValidationException extends MonoCloudRequestException { errors: IdentityError[] }
class MonoCloudKeyValidationException extends MonoCloudRequestException { errors: Record<string, string[]> }

class ProblemDetails { // core-only
  type: string; title: string; status: number; detail: string; instance: string;
  error_code?: string; trace_id?: string;
  [key: string]: any; // every other member of the problem+json body
}
class IdentityValidationProblemDetails extends ProblemDetails { errors: IdentityError[] }
class KeyValidationProblemDetails extends ProblemDetails { errors: Record<string, string[]> }
interface IdentityError { code: string; description: string }
```

- A 422 problem body with `type` `https://httpstatuses.io/422#identity-validation-error` throws `MonoCloudIdentityValidationException`, `…#validation-error` throws `MonoCloudKeyValidationException`, anything else `MonoCloudModelStateException`.
- `.message` is the problem `title`; the validation classes append the errors as JSON (`"<title> : <errors JSON>"`). Non-problem error bodies give the body text (or status text) and leave `.response` undefined.
- Statuses not in the table throw `MonoCloudException` with the problem title or body text.

## Method reference

Notation: `→ T` resolves to `MonoCloudResponse<T>`; `→ T[]` **paged** resolves to `MonoCloudPageResponse<T[]>` (has `pageData`); `→ null` is an empty body. Ids are strings; `page?` / `size?` are numbers; `filter?`, `sort?`, `clientId?`, `sessionId?` are strings; `body` is the named request type. **Pro** / **Secure+** / **ScaleX** mark server-enforced plan gates.

### `users` — `UsersClient`

- `getAllUsers(page?, size?, filter?, sort?)` → `UserSummary[]` **paged**
- `createUser(body: CreateUserRequest)` → `User`
- `findUserById(userId)` → `User` (id field is `user_id`)
- `deleteUser(userId)` → `null`
- `enableUser(userId)`, `unblockUser(userId)` (clears sign-in lockout), `removeUsername(userId)` → `User`
- `disableUser(userId, body: DisableUserRequest)` → `User` (`{ revoke_sessions?: boolean }`)
- `updateUsername(userId, body: UpdateUsernameRequest)` → `User`
- `addEmail(userId, body: AddEmailRequest)`, `addPhone(userId, body: AddPhoneRequest)` → `User`
- `removeEmail`, `setPrimaryEmail`, `setEmailVerified`, `setEmailUnverified` `(userId, identifierId)` → `User`
- `removePhone`, `setPrimaryPhone`, `setPhoneVerified`, `setPhoneUnverified` `(userId, identifierId)` → `User`
- `verifyEmail(userId, identifierId, body: VerifyEmailRequest)` → `VerifyEmailResponse` (initiates verification)
- `setPassword(userId, body: SetPasswordRequest)`, `changePassword(userId, body: ChangePasswordRequest)` → `User`
- `resetPassword(userId, body: ResetPasswordRequest)` → `ResetPasswordResponse` (initiates a reset)
- `setPasswordResetRequired(userId)`, `removePasswordResetRequired(userId)` → `User`
- `removePassword(userId)`, `removePasskey(userId, passkeyId)` → `null`
- `patchClaims(userId, body: UpdateClaimsRequest)` → `User`
- `getPrivateData(userId)`, `patchPrivateData(userId, body: UpdatePrivateDataRequest)` → `UserPrivateData`
- `getPublicData(userId)`, `patchPublicData(userId, body: UpdatePublicDataRequest)` → `UserPublicData`
- `getAllBlockedIps(userId, page?, size?, filter?, sort?)` → `UserIpAccessDetails[]` **paged**
- `unblockIp(userId, body: UnblockIpRequest)` → `User`
- `getAllUserSessions(userId, page?, size?, clientId?, sort?)` → `UserSession[]` **paged** — **Pro**
- `findUserSession(userId, sessionId)` → `UserSession` — **Pro**
- `revokeUserSession(userId, sessionId)` → `null` — **Pro** (issued tokens stay valid unless bound to the session)
- `externalAuthenticatorDisconnect(userId, body: ExternalAuthenticatorDisconnectRequest)` → `User`
- `getAllUserGroups(userId, page?, size?, sort?)` → `UserGroup[]` **paged**
- `findUserGroup(userId, groupId)`, `assignUserToGroup(userId, groupId)` → `UserGroup`
- `removeUserFromGroup(userId, groupId)` → `null`
- `getAllGroupAssignedUsers(groupId, page?, size?, filter?, sort?)` → `UserSummary[]` **paged**
- `getAllUserClientGrants(userId, page?, size?)` → `UserClientGrants[]` **paged** — **Pro**
- `getAllUserConsents(userId, page?, size?, clientId?, sort?)` → `UserConsent[]` **paged** — **Secure+**
- `getAllReferenceTokens`, `getAllRefreshTokens`, `getAllAuthorizationCodes` `(userId, page?, size?, clientId?, sessionId?, sort?)` → `ReferenceToken[]` / `RefreshToken[]` / `AuthorizationCode[]` **paged** — **Secure+**
- `revokeUserClientGrants(userId, clientId)`, `revokeUserConsent(userId, consentId)`, `revokeReferenceToken(userId, tokenId)`, `revokeRefreshToken(userId, tokenId)`, `revokeAuthorizationCode(userId, codeId)` → `null` — **Secure+**

### `clients` — `ClientsClient`

Applications; the REST path is `/applications` and every name says `Application`, but the id parameter is `clientId`.

- `getAllApplications(page?, size?, filter?, sort?)` → `Application[]` **paged**
- `createApplication(body: CreateApplicationRequest)` → `Application`
- `findApplicationById(clientId)`, `patchApplication(clientId, body: PatchApplicationRequest)` → `Application`
- `deleteApplication(clientId)` → `null`
- `getAllApplicationSecrets(clientId)` → `Secret[]` (not paged)
- `createApplicationSecret(clientId, body: CreateSecretRequest)`, `findApplicationSecretById(clientId, secretId)` → `Secret`
- `deleteApplicationSecret(clientId, secretId)` → `null`
- `getAllApplicationGroups(clientId, page?, size?, sort?)` → `ApplicationGroup[]` **paged**
- `findApplicationGroup(clientId, groupId)` → `ApplicationGroup`
- `assignGroupToApplication(clientId, groupId)`, `removeGroupFromApplication(clientId, groupId)` → `null` — **ScaleX**
- `getAllGroupAssignedApplications(groupId, page?, size?, filter?, sort?)` → `Application[]` **paged**

### `groups` — `GroupsClient`

- `getAllGroups(page?, size?, filter?, sort?)` → `Group[]` **paged**
- `createGroup(body: CreateGroupRequest)` → `Group` — **Pro** beyond two groups
- `findGroupById(groupId)`, `patchGroup(groupId, body: PatchGroupRequest)` → `Group`
- `deleteGroup(groupId)` → `null`

No membership methods here: use `users.assignUserToGroup` / `removeUserFromGroup` / `getAllGroupAssignedUsers` and `clients.assignGroupToApplication` / `getAllGroupAssignedApplications`.

### `keys` — `KeysClient`

- `getAllKeyMaterials(page?, size?)` → `KeyMaterial[]` **paged**
- `rotateKey(keyId)`, `revokeKey(keyId)` → `null` (irreversible)

No create or find-by-id methods.

### `logs` — `LogsClient`

- `getAllLogs(page?, size?, filter?, sort?)` → `Log[]` **paged**
- `findLogById(logId)` → `Log`

### `options` — `OptionsClient`

- `findAuthenticationOptions()`, `patchAuthenticationOptions(body: PatchAuthenticationOptionsRequest)` → `AuthenticationOptions`
- `findCommunicationOptions()`, `patchCommunicationOptions(body: PatchCommunicationOptionsRequest)` → `CommunicationOptions`
- `getAllSignUpCustomFields()` → `SignUpCustomField[]` (not paged)
- `createSignUpCustomField(body: CreateSignUpCustomFieldRequest)`, `findSignUpCustomField(claimName)`, `patchSignUpCustomField(claimName, body: PatchSignUpCustomFieldRequest)` → `SignUpCustomField`
- `deleteSignUpCustomField(claimName)` → `null`
- `getAllExternalAuthenticators()` → `ExternalProvider[]` (not paged)
- `createExternalProvider(body: CreateExternalProviderRequest)`, `findExternalProvider(providerName)`, `patchExternalProvider(providerName, body: PatchExternalProviderRequest)` → `ExternalProvider`
- `deleteExternalProvider(providerName)` → `null`

`AuthenticationOptions` nests `authenticators`, `identifiers`, `recovery_methods`, `session`, `logout`, `sign_up`, `account_protection` and `pushed_authorization`; `CommunicationOptions` nests `email` and `sms`. Those are read and patched only through the two `*Options` methods.

### `branding` — `BrandingClient`

- `findPageBrandingOptions()`, `patchPageBrandingOptions(body: PatchPageBrandingOptionsRequest)` → `PageBrandingOptions`
- `findEmailBrandingOptions()`, `patchEmailBrandingOptions(body: PatchEmailBrandingOptionsRequest)` → `EmailBrandingOptions`
- `findSmsBrandingOptions()`, `patchSmsBrandingOptions(body: PatchSmsBrandingOptionsRequest)` → `SmsBrandingOptions`

### `resources` — `ResourcesClient`

API resources:

- `getAllApiResources(page?, size?, filter?, sort?)` → `ApiResource[]` **paged**
- `createApiResource(body: CreateApiResourceRequest)` → `ApiResource`
- `findApiResourceById(apiId)`, `patchApiResource(apiId, body: PatchApiResourceRequest)` → `ApiResource`
- `deleteApiResource(apiId)` → `null`

API resource secrets and scopes — **watch the id order**:

- `getAllApiResourceSecrets(apiId)` → `Secret[]` (not paged)
- `createApiResourceSecret(apiId, body: CreateSecretRequest)` → `Secret` — **ScaleX**
- `findApiResourceSecretById(secretId, apiId)` → `Secret` — child id first
- `deleteApiResourceSecret(apiId, secretId)` → `null` — `apiId` first
- `getAllApiScopes(apiId, page?, size?, filter?, sort?)` → `ApiScope[]` **paged**
- `createApiScope(apiId, body: CreateApiScopeRequest)` → `ApiScope`
- `findApiScopeById(scopeId, apiId)`, `patchApiScope(scopeId, apiId, body: PatchApiScopeRequest)` → `ApiScope` — child id first
- `deleteApiScope(scopeId, apiId)` → `null` — child id first

API access policies (all `apiId` first). Basic policies apply to one `client_id` (optionally limited to `scopes`); advanced policies carry Cedar source in `cedar` plus an optional denial `error`:

- `getAllApiAccessPolicies(apiId, page?, size?, sort?)` → `ApiAccessPolicy[]` **paged** — summaries with `type: 'basic' | 'advanced'`; fetch details with the matching `find*`
- `createApiAccessBasicPolicy(apiId, body: CreateApiAccessBasicPolicyRequest)`, `findApiAccessBasicPolicyById(apiId, policyId)`, `patchApiAccessBasicPolicy(apiId, policyId, body: PatchApiAccessBasicPolicyRequest)` → `BasicApiAccessPolicy`
- `deleteApiAccessBasicPolicy(apiId, policyId)` → `null`
- `convertApiAccessBasicToAdvancedPolicy(apiId, policyId)` → `AdvancedApiAccessPolicy` (irreversible)
- `createApiAccessAdvancedPolicy(apiId, body: CreateApiAccessAdvancedPolicyRequest)`, `findApiAccessAdvancedPolicyById(apiId, policyId)`, `patchApiAccessAdvancedPolicy(apiId, policyId, body: PatchApiAccessAdvancedPolicyRequest)` → `AdvancedApiAccessPolicy`
- `deleteApiAccessAdvancedPolicy(apiId, policyId)` → `null`

Identity scopes and claim resources (tenant-wide):

- `getAllScopes(page?, size?, filter?, sort?)` → `Scope[]` **paged**
- `createScope(body: CreateScopeRequest)`, `findScopeById(scopeId)`, `patchScope(scopeId, body: PatchScopeRequest)` → `Scope`
- `deleteScope(scopeId)` → `null`
- `getAllClaimResources(page?, size?, filter?, sort?)` → `ClaimResource[]` **paged**
- `createClaimResource(body: CreateClaimResourceRequest)`, `findClaimResourceById(claimId)`, `patchClaimResource(claimId, body: PatchClaimResourceRequest)` → `ClaimResource` (only custom claims can be patched)
- `deleteClaimResource(claimId)` → `null`

### `trustStores` — `TrustStoresClient`

PKI (X.509 CA) trust stores:

- `getAllPkiTrustStores(page?, size?, sort?)` → `PkiTrustStoreSummary[]` **paged**
- `createPkiTrustStore(body: CreatePkiTrustStoreRequest)`, `findPkiTrustStoreById(trustStoreId)`, `patchPkiTrustStore(trustStoreId, body: PatchPkiTrustStoreRequest)`, `setPkiTrustStoreDefault(trustStoreId)` → `PkiTrustStore`
- `deletePkiTrustStore(trustStoreId)` → `null`
- `getAllRevocations(trustStoreId, page?, size?, sort?)` → `RevocationGrouped[]` **paged**
- `addCertificateRevocation(trustStoreId, body: AddCertificateRevocationRequest)`, `findCertificateRevocation(trustStoreId, revocationId)` → `ICertificateRevocation`
- `removeCertificateRevocation(trustStoreId, revocationId)` → `null`
- `getAllPkiBannedCertificates(trustStoreId)` → `BannedCertificate[]` (not paged)
- `banPkiTrustStoreCertificate(trustStoreId, body: BanTrustStoreCertificateRequest)` → `BannedCertificate`
- `unbanPkiTrustStoreCertificate(trustStoreId, banId)` → `null`

SPIFFE trust stores:

- `getAllSpiffeTrustStores(page?, size?, sort?)` → `SpiffeTrustStoreSummary[]` **paged**
- `createSpiffeTrustStore(body: CreateSpiffeTrustStoreRequest)`, `findSpiffeTrustStoreById(trustStoreId)`, `patchSpiffeTrustStore(trustStoreId, body: PatchSpiffeTrustStoreRequest)`, `setSpiffeTrustStoreDefault(trustStoreId)` → `SpiffeTrustStore`
- `deleteSpiffeTrustStore(trustStoreId)` → `null`
- `getAllSpiffeBannedSvids(trustStoreId)` → `BannedSvid[]` (not paged)
- `banSpiffeTrustStoreSvid(trustStoreId, body: BanTrustStoreSvidRequest)` → `BannedSvid`
- `unbanSpiffeTrustStoreSvid(trustStoreId, banId)` → `null`

`ICertificateRevocation = ({ type: 'base' } & BaseCertificateRevocation) | ({ type: 'delta' } & DeltaCertificateRevocation)` — narrow on `type`.

### `networkZones` — `NetworkZonesClient`

- `getAllNetworkZones(page?, size?, filter?, sort?)` → `INetworkZone[]` **paged**
- `createIpNetworkZone(body: CreateIpNetworkZoneRequest)` → `IpNetworkZone` — **ScaleX**
- `findIpNetworkZoneById(zoneId)` → `IpNetworkZone`
- `patchIpNetworkZone(zoneId, body: PatchIpNetworkZoneRequest)` → `IpNetworkZone` — **ScaleX**
- `deleteIpNetworkZone(zoneId)` → `null`
- `createRegionalNetworkZone(body: CreateRegionalNetworkZoneRequest)` → `RegionalNetworkZone` — **ScaleX**
- `findRegionalNetworkZoneById(zoneId)` → `RegionalNetworkZone`
- `patchRegionalNetworkZone(zoneId, body: PatchRegionalNetworkZoneRequest)` → `RegionalNetworkZone` — **ScaleX**
- `deleteRegionalNetworkZone(zoneId)` → `null`

`INetworkZone = ({ type: 'ip' } & IpNetworkZone) | ({ type: 'regional' } & RegionalNetworkZone)` — narrow on `type`. Enums: `NetworkZoneCategory` (`trusted`, `blocked`), `NetworkZoneOperator` (`in`, `not_in`).

## Field-level plan gates

Request fields annotated with a plan in `@note` tags. Setting them on a lower plan is rejected by the server.

| Plan | Fields |
| --- | --- |
| Secure+ | Application consents (`enable_consent`, `require_consent`, `always_require_consent_for_offline_access`, `remember_consent`, `show_consent_scope_selection`, `consent_lifetime`), JAR (`require_request_object`), PAR (`require_pushed_authorization_requests`, `allow_any_pushed_authorization_redirect_uri`), back-channel logout (`back_channel_logout_uri`, `back_channel_logout_session_required`); tenant PAR options (`pushed_authorization`) |
| Pro | Application front-channel logout (`front_channel_logout_uri`, `front_channel_logout_session_required`) and `authenticator_restrictions`; sign-up `allowlist` / `blocklist` restrictions; sign-up terms/privacy (`show_terms_and_privacy_policy`, `require_explicit_user_agreement`, `terms_url`, `privacy_url`); password `strength` / `reuse` options; custom `expiry` / `code_length` for email and phone authenticators, identifier verification and recovery methods; custom SMS `template`s (`sign_in` / `verification` / `password_reset`) |
| ScaleX | Reference tokens (`access_token_type`) on applications, API resources and policy actions; `allow_multi_audience`, `allow_user_info_access` and session binding (`bind_tokens_to_session`) on API resources and policy actions; application `bind_refresh_tokens_to_session` and `absolute_refresh_token_lifetime` beyond a month; `auto_generate_secret` on `CreateApiResourceRequest` |

## Sort fields

`sort` is `"<field>:1"` or `"<field>:-1"`. Documented fields:

| Methods | Fields |
| --- | --- |
| `getAllUsers`, `getAllGroupAssignedUsers` | `failure_count`, `last_sign_in_attempt`, `sign_in_attempts_count`, `last_sign_in_success`, `sign_in_success_count`, `last_activity`, `block_until`, `creation_time`, `last_updated` |
| `getAllBlockedIps` | `block_until`, `last_sign_in_attempt`, `last_sign_in_success` |
| `getAllUserSessions` | `session_id`, `initiated_at`, `expires_at`, `last_updated` |
| `getAllUserGroups`, `getAllApplicationGroups`, `getAllUserConsents`, `getAllReferenceTokens`, `getAllRefreshTokens`, `getAllAuthorizationCodes` | `creation_time` |
| `getAllApplications`, `getAllGroupAssignedApplications` | `client_name`, `creation_time` |
| `getAllGroups` | `name`, `type`, `clients_assigned`, `users_assigned`, `last_assigned`, `creation_time`, `last_updated` |
| `getAllLogs` | `time_stamp`, `category`, `code`, `type`, `name` |
| `getAllNetworkZones` | `name`, `category`, `operator`, `type`, `creation_time`, `last_updated` |
| `getAllApiResources`, `getAllApiScopes`, `getAllScopes`, `getAllClaimResources` | `name`, `display_name`, `creation_time` |
| `getAllApiAccessPolicies` | `name`, `type`, `is_permitted`, `creation_time`, `last_updated` |
| `getAllPkiTrustStores`, `getAllSpiffeTrustStores` | `name`, `creation_time`, `last_updated` |
| `getAllRevocations` | `creation_time`, `issued_at` |

`getAllKeyMaterials` and `getAllUserClientGrants` take no `sort`. `filter` (where accepted) is a Lucene-style expression; the SDK doesn't document per-endpoint filter fields — see <https://www.monocloud.com/docs/apis/management>.

## Internal runtime

`MonoCloudClientBase` (core-only) is the base of every resource client. Its protected `processEventStream()` (server-sent events → `MonoCloudEvent { event, data, id }`) and `throwProblem()` are SDK-author extension points that no resource client uses: there is no public streaming, subscription or event API on `MonoCloudManagementClient`.
