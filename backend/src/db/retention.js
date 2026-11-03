const DAY_MS = 24 * 60 * 60 * 1000;

export function pruneOldEvents(db, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return 0;
  }

  const cutoff = new Date(Date.now() - retentionDays * DAY_MS).toISOString();
  const result = db.prepare('DELETE FROM usage_events WHERE timestamp < ?').run(cutoff);

  if (result.changes > 0) {
    console.log(`[RETENTION] Deleted ${result.changes} event(s) older than ${retentionDays} day(s).`);
  }
  return result.changes;
}

export function startRetentionJob(db, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    console.log('[RETENTION] Disabled (RETENTION_DAYS=0 keeps events forever).');
    return null;
  }

  pruneOldEvents(db, retentionDays);

  const timer = setInterval(() => {
    try {
      pruneOldEvents(db, retentionDays);
    } catch (err) {
      console.error('[RETENTION] Failed to prune old events:', err.message);
    }
  }, DAY_MS);

  timer.unref?.();
  return timer;
}
