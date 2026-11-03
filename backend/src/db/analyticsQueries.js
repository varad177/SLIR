/**
 * High-performance analytical queries for AI Usage Monitoring
 */

export class AnalyticsService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Builds SQL WHERE clause from filter parameters
   */
  _buildWhereClause(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.start) {
      conditions.push('timestamp >= ?');
      params.push(filters.start);
    }
    if (filters.end) {
      const end = String(filters.end);
      // A date-only end bound (`2026-11-02`) would exclude every event that
      // day, since stored timestamps carry time and milliseconds
      // (`2026-11-02T15:04:05.123Z` > `2026-11-02` in string comparison).
      conditions.push('timestamp <= ?');
      params.push(/^\d{4}-\d{2}-\d{2}$/.test(end) ? `${end}T23:59:59.999Z` : end);
    }
    if (filters.status && filters.status !== 'all') {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.model && filters.model !== 'all') {
      conditions.push('model = ?');
      params.push(filters.model);
    }
    if (filters.provider && filters.provider !== 'all') {
      conditions.push('provider = ?');
      params.push(filters.provider);
    }
    if (filters.appId && filters.appId !== 'all') {
      conditions.push('application_id = ?');
      params.push(filters.appId);
    }
    if (filters.search && String(filters.search).trim()) {
      const term = `%${String(filters.search).trim()}%`;
      conditions.push('(request_id LIKE ? OR model LIKE ? OR error_message LIKE ?)');
      params.push(term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { where, params };
  }

  /**
   * 1. Overview Summary KPI metrics
   */
  getSummary(filters = {}) {
    const { where, params } = this._buildWhereClause(filters);
    const sql = `
      SELECT 
        COUNT(*) AS total_requests,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successful_requests,
        COALESCE(SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END), 0) AS failed_requests,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost), 0.0) AS estimated_cost,
        COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms,
        COALESCE(SUM(tokens_estimated), 0) AS missing_tokens_count,
        COALESCE(SUM(CASE WHEN cost_status = 'confirmed_by_provider' THEN 1 ELSE 0 END), 0) AS confirmed_cost_count,
        COALESCE(SUM(CASE WHEN cost_status = 'estimated' THEN 1 ELSE 0 END), 0) AS estimated_cost_count,
        COALESCE(SUM(CASE WHEN cost_status = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown_cost_count
      FROM usage_events
      ${where}
    `;

    const row = this.db.prepare(sql).get(...params);
    const total = row.total_requests || 0;
    const errorRate = total > 0 ? Math.round((row.failed_requests / total) * 10000) / 100 : 0;
    const successRate = total > 0 ? Math.round((row.successful_requests / total) * 10000) / 100 : 100;

    return {
      totalRequests: total,
      successfulRequests: row.successful_requests,
      failedRequests: row.failed_requests,
      successRate,
      errorRate,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      estimatedCost: Math.round(row.estimated_cost * 1e4) / 1e4,
      avgLatencyMs: Math.round(row.avg_latency_ms * 10) / 10,
      missingTokensCount: row.missing_tokens_count,
      costBreakdown: {
        confirmedCount: row.confirmed_cost_count,
        estimatedCount: row.estimated_cost_count,
        unknownCount: row.unknown_cost_count
      }
    };
  }

  /**
   * 2. Time-series analytics (hourly, daily, monthly)
   */
  getTimeSeries(filters = {}) {
    const { where, params } = this._buildWhereClause(filters);
    const interval = (filters.interval || 'day').toLowerCase();

    let bucketFormat = '%Y-%m-%d';
    if (interval === 'hour') {
      bucketFormat = '%Y-%m-%dT%H:00:00Z';
    } else if (interval === 'month') {
      bucketFormat = '%Y-%m';
    }

    const sql = `
      SELECT 
        strftime('${bucketFormat}', timestamp) AS bucket,
        COUNT(*) AS requests,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successful_requests,
        COALESCE(SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END), 0) AS failed_requests,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost), 0.0) AS estimated_cost,
        COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms
      FROM usage_events
      ${where}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => ({
      bucket: r.bucket,
      requests: r.requests,
      successfulRequests: r.successful_requests,
      failedRequests: r.failed_requests,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
      estimatedCost: Math.round(r.estimated_cost * 1e4) / 1e4,
      avgLatencyMs: Math.round(r.avg_latency_ms * 10) / 10
    }));
  }

  /**
   * 3. Model-wise usage breakdown
   */
  getModelBreakdown(filters = {}) {
    const { where, params } = this._buildWhereClause(filters);
    const sql = `
      SELECT 
        model,
        provider,
        COUNT(*) AS requests,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(estimated_cost), 0.0) AS estimated_cost,
        COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms,
        COALESCE(SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END), 0) AS failed_requests
      FROM usage_events
      ${where}
      GROUP BY model, provider
      ORDER BY requests DESC
    `;

    const rows = this.db.prepare(sql).all(...params);
    const totalRequests = rows.reduce((acc, r) => acc + r.requests, 0);

    return rows.map(r => ({
      model: r.model,
      provider: r.provider,
      requests: r.requests,
      percentage: totalRequests > 0 ? Math.round((r.requests / totalRequests) * 1000) / 10 : 0,
      totalTokens: r.total_tokens,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      estimatedCost: Math.round(r.estimated_cost * 1e4) / 1e4,
      avgLatencyMs: Math.round(r.avg_latency_ms * 10) / 10,
      failedRequests: r.failed_requests
    }));
  }

  /**
   * 4. Provider-wise usage breakdown
   */
  getProviderBreakdown(filters = {}) {
    const { where, params } = this._buildWhereClause(filters);
    const sql = `
      SELECT 
        provider,
        COUNT(*) AS requests,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost), 0.0) AS estimated_cost,
        COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms,
        COALESCE(SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END), 0) AS failed_requests
      FROM usage_events
      ${where}
      GROUP BY provider
      ORDER BY requests DESC
    `;

    const rows = this.db.prepare(sql).all(...params);
    const totalRequests = rows.reduce((acc, r) => acc + r.requests, 0);
    const totalCost = rows.reduce((acc, r) => acc + r.estimated_cost, 0);

    return rows.map(r => ({
      provider: r.provider,
      requests: r.requests,
      requestPercentage: totalRequests > 0 ? Math.round((r.requests / totalRequests) * 1000) / 10 : 0,
      totalTokens: r.total_tokens,
      estimatedCost: Math.round(r.estimated_cost * 1e4) / 1e4,
      costPercentage: totalCost > 0 ? Math.round((r.estimated_cost / totalCost) * 1000) / 10 : 0,
      avgLatencyMs: Math.round(r.avg_latency_ms * 10) / 10,
      failedRequests: r.failed_requests
    }));
  }

  /**
   * 5. Paginated and filterable request history
   */
  getRequests(options = {}) {
    const { where, params } = this._buildWhereClause(options);
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(options.limit, 10) || 50));
    const offset = (page - 1) * limit;

    // Total matching records count
    const countSql = `SELECT COUNT(*) as count FROM usage_events ${where}`;
    const total = this.db.prepare(countSql).get(...params).count;

    // Paginated list
    const listSql = `
      SELECT 
        id, request_id, trace_id, application_id, provider, model, call_type,
        status, is_streaming, prompt_tokens, completion_tokens, total_tokens,
        tokens_estimated, estimated_cost, cost_status, latency_ms,
        prompt_eval_duration_ms, eval_duration_ms, load_duration_ms, cache_status,
        error_type, error_message, timestamp
      FROM usage_events
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;

    const items = this.db.prepare(listSql).all(...params, limit, offset);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * 6. Distinct Filter Options (for frontend dropdowns)
   */
  getFilterOptions() {
    const models = this.db.prepare('SELECT DISTINCT model FROM usage_events ORDER BY model ASC').all().map(r => r.model);
    const providers = this.db.prepare('SELECT DISTINCT provider FROM usage_events ORDER BY provider ASC').all().map(r => r.provider);
    const applications = this.db.prepare('SELECT id, name FROM applications ORDER BY name ASC').all();

    return {
      models,
      providers,
      applications
    };
  }

  /**
   * 7. Model Performance Benchmark Leaderboard
   * Evaluates and ranks models side-by-side during development
   */
  getModelBenchmark(filters = {}) {
    const { where, params } = this._buildWhereClause(filters);
    const sql = `
      SELECT 
        model,
        provider,
        COUNT(*) AS total_requests,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success_requests,
        COALESCE(SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END), 0) AS failed_requests,
        COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms,
        COALESCE(MIN(latency_ms), 0.0) AS min_latency_ms,
        COALESCE(MAX(latency_ms), 0.0) AS max_latency_ms,
        COALESCE(AVG(prompt_tokens), 0.0) AS avg_prompt_tokens,
        COALESCE(AVG(completion_tokens), 0.0) AS avg_completion_tokens,
        COALESCE(AVG(prompt_eval_duration_ms), 0.0) AS avg_prompt_eval_ms,
        COALESCE(AVG(eval_duration_ms), 0.0) AS avg_eval_ms,
        COALESCE(AVG(load_duration_ms), 0.0) AS avg_load_ms,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost), 0.0) AS total_cost
      FROM usage_events
      ${where}
      GROUP BY model, provider
      ORDER BY avg_latency_ms ASC
    `;

    const rows = this.db.prepare(sql).all(...params);

    return rows.map((r, index) => {
      const avgLatencySec = r.avg_latency_ms / 1000;
      const tokensPerSec = avgLatencySec > 0 && r.avg_completion_tokens > 0 
        ? Math.round((r.avg_completion_tokens / avgLatencySec) * 10) / 10 
        : 0;

      // True Generation Speed: based on pure token generation time (excluding cold prompt caching)
      const genTimeSec = (r.avg_eval_ms > 0 ? r.avg_eval_ms : r.avg_latency_ms) / 1000;
      const trueTokensPerSec = genTimeSec > 0 && r.avg_completion_tokens > 0
        ? Math.round((r.avg_completion_tokens / genTimeSec) * 10) / 10
        : tokensPerSec;

      const errorRate = r.total_requests > 0 
        ? Math.round((r.failed_requests / r.total_requests) * 10000) / 100 
        : 0;

      let speedTier = 'Standard';
      if (r.avg_latency_ms < 1500 || trueTokensPerSec > 12) speedTier = '⚡ Ultra Fast';
      else if (r.avg_latency_ms < 3500 || trueTokensPerSec > 6) speedTier = '🚀 Fast';
      else speedTier = '🛡️ Balanced';

      return {
        rank: index + 1,
        model: r.model,
        provider: r.provider,
        totalRequests: r.total_requests,
        successRequests: r.success_requests,
        failedRequests: r.failed_requests,
        errorRate,
        avgLatencyMs: Math.round(r.avg_latency_ms * 10) / 10,
        minLatencyMs: Math.round(r.min_latency_ms * 10) / 10,
        maxLatencyMs: Math.round(r.max_latency_ms * 10) / 10,
        avgPromptTokens: Math.round(r.avg_prompt_tokens),
        avgCompletionTokens: Math.round(r.avg_completion_tokens),
        avgPromptEvalMs: Math.round(r.avg_prompt_eval_ms * 10) / 10,
        avgEvalMs: Math.round(r.avg_eval_ms * 10) / 10,
        avgLoadMs: Math.round(r.avg_load_ms * 10) / 10,
        tokensPerSec: trueTokensPerSec,
        rawTokensPerSec: tokensPerSec,
        speedTier,
        totalTokens: r.total_tokens,
        totalCost: Math.round(r.total_cost * 1e4) / 1e4
      };
    });
  }
}

