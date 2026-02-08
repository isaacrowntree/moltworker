import { describe, it, expect } from 'vitest';
import { computeTransition, shouldChannelReceive } from './alerts';
import { createEmptyCheckState } from './state';
import type { AlertChannel, CheckConfig, CheckResult } from './types';

describe('alerts', () => {
  const successResult: CheckResult = {
    id: 'test',
    success: true,
    statusCode: 200,
    responseTimeMs: 100,
    error: null,
  };

  const failureResult: CheckResult = {
    id: 'test',
    success: false,
    statusCode: 503,
    responseTimeMs: 200,
    error: 'Expected status 200, got 503',
  };

  describe('computeTransition', () => {
    it('unknown → healthy on first success (no alert)', () => {
      const state = createEmptyCheckState('test');
      const { newState, alertType } = computeTransition(state, successResult, 2);

      expect(newState.status).toBe('healthy');
      expect(newState.consecutiveFailures).toBe(0);
      expect(alertType).toBeNull();
    });

    it('unknown → degraded on first failure (no alert, threshold=2)', () => {
      const state = createEmptyCheckState('test');
      const { newState, alertType } = computeTransition(state, failureResult, 2);

      expect(newState.status).toBe('degraded');
      expect(newState.consecutiveFailures).toBe(1);
      expect(alertType).toBeNull();
    });

    it('degraded → unhealthy when threshold met (failure alert)', () => {
      const state = { ...createEmptyCheckState('test'), status: 'degraded' as const, consecutiveFailures: 1 };
      const { newState, alertType } = computeTransition(state, failureResult, 2);

      expect(newState.status).toBe('unhealthy');
      expect(newState.consecutiveFailures).toBe(2);
      expect(alertType).toBe('failure');
    });

    it('unhealthy → unhealthy on continued failure (no alert)', () => {
      const state = { ...createEmptyCheckState('test'), status: 'unhealthy' as const, consecutiveFailures: 5 };
      const { newState, alertType } = computeTransition(state, failureResult, 2);

      expect(newState.status).toBe('unhealthy');
      expect(newState.consecutiveFailures).toBe(6);
      expect(alertType).toBeNull();
    });

    it('unhealthy → healthy on success (recovery alert)', () => {
      const state = { ...createEmptyCheckState('test'), status: 'unhealthy' as const, consecutiveFailures: 3 };
      const { newState, alertType } = computeTransition(state, successResult, 2);

      expect(newState.status).toBe('healthy');
      expect(newState.consecutiveFailures).toBe(0);
      expect(alertType).toBe('recovery');
    });

    it('healthy → degraded on first failure (no alert)', () => {
      const state = { ...createEmptyCheckState('test'), status: 'healthy' as const };
      const { newState, alertType } = computeTransition(state, failureResult, 2);

      expect(newState.status).toBe('degraded');
      expect(newState.consecutiveFailures).toBe(1);
      expect(alertType).toBeNull();
    });

    it('healthy → healthy on success (no alert)', () => {
      const state = { ...createEmptyCheckState('test'), status: 'healthy' as const };
      const { newState, alertType } = computeTransition(state, successResult, 2);

      expect(newState.status).toBe('healthy');
      expect(alertType).toBeNull();
    });

    it('threshold=1 goes straight to unhealthy on first failure', () => {
      const state = createEmptyCheckState('test');
      const { newState, alertType } = computeTransition(state, failureResult, 1);

      expect(newState.status).toBe('unhealthy');
      expect(newState.consecutiveFailures).toBe(1);
      expect(alertType).toBe('failure');
    });

    it('preserves lastError on recovery', () => {
      const state = {
        ...createEmptyCheckState('test'),
        status: 'unhealthy' as const,
        consecutiveFailures: 2,
        lastError: 'previous error',
      };
      const { newState } = computeTransition(state, successResult, 2);

      expect(newState.lastError).toBe('previous error');
    });

    it('handles legacy state without history field', () => {
      // State loaded from R2 before history was added
      const legacyState = {
        id: 'test',
        status: 'healthy' as const,
        consecutiveFailures: 0,
        lastCheck: '2026-01-01T00:00:00Z',
        lastSuccess: '2026-01-01T00:00:00Z',
        lastError: null,
        responseTimeMs: 100,
      };

      // @ts-expect-error -- simulating legacy state without history
      const { newState } = computeTransition(legacyState, successResult, 2);

      expect(newState.history).toEqual([]);
      expect(newState.status).toBe('healthy');
    });
  });

  describe('shouldChannelReceive', () => {
    const check: CheckConfig = {
      id: 'test',
      name: 'Test',
      type: 'api',
      url: 'https://example.com',
      tags: ['production', 'web'],
    };

    it('disabled channel receives nothing', () => {
      const channel: AlertChannel = { type: 'slack', enabled: false };
      expect(shouldChannelReceive(channel, check)).toBe(false);
    });

    it('enabled channel with no tags receives all alerts', () => {
      const channel: AlertChannel = { type: 'slack', enabled: true };
      expect(shouldChannelReceive(channel, check)).toBe(true);
    });

    it('enabled channel with matching tag receives alert', () => {
      const channel: AlertChannel = { type: 'slack', enabled: true, tags: ['production'] };
      expect(shouldChannelReceive(channel, check)).toBe(true);
    });

    it('enabled channel with non-matching tag does not receive alert', () => {
      const channel: AlertChannel = { type: 'slack', enabled: true, tags: ['staging'] };
      expect(shouldChannelReceive(channel, check)).toBe(false);
    });

    it('check with no tags and channel with tags → no match', () => {
      const noTagCheck: CheckConfig = { ...check, tags: undefined };
      const channel: AlertChannel = { type: 'slack', enabled: true, tags: ['production'] };
      expect(shouldChannelReceive(channel, noTagCheck)).toBe(false);
    });
  });
});
