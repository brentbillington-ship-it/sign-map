// ─────────────────────────────────────────────────────────────────────────────
// layers.js — Layer state, markers, drag, labels, undo, visibility
// ─────────────────────────────────────────────────────────────────────────────

const Layers = (() => {
  let LAYER_DEFS    = {};
  let allPoints     = {};
  let leafletGroups = {};
  let labelGroups   = {};
  let visible       = {};
  let mapRef        = null;
  let customCounter = 0;
  let showLabels    = CONFIG.SHOW_LABELS;

  // ── UNDO STACK ───────────────────────────────────────────────────────────────
  const undoStack = [];
  const MAX_UNDO  = 10;

  function pushUndo(snapshot) {
    undoStack.push(JSON.stringify(snapshot));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    _updateUndoBtn();
  }

  function undo() {
    if (!undoStack.length) return;
    const snapshot = JSON.parse(undoStack.pop());
    Object.keys(LAYER_DEFS).forEach(id => { allPoints[id] = snapshot[id] || []; });
    renderAll(null, _lastOnClick);
    _updateUndoBtn();
    Sync.savePoints(allPoints);
    if (typeof UI !== 'undefined') UI.toast('Undone');
  }

  function _updateUndoBtn() {
    const btn = document.getElementById('undo-btn');
    if (btn) btn.disabled = undoStack.length === 0;
  }

  function _snapshot() {
    const snap = {};
    Object.keys(LAYER_DEFS).forEach(id => { snap[id] = JSON.parse(JSON.stringify(allPoints[id]||[])); });
    return snap;
  }

  // ── INIT ────────────────────────────────────────────────────────────────────
  let _lastOnClick = null;

  function init(map) {
    mapRef = map;
    CONFIG.LAYERS.forEach(def => _registerLayer(def));
  }

  function _registerLayer(def) {
    LAYER_DEFS[def.id]    = def;
    allPoints[def.id]     = [];
    visible[def.id]       = true;
    leafletGroups[def.id] = L.layerGroup().addTo(mapRef);
    labelGroups[def.id]   = L.layerGroup().addTo(mapRef);
  }

  // ── GETTERS ──────────────────────────────────────────────────────────────────
  function getDefs()     { return LAYER_DEFS; }
  function getDef(id)    { return LAYER_DEFS[id]; }
  function getPoints(id) { return allPoints[id] || []; }
  function getAllPoints() { return allPoints; }
  function isVisible(id) { return !!visible[id]; }

  // ── SEED DATA ────────────────────────────────────────────────────────────────
  function applySeedIfEmpty(data) {
    // Only seed if ALL layers are empty
    const hasAny = Object.values(data||{}).some(arr => arr && arr.length > 0);
    if (hasAny) return false;
    if (!CONFIG.SEED_POINTS) return false;
    Object.entries(CONFIG.SEED_POINTS).forEach(([layerId, pts]) => {
      allPoints[layerId] = pts.map(p => ({...p}));
    });
    Sync.savePoints(allPoints);
    return true;
  }

  // ── LOAD FROM SHEETS ─────────────────────────────────────────────────────────
  function loadFromSheets(data, onMarkerClick) {
    _lastOnClick = onMarkerClick;
    const seeded = applySeedIfEmpty(data);
    if (!seeded) {
      Object.keys(LAYER_DEFS).forEach(id => { allPoints[id] = data[id] || []; });
    }
    renderAll(null, onMarkerClick);
    _updateAllCounts();
  }

  // ── ICON FACTORY ──────────────────────────────────────────────────────────────
  function makeIcon(layerId, selected) {
    const def = LAYER_DEFS[layerId];
    if (!def) return L.divIcon({ html:'', className:'', iconSize:[12,12] });
    const isSquare = def.shape === 'square';
    const s = isSquare ? 18 : 12;
    const ring = selected
      ? `box-shadow:0 0 0 3px #fff,0 2px 8px rgba(0,0,0,0.6);`
      : `box-shadow:0 2px 8px rgba(0,0,0,0.55);`;
    const html = `<div style="width:${s}px;height:${s}px;background:${def.color};border-radius:${isSquare?'2px':'50%'};border:2px solid rgba(255,255,255,0.3);${ring}"></div>`;
    return L.divIcon({ html, className:'', iconSize:[s,s], iconAnchor:[s/2,s/2], popupAnchor:[0,-s/2-4] });
  }

  // ── RENDER ────────────────────────────────────────────────────────────────────
  function renderLayer(layerId, selectedPoint, onMarkerClick) {
    if (!leafletGroups[layerId]) return;
    // Always keep a valid click handler — fall back to Points module
    const clickHandler = onMarkerClick || _lastOnClick || ((lid, pt, marker) => {
      if (typeof Points !== 'undefined') {
        Points.select(lid, pt.id);
        Points.openEditPopup(lid, pt.id);
      }
    });
    _lastOnClick = clickHandler;
    leafletGroups[layerId].clearLayers();
    labelGroups[layerId].clearLayers();

    (allPoints[layerId]||[]).forEach(pt => {
      const isSel = selectedPoint && selectedPoint.layerId===layerId && selectedPoint.ptId===pt.id;
      const marker = L.marker([pt.lat, pt.lng], {
        icon: makeIcon(layerId, isSel),
        draggable: true,
      });
      marker._ptLayerId = layerId;
      marker._ptId      = pt.id;

      marker.on('click', e => {
        L.DomEvent.stopPropagation(e);
        if (clickHandler) clickHandler(layerId, pt, marker);
      });

      // Drag to reposition
      marker.on('dragstart', () => pushUndo(_snapshot()));
      marker.on('dragend', e => {
        const pos = e.target.getLatLng();
        const ptArr = allPoints[layerId];
        const idx = ptArr.findIndex(p => p.id === pt.id);
        if (idx >= 0) {
          ptArr[idx].lat = pos.lat;
          ptArr[idx].lng = pos.lng;
        }
        _updateAllCounts();
        Sync.savePoints(allPoints);
        if (typeof UI !== 'undefined') UI.toast('Position updated');
      });

      if (visible[layerId]) leafletGroups[layerId].addLayer(marker);

      // Label
      if (showLabels && pt.name) {
        const label = L.marker([pt.lat, pt.lng], {
          icon: L.divIcon({
            html: `<div class="map-label">${_esc(pt.name.split('—')[0].trim())}</div>`,
            className: '',
            iconAnchor: [-4, -4],
          }),
          interactive: false,
        });
        if (visible[layerId]) labelGroups[layerId].addLayer(label);
      }
    });

    _updateCount(layerId);
  }

  function renderAll(selectedPoint, onMarkerClick) {
    _lastOnClick = onMarkerClick || _lastOnClick;
    Object.keys(LAYER_DEFS).forEach(id => renderLayer(id, selectedPoint, _lastOnClick));
    _updateAllCounts();
  }

  function _updateCount(layerId) {
    const cnt = document.getElementById(`cnt-${layerId}`);
    if (cnt) cnt.textContent = (allPoints[layerId]||[]).length || '';
  }

  function _updateAllCounts() {
    Object.keys(LAYER_DEFS).forEach(_updateCount);
    // Update total summary
    const total = Object.values(allPoints).reduce((sum, arr) => sum + (arr||[]).length, 0);
    const el = document.getElementById('total-count');
    if (el) el.textContent = `${total} point${total!==1?'s':''}`;
  }

  // ── VISIBILITY ────────────────────────────────────────────────────────────────
  function toggleVisibility(layerId) {
    visible[layerId] = !visible[layerId];
    const tog = document.getElementById(`tog-${layerId}`);
    const row = document.getElementById(`row-${layerId}`);
    if (tog) { tog.classList.toggle('checked', visible[layerId]); tog.textContent = visible[layerId] ? '✓' : ''; }
    if (row) row.classList.toggle('hidden-layer', !visible[layerId]);
    const fn = visible[layerId] ? 'addLayer' : 'removeLayer';
    mapRef[fn](leafletGroups[layerId]);
    mapRef[fn](labelGroups[layerId]);
  }

  // ── LABELS ───────────────────────────────────────────────────────────────────
  function toggleLabels(show) {
    showLabels = show;
    renderAll(null, _lastOnClick);
  }

  // ── POINT CRUD ────────────────────────────────────────────────────────────────
  function addPoint(layerId, pt)       { if (!allPoints[layerId]) allPoints[layerId]=[]; allPoints[layerId].push(pt); }
  function removePoint(layerId, ptId)  { allPoints[layerId]=(allPoints[layerId]||[]).filter(p=>p.id!==ptId); }
  function findPoint(layerId, ptId)    { return (allPoints[layerId]||[]).find(p=>p.id===ptId); }

  function movePoint(fromLayer, toLayer, ptId, updates) {
    const pt = findPoint(fromLayer, ptId);
    if (!pt) return;
    removePoint(fromLayer, ptId);
    if (!allPoints[toLayer]) allPoints[toLayer] = [];
    allPoints[toLayer].push({ ...pt, ...updates });
  }

  // ── CUSTOM LAYERS ─────────────────────────────────────────────────────────────
  function addCustomLayer(name, color, shape) {
    const id  = `custom_${++customCounter}_${Date.now()}`;
    const def = { id, name, color, shape, group:'custom' };
    _registerLayer(def);
    return id;
  }

  function removeCustomLayer(layerId) {
    mapRef.removeLayer(leafletGroups[layerId]);
    mapRef.removeLayer(labelGroups[layerId]);
    delete leafletGroups[layerId]; delete labelGroups[layerId];
    delete allPoints[layerId]; delete visible[layerId]; delete LAYER_DEFS[layerId];
  }

  // ── ACTIVE LAYER MEMORY ───────────────────────────────────────────────────────
  function saveActiveLayer(id)  { localStorage.setItem('chakaLastLayer', id); }
  function getActiveLayer()     { const s=localStorage.getItem('chakaLastLayer'); return (s&&LAYER_DEFS[s])?s:CONFIG.LAYERS[0].id; }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return {
    init, getDefs, getDef, getPoints, getAllPoints, isVisible,
    loadFromSheets, makeIcon, renderLayer, renderAll,
    toggleVisibility, toggleLabels,
    addPoint, removePoint, movePoint, findPoint,
    addCustomLayer, removeCustomLayer,
    saveActiveLayer, getActiveLayer,
    pushUndo, undo,
    _updateAllCounts,
  };
})();
