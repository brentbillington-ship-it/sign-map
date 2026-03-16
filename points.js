// ─────────────────────────────────────────────────────────────────────────────
// points.js — v3.1d — Always-on placement, popup fix, attribution
// ─────────────────────────────────────────────────────────────────────────────

const Points = (() => {
  let mapRef        = null;
  let selectedPoint = null;
  let copiedPoint   = null;
  let drawToolActive = false;
  let svMode        = false;
  let placeMode     = false;  // OFF by default — parcel identify is default
  let onSave        = null;

  function init(map, onSaveCallback) {
    mapRef = map;
    onSave = onSaveCallback;

    map.on('click', e => {
      UI.hideCtxMenu();
      if (svMode) { _openStreetView(e.latlng.lat, e.latlng.lng); setSVMode(false); return; }
      if (!placeMode) return;  // parcel identify handles clicks when place mode off
      if (drawToolActive) return;
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
    // Start with parcel identify on, place mode off
    map.getContainer().style.cursor = 'default';
  }

  // ── DRAW TOOL STATE (called by Annotations) ───────────────────────────────────
  function setDrawToolActive(val) {
    drawToolActive = val;
    if (!val && !svMode) {
      // Restore identify when draw tool exits (unless place mode is on)
      if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(!placeMode);
      map.getContainer().style.cursor = placeMode ? 'crosshair' : 'default';
    }
  }

  function isDrawToolActive() { return drawToolActive; }

  // ── STREET VIEW ───────────────────────────────────────────────────────────────
  function _openStreetView(lat, lng) {
    window.open(`https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}`, '_blank');
  }

  function setSVMode(on) {
    svMode = on;
    const btn = document.getElementById('sv-btn');
    if (btn) btn.classList.toggle('active', on);
    if (on) {
      // SV mode: disable parcel identify, set crosshair
      if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(false);
      map.getContainer().style.cursor = 'crosshair';
    } else {
      // Restore: identify on if not in place mode
      if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(!placeMode);
      map.getContainer().style.cursor = placeMode ? 'crosshair' : 'default';
    }
  }

  function isPlaceMode() { return placeMode; }

  function togglePlaceMode() {
    placeMode = !placeMode;
    const btn = document.getElementById('place-btn');
    if (btn) {
      btn.classList.toggle('active', placeMode);
      btn.querySelector('span').textContent = `Place Point: ${placeMode ? 'ON' : 'OFF'}`;
    }
    document.getElementById('map').classList.toggle('place-mode', placeMode);
    // Parcel identify is the inverse of place mode
    if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(!placeMode);
    map.getContainer().style.cursor = placeMode ? 'crosshair' : 'default';
  }

  function setPlaceMode(val) {
    placeMode = val;
    document.getElementById('map').classList.toggle('place-mode', val);
    if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(!val);
    map.getContainer().style.cursor = val ? 'crosshair' : 'default';
  }

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
    if (!def) return;
    const addedBy  = pt.addedBy  ? _esc(pt.addedBy)  : '—';
    const editedBy = pt.editedBy ? `${_esc(pt.editedBy)}${pt.editedAt ? ` · ${_esc(pt.editedAt)}` : ''}` : '—';

    const div = document.createElement('div');
    div.className = 'point-popup';
    div.innerHTML = `
      <h3>${_swatchHtml(def,12)}${_esc(pt.name||'Unnamed')}</h3>
      <div class="meta">${_esc(def.name)}</div>
      ${pt.notes ? `<div class="notes">${_esc(pt.notes)}</div>` : ''}
      <div class="attr-row"><span class="attr-key">Added by</span><span class="attr-val">${addedBy}</span></div>
      <div class="attr-row"><span class="attr-key">Edited by</span><span class="attr-val">${editedBy}</span></div>
      <div class="popup-btns" style="margin-top:9px">
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

  function _saveNew(origLayerId, ptId, lat, lng) {
    const newLayerId = document.getElementById('ef-layer').value;
    const name  = (document.getElementById('ef-name').value ||'').trim();
    const notes = (document.getElementById('ef-notes').value||'').trim();
    const user  = typeof Presence !== 'undefined' ? Presence.getCurrentUser() : '';
    const now   = new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});
    if (Layers.checkDuplicate(newLayerId, lat, lng)) {
      if (!confirm('A point already exists within 10m on this layer. Add anyway?')) return;
    }
    Layers.pushUndo(Layers.getAllPoints());
    const pt = { id:ptId, lat, lng, name, notes, addedBy:user, addedAt:now, editedBy:'', editedAt:'' };
    Layers.addPoint(newLayerId, pt);
    UI.setActiveLayer(newLayerId);
    Layers.renderLayer(newLayerId, selectedPoint, _onMarkerClick);
    mapRef.closePopup();
    UI.toast('Point added');
    Sync.addPoint(newLayerId, pt);  // delta save — tiny payload
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
    const updated = Layers.findPoint(newLayerId, ptId);
    if (updated) Sync.updatePoint(newLayerId, updated);  // delta save
  }

  function deletePoint(layerId, ptId) {
    Layers.pushUndo(Layers.getAllPoints());
    Layers.removePoint(layerId, ptId);
    selectedPoint = null;
    Layers.renderLayer(layerId, null, _onMarkerClick);
    mapRef.closePopup();
    UI.toast('Point deleted');
    Sync.deletePoint(layerId, ptId);  // delta save — just sends the id
  }

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
    const pt   = { ...copiedPoint.pt, id:ptId, lat:latlng.lat, lng:latlng.lng, addedBy:user, addedAt:now, editedBy:'', editedAt:'' };
    Layers.addPoint(copiedPoint.layerId, pt);
    Layers.renderLayer(copiedPoint.layerId, selectedPoint, _onMarkerClick);
    UI.toast('Point pasted');
    Sync.addPoint(copiedPoint.layerId, pt);  // delta save
  }

  function pasteAtCenter() { pasteAt(mapRef.getCenter()); }

  function _handleKey(e) {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if ((e.ctrlKey||e.metaKey) && e.key==='z') { e.preventDefault(); Layers.undo(); return; }
    if ((e.ctrlKey||e.metaKey) && e.key==='c') { copySelected(); return; }
    if ((e.ctrlKey||e.metaKey) && e.key==='v') { pasteAtCenter(); return; }
    if (e.key==='Escape') { setSVMode(false); if(typeof Annotations!=='undefined') Annotations.clearTool(); }
    if (e.key==='Delete' && selectedPoint) {
      if (confirm('Delete selected point?')) deletePoint(selectedPoint.layerId, selectedPoint.ptId);
    }
  }

  function renderAll() { Layers.renderAll(selectedPoint, _onMarkerClick); }

  function _swatchHtml(def, size, id='') {
    if (!def) return '';
    return `<span ${id?`id="${id}"`:''} style="display:inline-block;width:${size}px;height:${size}px;background:${def.color};border-radius:${def.shape==='circle'?'50%':'2px'};border:1.5px solid rgba(255,255,255,0.22);flex-shrink:0;vertical-align:middle;margin-right:5px;"></span>`;
  }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return {
    init, setDrawToolActive, isDrawToolActive, togglePlaceMode, setPlaceMode, isPlaceMode, setSVMode,
    select, deselect, getSelected, getCopied,
    openEditPopup, openNewPopup, streetViewAt,
    deletePoint, copySelected, pasteAt, pasteAtCenter,
    renderAll,
  };
})();
