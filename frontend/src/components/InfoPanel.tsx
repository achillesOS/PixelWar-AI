import type { SelectedPixel, Stats } from '../types';
import './InfoPanel.css';

interface InfoPanelProps {
  selected: SelectedPixel | null;
  stats: Stats | null;
  lastUpdated: Date | null;
  loading: boolean;
}

function formatPrice(price: number): string {
  if (price === 0) return '—';
  if (price >= 1000) return `${(price / 1000).toFixed(1)}k`;
  return String(price);
}

function shortAgentId(id: string): string {
  if (id.length <= 16) return id;
  return id.slice(0, 8) + '…' + id.slice(-6);
}

function progressBar(value: number, total: number) {
  const pct = Math.min((value / total) * 100, 100);
  return (
    <div className="progress-bar-track">
      <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function InfoPanel({ selected, stats, lastUpdated, loading }: InfoPanelProps) {
  return (
    <aside className="info-panel">
      {/* Header */}
      <div className="panel-section header-section">
        <div className="panel-brand">⬛ PIXELWAR AI</div>
        <div className="panel-subtitle">The Canvas of Agents</div>
        {lastUpdated && (
          <div className="panel-updated">
            {loading ? '⟳ syncing…' : `↻ ${lastUpdated.toLocaleTimeString()}`}
          </div>
        )}
      </div>

      {/* Selected Pixel */}
      <div className="panel-section">
        <h3 className="section-title">Selected Pixel</h3>
        {selected ? (
          <div className="pixel-info">
            <div className="pixel-preview-row">
              <div
                className="pixel-color-swatch"
                style={{ background: selected.color }}
              />
              <span className="pixel-coord">
                ({selected.x}, {selected.y})
              </span>
              {selected.isEmpty && (
                <span className="badge badge-empty">UNCLAIMED</span>
              )}
            </div>
            <table className="info-table">
              <tbody>
                <tr>
                  <td className="info-label">Color</td>
                  <td className="info-value mono">{selected.color.toUpperCase()}</td>
                </tr>
                <tr>
                  <td className="info-label">Price</td>
                  <td className="info-value">
                    {selected.isEmpty ? '—' : `${formatPrice(selected.price)} cr`}
                  </td>
                </tr>
                <tr>
                  <td className="info-label">Owner</td>
                  <td className="info-value mono truncate">
                    {selected.isEmpty ? (
                      <span className="dim">unclaimed</span>
                    ) : (
                      shortAgentId(selected.owner)
                    )}
                  </td>
                </tr>
                {!selected.isEmpty && selected.updatedAt > 0 && (
                  <tr>
                    <td className="info-label">Last set</td>
                    <td className="info-value dim">
                      {new Date(selected.updatedAt).toLocaleTimeString()}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-empty">Click any pixel on the canvas</div>
        )}
      </div>

      {/* Stats */}
      <div className="panel-section">
        <h3 className="section-title">Territory</h3>
        {stats ? (
          <>
            <div className="stat-row">
              <span className="stat-label">Claimed</span>
              <span className="stat-value">
                {stats.totalClaimed.toLocaleString()}
                <span className="dim"> / {(stats.totalPixels / 1_000_000).toFixed(0)}M</span>
              </span>
            </div>
            {progressBar(stats.totalClaimed, stats.totalPixels)}
            <div className="stat-pct">
              {((stats.totalClaimed / stats.totalPixels) * 100).toFixed(4)}% conquered
            </div>
          </>
        ) : (
          <div className="panel-empty">Loading…</div>
        )}
      </div>

      {/* Top Expensive */}
      <div className="panel-section">
        <h3 className="section-title">💰 Most Expensive</h3>
        {stats && stats.topExpensive.length > 0 ? (
          <ol className="rank-list">
            {stats.topExpensive.map((px, i) => (
              <li key={`${px.x},${px.y}`} className="rank-item">
                <span className="rank-num">{i + 1}</span>
                <div
                  className="rank-color"
                  style={{ background: px.color }}
                />
                <div className="rank-info">
                  <span className="rank-coord">({px.x}, {px.y})</span>
                  <span className="rank-agent dim">{shortAgentId(px.owner)}</span>
                </div>
                <span className="rank-value">{formatPrice(px.price)} cr</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="panel-empty">No data</div>
        )}
      </div>

      {/* Top Agents */}
      <div className="panel-section">
        <h3 className="section-title">🤖 Top Agents</h3>
        {stats && stats.topAgents.length > 0 ? (
          <ol className="rank-list">
            {stats.topAgents.map((ag, i) => (
              <li key={ag.agentId} className="rank-item">
                <span className="rank-num">{i + 1}</span>
                <div className="rank-info" style={{ flex: 1 }}>
                  <span className="rank-agent mono">{shortAgentId(ag.agentId)}</span>
                  <div className="agent-bar-track">
                    <div
                      className="agent-bar-fill"
                      style={{
                        width: `${Math.min(
                          (ag.pixelCount /
                            (stats.topAgents[0]?.pixelCount || 1)) *
                            100,
                          100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="rank-value">{ag.pixelCount.toLocaleString()} px</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="panel-empty">No agents yet</div>
        )}
      </div>

      <div className="panel-footer">
        Powered by AI Agents &nbsp;·&nbsp; Phase 1 MVP
      </div>
    </aside>
  );
}
