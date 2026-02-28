/**
 * PixelWar AI — Pixel Selection Strategies
 * strategy.js
 *
 * Strategies:
 *   random   — Pick any unclaimed pixel at random
 *   center   — Prefer high-traffic center zone (400–600)
 *   edge     — Target low-competition border pixels
 *   heatmap  — Follow the most contested pixels (requires stats API)
 */

export class Strategy {
  /**
   * @param {'random'|'center'|'edge'|'heatmap'} name
   */
  constructor(name = 'random') {
    if (!Strategy.STRATEGIES.includes(name)) {
      throw new Error(`Unknown strategy: "${name}". Valid: ${Strategy.STRATEGIES.join(', ')}`);
    }
    this.name    = name;
    this.claimed = new Set(); // Track what we've tried this session
  }

  static STRATEGIES = ['random', 'center', 'edge', 'heatmap'];

  /** Canvas bounds */
  static WIDTH  = 1000;
  static HEIGHT = 1000;

  /**
   * Pick the next target pixel.
   * @param {object} canvas  - { pixels: [{x, y, owner}] }
   * @param {object} stats   - { heatmap: [{x, y, claim_count}] } (required for heatmap)
   * @returns {{ x: number, y: number } | null}
   */
  pick(canvas, stats = null) {
    switch (this.name) {
      case 'random':  return this.#random(canvas);
      case 'center':  return this.#center(canvas);
      case 'edge':    return this.#edge(canvas);
      case 'heatmap': return this.#heatmap(canvas, stats);
      default:        return this.#random(canvas);
    }
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────────

  /** Build a set of owned pixel keys for fast lookup */
  #buildOwnedSet(canvas) {
    const owned = new Set();
    for (const p of (canvas.pixels || [])) {
      if (p.owner) owned.add(`${p.x},${p.y}`);
    }
    return owned;
  }

