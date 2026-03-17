// ─────────────────────────────────────────────────────────────────────────────
// Chaka Signs Map — Google Apps Script Backend v3.3
// Deploy: Web App → Execute as Me → Anyone can access
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_ID          = '1aBfll1stuWNXGD9Ez9vQnJ_uiJOt6zoVc-iNOjnE2nw';
const POINTS_SHEET      = 'Points';
const PRESENCE_SHEET    = 'Presence';
const ANNOTATIONS_SHEET = 'Annotations';

// Column order in Points sheet
const COLS = ['id','layerId','lat','lng','name','notes','addedBy','addedAt','editedBy','editedAt','photo'];

function doGet(e) {
  const params = e.parameter;
  let result;
  try {
    if (params.action === 'load') {
      result = loadAll();
    } else if (params.action === 'presence') {
      result = loadPresence();
    } else if (params.payload) {
      const payload = JSON.parse(decodeURIComponent(params.payload));
      const a = payload.action;
      if      (a === 'addPoint')    result = savePoint(payload.layerId, payload.point);
      else if (a === 'updatePoint') result = savePoint(payload.layerId, payload.point);
      else if (a === 'savePoint')   result = savePoint(payload.layerId, payload.point);
      else if (a === 'deletePoint') result = deletePoint(payload.layerId, payload.ptId);
      else if (a === 'saveLayer')   result = saveLayer(payload.layerId, payload.points, payload.append);
      else if (a === 'heartbeat')   result = saveHeartbeat(payload.sessionId, payload.name, payload.ts);
      else if (a === 'saveAnnotations') result = saveAnnotations(payload.annotations);
      else if (a === 'getPhoto')  result = getPhoto(payload.ptId);
      // Legacy full-save fallback (small datasets only)
      else if (a === 'save')        result = saveAllPoints(payload.points);
      else result = { error: 'Unknown action: ' + a };
    } else {
      result = { error: 'No action' };
    }
  } catch(err) {
    result = { error: err.toString() };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── LOAD ──────────────────────────────────────────────────────────────────────
function loadAll() {
  return {
    points:      loadPoints(),
    annotations: loadAnnotations(),
  };
}

function loadPoints() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(POINTS_SHEET);
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  const hdr = data[0].map(h => String(h).trim());
  const points = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    hdr.forEach((h, j) => { obj[h] = String(row[j]||''); });
    const { id, layerId, lat, lng } = obj;
    if (!id || !layerId || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) continue;
    if (!points[layerId]) points[layerId] = [];
    // Strip photo from main load to keep payload small
    const pt = { ...obj, lat: parseFloat(lat), lng: parseFloat(lng) };
    delete pt.photo;
    points[layerId].push(pt);
  }
  return points;
}

// ── GET PHOTO FOR A SINGLE POINT ────────────────────────────────────────────
function getPhoto(ptId) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(POINTS_SHEET);
  if (!sheet) return { photo: '' };
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { photo: '' };
  const hdr = data[0].map(h => String(h).trim());
  const photoIdx = hdr.indexOf('photo');
  if (photoIdx < 0) return { photo: '' };
  const idIdx = hdr.indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(ptId)) {
      return { photo: String(data[i][photoIdx] || '') };
    }
  }
  return { photo: '' };
}

// ── DELTA SAVES ───────────────────────────────────────────────────────────────
function _getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(POINTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(POINTS_SHEET);
    sheet.appendRow(COLS);
  }
  // Ensure header row exists
  const first = sheet.getRange(1,1,1,1).getValue();
  if (first !== 'id') sheet.insertRowBefore(1).getRange(1,1,1,COLS.length).setValues([COLS]);
  return sheet;
}

function _pointToRow(pt) {
  return COLS.map(k => k === 'lat' || k === 'lng' ? Number(pt[k]||0) : String(pt[k]||''));
}

function addPoint(layerId, pt) {
  const sheet = _getSheet();
  // Check if id already exists (avoid duplicates)
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(pt.id)) {
      // Already exists — update instead
      return updatePoint(layerId, pt);
    }
  }
  const row = _pointToRow({ ...pt, layerId });
  sheet.appendRow(row);
  return { ok: true, action: 'added' };
}

function updatePoint(layerId, pt) {
  const sheet = _getSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(pt.id)) {
      const row = _pointToRow({ ...pt, layerId });
      sheet.getRange(i+1, 1, 1, COLS.length).setValues([row]);
      return { ok: true, action: 'updated', row: i+1 };
    }
  }
  // Not found — add it
  return addPoint(layerId, pt);
}

function deletePoint(layerId, ptId) {
  const sheet = _getSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(ptId)) {
      sheet.deleteRow(i+1);
      return { ok: true, action: 'deleted' };
    }
  }
  return { ok: true, action: 'not_found' };
}

