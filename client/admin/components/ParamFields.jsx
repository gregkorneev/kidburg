// Поля параметров объекта по описанию типа: enum -> select, int -> число и ползунок, text -> строка с лимитом.

import { Field } from './ui.jsx';

export function ParamFields({ typeDef, params, onChange, idPrefix, disabled }) {
  const list = typeDef?.params ?? [];
  if (!list.length) return <p class="meta">У этого типа нет дополнительных параметров.</p>;
  const set = (key, value) => onChange({ ...params, [key]: value });
  return (
    <>
      {list.map((p) => {
        const id = `${idPrefix}-${p.key}`;
        const value = params[p.key] ?? p.default;
        if (p.kind === 'enum') {
          return (
            <Field key={p.key} id={id} label={p.label ?? p.key}>
              <select id={id} class="select" value={value} disabled={disabled} onChange={(e) => set(p.key, e.currentTarget.value)}>
                {p.values.map((v) => <option key={v} value={v}>{p.labels?.[v] ?? v}</option>)}
              </select>
            </Field>
          );
        }
        if (p.kind === 'int') {
          return (
            <Field key={p.key} id={id} label={p.label ?? p.key} help={`Целое от ${p.min} до ${p.max}`}>
              <div class="number-row">
                <input id={id} class="input input--num" type="number" min={p.min} max={p.max} step="1" value={value} disabled={disabled}
                  onInput={(e) => { const n = Math.round(Number(e.currentTarget.value)); if (Number.isFinite(n)) set(p.key, Math.min(p.max, Math.max(p.min, n))); }} />
                <input type="range" min={p.min} max={p.max} step="1" value={value} disabled={disabled} aria-label={`${p.label ?? p.key}: ползунок`} onInput={(e) => set(p.key, Number(e.currentTarget.value))} />
              </div>
            </Field>
          );
        }
        return (
          <Field key={p.key} id={id} label={p.label ?? p.key} counter={`${String(value).length} / ${p.max}`}>
            <input id={id} class="input" type="text" maxLength={p.max} value={value} disabled={disabled} onInput={(e) => set(p.key, e.currentTarget.value)} />
          </Field>
        );
      })}
    </>
  );
}
