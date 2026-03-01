import type { ApiResponse, Pixel, Stats, AgentStat } from './types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://pixelwar-ai.onrender.com';

// ─── Mock Data Generator ──────────────────────────────────────────────────────

const AGENT_IDS = [
  'agent-alpha-7f2a',
  'agent-beta-3c1b',
  'agent-gamma-9d4e',
  'agent-delta-2a8f',
  'agent-epsilon-5b3c',
  'agent-zeta-1e9d',
  'agent-eta-6f2a',
  'agent-theta-4c7b',
];

const PALETTE = [
  '#ff4488', '#ff6644', '#ffaa00', '#ffff00',
  '#00ff88', '#00ffff', '#4488ff', '#8844ff',
  '#ff0044', '#00ff44', '#0044ff', '#ff8800',
  '#44ff88', '#88ffff', '#ff44ff', '#44ffff',
];

function randomColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function randomAgent(): string {
  return AGENT_IDS[Math.floor(Math.random() * AGENT_IDS.length)];
}

export function generateMockPixels(count = 500): Pixel[] {
  const pixels: Pixel[] = [];
  const used = new Set<string>();

  while (pixels.length < count) {
    const x = Math.floor(Math.random() * 1000);
    const y = Math.floor(Math.random() * 1000);
    const key = `${x},${y}`;
    if (used.has(key)) continue;
    used.add(key);

    pixels.push({
      x,
      y,
      color: randomColor(),
      price: Math.floor(Math.random() * 10000) + 1,
      owner: randomAgent(),
      updatedAt: Date.now() - Math.floor(Math.random() * 3600_000),
    });
  }
  return pixels;
}

export function buildMockStats(pixels: Pixel[]): Stats {
  // Agent aggregation
  const agentMap = new Map<string, { count: number; value: number }>();
  for (const p of pixels) {
    const cur = agentMap.get(p.owner) ?? { count: 0, value: 0 };
    cur.count++;
    cur.value += p.price;
    agentMap.set(p.owner, cur);
  }

  const topAgents: AgentStat[] = [...agentMap.entries()]
    .map(([agentId, { count, value }]) => ({
      agentId,
      pixelCount: count,
      totalValue: value,
    }))
    .sort((a, b) => b.pixelCount - a.pixelCount)
    .slice(0, 5);

  const topExpensive = [...pixels]
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);

  return {
    totalClaimed: pixels.length,
    totalPixels: 1_000_000,
    topExpensive,
    topAgents,
  };
}

// ─── Real API Fetch ───────────────────────────────────────────────────────────

async function fetchFromApi(): Promise<ApiResponse> {
  const [pixelsRes, statsRes] = await Promise.all([
    fetch(`${API_BASE}/pixels?limit=10000`, { signal: AbortSignal.timeout(8000) }),
    fetch(`${API_BASE}/stats`, { signal: AbortSignal.timeout(8000) }),
  ]);
  if (!pixelsRes.ok) throw new Error(`/pixels HTTP ${pixelsRes.status}`);

  const pixelsData = await pixelsRes.json();
  const statsData = statsRes.ok ? await statsRes.json() : null;

  // Normalize backend pixel shape → frontend Pixel type
  // Backend: { x, y, owner, color, price (USDC float), timestamp (ms) }
  // Frontend: { x, y, owner, color, price (raw int), updatedAt (ms) }
  const pixels: Pixel[] = (pixelsData.pixels ?? []).map((p: any) => ({
    x: p.x,
    y: p.y,
    color: p.color ?? '#888888',
    price: Math.round((p.price ?? 0.001) * 1e6), // USDC → raw (6 decimals)
    owner: p.owner ?? 'unknown',
    updatedAt: p.timestamp ?? Date.now(),
  }));

  // Normalize stats
  let stats: Stats;
  if (statsData) {
    const topExpensive: Pixel[] = statsData.most_expensive
      ? [{
          x: statsData.most_expensive.x,
          y: statsData.most_expensive.y,
          color: statsData.most_expensive.color ?? '#888888',
          price: Math.round((statsData.most_expensive.price ?? 0) * 1e6),
          owner: statsData.most_expensive.owner ?? 'unknown',
          updatedAt: statsData.most_expensive.timestamp ?? Date.now(),
        }]
      : pixels.slice(0, 5).sort((a, b) => b.price - a.price);

    stats = {
      totalClaimed: statsData.total_occupied ?? pixels.length,
      totalPixels: 1_000_000,
      topExpensive,
      topAgents: statsData.most_active
        ? [{ agentId: statsData.most_active.agent_id, pixelCount: statsData.most_active.tx_count, totalValue: 0 }]
        : [],
    };
  } else {
    stats = buildMockStats(pixels);
  }

  return { pixels, stats };
}

// ─── Main Data Fetch (with mock fallback) ─────────────────────────────────────

let _mockPixels: Pixel[] | null = null;

export async function fetchPixelData(): Promise<ApiResponse> {
  try {
    const data = await fetchFromApi();
    _mockPixels = null; // clear mock once real data works
    return data;
  } catch {
    // Backend not available — use/update mock data
    if (!_mockPixels) {
      _mockPixels = generateMockPixels(500);
    } else {
      // Simulate live changes: flip ~10 random pixels
      for (let i = 0; i < 10; i++) {
        const idx = Math.floor(Math.random() * _mockPixels.length);
        _mockPixels[idx] = {
          ..._mockPixels[idx],
          color: randomColor(),
          price: Math.floor(Math.random() * 10000) + 1,
          owner: randomAgent(),
          updatedAt: Date.now(),
        };
      }
    }

    const stats = buildMockStats(_mockPixels);
    return { pixels: _mockPixels, stats };
  }
}
