import React, { useState, useEffect } from 'react';
import { OllamaModelInfo, CustomCloudModel } from '../types/analytics';
import { 
  fetchInstalledModels, 
  deleteCustomCloudModel, 
  setActiveModel
} from '../api/client';
import { AddCloudModelModal } from './AddCloudModelModal';
import { ConfirmModal } from './ConfirmModal';
import {
  SearchIcon,
  CheckIcon,
  TrashIcon
} from './icons/Icons';

interface ModelsHubViewProps {
  onModelSwitched?: () => void;
  refreshTrigger?: number;
}

export const ModelsHubView: React.FC<ModelsHubViewProps> = ({
  onModelSwitched,
  refreshTrigger = 0
}) => {
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [customModels, setCustomModels] = useState<CustomCloudModel[]>([]);
  const [activeModel, setActiveModelName] = useState<string>('qwen2.5:3b');
  const [filterType, setFilterType] = useState<'all' | 'local' | 'cloud'>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState<boolean>(false);
  const [switching, setSwitching] = useState<boolean>(false);
  const [modelToDelete, setModelToDelete] = useState<CustomCloudModel | null>(null);

  const loadModels = async () => {
    try {
      setLoading(true);
      const modelsRes = await fetchInstalledModels().catch(() => null);
      if (modelsRes) {
        setOllamaModels(modelsRes.models || []);
        setCustomModels(modelsRes.customModels || []);
        if (modelsRes.activeModel) setActiveModelName(modelsRes.activeModel);
      }
    } catch (err: any) {
      console.error('Failed to load models in ModelsHub:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, [refreshTrigger]);

  const handleSwitch = async (model: string) => {
    try {
      setSwitching(true);
      await setActiveModel(model);
      setActiveModelName(model);
      if (onModelSwitched) onModelSwitched();
      await loadModels();
    } catch (err: any) {
      alert(`Failed to switch model: ${err.message}`);
    } finally {
      setSwitching(false);
    }
  };

  const confirmDeleteCloud = async () => {
    if (!modelToDelete) return;
    try {
      await deleteCustomCloudModel(modelToDelete.modelId);
      setCustomModels(prev => prev.filter(m => m.modelId !== modelToDelete.modelId));
      if (onModelSwitched) onModelSwitched();
      await loadModels();
    } catch (err: any) {
      alert(`Failed to delete cloud model: ${err.message}`);
    } finally {
      setModelToDelete(null);
    }
  };

  const totalMounted = ollamaModels.length + customModels.length;

  // Active model info
  const activeCustom = customModels.find(cm => cm.modelId === activeModel);
  const activeLocal = ollamaModels.find(m => m.name === activeModel || m.name.includes(activeModel));
  const isCloud = !!activeCustom;

  // Filtered lists
  const filteredLocal = ollamaModels.filter(m => 
    !searchFilter.trim() || m.name.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const filteredCloud = customModels.filter(c => 
    !searchFilter.trim() || c.modelId.toLowerCase().includes(searchFilter.toLowerCase()) || (c.displayName && c.displayName.toLowerCase().includes(searchFilter.toLowerCase()))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Header Bar: Title, Search, Filter Pills & Add Model Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>
              Models & Providers
            </h2>
            <span
              className="font-mono"
              style={{
                fontSize: '0.6875rem',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid #1e2433',
                padding: '2px 7px',
                borderRadius: '4px',
                color: '#94a3b8'
              }}
            >
              {totalMounted} Available
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            View local Ollama models, add custom API / server endpoints, and switch your active routing model.
          </p>
        </div>

        {/* Filter & Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }} className="font-mono">
          {/* Search Box */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#0c0e14',
              border: '1px solid #1e2433',
              borderRadius: '6px',
              padding: '4px 8px'
            }}
          >
            <span style={{ color: '#64748b' }}>
              <SearchIcon size={13} />
            </span>
            <input
              type="text"
              placeholder="Search models or providers..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#f8fafc',
                fontSize: '0.75rem',
                outline: 'none',
                width: '180px'
              }}
            />
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '3px' }}>
            <button
              onClick={() => setFilterType('all')}
              style={{
                background: filterType === 'all' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: '1px solid',
                borderColor: filterType === 'all' ? '#2b3345' : 'transparent',
                color: filterType === 'all' ? '#f8fafc' : '#64748b',
                padding: '4px 10px',
                borderRadius: '5px',
                fontSize: '0.6875rem',
                cursor: 'pointer'
              }}
            >
              All ({totalMounted})
            </button>
            <button
              onClick={() => setFilterType('local')}
              style={{
                background: filterType === 'local' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: '1px solid',
                borderColor: filterType === 'local' ? '#2b3345' : 'transparent',
                color: filterType === 'local' ? '#f8fafc' : '#64748b',
                padding: '4px 10px',
                borderRadius: '5px',
                fontSize: '0.6875rem',
                cursor: 'pointer'
              }}
            >
              Local Ollama ({ollamaModels.length})
            </button>
            <button
              onClick={() => setFilterType('cloud')}
              style={{
                background: filterType === 'cloud' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: '1px solid',
                borderColor: filterType === 'cloud' ? '#2b3345' : 'transparent',
                color: filterType === 'cloud' ? '#f8fafc' : '#64748b',
                padding: '4px 10px',
                borderRadius: '5px',
                fontSize: '0.6875rem',
                cursor: 'pointer'
              }}
            >
              Custom Endpoints ({customModels.length})
            </button>
          </div>

          {/* Add Model Button */}
          <button
            onClick={() => setIsCloudModalOpen(true)}
            style={{
              background: '#f97316',
              color: '#0c0e14',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>+ Add Model</span>
          </button>
        </div>
      </div>

      {/* 2. Active Model Status Card */}
      <div
        className="mp-card"
        style={{
          background: 'linear-gradient(180deg, #12151e 0%, #0e1117 100%)',
          border: '1px solid #232938'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }} className="font-mono">
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
              <span style={{ fontSize: '0.6875rem', color: '#10b981', fontWeight: 700, letterSpacing: '0.04em' }}>
                CURRENTLY ACTIVE TARGET
              </span>
              <span style={{ fontSize: '0.6875rem', color: '#64748b' }}>
                {isCloud ? `Provider: ${activeCustom?.provider.toUpperCase()}` : 'Provider: Local Ollama'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f8fafc' }} className="font-mono">
                {activeModel}
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.6875rem',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid #1e2433',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  color: '#94a3b8'
                }}
              >
                {isCloud ? `${activeCustom?.apiBase}` : 'http://localhost:11434'}
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.6875rem',
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  color: '#10b981'
                }}
              >
                {isCloud ? 'Cloud API' : (activeLocal?.size ? `${activeLocal.size} VRAM` : 'Resident')}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} className="font-mono">
            <span
              style={{
                fontSize: '0.6875rem',
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                padding: '5px 12px',
                borderRadius: '6px',
                fontWeight: 700
              }}
            >
              ● Active Model Ready
            </span>
          </div>
        </div>
      </div>

      {/* 3. Local Ollama Models Table */}
      {(filterType === 'all' || filterType === 'local') && (
        <div className="mp-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f97316' }} />
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f8fafc' }}>
                Local Ollama Models
              </span>
              <span className="font-mono" style={{ fontSize: '0.6875rem', color: '#64748b' }}>
                (Host: http://localhost:11434)
              </span>
            </div>
            <span className="font-mono" style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>
              {ollamaModels.length} installed models
            </span>
          </div>

          <div className="mp-table-wrapper" style={{ overflowX: 'auto' }}>
            <table className="mp-table font-mono" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>MODEL ID</th>
                  <th>PARAMETERS & ARCHITECTURE</th>
                  <th>SIZE ON DISK / VRAM</th>
                  <th>STATUS</th>
                  <th style={{ textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocal.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                      {loading ? 'Discovering Ollama models...' : 'No local Ollama models found.'}
                    </td>
                  </tr>
                ) : (
                  filteredLocal.map((m) => {
                    const isActive = activeModel === m.name || activeModel.includes(m.name);
                    return (
                      <tr key={m.name}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isActive ? '#10b981' : '#475569' }} />
                            <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.8125rem' }}>
                              {m.name}
                            </span>
                          </div>
                        </td>
                        <td style={{ color: '#94a3b8', fontSize: '0.6875rem' }}>
                          {m.parameterSize || 'Standard'} · {m.quantization || 'Q4_K_M'} · {m.family || 'GGUF'}
                        </td>
                        <td style={{ color: '#e2e8f0' }}>
                          {m.size}
                        </td>
                        <td>
                          {isActive ? (
                            <span
                              style={{
                                color: '#10b981',
                                background: 'rgba(16, 185, 129, 0.12)',
                                border: '1px solid rgba(16, 185, 129, 0.25)',
                                padding: '2px 7px',
                                borderRadius: '4px',
                                fontSize: '0.6875rem',
                                fontWeight: 700
                              }}
                            >
                              Active
                            </span>
                          ) : (
                            <span style={{ color: '#64748b', fontSize: '0.6875rem' }}>
                              Installed
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isActive ? (
                            <span style={{ color: '#10b981', fontSize: '0.6875rem', fontWeight: 600 }}>
                              Current Active
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSwitch(m.name)}
                              disabled={switching}
                              className="mp-btn-ghost font-mono"
                              style={{ fontSize: '0.6875rem', padding: '3px 10px' }}
                            >
                              Set Active
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Custom Model Endpoints Table */}
      {(filterType === 'all' || filterType === 'cloud') && (
        <div className="mp-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8' }} />
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f8fafc' }}>
                Custom & External Model Endpoints
              </span>
            </div>
            <span className="font-mono" style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>
              {customModels.length} custom endpoints
            </span>
          </div>

          <div className="mp-table-wrapper" style={{ overflowX: 'auto' }}>
            <table className="mp-table font-mono" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>MODEL & PROVIDER</th>
                  <th>ENDPOINT BASE URL</th>
                  <th>AUTH STATUS</th>
                  <th>STATUS</th>
                  <th style={{ textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredCloud.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                      No custom models added yet. Click "+ Add Model" above to connect LM Studio, vLLM, or cloud APIs.
                    </td>
                  </tr>
                ) : (
                  filteredCloud.map((cm) => {
                    const isActive = activeModel === cm.modelId;
                    return (
                      <tr key={cm.modelId}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isActive ? '#10b981' : '#475569' }} />
                            <div>
                              <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.8125rem' }}>
                                {cm.displayName || cm.modelId}
                              </div>
                              <div style={{ fontSize: '0.625rem', color: '#64748b', textTransform: 'uppercase' }}>
                                {cm.provider} · {cm.modelId}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ color: '#38bdf8', fontSize: '0.75rem' }}>
                          {cm.apiBase}
                        </td>
                        <td style={{ color: '#94a3b8', fontSize: '0.6875rem' }}>
                          {cm.hasApiKey ? 'API Key Configured' : 'Public / Local'}
                        </td>
                        <td>
                          {isActive ? (
                            <span
                              style={{
                                color: '#10b981',
                                background: 'rgba(16, 185, 129, 0.12)',
                                border: '1px solid rgba(16, 185, 129, 0.25)',
                                padding: '2px 7px',
                                borderRadius: '4px',
                                fontSize: '0.6875rem',
                                fontWeight: 700
                              }}
                            >
                              Active
                            </span>
                          ) : (
                            <span style={{ color: '#64748b', fontSize: '0.6875rem' }}>
                              Available
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                            {isActive ? (
                              <span style={{ color: '#10b981', fontSize: '0.6875rem', fontWeight: 600 }}>
                                Current Active
                              </span>
                            ) : (
                              <button
                                onClick={() => handleSwitch(cm.modelId)}
                                disabled={switching}
                                className="mp-btn-ghost font-mono"
                                style={{ fontSize: '0.6875rem', padding: '3px 10px' }}
                              >
                                Set Active
                              </button>
                            )}

                            <button
                              onClick={() => setModelToDelete(cm)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#64748b',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'inline-flex',
                                alignItems: 'center'
                              }}
                              title="Delete this cloud model"
                            >
                              <TrashIcon size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Custom Cloud Model Modal */}
      <AddCloudModelModal
        isOpen={isCloudModalOpen}
        onClose={() => setIsCloudModalOpen(false)}
        onModelAdded={async () => {
          await loadModels();
          if (onModelSwitched) onModelSwitched();
        }}
      />

      {/* Confirmation Modal for Cloud Model Deletion */}
      <ConfirmModal
        isOpen={!!modelToDelete}
        title="Delete Model Endpoint"
        message={`Are you sure you want to remove upstream endpoint "${modelToDelete?.displayName || modelToDelete?.modelId}"?`}
        subMessage="This endpoint will no longer be available for dynamic routing."
        confirmLabel="Delete Model"
        isDanger={true}
        onConfirm={confirmDeleteCloud}
        onClose={() => setModelToDelete(null)}
      />
    </div>
  );
};
