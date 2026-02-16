/**
 * PriceWatch configuration for moltworker.
 *
 * Trackers are loaded from D1 (same database as monitoring).
 * Results are written to Analytics Engine.
 * R2 holds state for the price alert state machine.
 * Alerts POST to the moltbot gateway — the agent decides how/where to notify.
 */

import { createPriceWatch } from 'pricewatch';
import { getSandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from './types';
import { MOLTBOT_PORT } from './config';
import { findExistingMoltbotProcess } from './gateway';

export const pricewatch = createPriceWatch<MoltbotEnv>({
  storage: {
    getD1: (env) => env.MONITORING_DB,
    getR2: (env) => env.MOLTBOT_BUCKET,
    getAnalyticsEngine: (env) => env.PRICEWATCH_AE,
    getBrowser: (env) => env.BROWSER,
  },
  defaults: {
    stateKey: 'pricewatch/state.json',
    currency: 'NZD',
  },
  cdpSecret: (env) => env.CDP_SECRET,
  workerUrl: (env) => env.WORKER_URL,
  onAlert: async (alert, env) => {
    // POST to moltbot agent — agent decides how/where to alert
    try {
      const sandbox = getSandbox(env.Sandbox, 'moltbot', { keepAlive: true });
      const gateway = await findExistingMoltbotProcess(sandbox);
      if (gateway) {
        await sandbox.containerFetch(
          new Request('http://localhost/api/price-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(alert),
          }),
          MOLTBOT_PORT,
        );
        console.log(`[pricewatch] Agent notified: ${alert.type} for ${alert.tracker.name}`);
      } else {
        console.log(`[pricewatch] Gateway not running, skipping alert for ${alert.tracker.name}`);
      }
    } catch (err) {
      console.error('[pricewatch] Gateway notification failed:', err);
    }
  },
});
