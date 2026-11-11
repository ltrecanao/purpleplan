'use strict';
/* PurplePlan — pizarra colaborativa P2P
   SPDX-License-Identifier: AGPL-3.0-or-later */

// ---------- SEGURIDAD ----------
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
// Solo http(s), data:image/* y blobs. Bloquea javascript: y otros esquemas peligrosos.
function safeUrl(u) {
    const s = String(u ?? '').trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^data:image\//i.test(s)) return s;
    if (/^blob:https?:\/\//i.test(s)) return s;
    try {
        const url = new URL(s, location.href);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch (_) { /* no-op */ }
    return '';
}

// ---------- PALETAS ----------
const STICKY_PALETTES = {
    purple:  'bg-purple-100 dark:bg-purple-950/90 border-purple-300 dark:border-purple-800 text-purple-900 dark:text-purple-200',
    violet:  'bg-violet-100 dark:bg-violet-950/90 border-violet-300 dark:border-violet-800 text-violet-900 dark:text-violet-200',
    pink:    'bg-pink-100 dark:bg-pink-950/90 border-pink-300 dark:border-pink-800 text-pink-900 dark:text-pink-200',
    amber:   'bg-amber-100 dark:bg-amber-950/90 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200',
    emerald: 'bg-emerald-100 dark:bg-emerald-950/90 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200',
    sky:     'bg-sky-100 dark:bg-sky-950/90 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-200',
    slate:   'bg-slate-100 dark:bg-zinc-900 border-slate-300 dark:border-zinc-700 text-slate-900 dark:text-zinc-100'
};
const PALETTE_DOT_COLORS = {
    purple: '#8b5cf6', violet: '#a855f7', pink: '#ec4899',
    amber: '#f59e0b', emerald: '#10b981', sky: '#0ea5e9', slate: '#64748b'
};
const PALETTE_KEYS = Object.keys(STICKY_PALETTES);
const ALL_PALETTE_CLASSES = PALETTE_KEYS
    .flatMap(k => STICKY_PALETTES[k].split(/\s+/))
    .filter(Boolean);

function inferColorKey(item) {
    if (item.colorKey && STICKY_PALETTES[item.colorKey]) return item.colorKey;
    const c = (item.color || '').toLowerCase();
    if (c.includes('violet')) return 'violet';
    if (c.includes('pink')) return 'pink';
    if (c.includes('amber') || c.includes('yellow')) return 'amber';
    if (c.includes('emerald') || c.includes('green')) return 'emerald';
    if (c.includes('sky') || c.includes('blue')) return 'sky';
    if (c.includes('slate') || c.includes('zinc') || c.includes('gray')) return 'slate';
    return 'purple';
}

// Normaliza un elemento venido de la red, de un JSON importado o del autosave.
// Devuelve un objeto nuevo y seguro, o null si no es válido. El id y los números
// terminan dentro de atributos HTML (onclick, style), así que se validan acá.
const ELEMENT_TYPES = ['sticky', 'label', 'link', 'image'];
const WORLD_SIZE = 8000;
function finiteOr(v, fallback, min, max) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}
function sanitizeElement(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id)) return null;
    if (!ELEMENT_TYPES.includes(raw.type)) return null;
    return {
        id: raw.id,
        type: raw.type,
        x: finiteOr(raw.x, 0, -WORLD_SIZE, WORLD_SIZE),
        y: finiteOr(raw.y, 0, -WORLD_SIZE, WORLD_SIZE),
        content: typeof raw.content === 'string' ? raw.content.slice(0, 20000) : '',
        colorKey: PALETTE_KEYS.includes(raw.colorKey) ? raw.colorKey : inferColorKey({ color: raw.color }),
        imgUrl: typeof raw.imgUrl === 'string' ? raw.imgUrl : '',
        w: raw.w == null ? null : finiteOr(raw.w, null, 20, 4000),
        h: raw.h == null ? null : finiteOr(raw.h, null, 20, 4000)
    };
}

// ---------- ESTADO ----------
let elements = [];
let strokes = [];
let edges = [];
let currentStroke = null;
let currentPathEl = null;
let drawMode = false;
let selectedElementId = null;

let panX = 0, panY = 0;
let zoomLevel = 1.0;
const MIN_ZOOM = 0.2, MAX_ZOOM = 3.0;

let isPanning = false, startX = 0, startY = 0;
let isPinching = false;
let pinchStartDist = 0, pinchStartZoom = 1, pinchStartPanX = 0, pinchStartPanY = 0;
let pinchMidX = 0, pinchMidY = 0;

let peer = null;
let p2pConnections = [];
let localStream = null;
let currentRoomId = '';
let role = null; // 'host' | 'joiner' | null
const audioStreams = new Map(); // peerId -> <audio>

const content = document.getElementById('canvas-content');
const container = document.getElementById('canvas-container');
const drawingLayer = document.getElementById('drawing-layer');
const connectionsLayer = document.getElementById('connections-layer');
const SVG_NS = 'http://www.w3.org/2000/svg';

const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
        const id = entry.target.id;
        if (edges.some(e => e.fromId === id || e.toId === id)) redrawEdgesFor(id);
    }
});

// ---------- SELECCIÓN ----------
function selectElement(id) {
    closeFloatingMenu();
    if (selectedElementId === id) return;
    if (selectedElementId) {
        document.getElementById(selectedElementId)?.classList.remove('selected');
    }
    selectedElementId = id;
    const dom = document.getElementById(id);
    if (dom) dom.classList.add('selected');
}
function deselectElement() {
    if (!selectedElementId) return;
    document.getElementById(selectedElementId)?.classList.remove('selected');
    selectedElementId = null;
}

// ---------- HISTORIAL ----------
const history = [];
let historyIndex = -1;
const HISTORY_LIMIT = 100;

function pushAction(action) {
    history.splice(historyIndex + 1);
    history.push(action);
    historyIndex++;
    if (history.length > HISTORY_LIMIT) { history.shift(); historyIndex--; }
    updateUndoRedoButtons();
}
function undo() {
    if (historyIndex < 0) return;
    history[historyIndex].undo();
    historyIndex--;
    updateUndoRedoButtons();
}
function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    history[historyIndex].redo();
    updateUndoRedoButtons();
}
function updateUndoRedoButtons() {
    const u = document.getElementById('undo-btn');
    const r = document.getElementById('redo-btn');
    if (u) u.disabled = historyIndex < 0;
    if (r) r.disabled = historyIndex >= history.length - 1;
}
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (e.key === 'Escape') { closeFloatingMenu(); deselectElement(); }
});

// ---------- TRANSFORM ----------
function updateTransform() {
    content.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    const d = document.getElementById('zoom-display');
    if (d) d.textContent = Math.round(zoomLevel * 100) + '%';
}
function getWorldCoords(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return {
        x: (clientX - rect.left - panX) / zoomLevel,
        y: (clientY - rect.top - panY) / zoomLevel
    };
}

