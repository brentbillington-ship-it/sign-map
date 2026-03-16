// ─────────────────────────────────────────────────────────────────────────────
// sync.js — v3.1f — Delta saves (one point at a time), no payload size issues
// ─────────────────────────────────────────────────────────────────────────────

const Sync = (() => {
  let lastHash = '';

  // ── GET helper (all reads + small writes) ────────────────────────────────────
  async function _get(payload) {
    if (!CONFIG.APPS_SCRIPT_URL) return null;
    const encoded = encodeURIComponent(JSON.stringify(payload));
    try {
      const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?payload=${encoded}`, { redirect:'follow' });
      return await res.json();
    } catch(e) { console.warn('Sync GET failed:', payload.action, e); return null; }
  }

  // ── LOAD ─────────────────────────────────────────────────────────────────────
  async function loadAll(onUpdate) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const res  = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=load`, { redirect:'follow' });
      const data = await res.json();
      const hash = JSON.stringify(data);
      if (hash === lastHash) return;
      lastHash = hash;
      onUpdate(data);
    } catch(e) { console.warn('Sync load failed:', e); }
  }

  function startRefresh(onUpdate) {
    loadAll(onUpdate);
    setInterval(() => loadAll(onUpdate), CONFIG.REFRESH_INTERVAL);
  }

  // ── DELTA POINT SAVES (tiny payloads, always within GAS URL limit) ───────────
  async function addPoint(layerId, point) {
    return _get({ action:'addPoint', layerId, point });
  }

  async function updatePoint(layerId, point) {
    return _get({ action:'updatePoint', layerId, point });
  }

  async function deletePoint(layerId, ptId) {
    return _get({ action:'deletePoint', layerId, ptId });
  }

  // ── ANNOTATIONS (saved as full replace — usually small) ──────────────────────
  async function saveAnnotations(annotations) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    // Annotations are usually few — chunk if needed
    const payload = JSON.stringify({ action:'saveAnnotations', annotations });
    const encoded = encodeURIComponent(payload);
    if (encoded.length < 7000) {
      return _get({ action:'saveAnnotations', annotations });
    }
    // Too large — save empty and warn
    console.warn('Annotations payload too large, skipping save');
  }

  // ── PRESENCE ─────────────────────────────────────────────────────────────────
  async function sendHeartbeat(sessionId, name) {
    if (!CONFIG.APPS_SCRIPT_URL || !name) return;
    return _get({ action:'heartbeat', sessionId, name, ts:Date.now() });
  }

  async function loadPresence(onUpdate) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const res  = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=presence`, { redirect:'follow' });
      const data = await res.json();
      onUpdate(data.presence || data || {});
    } catch(e) {}
  }

  function startPresence(sessionId, getName, onPresenceUpdate) {
    sendHeartbeat(sessionId, getName());
    if (!CONFIG.APPS_SCRIPT_URL) return;
    setInterval(() => sendHeartbeat(sessionId, getName()), CONFIG.PRESENCE_INTERVAL);
    setInterval(() => loadPresence(onPresenceUpdate), CONFIG.PRESENCE_INTERVAL);
  }

  return {
    loadAll, startRefresh,
    addPoint, updatePoint, deletePoint,
    saveAnnotations, sendHeartbeat, startPresence,
  };
})();
