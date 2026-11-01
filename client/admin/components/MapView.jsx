// 2D-карта мира на SVG: сетка чанков, зоны, динамические объекты, «призрак» размещения, панорама и масштаб.

import { memo } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import { prefs, worldStore } from '../state.js';
import { useStore } from '../lib/store.js';
import {
  CHUNK_SIZE, DEFAULT_CENTER, SCALE_MAX, SCALE_MIN, WORLD_SIZE, createView, fitView, listObjects, objectRadius, panBy, screenToWorld, snap, typeColor, worldToScreen, zoomAt,
} from '../lib/world.js';
import { fmtNum, radToDeg } from '../lib/format.js';
import { cancelDrag, checkPlacement, dragTo, finishDrag, hoverLeave, mapUi, placeAt, select, stopPlacing } from '../world-ui.js';
import { Icon } from './ui.jsx';

const RECT_TYPES = new Set(['bench', 'crate', 'sign']);
const buildingName = (label) => label.replace(/^Здание:\s*/, '');
const CHECK_COLOR = { ok: '#2f9e63', bad: '#c0392b', checking: '#c98a1d', unknown: '#6b7f74' };

// ── Статический слой: меняется только при масштабе/переключателях ────────────────────────────

const WorldBase = memo(function WorldBase({ zones, scale, showForbidden, showChunks, showLabels }) {
  if (!zones) return null;
  const { buildings, circles, routes, paths, statics, margin } = zones;
  const W = WORLD_SIZE.x;
  const Z = WORLD_SIZE.z;
  const px = (n) => n / scale; // пиксели -> метры
  const hatch = showForbidden ? 'url(#forbidden-hatch)' : 'none';
  const chunkLines = [];
  for (let i = 0; i <= W / CHUNK_SIZE; i++) {
    chunkLines.push(<line key={`v${i}`} x1={i * CHUNK_SIZE} x2={i * CHUNK_SIZE} y1="0" y2={Z} />);
    chunkLines.push(<line key={`h${i}`} x1="0" x2={W} y1={i * CHUNK_SIZE} y2={i * CHUNK_SIZE} />);
  }
  const chunkLabels = [];
  if (showChunks && scale >= 1.6) {
    for (let cx = 0; cx < W / CHUNK_SIZE; cx++) for (let cz = 0; cz < Z / CHUNK_SIZE; cz++) {
      chunkLabels.push(<text key={`${cx}_${cz}`} x={cx * CHUNK_SIZE + px(4)} y={cz * CHUNK_SIZE + px(12)} font-size={px(10)} class="map-chunk-label">{cx},{cz}</text>);
    }
  }
  const staticsPath = statics.map((s) => `M${snap(s.x - s.r)} ${snap(s.z)}a${s.r} ${s.r} 0 1 0 ${s.r * 2} 0a${s.r} ${s.r} 0 1 0 ${-s.r * 2} 0`).join('');
  const forbidStroke = showForbidden ? { stroke: '#b5483f', 'stroke-width': 1, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' } : {};

  return (
    <g>
      <defs>
        <pattern id="forbidden-hatch" patternUnits="userSpaceOnUse" width={px(7)} height={px(7)} patternTransform="rotate(45)">
          <rect width={px(7)} height={px(7)} fill="#c0392b" fill-opacity="0.07" />
          <line x1="0" y1="0" x2="0" y2={px(7)} stroke="#c0392b" stroke-opacity="0.45" stroke-width={px(1.6)} />
        </pattern>
      </defs>
      <rect x="0" y="0" width={W} height={Z} class="map-ground" />
      {/* Подложка зон: дорожки, маршруты, здания */}
      {paths.map((p) => (
        <g key={p.id} transform={`translate(${p.x} ${p.z})`}>
          <rect x={-p.w / 2} y={-p.d / 2} width={p.w} height={p.d} class="map-path" />
          <title>{p.label}</title>
        </g>
      ))}
      {routes.map((r) => (
        <line key={r.id} x1={r.ax} y1={r.az} x2={r.bx} y2={r.bz} stroke-width={r.half * 2} stroke-linecap="round" class="map-route"><title>{r.label}</title></line>
      ))}
      {circles.map((c) => (
        <g key={c.id}>
          <circle cx={c.x} cy={c.z} r={c.r} class={`map-circle ${c.id === 'plaza' ? 'map-circle--plaza' : ''}`}><title>{c.label}</title></circle>
        </g>
      ))}
      {buildings.map((b) => (
        <g key={b.id} transform={`translate(${b.x} ${b.z}) rotate(${-radToDeg(b.ry)})`}>
          <rect x={-b.w / 2} y={-b.d / 2} width={b.w} height={b.d} class="map-building"><title>{b.label}</title></rect>
        </g>
      ))}
      {/* Запретные зоны (штриховка) */}
      {showForbidden ? (
        <g class="map-forbidden">
          {paths.map((p) => <rect key={p.id} x={p.x - p.w / 2} y={p.z - p.d / 2} width={p.w} height={p.d} fill={hatch} {...forbidStroke} />)}
          {routes.map((r) => <line key={r.id} x1={r.ax} y1={r.az} x2={r.bx} y2={r.bz} stroke="url(#forbidden-hatch)" stroke-width={r.half * 2} stroke-linecap="round" />)}
          {circles.map((c) => <circle key={c.id} cx={c.x} cy={c.z} r={c.r} fill={hatch} {...forbidStroke} />)}
          {buildings.map((b) => (
            <g key={b.id} transform={`translate(${b.x} ${b.z}) rotate(${-radToDeg(b.ry)})`}>
              <rect x={-b.w / 2} y={-b.d / 2} width={b.w} height={b.d} fill={hatch} {...forbidStroke} />
            </g>
          ))}
          <path d={`M0 0H${W}V${Z}H0ZM${margin} ${margin}V${Z - margin}H${W - margin}V${margin}Z`} fill-rule="evenodd" fill={hatch} />
        </g>
      ) : null}
      <path d={staticsPath} class="map-static"><title>Существующие объекты мира</title></path>
      {showChunks ? <g class="map-chunks" vector-effect="non-scaling-stroke">{chunkLines}</g> : null}
      {chunkLabels}
      <rect x="0" y="0" width={W} height={Z} class="map-border" />
      {showLabels ? (
        <g class="map-labels" font-size={px(11.5)}>
          {buildings.map((b) => <text key={b.id} x={b.x} y={b.z} text-anchor="middle" dominant-baseline="middle" class="map-label map-label--building">{buildingName(b.label)}</text>)}
          {scale >= 3.5 ? circles.filter((c) => c.id !== 'spawn' || scale >= 5).map((c) => <text key={c.id} x={c.x} y={c.z - c.r - px(3)} text-anchor="middle" font-size={px(10)} class="map-label">{c.label}</text>) : null}
        </g>
      ) : null}
    </g>
  );
});

// ── Объекты ──────────────────────────────────────────────────────────────────────────────────

function footprint(typeDef, scaleFactor, extra) {
  const collider = typeDef?.collider;
  if (typeDef && RECT_TYPES.has(typeDef.id) && collider) {
    const w = collider[0] * scaleFactor;
    const d = collider[2] * scaleFactor;
    return <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={Math.min(w, d) * 0.15} {...extra} />;
  }
  return <circle cx="0" cy="0" r={(typeDef?.radius ?? 1) * scaleFactor} {...extra} />;
}

const MapObject = memo(function MapObject({ obj, typeDef, view, selected, dragging }) {
  const r = objectRadius(typeDef, obj);
  const px = 1 / view;
  const hit = Math.max(r, 8 * px);
  const marker = Math.max(r, 7 * px);
  const color = typeColor(obj.type);
  return (
    <g transform={`translate(${obj.x} ${obj.z}) rotate(${-radToDeg(obj.ry)})`} data-oid={obj.id} class={`map-obj ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <circle r={hit} fill="transparent" data-oid={obj.id} />
      {footprint(typeDef, obj.scale, { fill: color, 'fill-opacity': 0.55, stroke: color, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'data-oid': obj.id })}
      <circle r={marker} fill={color} stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" data-oid={obj.id} />
      <line x1="0" y1="0" x2="0" y2={marker * 1.9} stroke="#fff" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke" data-oid={obj.id} />
      {selected ? <circle r={marker + 5 * px} fill="none" stroke="#20372e" stroke-width="2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" class="map-selected" /> : null}
      <title>{typeDef?.label ?? obj.type}</title>
    </g>
  );
});

function Ghost({ x, z, ry, scale, typeDef, status, view }) {
  const color = CHECK_COLOR[status] ?? CHECK_COLOR.unknown;
  const px = 1 / view;
  const marker = Math.max((typeDef?.radius ?? 1) * scale, 7 * px);
  return (
    <g transform={`translate(${x} ${z}) rotate(${-radToDeg(ry)})`} class="map-ghost" pointer-events="none">
      {footprint(typeDef, scale, { fill: color, 'fill-opacity': 0.35, stroke: color, 'stroke-width': 2, 'stroke-dasharray': '5 3', 'vector-effect': 'non-scaling-stroke' })}
      <circle r={marker} fill={color} fill-opacity="0.6" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      <line x1="0" y1="0" x2="0" y2={marker * 1.9} stroke="#fff" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </g>
  );
}

const ObjectsLayer = memo(function ObjectsLayer({ objects, typeById, view, selectedId, dragId }) {
  return (
    <g>
      {objects.map((o) => <MapObject key={o.id} obj={o} typeDef={typeById.get(o.type)} view={view} selected={o.id === selectedId} dragging={o.id === dragId} />)}
    </g>
  );
});

// ── Карта ────────────────────────────────────────────────────────────────────────────────────

function Coords() {
  const cursor = useStore(mapUi, (s) => s.cursor);
  return <span class="map-coords" aria-hidden="true">{cursor ? `x ${fmtNum(cursor.x, 1)} · z ${fmtNum(cursor.z, 1)}` : 'x — · z —'}</span>;
}

export function MapView() {
  const wrap = useRef(null);
  const svgRef = useRef(null);
  const gesture = useRef(null);
  const view = useStore(mapUi, (s) => s.view);
  const size = useStore(mapUi, (s) => s.size);
  const selectedId = useStore(mapUi, (s) => s.selectedId);
  const placing = useStore(mapUi, (s) => s.placing);
  const hover = useStore(mapUi, (s) => s.hover);
  const drag = useStore(mapUi, (s) => s.drag);
  const preview = useStore(mapUi, (s) => s.preview);
  const check = useStore(mapUi, (s) => s.check);
  const world = useStore(worldStore, (s) => s.world);
  const zones = useStore(worldStore, (s) => s.zones);
  const typeById = useStore(worldStore, (s) => s.typeById);
  const showForbidden = useStore(prefs, (p) => p.showForbidden !== false);
  const showChunks = useStore(prefs, (p) => p.showChunks !== false);
  const showLabels = useStore(prefs, (p) => p.showLabels !== false);
  const objects = listObjects(world);

  // Размер контейнера; первый замер выставляет вид «центр города».
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.max(200, Math.round(el.clientWidth));
      const h = Math.max(200, Math.round(el.clientHeight));
      const cur = mapUi.get();
      if (cur.size.w === w && cur.size.h === h && cur.viewReady) return;
      mapUi.set({ size: { w, h }, ...(cur.viewReady ? {} : { viewReady: true, view: createView(DEFAULT_CENTER, Math.max(SCALE_MIN, Math.min(w, h) / 200)) }) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Колесо мыши: масштаб вокруг курсора (слушатель не пассивный, чтобы остановить прокрутку страницы).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const s = mapUi.get();
      mapUi.set({ view: zoomAt(s.view, s.size, factor, e.clientX - rect.left, e.clientY - rect.top) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toWorld = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const s = mapUi.get();
    const p = screenToWorld(s.view, s.size, e.clientX - rect.left, e.clientY - rect.top);
    return { x: snap(p.x), z: snap(p.z) };
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const oid = e.target?.closest?.('[data-oid]')?.getAttribute('data-oid') ?? null;
    const s = mapUi.get();
    svgRef.current.setPointerCapture?.(e.pointerId);
    wrap.current?.focus({ preventScroll: true });
    const pt = toWorld(e);
    let kind = 'pan';
    let offset = null;
    if (oid && !s.placing && e.button === 0) {
      const obj = worldStore.get().world.objects.get(oid);
      if (oid === s.selectedId && obj) {
        kind = 'obj'; // перетаскивать можно только уже выбранный объект
        offset = { x: obj.x - pt.x, z: obj.z - pt.z };
      } else {
        kind = 'select';
        select(oid);
      }
    }
    gesture.current = { kind, oid, offset, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, button: e.button };
  };

  const onPointerMove = (e) => {
    const pt = toWorld(e);
    mapUi.set({ cursor: pt });
    const g = gesture.current;
    if (g) {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return;
      g.moved = true;
      if (g.kind === 'obj') dragTo(g.oid, pt.x + g.offset.x, pt.z + g.offset.z);
      else if (g.kind === 'pan' || g.kind === 'select') {
        const dx = e.clientX - g.lx;
        const dy = e.clientY - g.ly;
        mapUi.set({ view: panBy(mapUi.get().view, dx, dy) });
      }
      g.lx = e.clientX;
      g.ly = e.clientY;
      return;
    }
    if (mapUi.get().placing) checkPlacement(pt);
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    gesture.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    if (!g) return;
    if (g.kind === 'obj' && g.moved) void finishDrag(g.oid);
    else if (g.kind === 'pan' && !g.moved && g.button === 0) {
      if (mapUi.get().placing) void placeAt(toWorld(e));
      else select(null);
    }
  };

  const onPointerCancel = () => {
    if (gesture.current?.kind === 'obj') cancelDrag();
    gesture.current = null;
  };

  const zoomBy = (factor) => {
    const s = mapUi.get();
    mapUi.set({ view: zoomAt(s.view, s.size, factor, s.size.w / 2, s.size.h / 2) });
  };
  const goCenter = () => mapUi.set({ view: createView(DEFAULT_CENTER, Math.max(SCALE_MIN, Math.min(mapUi.get().size.w, mapUi.get().size.h) / 200)) });
  const fit = () => mapUi.set({ view: fitView(mapUi.get().size) });

  const onKeyDown = (e) => {
    const s = mapUi.get();
    const step = 60;
    const map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (map[e.key]) {
      e.preventDefault();
      mapUi.set({ view: panBy(s.view, ...map[e.key]) });
    } else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') zoomBy(0.8);
    else if (e.key === '0') goCenter();
    else if (e.key === 'Escape') {
      if (s.drag) cancelDrag();
      else if (s.placing) stopPlacing();
      else select(null);
    }
  };

  const placingType = placing ? typeById.get(placing.type) : null;
  const dragObj = drag ? world.objects.get(drag.id) : null;
  const shown = objects.map((o) => (drag && o.id === drag.id ? { ...o, x: drag.x, z: drag.z } : o));
  const previewObj = preview && !drag ? world.objects.get(preview.id) : null;
  const status = check?.status ?? 'checking';
  const tipSpot = drag ? { x: drag.x, z: drag.z } : placing && hover ? hover : previewObj ? { x: preview.x, z: preview.z } : null;
  const tipPos = tipSpot ? worldToScreen(view, size, tipSpot.x, tipSpot.z) : null;
  const tipText = check?.status === 'bad' ? check.message : check?.status === 'unknown' ? check.message : check?.status === 'ok' ? 'Можно поставить' : 'Проверяем…';
  const cursorClass = placing ? 'is-placing' : drag ? 'is-dragging' : '';

  return (
    <div class={`map ${cursorClass}`} ref={wrap} tabIndex={0} role="application" aria-label="Карта мира. Стрелки — сдвиг, плюс и минус — масштаб, ноль — к центру города, Escape — отмена." onKeyDown={onKeyDown}>
      <svg ref={svgRef} width={size.w} height={size.h} class="map__svg" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onPointerLeave={() => { mapUi.set({ cursor: null }); hoverLeave(); }}>
        <g transform={`translate(${size.w / 2} ${size.h / 2}) scale(${view.scale}) translate(${-view.cx} ${-view.cz})`}>
          <WorldBase zones={zones} scale={Math.round(view.scale * 20) / 20} showForbidden={showForbidden} showChunks={showChunks} showLabels={showLabels} />
          <ObjectsLayer objects={shown} typeById={typeById} view={Math.round(view.scale * 20) / 20} selectedId={selectedId} dragId={drag?.id ?? null} />
          {placing && hover && placingType ? <Ghost x={hover.x} z={hover.z} ry={placing.ry} scale={placing.scale} typeDef={placingType} status={status} view={view.scale} /> : null}
          {previewObj ? <Ghost x={preview.x} z={preview.z} ry={preview.ry} scale={preview.scale} typeDef={typeById.get(previewObj.type)} status={status} view={view.scale} /> : null}
          {dragObj ? <Ghost x={drag.x} z={drag.z} ry={dragObj.ry} scale={dragObj.scale} typeDef={typeById.get(dragObj.type)} status={status} view={view.scale} /> : null}
        </g>
      </svg>

      <div class="map__tools" role="toolbar" aria-label="Масштаб карты">
        <button type="button" class="map__btn" onClick={() => zoomBy(1.25)} aria-label="Приблизить" disabled={view.scale >= SCALE_MAX}><Icon name="plus" /></button>
        <button type="button" class="map__btn" onClick={() => zoomBy(0.8)} aria-label="Отдалить" disabled={view.scale <= SCALE_MIN}><Icon name="minus" /></button>
        <button type="button" class="map__btn" onClick={goCenter} aria-label="К центру города" title="К центру города"><Icon name="cursor" /></button>
        <button type="button" class="map__btn" onClick={fit} aria-label="Показать весь мир" title="Показать весь мир"><Icon name="fit" /></button>
      </div>
      <div class="map__status" aria-hidden="true">
        <Coords />
        <span>{fmtNum(view.scale, 1)} px/м · сетка 64 м</span>
      </div>
      {tipPos ? (
        <div class={`map__tip map__tip--${status}`} style={{ left: `${Math.min(tipPos.sx + 16, size.w - 220)}px`, top: `${Math.max(8, tipPos.sy - 40)}px` }} role="status">
          {tipText}
        </div>
      ) : null}
      {placing ? (
        <div class="map__hint" role="status">Размещение: «{placingType?.label}». Клик по карте — поставить, Esc — отмена.</div>
      ) : null}
    </div>
  );
}
