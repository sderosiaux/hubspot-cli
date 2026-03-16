# hubspot-cli (fork) — CRM commands for humans and machines

Fork of [HubSpot/hubspot-cli](https://github.com/HubSpot/hubspot-cli) v8.1.0 with full CRM support.

The official CLI targets CMS developers: themes, serverless functions, project deploys. It has no CRM access — no contacts, no deals, no search.

This fork adds 27 CRM commands, all with `--json` output for scripts, agents, and LLMs.

## Commands

### CRUD

```bash
hs crm get contacts 12345                          # one record
hs crm get deals 789 -p "dealname,amount,pipeline" # specific properties
hs crm create contacts -p '{"firstname":"Jane","email":"j@x.com"}'
hs crm update contacts 12345 -p '{"phone":"+1234"}'
hs crm delete contacts 12345
```

### List by type (with filters)

```bash
hs crm contacts -l 50
hs crm contacts --owner 12345 --lifecycle lead
hs crm companies --industry COMPUTER_SOFTWARE --after 2026-01-01
hs crm deals -s won --after 2026-01-01          # stage aliases: won, lost, open
hs crm deals --pipeline 36825126 --before 2026-04-01
hs crm tickets --priority HIGH --stage open
hs crm owners
```

### Search

```bash
hs crm search contacts "acme"
hs crm search deals "enterprise" -p "dealname,amount"
```

### Schema & properties

```bash
hs crm properties contacts             # all contact properties
hs crm properties deals --group dealinformation
hs crm schema                          # object types + property counts
```

### Relationships

```bash
hs crm associations contacts 12345 companies
hs crm engagements contacts 12345      # notes, calls, emails, meetings
```

### Pipelines & lists

```bash
hs crm pipelines
hs crm lists
```

### Bulk operations

```bash
echo '[{"firstname":"A"},{"firstname":"B"}]' | hs crm batch create contacts --stdin
hs crm export contacts -o contacts.json            # full paginated dump
hs crm export deals -f csv -o deals.csv            # CSV export
hs crm export deals -s won --after 2026-01-01 -o won.json
```

### Marketing & automation (requires private app token)

```bash
hs crm forms
hs crm workflows
hs crm workflows --active-only
```

### Insights & analytics

```bash
# Pipeline performance
hs crm analytics                       # win rate, values, avg deal per pipeline

# Data quality
hs crm audit deals                     # field fill rates
hs crm audit deals --meddic            # MEDDIC completeness check
hs crm audit contacts --limit 1000     # sample more records

# Pipeline forecast
hs crm forecast                        # weighted pipeline, closing this Q, at-risk
hs crm forecast --quarter Q2-2026

# Deal velocity
hs crm velocity                        # avg time per stage (from hs_v2_date_entered_*)
hs crm velocity --pipeline 36825126    # filter by pipeline

# Owner performance
hs crm leaderboard                     # ranked by won amount this quarter
hs crm leaderboard --period year       # full fiscal year
hs crm leaderboard --period month      # current month

# Stale records
hs crm stale deals --days 60           # deals not modified in 60+ days
hs crm stale contacts --days 90        # contacts dormant 90+ days

# Churn signals
hs crm churn                           # companies + deals with account_risk set
hs crm churn --days 120                # widen the inactivity window
```

### JSON output

Every command supports `--json`:

```json
{
  "ok": true,
  "command": "crm.contacts",
  "account_id": 8861897,
  "data": ["..."],
  "total": 1523
}
```

Errors use the same envelope:

```json
{
  "ok": false,
  "command": "crm.contacts",
  "account_id": 8861897,
  "data": null,
  "error": { "code": "API_ERROR", "message": "..." }
}
```

## Why

I needed CRM access from the terminal. The official CLI can upload a theme but can't list a contact. Curl + API tokens for every lookup gets old.

This fork uses the same `@hubspot/local-dev-lib` HTTP layer as the official CLI. If `hs account info` works, so does `hs crm contacts`.

The `--json` flag makes the CLI usable by LLM agents. An agent calls `hs crm schema --json` to discover object types, `hs crm search` to find records, `hs crm get` to read details — no HubSpot API knowledge needed. The insight commands (`audit`, `forecast`, `velocity`, `leaderboard`, `churn`, `stale`) give agents analytical capability over CRM data without custom code.

## Install

```bash
git clone https://github.com/sderosiaux/hubspot-cli.git
cd hubspot-cli
npm install
npx tsc
npm pack && npm install -g hubspot-cli-*.tgz
```

## Auth

```bash
hs init        # or hs auth
```

Personal access key with CRM scopes (`crm.objects.contacts.read`, `crm.objects.deals.read`, etc.). Generate one at `https://app.hubspot.com/personal-access-key/<your-account-id>`.

Some endpoints (`/crm/v3/pipelines`, `/marketing/v3/forms`, `/automation/v3/workflows`) require a **private app token** — personal access keys get a 403 on these. The commands handle this gracefully and return a clear error.

## What changed from upstream

**Removed:** MCP server, project commands (`hs project`), doctor command, CMS dev server, serverless runtime, `@hubspot/project-parsing-lib` and 5 other `@hubspot/*` dependencies.

**Added (commands/crm/):**
- `_lib/` — shared output envelope, typed API helpers, pagination, rate-limit retry
- 27 command files:
  - CRUD: get, create, update, delete
  - List: contacts, companies, deals, tickets, owners (all with filters: `--stage`, `--after`, `--before`, `--pipeline`, `--owner`, `--lifecycle`, `--industry`, `--priority`)
  - Search: search
  - Schema: properties, schema
  - Relationships: associations, engagements
  - Pipelines: pipelines, lists
  - Bulk: batch, export (paginated, CSV/JSON, rate-limit retry)
  - Marketing: forms, workflows
  - Insights: analytics, audit, velocity, forecast, leaderboard, churn, stale

**Modified:**
- `bin/cli.ts` — registers `crm`, removes project/doctor/MCP
- `lang/en.ts` — stubs out `project-parsing-lib` import
- `package.json` — cleaned deps, fixed bin paths, react-dom override

## License

Apache 2.0 (same as upstream).
