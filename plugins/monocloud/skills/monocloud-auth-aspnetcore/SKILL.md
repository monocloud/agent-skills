---
name: monocloud-auth-aspnetcore
description: Use when validating MonoCloud access tokens in ASP.NET Core APIs — installing or configuring the `MonoCloud.Authentication.Api` NuGet package, wiring `AddAuthentication(...).AddMonoCloudAuthentication(...)` and the `"MonoCloud"` scheme, setting `MonoCloudAuthenticationOptions` (`Authority`, `Audience`, `ClientId`, `ClientAuth`, `RoleClaimType`, `IntrospectJwtTokens`), JWT vs opaque (RFC 7662 introspection) tokens, scope/group authorization via standard `[Authorize(Policy=…)]` / `RequireClaim` policies, caching introspection with a singleton `IIntrospectionCache`, mTLS certificate-bound tokens (`ValidateCertificateBinding` = `CertificateBindingValidation.WhenPresent`/`Required`/`DangerouslyIgnore`, `cnf` / `x5t#S256`), client-auth methods (`client_secret_basic`/`client_secret_post`/`client_secret_jwt`/`private_key_jwt`/`tls_client_auth`/`spiffe_jwt`/`spiffe_x509`), or troubleshooting 401/403/500s, `MapInboundClaims`, `Token inactive`, or `IIntrospectionCache not found`.
license: MIT
---

# MonoCloud ASP.NET Core API authentication (`MonoCloud.Authentication.Api`)

Validates MonoCloud-issued **access tokens** in ASP.NET Core APIs and resource servers. It is a standard authentication **scheme** whose handler extends `JwtBearerHandler` (`MonoCloudAuthenticationOptions : JwtBearerOptions`, `MonoCloudAuthenticationEvents : JwtBearerEvents`), so the whole `AddJwtBearer` option and event surface applies, and it plugs into `UseAuthentication()`, `[Authorize]` and authorization policies. JWTs are validated locally against the tenant's signing keys; opaque (reference) tokens are introspected (RFC 7662). The format is detected per request.

## Package identity — read this first

- **Install `MonoCloud.Authentication.Api`** (NuGet). Package id, assembly and root namespace are the same. Check `*.csproj` for `<PackageReference Include="MonoCloud.Authentication.Api" … />` before writing code.
- **Targets `net8.0`, `net9.0`, `net10.0`** — the API project must target `net8.0` or later. The matching `Microsoft.AspNetCore.Authentication.JwtBearer` comes in transitively; don't add it yourself.
- **Different packages:** `MonoCloud.Management` calls the Management API (`monocloud-management-dotnet` skill); `@monocloud/backend-node` with `protectApi()` is the Node SDK (`monocloud-auth-express` / `monocloud-auth-fastify`). `@monocloud/authentication-api` is a private release-tooling name in the SDK repo, not an installable package.
- **These do not exist — never emit them:** `AddMonoCloud()`, `UseMonoCloud()` / `UseMonoCloudAuthentication()` middleware, `[MonoCloudAuthorize]`, `MonoCloud.AspNetCore.Authentication`, `MonoCloudJwtBearer`, `options.TenantDomain` (use `Authority`), `options.ClientSecret` (use `ClientAuth = new ClientSecretAuth(…)`), `JwtTokenValidationParameters` (use `TokenValidationParameters`), `MONOCLOUD_*` environment variables. The SDK reads no environment variables; configure it through the options action or `IConfiguration`.

## Install and register

```bash
dotnet add package MonoCloud.Authentication.Api
```

```csharp
using System.Security.Claims;
using MonoCloud.Authentication.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme) // "MonoCloud"
    .AddMonoCloudAuthentication(options =>
    {
        options.Authority = builder.Configuration["MonoCloud:Authority"]; // tenant domain, e.g. https://acme.us.monocloud.com
        options.Audience  = builder.Configuration["MonoCloud:Audience"];  // the API's audience identifier
    });

builder.Services.AddAuthorization();

var app = builder.Build();

app.UseAuthentication(); // then UseAuthorization; both after UseRouting() if you call it explicitly
app.UseAuthorization();

app.MapGet("/api/protected", (ClaimsPrincipal user) =>
        user.Claims.Select(c => new { c.Type, c.Value }))
   .RequireAuthorization();

app.Run();
```

