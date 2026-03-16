// ─────────────────────────────────────────────────────────────────────────────
// annotations.js — Drawing toolbar: Line, Shape, Text, Measure, Erase
// ─────────────────────────────────────────────────────────────────────────────

const Annotations = (() => {
  let mapRef      = null;
  let activeTool  = null;   // 'line' | 'shape' | 'text' | 'measure' | 'erase'
  let drawPoints  = [];     // in-progress click points
  let drawLayer   = null;   // in-progress preview layer
  let tempLine    = null;
  let annotations = [];     // [{id, type, geojson, style, label, creator, ts}]
  let leafletAnns = {};     // id -> Leaflet layer
  let onSave      = null;
  let mapLayerGroup = null;

  const COLORS = {
    line:    '#4da6ff',
    shape:   '#68949E',
    text:    '#ffffff',
    measure: '#f5d76e',
  };

  // ── INIT ────────────────────────────────────────────────────────────────────
  function init(map, onSaveCallback) {
    mapRef  = map;
    onSave  = onSaveCallback;
    mapLayerGroup = L.layerGroup().addTo(mapRef);

    map.on('click', _onMapClick);
    map.on('mousemove', _onMouseMove);
    map.on('dblclick', _onMapDblClick);
  }

  // ── LOAD FROM SHEETS ─────────────────────────────────────────────────────────
  function loadFromSheets(data) {
    annotations = data || [];
    mapLayerGroup.clearLayers();
    leafletAnns = {};
    annotations.forEach(_renderAnnotation);
  }

  // ── TOOL SELECTION ───────────────────────────────────────────────────────────
  function setTool(tool) {
    if (activeTool === tool) { clearTool(); return; }
    clearTool();
    activeTool = tool;
    drawPoints = [];
    document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`tool-${tool}`);
    if (btn) btn.classList.add('active');
    mapRef.getContainer().style.cursor = tool === 'erase' ? 'not-allowed' : 'crosshair';
    // Disable place mode while drawing
    if (typeof Points !== 'undefined') Points.setPlaceMode(false);
    const placeBtn = document.getElementById('place-btn');
    if (placeBtn) placeBtn.classList.remove('active');
  }

  function clearTool() {
    activeTool = null;
    drawPoints = [];
    if (drawLayer)  { mapRef.removeLayer(drawLayer); drawLayer=null; }
    if (tempLine)   { mapRef.removeLayer(tempLine);  tempLine=null; }
    document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
    mapRef.getContainer().style.cursor = '';
  }

  function getActiveTool() { return activeTool; }

  // ── MAP EVENTS ───────────────────────────────────────────────────────────────
  function _onMapClick(e) {
    if (!activeTool) return;
    L.DomEvent.stopPropagation(e);

    if (activeTool === 'text') { _placeText(e.latlng); return; }
    if (activeTool === 'erase') return;
    if (['line','shape','measure'].includes(activeTool)) {
      drawPoints.push(e.latlng);
      _updatePreview();
    }
  }

  function _onMouseMove(e) {
    if (!activeTool || !drawPoints.length) return;
    if (!['line','shape','measure'].includes(activeTool)) return;
    _updatePreviewWithCursor(e.latlng);
  }

  function _onMapDblClick(e) {
    if (!activeTool) return;
    L.DomEvent.stopPropagation(e);
    if (activeTool === 'line')    { _finishLine(); }
    if (activeTool === 'shape')   { _finishShape(); }
    if (activeTool === 'measure') { _finishMeasure(); }
  }

  // ── PREVIEW ──────────────────────────────────────────────────────────────────
  function _updatePreview() {
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer=null; }
    if (drawPoints.length < 2) return;
    const color = COLORS[activeTool] || '#fff';
    if (activeTool === 'shape' && drawPoints.length >= 3) {
      drawLayer = L.polygon(drawPoints, { color, fillColor:color, fillOpacity:0.15, weight:2, dashArray:'5,5' }).addTo(mapRef);
    } else {
      drawLayer = L.polyline(drawPoints, { color, weight:2, dashArray:'5,5' }).addTo(mapRef);
    }
  }

  function _updatePreviewWithCursor(cursor) {
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer=null; }
    const pts = [...drawPoints, cursor];
    if (pts.length < 2) return;
    const color = COLORS[activeTool] || '#fff';
    if (activeTool === 'shape' && pts.length >= 3) {
      drawLayer = L.polygon(pts, { color, fillColor:color, fillOpacity:0.1, weight:2, dashArray:'4,4' }).addTo(mapRef);
    } else {
      drawLayer = L.polyline(pts, { color, weight:2, dashArray:'4,4' }).addTo(mapRef);
    }
  }

  // ── FINISH LINE ───────────────────────────────────────────────────────────────
  function _finishLine() {
    if (drawPoints.length < 2) { clearTool(); return; }
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer=null; }
    const geojson = { type:'LineString', coordinates: drawPoints.map(p=>[p.lng,p.lat]) };
    _saveAnnotation('line', geojson, { color: COLORS.line, weight:2 }, '');
    clearTool();
  }

  // ── FINISH SHAPE ──────────────────────────────────────────────────────────────
  function _finishShape() {
    if (drawPoints.length < 3) { clearTool(); return; }
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer=null; }
    const coords = [...drawPoints, drawPoints[0]].map(p=>[p.lng,p.lat]);
    const geojson = { type:'Polygon', coordinates:[coords] };
    _saveAnnotation('shape', geojson, { color:COLORS.shape, fillColor:COLORS.shape, fillOpacity:0.15, weight:2 }, '');
    clearTool();
  }

  // ── FINISH MEASURE ────────────────────────────────────────────────────────────
  function _finishMeasure() {
    if (drawPoints.length < 2) { clearTool(); return; }
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer=null; }

    let totalM = 0;
    for (let i=1; i<drawPoints.length; i++) totalM += drawPoints[i-1].distanceTo(drawPoints[i]);
    const totalFt  = totalM * 3.28084;
    const totalMi  = totalM / 1609.34;
    const label = totalMi >= 0.1
      ? `${totalMi.toFixed(2)} mi (${Math.round(totalFt).toLocaleString()} ft)`
      : `${Math.round(totalFt)} ft`;

    const geojson = { type:'LineString', coordinates: drawPoints.map(p=>[p.lng,p.lat]) };
    _saveAnnotation('measure', geojson, { color:COLORS.measure, weight:2, dashArray:'6,4' }, label);
    clearTool();
  }

  // ── PLACE TEXT ───────────────────────────────────────────────────────────────
  function _placeText(latlng) {
    const text = prompt('Enter annotation text:');
    if (!text) return;
    const geojson = { type:'Point', coordinates:[latlng.lng, latlng.lat] };
    _saveAnnotation('text', geojson, { color:COLORS.text }, text);
    clearTool();
  }

  // ── RENDER ANNOTATION ─────────────────────────────────────────────────────────
  function _renderAnnotation(ann) {
    let lyr;
    const g = ann.geojson;
    const s = ann.style || {};

    if (ann.type === 'text') {
      const [lng,lat] = g.coordinates;
      lyr = L.marker([lat,lng], {
        icon: L.divIcon({
          html: `<div class="ann-text">${_esc(ann.label)}</div>`,
          className:'', iconAnchor:[0,0],
        }),
      });
    } else if (ann.type === 'shape') {
      const coords = g.coordinates[0].map(c=>[c[1],c[0]]);
      lyr = L.polygon(coords, { color:s.color||'#68949E', fillColor:s.fillColor||s.color||'#68949E', fillOpacity:s.fillOpacity||0.15, weight:s.weight||2 });
    } else {
      // line or measure
      const coords = g.coordinates.map(c=>[c[1],c[0]]);
      lyr = L.polyline(coords, { color:s.color||'#4da6ff', weight:s.weight||2, dashArray:s.dashArray||'' });
      if (ann.label) {
        const mid = coords[Math.floor(coords.length/2)];
        const labelLyr = L.marker(mid, {
          icon: L.divIcon({ html:`<div class="measure-label">${_esc(ann.label)}</div>`, className:'', iconAnchor:[0,0] }),
          interactive:false,
        });
        mapLayerGroup.addLayer(labelLyr);
      }
    }

    lyr.on('click', e => {
      if (activeTool === 'erase') { L.DomEvent.stopPropagation(e); _eraseAnnotation(ann.id); return; }
      L.DomEvent.stopPropagation(e);
      _showAnnPopup(ann, e.latlng || e.target.getLatLng());
    });

    mapLayerGroup.addLayer(lyr);
    leafletAnns[ann.id] = lyr;
  }

  function _showAnnPopup(ann, latlng) {
    const creator = ann.creator ? `by ${_esc(ann.creator)}` : '';
    L.popup({ maxWidth:220 })
      .setLatLng(latlng)
      .setContent(`
        <div style="font-family:'DM Mono',monospace;font-size:11px;color:#e6edf3">
          <div style="font-weight:600;margin-bottom:6px;text-transform:capitalize">${_esc(ann.type)}${ann.label?' — '+_esc(ann.label):''}</div>
          ${creator?`<div style="color:#8b949e;margin-bottom:8px;font-size:10px">${creator}</div>`:''}
          <button class="btn-delete" onclick="Annotations.erase('${ann.id}');map.closePopup && map.closePopup()">🗑 Delete</button>
        </div>
      `)
      .openOn(mapRef);
  }

  function _eraseAnnotation(id) {
    annotations = annotations.filter(a => a.id !== id);
    if (leafletAnns[id]) { mapLayerGroup.removeLayer(leafletAnns[id]); delete leafletAnns[id]; }
    onSave(annotations);
    UI.toast('Annotation deleted');
  }

  function erase(id) { _eraseAnnotation(id); }

  // ── SAVE ─────────────────────────────────────────────────────────────────────
  function _saveAnnotation(type, geojson, style, label) {
    const ann = {
      id:      'ann_' + Date.now(),
      type, geojson, style, label,
      creator: typeof Presence !== 'undefined' ? Presence.getCurrentUser() : '',
      ts:      Date.now(),
    };
    annotations.push(ann);
    _renderAnnotation(ann);
    onSave(annotations);
    UI.toast(`${type.charAt(0).toUpperCase()+type.slice(1)} saved`);
  }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { init, loadFromSheets, setTool, clearTool, getActiveTool, erase };
})();
