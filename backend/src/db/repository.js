import { calculateEventCost } from './pricingEngine.js';

/**
 * Usage Events Repository
 */
export class UsageRepository {
  constructor(db) {
    this.db = db;

    // Prepared statement for fast idempotent insertion.
    // ON CONFLICT targets ONLY the request_id uniqueness rule, so genuine
    // constraint violations (bad CHECK/NOT NULL values) surface as errors
    // instead of being silently swallowed and miscounted as duplicates.
    this.insertStmt = this.db.prepare(`
      INSERT INTO usage_events (
        request_id, trace_id, application_id, provider, model, call_type,
        status, is_streaming, prompt_tokens, completion_tokens, total_tokens,
        tokens_estimated, estimated_cost, cost_status, latency_ms,
        prompt_eval_duration_ms, eval_duration_ms, load_duration_ms, cache_status,
        error_type, error_message, timestamp
      ) VALUES (
        @requestId, @traceId, @applicationId, @provider, @model, @callType,
        @status, @isStreaming, @promptTokens, @completionTokens, @totalTokens,
        @tokensEstimated, @estimatedCost, @costStatus, @latencyMs,
        @promptEvalDurationMs, @evalDurationMs, @loadDurationMs, @cacheStatus,
        @errorType, @errorMessage, @timestamp
      )
      ON CONFLICT(request_id) DO NOTHING
    `);

    // Ensure application exists to satisfy foreign key constraint dynamically
    this.ensureAppStmt = this.db.prepare(`
      INSERT OR IGNORE INTO applications (id, name, description, api_key)
      VALUES (?, ?, 'Auto-registered from gateway event metadata', 'mp_live_' || lower(hex(randomblob(16))))
    `);
  }

  /**
   * Persists a single parsed event idempotently
   * @param {Object} event 
   * @returns {{ inserted: boolean, requestId: string }}
   */
  saveEvent(event) {
    // Auto-register application if specified
    if (event.applicationId) {
      this.ensureAppStmt.run(event.applicationId, event.applicationId);
    }

    // Check pricing & cost status
    const pricing = calculateEventCost(this.db, event);
    const enrichedEvent = {
      traceId: null,
      applicationId: null,
      errorType: null,
      errorMessage: null,
      tokensEstimated: 0,
      isStreaming: 0,
      ...event,
      // Preserve `null` timings: they mean "provider did not report this",
      // which is materially different from a measured 0ms.
      promptEvalDurationMs: event.promptEvalDurationMs ?? null,
      evalDurationMs: event.evalDurationMs ?? null,
      loadDurationMs: event.loadDurationMs ?? null,
      cacheStatus: event.cacheStatus || 'unknown',
      estimatedCost: pricing.cost,
      costStatus: pricing.status
    };

    const res = this.insertStmt.run(enrichedEvent);
    const inserted = res.changes > 0;

    return {
      inserted,
      requestId: event.requestId,
      estimatedCost: enrichedEvent.estimatedCost,
      costStatus: enrichedEvent.costStatus
    };
  }

  /**
   * Persists an array of parsed events in an atomic transaction.
   * A row that violates a real constraint is reported as `rejected` rather
   * than aborting the whole batch or being counted as a duplicate.
   * @param {Array<Object>} events 
   * @returns {{ received: number, inserted: number, duplicatesSkipped: number, rejected: number }}
   */
  saveBatch(events) {
    let inserted = 0;
    let duplicatesSkipped = 0;
    let rejected = 0;

    const runBatch = this.db.transaction((items) => {
      for (const item of items) {
        try {
          const result = this.saveEvent(item);
          if (result.inserted) {
            inserted++;
          } else {
            duplicatesSkipped++;
          }
        } catch (err) {
          rejected++;
          console.error(`[REPOSITORY] Rejected event ${item?.requestId}:`, err.message);
        }
      }
    });

    runBatch(events);

    return {
      received: events.length,
      inserted,
      duplicatesSkipped,
      rejected
    };
  }

  /**
   * Get basic stats for verification
   */
  getQuickStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM usage_events').get().count;
    const totalCost = this.db.prepare('SELECT SUM(estimated_cost) as cost FROM usage_events WHERE estimated_cost IS NOT NULL').get().cost || 0;
    const totalTokens = this.db.prepare('SELECT SUM(total_tokens) as tokens FROM usage_events WHERE total_tokens IS NOT NULL').get().tokens || 0;
    
    return {
      totalEvents: total,
      totalCost: Math.round(totalCost * 1e4) / 1e4,
      totalTokens
    };
  }
}
