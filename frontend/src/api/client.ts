import { 
  SummaryKpis, 
  TimeSeriesPoint, 
  ModelMetric, 
  ProviderMetric, 
  RequestsResponse, 
  FilterOptions, 
  ActiveFilters,
  InstalledModelsResponse,
  BenchmarkLeaderboardResponse,
  TestPromptResult,
  CustomCloudModel,
  DevConfig,
  ProfileBenchmarkResult,
  ModelTestResult,
  BudgetItem,
  BudgetPayload,
  AlertsResponse,
  AlertSettings,
  PricingRule,
  PricingPayload
} from '../types/analytics';

const BASE_URL = '/api/analytics';

function buildQuery(filters: Partial<ActiveFilters>): string {
  const params = new URLSearchParams();
  if (filters.interval) params.set('interval', filters.interval);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.model && filters.model !== 'all') params.set('model', filters.model);
  if (filters.provider && filters.provider !== 'all') params.set('provider', filters.provider);
  if (filters.appId && filters.appId !== 'all') params.set('appId', filters.appId);
  if (filters.streaming && filters.streaming !== 'all') params.set('streaming', filters.streaming);
  if (filters.cacheStatus && filters.cacheStatus !== 'all') params.set('cacheStatus', filters.cacheStatus);
  if (filters.start) params.set('start', filters.start);
  if (filters.end) params.set('end', filters.end);
  if (filters.search && filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.page) params.set('page', filters.page.toString());
  const limit = filters.limit && filters.limit > 0 ? filters.limit : 25;
  params.set('limit', limit.toString());

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchSummary(filters: Partial<ActiveFilters>): Promise<SummaryKpis> {
  const res = await fetch(`${BASE_URL}/summary${buildQuery(filters)}`);
  if (!res.ok) throw new Error(`Failed to load summary: ${res.statusText}`);
  return res.json();
}

export async function fetchTimeSeries(filters: Partial<ActiveFilters>): Promise<TimeSeriesPoint[]> {
  const res = await fetch(`${BASE_URL}/timeseries${buildQuery(filters)}`);
  if (!res.ok) throw new Error(`Failed to load time series: ${res.statusText}`);
  return res.json();
}

export async function fetchModelBreakdown(filters: Partial<ActiveFilters>): Promise<ModelMetric[]> {
  const res = await fetch(`${BASE_URL}/models${buildQuery(filters)}`);
  if (!res.ok) throw new Error(`Failed to load model metrics: ${res.statusText}`);
  return res.json();
}

export async function fetchProviderBreakdown(filters: Partial<ActiveFilters>): Promise<ProviderMetric[]> {
  const res = await fetch(`${BASE_URL}/providers${buildQuery(filters)}`);
  if (!res.ok) throw new Error(`Failed to load provider metrics: ${res.statusText}`);
  return res.json();
}

export async function fetchRequests(filters: Partial<ActiveFilters>): Promise<RequestsResponse> {
  const res = await fetch(`${BASE_URL}/requests${buildQuery(filters)}`);
  if (!res.ok) throw new Error(`Failed to load requests: ${res.statusText}`);
  return res.json();
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const res = await fetch(`${BASE_URL}/filters`);
  if (!res.ok) throw new Error(`Failed to load filter options: ${res.statusText}`);
  return res.json();
}

export async function clearDatabase(clearApps: boolean = true, reseedDefault: boolean = false): Promise<{ success: boolean; message: string; deletedEvents: number; deletedApps?: number }> {
  const res = await fetch(`${BASE_URL}/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clearApps, reseedDefault })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to reset database: ${res.statusText}`);
  }
  return res.json();
}

const MODELS_BASE_URL = '/api/models';

export async function fetchInstalledModels(): Promise<InstalledModelsResponse> {
  const res = await fetch(`${MODELS_BASE_URL}/installed`);
  if (!res.ok) throw new Error(`Failed to load installed models: ${res.statusText}`);
  return res.json();
}

