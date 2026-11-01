export function createStudioCanvas(width, height) {
  if (globalThis.document?.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  const context = new Proxy({}, {
    get(target, property) {
      if (property === 'measureText') return () => ({ width: 0 });
      if (!(property in target)) target[property] = () => {};
      return target[property];
    },
    set(target, property, value) { target[property] = value; return true; },
  });
  return { width, height, getContext: () => context };
}
