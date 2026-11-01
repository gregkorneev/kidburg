// Обзор: карточки состояния сервера и мини-графики за последние минуты.

import { useMemo } from 'preact/hooks';
import { live } from '../state.js';
import { useNow, useStore } from '../lib/store.js';
import { fmtInt, fmtNum, formatUptime, plural, isNum } from '../lib/format.js';
import { metricHealth } from '../lib/clients.js';
import { LineChart } from './Chart.jsx';
import { Pill, Spinner, Icon } from './ui.jsx';

const OLLAMA = {
  ready: { tone: 'ok', text: 'Готова к работе' },
  unavailable: { tone: 'bad', text: 'Недоступна' },
  model_missing: { tone: 'warn', text: 'Модель не загружена' },
  not_configured: { tone: 'muted', text: 'Не настроена' },
};

function Card({ title, icon, tone, children, wide }) {
  return (
    <section class={`card stat ${tone ? `stat--${tone}` : ''} ${wide ? 'stat--wide' : ''}`}>
      <h3 class="stat__title"><Icon name={icon} size={16} />{title}</h3>
      {children}
    </section>
  );
}

const Big = ({ value, unit, empty = 'Нет данных' }) => (
  <p class={`stat__value ${value === null ? 'stat__value--empty' : ''}`}>
    {value === null ? empty : <>{value}{unit ? <small>{unit}</small> : null}</>}
  </p>
);

function Uptime() {
  const overview = useStore(live, (s) => s.overview);
  const receivedAt = useStore(live, (s) => s.receivedAt);
  const now = useNow();
  if (!overview) return null;
  return <Big value={formatUptime(overview.uptimeSec + Math.max(0, (now - receivedAt) / 1000))} />;
}

