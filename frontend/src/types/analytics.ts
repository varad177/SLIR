export interface SummaryKpis {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  errorRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  avgLatencyMs: number;
  latencyP50Ms?: number | null;
  latencyP95Ms?: number | null;
  latencyP99Ms?: number | null;
  ttftP50Ms?: number | null;
  ttftP95Ms?: number | null;
  cacheHitRate?: number;
  cacheHitRequests?: number;
  cacheReportedRequests?: number;
  burnRatePerDay?: number;
  projected30dCost?: number;
  missingTokensCount: number;
  costBreakdown: {
    confirmedCount: number;
    estimatedCount: number;
    unknownCount: number;
  };
}

export interface TimeSeriesPoint {
  bucket: string;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHits?: number;
  cacheReported?: number;
  cacheHitRate?: number;
  estimatedCost: number;
  avgLatencyMs: number;
  latencyP95Ms?: number;
  latencyP50Ms?: number;
}

export interface ModelMetric {
  model: string;
  provider: string;
  requests: number;
  percentage: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  avgLatencyMs: number;
  p95LatencyMs?: number | null;
  cacheHitRate?: number;
  failedRequests: number;
}

export interface ProviderMetric {
  provider: string;
  requests: number;
  requestPercentage: number;
  totalTokens: number;
  estimatedCost: number;
  costPercentage: number;
  avgLatencyMs: number;
  failedRequests: number;
}

export interface UsageEventItem {
  id: number;
  request_id: string;
  trace_id: string | null;
  application_id: string | null;
  application_name?: string | null;
  provider: string;
  model: string;
  client_model?: string | null;
  http_status?: number | null;
  call_type: string;
  status: 'success' | 'failure';
  is_streaming: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  tokens_estimated: number;
  estimated_cost: number | null;
  cost_status: 'confirmed_by_provider' | 'estimated' | 'unknown';
  latency_ms: number;
  prompt_eval_duration_ms?: number;
  eval_duration_ms?: number;
  load_duration_ms?: number;
  cache_status?: 'cache_hit' | 'cold_cache' | 'standard' | 'n/a';
  error_type: string | null;
  error_message: string | null;
  failover_used?: number;
  failover_from_model?: string | null;
  failover_reason?: string | null;
  failover_attempts?: number;
  failover_trace?: string | null;
  timestamp: string;
}

export interface FailoverTraceEntry {
  model: string;
  provider: string;
  outcome: string;
  status?: number | null;
  durationMs?: number;
  message?: string;
}

