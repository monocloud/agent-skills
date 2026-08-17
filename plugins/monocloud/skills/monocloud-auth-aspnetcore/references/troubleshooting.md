# Troubleshooting — `MonoCloud.Authentication.Api`

Quick reference for the most common things that go wrong when validating MonoCloud-issued access tokens in an ASP.NET Core API, grounded in `MonoCloud.Authentication.Api@0.1.4`. Each entry is **symptom → root cause → fix**.

This SDK is a standard ASP.NET Core **authentication handler / scheme** (built on `Microsoft.AspNetCore.Authentication.JwtBearer`), registered via `AddAuthentication(scheme).AddMonoCloudAuthentication(...)`. It only *authenticates* and shapes claims — authorization (scopes/groups) is the **standard** policy system (`AddAuthorization` / `[Authorize(Policy = …)]` / `RequireClaim`). There is no `protectApi` factory, no `[MonoCloudAuthorize]` attribute, and no environment-variable configuration — those belong to the Node express/fastify SDK, not this one.

## 401 on every request — middleware missing or misordered

**Symptom:** Every protected endpoint returns `401`, even with a valid `Authorization: Bearer <token>` header. No introspection or JWKS traffic appears in logs.

**Cause:** `app.UseAuthentication()` / `app.UseAuthorization()` are missing, in the wrong order, or registered *after* the endpoints. The handler never runs, so no `ClaimsPrincipal` is built and `[Authorize]` fails closed.

**Fix:** Register both, in this order, before `MapControllers()` / endpoint mapping:

```csharp
var app = builder.Build();

app.UseAuthentication();   // must come first — builds the principal
app.UseAuthorization();    // then enforces [Authorize] / policies

app.MapControllers();
app.Run();
```

`UseAuthentication` must precede `UseAuthorization`. If you use `UseRouting`, both auth calls go **between** `UseRouting` and the endpoint middleware.

## 401 on every request — scheme name mismatch

**Symptom:** Requests fail with `401` and the handler seems never to fire, or you get `InvalidOperationException: No authentication handler is registered for the scheme 'X'`.

**Cause:** The scheme you registered under `AddMonoCloudAuthentication` doesn't match the default challenge scheme (or what `[Authorize(AuthenticationSchemes = …)]` names). The default scheme string is `"MonoCloud"`, held in `MonoCloudAuthenticationDefaults.AuthenticationScheme`.

**Fix:** Register with the constant and make it the default:

```csharp
builder.Services
    .AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme)
    .AddMonoCloudAuthentication(options => { /* … */ });
```

`AddAuthentication(scheme)` sets both `DefaultAuthenticateScheme` and `DefaultChallengeScheme`. If you register under a custom scheme name — `AddMonoCloudAuthentication("my-scheme", options => …)` — either pass that same string to `AddAuthentication(...)` or name it explicitly: `[Authorize(AuthenticationSchemes = "my-scheme")]`.

## 401 on JWTs — audience or issuer mismatch

**Symptom:** A valid-looking JWT is rejected; `OnAuthenticationFailed` fires with a `SecurityTokenInvalidAudienceException` or `SecurityTokenInvalidIssuerException`.

