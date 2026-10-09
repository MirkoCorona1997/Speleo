const DB='csr-grotte-v3', STORE_FAV='preferiti', STORE_NAMES='nomi';
let map, layer, all=[], cur=null, db=null, navMarker=null;

function openDB(){
  return new Promise((ok,no)=>{
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(STORE_FAV)) d.createObjectStore(STORE_FAV,{keyPath:'id_ost'});
      if(!d.objectStoreNames.contains(STORE_NAMES)) d.createObjectStore(STORE_NAMES,{keyPath:'id_ost'});
    };
    r.onsuccess=e=>{db=e.target.result;ok(db);};
    r.onerror=e=>no(e.target.error);
  });
}

function saveNameCache(id, nome, codice){
  if(!db||!id||!nome) return;
  const tx=db.transaction(STORE_NAMES,'readwrite');
  tx.objectStore(STORE_NAMES).put({id_ost:id, nome, codice:codice||null, at:Date.now()});
}
function getNameCache(id){
  return new Promise(r=>{
    if(!db||!id) return r(null);
    const tx=db.transaction(STORE_NAMES,'readonly');
    const q=tx.objectStore(STORE_NAMES).get(id);
    q.onsuccess=()=>r(q.result||null);
  });
}

function saveFav(f){
  if(!db||!f.properties.id_ost) return;
  const p=f.properties;
  const tx=db.transaction(STORE_FAV,'readwrite');
  tx.objectStore(STORE_FAV).put({
    id_ost:p.id_ost,
    nome:p.nome,
    nome_reale:p.nome_reale||p.nome,
    codice:p.codice||null,
    comune:p.comune,
    provincia:p.provincia,
    ambito:p.ambito,
    scheda_url:p.scheda_url,
    coordinates:f.geometry.coordinates,
    savedAt:Date.now()
  });
  tx.oncomplete=()=>{status('Salvata offline ★');renderFavs();};
}
function delFav(id){
  if(!db) return;
  const tx=db.transaction(STORE_FAV,'readwrite');
  tx.objectStore(STORE_FAV).delete(id);
  tx.oncomplete=()=>{status('Rimossa');renderFavs();};
}
function allFavs(){
  return new Promise(r=>{
    if(!db) return r([]);
    const tx=db.transaction(STORE_FAV,'readonly');
    const q=tx.objectStore(STORE_FAV).getAll();
    q.onsuccess=()=>r(q.result||[]);
  });
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}


function padCat(c){
  if(c==null||c==='') return null;
  const s=String(c).trim();
  if(!/^\d+$/.test(s)) return s;
  return s.padStart(4,'0');
}

