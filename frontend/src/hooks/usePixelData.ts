import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchPixelData } from '../api';
import type { PixelMap, Stats, Pixel } from '../types';

interface UsePixelDataReturn {
  pixelMap: PixelMap;
  stats: Stats | null;
  loading: boolean;
  error: string | null;
  isMock: boolean;
  lastUpdated: Date | null;
}

export function usePixelData(intervalMs = 2000): UsePixelDataReturn {
  const [pixelMap, setPixelMap] = useState<PixelMap>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isMounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchPixelData();

      if (!isMounted.current) return;

      // Detect mock: if stats.totalClaimed <= 1000 and no real API indicator
      // We flag mock via the absence of any server-side marker; api.ts returns same shape
      const map: PixelMap = {};
      for (const px of data.pixels) {
        map[`${px.x},${px.y}`] = px;
      }

      setPixelMap(map);
      setStats(data.stats);
      setError(null);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      if (!isMounted.current) return;
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    isMounted.current = true;
    load();

    const timer = setInterval(load, intervalMs);
    return () => {
      isMounted.current = false;
      clearInterval(timer);
    };
  }, [load, intervalMs]);

  return { pixelMap, stats, loading, error, isMock, lastUpdated };
}

// Convenience: convert Pixel color string "#rrggbb" → PixiJS number 0xRRGGBB
export function colorToHex(color: string): number {
  return parseInt(color.replace('#', ''), 16);
}
