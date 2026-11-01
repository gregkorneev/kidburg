// Клиенты игры: таблица с сортировкой, фильтрами и раскрываемой строкой (графики и render-статистика).

import { memo } from 'preact/compat';
import { useMemo, useState } from 'preact/hooks';
import { live, prefs, setPref } from '../state.js';
import { useNow, useStore } from '../lib/store.js';
import { LOC_LABELS, STATUS_LABELS, fmtInt, fmtMs, fmtNum, formatDateTime, isNum, locLabel, plural, qualityLabel, relativeTime } from '../lib/format.js';
import { chunksText, filterClients, metricHealth, sortClients, tabSuffixes } from '../lib/clients.js';
import { LineChart } from './Chart.jsx';
import { EmptyState, Icon, Pill, Spinner } from './ui.jsx';

const COLUMNS = [
  { key: 'name', label: 'Игрок', sortable: true },
  { key: 'status', label: 'Статус', sortable: true },
  { key: 'fps', label: 'FPS', sortable: true },
  { key: 'ping', label: 'Ping', sortable: true },
  { key: 'loc', label: 'Локация', sortable: true },
  { key: 'quality', label: 'Графика' },
  { key: 'chunks', label: 'Чанки' },
  { key: 'lastSeen', label: 'Активность', sortable: true },
];

const STATUS_TONE = { online: 'ok', inactive: 'warn', offline: 'muted' };
const STATUS_TEXT = { online: 'Онлайн', inactive: 'Неактивна', offline: 'Отключён' };
const STATUS_HINT = { inactive: 'Вкладка скрыта или приостановлена', offline: 'Данные не приходят: вкладка закрыта или нет связи' };

function RelTime({ ts }) {
  const now = useNow();
  return <span class="num" title={formatDateTime(ts)}>{relativeTime(ts, now)}</span>;
}

/** Ячейка метрики: текущее значение, среднее, цвет по порогу; пояснение, если данных нет. */
function Metric({ kind, value, avg, thresholds, unit, na, tip }) {
  const health = metricHealth(kind, value, thresholds);
  if (!isNum(value)) {
    return <span class="metric metric--na" title={tip}>—<small>{na}</small></span>;
  }
  return (
    <span class={`metric ${health === 'bad' ? 'metric--bad' : ''}`} title={tip}>
      <b class="num">{fmtNum(value, kind === 'fps' ? 0 : 0)} {unit}</b>
      <small>{isNum(avg) ? `в среднем ${fmtNum(avg, 1)}` : 'среднее: нет данных'}</small>
    </span>
  );
}

function naText(client) {
  if (client.status === 'offline') return 'клиент отключён';
  if (client.status === 'inactive') return 'вкладка скрыта';
  return 'нет данных';
}

function DetailCharts({ sid, thresholds }) {
  const points = useStore(live, (s) => s.histories[sid]) ?? [];
  const fpsLines = useMemo(() => [{ key: 'fps', color: '#2d705a', label: 'FPS', unit: 'к/с', digits: 1 }], []);
  const pingLines = useMemo(() => [{ key: 'ping', color: '#c0762d', label: 'Ping', unit: 'мс', digits: 1 }], []);
  const fpsTh = useMemo(() => [{ value: thresholds.lowFps, color: '#b7791f', label: `порог ${thresholds.lowFps}` }], [thresholds.lowFps]);
  const pingTh = useMemo(() => [{ value: thresholds.highPingMs, color: '#b7791f', label: `порог ${thresholds.highPingMs} мс` }], [thresholds.highPingMs]);
  return (
    <div class="detail-grid">
      <div>
        <h4 class="field__label">FPS ({points.length} {plural(points.length, ['точка', 'точки', 'точек'])})</h4>
        <LineChart points={points} lines={fpsLines} thresholds={fpsTh} height={140} empty="Нет данных FPS" />
      </div>
      <div>
        <h4 class="field__label">Ping (HTTP /health)</h4>
        <LineChart points={points} lines={pingLines} thresholds={pingTh} height={140} empty="Нет данных ping" />
      </div>
    </div>
  );
}

