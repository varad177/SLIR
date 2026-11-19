# Comprehensive Improvement Plan for AI Usage Monitor (SLIR)

## Executive Summary

The application is a well-architected AI gateway with SQLite-backed telemetry, per-application failover, budget enforcement, and a polished React dashboard. This plan identifies **18 bugs**, **24 improvements**, and **16 UX enhancements** organized by priority and component.

---

## 🔴 CRITICAL BUGS (Fix Immediately)

### 1. Budget Enforcement Race Condition
**Location**: `backend/src/services/budgetService.js:175-215` (`getBlockingBudget`)
**Issue**: Cache key uses `applicationId|eventModel` but budget scope can be global/model. A global budget blocking all apps will only cache per-app, leading to inconsistent blocking.
**Fix**: Include budget scope in cache key or evaluate all matching budgets per request.

### 2. Failover Trace Serialization Failure
**Location**: `backend/src/server.js:290-292` (`failoverMetadata`)
**Issue**: `JSON.stringify(trace)` on line 291 fails silently if trace contains circular refs or non-serializable objects (e.g., `Response` objects). No try-catch.
**Fix**: Wrap in try-catch, fallback to sanitized trace.

### 3. SSE Pipe Memory Leak on Client Disconnect
**Location**: `backend/src/server.js:75-105` (`pipeSseAndCapture`)
**Issue**: Captures entire stream in `chunks[]` array (line 76) without size limit. Long streams OOM the server.
**Fix**: Add max buffer size (e.g., 10MB) and truncate/stop capture.

### 4. CORS Origin Validation Bypass
**Location**: `backend/src/server.js:129-139`
**Issue**: `origin` header check allows `null`/`undefined` (line 136). Non-browser requests skip CORS but can still hit API.
**Fix**: Explicitly require origin for browser-like requests; log warnings.

### 5. Database Migration Backup Fails on Windows
**Location**: `backend/src/db/schema.js:188-189` (`VACUUM INTO`)
**Issue**: `VACUUM INTO` uses single quotes with escaped path. Windows paths with backslashes break the SQL.
**Fix**: Use forward slashes or `path.posix` for backup path.

### 6. Application API Key Not Unique Index Race
**Location**: `backend/src/db/schema.js:235-239`
**Issue**: Unique index creation catches error but continues. Duplicate keys can exist, causing auth confusion.
**Fix**: Add migration to deduplicate keys before index creation, or enforce at insert time.

### 7. Frontend: `GatewayConnectionCard` Stale Config Race
**Location**: `frontend/src/components/GatewayConnectionCard.tsx:24-28`
**Issue**: `fetchGatewayConfig()` called once on mount. If `SLIR_PUBLIC_BASE_URL` changes at runtime, card never updates.
**Fix**: Add `key` prop tied to config version or poll `/api/config`.

### 8. Frontend: Request Logs Search Debounce Resets Page on Every Keystroke
**Location**: `frontend/src/components/RequestLogsView.tsx:96-102`
**Issue**: `setPage(1)` called inside debounce (line 99), causing flicker when user types fast.
**Fix**: Only reset page when debounced value actually changes.

---

## 🟠 HIGH PRIORITY BUGS

### 9. Budget Alert Deduplication Uses Wrong Key
**Location**: `backend/src/services/budgetService.js:152-156`
**Issue**: `UNIQUE(budget_id, period_key, threshold)` but `period_key` for daily budgets is `YYYY-MM-DD`. If budget crosses midnight UTC, two alerts fire.
**Fix**: Use budget period boundaries consistently; store period start/end in alert.

### 10. Ollama Service Hardcoded Host Fallbacks
**Location**: `backend/src/services/ollamaService.js:27-33` and 7+ other locations
**Issue**: 5 hardcoded URLs duplicated across methods. Adding new host requires 7+ edits.
**Fix**: Centralize in `getOllamaUrls()` (already exists in gatewayFailover) and import.