**Cause:** The token's `aud` doesn't match `Audience` (which the framework's `JwtBearerPostConfigureOptions` copies into `TokenValidationParameters.ValidAudience`), or the discovery issuer doesn't match the token's `iss`. `Authority` is the tenant domain: the base `JwtBearerHandler` builds the discovery URL as `Authority + "/.well-known/openid-configuration"`.

**Fix:**

1. Decode the token (jwt.io or `dotnet`), compare `aud` against `options.Audience` — it must match **exactly**, including scheme and trailing slash (`https://api.example.com/` ≠ `https://api.example.com`).
2. Set `Authority` to the bare tenant root, e.g. `https://acme.us.monocloud.com` — **not** the `.well-known` URL. Post-configuration prepends `https://` if you omit the scheme.
3. `Audience` only feeds `ValidAudience` when `TokenValidationParameters.ValidAudience`/`ValidAudiences` is empty. If you set them directly, that wins and `Audience` is ignored.

```csharp
options.Authority = "https://acme.us.monocloud.com";
options.Audience = "https://api.example.com";
```

## Opaque/reference tokens fail (JWTs work fine)

**Symptom:** Short opaque tokens fail while JWTs succeed — the request returns **HTTP 500** (as of 0.1.4) with `OnAuthenticationFailed` carrying the real introspection exception (transport error, non-2xx response, malformed JSON, or client-auth failure), or throws `ArgumentNullException` naming `ClientId`, `Authority`, or `ClientAuth`.

**Cause:** Opaque (reference) tokens are validated by RFC 7662 introspection, which requires all three: `Authority`, `ClientId`, and a `ClientAuth`. The handler throws `ArgumentNullException("Client ID must be set")` / `("Authority must be set")` in `HandleOpaqueTokenAuthenticationAsync`, and `ArgumentNullException` for a null `ClientAuth` inside `IntrospectTokenAsync`. Pure local-JWT validation needs none of these.

**Fix:** Supply a client identity and authentication method for introspection:

```csharp
options.Authority  = "https://acme.us.monocloud.com";
options.ClientId   = builder.Configuration["MonoCloud:ClientId"];
options.ClientAuth = new ClientSecretAuth(builder.Configuration["MonoCloud:ClientSecret"]!);
```

`ClientAuth` is one of `ClientSecretAuth`, `JwtAssertionAuth`, `TlsAuth`, `SpiffeJwtAuth`, or `SpiffeX509Auth`. If your tenant issues only JWT access tokens you can leave all three unset.

## Introspection infrastructure failure returns 500, not 401

**Symptom:** An opaque-token request returns **HTTP 500** instead of a `401`. `OnAuthenticationFailed` fires with a real exception — an `HttpRequestException` (transport error or non-2xx introspection response via `EnsureSuccessStatusCode`), a `JsonException` (malformed introspection JSON), a discovery error, or a client-auth failure.

**Cause:** As of 0.1.4 the handler separates introspection **infrastructure** failures from token **verdicts**. Infrastructure failures — and exceptions thrown by your own opaque-path event handlers — raise `OnAuthenticationFailed` with the real exception and then **rethrow**, surfacing as a 500, instead of the old misleading 401 `invalid_token`. Genuine token verdicts (`active: false`, certificate-binding mismatch) still produce a `401`.

**Fix:** A 500 here means introspection could not complete — verify the tenant is reachable, the introspection endpoint/credentials are correct, and the discovery document is valid. To restore the old behavior and turn an infrastructure failure back into a 401, handle `OnAuthenticationFailed` and set `context.Result`:

```csharp
options.Events.OnAuthenticationFailed = ctx =>
{
    ctx.Result = AuthenticateResult.Fail(ctx.Exception!);
    return Task.CompletedTask;
};
```

## Need real-time revocation — introspect JWTs too

**Symptom:** Local JWT validation is "stale" — a revoked token keeps working until it expires.

**Cause:** By default, JWT-parseable tokens are validated locally (no network call); only opaque tokens are introspected.

**Fix:** Set `options.IntrospectJwtTokens = true` to force **every** token through introspection. This requires `ClientId` + `Authority` + `ClientAuth` (the opaque path). Cost: a network hop per request — pair it with `EnableCaching` (below) to bound the load.

## `IIntrospectionCache not found` / DI scope-validation error at startup

**Symptom:** The app throws at startup: `ArgumentException: IIntrospectionCache not found in the services collection`, or a scope-validation error like `Cannot consume scoped service 'IIntrospectionCache' from singleton`.

**Cause:** `EnableCaching = true` requires an `IIntrospectionCache` implementation in the container, and it **must be a singleton**. `PostConfigureMonoCloudAuthenticationOptions` (which discovers it) is itself a singleton, so a scoped/transient registration fails DI scope validation.

**Fix:** Register the implementation as a singleton before enabling caching:

```csharp
builder.Services.AddSingleton<IIntrospectionCache, MyRedisCache>();

builder.Services
    .AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme)
    .AddMonoCloudAuthentication(options =>
    {
        options.EnableCaching = true;                 // master switch (default false)
        options.CacheDuration = TimeSpan.FromMinutes(5);
        // …ClientId / ClientAuth / Authority for the opaque path
    });
```

`IIntrospectionCache` (namespace `MonoCloud.Authentication.Api.Shared`) has three methods — `Task<string?> GetAsync(string key, CancellationToken)`, `Task SetAsync(string key, string value, TimeSpan expiresIn, CancellationToken)`, and `Task DeleteAsync(string key, CancellationToken)` (added in 0.1.3, never called by the SDK — for consumer-side eviction) — a plain string key/value store; the SDK serializes/deserializes the claim list itself. Only introspection-validated tokens are cached (opaque tokens, plus JWTs when `IntrospectJwtTokens = true`); locally validated JWTs are never cached. A thrown `GetAsync` is caught and logged, then the request falls through to a live introspection; a failing `SetAsync` write is likewise swallowed and logged (as of 0.1.4), so a cache outage degrades gracefully rather than failing requests.

## Scope-based `[Authorize(Policy = …)]` never authorizes

**Symptom:** A policy like `RequireClaim("scope", "read:weather")` returns `403` even though the token clearly grants `read:weather`.

**Cause:** How the `scope` value lands as claims. On the **opaque/introspection** path the `scope` response (a space-delimited string *or* JSON array) is split into **one `Claim` of type `"scope"` per value**, so `RequireClaim("scope", "read:weather")` matches directly. As of 0.1.4 the local-JWT path also splits a space-delimited `scope` into one `"scope"` claim per value, matching the introspection path — so `RequireClaim("scope", "read:weather")` matches directly on both paths.

**Fix:** For opaque tokens, the direct claim policy works:

```csharp
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("read:weather", p => p.RequireClaim("scope", "read:weather"));
});
```

```csharp
[Authorize(Policy = "read:weather")]           // controller / action
public IActionResult Get() => Ok();

// or minimal API:
app.MapGet("/weather", () => "…").RequireAuthorization("read:weather");
```

## Group policy `[Authorize]` never matches

**Symptom:** `RequireClaim("groups", "admin")` (or `[Authorize(Roles = "admin")]`) returns `403` for users who are in the group; inspecting the principal shows one `groups` claim whose value is a raw JSON array string.

**Cause:** Group expansion via `Utils.NormalizeGroupClaims` runs **only if `RoleClaimType` is non-null** on the opaque path (and uses the `RoleClaimType` fallback on the JWT path). If you never set `options.RoleClaimType`, the `groups` claim is left as the raw array and no per-group claim exists to match.

**Fix:** Tell the handler which claim carries groups:

```csharp
options.RoleClaimType = "groups";   // MonoCloud's group claim
```

`NormalizeGroupClaims` then expands a JSON-array `groups` claim into individual claims of that type: a string array becomes one claim per string; an array of `{id, name}` objects expands into **two** claims per group (one carrying the `id`, one the `name`), so a policy can match either. Because `RoleClaimType` is also the `ClaimsIdentity` role claim type, `[Authorize(Roles = "admin")]` and `User.IsInRole("admin")` work against groups too.

```csharp
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("admins", p => p.RequireClaim("groups", "admin"));
});
```

## Claims look wrong / `User.FindFirst("sub")` is null

**Symptom:** `User.FindFirst("sub")`, `"email"`, etc. return null on the JWT path, but the token clearly contains them. The claim types show up as long URIs like `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`.

**Cause:** `MapInboundClaims` defaults to **`true`** and proxies to the internal `JsonWebTokenHandler`. With it on, well-known JWT claim types are rewritten to legacy Microsoft WS-* URIs (`sub` → `…/nameidentifier`, `name` → `…/name`, …). Opaque/introspection claims are **not** remapped — this only bites the JWT path.

**Fix:** Either turn mapping off to keep short OIDC names, or index by the mapped URI:

```csharp
options.MapInboundClaims = false;   // keep "sub", "email", "name" verbatim
```

```csharp
// Then read them by short name:
var sub = User.FindFirstValue("sub");
```

If you leave mapping on, set `NameClaimType` / `RoleClaimType` to the mapped URIs (or use `ClaimTypes.NameIdentifier`) so `User.Identity.Name` and role checks resolve.

## mTLS certificate-binding validation failing

**Symptom:** Certificate-bound tokens are rejected; `OnAuthenticationFailed` reports one of: `"Client certificate is not present"`, `"Access token does not contain a 'cnf' … claim"`, `"Malformed 'cnf' claim …"`, `"The 'cnf' claim does not contain an 'x5t#S256' member …"`, or `"… certificate binding validation failed"`.

**Cause:** Binding is opt-in per request via `options.ValidateCertificateBinding` (a `Func<HttpContext, bool>` defaulting to `_ => false`). When it returns `true`, the handler compares the presented client cert's base64url SHA-256 thumbprint against the token's `cnf.x5t#S256` claim (constant-time). Failures: no client cert reached the handler, the token isn't bound, or the thumbprints differ.

**Fix:**

1. Enable binding only for the requests that need it:
   ```csharp
   options.ValidateCertificateBinding = ctx => true;   // or gate by path / header
   ```
2. Make sure the client certificate actually reaches the app. By default the cert is read via `context.Connection.GetClientCertificateAsync()`. Behind a reverse proxy/load balancer that terminates TLS (nginx, ALB, YARP), forward the client cert and supply a custom retriever:
   ```csharp
   options.CertificateRetriever = ctx =>
   {
       var pem = ctx.Request.Headers["X-Client-Cert"].FirstOrDefault();
       return Task.FromResult(pem is null
           ? null
           : X509Certificate2.CreateFromPem(Uri.UnescapeDataString(pem)));
   };
   ```
   In Kestrel, also configure `ClientCertificateMode` so the cert is negotiated. This cert-*binding* feature (validating the caller's token) is independent of mTLS client-*auth* (`TlsAuth`, below).

## `InvalidOperationException` about the mTLS introspection alias

**Symptom:** Using `TlsAuth` or `SpiffeX509Auth`, introspection throws `InvalidOperationException: The mTLS introspection endpoint alias was not found in the OpenID configuration`.

**Cause:** When `ClientAuth` is `TlsAuth`/`SpiffeX509Auth`, the introspection endpoint is resolved from the discovery doc's `mtls_endpoint_aliases.introspection_endpoint` (or, when a `trustStore` is set, the matching entry under `mtls_additional_endpoint_aliases`). If that alias is absent, the SDK throws rather than falling back to the plain endpoint.

**Fix:** Ensure the tenant/discovery document exposes mTLS endpoint aliases (mutual-TLS must be enabled for the tenant). Also note: a `TlsAuth` constructed **with** an `X509Certificate2` makes `PostConfigure` build a dedicated `HttpClient` carrying that cert; a `TlsAuth()` **without** one means *you* must attach the client cert to `options.HttpClient`'s handler yourself.

```csharp
options.ClientAuth = new TlsAuth(clientCertificate);   // dedicated HttpClient built for you
```

## 401 with a `WWW-Authenticate` header — reading the RFC 6750 challenge

**Symptom:** A client sees `401` with a `WWW-Authenticate: Bearer error="invalid_token", error_description="…"` header and wants to know where the detail comes from, or wants to suppress the `error_description`.

**Cause:** As of 0.1.3 the handler emits a standards-compliant RFC 6750 bearer challenge on 401. The `error_description` portion is gated by the inherited `IncludeErrorDetails` option, which **defaults to `true`**.

**Fix:** Nothing is wrong — clients may parse `WWW-Authenticate` for the error. To omit `error_description` (e.g. to avoid leaking validation detail to callers), set:

```csharp
options.IncludeErrorDetails = false;
```

## Tokens rejected just outside their validity window (clock skew)

**Symptom:** Freshly issued or near-expiry JWTs intermittently fail with `SecurityTokenExpiredException` / `SecurityTokenNotYetValidException` on one server but not another.

**Cause:** `ClockSkew` is **`null`** by default, which means the framework default of **5 minutes** applies (not zero). Server clock drift beyond that window causes rejections.

**Fix:** First fix clock sync (NTP). To tighten or loosen the allowance explicitly:

```csharp
options.ClockSkew = TimeSpan.FromMinutes(2);
```

Setting `ClockSkew` overrides the validation parameters' `ClockSkew` on the JWT path. Don't set it to `TimeSpan.Zero` in production unless every host is tightly time-synced.

## Multiple schemes share cached claims for the same token

**Symptom:** Two MonoCloud schemes (e.g. different audiences) return each other's cached claims for the same token string when `EnableCaching` is on.

**Cause:** Rare, because the default persisted cache key already includes the scheme name. `CacheKeyGenerator` defaults to `Utils.CacheKeyGenerator` = `CacheKeyPrefix + Base64(SHA256("{SchemeName}|{token}"))`, and `SchemeName` is assigned per scheme in `PostConfigure` — so distinct schemes normally do **not** collide. A collision means a custom `CacheKeyGenerator` dropped the scheme discriminator, or two schemes share `CacheKeyPrefix` *and* a custom generator that ignores the scheme.

**Fix:** Keep the scheme discriminator. If you must customize, give each scheme a distinct `CacheKeyPrefix` and/or retain `SchemeName` in your generator:

```csharp
options.CacheKeyPrefix = "api-a:";
// or a custom generator that still namespaces by scheme:
options.CacheKeyGenerator = (opts, token) => $"{opts.CacheKeyPrefix}{opts.SchemeName}:{Hash(token)}";
```

Note the **in-flight de-dupe** dictionary (which collapses concurrent introspections of the same token) is keyed by **scheme name + token** (as of 0.1.4); it is a concurrency collapse, not a result cache, and concurrent introspections of the same token under different schemes no longer share a result.

## Signing-key rotation causes transient JWT failures

**Symptom:** After the tenant rotates signing keys, valid tokens briefly fail with `SecurityTokenSignatureKeyNotFoundException` until the process restarts or the metadata refresh interval elapses.

**Cause:** Discovery metadata (including JWKS) is fetched by a `ConfigurationManager` with `AutomaticRefreshInterval` / `RefreshInterval` defaults; a new signing key may not be cached yet.

**Fix:** Enable on-demand refresh so an unknown `kid` triggers a re-fetch:

```csharp
options.RefreshOnIssuerKeyNotFound = true;
```

When set, a `SecurityTokenSignatureKeyNotFoundException` calls `ConfigurationManager.RequestRefresh()`. You can also shorten `options.RefreshInterval` / `options.AutomaticRefreshInterval`, or pre-supply metadata via `options.Configuration` / `options.ConfigurationManager` for air-gapped setups.

## Wrong package — `MonoCloud.Management` instead of `MonoCloud.Authentication.Api`

**Symptom:** `AddMonoCloudAuthentication`, `MonoCloudAuthenticationOptions`, or `MonoCloudAuthenticationDefaults` won't resolve; the only MonoCloud types available are `MonoCloudManagementClient`, `Users`, `Clients`, etc.

**Cause:** The project references `MonoCloud.Management` (the server-side admin SDK for the Management API) rather than `MonoCloud.Authentication.Api` (the token-validation handler). They are different packages for different jobs.

**Fix:** Install the authentication package and import its namespaces:

```bash
dotnet add package MonoCloud.Authentication.Api
```

```csharp
using MonoCloud.Authentication.Api;                    // extension, defaults, options, events, handler
using MonoCloud.Authentication.Api.Shared;             // IIntrospectionCache, JwtAssertion
using MonoCloud.Authentication.Api.Shared.ClientAuth;  // IMonoCloudClientAuth + ClientSecretAuth / TlsAuth / …
```

Use `MonoCloud.Management` only to *call* the admin API (create users, list clients); use `MonoCloud.Authentication.Api` to *protect* an API with incoming access tokens. Note the NuGet id is `MonoCloud.Authentication.Api` — `@monocloud/authentication-api` is the internal Changesets tooling name, not a package you install.

## `NETSDK` / target-framework error — package won't restore

**Symptom:** `error NU1202: Package MonoCloud.Authentication.Api 0.1.4 is not compatible with …`, or restore fails on an older project.

**Cause:** The package targets **net8.0, net9.0 and net10.0** (the `net6.0`/`net7.0` targets were dropped in 0.1.3). A project on `net6.0`, `net7.0`, `netstandard2.0`, `netcoreapp3.1`, `net5.0`, or `net framework` cannot consume it.

**Fix:** Target `net8.0` or newer:

```xml
<TargetFramework>net8.0</TargetFramework>
```

The correct `Microsoft.AspNetCore.Authentication.JwtBearer` version is selected per-TFM by the package — you do not add it yourself for the handler to work.

## Older training-data SDK ghosts

**Symptom:** Code references APIs that don't compile: `UseMonoCloudAuthentication()` middleware, `[MonoCloudAuthorize]`, `protectApi(...)`, `AuthenticatedRequest`, `MONOCLOUD_*` env-var configuration, or an `options.ClientSecret` string property.

**Cause:** The agent is pattern-matching against the Node express/fastify SDK or an imagined API. This is a .NET **authentication handler**, not a middleware you write or an env-driven library.

**Fix:** The real surface:

- Register the scheme: `AddAuthentication(MonoCloudAuthenticationDefaults.AuthenticationScheme).AddMonoCloudAuthentication(options => …)`, then `app.UseAuthentication(); app.UseAuthorization();`. There is no `UseMonoCloudAuthentication()` middleware.
- Authorization is **standard ASP.NET Core** — `AddAuthorization`, `AddPolicy`, `RequireClaim`, `[Authorize(Policy = …)]`, `.RequireAuthorization(…)`. There is no `[MonoCloudAuthorize]` attribute and no `protectApi` factory.
- There is **no** `options.ClientSecret` string — client authentication is an `IMonoCloudClientAuth` object assigned to `options.ClientAuth` (e.g. `new ClientSecretAuth("secret")`).
- The SDK reads **no environment variables** of its own. Configure via the `Action<MonoCloudAuthenticationOptions>` or bind `MonoCloudAuthenticationOptions` from `IConfiguration`.
- Read claims with the standard `ClaimsPrincipal` — inject `ClaimsPrincipal user` (minimal APIs) or use `User` / `HttpContext.User` (controllers). There is no `req.claims` / `AuthenticatedRequest`.

## Diagnostic

```bash
node skills/monocloud-auth-aspnetcore/scripts/verify.js /path/to/project
```

The verify script is pure Node (no .NET required) — it parses `*.csproj` for the `MonoCloud.Authentication.Api` `PackageReference` and target framework, scans `Program.cs` for `AddMonoCloudAuthentication` plus `UseAuthentication` / `UseAuthorization` ordering, checks `appsettings*.json` for the options section, and warns if a client secret literal is committed to configuration. See [`api-surface.md`](api-surface.md) for the complete option, client-auth, and event inventory.
