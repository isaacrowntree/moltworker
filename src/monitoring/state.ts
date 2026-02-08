/**
 * R2 state persistence for monitoring
 *
 * Stores monitoring state as JSON in the MOLTBOT_BUCKET R2 binding
 * at the key "monitoring/state.json".
 */

import type { MonitoringState, CheckState } from './types';

const STATE_KEY = 'monitoring/state.json';

export function createEmptyState(): MonitoringState {
  return { checks: {}, lastRun: null };
}

export function createEmptyCheckState(id: string): CheckState {
  return {
    id,
    status: 'unknown',
    consecutiveFailures: 0,
    lastCheck: null,
    lastSuccess: null,
    lastError: null,
    responseTimeMs: null,
    history: [],
  };
}

export async function loadState(bucket: R2Bucket): Promise<MonitoringState> {
  try {
    const obj = await bucket.get(STATE_KEY);
    if (!obj) {
      return createEmptyState();
    }
    const text = await obj.text();
    return JSON.parse(text) as MonitoringState;
  } catch (err) {
    console.error('[monitoring] Failed to load state from R2:', err);
    return createEmptyState();
  }
}

export async function saveState(bucket: R2Bucket, state: MonitoringState): Promise<void> {
  await bucket.put(STATE_KEY, JSON.stringify(state, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}
