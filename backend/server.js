/**
 * PixelWar AI - Phase 1 MVP Backend
 * Port: 3001
 *
 * x402 Payment Integration: HTTP 402 Payment Required flow
 * TODO: 替换为 Redis — 当前所有存储使用内存 Map 模拟
 */

const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────
// x402 Payment Config
// ─────────────────────────────────────────────
const OWNER_WALLET_ADDRESS = process.env.OWNER_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';
const PAYMENT_NETWORK = process.env.PAYMENT_NETWORK || 'base-sepolia';
const PAYMENT_TOKEN = 'USDC';
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://sepolia.base.org';

// USDC contract addresses
const USDC_ADDRESS = PAYMENT_NETWORK === 'base-mainnet'
  ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  : '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // base-sepolia

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

// RPC provider (lazy init)
let _provider = null;
function getProvider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
  return _provider;
}

// Track used tx hashes to prevent replay attacks
const usedTxHashes = new Set();

// ─────────────────────────────────────────────
// In-Memory Store  (TODO: 替换为 Redis ioredis)
// ─────────────────────────────────────────────
/**
 * Canvas storage: Map<`${x}:${y}`, PixelData>
 *
 * PixelData {
 *   owner     : string        — agent_id of current owner
 *   color     : string        — "#RRGGBB"
 *   price     : number        — current USDC price
 *   timestamp : number        — Unix ms
 * }
 */
const canvasStore = new Map(); // TODO: 替换为 Redis Hash

/**
 * Transaction ledger: Array<TxRecord>
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

/**
 * Calculate price for a pixel (fresh or overwrite).
 */
function calcPrice(existing) {
  if (!existing) return INITIAL_PRICE;
  return round6(existing.price * PRICE_MULTIPLIER);
}

/**
 * Parse X-PAYMENT header.
 * Accepts JSON or plain string tx_hash.
 * Returns { tx_hash, raw } or null.
 */
function parsePaymentHeader(header) {
  if (!header) return null;
  try {
    const parsed = JSON.parse(header);
    return {
      tx_hash: parsed.tx_hash || parsed.txHash || parsed.transaction_hash || header,
      raw: parsed,
    };
  } catch {
    // Treat as plain tx_hash string
    return { tx_hash: header, raw: header };
  }
}

/**
 * On-chain payment verification via Base RPC.
 * Verifies:
 *   1. tx exists and succeeded (status === 1)
 *   2. USDC Transfer event: from=payer, to=OWNER_WALLET, amount>=expected
 *   3. tx_hash not previously used (anti-replay)
 *
 * Returns { ok: boolean, reason?: string }
 */
async function verifyPaymentOnChain(paymentProof, expectedPriceUsdc) {
  if (!paymentProof || !paymentProof.tx_hash) {
    return { ok: false, reason: 'missing tx_hash' };
  }
  const txHash = paymentProof.tx_hash;

  // Anti-replay
  if (usedTxHashes.has(txHash)) {
    return { ok: false, reason: 'tx_hash already used' };
  }

  // If owner wallet is zero address, skip on-chain check (dev mode)
  if (OWNER_WALLET_ADDRESS === '0x0000000000000000000000000000000000000000') {
    console.warn('[payment] OWNER_WALLET_ADDRESS not set — skipping on-chain verify (dev mode)');
    usedTxHashes.add(txHash);
    return { ok: true };
  }

  try {
    const provider = getProvider();
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) return { ok: false, reason: 'tx not found on chain' };
    if (receipt.status !== 1) return { ok: false, reason: 'tx failed on chain' };

    // Find USDC Transfer log: Transfer(from, to=OWNER_WALLET, amount)
    const ownerLower = OWNER_WALLET_ADDRESS.toLowerCase();
    const usdcLower = USDC_ADDRESS.toLowerCase();

    const log = receipt.logs.find(l =>
      l.address.toLowerCase() === usdcLower &&
      l.topics[0] === TRANSFER_TOPIC &&
      l.topics.length === 3 &&
      ('0x' + l.topics[2].slice(26)).toLowerCase() === ownerLower
    );

    if (!log) return { ok: false, reason: 'no matching USDC Transfer to owner' };

    // Decode amount (USDC has 6 decimals)
    const amount = BigInt(log.data);
    const expectedRaw = BigInt(Math.round(expectedPriceUsdc * 1e6));

    if (amount < expectedRaw) {
      return { ok: false, reason: `amount too low: got ${amount}, expected ${expectedRaw}` };
    }

    usedTxHashes.add(txHash);
    return { ok: true };
  } catch (err) {
    console.error('[payment] on-chain verify error:', err.message);
    // Fail open in dev, fail closed in prod
    return { ok: false, reason: `rpc error: ${err.message}` };
  }
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
  res.json({
    status: 'ok',
    store: 'in-memory',
    pixels: canvasStore.size,
    payment: 'x402',
    network: PAYMENT_NETWORK,
    owner_wallet: OWNER_WALLET_ADDRESS,
  });
});

