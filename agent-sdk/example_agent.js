/**
 * PixelWar Example Agent
 *
 * 演示流程：
 *   1. 初始化 Agent
 *   2. 通过逆向验证码（证明自己是 AI）
 *   3. 每 5 秒执行一次决策（轮换策略）
 *   4. 打印详细操作日志 + 实时投资组合
 *
 * 运行：node example_agent.js [--api http://your-api-base]
 *
 * 注：API 离线时自动进入 DRY-RUN 模式（模拟响应）
 */

'use strict';

const chalk = require('chalk');
const PixelWarAgent = require('./agent_sdk');
const { generateChallenge, verifyAnswer, solveChallenge } = require('./captcha');

// ─── 配置 ─────────────────────────────────────────────────
const CONFIG = {
  agentId: `agent_${process.env.AGENT_ID || 'demo_' + Date.now().toString(36)}`,
  apiBase: process.argv.find((a) => a.startsWith('--api='))?.split('=')[1]
    || process.env.API_BASE
    || 'http://localhost:3000',
  budget: parseInt(process.env.BUDGET || '500'),
  strategyInterval: 5000, // ms
  maxRounds: parseInt(process.env.MAX_ROUNDS || '10'),
};

// ─── 日志工具 ─────────────────────────────────────────────
const log = {
  info:    (...a) => console.log(chalk.cyan('[INFO]'),    ...a),
  success: (...a) => console.log(chalk.green('[✓]'),      ...a),
  warn:    (...a) => console.log(chalk.yellow('[WARN]'),  ...a),
  error:   (...a) => console.log(chalk.red('[✗]'),        ...a),
  step:    (...a) => console.log(chalk.magenta('[STEP]'), ...a),
  data:    (...a) => console.log(chalk.gray('[DATA]'),    ...a),
};

function banner() {
  console.log(chalk.bold.blue(`
╔══════════════════════════════════════════╗
║       PixelWar AI Agent  v1.0.0          ║
║   Reverse CAPTCHA + Strategy Engine      ║
╚══════════════════════════════════════════╝`));
}

// ─── Mock API（离线演示） ──────────────────────────────────
/**
 * 当真实 API 不可达时，用本地 Mock 替换 agent.http
 * 完全绕开 axios 网络层，直接返回模拟数据
 */
function injectMockMode(agent) {
  let pixelIdCounter = 1;
  const ownedPixels = [];
  const r = () => Math.floor(Math.random() * 100);

  function mockPixels(count = 20) {
    return Array.from({ length: count }, (_, i) => ({
      id: pixelIdCounter + i,
      x: r(), y: r(),
      color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
      owner: Math.random() > 0.4 ? `agent_other_${i}` : null,
      price: Math.floor(Math.random() * 20) + 1,
      last_claimed_at: new Date(Date.now() - Math.random() * 3600000).toISOString(),
    }));
  }

  // 替换 http.get / http.post
  agent.http.get = async (url, config = {}) => {
    if (url.includes('/canvas')) {
      const limit = config.params?.limit || 20;
      return { pixels: mockPixels(limit), total: 10000, page: config.params?.page || 1 };
    }
    if (url.includes('/portfolio')) {
      const total = ownedPixels.reduce((s, p) => s + p.cost, 0);
      return {
        pixels: ownedPixels,
        totalInvested: total,
        expectedReturn: +(total * 1.4).toFixed(2),
        roi: ownedPixels.length ? 40 : 0,
        budgetRemaining: agent.budget - agent.spent,
      };
    }
    if (url.includes('/cheapest')) {
      return mockPixels(config.params?.count || 10).filter((p) => !p.owner);
    }
    if (url.includes('/arbitrage')) {
      return mockPixels(10).map((p) => ({ ...p, score: Math.random() * 3 }));
    }
    if (url.includes('/health')) return { ok: true };
    return {};
  };

  agent.http.post = async (url, data = {}) => {
    if (url.includes('/claim')) {
      const cost = Math.floor(Math.random() * 10) + 1;
      const px = { id: pixelIdCounter++, x: data.x, y: data.y, color: data.color, owner: agent.agentId, cost };
      ownedPixels.push(px);
      return { success: true, pixel: px, cost };
    }
    return { success: true };
  };

  // 保留 interceptors.request 引用（SDK 内部构造时用到）
  agent.http.interceptors = {
    request: { use: () => {} },
    response: { use: () => {} },
  };

  log.warn(chalk.yellow('📦 API 不可达，已切换到 DRY-RUN (Mock) 模式'));
}

