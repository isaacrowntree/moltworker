/**
 * Resend API email alert sender (no SDK, plain fetch)
 */

import type { AlertPayload } from '../types';

export async function sendEmailAlert(
  apiKey: string,
  from: string,
  to: string,
  alert: AlertPayload,
): Promise<void> {
  const isFailure = alert.type === 'failure';
  const status = isFailure ? 'DOWN' : 'RECOVERED';
  const subject = `[Monitor] ${status}: ${alert.check.name}`;

  const html = buildHtml(alert, isFailure);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API failed: ${response.status} ${body}`);
  }
}

function buildHtml(alert: AlertPayload, isFailure: boolean): string {
  const color = isFailure ? '#ef4444' : '#4ade80';
  const status = isFailure ? 'DOWN' : 'RECOVERED';

  const rows = [
    row('Check', alert.check.name),
    row('URL', alert.check.url),
    row('Status', alert.checkState.status),
    row('Response Time', `${alert.result.responseTimeMs}ms`),
  ];

  if (alert.result.statusCode !== null) {
    rows.push(row('HTTP Status', String(alert.result.statusCode)));
  }

  if (alert.result.error) {
    rows.push(row('Error', alert.result.error));
  }

  rows.push(row('Timestamp', alert.timestamp));

  return `
<div style="font-family: -apple-system, sans-serif; max-width: 600px;">
  <div style="background: ${color}; color: white; padding: 12px 16px; border-radius: 8px 8px 0 0;">
    <strong>${status}: ${escapeHtml(alert.check.name)}</strong>
  </div>
  <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb;">
    ${rows.join('\n    ')}
  </table>
  <p style="color: #6b7280; font-size: 12px; margin-top: 8px;">Sent by moltworker-monitor</p>
</div>`.trim();
}

function row(label: string, value: string): string {
  return `<tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600; width: 140px;">${escapeHtml(label)}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(value)}</td>
    </tr>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
