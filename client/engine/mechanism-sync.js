// Синхронизация механизмов (ворота, лестница) с сервером. Сервер присылает цель и «возраст» перехода, клиент доигрывает
// анимацию с нужного места: новый игрок и переподключившийся видят то же положение, что и остальные.
// Объекты регистрируются по id (ворота чанка создаются при загрузке и исчезают при выгрузке), а последнее известное
// состояние хранится и после выгрузки — при следующей загрузке чанка ворота сразу встают как надо.

/**
 * @param {{on(type: string, handler: Function): () => void, net: {send(msg: object): boolean, status?: string}}} deps.api
 * @param {() => number} [deps.now] миллисекунды
 */
export function createMechanismSync({ api, now = () => performance.now() }) {
  /** @type {Map<string, {active: boolean, ageMs: number, at: number}>} */
  const known = new Map();
  /** @type {Map<string, (state: {active: boolean, ageMs: number}) => void>} */
  const bound = new Map();

  const remember = ({ id, active, ageMs, progress }) => {
    known.set(id, { active, ageMs, progress, at: now() });
    apply(id);
  };
  function apply(id) {
    const s = known.get(id);
    bound.get(id)?.({ active: s.active, ageMs: s.ageMs + (now() - s.at), progress: s.progress, elapsedMs: now() - s.at });
  }

  const offs = [
    api.on('mech_snapshot', ({ list }) => { for (const row of list) remember(row); }),
    api.on('mech_state', (row) => remember(row)),
  ];

  return {
    /** Привязывает объект к id; сразу применяет известное состояние. Возвращает отписку. */
    register(id, applyState) {
      bound.set(id, applyState);
      if (known.has(id)) apply(id);
      return () => { if (bound.get(id) === applyState) bound.delete(id); };
    },
    /** Подключает список механизмов {id, object, kind}: новые регистрируются, пропавшие (чанк выгружен) снимаются. */
    reconcile(list) {
      const live = new Set(list.map((m) => m.id));
      for (const [id, fn] of [...bound]) if (!live.has(id) && fn.owned) bound.delete(id);
      for (const m of list) {
        if (bound.has(m.id) && bound.get(m.id).object === m.object) continue;
        const fn = (state) => (m.kind === 'ladder' ? m.object.applyRemote({ deployed: state.active, ageMs: state.ageMs, progress: state.progress, elapsedMs: state.elapsedMs }) : m.object.applyRemote({ open: state.active, ageMs: state.ageMs, progress: state.progress, elapsedMs: state.elapsedMs }));
        fn.owned = true;
        fn.object = m.object;
        bound.set(m.id, fn);
        if (known.has(m.id)) apply(m.id);
      }
    },
    /** Просит сервер выставить состояние. Без соединения механизм переключается локально (автономный предпросмотр). */
    request(id, active, fallback = null) {
      const open = api.net.status === undefined || api.net.status === 'open';
      if (open && api.net.send({ t: 'mech_set', id, active })) return true;
      fallback?.(active);
      return false;
    },
    known: (id) => known.get(id) ?? null,
    dispose() {
      for (const off of offs) off();
      bound.clear();
      known.clear();
    },
  };
}
