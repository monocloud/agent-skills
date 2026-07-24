# `@monocloud/management` — API surface

Exhaustive export list, verified against `packages/management/src/` and `packages/core/src/` on `@monocloud/management@0.2.11`. Methods are listed verbatim with positional parameters; TypeScript intellisense (`go-to-definition`) is the source of truth for full request/response model fields.

## Quick reference

The surface most apps actually reach for — full method lists, request types, and gotchas follow below.

- Entry point: `MonoCloudManagementClient.init(options?, fetcher?)` — static factory; the constructor is `private`.
- Ten resource clients hang off it: `.branding`, `.clients`, `.groups`, `.keys`, `.logs`, `.networkZones`, `.options`, `.resources`, `.trustStores`, `.users`.
- Most-used methods: `users.getAllUsers / createUser / findUserById / patchClaims / patchPrivateData / patchPublicData / disableUser / enableUser / changePassword`, `clients.getAllApplications / createApplication / patchApplication`, `groups.getAllGroups / createGroup`, `keys.getAllKeyMaterials`, `logs.getAllLogs`, `resources.getAllApiResources / getAllApiAccessPolicies`, `options.findAuthenticationOptions`.
- Response wrappers: `MonoCloudResponse<T>` (`.result`, `.status`, `.headers`) and `MonoCloudPageResponse<T>` (adds `.pageData`).
- Errors: subclasses of `MonoCloudRequestException` — `MonoCloudNotFoundException`, `MonoCloudConflictException`, `MonoCloudPaymentRequiredException`, `MonoCloudIdentityValidationException`, … Base `MonoCloudException` has no status field; branch with `instanceof` or read `(e as MonoCloudRequestException).response?.status`.
- Common gotchas: `clients.*` methods are named `*Application*` (not `*Client*`); the deserialized body is on `.result` (**not** `.data`, which is the .NET SDK's field); the SDK appends `/api/` itself — don't include it in `domain`. Some methods require a paid subscription tier and fail with HTTP 402 → `MonoCloudPaymentRequiredException` (see the tier table below).

## Top-level exports

Everything below is re-exported from the `@monocloud/management` package root (the value exports come through `@monocloud/management-core`):

```ts
import {
  MonoCloudManagementClient,   // main client (value)
  MonoCloudResponse,           // response envelope (value)

  // exception classes
  MonoCloudException,
  MonoCloudBadRequestException,
  MonoCloudConflictException,
  MonoCloudIdentityValidationException,
  MonoCloudPaymentRequiredException,
  MonoCloudForbiddenException,
  MonoCloudKeyValidationException,
  MonoCloudModelStateException,
  MonoCloudNotFoundException,
  MonoCloudRequestException,
  MonoCloudResourceExhaustedException,
  MonoCloudServerException,
  MonoCloudUnauthorizedException,

  // problem-detail value objects
  IdentityValidationProblemDetails,
  KeyValidationProblemDetails,
} from '@monocloud/management';

import type {
  MonoCloudConfig,
  IdentityError,
  Fetcher,
} from '@monocloud/management';
```

`export * from './clients'` re-exports all ten resource-client classes: `BrandingClient`, `ClientsClient`, `GroupsClient`, `KeysClient`, `LogsClient`, `NetworkZonesClient`, `OptionsClient`, `ResourcesClient`, `TrustStoresClient`, `UsersClient`.

`export * from './models'` re-exports every request/response model, type, and enum (`User`, `CreateUserRequest`, `Application`, `Group`, `ApiResource`, `Log`, `KeyMaterial`, `PkiTrustStore`, `IpNetworkZone`, `SignUpCustomField`, `AuthenticationOptions`, etc.). Notable groups:

- **API access policies** (`resources.*ApiAccessPolicy*`): `ApiAccessPolicy`, `BasicApiAccessPolicy`, `AdvancedApiAccessPolicy`, `CreateApiAccessBasicPolicyRequest`, `CreateApiAccessAdvancedPolicyRequest`, `PatchApiAccessBasicPolicyRequest`, `PatchApiAccessAdvancedPolicyRequest`, `ApiAccessPolicyActions`, `CreateApiAccessPolicyActionsRequest`, `PatchApiAccessPolicyActionsRequest`, `PolicyTypes`.
- **Network zones** (`networkZones.*`): `INetworkZone` (discriminated union by `type`), `IpNetworkZone`, `RegionalNetworkZone`, `CreateIpNetworkZoneRequest`, `CreateRegionalNetworkZoneRequest`, `PatchIpNetworkZoneRequest`, `PatchRegionalNetworkZoneRequest`, `NetworkZoneCategory`, `NetworkZoneOperator`.
- **Trust stores** (`trustStores.*`): PKI + SPIFFE families — `PkiTrustStore`, `PkiTrustStoreSummary`, `PkiTrustStoreOptions`, `SpiffeTrustStore`, `SpiffeTrustStoreSummary`, `SpiffeTrustStoreOptions`, `BannedCertificate`, `BannedCertificateType`, `BannedSvid`, `ICertificateRevocation` (union of `BaseCertificateRevocation` / `DeltaCertificateRevocation`), `RevocationGrouped`, `RevocationGroupedDelta`, `RevocationCheckDepth`, `X509RevocationMode`, plus their `Create*`/`Patch*` request types.
- **Grants / tokens** (`users.*`): `ReferenceToken`, `RefreshToken` (+ `RefreshTokenExpirationTypes`, `RefreshTokenUsageTypes`), `AuthorizationCode`, `UserConsent`, `UserClientGrants`, `AccessTokenTypes`.

Not re-exported from the `@monocloud/management` root (they live in `@monocloud/management-core`): `MonoCloudPageResponse`, `PageModel`, `ProblemDetails`, `MonoCloudRequest`, `MonoCloudClientBase`. They are part of the runtime shape — `MonoCloudPageResponse<T>` is the return type of every paginated method, `PageModel` is its `.pageData`, `ProblemDetails` is the `.response` on `MonoCloudRequestException` — but a named import of them from the main package will fail. Rely on TypeScript inference from the method return types, or import them from `@monocloud/management-core` if you need to name them directly.

## `MonoCloudManagementClient`

Created via the static factory `MonoCloudManagementClient.init()`. The constructor is `private` — never `new MonoCloudManagementClient()`.

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

  static init(
    options?: MonoCloudConfig,
    fetcher?: Fetcher,
  ): MonoCloudManagementClient;
}
```

- `options.domain` — tenant URL; falls back to `process.env.MONOCLOUD_MANAGEMENT_DOMAIN`. The SDK sanitizes it (prepends `https://` if missing, strips a trailing `/`) and appends `/api/` automatically — do **not** include `/api` yourself.
- `options.apiKey` — Management API key; falls back to `process.env.MONOCLOUD_MANAGEMENT_API_KEY`. Sent as the `X-API-KEY` header.
- `options.config.timeout` — per-request timeout in **milliseconds**; falls back to `MONOCLOUD_MANAGEMENT_TIMEOUT` (parsed with `parseInt(…, 10)`, applied only when a positive integer). Default: `10000`.
- `fetcher` — optional `Fetcher` to replace the built-in `fetch` pipeline. When provided, the SDK does **not** add the base URL (`/api/`), the `X-API-KEY` / `Content-Type` headers, or the timeout `AbortSignal` — your fetcher owns all of that.