export function Overview() {
  const overview = useStore(live, (s) => s.overview);
  const series = useStore(live, (s) => s.series);
  const conn = useStore(live, (s) => s.conn);
  const fpsLines = useMemo(() => [{ key: 'fps', color: '#2d705a', label: 'Средний FPS', unit: 'к/с', digits: 1 }], []);
  const pingLines = useMemo(() => [{ key: 'ping', color: '#c0762d', label: 'Средний ping', unit: 'мс', digits: 1 }], []);

  const lowFps = overview?.summary.thresholds.lowFps;
  const highPingMs = overview?.summary.thresholds.highPingMs;
  const fpsThresholds = useMemo(() => [{ value: lowFps, color: '#b7791f', label: `порог ${lowFps}` }], [lowFps]);
  const pingThresholds = useMemo(() => [{ value: highPingMs, color: '#b7791f', label: `порог ${highPingMs} мс` }], [highPingMs]);

  if (!overview) {
    return <div class="page-loading">{conn === 'reconnecting' ? 'Нет связи с сервером. Переподключение…' : <Spinner label="Получаем данные сервера…" />}</div>;
  }
  const s = overview.summary;
  const th = s.thresholds;
  const fpsHealth = metricHealth('fps', s.fpsMin, th) === 'bad' || metricHealth('fps', s.fpsAvg, th) === 'bad';
  const pingHealth = metricHealth('ping', s.pingMax, th) === 'bad';
  const ollama = overview.ollama ? OLLAMA[overview.ollama.state] ?? { tone: 'muted', text: overview.ollama.state } : null;
  const a = overview.agents;
  const w = overview.world;
  const reporting = s.chunksReporting;
  const worldShare = w.limit ? Math.min(100, (w.count / w.limit) * 100) : 0;

  return (
    <div class="overview">
      <div class="stat-grid">
        <Card title="Игроки в сети" icon="clients">
          <Big value={fmtInt(overview.playersWs)} />
          <p class="stat__sub">
            Вкладок: {s.sessionsOnline} активных
            {s.sessionsInactive ? `, ${s.sessionsInactive} ${plural(s.sessionsInactive, ['неактивна', 'неактивны', 'неактивны'])}` : ''}
            {s.sessionsOffline ? `, ${s.sessionsOffline} отключено` : ''}
          </p>
          <p class="stat__hint">Подключений WebSocket: {overview.playersWs}</p>
        </Card>

        <Card title="FPS клиентов" icon="overview" tone={fpsHealth ? 'warn' : null}>
          <Big value={isNum(s.fpsAvg) ? fmtNum(s.fpsAvg, 1) : null} unit=" в среднем" empty="Нет данных" />
          <p class="stat__sub">Минимум: {isNum(s.fpsMin) ? <b class={metricHealth('fps', s.fpsMin, th) === 'bad' ? 'is-bad' : ''}>{fmtNum(s.fpsMin, 1)}</b> : 'нет данных'}</p>
          <p class="stat__hint">{isNum(s.fpsAvg) ? `Порог: ниже ${th.lowFps}` : 'Нет активных клиентов с телеметрией'}</p>
        </Card>

        <Card title="Ping (HTTP /health)" icon="send" tone={pingHealth ? 'warn' : null}>
          <Big value={isNum(s.pingAvg) ? fmtNum(s.pingAvg, 1) : null} unit=" мс в среднем" />
          <p class="stat__sub">Максимум: {isNum(s.pingMax) ? <b class={pingHealth ? 'is-bad' : ''}>{fmtNum(s.pingMax, 0)} мс</b> : 'нет данных'}</p>
          <p class="stat__hint">{isNum(s.pingAvg) ? `Порог: выше ${th.highPingMs} мс` : 'Измерение недоступно: нет клиентов'}</p>
        </Card>

        <Card title="Загружено чанков" icon="world">
          <Big value={reporting > 0 ? fmtInt(s.chunksLoaded) : null} empty="Измерение недоступно" />
          <p class="stat__sub">{reporting > 0 ? `Суммарно по ${reporting} ${plural(reporting, ['клиенту', 'клиентам', 'клиентам'])}` : 'Клиенты не присылают данные о чанках'}</p>
        </Card>

        <Card title="ИИ-агенты" icon="agents">
          <Big value={`${a.active} из ${a.configured}`} unit=" активны" />
          <p class="stat__sub">Размещены в мире: {a.placed}</p>
          <p class="stat__hint">Отвечают сейчас: {a.generating}, в очереди: {a.queued}</p>
        </Card>

        <Card title="Динамические объекты" icon="world">
          <Big value={`${w.count} из ${w.limit}`} />
          <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax={w.limit} aria-valuenow={w.count} aria-label="Заполнение лимита объектов"><i style={{ width: `${worldShare}%` }} /></div>
          <p class="stat__hint">Ревизия мира: {w.revision}</p>
        </Card>

        <Card title="Ollama" icon="agents" tone={ollama && ollama.tone !== 'ok' && ollama.tone !== 'muted' ? ollama.tone : null}>
          {ollama ? (
            <>
              <p class="stat__value stat__value--small"><Pill tone={ollama.tone} dot>{ollama.text}</Pill></p>
              <p class="stat__sub">{overview.ollama.model ? `Модель: ${overview.ollama.model}` : 'Модель не указана'}</p>
              {overview.ollama.message ? <p class="stat__hint">{overview.ollama.message}</p> : null}
            </>
          ) : (
            <Big value={null} empty="Состояние пока неизвестно" />
          )}
        </Card>

        <Card title="Сервер работает" icon="refresh">
          <Uptime />
          <p class="stat__hint">Телеметрия: каждые {fmtNum(overview.telemetry.intervalMs / 1000, 0)} с, сессий в памяти: {overview.telemetry.sessions}</p>
        </Card>
      </div>

      <div class="chart-grid">
        <section class="card">
          <h3 class="card__title">Средний FPS</h3>
          <p class="card__sub">По активным клиентам, последние минуты (копится в этой вкладке)</p>
          <LineChart points={series} lines={fpsLines} thresholds={fpsThresholds} axis="age" empty="Нет данных: клиенты не присылают FPS" />
        </section>
        <section class="card">
          <h3 class="card__title">Средний ping</h3>
          <p class="card__sub">Время ответа HTTP /health, последние минуты</p>
          <LineChart points={series} lines={pingLines} thresholds={pingThresholds} axis="age" empty="Нет данных: клиенты не присылают ping" />
        </section>
      </div>
    </div>
  );
}
