# SLIR ⚡ (Switch LLM In Runtime)
### *One API. Any LLM. No Restart.*

[![Docker Backend](https://img.shields.io/badge/Docker%20Hub-varad177%2Fslir--backend-blue?logo=docker)](https://hub.docker.com/r/varad177/slir-backend)
[![Docker Frontend](https://img.shields.io/badge/Docker%20Hub-varad177%2Fslir--frontend-blue?logo=docker)](https://hub.docker.com/r/varad177/slir-frontend)
[![Release](https://img.shields.io/badge/release-v1.0.0-emerald)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A lightweight, developer-first AI Gateway and Model Hub that lets you **hot-switch between local and cloud LLMs in runtime** without touching your code or restarting your servers. 

Built specifically for fast local development with **Node.js Express**, **SQLite (`node:sqlite` in WAL mode)**, and **React 18 + Vite**.

---

## 🎯 The Problem SLIR Solves

When developing AI-powered applications (like chatbots, RAG pipelines, or background agents), developers face two daily frustrations:

1. **The Restart Cycle**: Every time you want to test a different model (e.g. `qwen2.5:1.5b` vs `qwen2.5:3b`, LM Studio, or Groq), you have to change your config, swap API keys, and restart your backend.
2. **The Latency Mystery**: A response takes 3 seconds. *Why?* Did Ollama take 2.5s loading weights into VRAM? Was the context window (`num_ctx`) too large? Did sampling temperature cause runaway tokens? 

**SLIR eliminates both:**
* Point your code to `http://localhost:4101/v1` once with model `active-model`.
* Switch models in **1 click** from your browser — zero code restarts.
* Use the built-in **Latency Profiler** to see the exact breakdown: **Model Load Time (VRAM)** + **Time to First Token (TTFT)** + **Generation Speed (tok/s)**.

---

## 🏛️ How It Works

```
 ┌─────────────────────────────────────────────────────────────┐
 │                     Client Application                      │
 │    (.NET Backend, Python Agent, LangChain, Node, cURL)      │
 │                                                             │
 │   Base URL: http://localhost:4101/v1                        │
 │   Model:    "active-model"                                  │
 └──────────────────────────────┬──────────────────────────────┘
                                │ Standard OpenAI /v1 Protocol
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                     SLIR GATEWAY (:4101)                    │
 │                                                             │
 │  • Dynamic Model Resolver (SQLite 'active_model' setting)   │
 │  • Dev Defaults Injection (temperature & num_ctx)           │
 │  • High-Precision Latency Telemetry (load, TTFT, eval)      │
 └──────────────┬───────────────────────────────┬──────────────┘
                │                               │
                ▼                               ▼
 ┌─────────────────────────────┐ ┌─────────────────────────────┐
 │       Local Runtimes        │ │    Custom & Cloud APIs      │
 │  • Ollama (:11434)          │ │  • Groq Cloud (Llama 3.3)   │
 │  • LM Studio (:1234)        │ │  • OpenAI (GPT-4o Mini)     │
 │  • vLLM / LocalAI (:8000)   │ │  • DeepSeek / Any /v1 API   │
 └─────────────────────────────┘ └─────────────────────────────┘
```

---

## ✨ Core Capabilities

### 1. 🔀 1-Click Runtime Model Switching
Configure your application once with `model: "active-model"`. From the SLIR dashboard at `http://localhost:4100`, switch between any local Ollama model (`qwen2.5`, `llama3.2`, `mistral`) or external API in real time. Your application immediately routes to the new model on the very next call.

### 2. ⏱️ Latency & Model Load Profiler (X-Ray)
Directly on the home page, tune your runtime parameters and run an instant diagnostic probe:
* 📦 **Model Load Time (`load_duration`)**: Measures exact VRAM weight & KV cache initialization time (badges **Cold Load** vs **Resident Warm**).
* ⚡ **Prompt Eval Time (`prompt_eval_duration`)**: Measures Time to First Token (TTFT) for context ingestion.
* 🔄 **Inference Eval (`eval_duration`)**: Measures token generation speed (`tokens/sec`).
* 🎯 **Total Latency**: Wall-clock end-to-end execution time.
* 🎛️ **Runtime Context & Temp**: Adjust `num_ctx` (2K, 4K, 8K, 16K) and `temperature` (0.0 to 1.0) on the fly.

### 3. 🔌 Universal OpenAI Compatibility
SLIR exposes standard OpenAI-compatible endpoints:
* `POST /v1/chat/completions` (Streaming & Non-Streaming)
* `POST /v1/messages` (Native Anthropic Messages API, Streaming & Non-Streaming)
* `GET  /v1/models`
* `GET  /api/health`

Works out-of-the-box with standard OpenAI SDKs in Python, C# / .NET, JavaScript/TypeScript, Go, and cURL.

**Upstream API formats:** every custom model is stored with a `format` — `openai` (Chat Completions at `/chat/completions`) or `anthropic` (native Messages API at `/v1/messages`). SLIR translates requests, responses, streaming events, token usage, and provider errors in both directions, so clients always see OpenAI-shaped data. Existing models default to `openai`. Text chat, streaming, usage, vision (`image_url` content parts), tool/function calling (`tools`, `tool_choice`, `parallel_tool_calls`, plus legacy `functions`/`function_call`), and JSON structured output (`response_format: json_object` / `json_schema`, emulated with a forced output tool) translate fully. `cache_control` can be attached to system/user messages and tools for Anthropic prompt caching, and native `top_k`, `metadata`, and `thinking` parameters pass through when present in the request body. OpenAI-only features that Anthropic does not support (`n`, `logprobs`, `seed`) are not forwarded.

**Native Anthropic SDK clients:** `POST /v1/messages` accepts the Anthropic Messages API request shape and the `x-api-key` header used by the official Anthropic SDKs. Requests are converted to the internal OpenAI shape, run through the same model resolution, failover, budget, and telemetry pipeline as Chat Completions, then responses (including streaming SSE events and errors) are converted back to Anthropic format. The client-provided model name is echoed in `message.model`, usage is reported as `input_tokens` / `output_tokens`, and requests are recorded with call type `anthropic.messages`. Because the gateway resolves model names from its own catalog, pass a model id configured in the dashboard (for example `claude-model` or `active-model`); raw upstream ids are not auto-registered.

### 4. 🔒 100% Local & Privacy-First
* Powered by embedded **SQLite** (WAL mode enabled).
* **Zero Cloud Lock-in**: Runs entirely offline on your laptop or workstation.
* **Zero Prompt Retention**: Only anonymous operational telemetry (latency, token counts, model target) is recorded.

### 5. Automatic Per-Application Failover
Configure an ordered fallback chain for each application under the **Failover** tab. If the primary model returns HTTP 429, HTTP 5xx, times out, or cannot be reached, SLIR tries the next model before returning an error. Requests authenticated with that application's `mp_live_` key use the chain for both `active-model` and explicit model names.

* Up to five fallback models, resolved as custom cloud endpoints first and local Ollama models second.
* Primary budget hard-blocks remain hard stops; fallback candidates that exceed a budget are skipped.
* Each client request still produces one request-log row, with failover source, reason, attempt count, and per-attempt trace.

---

## 🚀 Quick Start

### Option A: Run the production image with Docker Compose (Recommended)

The production Dockerfile bundles the React dashboard and the Node.js gateway into one image. Build and start that single container:

```bash
docker compose up -d --build
```
> The default `docker-compose.yml` builds `slir-app:latest` from `Dockerfile` with **zero configuration or `.env` file required**.
> *(Optional)* To use an image that is already built or loaded, run: `SLIR_IMAGE=slir-app:v1.0.0 docker compose up -d`

* **Dashboard (Web UI):** [http://localhost:4100](http://localhost:4100)
* **SLIR AI Gateway:** [http://localhost:4101/v1](http://localhost:4101/v1)

Both ports reach the same container listener; the dashboard uses relative `/api` and `/v1` requests.

---

### Option A2: Build and export a single app image

The root Dockerfile builds the frontend and bundles it into the Node.js backend image. Build and export that image:

```bash
docker build -t slir-app:latest .
docker save -o slir-app.tar slir-app:latest
```

Copy `slir-app.tar` and `docker-compose.yml` to the other machine, then load and run:

```bash
docker load -i slir-app.tar
docker compose up -d
```

The dashboard is available at `http://localhost:4100`; the API gateway is at `http://localhost:4101/v1`. SQLite data remains in the `ai_monitor_sqlite_data` Docker volume.

---

### Option B: Pull the split backend and frontend images

The earlier split images remain available on Docker Hub for custom multi-container deployments. The bundled production Compose file uses the single `slir-app` image instead.

```bash
# Pull version v1.0.0
docker pull varad177/slir-backend:v1.0.0
docker pull varad177/slir-frontend:v1.0.0

# Also tagged as :latest
docker pull varad177/slir-backend:latest
docker pull varad177/slir-frontend:latest
```

---

### Option C: Build from Source Locally

#### 1. Start the Backend Gateway
```bash
cd backend
npm install
npm run dev
# Gateway runs on http://localhost:4101
```

#### 2. Start the Frontend Dashboard
```bash
cd frontend
npm install
npm run dev
# Dashboard opens on http://localhost:4100
```

#### Or build containers locally:
```bash
docker compose up -d --build
```

---

## 💻 Code Examples

> Create an application under **Applications** to get an `mp_live_...` virtual key. Requests authenticated with an `mp_live_...` key are automatically attributed and recorded in telemetry, budgets, and failover.

### 1. cURL
```bash
curl http://localhost:4101/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mp_live_your_application_key" \
  -d '{
    "model": "active-model",
    "messages": [
      {"role": "user", "content": "Explain vibration analysis in 1 sentence."}
    ]
  }'
```

### 2. C# / .NET (`HttpClient`)
```csharp
using System.Net.Http.Headers;
using System.Text.Json;

var client = new HttpClient { BaseAddress = new Uri("http://localhost:4101/v1/") };
client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "mp_live_your_application_key");

var requestBody = new {
    model = "active-model", // Dynamically resolved by SLIR
    messages = new[] {
        new { role = "user", content = "Analyze vibration telemetry anomaly." }
    }
};

var response = await client.PostAsJsonAsync("chat/completions", requestBody);
var result = await response.Content.ReadAsStringAsync();
Console.WriteLine(result);
```

### 3. Python (`openai` SDK)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4101/v1",
    api_key="mp_live_your_application_key"
)

response = client.chat.completions.create(
    model="active-model",  # Hot-swappable from SLIR dashboard
    messages=[{"role": "user", "content": "Hello SLIR!"}]
)

print(response.choices[0].message.content)
```

### 4. Node.js (`openai` SDK)
```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:4101/v1",
  apiKey: "mp_live_your_application_key"
});

const response = await client.chat.completions.create({
  model: "active-model",
  messages: [{ role: "user", content: "Status check." }]
});

console.log(response.choices[0].message.content);
```

### 5. Python (`anthropic` SDK, native Messages API)
```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://localhost:4101",
    api_key="dev-secret-key"  # sent as x-api-key
)

message = client.messages.create(
    model="claude-model",  # A model id configured in the SLIR dashboard
    max_tokens=256,
    messages=[{"role": "user", "content": "Hello SLIR!"}]
)

print(message.content[0].text)
```

---

## 📊 Dashboard Overview

| View | Purpose |
| :--- | :--- |
| **🏠 Overview** | Gateway status, active model switcher, `num_ctx` & `temp` tuning, **⚡ Profile Latency** tool, token throughput chart, and recent live requests. |
| **📦 Models** | Local Ollama inventory, custom endpoints (LM Studio, vLLM, Cloud APIs), 1-click **Set Active**, and **+ Add Model**. |
| **📋 Request Logs** | Searchable audit log with exact latency decomposition (`load_duration`, `prompt_eval_duration`, `eval_duration`), token counts, and HTTP status. |
| **📱 Applications** | Multi-tenant app registration and API key generator (e.g. for separating bot traffic from dev scripts). |
| **💸 Costs & Alerts** | Versioned pricing rules, daily/monthly budgets (notify or hard-block), projected spend, latency percentiles, alert history, and Slack/Discord-compatible webhooks. |
| **Failover** | Per-application ordered fallback chains, model availability checks, and recent failover events with attempt traces. |
| **🧪 Playground** | Direct in-browser prompt testing with real-time token throughput metrics. |

The header includes a dark/light theme toggle, and the alert bell links straight
to unacknowledged budget alerts.

---

## ⚡ Zero Configuration Required

**SLIR is 100% Zero-Config.** You do **not** need to create or manage any `.env` file!

* **Cloud API Keys & Models**: Added directly from the dashboard (**Models** → **+ Add Model**) and stored in the embedded SQLite database.
* **Ports & Routing**: Pre-configured out of the box (`4100` for Dashboard, `4101` for AI Gateway).
* **Telemetry & Storage**: Persisted automatically in a Docker volume (`ai_monitor_sqlite_data`).

*(Optional)* If you ever need to customize ports or settings, you can pass environment variables directly:
```bash
# Example: Run on custom host ports without any .env file
SLIR_DASHBOARD_PORT=5000 SLIR_GATEWAY_PORT=5001 docker compose up -d
```

### 🌐 Gateway Connection URLs

The dashboard automatically detects the best gateway URL based on how you access it:

* **From your machine (IDE, terminal, scripts)**: `http://localhost:4101/v1`
* **From another Docker container on the same host**: `http://host.docker.internal:4101/v1`
* **From a service in the same Docker Compose project**: `http://app:4101/v1`

The dashboard shows the appropriate URL and lets you switch between them with a single click. No manual configuration required.

For production deployments behind a reverse proxy, custom domain, or fixed IP, you can set a fixed public URL:

```bash
SLIR_PUBLIC_BASE_URL=https://ai.example.com/v1 docker compose up -d
```

When set, this URL becomes the single source of truth for all generated code snippets and copy buttons.

---

## 📄 License
MIT License. Built for developers building local AI systems.
