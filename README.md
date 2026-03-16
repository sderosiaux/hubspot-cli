# hubspot-cli (fork) — CRM commands for humans and machines

Fork of [HubSpot/hubspot-cli](https://github.com/HubSpot/hubspot-cli) v8.1.0 that adds full CRM support.

The official HubSpot CLI is built for CMS developers: uploading themes, managing serverless functions, deploying projects. It has zero access to CRM data. No contacts, no deals, no companies, no search — nothing.

This fork fixes that. 17 CRM commands, all with `--json` output for piping into scripts, agents, or LLMs.

## What's new

```bash
hs crm get contacts 12345                          # read one record
hs crm get deals 789 -p "dealname,amount,pipeline" # with specific properties
hs crm create contacts -p '{"firstname":"Jane","email":"j@x.com"}'
hs crm update contacts 12345 -p '{"phone":"+1234"}'
hs crm delete contacts 12345

hs crm contacts -l 50                  # list contacts
hs crm companies                       # list companies
hs crm deals                           # list deals
hs crm tickets                         # list tickets
hs crm owners                          # list owners (users)

hs crm search contacts "acme"          # full-text search any object type
hs crm search deals "enterprise" -p "dealname,amount"

hs crm properties contacts             # list all 682 contact properties
hs crm properties deals --group dealinformation
hs crm schema                          # all object types + property counts

hs crm associations contacts 12345 companies  # what's linked to what
hs crm engagements contacts 12345             # notes, calls, emails, meetings

hs crm pipelines                       # deal/ticket pipelines
hs crm lists                           # contact lists

echo '[{"firstname":"A"},{"firstname":"B"}]' | hs crm batch create contacts --stdin
```

Every command supports `--json` for structured output:

```json
{
  "ok": true,
  "command": "crm.contacts",
  "account_id": 8861897,
  "data": ["..."],
  "total": 1523,
  "next_cursor": "abc123"
}
```

Errors follow the same envelope:

```json
{
  "ok": false,
  "command": "crm.contacts",
  "account_id": 8861897,
  "data": null,
  "error": { "code": "API_ERROR", "message": "..." }
}
```

## Why this exists

I needed to query HubSpot CRM from the terminal. The official CLI can upload a theme but can't list a contact. The REST API works, but managing auth tokens and curl commands for every lookup gets old fast.

This fork wraps the same `@hubspot/local-dev-lib` HTTP layer the official CLI uses, so auth (personal access key or OAuth) works identically. If `hs account info` works, so does `hs crm contacts`.

The `--json` flag on every command makes the CLI usable by LLM agents and scripts. An agent can call `hs crm schema --json` to discover available object types and properties, then `hs crm search` to find records, then `hs crm get` to read details — without knowing the HubSpot API.

## Install

```bash
git clone https://github.com/sderosiaux/hubspot-cli.git
cd hubspot-cli
npm install --legacy-peer-deps
npx tsc
npm link
```

## Auth

Same as the official CLI:

```bash
hs init        # or hs auth
```

You need a personal access key with CRM scopes (`crm.objects.contacts.read`, `crm.objects.deals.read`, etc.). Generate one at `https://app.hubspot.com/personal-access-key/<your-account-id>`.

## What changed from upstream

**New files (commands/crm/):**
- `_lib/` — shared output envelope, Zod 4 runtime validation, typed API helpers, pagination
- 17 command files: get, create, update, delete, contacts, companies, deals, tickets, owners, search, properties, schema, associations, engagements, pipelines, lists, batch

**Modified files:**
- `bin/cli.ts` — registers the `crm` parent command
- `lang/en.ts` — i18n strings for CRM commands
- `.eslintrc.cjs` — strict type-checked linting for `commands/crm/**`

**Fixed upstream bugs:**
- `commands/__tests__/auth.test.ts` — missing `mockYargs` declaration
- `commands/__tests__/open.test.ts` — missing `mockYargs` declaration
- `commands/secret/__tests__/addSecret.test.ts` — untyped `globalThis` access

Everything else is untouched. The original CMS, project, HubDB, and config commands work as before.

## Code quality

- TypeScript strict mode, zero errors across the whole project
- ESLint with `@typescript-eslint/recommended-requiring-type-checking` on CRM files, zero warnings
- Zod 4 runtime validation on API responses
- Stdout flush before exit (no truncated JSON on large outputs)
- `--stdin` support on create/update/batch for LLM piping

## License

Same as upstream — Apache 2.0.
