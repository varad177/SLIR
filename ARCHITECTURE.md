# Architecture

## 1. Request flow

```
Browser ──► Nginx :80 ──/api/*──► Express :4101 ──► SQLite
              │                        │
              └── static React build   └──► Ollama :11434
                                            or configured cloud endpoint

AI client ──► Express :4101 /v1/chat/completions ──► Ollama / cloud
                        │
                        └──► SQLite usage_events
```

There is **no separate proxy process**. The Express backend is both the
OpenAI-compatible gateway and the telemetry writer.

- `frontend/` is compiled by Vite and served by Nginx. Nginx proxies `/api/` and `/v1/` to
  `backend:4101`; the gateway endpoints `/v1/` can also be called directly on the
  backend port 4101.
- `backend/` exposes the dashboard API under `/api/*` and the OpenAI-compatible
  gateway under `/v1/*`.
- `backend/data` (the `ai_monitor_sqlite_data` volume in Compose) holds the
  SQLite database and pre-migration backups.

## 2. Gateway behaviour

`POST /v1/chat/completions`:

1. Reads an optional `Authorization: Bearer mp_live_...` application key.
   - A valid key attributes the request to an application.
   - An unknown `mp_live_` key returns `401`.
   - Requests without an application key are proxied but not recorded.
2. Resolves the target model:
   - explicit `model` value, or
   - the application's `default_model`, or
   - the global `active_model` setting for `active-model` / missing model.
3. If the model matches a row in `custom_models`, forwards to
   `<api_base>/chat/completions` with the stored provider key.
4. Otherwise forwards to Ollama. Non-streaming calls prefer Ollama's native
   `/api/chat` so prompt-cache and eval timings can be recorded; streaming and
   fallback calls use `/v1/chat/completions`.
5. Records a `usage_events` row for attributed calls:
   - success: token counts, latency, timings, cache status
   - failure: status `failure`, `error_type`, `error_message`, null tokens
6. Cloud streaming requests add `stream_options.include_usage = true` so the
   final SSE chunk carries usage.

Prompts and responses are never persisted. Only operational metadata is stored.

## 3. Database

SQLite in WAL mode with `synchronous = NORMAL`, `foreign_keys = ON`, and a
5-second busy timeout.

Core tables:

- `applications` — id, name, description, `api_key`, `default_model`
- `usage_events` — one row per attributed request, unique `request_id`
- `model_pricing` — versioned input/output cost per million tokens
- `custom_models` — cloud/OpenAI-compatible endpoints and their keys
- `settings` — `active_model`, setup flags
- `schema_migrations` — applied schema versions

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

## 5. Retention

`RETENTION_DAYS` controls event pruning:

- `0` (default): keep everything.
- Positive value: delete `usage_events.timestamp` older than the cutoff at
  startup, then once per day.

Backups are independent of retention and are pruned separately (five most
recent kept).

## 6. Container layout

- `backend/Dockerfile`: Node 22 multi-stage build. Native `better-sqlite3` is
  compiled in the build stage. The runtime entrypoint repairs data-volume
  ownership and then drops to the `node` user.
- `frontend/Dockerfile`: Node 22 build stage; Nginx 1.27 Alpine runtime with
  gzip, static-asset caching, security headers, and an `/api/` reverse proxy.
- `docker-compose.yml`: loopback-bound ports, healthchecks, log rotation, and a
  named SQLite volume.
- `.github/workflows/publish.yml`: multi-arch (`amd64`, `arm64`) GHCR publishing
  on `v*` tags.
