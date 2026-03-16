// ─────────────────────────────────────────────────────────────────────────────
// layers.js — v3.1e
// ─────────────────────────────────────────────────────────────────────────────

const Layers = (() => {
  let LAYER_DEFS    = {};
  let layerOrder    = [];
  let allPoints     = {};
  let leafletGroups = {};
  let labelGroups   = {};
  let opacityMap    = {};
  let visible       = {};
  let mapRef        = null;
  let customCounter = 0;
  let showLabels    = CONFIG.SHOW_LABELS;

  // ── UNDO ────────────────────────────────────────────────────────────────────
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
    renderAll(null, _lastMarkerClick);
    _updateUndoBtn();
    Sync.savePoints(allPoints);
    if (typeof UI !== 'undefined') UI.toast('Undone');
  }

  function _updateUndoBtn() {
    const btn = document.getElementById('undo-btn');
    if (btn) btn.disabled = undoStack.length === 0;
  }

  function _snapshot() {
    const s = {};
    Object.keys(LAYER_DEFS).forEach(id => { s[id] = JSON.parse(JSON.stringify(allPoints[id]||[])); });
    return s;
  }

  // ── INIT ────────────────────────────────────────────────────────────────────
  let _lastMarkerClick = null;

  function init(map) {
    mapRef = map;
    const savedOrder = _loadOrder();
    CONFIG.LAYERS.forEach(def => _registerLayer(def));
    if (savedOrder && savedOrder.length) {
      const validOrder = savedOrder.filter(id => LAYER_DEFS[id]);
      layerOrder.forEach(id => { if (!validOrder.includes(id)) validOrder.push(id); });
      layerOrder = validOrder;
    }
  }

  function _registerLayer(def) {
    LAYER_DEFS[def.id]    = def;
    allPoints[def.id]     = [];
    visible[def.id]       = true;
    opacityMap[def.id]    = 1;
    leafletGroups[def.id] = L.layerGroup().addTo(mapRef);
    labelGroups[def.id]   = L.layerGroup().addTo(mapRef);
    if (!layerOrder.includes(def.id)) layerOrder.push(def.id);
  }

  // ── ORDER PERSISTENCE ────────────────────────────────────────────────────────
  function _saveOrder() { localStorage.setItem('chakaLayerOrder', JSON.stringify(layerOrder)); }
  function _loadOrder() {
    try { return JSON.parse(localStorage.getItem('chakaLayerOrder')||'[]'); } catch(e) { return []; }
  }

  function reorderLayer(fromId, toId) {
    const fi = layerOrder.indexOf(fromId);
    const ti = layerOrder.indexOf(toId);
    if (fi < 0 || ti < 0) return;
    layerOrder.splice(fi, 1);
    layerOrder.splice(ti, 0, fromId);
    _saveOrder();
    if (typeof UI !== 'undefined') UI.rebuildLayerLists();
  }

  // ── STYLE EDITOR ─────────────────────────────────────────────────────────────
  function updateLayerStyle(layerId, changes) {
    if (!LAYER_DEFS[layerId]) return;
    Object.assign(LAYER_DEFS[layerId], changes);
    renderLayer(layerId, null, _lastMarkerClick);
    if (typeof UI !== 'undefined') UI.rebuildLayerLists();
  }

  // ── GETTERS ──────────────────────────────────────────────────────────────────
  function getDefs()      { return LAYER_DEFS; }
  function getDef(id)     { return LAYER_DEFS[id]; }
  function getPoints(id)  { return allPoints[id] || []; }
  function getAllPoints()  { return allPoints; }
  function isVisible(id)  { return !!visible[id]; }
  function getOrder()     { return layerOrder; }
  function getOpacity(id) { return opacityMap[id] ?? 1; }

  // ── SEED DATA ────────────────────────────────────────────────────────────────
  function applySeedIfEmpty(data) {
    const hasAny = Object.values(data||{}).some(arr => arr && arr.length > 0);
    if (hasAny || !CONFIG.SEED_POINTS) return false;
    Object.entries(CONFIG.SEED_POINTS).forEach(([layerId, pts]) => {
      allPoints[layerId] = pts.map(p => ({...p, addedBy:'Brent', editedBy:'', editedAt:''}));
    });
    Sync.savePoints(allPoints);
    return true;
  }

  function loadFromSheets(data, onMarkerClick) {
    _lastMarkerClick = onMarkerClick || _lastMarkerClick;
    const seeded = applySeedIfEmpty(data);
    if (!seeded) {
      Object.keys(LAYER_DEFS).forEach(id => { allPoints[id] = data[id] || []; });
    }
    renderAll(null, _lastMarkerClick);
    _updateAllCounts();
  }

  // ── ICON FACTORY ──────────────────────────────────────────────────────────────
  function makeIcon(layerId, selected) {
    const def = LAYER_DEFS[layerId];
    if (!def) return L.divIcon({ html:'', className:'', iconSize:[10,10] });
    const isSquare = def.shape === 'square';
    const s = isSquare ? 16 : 10;
    const op = opacityMap[layerId] ?? 1;
    const ring = selected
      ? `box-shadow:0 0 0 2px #fff,0 2px 8px rgba(0,0,0,0.7);`
      : `box-shadow:0 1px 5px rgba(0,0,0,0.5);`;
    const html = `<div class="chaka-marker" style="
      width:${s}px;height:${s}px;
      background:${def.color};
      border-radius:${isSquare?'2px':'50%'};
      border:2px solid rgba(255,255,255,0.35);
      opacity:${op};
      ${ring}
    "></div>`;
    return L.divIcon({ html, className:'', iconSize:[s,s], iconAnchor:[s/2,s/2], popupAnchor:[0,-s/2-4] });
  }

  // ── RENDER ────────────────────────────────────────────────────────────────────
  function renderLayer(layerId, selectedPoint, onMarkerClick) {
    if (!leafletGroups[layerId]) return;
    const clickHandler = onMarkerClick || _lastMarkerClick || ((lid, pt, marker) => {
      if (typeof Points !== 'undefined') Points.openEditPopup(lid, pt.id);
    });
    _lastMarkerClick = clickHandler;

    leafletGroups[layerId].clearLayers();
    labelGroups[layerId].clearLayers();

    (allPoints[layerId]||[]).forEach(pt => {
      const isSel = selectedPoint && selectedPoint.layerId===layerId && selectedPoint.ptId===pt.id;
      const marker = L.marker([pt.lat, pt.lng], { icon: makeIcon(layerId, isSel), draggable: true });
      marker._ptLayerId = layerId;
      marker._ptId = pt.id;

      marker.on('click', e => { L.DomEvent.stopPropagation(e); clickHandler(layerId, pt, marker); });
      marker.on('dragstart', () => pushUndo(_snapshot()));
      marker.on('dragend', e => {
        const pos = e.target.getLatLng();
        const idx = (allPoints[layerId]||[]).findIndex(p => p.id === pt.id);
        if (idx >= 0) {
          allPoints[layerId][idx].lat = pos.lat;
          allPoints[layerId][idx].lng = pos.lng;
          allPoints[layerId][idx].editedBy = typeof Presence !== 'undefined' ? Presence.getCurrentUser() : '';
          allPoints[layerId][idx].editedAt = new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});
        }
        Sync.savePoints(allPoints);
        if (typeof UI !== 'undefined') UI.toast('Position updated');
      });

      if (visible[layerId]) leafletGroups[layerId].addLayer(marker);

      // Labels
      if (showLabels && pt.name) {
        const shortName = pt.name.split('—')[0].trim().split(' ').slice(0,4).join(' ');
        const lbl = L.marker([pt.lat, pt.lng], {
          icon: L.divIcon({
            html: `<div class="map-label">${_esc(shortName)}</div>`,
            className: '', iconAnchor: [-6, 6],
          }),
          interactive: false, zIndexOffset: -100,
        });
        if (visible[layerId]) labelGroups[layerId].addLayer(lbl);
      }
    });
    _updateCount(layerId);
  }

  function renderAll(selectedPoint, onMarkerClick) {
    _lastMarkerClick = onMarkerClick || _lastMarkerClick;
    Object.keys(LAYER_DEFS).forEach(id => renderLayer(id, selectedPoint, _lastMarkerClick));
    _updateAllCounts();
  }

  function _updateCount(layerId) {
    const cnt = document.getElementById(`cnt-${layerId}`);
    if (cnt) cnt.textContent = (allPoints[layerId]||[]).length || '';
  }

  function _updateAllCounts() {
    Object.keys(LAYER_DEFS).forEach(_updateCount);
    const total = Object.values(allPoints).reduce((s,a) => s+(a||[]).length, 0);
    const el = document.getElementById('total-count');
    if (el) el.textContent = `${total} point${total!==1?'s':''}`;
  }

  // ── VISIBILITY ────────────────────────────────────────────────────────────────
  function toggleVisibility(layerId) {
    visible[layerId] = !visible[layerId];
    const tog = document.getElementById(`tog-${layerId}`);
    const row = document.getElementById(`row-${layerId}`);
    if (tog) { tog.classList.toggle('checked', visible[layerId]); tog.textContent = visible[layerId]?'✓':''; }
    if (row) row.classList.toggle('hidden-layer', !visible[layerId]);
    if (visible[layerId]) { mapRef.addLayer(leafletGroups[layerId]); mapRef.addLayer(labelGroups[layerId]); }
    else { mapRef.removeLayer(leafletGroups[layerId]); mapRef.removeLayer(labelGroups[layerId]); }
  }

  function setOpacity(layerId, val) {
    opacityMap[layerId] = val;
    renderLayer(layerId, null, _lastMarkerClick);
  }

  function toggleLabels(show) { showLabels = show; renderAll(null, _lastMarkerClick); }

  // ── POINT CRUD ────────────────────────────────────────────────────────────────
  function addPoint(layerId, pt)      { if (!allPoints[layerId]) allPoints[layerId]=[]; allPoints[layerId].push(pt); }
  function removePoint(layerId, ptId) { allPoints[layerId]=(allPoints[layerId]||[]).filter(p=>p.id!==ptId); }
  function findPoint(layerId, ptId)   { return (allPoints[layerId]||[]).find(p=>p.id===ptId); }

  function movePoint(fromLayer, toLayer, ptId, updates) {
    const pt = findPoint(fromLayer, ptId);
    if (!pt) return;
    removePoint(fromLayer, ptId);
    if (!allPoints[toLayer]) allPoints[toLayer]=[];
    allPoints[toLayer].push({...pt, ...updates});
  }

  function zoomToLayer(layerId) {
    const pts = allPoints[layerId]||[];
    if (!pts.length) { if(typeof UI!=='undefined') UI.toast('No points on this layer'); return; }
    mapRef.fitBounds(L.latLngBounds(pts.map(p=>[p.lat,p.lng])), { padding:[40,40], maxZoom:17 });
  }

  // ── CUSTOM LAYERS ─────────────────────────────────────────────────────────────
  function addCustomLayer(name, color, shape) {
    const id = `custom_${++customCounter}_${Date.now()}`;
    _registerLayer({ id, name, color, shape, group:'custom' });
    return id;
  }

  function removeCustomLayer(layerId) {
    mapRef.removeLayer(leafletGroups[layerId]);
    mapRef.removeLayer(labelGroups[layerId]);
    delete leafletGroups[layerId]; delete labelGroups[layerId];
    delete allPoints[layerId]; delete visible[layerId];
    delete opacityMap[layerId]; delete LAYER_DEFS[layerId];
    layerOrder = layerOrder.filter(id => id !== layerId);
  }

  function saveActiveLayer(id)  { localStorage.setItem('chakaLastLayer', id); }
  function getActiveLayer()     {
    const s = localStorage.getItem('chakaLastLayer');
    return (s && LAYER_DEFS[s]) ? s : (layerOrder[0] || CONFIG.LAYERS[0].id);
  }

  function checkDuplicate(layerId, lat, lng) {
    return (allPoints[layerId]||[]).some(p => mapRef.distance([lat,lng],[p.lat,p.lng]) < 10);
  }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return {
    init, getDefs, getDef, getPoints, getAllPoints, isVisible, getOrder, getOpacity,
    loadFromSheets, makeIcon, renderLayer, renderAll,
    toggleVisibility, setOpacity, toggleLabels,
    addPoint, removePoint, movePoint, findPoint, zoomToLayer,
    addCustomLayer, removeCustomLayer,
    saveActiveLayer, getActiveLayer,
    reorderLayer, pushUndo, undo,
    checkDuplicate, updateLayerStyle, _updateAllCounts,
  };
})();
