---
name: cross-border-e-commerce-daily-report
description: Collect public RSS/Atom feeds and allowlisted Chinese industry pages about marketplace policies, cross-border logistics, overseas warehousing, customs, tariffs, and market trends; filter and rank relevant stories; optionally summarize them through an OpenAI-compatible API; and generate local HTML and JSON daily briefs for cross-border e-commerce sellers. Use when Codex needs to create, refresh, review, automate, or safely publish a bilingual seller-focused daily industry report without embedding credentials or private workspace data.
---

# Cross-border E-commerce Daily Report

Generate locally first. Publish only after the user explicitly asks to send the report to an external destination.

## Workflow

1. Read `references/configuration.md` when configuring RSS sources, fixed Chinese adapters, AI, filtering, or webhooks.
2. Use `references/sources.example.json` as a public, non-secret starting configuration. Copy it outside the skill before customizing it for a task.
3. Run the bundled script from the desired output workspace:

   ```bash
   node <skill-directory>/scripts/push_daily_report.mjs \
     --config <skill-directory>/references/sources.example.json \
     --output-dir ./daily-report-output
   ```

4. Inspect both generated files. Check titles, summaries, links, dates, source diversity, and exclusions.
5. Revise the configuration and regenerate if necessary.
6. Use `--push` only when the user has approved the destination and final content. A push requires `DAILY_REPORT_WEBHOOK_URL` in the process environment.

## Safety Rules

- Never read, print, copy, commit, or return secret values.
- Never put API keys or webhook URLs in JSON, Markdown, source code, command arguments, logs, or generated reports.
- Keep secrets in process environment variables or an external secret manager.
- Treat local generation as the default. Do not infer permission to publish from a request to generate, preview, test, or validate.
- Use public HTTP(S) feed URLs only. The script rejects localhost and literal private-network addresses.
- Use only bundled adapter IDs for Chinese industry pages. Do not add cookies, login flows, anti-bot bypasses, or user-defined scraping selectors.
- Treat an unavailable or structurally changed source as a skipped source; never weaken host allowlists to make it pass.
- Do not package source caches, report history, generated reports, databases, user data, or original workspace configuration with the skill.
- If AI configuration is absent, continue with feed-provided summaries instead of failing or requesting a secret in chat.

## Common Commands

Generate without AI or publication:

```bash
node <skill-directory>/scripts/push_daily_report.mjs \
  --config <config.json> \
  --output-dir <output-directory> \
  --no-ai
```

Generate from a local RSS fixture for deterministic validation:

```bash
node <skill-directory>/scripts/push_daily_report.mjs \
  --config <config.json> \
  --fixture <feed.xml> \
  --ignore-age \
  --output-dir <output-directory>
```

Publish an already reviewed run:

```bash
DAILY_REPORT_WEBHOOK_URL="<provided securely by the runtime>" \
node <skill-directory>/scripts/push_daily_report.mjs \
  --config <config.json> \
  --output-dir <output-directory> \
  --push
```

## Outputs

- `daily-report_YYYY-MM-DD.html`: readable report with escaped content and source links.
- `daily-report_YYYY-MM-DD.json`: structured report for downstream automation.
- Optional state contains only date and SHA-256 item hashes; it does not store titles, article text, credentials, or webhook URLs.
