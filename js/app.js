/**
 * app.js — Gnoke GeoCompass
 * Bootstrap file. Runs after ALL other scripts are loaded.
 * Owns: DOMContentLoaded init, page routing, ALL event wiring.
 *
 * TYPE C — Tool / Converter: no database, compass logic in geo-compass.js
 */

document.addEventListener('DOMContentLoaded', () => {

  /* ── 1. Init shared modules ──────────────────────────────────── */
  Theme.init();
  UI.init();

  /* ── 2. Init compass engine ──────────────────────────────────── */
  Compass.init();

  /* ── 3. Init speedometer ─────────────────────────────────────── */
  Speedometer.init();

  /* ── 4. Populate About tech table ────────────────────────────── */
  renderAboutTech([
    ['Orientation', 'DeviceOrientation API'],
    ['Location',    'Geolocation API (GPS)'],
    ['Speed',       'Geolocation API (coords.speed)'],
    ['Geocoding',   'Nominatim / OpenStreetMap'],
    ['Distance',    'Haversine formula'],
    ['Maps',        'OpenStreetMap (search preview)'],
    ['Persistence', 'localStorage (theme, settings, odometer)'],
    ['Stack',       'HTML · CSS · Vanilla JS'],
    ['Version',     'v1.0'],
  ]);

  /* ── 5. Initial page ─────────────────────────────────────────── */
  loadPage('compass-page');


  /* ═══════════════════════════════════════════════════════════════
     PAGE ROUTING
  ═══════════════════════════════════════════════════════════════ */

  function loadPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(pageId);
    if (page) page.classList.add('active');
    State.set('activePage', pageId);
    // Clear context info on non-compass pages
    const ctx = document.getElementById('context-info');
    if (ctx && pageId !== 'compass-page') ctx.textContent = '';
  }


  /* ═══════════════════════════════════════════════════════════════
     MOBILE DRAWER
  ═══════════════════════════════════════════════════════════════ */

  const Drawer = (() => {
    const panel   = () => document.getElementById('drawer');
    const overlay = () => document.getElementById('drawer-overlay');

    function open()  { panel()?.classList.add('open');    overlay()?.classList.add('open'); }
    function close() { panel()?.classList.remove('open'); overlay()?.classList.remove('open'); }

    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.getElementById('hamburger')?.addEventListener('click', open);
    document.getElementById('drawer-close')?.addEventListener('click', close);
    document.getElementById('drawer-overlay')?.addEventListener('click', close);

    return { open, close };
  })();

  window.Drawer   = Drawer;
  window.loadPage = loadPage;


  /* ═══════════════════════════════════════════════════════════════
     COMPASS PAGE EVENTS
  ═══════════════════════════════════════════════════════════════ */

  /* Enable compass button */
  document.getElementById('btn-enable-compass')?.addEventListener('click', () => {
    Compass.enableOrientation();
  });


  /* ═══════════════════════════════════════════════════════════════
     NAVIGATE PAGE EVENTS
  ═══════════════════════════════════════════════════════════════ */

  /* Set destination from manual coordinate input */
  document.getElementById('btn-set-dest')?.addEventListener('click', () => {
    const latVal = document.getElementById('input-dest-lat')?.value;
    const lonVal = document.getElementById('input-dest-lon')?.value;
    const nameVal = document.getElementById('input-dest-name')?.value?.trim();

    const lat = parseFloat(latVal);
    const lon = parseFloat(lonVal);

    if (!isFinite(lat) || lat < -90  || lat > 90) {
      UI.toast('Invalid latitude (must be -90 to 90)', 'err');
      return;
    }
    if (!isFinite(lon) || lon < -180 || lon > 180) {
      UI.toast('Invalid longitude (must be -180 to 180)', 'err');
      return;
    }

    Compass.setDest(lat, lon, nameVal || 'Manual Entry');
    UI.toast('Destination set', 'ok');
    loadPage('compass-page');
  });

  /* Clear destination */
  document.getElementById('btn-clear-dest')?.addEventListener('click', () => {
    Compass.clearDest();
    // Also clear the input fields
    const latEl  = document.getElementById('input-dest-lat');
    const lonEl  = document.getElementById('input-dest-lon');
    const nameEl = document.getElementById('input-dest-name');
    if (latEl)  latEl.value  = '';
    if (lonEl)  lonEl.value  = '';
    if (nameEl) nameEl.value = '';
    UI.toast('Destination cleared', 'ok');
  });

  /* Preset location buttons */
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lat  = parseFloat(btn.dataset.lat);
      const lon  = parseFloat(btn.dataset.lon);
      const name = btn.dataset.name || btn.textContent.trim();
      Compass.setDest(lat, lon, name);
      UI.toast(`Destination: ${name}`, 'ok');
      loadPage('compass-page');
    });
  });

  /* Also allow Enter key in coordinate inputs */
  ['input-dest-lat', 'input-dest-lon', 'input-dest-name'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-set-dest')?.click();
    });
  });


  /* ═══════════════════════════════════════════════════════════════
     SEARCH PAGE EVENTS
  ═══════════════════════════════════════════════════════════════ */

  document.getElementById('btn-search')?.addEventListener('click', () => {
    const q = document.getElementById('input-search')?.value?.trim();
    Compass.searchLocation(q);
  });

  document.getElementById('input-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-search')?.click();
  });

});


/* ─────────────────────────────────────────────────────────────────
   renderAboutTech — populates the ⚙️ Under The Hood table.
──────────────────────────────────────────────────────────────────*/
function renderAboutTech(rows) {
  const tbody = document.getElementById('about-tech-table');
  if (!tbody) return;
  tbody.innerHTML = rows.map(([k, v]) => `
    <tr>
      <td>${k}</td>
      <td>${v}</td>
    </tr>`).join('');
}
