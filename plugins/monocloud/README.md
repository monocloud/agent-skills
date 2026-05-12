# MonoCloud — agent plugin

This is the **MonoCloud** plugin: a bundle of [Agent Skills](https://agentskills.io/specification)-compliant skills that teach LLM coding agents how to integrate MonoCloud SDKs correctly.

It ships as a native plugin for both **Claude Code** (via [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json)) and **Cursor** (via [`.cursor-plugin/plugin.json`](.cursor-plugin/plugin.json)). The `skills/` folder underneath is agentskills.io-standard, so it also works in Codex CLI, Gemini CLI, Google Antigravity, and any other tool that respects that spec.

## What's in the plugin

| Skill | What it covers | SDK |
|---|---|---|
| `monocloud-quickstart` | Smart router — detects framework from `package.json` / `*.csproj` and points to the right skill below | — |
| `monocloud-auth-nextjs` | Sign-in / sessions / route protection / components / hooks for Next.js | `@monocloud/auth-nextjs` |
| `monocloud-auth-express` | JWT / introspection token validation, scope + group enforcement | `@monocloud/backend-node/express` |
| `monocloud-auth-fastify` | Same engine as above, via a Fastify `onRequest` hook | `@monocloud/backend-node/fastify` |
| `monocloud-management-js` | Programmatic  API access for Node.js | `@monocloud/management` |
| `monocloud-management-dotnet` | Programmatic  API access for C# with .NET DI registration | `MonoCloud.Management` |

## Installing

### Claude Code

```text
/plugin marketplace add monocloud/agent-skills
/plugin install monocloud@monocloud-agent-skills
```

### Cursor

Open Cursor → **Settings → Plugins**, then paste `https://github.com/monocloud/agent-skills` into the **Search or Paste Link** box at the top right and confirm the suggested plugin.

### Skills Cli

```bash
npx skills add monocloud/agent-skills/plugins/monocloud
```

## License

MIT — see the root [`LICENSE`](../../LICENSE).
