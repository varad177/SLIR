# Architecture

## 1. Request flow

```
Browser ──► Nginx :80 ──/api/*──► Express :4101 ──► SQLite
              │                        │
              └── static React build   └──► Ollama :11434
                                            or configured cloud endpoint

AI client ──► Express :4101 /v1/chat/completions ──► Ollama / cloud
           │           /v1/messages (Anthropic SDKs)
           │
           └──► SQLite usage_events
```

There is **no separate proxy process**. The Express backend is both the
OpenAI-compatible gateway and the telemetry writer.

- `frontend/` is compiled by Vite and served by Nginx. Nginx proxies `/api/` and `/v1/` to
  `backend:4101`; the gateway endpoints `/v1/` can also be called directly on the
  backend port 4101.
- `backend/` exposes the dashboard API under `/api/*` and the gateway under
  `/v1/*` (OpenAI Chat Completions and native Anthropic Messages).
- `backend/data` (the `ai_monitor_sqlite_data` volume in Compose) holds the
  SQLite database and pre-migration backups.

## 2. Gateway behaviour

`POST /v1/chat/completions` (OpenAI shape) and `POST /v1/messages` (native
Anthropic shape) share one pipeline. The Anthropic route first maps `x-api-key`
to a bearer token, converts the Messages request into the internal OpenAI shape
(`anthropicIngress.js`), and records the client's requested model name. The
shared handler then runs steps 1-7 unchanged; responses are converted back to
the Anthropic shape only when the route requested it (`anthropicEgress.js`):

1. Reads an optional `Authorization: Bearer mp_live_...` application key
   (`x-api-key` is accepted on `/v1/messages`).
   - A valid key attributes the request to an application.
   - An unknown `mp_live_` key returns `401`.
   - Requests without an application key are proxied but not recorded.
2. Resolves the primary target model:
   - explicit `model` value, or
   - the application's `default_model`, or
   - the global `active_model` setting for `active-model` / missing model.
3. If the application has failover enabled, builds `[primary, ...fallbackModels]`.
   Fallback chains are per application, capped at five models, and apply to
   explicit model requests too. A primary request blocked by a hard budget
   stops immediately; a fallback candidate blocked by budget is skipped
   and recorded in the trace.
4. Executes each candidate in order. The next candidate is tried when the
   current one returns HTTP 429 or 5xx, times out, or cannot be reached.
   Non-retryable 4xx responses stop immediately. Streaming failover is only
   possible before the first response chunk is sent.
5. If the model matches a row in `custom_models`, converts the request to that
   model's `format` (`openai` → `<api_base>/chat/completions`, `anthropic` →
   `<api_base>/v1/messages`) and forwards it with the stored provider key.
   Responses, streaming SSE events, token usage, tool calls, vision content,
   JSON structured output, and provider errors are converted back to OpenAI
   shapes before they reach the client. Native `/v1/messages` requests are then
   converted once more into Anthropic `message` objects or the
   `message_start` → `content_block_*` → `message_delta` → `message_stop` SSE
   sequence; telemetry is still captured from the OpenAI-shaped bytes.
6. Otherwise forwards to Ollama. Non-streaming calls prefer Ollama's native
   `/api/chat` so prompt-cache and eval timings can be recorded; streaming and
   fallback calls use `/v1/chat/completions`.
7. Records one `usage_events` row per attributed client request, with call type
   `chat.completion` or `anthropic.messages`:
   - success: token counts, latency, timings, cache status
   - failure: status `failure`, `error_type`, `error_message`, null tokens
   - failover: `failover_used`, `failover_from_model`, `failover_reason`,
     `failover_attempts`, and a JSON `failover_trace` of each attempt
8. OpenAI-format streaming requests add `stream_options.include_usage = true`
   so the final SSE chunk carries usage. Anthropic streaming usage is read from
   `message_start` / `message_delta` and emitted in the converted final chunk.

Prompts and responses are never persisted. Only operational metadata is stored.

## 3. Database

SQLite in WAL mode with `synchronous = NORMAL`, `foreign_keys = ON`, and a
5-second busy timeout.

Core tables:

- `applications` — id, name, description, `api_key`, `default_model`,
  `failover_enabled`, `fallback_models` (ordered JSON array)
- `usage_events` — one row per attributed request, unique `request_id`, plus
  failover source/reason/attempt/trace fields
- `model_pricing` — versioned input/output cost per million tokens
- `custom_models` — cloud endpoints, their keys, and their upstream API `format`
  (`openai` or `anthropic`)
