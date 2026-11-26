/**
 * Pricing Engine
 * Computes estimated costs using versioned model_pricing records.
 */

/**
 * Pricing rules rarely change but are read once per ingested event, so the
 * catalog is cached per database handle. Call `invalidatePricingCache` after
 * any write to `model_pricing`.
 */
const pricingCache = new WeakMap();

export function invalidatePricingCache(db) {
  pricingCache.delete(db);
}

function loadPricingCatalog(db) {
  const cached = pricingCache.get(db);
  if (cached) return cached;

  const rules = db.prepare(`
    SELECT * FROM model_pricing
    ORDER BY (model_pattern LIKE '%*%') ASC, id DESC
  `).all();

  let customRates = [];
  try {
    customRates = db.prepare(`
      SELECT model_id, provider, input_cost_per_million, output_cost_per_million
      FROM custom_models
      WHERE input_cost_per_million IS NOT NULL OR output_cost_per_million IS NOT NULL
    `).all();
  } catch {
    customRates = [];
  }

  const catalog = { rules, customRates };
  pricingCache.set(db, catalog);
  return catalog;
}

/**
 * Escapes a wildcard model pattern (`gpt-4o*`) into a safe anchored regex.
 * Everything except `*` is literal, so patterns containing regex
 * metacharacters (`(`, `+`, `[`, `.`) can neither throw nor over-match.
 * @param {string} pattern
 * @returns {RegExp|null}
 */
function patternToRegex(pattern) {
  try {
    const source = pattern
      .split('*')
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${source}$`, 'i');
  } catch {
    return null;
  }
}

/**
 * Calculates the cost for a usage event.
 * 
 * Rules:
 * 1. If provider confirmed a cost, retain it with 'confirmed_by_provider'.
 * 2. If tokens are missing/invalid: failures cost 0.0 ('estimated'),
 *    anything else is 'unknown'.
 * 3. Otherwise match an active pricing record (provider + exact match first,
 *    then wildcard) and price both token counts.
 * 
 * @param {Object} db Database instance
 * @param {Object} event Event to price
 * @returns {{ cost: number|null, status: string }}
 */
export function calculateEventCost(db, event) {
  // Rule 1: Prioritize provider-confirmed cost
  if (Number.isFinite(event.estimatedCost)) {
    return {
      cost: Math.round(event.estimatedCost * 1e6) / 1e6,
      status: 'confirmed_by_provider'
    };
  }

  // Rule 2: Missing/invalid tokens -> never treat as zero
  const promptTokens = Number.isFinite(event.promptTokens) ? event.promptTokens : null;
  const completionTokens = Number.isFinite(event.completionTokens) ? event.completionTokens : null;

  if (promptTokens === null || completionTokens === null) {
    if (event.status === 'failure') {
      // A failed request with no provider cost is not a confirmed charge
      return { cost: 0.0, status: 'estimated' };
    }
    return { cost: null, status: 'unknown' };
  }

  // Rule 3: Match pricing table (cached; provider match preferred, then
  // exact model match, then wildcard match)
  const eventTime = event.timestamp || new Date().toISOString();
  const eventModel = (event.model || '').toLowerCase();
  const eventProvider = (event.provider || '').toLowerCase();
  const catalog = loadPricingCatalog(db);
  const pricingRules = catalog.rules.filter(rule =>
    rule.effective_from <= eventTime &&
    (!rule.effective_to || rule.effective_to > eventTime)
  );

  const scoreRule = (rule) => {
    const pattern = rule.model_pattern.toLowerCase();
    const providerMatches = (rule.provider || '').toLowerCase() === eventProvider;
    if (pattern === eventModel) return providerMatches ? 4 : 3;
    if (pattern.includes('*')) {
      const regex = patternToRegex(pattern);
      if (regex && regex.test(eventModel)) return providerMatches ? 2 : 1;
    }
    return 0;
  };

  let matchedRule = null;
  let bestScore = 0;
  for (const rule of pricingRules) {
    const score = scoreRule(rule);
    if (score > bestScore) {
      bestScore = score;
      matchedRule = rule;
      if (score === 4) break;
    }
  }

  // Fallback to per-1M rates configured directly on custom_models when no
  // explicit model_pricing rule matched.
  if (!matchedRule && catalog.customRates.length > 0) {
    const normalizedModel = eventModel.replace(/^ollama\//, '');
    const customMatch = catalog.customRates.find((cm) => {
      const id = String(cm.model_id || '').trim().toLowerCase();
      return id === eventModel || id === normalizedModel;
    });
    if (customMatch) {
      matchedRule = {
        input_cost_per_million: Number(customMatch.input_cost_per_million) || 0,
        output_cost_per_million: Number(customMatch.output_cost_per_million) || 0
      };
    }
  }

  // If no pricing found, return unknown
  if (!matchedRule) {
    return {
      cost: null,
      status: 'unknown'
    };
  }

  // Rule 4: Calculate estimated cost
  const inputCost = (promptTokens / 1_000_000) * matchedRule.input_cost_per_million;
  const outputCost = (completionTokens / 1_000_000) * matchedRule.output_cost_per_million;
  const totalCost = Math.round((inputCost + outputCost) * 1e6) / 1e6;

  return {
    cost: totalCost,
    status: 'estimated'
  };
}