/* Fetch real name from SIRA (via CORS proxies, with fallback) */
async function fetchNomeOnline(id_ost){
  if(!id_ost || !navigator.onLine) return null;
  const pageUrl=`https://portal.sardegnasira.it/dettaglio-grotte-aree-carsiche?id_ost=${id_ost}&tipologia=Grotta`;
  const proxies=[
    `https://api.allorigins.win/get?url=${encodeURIComponent(pageUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(pageUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(pageUrl)}`
  ];
  for(const proxy of proxies){
    try{
      const ctrl=new AbortController();
      const t=setTimeout(()=>ctrl.abort(),14000);
      const res=await fetch(proxy,{signal:ctrl.signal, cache:'no-store'});
      clearTimeout(t);
      if(!res.ok) continue;
      let html=await res.text();
      // allorigins /get returns JSON wrapper
      if(html.trim().startsWith('{')){
        try{
          const j=JSON.parse(html);
          html=j.contents||j.data||html;
        }catch(e){}
      }
      if(!html || html.length<500) continue;
      let nome=null, codice=null;
      let m=html.match(/Denominazione sito:[\s\S]*?<span class="td-content">\s*([^<]{2,100}?)\s*<\/span>/i);
      if(m) nome=m[1].trim();
      if(!nome){
        m=html.match(/Denominazione sito:[\s\S]{0,300}?td-content">\s*([^<]{2,100}?)\s*</i);
        if(m) nome=m[1].trim();
      }
      if(!nome){
        m=html.match(/>(Grotta [A-Za-zÀ-ú0-9'\.\- ]{3,60}|Abisso [A-Za-zÀ-ú0-9'\.\- ]{3,50}|Brecca [A-Za-zÀ-ú0-9'\.\- ]{3,50})</);
        if(m) nome=m[1].trim();
      }
      m=html.match(/Codice grotta:[\s\S]*?<span class="td-content">\s*(\d{2,6})\s*<\/span>/i);
      if(m) codice=m[1].trim();
      if(nome && nome.length>2 && nome.toLowerCase()!=='n/d'){
        return {nome, codice};
      }
    }catch(e){ console.warn('proxy fail', e); }
  }
  return null;
}

async function resolveNome(f){
  const id=f.properties.id_ost;
  if(!id) return f.properties.nome;

  // 1) already resolved in memory
  if(f.properties.nome_reale) return f.properties.nome;

  // 2) local cache
  const cached=await getNameCache(id);
  if(cached && cached.nome){
    f.properties.nome_reale=cached.nome;
    f.properties.codice=cached.codice;
    f.properties.codice=padCat(cached.codice);
    f.properties.nome=f.properties.codice?`${f.properties.codice} - ${cached.nome}`:cached.nome;
    return f.properties.nome;
  }

  // 3) online
  const titleEl=document.getElementById('cardTitle');
  const idEl=document.getElementById('cardId');
  if(titleEl) titleEl.innerHTML=esc(f.properties.nome)+' <span style="font-size:11px;color:#3dcfb0;font-weight:500"> cercando nome…</span>';

  const data=await fetchNomeOnline(id);
  if(data && data.nome){
    f.properties.nome_reale=data.nome;
    f.properties.codice=padCat(data.codice);
    f.properties.nome=f.properties.codice?`${f.properties.codice} - ${data.nome}`:data.nome;
    saveNameCache(id, data.nome, data.codice);
    if(titleEl && cur===f){
      titleEl.textContent=f.properties.nome;
      if(idEl) idEl.textContent=f.properties.codice?('N. catastale  '+f.properties.codice):('ID SIRA  '+id);
    }
    return f.properties.nome;
  } else {
    if(titleEl && cur===f) titleEl.textContent=f.properties.nome;
    const idEl2=document.getElementById('cardId');
    if(idEl2 && cur===f && !f.properties.nome_reale) idEl2.textContent=(idEl2.textContent||'')+' · nome non disponibile online';
    return f.properties.nome;
  }
}

async function renderFavs(){
  const list=document.getElementById('favList');
  const items=await allFavs();
  document.getElementById('favCount').textContent=items.length+(items.length===1?' salvata':' salvate');
  if(!items.length){
    list.innerHTML='<div class="empty"><div class="big">★</div><p>Nessun preferito</p><p style="font-size:12px;margin-top:6px">Tocca una grotta e salvala offline</p></div>';
    return;
  }
  items.sort((a,b)=>(a.nome||'').localeCompare(b.nome||'','it'));
  list.innerHTML=items.map(it=>`<div class="fc" data-id="${it.id_ost}">
    <div class="inf">
      <div class="n">${esc(it.nome||it.nome_reale||'Grotta')}</div>
      <div class="m">${esc([it.comune,it.provincia].filter(Boolean).join(' · '))}</div>
      <div class="id">${it.codice?('N. '+esc(padCat(it.codice))):('ID '+esc(it.id_ost))}</div>
    </div>
    <div class="bt">
      <button data-a="map">🗺️</button>
      <button data-a="nav">🧭</button>
      ${it.scheda_url?'<button data-a="scheda">📄</button>':''}
      <button class="del" data-a="del">🗑️</button>
    </div>
  </div>`).join('');
  list.querySelectorAll('.fc').forEach(card=>{
    const id=card.dataset.id;
    const it=items.find(x=>x.id_ost===id);
    card.querySelectorAll('button').forEach(b=>{
      b.onclick=e=>{
        e.stopPropagation();
        const a=b.dataset.a;
        if(a==='del'){if(confirm('Rimuovere?'))delFav(id);}
        else if(a==='map'&&it?.coordinates){
          switchView('map');
          map.setView([it.coordinates[1],it.coordinates[0]],15);
          const f=all.find(x=>x.properties.id_ost===id);
          if(f){ if(it.nome) {f.properties.nome=it.nome;f.properties.nome_reale=it.nome_reale||it.nome;f.properties.codice=it.codice;} openCard(f); }
        }else if(a==='nav'&&it?.coordinates){
          const [lo,la]=it.coordinates;
          location.href=`https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=driving`;
        }else if(a==='scheda'&&it?.scheda_url){
          location.href=it.scheda_url;
        }
      };
    });
  });
}

function switchView(n){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('view-'+n).classList.add('active');
  document.querySelector(`.tab[data-view="${n}"]`).classList.add('on');
  if(n==='preferiti') renderFavs();
  if(n==='tracce') renderTracksList();
  if(n==='punti') renderPoiList();
  if(n==='map'&&map) setTimeout(()=>map.invalidateSize(),40);
  closeCard(); hideNavPin();
}

function initMap(){
  if(typeof L==='undefined'){showError('Leaflet non caricato. Controlla la connessione e ricarica.');return;}
  map=L.map('map',{zoomControl:false,attributionControl:false}).setView([40.05,9.0],8);
  setTimeout(()=>{try{map.invalidateSize();}catch(e){}},200);
  setTimeout(()=>{try{map.invalidateSize();}catch(e){}},600);
  baseOsm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18, attribution:'© OSM'});
  baseTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{
    maxZoom:17,
    attribution:'© OpenTopoMap (CC-BY-SA)'
  });
  baseOsm.addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
  layer=L.layerGroup().addTo(map);

  map.on('contextmenu',e=>{ e.originalEvent.preventDefault(); showNavPin(e.latlng); });

  let pressTimer=null;
  map.getContainer().addEventListener('touchstart',ev=>{
    if(ev.touches.length!==1) return;
    const t=ev.touches[0];
    pressTimer=setTimeout(()=>{
      const rect=map.getContainer().getBoundingClientRect();
      const pt=L.point(t.clientX-rect.left, t.clientY-rect.top);
      showNavPin(map.containerPointToLatLng(pt));
    },550);
  },{passive:true});
  map.getContainer().addEventListener('touchmove',()=>clearTimeout(pressTimer),{passive:true});
  map.getContainer().addEventListener('touchend',()=>clearTimeout(pressTimer),{passive:true});
}


const POI_TYPES = [
  {id:'grotta', label:'Grotta', icon:'🕳️'},
  {id:'parcheggio', label:'Parcheggio', icon:'🅿️'},
  {id:'panchina', label:'Panchina', icon:'🪑'},
  {id:'acqua', label:'Acqua', icon:'💧'},
  {id:'bivio', label:'Bivio', icon:'🔀'},
  {id:'pericolo', label:'Pericolo', icon:'⚠️'},
  {id:'campo', label:'Campo', icon:'⛺'},
  {id:'altro', label:'Altro', icon:'📍'}
];
let savedPois = [];
let poiLayer = null;
let poiDraft = null;
let poiType = 'grotta';
function loadPois(){ try { savedPois = JSON.parse(localStorage.getItem('csr-poi')||'[]'); } catch(e){ savedPois=[]; } }
function persistPois(){ localStorage.setItem('csr-poi', JSON.stringify(savedPois)); }
function drawPois(){
  if (!map) return;
  if (poiLayer) map.removeLayer(poiLayer);
  poiLayer = L.layerGroup().addTo(map);
  savedPois.forEach(p => {
    const t = POI_TYPES.find(x => x.id === p.type) || POI_TYPES[7];
    const m = L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className:'', html:`<div style="font-size:22px;filter:drop-shadow(0 1px 2px #000)">${t.icon}</div>`, iconSize:[24,24], iconAnchor:[12,12] })
    });
    m.bindPopup(`<strong>${t.icon} ${esc(p.name)}</strong><br><span style="font-size:12px">${t.label}</span><br><button id="poiDel-${p.id}" style="margin-top:6px">Elimina</button>`);
    m.on('popupopen', () => {
      const b = document.getElementById('poiDel-'+p.id);
      if (b) b.onclick = () => { savedPois = savedPois.filter(x => x.id !== p.id); persistPois(); drawPois(); map.closePopup(); };
    });
    m.addTo(poiLayer);
  });
}
function openPoiSheet(){
  if (!poiDraft) return;
  document.getElementById('poiName').value = '';
  poiType = 'grotta';
  const box = document.getElementById('poiTypes');
  box.innerHTML = POI_TYPES.map(t => `<button type="button" data-t="${t.id}" class="tbtn-sm ${t.id==='grotta'?'acc':''}" style="height:34px">${t.icon} ${t.label}</button>`).join('');
  box.querySelectorAll('button').forEach(b => b.onclick = () => {
    poiType = b.dataset.t;
    box.querySelectorAll('button').forEach(x => x.classList.remove('acc'));
    b.classList.add('acc');
  });
  document.getElementById('poiSheet').classList.add('show'); document.getElementById('poiSheet').style.display='block';
}
function poiNumber(p){
  const ordered = savedPois.slice().sort((a,b)=>(a.created||0)-(b.created||0));
  const i = ordered.findIndex(x => x.id === p.id);
  return i >= 0 ? i + 1 : 0;
}
async function savePoi(){
  if (!poiDraft) return;
  const name = (document.getElementById('poiName').value || '').trim() || (POI_TYPES.find(t=>t.id===poiType)||{}).label || 'Punto';
  const desc = (document.getElementById('poiDesc').value || '').trim();
  status('Quota del punto…');
  let ele = null;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${poiDraft.lat}&longitude=${poiDraft.lng}`);
    const d = await r.json();
    if (d.elevation && d.elevation[0] != null) ele = d.elevation[0];
  } catch(e) {}
  savedPois.unshift({ id:'p'+Date.now(), name, type: poiType, desc, lat: poiDraft.lat, lng: poiDraft.lng, ele, created: Date.now() });
  persistPois();
  drawPois();
  document.getElementById('poiSheet').classList.remove('show'); document.getElementById('poiSheet').style.display='none';
  hideNavPin();
  status('Punto salvato');
  renderPoiList();
}
function openPoiDetail(p){
  const t = POI_TYPES.find(x => x.id === p.type) || POI_TYPES[7];
  document.getElementById('tdTitle').textContent = '#' + poiNumber(p) + ' ' + (p.name || 'Punto');
  document.getElementById('tdMeta').textContent = t.icon + ' ' + t.label + (p.created ? ' · ' + new Date(p.created).toLocaleString('it-IT') : '');
  document.getElementById('tdStats').innerHTML =
    `<div class="stat-box"><div class="sl">Coordinate</div><div class="sv" style="font-size:13px">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div></div>` +
    `<div class="stat-box"><div class="sl">Altitudine</div><div class="sv">${p.ele!=null?Math.round(p.ele)+' m':'n/d'}</div></div>`;
  document.getElementById('tdChart').innerHTML = `<div class="elev-chart"><div class="clabel">${esc(p.desc || 'Nessuna descrizione')}</div></div>`;
  document.getElementById('tdActs').innerHTML =
    `<button class="pri" id="poiGo">Vedi su mappa</button>
     <a class="pri" style="background:var(--panel2);color:var(--text)" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank">Google Maps</a>
     <button id="poiDel" style="color:var(--danger)">Elimina</button>`;
  document.getElementById('trDetail').classList.add('open');
  document.getElementById('poiGo').onclick = () => {
    switchView('map');
    closeTrackDetail();
    map.setView([p.lat, p.lng], 16);
  };
  document.getElementById('poiDel').onclick = () => {
    if (!confirm('Eliminare il punto?')) return;
    savedPois = savedPois.filter(x => x.id !== p.id);
    persistPois(); drawPois(); closeTrackDetail(); renderPoiList();
  };
}
function renderPoiList(){
  loadPois();
  const list = document.getElementById('poiList');
  if (!list) return;
  document.getElementById('poiCount').textContent = savedPois.length + (savedPois.length===1?' punto':' punti');
  if (!savedPois.length) {
    list.innerHTML = '<div class="empty"><div class="big">📌</div><p>Nessun segnaposto</p><p style="font-size:12px;margin-top:6px">Tieni premuto sulla mappa e scegli Salva punto</p></div>';
    return;
  }
  const sort = (document.getElementById('poiSort')||{}).value || 'new';
  const view = savedPois.slice().sort((a,b) => {
    if (sort==='az') return (a.name||'').localeCompare(b.name||'', 'it');
    if (sort==='za') return (b.name||'').localeCompare(a.name||'', 'it');
    if (sort==='old') return (a.created||0)-(b.created||0);
    return (b.created||0)-(a.created||0);
  });
  list.innerHTML = view.map(p => {
    const t = POI_TYPES.find(x => x.id === p.type) || POI_TYPES[7];
    return `<div class="tr-card" data-id="${p.id}">
      <div class="tr-head"><div class="cname">${t.icon} #${poiNumber(p)} ${esc(p.name)}</div></div>
      <div class="meta">${t.label} · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} · ${p.ele!=null?Math.round(p.ele)+' m':'quota n/d'}</div>
      <div class="acts"><button data-a="open">Dettagli</button><button data-a="map">Mappa</button><button class="del" data-a="del">Elimina</button></div>
    </div>`;
  }).join('');
  list.querySelectorAll('.tr-card').forEach(card => {
    const p = savedPois.find(x => x.id === card.dataset.id);
    const goMap = () => { switchView('map'); map.setView([p.lat, p.lng], 16); if (poiLayer) poiLayer.eachLayer(l => { if (l.getLatLng && l.getLatLng().lat===p.lat) l.openPopup(); }); };
    card.onclick = () => goMap();
    card.querySelectorAll('button').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      if (b.dataset.a==='open') openPoiDetail(p);
      else if (b.dataset.a==='map') goMap();
      else if (b.dataset.a==='del' && confirm('Eliminare?')) {
        savedPois = savedPois.filter(x => x.id !== p.id); persistPois(); drawPois(); renderPoiList();
      }
    });
  });
}


function showNavPin(latlng){
  closeCard();
  if(navMarker) map.removeLayer(navMarker);
  navMarker=L.circleMarker(latlng,{radius:10,color:'#3dcfb0',fillColor:'#3dcfb0',fillOpacity:0.35,weight:2}).addTo(map);
  const la=latlng.lat.toFixed(5), lo=latlng.lng.toFixed(5);
  document.getElementById('navPinText').textContent=`Punto ${la}, ${lo}`;
  document.getElementById('navPinGoogle').href=`https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=driving`;
    document.getElementById('navPin').classList.add('show');
}
function hideNavPin(){
  document.getElementById('navPin').classList.remove('show');
  if(navMarker){map.removeLayer(navMarker);navMarker=null;}
}

function draw(feats){
  layer.clearLayers();
  feats.forEach(f=>{
    const [lo,la]=f.geometry.coordinates;
    const m=L.circleMarker([la,lo],{radius:8,fillColor:'#3dcfb0',color:'#fff',weight:2,opacity:1,fillOpacity:0.95});
    m.on('click',function(e){ L.DomEvent.stopPropagation(e); openCard(f); });
    m.addTo(layer);
  });
  document.getElementById('status').textContent=feats.length+' grotte';
}

function openCard(f){
  hideNavPin();
  cur=f;
  const p=f.properties;
  const [lo,la]=f.geometry.coordinates;
  const cat=padCat(p.codice);
  if(cat) p.codice=cat;
  const baseName=(p.nome_reale||p.nome||'Grotta').replace(/^\d+\s*-\s*/,'');
  document.getElementById('cardTitle').textContent=cat?(cat+' - '+baseName):(p.nome||'Grotta');
  document.getElementById('cardId').textContent=cat?('N. catastale  '+cat):(p.id_ost?('ID SIRA  '+p.id_ost):'');
  document.getElementById('cardMeta').innerHTML=
    (p.comune?`<span class="pill"><strong>${esc(p.comune)}</strong></span>`:'')+
    (p.provincia?`<span class="pill">${esc(p.provincia)}</span>`:'')+
    (p.ambito?`<span class="pill">${esc(p.ambito)}</span>`:'')+
    `<span class="pill">${la.toFixed(5)}, ${lo.toFixed(5)}</span>`;
  const codice = padCat(p.codice);
  const csrScheda = codice ? `https://m.catastospeleologicoregionale.sardegna.it/scheda-catastale/${codice}` : null;
  const csrPos = codice ? `https://www.catastospeleologicoregionale.sardegna.it/scheda-posizionamento/${codice}` : null;
  const csrRilievo = codice ? `https://www.catastospeleologicoregionale.sardegna.it/rilievo-pdf/${codice}` : null;
  let docs = '';
  if (csrScheda) {
    docs += `<a class="ba" href="${csrScheda}" target="_blank" rel="noopener">Scheda completa</a>`;
  }
  if (csrPos) {
    docs += `<a class="bb" href="${csrPos}" target="_blank" rel="noopener">Scheda posizionamento</a>`;
  }
  if (csrRilievo) {
    docs += `<a class="bb" href="${csrRilievo}" target="_blank" rel="noopener">Rilievo PDF</a>`;
  }
  if (!csrScheda && !csrPos && !csrRilievo) {
    docs += `<span class="bc" style="opacity:.7">Documenti non disponibili (manca n. catastale)</span>`;
  }
  document.getElementById('cardActions').innerHTML =
    docs +
    `<a class="bb" href="https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=driving" target="_blank" rel="noopener">Google Maps</a>` +
    `<button class="bc" id="saveBtn">★  Salva offline</button>`;
  document.getElementById('card').classList.add('open');
  document.getElementById('saveBtn')?.addEventListener('click',()=>saveFav(f));

  // Resolve real name online (async) — then card updates + available for offline save
  resolveNome(f);
}

