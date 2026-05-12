<div align="center">
  <a href="https://www.monocloud.com?utm_source=github&utm_medium=agent_skills" target="_blank" rel="noopener noreferrer">
    <picture>
      <img src="https://raw.githubusercontent.com/monocloud/agent-skills/refs/heads/main/banner.svg" alt="MonoCloud Banner">
    </picture>
  </a>
  <div align="right">
    <a href="https://opensource.org/licenses/MIT" target="_blank">
      <img src="https://img.shields.io/:license-MIT-blue.svg?style=flat" alt="License: MIT" />
    </a>
    <a href="https://agentskills.io/specification" target="_blank">
      <img src="https://img.shields.io/:spec-agentskills.io-blue.svg?style=flat" alt="agentskills.io spec" />
    </a>
  </div>
</div>

## Introduction

**MonoCloud Agent Skills — drop-in SDK knowledge for LLM-powered coding agents (Claude Code, Cursor, Codex CLI, Gemini CLI, Google Antigravity, Windsurf, and any other agent that supports [Agent Skills Specification](https://agentskills.io/specification)).**

[MonoCloud](https://www.monocloud.com?utm_source=github&utm_medium=agent_skills) is a modern, developer-friendly Identity & Access Management platform.

When an agent has these skills loaded, asking it to _"add MonoCloud login to my Next.js app"_ or _"list all users in our tenant using the Management API in .NET"_ produces correct, idiomatic code that uses the right MonoCloud package, the right environment variables, and the right patterns — instead of approximations based on stale training data.

### Who is this for?

- **Developers using AI coding assistants** to integrate MonoCloud into their applications.
- **Teams standardizing prompts** around an internal MonoCloud-powered platform.
- **MonoCloud customers** who want the AI to stop hallucinating non-existent SDK methods.

## Documentation

- **MonoCloud Documentation:** [https://www.monocloud.com/docs](https://www.monocloud.com/docs?utm_source=github&utm_medium=agent_skills)

## Skills in this repo

| Skill                                                                                          | Covers                                                                 | SDK                               |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| [`monocloud-quickstart`](plugins/monocloud/skills/monocloud-quickstart/SKILL.md)               | Smart router — detects framework and points to the correct skill below | —                                 |
| [`monocloud-auth-nextjs`](plugins/monocloud/skills/monocloud-auth-nextjs/SKILL.md)             | Sign-in / sessions / route protection / components / hooks for Next.js | `@monocloud/auth-nextjs`          |
| [`monocloud-auth-express`](plugins/monocloud/skills/monocloud-auth-express/SKILL.md)           | JWT / introspection token validation, scope + group enforcement        | `@monocloud/backend-node/express` |
| [`monocloud-auth-fastify`](plugins/monocloud/skills/monocloud-auth-fastify/SKILL.md)           | Same engine as above, via a Fastify `onRequest` hook                   | `@monocloud/backend-node/fastify` |
| [`monocloud-management-js`](plugins/monocloud/skills/monocloud-management-js/SKILL.md)         | Programmatic  API access for Node.js     | `@monocloud/management`           |
| [`monocloud-management-dotnet`](plugins/monocloud/skills/monocloud-management-dotnet/SKILL.md) | Programmatic  API access for C# with .NET DI registration                           | `MonoCloud.Management`            |

## Installing

### Claude Code

From inside a Claude Code session:

```text
/plugin marketplace add monocloud/agent-skills
/plugin install monocloud@monocloud-agent-skills
```

### Cursor

Open Cursor → **Settings → Plugins**, then paste `https://github.com/monocloud/agent-skills` into the **Search or Paste Link** box at the top right and confirm the suggested plugin.

### Everything else (Codex CLI, Gemini CLI, Antigravity, Windsurf, …)

Use the universal [`skills` CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add monocloud/agent-skills
```

Add `--agent <name>` to target a specific agent or `--global` for a user-wide install. See the [skills CLI README](https://github.com/vercel-labs/skills) for the full list of agents and flags.

## 🤝 Contributing & Support

### Issues & Feedback

- **GitHub Issues** for bug reports and feature requests on the skill content.
- For MonoCloud product or tenant questions, contact MonoCloud Support through your dashboard.

### Security

Do **not** report security issues publicly. Please follow the contact instructions at: [https://www.monocloud.com/contact](https://www.monocloud.com/contact?utm_source=github&utm_medium=agent_skills)

## 📄 License

Licensed under the **MIT License**. See the included [`LICENSE`](LICENSE) file.
