# PixelWar 支付合约设计文档

## 1. 为什么不需要复杂合约

### 核心原则：最小化链上逻辑

PixelWar 的支付层遵循"链上只做不可篡改的事"原则：

| 功能 | 实现方式 | 理由 |
|------|---------|------|
| 收款 | 直接 USDC transfer 到钱包 | ERC-20 原生支持，无需合约包装 |
| 验证支付 | 后端调用 Base RPC 查 tx | 链上数据永久可查，无法伪造 |
| 像素所有权 | 后端数据库 + 合约可选存储 | 前者成本为零，后者可升级性差 |
| 收益分配 | PixelWarTreasury 合约 | 需要链上可信执行 |

**USDC transfer + 后端验签** 已经满足 95% 的需求。合约只处理一件事：收益分配（rebate + treasury + loot + dev），这是必须链上执行才有公信力的逻辑。

---

## 2. x402 on Base 完整流程

```
┌─────────────────────────────────────────────────────────────────┐
│                      x402 Payment Flow                          │
└─────────────────────────────────────────────────────────────────┘

 AI Agent                    PixelWar Server              Base Chain
    │                              │                           │
    │  POST /pixel/42/88           │                           │
    │─────────────────────────────>│                           │
    │                              │                           │
    │  402 Payment Required        │                           │
    │  {                           │                           │
    │    amount: "1000",           │                           │
    │    token: "USDC",            │                           │
    │    network: "base-sepolia",  │                           │
    │    payTo: "0xTreasury...",   │                           │
    │    pixelId: "42,88",         │                           │
    │    nonce: "uuid-xxx"         │                           │
    │  }                           │                           │
    │<─────────────────────────────│                           │
    │                              │                           │
    │  USDC.transfer(              │                           │
    │    payTo, 1000               │                           │
    │  )                           │                           │
    │────────────────────────────────────────────────────────>│
    │                              │                           │
    │  txHash: 0xabc...            │                           │
    │<────────────────────────────────────────────────────────│
    │                              │                           │
    │  POST /pixel/42/88           │                           │
    │  X-PAYMENT: {                │                           │
    │    txHash: "0xabc...",       │                           │
    │    from: "0xAgent...",       │                           │
    │    amount: "1000",           │                           │
    │    token: "USDC",            │                           │
    │    nonce: "uuid-xxx"         │                           │
    │  }                           │                           │
    │─────────────────────────────>│                           │
    │                              │  eth_getTransactionReceipt│
    │                              │────────────────────────>│
    │                              │  { status: 1, logs: [...]}│
    │                              │<────────────────────────│
    │                              │                           │
    │                              │  验证：                    │
    │                              │  ✓ tx 成功                 │
    │                              │  ✓ to == USDC 合约         │
    │                              │  ✓ Transfer(from, payTo,  │
    │                              │             1000)          │
    │                              │  ✓ nonce 未使用过           │
    │                              │  ✓ block 已确认(≥1)        │
    │                              │                           │
    │  200 OK { pixel: captured }  │                           │
    │<─────────────────────────────│                           │
    │                              │                           │
    │                              │  Treasury.distribute(     │
    │                              │    pixel, from, 1000      │
    │                              │  )  [异步，批量]            │
    │                              │────────────────────────>│
```

### 服务端验签关键检查项

```javascript
// 验证 USDC Transfer 事件
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const log = receipt.logs.find(l =>
  l.address.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
  l.topics[0] === TRANSFER_TOPIC &&
  l.topics[2].includes(PAY_TO.slice(2).toLowerCase())
);
// 解析 amount
const amount = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], log.data)[0];
```

---

## 3. 地址说明

### USDC 合约地址

| 网络 | USDC 地址 | 说明 |
|------|----------|------|
| Base Sepolia (测试网) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Circle 官方测试 USDC |
| Base Mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 官方 USDC |

### 收款钱包

- **Treasury 合约**：部署后的 `PixelWarTreasury` 合约地址（接收 USDC 并分配）
- **Dev 钱包**：部署时指定的 `devWallet` 地址（接收 10% dev fee）

> ⚠️ **强烈建议**：Treasury 合约地址作为 `payTo`，而非 EOA 钱包。这样分配逻辑在链上透明可查。

### RPC 端点

| 网络 | RPC |
|------|-----|
| Base Sepolia | `https://sepolia.base.org` |
| Base Mainnet | `https://mainnet.base.org` |
| Base Mainnet (Alchemy) | `https://base-mainnet.g.alchemy.com/v2/{KEY}` |

---

## 4. 价格体系

### USDC 6 位小数换算

USDC 使用 6 位小数（不同于 ETH 的 18 位）：

```
1 USDC = 1_000_000 (1e6)
0.1 USDC = 100_000
0.01 USDC = 10_000
0.001 USDC = 1_000
```

### PixelWar 价格层级

| 像素类型 | 价格 (USDC) | 链上值 (raw) | 说明 |
|---------|------------|------------|------|
| 基础像素 | 0.001 USDC | 1,000 | 初始上架价 |
| 已占领像素 | 前价 × 1.5 | (prev × 3) / 2 | 每次溢价 50% |
| 热门像素 | 动态定价 | 后端计算 | 后端返回实时价格 |

### 分配比例

```
每次像素支付（amount P）：
├── 40% → 前任 owner rebate（激励持有）
├── 40% → Treasury（游戏基金）
├── 10% → Loot pool（随机奖励池）
└── 10% → Dev wallet（开发维护）

首次购买（无前 owner）：
├── 40% → 直接进 Treasury（原 rebate 份额）
├── 40% → Treasury
├── 10% → Loot pool
└── 10% → Dev wallet
即：80% Treasury, 10% Loot, 10% Dev
```

### 价格计算示例

```
初始像素价格: 0.001 USDC (1000 raw)
第1次被抢: 0.001 × 1.5 = 0.0015 USDC (1500 raw)
第2次被抢: 0.0015 × 1.5 = 0.00225 USDC (2250 raw)
第3次被抢: 0.00225 × 1.5 = 0.003375 USDC (3375 raw)

第1次抢购分配 (1500 raw):
├── 前owner rebate: 600 raw (0.0006 USDC)
├── Treasury: 600 raw
├── Loot: 150 raw
└── Dev: 150 raw
```

---

## 5. 安全考量

### 防重放攻击
- 每个 402 响应包含唯一 `nonce`（UUID）
- 后端用 Redis/DB 记录已使用的 `(txHash, nonce)` 对
- txHash 全局唯一，防止同一笔 tx 被重复使用

### 防超时攻击
- tx 必须在发出 402 后 5 分钟内到达
- 过期 nonce 自动失效

### 金额验证
- 后端严格验证 `amount >= requiredAmount`
- 不接受低于要价的支付

### 合约安全
- `PixelWarTreasury` 使用 OpenZeppelin `ReentrancyGuard`
- USDC 转账用 `SafeERC20`
- 只有 `owner` 可以提取 treasury 余额
- 使用 `nonReentrant` 修饰符防止重入
