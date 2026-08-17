# `MonoCloud.Authentication.Api` — API surface

Exhaustive type-by-type surface for the `MonoCloud.Authentication.Api` NuGet package — the MonoCloud **ASP.NET Core authentication handler** for validating access tokens on APIs / resource servers. Verified against `MonoCloud.Authentication.Api/` (source) and `README.nuget.md` on **`MonoCloud.Authentication.Api@0.1.4`** (repo `monocloud/api-authentication-dotnet`, tag `v0.1.4`, clean tree). Signatures are listed **verbatim** from source, including default parameter values. IDE intellisense (go-to-definition) is the source of truth for members not listed here.

This is a standard ASP.NET Core authentication handler (built on `Microsoft.AspNetCore.Authentication.JwtBearer`) that plugs into `AddAuthentication()`, `[Authorize]`, and the authorization **policy system**. It is **not** a middleware you write, **not** a management client, and it has **no** `protectApi` factory (that is the Node express/fastify SDK — a different skill). See [What this SDK does NOT have](#what-this-sdk-does-not-have).

- **Install:** `dotnet add package MonoCloud.Authentication.Api`
- **Target frameworks:** `net8.0; net9.0; net10.0` (supports **>= .NET 8.0**). The `net6.0`/`net7.0` targets were dropped in 0.1.3.
- **Package id / assembly / root namespace:** all `MonoCloud.Authentication.Api`.

## Quick reference

The surface most apps actually reach for — full detail follows below.

- Register: `services.AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme).AddMonoCloudAuthentication(options => { … })`, then `app.UseAuthentication(); app.UseAuthorization();`.
- Entry point: [`AddMonoCloudAuthentication(…)`](#monocloudauthenticationextension) — 4 overloads on `AuthenticationBuilder`.
- Options bag: [`MonoCloudAuthenticationOptions`](#monocloudauthenticationoptions) (`: JwtBearerOptions`) — `Authority`, `Audience` (JWT path); add `ClientId` + `ClientAuth` for the opaque/introspection path.
- Client auth (introspection): [`ClientSecretAuth`](#client-authentication-types), `JwtAssertionAuth`, `TlsAuth`, `SpiffeJwtAuth`, `SpiffeX509Auth` — or a custom `IMonoCloudClientAuth`.
- Authorization is **standard ASP.NET Core**: `AddAuthorization` + `RequireClaim("scope", …)` / `RequireClaim("groups", …)` + `[Authorize(Policy = …)]` — see [Authorization patterns](#authorization-patterns).
- Caching: implement [`IIntrospectionCache`](#iintrospectioncache), register it as a **singleton**, set `EnableCaching = true`.
- Events: [`MonoCloudAuthenticationEvents`](#monocloudauthenticationevents) — `OnTokenValidated`, `OnIntrospection`, `OnCreatingJwtAssertion`, `OnAuthenticationFailed`, `OnMessageReceived`, `OnCertificateBindingValidated`.
- **No environment variables.** The SDK reads none of its own — configure via the options action or `IConfiguration` binding of `MonoCloudAuthenticationOptions`.

## Namespaces / top-level public types

Implicit usings are **off** in this package, so consumer files import explicitly. There is no barrel/index — every `public` type is exported. The namespaces you reference:

| Namespace | Public types |
|---|---|
| `MonoCloud.Authentication.Api` | `MonoCloudAuthenticationExtension`, `MonoCloudAuthenticationDefaults`, `MonoCloudAuthenticationOptions`, `MonoCloudAuthenticationEvents`, `MonoCloudAuthenticationHandler`, `PostConfigureMonoCloudAuthenticationOptions`, `PostConfigureMonoCloudAuthenticationTimeProvider` |
| `MonoCloud.Authentication.Api.Shared` | `IIntrospectionCache`, `JwtAssertion` |
| `MonoCloud.Authentication.Api.Shared.ClientAuth` | `IMonoCloudClientAuth`, `ClientSecretAuth`, `JwtAssertionAuth`, `TlsAuth`, `SpiffeJwtAuth`, `SpiffeX509Auth`, `ClientAuthenticationContext` |
| `MonoCloud.Authentication.Api.Shared.Context` | `IntrospectionRequestContext`, `JwtAssertionContext`, `CertificateBindingValidatedContext` (MessageReceived/TokenValidated/AuthenticationFailed contexts are now the framework's JwtBearer types) |

A typical `Program.cs` needs:

```csharp
using MonoCloud.Authentication.Api;                        // extension, defaults, options, events
using MonoCloud.Authentication.Api.Shared.ClientAuth;      // ClientSecretAuth, TlsAuth, … (opaque path only)
// using MonoCloud.Authentication.Api.Shared;              // IIntrospectionCache (only if you implement caching)
// using MonoCloud.Authentication.Api.Shared.Context;      // event context types (only if you wire events)
```

> The options bag exposes several `Microsoft.IdentityModel` types (`TokenValidationParameters`, `OpenIdConnectConfiguration`, `IConfigurationManager<T>`) — reference `Microsoft.IdentityModel.Tokens` / `Microsoft.IdentityModel.Protocols.OpenIdConnect` if you set them directly.

## `MonoCloudAuthenticationExtension`

Extension methods on `AuthenticationBuilder`. Chain after `AddAuthentication(…)`. Verbatim:

```csharp
namespace MonoCloud.Authentication.Api;

public static class MonoCloudAuthenticationExtension
{
    // 1. Default scheme "MonoCloud", no options.
    public static AuthenticationBuilder AddMonoCloudAuthentication(
        this AuthenticationBuilder builder);

    // 2. Custom scheme, no options.
    public static AuthenticationBuilder AddMonoCloudAuthentication(
        this AuthenticationBuilder builder, string authenticationScheme);

    // 3. Default scheme "MonoCloud" + options action.
    public static AuthenticationBuilder AddMonoCloudAuthentication(
        this AuthenticationBuilder builder, Action<MonoCloudAuthenticationOptions> configureOptions);

    // 4. Custom scheme + options action — the core overload all others funnel into.
    public static AuthenticationBuilder AddMonoCloudAuthentication(
        this AuthenticationBuilder builder, string authenticationScheme, Action<MonoCloudAuthenticationOptions>? configureOptions);
}
```

Overloads 1–3 delegate to overload 4. The core overload registers the scheme **by hand** (it cannot use `AddScheme<TOptions,THandler>`, whose `THandler : AuthenticationHandler<TOptions>` constraint a `JwtBearerHandler` subclass can't satisfy):

1. Registers the named `HttpClient` via `builder.Services.AddHttpClient(MonoCloudAuthenticationDefaults.HttpClientName)`.
2. `TryAddEnumerable`s **two singletons** `IPostConfigureOptions<MonoCloudAuthenticationOptions>` → `PostConfigureMonoCloudAuthenticationOptions` and `PostConfigureMonoCloudAuthenticationTimeProvider`.
3. Adds the scheme to `AuthenticationOptions` with `HandlerType = typeof(MonoCloudAuthenticationHandler)`, runs the named `Configure`, calls `AddOptions<MonoCloudAuthenticationOptions>(scheme).Validate(...)`, and `AddTransient<MonoCloudAuthenticationHandler>()`.

Canonical registration:

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme)
    .AddMonoCloudAuthentication(options =>
    {
        options.Authority = "https://<your-tenant>.us.monocloud.com";
        options.Audience  = "<your-api-identifier>";
    });

builder.Services.AddAuthorization();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
```

## `MonoCloudAuthenticationDefaults`

```csharp
namespace MonoCloud.Authentication.Api;

public static class MonoCloudAuthenticationDefaults
{
    public const string AuthenticationScheme = "MonoCloud";
    public const string HttpClientName       = "MonoCloud.AspNetCore.HttpClient";
}
```

- `AuthenticationScheme` — the default scheme string. Pass it to `AddAuthentication(...)` and use it in `[Authorize(AuthenticationSchemes = MonoCloudAuthenticationDefaults.AuthenticationScheme)]` when you register multiple schemes.
- `HttpClientName` — the named `HttpClient` the SDK registers with `IHttpClientFactory` and consumes for discovery / introspection / mTLS (unless you supply `Options.HttpClient`). Configure it via `services.AddHttpClient(MonoCloudAuthenticationDefaults.HttpClientName)` if you need custom handlers/policies.

## `MonoCloudAuthenticationOptions`

```csharp
public class MonoCloudAuthenticationOptions : JwtBearerOptions
```

Derives from `JwtBearerOptions`, so the **entire `AddJwtBearer` surface is inherited** and applies to the MonoCloud scheme (`Authority`, `Audience`, `TokenValidationParameters`, `SaveToken`, `MapInboundClaims`, `IncludeErrorDetails`, `RequireHttpsMetadata`, `MetadataAddress`, `Challenge`, `RefreshOnIssuerKeyNotFound`, `AutomaticRefreshInterval`, `RefreshInterval`, `Backchannel`, `Configuration`, `ConfigurationManager`, `Events`, `TokenHandlers`, …). The constructor seeds `Events = new MonoCloudAuthenticationEvents()`. Bindable from `IConfiguration`. Members **declared by MonoCloud** (everything else is inherited):

### Core / validation (declared)

- `bool IntrospectJwtTokens { get; set; }` — default `false`. Forces even JWT-parseable tokens through introspection.
- `TimeSpan? ClockSkew { get; set; }` — default `null`. Applied to `TokenValidationParameters.ClockSkew`; `null` ⇒ framework default (**5 minutes**), not zero.
- `MonoCloudAuthenticationEvents Events { get; set; }` — `new`-shadows `JwtBearerOptions.Events` with the strongly-typed [event class](#monocloudauthenticationevents); backed by `base.Events`, seeded in the ctor.

### Inherited from `JwtBearerOptions` (not declared here)

- `string? Authority` — default `null`. Tenant domain / authority + expected issuer; discovery base. Scheme-less values get `https://` in post-configuration; explicit `http://` honored. **Required on both paths (opaque path throws `ArgumentNullException` if missing). Replaces the removed `TenantDomain`.**
- `string? Audience` — default `null`. Copied into `TokenValidationParameters.ValidAudience`/`ValidAudiences` by the framework's `JwtBearerPostConfigureOptions` only when unset.
- `TokenValidationParameters TokenValidationParameters` — full JWT-path validation params. **Replaces the removed `JwtTokenValidationParameters`.**
- `bool SaveToken` — default **`true`**. Stores the raw token as `AuthenticationToken` `"access_token"`.
- `bool RefreshOnIssuerKeyNotFound` — default **`true`**.
- `bool IncludeErrorDetails` — default **`true`**. Adds `error_description` to the RFC 6750 challenge.

### Introspection & client authentication

- `string? ClientId { get; set; }` — default `null`. OAuth client identifier. **Required for the opaque/introspection path** and by every `ClientAuth` implementation (missing → `ArgumentNullException`). Not needed for pure local-JWT validation.
- `IMonoCloudClientAuth? ClientAuth { get; set; }` — default `null`. The client-authentication mechanism applied to the introspection request. **Required (non-null) on the opaque path** (missing → `ArgumentNullException` inside introspection). One of [`ClientSecretAuth` / `JwtAssertionAuth` / `TlsAuth` / `SpiffeJwtAuth` / `SpiffeX509Auth`](#client-authentication-types), or a custom impl.

### Caching (introspection results)

- `bool EnableCaching { get; set; }` — default `false`. Master switch for read-through / write-through of introspection results via the registered [`IIntrospectionCache`](#iintrospectioncache). Only introspection-validated tokens are cached; locally validated JWTs never are. If `true` and no `IIntrospectionCache` is registered, post-configure throws `ArgumentException`.
- `TimeSpan CacheDuration { get; set; }` — default `TimeSpan.FromMinutes(5)`. Max TTL for cached claims; the actual TTL is `min(CacheDuration, time-until-token-exp)`.
- `string CacheKeyPrefix { get; set; }` — default `string.Empty`. Prefix prepended to every generated cache key.
- `Func<MonoCloudAuthenticationOptions, string, string> CacheKeyGenerator { get; set; }` — default `Utils.CacheKeyGenerator`, i.e. `CacheKeyPrefix + Base64(SHA256("{SchemeName}|{token}"))`. The scheme-name discriminator means distinct schemes never share a cache entry for the same token.

### Certificate binding (mTLS-bound tokens, RFC 8705)

- `Func<HttpContext, bool> ValidateCertificateBinding { get; set; }` — default `_ => false`. Per-request predicate; when it returns `true` the handler enforces `cnf`/`x5t#S256` certificate-binding (on the JWT path, the live introspection path, and the cached introspection path). Default disables cert binding.
- `Func<HttpContext, Task<X509Certificate2?>> CertificateRetriever { get; set; }` — default `async context => await context.Connection.GetClientCertificateAsync()`. How the presented client cert is obtained for binding validation.

### Client-assertion JWT (for `JwtAssertionAuth`)

- `TimeSpan JwtAssertionDuration { get; set; }` — default `TimeSpan.FromMinutes(5)`. Lifetime (`exp`) of the generated client-assertion JWT.
- `string? JwtAssertionSigningAlgorithm { get; set; }` — default `null`. Signing-algorithm override for the client-assertion JWT. When `null`: `HS256` for symmetric/`oct` keys, `RS256` (`RsaSha256`) otherwise.

### Claims mapping / identity

- `bool MapInboundClaims { get; set; }` — default **`true`** (inherited from `JwtBearerOptions`). When `true`, JWT claim types are mapped to legacy WS-* URIs (e.g. `sub` → `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`). Set `false` to keep short OIDC names (`sub`, `email`, …). **Introspection/opaque claims are never remapped.** See [Claims behavior](#claims-behavior).
- `string? AuthenticationType { get; set; }` — default `null`. The `ClaimsIdentity` authentication type. Post-configuration writes `AuthenticationType ?? SchemeName` onto `TokenValidationParameters.AuthenticationType` when that is unset (JWT path); the opaque path uses `AuthenticationType ?? Scheme.Name`.
- `string? NameClaimType { get; set; }` — default `null`. Claim type used as `Identity.Name`. When non-null, post-configuration copies it onto `TokenValidationParameters.NameClaimType`.
- `string? RoleClaimType { get; set; }` — default `null`. Claim type treated as roles **and** as the group claim that group-normalization expands. When non-null, post-configuration copies it onto `TokenValidationParameters.RoleClaimType`; on the opaque path group expansion runs **only if `RoleClaimType` is non-null**. Set to `"groups"` for MonoCloud group claims. See [Authorization patterns](#authorization-patterns).

### Discovery / configuration manager (all inherited from `JwtBearerOptions`)

- `OpenIdConnectConfiguration? Configuration` — default `null`. Pre-supplied OIDC metadata.
- `IConfigurationManager<OpenIdConnectConfiguration>? ConfigurationManager` — default `null`. If left `null`, the framework's `JwtBearerPostConfigureOptions` builds one from `Authority + "/.well-known/openid-configuration"` (or a static manager when `Configuration` is set).
- `TokenValidationParameters TokenValidationParameters` — full `Microsoft.IdentityModel` validation parameters for the JWT path (the base `JwtBearerHandler` owns JWT validation now). Post-configuration maps MonoCloud's `AuthenticationType`/`NameClaimType`/`RoleClaimType`/`ClockSkew` onto it. **Replaces the removed `JwtTokenValidationParameters`.**
- `TimeSpan AutomaticRefreshInterval` — discovery refresh (12 h default).
- `TimeSpan RefreshInterval` — discovery refresh (30 s default).

### HTTP

- `HttpClient HttpClient { get; set; }` — default `null!`. HTTP client for discovery + introspection + mTLS. If still `null` at post-configure time it is built: a new `HttpClient` carrying the client cert when `ClientAuth` is a `TlsAuth` with a `Certificate`, otherwise `IHttpClientFactory.CreateClient(MonoCloudAuthenticationDefaults.HttpClientName)`.

### Internal (not public API — do not reference from consumer code)

- `internal string? SchemeName` — assigned in post-configure to the scheme name; namespaces cache keys so distinct schemes never share cached claims for the same token.

## Client authentication types

Namespace `MonoCloud.Authentication.Api.Shared.ClientAuth`. Assign an instance to `options.ClientAuth`; it runs on each **introspection** request (opaque path only). Every implementation requires `options.ClientId`.

### `IMonoCloudClientAuth`

The public extension point:

```csharp
public interface IMonoCloudClientAuth
{
    Task AuthenticateAsync(ClientAuthenticationContext context, CancellationToken cancellationToken);
}
```

Implement it for a custom client-auth scheme. It receives a [`ClientAuthenticationContext`](#clientauthenticationcontext) and mutates the introspection request / payload (add form fields to `IntrospectionRequestPayload`, headers to `IntrospectionRequest`).

### Built-in implementations

| Type | Public constructor(s) | `client_auth` method |
|---|---|---|
| `ClientSecretAuth` | `ClientSecretAuth(string clientSecret, bool clientSecretBasic = false)` | `client_secret_post` (default) / `client_secret_basic` (`clientSecretBasic: true`) |
| `JwtAssertionAuth` | `JwtAssertionAuth(string clientSecret)` | `client_secret_jwt` (HS256 over the symmetric key) |
| `JwtAssertionAuth` | `JwtAssertionAuth(JsonWebKey jwk)` | `client_secret_jwt` if `kty` is `oct`, else `private_key_jwt` |
| `JwtAssertionAuth` | `JwtAssertionAuth(X509Certificate2 certificate)` | `private_key_jwt` (RS256 over the X.509 key) |
| `TlsAuth` | `TlsAuth(X509Certificate2? certificate = null, string? trustStore = null)` | `tls_client_auth` (mutual TLS, RFC 8705) |
| `SpiffeJwtAuth` | `SpiffeJwtAuth(string jwtSvid)` | `spiffe_jwt` (fixed JWT-SVID) |
| `SpiffeJwtAuth` | `SpiffeJwtAuth(Func<HttpContext, CancellationToken, Task<string>> jwtSvidProvider)` | `spiffe_jwt` (SVID resolved per request — preferred) |
| `SpiffeX509Auth : TlsAuth` | `SpiffeX509Auth(X509Certificate2? certificate = null, string? trustStore = null)` | `spiffe_x509` (X.509-SVID over mTLS; behaves like `tls_client_auth`) |

Details:

- **`ClientSecretAuth`** — `clientSecretBasic: false` (default) adds `client_id` + `client_secret` to the form POST body (`client_secret_post`). `clientSecretBasic: true` sends an HTTP Basic `Authorization` header with URL-escaped `client_id:client_secret` (`client_secret_basic`). The common case shown in the README:

  ```csharp
  options.ClientId   = "<your-client-id>";
  options.ClientAuth = new ClientSecretAuth("<your-client-secret>");
  ```

- **`JwtAssertionAuth`** — builds a signed client-assertion JWT (`iss`/`sub` = `ClientId`, `aud` = the **issuer identifier** from discovery (`config.Issuer`; changed from the token endpoint in 0.1.2), plus `jti`, `nbf`, `iat`, `exp` = now + `JwtAssertionDuration`), then adds `client_assertion_type` = `urn:ietf:params:oauth:client-assertion-type:jwt-bearer` and `client_assertion` to the body. Fires the [`CreatingJwtAssertion`](#monocloudauthenticationevents) event first — if that event supplies a `JwtAssertion` it is used verbatim (letting you override signing entirely). Algorithm override via `options.JwtAssertionSigningAlgorithm`. Requires `options.ClientId` and a `ConfigurationManager`. Use when the IdP requires a signed client assertion instead of a plaintext secret.

- **`TlsAuth`** — `AuthenticateAsync` only adds `client_id` to the body (no secret); the client identity is proven by the TLS client certificate. If a `certificate` is supplied, post-configure builds a dedicated `HttpClient` with that cert on an `HttpClientHandler`; otherwise you must configure `options.HttpClient`'s handler to present the cert yourself. When `TlsAuth` is active the handler resolves the introspection endpoint from the discovery doc's `mtls_endpoint_aliases.introspection_endpoint` (or, if `trustStore` is set, from the matching `mtls_additional_endpoint_aliases` entry) and throws `InvalidOperationException` if that mTLS alias is absent. `Certificate` and `TrustStore` are `internal`.

- **`SpiffeJwtAuth`** — forwards the workload's JWT-SVID as the client assertion: adds `client_id`, `client_assertion_type` = `urn:ietf:params:oauth:client-assertion-type:jwt-spiffe`, and `client_assertion` = the SVID. Throws `InvalidOperationException` if the SVID is null/empty. Prefer the **provider** constructor — it is invoked per introspection request so rotated short-lived SVIDs are picked up, and the delegate can resolve services from `HttpContext.RequestServices`. Use in SPIFFE/SPIRE workloads.

- **`SpiffeX509Auth`** — subclasses `TlsAuth`; identical behavior (`mtls_endpoint_aliases` resolution, dedicated cert `HttpClient`) but represents `spiffe_x509` (an X.509-SVID over mTLS).

### `ClientAuthenticationContext`

Passed to `IMonoCloudClientAuth` implementations. All fields are `public readonly`:

```csharp
public class ClientAuthenticationContext
{
    public readonly MonoCloudAuthenticationOptions Options;
    public readonly HttpRequestMessage             IntrospectionRequest;
    public readonly IDictionary<string, string>    IntrospectionRequestPayload;
    public readonly HttpContext                     HttpContext;
    public readonly AuthenticationScheme            Scheme;
}
```

Mutate `IntrospectionRequestPayload` (form fields) and/or `IntrospectionRequest.Headers` inside a custom implementation.

## `MonoCloudAuthenticationEvents`

```csharp
namespace MonoCloud.Authentication.Api;

public class MonoCloudAuthenticationEvents : JwtBearerEvents
{
    // MonoCloud-specific hooks (declared here):
    public Func<CertificateBindingValidatedContext, Task> OnCertificateBindingValidated { get; set; } = _ => Task.CompletedTask;
    public Func<IntrospectionRequestContext, Task>        OnIntrospection               { get; set; } = _ => Task.CompletedTask;
    public Func<JwtAssertionContext, Task>                OnCreatingJwtAssertion        { get; set; } = _ => Task.CompletedTask;

    public virtual Task CertificateBindingValidated(CertificateBindingValidatedContext context);
    public virtual Task Introspection(IntrospectionRequestContext context);
    public virtual Task CreatingJwtAssertion(JwtAssertionContext context);
}
```

Derives from `JwtBearerEvents`, so the **standard bearer events are inherited** and fire on **both** the JWT and opaque paths: `OnMessageReceived`, `OnTokenValidated`, `OnAuthenticationFailed`, `OnChallenge`, `OnForbidden` (framework virtuals `MessageReceived`/`TokenValidated`/`AuthenticationFailed`/`Challenge`/`Forbidden`). The three `OnXxx` above are the MonoCloud additions. Wire hooks by assigning the delegates on `options.Events`, or subclass and override.

| Event / virtual | When it fires | Context (extra members) |
|---|---|---|
| `OnMessageReceived` / `MessageReceived` | First in `HandleAuthenticateAsync`, before the token is read from the `Authorization` header. Set `context.Token`/`context.Result`. | `MessageReceivedContext` (JwtBearer) |
| `OnTokenValidated` / `TokenValidated` | After the `ClaimsPrincipal` is built, on **both** paths. Set `context.Result` to override. | `TokenValidatedContext` (JwtBearer) — `context.SecurityToken` is the parsed JWT on the JWT path, **`null` on the opaque path** |
| `OnAuthenticationFailed` / `AuthenticationFailed` | On any failure — JWT validation error, introspection infrastructure failure, inactive token, cert-binding failure. `context.Exception` carries the error. As of 0.1.4 token verdicts (`active:false`, cert-binding) yield a **401**; introspection infrastructure failures (and exceptions from opaque-path handlers) **rethrow → HTTP 500** unless `context.Result` is set. | `AuthenticationFailedContext` (JwtBearer) |
| `OnChallenge` / `Challenge` | Before the 401 `WWW-Authenticate` challenge is written. | `JwtBearerChallengeContext` (JwtBearer) |
| `OnForbidden` / `Forbidden` | On a 403. | `ForbiddenContext` (JwtBearer) |
| `OnCertificateBindingValidated` / `CertificateBindingValidated` | After the presented cert's SHA-256 thumbprint matches the token's `cnf.x5t#S256`. If `context.Result` is set it is returned. | `CertificateBindingValidatedContext` (MonoCloud) — none |
| `OnIntrospection` / `Introspection` | On the opaque path, just before the HTTP introspection request is sent. Mutate/replace `context.IntrospectionRequest`. | `IntrospectionRequestContext` (MonoCloud) — `HttpRequestMessage IntrospectionRequest` |
| `OnCreatingJwtAssertion` / `CreatingJwtAssertion` | Inside `JwtAssertionAuth`, before building the client-assertion JWT. Set `context.JwtAssertion` to fully supply/override it. | `JwtAssertionContext` (MonoCloud) — `JwtAssertion? JwtAssertion` |

### Event context types

Only three context types live in `MonoCloud.Authentication.Api.Shared.Context`, each deriving from `ResultContext<MonoCloudAuthenticationOptions>` (exposing `HttpContext`, `Scheme`, `Options`, `Principal`, `Properties`, `Result`, `Success()`/`Fail()`/`NoResult()`):

```csharp
public class IntrospectionRequestContext        : ResultContext<MonoCloudAuthenticationOptions> { public HttpRequestMessage IntrospectionRequest { get; set; } }
public class JwtAssertionContext                : ResultContext<MonoCloudAuthenticationOptions> { public JwtAssertion? JwtAssertion { get; set; } }
public class CertificateBindingValidatedContext : ResultContext<MonoCloudAuthenticationOptions> { }
```

> `MessageReceivedContext`, `TokenValidatedContext` and `AuthenticationFailedContext` are the framework's `Microsoft.AspNetCore.Authentication.JwtBearer` types — there is no MonoCloud shadowing. On the opaque path `TokenValidatedContext.SecurityToken` is `null`; read claims off `context.Principal`.

Example — reject tokens lacking a custom claim, and log failures:

```csharp
using MonoCloud.Authentication.Api.Shared.Context;

options.Events.OnTokenValidated = context =>
{
    if (context.Principal?.FindFirst("tenant_id") is null)
    {
        context.Fail("Missing tenant_id claim");
    }
    return Task.CompletedTask;
};

options.Events.OnAuthenticationFailed = context =>
{
    context.HttpContext.RequestServices
        .GetRequiredService<ILoggerFactory>()
        .CreateLogger("MonoCloudAuth")
        .LogWarning(context.Exception, "Token validation failed");
    return Task.CompletedTask;
};
```

## `IIntrospectionCache`

```csharp
namespace MonoCloud.Authentication.Api.Shared;

public interface IIntrospectionCache
{
    Task<string?> GetAsync(string key, CancellationToken cancellationToken);
    Task SetAsync(string key, string value, TimeSpan expiresIn, CancellationToken cancellationToken);
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}
```

A raw string key/value store. The SDK serializes the claim list to JSON itself (persisting only each `Claim`'s `Type` + `Value`) and deserializes on read. `DeleteAsync` (added in 0.1.3) is **never called by the SDK** — implement it so consumers can evict an entry before expiry (e.g. on token revocation), keyed via `options.CacheKeyGenerator`. The SDK's read/write path uses only `GetAsync`/`SetAsync`.

**Singleton requirement (hard).** Register the implementation as a **singleton**:

```csharp
builder.Services.AddSingleton<IIntrospectionCache, RedisIntrospectionCache>();
```

`PostConfigureMonoCloudAuthenticationOptions` (which discovers the cache) is itself a singleton, so a scoped/transient registration fails DI scope validation. If `EnableCaching = true` and no `IIntrospectionCache` is in the container, post-configure throws `ArgumentException("IIntrospectionCache not found in the services collection")` at startup.

**What is cached.** Only introspection-validated tokens — opaque tokens, plus JWTs when `IntrospectJwtTokens = true`. Locally validated JWTs are never cached. Both active and inactive results are cached (an inactive result is stored with an added `active=false` claim so a cache hit short-circuits to failure without re-introspecting).

**TTL / key.** Key = `CacheKeyPrefix + Base64(SHA256("{SchemeName}|{token}"))`. TTL starts at `CacheDuration`; if a parseable `exp` claim is present, entries already expired are not cached and the TTL is shortened to the remaining token life when the token expires sooner than `now + CacheDuration`. A missing/non-numeric `exp` never throws — it just caches for `CacheDuration`.

**Cache resilience.** A thrown exception from `GetAsync` is caught and logged, then the handler falls through to a live introspection; a failing `SetAsync` write is likewise caught and logged (as of 0.1.4) — a cache failure never fails an otherwise-successful request. Separately, a static in-process `ConcurrentDictionary<string, Lazy<Task<…>>>` de-duplicates concurrent in-flight introspections of the same token (removed in a `finally`); it collapses duplicate calls but is **not** a result cache, and is keyed by **scheme name + token** (as of 0.1.4) so concurrent introspections of the same token under different schemes don't share a result.

Minimal in-memory example:

```csharp
using MonoCloud.Authentication.Api.Shared;
using Microsoft.Extensions.Caching.Memory;

public sealed class MemoryIntrospectionCache(IMemoryCache cache) : IIntrospectionCache
{
    public Task<string?> GetAsync(string key, CancellationToken ct) =>
        Task.FromResult(cache.TryGetValue(key, out string? v) ? v : null);

    public Task SetAsync(string key, string value, TimeSpan expiresIn, CancellationToken ct)
    {
        cache.Set(key, value, expiresIn);
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        cache.Remove(key);
        return Task.CompletedTask;
    }
}

// Registration:
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<IIntrospectionCache, MemoryIntrospectionCache>();
// options.EnableCaching = true;
```

## `JwtAssertion`

```csharp
namespace MonoCloud.Authentication.Api.Shared;

public class JwtAssertion
{
    public string    Assertion           { get; set; } = string.Empty;   // the signed JWT
    public string    AssertionType       { get; set; } = string.Empty;   // e.g. urn:ietf:params:oauth:client-assertion-type:jwt-bearer
}
```

Returned/overridden via the [`CreatingJwtAssertion`](#monocloudauthenticationevents) event to fully supply the client assertion (bypassing `JwtAssertionAuth`'s built-in signing).

## Other public types

- `MonoCloudAuthenticationHandler : JwtBearerHandler` — the scheme handler. Public, but registered by the extension — never constructed by consumers. It raises `MessageReceived` once, reads the bearer token (returns `NoResult()` if none), then routes: JWT tokens are delegated to `base.HandleAuthenticateAsync()` (with an internal `InterceptingEvents` wrapper that runs group normalization + cert binding before the consumer's `TokenValidated`), opaque tokens go through RFC 7662 introspection.
- `PostConfigureMonoCloudAuthenticationOptions : IPostConfigureOptions<MonoCloudAuthenticationOptions>` — public; registered as a singleton by the extension. `https://`-prefixes a scheme-less `Authority`, assigns `HttpClient` → `Backchannel`, maps `AuthenticationType`/`NameClaimType`/`RoleClaimType`/`ClockSkew` onto `TokenValidationParameters`, enforces the cache-singleton rule, then calls the framework's `JwtBearerPostConfigureOptions` (which copies `Audience` → `ValidAudience` and builds the `ConfigurationManager`).
- `PostConfigureMonoCloudAuthenticationTimeProvider : IPostConfigureOptions<MonoCloudAuthenticationOptions>` — public; second singleton registered by the extension (replica of the framework's private TimeProvider post-configure).

> **Internal (not public API — do not reference):** `IntrospectionResult` (parses RFC 7662 JSON → claims + `IsActive`), `Utils` (`CacheKeyGenerator`, `NormalizeGroupClaims`, exp/TTL), `ClaimConverter`, `MtlsEndpointAliases`, and `MonoCloudAuthenticationOptions.SchemeName`.

## Claims behavior

**JWT path.** JWT validation and identity creation are performed by the base `JwtBearerHandler` against the inherited `TokenValidationParameters`. `MapInboundClaims` (default **`true`**) maps well-known JWT claim types to legacy WS-* URIs (`sub` → `…/nameidentifier`, `name` → `…/name`, …); set `options.MapInboundClaims = false` to keep short OIDC names. During post-configuration MonoCloud's `AuthenticationType`/`NameClaimType`/`RoleClaimType`/`ClockSkew` are copied onto `TokenValidationParameters` (with `AuthenticationType` falling back to the scheme name), so they drive the name/role claim types. The handler only re-flattens group claims when a group claim actually needs normalizing (otherwise the base handler's identity is left untouched, keeping case-sensitive claim lookups exactly as `AddJwtBearer`).

**Opaque path.** Claims are built verbatim from the RFC 7662 introspection JSON — **never** subject to `MapInboundClaims`. `scope` (space-delimited string or JSON array) is split into one `Claim` of type `"scope"` per value; nested objects become JSON-typed claims; arrays expand to one claim per element. Identity: `authenticationType = AuthenticationType ?? Scheme.Name`, and `NameClaimType`/`RoleClaimType` are used directly (the opaque path does not consult `TokenValidationParameters`).

**Reading claims in app code.** Inject `ClaimsPrincipal` (minimal APIs) or use `User` / `HttpContext.User` (controllers). `User.Identity?.Name` reflects `NameClaimType`. Read scopes via `User.FindAll("scope")`; groups/roles via `RoleClaimType`, `User.IsInRole(...)`, or `[Authorize(Roles = ...)]`. Because `MapInboundClaims` can rename JWT claim types, set `NameClaimType`/`RoleClaimType` to the mapped URI, or turn mapping off, if you index claims by short name.

## Authorization patterns

There is **no MonoCloud-specific authorization API** — authorization is pure ASP.NET Core. The handler only authenticates and turns token data into claims; you enforce scope/group requirements with the standard policy system.

**How scopes land as claims.** On the opaque/introspection path, the `scope` value (space-delimited string **or** JSON array) is split into **one `"scope"` claim per value**. On the JWT path, a space-delimited `scope` is split the same way (aligned in 0.1.4), so `RequireClaim("scope", …)` matches per-value on both the JWT and introspection paths.

**How groups land as claims.** Groups arrive under whatever claim the token uses (MonoCloud uses `groups`). To have array-valued groups expanded into individual claims, set `options.RoleClaimType = "groups"`. Group normalization then runs — on the opaque path **only when `RoleClaimType` is non-null**; on the JWT path always. It expands a JSON-array group claim into one claim per element: a string array becomes one claim per string; an array of `{ id, name }` objects becomes **two** claims per group (one for `id`, one for `name`) — so a `RequireClaim` policy can match either the group id or the group name. Because `RoleClaimType` is the identity's role claim type, `[Authorize(Roles = ...)]` / `User.IsInRole(...)` also work against groups.

**Registering policies:**

```csharp
builder.Services
    .AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme)
    .AddMonoCloudAuthentication(options =>
    {
        options.Authority     = builder.Configuration["MonoCloud:Authority"];
        options.Audience      = builder.Configuration["MonoCloud:Audience"];
        options.RoleClaimType = "groups";   // expand + treat MonoCloud groups as roles
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("read:weather", p => p.RequireClaim("scope", "read:weather"));
    options.AddPolicy("admins",       p => p.RequireClaim("groups", "admin")); // matches RoleClaimType = "groups"
});
```

**Enforcing on endpoints.**

Minimal API:

```csharp
app.MapGet("/weather", () => Results.Ok(/* … */))
   .RequireAuthorization("read:weather");

app.MapGet("/admin", () => Results.Ok(/* … */))
   .RequireAuthorization("admins");

// Any authenticated principal from the scheme (no specific policy):
app.MapGet("/me", (ClaimsPrincipal user) => user.Identity?.Name)
   .RequireAuthorization();
```

Controllers:

```csharp
[ApiController]
[Route("weather")]
public class WeatherController : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = "read:weather")]
    public IActionResult Get() => Ok(/* … */);

    [HttpGet("admin")]
    [Authorize(Roles = "admin")]   // works because RoleClaimType = "groups"
    public IActionResult Admin() => Ok(/* … */);
}
```

> **Scope splitting.** A space-delimited `scope` is split into discrete `"scope"` claims on **both** the JWT and introspection paths (aligned in 0.1.4), so `RequireClaim("scope", "read:weather")` works directly on either — no custom requirement needed.

## Defaults

| Option | Default | Notes |
|---|---|---|
| Scheme name | `"MonoCloud"` | `MonoCloudAuthenticationDefaults.AuthenticationScheme` |
| HTTP client name | `"MonoCloud.AspNetCore.HttpClient"` | `MonoCloudAuthenticationDefaults.HttpClientName` |
| `EnableCaching` | `false` | Requires a singleton `IIntrospectionCache` when `true` |
| `CacheDuration` | `TimeSpan.FromMinutes(5)` | Max TTL; capped by token `exp` |
| `CacheKeyPrefix` | `string.Empty` | |
| `SaveToken` (inherited) | **`true`** | Stored as `AuthenticationToken` `"access_token"` |
| `ClockSkew` | `null` | Framework default (5 min) applies — **not** zero |
| `IntrospectJwtTokens` | `false` | Force introspection for JWTs |
| `MapInboundClaims` (inherited) | `true` | JWT claim types → WS-* URIs |
| `IncludeErrorDetails` (inherited) | **`true`** | Adds `error_description` to the RFC 6750 401 challenge |
| `RefreshOnIssuerKeyNotFound` (inherited) | **`true`** | Re-fetches keys on unknown `kid` |
| `JwtAssertionDuration` | `TimeSpan.FromMinutes(5)` | Client-assertion JWT `exp` |
| `JwtAssertionSigningAlgorithm` | `null` | HS256 for symmetric, RS256 otherwise |
| `ValidateCertificateBinding` | `_ => false` | Cert binding off by default |
| `CertificateRetriever` | `ctx => ctx.Connection.GetClientCertificateAsync()` | |
| `AutomaticRefreshInterval` | `ConfigurationManager<…>.DefaultAutomaticRefreshInterval` (12 h) | Discovery refresh |
| `RefreshInterval` | `ConfigurationManager<…>.DefaultRefreshInterval` (30 s) | Discovery refresh |
| `CacheKeyGenerator` | `Utils.CacheKeyGenerator` | `Prefix + Base64(SHA256("{scheme}|{token}"))` |
| Discovery URL | `Authority + "/.well-known/openid-configuration"` | `https://` prefixed if the scheme is missing |

## Gotchas

- **The opaque/introspection path requires `ClientId` + `Authority` + `ClientAuth`** — each throws `ArgumentNullException` when missing (the handler throws `"Authority must be set"`). Pure local-JWT validation needs none of these (only `Audience` and `Authority` as the issuer).
- **`EnableCaching = true` with no singleton `IIntrospectionCache`** throws `ArgumentException` at startup. The cache **must** be a singleton or DI scope validation fails.
- **`MapInboundClaims` defaults to `true`** — `sub`/`name`/etc. become long WS-* URIs on the JWT path (introspection claims are not remapped). Set `false`, or point `NameClaimType`/`RoleClaimType` at the mapped URIs, if you index claims by short name.
- **Group expansion only happens if `RoleClaimType` is set** (the opaque path gates normalization on `RoleClaimType != null`). Forget `options.RoleClaimType = "groups"` and the `groups` claim stays a raw JSON-array string — `RequireClaim("groups", "admin")` won't match.
- **`{ id, name }` group objects expand into TWO claims** (one id, one name), both of the role/group claim type — a policy can match either.
- **Scopes are split per-value on both paths** (aligned in 0.1.4) — `RequireClaim("scope", …)` behaves identically on the JWT and introspection paths.
- **Provide the tenant root, not the discovery URL.** `Authority` is auto-prefixed with `https://`; discovery is `Authority + "/.well-known/openid-configuration"`.
- **`Audience` only feeds `ValidAudience` if it is empty** — setting `TokenValidationParameters.ValidAudience`/`ValidAudiences` directly overrides `Audience`.
- **`TlsAuth`/`SpiffeX509Auth` require the discovery doc to expose `mtls_endpoint_aliases.introspection_endpoint`** (or a trust-store-specific `mtls_additional_endpoint_aliases` entry); otherwise `InvalidOperationException`. A `TlsAuth` with an explicit `Certificate` makes post-configure build a dedicated `HttpClient`; without one, attach the cert to `options.HttpClient`'s handler yourself.
- **`TokenValidatedContext.SecurityToken` is `null` on the opaque path** (there is no parsed token for an introspected credential) — read claims off `context.Principal`, not a `Token` cast.
- **`MessageReceivedContext`/`TokenValidatedContext`/`AuthenticationFailedContext` are the framework's JwtBearer types**, not MonoCloud's; only `IntrospectionRequestContext`/`JwtAssertionContext`/`CertificateBindingValidatedContext` live in `MonoCloud.Authentication.Api.Shared.Context`.

## What this SDK does NOT have

- **No `protectApi` factory / middleware you write.** This is an ASP.NET Core authentication **handler/scheme**. Register it with `AddAuthentication(scheme).AddMonoCloudAuthentication(...)` and protect endpoints with the standard `[Authorize]` / `RequireAuthorization(...)`. (`protectApi()` belongs to the Node `@monocloud/backend-node` express/fastify SDK — a different skill.)
- **No environment-variable configuration.** The SDK reads no env vars of its own. Configure via the `Action<MonoCloudAuthenticationOptions>` or `IConfiguration` binding. (You may still feed those values from env through standard .NET `IConfiguration` providers.)
- **No `[MonoCloudAuthorize]` attribute and no MonoCloud-specific authorization API.** Use the standard `[Authorize]` / `[Authorize(Policy = …)]` / `[Authorize(Roles = …)]` and `AddAuthorization` policy system.
- **No management operations.** This package validates access tokens only; to manage users/clients/groups use the separate `MonoCloud.Management` NuGet package (`monocloud-management-dotnet` skill).

## References

- Quickstart: <https://www.monocloud.com/docs/quickstarts/dotnet-api-authentication>
- SDK reference: <https://www.monocloud.com/docs/sdks/dotnet-api-authentication>
- API reference (docfx): <https://monocloud.github.io/api-authentication-dotnet>
- GitHub: <https://github.com/monocloud/api-authentication-dotnet>
