import { useEffect, useRef, useCallback } from 'react';
import type { PixelMap, SelectedPixel } from '../types';

interface PixelCanvasProps {
  pixelMap: PixelMap;
  onPixelSelect: (pixel: SelectedPixel | null) => void;
}

const GRID_SIZE = 1000;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function hexToRgb(color: string): string {
  return color || '#1a1a2e';
}

export function PixelCanvas({ pixelMap, onPixelSelect }: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pixelMapRef = useRef<PixelMap>({});
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const rafRef = useRef<number | null>(null);

  // Draw everything onto Canvas 2D
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y, scale } = viewRef.current;
    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Canvas area background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(x, y, GRID_SIZE * scale, GRID_SIZE * scale);

    // Pixels
    const map = pixelMapRef.current;
    for (const key in map) {
      const px = map[key];
      ctx.fillStyle = hexToRgb(px.color);
      ctx.fillRect(
        x + px.x * scale,
        y + px.y * scale,
        Math.max(1, scale),
        Math.max(1, scale)
      );
    }

    // Grid lines (only when zoomed in enough)
    if (scale >= 8) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      const startX = Math.max(0, Math.floor(-x / scale));
      const endX = Math.min(GRID_SIZE, Math.ceil((w - x) / scale));
      const startY = Math.max(0, Math.floor(-y / scale));
      const endY = Math.min(GRID_SIZE, Math.ceil((h - y) / scale));

      for (let i = startX; i <= endX; i++) {
        ctx.moveTo(x + i * scale, y + startY * scale);
        ctx.lineTo(x + i * scale, y + endY * scale);
      }
      for (let j = startY; j <= endY; j++) {
        ctx.moveTo(x + startX * scale, y + j * scale);
        ctx.lineTo(x + endX * scale, y + j * scale);
      }
      ctx.stroke();
    }

    // Border around canvas
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, GRID_SIZE * scale, GRID_SIZE * scale);
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Setup canvas and events
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      // Init view: fit grid in center
      const s = Math.min(canvas.width, canvas.height) / GRID_SIZE;
      viewRef.current = {
        scale: s,
        x: (canvas.width - GRID_SIZE * s) / 2,
        y: (canvas.height - GRID_SIZE * s) / 2,
      };
      scheduleDraw();
    };

    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Wheel zoom
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const v = viewRef.current;
      const newScale = clamp(v.scale * factor, 0.1, 100);

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const worldX = (mx - v.x) / v.scale;
      const worldY = (my - v.y) / v.scale;

      viewRef.current = {
        scale: newScale,
        x: mx - worldX * newScale,
        y: my - worldY * newScale,
      };
      scheduleDraw();
    };

    // Pan
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
      viewRef.current.x += dx;
      viewRef.current.y += dy;
      lastPos.current = { x: e.clientX, y: e.clientY };
      scheduleDraw();
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const wasDragging = hasMoved.current;
      isDragging.current = false;
      canvas.style.cursor = 'crosshair';

      if (!wasDragging) {
        const rect = canvas.getBoundingClientRect();
        const v = viewRef.current;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const px = Math.floor((mx - v.x) / v.scale);
        const py = Math.floor((my - v.y) / v.scale);

        if (px >= 0 && px < GRID_SIZE && py >= 0 && py < GRID_SIZE) {
          const key = `${px},${py}`;
          const found = pixelMapRef.current[key];
          if (found) {
            onPixelSelect(found);
          } else {
            onPixelSelect({ x: px, y: py, color: '#1a1a2e', price: 0, owner: '(unclaimed)', updatedAt: 0, isEmpty: true });
          }
        } else {
          onPixelSelect(null);
        }
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.style.cursor = 'crosshair';

    return () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scheduleDraw, onPixelSelect]);

  // Redraw when pixelMap changes
  useEffect(() => {
    pixelMapRef.current = pixelMap;
    scheduleDraw();
  }, [pixelMap, scheduleDraw]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#0a0a0a' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
