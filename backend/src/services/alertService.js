/**
 * Alert delivery for budget thresholds.
 *
 * Alerts are always persisted in `budget_alerts` (the in-app feed). If a
 * webhook is configured, the same alert is also POSTed to it using a payload
 * that works for generic receivers, Slack incoming webhooks (via `text`) and
 * Discord (via `content`).
 */

const WEBHOOK_KEYS = ['alerts_webhook_url', 'alerts_webhook_enabled'];

export function getAlertSettings(db) {
  const settings = { webhookUrl: '', webhookEnabled: false };
  try {
    const rows = db.prepare(
      `SELECT key, value FROM settings WHERE key IN (${WEBHOOK_KEYS.map(() => '?').join(', ')})`
    ).all(...WEBHOOK_KEYS);
    for (const row of rows) {
      if (row.key === 'alerts_webhook_url') settings.webhookUrl = row.value || '';
      if (row.key === 'alerts_webhook_enabled') settings.webhookEnabled = row.value === 'true' || row.value === '1';
    }
  } catch {
    // A missing settings table must never break event ingestion.
  }
  return settings;
}

export function saveAlertSettings(db, { webhookUrl, webhookEnabled }) {
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  `);
  if (webhookUrl !== undefined) upsert.run('alerts_webhook_url', String(webhookUrl || '').trim());
  if (webhookEnabled !== undefined) upsert.run('alerts_webhook_enabled', webhookEnabled ? 'true' : 'false');
  return getAlertSettings(db);
}

function buildPayload(alert, budget) {
  const title = `Budget ${alert.threshold === 'exceeded' ? 'exceeded' : 'warning'}: ${budget.name}`;
  return {
    event: 'budget.threshold',
    title,
    text: alert.message,
    content: alert.message,
    threshold: alert.threshold,
    budget: {
      id: budget.id,
      name: budget.name,
      scopeType: budget.scope_type,
      applicationId: budget.application_id,
      model: budget.model,
      period: budget.period,
      metric: budget.metric,
      limitValue: budget.limit_value,
      action: budget.action
    },
    usage: {
      value: alert.usage_value,
      limit: alert.limit_value,
      periodKey: alert.period_key
    },
    createdAt: alert.created_at || new Date().toISOString()
  };
}

async function postWebhookOnce(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        retryable: res.status === 408 || res.status === 429 || res.status >= 500,
        error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, retryable: true, error: err?.message || 'Webhook request failed' };
  }
}

const WEBHOOK_RETRY_DELAYS_MS = [0, 500, 1500];

async function postWebhook(url, payload) {
  let lastResult = { ok: false, error: 'Webhook request failed' };
  for (const delay of WEBHOOK_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastResult = await postWebhookOnce(url, payload);
    if (lastResult.ok || lastResult.retryable === false) return lastResult;
  }
  return {
    ...lastResult,
    error: `${lastResult.error || 'Webhook request failed'} (after ${WEBHOOK_RETRY_DELAYS_MS.length} attempts)`
  };
}

/**
 * Delivers a persisted alert to the configured webhook and records the
 * outcome on the alert row.
 */
export async function deliverAlert(db, alert, budget) {
  const settings = getAlertSettings(db);
  if (!settings.webhookEnabled || !settings.webhookUrl) {
    db.prepare('UPDATE budget_alerts SET delivery_status = ?, delivery_error = ? WHERE id = ?')
      .run('in_app_only', null, alert.id);
    return { delivered: false, status: 'in_app_only' };
  }

  const result = await postWebhook(settings.webhookUrl, buildPayload(alert, budget));
  db.prepare('UPDATE budget_alerts SET delivery_status = ?, delivery_error = ? WHERE id = ?')
    .run(result.ok ? 'delivered' : 'failed', result.ok ? null : result.error, alert.id);

  return { delivered: result.ok, status: result.ok ? 'delivered' : 'failed', error: result.error };
}

export async function sendTestAlert(db) {
  const settings = getAlertSettings(db);
  if (!settings.webhookUrl) {
    return { ok: false, message: 'No webhook URL is configured.' };
  }
  if (!settings.webhookEnabled) {
    return { ok: false, message: 'Webhook delivery is disabled.' };
  }

  const payload = {
    event: 'budget.test',
    title: 'SLIR budget alerts: test',
    text: 'This is a test alert from SLIR. Budget threshold notifications are wired up correctly.',
    content: 'This is a test alert from SLIR. Budget threshold notifications are wired up correctly.',
    createdAt: new Date().toISOString()
  };
  const result = await postWebhook(settings.webhookUrl, payload);
  return {
    ok: result.ok,
    message: result.ok ? 'Test alert delivered.' : `Test alert failed: ${result.error}`
  };
}
