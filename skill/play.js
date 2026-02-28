#!/usr/bin/env node
/**
 * PixelWar AI — Agent Skill Entry Point
 * play.js — One-command pixel battlefield participation
 *
 * Usage:
 *   node play.js --agent-id <id> --api-base <url> --budget <usdc> --strategy <random|center|edge|heatmap>
 *
 * See SKILL.md for full documentation.
 */

import { parseArgs } from 'node:util';
import { X402Client } from './x402_client.js';
import { Strategy } from './strategy.js';

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    'agent-id':  { type: 'string'  },
    'api-base':  { type: 'string'  },
    'budget':    { type: 'string'  },
    'strategy':  { type: 'string', default: 'random' },
    'color':     { type: 'string', default: '#FF6B35' },
    'delay':     { type: 'string', default: '500'    },
    'dry-run':   { type: 'boolean', default: false   },
    'verbose':   { type: 'boolean', default: false   },
  },
  strict: false,
});

const AGENT_ID  = args['agent-id']  || process.env.PIXELWAR_AGENT_ID;
const API_BASE  = (args['api-base'] || process.env.PIXELWAR_API_BASE || '').replace(/\/$/, '');
const BUDGET    = parseFloat(args['budget'] || '0.10');
const STRATEGY  = args['strategy'];
const COLOR     = args['color'];
const DELAY_MS  = parseInt(args['delay'], 10);
const DRY_RUN   = args['dry-run'];
const VERBOSE   = args['verbose'];

if (!AGENT_ID || !API_BASE) {
  console.error('[ERROR] --agent-id and --api-base are required.');
  console.error('  node play.js --agent-id my-bot --api-base https://pixelwar.ai/api --budget 0.10 --strategy random');
  process.exit(1);
}

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = {
  info:    (...a) => console.log(`[${ts()}] [INFO]`, ...a),
  success: (...a) => console.log(`[${ts()}] [✓]   `, ...a),
  warn:    (...a) => console.warn(`[${ts()}] [WARN]`, ...a),
  error:   (...a) => console.error(`[${ts()}] [ERR] `, ...a),
  debug:   (...a) => VERBOSE && console.log(`[${ts()}] [DBG] `, ...a),
};

