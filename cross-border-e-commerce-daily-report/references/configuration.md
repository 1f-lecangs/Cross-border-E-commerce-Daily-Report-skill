# Configuration Reference

## Contents

- Configuration file
- AI environment variables
- Webhook environment variable
- CLI options
- Security behavior

## Configuration file

Pass a JSON file with `--config`. Supported fields:

| Field | Type | Purpose |
|---|---|---|
| `title` | string | Report title shown in HTML, JSON, and webhook text |
| `timeZone` | string | IANA time zone used for the default report date |
| `maxItems` | integer | Maximum selected items; constrained to 1–50 |
| `maxItemsPerSource` | integer | Maximum final items from one named source; constrained to 1–50 |
| `minAdapterItems` | integer | Minimum final items reserved for matching bundled adapter sources; constrained to 0–50 |
| `lookbackHours` | integer | Exclude older dated items; constrained to 1–720 |
| `includeKeywords` | string[] | Positive relevance terms; matching is case-insensitive |
| `excludeKeywords` | string[] | Terms that always remove an item |
| `sources` | object[] | Public RSS/Atom feeds or bundled allowlisted adapters |
| `ai.enabled` | boolean | Allow optional AI summaries when all AI environment variables exist |
| `ai.maxItems` | integer | Maximum selected items sent for AI summarization |
| `webhookType` | string | `feishu` or `generic-json`; defaults to `generic-json` |

Do not add API keys, webhook URLs, private hostnames, customer names, chat IDs, tokens, cookies, internal paths, or private feed URLs to the configuration.

For RSS/Atom, provide `name`, `url`, optional `weight`, and optional `maxItems`. For a bundled Chinese source, provide `name`, `adapter`, optional `weight`, and optional `maxItems`. Adapter URLs are fixed in code and cannot be overridden.

Supported adapters:

| Adapter | Public source |
|---|---|
| `cifnews-home` | CIFNews public homepage |
| `data10100-news` | 大数跨境 public news page |
| `ikjzd-news` | 雨果网 public news page |

Example:

```json
{
  "name": "雨果网",
  "adapter": "ikjzd-news",
  "weight": 3,
  "maxItems": 12
}
```

Do not add a `url` to an adapter entry. Unknown adapter IDs and URL overrides are rejected.

## AI environment variables

AI summarization is optional and uses an OpenAI-compatible chat completions endpoint.

| Variable | Required | Meaning |
|---|---|---|
| `DAILY_REPORT_AI_BASE_URL` | when AI enabled | Public API base URL ending before `/chat/completions` |
| `DAILY_REPORT_AI_API_KEY` | when AI enabled | API credential; never logged |
| `DAILY_REPORT_AI_MODEL` | when AI enabled | Model identifier |

If any value is missing, the script keeps feed summaries and prints only a non-secret warning.

## Webhook environment variable

`DAILY_REPORT_WEBHOOK_URL` is required only with `--push`. Supply the URL through the process environment. Never save it in the repository.

- `feishu`: sends a plain-text Feishu custom-bot payload.
- `generic-json`: sends `{title, date, text, items}` as JSON.

## CLI options

```text
--config <file>       JSON configuration file
--output-dir <dir>    Generated HTML and JSON directory
--state-dir <dir>     Optional hash-only publication history directory
--date <YYYY-MM-DD>   Override report date
--max-items <n>       Override configured item limit
--fixture <file>      Parse a local RSS/Atom fixture instead of using the network
--ignore-age          Keep old feed entries; useful for fixtures and archives
--no-ai               Disable AI even if configured
--push                Publish summary after local files are generated
--commit-history      Save selected hashes without publishing
--help                Print usage
```

## Security behavior

- Local generation never requires a secret.
- Publishing cannot occur without both `--push` and a runtime webhook URL.
- Private IPs, hostnames resolving to private addresses, localhost, non-HTTP protocols, credentials embedded in URLs, and unsafe redirect targets are rejected.
- Chinese adapters use fixed public endpoints, per-adapter host allowlists, HTTPS-only article links, bounded response sizes, and cross-domain redirect rejection.
- The adapters do not use cookies, authentication, browser sessions, anti-bot bypasses, or user-provided selectors.
- A failed source is skipped without stopping other sources.
- Publication history stores SHA-256 hashes rather than titles or URLs.
- Generated HTML escapes all feed-controlled text.
- Network requests use bounded timeouts and response-size limits.
