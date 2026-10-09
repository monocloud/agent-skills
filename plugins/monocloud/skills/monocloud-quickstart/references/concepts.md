# MonoCloud concepts (quick map)

One-page mental model the framework skills assume.

## Tenant URL

Every tenant has a URL like `https://<slug>.<region>.monocloud.com` (e.g. `https://acme.us.monocloud.com`). It is the OIDC **issuer** for every auth SDK and the base of the Management API — both Management SDKs append `/api/` themselves, so always pass the bare URL.

| SDK | Where the tenant URL goes |
| --- | --- |
| `@monocloud/auth-nextjs` | `MONOCLOUD_AUTH_TENANT_DOMAIN` (or the `tenantDomain` option) |
| `@monocloud/auth-web-js` | `tenantDomain` constructor option |
| `@monocloud/auth-react` | `tenantDomain` prop on `<MonoCloudAuthProvider>` |
| `@monocloud/backend-node` (root, `/express`, `/fastify`) | `MONOCLOUD_BACKEND_TENANT_DOMAIN` (or the `tenantDomain` option) |
| `MonoCloud.Authentication.Api` (ASP.NET Core) | `options.Authority` inside `AddMonoCloudAuthentication(options => …)` |
| `@monocloud/management` | `MONOCLOUD_MANAGEMENT_DOMAIN` (or `init({ domain })`) |
| `MonoCloud.Management` (.NET) | `MonoCloud:Management:Domain` configuration key |

## OIDC vs Management

Two separate surfaces — don't mix them.

- **OIDC** — user-facing auth: sign-in, sessions, tokens, and access-token validation on APIs. Each app or API is registered in the MonoCloud dashboard. Used by `@monocloud/auth-nextjs`, `@monocloud/auth-web-js`, `@monocloud/auth-react`, `@monocloud/backend-node`, and `MonoCloud.Authentication.Api`.
- **Management** — programmatic tenant admin (users, applications, groups, API resources, …), authenticated by a **Management API key** sent as `X-API-KEY`. Used by `@monocloud/management` and `MonoCloud.Management`. The key has full tenant-admin scope: keep it server-side, load it from `process.env` / `IConfiguration`, never ship it to a browser.

## Tokens

- **ID tokens** — consumed by the sign-in SDKs (`auth-nextjs`, `auth-web-js`, `auth-react`) to build the user session. Never send them to APIs.
- **JWT access tokens** — APIs validate them locally against the tenant's JWKS (`backend-node`, `MonoCloud.Authentication.Api`).
- **Opaque (reference) access tokens** — must be introspected (RFC 7662) with the API's client credentials. Both API SDKs introspect any token that isn't a JWT, and every token when JWT introspection is switched on (`introspectJwtTokens` / `IntrospectJwtTokens`). Without credentials `backend-node` throws `Token introspection is not configured`.

## Client types

| Client type | Secret? | Used by |
| --- | --- | --- |
| Web application (server-side) | yes | `@monocloud/auth-nextjs` |
| Single-page application | usually no (public client + PKCE) | `@monocloud/auth-web-js`, `@monocloud/auth-react` |
| Native / CLI / device | no | No dedicated skill — `@monocloud/auth-core`'s `MonoCloudOidcClient` (e.g. `deviceAuthorizationRequest()` / `deviceAuthorizationGrant()`) |
| API credentials (introspection) | yes | `@monocloud/backend-node`, `MonoCloud.Authentication.Api` |
| Management API key | key only | `@monocloud/management`, `MonoCloud.Management` |

## Audiences

An API validates the token's `aud` claim against its configured audience — `MONOCLOUD_BACKEND_AUDIENCE` (`backend-node`) or `options.Audience` (`MonoCloud.Authentication.Api`) — typically the API's URL (e.g. `https://api.example.com`), set on the API resource in the dashboard. A mismatch is a 401 `invalid_token` (`backend-node`'s underlying error: `Invalid audience claim`).
