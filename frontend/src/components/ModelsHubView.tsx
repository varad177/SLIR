import React, { useState, useEffect } from 'react';
import { OllamaModelInfo, CustomCloudModel, ApplicationItem, ModelHealthItem, ModelTestResult } from '../types/analytics';
import {
  fetchInstalledModels,
  fetchModelHealth,
  deleteCustomCloudModel,
  setActiveModel,
  testStoredModel
} from '../api/client';
import { AddCloudModelModal } from './AddCloudModelModal';
import { ConfirmModal } from './ConfirmModal';
import {
  SearchIcon,
  CheckIcon,
  TrashIcon,
  ZapIcon,
  PlusIcon
} from './icons/Icons';

interface ModelsHubViewProps {
  onModelSwitched?: () => void;
  refreshTrigger?: number;
  applications?: ApplicationItem[];
}

const normalizeModel = (value?: string | null) => (value || '').replace(/^ollama\//, '').toLowerCase();

const healthClass = (status: ModelHealthItem['status']) =>
  status === 'healthy' ? 'ok' : status === 'degraded' ? 'warn' : status === 'unhealthy' ? 'error' : '';

export const ModelsHubView: React.FC<ModelsHubViewProps> = ({
  onModelSwitched,
  refreshTrigger = 0,
  applications = []
}) => {
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [customModels, setCustomModels] = useState<CustomCloudModel[]>([]);
  const [globalModel, setGlobalModel] = useState('qwen2.5:3b');
  const [filterType, setFilterType] = useState<'all' | 'local' | 'cloud'>('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);
  const [modelToEdit, setModelToEdit] = useState<CustomCloudModel | null>(null);
  const [switching, setSwitching] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<CustomCloudModel | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ModelTestResult>>({});
  const [modelHealth, setModelHealth] = useState<Record<string, ModelHealthItem>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const loadModels = async () => {
    try {
      setLoading(true);
      const [modelsRes, healthRes] = await Promise.all([
        fetchInstalledModels().catch(() => null),
        fetchModelHealth(24).catch(() => null)
      ]);
      if (modelsRes) {
        setOllamaModels(modelsRes.models || []);
        setCustomModels(modelsRes.customModels || []);
        if (modelsRes.activeModel) setGlobalModel(modelsRes.activeModel);
      }
      if (healthRes) {
        setModelHealth(Object.fromEntries(
          healthRes.models.map((item) => [normalizeModel(item.model), item])
        ));
      }
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, [refreshTrigger]);

  const flash = (ok: boolean, message: string) => {
    setFeedback({ ok, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleSwitch = async (model: string) => {
    if (normalizeModel(model) === normalizeModel(globalModel)) return;
    setSwitching(true);
    try {
      await setActiveModel(model);
      setGlobalModel(model);
      flash(true, `Global fallback is now ${model}. Applications pinned to a specific model are unchanged.`);
      onModelSwitched?.();
      await loadModels();
    } catch (err: any) {
      flash(false, err.message || 'Failed to switch the global model.');
    } finally {
      setSwitching(false);
    }
  };

  const handleTestModel = async (model: CustomCloudModel) => {
    setTestingModel(model.modelId);
    try {
      const result = await testStoredModel(model.modelId);
      setTestResults((prev) => ({ ...prev, [model.modelId]: result }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [model.modelId]: { ok: false, message: err.message || 'Connection test failed.' }
      }));
    } finally {
      setTestingModel(null);
    }
  };

  const confirmDeleteCloud = async () => {
    if (!modelToDelete) return;
    try {
      await deleteCustomCloudModel(modelToDelete.modelId);
      setCustomModels((prev) => prev.filter((m) => m.modelId !== modelToDelete.modelId));
      flash(true, `${modelToDelete.displayName || modelToDelete.modelId} removed.`);
      onModelSwitched?.();
      await loadModels();
    } catch (err: any) {
      flash(false, err.message || 'Failed to delete model.');
    } finally {
      setModelToDelete(null);
    }
  };

  const pinnedCount = (modelId: string) => applications.filter((app) => app.defaultModel === modelId).length;
  const healthFor = (modelId: string) => modelHealth[normalizeModel(modelId)];
  const totalMounted = ollamaModels.length + customModels.length;
  const activeCustom = customModels.find(cm => normalizeModel(cm.modelId) === normalizeModel(globalModel));
  const activeLocal = ollamaModels.find(m => normalizeModel(m.name) === normalizeModel(globalModel));
  const isCloud = !!activeCustom;

  const filteredLocal = ollamaModels.filter(m =>
    !searchFilter.trim() || m.name.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const filteredCloud = customModels.filter(c =>
    !searchFilter.trim()
    || c.modelId.toLowerCase().includes(searchFilter.toLowerCase())
    || (c.displayName || '').toLowerCase().includes(searchFilter.toLowerCase())
    || c.provider.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const allTargets = [
    ...ollamaModels.map(m => ({ id: m.name, label: m.name, group: 'Local' })),
    ...customModels.map(c => ({ id: c.modelId, label: c.displayName || c.modelId, group: c.provider }))
  ];

  return (
    <div className="mp-models-page">
      <div className="mp-page-head">
        <div>
          <div className="mp-eyebrow">Runtime</div>
          <h1 className="mp-page-title">Models and providers</h1>
          <p className="mp-page-subtitle">
            The global fallback is used by every application set to <code>active-model</code>. Pinned applications keep their own model.
          </p>
        </div>
        <div className="mp-page-head-actions">
          <div className="mp-search">
            <SearchIcon size={13} />
            <input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search models or providers"
              aria-label="Search models"
            />
          </div>
          <div className="mp-segmented font-mono">
            {(['all', 'local', 'cloud'] as const).map((type) => (
              <button
                key={type}
                className={filterType === type ? 'active' : ''}
                onClick={() => setFilterType(type)}
              >
                {type === 'all' ? `All ${totalMounted}` : type === 'local' ? `Local ${ollamaModels.length}` : `Cloud ${customModels.length}`}
              </button>
            ))}
          </div>
          <button className="mp-btn mp-btn-primary" onClick={() => { setModelToEdit(null); setIsCloudModalOpen(true); }}>
            <PlusIcon size={13} />
            Add model
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`mp-alert ${feedback.ok ? 'success' : 'error'}`}>
          {feedback.ok && <CheckIcon size={13} />}
          <span>{feedback.message}</span>
        </div>
      )}

      <section className="mp-global-model-card">
        <div className="mp-global-model-copy">
          <div className="mp-eyebrow">Global fallback</div>
          <div className="mp-global-model-name font-mono">{globalModel}</div>
          <p>
            {isCloud
              ? `${activeCustom?.provider} endpoint at ${activeCustom?.apiBase}.`
              : activeLocal
                ? `Local Ollama model · ${activeLocal.parameterSize || 'unknown size'} · ${activeLocal.size}.`
                : 'This model was not found in the current provider list. Requests may fail until it is available.'}
          </p>
          <div className="mp-global-model-meta font-mono">
            <span>{applications.filter(a => a.defaultModel === 'active-model').length} {applications.filter(a => a.defaultModel === 'active-model').length === 1 ? 'app follows' : 'apps follow'} this</span>
            <span>{applications.filter(a => a.defaultModel !== 'active-model').length} {applications.filter(a => a.defaultModel !== 'active-model').length === 1 ? 'app' : 'apps'} pinned</span>
          </div>
        </div>

        <label className="mp-field">
          <span className="mp-field-label">Switch global model</span>
          <select
            className="mp-select font-mono"
            value={globalModel}
            onChange={(e) => handleSwitch(e.target.value)}
            disabled={switching || allTargets.length === 0}
          >
            {allTargets.length === 0 && <option value={globalModel}>{globalModel}</option>}
            {['Local', ...Array.from(new Set(customModels.map(c => c.provider)))].map((group) => {
              const targets = allTargets.filter((target) => target.group === group);
              if (targets.length === 0) return null;
              return (
                <optgroup key={group} label={group}>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>{target.label}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <small>{switching ? 'Updating fallback...' : 'Only affects apps set to active-model.'}</small>
        </label>
      </section>

      {(filterType === 'all' || filterType === 'local') && (
        <section className="mp-card">
          <div className="mp-section-head">
            <div>
              <div className="mp-eyebrow">Local runtime</div>
              <div className="mp-section-title">Ollama models</div>
            </div>
            <span className="mp-muted font-mono">{ollamaModels.length} installed</span>
          </div>

          <div className="mp-table-wrapper">
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Architecture</th>
                  <th>Size</th>
                  <th>Routing</th>
                  <th className="align-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocal.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="mp-empty compact">
                        <strong>{loading ? 'Discovering local models' : 'No local Ollama models found'}</strong>
                        <span>{loading ? 'Checking the Ollama API.' : 'Start Ollama and refresh, or add a cloud endpoint.'}</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredLocal.map((model) => {
                  const isGlobal = normalizeModel(globalModel) === normalizeModel(model.name);
                  const pins = pinnedCount(model.name);
                  return (
                    <tr key={model.name}>
                      <td>
                        <div className="mp-model-cell">
                          <span className={`mp-status-dot ${isGlobal ? '' : 'muted'}`} />
                          <div>
                            <strong className="font-mono">{model.name}</strong>
                            <small>{model.family || 'Unknown family'}</small>
                            {healthFor(model.name) && (
                              <div
                                className={`mp-test-pill ${healthClass(healthFor(model.name)!.status)}`}
                                title={`${healthFor(model.name)!.successes}/${healthFor(model.name)!.requests} successful requests in the last 24h`}
                              >
                                {healthFor(model.name)!.successRate}% success · {healthFor(model.name)!.requests} req
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="font-mono">{model.parameterSize || 'Unknown'} · {model.quantization || 'Unknown'}</td>
                      <td className="font-mono">{model.size}</td>
                      <td>
                        <div className="mp-routing-cell">
                          {isGlobal && <span className="mp-badge success">Global</span>}
                          {pins > 0 && <span className="mp-badge neutral">{pins} pinned</span>}
                          {!isGlobal && pins === 0 && <span className="mp-muted">Available</span>}
                        </div>
                      </td>
                      <td className="align-right">
                        {isGlobal ? (
                          <span className="mp-muted font-mono">Current fallback</span>
                        ) : (
                          <button className="mp-btn mp-btn-ghost" onClick={() => handleSwitch(model.name)} disabled={switching}>
                            Make global
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(filterType === 'all' || filterType === 'cloud') && (
        <section className="mp-card">
          <div className="mp-section-head">
            <div>
              <div className="mp-eyebrow">External</div>
              <div className="mp-section-title">Cloud and custom endpoints</div>
            </div>
            <div className="mp-section-head-actions">
              <span className="mp-muted font-mono">{customModels.length} configured</span>
              <button className="mp-btn mp-btn-ghost" onClick={() => { setModelToEdit(null); setIsCloudModalOpen(true); }}>
                <PlusIcon size={12} /> Add
              </button>
            </div>
          </div>

          <div className="mp-table-wrapper">
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Endpoint</th>
                  <th>Auth</th>
                  <th>Limits</th>
                  <th>Routing</th>
                  <th className="align-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCloud.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="mp-empty compact">
                        <strong>No cloud endpoints yet</strong>
                        <span>Connect Groq, OpenAI, DeepSeek, OpenRouter, LM Studio, or vLLM.</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredCloud.map((model) => {
                  const isGlobal = normalizeModel(globalModel) === normalizeModel(model.modelId);
                  const pins = pinnedCount(model.modelId);
                  const test = testResults[model.modelId];
                  return (
                    <tr key={model.modelId}>
                      <td>
                        <div className="mp-model-cell">
                          <span className={`mp-status-dot cloud ${isGlobal ? '' : 'muted'}`} />
                          <div>
                            <strong>{model.displayName || model.modelId}</strong>
                            <small className="font-mono">{model.provider} · {model.modelId}</small>
                            {healthFor(model.modelId) && (
                              <div
                                className={`mp-test-pill ${healthClass(healthFor(model.modelId)!.status)}`}
                                title={`${healthFor(model.modelId)!.successes}/${healthFor(model.modelId)!.requests} successful requests in the last 24h`}
                              >
                                {healthFor(model.modelId)!.successRate}% success · {healthFor(model.modelId)!.requests} req
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="font-mono mp-endpoint-cell">{model.apiBase}</td>
                      <td>
                        <span className="mp-muted">{model.hasApiKey ? 'Key stored' : 'No key'}</span>
                        {test && (
                          <div className={`mp-test-pill ${test.ok ? 'ok' : 'error'}`} title={test.message}>
                            {test.ok ? `${Math.round(test.latencyMs || 0)} ms` : test.errorType || 'failed'}
                          </div>
                        )}
                      </td>
                      <td className="font-mono">
                        <div>{model.contextWindow ? `${model.contextWindow.toLocaleString()} ctx` : 'ctx n/a'}</div>
                        <div className="mp-table-secondary">
                          {model.inputCostPerMillion != null || model.outputCostPerMillion != null
                            ? `$${model.inputCostPerMillion ?? 0}/$${model.outputCostPerMillion ?? 0} per 1M`
                            : 'Unpriced'}
                        </div>
                      </td>
                      <td>
                        <div className="mp-routing-cell">
                          {isGlobal && <span className="mp-badge success">Global</span>}
                          {pins > 0 && <span className="mp-badge neutral">{pins} pinned</span>}
                          {!isGlobal && pins === 0 && <span className="mp-muted">Available</span>}
                        </div>
                      </td>
                      <td>
                        <div className="mp-row-actions">
                          <button className="mp-btn mp-btn-ghost" onClick={() => handleTestModel(model)} disabled={testingModel === model.modelId}>
                            <ZapIcon size={11} />
                            {testingModel === model.modelId ? 'Testing' : 'Test'}
                          </button>
                          {!isGlobal && (
                            <button className="mp-btn mp-btn-ghost" onClick={() => handleSwitch(model.modelId)} disabled={switching}>
                              Make global
                            </button>
                          )}
                          <button className="mp-icon-btn" onClick={() => { setModelToEdit(model); setIsCloudModalOpen(true); }} title="Edit model">
                            Edit
                          </button>
                          <button className="mp-icon-btn danger" onClick={() => setModelToDelete(model)} title="Delete model">
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AddCloudModelModal
        isOpen={isCloudModalOpen}
        modelToEdit={modelToEdit}
        onClose={() => { setIsCloudModalOpen(false); setModelToEdit(null); }}
        onModelAdded={async () => {
          await loadModels();
          onModelSwitched?.();
          flash(true, modelToEdit ? 'Model updated.' : 'Model added and available for routing.');
        }}
      />

      <ConfirmModal
        isOpen={!!modelToDelete}
        title="Delete model endpoint"
        message={`Remove "${modelToDelete?.displayName || modelToDelete?.modelId}" from routing?`}
        subMessage="Applications pinned to this model will fail until they are repointed."
        confirmLabel="Delete model"
        isDanger={true}
        onConfirm={confirmDeleteCloud}
        onClose={() => setModelToDelete(null)}
      />
    </div>
  );
};