function closeCard(){
  document.getElementById('card').classList.remove('open');
  cur=null;
}

function filter(){
  const q=document.getElementById('search').value.trim().toLowerCase();
  const pv=document.getElementById('provinciaFilter').value;
  const am=document.getElementById('ambitoFilter').value;
  const out=all.filter(f=>{
    const p=f.properties;
    if(pv&&p.provincia!==pv) return false;
    if(am&&p.ambito!==am) return false;
    if(q){
      const cat=padCat(p.codice)||'';
      const h=`${p.nome||''} ${p.nome_reale||''} ${p.comune||''} ${p.provincia||''} ${p.id_ost||''} ${p.codice||''} ${cat}`.toLowerCase();
      if(!h.includes(q)) return false;
    }
    return true;
  });
  draw(out);
  document.getElementById('filters').classList.remove('open');
}
function status(m){
  const el=document.getElementById('status');
  el.textContent=m;
  setTimeout(()=>{if(el.textContent===m) el.textContent=all.length+' grotte';},2200);
}
function deb(fn,ms){let t;return()=>{clearTimeout(t);t=setTimeout(fn,ms);};}
function showError(msg){
  const el=document.getElementById('errbox');
  if(!el) return;
  el.textContent=msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),8000);
}


/* ========== GPS + Tracce GPX ========== */
const STORE_TR = 'tracce';
const TRACK_COLORS = ['#3dcfb0','#3b9eff','#f5b942','#e85d5d','#c084fc','#fb923c'];
let baseOsm, baseTopo, topoOn = false;
let watchId = null;
let orientHandler = null;
let myMarker = null, myArrow = null;
let heading = 0;
let recording = false;
let routeMode = false;
let recPoints = []; // {lat,lng,t}
let routePoints = []; // {lat,lng}
let recPolyline = null, routePolyline = null, routeMarkers = [];
let savedTracks = []; // loaded from IDB
let trackLayers = {}; // id -> {line, markers}
let activeColor = '#3dcfb0';
let recStart = null;