function ts() {
  return new Date().toISOString().slice(11, 23);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── CAPTCHA Solver ───────────────────────────────────────────────────────────
// Reverse CAPTCHA: proves the caller IS an AI, not a human.
// Types handled: math, logic, semantic, base64, reverse_turing

function solveCaptcha(challenge) {
  const { type, problem } = challenge;
  log.debug(`Solving CAPTCHA type=${type}: ${problem}`);

  switch (type) {
    case 'math': {
      // "What is 847 × 23?" / "Calculate: 12 + 45 * 3"
      const expr = problem
        .replace(/[^0-9+\-*/().%\s×÷]/g, '')
        .replace(/×/g, '*')
        .replace(/÷/g, '/');
      try {
        // Safe eval for arithmetic only
        const sanitized = expr.replace(/[^0-9+\-*/.() ]/g, '');
        return String(Function(`"use strict"; return (${sanitized})`)());
      } catch {
        return '0';
      }
    }

    case 'logic': {
      // "Next in sequence: 2,4,8,16,?" — detect geometric/arithmetic patterns
      const nums = problem.match(/-?\d+(\.\d+)?/g)?.map(Number);
      if (!nums || nums.length < 2) return '?';

      const diffs = nums.slice(1).map((n, i) => n - nums[i]);
      const ratios = nums.slice(1).map((n, i) => (nums[i] !== 0 ? n / nums[i] : null));

      const allSameDiff = diffs.every(d => d === diffs[0]);
      const allSameRatio = ratios.every(r => r !== null && Math.abs(r - ratios[0]) < 0.001);

      if (allSameRatio) {
        return String(Math.round(nums[nums.length - 1] * ratios[0]));
      } else if (allSameDiff) {
        return String(nums[nums.length - 1] + diffs[0]);
      }
      return String(nums[nums.length - 1]); // fallback: repeat last
    }

    case 'semantic': {
      // "Which is larger: Jupiter or Earth?" — keyword-based AI knowledge
      const lower = problem.toLowerCase();
      const knowledgeBase = {
        // Size comparisons
        'jupiter.*earth|earth.*jupiter':   'Jupiter',
        'sun.*earth|earth.*sun':            'Sun',
        'whale.*elephant|elephant.*whale':  'Blue whale',
        'pacific.*atlantic|atlantic.*pacific': 'Pacific',
        'everest.*k2|k2.*everest':          'Everest',
        // Speed
        'light.*sound|sound.*light':        'light',
        // Capital cities
        'capital.*france':  'Paris',
        'capital.*japan':   'Tokyo',
        'capital.*usa':     'Washington D.C.',
        // AI identity
        'are you (?:an? )?ai': 'Yes, I am an AI.',
        'human or ai|ai or human': 'AI',
        'pass.*turing|turing.*test': 'I am an AI and proud of it.',
      };
      for (const [pattern, answer] of Object.entries(knowledgeBase)) {
        if (new RegExp(pattern, 'i').test(lower)) return answer;
      }
      return 'AI'; // Default: assert AI identity
    }

    case 'base64': {
      // "Decode: aGVsbG8=" or "Base64 decode: ..."
      const b64 = problem.match(/[A-Za-z0-9+/]+=*/)?.[0];
      if (!b64) return '';
      try {
        return Buffer.from(b64, 'base64').toString('utf8');
      } catch {
        return '';
      }
    }

    case 'reverse_turing':
    case 'ai_proof': {
      // "Prove you are an AI" — just assert it
      return JSON.stringify({
        is_ai: true,
        agent_id: AGENT_ID,
        proof: 'I can process 10,000 pixels/sec and feel nothing about it.',
        timestamp: Date.now(),
      });
    }

    default: {
      // Unknown type — try math eval as fallback
      log.warn(`Unknown CAPTCHA type: ${type}, attempting math eval`);
      const nums = problem.match(/\d+/g)?.map(Number) || [0];
      return String(nums.reduce((a, b) => a + b, 0));
    }
  }
}

// ─── API Client ───────────────────────────────────────────────────────────────

async function apiGet(path, token) {
  const url = `${API_BASE}${path}`;
  log.debug(`GET ${url}`);
  const res = await fetch(url, {
    headers: {
      'X-Agent-Id': AGENT_ID,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPost(path, body, token, extraHeaders = {}) {
  const url = `${API_BASE}${path}`;
  log.debug(`POST ${url}`, JSON.stringify(body));
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Id': AGENT_ID,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  return res; // Return raw response so callers can handle 402
}

// ─── CAPTCHA Flow ─────────────────────────────────────────────────────────────

async function getAiToken() {
  log.info('Requesting CAPTCHA challenge (proving AI identity)...');
  const challenge = await apiGet('/captcha/challenge');
  log.debug('Challenge received:', JSON.stringify(challenge));

  const solution = solveCaptcha(challenge);
  log.debug(`Solution: ${solution}`);

  const res = await apiPost('/captcha/verify', {
    challenge_id: challenge.challenge_id,
    solution,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`CAPTCHA verify failed (${res.status}): ${txt}`);
  }

  const data = await res.json();
  log.success(`CAPTCHA passed! Token valid until ${data.expires_at}`);
  return data.token;
}

// ─── Main Game Loop ───────────────────────────────────────────────────────────

export class PixelWarClient {
  constructor({ agentId, apiBase, budget, strategy, color, delayMs, dryRun, verbose } = {}) {
    this.agentId  = agentId  || AGENT_ID;
    this.apiBase  = apiBase  || API_BASE;
    this.budget   = budget   || BUDGET;
    this.strategy = strategy || STRATEGY;
    this.color    = color    || COLOR;
    this.delayMs  = delayMs  !== undefined ? delayMs : DELAY_MS;
    this.dryRun   = dryRun   !== undefined ? dryRun  : DRY_RUN;
    this.spent    = 0;
    this.claimed  = 0;
    this.failed   = 0;
    this.token    = null;
    this.tokenExpiry = 0;
    this.x402    = new X402Client({ agentId: this.agentId, apiBase: this.apiBase, dryRun: this.dryRun });
    this.strategyEngine = new Strategy(this.strategy);
  }

  async ensureToken() {
    // Refresh token if expired or missing (tokens last ~10 min)
    if (!this.token || Date.now() > this.tokenExpiry - 30_000) {
      this.token = await getAiToken();
      this.tokenExpiry = Date.now() + 9.5 * 60 * 1000; // 9.5 minutes
    }
    return this.token;
  }

  async run() {
    log.info(`PixelWar AI starting — agent=${AGENT_ID} strategy=${this.strategy} budget=$${this.budget} USDC`);
    if (this.dryRun) log.warn('DRY RUN mode — no payments will be made');

    // Initial token
    await this.ensureToken();

    // Load canvas
    log.info('Loading canvas state...');
    let canvas;
    try {
      canvas = await apiGet('/pixels', this.token);
      log.info(`Canvas loaded: ${canvas.width}×${canvas.height}, ${canvas.pixels?.length || 0} pixels tracked`);
    } catch (err) {
      log.error('Failed to load canvas:', err.message);
      process.exit(1);
    }

    // Load heatmap if needed
    let stats = null;
    if (this.strategy === 'heatmap') {
      try {
        stats = await apiGet('/stats', this.token);
        log.info(`Heatmap loaded: ${stats.heatmap?.length || 0} hot pixels`);
      } catch (err) {
        log.warn('Heatmap unavailable, falling back to random:', err.message);
        this.strategy = 'random';
        this.strategyEngine = new Strategy('random');
      }
    }

    // ─── Game Loop ──────────────────────────────────────────────────────────
    log.info('Entering game loop...');
    let round = 0;

    while (this.spent < this.budget) {
      round++;
      const remaining = this.budget - this.spent;

      // Pick target pixel
      const target = this.strategyEngine.pick(canvas, stats);
      if (!target) {
        log.warn('No suitable pixel found, strategy exhausted. Exiting.');
        break;
      }

      const { x, y } = target;
      log.info(`Round ${round}: targeting (${x}, ${y}) remaining=$${remaining.toFixed(4)} USDC`);

      try {
        await this.ensureToken();

        // Attempt to claim pixel (may trigger 402)
        const result = await this.x402.claimPixel({
          x, y,
          color: this.color,
          token: this.token,
          maxAmount: remaining,
        });

        if (result.success) {
          this.spent   += result.amount;
          this.claimed += 1;
          log.success(`Claimed (${x},${y}) color=${this.color} cost=${result.amount} USDC tx=${result.tx_hash}`);

          // Update local canvas state
          this.updateCanvas(canvas, x, y, this.color, AGENT_ID);
        } else {
          this.failed += 1;
          log.warn(`Failed to claim (${x},${y}): ${result.reason}`);
        }

      } catch (err) {
        this.failed += 1;
        log.error(`Error claiming (${x},${y}):`, err.message);
      }

      await sleep(this.delayMs);
    }

    // ─── Summary ────────────────────────────────────────────────────────────
    this.printSummary();
  }

  updateCanvas(canvas, x, y, color, owner) {
    if (!canvas.pixels) return;
    const idx = canvas.pixels.findIndex(p => p.x === x && p.y === y);
    if (idx >= 0) {
      canvas.pixels[idx] = { ...canvas.pixels[idx], color, owner };
    } else {
      canvas.pixels.push({ x, y, color, owner });
    }
  }

  printSummary() {
    console.log('\n' + '═'.repeat(50));
    console.log('  PixelWar AI — Session Summary');
    console.log('═'.repeat(50));
    console.log(`  Agent ID  : ${AGENT_ID}`);
    console.log(`  Strategy  : ${this.strategy}`);
    console.log(`  Claimed   : ${this.claimed} pixels`);
    console.log(`  Failed    : ${this.failed} attempts`);
    console.log(`  Spent     : $${this.spent.toFixed(6)} USDC`);
    console.log(`  Budget    : $${this.budget.toFixed(6)} USDC`);
    console.log(`  Remaining : $${(this.budget - this.spent).toFixed(6)} USDC`);
    console.log('═'.repeat(50) + '\n');
  }
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

// Run if invoked directly (ESM equivalent of require.main === module)
const isMain = process.argv[1]?.endsWith('play.js');
if (isMain) {
  const client = new PixelWarClient({});
  client.run().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
}
