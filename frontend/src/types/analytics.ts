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
  estimatedCost: number;
  avgLatencyMs: number;
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
  provider: string;
  model: string;
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
  timestamp: string;
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
  hasApiKey?: boolean;
  maskedApiKey?: string;
  createdAt?: string;
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
  minLatencyMs: number;
  maxLatencyMs: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgPromptEvalMs?: number;
  avgEvalMs?: number;
  avgLoadMs?: number;
  tokensPerSec: number;
  rawTokensPerSec?: number;
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
  baseUrl: string;
  gatewayUrl: string;
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