function Detail({ client, thresholds }) {
  const r = client.render;
  return (
    <div class="detail">
      <DetailCharts sid={client.sid} thresholds={thresholds} />
      <dl class="kv">
        <div><dt>Время кадра</dt><dd>{isNum(client.frameMs) ? fmtMs(client.frameMs, 1) : 'нет данных'}</dd></div>
        <div><dt>Draw calls</dt><dd>{r ? fmtInt(r.calls) : 'нет данных'}</dd></div>
        <div><dt>Треугольники</dt><dd>{r ? fmtInt(r.triangles) : 'нет данных'}</dd></div>
        <div><dt>Геометрии</dt><dd>{r ? fmtInt(r.geometries) : 'нет данных'}</dd></div>
        <div><dt>Текстуры</dt><dd>{r ? fmtInt(r.textures) : 'нет данных'}</dd></div>
        <div><dt>WebSocket</dt><dd>{client.wsConnected ? (isNum(client.wsRttMs) ? `подключён, RTT ${fmtMs(client.wsRttMs)}` : 'подключён') : 'не подключён'}</dd></div>
        <div><dt>Источник чанков</dt><dd>{client.chunksSource === 'server' ? 'сервер' : client.chunksSource === 'client' ? 'клиент' : 'измерение недоступно'}</dd></div>
        <div><dt>Первый отчёт</dt><dd>{formatDateTime(client.firstSeen)}</dd></div>
        <div><dt>Отчётов</dt><dd>{fmtInt(client.reports)}</dd></div>
        <div><dt>Вкладка</dt><dd class="sid">{client.sid}</dd></div>
      </dl>
    </div>
  );
}

const ClientRow = memo(
  function ClientRow({ client, suffix, thresholds, open, onToggle }) {
    const na = naText(client);
    const chunks = chunksText(client);
    const quality = qualityLabel(client.quality);
    const ws = isNum(client.wsRttMs) ? `, WS RTT ${fmtMs(client.wsRttMs)}` : '';
    const detailId = `client-detail-${client.sid}`;
    return (
      <>
        <tr class={`row-main ${open ? 'is-open' : ''} ${client.status === 'offline' ? 'is-gone' : ''}`} onClick={() => onToggle(client.sid)}>
          <td>
            <span class="cell-name">
              <button type="button" class="row-toggle" aria-expanded={open} aria-controls={open ? detailId : undefined} aria-label={`${open ? 'Свернуть' : 'Развернуть'} подробности: ${client.name}`} onClick={(e) => { e.stopPropagation(); onToggle(client.sid); }}>
                <Icon name="chevron" size={16} class="chev" />
              </button>
              <span>{client.name}</span>
              {suffix ? <span class="sid" title={`Вкладка ${client.sid}`}>#{suffix}</span> : null}
            </span>
          </td>
          <td><Pill tone={STATUS_TONE[client.status] ?? 'muted'} dot title={STATUS_HINT[client.status]}>{STATUS_TEXT[client.status] ?? client.status}</Pill></td>
          <td><Metric kind="fps" value={client.fps} avg={client.fpsAvg} thresholds={thresholds} unit="к/с" na={na} tip={`Кадров в секунду${client.state === 'hidden' ? ' (вкладка скрыта)' : ''}`} /></td>
          <td><Metric kind="ping" value={client.ping} avg={client.pingAvg} thresholds={thresholds} unit="мс" na={na} tip={`Метод: HTTP /health (как в HUD игры)${ws}`} /></td>
          <td>{locLabel(client.loc)}</td>
          <td>{quality ?? <span class="metric--na">нет данных</span>}</td>
          <td class="num">
            {chunks ? (
              <span class="metric" title={client.chunksSource === 'server' ? 'Источник: сервер' : 'Источник: клиент'}>
                <b>{chunks}</b>
                <small>{client.chunksSource === 'server' ? 'по данным сервера' : 'по данным клиента'}</small>
              </span>
            ) : (
              <span class="metric metric--na">—<small>измерение недоступно</small></span>
            )}
          </td>
          <td><RelTime ts={client.lastSeen} /></td>
        </tr>
        {open ? (
          <tr class="row-detail" id={detailId}>
            <td colSpan={COLUMNS.length}><Detail client={client} thresholds={thresholds} /></td>
          </tr>
        ) : null}
      </>
    );
  },
);

function SortHeader({ col, sort, onSort }) {
  if (!col.sortable) return <th scope="col">{col.label}</th>;
  const active = sort.key === col.key;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" class="th-sort" aria-pressed={active} onClick={() => onSort(col.key)}>
        {col.label}
        {active ? <Icon name={sort.dir === 'asc' ? 'sortUp' : 'sortDown'} size={14} /> : null}
      </button>
    </th>
  );
}

