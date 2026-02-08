/**
 * Slack incoming webhook alert sender
 */

import type { AlertPayload } from '../types';

export async function sendSlackAlert(
  webhookUrl: string,
  alert: AlertPayload,
): Promise<void> {
  const isFailure = alert.type === 'failure';
  const emoji = isFailure ? ':red_circle:' : ':large_green_circle:';
  const title = isFailure
    ? `${emoji} DOWN: ${alert.check.name}`
    : `${emoji} RECOVERED: ${alert.check.name}`;

  const fields = [
    { title: 'Status', value: alert.checkState.status, short: true },
    { title: 'Response Time', value: `${alert.result.responseTimeMs}ms`, short: true },
  ];

  if (alert.result.error) {
    fields.push({ title: 'Error', value: alert.result.error, short: false });
  }

  if (alert.result.statusCode !== null) {
    fields.push({
      title: 'HTTP Status',
      value: String(alert.result.statusCode),
      short: true,
    });
  }

  const payload = {
    text: title,
    attachments: [
      {
        color: isFailure ? '#ef4444' : '#4ade80',
        fields,
        footer: `moltworker-monitor | ${alert.check.url}`,
        ts: Math.floor(new Date(alert.timestamp).getTime() / 1000),
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status}`);
  }
}
