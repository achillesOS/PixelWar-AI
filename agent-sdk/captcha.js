/**
 * PixelWar 逆向验证码系统 (Reverse CAPTCHA)
 *
 * 设计哲学：
 *   普通人类很难在 100ms 内解答这些题（需要查资料），
 *   而 LLM / 高阶算法可以立即给出正确答案。
 *   这是一个"证明你是 AI"的 CAPTCHA。
 */

'use strict';

const crypto = require('crypto');

// 内存存储（生产中应使用 Redis）
const _store = new Map(); // challenge_id → { answer, type, expires_at }

// ─────────────────────────────────────────────
// 题目生成器
// ─────────────────────────────────────────────

/**
 * 类型1：下一个素数
 */
function _makePrimeChallenge() {
  const n = _randomInt(50, 500);
  const answer = _nextPrime(n);
  return {
    question: `数学逻辑：当前数为 ${n}，请给出下一个素数（质数）是多少？`,
    answer: String(answer),
    hint_type: '纯数字',
  };
}

/**
 * 类型2：语义理解 - 找出不同类的词
 */
function _makeSemanticChallenge() {
  const groups = [
    { words: ['苹果', '香蕉', '汽车', '葡萄'], odd: '汽车', reason: '非水果' },
    { words: ['Python', 'Java', 'C++', '咖啡'], odd: '咖啡', reason: '非编程语言' },
    { words: ['氢', '氦', '氮', '铁'], odd: '铁', reason: '非气态元素' },
    { words: ['加法', '乘法', '减法', '地球'], odd: '地球', reason: '非运算' },
    { words: ['红色', '蓝色', '绿色', '正方形'], odd: '正方形', reason: '非颜色' },
    { words: ['比特币', '以太坊', '狗狗币', '黄金'], odd: '黄金', reason: '非加密货币' },
    { words: ['猫', '狗', '鱼', '玫瑰'], odd: '玫瑰', reason: '非动物' },
  ];
  const g = groups[_randomInt(0, groups.length - 1)];
  const shuffled = [...g.words].sort(() => Math.random() - 0.5);
  return {
    question: `语义理解：以下哪个词与其他三个不属于同一类别？\n选项：${shuffled.join('、')}\n请直接回答该词。`,
    answer: g.odd,
    hint_type: '汉字词语',
    options: shuffled,
  };
}

/**
 * 类型3：数列模式识别
 */
function _makePatternChallenge() {
  const patterns = [
    // 等差数列
    () => {
      const start = _randomInt(1, 10);
      const diff = _randomInt(2, 8);
      const seq = Array.from({ length: 5 }, (_, i) => start + i * diff);
      return { seq, answer: seq[4], desc: '等差数列' };
    },
    // 等比数列
    () => {
      const start = _randomInt(1, 5);
      const ratio = _randomInt(2, 3);
      const seq = Array.from({ length: 5 }, (_, i) => start * Math.pow(ratio, i));
      return { seq, answer: seq[4], desc: '等比数列' };
    },
    // 平方数列
    () => {
      const offset = _randomInt(1, 5);
      const seq = Array.from({ length: 5 }, (_, i) => Math.pow(i + offset, 2));
      return { seq, answer: seq[4], desc: '平方数列' };
    },
    // 斐波那契变体
    () => {
      const a = _randomInt(1, 5), b = _randomInt(1, 5);
      const seq = [a, b];
      for (let i = 2; i < 5; i++) seq.push(seq[i - 1] + seq[i - 2]);
      return { seq, answer: seq[4], desc: '类斐波那契' };
    },
  ];

  const gen = patterns[_randomInt(0, patterns.length - 1)];
  const { seq, answer } = gen();
  const visible = seq.slice(0, 4);

  return {
    question: `模式识别：补全数列的下一项。\n数列：${visible.join(', ')}, ?\n请直接回答数字。`,
    answer: String(answer),
    hint_type: '数字',
  };
}

// ─────────────────────────────────────────────
// 公共 API
// ─────────────────────────────────────────────

/**
 * 生成验证挑战
 * @param {number} [ttlMs=5000] - 有效期（毫秒），默认 5 秒（给 LLM 推理留余地）
 * @returns {{ challenge_id: string, question: string, type: string, expires_at: string }}
 */
