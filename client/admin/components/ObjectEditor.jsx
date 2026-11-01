// Панель выбранного объекта: позиция, поворот (в градусах), масштаб, параметры; применить / удалить.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { mapUi, removeObject, saveObject, setPreview, refreshWorld, select } from '../world-ui.js';
import { worldStore } from '../state.js';
import { useStore } from '../lib/store.js';
import { degToRad, radToDeg, fmtNum, isNum } from '../lib/format.js';
import { clampObjectScale, objectChanged, snap } from '../lib/world.js';
import { Button, ConfirmButton, Field, Icon, Notice, Pill } from './ui.jsx';
import { ParamFields } from './ParamFields.jsx';

const toForm = (o) => ({ x: o.x, z: o.z, deg: radToDeg(o.ry), scale: o.scale, params: { ...o.params } });
const fromForm = (f, base) => ({ ...base, x: snap(Number(f.x)), z: snap(Number(f.z)), ry: Math.round(degToRad(f.deg) * 1e4) / 1e4, scale: Number(f.scale), params: f.params });

function CheckLine({ check }) {
  if (!check) return <p class="meta" aria-live="polite">&nbsp;</p>;
  if (check.status === 'checking') return <p class="meta" aria-live="polite">Проверяем размещение…</p>;
  if (check.status === 'ok') return <p class="meta check--ok" aria-live="polite">Размещение допустимо</p>;
  if (check.status === 'bad') return <p class="meta check--bad" aria-live="polite">Нельзя: {check.message}</p>;
  return <p class="meta" aria-live="polite">{check.message}</p>;
}

export function ObjectEditor({ object }) {
  const typeDef = useStore(worldStore, (s) => s.typeById.get(object.type));
  const check = useStore(mapUi, (s) => s.check);
  const busy = useStore(mapUi, (s) => s.busy);
  const message = useStore(mapUi, (s) => s.message);
  const [form, setForm] = useState(() => toForm(object));
  // base — объект, из которого заполнена форма: правки считаются относительно него, а не текущего состояния сервера
  const [base, setBase] = useState(object);
  const [stale, setStale] = useState(false);

  const draftObj = useMemo(() => fromForm(form, base), [form, base]);
  const dirty = useMemo(() => objectChanged(draftObj, base) || !Number.isFinite(draftObj.x) || !Number.isFinite(draftObj.z), [draftObj, base]);

  // Объект изменён на сервере: без правок (или если правки уже совпадают с ним) обновляем форму, иначе предупреждаем.
  useEffect(() => {
    if (object === base) return;
    if (!dirty || !objectChanged(draftObj, object)) {
      setBase(object);
      setForm(toForm(object));
      setStale(false);
    } else if (object.rev !== base.rev) setStale(true);
  }, [object]);

  // Предпросмотр на карте и проверка размещения по правкам формы.
  useEffect(() => {
    if (!dirty) {
      setPreview(null);
      return;
    }
    if (![draftObj.x, draftObj.z, draftObj.scale, draftObj.ry].every(isNum)) return;
    setPreview({ id: object.id, x: draftObj.x, z: draftObj.z, ry: draftObj.ry, scale: draftObj.scale });
  }, [draftObj, dirty, object.id]);
  useEffect(() => () => setPreview(null), []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const [lo, hi] = typeDef?.scale ?? [0.5, 2];
  const conflict = message?.conflict === object.id || message?.conflict === true;
  const label = typeDef?.label ?? object.type;

  const apply = async () => {
    const next = { ...draftObj, scale: clampObjectScale(typeDef, draftObj.scale) };
    const saved = await saveObject(object.id, next, base.rev);
    if (saved) {
      setBase(saved);
      setForm(toForm(saved));
      setStale(false);
    }
  };
  const reload = async () => {
    await refreshWorld();
    const cur = worldStore.get().world.objects.get(object.id);
    if (cur) {
      setBase(cur);
      setForm(toForm(cur));
      setStale(false);
    }
  };

  return (
    <section class="card editor" aria-label="Выбранный объект">
      <div class="editor__head">
        <h3 class="card__title">{label}</h3>
        <button type="button" class="btn btn--ghost btn--small" onClick={() => select(null)} aria-label="Снять выделение"><Icon name="x" size={14} /></button>
      </div>
      <p class="meta editor__id">{object.id} · версия {object.rev}</p>

      {stale ? <Notice tone="warn" action={<Button small onClick={reload}>Обновить</Button>}>Объект изменён на сервере, пока вы редактировали. Сохранение вашей версии будет отклонено.</Notice> : null}

      <div class="editor__grid">
        <Field id="obj-x" label="x, м (восток)">
          <input id="obj-x" class="input input--num" type="number" step="0.1" value={form.x} onInput={(e) => set({ x: e.currentTarget.value })} />
        </Field>
        <Field id="obj-z" label="z, м (юг)">
          <input id="obj-z" class="input input--num" type="number" step="0.1" value={form.z} onInput={(e) => set({ z: e.currentTarget.value })} />
        </Field>
      </div>
      <Field id="obj-ry" label="Поворот, °">
        <div class="number-row">
          <input id="obj-ry" class="input input--num" type="number" step="1" min="0" max="359" value={form.deg} onInput={(e) => set({ deg: Number(e.currentTarget.value) })} />
          <input type="range" min="0" max="359" step="1" value={Math.round(form.deg) % 360} aria-label="Поворот: ползунок" onInput={(e) => set({ deg: Number(e.currentTarget.value) })} />
        </div>
      </Field>
      <Field id="obj-scale" label="Масштаб" help={`Допустимо от ${fmtNum(lo, 1)} до ${fmtNum(hi, 1)}`}>
        <div class="number-row">
          <input id="obj-scale" class="input input--num" type="number" step="0.05" min={lo} max={hi} value={form.scale} onInput={(e) => set({ scale: e.currentTarget.value })} />
          <input type="range" min={lo} max={hi} step="0.05" value={form.scale} aria-label="Масштаб: ползунок" onInput={(e) => set({ scale: Number(e.currentTarget.value) })} />
        </div>
      </Field>
      <ParamFields typeDef={typeDef} params={form.params} idPrefix="obj-param" onChange={(params) => set({ params })} />

      <CheckLine check={dirty ? check : null} />
      <Notice tone={message?.tone ?? 'info'} action={conflict ? <Button small onClick={reload}>Обновить</Button> : null}>{message?.text}</Notice>

      <div class="editor__actions">
        <Button variant="primary" icon="check" busy={busy} disabled={!dirty || check?.status === 'bad'} onClick={apply}>Применить</Button>
        <Button disabled={!dirty} onClick={() => { setBase(object); setForm(toForm(object)); setStale(false); }}>Сбросить</Button>
        <ConfirmButton label="Удалить" question="Удалить объект?" confirmLabel="Да, удалить" busy={busy} onConfirm={() => removeObject(object.id, object.rev)} />
      </div>
      {dirty ? <Pill tone="warn">Есть несохранённые правки</Pill> : null}
    </section>
  );
}
