// ─────────────────────────────────────────────────────────────────────────────
// layers.js — v3.3 — Photo cache, popup-safe refresh
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

  // ── DRAG STATE (module-level so justDragged() is accessible via export) ──────
  let _justDragged  = false;
  function justDragged() { return _justDragged; }

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
    // Find what changed and delta-save only those points
    Object.keys(LAYER_DEFS).forEach(id => {
      const before = snapshot[id] || [];
      const after  = allPoints[id] || [];
      // Points removed by undo (were added after snapshot) — delete them
      after.forEach(pt => {
        if (!before.find(p => p.id === pt.id)) Sync.deletePoint(id, pt.id);
      });
      // Points restored or moved — update them
      before.forEach(pt => {
        const current = after.find(p => p.id === pt.id);
        if (!current || current.lat !== pt.lat || current.lng !== pt.lng) Sync.updatePoint(id, pt);
      });
      allPoints[id] = before;
    });
    renderAll(null, _lastMarkerClick);
    _updateUndoBtn();
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
    if (!CONFIG.SEED_POINTS) return false;
    let seeded = false;
    Object.entries(CONFIG.SEED_POINTS).forEach(([layerId, pts]) => {
      const existing = data[layerId] || [];
      const existingIds = new Set(existing.map(p => String(p.id)));
      const missing = pts.filter(p => !existingIds.has(String(p.id)));
      if (!missing.length) return;
      missing.forEach(p => {
        const pt = {...p, addedBy:'Brent', editedBy:'', editedAt:''};
        if (!allPoints[layerId]) allPoints[layerId] = [];
        allPoints[layerId].push(pt);
        Sync.addPoint(layerId, pt);
      });
      seeded = true;
    });
    return seeded;
  }

  function loadFromSheets(data, onMarkerClick) {
    _lastMarkerClick = onMarkerClick || _lastMarkerClick;

    // Preserve local photo data (stripped from sheet load for bandwidth)
    const photoCache = {};
    Object.keys(allPoints).forEach(id => {
      (allPoints[id]||[]).forEach(pt => {
        if (pt.photo) photoCache[pt.id] = pt.photo;
      });
    });

    // Load all data from sheets first
    Object.keys(LAYER_DEFS).forEach(id => { allPoints[id] = data[id] || []; });

    // Restore cached photos
    Object.keys(allPoints).forEach(id => {
      (allPoints[id]||[]).forEach(pt => {
        if (!pt.photo && photoCache[pt.id]) pt.photo = photoCache[pt.id];
      });
    });

    // Auto-dedup: remove points with identical lat/lng within same layer
    Object.keys(LAYER_DEFS).forEach(id => {
      const pts = allPoints[id] || [];
      const seen = new Map();
      const toDelete = [];
      pts.forEach(pt => {
        const key = `${parseFloat(pt.lat).toFixed(6)},${parseFloat(pt.lng).toFixed(6)}`;
        if (seen.has(key)) {
          const existing = seen.get(key);
          const existingScore = (existing.notes||'').length + (existing.name||'').length;
          const newScore = (pt.notes||'').length + (pt.name||'').length;
          if (newScore > existingScore) {
            toDelete.push(existing.id);
            seen.set(key, pt);
          } else {
            toDelete.push(pt.id);
          }
        } else {
          seen.set(key, pt);
        }
      });
      if (toDelete.length) {
        allPoints[id] = pts.filter(p => !toDelete.includes(p.id));
        toDelete.forEach(ptId => Sync.deletePoint(id, ptId));
        console.log(`Auto-dedup: removed ${toDelete.length} duplicate(s) from ${id}`);
      }
    });

    // Skip re-render if a popup is open (avoids destroying it mid-view)
    const popupOpen = mapRef && mapRef._popup && mapRef._popup.isOpen && mapRef._popup.isOpen();
    if (!popupOpen) {
      renderAll(null, _lastMarkerClick);
    }
    _updateAllCounts();
  }

  // ── ICON FACTORY ──────────────────────────────────────────────────────────────
  function makeIcon(layerId, selected) {
    const def = LAYER_DEFS[layerId];
    if (!def) return L.divIcon({ html:'', className:'', iconSize:[10,10] });
    const shape = def.shape || 'circle';
    const s = (shape === 'circle') ? 10 : 16;
    const op = opacityMap[layerId] ?? 1;
    const hex = def.color.replace('#','');
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    const bg = op < 1 ? `rgba(${r},${g},${b},${op})` : def.color;
    const ring = selected
      ? `box-shadow:0 0 0 2px #fff,0 2px 6px #000;`
      : `box-shadow:0 1px 4px #000;`;
    let html;
    if (shape === 'diamond') {
      html = `<div class="chaka-marker" style="width:${s}px;height:${s}px;background:${bg};border:1.5px solid #fff;transform:rotate(45deg);border-radius:2px;${ring}"></div>`;
    } else if (shape === 'triangle') {
      html = `<div class="chaka-marker" style="width:0;height:0;border-left:${s/2}px solid transparent;border-right:${s/2}px solid transparent;border-bottom:${s}px solid ${bg};filter:drop-shadow(0 1px 3px #000);"></div>`;
    } else if (shape === 'star') {
      html = `<div class="chaka-marker chaka-star" style="color:${bg};font-size:${s+2}px;line-height:1;text-shadow:0 0 2px #000;${ring}">★</div>`;
    } else {
      // circle or square
      html = `<div class="chaka-marker" style="width:${s}px;height:${s}px;background:${bg};border-radius:${shape==='circle'?'50%':'2px'};border:1.5px solid #fff;${ring}"></div>`;
    }
    return L.divIcon({ html, className:'', iconSize:[s,s], iconAnchor:[s/2,s/2], popupAnchor:[0,-s/2-4] });
  }

  // ── SELECTION STATE (for mass delete) ────────────────────────────────────────
  const selectedPts = new Set(); // "layerId::ptId"
  function _selKey(layerId, ptId) { return `${layerId}::${ptId}`; }
  function toggleSelect(layerId, ptId) {
    const k = _selKey(layerId, ptId);
    if (selectedPts.has(k)) selectedPts.delete(k); else selectedPts.add(k);
    _updateMassDeleteBar();
    renderLayer(layerId, null, _lastMarkerClick);
  }
  function isSelected(layerId, ptId) { return selectedPts.has(_selKey(layerId, ptId)); }
  function clearSelection() { selectedPts.clear(); _updateMassDeleteBar(); }
  function getSelected() { return Array.from(selectedPts).map(k => { const [l,p]=k.split('::'); return {layerId:l,ptId:p}; }); }
  function _updateMassDeleteBar() {
    const bar = document.getElementById('mass-delete-bar');
    if (!bar) return;
    const n = selectedPts.size;
    bar.style.display = n > 0 ? 'flex' : 'none';
    const lbl = bar.querySelector('#mass-delete-label');
    if (lbl) lbl.textContent = `${n} point${n!==1?'s':''} selected`;
  }
  function massDelete() {
    const sel = getSelected();
    if (!sel.length) return;
    if (!confirm(`Delete ${sel.length} selected point${sel.length!==1?'s':''}? This cannot be undone.`)) return;
    pushUndo(_snapshot());
    sel.forEach(({layerId, ptId}) => {
      removePoint(layerId, ptId);
      Sync.deletePoint(layerId, ptId);
    });
    selectedPts.clear();
    _updateMassDeleteBar();
    renderAll(null, _lastMarkerClick);
    if (typeof UI !== 'undefined') { UI.toast(`${sel.length} points deleted`); UI.rebuildLayerLists(); }
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

    const isMobile = window.matchMedia('(max-width:768px)').matches;

    (allPoints[layerId]||[]).forEach(pt => {
      const isSel = selectedPoint && selectedPoint.layerId===layerId && selectedPoint.ptId===pt.id;
      const isMassSel = isSelected(layerId, pt.id);
      const marker = L.marker([pt.lat, pt.lng], {
        icon: makeIcon(layerId, isSel || isMassSel),
        draggable: true,
        riseOnHover: isMobile,
      });
      marker._ptLayerId = layerId;
      marker._ptId = pt.id;
      marker._wasDragged = false;

      marker.on('click', e => {
        L.DomEvent.stopPropagation(e);
        Layers.markerClickedAt = Date.now();
        if (marker._wasDragged) { marker._wasDragged = false; return; }
        if (e.originalEvent && (e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey)) {
          toggleSelect(layerId, pt.id);
          return;
        }
        clickHandler(layerId, pt, marker);
      });

      marker.on('dragstart', () => {
        pushUndo(_snapshot());
      });

      marker.on('dragend', e => {
        marker._wasDragged = true;
        _justDragged = true;
        setTimeout(() => { _justDragged = false; }, 300);

        const pos = e.target.getLatLng();
        const idx = (allPoints[layerId]||[]).findIndex(p => p.id === pt.id);
        if (idx < 0) return;
        const origLat = allPoints[layerId][idx].lat;
        const origLng = allPoints[layerId][idx].lng;
        if (!confirm('Move point to new location?')) {
          marker.setLatLng([origLat, origLng]);
          marker._wasDragged = false;
          return;
        }
        allPoints[layerId][idx].lat = pos.lat;
        allPoints[layerId][idx].lng = pos.lng;
        allPoints[layerId][idx].editedBy = typeof Presence !== 'undefined' ? Presence.getCurrentUser() : '';
        allPoints[layerId][idx].editedAt = new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});
        Sync.updatePoint(layerId, allPoints[layerId][idx]);
        if (typeof UI !== 'undefined') UI.toast('Position updated');
      });

      if (visible[layerId]) leafletGroups[layerId].addLayer(marker);

      // Labels
      if (showLabels && pt.name) {
        const shortName = pt.name.split('—')[0].trim().split(' ').slice(0,4).join(' ');
        const lbl = L.marker([pt.lat, pt.lng], {
          icon: L.divIcon({
            html: `<div class="map-label" style="writing-mode:horizontal-tb!important">${_esc(shortName)}</div>`,
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

  const mod = {
    init, getDefs, getDef, getPoints, getAllPoints, isVisible, getOrder, getOpacity,
    loadFromSheets, makeIcon, renderLayer, renderAll,
    toggleVisibility, setOpacity, toggleLabels,
    addPoint, removePoint, movePoint, findPoint, zoomToLayer,
    addCustomLayer, removeCustomLayer,
    saveActiveLayer, getActiveLayer,
    reorderLayer, pushUndo, undo,
    checkDuplicate, updateLayerStyle, _updateAllCounts,
    toggleSelect, isSelected, clearSelection, getSelected, massDelete,
    justDragged,
    markerClickedAt: 0,
  };
  return mod;
})();
