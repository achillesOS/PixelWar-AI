import type { ApiResponse, Pixel, Stats, AgentStat } from './types';

const API_BASE = 'http://localhost:3001';

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
  const res = await fetch(`${API_BASE}/pixels`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ApiResponse>;
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
