// CSR Sardegna – Grotte Offline (PWA installabile)
const DB_NAME = 'csr-grotte-db';
const DB_VERSION = 1;
const STORE = 'preferiti';

let map, markersLayer, allFeatures = [], currentFeature = null;
let db = null;

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'id_ost' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

function savePreferito(feat) {
  if (!db || !feat.properties.id_ost) return Promise.resolve();
  const p = feat.properties;
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({
      id_ost: p.id_ost,
      nome: p.nome,
      provincia: p.provincia,
      ambito: p.ambito,
      scheda_url: p.scheda_url,
      coordinates: feat.geometry.coordinates,
      savedAt: new Date().toISOString()
    });
    tx.oncomplete = () => { updateFavBtn(true); showStatus('Salvata nei preferiti ✓'); renderPreferiti(); resolve(); };
  });
}

function removePreferito(id_ost) {
  if (!db || !id_ost) return Promise.resolve();
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id_ost);
    tx.oncomplete = () => { updateFavBtn(false); showStatus('Rimossa dai preferiti'); renderPreferiti(); resolve(); };
  });
}

function isPreferito(id_ost) {
  return new Promise(resolve => {
    if (!db || !id_ost) return resolve(false);
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id_ost);
    req.onsuccess = () => resolve(!!req.result);
  });
}

function getAllPreferiti() {
  return new Promise(resolve => {
    if (!db) return resolve([]);
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

async function updateFavBtn(force) {
  const btn = document.getElementById('favBtn');
  if (!currentFeature) return;
  const saved = force !== undefined ? force : await isPreferito(currentFeature.properties.id_ost);
  btn.textContent = saved ? '★' : '☆';
  btn.style.color = saved ? '#fbbf24' : '#94a3b8';
}

// ---------- Preferiti page ----------
async function renderPreferiti() {
  const list = document.getElementById('favList');
  const countEl = document.getElementById('favCount');
  const items = await getAllPreferiti();
  countEl.textContent = items.length + ' grotte salvate offline';

  if (!items.length) {
    list.innerHTML = '<div class="fav-empty"><div class="big">★</div><p>Nessuna grotta salvata</p><p style="margin-top:8px;font-size:13px">Dalla mappa tocca una grotta e premi ★ per salvarla offline</p></div>';
    return;
  }

  items.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'it'));

  list.innerHTML = items.map(item => {
    const nome = String(item.nome || 'Grotta').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const meta = [item.provincia, item.ambito].filter(Boolean).join(' · ') || '—';
    const schedaBtn = item.scheda_url ? '<button class="icon-btn" data-action="scheda" title="Scheda completa">📄</button>' : '';
    return '<div class="fav-card" data-id="' + item.id_ost + '">' +
      '<div class="info"><div class="nome">' + nome + '</div><div class="meta">' + meta + '</div></div>' +
      '<div class="actions-row">' +
        '<button class="icon-btn" data-action="map" title="Mostra in mappa">🗺️</button>' +
        '<button class="icon-btn" data-action="nav" title="Naviga">🧭</button>' +
        schedaBtn +
        '<button class="icon-btn danger" data-action="del" title="Rimuovi">🗑️</button>' +
      '</div></div>';
  }).join('');

  list.querySelectorAll('.fav-card').forEach(card => {
    const id = card.dataset.id;
    const item = items.find(i => i.id_ost === id);
    card.querySelectorAll('.icon-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'del') {
          if (confirm('Rimuovere dai preferiti?')) removePreferito(id);
        } else if (action === 'map' && item && item.coordinates) {
          switchView('map');
          map.setView([item.coordinates[1], item.coordinates[0]], 15);
          const feat = allFeatures.find(f => f.properties.id_ost === id);
          if (feat) openPanel(feat);
        } else if (action === 'nav' && item && item.coordinates) {
          const lon = item.coordinates[0], lat = item.coordinates[1];
          window.open('https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon + '&travelmode=driving', '_blank');
        } else if (action === 'scheda' && item && item.scheda_url) {
          window.open(item.scheda_url, '_blank');
        }
      });
    });
    card.addEventListener('click', () => {
      const feat = allFeatures.find(f => f.properties.id_ost === id);
      if (feat) {
        switchView('map');
        map.setView([feat.geometry.coordinates[1], feat.geometry.coordinates[0]], 15);
        openPanel(feat);
      } else if (item && item.scheda_url) {
        window.open(item.scheda_url, '_blank');
      }
    });
  });
}

// ---------- Tabs ----------
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelector('.tab[data-view="' + name + '"]').classList.add('active');
  if (name === 'preferiti') renderPreferiti();
  if (name === 'map' && map) setTimeout(() => map.invalidateSize(), 50);
  closePanel();
}

