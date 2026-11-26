import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationItem } from '../types/analytics';
import type { NavTab } from './AppSidebar';
import { GatewayConnectionCard } from './GatewayConnectionCard';
import { getBrowserGatewayBaseUrl, getGatewayConnectionOptions } from '../utils/gatewayConnection';
import { copyText } from '../utils/clipboard';
import {
  ApplicationsIcon,
  AlertTriangleIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  CostsIcon,
  FailoverIcon,
  HelpIcon,
  LogsIcon,
  ModelsIcon,
  OverviewIcon,
  PlaygroundIcon,
  SearchIcon,
  ShieldCheckIcon,
  ZapIcon
} from './icons/Icons';

type CodeLanguage = 'curl' | 'python' | 'node' | 'csharp';

interface HelpViewProps {
  applications?: ApplicationItem[];
  selectedAppId?: string | null;
  activeModel?: string;
  gatewayPort?: number;
  onNavigateToTab?: (tab: NavTab) => void;
}

interface ManualSection {
  id: string;
  title: string;
  summary: string;
  icon: React.ReactNode;
  searchText: string;
  content: React.ReactNode;
}

const CODE_LANGUAGES: Array<{ id: CodeLanguage; label: string }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'python', label: 'Python' },
  { id: 'node', label: 'Node.js' },
  { id: 'csharp', label: 'C#' }
];

const DASHBOARD_CARDS: Array<{
  tab: NavTab;
  title: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    tab: 'overview',
    title: 'Overview',
    description: 'Traffic KPIs, latency, token usage, model health, timeframe controls, and the latency profiler.',
    icon: <OverviewIcon size={16} />
  },
  {
    tab: 'apps',
    title: 'Applications',
    description: 'Create API clients, copy keys, choose global or pinned routing, run test prompts, and rotate keys.',
    icon: <ApplicationsIcon size={16} />
  },
  {
    tab: 'models',
    title: 'Models & Providers',
    description: 'See Ollama models, add OpenAI-compatible or Anthropic cloud providers, switch the global model, and run benchmarks.',
    icon: <ModelsIcon size={16} />
  },
  {
    tab: 'logs',
    title: 'Request Logs',
    description: 'Inspect request telemetry, filter by app or status, export CSV, view failover traces, and replay prompts.',
    icon: <LogsIcon size={16} />
  },
  {
    tab: 'costs',
    title: 'Costs & Alerts',
    description: 'Track spend, configure daily or monthly budgets, avoid runaway usage, and review budget alerts.',
    icon: <CostsIcon size={16} />
  },
  {
    tab: 'failover',
    title: 'Failover',
    description: 'Give each application an ordered fallback chain and inspect recent fallback attempts.',
    icon: <FailoverIcon size={16} />
  },
  {
    tab: 'playground',
    title: 'Playground',
    description: 'Send test prompts, compare models, inspect latency and token counts, and experiment safely.',
    icon: <PlaygroundIcon size={16} />
  }
];

const CodeBlock: React.FC<{ label: string; code: string }> = ({ label, code }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const handleCopy = async () => {
    if (!(await copyText(code))) {
      setCopied(false);
      return;
    }
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mp-manual-code">
      <div className="mp-manual-code-head">
        <span>{label}</span>
        <button type="button" onClick={handleCopy} className="mp-manual-code-copy">
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
};

const InfoCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mp-manual-info-card">
    <strong>{title}</strong>
    <div className="mp-manual-info-body">{children}</div>
  </div>
);

const Callout: React.FC<{
  tone?: 'note' | 'warn' | 'success';
  title: string;
  children: React.ReactNode;
}> = ({ tone = 'note', title, children }) => (
  <div className={`mp-manual-callout ${tone}`}>
    {tone === 'warn' ? <AlertTriangleIcon size={15} /> : <ShieldCheckIcon size={15} />}
    <div>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  </div>
);

