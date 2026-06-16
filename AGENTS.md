# AGENTS.md

Guidance for AI coding agents working **on** this repository. This repo is itself a bundle of [Agent Skills](https://agentskills.io/specification) — so the job here is authoring and maintaining skill content, not shipping an application.

## What this repo is

A marketplace plugin (`monocloud`) of agentskills.io-compliant skills that teach LLM coding agents how to integrate MonoCloud SDKs correctly. The same `skills/` folder is consumed by Claude Code, Cursor, Codex CLI, Gemini CLI, Antigravity, Windsurf, and any other spec-compliant tool — there is no build step and no runtime; the deliverable is the Markdown and the small helper scripts.

## Layout

```
.claude-plugin/marketplace.json     Claude Code marketplace manifest (lists the plugin)
.cursor-plugin/marketplace.json     Cursor marketplace manifest (lists the plugin)
README.md                           Root readme + skills table
plugins/monocloud/
  .claude-plugin/plugin.json        Plugin manifest (name, version, keywords)
  README.md                         Plugin readme + skills table
  skills/<skill-name>/
    SKILL.md                        Required. Frontmatter + the skill body.
    references/*.md                 Optional. Deep-dive docs loaded on demand (api-surface, troubleshooting, …).
    scripts/*.js                    Optional. Pure-Node, zero-dependency helpers (verify.js, detect.js).
```

Every skill directory name **must** equal the `name:` in its `SKILL.md` frontmatter.

## Authoring conventions

A `SKILL.md` opens with YAML frontmatter — exactly these keys:

```yaml
---
name: monocloud-auth-nextjs          # kebab-case, matches the directory name
description: Use when …              # see below
license: MIT
---
```

**The `description` is the single most important line** — it's what the host agent reads to decide whether to load the skill. Write it third-person and trigger-rich: start with "Use when …", then pack in the concrete symbols, package names, env vars, function names, and error strings a user might mention (e.g. `` `authMiddleware()` ``, `` `MONOCLOUD_AUTH_*` ``, `login_required`). Match the density of the existing skills' descriptions — they are the reference standard.

Body conventions, drawn from the existing skills:

- **Lead with package identity.** State the exact package to use and call out similarly-named wrong packages / stale-training-data symbols so the agent doesn't hallucinate them. Tell it to check `package.json` / `*.csproj` before suggesting code.
- **Keep `SKILL.md` actionable; push depth into `references/`.** Common reference files are `api-surface.md` (the full export/method surface) and `troubleshooting.md`. Link to them rather than inlining everything.
- **Prefer tables** for env vars, subpath exports, and method surfaces — that's the house style.
- **Ground every API claim in the real SDK.** Do not invent methods or exports. Verify symbol names, signatures, and env var names against the actual SDK source or the official docs at <https://www.monocloud.com/docs> before writing them down.
- **Scripts stay pure Node, no dependencies, cross-platform.** `verify.js` diagnoses an integration in a target project; `detect.js` (quickstart only) routes to the right skill. Keep them `node scripts/foo.js [project-dir]` invocable with no install step.

## When you add, rename, or remove a skill

Keep these in sync — they are not auto-generated:

1. The skill table in **`README.md`** (root).
2. The skill table in **`plugins/monocloud/README.md`**.
3. Cross-references inside **`monocloud-quickstart`** (`SKILL.md` routing table and `scripts/detect.js`) if the change affects framework detection.
4. `keywords` / `description` in **`plugins/monocloud/.claude-plugin/plugin.json`** and both `marketplace.json` files if the plugin's scope changed.

Bump `version` in `plugin.json` and both marketplace manifests together when releasing.

## Validation

There is no test suite. Before committing changes to a skill:

- Run its script against a sample project, e.g. `node plugins/monocloud/skills/<skill>/scripts/verify.js /path/to/app`, and `node plugins/monocloud/skills/monocloud-quickstart/scripts/detect.js /path/to/app`.
- Confirm `SKILL.md` frontmatter parses (valid YAML, `name` matches the directory).
- Sanity-check relative links to `references/` and `scripts/` resolve.

## Conventions

- Markdown only for skill content; no HTML beyond the banner block already in `README.md`.
- All files are MIT-licensed (`license: MIT` in frontmatter, root `LICENSE`).
- Commit only when asked. This repo's default branch is `main`.
- Do **not** report security issues in skill content publicly — follow <https://www.monocloud.com/contact>.
