# PixelWar AI — Backend MVP (Phase 1)

> Node.js + Express REST API for the 1000×1000 pixel canvas game.

---

## 快速启动

### 前置要求
- Node.js ≥ 18

### 安装依赖

```bash
cd /workspace/coder/pixelwar/backend
npm install
```

### 启动服务

```bash
# 生产模式
npm start

# 开发模式（自动重载，Node 18+）
npm run dev
```

服务默认监听 **http://localhost:3001**

---

## API 文档

### `GET /health`
健康检查。

```json
{ "status": "ok", "store": "in-memory", "pixels": 42 }
```

---

### `GET /pixels?page=1&limit=100`
返回所有**已占领**像素（分页）。

| 参数 | 默认 | 说明 |
|------|------|------|
| `page` | 1 | 页码（1-based） |
| `limit` | 100 | 每页条数（最大 10000） |

**响应：**
```json
{
  "total": 3,
  "page": 1,
  "limit": 100,
  "pages": 1,
  "pixels": [
    { "x": 10, "y": 20, "owner": "agent-001", "color": "#FF5733", "price": 0.001, "timestamp": 1706000000000, "occupied": true }
  ]
}
```

---

### `GET /pixel/:x/:y`
获取单个像素。坐标范围 `0–999`。

**未占领时：**
```json
{ "x": 5, "y": 5, "owner": null, "color": null, "price": 0.001, "timestamp": null, "occupied": false }
```

**已占领时：**
```json
{ "x": 5, "y": 5, "owner": "agent-001", "color": "#00FF00", "price": 0.0013, "timestamp": 1706000000000, "occupied": true }
```

---

### `POST /pixel/:x/:y`
占领或覆盖一个像素。

**Request Body：**
```json
{
  "color": "#FF5733",
  "agent_id": "agent-001"
}
```

**响应（首次占领）：**
```json
{
  "success": true,
  "x": 10,
  "y": 20,
  "color": "#FF5733",
  "owner": "agent-001",
  "price_paid": 0.001,
  "rebate_to_previous_owner": 0,
  "treasury_cut": 0,
  "loot_cut": 0,
  "dev_cut": 0,
  "previous_owner": null
}
```

**响应（覆盖已占像素，旧价 = 0.001）：**
```json
{
  "success": true,
  "x": 10,
  "y": 20,
  "color": "#0000FF",
  "owner": "agent-002",
  "price_paid": 0.0013,
  "rebate_to_previous_owner": 0.0004,
  "treasury_cut": 0.0004,
  "loot_cut": 0.0001,
  "dev_cut": 0.0001,
  "previous_owner": "agent-001"
}
```

---

### `GET /stats`
全局统计。

```json
{
  "total_occupied": 3,
  "canvas_size": "1000x1000",
  "most_expensive": { "x": 5, "y": 10, "owner": "agent-002", "color": "#FF0000", "price": 0.00169, "timestamp": 1706000100000 },
  "most_active": { "agent_id": "agent-001", "tx_count": 5 }
}
```

---

## 经济模型

| 角色 | 比例 | 说明 |
|------|------|------|
| 新价格 | 旧价格 × 1.3 | 覆盖者支付 |
| rebate | 旧价格 × 0.4 | 返还前任 owner |
| treasury | 旧价格 × 0.4 | 项目金库 |
| loot | 旧价格 × 0.1 | 奖励池 |
| dev | 旧价格 × 0.1 | 开发者收入 |

初始价格（空像素）：**0.001 USDC**

---

## 存储说明

当前使用 **内存 Map** 模拟 Redis。

| 代码位置 | TODO 说明 |
|----------|-----------|
| `canvasStore` | 替换为 `ioredis` HSET/HGET on `pixel:{x}:{y}` |
| `txLedger` | 替换为 Redis List (LPUSH) 或 Stream (XADD) |
| `/stats` | 替换为 Redis Sorted Set 排行榜 |
| `/pixels` | 替换为 HSCAN 游标分页 |
| POST 写入 | 替换为原子 Lua 脚本保证一致性 |

> **重要**：内存存储在服务重启后数据丢失，生产环境必须接入 Redis。

---

## 目录结构

```
backend/
├── server.js      # 主入口（Express API + In-Memory Store）
├── package.json   # 依赖声明
└── README.md      # 本文档
```
