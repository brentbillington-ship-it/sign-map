// ─────────────────────────────────────────────────────────────────────────────
// annotations.js — v3.1c — Drawing with color/thickness/label options
// ─────────────────────────────────────────────────────────────────────────────

const Annotations = (() => {
  let mapRef        = null;
  let activeTool    = null;
  let drawPoints    = [];
  let drawLayer     = null;
  let annotations   = [];
  let leafletAnns   = {};
  let mapLayerGroup = null;
  let onSave        = null;

  // Draw options (set via the options bar)
  let drawColor     = '#4da6ff';
  let drawThickness = 2;
  let drawLabel     = '';

  function init(map, onSaveCallback) {
    mapRef  = map;
    onSave  = onSaveCallback;
    mapLayerGroup = L.layerGroup().addTo(mapRef);  // FIXED: mapRef not map
    map.on('click',    _onMapClick);
    map.on('mousemove', _onMouseMove);
    map.on('dblclick', _onDblClick);
  }

  function loadFromSheets(data) {
    annotations = data || [];
    mapLayerGroup.clearLayers();
    leafletAnns  = {};
    annotations.forEach(_renderAnnotation);
  }

  // ── DRAW OPTIONS ─────────────────────────────────────────────────────────────
  function setDrawColor(c)     { drawColor = c; }
  function setDrawThickness(t) { drawThickness = Number(t); }
  function setDrawLabel(l)     { drawLabel = l; }

  // ── TOOL SELECTION ───────────────────────────────────────────────────────────
  function setTool(tool) {
    if (activeTool === tool) { clearTool(); return; }
    clearTool();
    activeTool = tool;
    drawPoints = [];
    document.querySelectorAll('.toolbar-btn[data-tool]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`tool-${tool}`);
    if (btn) btn.classList.add('active');

    // Show options bar and status hint
    _showOptionsBar(tool);
    _setStatusHint(tool);

    // Disable place mode
    if (typeof Points !== 'undefined') Points.setPlaceMode(false);
    mapRef.getContainer().style.cursor = tool === 'erase' ? 'not-allowed' : 'crosshair';
  }

  function clearTool() {
    activeTool = null;
    drawPoints = [];
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer = null; }
    document.querySelectorAll('.toolbar-btn[data-tool]').forEach(b => b.classList.remove('active'));
    mapRef.getContainer().style.cursor = '';
    _hideOptionsBar();
    _setStatusHint(null);
  }

  function getActiveTool() { return activeTool; }

  function _showOptionsBar(tool) {
    const bar = document.getElementById('draw-options-bar');
    if (!bar) return;
    const showLabel = tool !== 'erase';
    bar.style.display = showLabel ? 'flex' : 'none';
    // Update color swatch preview
    const colorInput = document.getElementById('draw-color-input');
    if (colorInput) colorInput.value = drawColor;
  }

  function _hideOptionsBar() {
    const bar = document.getElementById('draw-options-bar');
    if (bar) bar.style.display = 'none';
  }

  function _setStatusHint(tool) {
    const hints = {
      line:    'Click to add points · Double-click to finish · Esc to cancel',
      shape:   'Click to draw shape · Double-click to close · Esc to cancel',
      text:    'Click map to place text annotation',
      measure: 'Click to measure · Double-click to finish and show distance',
      erase:   'Click any annotation to delete it · Esc to cancel',
    };
    const el = document.getElementById('toolbar-hint');
    if (el) { el.textContent = tool ? hints[tool]||'' : ''; el.style.display = tool ? 'block' : 'none'; }
  }

  // ── MAP EVENTS ───────────────────────────────────────────────────────────────
  function _onMapClick(e) {
    if (!activeTool) return;
    L.DomEvent.stopPropagation(e);
    if (activeTool === 'text')  { _placeText(e.latlng); return; }
    if (activeTool === 'erase') return;
    drawPoints.push(e.latlng);
    _updatePreview(null);
  }

  function _onMouseMove(e) {
    if (!activeTool || !drawPoints.length) return;
    if (!['line','shape','measure'].includes(activeTool)) return;
    _updatePreview(e.latlng);
  }

  function _onDblClick(e) {
    if (!activeTool) return;
    L.DomEvent.stopPropagation(e);
    // Remove the last point (it was added by the click before dblclick)
    if (drawPoints.length > 1) drawPoints.pop();
    if (activeTool === 'line')    _finishLine();
    if (activeTool === 'shape')   _finishShape();
    if (activeTool === 'measure') _finishMeasure();
  }

  function _updatePreview(cursor) {
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer = null; }
    const pts = cursor ? [...drawPoints, cursor] : drawPoints;
    if (pts.length < 2) return;
    const style = { color: drawColor, weight: drawThickness, dashArray: '5,4', opacity: 0.8 };
    if (activeTool === 'shape' && pts.length >= 3) {
      drawLayer = L.polygon(pts, { ...style, fillColor: drawColor, fillOpacity: 0.1 }).addTo(mapRef);
    } else {
      drawLayer = L.polyline(pts, style).addTo(mapRef);
    }
  }

  function _finishLine() {
    if (drawPoints.length < 2) { clearTool(); return; }
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer = null; }
    const geojson = { type:'LineString', coordinates: drawPoints.map(p=>[p.lng,p.lat]) };
    _saveAnnotation('line', geojson, { color:drawColor, weight:drawThickness }, drawLabel);
    clearTool();
  }

  function _finishShape() {
    if (drawPoints.length < 3) { clearTool(); return; }
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer = null; }
    const coords = [...drawPoints, drawPoints[0]].map(p=>[p.lng,p.lat]);
    _saveAnnotation('shape', { type:'Polygon', coordinates:[coords] },
      { color:drawColor, fillColor:drawColor, fillOpacity:0.15, weight:drawThickness }, drawLabel);
    clearTool();
  }

  function _finishMeasure() {
    if (drawPoints.length < 2) { clearTool(); return; }
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer = null; }
    let totalM = 0;
    for (let i=1; i<drawPoints.length; i++) totalM += drawPoints[i-1].distanceTo(drawPoints[i]);
    const ft = totalM * 3.28084;
    const mi = totalM / 1609.34;
    const label = drawLabel || (mi >= 0.1 ? `${mi.toFixed(2)} mi (${Math.round(ft).toLocaleString()} ft)` : `${Math.round(ft).toLocaleString()} ft`);
    _saveAnnotation('measure', { type:'LineString', coordinates: drawPoints.map(p=>[p.lng,p.lat]) },
      { color: drawColor||'#f5d76e', weight: drawThickness, dashArray:'6,4' }, label);
    clearTool();
  }

  function _placeText(latlng) {
    const text = drawLabel || prompt('Enter annotation text:');
    if (!text) return;
    _saveAnnotation('text', { type:'Point', coordinates:[latlng.lng,latlng.lat] }, { color: drawColor }, text);
    clearTool();
  }

  // ── RENDER ────────────────────────────────────────────────────────────────────
  function _renderAnnotation(ann) {
    let lyr;
    const g = ann.geojson;
    const s = ann.style || {};

    if (ann.type === 'text') {
      const [lng,lat] = g.coordinates;
      lyr = L.marker([lat,lng], {
        icon: L.divIcon({ html:`<div class="ann-text" style="color:${s.color||'#fff'}">${_esc(ann.label)}</div>`, className:'', iconAnchor:[0,0] }),
      });
    } else if (ann.type === 'shape') {
      const coords = g.coordinates[0].map(c=>[c[1],c[0]]);
      lyr = L.polygon(coords, { color:s.color||'#68949E', fillColor:s.fillColor||s.color||'#68949E', fillOpacity:s.fillOpacity??0.15, weight:s.weight??2 });
    } else {
      const coords = g.coordinates.map(c=>[c[1],c[0]]);
      lyr = L.polyline(coords, { color:s.color||'#4da6ff', weight:s.weight??2, dashArray:s.dashArray||'' });
      if (ann.label) {
        const mid = coords[Math.floor(coords.length/2)];
        const lblLyr = L.marker(mid, {
          icon: L.divIcon({ html:`<div class="measure-label">${_esc(ann.label)}</div>`, className:'', iconAnchor:[0,12] }),
          interactive:false,
        });
        mapLayerGroup.addLayer(lblLyr);
      }
    }

    lyr.on('click', e => {
      if (activeTool === 'erase') { L.DomEvent.stopPropagation(e); _eraseAnnotation(ann.id); return; }
      L.DomEvent.stopPropagation(e);
      const latlng = e.latlng || (lyr.getLatLng ? lyr.getLatLng() : lyr.getBounds().getCenter());
      L.popup({ maxWidth:220 }).setLatLng(latlng).setContent(`
        <div style="font-family:'DM Mono',monospace;font-size:11px;color:#e6edf3">
          <div style="font-weight:600;margin-bottom:5px;text-transform:capitalize">${_esc(ann.type)}${ann.label?' — '+_esc(ann.label):''}</div>
          ${ann.creator?`<div style="color:#8b949e;font-size:10px;margin-bottom:8px">by ${_esc(ann.creator)}</div>`:''}
          <button class="btn-delete" style="width:100%" onclick="Annotations.erase('${ann.id}');window.map&&window.map.closePopup()">🗑 Delete</button>
        </div>
      `).openOn(mapRef);
    });

    mapLayerGroup.addLayer(lyr);
    leafletAnns[ann.id] = lyr;
  }

  function _eraseAnnotation(id) {
    annotations = annotations.filter(a => a.id !== id);
    if (leafletAnns[id]) { mapLayerGroup.removeLayer(leafletAnns[id]); delete leafletAnns[id]; }
    onSave(annotations);
    if (typeof UI !== 'undefined') UI.toast('Annotation deleted');
  }

  function erase(id) { _eraseAnnotation(id); }

  function _saveAnnotation(type, geojson, style, label) {
    const ann = {
      id: 'ann_' + Date.now(), type, geojson, style, label,
      creator: typeof Presence !== 'undefined' ? Presence.getCurrentUser() : '',
      ts: Date.now(),
    };
    annotations.push(ann);
    _renderAnnotation(ann);
    onSave(annotations);
    if (typeof UI !== 'undefined') UI.toast(`${type.charAt(0).toUpperCase()+type.slice(1)} added`);
  }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { init, loadFromSheets, setTool, clearTool, getActiveTool, erase, setDrawColor, setDrawThickness, setDrawLabel };
})();
