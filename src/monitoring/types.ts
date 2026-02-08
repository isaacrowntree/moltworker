/**
 * Types for the synthetic monitoring system
 */

export type CheckType = 'api' | 'browser';

export type CheckStatus = 'unknown' | 'healthy' | 'degraded' | 'unhealthy';

export interface CheckConfig {
  id: string;
  name: string;
  type: CheckType;
  url: string;
  expectedStatus?: number;
  timeoutMs?: number;
  failureThreshold?: number;
  tags?: string[];
}

export type AlertChannelType = 'slack' | 'telegram' | 'email';

export interface AlertChannel {
  type: AlertChannelType;
  enabled: boolean;
  tags?: string[];
}

export interface MonitoringConfig {
  checks: CheckConfig[];
  channels: AlertChannel[];
  defaultFailureThreshold: number;
  defaultTimeoutMs: number;
}

export interface HistoryEntry {
  timestamp: string;
  status: CheckStatus;
  responseTimeMs: number;
  error: string | null;
}

export interface CheckState {
  id: string;
  status: CheckStatus;
  consecutiveFailures: number;
  lastCheck: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  responseTimeMs: number | null;
  history: HistoryEntry[];
}

export interface MonitoringState {
  checks: Record<string, CheckState>;
  lastRun: string | null;
}

export interface CheckResult {
  id: string;
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  error: string | null;
}

export type AlertType = 'failure' | 'recovery';

export interface AlertPayload {
  type: AlertType;
  check: CheckConfig;
  checkState: CheckState;
  result: CheckResult;
  timestamp: string;
}
