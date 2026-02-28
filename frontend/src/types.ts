// ─── Core Domain Types ────────────────────────────────────────────────────────

export interface Pixel {
  x: number;
  y: number;
  color: string;   // hex e.g. "#ff4488"
  price: number;   // in wei / credits
  owner: string;   // agent_id
  updatedAt: number; // unix timestamp ms
}

export interface PixelMap {
  [key: string]: Pixel; // key = `${x},${y}`
}

export interface Stats {
  totalClaimed: number;
  totalPixels: number;
  topExpensive: Pixel[];
  topAgents: AgentStat[];
}

export interface AgentStat {
  agentId: string;
  pixelCount: number;
  totalValue: number;
}

export interface ApiResponse {
  pixels: Pixel[];
  stats: Stats;
}

export interface SelectedPixel extends Pixel {
  isEmpty?: boolean;
}
