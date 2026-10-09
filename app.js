const DB_NAME='csr-grotte-db', DB_VERSION=1, STORE='preferiti';
let map, markersLayer, allFeatures=[], currentFeature=null, db=null;

function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id_ost'});};
    r.onsuccess=e=>{db=e.target.result;resolve(db);};
    r.onerror=e=>reject(e.target.error);
  });
}
function savePreferito(feat){
  if(!db||!feat.properties.id_ost)return Promise.resolve();
  const p=feat.properties;
  return new Promise(res=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({id_ost:p.id_ost,nome:p.nome,comune:p.comune,provincia:p.provincia,ambito:p.ambito,scheda_url:p.scheda_url,coordinates:feat.geometry.coordinates,savedAt:new Date().toISOString()});
    tx.oncomplete=()=>{updateFavBtn(true);showStatus('Salvata nei preferiti ✓');renderPreferiti();res();};
  });
}
function removePreferito(id){
  if(!db||!id)return Promise.resolve();
  return new Promise(res=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete=()=>{updateFavBtn(false);showStatus('Rimossa dai preferiti');renderPreferiti();res();};
  });
}
function isPreferito(id){
  return new Promise(res=>{
    if(!db||!id)return res(false);
    const tx=db.transaction(STORE,'readonly');
    const r=tx.objectStore(STORE).get(id);
    r.onsuccess=()=>res(!!r.result);
  });
}
function getAllPreferiti(){
  return new Promise(res=>{
    if(!db)return res([]);
    const tx=db.transaction(STORE,'readonly');
    const r=tx.objectStore(STORE).getAll();
    r.onsuccess=()=>res(r.result||[]);
  });
}
async function updateFavBtn(force){
  const btn=document.getElementById('favBtn');
  if(!currentFeature)return;
  const saved=force!==undefined?force:await isPreferito(currentFeature.properties.id_ost);
  btn.textContent=saved?'★':'☆';
  btn.style.color=saved?'#f5b942':'#8b9bb4';
}

async function renderPreferiti(){
  const list=document.getElementById('favList');
  const items=await getAllPreferiti();
  document.getElementById('favCount').textContent=items.length+(items.length===1?' grotta salvata':' grotte salvate');
  if(!items.length){
    list.innerHTML='<div class="empty"><div class="big">★</div><p>Nessuna grotta salvata</p><p style="margin-top:8px;font-size:13px">Dalla mappa tocca una grotta e premi ★</p></div>';
    return;
  }
  items.sort((a,b)=>(a.nome||'').localeCompare(b.nome||'','it'));
  list.innerHTML=items.map(it=>{
    const nome=esc(it.nome||'Grotta');
    const meta=[it.comune,it.provincia].filter(Boolean).join(' · ')||'—';
    return `<div class="fav-card" data-id="${it.id_ost}">
      <div class="info">
        <div class="nome">${nome}</div>
        <div class="meta">${esc(meta)}</div>
        <div class="badge">ID ${it.id_ost||'—'}</div>
      </div>
      <div class="fav-btns">
        <button data-a="map" title="Mappa">🗺️</button>
        <button data-a="nav" title="Naviga">🧭</button>
        ${it.scheda_url?'<button data-a="scheda" title="Scheda">📄</button>':''}
        <button class="del" data-a="del" title="Rimuovi">🗑️</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.fav-card').forEach(card=>{
    const id=card.dataset.id;
    const item=items.find(i=>i.id_ost===id);
    card.querySelectorAll('button').forEach(btn=>{
      btn.onclick=e=>{
        e.stopPropagation();
        const a=btn.dataset.a;
        if(a==='del'){if(confirm('Rimuovere dai preferiti?'))removePreferito(id);}
        else if(a==='map'&&item?.coordinates){
          switchView('map');
          map.setView([item.coordinates[1],item.coordinates[0]],15);
          const f=allFeatures.find(x=>x.properties.id_ost===id);
          if(f)openSheet(f);
        }else if(a==='nav'&&item?.coordinates){
          const [lon,lat]=item.coordinates;
          window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`,'_blank');
        }else if(a==='scheda'&&item?.scheda_url){
          window.open(item.scheda_url,'_blank');
        }
      };
    });
    card.onclick=()=>{
      const f=allFeatures.find(x=>x.properties.id_ost===id);
      if(f){switchView('map');map.setView([f.geometry.coordinates[1],f.geometry.coordinates[0]],15);openSheet(f);}
      else if(item?.scheda_url)window.open(item.scheda_url,'_blank');
    };
  });
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelector(`.tab[data-view="${name}"]`).classList.add('active');
  if(name==='preferiti')renderPreferiti();
  if(name==='map'&&map)setTimeout(()=>map.invalidateSize(),50);
  closeSheet();
}

