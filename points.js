// ─────────────────────────────────────────────────────────────────────────────
// points.js — v3.1c — Placement, popups, attribution, street view, undo
// ─────────────────────────────────────────────────────────────────────────────

const Points = (() => {
  let mapRef        = null;
  let selectedPoint = null;
  let copiedPoint   = null;
  let placeMode     = true;
  let svMode        = false;   // street view click mode
  let onSave        = null;

  function init(map, onSaveCallback) {
    mapRef = map;
    onSave = onSaveCallback;

    map.on('click', e => {
      UI.hideCtxMenu();
      // Street View mode
      if (svMode) { _openStreetView(e.latlng.lat, e.latlng.lng); setSVMode(false); return; }
      if (!placeMode) { deselect(); return; }
      const layerId = UI.getActiveLayerId();
      openNewPopup(e.latlng, layerId);
    });

    map.on('contextmenu', e => {
      const layerId = UI.getActiveLayerId();
      const def = Layers.getDef(layerId);
      UI.showCtxMenu(e.originalEvent, {
        placeLabel: def ? `Place "${def.name}" here` : 'Place point here',
        hasCopy: !!copiedPoint,
        onPlace: () => openNewPopup(e.latlng, layerId),
        onPaste: () => pasteAt(e.latlng),
        onStreetView: () => _openStreetView(e.latlng.lat, e.latlng.lng),
      });
    });

    document.addEventListener('keydown', _handleKey);
  }

  // ── STREET VIEW ───────────────────────────────────────────────────────────────
  function _openStreetView(lat, lng) {
    window.open(`https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}`, '_blank');
  }

  function setSVMode(on) {
    svMode = on;
    const btn = document.getElementById('sv-btn');
    if (btn) btn.classList.toggle('active', on);
    mapRef.getContainer().style.cursor = on ? 'crosshair' : '';
    if (on && placeMode) { placeMode = false; _updatePlaceBtn(); }
  }

  // ── PLACE MODE ───────────────────────────────────────────────────────────────
  function togglePlaceMode() {
    placeMode = !placeMode;
    if (placeMode) { svMode = false; setSVMode(false); }
    _updatePlaceBtn();
    document.getElementById('map').classList.toggle('place-mode', placeMode);
  }

  function _updatePlaceBtn() {
    const btn = document.getElementById('place-btn');
    if (!btn) return;
    btn.classList.toggle('active', placeMode);
    btn.querySelector('span').textContent = `Place Point: ${placeMode?'ON':'OFF'}`;
  }

  function setPlaceMode(val) { placeMode = val; _updatePlaceBtn(); document.getElementById('map').classList.toggle('place-mode', val); }
  function isPlaceMode()     { return placeMode; }

  // ── SELECTION ────────────────────────────────────────────────────────────────
  function select(layerId, ptId) {
    const prev = selectedPoint;
    selectedPoint = { layerId, ptId };
    if (prev) Layers.renderLayer(prev.layerId, selectedPoint, _onMarkerClick);
    Layers.renderLayer(layerId, selectedPoint, _onMarkerClick);
  }

  function deselect() {
    if (!selectedPoint) return;
    const prev = selectedPoint; selectedPoint = null;
    Layers.renderLayer(prev.layerId, null, _onMarkerClick);
  }

  function getSelected() { return selectedPoint; }
  function getCopied()   { return copiedPoint; }

  function _onMarkerClick(layerId, pt, marker) {
    select(layerId, pt.id);
    _showViewPopup(layerId, pt, marker);
  }

  // ── VIEW POPUP ───────────────────────────────────────────────────────────────
  function _showViewPopup(layerId, pt, marker) {
    const def = Layers.getDef(layerId);
    const addedBy  = pt.addedBy  ? `<span class="attr-val">${_esc(pt.addedBy)}</span>` : '<span class="attr-val muted">—</span>';
    const editedBy = pt.editedBy ? `<span class="attr-val">${_esc(pt.editedBy)}</span>${pt.editedAt?` <span class="attr-date">${_esc(pt.editedAt)}</span>`:''}` : '<span class="attr-val muted">—</span>';

    const div = document.createElement('div');
    div.className = 'point-popup';
    div.innerHTML = `
      <h3>${_swatchHtml(def,12)}${_esc(pt.name||'Unnamed')}</h3>
      <div class="meta">${_esc(def.name)}</div>
      ${pt.notes?`<div class="notes">${_esc(pt.notes)}</div>`:''}
      <div class="attr-row"><span class="attr-key">Added by</span>${addedBy}</div>
      <div class="attr-row"><span class="attr-key">Edited by</span>${editedBy}</div>
      <div class="popup-btns" style="margin-top:8px">
        <button class="edit-btn" onclick="Points.openEditPopup('${layerId}','${pt.id}')">✎ Edit</button>
        <button class="sv-popup-btn" onclick="Points.streetViewAt(${pt.lat},${pt.lng})">📷 Street View</button>
      </div>
    `;
    marker.bindPopup(div, { maxWidth:300 }).openPopup();
    marker.on('popupclose', deselect);
  }

  function streetViewAt(lat, lng) { _openStreetView(lat, lng); }

  // ── EDIT POPUP ───────────────────────────────────────────────────────────────
  function openEditPopup(layerId, ptId) {
    const pt = Layers.findPoint(layerId, ptId);
    if (!pt) return;
    mapRef.closePopup();
    const div = _buildForm(layerId, pt, false);
    L.popup({ maxWidth:320 }).setLatLng([pt.lat,pt.lng]).setContent(div).openOn(mapRef);
    div.querySelector('.btn-save').onclick   = () => _saveEdit(layerId, ptId, pt.lat, pt.lng);
    div.querySelector('.btn-delete').onclick = () => deletePoint(layerId, ptId);
    div.querySelector('.btn-cancel').onclick = () => mapRef.closePopup();
  }

  function openNewPopup(latlng, layerId) {
    const ptId = 'pt_' + Date.now();
    const div  = _buildForm(layerId, { id:ptId, name:'', notes:'' }, true);
    L.popup({ maxWidth:320 }).setLatLng(latlng).setContent(div).openOn(mapRef);
    setTimeout(() => { const el=document.getElementById('ef-name'); if(el) el.focus(); }, 80);
    div.querySelector('.btn-save').onclick   = () => _saveNew(layerId, ptId, latlng.lat, latlng.lng);
    div.querySelector('.btn-cancel').onclick = () => mapRef.closePopup();
  }

  // ── FORM BUILDER ─────────────────────────────────────────────────────────────
  function _buildForm(layerId, pt, isNew) {
    const def = Layers.getDef(layerId);
    const div = document.createElement('div');
    div.className = 'popup-form';
    div.innerHTML = `
      <h3>${_swatchHtml(def,13,'ef-swatch')} ${isNew?'New Point':'Edit Point'}</h3>
      <label>Layer</label>
      <select id="ef-layer">
        ${Layers.getOrder().filter(id=>Layers.getDef(id)).map(id=>{
          const d=Layers.getDef(id);
          return `<option value="${d.id}"${d.id===layerId?' selected':''}>${_esc(d.name)}</option>`;
        }).join('')}
      </select>
      <label>Name / Label</label>
      <input id="ef-name" type="text" value="${_esc(pt.name||'')}" placeholder="Address or label"/>
      <label>Notes</label>
      <textarea id="ef-notes" placeholder="Optional notes…">${_esc(pt.notes||'')}</textarea>
      <div class="popup-btns">
        <button class="btn-save">Save</button>
        ${!isNew?'<button class="btn-delete">Delete</button>':''}
        <button class="btn-cancel">Cancel</button>
      </div>
    `;
    div.querySelector('#ef-layer').addEventListener('change', function() {
      const d = Layers.getDef(this.value);
      const sw = div.querySelector('#ef-swatch');
      if (d && sw) { sw.style.background=d.color; sw.style.borderRadius=d.shape==='circle'?'50%':'2px'; }
    });
    return div;
  }

  // ── SAVE ─────────────────────────────────────────────────────────────────────
  function _saveNew(origLayerId, ptId, lat, lng) {
    const newLayerId = document.getElementById('ef-layer').value;
    const name  = (document.getElementById('ef-name').value ||'').trim();
    const notes = (document.getElementById('ef-notes').value||'').trim();
    const user  = typeof Presence !== 'undefined' ? Presence.getCurrentUser() : '';
    const now   = new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});

    // Duplicate check
    if (Layers.checkDuplicate(newLayerId, lat, lng)) {
      if (!confirm('A point already exists within 10m on this layer. Add anyway?')) return;
    }

    Layers.pushUndo(Layers.getAllPoints());
    Layers.addPoint(newLayerId, { id:ptId, lat, lng, name, notes, addedBy:user, addedAt:now, editedBy:'', editedAt:'' });
    UI.setActiveLayer(newLayerId);
    Layers.renderLayer(newLayerId, selectedPoint, _onMarkerClick);
    // Animate new marker
    setTimeout(() => {
      const el = document.querySelector(`.chaka-marker`);
      if (el) el.style.transform = 'scale(1.4)';
      setTimeout(() => { if(el) el.style.transform = 'scale(1)'; }, 150);
    }, 50);
    mapRef.closePopup();
    UI.toast('Point added');
    onSave(Layers.getAllPoints());
  }

  function _saveEdit(origLayerId, ptId, lat, lng) {
    const newLayerId = document.getElementById('ef-layer').value;
    const name  = (document.getElementById('ef-name').value ||'').trim();
    const notes = (document.getElementById('ef-notes').value||'').trim();
    const user  = typeof Presence !== 'undefined' ? Presence.getCurrentUser() : '';
    const now   = new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});

    Layers.pushUndo(Layers.getAllPoints());
    Layers.movePoint(origLayerId, newLayerId, ptId, { name, notes, editedBy:user, editedAt:now });
    UI.setActiveLayer(newLayerId);
    Layers.renderLayer(origLayerId, selectedPoint, _onMarkerClick);
    if (newLayerId !== origLayerId) Layers.renderLayer(newLayerId, selectedPoint, _onMarkerClick);
    mapRef.closePopup();
    UI.toast('Point saved');
    onSave(Layers.getAllPoints());
  }

  function deletePoint(layerId, ptId) {
    Layers.pushUndo(Layers.getAllPoints());
    Layers.removePoint(layerId, ptId);
    selectedPoint = null;
    Layers.renderLayer(layerId, null, _onMarkerClick);
    mapRef.closePopup();
    UI.toast('Point deleted');
    onSave(Layers.getAllPoints());
  }

  // ── COPY / PASTE ──────────────────────────────────────────────────────────────
  function copySelected() {
    if (!selectedPoint) return;
    const pt = Layers.findPoint(selectedPoint.layerId, selectedPoint.ptId);
    if (pt) { copiedPoint = { layerId:selectedPoint.layerId, pt:{...pt} }; UI.toast('Copied — Ctrl+V or right-click to paste'); }
  }

  function pasteAt(latlng) {
    if (!copiedPoint) return;
    Layers.pushUndo(Layers.getAllPoints());
    const user = typeof Presence !== 'undefined' ? Presence.getCurrentUser() : '';
    const now  = new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});
    const ptId = 'pt_' + Date.now();
    Layers.addPoint(copiedPoint.layerId, { ...copiedPoint.pt, id:ptId, lat:latlng.lat, lng:latlng.lng, addedBy:user, addedAt:now, editedBy:'', editedAt:'' });
    Layers.renderLayer(copiedPoint.layerId, selectedPoint, _onMarkerClick);
    UI.toast('Point pasted');
    onSave(Layers.getAllPoints());
  }

  function pasteAtCenter() { pasteAt(mapRef.getCenter()); }

  // ── KEYBOARD ─────────────────────────────────────────────────────────────────
  function _handleKey(e) {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if ((e.ctrlKey||e.metaKey) && e.key==='z') { e.preventDefault(); Layers.undo(); return; }
    if ((e.ctrlKey||e.metaKey) && e.key==='c') { copySelected(); return; }
    if ((e.ctrlKey||e.metaKey) && e.key==='v') { pasteAtCenter(); return; }
    if (e.key==='Delete' && selectedPoint) {
      if (confirm('Delete selected point?')) deletePoint(selectedPoint.layerId, selectedPoint.ptId);
    }
    if (e.key==='Escape') { setSVMode(false); Annotations.clearTool && Annotations.clearTool(); }
  }

  function renderAll() { Layers.renderAll(selectedPoint, _onMarkerClick); }

  function _swatchHtml(def, size, id='') {
    if (!def) return '';
    return `<span ${id?`id="${id}"`:''} style="display:inline-block;width:${size}px;height:${size}px;background:${def.color};border-radius:${def.shape==='circle'?'50%':'2px'};border:1.5px solid rgba(255,255,255,0.22);flex-shrink:0;vertical-align:middle;margin-right:5px;"></span>`;
  }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return {
    init, togglePlaceMode, setPlaceMode, isPlaceMode, setSVMode,
    select, deselect, getSelected, getCopied,
    openEditPopup, openNewPopup, streetViewAt,
    deletePoint, copySelected, pasteAt, pasteAtCenter,
    renderAll,
  };
})();