### 11. Failover Candidate Order Non-Deterministic for Same Provider
**Location**: `backend/src/services/gatewayFailover.js:72-85` (`buildFailoverCandidates`)
**Issue**: Deduplication uses `candidates.some(...)` which preserves first occurrence. If user adds "model-a" then "model-b" both mapping to same custom endpoint, order depends on insert order.
**Fix**: Document behavior or sort by user-defined priority.

### 12. Streaming Response Missing Usage on Error
**Location**: `backend/src/server.js:474-502`
**Issue**: If SSE pipe errors after headers sent (line 479-481), `persistFailure` called but no usage captured. Event has null tokens.
**Fix**: Capture partial usage before error if possible.

### 13. Dashboard Timeframe "7d" Uses Day Interval Causing 168 Points
**Location**: `frontend/src/App.tsx:94-95`
**Issue**: `overviewTimeframe === '7d' ? 'day' : 'hour'` produces hourly buckets for 7d (168 points). Chart becomes unreadable.
**Fix**: Use 'day' bucket for 7d, 'hour' for ≤24h.

### 14. Copy-to-Clipboard Silent Failure
**Location**: Multiple components (`handleCopy` functions)
**Issue**: `navigator.clipboard.writeText()` throws on insecure contexts (HTTP) but errors swallowed.
**Fix**: Wrap in try-catch, fallback to `execCommand('copy')` for HTTP.

### 15. Budget Projected Cost Math Wrong for Partial Periods
**Location**: `backend/src/services/budgetService.js:97-107` (`buildProjection`)
**Issue**: `ratio = totalMs / elapsedMs` assumes linear spend. Early in period, ratio is huge (e.g., 1h into month = 720x projection).
**Fix**: Minimum elapsed threshold (e.g., 10% of period) before projecting.

---

## 🟡 MEDIUM PRIORITY IMPROVEMENTS

### 16. Add Request Tracing / Correlation IDs
**Scope**: Backend + Frontend
**Detail**: Add `X-Request-ID` header propagation through gateway, include in all logs. Frontend: display in inspector.

### 17. Structured Logging (JSON) for Production
**Scope**: Backend (`server.js`)
**Detail**: Replace `console.log/error` with pino/winston. Add log levels, request context, pretty dev mode.

### 18. Health Check Should Verify Ollama Connectivity
**Scope**: Backend (`server.js:548-565`)
**Detail**: `/api/health` only checks DB. Add optional Ollama ping (cached 30s) to detect downstream issues.

### 19. Rate Limiting on Admin Endpoints
**Scope**: Backend (`requireAdmin` middleware)
**Detail**: No rate limit on `/api/ingest/status`, `/api/analytics/clear`. Add token bucket per IP.

### 20. Database Vacuum Strategy
**Scope**: Backend (`analyticsRouter.js:271-272`)
**Detail**: Comment says VACUUM not run due to WAL. Add scheduled VACUUM during low-traffic (e.g., 3am) or use `PRAGMA wal_autocheckpoint`.

### 21. API Key Rotation Should Invalidate Active Streams
**Scope**: Backend (`applicationsRouter.js:270-296`)
**Detail**: Rotating key doesn't kill in-flight streaming requests using old key. Acceptable but document.

### 22. Cost Estimation for Cloud Models Missing
**Scope**: Backend (`pricingEngine.js` not shown but referenced)
**Detail**: `estimated_cost` only from provider usage. For local models, always 0. Add configurable per-model pricing for local.

### 23. Frontend: Virtualized Tables for Large Datasets
**Scope**: Frontend (`RequestLogsView`, `CostsBudgetsView`)
**Detail**: Tables render all rows. 10k+ rows cause lag. Use `react-window` or pagination only.

### 24. Frontend: Optimistic UI for Failover/Budget Changes
**Scope**: Frontend (`FailoverView`, `CostsBudgetsView`)
**Detail**: Save button disables until API responds. Show pending state immediately, rollback on error.

