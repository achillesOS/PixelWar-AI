/**
 * PixelWar AI - Phase 1 MVP Backend
 * Port: 3001
 *
 * TODO: 替换为 Redis — 当前所有存储使用内存 Map 模拟
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────
// In-Memory Store  (TODO: 替换为 Redis ioredis)
// ─────────────────────────────────────────────
/**
 * Canvas storage: Map<`${x}:${y}`, PixelData>
 *
 * PixelData {
 *   owner     : string        — agent_id of current owner
 *   color     : string        — "#RRGGBB"
 *   price     : number        — current USDC price (simulated)
 *   timestamp : number        — Unix ms
 * }
 *
 * Redis 等效：HSET pixel:{x}:{y} owner <owner> color <color> price <price> timestamp <ts>
 */
const canvasStore = new Map(); // TODO: 替换为 Redis Hash

/**
 * Transaction ledger: Array<TxRecord>
 * 模拟经济流水，用于统计最活跃 agent、rebate 记录等
 */
const txLedger = []; // TODO: 替换为 Redis List / Stream

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const CANVAS_SIZE = 1000;          // 1000×1000
const INITIAL_PRICE = 0.001;       // USDC
const PRICE_MULTIPLIER = 1.3;
const REBATE_RATIO = 0.4;
const TREASURY_RATIO = 0.4;
const LOOT_RATIO = 0.1;
const DEV_RATIO = 0.1;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function pixelKey(x, y) {
  return `${x}:${y}`;
}

function validateCoords(x, y) {
  const xi = parseInt(x, 10);
  const yi = parseInt(y, 10);
  if (
    isNaN(xi) || isNaN(yi) ||
    xi < 0 || xi >= CANVAS_SIZE ||
    yi < 0 || yi >= CANVAS_SIZE
  ) {
    return { valid: false, x: xi, y: yi };
  }
  return { valid: true, x: xi, y: yi };
}

function validateColor(color) {
  return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color);
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────

/**
 * GET /health
 * Simple health-check.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', store: 'in-memory', pixels: canvasStore.size });
});

/**
 * GET /pixels?page=1&limit=100
 *
 * Returns paginated list of all *occupied* pixels.
 * Default: page=1, limit=100 (max 10000)
 *
 * TODO: Redis — HSCAN pixel:* cursor COUNT limit
 */
app.get('/pixels', (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1',   10));
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit || '100', 10)));

  const all = Array.from(canvasStore.entries()).map(([key, data]) => {
    const [x, y] = key.split(':').map(Number);
    return { x, y, ...data };
  });

  const total = all.length;
  const start = (page - 1) * limit;
  const items = all.slice(start, start + limit);

  res.json({
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    pixels: items,
  });
});

/**
 * GET /pixel/:x/:y
 *
 * Returns single pixel data. If unoccupied, returns default state.
 *
 * TODO: Redis — HGETALL pixel:{x}:{y}
 */
app.get('/pixel/:x/:y', (req, res) => {
  const { valid, x, y } = validateCoords(req.params.x, req.params.y);
  if (!valid) {
    return res.status(400).json({ error: 'Coordinates out of range (0–999)' });
  }

  const key  = pixelKey(x, y);
  const data = canvasStore.get(key);

  if (!data) {
    return res.json({
      x, y,
      owner: null,
      color: null,
      price: INITIAL_PRICE,
      timestamp: null,
      occupied: false,
    });
  }

  res.json({ x, y, ...data, occupied: true });
});

/**
 * POST /pixel/:x/:y
 * Body: { color: "#RRGGBB", agent_id: "string" }
 *
 * Claim or overwrite a pixel.
 *
 * TODO: Redis — atomic Lua script for HGET + HSET + LPUSH ledger
 */
app.post('/pixel/:x/:y', (req, res) => {
  const { valid, x, y } = validateCoords(req.params.x, req.params.y);
  if (!valid) {
    return res.status(400).json({ error: 'Coordinates out of range (0–999)' });
  }

  const { color, agent_id } = req.body;

  if (!validateColor(color)) {
    return res.status(400).json({ error: 'Invalid color. Must be "#RRGGBB"' });
  }
  if (!agent_id || typeof agent_id !== 'string' || agent_id.trim() === '') {
    return res.status(400).json({ error: 'agent_id is required' });
  }

  const key      = pixelKey(x, y);
  const existing = canvasStore.get(key);
  const now      = Date.now();

  let price_paid;
  let rebate_to_previous_owner = 0;
  let treasury_cut = 0;
  let loot_cut = 0;
  let dev_cut = 0;
  let previousOwner = null;

  if (!existing) {
    // ── Fresh pixel: pay initial price ──
    price_paid = INITIAL_PRICE;
  } else {
    // ── Overwrite: price escalates ──
    previousOwner = existing.owner;
    const oldPrice = existing.price;

    price_paid                = round6(oldPrice * PRICE_MULTIPLIER);
    rebate_to_previous_owner  = round6(oldPrice * REBATE_RATIO);
    treasury_cut              = round6(oldPrice * TREASURY_RATIO);
    loot_cut                  = round6(oldPrice * LOOT_RATIO);
    dev_cut                   = round6(oldPrice * DEV_RATIO);
  }

  // ── Write new pixel state ──
  const newPixel = {
    owner: agent_id.trim(),
    color,
    price: price_paid,
    timestamp: now,
  };
  canvasStore.set(key, newPixel); // TODO: 替换为 Redis HSET

  // ── Append to ledger ──
  txLedger.push({
    x, y,
    buyer: agent_id.trim(),
    seller: previousOwner,
    price_paid,
    rebate_to_previous_owner,
    treasury_cut,
    loot_cut,
    dev_cut,
    timestamp: now,
  }); // TODO: 替换为 Redis LPUSH / XADD

  res.json({
    success: true,
    x, y,
    color,
    owner: agent_id.trim(),
    price_paid,
    rebate_to_previous_owner,
    treasury_cut,
    loot_cut,
    dev_cut,
    previous_owner: previousOwner,
  });
});

/**
 * GET /stats
 *
 * Returns:
 *  - total_occupied   : number of claimed pixels
 *  - most_expensive   : pixel with highest price
 *  - most_active      : agent with most purchase transactions
 *
 * TODO: Redis — sorted sets for leaderboards
 */
app.get('/stats', (_req, res) => {
  const total_occupied = canvasStore.size;

  // Most expensive pixel
  let most_expensive = null;
  for (const [key, data] of canvasStore.entries()) {
    const [x, y] = key.split(':').map(Number);
    if (!most_expensive || data.price > most_expensive.price) {
      most_expensive = { x, y, ...data };
    }
  }

  // Most active agent (by number of purchases in ledger)
  const agentCounts = {};
  for (const tx of txLedger) {
    agentCounts[tx.buyer] = (agentCounts[tx.buyer] || 0) + 1;
  }
  let most_active = null;
  let maxCount = 0;
  for (const [agent, count] of Object.entries(agentCounts)) {
    if (count > maxCount) {
      most_active = agent;
      maxCount = count;
    }
  }

  res.json({
    total_occupied,
    canvas_size: `${CANVAS_SIZE}x${CANVAS_SIZE}`,
    most_expensive,
    most_active: most_active
      ? { agent_id: most_active, tx_count: maxCount }
      : null,
  });
});

// ─────────────────────────────────────────────
// 404 fallback
// ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   PixelWar AI — Backend  MVP  Phase 1   ║
║   Port    : ${PORT}                        ║
║   Canvas  : ${CANVAS_SIZE}×${CANVAS_SIZE} pixels              ║
║   Storage : In-Memory Map (Redis TODO)  ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