// ---------- MENÚ FLOTANTE ----------
function showFloatingMenu(clientX, clientY) {
    closeFloatingMenu();
    const menu = document.createElement('div');
    menu.id = 'floating-menu';
    menu.className = 'fixed z-[60] bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-2xl p-1.5 flex items-center gap-1';
    menu.style.left = clientX + 'px';
    menu.style.top = clientY + 'px';
    menu.style.transform = 'translate(-50%, -130%)';
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.left < 8) menu.style.left = (8 + rect.width / 2) + 'px';
    if (rect.right > window.innerWidth - 8) menu.style.left = (window.innerWidth - 8 - rect.width / 2) + 'px';
    if (rect.top < 8) menu.style.transform = 'translate(-50%, 20%)';

    setTimeout(() => {
        const dismiss = (ev) => {
            if (!menu.contains(ev.target)) {
                closeFloatingMenu();
                document.removeEventListener('pointerdown', dismiss, true);
            }
        };
        document.addEventListener('pointerdown', dismiss, true);
    }, 30);
    return menu;
}
function closeFloatingMenu() {
    document.getElementById('floating-menu')?.remove();
}
function makeDeleteButton(onClick) {
    const btn = document.createElement('button');
    btn.className = 'px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg flex items-center gap-1.5 whitespace-nowrap transition';
    btn.innerHTML = '<i class="fa-solid fa-trash text-[10px]"></i><span>Eliminar</span>';
    btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); closeFloatingMenu(); });
    return btn;
}

