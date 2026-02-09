import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getMonitoringStatus,
  type MonitoringCheckStatus,
  type MonitoringHistoryEntry,
  AuthError,
} from '../api';
import './CheckDetailPage.css';

const REFRESH_INTERVAL = 60_000;

type TimeRange = '1h' | '6h' | '12h' | '24h';

const TIME_RANGES: { key: TimeRange; label: string; entries: number }[] = [
  { key: '1h', label: '1h', entries: 12 },
  { key: '6h', label: '6h', entries: 72 },
  { key: '12h', label: '12h', entries: 144 },
  { key: '24h', label: '24h', entries: 288 },
];

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

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatTimeFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function rangeLabel(range: TimeRange): string {
  switch (range) {
    case '1h':
      return '1 hour';
    case '6h':
      return '6 hours';
    case '12h':
      return '12 hours';
    case '24h':
      return '24 hours';
  }
}

export default function CheckDetailPage() {
  const { checkId } = useParams<{ checkId: string }>();
  const [check, setCheck] = useState<MonitoringCheckStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>('24h');

  const fetchData = useCallback(async () => {
    try {
      const status = await getMonitoringStatus();
      const found = status.checks.find((c) => c.id === checkId);
      if (found) {
        setCheck(found);
        setError(null);
      } else {
        setError(`Check "${checkId}" not found`);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        window.location.reload();
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [checkId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  const rangeConfig = TIME_RANGES.find((r) => r.key === range)!;
  const filteredHistory = useMemo(() => {
    if (!check) return [];
    return check.history.slice(-rangeConfig.entries);
  }, [check, rangeConfig.entries]);

  const uptimePercent = useMemo(() => {
    if (filteredHistory.length === 0) return null;
    const success = filteredHistory.filter((h) => h.status === 'healthy').length;
    return Math.round((success / filteredHistory.length) * 10000) / 100;
  }, [filteredHistory]);

  const paddedHistory = useMemo(() => {
    const target = rangeConfig.entries;
    if (filteredHistory.length >= target) return filteredHistory;
    const padding: null[] = Array.from({ length: target - filteredHistory.length }, () => null);
    return [...padding, ...filteredHistory];
  }, [filteredHistory, rangeConfig.entries]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading check details...</p>
      </div>
    );
  }

  if (error || !check) {
    return (
      <div className="detail-page">
        <Link to="/monitoring" className="back-link">Back to Monitoring</Link>
        <div className="error-banner">
          <span>{error || 'Check not found'}</span>
          <button className="dismiss-btn" onClick={() => { setError(null); fetchData(); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const maxResponseTime = Math.max(...paddedHistory.map((h) => h?.responseTimeMs ?? 0), 1);
  const avgResponseTime = filteredHistory.length > 0
    ? Math.round(filteredHistory.reduce((sum, h) => sum + h.responseTimeMs, 0) / filteredHistory.length)
    : null;

  return (
    <div className="detail-page">
      <Link to="/monitoring" className="back-link">Back to Monitoring</Link>

      {/* Header */}
      <div className={`detail-header detail-header-${check.status}`}>
        <div className="detail-header-left">
          <div className="detail-title-row">
            <span className={`hero-dot dot-${check.status}`} />
            <h1 className="detail-title">{check.name}</h1>
            <span className={`status-badge ${check.status}`}>
              {statusLabel(check.status)}
            </span>
          </div>
          <div className="detail-meta">
            <span className="detail-meta-item">{check.type.toUpperCase()} Test</span>
            <span className="detail-meta-item detail-url">{check.url}</span>
            {check.lastCheck && (
              <span className="detail-meta-item">Last run {timeAgo(check.lastCheck)}</span>
            )}
          </div>
        </div>
        <div className="detail-header-right">
          {check.tags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      </div>

      {/* Properties */}
      <div className="detail-section">
        <h2 className="section-title">Properties</h2>
        <div className="properties-grid">
          <div className="property">
            <span className="property-label">URL</span>
            <span className="property-value">{check.url}</span>
          </div>
          <div className="property">
            <span className="property-label">Type</span>
            <span className="property-value">{check.type.toUpperCase()}</span>
          </div>
          <div className="property">
            <span className="property-label">Consecutive Failures</span>
            <span className="property-value">{check.consecutiveFailures}</span>
          </div>
          <div className="property">
            <span className="property-label">Last Success</span>
            <span className="property-value">{check.lastSuccess ? formatTimeFull(check.lastSuccess) : 'Never'}</span>
          </div>
          {check.lastError && check.status !== 'healthy' && (
            <div className="property property-full">
              <span className="property-label">Last Error</span>
              <span className="property-value property-error">{check.lastError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Time Range Selector */}
      <div className="detail-section">
        <div className="section-header">
          <h2 className="section-title">History</h2>
          <div className="range-selector">
            {TIME_RANGES.map((r) => (
              <button
                key={r.key}
                className={`range-btn ${range === r.key ? 'range-btn-active' : ''}`}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className="stats-row">
          <div className="stat-card">
            <span className="stat-label">Uptime</span>
            <span className="stat-value" style={{
              color: uptimePercent !== null
                ? statusColor(uptimePercent >= 99 ? 'healthy' : uptimePercent >= 95 ? 'degraded' : 'unhealthy')
                : 'var(--text-muted)',
            }}>
              {uptimePercent !== null ? `${uptimePercent}%` : '--'}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Avg Response</span>
            <span className="stat-value">{avgResponseTime !== null ? `${avgResponseTime}ms` : '--'}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Current</span>
            <span className="stat-value">{check.responseTimeMs !== null ? `${check.responseTimeMs}ms` : '--'}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Checks</span>
            <span className="stat-value">{filteredHistory.length}</span>
          </div>
        </div>

        {/* Uptime bar */}
        <div className="detail-viz">
          <div className="viz-label">Uptime ({rangeLabel(range)})</div>
          <DetailTimeline history={paddedHistory} rangeLabel={rangeLabel(range)} />
        </div>

        {/* Response time chart */}
        <div className="detail-viz">
          <div className="viz-label">Response Time ({rangeLabel(range)})</div>
          <DetailSparkline history={paddedHistory} maxResponseTime={maxResponseTime} />
        </div>
      </div>

      {/* Test Runs Table */}
      <div className="detail-section">
        <h2 className="section-title">Test Runs</h2>
        <p className="section-subtitle">
          Showing {filteredHistory.length} run{filteredHistory.length !== 1 ? 's' : ''} in the past {rangeLabel(range)}
        </p>
        <div className="runs-table-container">
          <table className="runs-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Time</th>
                <th>Duration</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.toReversed().map((entry, i) => (
                // eslint-disable-next-line react/no-array-index-key -- history entries lack unique IDs
                <tr key={i}>
                  <td>
                    <span className={`run-status run-status-${entry.status}`}>
                      {entry.status === 'healthy' ? 'PASSED' : entry.status === 'degraded' ? 'DEGRADED' : 'FAILED'}
                    </span>
                  </td>
                  <td className="run-time">
                    <span className="run-time-ago">{timeAgo(entry.timestamp)}</span>
                    <span className="run-time-full">{formatTimeFull(entry.timestamp)}</span>
                  </td>
                  <td className="run-duration">{entry.responseTimeMs}ms</td>
                  <td className="run-error">{entry.error || '--'}</td>
                </tr>
              ))}
              {filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={4} className="runs-empty">No test runs in this time range</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DetailTimeline({ history, rangeLabel: label }: { history: (MonitoringHistoryEntry | null)[]; rangeLabel: string }) {
  const [tooltip, setTooltip] = useState<{ x: number; entry: MonitoringHistoryEntry } | null>(null);

  return (
    <div className="timeline-container">
      <div className="timeline-bar detail-timeline-bar">
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
        <span>{label} ago</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function DetailSparkline({
  history,
  maxResponseTime,
}: {
  history: (MonitoringHistoryEntry | null)[];
  maxResponseTime: number;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; entry: MonitoringHistoryEntry } | null>(null);

  return (
    <div className="sparkline-container">
      <div className="sparkline-bar detail-sparkline-bar">
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
