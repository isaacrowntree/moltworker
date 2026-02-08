import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runMonitoringChecks } from './index';
import { createMockEnv, suppressConsole } from '../test-utils';

const mockFetch = vi.fn();

function createMockBucket(existingState: object | null = null) {
  return {
    get: vi.fn().mockResolvedValue(
      existingState
        ? { text: () => Promise.resolve(JSON.stringify(existingState)) }
        : null,
    ),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

describe('runMonitoringChecks', () => {
  beforeEach(() => {
    suppressConsole();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs checks and saves state to R2', async () => {
    const bucket = createMockBucket();
    // Mock successful fetch for all checks
    mockFetch.mockResolvedValue({ status: 200 });

    const env = createMockEnv({
      MOLTBOT_BUCKET: bucket as any,
      WORKER_URL: 'https://moltworker.example.com',
    });

    await runMonitoringChecks(env);

    // Should have fetched state
    expect(bucket.get).toHaveBeenCalledWith('monitoring/state.json');
    // Should have saved state
    expect(bucket.put).toHaveBeenCalledWith(
      'monitoring/state.json',
      expect.any(String),
      expect.objectContaining({ httpMetadata: { contentType: 'application/json' } }),
    );

    // Parse the saved state
    const savedState = JSON.parse(bucket.put.mock.calls[0][1]);
    expect(savedState.lastRun).toBeTruthy();
    expect(savedState.checks['campermate-website']).toBeDefined();
    expect(savedState.checks['campermate-website'].status).toBe('healthy');
    expect(savedState.checks['sandbox-health']).toBeDefined();
    expect(savedState.checks['sandbox-health'].status).toBe('healthy');

    // Verify history entries were appended
    const cmHistory = savedState.checks['campermate-website'].history;
    expect(cmHistory).toHaveLength(1);
    expect(cmHistory[0].status).toBe('healthy');
    expect(cmHistory[0].responseTimeMs).toBeTypeOf('number');
    expect(cmHistory[0].timestamp).toBeTruthy();
    expect(cmHistory[0].error).toBeNull();
  });

  it('transitions to degraded then unhealthy on consecutive failures', async () => {
    // Start with no existing state
    const bucket = createMockBucket();
    mockFetch.mockResolvedValue({ status: 503 });

    const env = createMockEnv({
      MOLTBOT_BUCKET: bucket as any,
      WORKER_URL: 'https://moltworker.example.com',
    });

    // Run 1: unknown → degraded (1 failure, threshold=2)
    await runMonitoringChecks(env);
    let savedState = JSON.parse(bucket.put.mock.calls[0][1]);
    expect(savedState.checks['campermate-website'].status).toBe('degraded');
    expect(savedState.checks['campermate-website'].consecutiveFailures).toBe(1);

    // Run 2: degraded → unhealthy (2 failures >= threshold)
    // Feed previous state back in
    bucket.get.mockResolvedValue({
      text: () => Promise.resolve(JSON.stringify(savedState)),
    });
    bucket.put.mockClear();
    await runMonitoringChecks(env);

    savedState = JSON.parse(bucket.put.mock.calls[0][1]);
    expect(savedState.checks['campermate-website'].status).toBe('unhealthy');
    expect(savedState.checks['campermate-website'].consecutiveFailures).toBe(2);
  });

  it('dispatches recovery alert when unhealthy → healthy', async () => {
    const unhealthyState = {
      checks: {
        'campermate-website': {
          id: 'campermate-website',
          status: 'unhealthy',
          consecutiveFailures: 3,
          lastCheck: '2025-01-01T00:00:00Z',
          lastSuccess: null,
          lastError: 'Expected status 200, got 503',
          responseTimeMs: 200,
          history: [],
        },
        'sandbox-health': {
          id: 'sandbox-health',
          status: 'healthy',
          consecutiveFailures: 0,
          lastCheck: '2025-01-01T00:00:00Z',
          lastSuccess: '2025-01-01T00:00:00Z',
          lastError: null,
          responseTimeMs: 50,
          history: [],
        },
      },
      lastRun: '2025-01-01T00:00:00Z',
    };

    const bucket = createMockBucket(unhealthyState);
    // Now campermate.com is back!
    mockFetch.mockResolvedValue({ status: 200 });

    // Provide Telegram credentials so we can verify alert dispatch attempt
    const env = createMockEnv({
      MOLTBOT_BUCKET: bucket as any,
      WORKER_URL: 'https://moltworker.example.com',
      TELEGRAM_BOT_TOKEN: 'test-bot-token',
      MONITORING_TELEGRAM_CHAT_ID: 'test-chat-id',
    });

    await runMonitoringChecks(env);

    const savedState = JSON.parse(bucket.put.mock.calls[0][1]);
    expect(savedState.checks['campermate-website'].status).toBe('healthy');
    expect(savedState.checks['campermate-website'].consecutiveFailures).toBe(0);

    // Verify Telegram API was called (recovery alert for campermate-website)
    const telegramCalls = mockFetch.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('api.telegram.org'),
    );
    expect(telegramCalls.length).toBe(1);
    const telegramBody = JSON.parse(telegramCalls[0][1].body);
    expect(telegramBody.text).toContain('RECOVERED');
    expect(telegramBody.text).toContain('Campermate Website');
  });

  it('trims history to 288 entries', async () => {
    // Create state with 288 existing history entries
    const fullHistory = Array.from({ length: 288 }, (_, i) => ({
      timestamp: `2025-01-01T00:${String(i).padStart(2, '0')}:00Z`,
      status: 'healthy',
      responseTimeMs: 100 + i,
      error: null,
    }));
    const existingState = {
      checks: {
        'campermate-website': {
          id: 'campermate-website',
          status: 'healthy',
          consecutiveFailures: 0,
          lastCheck: '2025-01-01T00:00:00Z',
          lastSuccess: '2025-01-01T00:00:00Z',
          lastError: null,
          responseTimeMs: 100,
          history: fullHistory,
        },
        'sandbox-health': {
          id: 'sandbox-health',
          status: 'healthy',
          consecutiveFailures: 0,
          lastCheck: '2025-01-01T00:00:00Z',
          lastSuccess: '2025-01-01T00:00:00Z',
          lastError: null,
          responseTimeMs: 50,
          history: [],
        },
      },
      lastRun: '2025-01-01T00:00:00Z',
    };
    const bucket = createMockBucket(existingState);
    mockFetch.mockResolvedValue({ status: 200 });

    const env = createMockEnv({
      MOLTBOT_BUCKET: bucket as any,
      WORKER_URL: 'https://moltworker.example.com',
    });

    await runMonitoringChecks(env);

    const savedState = JSON.parse(bucket.put.mock.calls[0][1]);
    // Should still be 288 (oldest trimmed, new one appended)
    expect(savedState.checks['campermate-website'].history).toHaveLength(288);
    // The first entry should no longer be the original first entry
    expect(savedState.checks['campermate-website'].history[0].responseTimeMs).toBe(101);
  });

  it('skips if MOLTBOT_BUCKET is not available', async () => {
    mockFetch.mockClear();
    const env = createMockEnv({ MOLTBOT_BUCKET: undefined as any });

    // Should not throw
    await runMonitoringChecks(env);
    // No fetch calls for checks
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
