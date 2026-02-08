/**
 * Static monitoring configuration
 *
 * This is the single source of truth for all uptime checks.
 * Version-controlled — redeploy to change.
 *
 * Use {{WORKER_URL}} as a placeholder; it is resolved at runtime
 * from env.WORKER_URL.
 */

import type { MonitoringConfig } from './types';

export const monitoringConfig: MonitoringConfig = {
  checks: [
    {
      id: 'campermate-website',
      name: 'Campermate Website',
      type: 'api',
      url: 'https://www.campermate.com',
      expectedStatus: 200,
      tags: ['production'],
    },
    {
      id: 'sandbox-health',
      name: 'Moltworker Health',
      type: 'api',
      url: '{{WORKER_URL}}/sandbox-health',
      expectedStatus: 200,
      tags: ['infrastructure'],
    },
  ],
  channels: [
    { type: 'slack', enabled: false },
    { type: 'telegram', enabled: true },
    { type: 'email', enabled: false },
  ],
  defaultFailureThreshold: 2,
  defaultTimeoutMs: 10_000,
};

/**
 * Resolve {{WORKER_URL}} placeholders in check URLs
 */
export function resolveCheckUrl(url: string, workerUrl: string | undefined): string {
  if (!workerUrl) {
    return url.replace('{{WORKER_URL}}', 'http://localhost:8787');
  }
  return url.replace('{{WORKER_URL}}', workerUrl.replace(/\/+$/, ''));
}
