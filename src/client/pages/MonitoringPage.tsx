import { useState, useEffect, useCallback } from 'react';
import {
  getMonitoringStatus,
  type MonitoringStatusResponse,
  type MonitoringCheckStatus,
  type MonitoringHistoryEntry,
  AuthError,
} from '../api';
import './MonitoringPage.css';

const REFRESH_INTERVAL = 60_000;
const MAX_HISTORY = 288;

function statusLabel(status: string): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'unhealthy':
      return 'Down';
    default:
      return 'Unknown';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'var(--success-color)';
    case 'degraded':
      return 'var(--warning-color)';
    case 'unhealthy':
      return 'var(--error-color)';
    default:
      return 'var(--text-muted)';
  }
}

function statusBgColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'rgba(74, 222, 128, 0.25)';
    case 'degraded':
      return 'rgba(251, 191, 36, 0.25)';
    case 'unhealthy':
      return 'rgba(239, 68, 68, 0.25)';
    default:
      return 'rgba(107, 114, 128, 0.25)';
  }
}

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatMs(ms: number | null): string {
  if (ms === null) return '--';
  return `${ms}ms`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function MonitoringPage() {
  const [data, setData] = useState<MonitoringStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const status = await getMonitoringStatus();
      setData(status);
      setError(null);
    } catch (err) {
      if (err instanceof AuthError) {
        window.location.reload();
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load monitoring status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading monitoring status...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-banner">
        <span>{error}</span>
        <button className="dismiss-btn" onClick={() => { setError(null); fetchData(); }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const allHistory = data.checks.flatMap((c) => c.history);
  const totalSuccess = allHistory.filter((h) => h.status === 'healthy').length;
  const overallUptime = allHistory.length > 0
    ? Math.round((totalSuccess / allHistory.length) * 10000) / 100
    : null;

  return (
    <div className="monitoring-page">
      <HeroSection
        overall={data.overall}
        lastRun={data.lastRun}
        overallUptime={overallUptime}
        checkCount={data.checks.length}
        onRefresh={fetchData}
      />
      <div className="checks-grid">
        {data.checks.map((check) => (
          <CheckCard key={check.id} check={check} />
        ))}
      </div>
      {data.checks.length === 0 && (
        <div className="empty-state">
          <p>No monitoring checks configured.</p>
        </div>
      )}
    </div>
  );
}

function HeroSection({
  overall,
  lastRun,
  overallUptime,
  checkCount,
  onRefresh,
}: {
  overall: string;
  lastRun: string | null;
  overallUptime: number | null;
  checkCount: number;
  onRefresh: () => void;
}) {
  return (
    <div className={`hero-section hero-${overall}`}>
      <div className="hero-left">
        <div className="hero-status-row">
          <span className={`hero-dot dot-${overall}`} />
          <h1 className="hero-title">
            {overall === 'healthy'
              ? 'All Systems Operational'
              : overall === 'degraded'
                ? 'Partial Degradation'
                : 'Service Disruption'}
          </h1>
        </div>
        <div className="hero-meta">
          <span className="hero-stat">
            {checkCount} check{checkCount !== 1 ? 's' : ''} monitored
          </span>
          {overallUptime !== null && (
            <span className="hero-stat">
              {overallUptime}% uptime (24h)
            </span>
          )}
          {lastRun && (
            <span className="hero-stat">
              Last run: {timeAgo(lastRun)}
            </span>
          )}
        </div>
      </div>
      <button className="btn btn-secondary btn-sm" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  );
}

function CheckCard({ check }: { check: MonitoringCheckStatus }) {
  const history = padHistory(check.history);
  const maxResponseTime = Math.max(...history.map((h) => h?.responseTimeMs ?? 0), 1);

  return (
    <div className="check-card">
      <div className="card-header">
        <div className="card-header-left">
          <span className={`card-dot dot-${check.status}`} />
          <h3 className="card-name">{check.name}</h3>
        </div>
        <div className="card-header-right">
          {check.uptimePercent !== null && (
            <span className="uptime-pill" style={{
              backgroundColor: statusBgColor(check.uptimePercent >= 99 ? 'healthy' : check.uptimePercent >= 95 ? 'degraded' : 'unhealthy'),
              color: statusColor(check.uptimePercent >= 99 ? 'healthy' : check.uptimePercent >= 95 ? 'degraded' : 'unhealthy'),
            }}>
              {check.uptimePercent}%
            </span>
          )}
          <span className={`status-badge ${check.status}`}>
            {statusLabel(check.status)}
          </span>
        </div>
      </div>

      <div className="card-viz">
        <div className="viz-label">Status</div>
        <StatusTimeline history={history} />
      </div>

      <div className="card-viz">
        <div className="viz-label">Response</div>
        <ResponseSparkline history={history} maxResponseTime={maxResponseTime} />
      </div>

      <div className="card-footer">
        <div className="card-footer-left">
          <span className="footer-item">
            {formatMs(check.responseTimeMs)}
          </span>
          <span className="footer-item footer-muted">
            {timeAgo(check.lastCheck)}
          </span>
        </div>
        <div className="card-tags">
          {check.tags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      </div>

      {check.lastError && (
        <div className="card-error">
          {check.lastError}
        </div>
      )}
    </div>
  );
}

/** Pad history to MAX_HISTORY slots, with nulls for missing entries */
function padHistory(history: MonitoringHistoryEntry[]): (MonitoringHistoryEntry | null)[] {
  if (history.length >= MAX_HISTORY) return history.slice(-MAX_HISTORY);
  const padding: null[] = Array.from({ length: MAX_HISTORY - history.length }, () => null);
  return [...padding, ...history];
}

function StatusTimeline({ history }: { history: (MonitoringHistoryEntry | null)[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; entry: MonitoringHistoryEntry } | null>(null);

  return (
    <div className="timeline-container">
      <div className="timeline-bar">
        {/* eslint-disable-next-line react/no-array-index-key -- fixed-position timeline slots */}
        {history.map((entry, i) => (
          <div
            key={i}
            className="timeline-segment"
            style={{
              backgroundColor: entry ? statusColor(entry.status) : 'var(--surface-hover)',
            }}
            onMouseEnter={(e) => {
              if (entry) {
                const rect = (e.target as HTMLElement).getBoundingClientRect();
                const container = (e.target as HTMLElement).parentElement!.getBoundingClientRect();
                setTooltip({ x: rect.left - container.left + rect.width / 2, entry });
              }
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </div>
      {tooltip && (
        <div className="timeline-tooltip" style={{ left: `${tooltip.x}px` }}>
          <span className="tooltip-status" style={{ color: statusColor(tooltip.entry.status) }}>
            {statusLabel(tooltip.entry.status)}
          </span>
          <span className="tooltip-time">{formatTimeShort(tooltip.entry.timestamp)}</span>
          <span className="tooltip-ms">{tooltip.entry.responseTimeMs}ms</span>
        </div>
      )}
      <div className="timeline-labels">
        <span>24h ago</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function ResponseSparkline({
  history,
  maxResponseTime,
}: {
  history: (MonitoringHistoryEntry | null)[];
  maxResponseTime: number;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; entry: MonitoringHistoryEntry } | null>(null);

  return (
    <div className="sparkline-container">
      <div className="sparkline-bar">
        {/* eslint-disable-next-line react/no-array-index-key -- fixed-position sparkline slots */}
        {history.map((entry, i) => {
          const height = entry
            ? Math.max((entry.responseTimeMs / maxResponseTime) * 100, 2)
            : 0;
          return (
            <div
              key={i}
              className="sparkline-segment"
              onMouseEnter={(e) => {
                if (entry) {
                  const rect = (e.target as HTMLElement).getBoundingClientRect();
                  const container = (e.target as HTMLElement).parentElement!.getBoundingClientRect();
                  setTooltip({ x: rect.left - container.left + rect.width / 2, entry });
                }
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <div
                className="sparkline-fill"
                style={{
                  height: `${height}%`,
                  backgroundColor: entry ? statusColor(entry.status) : 'transparent',
                }}
              />
            </div>
          );
        })}
      </div>
      {tooltip && (
        <div className="timeline-tooltip" style={{ left: `${tooltip.x}px` }}>
          <span className="tooltip-ms">{tooltip.entry.responseTimeMs}ms</span>
          <span className="tooltip-time">{formatTimeShort(tooltip.entry.timestamp)}</span>
        </div>
      )}
    </div>
  );
}
