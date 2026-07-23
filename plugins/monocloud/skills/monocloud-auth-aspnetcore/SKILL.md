---
name: monocloud-auth-aspnetcore
description: Use when validating MonoCloud access tokens in an ASP.NET Core API / resource server — installing or configuring the `MonoCloud.Authentication.Api` NuGet package, wiring `AddAuthentication(...).AddMonoCloudAuthentication(...)` and the `"MonoCloud"` scheme, setting `MonoCloudAuthenticationOptions` (`TenantDomain`, `Audience`, `ClientId`, `ClientAuth`), validating JWT vs opaque (RFC 7662 introspection) bearer tokens, enforcing scope/group authorization via standard `[Authorize(Policy=…)]` / `RequireClaim` policies, caching introspection results with a singleton `IIntrospectionCache`, mTLS certificate-bound tokens (`ValidateCertificateBinding` / `cnf` / `x5t#S256`), picking a client-auth method (`client_secret_basic`/`client_secret_post`/`client_secret_jwt`/`private_key_jwt`/`tls_client_auth`/`spiffe_jwt`/`spiffe_x509`), or troubleshooting 401/403 / `MapInboundClaims` / `IIntrospectionCache not found` errors.
license: MIT
---

# MonoCloud ASP.NET Core API authentication (`MonoCloud.Authentication.Api`)

.NET SDK for validating MonoCloud-issued **access tokens** in ASP.NET Core APIs and resource servers. It ships as a standard ASP.NET Core **authentication handler / scheme** built on `Microsoft.AspNetCore.Authentication.JwtBearer`, so it plugs directly into `AddAuthentication()`, `[Authorize]`, and the authorization policy system. It validates JWTs locally against the tenant signing keys and introspects opaque (reference) tokens via RFC 7662, auto-detecting which.

## Package identity — read this first

**Use:** the `MonoCloud.Authentication.Api` NuGet package. Check `*.csproj` before writing code — confirm `<PackageReference Include="MonoCloud.Authentication.Api" ... />` is present and note its version. The package id, assembly name, and root namespace are all `MonoCloud.Authentication.Api`.

Three intentional, distinct naming axes — do not conflate them:

- **NuGet id / assembly / namespace:** `MonoCloud.Authentication.Api` (what you install and `using`).
- **GitHub repo:** `monocloud/api-authentication-dotnet`.
- **Changesets/npm tooling name:** `@monocloud/authentication-api` (a repo-internal release-tooling name only — it is **not** installable and never appears in app code).

This is **not**:

