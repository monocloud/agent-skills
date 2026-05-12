# `@monocloud/management` — API surface

Exhaustive export list, verified against `packages/management/src/` and `packages/core/src/` on `@monocloud/management@0.2.5`. Methods are listed verbatim with positional parameters; TypeScript intellisense (`go-to-definition`) is the source of truth for full request/response model fields.

## Quick reference

The surface most apps actually reach for — full method lists, request types, and gotchas follow below.

- Entry point: `MonoCloudManagementClient.init(options?, fetcher?)` — returns a singleton-style client.
- Resource clients hang off it: `.users`, `.clients`, `.groups`, `.resources`, `.keys`, `.logs`, `.options`, `.branding`, `.trustStores`.
- Most-used methods: `users.getAllUsers / createUser / findUserById / patchPrivateData / patchPublicData / patchClaims / disableUser / enableUser`, `clients.getAllApplications / createApplication / patchApplication`, `groups.getAllGroups / createGroup`, `keys.getAllKeyMaterials`, `logs.getAllLogs`.
- Response wrappers: `MonoCloudResponse<T>` (`.result`, `.status`, `.headers`) and `MonoCloudPageResponse<T>` (adds `.pageData`).
- Errors: subclasses of `MonoCloudRequestException` — `MonoCloudNotFoundException`, `MonoCloudConflictException`, `MonoCloudIdentityValidationException`, … Base `MonoCloudException` has no `statusCode`; branch with `instanceof` or read `(e as MonoCloudRequestException).response?.status`.
- Common gotchas: `clients.*` methods are named `*Application*` (not `*Client*`); the user identifier is `User.user_id` (not `user.id`); the SDK appends `/api/` itself — don't include it in `domain`.

## Top-level exports

From `@monocloud/management` (re-exported through `@monocloud/management-core`):

