/**
 * Monitoring orchestrator
 *
 * Called from the scheduled handler to run all configured checks,
 * update state, and dispatch alerts as needed.
 */

import type { MoltbotEnv } from '../types';
import type { MonitoringState } from './types';
import { monitoringConfig } from './checks';
import { loadState, saveState, createEmptyCheckState } from './state';
import { runCheck } from './runner';
import { computeTransition, dispatchAlerts } from './alerts';

export async function runMonitoringChecks(env: MoltbotEnv): Promise<void> {
  const config = monitoringConfig;
  const bucket = env.MOLTBOT_BUCKET;

  if (!bucket) {
    console.warn('[monitoring] MOLTBOT_BUCKET not available, skipping monitoring');
    return;
  }

  console.log(`[monitoring] Running ${config.checks.length} check(s)...`);

  const state: MonitoringState = await loadState(bucket);

  for (const check of config.checks) {
    const timeoutMs = check.timeoutMs ?? config.defaultTimeoutMs;
    const threshold = check.failureThreshold ?? config.defaultFailureThreshold;

    const checkState = state.checks[check.id] ?? createEmptyCheckState(check.id);
    // eslint-disable-next-line no-await-in-loop -- sequential check execution required
    const result = await runCheck(check, env.WORKER_URL, timeoutMs);

    console.log(
      `[monitoring] ${check.name}: ${result.success ? 'OK' : 'FAIL'} (${result.responseTimeMs}ms)${result.error ? ` — ${result.error}` : ''}`,
    );

    const { newState, alertType } = computeTransition(checkState, result, threshold);

    // Record history entry
    newState.history.push({
      timestamp: new Date().toISOString(),
      status: newState.status,
      responseTimeMs: result.responseTimeMs,
      error: result.error,
    });
    // Trim to last 288 entries (24h at 5min intervals)
    if (newState.history.length > 288) {
      newState.history = newState.history.slice(-288);
    }

    state.checks[check.id] = newState;

    if (alertType) {
      console.log(`[monitoring] Dispatching ${alertType} alert for ${check.name}`);
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential alert dispatch
        await dispatchAlerts(alertType, check, newState, result, config, env);
      } catch (err) {
        console.error(`[monitoring] Alert dispatch failed for ${check.name}:`, err);
      }
    }
  }

  state.lastRun = new Date().toISOString();
  await saveState(bucket, state);

  console.log('[monitoring] Checks complete, state saved');
}

export { loadState } from './state';
export type { MonitoringState, HistoryEntry } from './types';