/**
 * GET /pixels?page=1&limit=100
 *
 * Returns paginated list of all *occupied* pixels.
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
 * x402 Payment Flow:
 *
 * Step 1 — No X-PAYMENT header:
 *   → 402 Payment Required + { price_usdc, wallet_address, network, token, x, y }
 *
 * Step 2 — With X-PAYMENT header (tx_hash or JSON proof):
 *   → Verify payment → Execute pixel claim
 *   → 200 { success, x, y, color, owner, price_paid, ... }
 *
 * TODO: Redis — atomic Lua script for HGET + HSET + LPUSH ledger
 */
app.post('/pixel/:x/:y', async (req, res) => {
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
  const price_usdc = calcPrice(existing);

  // ── x402: Check for payment header ──
  const paymentHeader = req.headers['x-payment'];

  if (!paymentHeader) {
    // ── STEP 1: Return 402 Payment Required ──
    return res.status(402).json({
      x402Version: 1,
      error: 'Payment Required',
      accepts: [
        {
          scheme: 'exact',
          network: PAYMENT_NETWORK,
          maxAmountRequired: String(Math.round(price_usdc * 1e6)), // in USDC base units (6 decimals)
          resource: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
          description: `Claim pixel (${x}, ${y}) on PixelWar AI`,
          mimeType: 'application/json',
          payTo: OWNER_WALLET_ADDRESS,
          maxTimeoutSeconds: 300,
          asset: PAYMENT_TOKEN === 'USDC' && PAYMENT_NETWORK === 'base-sepolia'
            ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'  // USDC on Base Sepolia
            : PAYMENT_NETWORK === 'base'
            ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'  // USDC on Base Mainnet
            : '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          extra: {
            price_usdc,
            wallet_address: OWNER_WALLET_ADDRESS,
            network: PAYMENT_NETWORK,
            token: PAYMENT_TOKEN,
            name: 'PixelWar AI',
          },
        },
      ],
    });
  }

  // ── STEP 2: Validate payment and execute pixel claim ──
  const paymentProof = parsePaymentHeader(paymentHeader);

  const verification = await verifyPaymentOnChain(paymentProof, price_usdc);
  if (!verification.ok) {
    return res.status(402).json({
      error: `Invalid payment: ${verification.reason}`,
      x402Version: 1,
    });
  }

  const now = Date.now();
  let price_paid = price_usdc;
  let rebate_to_previous_owner = 0;
  let treasury_cut = 0;
  let loot_cut = 0;
  let dev_cut = 0;
  let previousOwner = null;

  if (existing) {
    previousOwner = existing.owner;
    const oldPrice = existing.price;
    rebate_to_previous_owner = round6(oldPrice * REBATE_RATIO);
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
    tx_hash: paymentProof.tx_hash,
  };
  canvasStore.set(key, newPixel);

  // ── Append to ledger ──
  txLedger.push({
    x, y,
    buyer: agent_id.trim(),
    seller: previousOwner,
    price_paid,
    tx_hash: paymentProof.tx_hash,
    rebate_to_previous_owner,
    treasury_cut,
    loot_cut,
    dev_cut,
    timestamp: now,
  });

  res.json({
    success: true,
    x, y,
    color,
    owner: agent_id.trim(),
    price_paid,
    tx_hash: paymentProof.tx_hash,
    rebate_to_previous_owner,
    treasury_cut,
    loot_cut,
    dev_cut,
    previous_owner: previousOwner,
  });
});

/**
 * GET /price/:x/:y
 *
 * Returns the current price for a pixel (useful for agents before payment).
 */
app.get('/price/:x/:y', (req, res) => {
  const { valid, x, y } = validateCoords(req.params.x, req.params.y);
  if (!valid) {
    return res.status(400).json({ error: 'Coordinates out of range (0–999)' });
  }

  const existing = canvasStore.get(pixelKey(x, y));
  const price_usdc = calcPrice(existing);

  res.json({
    x, y,
    price_usdc,
    wallet_address: OWNER_WALLET_ADDRESS,
    network: PAYMENT_NETWORK,
    token: PAYMENT_TOKEN,
    occupied: !!existing,
    current_owner: existing ? existing.owner : null,
  });
});

/**
 * GET /stats
 *
 * Returns aggregate stats.
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
    payment_info: {
      protocol: 'x402',
      network: PAYMENT_NETWORK,
      token: PAYMENT_TOKEN,
      owner_wallet: OWNER_WALLET_ADDRESS,
    },
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
╔══════════════════════════════════════════════════╗
║   PixelWar AI — Backend  MVP  Phase 1           ║
║   Port    : ${PORT}                                ║
║   Canvas  : ${CANVAS_SIZE}×${CANVAS_SIZE} pixels                  ║
║   Storage : In-Memory Map (Redis TODO)          ║
║   Payment : x402 / HTTP 402 Protocol            ║
║   Network : ${PAYMENT_NETWORK.padEnd(30)}║
║   Wallet  : ${OWNER_WALLET_ADDRESS.slice(0, 20)}...          ║
╚══════════════════════════════════════════════════╝
  `);
});

module.exports = app;
