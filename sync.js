// ─────────────────────────────────────────────────────────────────────────────
// sync.js — Google Sheets sync: points, annotations, presence
// ─────────────────────────────────────────────────────────────────────────────

const Sync = (() => {
  let lastHash = '';

  async function loadAll(onUpdate) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const res  = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=load`);
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

  async function savePoints(allPoints) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const payload = JSON.stringify({ action:'save', points:allPoints });
      await fetch(`${CONFIG.APPS_SCRIPT_URL}?payload=${encodeURIComponent(payload)}`);
    } catch(e) { console.warn('Sync save failed:', e); }
  }

  async function saveAnnotations(annotations) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const payload = JSON.stringify({ action:'saveAnnotations', annotations });
      await fetch(`${CONFIG.APPS_SCRIPT_URL}?payload=${encodeURIComponent(payload)}`);
    } catch(e) { console.warn('Annotation save failed:', e); }
  }

  async function sendHeartbeat(sessionId, name) {
    if (!CONFIG.APPS_SCRIPT_URL || !name) return;
    try {
      const payload = JSON.stringify({ action:'heartbeat', sessionId, name, ts:Date.now() });
      await fetch(`${CONFIG.APPS_SCRIPT_URL}?payload=${encodeURIComponent(payload)}`);
    } catch(e) {}
  }

  async function loadPresence(onUpdate) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const res  = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=presence`);
      const data = await res.json();
      onUpdate(data.presence || {});
    } catch(e) {}
  }

  function startPresence(sessionId, getName, onPresenceUpdate) {
    sendHeartbeat(sessionId, getName());
    if (!CONFIG.APPS_SCRIPT_URL) return;
    setInterval(() => sendHeartbeat(sessionId, getName()), CONFIG.PRESENCE_INTERVAL);
    setInterval(() => loadPresence(onPresenceUpdate), CONFIG.PRESENCE_INTERVAL);
  }

  return { loadAll, startRefresh, savePoints, saveAnnotations, sendHeartbeat, startPresence };
})();