### 25. Add OpenAPI/Swagger Spec
**Scope**: Backend
**Detail**: Generate from route handlers. Enables client SDK generation, Postman import.

### 26. Circuit Breaker for Upstream Providers
**Scope**: Backend (`gatewayFailover.js`)
**Detail**: After N consecutive failures, temporarily skip provider. Prevents hammering dead endpoints.

### 27. Request Sampling for High-Volume Apps
**Scope**: Backend (`server.js:239-255` `persistEvent`)
**Detail**: Log every request. Add configurable sampling rate (e.g., 10% for high-volume apps) with extrapolated metrics.

### 28. Frontend: Keyboard Shortcuts
**Scope**: Frontend (`App.tsx`)
**Detail**: Add `Cmd/Ctrl+K` for command palette (search tabs, apps, models). `?` for help.

### 29. Export Telemetry as Parquet/JSONL
**Scope**: Frontend + Backend
**Detail**: CSV export limited. Add JSONL streaming for large exports, Parquet for analytics.

### 30. Multi-Tenant / Organization Support
**Scope**: Architecture
**Detail**: Current schema single-tenant. Add `organization_id` to applications, budgets, usage_events.

---

## 🟢 LOW PRIORITY IMPROVEMENTS

### 31. Automated Dependency Updates
**Scope**: Both `package.json`
**Detail**: Add Dependabot/Renovate config. Pin major versions.

### 32. E2E Tests with Playwright
**Scope**: Frontend
**Detail**: Critical flows: create app → test route → configure failover → verify log.

### 33. Benchmark Comparison View
**Scope**: Frontend (`OverviewView`, `ModelsHubView`)
**Detail**: Side-by-side model comparison (latency, cost, quality). Save baseline.

### 34. Prometheus Metrics Endpoint
**Scope**: Backend
**Detail**: `/metrics` with request counts, latency histograms, budget status.

### 35. Dark/Light Theme Persistence
**Scope**: Frontend (`ThemeProvider`)
**Detail**: Already uses localStorage. Add system preference detection (`prefers-color-scheme`).

### 36. Accessibility Audit
**Scope**: Frontend
**Detail**: ARIA labels, focus management, color contrast (some orange-on-gray fails WCAG AA).

---

## 🎨 UX ENHANCEMENTS

### 37. Onboarding Wizard (First Run)
**Detail**: Empty state → "Create your first app" → "Test route" → "View logs". Guided tour.

### 38. Application Templates
**Detail**: Pre-filled configs for common stacks: "LangChain Python", "Semantic Kernel .NET", "Vercel AI SDK".

### 39. Model Health Indicators
**Detail**: In Models Hub, show green/red dot per model based on recent success rate. Auto-disable failing models from failover.

### 40. Budget Alert Webhook Templates
**Detail**: Pre-built JSON for Slack, Discord, PagerDuty, Opsgenie. Test button shows preview.

### 41. Request Log "Share Link"
**Detail**: Generate short-lived signed URL for a single request inspector (for team debugging).

### 42. Failover Visualization
**Detail**: Flow diagram showing primary → fallback1 → fallback2 with recent latency per hop.

### 43. Cost Anomaly Detection
**Detail**: Alert when daily spend > 2x 7-day average. ML not needed; simple statistical threshold.

### 44. Copy as cURL with Auth Header
**Detail**: In Request Logs inspector, "Copy as cURL" includes actual request headers (sanitized).

### 45. Model Comparison Benchmark Runner
**Detail**: "Run benchmark on all models" button. Shows table: model | latency | tokens/s | cost/1k.

### 46. Application Usage Quotas (Hard Limits)
**Detail**: Per-app daily request/token limits independent of budgets. Returns 429 with `Retry-After`.

### 47. Webhook Retry with Exponential Backoff
**Scope**: `alertService.js`
**Detail**: Currently fires once. Add retry: 1m, 5m, 15m, 1h. Dead letter queue after 5 failures.

