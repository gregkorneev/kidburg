// Редактор мира: библиотека типов, карта, панель выбранного объекта и список динамических объектов.

import { useEffect } from 'preact/hooks';
import { auditStore, live, loadWorld, prefs, setPref, worldStore } from '../state.js';
import { useStore } from '../lib/store.js';
import { canUndoWorld } from '../lib/audit.js';
import { listObjects, typeColor } from '../lib/world.js';
import { fmtNum } from '../lib/format.js';
import { clearWorldObjects, mapUi, select, startPlacing, stopPlacing, undoLast, updatePlacing, refreshWorld } from '../world-ui.js';
import { MapView } from './MapView.jsx';
import { ObjectEditor } from './ObjectEditor.jsx';
import { ParamFields } from './ParamFields.jsx';
import { Button, ConfirmButton, EmptyState, Field, Icon, Notice, Spinner } from './ui.jsx';
import { degToRad, radToDeg } from '../lib/format.js';

function Library() {
  const types = useStore(worldStore, (s) => s.types);
  const placing = useStore(mapUi, (s) => s.placing);
  const typeDef = placing ? types.find((t) => t.id === placing.type) : null;
  return (
    <section class="card lib" aria-label="Библиотека объектов">
      <h3 class="card__title">Библиотека объектов</h3>
      <p class="card__sub">Выберите тип, затем кликните по карте.</p>
      <ul class="lib__list">
        {types.map((t) => (
          <li key={t.id}>
            <button type="button" class={`lib__item ${placing?.type === t.id ? 'is-active' : ''}`} aria-pressed={placing?.type === t.id} onClick={() => (placing?.type === t.id ? stopPlacing() : startPlacing(t.id))}>
              <i style={{ background: typeColor(t.id) }} aria-hidden="true" />
              <span>{t.label}</span>
              <small>⌀ {fmtNum(t.radius * 2, 1)} м</small>
            </button>
          </li>
        ))}
      </ul>
      {placing && typeDef ? (
        <div class="lib__draft">
          <h4 class="field__label">Новый объект: {typeDef.label}</h4>
          <Field id="new-ry" label="Поворот, °">
            <div class="number-row">
              <input id="new-ry" class="input input--num" type="number" min="0" max="359" step="1" value={radToDeg(placing.ry)} onInput={(e) => updatePlacing({ ry: degToRad(e.currentTarget.value) })} />
              <input type="range" min="0" max="359" step="1" value={Math.round(radToDeg(placing.ry)) % 360} aria-label="Поворот: ползунок" onInput={(e) => updatePlacing({ ry: degToRad(e.currentTarget.value) })} />
            </div>
          </Field>
          <Field id="new-scale" label="Масштаб">
            <div class="number-row">
              <input id="new-scale" class="input input--num" type="number" step="0.05" min={typeDef.scale[0]} max={typeDef.scale[1]} value={placing.scale} onInput={(e) => updatePlacing({ scale: Number(e.currentTarget.value) })} />
              <input type="range" min={typeDef.scale[0]} max={typeDef.scale[1]} step="0.05" value={placing.scale} aria-label="Масштаб: ползунок" onInput={(e) => updatePlacing({ scale: Number(e.currentTarget.value) })} />
            </div>
          </Field>
          <ParamFields typeDef={typeDef} params={placing.params} idPrefix="new-param" onChange={(params) => updatePlacing({ params })} />
          <label class="check"><input type="checkbox" checked={placing.sticky} onChange={(e) => updatePlacing({ sticky: e.currentTarget.checked })} />Ставить несколько подряд</label>
          <Button small icon="x" onClick={stopPlacing}>Отменить размещение</Button>
        </div>
      ) : null}
    </section>
  );
}

function Layers() {
  const showForbidden = useStore(prefs, (p) => p.showForbidden !== false);
  const showChunks = useStore(prefs, (p) => p.showChunks !== false);
  const showLabels = useStore(prefs, (p) => p.showLabels !== false);
  return (
    <section class="card layers" aria-label="Слои карты">
      <h3 class="card__title">Слои карты</h3>
      <label class="check"><input type="checkbox" checked={showForbidden} onChange={(e) => setPref({ showForbidden: e.currentTarget.checked })} />Показать запретные зоны</label>
      <label class="check"><input type="checkbox" checked={showChunks} onChange={(e) => setPref({ showChunks: e.currentTarget.checked })} />Сетка чанков (64 м)</label>
      <label class="check"><input type="checkbox" checked={showLabels} onChange={(e) => setPref({ showLabels: e.currentTarget.checked })} />Подписи зданий</label>
    </section>
  );
}

