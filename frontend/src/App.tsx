import { useState, useCallback } from 'react';
import { PixelCanvas } from './components/PixelCanvas';
import { InfoPanel } from './components/InfoPanel';
import { usePixelData } from './hooks/usePixelData';
import type { SelectedPixel } from './types';
import './App.css';

export default function App() {
  const { pixelMap, stats, loading, error, lastUpdated } = usePixelData(2000);
  const [selected, setSelected] = useState<SelectedPixel | null>(null);

  const handlePixelSelect = useCallback((px: SelectedPixel | null) => {
    setSelected(px);
  }, []);

  return (
    <div className="app-root">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-logo">
          <span className="logo-icon">▓</span>
          <span className="logo-main">PIXELWAR AI</span>
          <span className="logo-sep">—</span>
          <span className="logo-sub">The Canvas of Agents</span>
        </div>
        <div className="topbar-status">
          {error ? (
            <span className="status-badge status-mock">⚡ MOCK DATA</span>
          ) : loading && !lastUpdated ? (
            <span className="status-badge status-loading">◌ Connecting…</span>
          ) : (
            <span className="status-badge status-live">● LIVE</span>
          )}
          {stats && (
            <span className="topbar-stat">
              {stats.totalClaimed.toLocaleString()} / {(stats.totalPixels / 1_000_000).toFixed(0)}M pixels
            </span>
          )}
        </div>
      </header>

      {/* Main layout */}
      <div className="app-body">
        {/* Canvas area */}
        <main className="canvas-area">
          <PixelCanvas
            pixelMap={pixelMap}
            onPixelSelect={handlePixelSelect}
          />
          {/* Canvas overlay hint */}
          <div className="canvas-hint">
            Scroll to zoom &nbsp;·&nbsp; Drag to pan &nbsp;·&nbsp; Click a pixel
          </div>
        </main>

        {/* Info panel */}
        <InfoPanel
          selected={selected}
          stats={stats}
          lastUpdated={lastUpdated}
          loading={loading}
        />
      </div>
    </div>
  );
}