function generateChallenge(ttlMs = 5000) {
  const typeRoll = _randomInt(1, 3);
  let challengeData;
  let type;

  switch (typeRoll) {
    case 1:
      challengeData = _makePrimeChallenge();
      type = 'math_prime';
      break;
    case 2:
      challengeData = _makeSemanticChallenge();
      type = 'semantic_odd_one_out';
      break;
    case 3:
    default:
      challengeData = _makePatternChallenge();
      type = 'pattern_sequence';
      break;
  }

  const challenge_id = crypto.randomUUID();
  const expires_at = new Date(Date.now() + ttlMs).toISOString();

  // 持久化（5 秒后自动 GC）
  _store.set(challenge_id, {
    answer: challengeData.answer.trim().toLowerCase(),
    type,
    expires_at,
    hint_type: challengeData.hint_type,
    options: challengeData.options || null,
  });
  setTimeout(() => _store.delete(challenge_id), ttlMs + 1000);

  return {
    challenge_id,
    question: challengeData.question,
    type,
    hint_type: challengeData.hint_type,
    options: challengeData.options || undefined,
    expires_at,
  };
}

/**
 * 验证答案
 * @param {string} challenge_id
 * @param {string|number} answer
 * @returns {{ valid: boolean, token: string|null, reason?: string }}
 */
function verifyAnswer(challenge_id, answer) {
  const record = _store.get(challenge_id);

  if (!record) {
    return { valid: false, token: null, reason: 'challenge_not_found_or_expired' };
  }

  if (new Date() > new Date(record.expires_at)) {
    _store.delete(challenge_id);
    return { valid: false, token: null, reason: 'challenge_expired' };
  }

  const normalized = String(answer).trim().toLowerCase();
  const correct = record.answer;

  if (normalized !== correct) {
    return { valid: false, token: null, reason: 'wrong_answer' };
  }

  // 验证通过 → 签发 token（生产中用 JWT）
  _store.delete(challenge_id);
  const token = _issueToken(challenge_id, record.type);

  return { valid: true, token, reason: 'ok' };
}

/**
 * AI 专用：自动解题（SDK 内置，让 Agent 能自助通关）
 * 生产环境中此函数应在 Agent 侧，而不是服务端
 * @param {{ challenge_id, question, type, options, hint_type }} challenge
 * @returns {string} 答案字符串
 */
function solveChallenge(challenge) {
  const { type, question, options } = challenge;

  if (type === 'math_prime') {
    // 从问题里提取当前数
    const match = question.match(/当前数为\s*(\d+)/);
    if (match) return String(_nextPrime(parseInt(match[1])));
  }

  if (type === 'semantic_odd_one_out' && options) {
    // 简单启发式：返回第一个看起来不同类的词
    // 真实场景由 LLM 推断，这里用硬编码关键字检测做 demo
    const nonChinese = options.find((w) => /[a-zA-Z]/.test(w));
    if (nonChinese) return nonChinese;
    // 否则返回最后一个（往往是"异类"）
    return options[options.length - 1];
  }

  if (type === 'pattern_sequence') {
    const nums = [...question.matchAll(/-?\d+/g)].map((m) => parseInt(m[0]));
    if (nums.length >= 4) {
      // 尝试等差（二阶差分也为常数 → 平方数列等）
      const diffs = nums.slice(1).map((v, i) => v - nums[i]);
      if (diffs.every((d) => d === diffs[0])) return String(nums[nums.length - 1] + diffs[0]);
      // 尝试二阶差分（平方数列）
      const diffs2 = diffs.slice(1).map((v, i) => v - diffs[i]);
      if (diffs2.every((d) => d === diffs2[0])) {
        const nextDiff = diffs[diffs.length - 1] + diffs2[0];
        return String(nums[nums.length - 1] + nextDiff);
      }
      // 尝试等比
      const ratios = nums.slice(1).map((v, i) => v / nums[i]);
      if (ratios.every((r) => Math.abs(r - ratios[0]) < 0.01))
        return String(Math.round(nums[nums.length - 1] * ratios[0]));
      // 尝试斐波那契
      const last = nums.length - 1;
      return String(nums[last] + nums[last - 1]);
    }
  }

  return '';
}

// ─────────────────────────────────────────────
// 内部工具函数
// ─────────────────────────────────────────────

function _isPrime(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

function _nextPrime(n) {
  let candidate = n + 1;
  while (!_isPrime(candidate)) candidate++;
  return candidate;
}

function _randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function _issueToken(challengeId, type) {
  const payload = `${challengeId}:${type}:${Date.now()}`;
  const sig = crypto.createHash('sha256').update(payload + '_pixelwar_secret').digest('hex').slice(0, 16);
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

module.exports = { generateChallenge, verifyAnswer, solveChallenge };