- `budgets` — daily/monthly limits on cost, tokens or requests, scoped globally,
  per application or per model, with `notify` or `block` actions
- `budget_alerts` — threshold notifications, deduplicated per budget period
- `settings` — `active_model`, setup flags, alert webhook configuration
- `schema_migrations` — applied schema versions

Schema version 3 adds the budget tables and indexes over alert history. Version
4 adds per-application failover settings and request-level failover telemetry.
Version 5 adds `custom_models.format` (for example `openai` vs `anthropic`).
Pricing falls back to `custom_models` input/output per-million rates when no
`model_pricing` rule matches, and proxied `/v1/*` gateway responses emit
`X-SLIR-Telemetry: recorded | skipped`.

Key indexes cover timestamp, model, provider, status, and application queries.

### Migrations and backups

`initSchema()` is idempotent:

1. Creates the base schema with `CREATE TABLE IF NOT EXISTS`.
2. If the database already existed and its recorded version is older than the
   target, creates a consistent `VACUUM INTO` backup under
   `<database-dir>/backups/` before changing anything.
3. Adds missing columns only after checking `PRAGMA table_info`.
4. Records the new version in `schema_migrations`.

A migration error aborts startup. The previous five backups are retained.

## 4. Cost calculation

`calculateEventCost()` runs for every event:

1. A provider-confirmed cost is stored as `confirmed_by_provider`.
2. Missing token counts are never treated as zero. Failures get `0.0` /
   `estimated`; successful events with unknown usage get `NULL` / `unknown`.
3. Otherwise the newest active pricing rule matching provider and model pattern
   is used:

   ```
   cost = (prompt_tokens / 1_000_000) * input_cost_per_million
        + (completion_tokens / 1_000_000) * output_cost_per_million
   ```

   The result is stored as `estimated`. No match means `NULL` / `unknown`.

### Budgets and alerts

`evaluateBudgets()` runs every 30 seconds (and on demand from the API):

- Usage is summed over the current UTC day or month, filtered by the budget's
  application or model scope.
- The warning threshold defaults to 80% of the limit; the exceeded threshold is
  100%. Alerts are written to `budget_alerts` with a unique
  `(budget_id, period_key, threshold)` key, so each threshold fires once per
  period.
- Alerts are always available in-app and are POSTed to the configured webhook
  when `alerts_webhook_enabled` is true. Payloads include both `text` and
  `content`, which makes them compatible with Slack and Discord webhooks.
  Delivery failures are recorded but never block budgeting.
- `getBlockingBudget()` runs in the gateway after application attribution. Any
  exceeded budget with `action = 'block'` returns HTTP 429 with
  `type: "budget_exceeded"` before an upstream provider is contacted. Results
  are cached for 10 seconds and invalidated on budget changes.

### Observability fields

`/api/analytics/summary` includes nearest-rank latency percentiles (p50, p95,
p99), TTFT percentiles, prompt-cache hit rate, and a burn-rate / 30-day cost
projection. `/api/analytics/timeseries` and `/api/analytics/models` expose
per-bucket and per-model cache statistics plus per-model p95 latency.

## 5. Retention

`RETENTION_DAYS` controls event pruning:

- `0` (default): keep everything.
- Positive value: delete `usage_events.timestamp` older than the cutoff at
  startup, then once per day.

Backups are independent of retention and are pruned separately (five most
recent kept).

## 6. Container layout

- `Dockerfile` (root): unified multi-stage image building the frontend Vite
  bundle, compiling native `better-sqlite3` for backend Node 22, and serving both
  through Nginx + Supervisord in a single container.
- `backend/Dockerfile`: Node 22 multi-stage build. Native `better-sqlite3` is
  compiled in the build stage. The runtime entrypoint repairs data-volume
  ownership and then drops to the `node` user.
- `frontend/Dockerfile`: Node 22 build stage; Nginx 1.27 Alpine runtime with
  gzip, static-asset caching, security headers, and `/api/` + unbuffered `/v1/`
  reverse proxies.
- `docker-compose.yml`: loopback-bound ports, healthchecks, log rotation, and a
  named SQLite volume (`varad177/slir-app:latest`).
- `.github/workflows/ci.yml`: automated backend tests (`npm test`) and frontend
  TypeScript/Vite production build (`npm run build`) on push/PR.
- `.github/workflows/publish.yml`: runs `test` first, then multi-arch (`amd64`,
  `arm64`) `publish-app` build/push for the root unified `Dockerfile` on `v*`
  tags.