function openTracksDB() {
  // tracks stored in same DB - ensure store exists via upgrade is hard; use separate key in preferiti style
  // We recreate DB version bump is complex mid-flight; store tracks as JSON in localStorage + optional IDB put via preferiti pattern
}

function loadTracks() {
  try {
    savedTracks = JSON.parse(localStorage.getItem('csr-tracce') || '[]');
  } catch(e) { savedTracks = []; }
  return savedTracks;
}
function persistTracks() {
  localStorage.setItem('csr-tracce', JSON.stringify(savedTracks));
}

function haversine(a, b) {
  const R = 6371000;
  const toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lng - a.lng);
  const lat1 = toR(a.lat), lat2 = toR(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function trackDistance(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i-1], pts[i]);
  return d;
}
function fmtDist(m) {
  return m >= 1000 ? (m/1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}
function fmtDur(ms) {
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60), sec = s % 60;
  const h = Math.floor(m/60);
  if (h) return h + 'h ' + (m%60) + 'm';
  return m + 'm ' + sec + 's';
}

let accCircle = null;
function updateGpsMarker(latlng, acc) {
  if (!map) return;
  if (accCircle) accCircle.setLatLng(latlng);
  else accCircle = L.circle(latlng, { radius: Math.max(acc || 8, 3), color: '#3b9eff', weight: 1, fillColor: '#3b9eff', fillOpacity: 0.12, interactive: false }).addTo(map);
  if (acc) accCircle.setRadius(Math.max(acc, 3));
  if (!myMarker) {
    const icon = L.divIcon({ className: 'gps-icon', html: '<div class="gps-live"><div class="gps-cone" id="gpsArrow"></div><div class="gps-dot"></div></div>', iconSize: [72,72], iconAnchor: [36,36] });
    myMarker = L.marker(latlng, { icon, zIndexOffset: 2000, interactive: false }).addTo(map);
  } else {
    myMarker.setLatLng(latlng);
      }
  applyHeading();
}

function applyHeading() {
  const el = document.getElementById('gpsArrow');
  if (el) el.style.transform = 'rotate(' + heading.toFixed(1) + 'deg)';
}

let gpsPoll = null;
function setHeading(h) {
  if (h == null || isNaN(h)) return;
  // smooth
  let d = ((h - heading + 540) % 360) - 180;
  heading = (heading + d * 0.45 + 360) % 360;
  applyHeading();
}
async function enableCompass() {
  const onOrient = (e) => {
    let h = (typeof e.webkitCompassHeading === 'number') ? e.webkitCompassHeading : null;
    if (h == null && e.alpha != null) h = e.absolute ? (360 - e.alpha) : (360 - e.alpha);
    setHeading(h);
  };
  if (!window.DeviceOrientationEvent) return;
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const s = await DeviceOrientationEvent.requestPermission();
      if (s !== 'granted') return;
    }
    if (orientHandler) window.removeEventListener('deviceorientation', orientHandler, true);
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
    orientHandler = onOrient;
  } catch (e) { console.warn(e); }
}

function onGps(pos) {
      const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      updateGpsMarker(ll, pos.coords.accuracy);
      if (typeof pos.coords.heading === 'number' && !isNaN(pos.coords.heading) && pos.coords.speed > 0.4) setHeading(pos.coords.heading);
      if (recording) {
        const p = { lat: ll.lat, lng: ll.lng, t: Date.now(), ele: (pos.coords.altitude != null && !isNaN(pos.coords.altitude)) ? pos.coords.altitude : null };
        // skip if too close to last
        if (!recPoints.length || haversine(recPoints[recPoints.length-1], p) > 3) {
          recPoints.push(p);
          updateRecLine();
          updateTrackStat();
        }
      }
}
function startGpsWatch() {
  if (!navigator.geolocation) { showError('GPS non disponibile su questo browser'); return; }
  if (watchId != null) return;
  const opt = { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 };
  watchId = navigator.geolocation.watchPosition(onGps, err => { console.warn(err); }, opt);
  if (gpsPoll) clearInterval(gpsPoll);
  gpsPoll = setInterval(() => navigator.geolocation.getCurrentPosition(onGps, () => {}, opt), 500);
}


function stopGpsWatch() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (orientHandler) {
    window.removeEventListener('deviceorientation', orientHandler, true);
    orientHandler = null;
  }
}

function updateRecLine() {
  const latlngs = recPoints.map(p => [p.lat, p.lng]);
  if (!recPolyline) {
    recPolyline = L.polyline(latlngs, { color: activeColor, weight: 4, opacity: 0.9 }).addTo(map);
  } else {
    recPolyline.setLatLngs(latlngs);
  }
}

function updateTrackStat() {
  const dist = trackDistance(recPoints);
  const dur = recStart ? Date.now() - recStart : 0;
  document.getElementById('trackStat').textContent = fmtDist(dist) + ' · ' + fmtDur(dur);
  document.getElementById('trackSub').textContent = recPoints.length + ' punti · registrazione';
}

function startRecording() {
  startGpsWatch();
  recording = true;
  recPoints = [];
  recStart = Date.now();
  if (recPolyline) { map.removeLayer(recPolyline); recPolyline = null; }
  document.getElementById('trackBar').classList.add('show');
  updateTrackStat();
  // center on user once
  if (myMarker) map.setView(myMarker.getLatLng(), Math.max(map.getZoom(), 15));
  else map.locate({ setView: true, maxZoom: 16 });
}

