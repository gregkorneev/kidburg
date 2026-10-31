function isTyping(target) {
  const tag = target?.tagName?.toLowerCase();
  return ['input', 'textarea', 'select'].includes(tag) || target?.isContentEditable === true;
}

/** Подключает возврат из отдельной локации в центральный город по клавише L. */
export function bindCityExit({ window = globalThis.window, onExit, isBlocked = () => false }) {
  const onKeyDown = (event) => {
    if (event.code !== 'KeyL' || event.repeat || event.defaultPrevented || isTyping(event.target) || isBlocked()) return;
    event.preventDefault();
    onExit();
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
