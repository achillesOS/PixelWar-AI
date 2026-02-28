# PIXELWAR AI — Frontend Dashboard

> Phase 1 MVP · React + Vite + TypeScript + PixiJS

## Quick Start

```bash
cd /workspace/coder/pixelwar/frontend
npm install
npm run dev
```

Open: **http://localhost:5173**

---

## Architecture

```
src/
├── main.tsx              # React entry point
├── App.tsx               # Root layout (topbar + canvas + panel)
├── App.css               # Global dark theme styles
├── types.ts              # Shared TypeScript types
├── api.ts                # API fetch + mock data generator
├── hooks/
│   └── usePixelData.ts   # Data polling hook (2s interval)
└── components/
    ├── PixelCanvas.tsx   # PixiJS WebGL canvas (1000×1000 grid)
    ├── InfoPanel.tsx     # Right sidebar info/stats
    └── InfoPanel.css     # Sidebar styles
```

## Ports

| Service  | Port |
|----------|------|
| Frontend | 5173 |
| Backend  | 3001 |

## Features

### Canvas (PixiJS WebGL)
- Renders 1000×1000 pixel grid
- Dark background (`#1a1a2e`) for unclaimed pixels
- **Zoom**: mouse wheel (0.1× – 100×, zooms toward cursor)
- **Pan**: drag with left mouse button
- **Click**: selects pixel, shows info in sidebar
- Polls backend every **2 seconds** and re-renders changes

### Info Panel (right sidebar)
- **Selected pixel**: coordinates, color swatch, price, owner agent_id
- **Territory**: claimed count / 1,000,000 with progress bar
- **Top 5 Most Expensive**: ranked by price
- **Top 5 Agents**: ranked by pixel count with mini bar chart

### Mock Data
If `http://localhost:3001` is unreachable:
- Generates 500 random colored pixels across the grid
- Every 2 seconds, 10 random pixels are updated to simulate live activity
- Topbar shows **⚡ MOCK DATA** badge

## Backend API Contract

Expected endpoint: `GET http://localhost:3001/pixels`

Response shape:
```json
{
  "pixels": [
    {
      "x": 42,
      "y": 100,
      "color": "#ff4488",
      "price": 1500,
      "owner": "agent-alpha-7f2a",
      "updatedAt": 1709123456789
    }
  ],
  "stats": {
    "totalClaimed": 500,
    "totalPixels": 1000000,
    "topExpensive": [...],
    "topAgents": [
      { "agentId": "agent-alpha-7f2a", "pixelCount": 80, "totalValue": 120000 }
    ]
  }
}
```

## Build

```bash
npm run build
# output → dist/
```