### 48. Dashboard Customization
**Detail**: Drag-to-reorder KPI cards. Save layout per user (localStorage).

### 49. Keyboard Navigation in Tables
**Scope**: Request Logs, Budgets tables
**Detail**: Arrow keys to navigate rows. Enter to open inspector.

### 50. Real-time Log Tail
**Scope**: Request Logs
**Detail**: "Live tail" mode (WebSocket or SSE) showing requests as they arrive.

### 51. Model Warm-up Scheduler
**Scope**: Backend
**Detail**: Pre-load models before peak hours. Configurable cron: "warm qwen2.5:7b at 8am weekdays".

### 52. Audit Log for Admin Actions
**Scope**: Backend
**Detail**: Log key rotations, budget changes, model deletions with actor (API key prefix).

---

## 📋 IMPLEMENTATION ROADMAP

### Phase 1: Stability (Week 1-2)
| # | Task | Effort |
|---|------|--------|
| 1 | Fix budget cache race | 2h |
| 2 | Failover trace try-catch | 1h |
| 3 | SSE buffer limit | 2h |
| 4 | CORS origin fix | 1h |
| 5 | Windows VACUUM path fix | 1h |
| 6 | API key unique index migration | 2h |
| 7 | GatewayConnectionCard config polling | 2h |
| 8 | Search debounce page reset fix | 1h |

### Phase 2: Observability (Week 2-3)
| # | Task | Effort |
|---|------|--------|
| 9 | Budget alert period fix | 2h |
| 10 | Centralize Ollama URLs | 3h |
| 11 | Deterministic failover order | 2h |
| 12 | Streaming partial usage capture | 3h |
| 13 | 7d chart bucket fix | 1h |
| 14 | Clipboard fallback | 2h |
| 15 | Budget projection threshold | 2h |
| 16 | Request correlation IDs | 4h |
| 17 | Structured logging | 4h |
| 18 | Health check Ollama ping | 2h |

### Phase 3: Resilience (Week 3-4)
| # | Task | Effort |
|---|------|--------|
| 19 | Admin rate limiting | 2h |
| 20 | VACUUM strategy | 2h |
| 21 | Circuit breaker | 4h |
| 22 | Request sampling | 3h |
| 23 | Virtualized tables | 4h |
| 24 | Optimistic UI | 3h |
| 25 | OpenAPI spec | 4h |

### Phase 4: UX Polish (Week 4-5)
| # | Task | Effort |
|---|------|--------|
| 26 | Onboarding wizard | 6h |
| 27 | App templates | 3h |
| 28 | Model health indicators | 4h |
| 29 | Budget webhook templates | 3h |
| 30 | Failover visualization | 4h |
| 31 | Copy as cURL | 2h |
| 32 | Keyboard shortcuts | 3h |
| 33 | Accessibility fixes | 4h |

### Phase 5: Advanced Features (Week 5+)
| # | Task | Effort |
|---|------|--------|
| 34 | Cost anomaly detection | 4h |
| 35 | Model benchmark runner | 6h |
| 36 | App quotas | 4h |
| 37 | Webhook retry/backoff | 3h |
| 38 | Real-time log tail (WebSocket) | 6h |
| 39 | Model warm-up scheduler | 4h |
| 40 | Audit log | 3h |

---

## 🧪 TESTING GAPS TO ADDRESS

| Area | Missing Coverage |
|------|------------------|
| BudgetService | Multi-scope budget interaction, projection edge cases |
| GatewayFailover | Streaming failover mid-stream, cloud+local mixed chains |
| OllamaService | Partial model list, host failover order |
| AnalyticsService | Complex filter combinations, large pagination |
| Frontend | Error boundary coverage, offline handling, responsive breakpoints |
| E2E | None (add Playwright) |

---

## 🏗️ TECHNICAL DEBT

