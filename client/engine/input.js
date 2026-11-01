// Ввод: WASD, Shift, мышь с pointer lock, клавиши E и Enter.
// Пока интерфейс просит освободить мышь (uiOpen), управление отключено.

const MOVE_KEYS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
};
const DOUBLE_TAP_MS = 350;

const isTyping = (target) => !!target?.closest?.('input, textarea, select, [contenteditable="true"]');

/**
 * @param {object} deps
 * @param {HTMLElement} deps.target элемент, на который ставится pointer lock (canvas)
 * @param {Document} deps.document
 * @param {Window} deps.window
 * @param {() => void} deps.onInteract нажата E
 * @param {() => void} deps.onChat нажата Enter
 */
export function createInput({ target, document, window, onInteract, onChat }) {
  const pressed = new Set();
  let locked = false;
  let uiOpen = false;
  let lookX = 0;
  let lookY = 0;
  let lastWDownAt = null;
  let doubleTapRun = false;

  const requestLock = () => {
    if (uiOpen || locked) return;
    // Chrome возвращает промис и может отклонить его (нет жеста пользователя); это не ошибка.
    Promise.resolve(target.requestPointerLock?.()).catch(() => {});
  };

  const onKeyDown = (e) => {
    if (isTyping(e.target) || uiOpen) return;
    const action = MOVE_KEYS[e.code];
    if (action) {
      if (e.code === 'KeyW' && !e.repeat) {
        const now = performance.now();
        if (lastWDownAt !== null && now - lastWDownAt <= DOUBLE_TAP_MS) doubleTapRun = true;
        lastWDownAt = now;
      }
      pressed.add(action);
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyE') onInteract();
    else if (e.code === 'Enter') onChat();
  };
  const onKeyUp = (e) => {
    const action = MOVE_KEYS[e.code];
    if (action) pressed.delete(action);
    if (e.code === 'KeyW') doubleTapRun = false;
  };
  const onBlur = () => {
    pressed.clear();
    lastWDownAt = null;
    doubleTapRun = false;
  };
  const onMouseMove = (e) => {
    if (!locked || uiOpen) return;
    lookX += e.movementX || 0;
    lookY += e.movementY || 0;
  };
  const onLockChange = () => {
    locked = document.pointerLockElement === target;
    if (!locked) onBlur();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChange);
  target.addEventListener('click', requestLock);

  return {
    get locked() {
      return locked;
    },
    /** Нажатые клавиши движения; при открытом UI всё сброшено. */
    keys: () => ({
      forward: pressed.has('forward'),
      back: pressed.has('back'),
      left: pressed.has('left'),
      right: pressed.has('right'),
      run: pressed.has('run') || doubleTapRun,
    }),
    /** Накопленный поворот мыши в пикселях с прошлого вызова. */
    consumeLook() {
      const look = { dx: lookX, dy: lookY };
      lookX = lookY = 0;
      return look;
    },
    /** UI закончил: снова разрешаем управление и пробуем вернуть захват мыши. */
    lockPointer() {
      uiOpen = false;
      requestLock();
    },
    /** UI открыл панель: останавливаем игрока и освобождаем мышь. */
    unlockPointer() {
      uiOpen = true;
      onBlur();
      lookX = lookY = 0;
      if (document.pointerLockElement) document.exitPointerLock();
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      target.removeEventListener('click', requestLock);
      if (document.pointerLockElement === target) document.exitPointerLock();
    },
  };
}
