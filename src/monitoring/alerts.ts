/**
 * Alert dispatch logic — routes alerts to configured channels
 * with tag-based filtering and deduplication via state machine.
 */

import type {
  AlertPayload,
  AlertChannel,
  CheckConfig,
  CheckResult,
  CheckState,
  AlertType,
  MonitoringConfig,
} from './types';
import type { MoltbotEnv } from '../types';
import { sendSlackAlert } from './alerts/slack';
import { sendTelegramAlert } from './alerts/telegram';
import { sendEmailAlert } from './alerts/email';

/**
 * Determine the state transition and whether to alert.
 *
 * State machine:
 *   unknown  → healthy   (first success)
 *   unknown  → degraded  (1 failure, threshold not met)
 *   healthy  → degraded  (1 failure, threshold not met)
 *   degraded → unhealthy (consecutive failures >= threshold) → SEND FAILURE ALERT
 *   unhealthy → healthy  (1 success) → SEND RECOVERY ALERT
 *   unhealthy → unhealthy (still failing) → NO ALERT
 */
export function computeTransition(
  state: CheckState,
  result: CheckResult,
  threshold: number,
): { newState: CheckState; alertType: AlertType | null } {
  const now = new Date().toISOString();
  const updated: CheckState = {
    ...state,
    history: state.history ?? [],
    lastCheck: now,
    responseTimeMs: result.responseTimeMs,
  };

  if (result.success) {
    const wasUnhealthy = state.status === 'unhealthy';
    updated.status = 'healthy';
    updated.consecutiveFailures = 0;
    updated.lastSuccess = now;
    updated.lastError = state.lastError; // preserve last error for history

    return {
      newState: updated,
      alertType: wasUnhealthy ? 'recovery' : null,
    };
  }

  // Failure path
  updated.consecutiveFailures = state.consecutiveFailures + 1;
  updated.lastError = result.error;

  if (updated.consecutiveFailures >= threshold) {
    const wasAlreadyUnhealthy = state.status === 'unhealthy';
    updated.status = 'unhealthy';
    return {
      newState: updated,
      alertType: wasAlreadyUnhealthy ? null : 'failure',
    };
  }

  // Below threshold — degraded
  updated.status = 'degraded';
  return { newState: updated, alertType: null };
}

/**
 * Check if a channel should receive alerts for a given check's tags.
 * Channels with no tags receive all alerts.
 * Channels with tags only receive alerts from checks with matching tags.
 */
export function shouldChannelReceive(channel: AlertChannel, check: CheckConfig): boolean {
  if (!channel.enabled) return false;
  if (!channel.tags || channel.tags.length === 0) return true;
  if (!check.tags || check.tags.length === 0) return false;
  return channel.tags.some((tag) => check.tags!.includes(tag));
}

/**
 * Dispatch an alert to all matching channels.
 */
export async function dispatchAlerts(
  alertType: AlertType,
  check: CheckConfig,
  checkState: CheckState,
  result: CheckResult,
  config: MonitoringConfig,
  env: MoltbotEnv,
): Promise<void> {
  const payload: AlertPayload = {
    type: alertType,
    check,
    checkState,
    result,
    timestamp: new Date().toISOString(),
  };

  const tasks: Promise<void>[] = [];

  for (const channel of config.channels) {
    if (!shouldChannelReceive(channel, check)) continue;

    switch (channel.type) {
      case 'slack':
        if (env.SLACK_WEBHOOK_URL) {
          tasks.push(
            sendSlackAlert(env.SLACK_WEBHOOK_URL, payload).catch((err) =>
              console.error('[monitoring] Slack alert failed:', err),
            ),
          );
        }
        break;
      case 'telegram':
        if (env.TELEGRAM_BOT_TOKEN && env.MONITORING_TELEGRAM_CHAT_ID) {
          tasks.push(
            sendTelegramAlert(env.TELEGRAM_BOT_TOKEN, env.MONITORING_TELEGRAM_CHAT_ID, payload).catch(
              (err) => console.error('[monitoring] Telegram alert failed:', err),
            ),
          );
        }
        break;
      case 'email':
        if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && env.MONITORING_EMAIL_TO) {
          tasks.push(
            sendEmailAlert(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL, env.MONITORING_EMAIL_TO, payload).catch(
              (err) => console.error('[monitoring] Email alert failed:', err),
            ),
          );
        }
        break;
    }
  }

  await Promise.all(tasks);
}
