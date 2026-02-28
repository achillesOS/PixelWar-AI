import { useEffect, useRef, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import type { PixelMap, SelectedPixel } from '../types';
import { colorToHex } from '../hooks/usePixelData';

interface PixelCanvasProps {
  pixelMap: PixelMap;
  onPixelSelect: (pixel: SelectedPixel | null) => void;
}

const GRID_SIZE = 1000;
const PIXEL_SIZE = 1; // 1 logical pixel per cell at scale=1

// Clamp helpers
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function PixelCanvas({ pixelMap, onPixelSelect }: PixelCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const stageContainerRef = useRef<PIXI.Container | null>(null);
  const pixelsGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const gridGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const bgGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const pixelMapRef = useRef<PixelMap>({});
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  // Draw all pixels onto the Graphics object
  const drawPixels = useCallback((g: PIXI.Graphics, map: PixelMap) => {
    g.clear();
    for (const key in map) {
      const px = map[key];
      g.beginFill(colorToHex(px.color), 1);
      g.drawRect(px.x * PIXEL_SIZE, px.y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      g.endFill();
    }
  }, []);

  // Draw subtle grid lines (only when scale is large enough)
  const drawGrid = useCallback((g: PIXI.Graphics, scale: number) => {
    g.clear();
    if (scale < 8) return; // don't draw grid when too zoomed out

    g.lineStyle(0.5 / scale, 0x333333, 0.5);
    for (let i = 0; i <= GRID_SIZE; i++) {
      g.moveTo(i * PIXEL_SIZE, 0);
      g.lineTo(i * PIXEL_SIZE, GRID_SIZE * PIXEL_SIZE);
      g.moveTo(0, i * PIXEL_SIZE);
      g.lineTo(GRID_SIZE * PIXEL_SIZE, i * PIXEL_SIZE);
    }
  }, []);

  // Initialize PIXI app
  useEffect(() => {
    const div = containerRef.current;
    if (!div) return;

    const w = div.clientWidth;
    const h = div.clientHeight;

    const app = new PIXI.Application({
      width: w,
      height: h,
      backgroundColor: 0x0a0a0a,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    div.appendChild(app.view as HTMLCanvasElement);
    appRef.current = app;

    // Stage container (for pan/zoom)
    const stage = new PIXI.Container();
    app.stage.addChild(stage);
    stageContainerRef.current = stage;

    // Initial scale/position: fit the 1000x1000 grid
    const initScale = Math.min(w, h) / GRID_SIZE;
    stage.scale.set(initScale);
    stage.position.set(
      (w - GRID_SIZE * initScale) / 2,
      (h - GRID_SIZE * initScale) / 2,
    );

    // Background layer
    const bg = new PIXI.Graphics();
    bg.beginFill(0x1a1a2e, 1);
    bg.drawRect(0, 0, GRID_SIZE, GRID_SIZE);
    bg.endFill();
    stage.addChild(bg);
    bgGraphicsRef.current = bg;

    // Pixel layer
    const pixelsG = new PIXI.Graphics();
    stage.addChild(pixelsG);
    pixelsGraphicsRef.current = pixelsG;

    // Grid layer
    const gridG = new PIXI.Graphics();
    stage.addChild(gridG);
    gridGraphicsRef.current = gridG;

    // ─── Mouse wheel zoom ──────────────────────────────────────────────────
    const canvas = app.view as HTMLCanvasElement;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = clamp(stage.scale.x * factor, 0.1, 100);

      // Zoom towards cursor position
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const worldX = (mouseX - stage.x) / stage.scale.x;
      const worldY = (mouseY - stage.y) / stage.scale.y;

      stage.scale.set(newScale);
      stage.x = mouseX - worldX * newScale;
      stage.y = mouseY - worldY * newScale;

      drawGrid(gridGraphicsRef.current!, newScale);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });

    // ─── Pan (drag) ────────────────────────────────────────────────────────
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDragging.current = true;
      hasMoved.current = false;
      lastPos.current = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved.current = true;
      stage.x += dx;
      stage.y += dy;
      lastPos.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const wasDragging = hasMoved.current;
      isDragging.current = false;
      canvas.style.cursor = 'crosshair';

      if (!wasDragging) {
        // It was a click — find which pixel
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldX = (mouseX - stage.x) / stage.scale.x;
        const worldY = (mouseY - stage.y) / stage.scale.y;

        const px = Math.floor(worldX / PIXEL_SIZE);
        const py = Math.floor(worldY / PIXEL_SIZE);

        if (px >= 0 && px < GRID_SIZE && py >= 0 && py < GRID_SIZE) {
          const key = `${px},${py}`;
          const found = pixelMapRef.current[key];
          if (found) {
            onPixelSelect(found);
          } else {
            onPixelSelect({
              x: px, y: py,
              color: '#1a1a2e',
              price: 0,
              owner: '(unclaimed)',
              updatedAt: 0,
              isEmpty: true,
            });
          }
        } else {
          onPixelSelect(null);
        }
      }
    };

    const onMouseLeave = () => {
      isDragging.current = false;
      canvas.style.cursor = 'crosshair';
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.style.cursor = 'crosshair';

    // ─── Resize observer ──────────────────────────────────────────────────
    const resizeObserver = new ResizeObserver(() => {
      const nw = div.clientWidth;
      const nh = div.clientHeight;
      app.renderer.resize(nw, nh);
    });
    resizeObserver.observe(div);

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      app.destroy(true, { children: true });
      appRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update pixel graphics when data changes
  useEffect(() => {
    pixelMapRef.current = pixelMap;
    const g = pixelsGraphicsRef.current;
    if (!g) return;
    drawPixels(g, pixelMap);
  }, [pixelMap, drawPixels]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