- A middleware you hand-write. It is an authentication **scheme** you register via `AddMonoCloudAuthentication(...)`; the framework's `UseAuthentication()` runs it. There is no `app.UseMonoCloud()` middleware to author.
- `MonoCloud.Management` (the admin/Management API client — different skill, `monocloud-management-dotnet`).
- The Node backend SDK. There is **no** `protectApi()` factory, no `[MonoCloudAuthorize]` attribute, and no scope/group option bag here — authorization is done with the **standard ASP.NET Core policy system** (see [Authorization](#authorization--scopes--groups)).

Stale-training-data guards — none of these exist; do not emit them:

- No `MonoCloud.AspNetCore.Authentication`, `AddMonoCloud()`, `UseMonoCloudAuthentication()`, or `MonoCloudJwtBearer` types. The DI entry point is `AddMonoCloudAuthentication(...)` on `AuthenticationBuilder`.
- The SDK reads **no** environment variables of its own (no `MONOCLOUD_*` fallback). All config flows through the options action or `IConfiguration` binding of `MonoCloudAuthenticationOptions`.

## Installation

```bash
dotnet add package MonoCloud.Authentication.Api
```

Target frameworks: **`net6.0`, `net7.0`, `net8.0`, `net9.0`, `net10.0`** (supported platforms `>= .NET 6.0`). The correct `Microsoft.AspNetCore.Authentication.JwtBearer` version is pulled in per-TFM automatically.

## Registration

Register the scheme on the `AuthenticationBuilder`, then add the two framework middleware in order — `UseAuthentication()` **before** `UseAuthorization()`, both after routing:

```csharp
using System.Security.Claims;
using MonoCloud.Authentication.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme) // "MonoCloud"
    .AddMonoCloudAuthentication(options =>
    {
        options.TenantDomain = builder.Configuration["MonoCloud:TenantDomain"]; // e.g. https://acme.us.monocloud.com
        options.Audience     = builder.Configuration["MonoCloud:Audience"];     // your API identifier
    });

builder.Services.AddAuthorization();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/me", (ClaimsPrincipal user) => $"Hello {user.Identity?.Name}")
   .RequireAuthorization();

app.Run();
```

`MonoCloudAuthenticationDefaults.AuthenticationScheme` is the constant `"MonoCloud"`. The SDK also registers a named `IHttpClientFactory` client `MonoCloudAuthenticationDefaults.HttpClientName` (`"MonoCloud.AspNetCore.HttpClient"`) used for discovery + introspection.

### The four `AddMonoCloudAuthentication` overloads

All hang off `AuthenticationBuilder` (the return of `AddAuthentication(...)`) and all funnel into the last one:

| Overload | Use |
| --- | --- |
| `AddMonoCloudAuthentication()` | Default scheme `"MonoCloud"`, no options action (configure later via `IConfiguration` binding / `PostConfigure`). |
| `AddMonoCloudAuthentication(string authenticationScheme)` | Custom scheme name, no options action. |
| `AddMonoCloudAuthentication(Action<MonoCloudAuthenticationOptions> configureOptions)` | Default scheme `"MonoCloud"` + options action. |
| `AddMonoCloudAuthentication(string authenticationScheme, Action<MonoCloudAuthenticationOptions>? configureOptions)` | Core overload — custom scheme + optional options action. |

> Do not hardcode secrets. Load `TenantDomain`, `ClientId`, and any client secret from `IConfiguration` (User Secrets locally, a secret manager in production).

## Configuration

`MonoCloudAuthenticationOptions : AuthenticationSchemeOptions`. Set it in the options action or bind it from `IConfiguration`. The most-used options:

| Option | Type / default | Purpose |
| --- | --- | --- |
| `TenantDomain` | `string?` = `null` | Authority/issuer URL (the tenant domain). Discovery is `TenantDomain + "/.well-known/openid-configuration"`. Auto-prefixed with `https://` if missing. Required for the opaque/introspection path. |
| `Audience` | `string?` = `null` | Expected token audience. Copied into `JwtTokenValidationParameters.ValidAudience` **only if** that is unset. |
| `ClientId` | `string?` = `null` | OAuth client id. Required for introspection and by every `ClientAuth`; not needed for pure local-JWT validation. |
| `ClientAuth` | `IMonoCloudClientAuth?` = `null` | How the API authenticates itself on the introspection request. Required (non-null) on the opaque path. |
| `IntrospectJwtTokens` | `bool` = `false` | When `true`, even JWT-parseable tokens go through introspection (forces the opaque path for all tokens). |
| `SaveToken` | `bool` = `false` | Store the raw access token as an `AuthenticationToken` named `"access_token"` in `AuthenticationProperties`. |
| `NameClaimType` | `string?` = `null` | Claim used as `Identity.Name`. |
| `RoleClaimType` | `string?` = `null` | Claim treated as roles **and** as the group claim expanded by group normalization (set to `"groups"` to enable group policies). |
| `ClockSkew` | `TimeSpan?` = `null` | Overrides JWT-validation clock skew. `null` ⇒ framework default (5 min), **not** zero. |
| `MapInboundClaims` | `bool` = `true` | Maps JWT claim types to legacy WS-* URIs on the JWT path (see [Accessing the user](#accessing-the-authenticated-user)). |
| `EnableCaching` | `bool` = `false` | Read/write introspection results through a registered `IIntrospectionCache`. |
| `CacheDuration` | `TimeSpan` = 5 min | Max cache TTL. |
| `CacheKeyPrefix` | `string` = `""` | Prefix on every generated cache key. |
| `ValidateCertificateBinding` | `Func<HttpContext,bool>` = `_ => false` | Per-request predicate; `true` enforces mTLS cert binding. |
| `CertificateRetriever` | `Func<HttpContext,Task<X509Certificate2?>>` | How the client cert is obtained (default `Connection.GetClientCertificateAsync()`). |
| `Events` | `MonoCloudAuthenticationEvents` | Strongly-typed event hooks (see [Events](#events)). |
| `JwtTokenValidationParameters` | `TokenValidationParameters` = `new()` | Full `Microsoft.IdentityModel` params for the JWT path; the handler clones it and appends the discovery issuer + signing keys. |
| `Configuration` / `ConfigurationManager` | `null` | Pre-supplied OIDC metadata / metadata manager. If both `null`, discovery is built from `TenantDomain`. |

Advanced options also exist: `JwtAssertionDuration`, `JwtAssertionSigningAlgorithm`, `AuthenticationType`, `AutomaticRefreshInterval`, `RefreshInterval`, `RefreshOnIssuerKeyNotFound`, `CacheKeyGenerator`, `HttpClient` — see [`references/api-surface.md`](references/api-surface.md).

### Binding from `appsettings.json` / `IConfiguration`

Because `MonoCloudAuthenticationOptions` is a plain options class, you can bind simple values from configuration inside the action. The SDK does not read env vars itself, but `IConfiguration` surfaces them through the standard ASP.NET Core mapping (`MonoCloud__TenantDomain`, etc.).

```json
{
  "MonoCloud": {
    "TenantDomain": "https://acme.us.monocloud.com",
    "Audience": "https://api.example.com",
    "ClientId": "your-client-id"
  }
}
```

```csharp
.AddMonoCloudAuthentication(options =>
{
    builder.Configuration.GetSection("MonoCloud").Bind(options);
    // ClientAuth is not bindable from config — set it in code:
    options.ClientAuth = new ClientSecretAuth(builder.Configuration["MonoCloud:ClientSecret"]!);
});
```

## JWT vs opaque tokens

The handler auto-detects the token format per request:

- **JWT path** (`!IntrospectJwtTokens` and the token parses as a JWT): validated **locally** against the tenant's discovery signing keys + `JwtTokenValidationParameters`. No per-request network call once discovery is cached. Needs only `TenantDomain` (issuer) and `Audience` — **no** `ClientId`/`ClientAuth`.
- **Opaque path** (reference tokens, or any token when `IntrospectJwtTokens = true`): validated by calling the OIDC **introspection** endpoint (RFC 7662). **Requires** `TenantDomain` + `ClientId` + `ClientAuth` — each throws `ArgumentNullException` at request time if missing.

Set `IntrospectJwtTokens = true` only when you specifically need server-side revocation checks on JWTs; it adds an introspection round-trip to every request.

## Authorization — scopes & groups

There is **no MonoCloud-specific authorization API**. The handler only authenticates and turns token data into claims; you enforce requirements with the **standard ASP.NET Core policy system** (`AddAuthorization` / policies / `[Authorize(Policy=…)]` / `RequireClaim`). (Contrast the Node Express/Fastify SDK, which uses a `protectApi({ scopes, groups })` factory — that does not exist here.)

**How scopes become claims.** On the **opaque/introspection** path the `scope` response value (space-delimited string *or* JSON array) is split into **one `"scope"` claim per value**, so `RequireClaim("scope", "read:weather")` matches directly. On the **JWT** path scope claims arrive exactly as the JWT emits them — a space-delimited `scope` stays a **single** claim and is **not** auto-split, so a scope policy may need a custom requirement.

**How groups become claims.** Groups arrive under the token's group claim (MonoCloud uses `groups`). To have them expanded you **must** set `options.RoleClaimType = "groups"`. Group normalization then runs (on the opaque path it runs **only if `RoleClaimType` is non-null**) and expands a JSON-array group claim into individual claims: a string array becomes one claim per string; an array of `{id,name}` objects becomes **two** claims per group (one carrying the id, one the name) — so a policy can match either. Because `RoleClaimType` is the identity's role claim type, `[Authorize(Roles=…)]` and `User.IsInRole(...)` also work against groups.

```csharp
builder.Services.AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme)
    .AddMonoCloudAuthentication(options =>
    {
        options.TenantDomain = builder.Configuration["MonoCloud:TenantDomain"];
        options.Audience     = builder.Configuration["MonoCloud:Audience"];
        options.RoleClaimType = "groups"; // required so groups expand + role/group policies work
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("read:weather", p => p.RequireClaim("scope", "read:weather"));
    options.AddPolicy("admins",       p => p.RequireClaim("groups", "admin")); // matches RoleClaimType
});
```

Then require them: `[Authorize(Policy = "read:weather")]` on controllers/actions, or `.RequireAuthorization("read:weather")` on minimal-API endpoints. `[Authorize]` / `.RequireAuthorization()` with no policy just requires an authenticated principal from the scheme.

## Client authentication methods

Set `options.ClientAuth` to one of these when the API must authenticate itself on the introspection request (opaque path). All except the SPIFFE-fixed-SVID case require `options.ClientId`. Types live in `MonoCloud.Authentication.Api.Shared.ClientAuth`.

| Type | client_auth method | Constructor |
| --- | --- | --- |
| `ClientSecretAuth` | `client_secret_post` (default) / `client_secret_basic` | `ClientSecretAuth(string clientSecret, bool clientSecretBasic = false)` |
| `JwtAssertionAuth` | `client_secret_jwt` (symmetric) / `private_key_jwt` (asymmetric) | `JwtAssertionAuth(string clientSecret)` · `JwtAssertionAuth(JsonWebKey jwk)` · `JwtAssertionAuth(X509Certificate2 certificate)` |
| `TlsAuth` | `tls_client_auth` (mutual TLS, RFC 8705) | `TlsAuth(X509Certificate2? certificate = null, string? trustStore = null)` |
| `SpiffeJwtAuth` | `spiffe_jwt` (JWT-SVID forwarded as client assertion) | `SpiffeJwtAuth(string jwtSvid)` · `SpiffeJwtAuth(Func<HttpContext, CancellationToken, Task<string>> jwtSvidProvider)` |
| `SpiffeX509Auth` | `spiffe_x509` (X.509-SVID over mTLS; behaves like `tls_client_auth`) | `SpiffeX509Auth(X509Certificate2? certificate = null, string? trustStore = null)` |

```csharp
// Confidential client with a shared secret (the common case)
options.ClientId = builder.Configuration["MonoCloud:ClientId"];
options.ClientAuth = new ClientSecretAuth(builder.Configuration["MonoCloud:ClientSecret"]!);
// client_secret_basic instead of the default client_secret_post:
options.ClientAuth = new ClientSecretAuth(secret, clientSecretBasic: true);

// Signed client assertion (private_key_jwt) from a certificate
options.ClientAuth = new JwtAssertionAuth(new X509Certificate2("client.pfx", pfxPassword));

// Mutual-TLS client auth — the cert proves client identity (no secret in the body)
options.ClientAuth = new TlsAuth(new X509Certificate2("client.pfx", pfxPassword));

// SPIFFE/SPIRE workload — resolve the rotated short-lived JWT-SVID per request
options.ClientAuth = new SpiffeJwtAuth(async (ctx, ct) =>
    await ctx.RequestServices.GetRequiredService<IWorkloadApi>().FetchJwtSvidAsync(ct));
```

`JwtAssertionAuth` builds a signed client-assertion JWT (`iss`/`sub` = `ClientId`, `aud` = token endpoint, `jti`/`nbf`/`iat`/`exp` = now + `JwtAssertionDuration`); override the algorithm with `JwtAssertionSigningAlgorithm` or the assertion itself via the `OnCreatingJwtAssertion` event. `TlsAuth`/`SpiffeX509Auth` resolve the introspection endpoint from the discovery doc's `mtls_endpoint_aliases` (or a `trustStore`-specific `mtls_additional_endpoint_aliases` entry) and throw `InvalidOperationException` if that alias is absent; supplying a `certificate` makes the SDK build a dedicated cert-bearing `HttpClient`, otherwise attach the cert to `options.HttpClient`'s handler yourself. For a custom scheme, implement `IMonoCloudClientAuth.AuthenticateAsync(ClientAuthenticationContext, CancellationToken)`.

## Claims caching

Introspection is a per-request network call; cache its results by implementing `IIntrospectionCache` (namespace `MonoCloud.Authentication.Api.Shared`) — a raw string key/value store the SDK serializes claims JSON into and out of:

```csharp
public interface IIntrospectionCache
{
    Task<string?> GetAsync(string key, CancellationToken cancellationToken);
    Task SetAsync(string key, string value, TimeSpan expiresIn, CancellationToken cancellationToken);
}
```

**Register it as a singleton** (hard requirement — the post-configure step that discovers it is a singleton, so a scoped/transient registration fails DI scope validation). If `EnableCaching = true` and no `IIntrospectionCache` is registered, startup throws `ArgumentException("IIntrospectionCache not found in the services collection")`.

```csharp
public sealed class MemoryIntrospectionCache : IIntrospectionCache
{
    private readonly IMemoryCache _cache;
    public MemoryIntrospectionCache(IMemoryCache cache) => _cache = cache;

    public Task<string?> GetAsync(string key, CancellationToken ct) =>
        Task.FromResult(_cache.TryGetValue(key, out string? v) ? v : null);

    public Task SetAsync(string key, string value, TimeSpan expiresIn, CancellationToken ct)
    {
        _cache.Set(key, value, expiresIn);
        return Task.CompletedTask;
    }
}
```

```csharp
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<IIntrospectionCache, MemoryIntrospectionCache>(); // MUST be singleton

// ...AddMonoCloudAuthentication(options =>
options.EnableCaching  = true;
options.CacheDuration  = TimeSpan.FromMinutes(5);
options.CacheKeyPrefix = "api:";
```

A Redis adapter is identical — `GetAsync` reads the string, `SetAsync` writes it with `expiresIn` as the key TTL. Notes: **only introspection-validated tokens are cached** (opaque tokens, plus JWTs when `IntrospectJwtTokens = true`); locally validated JWTs are never cached. Both active and inactive results are cached (inactive short-circuits a re-introspection). The default key is `CacheKeyPrefix + Base64(SHA256("{SchemeName}|{token}"))` — the scheme discriminator means multiple schemes never share entries. TTL is `min(CacheDuration, time-until-token-exp)`. A thrown `GetAsync` is caught and logged, then the handler falls through to a live introspection — a cache failure never fails the request.

## mTLS certificate-bound tokens

Enforce RFC 8705 sender-constrained tokens (`cnf` / `x5t#S256`) per-request via `ValidateCertificateBinding`:

```csharp
options.ValidateCertificateBinding = ctx => ctx.Request.Path.StartsWithSegments("/api/secure");
// CertificateRetriever defaults to ctx.Connection.GetClientCertificateAsync();
// override it if the cert arrives via a header from a TLS-terminating proxy:
options.CertificateRetriever = async ctx =>
{
    var pem = ctx.Request.Headers["X-Client-Cert"].ToString();
    return string.IsNullOrEmpty(pem) ? null : X509Certificate2.CreateFromPem(Uri.UnescapeDataString(pem));
};
```

When the predicate returns `true`, the presented client cert's base64url SHA-256 thumbprint is compared (constant-time) against the token's `cnf.x5t#S256` on **all three** validation routes (local JWT, live introspection, cached introspection). On success `OnCertificateBindingValidated` fires. Note that cert-**binding** (validating the caller's token) is independent of mTLS client-**auth** (`TlsAuth`, how the API authenticates itself to the introspection endpoint).

## Events

Assign delegates on `options.Events` (a `MonoCloudAuthenticationEvents`), or subclass and override the virtual methods.

| Event | Fires |
| --- | --- |
| `OnMessageReceived` | First, before the token is read from the `Authorization` header. Set `context.Token` to supply it yourself, or `context.Result` to short-circuit. |
| `OnTokenValidated` | After validation + principal built, on **both** paths. `context.Token` is a `SecurityToken` on the JWT path but the raw token **string** on the opaque path (type is `object`). |
| `OnIntrospection` | Opaque path, just before the introspection HTTP request is sent. Mutate `context.IntrospectionRequest`. |
| `OnCreatingJwtAssertion` | Inside `JwtAssertionAuth` before the assertion is built. Set `context.JwtAssertion` to fully override it. |
| `OnCertificateBindingValidated` | After the client cert thumbprint matches `cnf.x5t#S256`. |
| `OnAuthenticationFailed` | On any failure (validation error, introspection failure, inactive token, cert-binding failure). `context.Exception` carries the error; set `context.Result` to override. |

```csharp
options.Events = new MonoCloudAuthenticationEvents
{
    OnTokenValidated = ctx =>
    {
        ctx.HttpContext.RequestServices
           .GetRequiredService<ILoggerFactory>()
           .CreateLogger("Auth")
           .LogInformation("Token validated for {Sub}", ctx.Principal?.FindFirst("sub")?.Value);
        return Task.CompletedTask;
    },
    OnAuthenticationFailed = ctx =>
    {
        // ctx.Exception has the details; leave ctx.Result unset to keep the default 401.
        return Task.CompletedTask;
    }
};
```

> Context types (`MonoCloud.Authentication.Api.Shared.Context`) shadow identically named JwtBearer types via global usings — reference the MonoCloud ones, not `Microsoft.AspNetCore.Authentication.JwtBearer`'s.

## Accessing the authenticated user

Read claims from `ClaimsPrincipal` — inject it in minimal APIs, or use `User` / `HttpContext.User` in controllers.

**`MapInboundClaims` defaults to `true`.** On the **JWT path** this maps claim types to legacy WS-* URIs — `sub` becomes `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`, etc. If you index claims by short name (`"sub"`), either set `options.MapInboundClaims = false` to keep OIDC names, or set `NameClaimType`/`RoleClaimType` to the mapped URIs. **Introspection/opaque claims are never remapped** — they are built verbatim from the RFC 7662 JSON.

```csharp
// Minimal API
app.MapGet("/api/profile", (ClaimsPrincipal user) => Results.Ok(new
{
    Name   = user.Identity?.Name,                        // reflects NameClaimType
    Scopes = user.FindAll("scope").Select(c => c.Value), // one claim per scope on the opaque path
    Groups = user.FindAll("groups").Select(c => c.Value) // requires RoleClaimType = "groups"
})).RequireAuthorization();

// With MapInboundClaims = false, read short names directly:
app.MapGet("/api/sub", (ClaimsPrincipal user) => user.FindFirst("sub")?.Value)
   .RequireAuthorization();
```

```csharp
// Controller
[ApiController]
[Route("api/[controller]")]
public class WeatherController : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = "read:weather")]
    public IActionResult Get() => Ok(new { user = User.Identity?.Name });

    [HttpDelete("{id}")]
    [Authorize(Roles = "admin")] // matches RoleClaimType = "groups"
    public IActionResult Delete(string id) => NoContent();
}
```

## Multiple schemes

Register the handler more than once with distinct scheme names to validate tokens from different tenants/audiences, then target a scheme in `[Authorize(AuthenticationSchemes = "…")]` or a policy's `AuthenticationSchemes`:

```csharp
builder.Services.AddAuthentication()
    .AddMonoCloudAuthentication("tenant-a", o => { o.TenantDomain = a; o.Audience = audA; })
    .AddMonoCloudAuthentication("tenant-b", o => { o.TenantDomain = b; o.Audience = audB; });
```

The cache key includes the scheme name, so schemes never share cached claims for the same token.

## Common pitfalls

1. **Opaque tokens without `ClientId` + `ClientAuth`.** The introspection path requires `TenantDomain` + `ClientId` + `ClientAuth`; each throws `ArgumentNullException` at request time. Pure local-JWT validation needs none of them.
2. **`EnableCaching = true` with no singleton cache.** Startup throws `ArgumentException("IIntrospectionCache not found...")`. Register `IIntrospectionCache` and it **must** be a singleton or DI scope validation fails.
3. **Forgetting `RoleClaimType = "groups"`.** Without it, the `groups` claim stays a raw JSON-array string on the opaque path and `RequireClaim("groups", "admin")` never matches.
4. **Indexing claims by short name with `MapInboundClaims` on (the default).** `sub`/`name`/etc. become long WS-* URIs on the JWT path. Set `MapInboundClaims = false` or use the mapped URIs. (Introspection claims are unaffected.)
5. **JWT scopes aren't auto-split.** A space-delimited `scope` on the JWT path is one claim; only the introspection path splits scopes into per-value `"scope"` claims. Add a custom policy/requirement if you gate space-delimited JWT scopes.
6. **Passing the discovery URL as `TenantDomain`.** Provide the tenant root (`https://acme.us.monocloud.com`); the SDK appends `/.well-known/openid-configuration` and prefixes `https://` if missing.
7. **`Audience` ignored.** It only feeds `ValidAudience` when `JwtTokenValidationParameters.ValidAudience` is unset — setting `ValidAudience` directly overrides `Audience`.
8. **`UseAuthentication()`/`UseAuthorization()` order or omission.** Both are required, `UseAuthentication()` first, both after routing — otherwise `[Authorize]` yields 401/403 even for valid tokens.
9. **`TlsAuth`/`SpiffeX509Auth` without mTLS aliases.** The discovery doc must expose `mtls_endpoint_aliases.introspection_endpoint` (or a trust-store entry) or you get `InvalidOperationException`; without an explicit cert you must attach it to `options.HttpClient`'s handler.
10. **Casting `TokenValidatedContext.Token`.** It's a `SecurityToken` on the JWT path but a `string` on the opaque path (declared `object`) — check the type before casting.

## Onboarding checklist

1. `dotnet add package MonoCloud.Authentication.Api`.
2. Register an **API** (audience) in the MonoCloud dashboard matching `options.Audience`.
3. `Program.cs`: `AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme).AddMonoCloudAuthentication(options => { ... })`.
4. Set `TenantDomain` + `Audience` (from `IConfiguration`). For opaque tokens also set `ClientId` + `ClientAuth`.
5. Add `app.UseAuthentication(); app.UseAuthorization();` (in that order).
6. For group policies, set `options.RoleClaimType = "groups"` and define policies with `AddAuthorization` / `RequireClaim`.
7. Protect endpoints with `[Authorize(Policy=…)]` / `.RequireAuthorization(…)`, and read `ClaimsPrincipal` in handlers.
8. (Optional) Register a singleton `IIntrospectionCache` and set `EnableCaching = true` to cache introspection results.

## Deeper reference

- [`references/api-surface.md`](references/api-surface.md) — every `MonoCloudAuthenticationOptions` option (type, default, behavior), all four DI overloads, every client-auth type, and every event context.
- [`references/troubleshooting.md`](references/troubleshooting.md) — symptom → cause → fix for the common failure modes (401/403, `ArgumentNullException` on the opaque path, `IIntrospectionCache not found`, `MapInboundClaims` claim-name surprises, group-claim non-expansion, mTLS alias errors).
- Quickstart: <https://www.monocloud.com/docs/quickstarts/dotnet-api-authentication> · SDK reference: <https://www.monocloud.com/docs/sdks/dotnet-api-authentication> · API reference: <https://monocloud.github.io/api-authentication-dotnet>.
