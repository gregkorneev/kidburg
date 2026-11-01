const STATIONS = [
  { name: 'Пожарная часть', taskId: 'firefighter_station_v1' },
  { name: 'Пекарня' },
  { name: 'Цветочная лавка' },
  { name: 'Музыкальная школа' },
  { name: 'Радиостанция' },
];

export function createCityProgress(container, emitter) {
  const root = document.createElement('section');
  root.className = 'city-progress';
  root.hidden = true;
  const label = document.createElement('div');
  const bar = document.createElement('div');
  bar.className = 'city-progress-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Пройдено домиков');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(STATIONS.length));
  const segments = STATIONS.map(({ name }) => {
    const segment = document.createElement('span');
    segment.className = 'city-progress-segment';
    segment.title = name;
    bar.appendChild(segment);
    return segment;
  });
  root.appendChild(label);
  root.appendChild(bar);
  container.appendChild(root);

  let progress = {};
  function render() {
    let count = 0;
    STATIONS.forEach(({ taskId }, index) => {
      const done = Boolean(taskId && progress[taskId] === true);
      segments[index].classList.toggle('is-complete', done);
      if (done) count += 1;
    });
    label.textContent = `Пройдено домиков: ${count} из ${STATIONS.length}`;
    bar.setAttribute('aria-valuenow', String(count));
  }
  const offs = [
    emitter.on('welcome', ({ state }) => {
      progress = { ...state?.progress };
      root.hidden = false;
      render();
    }),
    emitter.on('task_state', ({ taskId, state }) => {
      if (!STATIONS.some((station) => station.taskId === taskId) || state?.error || typeof state?.done !== 'boolean') return;
      progress[taskId] = state.done;
      render();
    }),
    emitter.on('auth', (info) => {
      if (!info) {
        progress = {};
        root.hidden = true;
      }
    }),
  ];
  return () => {
    offs.forEach((off) => off());
    root.remove();
  };
}
