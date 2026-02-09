/**
 * ClawdWatch v2 monitoring configuration for moltworker.
 *
 * Checks are loaded from D1 (not static config).
 * Results are written to Analytics Engine.
 * R2 holds only hot state for the alert state machine.
 * Alerts POST to the moltbot gateway — the agent decides how/where to notify.
 */

import { createMonitor } from 'clawdwatch';
import { getSandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from './types';
import { MOLTBOT_PORT } from './config';
import { findExistingMoltbotProcess } from './gateway';

export const monitor = createMonitor<MoltbotEnv>({
  storage: {
    getD1: (env) => env.MONITORING_DB,
    getR2: (env) => env.MOLTBOT_BUCKET,
    getAnalyticsEngine: (env) => env.MONITORING_AE,
  },
  defaults: {
    stateKey: 'monitoring/state.json',
  },
  resolveUrl: (url, env) =>
    url.replace('{{WORKER_URL}}', (env.WORKER_URL ?? 'http://localhost:8787').replace(/\/+$/, '')),
  onAlert: async (alert, env) => {
    // POST to moltbot agent — agent decides how/where to alert
    try {
      const sandbox = getSandbox(env.Sandbox, 'moltbot', { keepAlive: true });
      const gateway = await findExistingMoltbotProcess(sandbox);
      if (gateway) {
        await sandbox.containerFetch(
          new Request('http://localhost/api/monitoring-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(alert),
          }),
          MOLTBOT_PORT,
        );
        console.log(`[monitoring] Agent notified: ${alert.type} for ${alert.check.name}`);
      } else {
        console.log(`[monitoring] Gateway not running, skipping alert for ${alert.check.name}`);
      }
    } catch (err) {
      console.error('[monitoring] Gateway notification failed:', err);
    }
  },
});