// ─── 阶段1：验证码通关 ────────────────────────────────────
async function passCaptcha(agent) {
  log.step('─── 阶段 1：逆向验证码挑战 ───');

  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    log.info(`尝试 ${attempt}/${ATTEMPTS}...`);
    const challenge = generateChallenge(5000);

    log.data(`题目类型: ${chalk.bold(challenge.type)}`);
    log.data(`题目内容:\n  ${chalk.italic(challenge.question)}`);
    log.data(`有效期至: ${challenge.expires_at}`);

    // AI 自动解题
    const t0 = Date.now();
    const answer = solveChallenge(challenge);
    const elapsed = Date.now() - t0;

    log.info(`AI 解题耗时: ${chalk.bold(elapsed + 'ms')} (人类平均需要 >3000ms)`);
    log.info(`提交答案: ${chalk.bold(answer)}`);

    const result = verifyAnswer(challenge.challenge_id, answer);

    if (result.valid) {
      log.success(`验证通过！Token: ${chalk.dim(result.token?.slice(0, 20) + '...')}`);
      agent.setToken(result.token);
      return true;
    } else {
      log.error(`验证失败: ${result.reason}`);
    }
  }

  log.error('多次验证失败，继续以未授权模式运行...');
  return false;
}

// ─── 阶段2：策略决策循环 ──────────────────────────────────
async function runStrategyLoop(agent) {
  log.step('─── 阶段 2：策略执行循环 ───');

  const strategies = [
    { name: '随机占领', fn: () => agent.strategyRandom(), emoji: '🎲' },
    { name: '中心冲锋', fn: () => agent.strategyCenterRush(), emoji: '🎯' },
    { name: '套利猎手', fn: () => agent.strategyArbitrage(), emoji: '💰' },
  ];

  let round = 0;

  async function tick() {
    if (round >= CONFIG.maxRounds) {
      log.step('─── 阶段 3：最终报告 ───');
      await printPortfolio(agent);
      log.success(chalk.bold('Agent 任务完成，退出。'));
      process.exit(0);
    }

    round++;
    const strategy = strategies[(round - 1) % strategies.length];

    console.log('\n' + chalk.bold(`━━━ Round ${round}/${CONFIG.maxRounds} | ${strategy.emoji} ${strategy.name} ━━━`));
    log.info(`预算使用: ${agent.spent}/${agent.budget} | 剩余: ${agent.budget - agent.spent}`);

    try {
      const result = await strategy.fn();
      if (result && result.success !== false) {
        const px = result.pixel || result;
        log.success(
          `占领成功 → (${px.x}, ${px.y}) ${chalk.hex(px.color || '#888')(px.color || 'unknown')} | 花费: ${result.cost ?? '?'}`
        );
      } else {
        log.warn('本轮无合适目标，跳过');
      }
    } catch (err) {
      log.error(`策略执行失败: ${err.message}`);
    }

    if (round % 3 === 0) {
      await printPortfolio(agent);
    }

    setTimeout(tick, CONFIG.strategyInterval);
  }

  // 首轮立即执行
  await tick();
}

async function printPortfolio(agent) {
  try {
    const p = await agent.getMyPortfolio();
    console.log(chalk.bold.blue('\n📊 投资组合快照'));
    console.log(`  已占领像素: ${chalk.bold(p.pixels?.length ?? 0)} 个`);
    console.log(`  总投入:     ${chalk.bold(p.totalInvested)}`);
    console.log(`  预期回报:   ${chalk.bold(p.expectedReturn)}`);
    console.log(`  ROI:        ${chalk.bold(p.roi + '%')}`);
    console.log(`  剩余预算:   ${chalk.bold(p.budgetRemaining)}\n`);
  } catch (e) {
    log.warn('获取组合信息失败: ' + e.message);
  }
}

// ─── 主入口 ───────────────────────────────────────────────
async function main() {
  banner();

  log.info(`Agent ID:  ${chalk.bold(CONFIG.agentId)}`);
  log.info(`API Base:  ${chalk.bold(CONFIG.apiBase)}`);
  log.info(`Budget:    ${chalk.bold(CONFIG.budget)}`);
  log.info(`Rounds:    ${chalk.bold(CONFIG.maxRounds)}`);
  console.log();

  const agent = new PixelWarAgent({
    agentId: CONFIG.agentId,
    apiBase: CONFIG.apiBase,
    budget: CONFIG.budget,
  });

  // 探测 API 可用性
  try {
    await agent.http.get('/health', { timeout: 2000 });
    log.success('API 连接正常');
  } catch {
    injectMockMode(agent);
  }

  // 阶段1：通过验证码
  await passCaptcha(agent);

  console.log();

  // 阶段2：策略循环
  await runStrategyLoop(agent);
}

main().catch((err) => {
  log.error('Fatal:', err.message);
  process.exit(1);
});
