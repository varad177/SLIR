/**
 * Seeds initial applications and model pricing records if empty
 */
import { randomBytes } from 'node:crypto';
import { invalidatePricingCache } from './pricingEngine.js';

export function generateApiKey(seedName = '') {
  const suffix = randomBytes(8).toString('hex');
  const prefix = (seedName || 'app').replace(/[^a-z0-9]/gi, '_').slice(0, 24);
  return `mp_live_${prefix}_${suffix}`;
}

export function seedDefaultData(db) {
  // Check if initial setup has already been performed
  const setupRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('initial_setup_completed');

  // 1. Seed Initial Applications ONLY ONCE on very first system initialization
  if (!setupRow) {
    const appCount = db.prepare('SELECT COUNT(*) as count FROM applications').get().count;
    if (appCount === 0) {
      const insertApp = db.prepare(`
        INSERT INTO applications (id, name, description, api_key, default_model)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertApp.run('app_sensorbot', 'SensorReportBot (.NET Backend)', 'Industrial vibration and motor diagnostic bot', generateApiKey('sensorbot'), 'active-model');
      console.log('[DB-SEED] Initialized starter application app_sensorbot.');
    }
    // Mark initial setup as permanently completed
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value)
      VALUES ('initial_setup_completed', 'true')
    `).run();
  } else {
    // If applications exist, make sure their API keys and default models are valid
    const existing = db.prepare('SELECT id, api_key FROM applications').all();
    for (const app of existing) {
      if (!app.api_key) {
        const generatedKey = generateApiKey(app.id);
        try {
          db.prepare("UPDATE applications SET api_key = ?, default_model = COALESCE(default_model, 'active-model') WHERE id = ?")
            .run(generatedKey, app.id);
        } catch (e) {
          console.error('[DB-SEED] Failed to update app key:', e);
        }
      }
    }
  }

  // 2. Seed / refresh Default Model Pricing.
  // Upserted on every boot so vendor price changes reach existing databases.
  // (Manual UPDATE-then-INSERT: model_pricing has no unique constraint, and
  // adding one could fail on legacy databases that already hold duplicates.)
  const findPrice = db.prepare(`
    SELECT id FROM model_pricing
    WHERE model_pattern = ? AND provider = ? AND effective_from = ?
    ORDER BY id LIMIT 1
  `);
  const updatePrice = db.prepare(`
    UPDATE model_pricing
    SET input_cost_per_million = ?, output_cost_per_million = ?, effective_to = ?
    WHERE id = ?
  `);
  const insertPrice = db.prepare(`
    INSERT INTO model_pricing (
      model_pattern, provider, input_cost_per_million, output_cost_per_million, effective_from, effective_to
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const standardSeed = [
    // OpenAI
    ['gpt-4o', 'openai', 2.50, 10.00, '2024-01-01T00:00:00Z', null],
    ['gpt-4o-*', 'openai', 2.50, 10.00, '2024-01-01T00:00:00Z', null],
    ['gpt-4o-mini', 'openai', 0.15, 0.60, '2024-01-01T00:00:00Z', null],
    ['o1', 'openai', 15.00, 60.00, '2024-09-01T00:00:00Z', null],
    ['o1-*', 'openai', 15.00, 60.00, '2024-09-01T00:00:00Z', null],
    ['o3-mini', 'openai', 1.10, 4.40, '2025-01-01T00:00:00Z', null],
    ['text-embedding-3-small', 'openai', 0.02, 0.00, '2024-01-01T00:00:00Z', null],

    // Anthropic
    ['claude-3-5-sonnet*', 'anthropic', 3.00, 15.00, '2024-06-01T00:00:00Z', null],
    ['claude-3-5-haiku*', 'anthropic', 0.80, 4.00, '2024-10-01T00:00:00Z', null],

    // Groq / Open Source Cloud
    ['llama-3.3-70b*', 'groq', 0.59, 0.79, '2024-11-01T00:00:00Z', null],
    ['llama-3.1-8b*', 'groq', 0.05, 0.08, '2024-07-01T00:00:00Z', null],

    // Ollama (Self-hosted / Local)
    ['ollama*', 'ollama', 0.00, 0.00, '2024-01-01T00:00:00Z', null],
    ['*active-model*', 'ollama', 0.00, 0.00, '2024-01-01T00:00:00Z', null],
    ['qwen*', 'ollama', 0.00, 0.00, '2024-01-01T00:00:00Z', null],
    ['local-*', 'ollama', 0.00, 0.00, '2024-01-01T00:00:00Z', null]
  ];

  let pricingChanged = false;
  for (const [pattern, provider, inRate, outRate, from, to] of standardSeed) {
    const existing = findPrice.get(pattern, provider, from);
    if (existing) {
      const res = updatePrice.run(inRate, outRate, to, existing.id);
      if (res.changes > 0) pricingChanged = true;
    } else {
      insertPrice.run(pattern, provider, inRate, outRate, from, to);
      pricingChanged = true;
    }
  }
  if (pricingChanged) {
    invalidatePricingCache(db);
    console.log('[DB-SEED] Upserted standard model pricing catalog.');
  }

  // 3. Seed Default Active Model Setting
  const activeModelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_model');
  if (!activeModelRow) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_model', 'qwen2.5:1.5b')").run();
  }

}