`AddMonoCloudAuthentication` hangs off `AuthenticationBuilder` with four overloads: `()`, `(string authenticationScheme)`, `(Action<MonoCloudAuthenticationOptions> configureOptions)`, `(string authenticationScheme, Action<MonoCloudAuthenticationOptions>? configureOptions)`. Without a scheme argument it registers `"MonoCloud"`. Registering the same scheme name twice throws `InvalidOperationException` ("Scheme already exists").

Namespaces:

- `MonoCloud.Authentication.Api` — registration, options, events, `CertificateBindingValidation`
- `.Shared` — `IIntrospectionCache`, `JwtAssertion`
- `.Shared.ClientAuth` — client-auth types
- `.Shared.Context` — MonoCloud event contexts

## Configuration

Every `JwtBearerOptions` member applies. These are the ones that matter:

| Option | Type, default | Notes |
| --- | --- | --- |
| `Authority` *(inherited)* | `string?`, `null` | Tenant domain: the issuer and discovery base (`{Authority}/.well-known/openid-configuration`). A value without `://` gets `https://` prepended. `http://` also needs `RequireHttpsMetadata = false` (dev only). Required for introspection. |
| `Audience` *(inherited)* | `string?`, `null` | Expected `aud` for JWTs. Copied to `TokenValidationParameters.ValidAudience` unless that is already set. |
| `ClientId` | `string?`, `null` | Required on the introspection path. Not used for local JWT validation. |
| `ClientAuth` | `IMonoCloudClientAuth?`, `null` | How the API authenticates to the introspection endpoint. Required on the introspection path. See [Client authentication](#client-authentication). |
| `IntrospectJwtTokens` | `bool`, `false` | Send JWTs to introspection too, for a server-side revocation check instead of local validation. |
| `RoleClaimType` | `string?`, `null` | Role claim type on both paths. Set `"groups"` for MonoCloud groups (see [Authorization](#authorization--scopes-and-groups)). |
| `NameClaimType` | `string?`, `null` | Claim used for `Identity.Name` on both paths. |
| `MapInboundClaims` *(inherited)* | `bool`, `true` | JWT path only: renames claim types such as `sub` → `ClaimTypes.NameIdentifier`. Introspected claims are never renamed. See [Reading claims](#reading-claims). |
| `EnableCaching` / `CacheDuration` / `CacheKeyPrefix` | `bool` `false` / `TimeSpan` 5 min / `string` `""` | Introspection-result caching. See [Caching](#caching-introspection-results). |
| `ValidateCertificateBinding` | `CertificateBindingValidation`, `WhenPresent` | Certificate-bound tokens. See [mTLS binding](#mtls-certificate-bound-tokens). |
| `CertificateRetriever` | `Func<HttpContext, Task<X509Certificate2?>>`, `Connection.GetClientCertificateAsync()` | Supplies the caller's client certificate for binding checks. |
| `ClockSkew` | `TimeSpan?`, `null` | Copied to `TokenValidationParameters.ClockSkew` when set. `null` leaves that value alone (5 min by default). |
| `SaveToken` / `IncludeErrorDetails` *(inherited)* | `bool`, `true` / `true` | Store the raw token as `access_token`. Put `error` / `error_description` in the 401 challenge. |

Other declared options (`AuthenticationType`, `CacheKeyGenerator`, `JwtAssertionDuration`, `JwtAssertionSigningAlgorithm`, `HttpClient`, `Events`) and how they map onto `JwtBearerOptions` are listed in [`references/api-surface.md`](references/api-surface.md#monocloudauthenticationoptions).

Simple values bind from `IConfiguration`, which also lets environment variables in through the usual providers (e.g. `MonoCloud__Authority`). `ClientAuth` is an object and is set in code:

```json
{ "MonoCloud": { "Authority": "https://acme.us.monocloud.com", "Audience": "https://api.example.com", "ClientId": "<client-id>" } }
```

```csharp
.AddMonoCloudAuthentication(options =>
{
    builder.Configuration.GetSection("MonoCloud").Bind(options);
    options.ClientAuth = new ClientSecretAuth(builder.Configuration["MonoCloud:ClientSecret"]!); // secret from User Secrets / a vault
});
```

## JWT vs opaque tokens

| | JWT path | Introspection (opaque) path |
| --- | --- | --- |
| Used for | compact JWTs while `IntrospectJwtTokens` is `false` | every other token, or all tokens when `IntrospectJwtTokens = true` |
| Validation | base `JwtBearerHandler`: signature (discovery JWKS), issuer, `Audience`, lifetime | POST to the discovery `introspection_endpoint`; response must be `"active": true`. `Audience` is not compared, so add a `RequireClaim("aud", …)` policy if needed. |
| Requires | `Authority`, `Audience` | `Authority`, `ClientId`, `ClientAuth` |
| Per-request network | none once discovery and keys are cached | one introspection call, unless cached or shared with a concurrent identical request |

Outcomes:

- **No bearer token** → anonymous (`NoResult`). `[Authorize]` then challenges with 401 `WWW-Authenticate: Bearer`.
- **Token verdicts** → 401 `Bearer error="invalid_token"`. These are an invalid or expired JWT, `Token inactive` (`active: false`), and certificate-binding failures. The reason is in `OnAuthenticationFailed` → `context.Exception.Message`. The challenge only carries `error_description` for the framework's own JWT errors (expiry, audience, issuer, signature).
- **Introspection-path infrastructure failures** → the exception propagates (500). These are a missing `ClientId` / `Authority` / `ClientAuth` (`ArgumentNullException`), discovery/HTTP errors or non-2xx responses (`HttpRequestException`), malformed JSON (`JsonException`), client-auth errors, and exceptions from your own event handlers. Setting `context.Result` in `OnAuthenticationFailed` replaces the 500, except for the missing `ClientId` / `Authority` checks, which run before that event.

## Authorization — scopes and groups

There is no MonoCloud-specific authorization API. Use `AddAuthorization` policies, `[Authorize(Policy = …)]`, `.RequireAuthorization(…)` and `RequireClaim`.

- **Scopes** become one `scope` claim per value on both paths, whether the token has a space-delimited string or an array. So `RequireClaim("scope", "read:weather")` works directly.
- **Groups** arrive in the `groups` claim as strings and/or `{ "id", "name" }` objects, and each entry becomes its own `groups` claim. Set `options.RoleClaimType = "groups"` for two effects:
  - Each object expands into two claims, its id and its name. Without this setting an object stays a raw JSON string that no policy matches.
  - Groups count as roles for `[Authorize(Roles = …)]`, `RequireRole` and `User.IsInRole`.

```csharp
builder.Services.AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme)
    .AddMonoCloudAuthentication(options =>
    {
        options.Authority = builder.Configuration["MonoCloud:Authority"];
        options.Audience = builder.Configuration["MonoCloud:Audience"];
        options.RoleClaimType = "groups";
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("read:weather", p => p.RequireClaim("scope", "read:weather"));
    options.AddPolicy("admins", p => p.RequireClaim("groups", "admin")); // group id or name
});

app.MapGet("/weather", () => "…").RequireAuthorization("read:weather");
// Controllers: [Authorize(Policy = "read:weather")], [Authorize(Roles = "admin")]
```

`[Authorize]` or `.RequireAuthorization()` without a policy only requires an authenticated principal. Set `RoleClaimType` / `NameClaimType` on the MonoCloud options, not on `TokenValidationParameters`, because the introspection path reads only the options.

## Client authentication

`ClientAuth` is required on the introspection path (opaque tokens, or `IntrospectJwtTokens = true`), always together with `options.ClientId`. The types are in `MonoCloud.Authentication.Api.Shared.ClientAuth`.

| Method | `options.ClientAuth =` |
| --- | --- |
| `client_secret_post` | `new ClientSecretAuth(secret)` |
| `client_secret_basic` | `new ClientSecretAuth(secret, clientSecretBasic: true)` |
| `client_secret_jwt` | `new JwtAssertionAuth(secret)`, or `new JwtAssertionAuth(jwk)` with an `oct` key |
| `private_key_jwt` | `new JwtAssertionAuth(certificate)`, or `new JwtAssertionAuth(jwk)` with an RSA/EC key |
| `tls_client_auth` | `new TlsAuth(certificate, trustStore)` (both optional) |
| `spiffe_jwt` | `new SpiffeJwtAuth(jwtSvid)` or `new SpiffeJwtAuth((httpContext, ct) => …)` |
| `spiffe_x509` | `new SpiffeX509Auth(certificate, trustStore)` (both optional) |
| custom | implement `IMonoCloudClientAuth.AuthenticateAsync(ClientAuthenticationContext, CancellationToken)` |

```csharp
options.ClientId = builder.Configuration["MonoCloud:ClientId"];
options.ClientAuth = new ClientSecretAuth(builder.Configuration["MonoCloud:ClientSecret"]!);
```

- `JwtAssertionAuth` signs a fresh assertion for every introspection: `iss` and `sub` are `ClientId`, `aud` is the discovery issuer, and the lifetime is `JwtAssertionDuration` (default 5 min). The default algorithm is HS256 for a secret or `oct` key and RS256 otherwise. Set `JwtAssertionSigningAlgorithm` for EC keys (e.g. `SecurityAlgorithms.EcdsaSha256`).
- `TlsAuth` / `SpiffeX509Auth` introspect at the discovery document's `mtls_endpoint_aliases.introspection_endpoint`. With a `trustStore` they use that trust store's entry under `mtls_additional_endpoint_aliases`. If the alias is missing they throw `InvalidOperationException`. Given a certificate (and no `options.HttpClient`), the SDK builds an `HttpClient` that presents it. Without one, attach the certificate yourself to the named client `MonoCloudAuthenticationDefaults.HttpClientName` or to `options.HttpClient`.
- `SpiffeJwtAuth`'s provider runs on every introspection, so rotated JWT-SVIDs are picked up. Resolve your Workload API client from `httpContext.RequestServices`.

## Caching introspection results

Each opaque token costs one introspection call per request. To cache results, register a **singleton** `IIntrospectionCache` (`MonoCloud.Authentication.Api.Shared`). It's a string key/value store, and the SDK serializes the claims itself.

```csharp
using Microsoft.Extensions.Caching.Memory;
using MonoCloud.Authentication.Api.Shared;

public sealed class MemoryIntrospectionCache(IMemoryCache cache) : IIntrospectionCache
{
    public Task<string?> GetAsync(string key, CancellationToken ct) =>
        Task.FromResult(cache.TryGetValue(key, out string? value) ? value : null);

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

builder.Services.AddMemoryCache();
builder.Services.AddSingleton<IIntrospectionCache, MemoryIntrospectionCache>();
// inside AddMonoCloudAuthentication(options => …):
options.EnableCaching = true;
options.CacheDuration = TimeSpan.FromMinutes(5);
```

- **Registration.** It must be a singleton; a scoped registration fails DI scope validation. With `EnableCaching = true` and nothing registered, the first request through the scheme fails with `ArgumentException: IIntrospectionCache not found in the services collection`.
- **What's cached.** Only introspected tokens; local JWT validations never are. Both active and inactive results are stored, so a cached inactive token fails without another call. A token revoked after it was cached keeps passing until its entry expires.
- **TTL and key.** The TTL is `CacheDuration`, shortened to the token's remaining `exp`; already-expired tokens aren't stored. The key is `CacheKeyPrefix` + Base64(SHA-256(`"{scheme}|{token}"`)), so schemes never share entries.
- **Errors and eviction.** Cache exceptions are logged and swallowed. A failed `GetAsync` falls back to live introspection, and a failed `SetAsync` doesn't fail the request. The SDK never calls `DeleteAsync`; call it yourself to evict early:

```csharp
// inject IOptionsMonitor<MonoCloudAuthenticationOptions> optionsMonitor and IIntrospectionCache cache
var o = optionsMonitor.Get(MonoCloudAuthenticationDefaults.AuthenticationScheme);
await cache.DeleteAsync(o.CacheKeyGenerator(o, token), cancellationToken);
```

## mTLS certificate-bound tokens

`options.ValidateCertificateBinding` is a `CertificateBindingValidation` enum (namespace `MonoCloud.Authentication.Api`). It controls the RFC 8705 `cnf` / `x5t#S256` check, which runs the same way on JWT, introspected and cached results:

| Value | Validates |
| --- | --- |
| `WhenPresent` (default) | Tokens whose `cnf` claim has an `x5t#S256` member. A `cnf` using another method (e.g. DPoP `jkt`) is skipped. A `cnf` that can't be parsed is validated and fails. |
| `Required` | Every token. Tokens without `cnf` are rejected. |
| `DangerouslyIgnore` | Nothing, even when `cnf` is present. |

It is a setting, not a per-request predicate. Assigning a delegate (`_ => true`) doesn't compile. An undefined value (e.g. a cast integer) throws `ArgumentException` when the options are built.

When the check runs, the base64url SHA-256 thumbprint of the certificate from `CertificateRetriever` must equal `cnf.x5t#S256`. On a match `OnCertificateBindingValidated` fires, then `OnTokenValidated`. Each failure is a 401 with one of these messages in `context.Exception.Message`:

- `Client certificate is not present`
- `Client certificate is malformed` — the retriever threw; the original exception is the `InnerException`
- `Access token does not contain a 'cnf' (confirmation) claim …`
- `Malformed 'cnf' claim …`
- `The 'cnf' claim does not contain an 'x5t#S256' member …`
- `The certificate hash in the access token does not match the presented client certificate …`

Kestrel has to request client certificates (`ClientCertificateMode`). Behind a TLS-terminating proxy, read the forwarded certificate instead:

```csharp
options.ValidateCertificateBinding = CertificateBindingValidation.Required; // also reject unbound tokens
options.CertificateRetriever = ctx =>
{
    var pem = ctx.Request.Headers["X-Client-Cert"].ToString(); // whatever header your proxy sets
    return Task.FromResult<X509Certificate2?>(
        string.IsNullOrEmpty(pem) ? null : X509Certificate2.CreateFromPem(Uri.UnescapeDataString(pem)));
};
```

Certificate *binding* checks the caller's token. It is independent of mTLS *client authentication* (`TlsAuth`), which is how the API proves its own identity to the introspection endpoint.

## Events

`options.Events` is a `MonoCloudAuthenticationEvents` (`: JwtBearerEvents`). Assign delegates on it, or subclass and override.

| Event | Fires |
| --- | --- |
| `OnMessageReceived` | Once per request, before the token is read. Set `context.Token` to supply one, or `context.Result` to short-circuit. |
| `OnTokenValidated` | On both paths, after claims are normalized and binding has passed. `context.SecurityToken` is `null` for introspected tokens, so use `context.Principal`. `context.Fail(…)` rejects. |
| `OnAuthenticationFailed` | On every failure except the up-front `ClientId` / `Authority` checks, with the cause in `context.Exception`. Setting `context.Result` replaces the outcome. |
| `OnChallenge` / `OnForbidden` | On a 401 challenge or a 403. |
| `OnIntrospection` | Before the introspection request is sent. Modify or replace `context.IntrospectionRequest`, which already carries the form body and client authentication. |
| `OnCreatingJwtAssertion` | Before `JwtAssertionAuth` builds its assertion. Set `context.JwtAssertion` to supply your own. |
| `OnCertificateBindingValidated` | After a thumbprint match. `context.Fail(…)` rejects. |

```csharp
options.Events.OnAuthenticationFailed = ctx =>
{
    ctx.HttpContext.RequestServices.GetRequiredService<ILogger<Program>>()
        .LogWarning(ctx.Exception, "MonoCloud authentication failed");
    return Task.CompletedTask; // leave ctx.Result unset to keep the default outcome
};
```

`MessageReceivedContext`, `TokenValidatedContext` and `AuthenticationFailedContext` are the framework's JwtBearer types. Only `IntrospectionRequestContext`, `JwtAssertionContext` and `CertificateBindingValidatedContext` are in `MonoCloud.Authentication.Api.Shared.Context`.

## Reading claims

Inject `ClaimsPrincipal` in minimal APIs, or use `User` in controllers.

- **`MapInboundClaims` is `true` by default.** On the JWT path it renames `sub` → `ClaimTypes.NameIdentifier`, `email` → `ClaimTypes.Email` and `role` / `roles` → `ClaimTypes.Role`. `scope`, `groups` and `cnf` keep their names, and introspected claims are never renamed. Set `options.MapInboundClaims = false` to use the same OIDC names (`FindFirst("sub")`) on both paths.
- **`User.Identity.Name` is `null`** unless `NameClaimType` names a claim the token carries, e.g. `"sub"` with `MapInboundClaims = false`.
- **The raw token** is saved (`SaveToken`): `await HttpContext.GetTokenAsync("access_token")`.

```csharp
app.MapGet("/api/profile", (ClaimsPrincipal user) => new
{
    Sub    = user.FindFirst("sub")?.Value,                // with MapInboundClaims = false
    Scopes = user.FindAll("scope").Select(c => c.Value),
    Groups = user.FindAll("groups").Select(c => c.Value)  // ids and names with RoleClaimType = "groups"
}).RequireAuthorization();
```

## Multiple schemes

```csharp
builder.Services.AddAuthentication()
    .AddMonoCloudAuthentication("tenant-a", o => { o.Authority = authorityA; o.Audience = audienceA; })
    .AddMonoCloudAuthentication("tenant-b", o => { o.Authority = authorityB; o.Audience = audienceB; });
// [Authorize(AuthenticationSchemes = "tenant-a")], or add the scheme to a policy's AuthenticationSchemes
```

Each scheme has its own options, cache keys and in-flight introspection de-duplication. With more than one scheme and no default, each `[Authorize]` (or a default policy) must name its scheme.

## Common pitfalls

1. **Middleware order.** Explicit calls must be `UseAuthentication()` then `UseAuthorization()`, both after an explicit `UseRouting()`. Otherwise valid tokens get 401s. `WebApplication` adds both automatically when you call neither; `Startup`-style pipelines must call both.
2. **Opaque tokens without `ClientId` + `ClientAuth`.** Requests fail with 500 (`ArgumentNullException`). JWT-only APIs need neither.
3. **`EnableCaching = true` without a singleton `IIntrospectionCache`.** You get `ArgumentException` (no registration) or a DI scope-validation error (scoped registration).
4. **Group checks without `RoleClaimType = "groups"`.** `{id,name}` groups stay JSON strings, and `[Authorize(Roles = …)]` / `IsInRole` never match.
5. **Short claim names with `MapInboundClaims` on.** `FindFirst("sub")` / `FindFirst("email")` return `null` on the JWT path.
6. **`Authority` set to the discovery URL.** Use the tenant root. The SDK adds `https://` if no scheme is given, and the framework appends `/.well-known/openid-configuration`. An `http://` authority throws `InvalidOperationException` unless `RequireHttpsMetadata = false`.
7. **Bound tokens without a certificate at the app.** TLS terminated at a proxy, or Kestrel not asking for client certs, gives 401 `Client certificate is not present`. Fix it with `CertificateRetriever` / `ClientCertificateMode`. Use `DangerouslyIgnore` only when binding is enforced elsewhere.
8. **Hardcoded secrets.** Load `ClientSecretAuth` / `JwtAssertionAuth` secrets from User Secrets or a vault, never from committed `appsettings.json` or source.

## Verify and go deeper

- [`scripts/verify.js`](scripts/verify.js) checks a project: package and target framework, registration and middleware order, `Authority` / `Audience`, client-auth pairing, cache lifetime, group/role setup, and options that don't exist. Run `node scripts/verify.js [project-dir]` from this skill's directory.
- [`references/api-surface.md`](references/api-surface.md) covers every public type, option, client-auth type, event and context, the request pipeline, claim shaping and a failure-message reference.
- [`references/troubleshooting.md`](references/troubleshooting.md) is symptom → cause → fix for 401 / 403 / 500, claims, caching, mTLS and build errors.
- Docs: [quickstart](https://www.monocloud.com/docs/quickstarts/dotnet-api-authentication) · [SDK reference](https://www.monocloud.com/docs/sdks/dotnet-api-authentication) · [API reference](https://monocloud.github.io/api-authentication-dotnet).
