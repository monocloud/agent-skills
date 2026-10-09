# `MonoCloud.Authentication.Api` — API surface

Verified against `MonoCloud.Authentication.Api@0.1.5` (`monocloud/api-authentication-dotnet` @ `8dc2aed`).

This page lists every public type and member, plus the internals that shape behavior: the request pipeline, claim shaping and the failure messages. Anything marked *internal* can't be referenced from app code.

## Namespaces and public types

| Namespace | Public types |
| --- | --- |
| `MonoCloud.Authentication.Api` | `MonoCloudAuthenticationExtension`, `MonoCloudAuthenticationDefaults`, `MonoCloudAuthenticationOptions`, `MonoCloudAuthenticationEvents`, `MonoCloudAuthenticationHandler`, `CertificateBindingValidation`, `PostConfigureMonoCloudAuthenticationOptions` |
| `MonoCloud.Authentication.Api.Shared` | `IIntrospectionCache`, `JwtAssertion` |
| `MonoCloud.Authentication.Api.Shared.ClientAuth` | `IMonoCloudClientAuth`, `ClientAuthenticationContext`, `ClientSecretAuth`, `JwtAssertionAuth`, `TlsAuth`, `SpiffeX509Auth`, `SpiffeJwtAuth` |
| `MonoCloud.Authentication.Api.Shared.Context` | `IntrospectionRequestContext`, `JwtAssertionContext`, `CertificateBindingValidatedContext` |

Internal: `PostConfigureMonoCloudAuthenticationTimeProvider`, `Utils`, `IntrospectionResult`, `ClaimConverter`, `MtlsEndpointAliases`, `MonoCloudAuthenticationOptions.SchemeName`, and `TlsAuth.Certificate` / `TlsAuth.TrustStore`.

`MessageReceivedContext`, `TokenValidatedContext`, `AuthenticationFailedContext`, `JwtBearerChallengeContext` and `ForbiddenContext` are the framework's types (`Microsoft.AspNetCore.Authentication.JwtBearer`). `TokenValidationParameters`, `SecurityAlgorithms` and `JsonWebKey` come from `Microsoft.IdentityModel.Tokens`, which is a transitive dependency.

## `AddMonoCloudAuthentication`

`MonoCloudAuthenticationExtension` provides:

```csharp
public static AuthenticationBuilder AddMonoCloudAuthentication(this AuthenticationBuilder builder);
public static AuthenticationBuilder AddMonoCloudAuthentication(this AuthenticationBuilder builder, string authenticationScheme);
public static AuthenticationBuilder AddMonoCloudAuthentication(this AuthenticationBuilder builder, Action<MonoCloudAuthenticationOptions> configureOptions);
public static AuthenticationBuilder AddMonoCloudAuthentication(this AuthenticationBuilder builder, string authenticationScheme, Action<MonoCloudAuthenticationOptions>? configureOptions);
```

The first three delegate to the last, using `"MonoCloud"` and/or a `null` action. The last one registers:

- the named client `MonoCloudAuthenticationDefaults.HttpClientName`;
- two singleton `IPostConfigureOptions<MonoCloudAuthenticationOptions>`: `PostConfigureMonoCloudAuthenticationOptions` and an internal `TimeProvider` one. Each is added once, however many schemes you register;
- the scheme itself, added directly to `AuthenticationOptions` with `HandlerType = typeof(MonoCloudAuthenticationHandler)` (not via `AddScheme`);
- the options action as a named `Configure`;
- the handler as transient.

Registering a scheme name twice throws `InvalidOperationException: Scheme already exists: …`.

## `MonoCloudAuthenticationDefaults`

| Constant | Value | Purpose |
| --- | --- | --- |
| `AuthenticationScheme` | `"MonoCloud"` | Default scheme name. |
| `HttpClientName` | `"MonoCloud.AspNetCore.HttpClient"` | Named `IHttpClientFactory` client used when `options.HttpClient` is unset. Customize it with `services.AddHttpClient(MonoCloudAuthenticationDefaults.HttpClientName)…`. |

## `MonoCloudAuthenticationOptions`

`public class MonoCloudAuthenticationOptions : JwtBearerOptions`. The constructor sets `Events = new MonoCloudAuthenticationEvents()`.

### Declared members

