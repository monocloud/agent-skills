# Troubleshooting — `MonoCloud.Authentication.Api`

Each entry is symptom → cause → fix. Every exception and message the SDK produces is listed in the [failure reference](api-surface.md#failure-reference). To find which case you hit, log `context.Exception` in `OnAuthenticationFailed`:

```csharp
options.Events.OnAuthenticationFailed = ctx =>
{
    ctx.HttpContext.RequestServices.GetRequiredService<ILogger<Program>>()
        .LogWarning(ctx.Exception, "MonoCloud authentication failed");
    return Task.CompletedTask;
};
```

## Valid tokens get 401 with a bare `WWW-Authenticate: Bearer`

**Symptom:** The challenge has no `error=` (with `IncludeErrorDetails` on), so authentication produced no failure. Either the token never reached the handler, or authorization ran before authentication.

**Causes and fixes:**

- **Middleware order.** Explicit calls must be `app.UseAuthentication()` then `app.UseAuthorization()`, both after an explicit `app.UseRouting()`. `WebApplication` inserts both automatically if you call neither. `Startup`-style pipelines must call both, between `UseRouting()` and `UseEndpoints()`.
- **The scheme isn't used.** `AddAuthentication()` with no default scheme, or a custom scheme name that `[Authorize]` doesn't reference. Pass `MonoCloudAuthenticationDefaults.AuthenticationScheme` (or your custom name) to `AddAuthentication(…)`, or name it in `[Authorize(AuthenticationSchemes = …)]` / the policy.
- **The token isn't sent as `Authorization: Bearer <token>`.** If it comes from elsewhere (a cookie, a query string), set `context.Token` in `OnMessageReceived`.

## JWT rejected with 401 `invalid_token`

The `error_description` in `WWW-Authenticate` (while `IncludeErrorDetails` is on) names the failed check:

| `error_description` | Fix |
| --- | --- |
| `The audience '…' is invalid` | `Audience` must equal the token's `aud` exactly, including scheme and trailing slash. A `TokenValidationParameters.ValidAudience` you set yourself takes precedence over `Audience`. |
| `The issuer '…' is invalid` | `Authority` must be the tenant root whose discovery `issuer` equals the token's `iss`. Don't use the discovery URL or add a path. |
| `The token expired at '…'` / `The token is not valid before '…'` | Fix the host clock; `ClockSkew` (default 5 min) is the tolerance. |
| `The signature key was not found` | The token is from another tenant, or keys rotated. `RefreshOnIssuerKeyNotFound` (default `true`) already refetches metadata, so check `Authority`. |
| none | Another validation failure, or discovery/JWKS unreachable. Check the logged exception. |

## Opaque tokens fail with 500 (JWTs work)

**Cause:** an exception on the introspection path propagates.

| Exception | Fix |
| --- | --- |
| `ArgumentNullException: Client ID must be set` / `Authority must be set` | Set `ClientId` / `Authority`. These are checked before `OnAuthenticationFailed` runs. |
| `ArgumentNullException` (parameter `ClientAuth`) | Set `options.ClientAuth`. See [client authentication](../SKILL.md#client-authentication). |
| `HttpRequestException` | Discovery or the introspection endpoint is unreachable or returned non-2xx. Common causes are rejected client credentials, or a client-auth method the client isn't configured for (e.g. post vs `clientSecretBasic: true`). |
| `JsonException` | The endpoint returned something other than JSON, e.g. a proxy error page. |
| `InvalidOperationException: The mTLS introspection endpoint alias was not found …` | See [mTLS introspection alias](#mtls-introspection-alias-not-found). |
| `InvalidOperationException: The SPIFFE JWT-SVID must not be null or empty` | Your `SpiffeJwtAuth` provider returned nothing. |

An API that only receives JWTs (with `IntrospectJwtTokens` off) can't hit any of these. To report one of these failures as a 401 instead (all but the `ClientId` / `Authority` checks), set a result in the event:

```csharp
options.Events.OnAuthenticationFailed = ctx =>
{
    if (ctx.Exception is not null) ctx.Fail(ctx.Exception); // 401 instead of a propagated exception
    return Task.CompletedTask;
};
```

## 401 `Token inactive`

Introspection returned `active: false`, e.g. the token expired or was revoked. With `EnableCaching`, that verdict is reused until the entry expires; evict it with `DeleteAsync` (see [caching](../SKILL.md#caching-introspection-results)).

## 401 on certificate-bound tokens

The cause is in `context.Exception.Message` ([check order](api-surface.md#certificatebindingvalidation)):

| Message | Fix |
| --- | --- |
| `Client certificate is not present` | Make Kestrel request client certificates (`ClientCertificateMode`). Behind a TLS-terminating proxy, forward the certificate and read it in `CertificateRetriever`. |
| `Client certificate is malformed` | Your `CertificateRetriever` threw (see `InnerException`), e.g. while decoding a URL-encoded PEM header. |
| `Access token does not contain a 'cnf' …` | `Required` mode received an unbound token. Use `WhenPresent` if unbound tokens are acceptable. |
| `Malformed 'cnf' claim …` / `The 'cnf' claim could not be parsed` / `… does not contain an 'x5t#S256' member …` | The token's `cnf` isn't an RFC 8705 certificate confirmation. |
| `The certificate hash in the access token does not match …` | The caller (or your proxy) presented a different certificate than the one the token is bound to. |

`CertificateBindingValidation.DangerouslyIgnore` disables the check. Use it only when binding is enforced elsewhere.

## mTLS introspection alias not found

**Symptom:** `InvalidOperationException: The mTLS introspection endpoint alias was not found in the OpenID configuration …` with `TlsAuth` / `SpiffeX509Auth`.

**Cause:** these methods introspect at the discovery document's `mtls_endpoint_aliases.introspection_endpoint`, or with `trustStore` at that store's entry under `mtls_additional_endpoint_aliases`. The alias is missing.

**Fix:** enable mutual TLS for the tenant, or check the trust-store id. Also make sure a certificate is actually presented, by passing it to `TlsAuth` / `SpiffeX509Auth` or configuring it on the named client `MonoCloudAuthenticationDefaults.HttpClientName`. Without one, the endpoint rejects the call (`HttpRequestException`).

## `IIntrospectionCache not found in the services collection` / scoped-service error

`EnableCaching = true` needs an `IIntrospectionCache` registered as a **singleton**: `builder.Services.AddSingleton<IIntrospectionCache, MyCache>()`.

- With nothing registered, the first request through the scheme fails with this `ArgumentException`.
- A scoped registration fails DI scope validation (`Cannot consume scoped service …`), at `builder.Build()` in Development.

## `ValidateCertificateBinding` won't compile, or "must be a defined CertificateBindingValidation value"

`ValidateCertificateBinding` is a `CertificateBindingValidation` enum. Assigning a lambda gives `CS1660: Cannot convert lambda expression to type 'CertificateBindingValidation'`, so use `WhenPresent`, `Required` or `DangerouslyIgnore`. The `ArgumentException` means an undefined value, e.g. a number bound from configuration. Use the value names instead.

## Scope policy returns 403

403 means the caller is authenticated but the policy failed.

- **Wrong claim type.** MonoCloud scopes are `scope` claims, one per value. A policy on `scp` or `http://schemas.microsoft.com/identity/claims/scope` never matches. Use `RequireClaim("scope", "<value>")`.
- **The token lacks the scope.** Check what was requested, and the API's default scopes in the MonoCloud dashboard.

## Group or role policy returns 403

- **`RoleClaimType` isn't `"groups"`.** `{ "id", "name" }` group objects stay as raw JSON strings, and `[Authorize(Roles = …)]` / `IsInRole` look at a different claim type.
- **Set on the wrong object.** Set it on the MonoCloud options, not on `TokenValidationParameters`, because the introspection path reads only the options.

Policies can match the group id or the name.

## `User.FindFirst("sub")` or `User.Identity.Name` is null

- **`MapInboundClaims` (default `true`) renames claims on the JWT path.** `sub` becomes `ClaimTypes.NameIdentifier`, `email` becomes `ClaimTypes.Email`. Set `options.MapInboundClaims = false` or read the mapped types. Introspected claims are never renamed, so behavior differs between paths until mapping is off.
- **`Identity.Name` reads `NameClaimType`.** Point it at a claim the token carries (e.g. `"sub"` with mapping off). See [claims shaping](api-surface.md#claims-shaping).

## `The MetadataAddress or Authority must use HTTPS unless disabled for development …`

An `http://` `Authority` requires `RequireHttpsMetadata = false`. Use that only for local development.

## A revoked token is still accepted

- **JWT path.** It validates locally and can't see revocation. Set `IntrospectJwtTokens = true` (one introspection call per request, or per cache TTL with caching).
- **Cached introspection.** The entry lives until its TTL. Lower `CacheDuration`, or call `DeleteAsync` with the key from `CacheKeyGenerator` ([eviction](api-surface.md#iintrospectioncache)).

## Two schemes share cache entries

The default key includes the scheme name. A custom `CacheKeyGenerator` can't read it (the scheme name is internal), so give each scheme a distinct `CacheKeyPrefix`.

## `InvalidOperationException: Scheme already exists`

The same scheme name was registered twice, e.g. `AddMonoCloudAuthentication()` plus `AddMonoCloudAuthentication(o => …)`. Make it one call, or use distinct names for multiple schemes.

## Build and restore errors

| Error | Fix |
| --- | --- |
| `NU1202` (package not compatible with the target framework) | The package targets `net8.0`, `net9.0` and `net10.0`, so target `net8.0` or later. |
| `AddMonoCloudAuthentication` / `MonoCloudAuthenticationOptions` not found | Add `using MonoCloud.Authentication.Api;` and the `MonoCloud.Authentication.Api` package. `MonoCloud.Management` is a different SDK. |
| `CS1061` / `CS0117` on `TenantDomain`, `ClientSecret` or `JwtTokenValidationParameters` | These members don't exist. Use `Authority`, `ClientAuth = new ClientSecretAuth(…)` and `TokenValidationParameters`. |
| `UseMonoCloudAuthentication`, `AddMonoCloud`, `[MonoCloudAuthorize]`, `protectApi` not found | They don't exist. Use `AddMonoCloudAuthentication` with `UseAuthentication()` / `UseAuthorization()` and standard `[Authorize]` policies. |
| `CS0122` on `SchemeName` or `PostConfigureMonoCloudAuthenticationTimeProvider` | Both are internal. |

## Diagnostic script

From this skill's directory, run `node scripts/verify.js [project-dir]` ([source](../scripts/verify.js)). It is pure Node and needs no .NET SDK. It checks:

- the package reference and target framework;
- `AddMonoCloudAuthentication` and middleware order;
- `Authority` / `Audience`;
- `ClientId` / `ClientAuth` pairing and committed secrets;
- the cache lifetime;
- the group / role setup;
- the `ValidateCertificateBinding` type;
- options that don't exist.