```ts
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface MonoCloudConfig {
  domain: string;
  apiKey: string;
  config?: { timeout?: number };   // timeout in milliseconds
}
```

Both `init()` arguments are optional; with no `options` the client is built entirely from the env-var fallbacks. `init()`'s timeout-from-env wiring is quirky — for reliable results pass `config.timeout` explicitly in `options`.

## Response envelopes

```ts
class MonoCloudResponse<TResult = unknown> {
  status: number;
  headers: Record<string, any>;
  result: TResult;                 // deserialized body — NOT `.data`
  constructor(status: number, headers: Record<string, any>, result: TResult);
}

class MonoCloudPageResponse<TResult = unknown> extends MonoCloudResponse<TResult> {
  pageData: PageModel;             // present on every paginated call
  constructor(status, headers, result, pageData);
}

interface PageModel {
  page_size: number;
  current_page: number;
  total_count: number;
  has_previous: boolean;
  has_next: boolean;
}
```

- The body of every non-list call is on `.result`. (The .NET SDK uses `.Data` / `.PageData` — do not confuse the two.)
- Paginated `getAll*` methods return `MonoCloudPageResponse<T[]>`; `pageData` is populated from the JSON in the `x-pagination` response header. `MonoCloudPageResponse` and `PageModel` are **not** re-exported from the main package root (see [Top-level exports](#top-level-exports)) — annotate via the method return type.
- Empty / no-content responses (e.g. every `delete*`) resolve to `MonoCloudResponse<null>` with `result === null`.

## Exception hierarchy

Thrown on non-2xx responses (and for config/timeout failures). All extend the native `Error`.

```ts
class MonoCloudException extends Error {}   // base: config errors, timeouts, unmapped statuses

class MonoCloudRequestException extends MonoCloudException {
  response?: ProblemDetails;                // server problem+json body, when present
}

class MonoCloudBadRequestException         extends MonoCloudRequestException {}  // 400
class MonoCloudUnauthorizedException       extends MonoCloudRequestException {}  // 401 (bad/missing API key)
class MonoCloudPaymentRequiredException    extends MonoCloudRequestException {}  // 402 (feature needs a higher tier)
class MonoCloudForbiddenException          extends MonoCloudRequestException {}  // 403
class MonoCloudNotFoundException           extends MonoCloudRequestException {}  // 404
class MonoCloudConflictException           extends MonoCloudRequestException {}  // 409
class MonoCloudModelStateException         extends MonoCloudRequestException {}  // 422 (generic validation)
class MonoCloudIdentityValidationException extends MonoCloudRequestException {
  errors: IdentityError[];                  // 422, type=…#identity-validation-error
}
class MonoCloudKeyValidationException      extends MonoCloudRequestException {
  errors: Record<string, string[]>;         // 422, type=…#validation-error
}
class MonoCloudResourceExhaustedException  extends MonoCloudRequestException {}  // 429 (rate limited)
class MonoCloudServerException             extends MonoCloudRequestException {}  // 500
```

`MonoCloudException` itself only has `.message` (inherited from `Error`) — there is no `statusCode` property. Branch with `instanceof` against the specific subclass, or read the status off the problem-details body:

```ts
catch (e) {
  if (e instanceof MonoCloudPaymentRequiredException) {
    // feature requires a higher subscription tier
  } else if (e instanceof MonoCloudRequestException) {
    console.log(e.response?.status, e.response?.title, e.response?.detail);
  }
}
```

A request that times out surfaces as a plain `MonoCloudException` (there is no dedicated timeout class); the original error's `name === 'TimeoutError'`.

```ts
class ProblemDetails {          // core-only; not re-exported from the main package
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  [key: string]: any;
}

class IdentityValidationProblemDetails extends ProblemDetails {
  errors: IdentityError[];
}
class KeyValidationProblemDetails extends ProblemDetails {
  errors: Record<string, string[]>;
}

interface IdentityError {
  code: string;
  description: string;
}
```

## `client.users` — `UsersClient`

Full user lifecycle: CRUD, enable/disable/unblock, identifiers, passkeys/passwords, claims, data, blocked IPs, sessions, external authenticators, group membership, and grants/tokens.

| Method | Returns |
|---|---|
| `getAllUsers(page?, size?, filter?, sort?)` | `MonoCloudPageResponse<UserSummary[]>` |
| `createUser(createUserRequest: CreateUserRequest)` | `MonoCloudResponse<User>` |
| `findUserById(userId: string)` | `MonoCloudResponse<User>` |
| `deleteUser(userId: string)` | `MonoCloudResponse<null>` |
| `enableUser(userId: string)` | `MonoCloudResponse<User>` |
| `disableUser(userId: string, disableUserRequest: DisableUserRequest)` | `MonoCloudResponse<User>` |
| `unblockUser(userId: string)` | `MonoCloudResponse<User>` |
| `updateUsername(userId: string, updateUsernameRequest: UpdateUsernameRequest)` | `MonoCloudResponse<User>` |
| `removeUsername(userId: string)` | `MonoCloudResponse<User>` |

Emails:

- `addEmail(userId: string, addEmailRequest: AddEmailRequest)` → `MonoCloudResponse<User>`
- `removeEmail(userId: string, identifierId: string)` → `MonoCloudResponse<User>`
- `setPrimaryEmail(userId: string, identifierId: string)` → `MonoCloudResponse<User>`
- `setEmailVerified(userId: string, identifierId: string)` → `MonoCloudResponse<User>`
- `setEmailUnverified(userId: string, identifierId: string)` → `MonoCloudResponse<User>`
- `verifyEmail(userId: string, identifierId: string, verifyEmailRequest: VerifyEmailRequest)` → `MonoCloudResponse<VerifyEmailResponse>`

Phones:

- `addPhone(userId: string, addPhoneRequest: AddPhoneRequest)` → `MonoCloudResponse<User>`
- `removePhone(userId: string, identifierId: string)` → `MonoCloudResponse<User>`
- `setPrimaryPhone(userId: string, identifierId: string)` → `MonoCloudResponse<User>`
- `setPhoneVerified(userId: string, identifierId: string)` → `MonoCloudResponse<User>`
- `setPhoneUnverified(userId: string, identifierId: string)` → `MonoCloudResponse<User>`

Passkeys / passwords:

- `removePasskey(userId: string, passkeyId: string)` → `MonoCloudResponse<null>`
- `setPassword(userId: string, setPasswordRequest: SetPasswordRequest)` → `MonoCloudResponse<User>`
- `removePassword(userId: string)` → `MonoCloudResponse<null>`
- `setPasswordResetRequired(userId: string)` → `MonoCloudResponse<User>`
- `removePasswordResetRequired(userId: string)` → `MonoCloudResponse<User>`
- `resetPassword(userId: string, resetPasswordRequest: ResetPasswordRequest)` → `MonoCloudResponse<ResetPasswordResponse>`
- `changePassword(userId: string, changePasswordRequest: ChangePasswordRequest)` → `MonoCloudResponse<User>`

Claims / public / private data:

- `patchClaims(userId: string, updateClaimsRequest: UpdateClaimsRequest)` → `MonoCloudResponse<User>`
- `getPrivateData(userId: string)` → `MonoCloudResponse<UserPrivateData>`
- `patchPrivateData(userId: string, updatePrivateDataRequest: UpdatePrivateDataRequest)` → `MonoCloudResponse<UserPrivateData>`
- `getPublicData(userId: string)` → `MonoCloudResponse<UserPublicData>`
- `patchPublicData(userId: string, updatePublicDataRequest: UpdatePublicDataRequest)` → `MonoCloudResponse<UserPublicData>`

IP access:

- `getAllBlockedIps(userId: string, page?, size?, filter?, sort?)` → `MonoCloudPageResponse<UserIpAccessDetails[]>`
- `unblockIp(userId: string, unblockIpRequest: UnblockIpRequest)` → `MonoCloudResponse<User>`

Sessions — **Pro plan**:

- `getAllUserSessions(userId: string, page?, size?, clientId?, sort?)` → `MonoCloudPageResponse<UserSession[]>`
- `findUserSession(userId: string, sessionId: string)` → `MonoCloudResponse<UserSession>`
- `revokeUserSession(userId: string, sessionId: string)` → `MonoCloudResponse<null>`

External authenticators:

- `externalAuthenticatorDisconnect(userId: string, externalAuthenticatorDisconnectRequest: ExternalAuthenticatorDisconnectRequest)` → `MonoCloudResponse<User>`

Groups (membership lives on the user, not the group):

- `getAllUserGroups(userId: string, page?, size?, sort?)` → `MonoCloudPageResponse<UserGroup[]>`
- `findUserGroup(userId: string, groupId: string)` → `MonoCloudResponse<UserGroup>`
- `assignUserToGroup(userId: string, groupId: string)` → `MonoCloudResponse<UserGroup>`
- `removeUserFromGroup(userId: string, groupId: string)` → `MonoCloudResponse<null>`
- `getAllGroupAssignedUsers(groupId: string, page?, size?, filter?, sort?)` → `MonoCloudPageResponse<UserSummary[]>` — group-side view.

Grants, consents, tokens, codes:

- `getAllUserClientGrants(userId: string, page?, size?)` → `MonoCloudPageResponse<UserClientGrants[]>` — **Pro plan**
- `getAllUserConsents(userId: string, page?, size?, clientId?, sort?)` → `MonoCloudPageResponse<UserConsent[]>` — **Secure+**
- `getAllReferenceTokens(userId: string, page?, size?, clientId?, sessionId?, sort?)` → `MonoCloudPageResponse<ReferenceToken[]>` — **Secure+**
- `getAllRefreshTokens(userId: string, page?, size?, clientId?, sessionId?, sort?)` → `MonoCloudPageResponse<RefreshToken[]>` — **Secure+**
- `getAllAuthorizationCodes(userId: string, page?, size?, clientId?, sessionId?, sort?)` → `MonoCloudPageResponse<AuthorizationCode[]>` — **Secure+**
- `revokeUserClientGrants(userId: string, clientId: string)` → `MonoCloudResponse<null>` — **Secure+**
- `revokeUserConsent(userId: string, consentId: string)` → `MonoCloudResponse<null>` — **Secure+**
- `revokeReferenceToken(userId: string, tokenId: string)` → `MonoCloudResponse<null>` — **Secure+**
- `revokeRefreshToken(userId: string, tokenId: string)` → `MonoCloudResponse<null>` — **Secure+**
- `revokeAuthorizationCode(userId: string, codeId: string)` → `MonoCloudResponse<null>` — **Secure+**

> The identifier field on the response model is `User.user_id` (not `user.id`).

## `client.clients` — `ClientsClient`

OAuth applications and their secrets / group assignments. The accessor is `clients`, but the underlying REST resource is `applications` and every model + method uses **`Application`** (`getAllApplications`, `createApplication`, `Application`, `PatchApplicationRequest`). The path param is still `clientId`.

| Method | Returns |
|---|---|
| `getAllApplications(page?, size?, filter?, sort?)` | `MonoCloudPageResponse<Application[]>` |
| `createApplication(createApplicationRequest: CreateApplicationRequest)` | `MonoCloudResponse<Application>` |
| `findApplicationById(clientId: string)` | `MonoCloudResponse<Application>` |
| `patchApplication(clientId: string, patchApplicationRequest: PatchApplicationRequest)` | `MonoCloudResponse<Application>` |
| `deleteApplication(clientId: string)` | `MonoCloudResponse<null>` |

Application secrets:

- `getAllApplicationSecrets(clientId: string)` → `MonoCloudResponse<Secret[]>` — **not paginated**
- `createApplicationSecret(clientId: string, createSecretRequest: CreateSecretRequest)` → `MonoCloudResponse<Secret>`
- `findApplicationSecretById(clientId: string, secretId: string)` → `MonoCloudResponse<Secret>`
- `deleteApplicationSecret(clientId: string, secretId: string)` → `MonoCloudResponse<null>`

Application ↔ group mapping:

- `getAllApplicationGroups(clientId: string, page?, size?, sort?)` → `MonoCloudPageResponse<ApplicationGroup[]>`
- `findApplicationGroup(clientId: string, groupId: string)` → `MonoCloudResponse<ApplicationGroup>`
- `assignGroupToApplication(clientId: string, groupId: string)` → `MonoCloudResponse<null>` — **ScaleX**
- `removeGroupFromApplication(clientId: string, groupId: string)` → `MonoCloudResponse<null>` — **ScaleX**
- `getAllGroupAssignedApplications(groupId: string, page?, size?, filter?, sort?)` → `MonoCloudPageResponse<Application[]>`

## `client.groups` — `GroupsClient`

| Method | Returns |
|---|---|
| `getAllGroups(page?, size?, filter?, sort?)` | `MonoCloudPageResponse<Group[]>` |
| `createGroup(createGroupRequest: CreateGroupRequest)` | `MonoCloudResponse<Group>` — creating **more than two groups** requires the **Pro plan** |
| `findGroupById(groupId: string)` | `MonoCloudResponse<Group>` |
| `patchGroup(groupId: string, patchGroupRequest: PatchGroupRequest)` | `MonoCloudResponse<Group>` |
| `deleteGroup(groupId: string)` | `MonoCloudResponse<null>` |

Group membership is managed from the **user** side (`users.assignUserToGroup` / `users.removeUserFromGroup`) and queried from either side (`users.getAllUserGroups` / `users.getAllGroupAssignedUsers`). There are no member-management methods on `GroupsClient`.

## `client.keys` — `KeysClient`

Signing key materials are managed by the platform — only enumeration, rotation, and revocation are exposed.

- `getAllKeyMaterials(page?, size?)` → `MonoCloudPageResponse<KeyMaterial[]>`
- `rotateKey(keyId: string)` → `MonoCloudResponse<null>`
- `revokeKey(keyId: string)` → `MonoCloudResponse<null>`

There is no `createKey`, `findKeyById`, or `getAllKeys`.

## `client.logs` — `LogsClient`

Tenant audit / event logs (read-only).

- `getAllLogs(page?, size?, filter?, sort?)` → `MonoCloudPageResponse<Log[]>`
- `findLogById(logId: string)` → `MonoCloudResponse<Log>`

## `client.options` — `OptionsClient`

Tenant-wide authentication & communication options, plus sign-up custom fields.

- `findAuthenticationOptions()` → `MonoCloudResponse<AuthenticationOptions>`
- `patchAuthenticationOptions(patchAuthenticationOptionsRequest: PatchAuthenticationOptionsRequest)` → `MonoCloudResponse<AuthenticationOptions>`
- `findCommunicationOptions()` → `MonoCloudResponse<CommunicationOptions>`
- `patchCommunicationOptions(patchCommunicationOptionsRequest: PatchCommunicationOptionsRequest)` → `MonoCloudResponse<CommunicationOptions>`

Sign-up custom fields:

- `getAllSignUpCustomFields()` → `MonoCloudResponse<SignUpCustomField[]>` — **not paginated** (returns `MonoCloudResponse`, not `MonoCloudPageResponse`)
- `createSignUpCustomField(createSignUpCustomFieldRequest: CreateSignUpCustomFieldRequest)` → `MonoCloudResponse<SignUpCustomField>`
- `findSignUpCustomField(claimName: string)` → `MonoCloudResponse<SignUpCustomField>`
- `patchSignUpCustomField(claimName: string, patchSignUpCustomFieldRequest: PatchSignUpCustomFieldRequest)` → `MonoCloudResponse<SignUpCustomField>`
- `deleteSignUpCustomField(claimName: string)` → `MonoCloudResponse<null>`

External identity providers (the external authenticators end-users can sign in with):

- `getAllExternalAuthenticators()` → `MonoCloudResponse<ExternalProvider[]>` — **not paginated** (method name kept, but now returns `ExternalProvider[]`)
- `createExternalProvider(createExternalProviderRequest: CreateExternalProviderRequest)` → `MonoCloudResponse<ExternalProvider>`
- `findExternalProvider(providerName: string)` → `MonoCloudResponse<ExternalProvider>`
- `patchExternalProvider(providerName: string, patchExternalProviderRequest: PatchExternalProviderRequest)` → `MonoCloudResponse<ExternalProvider>`
- `deleteExternalProvider(providerName: string)` → `MonoCloudResponse<null>`

`AuthenticationOptions` and `CommunicationOptions` are deep, nested models (authenticators, identifiers, password policy, session policy, sign-up, logout, email/SMS providers, …). Many of their sub-options are subscription-gated at the field level — see the [Subscription tiers](#subscription-tiers) note. There are no discrete methods for those sub-areas; you read/patch them through the two `*Options` models. External identity providers, by contrast, are managed through their own dedicated methods (`getAllExternalAuthenticators` / `createExternalProvider` / `findExternalProvider` / `patchExternalProvider` / `deleteExternalProvider`, listed above).

## `client.branding` — `BrandingClient`

Server-rendered login-UI and notification-template branding. Three surfaces, each with `find* / patch*`:

- `findPageBrandingOptions()` → `MonoCloudResponse<PageBrandingOptions>`
- `patchPageBrandingOptions(patchPageBrandingOptionsRequest: PatchPageBrandingOptionsRequest)` → `MonoCloudResponse<PageBrandingOptions>`
- `findEmailBrandingOptions()` → `MonoCloudResponse<EmailBrandingOptions>`
- `patchEmailBrandingOptions(patchEmailBrandingOptionsRequest: PatchEmailBrandingOptionsRequest)` → `MonoCloudResponse<EmailBrandingOptions>`
- `findSmsBrandingOptions()` → `MonoCloudResponse<SmsBrandingOptions>`
- `patchSmsBrandingOptions(patchSmsBrandingOptionsRequest: PatchSmsBrandingOptionsRequest)` → `MonoCloudResponse<SmsBrandingOptions>`

There is no `getBranding()` / `patchBranding()` umbrella method.

## `client.resources` — `ResourcesClient`

API resources (audiences) + their secrets & scopes, API access policies (basic/advanced), standalone identity scopes, and claim resources.

API resources:

- `getAllApiResources(page?, size?, filter?, sort?)` → `MonoCloudPageResponse<ApiResource[]>`
- `createApiResource(createApiResourceRequest: CreateApiResourceRequest)` → `MonoCloudResponse<ApiResource>`
- `findApiResourceById(apiId: string)` → `MonoCloudResponse<ApiResource>`
- `patchApiResource(apiId: string, patchApiResourceRequest: PatchApiResourceRequest)` → `MonoCloudResponse<ApiResource>`
- `deleteApiResource(apiId: string)` → `MonoCloudResponse<null>`

API resource secrets:

- `getAllApiResourceSecrets(apiId: string)` → `MonoCloudResponse<Secret[]>` — **not paginated**
- `createApiResourceSecret(apiId: string, createSecretRequest: CreateSecretRequest)` → `MonoCloudResponse<Secret>` — **ScaleX**
- `findApiResourceSecretById(secretId: string, apiId: string)` → `MonoCloudResponse<Secret>` — **param order: `secretId` then `apiId`**
- `deleteApiResourceSecret(apiId: string, secretId: string)` → `MonoCloudResponse<null>` — **param order: `apiId` then `secretId`** (reversed vs `find`)

API scopes (scoped to one resource):

- `getAllApiScopes(apiId: string, page?, size?, filter?, sort?)` → `MonoCloudPageResponse<ApiScope[]>`
- `createApiScope(apiId: string, createApiScopeRequest: CreateApiScopeRequest)` → `MonoCloudResponse<ApiScope>`
- `findApiScopeById(scopeId: string, apiId: string)` → `MonoCloudResponse<ApiScope>` — **param order: `scopeId` then `apiId`**
- `patchApiScope(scopeId: string, apiId: string, patchApiScopeRequest: PatchApiScopeRequest)` → `MonoCloudResponse<ApiScope>` — **param order: `scopeId` then `apiId`**
- `deleteApiScope(scopeId: string, apiId: string)` → `MonoCloudResponse<null>` — **param order: `scopeId` then `apiId`**

API access policies (per resource). Basic policies use structured conditions; advanced policies use the policy-expression DSL. `convertApiAccessBasicToAdvancedPolicy` upgrades a basic policy to an advanced one (one-way):

- `getAllApiAccessPolicies(apiId: string, page?, size?, sort?)` → `MonoCloudPageResponse<ApiAccessPolicy[]>` — returns the union; discriminate by `type`.
- `createApiAccessBasicPolicy(apiId: string, createApiAccessBasicPolicyRequest: CreateApiAccessBasicPolicyRequest)` → `MonoCloudResponse<BasicApiAccessPolicy>`
- `findApiAccessBasicPolicyById(apiId: string, policyId: string)` → `MonoCloudResponse<BasicApiAccessPolicy>`
- `patchApiAccessBasicPolicy(apiId: string, policyId: string, patchApiAccessBasicPolicyRequest: PatchApiAccessBasicPolicyRequest)` → `MonoCloudResponse<BasicApiAccessPolicy>`
- `deleteApiAccessBasicPolicy(apiId: string, policyId: string)` → `MonoCloudResponse<null>`
- `convertApiAccessBasicToAdvancedPolicy(apiId: string, policyId: string)` → `MonoCloudResponse<AdvancedApiAccessPolicy>`
- `createApiAccessAdvancedPolicy(apiId: string, createApiAccessAdvancedPolicyRequest: CreateApiAccessAdvancedPolicyRequest)` → `MonoCloudResponse<AdvancedApiAccessPolicy>`
- `findApiAccessAdvancedPolicyById(apiId: string, policyId: string)` → `MonoCloudResponse<AdvancedApiAccessPolicy>`
- `patchApiAccessAdvancedPolicy(apiId: string, policyId: string, patchApiAccessAdvancedPolicyRequest: PatchApiAccessAdvancedPolicyRequest)` → `MonoCloudResponse<AdvancedApiAccessPolicy>`
- `deleteApiAccessAdvancedPolicy(apiId: string, policyId: string)` → `MonoCloudResponse<null>`

Identity scopes (tenant-wide):

- `getAllScopes(page?, size?, filter?, sort?)` → `MonoCloudPageResponse<Scope[]>`
- `createScope(createScopeRequest: CreateScopeRequest)` → `MonoCloudResponse<Scope>`
- `findScopeById(scopeId: string)` → `MonoCloudResponse<Scope>`
- `patchScope(scopeId: string, patchScopeRequest: PatchScopeRequest)` → `MonoCloudResponse<Scope>`
- `deleteScope(scopeId: string)` → `MonoCloudResponse<null>`

Claim resources (custom claims):

- `getAllClaimResources(page?, size?, filter?, sort?)` → `MonoCloudPageResponse<ClaimResource[]>`
- `createClaimResource(createClaimResourceRequest: CreateClaimResourceRequest)` → `MonoCloudResponse<ClaimResource>`
- `findClaimResourceById(claimId: string)` → `MonoCloudResponse<ClaimResource>`
- `patchClaimResource(claimId: string, patchClaimResourceRequest: PatchClaimResourceRequest)` → `MonoCloudResponse<ClaimResource>`
- `deleteClaimResource(claimId: string)` → `MonoCloudResponse<null>`

> The `find`/`delete`/`patch` secret & scope methods interleave `apiId` and the child id differently — read the per-method notes above before passing arguments; transposing them is the easiest mistake to make here.

## `client.trustStores` — `TrustStoresClient`

mTLS trust stores, split into two families — **PKI** (X.509 CA chains, with offline CRL revocation management) and **SPIFFE** (federated SPIFFE trust domains) — each with its own ban list. Accessor is camelCase `trustStores`. All list methods are paginated with `(page?, size?, sort?)`; the ban-list getters are not.

PKI trust stores:

- `getAllPkiTrustStores(page?, size?, sort?)` → `MonoCloudPageResponse<PkiTrustStoreSummary[]>`
- `createPkiTrustStore(createPkiTrustStoreRequest: CreatePkiTrustStoreRequest)` → `MonoCloudResponse<PkiTrustStore>`
- `findPkiTrustStoreById(trustStoreId: string)` → `MonoCloudResponse<PkiTrustStore>`
- `patchPkiTrustStore(trustStoreId: string, patchPkiTrustStoreRequest: PatchPkiTrustStoreRequest)` → `MonoCloudResponse<PkiTrustStore>`
- `deletePkiTrustStore(trustStoreId: string)` → `MonoCloudResponse<null>`
- `setPkiTrustStoreDefault(trustStoreId: string)` → `MonoCloudResponse<PkiTrustStore>`

Certificate revocations (offline CRLs — PKI only):

- `getAllRevocations(trustStoreId: string, page?, size?, sort?)` → `MonoCloudPageResponse<RevocationGrouped[]>`
- `addCertificateRevocation(trustStoreId: string, addCertificateRevocationRequest: AddCertificateRevocationRequest)` → `MonoCloudResponse<ICertificateRevocation>`
- `findCertificateRevocation(trustStoreId: string, revocationId: string)` → `MonoCloudResponse<ICertificateRevocation>`
- `removeCertificateRevocation(trustStoreId: string, revocationId: string)` → `MonoCloudResponse<null>`

PKI banned certificates:

- `getAllPkiBannedCertificates(trustStoreId: string)` → `MonoCloudResponse<BannedCertificate[]>` — **not paginated**
- `banPkiTrustStoreCertificate(trustStoreId: string, banTrustStoreCertificateRequest: BanTrustStoreCertificateRequest)` → `MonoCloudResponse<BannedCertificate>`
- `unbanPkiTrustStoreCertificate(trustStoreId: string, banId: string)` → `MonoCloudResponse<null>`

SPIFFE trust stores:

- `getAllSpiffeTrustStores(page?, size?, sort?)` → `MonoCloudPageResponse<SpiffeTrustStoreSummary[]>`
- `createSpiffeTrustStore(createSpiffeTrustStoreRequest: CreateSpiffeTrustStoreRequest)` → `MonoCloudResponse<SpiffeTrustStore>`
- `findSpiffeTrustStoreById(trustStoreId: string)` → `MonoCloudResponse<SpiffeTrustStore>`
- `patchSpiffeTrustStore(trustStoreId: string, patchSpiffeTrustStoreRequest: PatchSpiffeTrustStoreRequest)` → `MonoCloudResponse<SpiffeTrustStore>`
- `deleteSpiffeTrustStore(trustStoreId: string)` → `MonoCloudResponse<null>`
- `setSpiffeTrustStoreDefault(trustStoreId: string)` → `MonoCloudResponse<SpiffeTrustStore>`

SPIFFE banned SVIDs:

- `getAllSpiffeBannedSvids(trustStoreId: string)` → `MonoCloudResponse<BannedSvid[]>` — **not paginated**
- `banSpiffeTrustStoreSvid(trustStoreId: string, banTrustStoreSvidRequest: BanTrustStoreSvidRequest)` → `MonoCloudResponse<BannedSvid>`
- `unbanSpiffeTrustStoreSvid(trustStoreId: string, banId: string)` → `MonoCloudResponse<null>`

`ICertificateRevocation` is a discriminated union — narrow on `type`: `({ type: 'base' } & BaseCertificateRevocation) | ({ type: 'delta' } & DeltaCertificateRevocation)`.

## `client.networkZones` — `NetworkZonesClient`

IP and Regional network zones (allow/deny access rules), referenced by API access policies. Accessor is camelCase `networkZones`. Each zone is one of two types, discriminated by the `type` field on `INetworkZone`.

> The whole resource is **ScaleX**-gated: the create/patch methods below are annotated as requiring an active ScaleX subscription, and gated calls fail with HTTP 402 → `MonoCloudPaymentRequiredException`.

Listing:

- `getAllNetworkZones(page?, size?, filter?, sort?)` → `MonoCloudPageResponse<INetworkZone[]>` — returns the union; discriminate by `type`.

IP zones:

- `createIpNetworkZone(createIpNetworkZoneRequest: CreateIpNetworkZoneRequest)` → `MonoCloudResponse<IpNetworkZone>` — **ScaleX**
- `findIpNetworkZoneById(zoneId: string)` → `MonoCloudResponse<IpNetworkZone>`
- `patchIpNetworkZone(zoneId: string, patchIpNetworkZoneRequest: PatchIpNetworkZoneRequest)` → `MonoCloudResponse<IpNetworkZone>` — **ScaleX**
- `deleteIpNetworkZone(zoneId: string)` → `MonoCloudResponse<null>`

Regional zones:

- `createRegionalNetworkZone(createRegionalNetworkZoneRequest: CreateRegionalNetworkZoneRequest)` → `MonoCloudResponse<RegionalNetworkZone>` — **ScaleX**
- `findRegionalNetworkZoneById(zoneId: string)` → `MonoCloudResponse<RegionalNetworkZone>`
- `patchRegionalNetworkZone(zoneId: string, patchRegionalNetworkZoneRequest: PatchRegionalNetworkZoneRequest)` → `MonoCloudResponse<RegionalNetworkZone>` — **ScaleX**
- `deleteRegionalNetworkZone(zoneId: string)` → `MonoCloudResponse<null>`

`INetworkZone = ({ type: 'ip' } & IpNetworkZone) | ({ type: 'regional' } & RegionalNetworkZone)`. `NetworkZoneCategory` and `NetworkZoneOperator` are exported enums used by the request/response models.

## Subscription tiers

Subscription gating is documented in-source via `@note` JSDoc tags and enforced at runtime by the server returning HTTP **402** → `MonoCloudPaymentRequiredException`. There is no client-side hard-coded enforcement — the SDK just surfaces the 402. Three named tiers appear.

| Tier | Method-level gates |
|---|---|
| **Pro plan** | `groups.createGroup` (only when creating more than two groups); `users.getAllUserSessions` / `findUserSession` / `revokeUserSession`; `users.getAllUserClientGrants` |
| **Secure+** | `users.getAllUserConsents`, `getAllReferenceTokens`, `getAllRefreshTokens`, `getAllAuthorizationCodes`, `revokeUserClientGrants`, `revokeUserConsent`, `revokeReferenceToken`, `revokeRefreshToken`, `revokeAuthorizationCode` |
| **ScaleX** | `clients.assignGroupToApplication` / `removeGroupFromApplication`; `networkZones.createIpNetworkZone` / `patchIpNetworkZone` / `createRegionalNetworkZone` / `patchRegionalNetworkZone`; `resources.createApiResourceSecret` |

Some create/patch **request fields** are also tier-gated (setting them on a lower tier triggers a 402): consents / JWT request objects (JAR) / Pushed Authorization Requests / back-channel logout are **Secure+**; authenticator restrictions / front-channel logout / sign-up restrictions are **Pro plan**; UserInfo access / multi-audience tokens / long refresh-token lifetimes / API secrets / reference tokens / session binding are **ScaleX**. Consult the specific model's `@note` tags in intellisense.

## PATCH semantics

Every update method is a `patch*` — a partial merge, not a full replace. There are no PUT-style methods on the public surface. Per-field immutability (which properties a given `Patch*Request` accepts) is defined inside each request model; there are no repo-wide `immutable`/`readonly` markers, so treat the [Management API docs](https://www.monocloud.com/docs/apis/management) and TypeScript intellisense on the specific `Patch*Request` type as authoritative for what you may send.

## Defaults

- HTTP timeout when neither `config.timeout` nor `MONOCLOUD_MANAGEMENT_TIMEOUT` is set: **10000 ms** (10 s), applied by the built-in fetcher via `AbortSignal.timeout(...)`. A timeout throws a plain `MonoCloudException` (original `error.name === 'TimeoutError'`).
- Default headers set by the built-in fetcher: `X-API-KEY: <apiKey>` and `Content-Type: application/json`.
- Pagination `page?`/`size?`/`filter?`/`sort?` (and `clientId?`/`sessionId?` on the user token lists) have **no client-side defaults** — when `undefined` they are simply omitted from the query string and the server applies its own defaults. Query field names sent: `page`, `size`, `filter`, `sort`, `client_id`, `session_id`.

## Filter and sort expressions

- `filter` accepts Lucene-style expressions (the searchable fields vary per endpoint; see the [Management API docs](https://www.monocloud.com/docs/apis/management)).
- `sort` is `"<field>:1"` (ascending) or `"<field>:-1"` (descending). Sortable fields are documented per endpoint.

## Environment variables

| Env var | Option | Required? | Purpose |
|---|---|---|---|
| `MONOCLOUD_MANAGEMENT_DOMAIN` | `domain` | yes | Tenant URL, e.g. `example.us.monocloud.com` (no `/api`, no trailing slash). Empty → throws `Tenant Domain is required`. |
| `MONOCLOUD_MANAGEMENT_API_KEY` | `apiKey` | yes | Management API key, sent as `X-API-KEY`. Empty → throws `Api Key is required`. |
| `MONOCLOUD_MANAGEMENT_TIMEOUT` | `config.timeout` | no | Request timeout in **milliseconds** (parsed via `parseInt(…, 10)`; applied only if a positive integer). |

Options passed to `init()` win over environment variables. There is no env var for a custom `fetcher`.