function hideTrackBar() {
  const bar = document.getElementById('trackBar');
  if (bar) bar.classList.remove('show');
}
function stopRecording() {
  recording = false;
  hideTrackBar();
  status('Registrazione fermata');
}
function cancelRecording() {
  recording = false;
  routeMode = false;
  recPoints = [];
  recStart = null;
  routePoints = [];
  if (typeof clearRouteDraft === 'function') clearRouteDraft();
  if (recPolyline && map) { map.removeLayer(recPolyline); recPolyline = null; }
  const chip = document.getElementById('modeChip');
  if (chip) chip.classList.remove('show');
  hideTrackBar();
  status('Traccia annullata');
}
window.appStop = function() {
  if (routeMode && typeof cancelRouteMode === 'function') cancelRouteMode();
  else stopRecording();
};
window.appCancel = function() { cancelRecording(); };
window.appSave = function() {
  if (routeMode) saveRoute();
  else saveRecording();
};

async function saveRecording() {
  if (recPoints.length < 2) {
    alert('Traccia troppo corta');
    return;
  }
  const name = prompt('Nome traccia', 'Traccia ' + new Date().toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }));
  if (name == null) return;
  status('Calcolo quote…');
  const pts = recPoints.map(p => ({ lat: p.lat, lng: p.lng, t: p.t, ele: p.ele }));
  // fill missing elevations from DEM
  const need = pts.some(p => p.ele == null);
  if (need) await fetchElevations(pts);
  const tr = {
    id: 't' + Date.now(),
    name: name || 'Traccia',
    color: activeColor,
    type: 'gps',
    points: pts,
    visible: true,
    created: Date.now()
  };
  savedTracks.unshift(tr);
  persistTracks();
  drawSavedTrack(tr);
  recPoints = [];
  if (recPolyline) { map.removeLayer(recPolyline); recPolyline = null; }
  document.getElementById('trackBar').classList.remove('show');
  renderTracksList();
  status('Traccia salvata');
}

function discardRecording() {
  recording = false;
  recPoints = [];
  if (recPolyline) { map.removeLayer(recPolyline); recPolyline = null; }
  document.getElementById('trackBar').classList.remove('show');
}

/* Route mode: tap points on map */
function startRouteMode() {
  routeMode = true;
  routePoints = [];
  clearRouteDraft();
  document.getElementById('modeChip').classList.add('show');
  switchView('map');
  status('Tocca la mappa per aggiungere punti');
}

function clearRouteDraft() {
  if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
  routeMarkers.forEach(m => map.removeLayer(m));
  routeMarkers = [];
  routeGeom = [];
}

const SNAP_MAX_M = 10;
let routeGeom = [];
let routeBusy = false;

async function nearestPath(lat, lng) {
  try {
    const url = `https://router.project-osrm.org/nearest/v1/foot/${lng},${lat}?number=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const wp = data.waypoints && data.waypoints[0];
    if (!wp || !wp.location) return null;
    return { lng: wp.location[0], lat: wp.location[1], dist: wp.distance || 9999 };
  } catch (e) {
    return null;
  }
}

async function pathBetween(a, b) {
  try {
    const url = `https://router.project-osrm.org/route/v1/foot/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    return coords.map(c => ({ lng: c[0], lat: c[1] }));
  } catch (e) {
    return null;
  }
}

function redrawRoute() {
  const latlngs = routeGeom.map(p => [p.lat, p.lng]);
  if (!routePolyline) {
    routePolyline = L.polyline(latlngs, { color: activeColor, weight: 4, opacity: 0.95 }).addTo(map);
  } else {
    routePolyline.setLatLngs(latlngs);
    routePolyline.setStyle({ color: activeColor, dashArray: null });
  }
}

async function onMapClickRoute(e) {
  if (!routeMode || routeBusy) return;
  routeBusy = true;
  const raw = { lat: e.latlng.lat, lng: e.latlng.lng };
  status('Controllo sentiero…');
  const near = await nearestPath(raw.lat, raw.lng);
  const onPath = near && near.dist <= SNAP_MAX_M;
  const pt = onPath ? { lat: near.lat, lng: near.lng, snapped: true } : { lat: raw.lat, lng: raw.lng, snapped: false };
  const prev = routePoints[routePoints.length - 1];
  routePoints.push(pt);

  const m = L.circleMarker([pt.lat, pt.lng], {
    radius: 7, color: '#fff', weight: 2, fillColor: onPath ? activeColor : '#f5b942', fillOpacity: 1
  }).addTo(map);
  routeMarkers.push(m);

  if (!prev) {
    routeGeom = [{ lat: pt.lat, lng: pt.lng }];
  } else if (prev.snapped && pt.snapped) {
    status('Seguo il sentiero…');
    const seg = await pathBetween(prev, pt);
    if (seg && seg.length) {
      routeGeom.push(...seg.slice(1));
    } else {
      routeGeom.push({ lat: pt.lat, lng: pt.lng });
    }
  } else {
    routeGeom.push({ lat: pt.lat, lng: pt.lng });
  }
  redrawRoute();
  document.getElementById('trackBar').classList.add('show');
  document.getElementById('trackStat').textContent = routePoints.length + ' punti · ' + fmtDist(trackDistance(routeGeom));
  document.getElementById('trackSub').textContent = onPath
    ? 'Agganciato al sentiero'
    : 'Fuori sentiero: uso il punto toccato';
  document.getElementById('btnStopTrack').onclick = cancelRouteMode;
  document.getElementById('btnSaveTrack').onclick = saveRoute;
  routeBusy = false;
}

function cancelRouteMode() {
  routeMode = false;
  routePoints = [];
  clearRouteDraft();
  document.getElementById('modeChip').classList.remove('show');
  document.getElementById('trackBar').classList.remove('show');
  // restore GPS button handlers
  document.getElementById('btnStopTrack').onclick = () => { stopRecording(); };
  document.getElementById('btnSaveTrack').onclick = saveRecording;
}

async function saveRoute() {
  if (routePoints.length < 2) {
    alert('Aggiungi almeno 2 punti');
    return;
  }
  const name = prompt('Nome percorso', 'Percorso ' + new Date().toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }));
  if (name == null) return;
  status('Calcolo quote dal modello digitale…');
  const pts = (routeGeom.length >= 2 ? routeGeom : routePoints).map(p => ({ lat: p.lat, lng: p.lng }));
  await fetchElevations(pts);
  const tr = {
    id: 'r' + Date.now(),
    name: name || 'Percorso',
    color: activeColor,
    type: 'route',
    points: pts,
    visible: true,
    created: Date.now()
  };
  savedTracks.unshift(tr);
  persistTracks();
  drawSavedTrack(tr);
  cancelRouteMode();
  renderTracksList();
  status('Percorso salvato con quote');
}

function trackNumber(tr) {
  const ordered = savedTracks.slice().sort((a,b)=>(a.created||0)-(b.created||0));
  const i = ordered.findIndex(t => t.id === tr.id);
  return i >= 0 ? i + 1 : 0;
}
function showTrackHit(tr, latlng) {
  const n = trackNumber(tr);
  const html = `<div style="min-width:160px"><strong>#${n} ${esc(tr.name||'Traccia')}</strong><div style="margin-top:8px"><button id="hitDetail" style="height:32px;border:none;border-radius:8px;background:#3dcfb0;color:#08221c;font-weight:700;padding:0 10px">Dettagli</button></div></div>`;
  const pop = L.popup({ closeButton: true, autoPan: true }).setLatLng(latlng).setContent(html).openOn(map);
  setTimeout(() => {
    const b = document.getElementById('hitDetail');
    if (b) b.onclick = () => { map.closePopup(); openTrackDetail(tr); };
  }, 30);
}
function drawSavedTrack(tr) {
  if (tr.visible === false) { removeTrackFromMap(tr.id); return; }
  if (trackLayers[tr.id]) {
    map.removeLayer(trackLayers[tr.id].line);
    (trackLayers[tr.id].markers || []).forEach(m => map.removeLayer(m));
  }
  const latlngs = tr.points.map(p => [p.lat, p.lng]);
  const line = L.polyline(latlngs, {
    color: tr.color || '#3dcfb0',
    weight: 6,
    opacity: 0.9,
    dashArray: tr.type === 'route' ? '8 6' : null
  }).addTo(map);
  line.on('click', e => { L.DomEvent.stopPropagation(e); showTrackHit(tr, e.latlng); });
  const markers = [];
  if (tr.type === 'route') {
    tr.points.forEach((p, i) => {
      markers.push(L.circleMarker([p.lat, p.lng], {
        radius: 5, color: '#fff', weight: 1.5, fillColor: tr.color || '#3dcfb0', fillOpacity: 1
      }).addTo(map));
    });
  }
  trackLayers[tr.id] = { line, markers };
}