  /** Check if a coordinate has already been tried this session */
  #tried(x, y) {
    return this.claimed.has(`${x},${y}`);
  }

  /** Mark a coordinate as tried */
  #markTried(x, y) {
    this.claimed.add(`${x},${y}`);
  }

  /** Return random integer in [min, max] inclusive */
  #randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ─── Strategy: random ───────────────────────────────────────────────────────
  /**
   * Pick a random pixel from the full 1000×1000 canvas.
   * Prefers unclaimed pixels but will overwrite claimed ones if canvas is dense.
   */
  #random(canvas, maxAttempts = 50) {
    const owned = this.#buildOwnedSet(canvas);

    for (let i = 0; i < maxAttempts; i++) {
      const x = this.#randInt(0, Strategy.WIDTH - 1);
      const y = this.#randInt(0, Strategy.HEIGHT - 1);
      if (!this.#tried(x, y) && !owned.has(`${x},${y}`)) {
        this.#markTried(x, y);
        return { x, y };
      }
    }

    // Fallback: any unseen pixel regardless of ownership
    for (let i = 0; i < maxAttempts; i++) {
      const x = this.#randInt(0, Strategy.WIDTH - 1);
      const y = this.#randInt(0, Strategy.HEIGHT - 1);
      if (!this.#tried(x, y)) {
        this.#markTried(x, y);
        return { x, y };
      }
    }

    return null; // Canvas exhausted
  }

  // ─── Strategy: center ───────────────────────────────────────────────────────
  /**
   * Target the 400–600 zone — the most visible, highest-traffic region.
   * Falls back to random if center is saturated.
   */
  #center(canvas, maxAttempts = 100) {
    const CENTER_MIN = 400;
    const CENTER_MAX = 600;
    const owned = this.#buildOwnedSet(canvas);

    // First pass: unclaimed center pixels
    for (let i = 0; i < maxAttempts; i++) {
      const x = this.#randInt(CENTER_MIN, CENTER_MAX);
      const y = this.#randInt(CENTER_MIN, CENTER_MAX);
      if (!this.#tried(x, y) && !owned.has(`${x},${y}`)) {
        this.#markTried(x, y);
        return { x, y };
      }
    }

    // Second pass: any center pixel (overwrite rivals)
    for (let i = 0; i < maxAttempts; i++) {
      const x = this.#randInt(CENTER_MIN, CENTER_MAX);
      const y = this.#randInt(CENTER_MIN, CENTER_MAX);
      if (!this.#tried(x, y)) {
        this.#markTried(x, y);
        return { x, y };
      }
    }

    // Fallback to random
    console.warn('[strategy:center] Center saturated, falling back to random');
    return this.#random(canvas);
  }

  // ─── Strategy: edge ─────────────────────────────────────────────────────────
  /**
   * Target border pixels — low competition, cheap entry point.
   * Border = any pixel where x < 50, x ≥ 950, y < 50, or y ≥ 950
   */
  #edge(canvas, maxAttempts = 100) {
    const BORDER = 50;
    const W = Strategy.WIDTH;
    const H = Strategy.HEIGHT;
    const owned = this.#buildOwnedSet(canvas);

    const isEdge = (x, y) =>
      x < BORDER || x >= W - BORDER || y < BORDER || y >= H - BORDER;

    for (let i = 0; i < maxAttempts; i++) {
      // Bias toward edges: pick a random side, then random position on it
      const side = this.#randInt(0, 3);
      let x, y;
      switch (side) {
        case 0: x = this.#randInt(0, BORDER - 1);     y = this.#randInt(0, H - 1); break; // left
        case 1: x = this.#randInt(W - BORDER, W - 1); y = this.#randInt(0, H - 1); break; // right
        case 2: x = this.#randInt(0, W - 1); y = this.#randInt(0, BORDER - 1);     break; // top
        case 3: x = this.#randInt(0, W - 1); y = this.#randInt(H - BORDER, H - 1); break; // bottom
      }
      if (!this.#tried(x, y) && !owned.has(`${x},${y}`) && isEdge(x, y)) {
        this.#markTried(x, y);
        return { x, y };
      }
    }

    // Fallback: any edge pixel
    for (let i = 0; i < maxAttempts; i++) {
      const x = this.#randInt(0, W - 1);
      const y = this.#randInt(0, H - 1);
      if (isEdge(x, y) && !this.#tried(x, y)) {
        this.#markTried(x, y);
        return { x, y };
      }
    }

    console.warn('[strategy:edge] Edge exhausted, falling back to random');
    return this.#random(canvas);
  }

  // ─── Strategy: heatmap ──────────────────────────────────────────────────────
  /**
   * Follow the action — target pixels with the highest claim_count in stats.
   * Requires: GET /stats → { heatmap: [{x, y, claim_count}] }
   */
  #heatmap(canvas, stats, maxAttempts = 50) {
    if (!stats?.heatmap?.length) {
      console.warn('[strategy:heatmap] No heatmap data, falling back to center');
      return this.#center(canvas);
    }

    // Sort by claim_count descending (hottest first)
    const sorted = [...stats.heatmap].sort((a, b) => b.claim_count - a.claim_count);

    // Pick the hottest pixel we haven't tried
    for (const pixel of sorted) {
      const { x, y } = pixel;
      if (!this.#tried(x, y)) {
        this.#markTried(x, y);
        return { x, y };
      }
    }

    // All hot pixels tried — fallback to center
    console.warn('[strategy:heatmap] Hot pixels exhausted, falling back to center');
    return this.#center(canvas);
  }

  // ─── Utility ────────────────────────────────────────────────────────────────

  /**
   * Reset session memory (useful for multi-run agents)
   */
  reset() {
    this.claimed.clear();
  }

  /**
   * Get info about current strategy
   */
  info() {
    return {
      name: this.name,
      triedCount: this.claimed.size,
      description: Strategy.DESCRIPTIONS[this.name],
    };
  }

  static DESCRIPTIONS = {
    random:  'Pick random unclaimed pixels across the full 1000×1000 canvas',
    center:  'Target the high-traffic 400–600 center zone for maximum visibility',
    edge:    'Claim cheap border pixels (x<50, x>950, y<50, y>950)',
    heatmap: 'Follow the most contested pixels using the live stats API',
  };
}