export const HelpView: React.FC<HelpViewProps> = ({
  applications = [],
  selectedAppId = null,
  activeModel = 'qwen2.5:3b',
  gatewayPort = 4101,
  onNavigateToTab
}) => {
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState('quick-start');
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState(getBrowserGatewayBaseUrl(gatewayPort));
  const [language, setLanguage] = useState<CodeLanguage>('curl');

  const selectedApp = useMemo(
    () => applications.find((app) => app.id === selectedAppId) || applications[0] || null,
    [applications, selectedAppId]
  );
  const scopeLabel = selectedAppId === null
    ? 'All applications'
    : selectedApp?.name || 'No application selected';
  const dashboardUrl = typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:4100';
  const gatewayOptions = useMemo(
    () => getGatewayConnectionOptions(gatewayPort),
    [gatewayPort]
  );

  useEffect(() => {
    setGatewayBaseUrl(getBrowserGatewayBaseUrl(gatewayPort));
  }, [gatewayPort]);

  const handleNavigate = (tab: NavTab) => onNavigateToTab?.(tab);

  const codeExamples = useMemo<Record<CodeLanguage, string>>(() => ({
    curl: `curl "${gatewayBaseUrl}/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $SLIR_API_KEY" \\
  -d '{
    "model": "active-model",
    "messages": [
      { "role": "user", "content": "Hello from SLIR" }
    ]
  }'`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${gatewayBaseUrl}",
    api_key="mp_live_your_application_key",
)

response = client.chat.completions.create(
    model="active-model",
    messages=[{"role": "user", "content": "Hello from SLIR"}],
)

print(response.choices[0].message.content)`,
    node: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${gatewayBaseUrl}",
  apiKey: process.env.SLIR_API_KEY,
});

const response = await client.chat.completions.create({
  model: "active-model",
  messages: [{ role: "user", content: "Hello from SLIR" }],
});

console.log(response.choices[0].message.content);`,
    csharp: `using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

using var client = new HttpClient
{
    BaseAddress = new Uri("${gatewayBaseUrl}/")
};

client.DefaultRequestHeaders.Authorization =
    new AuthenticationHeaderValue(
        "Bearer",
        Environment.GetEnvironmentVariable("SLIR_API_KEY"));

var payload = new
{
    model = "active-model",
    messages = new[] { new { role = "user", content = "Hello from SLIR" } }
};

var response = await client.PostAsync(
    "chat/completions",
    new StringContent(
        JsonSerializer.Serialize(payload),
        Encoding.UTF8,
        "application/json"));

Console.WriteLine(await response.Content.ReadAsStringAsync());`
  }), [gatewayBaseUrl]);

  const sections: ManualSection[] = [
    {
      id: 'quick-start',
      title: 'Quick start',
      summary: 'Create an app, choose a gateway URL, send your first request, and confirm telemetry.',
      icon: <ZapIcon size={17} />,
      searchText: 'install setup first request start onboarding api key application gateway url curl python node dotnet docker connection anthropic sdk x-api-key v1/messages claude',
      content: (
        <>
          <div className="mp-manual-step-grid">
            <div className="mp-manual-step">
              <span className="mp-manual-step-number">01</span>
              <div>
                <strong>Create an application</strong>
                <p>Open Applications and create a client. SLIR generates an app-scoped <code>mp_live_...</code> key.</p>
              </div>
            </div>
            <div className="mp-manual-step">
              <span className="mp-manual-step-number">02</span>
              <div>
                <strong>Choose the right gateway URL</strong>
                <p>Use the browser URL for apps on this machine. Use the Docker options when your client runs in a container.</p>
              </div>
            </div>
            <div className="mp-manual-step">
              <span className="mp-manual-step-number">03</span>
              <div>
                <strong>Point your OpenAI client at SLIR</strong>
                <p>Set the base URL and use your app key as the bearer token. Keep the model as <code>active-model</code>.</p>
              </div>
            </div>
            <div className="mp-manual-step">
              <span className="mp-manual-step-number">04</span>
              <div>
                <strong>Verify the request</strong>
                <p>Open Request Logs or Overview. Usage, latency, model, status, and failover data appear automatically.</p>
              </div>
            </div>
          </div>

          {applications.length === 0 && (
            <Callout tone="warn" title="No applications yet">
              Create your first application before connecting a client. The API key is what attributes usage, budgets, and failover to the right app.
            </Callout>
          )}

          <GatewayConnectionCard value={gatewayBaseUrl} onChange={setGatewayBaseUrl} />

          <div className="mp-manual-endpoint-grid">
            <div className="mp-manual-endpoint">
              <span>Dashboard</span>
              <code>{dashboardUrl}</code>
              <small>Web UI, analytics, budgets, and logs.</small>
            </div>
            <div className="mp-manual-endpoint">
              <span>Gateway base URL</span>
              <code>{gatewayBaseUrl}</code>
              <small>OpenAI-compatible client endpoint.</small>
            </div>
          </div>

          <div className="mp-manual-actions">
            <button type="button" className="mp-btn-primary" onClick={() => handleNavigate('apps')}>
              <ApplicationsIcon size={14} />
              Open Applications
            </button>
            <button type="button" className="mp-btn-ghost" onClick={() => handleNavigate('playground')}>
              <PlaygroundIcon size={14} />
              Try the Playground
            </button>
          </div>
        </>
      )
    },
    {
      id: 'core-concepts',
      title: 'Core concepts',
      summary: 'Applications, API keys, the global active model, routing modes, analytics scope, and privacy.',
      icon: <ShieldCheckIcon size={17} />,
      searchText: 'concept application api key token active model global pinned routing scope analytics privacy prompt retention follow global fallback',
      content: (
        <>
          <div className="mp-manual-state-grid">
            <div className="mp-manual-state">
              <span>Analytics scope</span>
              <strong>{scopeLabel}</strong>
            </div>
            <div className="mp-manual-state">
              <span>Global active model</span>
              <strong className="font-mono">{activeModel}</strong>
            </div>
            <div className="mp-manual-state">
              <span>Gateway port</span>
              <strong className="font-mono">{gatewayPort}</strong>
            </div>
            <div className="mp-manual-state">
              <span>Applications</span>
              <strong className="font-mono">{applications.length}</strong>
            </div>
          </div>

          <div className="mp-manual-info-grid">
            <InfoCard title="Applications and API keys">
              <p>An application is an API client with its own key, routing mode, budget scope, failover chain, and usage history. Use one key per client or environment.</p>
              <p>Keys start with <code>mp_live_</code>. An unknown key receives <code>401 Unauthorized</code>.</p>
            </InfoCard>
            <InfoCard title="Global active model">
              <p>The global model is the shared default shown in the top bar. Change it from Overview or Models. The next request using <code>active-model</code> resolves to the new model without a restart.</p>
            </InfoCard>
            <InfoCard title="Follow global vs pinned">
              <p><strong>Follow global</strong> stores <code>active-model</code> as the app default. <strong>Pinned</strong> stores a concrete model instead, so that app ignores global model switches.</p>
            </InfoCard>
            <InfoCard title="Analytics scope">
              <p>The sidebar scope filters metrics and logs. It does not change which model an application uses or which failover chain is active.</p>
            </InfoCard>
            <InfoCard title="Privacy">
              <p>SLIR records operational telemetry such as model, latency, token counts, status, and cost. Prompt and completion text are not retained for analytics.</p>
            </InfoCard>
            <InfoCard title="Two different URLs">
              <p>The dashboard URL (usually port <code>4100</code>) is for humans. The gateway URL (usually <code>{gatewayBaseUrl}</code>) is for clients. Do not point SDKs at the dashboard page.</p>
            </InfoCard>
          </div>
        </>
      )
    },
    {
      id: 'dashboard-guide',
      title: 'Dashboard guide',
      summary: 'What each tab is for and where to go for common tasks.',
      icon: <OverviewIcon size={17} />,
      searchText: 'dashboard overview applications models logs costs alerts failover playground navigation tabs screen guide usage keyboard shortcuts',
      content: (
        <>
          <div className="mp-manual-nav-grid">
            {DASHBOARD_CARDS.map((card) => (
              <button
                key={card.tab}
                type="button"
                className="mp-manual-nav-card"
                onClick={() => handleNavigate(card.tab)}
              >
                <span className="mp-manual-nav-icon">{card.icon}</span>
                <span className="mp-manual-nav-copy">
                  <strong>{card.title}</strong>
                  <span>{card.description}</span>
                  <span className="mp-manual-nav-link">Open <ChevronRightIcon size={11} /></span>
                </span>
              </button>
            ))}
          </div>
          <InfoCard title="Keyboard shortcuts">
            <p>Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> for the command palette. Press <kbd>g</kbd> then <kbd>o</kbd> Overview, <kbd>a</kbd> Applications, <kbd>l</kbd> Logs, <kbd>m</kbd> Models, <kbd>c</kbd> Costs, <kbd>f</kbd> Failover, <kbd>p</kbd> Playground, or <kbd>h</kbd> Help. Press <kbd>?</kbd> to open this manual.</p>
          </InfoCard>
        </>
      )
    },
    {
      id: 'connect',
      title: 'Connect your application',
      summary: 'Base URLs for local and Docker clients, authentication, code samples, and streaming.',
      icon: <PlaygroundIcon size={17} />,
      searchText: 'connect client sdk openai compatible base url docker compose host.docker.internal authentication bearer api key curl python node csharp streaming stream models endpoint',
      content: (
        <>
          <div className="mp-manual-option-list">
            {gatewayOptions.map((option) => (
              <div key={option.target} className="mp-manual-option">
                <div>
                  <strong>{option.label}</strong>
                  <span>{option.hint}</span>
                </div>
                <code>{option.url}</code>
              </div>
            ))}
          </div>

          <Callout title="Using a domain or reverse proxy?">
            Set <code>SLIR_PUBLIC_BASE_URL</code> on the backend, for example <code>https://ai.example.com/v1</code>. The dashboard then shows that single URL for every client. Missing <code>/v1</code> is added automatically.
          </Callout>

          <div className="mp-manual-info-grid">
            <InfoCard title="Authentication">
              <p>Send the app key as a bearer token:</p>
              <code className="mp-manual-code-inline">Authorization: Bearer mp_live_your_application_key</code>
              <p>Requests without an app key can still be served, but they are not attributed to an app and cannot use per-app budgets or failover.</p>
            </InfoCard>
            <InfoCard title="Model selection">
              <p>Use <code>active-model</code> to follow the app default or global model. Send a concrete model ID to override the alias for that request.</p>
              <p>List available IDs with <code>GET {gatewayBaseUrl}/models</code>.</p>
            </InfoCard>
          </div>

          <div className="mp-manual-code-tabs" role="tablist" aria-label="Client language">
            {CODE_LANGUAGES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={language === option.id}
                className={language === option.id ? 'active' : ''}
                onClick={() => setLanguage(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <CodeBlock
            label={CODE_LANGUAGES.find((option) => option.id === language)?.label || 'Code'}
            code={codeExamples[language]}
          />

          <Callout title="Using the official Anthropic SDK?">
            Point the Anthropic client at the gateway root without <code>/v1</code>; the SDK appends <code>/v1/messages</code>. Pass your app key as <code>api_key</code>, which the SDK sends as <code>x-api-key</code>. Requests use the same routing, failover, budgets, and telemetry, and responses, streams, and errors come back in Anthropic format. Use a model id configured in the dashboard, such as <code>claude-model</code> or <code>active-model</code>.
          </Callout>

          <div className="mp-manual-info-grid">
            <InfoCard title="Streaming">
              <p>OpenAI-compatible streaming works with the gateway. Add <code>"stream": true</code> to the request body or use the SDK streaming API.</p>
              <p>Failover can only switch models before the first response chunk. Once streaming starts, that attempt is final.</p>
            </InfoCard>
            <InfoCard title="Environment variable">
              <p>Store the key outside source control. In PowerShell:</p>
              <code className="mp-manual-code-inline">$env:SLIR_API_KEY = "mp_live_..."</code>
              <p>Then reference <code>SLIR_API_KEY</code> in your client configuration.</p>
            </InfoCard>
          </div>
        </>
      )
    },
    {
      id: 'models-routing',
      title: 'Models and routing',
      summary: 'Local Ollama models, cloud providers, alias resolution, pinned apps, and explicit model requests.',
      icon: <ModelsIcon size={17} />,
      searchText: 'models providers ollama cloud custom endpoint active-model alias routing follow global pinned explicit model request failover discovery list',
      content: (
        <>
          <div className="mp-manual-info-grid">
            <InfoCard title="Local Ollama models">
              <p>SLIR discovers models installed in Ollama. If Ollama is unreachable, the Models tab shows a connection warning and only cloud models remain usable.</p>
            </InfoCard>
            <InfoCard title="Custom and cloud models">
              <p>Add any OpenAI-compatible endpoint under Models. Custom models are matched before local Ollama models with the same ID.</p>
            </InfoCard>
            <InfoCard title="How active-model resolves">
              <p>If the app follows global, <code>active-model</code> resolves to the current global model. If the app is pinned, it resolves to the pinned model.</p>
            </InfoCard>
            <InfoCard title="Explicit models">
              <p>Sending a concrete model ID bypasses the app default, but requests authenticated with the app key still use that app's failover chain.</p>
            </InfoCard>
          </div>

          <ol className="mp-manual-numbered">
            <li>Open Models & Providers to see installed Ollama models and custom endpoints.</li>
            <li>Switch the global model there or from Overview. Existing clients using <code>active-model</code> switch immediately.</li>
            <li>Open Applications to pin one app to a specific model, or choose <strong>Follow global</strong>.</li>
            <li>Use Request Logs to verify which concrete model served each request.</li>
          </ol>

          <div className="mp-manual-actions">
            <button type="button" className="mp-btn-ghost" onClick={() => handleNavigate('models')}>
              <ModelsIcon size={14} />
              Manage Models
            </button>
            <button type="button" className="mp-btn-ghost" onClick={() => handleNavigate('apps')}>
              <ApplicationsIcon size={14} />
              Routing Settings
            </button>
          </div>
        </>
      )
    },
    {
      id: 'failover',
      title: 'Automatic failover',
      summary: 'Ordered fallback models for each app, retry triggers, budgets, streaming limits, and telemetry.',
      icon: <FailoverIcon size={17} />,
      searchText: 'failover fallback chain retry 429 rate limit timeout network 5xx budget streaming trace recovery resilience provider',
      content: (
        <>
          <div className="mp-manual-info-grid">
            <InfoCard title="Configure it">
              <p>Open Failover, select an application, enable automatic failover, and add up to five fallback models in order. Save the chain.</p>
            </InfoCard>
            <InfoCard title="When it triggers">
              <p>HTTP 429 rate limits, HTTP 408, provider 5xx responses, timeouts, connection failures, and other transport errors move to the next model.</p>
            </InfoCard>
            <InfoCard title="When it does not">
              <p>Other 4xx responses such as an invalid request or unknown model stop immediately. A primary hard-budget block also remains a hard stop.</p>
            </InfoCard>
            <InfoCard title="Who gets it">
              <p>Failover is per application and requires an <code>mp_live_</code> app key. It applies to both <code>active-model</code> and explicit model requests.</p>
            </InfoCard>
          </div>

          <Callout tone="warn" title="Streaming limitation">
            A streaming request can fail over only before the first response chunk is sent. If the provider already started streaming, SLIR cannot safely replace the response.
          </Callout>

          <div className="mp-manual-info-grid">
            <InfoCard title="Budget behavior">
              <p>If the primary model is blocked by a hard budget, the request stops. If a fallback candidate would exceed a blocking budget, it is skipped and the skip is recorded in the failover trace.</p>
            </InfoCard>
            <InfoCard title="What gets logged">
              <p>One request row records the original model, final model, failover reason, attempt count, and a per-attempt trace. Inspect it from Request Logs.</p>
            </InfoCard>
          </div>

          <ul className="mp-manual-bullets">
            <li>The primary model is always tried first, even if it also appears in the fallback list.</li>
            <li>Duplicate models and the <code>active-model</code> alias are rejected in the chain.</li>
            <li>If every candidate fails, the client receives the last upstream error and the full trace remains visible in logs.</li>
            <li>Changing global model or app routing does not automatically change the failover chain.</li>
          </ul>

          <div className="mp-manual-actions">
            <button type="button" className="mp-btn-primary" onClick={() => handleNavigate('failover')}>
              <FailoverIcon size={14} />
              Configure Failover
            </button>
          </div>
        </>
      )
    },
    {
      id: 'costs-budgets',
      title: 'Costs, budgets, and alerts',
      summary: 'Spend tracking, daily or monthly budgets, block versus notify actions, and alert handling.',
      icon: <CostsIcon size={17} />,
      searchText: 'costs spend budget budgets alert alerts daily monthly tokens requests cost block notify warning threshold hard block billing price',
      content: (
        <>
          <div className="mp-manual-info-grid">
            <InfoCard title="Budget scope">
              <p>Budgets can apply globally, to one application, or to one model. Attribution requires an app key on the request.</p>
            </InfoCard>
            <InfoCard title="Periods and metrics">
              <p>Choose a daily or monthly window and cap <strong>cost</strong>, <strong>tokens</strong>, or <strong>requests</strong>.</p>
            </InfoCard>
            <InfoCard title="Notify or block">
              <p><strong>Notify</strong> creates an alert when the warning or limit is reached. <strong>Block</strong> returns HTTP 429 once the limit is exceeded.</p>
            </InfoCard>
            <InfoCard title="Warning threshold">
              <p>Each budget has a warning percentage, commonly 80%. Warnings and limit alerts are deduplicated per budget per period.</p>
            </InfoCard>
          </div>

          <ol className="mp-manual-numbered">
            <li>Open Costs & Alerts and review estimated cost, token totals, and per-app spend.</li>
            <li>Create a budget, choose scope, metric, period, limit, and action.</li>
            <li>Use the bell in the top bar to review unacknowledged alerts.</li>
            <li>Acknowledge alerts after investigating; the badge clears as alerts are acknowledged.</li>
          </ol>

          <Callout title="Costs can be estimated">
            Local models and missing provider usage data may produce estimated costs. Check the cost breakdown in Overview or Logs when accuracy matters.
          </Callout>

          <div className="mp-manual-actions">
            <button type="button" className="mp-btn-ghost" onClick={() => handleNavigate('costs')}>
              <CostsIcon size={14} />
              Manage Budgets
            </button>
          </div>
        </>
      )
    },
    {
      id: 'logs',
      title: 'Request logs and telemetry',
      summary: 'What is recorded, how to inspect a request, export CSV, replay prompts, and read failover data.',
      icon: <LogsIcon size={17} />,
      searchText: 'logs telemetry request inspect trace csv export replay tokens latency status streaming provider cost failover trace filters',
      content: (
        <>
          <div className="mp-manual-info-grid">
            <InfoCard title="Recorded fields">
              <p>Request ID, app, provider, concrete model, status, latency, token counts, cost estimate, streaming flag, timestamp, and errors.</p>
            </InfoCard>
            <InfoCard title="Failover fields">
              <p>Failover used, source model, reason, attempt count, and JSON trace with each candidate's outcome and budget skips.</p>
            </InfoCard>
            <InfoCard title="Inspect and export">
              <p>Select a row to open the inspector. Use filters to narrow the list, and export the current view as CSV.</p>
            </InfoCard>
            <InfoCard title="Replay">
              <p>The Replay action opens the Playground so you can retry an idea with another model. Prompts are not stored, so compose the message again there.</p>
            </InfoCard>
          </div>

          <ul className="mp-manual-bullets">
            <li>Filter by application, status, model, timeframe, or search text.</li>
            <li>Failover rows carry a badge; the inspector shows the ordered trace.</li>
            <li>Use the sidebar analytics scope to focus the rest of the dashboard on one app.</li>
            <li>Export before a database reset if you need a historical record.</li>
          </ul>

          <div className="mp-manual-actions">
            <button type="button" className="mp-btn-ghost" onClick={() => handleNavigate('logs')}>
              <LogsIcon size={14} />
              Open Request Logs
            </button>
          </div>
        </>
      )
    },
    {
      id: 'configuration',
      title: 'Configuration and deployment',
      summary: 'Ports, environment variables, Docker networking, persistence, and security notes.',
      icon: <HelpIcon size={17} />,
      searchText: 'configuration environment variables env port docker compose deployment persistence database volume retention cors security public url proxy reset',
      content: (
        <>
          <div className="mp-manual-table-wrap">
            <table className="mp-manual-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><code>PORT</code></td><td>Gateway listener port inside the backend process. Default <code>4101</code>.</td></tr>
                <tr><td><code>OLLAMA_URL</code></td><td>Ollama endpoint, for example <code>http://host.docker.internal:11434</code>.</td></tr>
                <tr><td><code>SLIR_PUBLIC_BASE_URL</code></td><td>Fixed public gateway URL for reverse proxies or shared environments.</td></tr>
                <tr><td><code>DATABASE_PATH</code></td><td>SQLite file path. Default <code>./data/monitor.db</code>.</td></tr>
                <tr><td><code>RETENTION_DAYS</code></td><td>Automatically prune telemetry older than this many days. <code>0</code> disables pruning.</td></tr>
                <tr><td><code>CORS_ORIGIN</code></td><td>Comma-separated allowed dashboard origins.</td></tr>
                <tr><td><code>INGEST_API_KEY</code></td><td>Admin bearer token for protected ingest status endpoints.</td></tr>
                <tr><td><code>SLIR_DASHBOARD_PORT</code></td><td>Compose host port mapped to the dashboard.</td></tr>
                <tr><td><code>SLIR_GATEWAY_PORT</code></td><td>Compose host port mapped to the gateway.</td></tr>
              </tbody>
            </table>
          </div>

          <div className="mp-manual-info-grid">
            <InfoCard title="Docker networking">
              <p>Use <code>http://app:{gatewayPort}/v1</code> when the client is another service in the same Compose project. Use <code>http://host.docker.internal:{gatewayPort}/v1</code> from a container outside the project.</p>
            </InfoCard>
            <InfoCard title="Linux containers">
              <p>Add <code>extra_hosts: ["host.docker.internal:host-gateway"]</code> to the client service so it can reach the host gateway.</p>
            </InfoCard>
            <InfoCard title="Persistence">
              <p>SQLite data lives in the configured database path or Docker volume. Resetting the database from the top bar clears telemetry and optionally applications.</p>
            </InfoCard>
            <InfoCard title="Security">
              <p>SLIR is intended for local or trusted networks. Set a strong <code>INGEST_API_KEY</code> and place the service behind authentication before exposing it publicly.</p>
            </InfoCard>
          </div>
        </>
      )
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      summary: 'Common connection, authentication, model, failover, budget, streaming, and Docker issues.',
      icon: <AlertTriangleIcon size={17} />,
      searchText: 'troubleshooting fix error offline 401 unauthorized unknown api key model not found failover not working docker connection refused cors budget 429 streaming timeout health check',
      content: (
        <div className="mp-manual-faq">
          <details open>
            <summary>Gateway shows offline or the dashboard cannot load data</summary>
            <p>Check <code>{dashboardUrl.replace(/:\d+$/, '')}:{gatewayPort}/api/health</code>. Confirm the gateway port is mapped and the backend is running. In Docker, the dashboard and gateway may use different host ports.</p>
          </details>
          <details>
            <summary>Requests return 401 Unauthorized</summary>
            <p>The bearer key is unknown. Copy the full app key from Applications. Keys must start with <code>mp_live_</code>. Rotate the key if it was exposed.</p>
          </details>
          <details>
            <summary>The model is not in the list or returns not found</summary>
            <p>Start Ollama and pull the model, or add the cloud model under Models & Providers. Verify the exact model ID returned by <code>GET {gatewayBaseUrl}/models</code>.</p>
          </details>
          <details>
            <summary>Failover is not switching models</summary>
            <p>Confirm the request uses the app's API key, failover is enabled, the chain is saved, and the failure is retryable. Non-429 4xx errors do not fail over, and streaming cannot switch after the first chunk.</p>
          </details>
          <details>
            <summary>A request returns 429 budget_exceeded</summary>
            <p>A blocking budget matched the app or model. Raise or disable the budget, or wait for the daily or monthly period to reset. Check the alert and budget usage in Costs & Alerts.</p>
          </details>
          <details>
            <summary>A Docker client cannot reach the gateway</summary>
            <p>Use the same-Compose service URL, or <code>host.docker.internal</code> outside the project. On Linux, add the host-gateway mapping to the client service.</p>
          </details>
          <details>
            <summary>Streaming fails after the first token</summary>
            <p>Failover cannot replace a stream that already started. Check the upstream provider and retry the request. The logs show which model and attempt failed.</p>
          </details>
          <details>
            <summary>The browser reports a CORS error</summary>
            <p>Add the dashboard origin to <code>CORS_ORIGIN</code> and restart the backend. Server-to-server SDK calls do not use browser CORS.</p>
          </details>
        </div>
      )
    },
    {
      id: 'faq',
      title: 'FAQ',
      summary: 'Short answers about model switching, OpenAI compatibility, privacy, keys, and cloud providers.',
      icon: <HelpIcon size={17} />,
      searchText: 'faq questions does restart change global model openai sdk cloud providers anthropic native messages api claude x-api-key ingress multiple apps same key prompts stored reset database failover global',
      content: (
        <div className="mp-manual-faq">
          <details>
            <summary>Do I need to restart my app when I change models?</summary>
            <p>No. Keep using <code>active-model</code>; the next request resolves to the new global or app-pinned model.</p>
          </details>
          <details>
            <summary>Can I use the official OpenAI SDKs?</summary>
            <p>Yes. Set the base URL to the SLIR gateway and use an app key. Python, Node.js, .NET, Go, and other OpenAI-compatible clients work.</p>
          </details>
          <details>
            <summary>Can I connect the native Anthropic API?</summary>
            <p>Yes. When adding a model, set API format to Anthropic Messages API and use <code>https://api.anthropic.com</code> as the base URL. SLIR converts requests, responses, streaming events, token usage, vision content, tool calls, and JSON structured output, so clients still talk OpenAI.</p>
            <p>SLIR also accepts native Anthropic SDK clients at <code>POST /v1/messages</code> using <code>x-api-key</code>. Those requests run through the same routing, failover, and budgets, and responses come back in Anthropic format. Use a model id configured in the dashboard.</p>
          </details>
          <details>
            <summary>Does SLIR store my prompts?</summary>
            <p>No. Analytics store operational metadata, not prompt or completion text. Provider-side retention policies still apply for cloud models.</p>
          </details>
          <details>
            <summary>Can two applications share one key?</summary>
            <p>It is not recommended. Keys are app-scoped, so sharing them merges attribution, budgets, and failover behavior. Create a separate app per client or environment.</p>
          </details>
          <details>
            <summary>Can I mix local and cloud models in a failover chain?</summary>
            <p>Yes. Any installed Ollama model or configured custom model can be used. Candidate order is the order you save.</p>
          </details>
          <details>
            <summary>Does Follow global change my failover chain?</summary>
            <p>No. Routing mode changes the default model for <code>active-model</code>. Failover settings remain independent.</p>
          </details>
          <details>
            <summary>How do I clear everything and start over?</summary>
            <p>Use Reset DB in the top bar. You can clear telemetry while keeping applications, or include applications in the reset.</p>
          </details>
        </div>
      )
    }
  ];

  const search = query.trim().toLowerCase();
  const filteredSections = search
    ? sections.filter((section) =>
        `${section.title} ${section.summary} ${section.searchText}`.toLowerCase().includes(search)
      )
    : sections;
  const visibleSectionKey = filteredSections.map((section) => section.id).join('|');

  useEffect(() => {
    const visibleIds = visibleSectionKey ? visibleSectionKey.split('|') : [];
    if (visibleIds.length === 0) return;
    if (!visibleIds.includes(activeSection)) {
      setActiveSection(visibleIds[0]);
    }
  }, [visibleSectionKey, activeSection]);

  useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>('[data-manual-section]')
    );
    if (elements.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]?.target instanceof HTMLElement) {
        setActiveSection(visible[0].target.id);
      }
    }, { rootMargin: '-96px 0px -60% 0px', threshold: [0, 1] });

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [visibleSectionKey]);

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="mp-manual-page">
      <div className="mp-manual-header">
        <div>
          <div className="mp-eyebrow">Documentation</div>
          <h1 className="mp-page-title">User Manual</h1>
          <p className="mp-page-subtitle">
            Everything you need to connect clients, switch models, configure failover, monitor usage, and deploy SLIR.
          </p>
        </div>
        <div className="mp-manual-header-meta">
          <span className="mp-manual-version">SLIR v1.0.0</span>
          <span className="mp-manual-scope">{scopeLabel}</span>
        </div>
      </div>

      <div className="mp-manual-toolbar">
        <div className="mp-manual-search">
          <SearchIcon size={14} />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search: API key, Docker, failover, budgets..."
            aria-label="Search the user manual"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
              <CloseIcon size={12} />
            </button>
          )}
        </div>
        <span className="mp-manual-count">
          {filteredSections.length} of {sections.length} sections
        </span>
      </div>

      <div className="mp-manual-layout">
        <aside className="mp-manual-toc" aria-label="User manual contents">
          <div className="mp-manual-toc-title">On this page</div>
          <nav>
            {filteredSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? 'active' : ''}
                onClick={() => scrollToSection(section.id)}
              >
                <span className="mp-manual-toc-icon">{section.icon}</span>
                <span>{section.title}</span>
              </button>
            ))}
          </nav>
          <div className="mp-manual-toc-footer">
            <span className="mp-pulse-dot" />
            Gateway :{gatewayPort}
          </div>
        </aside>

        <div className="mp-manual-content">
          {filteredSections.length === 0 && (
            <div className="mp-empty mp-manual-empty">
              <strong>No sections match "{query}"</strong>
              <span>Try a broader term such as API, Docker, model, failover, budget, or logs.</span>
              <button type="button" className="mp-btn-ghost" onClick={() => setQuery('')}>
                Clear search
              </button>
            </div>
          )}

          {filteredSections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              data-manual-section
              className="mp-manual-section"
            >
              <div className="mp-manual-section-head">
                <span className="mp-manual-section-icon">{section.icon}</span>
                <div>
                  <h2>{section.title}</h2>
                  <p>{section.summary}</p>
                </div>
              </div>
              <div className="mp-manual-section-body">{section.content}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