| Member | Type | Default | Behavior |
| --- | --- | --- | --- |
| `ClientId` | `string?` | `null` | Required on the introspection path. |
| `ClientAuth` | `IMonoCloudClientAuth?` | `null` | Applied to every introspection request. Required there. |
| `IntrospectJwtTokens` | `bool` | `false` | `true` sends JWT-shaped tokens to introspection instead of validating them locally. |
| `EnableCaching` | `bool` | `false` | Read and write introspection results through the registered `IIntrospectionCache`. |
| `CacheDuration` | `TimeSpan` | 5 min | Maximum TTL, capped at the token's remaining lifetime. |
| `CacheKeyPrefix` | `string` | `""` | Prepended to every generated key. |
| `CacheKeyGenerator` | `Func<MonoCloudAuthenticationOptions, string, string>` | `prefix + Base64(SHA256(UTF8("{scheme}\|{token}")))` | Builds the key from `(options, token)`. The scheme name is internal, so a custom generator can't read it. Give each scheme its own `CacheKeyPrefix` instead. |
| `ClockSkew` | `TimeSpan?` | `null` | Copied to `TokenValidationParameters.ClockSkew` when set. |
| `NameClaimType` | `string?` | `null` | Copied to `TokenValidationParameters.NameClaimType` when set. Used directly for introspected identities. |
| `RoleClaimType` | `string?` | `null` | Copied to `TokenValidationParameters.RoleClaimType` when set. Used directly for introspected identities, and enables `{id,name}` group expansion there. |
| `AuthenticationType` | `string?` | `null` | Identity authentication type; falls back to the scheme name. Copied to `TokenValidationParameters.AuthenticationType` only if that is unset. |
| `ValidateCertificateBinding` | `CertificateBindingValidation` | `WhenPresent` | See [`CertificateBindingValidation`](#certificatebindingvalidation). |
| `CertificateRetriever` | `Func<HttpContext, Task<X509Certificate2?>>` | `async context => await context.Connection.GetClientCertificateAsync()` | Called only when a binding check runs. Return `null` for "no certificate". A throw fails with `Client certificate is malformed`. |
| `JwtAssertionDuration` | `TimeSpan` | 5 min | `exp` of `JwtAssertionAuth` assertions. |
| `JwtAssertionSigningAlgorithm` | `string?` | `null` | Assertion algorithm. Unset: HS256 for a secret or `oct` JWK, RS256 for other JWKs and certificates. |
| `HttpClient` | `HttpClient` | built during post-configuration | Sends introspection requests. Discovery uses it too, through `Backchannel`. |
| `Events` | `MonoCloudAuthenticationEvents` | new instance | `new`-shadows `JwtBearerOptions.Events` with the same backing value. |

### Inherited `JwtBearerOptions` members that matter here

| Member | Default | Behavior with this SDK |
| --- | --- | --- |
| `Authority` | `null` | The tenant domain. Gets `https://` prepended if it lacks `://`. Discovery is `{Authority}/.well-known/openid-configuration` unless `MetadataAddress`, `Configuration` or `ConfigurationManager` is set. Required for introspection. |
| `Audience` | `null` | Copied to `TokenValidationParameters.ValidAudience` when that is empty. |
| `TokenValidationParameters` | framework defaults | JWT-path validation. The MonoCloud name, role, clock-skew and authentication-type options are copied onto it. |
| `MapInboundClaims` | `true` | Applies to the JWT path only. See [Claims shaping](#claims-shaping). |
| `SaveToken` | `true` | Stores the raw token as `access_token` on both paths (`HttpContext.GetTokenAsync("access_token")`). |
| `IncludeErrorDetails` | `true` | Adds `error="invalid_token"` to the 401 challenge, plus `error_description` for framework JWT errors. `false` sends a bare `Bearer`. |
| `RequireHttpsMetadata` | `true` | An `http://` authority throws `InvalidOperationException` unless this is `false`. |
| `RefreshOnIssuerKeyNotFound` | `true` | An unknown `kid` triggers a metadata refresh. |
| `MetadataAddress`, `Configuration`, `ConfigurationManager` | `null` | Override discovery. A `Configuration` becomes a static configuration manager. |
| `Backchannel` | set to `HttpClient` | The discovery client. Because the SDK always fills it, `BackchannelHttpHandler` and `BackchannelTimeout` have no effect. Customize the named client or `options.HttpClient` instead. |
| `Challenge` | `"Bearer"` | Scheme written in `WWW-Authenticate`. |
| `EventsType` | `null` | Resolves the events from DI. `CreatingJwtAssertion` is still raised on `options.Events`, not on this instance. |

### Post-configuration

`PostConfigureMonoCloudAuthenticationOptions(IHttpClientFactory httpClientFactory, IIntrospectionCache? cache = null)` runs once per scheme, when its options are first built (the first request through the scheme). Steps, in order:

1. Records the scheme name (internal; part of cache keys).
2. If `EnableCaching` is on and no `IIntrospectionCache` is registered, throws `ArgumentException: IIntrospectionCache not found in the services collection`.
3. If `ValidateCertificateBinding` isn't a defined value, throws `ArgumentException: ValidateCertificateBinding must be a defined CertificateBindingValidation value`.
4. If `Authority` lacks `://`, prepends `https://`.
5. If `HttpClient` is unset, creates it. A `TlsAuth` / `SpiffeX509Auth` constructed with a certificate gets a new `HttpClient` presenting that certificate; otherwise it comes from `IHttpClientFactory.CreateClient(HttpClientName)`.
6. Sets `Backchannel ??= HttpClient`.
7. Copies onto `TokenValidationParameters`:
   - `AuthenticationType ?? scheme`, only if `TokenValidationParameters.AuthenticationType` is null;
   - `NameClaimType`, `RoleClaimType` and `ClockSkew`, each only when set.
8. Runs the framework's `JwtBearerPostConfigureOptions`, which copies `Audience` → `ValidAudience`, builds the `ConfigurationManager` and enforces `RequireHttpsMetadata`.

## `CertificateBindingValidation`

```csharp
public enum CertificateBindingValidation { WhenPresent, Required, DangerouslyIgnore }
```

Whether a check runs at all:

- `Required` — always.
- `WhenPresent` — when the token has a `cnf` claim that either isn't a JSON object or contains `x5t#S256`.
- `DangerouslyIgnore` — never.

The check behaves the same on JWT, live-introspection and cached results. Once it runs, the first failing step wins. Every failure is a 401 verdict reported through `OnAuthenticationFailed`:

| Step | Failure condition | `Exception.Message` |
| --- | --- | --- |
| 1 | `CertificateRetriever` throws (the original exception becomes the `InnerException`) | `Client certificate is malformed` |
| 2 | Retriever returns `null` | `Client certificate is not present` |
| 3 | No `cnf` claim (only reachable under `Required`) | `Access token does not contain a 'cnf' (confirmation) claim for certificate binding` |
| 4 | `cnf` doesn't deserialize to a JSON object | `Malformed 'cnf' claim for certificate binding` |
| 5 | `cnf` is the JSON literal `null` | `The 'cnf' claim could not be parsed` |
| 6 | No string `x5t#S256` member | `The 'cnf' claim does not contain an 'x5t#S256' member specifying the certificate hash for binding` |
| 7 | base64url(SHA-256(certificate `RawData`)) ≠ `x5t#S256`, compared in constant time | `The certificate hash in the access token does not match the presented client certificate (certificate binding validation failed)` |

On success, `CertificateBindingValidated` is raised. If it sets `context.Result`, that result is returned. Otherwise processing continues to `TokenValidated`.

## Client authentication types

```csharp
public interface IMonoCloudClientAuth
{
    Task AuthenticateAsync(ClientAuthenticationContext context, CancellationToken cancellationToken);
}
```

`ClientAuthenticationContext` has these public readonly fields, set by its constructor in this order:

| Field | Type | Notes |
| --- | --- | --- |
| `Options` | `MonoCloudAuthenticationOptions` | |
| `IntrospectionRequest` | `HttpRequestMessage` | Add headers here. |
| `IntrospectionRequestPayload` | `IDictionary<string, string>` | Form fields; already contains `token`. |
| `HttpContext` | `HttpContext` | |
| `Scheme` | `AuthenticationScheme` | |

| Type | Constructors | Adds to the introspection request |
| --- | --- | --- |
| `ClientSecretAuth` | `(string clientSecret, bool clientSecretBasic = false)` | Post: form fields `client_id`, `client_secret`. Basic: `Authorization: Basic base64(escape(client_id):escape(secret))`. |
| `JwtAssertionAuth` | `(string clientSecret)` · `(JsonWebKey jwk)` · `(X509Certificate2 certificate)` | `client_assertion_type` = `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, plus `client_assertion`. |
| `TlsAuth` | `(X509Certificate2? certificate = null, string? trustStore = null)` | `client_id`. The TLS client certificate proves identity. |
| `SpiffeX509Auth : TlsAuth` | `(X509Certificate2? certificate = null, string? trustStore = null)` | Same as `TlsAuth` (`spiffe_x509`). |
| `SpiffeJwtAuth` | `(string jwtSvid)` · `(Func<HttpContext, CancellationToken, Task<string>> jwtSvidProvider)` | `client_id`, `client_assertion_type` = `urn:ietf:params:oauth:client-assertion-type:jwt-spiffe`, and `client_assertion` = the SVID. |

All built-ins require `options.ClientId`.

- **`JwtAssertionAuth`** first raises `CreatingJwtAssertion` on `context.Options.Events`. If the event sets `context.JwtAssertion`, its `Assertion` and `AssertionType` are posted as-is. Otherwise it reads discovery (needs a `ConfigurationManager`) and signs:
  - `iss` = `sub` = `ClientId`, `aud` = the discovery `issuer`, `jti` = a new GUID, `nbf` = `iat` = now, `exp` = now + `JwtAssertionDuration`;
  - with `JwtAssertionSigningAlgorithm`, or the default described in [Declared members](#declared-members). EC keys need an explicit algorithm such as `SecurityAlgorithms.EcdsaSha256`.
- **`TlsAuth` / `SpiffeX509Auth`** introspect at the discovery endpoint `mtls_endpoint_aliases.introspection_endpoint`. With a `trustStore`, they use `mtls_additional_endpoint_aliases["<trustStore>"].introspection_endpoint`. If the alias is missing they throw `InvalidOperationException: The mTLS introspection endpoint alias was not found in the OpenID configuration. …`. A certificate passed to the constructor is used only when `options.HttpClient` is unset. To supply one yourself (e.g. a rotating certificate), configure the named client:

  ```csharp
  builder.Services.AddHttpClient(MonoCloudAuthenticationDefaults.HttpClientName)
      .ConfigurePrimaryHttpMessageHandler(() =>
      {
          var handler = new HttpClientHandler();
          handler.ClientCertificates.Add(clientCertificate);
          return handler;
      });
  // options.ClientAuth = new TlsAuth();
  ```

- **`SpiffeJwtAuth`** calls its provider on every introspection request. A null or empty SVID throws `InvalidOperationException: The SPIFFE JWT-SVID must not be null or empty`.

## `MonoCloudAuthenticationEvents`

```csharp
public class MonoCloudAuthenticationEvents : JwtBearerEvents
{
    public Func<CertificateBindingValidatedContext, Task> OnCertificateBindingValidated { get; set; } // default: no-op
    public Func<IntrospectionRequestContext, Task> OnIntrospection { get; set; }                     // default: no-op
    public Func<JwtAssertionContext, Task> OnCreatingJwtAssertion { get; set; }                      // default: no-op

    public virtual Task CertificateBindingValidated(CertificateBindingValidatedContext context);
    public virtual Task Introspection(IntrospectionRequestContext context);
    public virtual Task CreatingJwtAssertion(JwtAssertionContext context);
}
```

The inherited `OnMessageReceived`, `OnTokenValidated`, `OnAuthenticationFailed`, `OnChallenge` and `OnForbidden` fire for JWT and introspected tokens alike.

| Event | Context | Raised | What the handler honors |
| --- | --- | --- | --- |
| `MessageReceived` | `MessageReceivedContext` | Once per request, first. | `Token` (validate this token); `Result` (returned as-is). |
| `TokenValidated` | `TokenValidatedContext` | After normalization and the binding check. `SecurityToken` is the `JsonWebToken` on the JWT path and `null` when introspected. | `Result`, e.g. via `Fail(…)`. |
| `AuthenticationFailed` | `AuthenticationFailedContext` | JWT validation failure, `Token inactive`, binding failure, or an introspection-path exception. | `Result` replaces the failure, and suppresses the rethrow for exceptions. |
| `Challenge` | `JwtBearerChallengeContext` | 401 challenge. | `HandleResponse()` skips the default response. |
| `Forbidden` | `ForbiddenContext` | 403. | — |
| `Introspection` | `IntrospectionRequestContext` (`HttpRequestMessage IntrospectionRequest`) | Before sending; the form body and client authentication are already applied. | The possibly replaced `IntrospectionRequest` is sent. `Result` is ignored. |
| `CreatingJwtAssertion` | `JwtAssertionContext` (`JwtAssertion? JwtAssertion`) | Inside `JwtAssertionAuth`, on `options.Events`. | `JwtAssertion` is used verbatim. `Result` is ignored. |
| `CertificateBindingValidated` | `CertificateBindingValidatedContext` | After a thumbprint match. | `Result` (e.g. `Fail(…)`) is returned. |

The three MonoCloud contexts derive from `ResultContext<MonoCloudAuthenticationOptions>`. That base provides `HttpContext`, `Scheme`, `Options`, `Principal`, `Properties`, `Result`, `Success()`, `Fail(…)` and `NoResult()`.

## `IIntrospectionCache`

```csharp
public interface IIntrospectionCache
{
    Task<string?> GetAsync(string key, CancellationToken cancellationToken);
    Task SetAsync(string key, string value, TimeSpan expiresIn, CancellationToken cancellationToken);
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}
```

- **Lifetime.** Register it as a singleton. The singleton post-configure step takes it as an optional dependency, so a scoped registration fails DI scope validation.
- **Stored value.** A JSON array of `{"Type":"…","Value":"…"}` holding the raw introspection claims (before group expansion). `ValueType` and `Issuer` are not kept.
- **Flow with `EnableCaching`.**
  1. Call `GetAsync`. An exception is logged and treated as a miss.
  2. On a hit, an `active` claim equal to `false` (case-insensitive) fails with `Token inactive`. Any other hit goes to the binding check and the ticket, with no network call.
  3. On a miss, introspect:
     - Active: `SetAsync`, then the binding check and the ticket.
     - Inactive: add `active=false` if the response had no `active` member, `SetAsync`, then fail with `Token inactive`.

     A failing `SetAsync` is logged and doesn't fail the request.
- **TTL.** `CacheDuration` by default. If there's a numeric `exp` claim and the token has already expired, nothing is stored. If it expires before now + `CacheDuration`, the TTL is the remaining lifetime. A missing or non-numeric `exp` gets the full `CacheDuration`.
- **Eviction.** The SDK never calls `DeleteAsync`. Compute the key with the scheme's post-configured options, whose generator includes the scheme name:

  ```csharp
  var o = optionsMonitor.Get(MonoCloudAuthenticationDefaults.AuthenticationScheme); // IOptionsMonitor<MonoCloudAuthenticationOptions>
  await cache.DeleteAsync(o.CacheKeyGenerator(o, token), cancellationToken);
  ```

- **In-flight de-duplication.** This is always on, independent of `EnableCaching`. Concurrent introspections of the same token under the same scheme share one HTTP call through a static in-process map keyed `"{scheme}|{token}"`. The entry is removed when the call completes, so it is not a result cache.

## `JwtAssertion`

```csharp
public class JwtAssertion
{
    public string Assertion { get; set; } = string.Empty;     // posted as client_assertion
    public string AssertionType { get; set; } = string.Empty; // posted as client_assertion_type
}
```

## Request pipeline

`public class MonoCloudAuthenticationHandler : JwtBearerHandler` has the constructor `(IOptionsMonitor<MonoCloudAuthenticationOptions> options, ILoggerFactory logger, UrlEncoder encoder, IIntrospectionCache? cache = null)`. `AddMonoCloudAuthentication` registers it, so apps never construct it. Challenge and forbid responses are the base `JwtBearerHandler`'s.

1. Raise `MessageReceived` once. If it sets a `Result`, return that.
2. Take the token from `context.Token`, else from the `Authorization: Bearer …` header (scheme matched case-insensitively). If there's none, return `NoResult()`.
3. **JWT path** — when `IntrospectJwtTokens` is `false` and `JsonWebTokenHandler.CanReadToken(token)` (compact JWS/JWE):
   1. The base handler validates against `TokenValidationParameters` and the discovery keys.
   2. Before your `TokenValidated` runs, the SDK expands groups, splits scopes and checks certificate binding.
   3. A binding failure fails the request, and your `TokenValidated` is skipped.
4. **Introspection path** — every other token:
   1. Require `ClientId` and `Authority`, else `ArgumentNullException`.
   2. Look up the cache.
   3. Run a de-duplicated introspection: discovery, endpoint selection, the `token` form field, `ClientAuth`, the `Introspection` event, the POST, `EnsureSuccessStatusCode`, then JSON parsing. The response must have `active: true`. `Audience`, issuer and `TokenValidationParameters` are not applied on this path.
   4. Check certificate binding.
   5. Build the identity: `AuthenticationType ?? scheme`, `NameClaimType`, `RoleClaimType`, with group expansion when `RoleClaimType` is set.
   6. Raise `TokenValidated`, then store `access_token` if `SaveToken` is on.
5. On the introspection path, an exception raises `AuthenticationFailed` with the original exception. If that sets a `Result`, it's returned; otherwise the exception is rethrown.

## Claims shaping

| | JWT path | Introspection path |
| --- | --- | --- |
| Source | Validated token claims (`JsonWebTokenHandler`). | Every top-level member of the introspection response, including `active`. |
| Claim-type renaming | `MapInboundClaims` (default `true`): `sub` → `ClaimTypes.NameIdentifier`, `email` → `ClaimTypes.Email`, `role` / `roles` → `ClaimTypes.Role`, `unique_name` → `ClaimTypes.Name`, and others. `name`, `scope`, `groups` and `cnf` are unchanged. | Never. |
| Arrays | One claim per element. | One claim per element; non-string elements as raw JSON. |
| Objects | One claim holding raw JSON. | One claim holding raw JSON. |
| `scope` | Space-delimited values split into one `scope` claim each. | Split (string), or one claim per string element (array). |
| `{id,name}` group objects | Expanded into an id claim and a name claim for the type `RoleClaimType ?? TokenValidationParameters.RoleClaimType`. | Expanded only when `RoleClaimType` is set. |
| Identity | Built from `TokenValidationParameters`. Claim-type lookups are case-sensitive (`CaseSensitiveClaimsIdentity`) with Microsoft.IdentityModel 8, the default on `net9.0` / `net10.0`. | `new ClaimsIdentity(claims, AuthenticationType ?? scheme, NameClaimType, RoleClaimType)`. `null` types fall back to `ClaimTypes.Name` / `ClaimTypes.Role`. |

## Failure reference

"500" means the exception propagates out of authentication.

| Stage | Condition | Exception / message | Result |
| --- | --- | --- | --- |
| Startup / first use | Same scheme registered twice | `InvalidOperationException: Scheme already exists: …` | Fails |
| Options build | `EnableCaching` with no `IIntrospectionCache` | `ArgumentException: IIntrospectionCache not found in the services collection` | 500 |
| `builder.Build()` (Development) or options build | `IIntrospectionCache` registered as scoped, with DI scope validation on | `Cannot consume scoped service '…IIntrospectionCache' from singleton …` | Fails |
| Options build | Undefined `ValidateCertificateBinding` | `ArgumentException: ValidateCertificateBinding must be a defined CertificateBindingValidation value` | 500 |
| Options build | `http://` authority while `RequireHttpsMetadata` is on | `InvalidOperationException: The MetadataAddress or Authority must use HTTPS unless disabled for development by setting RequireHttpsMetadata=false.` | 500 |
| JWT path | Bad signature, issuer, audience or lifetime; discovery/JWKS unreachable | IdentityModel validation exception. `error_description` is set only for known `SecurityToken…` types, e.g. `The token expired at '…'`, `The audience '…' is invalid`, `The signature key was not found`. | 401 |
| Introspection | `ClientId` empty | `ArgumentNullException: Client ID must be set` | 500; `AuthenticationFailed` not raised |
| Introspection | `Authority` empty | `ArgumentNullException: Authority must be set` | 500; `AuthenticationFailed` not raised |
| Introspection | `ClientAuth` null | `ArgumentNullException` (`ClientAuth`) | 500 unless handled |
| Introspection | mTLS alias missing | `InvalidOperationException: The mTLS introspection endpoint alias was not found …` | 500 unless handled |
| Introspection | Empty JWT-SVID | `InvalidOperationException: The SPIFFE JWT-SVID must not be null or empty` | 500 unless handled |
| Introspection | Discovery or transport error, non-2xx response | `HttpRequestException` | 500 unless handled |
| Introspection | Response isn't JSON | `JsonException` | 500 unless handled |
| Introspection | `active` isn't `true` | `Token inactive` | 401 |
| Both | Certificate binding | See [`CertificateBindingValidation`](#certificatebindingvalidation) | 401 |
| Both | Your event handler throws | That exception | 500 unless handled |

"Unless handled" means `OnAuthenticationFailed` sets `context.Result`. Every 401 verdict carries `WWW-Authenticate: Bearer error="invalid_token"` while `IncludeErrorDetails` is on. MonoCloud's own messages aren't put into `error_description`, so read them from `context.Exception` or the logs.

## Links

- Quickstart: <https://www.monocloud.com/docs/quickstarts/dotnet-api-authentication>
- SDK reference: <https://www.monocloud.com/docs/sdks/dotnet-api-authentication>
- API reference: <https://monocloud.github.io/api-authentication-dotnet>
- Source: <https://github.com/monocloud/api-authentication-dotnet>