1. **Duplicate Ollama URL lists** - 7 occurrences across 3 files
2. **Inline styles in React components** - ~40% of components use inline styles; migrate to CSS classes
3. **Magic strings for model normalization** - `replace(/^ollama\//, '')` in 8+ places
4. **No TypeScript on backend** - JSDoc only; migrate to TS for type safety
5. **CSS file monolith** - `components.css` 3765 lines; split by component
6. **Hardcoded timeouts** - 60s/90s in multiple places; centralize config
7. **No API versioning strategy** - `/v1/` in path but no deprecation policy

---

## 📊 METRICS TO TRACK POST-RELEASE

| Metric | Target |
|--------|--------|
| Gateway P99 latency | < 200ms overhead |
| Failover success rate | > 95% |
| Budget alert precision | < 5% false positives |
| Dashboard load time | < 1.5s (FCP) |
| API error rate | < 0.1% |
| Test coverage | > 80% backend, > 60% frontend |

---

## 🤔 DECISIONS NEEDED FROM USER

1. **Multi-tenancy**: Is this a single-user dev tool or future SaaS? (Affects schema, auth)
2. **Cloud provider priority**: Which providers matter most? (Groq, OpenAI, Anthropic, OpenRouter, custom)
3. **Real-time logs**: WebSocket vs SSE vs polling? (Impacts backend complexity)
4. **Benchmark storage**: Keep history? How long? (Storage growth)
5. **Plugin/extension model**: Allow custom failover logic? (Architecture impact)

---

## 📝 QUICK WINS (Do This Week)

- [ ] Fix 8 critical bugs
- [ ] Add clipboard fallback
- [ ] Fix 7d chart bucket
- [ ] Centralize Ollama URLs
- [ ] Add health check Ollama ping
- [ ] Fix search debounce page reset
- [ ] GatewayConnectionCard config polling
- [ ] Add request correlation ID header

---

*Generated from codebase analysis on 2026-11-19. Total: 18 bugs, 24 improvements, 16 UX enhancements.*

---

## IMPLEMENTATION STATUS (2026-11-19)

### Done

- Critical/high fixes: SSE capture bound, webhook retry, schema backup path, duplicate API-key repair, budget cache/projection, circuit breaker, structured logging, safe JSON traces, request correlation IDs, streaming partial usage persistence.
- Observability: `GET /api/metrics` Prometheus text endpoint, `X-Request-ID` response header + trace persistence, deep health with cached Ollama status, model health endpoint.
- Gateway: ordered failover with circuit breaker, `circuit_open` reason, `failover_trace`, rate-limit retry, streaming failover before first chunk, dynamic routing errors.
- API hardening: rate limits on operational/test routes, CORS `exposedHeaders`, `x-powered-by` disabled, `/api/config` for browser gateway port.
- Frontend UX: User Manual tab, command palette (`Ctrl/⌘ K`), keyboard navigation, connection status banner, config polling, clipboard fallback with failure states, copy-as-cURL, trace ID in inspector, request-row keyboard navigation, onboarding card, app templates, model health pills, failover route preview, budget projection reliability, webhook payload preview, error boundary, system theme preference, missing CSS variable fixes.
- Tests: backend suite covers metrics, request IDs, model health, circuit breaker, webhook retry, duplicate API-key repair, failover chains, budgets, schema migrations; frontend production build passes.

### Deferred (needs product/architecture decision)

- Multi-tenancy/auth model, hard quotas, audit log, request sampling.
- Real-time transport choice (WebSocket vs SSE vs polling), benchmark history retention, plugin/custom failover architecture.
- OpenAPI docs, benchmark-all-models runner, model warmup scheduler, table virtualization, full accessibility sweep.
- E2E test suite (Playwright) and backend TypeScript migration.

### Known Minor Gaps

- Budget projection tests cover the summary shape but not every early-window edge case.
- Full E2E browser workflows and large-screen virtualization remain untested.