// ─────────────────────────────────────────────────────────────────────────────
// points.js — v3.3 — Popup fix, photo upload, target-based deselect
// ─────────────────────────────────────────────────────────────────────────────

const Points = (() => {
  let mapRef        = null;
  let selectedPoint = null;
  let copiedPoint   = null;
  let drawToolActive = false;
  let svMode        = false;
  let placeMode     = false;
  let onSave        = null;
  // (flag removed — popup fix uses target check instead)

  function init(map, onSaveCallback) {
    mapRef = map;
    onSave = onSaveCallback;

    map.on('click', e => {
      UI.hideCtxMenu();
      if (svMode) { _openStreetView(e.latlng.lat, e.latlng.lng); setSVMode(false); return; }
      if (!placeMode) {
        // Skip deselect if a marker was just clicked (two guards for reliability)
        if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest && e.originalEvent.target.closest('.chaka-marker')) return;
        if (Layers.markerClickedAt && (Date.now() - Layers.markerClickedAt) < 50) return;
        if (Layers.justDragged()) return;
        if (selectedPoint) { deselect(); mapRef.closePopup(); }
        return;
      }
      if (drawToolActive) return;
      const layerId = UI.getActiveLayerId();
      openNewPopup(e.latlng, layerId);
    });

    map.on('contextmenu', e => {
      if (placeMode) { deactivateTool(); return; }
      // Deselect on right-click
      if (selectedPoint) { deselect(); mapRef.closePopup(); }
      const layerId = UI.getActiveLayerId();
      const def = Layers.getDef(layerId);
      UI.showCtxMenu(e.originalEvent, {
        placeLabel: def ? `Place "${def.name}" here` : 'Place point here',
        hasCopy: !!copiedPoint,
        onPlace: () => { activateTool(); openNewPopup(e.latlng, layerId); },
        onPaste: () => pasteAt(e.latlng),
        onStreetView: () => _openStreetView(e.latlng.lat, e.latlng.lng),
      });
    });

    document.addEventListener('keydown', _handleKey);
    // Start with parcel identify on, place mode off
    map.getContainer().style.cursor = 'default';
  }

  // ── DRAW TOOL STATE (called by Annotations) ───────────────────────────────────
  function getMarkerClickHandler() { return _onMarkerClick; }

  function setDrawToolActive(val) {
    drawToolActive = val;
    if (!val && !svMode) {
      if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(!placeMode);
      mapRef.getContainer().style.cursor = placeMode ? 'crosshair' : 'default';
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
      if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(false);
      mapRef.getContainer().style.cursor = 'crosshair';
    } else {
      if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(!placeMode);
      mapRef.getContainer().style.cursor = placeMode ? 'crosshair' : 'default';
    }
  }

  // ── POINT TOOL (Nearmap-style — just another tool) ───────────────────────────
  function activateTool() {
    // If already active, deactivate (toggle off)
    if (placeMode) { deactivateTool(); return; }
    // Deactivate any active draw tool first
    if (typeof Annotations !== 'undefined') Annotations.clearTool();
    placeMode = true;
    const btn = document.getElementById('tool-point');
    if (btn) btn.classList.add('active');
    document.getElementById('map').classList.add('place-mode');
    if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(false);
    map.getContainer().style.cursor = 'crosshair';
    // Show mobile cancel bar
    const bar = document.getElementById('mobile-cancel-bar');
    if (bar) bar.classList.add('show');
  }

  function deactivateTool() {
    placeMode = false;
    const btn = document.getElementById('tool-point');
    if (btn) btn.classList.remove('active');
    document.getElementById('map').classList.remove('place-mode');
    if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(true);
    mapRef.getContainer().style.cursor = 'default';
    const bar = document.getElementById('mobile-cancel-bar');
    if (bar) bar.classList.remove('show');
  }

  // Keep these for backward compat with other modules
  function isPlaceMode()     { return placeMode; }
  function togglePlaceMode() { placeMode ? deactivateTool() : activateTool(); }
  function setPlaceMode(val) { val ? activateTool() : deactivateTool(); }

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

    // Photo thumbnail (lazy-loaded)
    let photoHtml = '';
    const hasPhotoLocal = pt.photo && pt.photo.length > 20;

    div.innerHTML = `
      <h3>${_swatchHtml(def,12)}${_esc(pt.name||'Unnamed')}</h3>
      <div class="meta">${_esc(def.name)}</div>
      ${pt.notes ? `<div class="notes">${_esc(pt.notes)}</div>` : ''}
      <div id="popup-photo-wrap" class="popup-photo-wrap" style="display:none"></div>
      <div class="attr-row"><span class="attr-key">Added by</span><span class="attr-val">${addedBy}</span></div>
      <div class="attr-row"><span class="attr-key">Edited by</span><span class="attr-val">${editedBy}</span></div>
      <div class="popup-btns" style="margin-top:9px">
        <button class="edit-btn" onclick="Points.openEditPopup('${layerId}','${pt.id}')">✎ Edit</button>
        <button class="sv-popup-btn" onclick="Points.streetViewAt(${pt.lat},${pt.lng})">📷 Street View</button>
      </div>
    `;
    marker.bindPopup(div, { maxWidth:300 }).openPopup();
    marker.on('popupclose', deselect);

    // Lazy-load photo
    if (hasPhotoLocal) {
      _showPhotoInPopup(div, pt.photo);
    } else {
      Sync.loadPhoto(pt.id).then(photoData => {
        if (photoData) _showPhotoInPopup(div, photoData);
      });
    }
  }

  function _showPhotoInPopup(div, photoData) {
    const wrap = div.querySelector('#popup-photo-wrap');
    if (!wrap || !photoData) return;
    wrap.style.display = 'block';
    wrap.innerHTML = `<img src="${photoData}" class="popup-photo-img" onclick="Points._openPhotoFull(this.src)" title="Click to enlarge"/>`;
  }

  function _openPhotoFull(src) {
    const overlay = document.createElement('div');
    overlay.className = 'photo-fullscreen';
    overlay.innerHTML = `<img src="${src}"/><div class="photo-close" onclick="this.parentElement.remove()">✕</div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
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

    // Build layer options HTML for custom dropdown
    const layerOpts = Layers.getOrder().filter(id => Layers.getDef(id)).map(id => {
      const d = Layers.getDef(id);
      const br = d.shape === 'circle' ? '50%' : '2px';
      return `<div class="ef-dd-opt${d.id === layerId ? ' selected' : ''}" data-id="${d.id}" style="display:flex;align-items:center;gap:7px;padding:5px 8px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--border);">
        <span style="width:11px;height:11px;border-radius:${br};background:${d.color};border:1.5px solid rgba(255,255,255,0.2);flex-shrink:0;display:inline-block;"></span>
        <span>${_esc(d.name)}</span>
      </div>`;
    }).join('');

    div.innerHTML = `
      <h3>${_swatchHtml(def,13,'ef-swatch')} ${isNew?'New Point':'Edit Point'}</h3>
      <label>Layer</label>
      <div class="ef-layer-wrap" style="position:relative;margin-bottom:6px;">
        <div id="ef-layer-btn" style="display:flex;align-items:center;gap:7px;padding:5px 7px;background:var(--bg);border:1px solid var(--border2);border-radius:var(--radius);cursor:pointer;font-size:11px;">
          <span id="ef-layer-swatch" style="width:11px;height:11px;border-radius:${def&&def.shape==='circle'?'50%':'2px'};background:${def?def.color:'#888'};border:1.5px solid rgba(255,255,255,0.2);flex-shrink:0;display:inline-block;"></span>
          <span id="ef-layer-label" style="flex:1">${def?_esc(def.name):'Select layer'}</span>
          <span style="color:var(--muted2);font-size:9px;">▾</span>
        </div>
        <div id="ef-layer-list" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 2px);z-index:9999;background:var(--panel);border:1px solid var(--border2);border-radius:var(--radius);max-height:180px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.5);">
          ${layerOpts}
        </div>
        <input type="hidden" id="ef-layer" value="${layerId}"/>
      </div>
      <label>Name / Label</label>
      <input id="ef-name" type="text" value="${_esc(pt.name||'')}" placeholder="Address or label"/>
      <label>Notes</label>
      <textarea id="ef-notes" placeholder="Optional notes…">${_esc(pt.notes||'')}</textarea>
      <label>Photo</label>
      <div class="ef-photo-row">
        <input type="file" id="ef-photo-input" accept="image/*" capture="environment" style="display:none" onchange="Points._handlePhotoSelect(this)"/>
        <button type="button" class="btn-photo-upload" onclick="document.getElementById('ef-photo-input').click()">📷 ${pt.photo ? 'Replace' : 'Add'} Photo</button>
        <span id="ef-photo-status" class="ef-photo-status">${pt.photo ? '✓ Has photo' : ''}</span>
        ${pt.photo ? '<button type="button" class="btn-photo-remove" onclick="Points._removePhoto()">✕</button>' : ''}
      </div>
      <div id="ef-photo-preview" class="ef-photo-preview">${pt.photo ? `<img src="${pt.photo}"/>` : ''}</div>
      <input type="hidden" id="ef-photo-data" value="__KEEP__"/>
      <div class="popup-btns">
        <button class="btn-save">Save</button>
        ${!isNew?'<button class="btn-delete">Delete</button>':''}
        <button class="btn-cancel">Cancel</button>
      </div>
    `;

    // Wire up custom dropdown
    const btn  = div.querySelector('#ef-layer-btn');
    const list = div.querySelector('#ef-layer-list');
    const hiddenInput = div.querySelector('#ef-layer');
    btn.addEventListener('click', e => { e.stopPropagation(); list.style.display = list.style.display === 'none' ? 'block' : 'none'; });
    div.querySelectorAll('.ef-dd-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const id = opt.dataset.id;
        const d  = Layers.getDef(id);
        hiddenInput.value = id;
        div.querySelector('#ef-layer-label').textContent = d.name;
        div.querySelector('#ef-layer-swatch').style.background = d.color;
        div.querySelector('#ef-layer-swatch').style.borderRadius = d.shape === 'circle' ? '50%' : '2px';
        const sw = div.querySelector('#ef-swatch');
        if (sw) { sw.style.background = d.color; sw.style.borderRadius = d.shape === 'circle' ? '50%' : '2px'; }
        list.style.display = 'none';
      });
    });
    // Close dropdown on click outside — use popup container not document to avoid eating map clicks
    div.addEventListener('click', e => { if (!e.target.closest('#ef-layer-btn') && !e.target.closest('#ef-layer-list')) list.style.display = 'none'; });

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
    const photo = _getPhotoValue();
    if (photo !== undefined) pt.photo = photo;
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
    const photoVal = _getPhotoValue();
    const updates = { name, notes, editedBy:user, editedAt:now };
    if (photoVal !== undefined) updates.photo = photoVal;
    Layers.movePoint(origLayerId, newLayerId, ptId, updates);
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
    if (e.key==='Escape') {
      if (placeMode) { deactivateTool(); return; }
      setSVMode(false);
      if(typeof Annotations!=='undefined') Annotations.clearTool();
    }
    if (e.key==='Delete' && selectedPoint) {
      if (confirm('Delete selected point?')) deletePoint(selectedPoint.layerId, selectedPoint.ptId);
    }
  }

  function renderAll() { Layers.renderAll(selectedPoint, _onMarkerClick); }

  function _swatchHtml(def, size, id='') {
    if (!def) return '';
    return `<span ${id?`id="${id}"`:''} style="display:inline-block;width:${size}px;height:${size}px;background:${def.color};border-radius:${def.shape==='circle'?'50%':'2px'};border:1.5px solid rgba(255,255,255,0.22);flex-shrink:0;vertical-align:middle;margin-right:5px;"></span>`;
  }

  // ── PHOTO HANDLING ─────────────────────────────────────────────────────────
  function _handlePhotoSelect(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        const photoEl = document.getElementById('ef-photo-data');
        if (photoEl) photoEl.value = dataUrl;
        const preview = document.getElementById('ef-photo-preview');
        if (preview) preview.innerHTML = `<img src="${dataUrl}"/>`;
        const status = document.getElementById('ef-photo-status');
        if (status) status.textContent = '✓ Photo ready';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function _removePhoto() {
    const photoEl = document.getElementById('ef-photo-data');
    if (photoEl) photoEl.value = '';
    const preview = document.getElementById('ef-photo-preview');
    if (preview) preview.innerHTML = '';
    const status = document.getElementById('ef-photo-status');
    if (status) status.textContent = 'Photo removed';
  }

  function _getPhotoValue() {
    const el = document.getElementById('ef-photo-data');
    if (!el) return undefined;
    if (el.value === '__KEEP__') return undefined; // don't change
    return el.value || ''; // '' means remove, dataUrl means new photo
  }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return {
    init, setDrawToolActive, isDrawToolActive,
    activateTool, deactivateTool, togglePlaceMode, setPlaceMode, isPlaceMode, setSVMode,
    select, deselect, getSelected, getCopied,
    openEditPopup, openNewPopup, streetViewAt,
    deletePoint, copySelected, pasteAt, pasteAtCenter,
    renderAll, getMarkerClickHandler,
    _handlePhotoSelect: _handlePhotoSelect, _removePhoto: _removePhoto, _openPhotoFull: _openPhotoFull,
  };
})();