function ObjectList({ onSelect }) {
  const world = useStore(worldStore, (s) => s.world);
  const typeById = useStore(worldStore, (s) => s.typeById);
  const types = useStore(worldStore, (s) => s.types);
  const filter = useStore(prefs, (p) => p.listFilter ?? 'all');
  const selectedId = useStore(mapUi, (s) => s.selectedId);
  const list = listObjects(world, filter);
  return (
    <section class="card objlist" aria-label="Список объектов">
      <div class="objlist__head">
        <h3 class="card__title">Объекты</h3>
        <select class="select" value={filter} aria-label="Фильтр по типу" onChange={(e) => setPref({ listFilter: e.currentTarget.value })}>
          <option value="all">Все типы</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      {list.length === 0 ? (
        <EmptyState title={world.objects.size === 0 ? 'Динамических объектов пока нет' : 'Нет объектов этого типа'}>{world.objects.size === 0 ? 'Выберите тип слева и кликните по карте.' : 'Смените фильтр.'}</EmptyState>
      ) : (
        <ul class="objlist__list">
          {list.map((o) => (
            <li key={o.id}>
              <button type="button" class={`objlist__item ${o.id === selectedId ? 'is-active' : ''}`} aria-pressed={o.id === selectedId} onClick={() => onSelect(o.id)}>
                <i style={{ background: typeColor(o.type) }} aria-hidden="true" />
                <span>{typeById.get(o.type)?.label ?? o.type}</span>
                <small>{fmtNum(o.x, 1)} · {fmtNum(o.z, 1)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Toolbar() {
  const world = useStore(worldStore, (s) => s.world);
  const limits = useStore(worldStore, (s) => s.limits);
  const entries = useStore(auditStore, (s) => s.entries);
  const auditReady = useStore(auditStore, (s) => s.status);
  const busy = useStore(mapUi, (s) => s.busy);
  const count = world.objects.size;
  const canUndo = auditReady !== 'ready' || canUndoWorld(entries);
  return (
    <div class="world-bar">
      <span class={`counter ${count >= limits.total ? 'counter--full' : ''}`} role="status" aria-live="polite">
        <strong>{count} из {limits.total}</strong> объектов
      </span>
      <span class="meta">ревизия {world.revision}</span>
      <span class="toolbar__spacer" />
      <Button icon="undo" busy={busy} disabled={!canUndo} onClick={undoLast} title={canUndo ? '' : 'Нет изменений мира, которые можно отменить'}>Отменить последнее изменение</Button>
      <ConfirmButton label="Удалить все динамические объекты" question={`Удалить все ${count}?`} confirmLabel="Да, удалить все" disabled={count === 0} busy={busy} onConfirm={clearWorldObjects} />
    </div>
  );
}

export function World() {
  const status = useStore(worldStore, (s) => s.status);
  const error = useStore(worldStore, (s) => s.error);
  const world = useStore(worldStore, (s) => s.world);
  const selectedId = useStore(mapUi, (s) => s.selectedId);
  const message = useStore(mapUi, (s) => s.message);
  const conn = useStore(live, (s) => s.conn);
  const selected = selectedId ? world.objects.get(selectedId) ?? null : null;

  useEffect(() => {
    if (worldStore.get().status === 'idle') void loadWorld();
  }, []);
  // выбранный объект исчез (удалён с другой вкладки / отменено): снимаем выделение
  useEffect(() => {
    if (selectedId && status === 'ready' && !world.objects.has(selectedId)) select(null);
  }, [selectedId, world, status]);

  if (status === 'idle' || (status === 'loading' && !worldStore.get().zones)) {
    return <div class="page-loading"><Spinner label="Загружаем карту мира…" /></div>;
  }
  if (status === 'error') {
    return (
      <div class="page-loading">
        <Notice tone="bad" action={<Button small icon="refresh" onClick={() => loadWorld()}>Повторить</Button>}>{error || 'Не удалось загрузить мир'}</Notice>
      </div>
    );
  }

  return (
    <div class="world">
      <Toolbar />
      {conn !== 'online' ? <Notice tone="warn">Нет связи с сервером: карта может быть устаревшей. После переподключения она обновится.</Notice> : null}
      {!selected && message ? <Notice tone={message.tone} action={message.conflict ? <Button small icon="refresh" onClick={refreshWorld}>Обновить</Button> : null}>{message.text}</Notice> : <div class="notice-slot" role="status" aria-live="polite" />}
      <div class="world__grid">
        <aside class="world__left"><Library /><Layers /></aside>
        <div class="world__map"><MapView /></div>
        <aside class="world__right">
          {selected ? <ObjectEditor key={selected.id} object={selected} /> : null}
          <ObjectList onSelect={select} />
        </aside>
      </div>
    </div>
  );
}