function removeTrackFromMap(id) {
  if (trackLayers[id]) {
    map.removeLayer(trackLayers[id].line);
    (trackLayers[id].markers || []).forEach(m => map.removeLayer(m));
    delete trackLayers[id];
  }
}



async function fetchElevations(points) {
  // Sample max ~40 points to stay within API limits
  const n = points.length;
  if (n === 0) return points;
  const step = Math.max(1, Math.floor(n / 40));
  const idxs = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);

  const lats = idxs.map(i => points[i].lat.toFixed(5)).join(',');
  const lngs = idxs.map(i => points[i].lng.toFixed(5)).join(',');
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('elev ' + res.status);
    const data = await res.json();
    const elevs = data.elevation || [];
    // map sampled elevations back, interpolate for others
    const sampled = {};
    idxs.forEach((idx, j) => {
      if (elevs[j] != null) sampled[idx] = elevs[j];
    });
    const keys = Object.keys(sampled).map(Number).sort((a,b)=>a-b);
    for (let i = 0; i < n; i++) {
      if (sampled[i] != null) {
        points[i].ele = sampled[i];
        continue;
      }
      // linear interp between surrounding samples
      let lo = keys[0], hi = keys[keys.length-1];
      for (let k = 0; k < keys.length - 1; k++) {
        if (keys[k] <= i && keys[k+1] >= i) { lo = keys[k]; hi = keys[k+1]; break; }
      }
      if (hi === lo) points[i].ele = sampled[lo];
      else {
        const t = (i - lo) / (hi - lo);
        points[i].ele = sampled[lo] * (1 - t) + sampled[hi] * t;
      }
    }
  } catch (e) {
    console.warn('Elevation fetch failed', e);
  }
  return points;
}

function elevStats(pts) {
  const eles = pts.map(p => p.ele).filter(e => e != null && !isNaN(e));
  if (eles.length < 2) {
    return { min: null, max: null, gain: null, loss: null, has: false, eles: [] };
  }
  let gain = 0, loss = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i-1].ele, b = pts[i].ele;
    if (a == null || b == null || isNaN(a) || isNaN(b)) continue;
    const d = b - a;
    if (d > 0.5) gain += d;      // filter GPS noise
    else if (d < -0.5) loss += -d;
  }
  return {
    min: Math.min(...eles),
    max: Math.max(...eles),
    gain,
    loss,
    has: true,
    eles: pts.map(p => (p.ele != null && !isNaN(p.ele)) ? p.ele : null)
  };
}

