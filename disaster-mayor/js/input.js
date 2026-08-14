// Pointer input on the city canvas: drag to pan, wheel/pinch to zoom,
// tap to inspect incidents or buildings.

export function setupInput(canvas, renderer, handlers) {
  const pointers = new Map();
  let panning = false;
  let moved = 0;
  let pinchDist = 0;
  let downAt = 0;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      panning = true;
      moved = 0;
      downAt = performance.now();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        const rect = canvas.getBoundingClientRect();
        const cx = (a.x + b.x) / 2 - rect.left;
        const cy = (a.y + b.y) / 2 - rect.top;
        renderer.zoom(d / pinchDist, cx, cy);
      }
      pinchDist = d;
      moved += 10;
    } else if (panning) {
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) renderer.pan(dx, dy);
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) {
      const wasTap = moved <= 8 && performance.now() - downAt < 400;
      panning = false;
      if (wasTap) {
        const rect = canvas.getBoundingClientRect();
        handlers.onTap(e.clientX - rect.left, e.clientY - rect.top);
      }
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    renderer.zoom(factor, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
}

export function setupKeyboard(handlers) {
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        handlers.onPauseToggle();
        break;
      case 'Escape':
        handlers.onEscape();
        break;
      case '1': handlers.onSpeed(1); break;
      case '2': handlers.onSpeed(2); break;
      case '+': case '=': handlers.onZoom(1.15); break;
      case '-': case '_': handlers.onZoom(0.87); break;
      case 'ArrowUp': handlers.onPan(0, 60); break;
      case 'ArrowDown': handlers.onPan(0, -60); break;
      case 'ArrowLeft': handlers.onPan(60, 0); break;
      case 'ArrowRight': handlers.onPan(-60, 0); break;
    }
  });
}