// ── LEGACY FULL SAVE (fallback for small datasets) ────────────────────────────
function savePoint(layerId, pt) {
  const sheet = _getSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(pt.id)) {
      const row = _pointToRow({...pt, layerId});
      sheet.getRange(i+1, 1, 1, COLS.length).setValues([row]);
      return { ok:true, action:'updated' };
    }
  }
  sheet.appendRow(_pointToRow({...pt, layerId}));
  return { ok:true, action:'added' };
}

function saveLayer(layerId, pts, append) {
  const sheet = _getSheet();
  if (!append) {
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][1]) === String(layerId)) sheet.deleteRow(i+1);
    }
  }
  if (pts && pts.length) {
    const rows = pts.map(pt => _pointToRow({...pt, layerId}));
    const lastRow = sheet.getLastRow() || 1;
    sheet.getRange(lastRow+1, 1, rows.length, COLS.length).setValues(rows);
  }
  return { ok:true, count: pts ? pts.length : 0 };
}

// ── ANNOTATIONS ───────────────────────────────────────────────────────────────
function saveAllPoints(points) {
  let total = 0;
  Object.entries(points||{}).forEach(([layerId, pts]) => {
    saveLayer(layerId, pts, false);
    total += (pts||[]).length;
  });
  return { success:true, count:total };
}

function loadAnnotations() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(ANNOTATIONS_SHEET);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const anns = [];
  for (let i = 1; i < data.length; i++) {
    const [id, type, geojson, style, label, creator, ts] = data[i];
    if (!id) continue;
    try {
      anns.push({ id:String(id), type:String(type), geojson:JSON.parse(geojson),
        style:JSON.parse(style||'{}'), label:String(label||''),
        creator:String(creator||''), ts:Number(ts||0) });
    } catch(e) {}
  }
  return anns;
}

function saveAnnotations(annotations) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName(ANNOTATIONS_SHEET) || ss.insertSheet(ANNOTATIONS_SHEET);
  sheet.clearContents();
  sheet.appendRow(['id','type','geojson','style','label','creator','ts']);
  const rows = (annotations||[]).map(a => [
    String(a.id), String(a.type), JSON.stringify(a.geojson),
    JSON.stringify(a.style||{}), String(a.label||''),
    String(a.creator||''), Number(a.ts||0)
  ]);
  if (rows.length) sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  return { ok: true, count: rows.length };
}

// ── DAILY BACKUP ──────────────────────────────────────────────────────────────
// To activate: In Apps Script editor → Triggers (clock icon) → Add Trigger
//   Function: createDailyBackup | Event: Time-driven | Timer: Day timer | Time: 2am-3am
function createDailyBackup() {
  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const source   = ss.getSheetByName(POINTS_SHEET);
  if (!source) return;
  const dateStr  = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd');
  const backupName = `Backup_${dateStr}`;
  // Don't duplicate if already ran today
  if (ss.getSheetByName(backupName)) return;
  // Copy the sheet
  const copy = source.copyTo(ss);
  copy.setName(backupName);
  ss.setActiveSheet(copy);
  ss.moveActiveSheet(ss.getNumSheets());
  // Prune backups older than 7 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  ss.getSheets().forEach(sheet => {
    const n = sheet.getName();
    if (!n.startsWith('Backup_')) return;
    const d = new Date(n.replace('Backup_',''));
    if (!isNaN(d) && d < cutoff) ss.deleteSheet(sheet);
  });
}
function loadPresence() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(PRESENCE_SHEET);
  if (!sheet) return {};
  const data    = sheet.getDataRange().getValues();
  const cutoff  = Date.now() - 60000;
  const presence = {};
  for (let i = 1; i < data.length; i++) {
    const [sid, name, ts] = data[i];
    if (!sid || Number(ts) < cutoff) continue;
    presence[String(sid)] = { name:String(name), ts:Number(ts) };
  }
  return presence;
}

function saveHeartbeat(sessionId, name, ts) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName(PRESENCE_SHEET);
  if (!sheet) { sheet = ss.insertSheet(PRESENCE_SHEET); sheet.appendRow(['sessionId','name','ts']); }
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(sessionId)) {
      sheet.getRange(i+1, 2, 1, 2).setValues([[name, ts]]);
      return { ok: true };
    }
  }
  // First time we've seen this session — log it as a login event
  _logLogin(ss, sessionId, name, ts);
  sheet.appendRow([String(sessionId), name, ts]);
  // Prune stale rows
  const d2 = sheet.getDataRange().getValues();
  const cutoff = Date.now() - 120000;
  for (let i = d2.length - 1; i >= 1; i--) {
    if (Number(d2[i][2]) < cutoff) sheet.deleteRow(i+1);
  }
  return { ok: true };
}

function _logLogin(ss, sessionId, name, ts) {
  const LOGIN_SHEET = 'Login Log';
  let sheet = ss.getSheetByName(LOGIN_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOGIN_SHEET);
    sheet.appendRow(['sessionId', 'name', 'timestamp', 'date']);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,4).setFontWeight('bold');
  }
  const date = Utilities.formatDate(new Date(ts), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([String(sessionId), String(name), Number(ts), date]);
}