function initMap(){
  map=L.map('map',{zoomControl:false,attributionControl:true}).setView([40.05,9.0],8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OSM'}).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
  markersLayer=L.layerGroup().addTo(map);
}
function createMarker(f){
  const [lon,lat]=f.geometry.coordinates;
  const m=L.circleMarker([lat,lon],{radius:7,fillColor:'#1fa97a',color:'#fff',weight:1.5,opacity:1,fillOpacity:0.9});
  m.on('click',()=>openSheet(f));
  return m;
}
function renderMarkers(feats){
  markersLayer.clearLayers();
  feats.forEach(f=>createMarker(f).addTo(markersLayer));
  document.getElementById('status').textContent=feats.length+' grotte';
}

function openSheet(feature){
  currentFeature=feature;
  const p=feature.properties;
  const [lon,lat]=feature.geometry.coordinates;
  document.getElementById('sheetTitle').textContent=p.nome||'Grotta';
  document.getElementById('sheetId').textContent=p.id_ost?('ID '+p.id_ost):'';
  document.getElementById('sheetBody').innerHTML=`
    <div class="meta-grid">
      <div class="meta-item"><div class="label">Comune</div><div class="value">${esc(p.comune||'—')}</div></div>
      <div class="meta-item"><div class="label">Provincia</div><div class="value">${esc(p.provincia||'—')}</div></div>
      <div class="meta-item"><div class="label">Ambito</div><div class="value">${esc(p.ambito||'—')}</div></div>
      <div class="meta-item"><div class="label">ID SIRA</div><div class="value">${esc(p.id_ost||'—')}</div></div>
    </div>
    <div class="coords">${lat.toFixed(5)} N · ${lon.toFixed(5)} E</div>
    <div class="btn-row">
      ${p.scheda_url?`<a class="btn-main" href="${p.scheda_url}" target="_blank" rel="noopener">Scheda completa · dislivello + PDF</a>`:''}
      <a class="btn-sec" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving" target="_blank" rel="noopener">Naviga con Google Maps</a>
      <a class="btn-sec" href="https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d" target="_blank" rel="noopener">Naviga con Apple Maps</a>
      <button class="btn-ghost" id="saveBtn">Salva nei preferiti</button>
    </div>
    <p class="hint">Nella scheda ufficiale trovi dislivello, sviluppo, descrizione e i file dei rilievi (PDF/DWG).</p>
  `;
  document.getElementById('sheet').classList.add('open');
  updateFavBtn();
  document.getElementById('saveBtn')?.addEventListener('click',()=>savePreferito(feature));
  document.getElementById('favBtn').onclick=async()=>{
    const s=await isPreferito(p.id_ost);
    if(s)removePreferito(p.id_ost);else savePreferito(feature);
  };
}
function closeSheet(){
  document.getElementById('sheet').classList.remove('open');
  currentFeature=null;
}

function applyFilters(){
  const q=document.getElementById('search').value.trim().toLowerCase();
  const prov=document.getElementById('provinciaFilter').value;
  const amb=document.getElementById('ambitoFilter').value;
  const filtered=allFeatures.filter(f=>{
    const p=f.properties;
    if(prov&&p.provincia!==prov)return false;
    if(amb&&p.ambito!==amb)return false;
    if(q){
      const hay=`${p.nome||''} ${p.comune||''} ${p.provincia||''} ${p.ambito||''} ${p.id_ost||''}`.toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  });
  renderMarkers(filtered);
  document.getElementById('filters').classList.remove('open');
}
function showStatus(msg){
  const el=document.getElementById('status');
  el.textContent=msg;
  setTimeout(()=>{if(el.textContent===msg)el.textContent=allFeatures.length+' grotte';},2500);
}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}

async function init(){
  initMap();
  await openDB();
  document.getElementById('offlineBadge').classList.toggle('show',!navigator.onLine);
  window.addEventListener('online',()=>document.getElementById('offlineBadge').classList.remove('show'));
  window.addEventListener('offline',()=>document.getElementById('offlineBadge').classList.add('show'));

  document.getElementById('closeSheet').onclick=closeSheet;
  document.getElementById('filterBtn').onclick=()=>document.getElementById('filters').classList.toggle('open');
  document.getElementById('applyFilters').onclick=applyFilters;
  document.getElementById('search').addEventListener('input',debounce(applyFilters,280));
  document.getElementById('locateBtn').onclick=()=>map.locate({setView:true,maxZoom:13});
  map.on('locationfound',e=>{L.circle(e.latlng,{radius:e.accuracy/2,color:'#3b9eff',fillOpacity:0.12}).addTo(map);});
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchView(t.dataset.view)));

  try{
    const res=await fetch('grotte_sardegna.geojson');
    const gj=await res.json();
    allFeatures=gj.features||[];
    renderMarkers(allFeatures);
    showStatus(allFeatures.length+' grotte caricate');
  }catch(e){showStatus('Errore caricamento');console.error(e);}

  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('sw.js');}catch(e){}}
  renderPreferiti();
}
init();