export interface RequestsResponse {
  items: UsageEventItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface FilterOptions {
  models: string[];
  providers: string[];
  applications: Array<{ id: string; name: string }>;
}

export interface ActiveFilters {
  interval: 'hour' | 'day' | 'month';
  status: string;
  model: string;
  provider: string;
  appId: string;
  streaming?: string;
  cacheStatus?: string;
  start?: string;
  end?: string;
  search?: string;
  page: number;
  limit?: number;
}

export interface OllamaModelInfo {
  name: string;
  model: string;
  size: string;
  rawSizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
  family?: string;
  modifiedAt?: string;
}

export interface CustomCloudModel {
  id?: number;
  modelId: string;
  displayName: string;
  provider: string;
  apiBase: string;
  apiKey?: string;
  keepApiKey?: boolean;
  hasApiKey?: boolean;
  maskedApiKey?: string;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  inputCostPerMillion?: number | null;
  outputCostPerMillion?: number | null;
  timeoutMs?: number | null;
  createdAt?: string;
}

export interface ModelHealthItem {
  model: string;
  requests: number;
  successes: number;
  failures: number;
  successRate: number | null;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastSeen: string | null;
}

export interface ModelHealthResponse {
  windowHours: number;
  generatedAt: string;
  models: ModelHealthItem[];
}

export interface ModelTestResult {
  ok: boolean;
  httpStatus?: number;
  latencyMs?: number;
  modelId?: string;
  errorType?: 'validation' | 'auth' | 'not_found' | 'rate_limit' | 'invalid_request' | 'upstream_error' | 'timeout' | 'network' | 'gateway';
  message: string;
  sample?: string;
}

export interface InstalledModelsResponse {
  success: boolean;
  models: OllamaModelInfo[];
  customModels?: CustomCloudModel[];
  activeModel: string;
  host?: string;
  warning?: string;
}

export interface ModelBenchmarkItem {
  rank: number;
  model: string;
  provider: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs?: number | null;
  minLatencyMs: number;
  maxLatencyMs: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgPromptEvalMs?: number;
  avgEvalMs?: number;
  avgLoadMs?: number;
  tokensPerSec: number;
  rawTokensPerSec?: number;
  cacheHitRate?: number;
  speedTier: string;
  totalTokens: number;
  totalCost: number;
}

export interface BenchmarkLeaderboardResponse {
  count: number;
  models: ModelBenchmarkItem[];
}

export interface ApplicationItem {
  id: string;
  name: string;
  description: string;
  apiKey: string;
  maskedApiKey: string;
  defaultModel: string;
  routingMode?: 'global' | 'pinned';
  failoverEnabled?: boolean;
  fallbackModels?: string[];
  createdAt: string;
  totalRequests: number;
  failedRequests?: number;
  totalTokens: number;
  totalCost: number;
  lastActive: string | null;
}

export interface ApplicationsResponse {
  success: boolean;
  count: number;
  applications: ApplicationItem[];
}

export interface TestPromptResult {
  success: boolean;
  model: string;
  latencyMs: number;
  promptEvalMs?: number;
  evalMs?: number;
  loadMs?: number;
  cacheStatus?: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  tokensPerSec: number;
  estimatedCost?: number;
}

export interface DevConfig {
  temperature: number;
  num_ctx: number;
}

export interface ProfileBenchmarkResult {
  success: boolean;
  model: string;
  isCloud?: boolean;
  latencyMs: number;
  loadMs: number | null;
  promptEvalMs: number | null;
  evalMs: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokensPerSec: number;
  content: string;
  options: {
    temperature: number;
    num_ctx: number;
  };
}

export type BudgetScope = 'global' | 'application' | 'model';
export type BudgetPeriod = 'daily' | 'monthly';
export type BudgetMetric = 'cost' | 'tokens' | 'requests';
export type BudgetAction = 'notify' | 'block';

export interface BudgetItem {
  id: number;
  name: string;
  scope_type: BudgetScope;
  application_id: string | null;
  application_name?: string | null;
  model: string | null;
  period: BudgetPeriod;
  metric: BudgetMetric;
  limit_value: number;
  warn_percent: number;
  action: BudgetAction;
  enabled: boolean;
  usage: number;
  percent: number;
  projectedValue: number;
  projectedPercent: number;
  projectedUsage?: number;
  projectionReliable?: boolean;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  created_at?: string;
  updated_at?: string;
}

export interface BudgetPayload {
  name: string;
  scope_type: BudgetScope;
  application_id?: string | null;
  model?: string | null;
  period: BudgetPeriod;
  metric: BudgetMetric;
  limit_value: number;
  warn_percent: number;
  action: BudgetAction;
  enabled?: boolean;
}

export interface BudgetAlertItem {
  id: number;
  budget_id: number;
  period_key: string;
  threshold: 'warning' | 'exceeded';
  usage_value: number;
  limit_value: number;
  message: string;
  acknowledged: number;
  delivery_status: 'pending' | 'delivered' | 'failed' | 'in_app_only';
  delivery_error: string | null;
  created_at: string;
  budget_name: string;
  scope_type: BudgetScope;
  application_id: string | null;
  model: string | null;
  metric: BudgetMetric;
  action: BudgetAction;
}

export interface AlertsResponse {
  success: boolean;
  items: BudgetAlertItem[];
  total: number;
  unacknowledged: number;
  limit: number;
  offset: number;
}

export interface AlertSettings {
  webhookUrl: string;
  webhookEnabled: boolean;
}

export interface PricingRule {
  id: number;
  model_pattern: string;
  provider: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
  effective_from: string;
  effective_to: string | null;
  currency: string;
  created_at?: string;
}

export interface PricingPayload {
  model_pattern: string;
  provider: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
  effective_from?: string;
  effective_to?: string | null;
  currency?: string;
}