function profileSamples(pts) {
  const samples = [];
  let dist = 0, lastEle = null;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) dist += haversine(pts[i-1], pts[i]);
    if (pts[i].ele != null && !isNaN(pts[i].ele)) lastEle = pts[i].ele;
    samples.push({ d: dist, ele: lastEle });
  }
  if (samples.length < 2 || samples.every(s => s.ele == null)) return [];
  const total = samples[samples.length - 1].d;
  const out = [];
  let j = 0;
  const maxM = Math.min(total, 30000);
  for (let m = 0; m <= maxM; m += 1) {
    while (j < samples.length - 2 && samples[j+1].d < m) j++;
    const a = samples[j], b = samples[Math.min(j+1, samples.length-1)];
    const span = Math.max(b.d - a.d, 0.001);
    const t = Math.min(1, Math.max(0, (m - a.d) / span));
    const ea = a.ele != null ? a.ele : b.ele;
    const eb = b.ele != null ? b.ele : a.ele;
    out.push({ d: m, ele: ea + (eb - ea) * t });
  }
  if (!out.length || out[out.length-1].d < total) out.push({ d: total, ele: samples[samples.length-1].ele });
  return out;
}
function buildElevChart(pts) {
  const st = elevStats(pts);
  const prof = profileSamples(pts);
  if (!st.has || prof.length < 2) {
    return '<div class="elev-chart"><div class="clabel">Nessun dato altimetrico</div></div>';
  }
  window._elevProf = prof;
  const H = 150, pad = 18;
  const ppm = 2.4;
  const W = Math.max(340, Math.round(prof[prof.length-1].d * ppm) + pad * 2);
  const minE = st.min, maxE = st.max, range = Math.max(maxE - minE, 1);
  let d = '';
  const step = Math.max(1, Math.floor(prof.length / 800));
  for (let i = 0; i < prof.length; i += step) {
    const p = prof[i];
    const x = pad + (p.d / prof[prof.length-1].d) * (W - 2 * pad);
    const y = pad + (1 - (p.ele - minE) / range) * (H - 2 * pad);
    d += (d ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
  }
  const last = prof[prof.length-1];
  const lx = pad + (W - 2 * pad);
  const ly = pad + (1 - (last.ele - minE) / range) * (H - 2 * pad);
  d += 'L' + lx.toFixed(1) + ',' + ly.toFixed(1) + ' ';
  const area = d + `L${W-pad},${H-pad} L${pad},${H-pad} Z`;
  return `<div class="elev-chart">
    <div id="elevRead" class="clabel" style="text-align:left;margin-bottom:6px">0 m · ${Math.round(prof[0].ele)} m</div>
    <div id="elevScroll" style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:8px">
      <svg id="elevSvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <path d="${area}" fill="rgba(61,207,176,0.22)" stroke="none"/>
        <path d="${d}" fill="none" stroke="#3dcfb0" stroke-width="2"/>
        <line id="elevCursor" x1="${pad}" y1="${pad}" x2="${pad}" y2="${H-pad}" stroke="#f5b942" stroke-width="2"/>
      </svg>
    </div>
    <input id="elevScrub" type="range" min="0" max="${Math.round(prof[prof.length-1].d)}" value="0" step="1" style="width:100%;margin-top:8px"/>
    <div class="clabel">metro per metro · min ${Math.round(st.min)} m · max ${Math.round(st.max)} m · ${fmtDist(prof[prof.length-1].d)}</div>
  </div>`;
}
function bindElevScrub() {
  const scrub = document.getElementById('elevScrub');
  const prof = window._elevProf;
  if (!scrub || !prof || !prof.length) return;
  const move = () => {
    const m = Number(scrub.value);
    let best = prof[0];
    for (const p of prof) { if (p.d <= m) best = p; else break; }
    const read = document.getElementById('elevRead');
    if (read) read.textContent = m + ' m · ' + (best.ele!=null ? Number(best.ele).toFixed(1) : '–') + ' m s.l.m.';
    const svg = document.getElementById('elevSvg');
    const cur = document.getElementById('elevCursor');
    if (svg && cur && prof[prof.length-1].d) {
      const W = svg.width.baseVal.value || 340;
      const x = 18 + (m / prof[prof.length-1].d) * (W - 36);
      cur.setAttribute('x1', x); cur.setAttribute('x2', x);
      const sc = document.getElementById('elevScroll');
      if (sc) sc.scrollLeft = x - sc.clientWidth / 2;
    }
  };
  scrub.oninput = move;
  move();
}

function openTrackDetail(tr) {
  const dist = trackDistance(tr.points);
  const st = elevStats(tr.points);
  document.getElementById('tdTitle').textContent = '#' + trackNumber(tr) + ' ' + (tr.name || 'Traccia');
  document.getElementById('tdMeta').textContent =
    (tr.type === 'route' ? 'Percorso' : tr.type === 'gpx' ? 'GPX' : 'GPS') +
    ' · ' + tr.points.length + ' punti' +
    (tr.created ? ' · ' + new Date(tr.created).toLocaleDateString('it-IT') : '');
  let stats = `<div class="stat-box"><div class="sl">Distanza</div><div class="sv">${(dist/1000).toFixed(2)} km</div></div>`;
  if (st.has) {
    stats += `<div class="stat-box"><div class="sl">Dislivello +</div><div class="sv">+${Math.round(st.gain)} m</div></div>`;
    stats += `<div class="stat-box"><div class="sl">Dislivello −</div><div class="sv">−${Math.round(st.loss)} m</div></div>`;
    stats += `<div class="stat-box"><div class="sl">Quota min / max</div><div class="sv">${Math.round(st.min)} / ${Math.round(st.max)} m</div></div>`;
  } else {
    stats += `<div class="stat-box"><div class="sl">Dislivello</div><div class="sv">n/d</div></div>`;
    stats += `<div class="stat-box"><div class="sl">Quota min / max</div><div class="sv">n/d</div></div>`;
  }
  document.getElementById('tdStats').innerHTML = stats;
  document.getElementById('tdChart').innerHTML = buildElevChart(tr.points);
  bindElevScrub();
  document.getElementById('tdActs').innerHTML =
    `<button class="pri" id="tdShow">Vedi su mappa</button>
     <button id="tdGpx">Esporta GPX</button>
     <button id="tdDel" style="color:var(--danger)">Elimina</button>`;
  document.getElementById('trDetail').classList.add('open');
  document.getElementById('tdShow').onclick = () => {
    tr.visible = true;
    drawSavedTrack(tr);
    persistTracks();
    switchView('map');
    closeTrackDetail();
    const ll = tr.points.map(p => [p.lat, p.lng]);
    if (ll.length) map.fitBounds(ll, { padding: [50, 50] });
  };
  document.getElementById('tdGpx').onclick = () => exportGpx(tr);
  document.getElementById('tdDel').onclick = () => {
    if (confirm('Eliminare?')) {
      removeTrackFromMap(tr.id);
      savedTracks = savedTracks.filter(t => t.id !== tr.id);
      persistTracks();
      closeTrackDetail();
      renderTracksList();
    }
  };
}
function closeTrackDetail() {
  document.getElementById('trDetail').classList.remove('open');
}


function renderTracksList() {
  loadTracks();
  // ensure visible flag
  savedTracks.forEach(t => { if (t.visible === undefined) t.visible = true; });
  const list = document.getElementById('trList');
  document.getElementById('trCount').textContent = savedTracks.length + (savedTracks.length === 1 ? ' traccia' : ' tracce');
  if (!savedTracks.length) {
    list.innerHTML = '<div class="empty"><div class="big">📍</div><p>Nessuna traccia</p><p style="font-size:12px;margin-top:6px">Registra col pulsante ● oppure crea un percorso / carica GPX</p></div>';
    return;
  }
  const sort = (document.getElementById('trSort')||{}).value || 'new';
  const view = savedTracks.slice().sort((a,b) => {
    if (sort === 'az') return (a.name||'').localeCompare(b.name||'', 'it');
    if (sort === 'za') return (b.name||'').localeCompare(a.name||'', 'it');
    if (sort === 'old') return (a.created||0) - (b.created||0);
    return (b.created||0) - (a.created||0);
  });
  list.innerHTML = view.map(tr => {
    const dist = trackDistance(tr.points);
    const st = elevStats(tr.points);
    const type = tr.type === 'route' ? 'Percorso' : (tr.type === 'gpx' ? 'GPX' : 'GPS');
    const elevTxt = st.has
      ? ` · ↑${Math.round(st.gain)}m ↓${Math.round(st.loss)}m`
      : '';
    const on = tr.visible !== false;
    return `<div class="tr-card" data-id="${tr.id}">
      <div class="tr-head">
        <div class="color-dot" style="background:${tr.color||'#3dcfb0'};pointer-events:none"></div>
        <div class="cname">#${trackNumber(tr)} ${esc(tr.name)}</div>
        <span style="font-size:11px;color:var(--muted)">Mappa</span>
        <button class="toggle ${on?'on':''}" data-a="tog" title="Mostra o nascondi sulla mappa"></button>
      </div>
      <div class="meta">${type} · ${tr.points.length} pt · ${(dist/1000).toFixed(2)} km${elevTxt}</div>
      <div class="acts">
        <button data-a="open">Dettagli</button>
        <button data-a="map">Vai alla mappa</button>
        <button data-a="gpx">GPX</button>
        <button class="del" data-a="del">Elimina</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.tr-card').forEach(card => {
    const id = card.dataset.id;
    const tr = savedTracks.find(t => t.id === id);
    card.querySelectorAll('button').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const a = b.dataset.a;
        if (a === 'tog' && tr) {
          tr.visible = !(tr.visible !== false);
          b.classList.toggle('on', tr.visible);
          if (tr.visible) drawSavedTrack(tr);
          else removeTrackFromMap(id);
          persistTracks();
        } else if (a === 'open' && tr) {
          openTrackDetail(tr);
        } else if (a === 'map' && tr) {
          tr.visible = true;
          drawSavedTrack(tr);
          persistTracks();
          switchView('map');
          const ll = tr.points.map(p => [p.lat, p.lng]);
          if (ll.length) map.fitBounds(ll, { padding: [50, 50] });
        } else if (a === 'gpx' && tr) {
          exportGpx(tr);
        } else if (a === 'del') {
          if (confirm('Eliminare questa traccia?')) {
            removeTrackFromMap(id);
            savedTracks = savedTracks.filter(t => t.id !== id);
            persistTracks();
            renderTracksList();
          }
        }
      };
    });
    card.onclick = () => { if (tr) openTrackDetail(tr); };
  });
}


function exportGpx(tr) {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Grotte CSR" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(tr.name)}</name>
    <trkseg>
`;
  tr.points.forEach(p => {
    gpx += `      <trkpt lat="${p.lat}" lon="${p.lng}">`;
    if (p.ele != null && !isNaN(p.ele)) gpx += `
        <ele>${Number(p.ele).toFixed(1)}</ele>`;
    gpx += `</trkpt>
`;
  });
  gpx += `    </trkseg>
  </trk>
</gpx>`;
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (tr.name || 'traccia').replace(/[^\w\-]+/g, '_') + '.gpx';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importGpx(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = reader.result;
      const pts = [];
      // Match full trkpt/rtept blocks to get lat, lon, ele
      const blockRe = /<(trkpt|rtept|wpt)([^>]*)>([\s\S]*?)<\/\1>/gi;
      let m;
      while ((m = blockRe.exec(text))) {
        const attrs = m[2], body = m[3];
        let lat = attrs.match(/\blat=["']([^"']+)["']/i);
        let lon = attrs.match(/\blon=["']([^"']+)["']/i);
        if (!lat || !lon) continue;
        let ele = null;
        const em = body.match(/<ele>\s*([\-0-9.]+)\s*<\/ele>/i);
        if (em) ele = parseFloat(em[1]);
        pts.push({ lat: parseFloat(lat[1]), lng: parseFloat(lon[1]), ele });
      }
      // self-closing trkpt
      if (!pts.length) {
        const re = /<(?:trkpt|rtept|wpt)[^>]*\blat=["']([^"']+)["'][^>]*\blon=["']([^"']+)["'][^>]*\/?>/gi;
        while ((m = re.exec(text))) {
          pts.push({ lat: parseFloat(m[1]), lng: parseFloat(m[2]), ele: null });
        }
      }
      if (pts.length < 2) {
        alert('Nessun punto trovato nel GPX');
        return;
      }
      let nameMatch = text.match(/<name>\s*([^<]+)\s*<\/name>/i);
      const name = (nameMatch ? nameMatch[1] : (file.name || 'Import GPX')).replace(/\.gpx$/i, '');
      const tr = {
        id: 'g' + Date.now(),
        name,
        color: activeColor,
        type: 'gpx',
        points: pts,
        visible: true,
        created: Date.now()
      };
      (async () => {
        if (pts.some(p => p.ele == null)) {
          status('Calcolo quote mancanti…');
          await fetchElevations(pts);
          tr.points = pts;
        }
        savedTracks.unshift(tr);
        persistTracks();
        drawSavedTrack(tr);
        renderTracksList();
        switchView('map');
        map.fitBounds(pts.map(p => [p.lat, p.lng]), { padding: [40, 40] });
        status('GPX importato: ' + pts.length + ' punti');
      })();
    } catch (e) {
      alert('Errore lettura GPX');
      console.error(e);
    }
  };
  reader.readAsText(file);
}

function initTrackingUI() {
  loadTracks();
  savedTracks.forEach(tr => { if (tr.visible !== false) drawSavedTrack(tr); });
  renderTracksList();

  document.getElementById('tdClose') && (document.getElementById('tdClose').onclick = closeTrackDetail);
  window.appCloseDetail = closeTrackDetail;
  
  const btnTopo = document.getElementById('btnTopo');
  if (btnTopo) {
    btnTopo.onclick = () => {
      topoOn = !topoOn;
      btnTopo.classList.toggle('on', topoOn);
      if (topoOn) {
        map.removeLayer(baseOsm);
        baseTopo.addTo(map);
        status('Mappa topografica (OpenTopoMap)');
      } else {
        map.removeLayer(baseTopo);
        baseOsm.addTo(map);
        status('Mappa OpenStreetMap');
      }
    };
  }

  const btnStartRec = document.getElementById('btnStartRec');
  if (btnStartRec) {
    btnStartRec.onclick = () => {
      if (routeMode) cancelRouteMode();
      switchView('map');
      startRecording();
    };
  }
  document.getElementById('btnStopTrack').onclick = () => {
    if (routeMode) cancelRouteMode();
    else stopRecording();
  };
  const btnCancel = document.getElementById('btnCancelTrack');
  if (btnCancel) btnCancel.onclick = () => {
    if (routeMode) cancelRouteMode();
    else cancelRecording();
  };
  document.getElementById('btnSaveTrack').onclick = () => {
    if (routeMode) saveRoute();
    else saveRecording();
  };
  document.getElementById('btnNewRoute').onclick = startRouteMode;
  const trSort = document.getElementById('trSort');
  if (trSort) trSort.onchange = () => renderTracksList();
  document.getElementById('gpxInput').onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importGpx(f);
    e.target.value = '';
  };
  document.querySelectorAll('#colorPick .color-dot').forEach(dot => {
    dot.onclick = () => {
      document.querySelectorAll('#colorPick .color-dot').forEach(d => d.classList.remove('on'));
      dot.classList.add('on');
      activeColor = dot.dataset.c;
    };
  });

  map.on('click', onMapClickRoute);

  // enhance locate button: start GPS watch + center
  const oldLocate = document.getElementById('locateBtn').onclick;
  document.getElementById('locateBtn').onclick = () => {
    startGpsWatch();
    map.locate({ setView: true, maxZoom: 16 });
  };
}


async function init(){
  const tb=document.getElementById('trackBar'); if(tb) tb.classList.remove('show');
  const td=document.getElementById('trDetail'); if(td) td.classList.remove('open');
  const ps=document.getElementById('poiSheet'); if(ps){ ps.classList.remove('show'); ps.style.display='none'; }

  initMap();
  await openDB();
  document.getElementById('offlineBadge').classList.toggle('show',!navigator.onLine);
  window.addEventListener('online',()=>document.getElementById('offlineBadge').classList.remove('show'));
  window.addEventListener('offline',()=>document.getElementById('offlineBadge').classList.add('show'));

  document.getElementById('closeCard').onclick=closeCard;
  document.getElementById('navPinClose').onclick=hideNavPin;
  window.appSavePoi = () => { poiDraft = window._pinLL || null; if (!poiDraft) { status('Tieni premuto un punto sulla mappa'); return; } openPoiSheet(); };
  const navSave = document.getElementById('navPinSave');
  if (navSave) navSave.onclick = window.appSavePoi;
  document.getElementById('poiOk').onclick = savePoi;
  document.getElementById('poiCancel').onclick = () => document.getElementById('poiSheet').classList.remove('show'); document.getElementById('poiSheet').style.display='none';
  const poiSort = document.getElementById('poiSort');
  if (poiSort) poiSort.onchange = () => renderPoiList();
  renderPoiList();
  loadPois(); drawPois();
  document.getElementById('filterBtn').onclick=()=>document.getElementById('filters').classList.toggle('open');
  document.getElementById('applyFilters').onclick=filter;
  document.getElementById('search').oninput=deb(filter,250);
  document.getElementById('locateBtn').onclick=()=>{
    enableCompass();
    startGpsWatch();
    map.locate({setView:true,maxZoom:16});
    status('Cerco la posizione…');
  };
  map.on('locationfound',e=>{
    updateGpsMarker(e.latlng, e.accuracy);
    map.setView(e.latlng, Math.max(map.getZoom(), 15));
  });
  map.on('locationerror',e=>{ showError('Posizione non disponibile: consenti il GPS'); });
  const recBtn=document.getElementById('btnStartRec');
  if(recBtn) recBtn.onclick=()=>{ enableCompass(); if(routeMode) cancelRouteMode(); switchView('map'); startRecording(); status('Registrazione avviata'); };
  const routeBtn=document.getElementById('btnNewRoute');
  if(routeBtn) routeBtn.onclick=()=>startRouteMode();
  map.on('dragstart',closeCard);
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));

  try{
    const r=await fetch('grotte_sardegna.geojson');
    const g=await r.json();
    all=g.features||[];
    all.forEach(f=>{
      const p=f.properties||{};
      const cat=padCat(p.codice);
      if(cat){
        p.codice=cat;
        const base=(p.nome_reale||p.nome||'').replace(/^\d+\s*-\s*/,'');
        if(base) p.nome=cat+' - '+base;
      }
    });
    draw(all);
    status(all.length+' grotte');
  }catch(e){status('Errore dati');showError('Impossibile caricare le grotte: '+e.message);console.error(e);}

  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('sw.js');}catch(e){}}
  renderFavs();
  initTrackingUI();
}
init();