// ---------- CONEXIONES ----------
function initConnectionsLayer() {
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `<marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, 8 3, 0 6" fill="#7c3aed"/></marker>`;
    connectionsLayer.appendChild(defs);
}
function getDotPosition(item, side) {
    if (!item) return null;
    const dom = document.getElementById(item.id);
    const w = dom?.offsetWidth || 220;
    const h = dom?.offsetHeight || 120;
    switch (side) {
        case 'top':    return { x: item.x + w / 2, y: item.y };
        case 'bottom': return { x: item.x + w / 2, y: item.y + h };
        case 'left':   return { x: item.x,         y: item.y + h / 2 };
        case 'right':  return { x: item.x + w,     y: item.y + h / 2 };
    }
    return null;
}
function getControlPoints(from, to, fromSide, toSide) {
    const dist = Math.hypot(to.x - from.x, to.y - from.y) * 0.4 + 20;
    const c1 = { ...from }, c2 = { ...to };
    if (fromSide === 'right') c1.x += dist;
    else if (fromSide === 'left') c1.x -= dist;
    else if (fromSide === 'top') c1.y -= dist;
    else if (fromSide === 'bottom') c1.y += dist;
    if (toSide === 'right') c2.x += dist;
    else if (toSide === 'left') c2.x -= dist;
    else if (toSide === 'top') c2.y -= dist;
    else if (toSide === 'bottom') c2.y += dist;
    return { c1, c2 };
}
function renderEdge(edge) {
    document.getElementById('edge-' + edge.id)?.remove();
    const fromItem = elements.find(e => e.id === edge.fromId);
    const toItem = elements.find(e => e.id === edge.toId);
    if (!fromItem || !toItem) return;
    const from = getDotPosition(fromItem, edge.fromSide);
    const to = getDotPosition(toItem, edge.toSide);
    if (!from || !to) return;
    const { c1, c2 } = getControlPoints(from, to, edge.fromSide, edge.toSide);
    const d = `M${from.x} ${from.y} C${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;

    const group = document.createElementNS(SVG_NS, 'g');
    group.id = 'edge-' + edge.id;

    const visiblePath = document.createElementNS(SVG_NS, 'path');
    visiblePath.setAttribute('d', d);
    visiblePath.setAttribute('stroke', '#7c3aed');
    visiblePath.setAttribute('stroke-width', '2');
    visiblePath.setAttribute('fill', 'none');
    visiblePath.setAttribute('stroke-linecap', 'round');
    visiblePath.setAttribute('marker-end', 'url(#arrowhead)');
    visiblePath.setAttribute('vector-effect', 'non-scaling-stroke');
    visiblePath.style.pointerEvents = 'none';

    const hitPath = document.createElementNS(SVG_NS, 'path');
    hitPath.setAttribute('d', d);
    hitPath.setAttribute('stroke', 'transparent');
    hitPath.setAttribute('stroke-width', '24');
    hitPath.setAttribute('fill', 'none');
    hitPath.setAttribute('vector-effect', 'non-scaling-stroke');
    hitPath.style.pointerEvents = 'stroke';
    hitPath.style.cursor = 'pointer';
    hitPath.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        const menu = showFloatingMenu(ev.clientX, ev.clientY);
        menu.appendChild(makeDeleteButton(() => removeEdge(edge.id)));
    });

    group.appendChild(visiblePath);
    group.appendChild(hitPath);
    connectionsLayer.appendChild(group);
}
function redrawEdgesFor(elementId) {
    edges.forEach(e => { if (e.fromId === elementId || e.toId === elementId) renderEdge(e); });
}
function localAddEdge(edge) {
    if (edges.some(e => e.id === edge.id)) return;
    edges.push(edge);
    renderEdge(edge);
}
function localRemoveEdge(id) {
    edges = edges.filter(e => e.id !== id);
    document.getElementById('edge-' + id)?.remove();
}
function addEdge(fromId, fromSide, toId, toSide) {
    const edge = {
        id: 'edge_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
        fromId, fromSide, toId, toSide
    };
    localAddEdge(edge);
    broadcast({ type: 'addEdge', edge });
    pushAction({
        undo: () => { localRemoveEdge(edge.id); broadcast({ type: 'removeEdge', id: edge.id }); },
        redo: () => { localAddEdge(edge); broadcast({ type: 'addEdge', edge }); }
    });
}
function removeEdge(id) {
    const edge = edges.find(e => e.id === id);
    if (!edge) return;
    localRemoveEdge(id);
    broadcast({ type: 'removeEdge', id });
    pushAction({
        undo: () => { localAddEdge(edge); broadcast({ type: 'addEdge', edge }); },
        redo: () => { localRemoveEdge(id); broadcast({ type: 'removeEdge', id }); }
    });
}

// ---------- DRAG DE FLECHA ----------
let tempEdgePath = null;
let isEdgeDragging = false;

function setEdgeDraggingHighlight(active) {
    document.querySelectorAll('.interactive-element').forEach(el => {
        el.classList.toggle('edge-dragging-active', active);
    });
}

function startEdgeDrag(fromItem, fromSide, clientX, clientY) {
    const startPos = getDotPosition(fromItem, fromSide);
    if (!startPos) return;
    isEdgeDragging = true;
    closeFloatingMenu();
    setEdgeDraggingHighlight(true);

    tempEdgePath = document.createElementNS(SVG_NS, 'path');
    tempEdgePath.setAttribute('stroke', '#7c3aed');
    tempEdgePath.setAttribute('stroke-width', '2');
    tempEdgePath.setAttribute('stroke-dasharray', '6 4');
    tempEdgePath.setAttribute('fill', 'none');
    tempEdgePath.setAttribute('d', `M${startPos.x} ${startPos.y} L${startPos.x} ${startPos.y}`);
    tempEdgePath.style.pointerEvents = 'none';
    connectionsLayer.appendChild(tempEdgePath);

    const updateLine = (cx, cy) => {
        const world = getWorldCoords(cx, cy);
        tempEdgePath.setAttribute('d', `M${startPos.x} ${startPos.y} L${world.x} ${world.y}`);
    };
    const onMouseMove = (e) => updateLine(e.clientX, e.clientY);
    const onTouchMove = (e) => { if (e.touches.length === 1) updateLine(e.touches[0].clientX, e.touches[0].clientY); };

    const finish = (cx, cy) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);

        // CRÍTICO: buscar el dot mientras TODAVÍA están visibles
        const target = document.elementFromPoint(cx, cy);
        const dot = target?.closest?.('.conn-dot');

        // Ahora sí, limpiar
        tempEdgePath?.remove();
        tempEdgePath = null;
        isEdgeDragging = false;
        setEdgeDraggingHighlight(false);

        if (dot) {
            const toId = dot.dataset.elid;
            const toSide = dot.dataset.side;
            if (toId && toId !== fromItem.id) {
                addEdge(fromItem.id, fromSide, toId, toSide);
            }
        }
    };
    const onMouseUp = (e) => finish(e.clientX, e.clientY);
    const onTouchEnd = (e) => {
        const t = e.changedTouches[0];
        if (t) finish(t.clientX, t.clientY);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
}

// ---------- DIBUJO ----------
const STROKE_COLOR = '#7c3aed';
let currentShape = 'pen'; // 'pen' | 'line' | 'rect' | 'oval'

// Genera el "d" del path según el tipo de trazo. Sin kind (trazos viejos) = lápiz.
// line/rect/oval guardan solo [p1, p2] (esquinas/EXTremos), pen guarda todos los puntos.
function buildPathD(stroke) {
    const pts = stroke.points;
    if (!pts || pts.length === 0) return '';
    if (!stroke.kind || stroke.kind === 'pen') {
        if (pts.length === 1) {
            const p = pts[0];
            return `M${p.x} ${p.y} L${p.x + 0.01} ${p.y + 0.01}`;
        }
        return pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ' ' + p.y).join(' ');
    }
    const [a, b] = [pts[0], pts[1] || pts[0]];
    if (stroke.kind === 'line') {
        return `M${a.x} ${a.y} L${b.x} ${b.y}`;
    }
    if (stroke.kind === 'rect') {
        const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
        const x2 = Math.max(a.x, b.x), y2 = Math.max(a.y, b.y);
        if (x2 - x1 < 0.6 && y2 - y1 < 0.6) return `M${a.x} ${a.y} L${a.x + 0.01} ${a.y + 0.01}`;
        return `M${x1} ${y1} H${x2} V${y2} H${x1} Z`;
    }
    if (stroke.kind === 'oval') {
        const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
        const x2 = Math.max(a.x, b.x), y2 = Math.max(a.y, b.y);
        const rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
        if (rx < 0.6 || ry < 0.6) return `M${a.x} ${a.y} L${a.x + 0.01} ${a.y + 0.01}`;
        return `M${x1 + rx} ${y1} A${rx} ${ry} 0 1 1 ${x1} ${y1 + ry} A${rx} ${ry} 0 1 1 ${x1 + rx} ${y2} A${rx} ${ry} 0 1 1 ${x2} ${y1 + ry} A${rx} ${ry} 0 1 1 ${x1 + rx} ${y1} Z`;
    }
    return '';
}

// Tipos de trazo disponibles y su botón en la toolbar
const SHAPE_KINDS = ['pen', 'line', 'rect', 'oval'];
const SHAPE_BTN_IDS = {
    pen: 'shape-pen-btn',
    line: 'shape-line-btn',
    rect: 'shape-rect-btn',
    oval: 'shape-oval-btn'
};
function updateShapeButtons() {
    SHAPE_KINDS.forEach(k => {
        const btn = document.getElementById(SHAPE_BTN_IDS[k]);
        if (btn) btn.classList.toggle('shape-active', currentShape === k);
    });
}
function setShape(k) {
    if (!SHAPE_KINDS.includes(k)) return;
    currentShape = k;
    updateShapeButtons();
    if (!drawMode) toggleDrawMode();
}
function createPreviewPath(stroke) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', buildPathD(stroke));
    path.setAttribute('stroke', stroke.color);
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('fill', 'none');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.style.pointerEvents = 'none';
    return path;
}
function createStrokeGroup(stroke) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.id = 'stroke-group-' + stroke.id;
    g.appendChild(createPreviewPath(stroke));
    const hit = document.createElementNS(SVG_NS, 'path');
    hit.setAttribute('d', buildPathD(stroke));
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '20');
    hit.setAttribute('fill', 'none');
    hit.setAttribute('vector-effect', 'non-scaling-stroke');
    hit.style.pointerEvents = 'stroke';
    hit.style.cursor = 'pointer';
    hit.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        const menu = showFloatingMenu(ev.clientX, ev.clientY);
        menu.appendChild(makeDeleteButton(() => removeStroke(stroke.id)));
    });
    g.appendChild(hit);
    return g;
}
function startStroke(clientX, clientY) {
    const { x, y } = getWorldCoords(clientX, clientY);
    const isShape = currentShape !== 'pen';
    currentStroke = {
        id: 'stroke_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
        kind: currentShape,
        color: STROKE_COLOR,
        // Las formas guardan solo [p1, p2]; el lápiz va acumulando
        points: isShape ? [{ x, y }, { x, y }] : [{ x, y }]
    };
    currentPathEl = createPreviewPath(currentStroke);
    drawingLayer.appendChild(currentPathEl);
}
function moveStroke(clientX, clientY) {
    if (!currentStroke) return;
    const { x, y } = getWorldCoords(clientX, clientY);
    if (currentShape === 'pen') {
        const last = currentStroke.points[currentStroke.points.length - 1];
        if (Math.hypot(x - last.x, y - last.y) < 1.2) return;
        currentStroke.points.push({ x, y });
    } else {
        currentStroke.points[1] = { x, y };
    }
    currentPathEl.setAttribute('d', buildPathD(currentStroke));
}
function endStroke() {
    if (!currentStroke) return;
    currentPathEl?.remove();
    currentPathEl = null;
    const stroke = currentStroke;
    currentStroke = null;
    localAddStroke(stroke);
    broadcast({ type: 'addStroke', stroke });
    pushAction({
        undo: () => { localRemoveStroke(stroke.id); broadcast({ type: 'removeStroke', id: stroke.id }); },
        redo: () => { localAddStroke(stroke); broadcast({ type: 'addStroke', stroke }); }
    });
}
function cancelStroke() {
    currentPathEl?.remove();
    currentPathEl = null;
    currentStroke = null;
}
function localAddStroke(stroke) {
    if (strokes.some(s => s.id === stroke.id)) return;
    strokes.push(stroke);
    drawingLayer.appendChild(createStrokeGroup(stroke));
}
function localRemoveStroke(id) {
    strokes = strokes.filter(s => s.id !== id);
    document.getElementById('stroke-group-' + id)?.remove();
}
function removeStroke(id) {
    const stroke = strokes.find(s => s.id === id);
    if (!stroke) return;
    localRemoveStroke(id);
    broadcast({ type: 'removeStroke', id });
    pushAction({
        undo: () => { localAddStroke(stroke); broadcast({ type: 'addStroke', stroke }); },
        redo: () => { localRemoveStroke(id); broadcast({ type: 'removeStroke', id }); }
    });
}
function toggleDrawMode() {
    drawMode = !drawMode;
    if (drawMode) deselectElement();
    document.getElementById('pen-btn').classList.toggle('pen-active', drawMode);
    container.classList.toggle('draw-mode', drawMode);
    const group = document.getElementById('shape-group');
    if (group) group.classList.toggle('hidden', !drawMode);
    updateShapeButtons();
    closeFloatingMenu();
}

// ---------- PAN Y ZOOM ----------
function startPan(clientX, clientY, target) {
    if (target === container || target === content) {
        isPanning = true;
        startX = clientX - panX;
        startY = clientY - panY;
    }
}
function movePan(clientX, clientY) {
    if (!isPanning) return;
    panX = clientX - startX;
    panY = clientY - startY;
    updateTransform();
}

container.addEventListener('mousedown', (e) => {
    if (e.target === container || e.target === content) deselectElement();
    if (isEdgeDragging) return;
    if (drawMode) { startStroke(e.clientX, e.clientY); return; }
    startPan(e.clientX, e.clientY, e.target);
});
window.addEventListener('mousemove', (e) => {
    if (isEdgeDragging) return;
    if (drawMode && currentStroke) { moveStroke(e.clientX, e.clientY); return; }
    movePan(e.clientX, e.clientY);
});
window.addEventListener('mouseup', () => {
    if (drawMode && currentStroke) { endStroke(); return; }
    isPanning = false;
});

container.addEventListener('touchstart', (e) => {
    if (e.target === container || e.target === content) deselectElement();
    if (isEdgeDragging) return;
    if (e.touches.length === 2) {
        if (currentStroke) cancelStroke();
        isPinching = true;
        isPanning = false;
        const [t1, t2] = e.touches;
        pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        pinchStartZoom = zoomLevel;
        pinchStartPanX = panX;
        pinchStartPanY = panY;
        const rect = container.getBoundingClientRect();
        pinchMidX = (t1.clientX + t2.clientX) / 2 - rect.left;
        pinchMidY = (t1.clientY + t2.clientY) / 2 - rect.top;
    } else if (e.touches.length === 1 && !isPinching) {
        if (drawMode) startStroke(e.touches[0].clientX, e.touches[0].clientY);
        else startPan(e.touches[0].clientX, e.touches[0].clientY, e.target);
    }
}, { passive: true });

window.addEventListener('touchmove', (e) => {
    if (isEdgeDragging) return;
    if (e.touches.length === 2 && pinchStartDist > 0) {
        const [t1, t2] = e.touches;
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const newZoom = Math.min(Math.max(MIN_ZOOM, pinchStartZoom * (dist / pinchStartDist)), MAX_ZOOM);
        panX = pinchMidX - (pinchMidX - pinchStartPanX) / pinchStartZoom * newZoom;
        panY = pinchMidY - (pinchMidY - pinchStartPanY) / pinchStartZoom * newZoom;
        zoomLevel = newZoom;
        updateTransform();
    } else if (e.touches.length === 1) {
        if (drawMode && currentStroke) moveStroke(e.touches[0].clientX, e.touches[0].clientY);
        else movePan(e.touches[0].clientX, e.touches[0].clientY);
    }
}, { passive: true });

window.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
        if (drawMode && currentStroke) endStroke();
        isPanning = false;
        isPinching = false;
        pinchStartDist = 0;
    }
}, { passive: true });

function adjustZoom(delta) {
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    const newZoom = Math.min(Math.max(MIN_ZOOM, zoomLevel + delta), MAX_ZOOM);
    panX = cx - (cx - panX) / zoomLevel * newZoom;
    panY = cy - (cy - panY) / zoomLevel * newZoom;
    zoomLevel = newZoom;
    updateTransform();
}
function resetZoom() {
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    panX = cx - (cx - panX) / zoomLevel;
    panY = cy - (cy - panY) / zoomLevel;
    zoomLevel = 1.0;
    updateTransform();
}

updateTransform();
updateUndoRedoButtons();
initConnectionsLayer();

// ---------- ELEMENTOS ----------
function addElement(type, data = null) {
    const id = 'el_' + Math.random().toString(36).slice(2, 11);
    const worldCenterX = (container.clientWidth / 2 - panX) / zoomLevel;
    const worldCenterY = (container.clientHeight / 2 - panY) / zoomLevel;
    const item = {
        id, type,
        x: data?.x ?? (worldCenterX - 110),
        y: data?.y ?? (worldCenterY - 80),
        content: data?.content || (type === 'sticky' ? 'Nota rápida...' : type === 'label' ? 'Etiqueta de texto' : ''),
        colorKey: data?.colorKey || 'purple',
        imgUrl: data?.imgUrl || '',
        w: data?.w || (type === 'sticky' ? 220 : null),   // ancho (px, mundo)
        h: data?.h ?? null                                 // altura mínima manual (px, mundo)
    };
    localAddElement(item);
    broadcast({ type: 'createElement', data: item });
    pushAction({
        undo: () => { localDeleteElement(item.id); broadcast({ type: 'deleteElement', id: item.id }); },
        redo: () => { localAddElement(item); broadcast({ type: 'createElement', data: item }); }
    });
}
function localAddElement(raw) {
    const item = sanitizeElement(raw);
    if (!item || elements.some(e => e.id === item.id)) return;
    elements.push(item);
    renderElement(item);
}
function localDeleteElement(id) {
    if (selectedElementId === id) deselectElement();
    elements = elements.filter(e => e.id !== id);
    document.getElementById(id)?.remove();
}

function dotStyle(side) {
    // 32x32 de área táctil (el puntito visual interno sigue chiquito)
    const base = 'position:absolute;width:32px;height:32px;cursor:crosshair;pointer-events:auto;touch-action:none;z-index:20;';
    const pos = {
        top:    'top:0;left:50%;transform:translate(-50%,-50%);',
        bottom: 'top:100%;left:50%;transform:translate(-50%,-50%);',
        left:   'top:50%;left:0;transform:translate(-50%,-50%);',
        right:  'top:50%;left:100%;transform:translate(-50%,-50%);'
    }[side];
    return base + pos;
}

function renderElement(item) {
    const colorKey = item.colorKey || 'purple';
    const colorClass = STICKY_PALETTES[colorKey] || STICKY_PALETTES.purple;

    const div = document.createElement('div');
    div.id = item.id;

    if (item.type === 'image') {
        div.className = 'absolute group cursor-move select-none interactive-element';
        div.style.width = item.w ? `${item.w}px` : 'auto';
    } else {
        div.className = `absolute group cursor-move select-none p-3 rounded-2xl shadow-xl border backdrop-blur-md interactive-element ${colorClass}`;
        div.style.width = `${item.w || 220}px`;
    }
    div.style.left = `${item.x}px`;
    div.style.top = `${item.y}px`;

    let innerHTML = '';

    if (item.type === 'sticky') {
        innerHTML += `<textarea oninput="updateContent('${item.id}', this.value)" class="w-full bg-transparent resize-none focus:outline-none text-xs interactive-element">${esc(item.content)}</textarea>`;
    } else if (item.type === 'label') {
        innerHTML += `<input type="text" value="${esc(item.content)}" oninput="updateContent('${item.id}', this.value)" class="w-full bg-transparent focus:outline-none text-xs font-bold interactive-element">`;
    } else if (item.type === 'link') {
        const safe = esc(safeUrl(item.content));
        innerHTML += `<div class="space-y-2">
            <input type="text" value="${esc(item.content)}" oninput="updateContent('${item.id}', this.value)" class="w-full bg-transparent focus:outline-none text-xs font-medium underline interactive-element">
            <a href="${safe}" target="_blank" rel="noopener noreferrer" class="block w-full text-center py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-medium transition">Abrir</a>
        </div>`;
    } else if (item.type === 'image') {
        const img = safeUrl(item.imgUrl);
        if (img) {
            // Con tamaño manual: ancho fijo + alto automático (mantiene proporción).
            // Sin tamaño: comportamiento legado (máx 260px).
            const imgStyle = item.w
                ? `width:${item.w}px;height:auto;`
                : 'max-width:260px;max-height:260px;height:auto;';
            innerHTML += `<img src="${esc(img)}" ondblclick="openImageModal('${item.id}')" style="${imgStyle}" class="rounded-xl cursor-zoom-in" title="Doble clic para ampliar">`;
        }
    }

    ['top', 'bottom', 'left', 'right'].forEach(side => {
        innerHTML += `<div class="conn-dot" data-elid="${item.id}" data-side="${side}" style="${dotStyle(side)}"><div class="dot-inner"></div></div>`;
    });

    if (item.type === 'sticky' || item.type === 'image') {
        innerHTML += `<div class="resize-handle" title="Arrastrar para agrandar o achicar" style="position:absolute;right:-9px;bottom:-9px;width:18px;height:18px;z-index:30;cursor:nwse-resize;touch-action:none;border-radius:50%;background:#fff;border:2px solid #7c3aed;box-shadow:0 1px 4px rgba(0,0,0,0.3);"><i class="fa-solid fa-up-right-and-down-left-from-center text-[7px] text-purple-600 pointer-events-none"></i></div>`;
    }

    if (item.type === 'sticky' || item.type === 'label') {
        innerHTML += `<button class="palette-indicator absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-white dark:border-zinc-900 shadow-md z-30 cursor-pointer" style="background-color:${PALETTE_DOT_COLORS[colorKey]}" title="Cambiar color"></button>`;
        innerHTML += `<button class="elem-delete-btn absolute -top-2 -left-2 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white items-center justify-center shadow-md z-30 cursor-pointer" title="Eliminar nota"><i class="fa-solid fa-trash text-[7px]"></i></button>`;
    }

    if (item.type === 'image') {
        innerHTML += `<button class="img-delete-btn elem-delete-btn absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white items-center justify-center shadow-md z-30 cursor-pointer" title="Eliminar imagen"><i class="fa-solid fa-trash text-[10px]"></i></button>`;
    }

    div.innerHTML = innerHTML;
    makeDraggable(div, item);

    if (item.type === 'sticky' || item.type === 'image') {
        makeResizable(div, item);
        if (item.type === 'sticky') {
            const ta = div.querySelector('textarea');
            fitTextarea(item, ta);
            ta.addEventListener('input', () => fitTextarea(item, ta));
        }
    }

    div.querySelectorAll('.conn-dot').forEach(dot => {
        const side = dot.dataset.side;
        dot.addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            dot.classList.add('dot-active');
            startEdgeDrag(item, side, e.clientX, e.clientY);
        });
        dot.addEventListener('touchstart', (e) => {
            e.stopPropagation(); e.preventDefault();
            dot.classList.add('dot-active');
            if (e.touches.length === 1) startEdgeDrag(item, side, e.touches[0].clientX, e.touches[0].clientY);
            setTimeout(() => dot.classList.remove('dot-active'), 800);
        }, { passive: false });
        dot.addEventListener('mouseup', () => dot.classList.remove('dot-active'));
        dot.addEventListener('mouseleave', () => dot.classList.remove('dot-active'));
    });

    const indicator = div.querySelector('.palette-indicator');
    if (indicator) {
        indicator.addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            showElementMenu(item, e.clientX, e.clientY);
        });
        indicator.addEventListener('touchstart', (e) => {
            e.stopPropagation(); e.preventDefault();
            if (e.touches[0]) showElementMenu(item, e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });
    }

    const imgDel = div.querySelector('.img-delete-btn');
    if (imgDel) {
        imgDel.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
        imgDel.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });
        imgDel.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteElement(item.id);
        });
    }

    const delBtn = div.querySelector('.elem-delete-btn:not(.img-delete-btn)');
    if (delBtn) {
        delBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
        delBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteElement(item.id);
        });
    }

    content.appendChild(div);
    resizeObserver.observe(div);
}

function applyColorToElement(item) {
    if (item.type === 'image') return;
    const dom = document.getElementById(item.id);
    if (!dom) return;
    const colorKey = item.colorKey || 'purple';
    dom.classList.remove(...ALL_PALETTE_CLASSES);
    dom.classList.add(...STICKY_PALETTES[colorKey].split(/\s+/).filter(Boolean));
    const indicator = dom.querySelector('.palette-indicator');
    if (indicator) indicator.style.backgroundColor = PALETTE_DOT_COLORS[colorKey];
}
function changeElementColor(id, newColorKey) {
    const item = elements.find(e => e.id === id);
    if (!item) return;
    const oldColorKey = item.colorKey || 'purple';
    if (oldColorKey === newColorKey) return;
    item.colorKey = newColorKey;
    applyColorToElement(item);
    broadcast({ type: 'changeColor', id, colorKey: newColorKey });
    pushAction({
        undo: () => { item.colorKey = oldColorKey; applyColorToElement(item); broadcast({ type: 'changeColor', id, colorKey: oldColorKey }); },
        redo: () => { item.colorKey = newColorKey; applyColorToElement(item); broadcast({ type: 'changeColor', id, colorKey: newColorKey }); }
    });
}
function showElementMenu(item, clientX, clientY) {
    const menu = showFloatingMenu(clientX, clientY);
    PALETTE_KEYS.forEach(key => {
        const sw = document.createElement('button');
        sw.className = 'w-6 h-6 rounded-full border-2 border-white dark:border-zinc-900 shadow-sm hover:scale-110 active:scale-95 transition flex-shrink-0';
        sw.style.backgroundColor = PALETTE_DOT_COLORS[key];
        if ((item.colorKey || 'purple') === key) {
            sw.classList.add('ring-2', 'ring-purple-500', 'ring-offset-1', 'dark:ring-offset-zinc-900');
        }
        sw.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        sw.addEventListener('click', (ev) => {
            ev.stopPropagation();
            changeElementColor(item.id, key);
            closeFloatingMenu();
        });
        menu.appendChild(sw);
    });
    const divider = document.createElement('div');
    divider.className = 'w-px h-6 bg-gray-200 dark:bg-zinc-800 mx-0.5';
    menu.appendChild(divider);
    const delBtn = document.createElement('button');
    delBtn.className = 'w-8 h-8 flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition flex-shrink-0';
    delBtn.innerHTML = '<i class="fa-solid fa-trash text-xs"></i>';
    delBtn.title = 'Eliminar';
    delBtn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        deleteElement(item.id);
        closeFloatingMenu();
    });
    menu.appendChild(delBtn);
}

function moveItemTo(item, x, y, element) {
    item.x = x; item.y = y;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    redrawEdgesFor(item.id);
    broadcast({ type: 'moveElement', id: item.id, x, y });
}

// ---------- DRAG ----------
function makeDraggable(element, item) {
    const INTERACTIVE_SEL = 'button, a, input, textarea, .conn-dot, .palette-indicator, .img-delete-btn, .resize-handle, .elem-delete-btn';

    element.addEventListener('mousedown', (e) => {
        if (drawMode || isEdgeDragging) return;
        if (e.target.closest(INTERACTIVE_SEL)) return;
        selectElement(item.id);
        if (e.target.closest(INTERACTIVE_SEL)) return;
        e.stopPropagation();

        const sx = e.clientX, sy = e.clientY;
        const ix = item.x, iy = item.y;
        let moved = false;

        const onMove = (ev) => {
            const dx = ev.clientX - sx;
            const dy = ev.clientY - sy;
            if (!moved && Math.hypot(dx, dy) < 2) return;
            moved = true;
            moveItemTo(item, ix + dx / zoomLevel, iy + dy / zoomLevel, element);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (moved && (item.x !== ix || item.y !== iy)) {
                const ex = item.x, ey = item.y;
                pushAction({
                    undo: () => moveItemTo(item, ix, iy, element),
                    redo: () => moveItemTo(item, ex, ey, element)
                });
            }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    let touch = null;

    element.addEventListener('touchstart', (e) => {
        if (drawMode || isEdgeDragging) return;
        if (e.touches.length !== 1) return;
        if (e.target.closest(INTERACTIVE_SEL)) return;

        selectElement(item.id);

        const t = e.touches[0];
        const isInteractive = !!e.target.closest('button, a, input, textarea');
        touch = { id: t.identifier, sx: t.clientX, sy: t.clientY, ix: item.x, iy: item.y, moved: false, isInteractive };

        if (!isInteractive) {
            e.preventDefault();
            e.stopPropagation();
            touch.moved = true;
        }
    }, { passive: false });

    element.addEventListener('touchmove', (e) => {
        if (!touch) return;
        const t = Array.from(e.touches).find(tt => tt.identifier === touch.id);
        if (!t) return;
        const dx = t.clientX - touch.sx;
        const dy = t.clientY - touch.sy;
        if (!touch.moved) {
            if (Math.hypot(dx, dy) < 8) return;
            touch.moved = true;
            if (document.activeElement && document.activeElement !== document.body) {
                try { document.activeElement.blur(); } catch (_) {}
            }
        }
        e.preventDefault();
        e.stopPropagation();
        moveItemTo(item, touch.ix + dx / zoomLevel, touch.iy + dy / zoomLevel, element);
    }, { passive: false });

    const finishTouch = () => {
        if (!touch) return;
        if (touch.moved && (item.x !== touch.ix || item.y !== touch.iy)) {
            const sx = touch.ix, sy = touch.iy;
            const ex = item.x, ey = item.y;
            pushAction({
                undo: () => moveItemTo(item, sx, sy, element),
                redo: () => moveItemTo(item, ex, ey, element)
            });
        }
        touch = null;
    };
    element.addEventListener('touchend', finishTouch);
    element.addEventListener('touchcancel', finishTouch);
}

// ---------- TAMAÑO DINÁMICO (post-its) ----------
// Ajusta la altura del textarea a su contenido (o a la altura manual mínima).
function fitTextarea(item, ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    const needed = ta.scrollHeight + 2; // margen anti-clip por redondeo
    const manual = item.h || 0;
    ta.style.height = Math.max(needed, manual, 40) + 'px';
    redrawEdgesFor(item.id);
}

// Handle de esquina: arrastra para cambiar ancho (horizontalidad) y altura
// (verticalidad). La altura manual actúa como mínimo; el texto sigue creciendo.
function makeResizable(element, item) {
    const handle = element.querySelector('.resize-handle');
    if (!handle) return;
    const isSticky = item.type === 'sticky';
    const MIN_W = isSticky ? 140 : 40;

    const apply = (w, h) => {
        item.w = Math.round(Math.max(MIN_W, w));
        element.style.width = item.w + 'px';
        const inner = element.querySelector('img');
        if (inner) { inner.style.width = item.w + 'px'; inner.style.maxWidth = 'none'; inner.style.maxHeight = 'none'; }
        if (isSticky) {
            if (h != null) item.h = Math.round(Math.max(40, h));
            fitTextarea(item, element.querySelector('textarea'));
        }
        broadcast({ type: 'resizeElement', id: item.id, w: item.w, h: item.h ?? null });
    };

    const begin = (cx, cy) => {
        selectElement(item.id);
        const sx = cx, sy = cy;
        const sw = element.offsetWidth || item.w || 220;
        const sh = element.offsetHeight;
        let moved = false;
        const onMove = (ev) => {
            ev.preventDefault();
            moved = true;
            apply(sw + (ev.clientX - sx) / zoomLevel, sh + (ev.clientY - sy) / zoomLevel);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (moved && (item.w !== sw || (item.h || 0) !== sh)) {
                const uw = sw, uh = sh;
                const rw = item.w, rh = item.h ?? null;
                pushAction({
                    undo: () => apply(uw, uh),
                    redo: () => apply(rw, rh)
                });
            }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const beginTouch = (e) => {
        if (e.touches.length !== 1) return;
        selectElement(item.id);
        const t = e.touches[0];
        const sx = t.clientX, sy = t.clientY;
        const sw = element.offsetWidth || item.w || 220;
        const sh = element.offsetHeight;
        let moved = false;
        const onMove = (ev) => {
            const tt = ev.touches[0];
            if (!tt) return;
            ev.preventDefault();
            moved = true;
            apply(sw + (tt.clientX - sx) / zoomLevel, sh + (tt.clientY - sy) / zoomLevel);
        };
        const onEnd = () => {
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onEnd);
            if (moved && (item.w !== sw || (item.h || 0) !== sh)) {
                const uw = sw, uh = sh;
                const rw = item.w, rh = item.h ?? null;
                pushAction({
                    undo: () => apply(uw, uh),
                    redo: () => apply(rw, rh)
                });
            }
        };
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
    };

    handle.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); begin(e.clientX, e.clientY); });
    handle.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); if (e.touches.length === 1) beginTouch(e); }, { passive: false });
}

function updateContent(id, val) {
    const el = elements.find(e => e.id === id);
    if (el) { el.content = val; broadcast({ type: 'updateContent', id, content: val }); }
}
function deleteElement(id) {
    const item = elements.find(e => e.id === id);
    if (!item) return;
    const connectedEdges = edges.filter(e => e.fromId === id || e.toId === id);
    const doDelete = () => {
        localDeleteElement(id);
        connectedEdges.forEach(e => localRemoveEdge(e.id));
        broadcast({ type: 'deleteElement', id });
        connectedEdges.forEach(e => broadcast({ type: 'removeEdge', id: e.id }));
    };
    const doRestore = () => {
        localAddElement(item);
        connectedEdges.forEach(e => localAddEdge(e));
        broadcast({ type: 'createElement', data: item });
        connectedEdges.forEach(e => broadcast({ type: 'addEdge', edge: e }));
    };
    doDelete();
    pushAction({ undo: doRestore, redo: doDelete });
}

// ---------- IMAGEN ----------
function openImageInputModal() {
    const input = document.getElementById('image-url-input');
    if (input) input.value = '';
    const m = document.getElementById('image-input-modal');
    m.classList.remove('hidden'); m.classList.add('flex');
}
function closeImageInputModal() {
    const m = document.getElementById('image-input-modal');
    m.classList.add('hidden'); m.classList.remove('flex');
}
function addImageFromUrl() {
    const raw = document.getElementById('image-url-input').value.trim();
    if (!raw) return alert('Ingresa una URL');
    if (!safeUrl(raw)) return alert('URL no permitida (solo http/https)');
    addElement('image', { imgUrl: raw });
    closeImageInputModal();
}
function handleImageFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
        alert('La imagen es demasiado grande (máx. 10 MB).');
        e.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
        addElement('image', { imgUrl: evt.target.result });
        closeImageInputModal();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}
function openImageModal(elementId) {
    const item = elements.find(el => el.id === elementId);
    const url = item ? safeUrl(item.imgUrl) : '';
    if (!url) return;
    document.getElementById('modal-img').src = url;
    const m = document.getElementById('image-modal');
    m.classList.remove('hidden'); m.classList.add('flex');
}
function closeImageModal() {
    const m = document.getElementById('image-modal');
    m.classList.add('hidden'); m.classList.remove('flex');
}

// ---------- GUARDAR / CARGAR ----------
function saveLocal() {
    const data = { elements, strokes, edges };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = "purple_board_backup.json";
    document.body.appendChild(a); a.click(); a.remove();
}
function triggerJsonUpload() {
    const input = document.getElementById('json-file-input');
    input.value = ''; input.click();
}
function loadLocal(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const parsed = JSON.parse(evt.target.result);
            const isLegacy = Array.isArray(parsed);
            resetBoard({
                elements: isLegacy ? parsed : (parsed.elements || []),
                strokes:  isLegacy ? []     : (parsed.strokes  || []),
                edges:    isLegacy ? []     : (parsed.edges    || [])
            });
        } catch (err) {
            console.error(err);
            alert('Archivo JSON inválido: ' + err.message);
        }
        e.target.value = '';
    };
    reader.readAsText(file);
}
function resetBoard(state) {
    content.innerHTML = '';
    content.appendChild(connectionsLayer);
    content.appendChild(drawingLayer);
    connectionsLayer.innerHTML = '';
    drawingLayer.innerHTML = '';
    initConnectionsLayer();

    elements = []; strokes = []; edges = [];
    selectedElementId = null;

    state.elements.forEach(el => localAddElement(el));
    state.strokes.forEach(s => localAddStroke(s));
    state.edges.forEach(ed => localAddEdge(ed));

    history.length = 0; historyIndex = -1;
    updateUndoRedoButtons();
    centerViewOnContent();
    scheduleSave();
}

// ---------- AUTOSAVE (localStorage) ----------
const STORAGE_KEY = 'purpleplan_state_v1';
let saveTimer = null;
let quotaWarned = false;

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 600);
}
function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ elements, strokes, edges }));
    } catch (err) {
        if (!quotaWarned) {
            quotaWarned = true;
            console.warn('Autosave falló (cuota llena):', err);
            alert('No se pudo guardar automáticamente: el tablero es demasiado grande para el almacenamiento local. Usá el botón de exportar JSON.');
        }
    }
}
function loadAutosaved() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        resetBoard({
            elements: parsed.elements || [],
            strokes: parsed.strokes || [],
            edges: parsed.edges || []
        });
    } catch (err) {
        console.warn('No se pudo restaurar el autosave:', err);
    }
}
window.addEventListener('beforeunload', () => {
    clearTimeout(saveTimer);
    saveState();
});

function centerViewOnContent() {
    if (elements.length === 0 && strokes.length === 0) {
        panX = 0; panY = 0; zoomLevel = 1;
        updateTransform();
        return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach(el => {
        minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
        const dom = document.getElementById(el.id);
        const w = dom?.offsetWidth || 220;
        const h = dom?.offsetHeight || 120;
        maxX = Math.max(maxX, el.x + w);
        maxY = Math.max(maxY, el.y + h);
    });
    strokes.forEach(s => s.points.forEach(p => {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }));
    if (!isFinite(minX)) return;
    const bboxW = Math.max(maxX - minX, 1);
    const bboxH = Math.max(maxY - minY, 1);
    const padding = 60;
    const scaleX = (container.clientWidth  - padding * 2) / bboxW;
    const scaleY = (container.clientHeight - padding * 2) / bboxH;
    zoomLevel = Math.min(1.0, Math.max(MIN_ZOOM, Math.min(scaleX, scaleY)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    panX = container.clientWidth  / 2 - cx * zoomLevel;
    panY = container.clientHeight / 2 - cy * zoomLevel;
    updateTransform();
}

function toggleTheme() {
    const html = document.documentElement;
    const icon = document.getElementById('theme-icon');
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        icon.className = 'fa-solid fa-sun text-xs text-amber-500';
    } else {
        html.classList.add('dark');
        icon.className = 'fa-solid fa-moon text-xs';
    }
}

// ---------- P2P ----------
function formatRoomId(id) {
    if (!id) return '';
    const maxLen = 14;
    if (id.length <= maxLen) return id;
    return id.slice(0, maxLen) + '…';
}

// ---------- COMPARTIR SALA ----------
let toastTimer = null;
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('opacity-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('opacity-0'), 1800);
}

function copyToClipboard(text, okMsg) {
    const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast(okMsg); }
        catch (_) { showToast('No se pudo copiar'); }
        ta.remove();
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast(okMsg)).catch(fallback);
    } else {
        fallback();
    }
}

function inviteUrl() {
    return location.origin + location.pathname + '?room=' + encodeURIComponent(currentRoomId);
}
function showShareModal() {
    if (!currentRoomId) return;
    document.getElementById('share-title-text').textContent =
        role === 'joiner' ? 'Conectado a la sala' : 'Sala creada';
    document.getElementById('share-id').textContent = currentRoomId;
    if (navigator.share) {
        document.getElementById('native-share-btn').classList.remove('hidden');
    }
    const m = document.getElementById('share-modal');
    m.classList.remove('hidden'); m.classList.add('flex');
}
function closeShareModal() {
    const m = document.getElementById('share-modal');
    m.classList.add('hidden'); m.classList.remove('flex');
}
function copyShareId() {
    copyToClipboard(currentRoomId, 'ID copiado. Compartilo para que se unan.');
}
function copyShareLink() {
    copyToClipboard(inviteUrl(), 'Enlace copiado: quien lo abra puede unirse al instante.');
}
function nativeShare() {
    navigator.share({
        title: 'PurplePlan',
        text: 'Unite a mi pizarra con este ID: ' + currentRoomId,
        url: inviteUrl()
    }).catch(() => { /* el usuario canceló */ });
}

// ID de sala legible y sin caracteres confusos (evita O/0, 1/l, etc.)
function genRoomKey() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    let raw = '';
    try {
        const rand = crypto.getRandomValues(new Uint8Array(9));
        for (const b of rand) raw += alphabet[b % alphabet.length];
    } catch (_) {
        for (let i = 0; i < 9; i++) raw += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return raw.slice(0, 4) + '-' + raw.slice(4);
}

function openRoomModal() {
    if (currentRoomId) { showShareModal(); return; }
    document.getElementById('room-modal').classList.remove('hidden');
}
function closeRoomModal() { document.getElementById('room-modal').classList.add('hidden'); }
function initPeer(id = null) {
    audioStreams.forEach((_, pid) => detachRemoteStream(pid));
    if (peer) peer.destroy();
    peer = id ? new Peer(id) : new Peer();
    peer.on('open', (assignedId) => {
        currentRoomId = assignedId;
        document.getElementById('room-badge').classList.add('hidden');
        document.getElementById('room-id-text').textContent = formatRoomId(currentRoomId);
        document.getElementById('copy-room-btn').classList.remove('hidden');
        closeRoomModal();
        showShareModal();
    });
    peer.on('connection', (conn) => setupConnection(conn, false));
    peer.on('call', (call) => {
        call.answer(localStream);
        call.on('stream', (remote) => attachRemoteStream(call.peer, remote));
        call.on('close', () => detachRemoteStream(call.peer));
    });
    peer.on('error', (err) => {
        const messages = {
            'unavailable-id': 'Ese ID de sala ya está en uso. Probá con otro.',
            'peer-unavailable': 'No se encontró la sala. Verificá el ID.',
            'network': 'Problema de red con el servidor de la comunidad.',
            'server-error': 'El servidor de señalización (comunidad) no responde. Probá de nuevo más tarde.',
            'browser-incompatible': 'Tu navegador no soporta WebRTC.',
            'disconnected': 'Se perdió la conexión con el servidor de señalización.'
        };
        alert(messages[err.type] || ('Error P2P: ' + err.type));
    });
}
function hostRoom() {
    role = 'host';
    const raw = document.getElementById('room-id-input').value.trim();
    // Sin custom ID: generar uno legible (PeerJS generaría un UUID largo)
    const customId = raw && !/\s/.test(raw) ? raw : genRoomKey();
    initPeer(customId);
}
function joinRoom() {
    const targetId = document.getElementById('room-id-input').value.trim();
    if (!targetId) return alert('Ingresa el ID');
    role = 'joiner';
    initPeer();
    peer.on('open', () => {
        currentRoomId = targetId;
        document.getElementById('room-badge').classList.add('hidden');
        document.getElementById('room-id-text').textContent = formatRoomId(currentRoomId);
        document.getElementById('copy-room-btn').classList.remove('hidden');
        closeRoomModal();
        showShareModal();
        const conn = peer.connect(targetId);
        setupConnection(conn, true);
        if (localStream) {
            const call = peer.call(targetId, localStream);
            call.on('stream', (remote) => attachRemoteStream(targetId, remote));
            call.on('close', () => detachRemoteStream(targetId));
        }
    });
}
function copyRoomId() {
    if (!currentRoomId) return;
    const icon = document.getElementById('copy-room-icon');
    const original = 'fa-solid fa-copy text-[8px] text-purple-500 dark:text-purple-400 leading-none';
    copyToClipboard(currentRoomId, 'ID copiado. Compartilo para que se unan.');
    if (icon) {
        icon.className = 'fa-solid fa-check text-[8px] text-emerald-500 leading-none';
        setTimeout(() => { icon.className = original; }, 1200);
    }
}
function setupConnection(conn, outbound) {
    p2pConnections.push(conn);
    conn.on('open', () => {
        // Quien se une pide el estado actual de la sala; el anfitrión lo envía.
        if (outbound) conn.send({ type: 'requestSync' });
    });
    conn.on('data', (msg) => handleRemoteMessage(msg));
    conn.on('close', () => {
        p2pConnections = p2pConnections.filter(c => c !== conn);
        const calls = peer?.connections?.[conn.peer] || [];
        calls.forEach(c => { if (c.type === 'media') c.close(); });
        detachRemoteStream(conn.peer);
    });
}
function broadcast(msg) {
    p2pConnections.forEach(c => { if (c.open) c.send(msg); });
    scheduleSave();
}
function handleRemoteMessage(msg) {
    if (msg.type === 'createElement') {
        localAddElement(msg.data);
    } else if (msg.type === 'moveElement') {
        const el = elements.find(e => e.id === msg.id);
        if (el) {
            el.x = msg.x; el.y = msg.y;
            const dom = document.getElementById(msg.id);
            if (dom) { dom.style.left = `${msg.x}px`; dom.style.top = `${msg.y}px`; }
            redrawEdgesFor(msg.id);
        }
    } else if (msg.type === 'updateContent') {
        const el = elements.find(e => e.id === msg.id);
        if (el) {
            el.content = msg.content;
            const dom = document.getElementById(msg.id);
            const input = dom?.querySelector('textarea, input');
            if (input && input.value !== msg.content) input.value = msg.content;
            if (el.type === 'sticky') fitTextarea(el, input);
        }
    } else if (msg.type === 'resizeElement') {
        const el = elements.find(e => e.id === msg.id);
        if (el) {
            el.w = msg.w; el.h = msg.h ?? null;
            const dom = document.getElementById(msg.id);
            if (dom) {
                if (el.w) dom.style.width = el.w + 'px';
                if (el.type === 'image') {
                    const img = dom.querySelector('img');
                    if (img) { img.style.width = el.w + 'px'; img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; }
                } else if (el.type === 'sticky') {
                    fitTextarea(el, dom.querySelector('textarea'));
                }
            }
        }
    } else if (msg.type === 'changeColor') {
        const el = elements.find(e => e.id === msg.id);
        if (el) { el.colorKey = msg.colorKey; applyColorToElement(el); }
    } else if (msg.type === 'deleteElement') {
        localDeleteElement(msg.id);
    } else if (msg.type === 'addStroke') {
        localAddStroke(msg.stroke);
    } else if (msg.type === 'removeStroke') {
        localRemoveStroke(msg.id);
    } else if (msg.type === 'addEdge') {
        localAddEdge(msg.edge);
    } else if (msg.type === 'removeEdge') {
        localRemoveEdge(msg.id);
    } else if (msg.type === 'requestSync') {
        broadcast({ type: 'syncAll', elements, strokes, edges });
    } else if (msg.type === 'syncAll') {
        const localHasContent = elements.length > 0 || strokes.length > 0 || edges.length > 0;
        const remoteHasContent = (msg.elements?.length || 0) + (msg.strokes?.length || 0) + (msg.edges?.length || 0) > 0;
        if (localHasContent && remoteHasContent) {
            if (!confirm('La sala ya tiene contenido y tu tablero también. ¿Reemplazar tu tablero local con el de la sala?')) return;
        }
        resetBoard({ elements: msg.elements || [], strokes: msg.strokes || [], edges: msg.edges || [] });
    }
}

// ---------- AUDIO REMOTO (un <audio> por peer) ----------
function attachRemoteStream(peerId, stream) {
    detachRemoteStream(peerId);
    const audio = document.createElement('audio');
    audio.id = 'remote-audio-' + peerId;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.srcObject = stream;
    document.body.appendChild(audio);
    audio.play().catch(() => { /* autoplay bloqueado hasta interacción */ });
    audioStreams.set(peerId, audio);
}
function detachRemoteStream(peerId) {
    const audio = audioStreams.get(peerId);
    if (audio) {
        audio.srcObject = null;
        audio.remove();
        audioStreams.delete(peerId);
    }
}

// ---------- VOZ ----------
async function toggleVoice() {
    const btn = document.getElementById('voice-btn');
    const icon = document.getElementById('voice-icon');
    const txt = document.getElementById('voice-txt');
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            icon.className = 'fa-solid fa-microphone text-purple-600 animate-pulse';
            if (txt) txt.textContent = 'Activa';
            btn.classList.add('border', 'border-purple-600');
            // Emitir a todos los peers conectados
            p2pConnections.forEach(conn => {
                const call = peer.call(conn.peer, localStream);
                call.on('stream', (remote) => attachRemoteStream(conn.peer, remote));
                call.on('close', () => detachRemoteStream(conn.peer));
            });
        } catch (e) {
            alert('Permiso de micrófono denegado.');
        }
    } else {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
        icon.className = 'fa-solid fa-microphone-slash';
        if (txt) txt.textContent = 'Voz';
        btn.classList.remove('border', 'border-purple-600');
        audioStreams.forEach((_, pid) => detachRemoteStream(pid));
    }
}

// ---------- INICIO ----------
// Enlace de invitación: ?room=ab12-cd34 precarga el ID para unirse
(function initInvite() {
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
        const input = document.getElementById('room-id-input');
        if (input) input.value = room;
    }
})();
loadAutosaved();