```ts
import {
  MonoCloudManagementClient,
  MonoCloudResponse,
  // exception classes
  MonoCloudException,
  MonoCloudBadRequestException,
  MonoCloudConflictException,
  MonoCloudForbiddenException,
  MonoCloudIdentityValidationException,
  MonoCloudKeyValidationException,
  MonoCloudModelStateException,
  MonoCloudNotFoundException,
  MonoCloudPaymentRequiredException,
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

All request/response models (`User`, `CreateUserRequest`, `Application`, `Group`, `ApiResource`, `Log`, `KeyMaterial`, `TrustStore`, etc.) are re-exported from the package root via `export * from './models'`.

`MonoCloudPageResponse<T>`, `MonoCloudClientBase`, `ProblemDetails`, and `MonoCloudRequest` are part of the runtime shape (they're the return types of paginated methods, the parent of every resource client, the `.response` field on `MonoCloudRequestException`, etc.) but they aren't re-exported as named imports from `@monocloud/management`. Import them from `@monocloud/management-core` if you need to reference them directly — usually TypeScript inference from the method return types is enough.

## `MonoCloudManagementClient`

Created via the static factory `MonoCloudManagementClient.init()`. The constructor is `private`.

```ts
class MonoCloudManagementClient {
  readonly branding: BrandingClient;
  readonly clients: ClientsClient;
  readonly groups: GroupsClient;
  readonly keys: KeysClient;
  readonly logs: LogsClient;
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

- `options.domain` — tenant URL; falls back to `process.env.MONOCLOUD_MANAGEMENT_DOMAIN`. The base client appends `/api/` automatically.
- `options.apiKey` — Management API key; falls back to `process.env.MONOCLOUD_MANAGEMENT_API_KEY`. Sent as the `X-API-KEY` header.
- `options.config.timeout` — per-request timeout in **milliseconds**; falls back to `MONOCLOUD_MANAGEMENT_TIMEOUT` (parsed as integer). Default: `10000`.
- `fetcher` — optional `Fetcher` to replace the built-in `fetch` implementation. When provided, the SDK does **not** add the API-key or base-URL headers itself — you own that wiring.

```ts
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface MonoCloudConfig {
  domain: string;
  apiKey: string;
  config?: { timeout?: number };
}
```

## Response envelopes

```ts
class MonoCloudResponse<TResult = unknown> {
  status: number;
  headers: Record<string, any>;
  result: TResult;
}

class MonoCloudPageResponse<TResult = unknown> extends MonoCloudResponse<TResult> {
  pageData: PageModel;     // always present on paginated calls (not optional)
}

interface PageModel {
  page_size: number;
  current_page: number;
  total_count: number;
  has_previous: boolean;
  has_next: boolean;
}
```

Pagination metadata comes from the response's `X-Pagination` header. When the header is missing, `pageData` is populated with zeros / `false`.

## Exception hierarchy

```ts
class MonoCloudException extends Error {}

class MonoCloudRequestException extends MonoCloudException {
  response?: ProblemDetails;       // populated when the server returns application/problem+json
}

class MonoCloudBadRequestException        extends MonoCloudRequestException {}   // 400
class MonoCloudUnauthorizedException      extends MonoCloudRequestException {}   // 401
class MonoCloudPaymentRequiredException   extends MonoCloudRequestException {}   // 402
class MonoCloudForbiddenException         extends MonoCloudRequestException {}   // 403
class MonoCloudNotFoundException          extends MonoCloudRequestException {}   // 404
class MonoCloudConflictException          extends MonoCloudRequestException {}   // 409
class MonoCloudIdentityValidationException extends MonoCloudRequestException {
  errors: IdentityError[];         // 422 with type=identity-validation-error
}
class MonoCloudKeyValidationException     extends MonoCloudRequestException {
  errors: Record<string, string[]>;// 422 with type=validation-error
}
class MonoCloudModelStateException        extends MonoCloudRequestException {}   // 422 (other)
class MonoCloudResourceExhaustedException extends MonoCloudRequestException {}   // 429
class MonoCloudServerException            extends MonoCloudRequestException {}   // 5xx
```

`MonoCloudException` itself only has `.message` (inherited from `Error`). To branch on status, use `instanceof` against the specific subclass — there is no `statusCode` property to read.

To read the original problem-details payload (when present), use `.response`:

```ts
catch (e) {
  if (e instanceof MonoCloudRequestException) {
    console.log(e.response?.status, e.response?.title, e.response?.detail);
  }
}
```

```ts
class ProblemDetails {
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

class IdentityError {
  code: string;
  description: string;
}
```

## `client.users` — `UsersClient`

User lifecycle and identifiers.

| Method | Returns |
|---|---|
| `getAllUsers(page?, size?, filter?, sort?)` | `MonoCloudPageResponse<UserSummary[]>` |
| `createUser(req: CreateUserRequest)` | `MonoCloudResponse<User>` |
| `findUserById(userId)` | `MonoCloudResponse<User>` |
| `deleteUser(userId)` | `MonoCloudResponse<null>` |
| `enableUser(userId)` | `MonoCloudResponse<User>` |
| `disableUser(userId, req: DisableUserRequest)` | `MonoCloudResponse<User>` |
| `unblockUser(userId)` | `MonoCloudResponse<User>` |
| `updateUsername(userId, req: UpdateUsernameRequest)` | `MonoCloudResponse<User>` |
| `removeUsername(userId)` | `MonoCloudResponse<User>` |

Emails:

- `addEmail(userId, req: AddEmailRequest)` → `MonoCloudResponse<User>`
- `removeEmail(userId, identifierId)` → `MonoCloudResponse<User>`
- `setPrimaryEmail(userId, identifierId)` → `MonoCloudResponse<User>`
- `setEmailVerified(userId, identifierId)` → `MonoCloudResponse<User>`
- `setEmailUnverified(userId, identifierId)` → `MonoCloudResponse<User>`
- `verifyEmail(userId, identifierId, req: VerifyEmailRequest)` → `MonoCloudResponse<VerifyEmailResponse>`

Phones:

- `addPhone(userId, req: AddPhoneRequest)` → `MonoCloudResponse<User>`
- `removePhone(userId, identifierId)` → `MonoCloudResponse<User>`
- `setPrimaryPhone(userId, identifierId)` → `MonoCloudResponse<User>`
- `setPhoneVerified(userId, identifierId)` → `MonoCloudResponse<User>`
- `setPhoneUnverified(userId, identifierId)` → `MonoCloudResponse<User>`

Passkeys / passwords:

- `removePasskey(userId, passkeyId)` → `MonoCloudResponse<null>`
- `setPassword(userId, req: SetPasswordRequest)` → `MonoCloudResponse<User>`
- `removePassword(userId)` → `MonoCloudResponse<null>`
- `setPasswordResetRequired(userId)` → `MonoCloudResponse<User>`
- `removePasswordResetRequired(userId)` → `MonoCloudResponse<User>`
- `resetPassword(userId, req: ResetPasswordRequest)` → `MonoCloudResponse<ResetPasswordResponse>`
- `changePassword(userId, req: ChangePasswordRequest)` → `MonoCloudResponse<User>`

Claims / public / private data:

- `patchClaims(userId, req: UpdateClaimsRequest)` → `MonoCloudResponse<User>`
- `getPrivateData(userId)` → `MonoCloudResponse<UserPrivateData>`
- `patchPrivateData(userId, req: UpdatePrivateDataRequest)` → `MonoCloudResponse<UserPrivateData>`
- `getPublicData(userId)` → `MonoCloudResponse<UserPublicData>`
- `patchPublicData(userId, req: UpdatePublicDataRequest)` → `MonoCloudResponse<UserPublicData>`

IP access:

- `getAllBlockedIps(userId, page?, size?, filter?, sort?)` → `MonoCloudPageResponse<UserIpAccessDetails[]>`
- `unblockIp(userId, req: UnblockIpRequest)` → `MonoCloudResponse<User>`

Sessions:

- `getAllUserSessions(userId, page?, size?, clientId?, sort?)` → `MonoCloudPageResponse<UserSession[]>`
- `findUserSession(userId, sessionId)` → `MonoCloudResponse<UserSession>`
- `revokeUserSession(userId, sessionId)` → `MonoCloudResponse<null>`

External authenticators:

- `externalAuthenticatorDisconnect(userId, req: ExternalAuthenticatorDisconnectRequest)` → `MonoCloudResponse<User>` — `req.authenticator` is an `ExternalAuthenticators` enum value.

Groups (membership lives on the user, not the group):

- `getAllUserGroups(userId, page?, size?, sort?)` → `MonoCloudPageResponse<UserGroup[]>`
- `findUserGroup(userId, groupId)` → `MonoCloudResponse<UserGroup>`
- `assignUserToGroup(userId, groupId)` → `MonoCloudResponse<UserGroup>`
- `removeUserFromGroup(userId, groupId)` → `MonoCloudResponse<null>`
- `getAllGroupAssignedUsers(groupId, page?, size?, filter?, sort?)` → `MonoCloudPageResponse<UserSummary[]>` — group-side view.

Grants, consents, tokens, codes:

- `getAllUserClientGrants(userId, page?, size?)` → `MonoCloudPageResponse<UserClientGrants[]>`
- `getAllUserConsents(userId, page?, size?, clientId?, sort?)` → `MonoCloudPageResponse<UserConsent[]>`
- `getAllReferenceTokens(userId, page?, size?, clientId?, sessionId?, sort?)` → `MonoCloudPageResponse<ReferenceToken[]>`
- `getAllRefreshTokens(userId, page?, size?, clientId?, sessionId?, sort?)` → `MonoCloudPageResponse<RefreshToken[]>`
- `getAllAuthorizationCodes(userId, page?, size?, clientId?, sessionId?, sort?)` → `MonoCloudPageResponse<AuthorizationCode[]>`
- `revokeUserClientGrants(userId, clientId)` → `MonoCloudResponse<null>`
- `revokeUserConsent(userId, consentId)` → `MonoCloudResponse<null>`
- `revokeReferenceToken(userId, tokenId)` → `MonoCloudResponse<null>`
- `revokeRefreshToken(userId, tokenId)` → `MonoCloudResponse<null>`
- `revokeAuthorizationCode(userId, codeId)` → `MonoCloudResponse<null>`

> `User.user_id` is the identifier field on the response model — not `user.id`.

## `client.clients` — `ClientsClient`

OAuth applications. The property is named `clients`, but the underlying REST resource is `applications` and the SDK method names follow the resource name.

| Method | Returns |
|---|---|
| `getAllApplications(page?, size?, filter?, sort?)` | `MonoCloudPageResponse<Application[]>` |
| `createApplication(req: CreateApplicationRequest)` | `MonoCloudResponse<Application>` |
| `findApplicationById(clientId)` | `MonoCloudResponse<Application>` |
| `patchApplication(clientId, req: PatchApplicationRequest)` | `MonoCloudResponse<Application>` |
| `deleteApplication(clientId)` | `MonoCloudResponse<null>` |

Application secrets:

- `getAllApplicationSecrets(clientId)` → `MonoCloudResponse<Secret[]>` (not paginated)
- `createApplicationSecret(clientId, req: CreateSecretRequest)` → `MonoCloudResponse<Secret>`
- `findApplicationSecretById(clientId, secretId)` → `MonoCloudResponse<Secret>`
- `deleteApplicationSecret(clientId, secretId)` → `MonoCloudResponse<null>`

Application ↔ group mapping:

- `getAllApplicationGroups(clientId, page?, size?, sort?)` → `MonoCloudPageResponse<ApplicationGroup[]>`
- `findApplicationGroup(clientId, groupId)` → `MonoCloudResponse<ApplicationGroup>`
- `assignGroupToApplication(clientId, groupId)` → `MonoCloudResponse<null>`
- `removeGroupFromApplication(clientId, groupId)` → `MonoCloudResponse<null>`
- `getAllGroupAssignedApplications(groupId, page?, size?, filter?, sort?)` → `MonoCloudPageResponse<Application[]>`

## `client.groups` — `GroupsClient`

| Method | Returns |
|---|---|
| `getAllGroups(page?, size?, filter?, sort?)` | `MonoCloudPageResponse<Group[]>` |
| `createGroup(req: CreateGroupRequest)` | `MonoCloudResponse<Group>` |
| `findGroupById(groupId)` | `MonoCloudResponse<Group>` |
| `patchGroup(groupId, req: PatchGroupRequest)` | `MonoCloudResponse<Group>` |
| `deleteGroup(groupId)` | `MonoCloudResponse<null>` |

Group membership is managed from the **user** side (`users.assignUserToGroup` / `users.removeUserFromGroup`) and queried from either side (`users.getAllUserGroups` / `users.getAllGroupAssignedUsers`). There are no `addGroupMember` / `removeGroupMember` methods on `GroupsClient`.

## `client.resources` — `ResourcesClient`

API resources (audiences), API scopes, scope claims, claim resources.

API resources:

- `getAllApiResources(page?, size?, filter?, sort?)` → `MonoCloudPageResponse<ApiResource[]>`
- `createApiResource(req: CreateApiResourceRequest)` → `MonoCloudResponse<ApiResource>`
- `findApiResourceById(apiId)` → `MonoCloudResponse<ApiResource>`
- `patchApiResource(apiId, req: PatchApiResourceRequest)` → `MonoCloudResponse<ApiResource>`
- `deleteApiResource(apiId)` → `MonoCloudResponse<null>`

API resource secrets:

- `getAllApiResourceSecrets(apiId)` → `MonoCloudResponse<Secret[]>` (not paginated)
- `createApiResourceSecret(apiId, req: CreateSecretRequest)` → `MonoCloudResponse<Secret>`
- `findApiResourceSecretById(secretId, apiId)` → `MonoCloudResponse<Secret>`
- `deleteApiResourceSecret(apiId, secretId)` → `MonoCloudResponse<null>`

API scopes (scoped to one resource):

- `getAllApiScopes(apiId, page?, size?, filter?, sort?)` → `MonoCloudPageResponse<ApiScope[]>`
- `createApiScope(apiId, req: CreateApiScopeRequest)` → `MonoCloudResponse<ApiScope>`
- `findApiScopeById(scopeId, apiId)` → `MonoCloudResponse<ApiScope>`
- `patchApiScope(scopeId, apiId, req: PatchApiScopeRequest)` → `MonoCloudResponse<ApiScope>`
- `deleteApiScope(scopeId, apiId)` → `MonoCloudResponse<null>`

API resource ↔ client mappings:

- `getAllApiResourceClients(apiId, page?, size?, sort?)` → `MonoCloudPageResponse<ApiResourceClient[]>`
- `getAllClientApiResources(clientId, page?, size?, sort?)` → `MonoCloudPageResponse<ApiResourceClient[]>`
- `createApiResourceClient(apiId, clientId, req: CreateApiResourceClientRequest)` → `MonoCloudResponse<ApiResourceClient>`
- `findApiResourceClient(apiId, clientId)` → `MonoCloudResponse<ApiResourceClient>`
- `patchApiResourceClient(apiId, clientId, req: PatchApiResourceClientRequest)` → `MonoCloudResponse<ApiResourceClient>`
- `removeApiResourceClient(apiId, clientId)` → `MonoCloudResponse<null>`

Identity scopes (tenant-wide):

- `getAllScopes(page?, size?, filter?, sort?)` → `MonoCloudPageResponse<Scope[]>`
- `createScope(req: CreateScopeRequest)` → `MonoCloudResponse<Scope>`
- `findScopeById(scopeId)` → `MonoCloudResponse<Scope>`
- `patchScope(scopeId, req: PatchScopeRequest)` → `MonoCloudResponse<Scope>`
- `deleteScope(scopeId)` → `MonoCloudResponse<null>`

Claim resources (custom claims):

- `getAllClaimResources(page?, size?, filter?, sort?)` → `MonoCloudPageResponse<ClaimResource[]>`
- `createClaimResource(req: CreateClaimResourceRequest)` → `MonoCloudResponse<ClaimResource>`
- `findClaimResourceById(claimId)` → `MonoCloudResponse<ClaimResource>`
- `patchClaimResource(claimId, req: PatchClaimResourceRequest)` → `MonoCloudResponse<ClaimResource>`
- `deleteClaimResource(claimId)` → `MonoCloudResponse<null>`

## `client.keys` — `KeysClient`

Signing keys are managed by the platform — only enumeration, rotation, and revocation are exposed.

- `getAllKeyMaterials(page?, size?)` → `MonoCloudPageResponse<KeyMaterial[]>`
- `rotateKey(keyId)` → `MonoCloudResponse<null>`
- `revokeKey(keyId)` → `MonoCloudResponse<null>`

There is no `createKey`, `findKeyById`, or `getAllKeys` — those don't exist in the SDK.

## `client.logs` — `LogsClient`

- `getAllLogs(page?, size?, filter?, sort?)` → `MonoCloudPageResponse<Log[]>`
- `findLogById(logId)` → `MonoCloudResponse<Log>`

## `client.options` — `OptionsClient`

Tenant-wide settings. The SDK exposes `Authentication`, `Communication`, and sign-up-custom-fields options. Other option areas (recovery methods, identifier policies, per-provider external authenticator options) are **not** currently surfaced as discrete methods on this client.

- `findAuthenticationOptions()` → `MonoCloudResponse<AuthenticationOptions>`
- `patchAuthenticationOptions(req: PatchAuthenticationOptionsRequest)` → `MonoCloudResponse<AuthenticationOptions>`
- `findCommunicationOptions()` → `MonoCloudResponse<CommunicationOptions>`
- `patchCommunicationOptions(req: PatchCommunicationOptionsRequest)` → `MonoCloudResponse<CommunicationOptions>`

Sign-up custom fields:

- `getAllSignUpCustomFields()` → `MonoCloudResponse<SignUpCustomField[]>`
- `createSignUpCustomField(req: CreateSignUpCustomFieldRequest)` → `MonoCloudResponse<SignUpCustomField>`
- `findSignUpCustomFieldByName(claimName)` → `MonoCloudResponse<SignUpCustomField>`
- `patchSignUpCustomField(claimName, req: PatchSignUpCustomFieldRequest)` → `MonoCloudResponse<SignUpCustomField>`
- `deleteSignUpCustomField(claimName)` → `MonoCloudResponse<null>`

## `client.branding` — `BrandingClient`

Three distinct surfaces, each with `find* / patch*`:

- `findPageBrandingOptions()` → `MonoCloudResponse<PageBrandingOptions>`
- `patchPageBrandingOptions(req: PatchPageBrandingOptionsRequest)` → `MonoCloudResponse<PageBrandingOptions>`
- `findEmailBrandingOptions()` → `MonoCloudResponse<EmailBrandingOptions>`
- `patchEmailBrandingOptions(req: PatchEmailBrandingOptionsRequest)` → `MonoCloudResponse<EmailBrandingOptions>`
- `findSmsBrandingOptions()` → `MonoCloudResponse<SmsBrandingOptions>`
- `patchSmsBrandingOptions(req: PatchSmsBrandingOptionsRequest)` → `MonoCloudResponse<SmsBrandingOptions>`

There is no `getBranding()` / `patchBranding()` umbrella method.

## `client.trustStores` — `TrustStoresClient`

mTLS trust stores, plus revocation and ban lists.

Trust stores:

- `getAllTrustStores(page?, size?, sort?)` → `MonoCloudPageResponse<TrustStoreSummary[]>`
- `createTrustStore(req: CreateTrustStoreRequest)` → `MonoCloudResponse<TrustStore>`
- `findTrustStoreById(trustStoreId)` → `MonoCloudResponse<TrustStore>`
- `patchTrustStore(trustStoreId, req: PatchTrustStoreRequest)` → `MonoCloudResponse<TrustStore>`
- `deleteTrustStore(trustStoreId)` → `MonoCloudResponse<null>`
- `setTrustStoreDefault(trustStoreId)` → `MonoCloudResponse<TrustStore>`

Certificate revocations:

- `getAllRevocations(trustStoreId, page?, size?, sort?)` → `MonoCloudPageResponse<RevocationGrouped[]>`
- `addCertificateRevocation(trustStoreId, req: AddCertificateRevocationRequest)` → `MonoCloudResponse<CertificateRevocation>`
- `findCertificateRevocation(trustStoreId, revocationId)` → `MonoCloudResponse<CertificateRevocation>`
- `removeCertificateRevocation(trustStoreId, revocationId)` → `MonoCloudResponse<null>`

Banned certificates:

- `getAllBannedCertificates(trustStoreId)` → `MonoCloudResponse<BannedCertificate[]>` (not paginated)
- `banTrustStoreCertificate(trustStoreId, req: BanTrustStoreCertificateRequest)` → `MonoCloudResponse<BannedCertificate>`
- `unbanTrustStoreCertificate(trustStoreId, banId)` → `MonoCloudResponse<null>`

## Defaults

- HTTP timeout when neither `config.timeout` nor `MONOCLOUD_MANAGEMENT_TIMEOUT` is set: **10000 ms** (10s), via `AbortSignal.timeout(...)`.
- Pagination `page` parameter is **1-indexed**. The server defines its own default `size` per endpoint (typically 10).

## Filter and sort expressions

- `filter` accepts Lucene-style expressions (varies per endpoint; see the [Management API docs](https://www.monocloud.com/docs/apis/management)).
- `sort` is `"<field>:1"` (ascending) or `"<field>:-1"` (descending). Sortable fields are documented per method.

## Environment variables

| Env var | Option | Required? | Purpose |
|---|---|---|---|
| `MONOCLOUD_MANAGEMENT_DOMAIN` | `domain` | yes | Tenant URL (no `/api`, no trailing slash) |
| `MONOCLOUD_MANAGEMENT_API_KEY` | `apiKey` | yes | Management API key (sent as `X-API-KEY`) |
| `MONOCLOUD_MANAGEMENT_TIMEOUT` | `config.timeout` | no | Request timeout in milliseconds |

Options passed to `init()` always win over environment variables. There is no env var for a custom `fetcher`.
