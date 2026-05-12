# MonoCloud concepts (quick map)

This is a one-page mental model. The framework skills assume you have this context.

## Tenant URL

Every MonoCloud account has a tenant URL like `https://<slug>.<region>.monocloud.com` (e.g. `https://acme.us.monocloud.com`). It is:

- The OIDC **issuer** (for `auth-nextjs` and `backend-node`).
- The **base URL** for the Management API (`https://<tenant>/api/`). Both the JS and .NET Management SDKs append `/api/` themselves — pass the bare tenant URL.

Most SDKs accept it under different names:

| SDK                                           | Env var / config key                         |
| --------------------------------------------- | -------------------------------------------- |
| `@monocloud/auth-nextjs`                      | `MONOCLOUD_AUTH_TENANT_DOMAIN`               |
| `@monocloud/backend-node` (express + fastify) | `MONOCLOUD_BACKEND_TENANT_DOMAIN`            |
| `@monocloud/management`                       | `MONOCLOUD_MANAGEMENT_DOMAIN` or `init({ domain })` |
| `MonoCloud.Management` (.NET)                 | `MonoCloud:Management:Domain` (appsettings)  |

## OIDC vs Management

Two different surfaces; do not mix.

- **OIDC** — user-facing auth: sign-in, sign-up, sessions, tokens. Confidential clients (client id + secret) are configured per app in the MonoCloud dashboard. Used by `auth-nextjs` and `backend-node`.
- **Management** — programmatic admin: list/create/update users, clients, groups, resources, etc. Authenticated by a **Management API key** generated in the dashboard. Used by `@monocloud/management` (JS) and `MonoCloud.Management` (.NET).

A Management API key has **full tenant admin scope** — treat it like a root credential. It must never be shipped to a browser. Load from `process.env` / `IConfiguration` only.

## Tokens

- **JWT access tokens** — validated locally via JWKS. Default for `backend-node`.
- **Opaque (reference) tokens** — must be introspected. `backend-node` does this automatically when it sees a non-JWT format, provided `MONOCLOUD_BACKEND_CLIENT_ID/SECRET` are set.
- **ID tokens** — only consumed by `auth-nextjs`; never sent to APIs.

## Client types

| Client type        | Has a secret? | Used by                                                         |
| ------------------ | ------------- | --------------------------------------------------------------- |
| Regular web app    | yes           | `@monocloud/auth-nextjs`                                        |
| SPA                | no            | (not covered yet — vanilla SPA skill not authored)              |
| Native             | no            | (not covered yet)                                               |
| Machine-to-machine | yes           | `@monocloud/backend-node` introspection, server-to-server flows |
| Management API key | (just a key)  | `@monocloud/management`, `MonoCloud.Management`                 |

## Audiences and resources

For `backend-node`, `MONOCLOUD_BACKEND_AUDIENCE` must match the `aud` claim the access token was minted with — typically your API's URL (e.g. `https://api.example.com`). Mismatch causes 401s with `invalid_audience`. Configure the audience on the API resource in the MonoCloud dashboard.
