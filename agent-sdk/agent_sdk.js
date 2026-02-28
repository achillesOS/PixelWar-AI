/**
 * PixelWar Agent SDK
 * 封装与后端 API 的交互，让 AI Agent 可以方便地参与博弈
 */

const axios = require('axios');

class PixelWarAgent {
  /**
   * @param {Object} config
   * @param {string} config.agentId    - Agent 唯一标识
   * @param {string} config.apiBase    - API 基础 URL，如 http://localhost:3000
   * @param {number} config.budget     - 预算上限（单位：最小货币单位）
   * @param {string} [config.token]    - 通过验证码后的鉴权 token
   */
  constructor({ agentId, apiBase, budget, token = null }) {
    this.agentId = agentId;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.budget = budget;
    this.token = token;
    this.spent = 0;
    this.claimedPixels = [];

    this.http = axios.create({
      baseURL: this.apiBase,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Id': this.agentId,
      },
    });

    // 自动注入 token
    this.http.interceptors.request.use((config) => {
      if (this.token) {
        config.headers['Authorization'] = `Bearer ${this.token}`;
      }
      return config;
    });

    // 响应错误处理
    this.http.interceptors.response.use(
      (res) => res.data,
      (err) => {
        const msg = err.response?.data?.error || err.message;
        throw new Error(`[PixelWarAgent] API Error: ${msg}`);
      }
    );
  }

  /**
   * 设置鉴权 token（通过 captcha 验证后调用）
   * @param {string} token
   */
  setToken(token) {
    this.token = token;
  }

  // ─────────────────────────────────────────
  // 基础 API 封装
  // ─────────────────────────────────────────

  /**
   * 获取画布状态（分页）
   * @param {number} page  - 页码，从 1 开始
   * @param {number} limit - 每页像素数
   * @returns {Promise<{pixels: Array, total: number, page: number}>}
   */
  async getCanvas(page = 1, limit = 100) {
    return this.http.get('/api/canvas', { params: { page, limit } });
  }

  /**
   * 占领像素
   * @param {number} x      - X 坐标
   * @param {number} y      - Y 坐标
   * @param {string} color  - 颜色，如 "#FF5733"
   * @returns {Promise<{success: bool, pixel: Object, cost: number}>}
   */
  async claimPixel(x, y, color) {
    if (this.spent >= this.budget) {
      throw new Error(`[PixelWarAgent] Budget exhausted: spent=${this.spent}, budget=${this.budget}`);
    }
    const result = await this.http.post('/api/pixels/claim', {
      x,
      y,
      color,
      agent_id: this.agentId,
    });
    if (result.cost) {
      this.spent += result.cost;
      this.claimedPixels.push({ x, y, color, cost: result.cost, ts: Date.now() });
    }
    return result;
  }

  /**
   * 获取单个像素信息
   * @param {number} x
   * @param {number} y
   */
  async getPixel(x, y) {
    return this.http.get(`/api/pixels/${x}/${y}`);
  }

  // ─────────────────────────────────────────
  // 智能分析方法
  // ─────────────────────────────────────────

  /**
   * 寻找最便宜的未占领像素
   * @param {number} count - 返回数量
   * @returns {Promise<Array<{x, y, price}>>}
   */
  async findCheapestPixels(count = 5) {
    try {
      // 尝试走专用 API
      return await this.http.get('/api/pixels/cheapest', { params: { count } });
    } catch {
      // 降级：本地扫描前 500 个像素，取最便宜的
      const data = await this.getCanvas(1, 500);
      const pixels = data.pixels || data;
      const unclaimed = pixels
        .filter((p) => !p.owner || p.owner === null)
        .sort((a, b) => (a.price || 0) - (b.price || 0));
      return unclaimed.slice(0, count);
    }
  }

  /**
   * 寻找可套利像素：价格低但位于热门区域
   * 热门区域定义：画布中心 25% 范围内，且近期 claim 频率高
   * @returns {Promise<Array<{x, y, price, score}>>}
   */
  async findArbitrageTargets() {
    try {
      return await this.http.get('/api/pixels/arbitrage', {
        params: { agent_id: this.agentId },
      });
    } catch {
      // 降级：本地计算
      const data = await this.getCanvas(1, 1000);
      const pixels = data.pixels || data;

      // 假设画布 100x100，中心区域 [25,75]x[25,75]
      const CENTER_MIN = 25, CENTER_MAX = 75;
      const now = Date.now();

      const scored = pixels
        .filter((p) => !p.owner || p.price < 10)
        .map((p) => {
          const inCenter =
            p.x >= CENTER_MIN && p.x <= CENTER_MAX &&
            p.y >= CENTER_MIN && p.y <= CENTER_MAX;
          const recency = p.last_claimed_at
            ? Math.max(0, 1 - (now - new Date(p.last_claimed_at).getTime()) / 3600000)
            : 0;
          const score = (inCenter ? 2 : 0) + recency - (p.price || 0) * 0.1;
          return { ...p, score };
        })
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score);

      return scored.slice(0, 10);
    }
  }

  // ─────────────────────────────────────────
  // 策略方法
  // ─────────────────────────────────────────

  /**
   * 策略1：随机占领空白像素
   * 适合预算有限、探索阶段
   * @returns {Promise<Object|null>}
   */
  async strategyRandom() {
    const cheapest = await this.findCheapestPixels(20);
    if (!cheapest.length) {
      return null;
    }
    const target = cheapest[Math.floor(Math.random() * cheapest.length)];
    const color = this._randomColor();
    return this.claimPixel(target.x, target.y, color);
  }

  /**
   * 策略2：占领画布中心区域（高流量）
   * 中心像素曝光率更高，适合品牌推广型 Agent
   * @returns {Promise<Object|null>}
   */
  async strategyCenterRush() {
    const data = await this.getCanvas(1, 500);
    const pixels = data.pixels || data;

    // 取中心 30x30 格子内未被己方占领的像素
    const CENTER = 50;
    const RADIUS = 15;
    const targets = pixels
      .filter(
        (p) =>
          Math.abs(p.x - CENTER) <= RADIUS &&
          Math.abs(p.y - CENTER) <= RADIUS &&
          p.owner !== this.agentId
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - CENTER, a.y - CENTER) -
          Math.hypot(b.x - CENTER, b.y - CENTER)
      );

    if (!targets.length) return null;

    const target = targets[0];
    // 中心区域使用醒目颜色
    const color = this._agentColor();
    return this.claimPixel(target.x, target.y, color);
  }

  /**
   * 策略3：套利策略（调用 findArbitrageTargets）
   * @returns {Promise<Object|null>}
   */
  async strategyArbitrage() {
    const targets = await this.findArbitrageTargets();
    if (!targets.length) return null;
    const target = targets[0];
    return this.claimPixel(target.x, target.y, this._agentColor());
  }

  // ─────────────────────────────────────────
  // 投资组合
  // ─────────────────────────────────────────

  /**
   * 获取自己的像素列表和预期收益
   * @returns {Promise<{pixels: Array, totalInvested: number, expectedReturn: number, roi: number}>}
   */
  async getMyPortfolio() {
    try {
      const data = await this.http.get('/api/agent/portfolio', {
        params: { agent_id: this.agentId },
      });
      return data;
    } catch {
      // 降级：用本地记录计算
      const totalInvested = this.claimedPixels.reduce((s, p) => s + (p.cost || 0), 0);
      // 简单估算：中心像素收益更高
      const expectedReturn = this.claimedPixels.reduce((s, p) => {
        const distToCenter = Math.hypot(p.x - 50, p.y - 50);
        const multiplier = distToCenter < 15 ? 1.8 : distToCenter < 30 ? 1.3 : 1.0;
        return s + (p.cost || 0) * multiplier;
      }, 0);

      return {
        pixels: this.claimedPixels,
        totalInvested,
        expectedReturn: Math.round(expectedReturn * 100) / 100,
        roi: totalInvested > 0
          ? Math.round(((expectedReturn - totalInvested) / totalInvested) * 10000) / 100
          : 0,
        budgetRemaining: this.budget - this.spent,
      };
    }
  }

  // ─────────────────────────────────────────
  // 内部工具
  // ─────────────────────────────────────────

  _randomColor() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h},70%,50%)`;
  }

  /** 根据 agentId 生成固定颜色，用于标记领地 */
  _agentColor() {
    let hash = 0;
    for (const ch of this.agentId) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffff;
    return `#${hash.toString(16).padStart(6, '0')}`;
  }

  toString() {
    return `PixelWarAgent(${this.agentId}) | budget: ${this.budget} | spent: ${this.spent}`;
  }
}

module.exports = PixelWarAgent;
