export interface FloatingRect { x: number; y: number; width: number; height: number }

export function constrainFloatingRect(rect: FloatingRect, viewportWidth: number, viewportHeight: number): FloatingRect {
  const maxWidth = Math.max(1, viewportWidth - 24);
  const maxHeight = Math.max(1, viewportHeight - 24);
  const width = Math.min(maxWidth, Math.max(Math.min(640, maxWidth), Number.isFinite(rect.width) ? rect.width : 960));
  const height = Math.min(maxHeight, Math.max(Math.min(320, maxHeight), Number.isFinite(rect.height) ? rect.height : 640));
  const x = Math.min(Math.max(12, viewportWidth - width - 12), Math.max(12, Number.isFinite(rect.x) ? rect.x : 12));
  const y = Math.min(Math.max(12, viewportHeight - height - 12), Math.max(12, Number.isFinite(rect.y) ? rect.y : 12));
  return { x, y, width, height };
}

export function defaultFloatingRect(width: number, height: number): FloatingRect {
  return constrainFloatingRect({ x: width - 1104, y: height - 764, width: 1080, height: 740 }, width, height);
}