// ---------- Map ----------
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([40.0, 9.0], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap'
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function createMarker(feature) {
  const lon = feature.geometry.coordinates[0];
  const lat = feature.geometry.coordinates[1];
  const m = L.circleMarker([lat, lon], {
    radius: 6, fillColor: '#2d8a6e', color: '#fff', weight: 1.5, opacity: 1, fillOpacity: 0.85
  });
  m.feature = feature;
  m.on('click', () => openPanel(feature));
  return m;
}

function renderMarkers(features) {
  markersLayer.clearLayers();
  features.forEach(f => createMarker(f).addTo(markersLayer));
  document.getElementById('status').textContent = features.length + ' grotte visualizzate';
}

// ---------- Panel ----------
function openPanel(feature) {
  currentFeature = feature;
  const p = feature.properties;
  const lon = feature.geometry.coordinates[0];
  const lat = feature.geometry.coordinates[1];
  document.getElementById('panelTitle').textContent = p.nome || 'Grotta';
  document.getElementById('panelBody').innerHTML =
    '<div class="info-row"><span>Provincia</span><span>' + (p.provincia || '—') + '</span></div>' +
    '<div class="info-row"><span>Ambito</span><span>' + (p.ambito || '—') + '</span></div>' +
    '<div class="info-row"><span>ID SIRA</span><span>' + (p.id_ost || '—') + '</span></div>' +
    '<div class="info-row"><span>Coordinate</span><span>' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '</span></div>' +
    '<div class="actions">' +
      (p.scheda_url ? '<a class="btn-primary" href="' + p.scheda_url + '" target="_blank" rel="noopener">Apri scheda completa (dislivello + PDF)</a>' : '') +
      '<a class="btn-outline" href="https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon + '&travelmode=driving" target="_blank" rel="noopener">Naviga con Google Maps</a>' +
      '<a class="btn-outline" href="https://maps.apple.com/?daddr=' + lat + ',' + lon + '&dirflg=d" target="_blank" rel="noopener">Naviga con Apple Maps</a>' +
      '<a class="btn-outline" href="https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=16/' + lat + '/' + lon + '" target="_blank" rel="noopener">Apri in OpenStreetMap</a>' +
      '<button class="btn-outline" id="saveOfflineBtn">Salva offline (preferiti)</button>' +
    '</div>' +
    '<p style="margin-top:14px;font-size:12px;color:#94a3b8;line-height:1.45">La scheda ufficiale contiene: dislivello, sviluppo, descrizione, link ai rilievi PDF/DWG e scheda di posizionamento.</p>';
  document.getElementById('panel').classList.add('open');
  updateFavBtn();
  document.getElementById('saveOfflineBtn') && document.getElementById('saveOfflineBtn').addEventListener('click', () => savePreferito(feature));
  document.getElementById('favBtn').onclick = async () => {
    const saved = await isPreferito(p.id_ost);
    if (saved) removePreferito(p.id_ost);
    else savePreferito(feature);
  };
}

function closePanel() {
  document.getElementById('panel').classList.remove('open');
  currentFeature = null;
}

// ---------- Filters ----------
function applyFilters() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const prov = document.getElementById('provinciaFilter').value;
  const ambito = document.getElementById('ambitoFilter').value;
  const filtered = allFeatures.filter(f => {
    const p = f.properties;
    if (prov && p.provincia !== prov) return false;
    if (ambito && p.ambito !== ambito) return false;
    if (q) {
      const hay = ((p.nome||'') + ' ' + (p.provincia||'') + ' ' + (p.ambito||'') + ' ' + (p.id_ost||'')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  renderMarkers(filtered);
  document.getElementById('filters').classList.remove('open');
}

function showStatus(msg) {
  const el = document.getElementById('status');
  el.textContent = msg;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = allFeatures.length + ' grotte caricate';
  }, 2500);
}

function updateOnlineStatus() {
  document.getElementById('offlineBadge').classList.toggle('show', !navigator.onLine);
}

function debounce(fn, ms) {
  let t;
  return function() {
    const args = arguments;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

// ---------- Init ----------
async function init() {
  initMap();
  await openDB();
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  document.getElementById('closePanel').onclick = closePanel;
  document.getElementById('filterBtn').onclick = () => document.getElementById('filters').classList.toggle('open');
  document.getElementById('applyFilters').onclick = applyFilters;
  document.getElementById('search').addEventListener('input', debounce(applyFilters, 300));
  document.getElementById('locateBtn').onclick = () => map.locate({ setView: true, maxZoom: 13 });
  map.on('locationfound', e => {
    L.circle(e.latlng, { radius: e.accuracy / 2, color: '#38bdf8', fillOpacity: 0.15 }).addTo(map);
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  try {
    const res = await fetch('grotte_sardegna.geojson');
    const geojson = await res.json();
    allFeatures = geojson.features || [];
    renderMarkers(allFeatures);
    showStatus(allFeatures.length + ' grotte caricate');
  } catch (err) {
    showStatus('Errore caricamento dati');
    console.error(err);
  }

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn(e); }
  }

  renderPreferiti();
}

init();
