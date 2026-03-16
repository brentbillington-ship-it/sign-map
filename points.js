// ─────────────────────────────────────────────────────────────────────────────
// points.js — Placement, popups, edit/delete, copy/paste, keyboard
// ─────────────────────────────────────────────────────────────────────────────

const Points = (() => {
  let mapRef        = null;
  let selectedPoint = null;
  let copiedPoint   = null;
  let placeMode     = true;
  let onSave        = null;

  function init(map, onSaveCallback) {
    mapRef = map;
    onSave = onSaveCallback;

    map.on('click', e => {
      UI.hideCtxMenu();
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
      });
    });

    document.addEventListener('keydown', _handleKey);
  }

  // ── PLACE MODE ───────────────────────────────────────────────────────────────
  function togglePlaceMode() {
    placeMode = !placeMode;
    document.getElementById('map').classList.toggle('place-mode', placeMode);
    const btn = document.getElementById('place-btn');
    if (btn) {
      btn.classList.toggle('active', placeMode);
      btn.querySelector('span').textContent = `Place Point: ${placeMode?'ON':'OFF'}`;
    }
  }

  function setPlaceMode(val) {
    placeMode = val;
    document.getElementById('map').classList.toggle('place-mode', placeMode);
  }

  function isPlaceMode() { return placeMode; }

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
    const div = document.createElement('div');
    div.className = 'point-popup';
    div.innerHTML = `
      <h3>${_swatchHtml(def,12)}${_esc(pt.name||'Unnamed')}</h3>
      <div class="meta">${_esc(def.name)}</div>
      ${pt.notes?`<div class="notes">${_esc(pt.notes)}</div>`:''}
      <button class="edit-btn" onclick="Points.openEditPopup('${layerId}','${pt.id}')">✎ Edit / Change Layer</button>
    `;
    marker.bindPopup(div, { maxWidth:300 }).openPopup();
    marker.on('popupclose', deselect);
  }

  // ── EDIT POPUP ───────────────────────────────────────────────────────────────
  function openEditPopup(layerId, ptId) {
    const pt = Layers.findPoint(layerId, ptId);
    if (!pt) return;
    mapRef.closePopup();
    const def = Layers.getDef(layerId);
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
        ${Object.values(Layers.getDefs()).map(d=>`<option value="${d.id}"${d.id===layerId?' selected':''}>${_esc(d.name)}</option>`).join('')}
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
    Layers.pushUndo(Layers.getAllPoints());
    Layers.addPoint(newLayerId, { id:ptId, lat, lng, name, notes });
    UI.setActiveLayer(newLayerId);
    Layers.renderLayer(newLayerId, selectedPoint, _onMarkerClick);
    mapRef.closePopup();
    UI.toast('Point added');
    onSave(Layers.getAllPoints());
  }

  function _saveEdit(origLayerId, ptId, lat, lng) {
    const newLayerId = document.getElementById('ef-layer').value;
    const name  = (document.getElementById('ef-name').value ||'').trim();
    const notes = (document.getElementById('ef-notes').value||'').trim();
    Layers.pushUndo(Layers.getAllPoints());
    Layers.movePoint(origLayerId, newLayerId, ptId, { name, notes });
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
    const ptId  = 'pt_' + Date.now();
    const newPt = { ...copiedPoint.pt, id:ptId, lat:latlng.lat, lng:latlng.lng };
    Layers.addPoint(copiedPoint.layerId, newPt);
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
  }

  function renderAll() { Layers.renderAll(selectedPoint, _onMarkerClick); }
  // ── HELPERS ──────────────────────────────────────────────────────────────────
  function _swatchHtml(def, size, id='') {
    if (!def) return '';
    return `<span ${id?`id="${id}"`:''} style="display:inline-block;width:${size}px;height:${size}px;background:${def.color};border-radius:${def.shape==='circle'?'50%':'2px'};border:1.5px solid rgba(255,255,255,0.22);flex-shrink:0;vertical-align:middle;margin-right:5px;"></span>`;
  }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return {
    init, togglePlaceMode, setPlaceMode, isPlaceMode,
    select, deselect, getSelected, getCopied,
    openEditPopup, openNewPopup,
    deletePoint, copySelected, pasteAt, pasteAtCenter,
    renderAll,
  };
})();
