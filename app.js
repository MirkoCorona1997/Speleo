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

/* Fetch real name from SIRA (via CORS proxies, with fallback) */
async function fetchNomeOnline(id_ost){
  if(!id_ost || !navigator.onLine) return null;
  const target=encodeURIComponent(`https://portal.sardegnasira.it/dettaglio-grotte-aree-carsiche?id_ost=${id_ost}&tipologia=Grotta`);
  const proxies=[
    `https://api.allorigins.win/raw?url=${target}`,
    `https://corsproxy.io/?${target}`
  ];
  for(const proxy of proxies){
    try{
      const ctrl=new AbortController();
      const t=setTimeout(()=>ctrl.abort(),12000);
      const res=await fetch(proxy,{signal:ctrl.signal});
      clearTimeout(t);
      if(!res.ok) continue;
      const html=await res.text();
      const m=html.match(/Denominazione sito:[\s\S]*?<span class="td-content">([^<]{2,100})<\/span>/i);
      let nome=m?m[1].trim():null;
      if(!nome){
        const m2=html.match(/Denominazione sito:[\s\S]{0,200}?>(Grotta[^<]{3,80}|Abisso[^<]{3,60}|Voragine[^<]{3,60}|Pozzo[^<]{3,60}|Brecca[^<]{3,60})/i);
        if(m2) nome=m2[1].trim();
      }
      let codice=null;
      const mc=html.match(/Codice grotta:[\s\S]*?<span class="td-content">(\d{2,6})<\/span>/i);
      if(mc) codice=mc[1].trim();
      if(nome) return {nome, codice};
    }catch(e){ /* try next proxy */ }
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
    f.properties.nome=cached.codice?`${cached.codice} - ${cached.nome}`:cached.nome;
    return f.properties.nome;
  }

  // 3) online
  const titleEl=document.getElementById('cardTitle');
  const idEl=document.getElementById('cardId');
  if(titleEl) titleEl.innerHTML=esc(f.properties.nome)+' <span style="font-size:12px;color:#9aabbc;font-weight:500">…</span>';

  const data=await fetchNomeOnline(id);
  if(data && data.nome){
    f.properties.nome_reale=data.nome;
    f.properties.codice=data.codice||null;
    f.properties.nome=data.codice?`${data.codice} - ${data.nome}`:data.nome;
    saveNameCache(id, data.nome, data.codice);
    if(titleEl && cur===f){
      titleEl.textContent=f.properties.nome;
      if(idEl) idEl.textContent=data.codice?('N. catastale  '+data.codice):('ID SIRA  '+id);
    }
    return f.properties.nome;
  } else {
    if(titleEl && cur===f) titleEl.textContent=f.properties.nome;
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
      <div class="id">${it.codice?('N. '+esc(it.codice)):('ID '+esc(it.id_ost))}</div>
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
  if(n==='map'&&map) setTimeout(()=>map.invalidateSize(),40);
  closeCard(); hideNavPin();
}

function initMap(){
  if(typeof L==='undefined'){showError('Leaflet non caricato. Controlla la connessione e ricarica.');return;}
  map=L.map('map',{zoomControl:false,attributionControl:false}).setView([40.05,9.0],8);
  setTimeout(()=>{try{map.invalidateSize();}catch(e){}},200);
  setTimeout(()=>{try{map.invalidateSize();}catch(e){}},600);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18}).addTo(map);
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

function showNavPin(latlng){
  closeCard();
  if(navMarker) map.removeLayer(navMarker);
  navMarker=L.circleMarker(latlng,{radius:10,color:'#3dcfb0',fillColor:'#3dcfb0',fillOpacity:0.35,weight:2}).addTo(map);
  const la=latlng.lat.toFixed(5), lo=latlng.lng.toFixed(5);
  document.getElementById('navPinText').textContent=`Punto ${la}, ${lo}`;
  document.getElementById('navPinGoogle').href=`https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=driving`;
  document.getElementById('navPinApple').href=`https://maps.apple.com/?daddr=${la},${lo}&dirflg=d`;
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
  document.getElementById('cardTitle').textContent=p.nome||'Grotta';
  document.getElementById('cardId').textContent=p.codice?('N. catastale  '+p.codice):(p.id_ost?('ID SIRA  '+p.id_ost):'');
  document.getElementById('cardMeta').innerHTML=
    (p.comune?`<span class="pill"><strong>${esc(p.comune)}</strong></span>`:'')+
    (p.provincia?`<span class="pill">${esc(p.provincia)}</span>`:'')+
    (p.ambito?`<span class="pill">${esc(p.ambito)}</span>`:'')+
    `<span class="pill">${la.toFixed(5)}, ${lo.toFixed(5)}</span>`;
  document.getElementById('cardActions').innerHTML=
    (p.scheda_url?`<a class="ba" href="${p.scheda_url}" target="_blank" rel="noopener">Scheda + PDF</a>`:'')+
    `<a class="bb" href="https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=driving" target="_blank" rel="noopener">Google Maps</a>`+
    `<a class="bb" href="https://maps.apple.com/?daddr=${la},${lo}&dirflg=d" target="_blank" rel="noopener">Apple Maps</a>`+
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
      const h=`${p.nome||''} ${p.nome_reale||''} ${p.comune||''} ${p.provincia||''} ${p.id_ost||''} ${p.codice||''}`.toLowerCase();
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

async function init(){
  initMap();
  await openDB();
  document.getElementById('offlineBadge').classList.toggle('show',!navigator.onLine);
  window.addEventListener('online',()=>document.getElementById('offlineBadge').classList.remove('show'));
  window.addEventListener('offline',()=>document.getElementById('offlineBadge').classList.add('show'));

  document.getElementById('closeCard').onclick=closeCard;
  document.getElementById('navPinClose').onclick=hideNavPin;
  document.getElementById('filterBtn').onclick=()=>document.getElementById('filters').classList.toggle('open');
  document.getElementById('applyFilters').onclick=filter;
  document.getElementById('search').oninput=deb(filter,250);
  document.getElementById('locateBtn').onclick=()=>map.locate({setView:true,maxZoom:13});
  map.on('locationfound',e=>{L.circle(e.latlng,{radius:e.accuracy/2,color:'#3dcfb0',fillOpacity:.1,weight:1}).addTo(map);});
  map.on('dragstart',closeCard);
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));

  try{
    const r=await fetch('grotte_sardegna.geojson');
    const g=await r.json();
    all=g.features||[];
    draw(all);
    status(all.length+' grotte');
  }catch(e){status('Errore dati');showError('Impossibile caricare le grotte: '+e.message);console.error(e);}

  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('sw.js');}catch(e){}}
  renderFavs();
}
init();