export function Clients() {
  const clients = useStore(live, (s) => s.clients);
  const overview = useStore(live, (s) => s.overview);
  const conn = useStore(live, (s) => s.conn);
  const filters = useStore(prefs, (p) => p.clientFilters) ?? { loc: 'all', status: 'all' };
  const sort = useStore(prefs, (p) => p.clientSort) ?? { key: 'name', dir: 'asc' };
  const [openSid, setOpenSid] = useState(null);

  const thresholds = useStore(live, (s) => s.thresholds);
  const suffixes = useMemo(() => tabSuffixes(clients), [clients]);
  const rows = useMemo(() => sortClients(filterClients(clients, filters), sort), [clients, filters, sort]);

  if (!overview) return <div class="page-loading"><Spinner label="Получаем список клиентов…" /></div>;

  const onSort = (key) => setPref({ clientSort: { key, dir: sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc' } });
  const toggle = (sid) => setOpenSid((cur) => (cur === sid ? null : sid));
  const setFilter = (patch) => setPref({ clientFilters: { ...filters, ...patch } });
  const open = openSid !== null && !clients.some((c) => c.sid === openSid) ? null : openSid;

  return (
    <div class="clients">
      <div class="toolbar">
        <div class="field">
          <label for="f-loc">Локация</label>
          <select id="f-loc" class="select" value={filters.loc} onChange={(e) => setFilter({ loc: e.currentTarget.value })}>
            <option value="all">Все</option>
            {Object.entries(LOC_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <div class="field">
          <label for="f-status">Состояние</label>
          <select id="f-status" class="select" value={filters.status} onChange={(e) => setFilter({ status: e.currentTarget.value })}>
            <option value="all">Все</option>
            {Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <span class="toolbar__spacer toolbar__count" role="status" aria-live="polite">
          {rows.length === clients.length ? `Вкладок: ${clients.length}` : `Показано ${rows.length} из ${clients.length}`}
          {conn !== 'online' ? ' · данные могут быть устаревшими' : ''}
        </span>
      </div>

      {clients.length === 0 ? (
        <div class="card"><EmptyState icon="clients" title="Нет данных: клиентов нет">Список заполняется, когда игроки открывают игру и она присылает телеметрию (раз в {fmtNum(overview.telemetry.intervalMs / 1000, 0)} с). Отключённые вкладки пропадают через 2 минуты.</EmptyState></div>
      ) : rows.length === 0 ? (
        <div class="card"><EmptyState icon="clients" title="Нет клиентов по выбранным фильтрам">Измените или сбросьте фильтры.</EmptyState></div>
      ) : (
        <div class="table-wrap">
          <table class="table">
            <caption class="sr-only">Клиенты игры</caption>
            <thead>
              <tr>{COLUMNS.map((c) => <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />)}</tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <ClientRow key={c.sid} client={c} suffix={suffixes.get(c.sid)} thresholds={thresholds} open={open === c.sid} onToggle={toggle} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="meta" style="margin-top:10px">Ping измеряется как время ответа HTTP /health (как в HUD игры). FPS скрытых вкладок не измеряется. Графики копят точки из телеметрии.</p>
    </div>
  );
}
