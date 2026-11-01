// Журнал действий администратора: таблица, раскрытие записи (до/после), догрузка, отмена изменения мира.

import { memo } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { auditStore, loadAudit, loadMoreAudit } from '../state.js';
import { useStore } from '../lib/store.js';
import { actionLabel, canUndoWorld, diffStates, entityText, resultLabel, resultTone } from '../lib/audit.js';
import { formatDateTime, plural } from '../lib/format.js';
import { mapUi, undoLast } from '../world-ui.js';
import { Button, EmptyState, Icon, Notice, Pill, Spinner } from './ui.jsx';

function Diff({ entry }) {
  const d = diffStates(entry.before, entry.after);
  if (d.kind === 'none') return <p class="meta">Состояния до и после не записаны.</p>;
  if (d.kind === 'list') {
    return <p class="detail-text">Объектов до: <b>{d.before}</b>, после: <b>{d.after}</b>.</p>;
  }
  const onlyAfter = d.rows.every((r) => r.before === null);
  const onlyBefore = d.rows.every((r) => r.after === null);
  return (
    <table class="diff">
      <thead>
        <tr>
          <th scope="col">Поле</th>
          {!onlyAfter ? <th scope="col">До</th> : null}
          {!onlyBefore ? <th scope="col">После</th> : null}
        </tr>
      </thead>
      <tbody>
        {d.rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.label}</th>
            {!onlyAfter ? <td class="before">{r.before ?? <span class="none">—</span>}</td> : null}
            {!onlyBefore ? <td class="after">{r.after ?? <span class="none">—</span>}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Row = memo(function Row({ entry, open, onToggle }) {
  const hasState = entry.before != null || entry.after != null;
  const expandable = hasState || Boolean(entry.detail);
  const id = `audit-${entry.id}`;
  return (
    <>
      <tr class={`row-main ${open ? 'is-open' : ''}`} onClick={expandable ? () => onToggle(entry.id) : undefined} style={expandable ? '' : 'cursor:default'}>
        <td class="num" style="white-space:nowrap">{formatDateTime(entry.ts)}</td>
        <td>
          <span class="cell-name">
            {expandable ? (
              <button type="button" class="row-toggle" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`${open ? 'Свернуть' : 'Развернуть'} запись №${entry.id}`} onClick={(e) => { e.stopPropagation(); onToggle(entry.id); }}>
                <Icon name="chevron" size={16} class="chev" />
              </button>
            ) : <span style="width:16px" />}
            <span class={entry.undone ? 'undone' : ''}>{actionLabel(entry.action)}</span>
            {entry.undone ? <Pill tone="info">отменено</Pill> : null}
          </span>
        </td>
        <td class="detail-text">{entityText(entry)}</td>
        <td><Pill tone={resultTone(entry.result)} dot>{resultLabel(entry.result)}</Pill></td>
        <td class="detail-text">{entry.detail || <span class="meta">—</span>}</td>
      </tr>
      {open ? (
        <tr class="row-detail" id={id}>
          <td colSpan={5}>
            <div class="audit-detail">
              <p class="meta">Запись №{entry.id} · сессия {entry.sessionId ? String(entry.sessionId).slice(0, 8) : '—'}</p>
              {entry.detail ? <p class="detail-text">{entry.detail}</p> : null}
              {hasState ? <Diff entry={entry} /> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
});

export function Audit() {
  const { status, error, entries, nextBefore, loadingMore } = useStore(auditStore);
  const busy = useStore(mapUi, (s) => s.busy);
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    if (auditStore.get().status === 'idle') void loadAudit();
  }, []);

  const toggle = (id) => setOpenId((cur) => (cur === id ? null : id));
  const undo = async () => {
    setNote(null);
    await undoLast();
    const m = mapUi.get().message;
    setNote(m ? { tone: m.tone, text: m.text } : null);
  };

  if (status === 'idle' || (status === 'loading' && !entries.length)) return <div class="page-loading"><Spinner label="Загружаем журнал…" /></div>;
  if (status === 'error' && !entries.length) {
    return <div class="page-loading"><Notice tone="bad" action={<Button small icon="refresh" onClick={() => loadAudit()}>Повторить</Button>}>{error}</Notice></div>;
  }
  const canUndo = canUndoWorld(entries) || nextBefore !== null;

  return (
    <div class="audit">
      <div class="toolbar">
        <Button icon="undo" busy={busy} disabled={!canUndo} onClick={undo} title={canUndo ? '' : 'Нет изменений мира, которые можно отменить'}>Отменить последнее изменение мира</Button>
        <Button variant="ghost" icon="refresh" onClick={() => loadAudit({ silent: true })}>Обновить</Button>
        <span class="toolbar__spacer toolbar__count">Записей загружено: {entries.length}</span>
      </div>
      <div aria-live="polite">{note ? <div style="margin-bottom:10px"><Notice tone={note.tone}>{note.text}</Notice></div> : null}</div>
      {error ? <div style="margin-bottom:10px"><Notice tone="bad">{error}</Notice></div> : null}

      {entries.length === 0 ? (
        <div class="card"><EmptyState icon="audit" title="Журнал пока пуст">Действия администратора (вход, правки мира и агентов) появятся здесь.</EmptyState></div>
      ) : (
        <div class="table-wrap">
          <table class="table" style="min-width:760px">
            <caption class="sr-only">Журнал действий администратора</caption>
            <thead>
              <tr>
                <th scope="col">Время</th>
                <th scope="col">Действие</th>
                <th scope="col">Сущность</th>
                <th scope="col">Результат</th>
                <th scope="col">Подробности</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => <Row key={e.id} entry={e} open={openId === e.id} onToggle={toggle} />)}
            </tbody>
          </table>
        </div>
      )}
      {nextBefore !== null ? (
        <div style="margin-top:12px;text-align:center">
          <Button icon="chevron" busy={loadingMore} onClick={loadMoreAudit}>Показать ещё</Button>
        </div>
      ) : entries.length > 0 ? (
        <p class="meta" style="margin-top:12px;text-align:center">Это все записи ({entries.length} {plural(entries.length, ['запись', 'записи', 'записей'])}).</p>
      ) : null}
    </div>
  );
}
