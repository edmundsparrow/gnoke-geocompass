/**
 * geo-compass.js — Gnoke GeoCompass
 * Core compass engine. TYPE C tool module.
 *
 * Owns:
 *   - SVG compass rose rendering and animation
 *   - DeviceOrientation API (heading tracking)
 *   - Geolocation API (GPS tracking)
 *   - Haversine distance + bearing math
 *   - Nominatim geocoding (city search)
 *   - All DOM updates for the compass page
 *
 * Public API:
 *   Compass.init()                     → mount SVG, start animation loop + GPS
 *   Compass.enableOrientation()        → request device orientation permission + start
 *   Compass.setDest(lat, lon, name)    → set destination, updates display
 *   Compass.clearDest()                → clear destination
 *   Compass.searchLocation(query)      → Nominatim search → populates search page
 *   Compass.selectResult(lat, lon, name) → pick a search result as destination
 *
 * Reads:  State.get()
 * Writes: State.set() for heading, gps*, dest*
 * Events: wired externally by app.js
 */

const Compass = (() => {

  /* ── Internal state ─────────────────────────────────────────── */
  let _targetHeading  = 0;   // raw heading from device sensor
  let _smoothHeading  = 0;   // smoothed/animated heading
  let _orientHandler  = null;
  let _watchId        = null;
  let _animFrame      = null;
  let _enabled        = false;

  /* ── Math helpers ───────────────────────────────────────────── */

  function _toRad(d) { return d * Math.PI / 180; }
  function _toDeg(r) { return r * 180 / Math.PI; }

  function haversine(lat1, lon1, lat2, lon2) {
    const R    = 6371e3;
    const dLat = _toRad(lat2 - lat1);
    const dLon = _toRad(lon2 - lon1);
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
                 Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin(_toRad(lon2 - lon1)) * Math.cos(_toRad(lat2));
    const x = Math.cos(_toRad(lat1)) * Math.sin(_toRad(lat2)) -
              Math.sin(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.cos(_toRad(lon2 - lon1));
    return (_toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function cardinalDir(deg) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                  'S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round((deg % 360) / 22.5) % 16];
  }

  function formatDist(m) {
    return m >= 1000
      ? `${(m / 1000).toFixed(2)} km`
      : `${Math.round(m)} m`;
  }

  /* ── SVG compass builder ────────────────────────────────────── */

  function _buildCompassSVG() {
    // Tick marks: every 5° (72 total), major every 10°
    let ticks = '';
    for (let i = 0; i < 72; i++) {
      const a     = i * 5;
      const major = a % 10 === 0;
      const rad   = (a - 90) * Math.PI / 180;
      const r1    = major ? 128 : 133;
      const r2    = 143;
      const x1    = (150 + r1 * Math.cos(rad)).toFixed(2);
      const y1    = (150 + r1 * Math.sin(rad)).toFixed(2);
      const x2    = (150 + r2 * Math.cos(rad)).toFixed(2);
      const y2    = (150 + r2 * Math.sin(rad)).toFixed(2);
      const col   = major ? '#c4a250' : 'rgba(196,162,80,0.4)';
      const sw    = major ? '1.5' : '0.8';
      ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}"/>`;
    }

    // Degree numbers at 30° intervals
    let degNums = '';
    for (let a = 0; a < 360; a += 30) {
      if ([0, 90, 180, 270].includes(a)) continue; // skip cardinal positions
      const rad = (a - 90) * Math.PI / 180;
      const r   = 114;
      const x   = (150 + r * Math.cos(rad)).toFixed(2);
      const y   = (150 + r * Math.sin(rad) + 3.5).toFixed(2);
      degNums += `<text x="${x}" y="${y}" text-anchor="middle" fill="rgba(196,162,80,0.55)" font-size="9" font-family="'DM Mono',monospace">${a}</text>`;
    }

    // Cardinal and intercardinal labels
    const labels = [
      { t: 'N',  a: 0,   c: '#e53e3e', s: 17, rOff: 0   },
      { t: 'NE', a: 45,  c: 'rgba(196,162,80,0.7)', s: 9,  rOff: 0 },
      { t: 'E',  a: 90,  c: '#c4a250', s: 15, rOff: 0   },
      { t: 'SE', a: 135, c: 'rgba(196,162,80,0.7)', s: 9,  rOff: 0 },
      { t: 'S',  a: 180, c: '#c4a250', s: 15, rOff: 0   },
      { t: 'SW', a: 225, c: 'rgba(196,162,80,0.7)', s: 9,  rOff: 0 },
      { t: 'W',  a: 270, c: '#c4a250', s: 15, rOff: 0   },
      { t: 'NW', a: 315, c: 'rgba(196,162,80,0.7)', s: 9,  rOff: 0 },
    ];
    let labelSVG = '';
    labels.forEach(({ t, a, c, s }) => {
      const rad = (a - 90) * Math.PI / 180;
      const r   = 96;
      const x   = (150 + r * Math.cos(rad)).toFixed(2);
      const y   = (150 + r * Math.sin(rad) + s * 0.36).toFixed(2);
      labelSVG += `<text x="${x}" y="${y}" text-anchor="middle" fill="${c}" font-size="${s}" font-family="'DM Mono',monospace" font-weight="bold">${t}</text>`;
    });

    return `
<svg id="compass-svg" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg"
     style="width:100%;height:100%;display:block;">
  <defs>
    <radialGradient id="gc-bg" cx="42%" cy="36%">
      <stop offset="0%"   stop-color="#1d4d6a"/>
      <stop offset="100%" stop-color="#0a1e2d"/>
    </radialGradient>
    <radialGradient id="gc-inner" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="rgba(196,162,80,0.06)"/>
      <stop offset="100%" stop-color="rgba(196,162,80,0)"/>
    </radialGradient>
    <filter id="gc-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="gc-shadow">
      <feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="rgba(0,0,0,0.5)" flood-opacity="1"/>
    </filter>
  </defs>

  <!-- Drop shadow ring -->
  <circle cx="150" cy="154" r="146" fill="rgba(0,0,0,0.22)" filter="url(#gc-shadow)"/>

  <!-- ═══ ROTATING ROSE GROUP ═══ -->
  <g id="compass-rose" style="transform-origin:150px 150px;transition:transform 0.22s cubic-bezier(0.4,0,0.2,1);">

    <!-- Face -->
    <circle cx="150" cy="150" r="148" fill="url(#gc-bg)"/>

    <!-- Outer bezel rings -->
    <circle cx="150" cy="150" r="148" fill="none" stroke="#c4a250" stroke-width="2.5"/>
    <circle cx="150" cy="150" r="144" fill="none" stroke="rgba(196,162,80,0.2)" stroke-width="0.8"/>

    <!-- Inner glow -->
    <circle cx="150" cy="150" r="148" fill="url(#gc-inner)"/>

    <!-- Inner decorative rings -->
    <circle cx="150" cy="150" r="75"  fill="none" stroke="rgba(196,162,80,0.12)" stroke-width="0.8"/>
    <circle cx="150" cy="150" r="50"  fill="none" stroke="rgba(196,162,80,0.08)" stroke-width="0.5"/>

    <!-- Cross hairs (very subtle) -->
    <line x1="150" y1="6"   x2="150" y2="294" stroke="rgba(196,162,80,0.07)" stroke-width="0.6"/>
    <line x1="6"   y1="150" x2="294" y2="150" stroke="rgba(196,162,80,0.07)" stroke-width="0.6"/>
    <!-- Diagonal cross -->
    <line x1="46"  y1="46"  x2="254" y2="254" stroke="rgba(196,162,80,0.04)" stroke-width="0.5"/>
    <line x1="254" y1="46"  x2="46"  y2="254" stroke="rgba(196,162,80,0.04)" stroke-width="0.5"/>

    <!-- Tick marks -->
    ${ticks}

    <!-- Degree numbers -->
    ${degNums}

    <!-- Cardinal / intercardinal labels -->
    ${labelSVG}

    <!-- ── Compass needle ── -->
    <!-- North (red) half -->
    <polygon points="150,40 157,146 150,154 143,146"
             fill="#e53e3e" filter="url(#gc-glow)"/>
    <!-- North highlight shimmer -->
    <polygon points="150,40 153,100 150,154 150,40"
             fill="rgba(255,255,255,0.12)"/>

    <!-- South (gold) half -->
    <polygon points="150,260 157,154 150,146 143,154"
             fill="#c4a250" opacity="0.85"/>

    <!-- Center pivot cap -->
    <circle cx="150" cy="150" r="10" fill="#c4a250"/>
    <circle cx="150" cy="150" r="7"  fill="#0a1e2d"/>
    <circle cx="150" cy="150" r="3"  fill="#c4a250"/>
  </g>
  <!-- ═══ END ROTATING GROUP ═══ -->

  <!-- ── Destination bearing arrow (non-rotating, rotated via JS) ── -->
  <g id="dest-bearing-arrow"
     style="display:none;transform-origin:150px 150px;transition:transform 0.25s ease;">
    <!-- Outer glow ring at compass edge -->
    <circle cx="150" cy="150" r="148" fill="none"
            stroke="#f59e0b" stroke-width="3" stroke-dasharray="8,16"
            opacity="0.6"/>
    <!-- Arrow pointing toward bearing (12 o'clock = straight ahead) -->
    <polygon points="150,10 143,26 150,20 157,26"
             fill="#f59e0b" opacity="0.95"/>
    <!-- Dashed line from center to arrow -->
    <line x1="150" y1="20" x2="150" y2="75"
          stroke="#f59e0b" stroke-width="1.8"
          stroke-dasharray="5,4" opacity="0.6"/>
  </g>

  <!-- ── Top orientation pip (always visible, fixed) ── -->
  <polygon points="150,1 144,12 156,12" fill="#1b4d6e" opacity="0.85"/>
</svg>`;
  }

  /* ── DOM helpers ────────────────────────────────────────────── */

  function _el(id) { return document.getElementById(id); }

  function _updateHeadingDisplay() {
    const deg  = Math.round(_smoothHeading) % 360;
    const card = cardinalDir(deg);

    const degEl  = _el('compass-heading-deg');
    const cardEl = _el('compass-heading-cardinal');
    if (degEl)  degEl.textContent  = deg + '°';
    if (cardEl) cardEl.textContent = card;
  }

  function _updateDestDisplay() {
    const dLat  = State.get('destLat');
    const dLon  = State.get('destLon');
    const dName = State.get('destName');
    const gLat  = State.get('gpsLat');
    const gLon  = State.get('gpsLon');

    const valEl  = _el('compass-dest-value');
    const lblEl  = _el('compass-dest-label');
    const arrow  = _el('dest-bearing-arrow');
    const iconEl = _el('compass-dest-icon');

    if (!dLat || !dLon) {
      if (valEl)  valEl.textContent = 'No destination set';
      if (lblEl)  lblEl.textContent = 'Destination';
      if (iconEl) { iconEl.textContent = '🧭'; iconEl.style.transform = ''; }
      if (arrow)  arrow.style.display = 'none';
      return;
    }

    const name = dName || 'Custom Location';
    if (lblEl) lblEl.textContent = 'Destination';

    if (!gLat || !gLon) {
      if (valEl)  valEl.textContent = `${name} — waiting for GPS…`;
      if (iconEl) { iconEl.textContent = '📍'; iconEl.style.transform = ''; }
      if (arrow)  arrow.style.display = 'none';
      return;
    }

    const b    = bearing(gLat, gLon, dLat, dLon);
    const dist = haversine(gLat, gLon, dLat, dLon);
    const rel  = ((b - _smoothHeading) + 360) % 360;  // relative to facing direction

    if (valEl)  valEl.textContent = `${name} · ${b.toFixed(1)}° · ${formatDist(dist)}`;

    // Rotate the destination arrow by relative bearing
    if (arrow) {
      arrow.style.display   = '';
      arrow.style.transform = `rotate(${rel.toFixed(1)}deg)`;
    }

    // Rotate the arrow icon in the dest readout strip
    if (iconEl) {
      iconEl.textContent       = '➤';
      iconEl.style.transform   = `rotate(${rel.toFixed(1)}deg)`;
      iconEl.style.display     = 'inline-block';
    }
  }

  /* ── Animation loop ─────────────────────────────────────────── */

  function _animate() {
    // Smooth interpolation toward target heading
    let diff       = ((_targetHeading - _smoothHeading + 540) % 360) - 180;
    _smoothHeading = (_smoothHeading + diff * 0.1 + 360) % 360;

    // Rotate the compass rose (counter-rotate so N stays pointing to actual north)
    const rose = _el('compass-rose');
    if (rose) {
      rose.style.transform = `rotate(${(-_smoothHeading).toFixed(2)}deg)`;
    }

    _updateHeadingDisplay();
    _updateDestDisplay();

    // Update context info in topbar
    const ctx = _el('context-info');
    if (ctx) {
      const deg  = Math.round(_smoothHeading) % 360;
      const card = cardinalDir(deg);
      ctx.textContent = `${deg}° ${card}`;
    }

    _animFrame = requestAnimationFrame(_animate);
  }

  /* ── GPS ────────────────────────────────────────────────────── */

  function _initGPS() {
    const dot    = _el('gps-dot');
    const gpsEl  = _el('gps-text');

    if (!navigator.geolocation) {
      if (gpsEl) gpsEl.textContent = 'GPS not supported on this device';
      if (dot)   dot.classList.add('error');
      return;
    }

    if (gpsEl) gpsEl.textContent = 'Requesting GPS…';

    _watchId = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: la, longitude: lo, accuracy: ac } = pos.coords;
        State.set('gpsLat',      la);
        State.set('gpsLon',      lo);
        State.set('gpsAccuracy', ac);
        State.set('gpsActive',   true);

        if (dot)   { dot.classList.remove('error'); dot.classList.add('active'); }
        if (gpsEl) gpsEl.textContent = `${la.toFixed(5)}, ${lo.toFixed(5)}  ±${Math.round(ac)}m`;
      },
      err => {
        State.set('gpsActive', false);
        if (dot)   { dot.classList.remove('active'); dot.classList.add('error'); }
        if (gpsEl) {
          const msgs = {
            1: 'GPS permission denied',
            2: 'GPS position unavailable',
            3: 'GPS request timed out',
          };
          gpsEl.textContent = msgs[err.code] || 'GPS error';
        }
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  }

  /* ── Device Orientation ─────────────────────────────────────── */

  function enableOrientation() {
    const btn  = _el('btn-enable-compass');
    const stEl = _el('compass-status');

    const _handler = ev => {
      let hd = ev.webkitCompassHeading ?? null;
      if (hd === null && typeof ev.alpha === 'number') {
        hd = (360 - ev.alpha + 360) % 360;
      }
      if (typeof hd !== 'number' || isNaN(hd)) return;
      _targetHeading = hd;
    };

    const _activate = () => {
      window.addEventListener('deviceorientationabsolute', _handler, true);
      window.addEventListener('deviceorientation',         _handler, true);
      _orientHandler = _handler;
      _enabled       = true;
      State.set('compassEnabled', true);

      if (btn) {
        btn.textContent = '✓ Compass Active';
        btn.classList.add('active');
        btn.disabled = true;
      }
      if (stEl) stEl.textContent = '✓ Orientation tracking active';
      UI.toast('Compass enabled', 'ok');
    };

    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ requires explicit permission
      DeviceOrientationEvent.requestPermission()
        .then(perm => {
          if (perm === 'granted') {
            _activate();
          } else {
            if (stEl) stEl.textContent = '⚠ Permission denied — use manual mode';
            UI.toast('Orientation permission denied', 'err');
          }
        })
        .catch(() => {
          if (stEl) stEl.textContent = '⚠ Permission error';
          UI.toast('Could not request orientation', 'err');
        });
    } else {
      _activate();
    }
  }

  /* ── Destination ────────────────────────────────────────────── */

  function setDest(lat, lon, name) {
    State.set('destLat',  lat);
    State.set('destLon',  lon);
    State.set('destName', name || 'Custom Location');
    _refreshDestCard();
  }

  function clearDest() {
    State.set('destLat',  null);
    State.set('destLon',  null);
    State.set('destName', null);
    _refreshDestCard();
  }

  function _refreshDestCard() {
    const lat  = State.get('destLat');
    const lon  = State.get('destLon');
    const name = State.get('destName');

    const card    = _el('dest-current-card');
    const nameEl  = _el('dest-current-name');
    const coordEl = _el('dest-current-coords');

    if (!lat || !lon) {
      if (card)    card.className    = 'dest-card';
      if (nameEl)  nameEl.textContent = 'None set';
      if (coordEl) coordEl.textContent = '';
    } else {
      if (card)    card.className    = 'dest-card has-dest';
      if (nameEl)  nameEl.textContent = name || 'Custom Location';
      if (coordEl) coordEl.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    }
  }

  /* ── City Search ─────────────────────────────────────────────── */

  async function searchLocation(query) {
    query = (query || '').trim();
    if (!query) {
      UI.toast('Enter a location to search', 'err');
      return;
    }

    const statusEl = _el('search-status');
    const listEl   = _el('search-results-list');

    if (statusEl) { statusEl.textContent = 'Searching…'; statusEl.className = 'search-status searching'; }

    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&addressdetails=1`;
      const res = await fetch(url, { headers: { 'User-Agent': 'GnokegeoCompass/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const results = await res.json();
      State.set('searchResults', results);

      if (results.length === 0) {
        if (statusEl) { statusEl.textContent = 'No results found — try a different search'; statusEl.className = 'search-status error'; }
        if (listEl)   listEl.innerHTML = `<p style="color:var(--muted);font-size:.82rem;text-align:center;padding:2rem 0;">No results for "${_esc(query)}".</p>`;
        return;
      }

      if (statusEl) { statusEl.textContent = `${results.length} result${results.length > 1 ? 's' : ''} found`; statusEl.className = 'search-status found'; }
      _renderSearchResults(results);

    } catch (err) {
      console.warn('[GeoCompass] search error:', err);
      if (statusEl) { statusEl.textContent = '⚠ Search failed — check internet connection'; statusEl.className = 'search-status error'; }
      if (listEl)   listEl.innerHTML = `<p style="color:var(--muted);font-size:.82rem;text-align:center;padding:2rem 0;">Could not reach search service.</p>`;
      UI.toast('Search failed', 'err');
    }
  }

  function _renderSearchResults(results) {
    const listEl = _el('search-results-list');
    if (!listEl) return;

    listEl.innerHTML = results.map((r, i) => {
      const lat   = parseFloat(r.lat);
      const lon   = parseFloat(r.lon);
      const parts = (r.display_name || '').split(',');
      const short = parts.slice(0, 2).join(',').trim();
      const full  = r.display_name || '';
      const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${(lon-0.05).toFixed(4)},${(lat-0.05).toFixed(4)},${(lon+0.05).toFixed(4)},${(lat+0.05).toFixed(4)}&layer=mapnik&marker=${lat},${lon}`;

      return `
<div class="result-item" data-index="${i}">
  <div class="result-item-head">
    <div class="result-item-text">
      <div class="result-item-name">${_esc(short)}</div>
      <div class="result-item-full">${_esc(full)}</div>
      <div class="result-item-coords">${lat.toFixed(6)}, ${lon.toFixed(6)}</div>
    </div>
    <div class="result-map-thumb">
      <iframe src="${mapUrl}" scrolling="no" loading="lazy"></iframe>
    </div>
  </div>
  <button
    class="btn btn-primary"
    style="width:100%;margin-top:8px;font-size:.78rem;padding:8px 12px;"
    onclick="Compass.selectResult(${lat}, ${lon}, '${_esc(short).replace(/'/g,"\\'")}')">
    📍 Set as Destination
  </button>
</div>`;
    }).join('');
  }

  function selectResult(lat, lon, name) {
    setDest(lat, lon, name);
    UI.toast(`Destination: ${name}`, 'ok');
    // Switch to compass page after short delay
    setTimeout(() => window.loadPage && loadPage('compass-page'), 700);
  }

  /* ── HTML escaping ──────────────────────────────────────────── */
  function _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ── Init ───────────────────────────────────────────────────── */

  function init() {
    // Mount the compass SVG
    const wrap = _el('compass-container');
    if (wrap) wrap.innerHTML = _buildCompassSVG();

    // Start GPS
    _initGPS();

    // Start animation loop
    if (_animFrame) cancelAnimationFrame(_animFrame);
    _animFrame = requestAnimationFrame(_animate);
  }

  /* ── Cleanup ────────────────────────────────────────────────── */

  function destroy() {
    if (_animFrame) cancelAnimationFrame(_animFrame);
    if (_watchId != null) navigator.geolocation.clearWatch(_watchId);
    if (_orientHandler) {
      window.removeEventListener('deviceorientationabsolute', _orientHandler, true);
      window.removeEventListener('deviceorientation',         _orientHandler, true);
    }
  }

  return {
    init,
    destroy,
    enableOrientation,
    setDest,
    clearDest,
    selectResult,
    searchLocation,
    haversine,
    bearing,
    cardinalDir,
  };

})();