export async function setActiveModel(model: string): Promise<{ success: boolean; activeModel: string; message: string }> {
  const res = await fetch(`${MODELS_BASE_URL}/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to set active model: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchModelBenchmark(): Promise<BenchmarkLeaderboardResponse> {
  const res = await fetch(`${MODELS_BASE_URL}/benchmark`);
  if (!res.ok) throw new Error(`Failed to load model benchmarks: ${res.statusText}`);
  return res.json();
}

export async function runTestPromptBenchmark(
  model: string,
  prompt?: string,
  options?: { temperature?: number; maxTokens?: number; stream?: boolean }
): Promise<TestPromptResult> {
  const res = await fetch(`${MODELS_BASE_URL}/test-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(options?.stream !== undefined ? { stream: options.stream } : {})
    })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to run benchmark prompt: ${res.statusText}`);
  }
  return res.json();
}

export async function addCustomCloudModel(payload: CustomCloudModel): Promise<any> {
  const res = await fetch(`${MODELS_BASE_URL}/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to add cloud model: ${res.statusText}`);
  }
  return res.json();
}

export async function updateCustomCloudModel(modelId: string, payload: Partial<CustomCloudModel>): Promise<any> {
  const res = await fetch(`${MODELS_BASE_URL}/custom/${encodeURIComponent(modelId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to update cloud model: ${res.statusText}`);
  }
  return res.json();
}

export async function testModelConnection(payload: {
  apiBase: string;
  apiKey?: string;
  modelId: string;
  timeoutMs?: number;
}): Promise<ModelTestResult> {
  const res = await fetch(`${MODELS_BASE_URL}/custom/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Failed to test model connection: ${res.statusText}`);
  return res.json();
}

export async function testStoredModel(modelId: string, payload: { apiBase?: string; apiKey?: string; modelId?: string; timeoutMs?: number } = {}): Promise<ModelTestResult> {
  const res = await fetch(`${MODELS_BASE_URL}/custom/${encodeURIComponent(modelId)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Failed to test model connection: ${res.statusText}`);
  return res.json();
}

export async function deleteCustomCloudModel(modelId: string): Promise<any> {
  const res = await fetch(`${MODELS_BASE_URL}/custom/${encodeURIComponent(modelId)}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(`Failed to delete cloud model: ${res.statusText}`);
  return res.json();
}

const APPS_BASE_URL = '/api/applications';

export async function fetchApplications(): Promise<{ success: boolean; count: number; applications: import('../types/analytics').ApplicationItem[] }> {
  const res = await fetch(APPS_BASE_URL);
  if (!res.ok) throw new Error(`Failed to load applications: ${res.statusText}`);
  return res.json();
}

export async function createApplication(payload: {
  name: string;
  description?: string;
  defaultModel?: string;
  failoverEnabled?: boolean;
  fallbackModels?: string[];
}): Promise<any> {
  const res = await fetch(APPS_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create application: ${res.statusText}`);
  }
  return res.json();
}

export async function updateApplication(appId: string, payload: {
  name?: string;
  description?: string | null;
  defaultModel?: string;
  failoverEnabled?: boolean;
  fallbackModels?: string[];
}): Promise<any> {
  const res = await fetch(`${APPS_BASE_URL}/${encodeURIComponent(appId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update application: ${res.statusText}`);
  }
  return res.json();
}

export async function regenerateAppKey(appId: string): Promise<any> {
  const res = await fetch(`${APPS_BASE_URL}/${encodeURIComponent(appId)}/regenerate-key`, {
    method: 'POST'
  });
  if (!res.ok) throw new Error(`Failed to regenerate API key: ${res.statusText}`);
  return res.json();
}

export async function deleteApplication(appId: string): Promise<any> {
  const res = await fetch(`${APPS_BASE_URL}/${encodeURIComponent(appId)}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(`Failed to delete application: ${res.statusText}`);
  return res.json();
}

export async function fetchDevConfig(): Promise<DevConfig> {
  const res = await fetch(`${MODELS_BASE_URL}/dev-config`);
  if (!res.ok) throw new Error(`Failed to load dev config: ${res.statusText}`);
  return res.json();
}

export async function updateDevConfig(payload: Partial<DevConfig>): Promise<DevConfig> {
  const res = await fetch(`${MODELS_BASE_URL}/dev-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Failed to update dev config: ${res.statusText}`);
  return res.json();
}

export async function runProfileBenchmark(payload: {
  model?: string;
  prompt?: string;
  temperature?: number;
  num_ctx?: number;
}): Promise<ProfileBenchmarkResult> {
  const res = await fetch(`${MODELS_BASE_URL}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to run latency profile: ${res.statusText}`);
  }
  return res.json();
}

const BUDGETS_BASE_URL = '/api';

function budgetErrorMessage(err: any, fallback: string): string {
  return typeof err?.error === 'string' ? err.error : fallback;
}

export async function fetchBudgets(): Promise<BudgetItem[]> {
  const res = await fetch(`${BUDGETS_BASE_URL}/budgets`);
  if (!res.ok) throw new Error(`Failed to load budgets: ${res.statusText}`);
  const data = await res.json();
  return data.budgets || [];
}

export async function createBudget(payload: BudgetPayload): Promise<BudgetItem> {
  const res = await fetch(`${BUDGETS_BASE_URL}/budgets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(budgetErrorMessage(err, `Failed to create budget: ${res.statusText}`));
  }
  const data = await res.json();
  return data.budget;
}

export async function updateBudget(id: number, payload: Partial<BudgetPayload>): Promise<BudgetItem> {
  const res = await fetch(`${BUDGETS_BASE_URL}/budgets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(budgetErrorMessage(err, `Failed to update budget: ${res.statusText}`));
  }
  const data = await res.json();
  return data.budget;
}

export async function deleteBudget(id: number): Promise<void> {
  const res = await fetch(`${BUDGETS_BASE_URL}/budgets/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete budget: ${res.statusText}`);
}

export async function fetchAlerts(params: { unacknowledged?: boolean; limit?: number; offset?: number } = {}): Promise<AlertsResponse> {
  const query = new URLSearchParams();
  if (params.unacknowledged) query.set('unacknowledged', '1');
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  const res = await fetch(`${BUDGETS_BASE_URL}/alerts${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to load alerts: ${res.statusText}`);
  return res.json();
}

export async function acknowledgeAlert(id: number): Promise<void> {
  const res = await fetch(`${BUDGETS_BASE_URL}/alerts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledged: true })
  });
  if (!res.ok) throw new Error(`Failed to acknowledge alert: ${res.statusText}`);
}

export async function acknowledgeAllAlerts(): Promise<void> {
  const res = await fetch(`${BUDGETS_BASE_URL}/alerts/ack-all`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to acknowledge alerts: ${res.statusText}`);
}

export async function fetchAlertSettings(): Promise<AlertSettings> {
  const res = await fetch(`${BUDGETS_BASE_URL}/alerts/settings`);
  if (!res.ok) throw new Error(`Failed to load alert settings: ${res.statusText}`);
  const data = await res.json();
  return data.settings;
}

export async function updateAlertSettings(payload: AlertSettings): Promise<AlertSettings> {
  const res = await fetch(`${BUDGETS_BASE_URL}/alerts/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(budgetErrorMessage(err, `Failed to save alert settings: ${res.statusText}`));
  }
  const data = await res.json();
  return data.settings;
}

export async function sendTestAlert(): Promise<{ success: boolean; message?: string }> {
  const res = await fetch(`${BUDGETS_BASE_URL}/alerts/test`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(budgetErrorMessage(data, 'Failed to send test alert'));
  return data;
}

export async function fetchPricingRules(): Promise<PricingRule[]> {
  const res = await fetch(`${BASE_URL}/pricing`);
  if (!res.ok) throw new Error(`Failed to load pricing rules: ${res.statusText}`);
  return res.json();
}

export async function createPricingRule(payload: PricingPayload): Promise<PricingRule> {
  const res = await fetch(`${BASE_URL}/pricing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(budgetErrorMessage(err, `Failed to create pricing rule: ${res.statusText}`));
  }
  const data = await res.json();
  return data.pricing;
}

export async function updatePricingRule(id: number, payload: Partial<PricingPayload>): Promise<PricingRule> {
  const res = await fetch(`${BASE_URL}/pricing/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(budgetErrorMessage(err, `Failed to update pricing rule: ${res.statusText}`));
  }
  const data = await res.json();
  return data.pricing;
}

export async function deletePricingRule(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/pricing/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete pricing rule: ${res.statusText}`);
}



