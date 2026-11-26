const buckets = new Map();
const MAX_BUCKETS = 1000;

function pruneExpiredBuckets(now) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function createRateLimiter({ windowMs = 60_000, max = 30, keyPrefix = 'default' } = {}) {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    if (buckets.size > MAX_BUCKETS) {
      pruneExpiredBuckets(now);
    }
    const key = `${keyPrefix}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const existing = buckets.get(key);
    const bucket = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: { message: 'Too many requests. Please retry later.', code: 'rate_limited' }
      });
    }

    return next();
  };
}
