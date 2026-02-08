/**
 * Telegram Bot API alert sender
 */

import type { AlertPayload } from '../types';

export async function sendTelegramAlert(
  botToken: string,
  chatId: string,
  alert: AlertPayload,
): Promise<void> {
  const isFailure = alert.type === 'failure';
  const emoji = isFailure ? '\u{1F534}' : '\u{1F7E2}';
  const status = isFailure ? 'DOWN' : 'RECOVERED';

  const lines = [
    `${emoji} <b>${status}: ${escapeHtml(alert.check.name)}</b>`,
    '',
    `<b>URL:</b> ${escapeHtml(alert.check.url)}`,
    `<b>Status:</b> ${alert.checkState.status}`,
    `<b>Response Time:</b> ${alert.result.responseTimeMs}ms`,
  ];

  if (alert.result.statusCode !== null) {
    lines.push(`<b>HTTP Status:</b> ${alert.result.statusCode}`);
  }

  if (alert.result.error) {
    lines.push(`<b>Error:</b> ${escapeHtml(alert.result.error)}`);
  }

  lines.push('', `<i>${alert.timestamp}</i>`);

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API failed: ${response.status} ${body}`);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
