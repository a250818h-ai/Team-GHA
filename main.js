// main.js - MapLibre による地図表示とマーカー管理
(function(){
  console.log('Script loaded');
  const center = [140.1064, 35.6074]; // 初期中心座標（経度, 緯度） 千葉エリア
  const mapContainer = document.getElementById('map');
  let currentLocationControl = null;
  if(!mapContainer){
    console.error('Map container not found');
    return;
  }
  console.log('Creating map...');
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {},
      layers: []
    },
    center: center,
    zoom: 11,
    pitch: 45,
    bearing: 0,
    antialias: true
  });
  console.log('Map created');

  const shops = [];
  let shopMarkers = [];
  let remoteMarkers = [];
  // GeoJSON source id for clustered points
  const SHOPS_SOURCE_ID = 'shops';
  
  // Google SheetsのCSV URL
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSUmchphCUTPwyilugQYslVA8NEuSUhtcEcrVbzZudlNmxlYLWjViuBqfLbUPMjin0F-sG_aXyhSejV/pub?gid=31963048&single=true&output=csv";

  // ユーティリティ: テキスト正規化（比較用）
  function normalizeText(s){
    if(!s) return '';
    return String(s).toLowerCase().replace(/[^\w\u3040-\u30ff\u4e00-\u9fff]+/g,'').trim();
  }

  function generateIndexTabs(){
    const tabsContainer = document.getElementById('index-tabs');
    if(!tabsContainer) return;
    tabsContainer.innerHTML = '';
    
    // 全店舗から最初の文字を抽出してユニークにしてソート
    const firstChars = new Set(shopMarkers.map(m => (m.item.name || '')[0])).values();
    const sortedChars = Array.from(firstChars).sort();
    
    const allBtn = document.createElement('button');
    allBtn.textContent = 'すべて';
    allBtn.className = 'active';
    allBtn.addEventListener('click', ()=>{
      document.getElementById('search').value = '';
      document.querySelectorAll('#index-tabs button').forEach(b=>b.classList.remove('active'));
      allBtn.classList.add('active');
      populateList();
      document.getElementById('search-status').textContent = '';
    });
    tabsContainer.appendChild(allBtn);
    
    sortedChars.forEach(char=>{
      const btn = document.createElement('button');
      btn.textContent = char;
      btn.addEventListener('click', ()=>{
        document.getElementById('search').value = '';
        document.querySelectorAll('#index-tabs button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const filtered = shopMarkers.filter(m => (m.item.name || '')[0] === char);
        populateList(filtered);
        document.getElementById('search-status').textContent = `${filtered.length} 件`;
      });
      tabsContainer.appendChild(btn);
    });
  }

  function avgRating(item){
    if(!item.reviews || item.reviews.length===0) return null;
    const s = item.reviews.reduce((a,b)=>a+b.score,0);
    return (s / item.reviews.length);
  }

  function isDuplicateItem(newItem){
    const normalized = normalizeItem(newItem);
    if(!normalized || !normalized.name) return false;
    const nName = normalizeText(normalized.name);
    const nAddr = normalizeText(normalized.address || '');
    for(const m of shopMarkers){
      const it = m.item;
      const iname = normalizeText(it.name);
      const iaddr = normalizeText(it.address || '');
      if(iname && nName && iname === nName){
        if(iaddr && nAddr && iaddr === nAddr) return true;
        if(it.lat != null && it.lon != null && normalized.lat != null && normalized.lon != null){
          const d = haversine(it.lat, it.lon, normalized.lat, normalized.lon);
          if(d < 0.2) return true;
        } else {
          return true;
        }
      }
    }
    return false;
  }

  function popupHtml(item){
    const rating = avgRating(item);
    const ratingHtml = rating != null ? `<span class="rating-badge">${rating.toFixed(1)}</span>` : '';
    const placeholder = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="140"><rect fill="%23eeeeee" width="100%25" height="100%25"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="14" fill="%23999">No Image</text></svg>';
    const imgSrc = (item.photo && String(item.photo).trim()) ? item.photo : placeholder;
    return `
      <div class="popup">
        <img src="${imgSrc}" alt="${item.name}" onerror="this.src='${placeholder}'">
        <div style="display:flex;align-items:center;gap:8px"><strong>${item.name}</strong>${ratingHtml}</div>
        <div>${item.address || ''}</div>
        <div>${item.hours || ''}</div>
        ${item.url?`<div><a href="${item.url}" target="_blank">公式サイト</a></div>`:''}
      </div>`;
  }

  // ★修正箇所：normalizeItem 関数
  function isValidLatLon(lat, lon){
    return typeof lat === 'number' && typeof lon === 'number'
      && Number.isFinite(lat) && Number.isFinite(lon)
      && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function parseCoordinatePair(value){
    if(value == null) return null;
    const text = String(value).trim().replace(/[()（）\uFEFF]/g, '');
    if(!text) return null;
    const parts = text.split(/[,	;\/\s]+/).filter(Boolean);
    if(parts.length < 2) return null;
    const lat = Number(parts[0].trim());
    const lon = Number(parts[1].trim());
    if(isValidLatLon(lat, lon)) return {lat, lon};
    if(isValidLatLon(Number(parts[1].trim()), Number(parts[0].trim()))) return {lat: Number(parts[1].trim()), lon: Number(parts[0].trim())};
    return null;
  }

  function normalizeItem(item){
    if(!item || typeof item !== 'object') return null;
    const normalized = {};
    for(const key of Object.keys(item)){
      const cleanKey = String(key)
        .trim()
        .toLowerCase()
        .replace(/\(.*?\)/g, '')
        .replace(/例.*$/g, '')
        .replace(/[\r\n]/g, ' ')
        .replace(/[\s、・,]+/g, '')
        .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff]+/g, '');
      normalized[cleanKey] = item[key];
    }
    
    const result = {
      name: normalized.name || normalized.shop || normalized.title || normalized['店舗名'] || normalized['店名'] || normalized['名前'] || '',
      address: normalized.address || normalized.addr || normalized['住所'] || '',
      hours: normalized.hours || normalized.opening_hours || normalized.open || normalized['営業時間'] || '',
      photo: normalized.photo || normalized.image || normalized.img || '',
      url: normalized.url || normalized.website || '',
      city: normalized.city || '',
      prefecture: normalized.prefecture || normalized.state || normalized.region || normalized['県'] || '',
      _remote: normalized._remote || false,
      // category も genre として読み込めるように追加
      genre: normalized.genre || normalized.category || normalized.type || normalized['ジャンル'] || normalized['カテゴリー'] || '',
      reviews: Array.isArray(normalized.reviews) ? normalized.reviews : [],
    };

    let lat = null;
    let lon = null;

    const combined = normalized['座標'] || normalized['緯度経度'] || normalized['latlon'] || normalized['coordinates'] || normalized['location'] || normalized['coordinate'];
    const combinedPair = parseCoordinatePair(combined);
    if(combinedPair){
      lat = combinedPair.lat;
      lon = combinedPair.lon;
    } else {
      const rawLat = normalized.lat || normalized.latitude || normalized['緯度'];
      const rawLon = normalized.lon || normalized.longitude || normalized.lng || normalized.lngt || normalized['経度'];
      const parsedPair = parseCoordinatePair(rawLat) || parseCoordinatePair(rawLon) || parseCoordinatePair(`${rawLat || ''} ${rawLon || ''}`);
      if(parsedPair){
        lat = parsedPair.lat;
        lon = parsedPair.lon;
      } else {
        const cleanedLat = rawLat != null ? Number(String(rawLat).trim().replace(/[()（）\uFEFF]/g, '')) : null;
        const cleanedLon = rawLon != null ? Number(String(rawLon).trim().replace(/[()（）\uFEFF]/g, '')) : null;
        if(isValidLatLon(cleanedLat, cleanedLon)){
          lat = cleanedLat;
          lon = cleanedLon;
        } else if(isValidLatLon(cleanedLon, cleanedLat)){
          lat = cleanedLon;
          lon = cleanedLat;
        }
      }
    }

    result.lat = isValidLatLon(lat, lon) ? lat : null;
    result.lon = isValidLatLon(lat, lon) ? lon : null;
    return result;
  }

  const GENRE_COLORS = {
    '豚骨':'#c0392b',
    '醤油':'#3498db',
    '味噌':'#f1c40f',
    '塩':'#2ecc71',
    '家系':'#34495e',
    '二郎系':'#9b59b6',
    'school':'#2563eb',
    'station':'#dc2626',
    'park':'#16a34a',
    'tourism':'#f59e0b',
    'iekei':'#34495e',       // スプレッドシート側の入力値(iekei)の色
    'tsukemen':'#8e44ad',    // スプレッドシート側の入力値(tsukemen)の色
    'jiro':'#9b59b6',        // スプレッドシート側の入力値(jiro)の色
    'aburasoba':'#d35400',   // スプレッドシート側の入力値(aburasoba)の色
    'jimotokei':'#27ae60'    // スプレッドシート側の入力値(jimotokei)の色
  };

  function addMarker(item, preventRefresh = false){
    if(!item) return;
    const normalized = normalizeItem(item);
    if(!normalized.name) return;
    if(!normalized.reviews) normalized.reviews = [];
    shopMarkers.push({marker: null, item: normalized});
    if(normalized._remote) remoteMarkers.push({marker: null, item: normalized});
    if(!shops.includes(normalized)) shops.push(normalized);
    if (!preventRefresh) {
      refreshShopsSource();
    }
  }

  function refreshShopsSource(){
    try{
      const features = shopMarkers.filter(m=>m.item && m.item.lat!=null && m.item.lon!=null).map(m=>({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(m.item.lon), Number(m.item.lat)] },
        properties: {
          item: JSON.stringify(m.item),
          name: m.item.name || '',
          genre: m.item.genre || ''
        }
      }));
      const geojson = { type: 'FeatureCollection', features };
      const src = map.getSource(SHOPS_SOURCE_ID);
      if(src && typeof src.setData === 'function'){
        src.setData(geojson);
      }
    }catch(e){ console.warn('refreshShopsSource error', e); }
  }

  function clearRemoteMarkers(){
    remoteMarkers.forEach(m=>{ try{ if(m.marker && typeof m.marker.remove === 'function') m.marker.remove(); }catch(e){} });
    remoteMarkers = [];
    shopMarkers = shopMarkers.filter(m=>!m.item._remote);
  }

  function populateList(filteredMarkers=null){
    const ul = document.getElementById('shop-list');
    ul.innerHTML = '';
    const list = filteredMarkers || shopMarkers;
    const query = document.getElementById('search').value || '';
    const countEl = document.getElementById('shop-count');
    if(countEl) countEl.innerHTML = `全国店舗・施設<br>${shopMarkers.length}店舗・施設掲載`;
    if(list.length === 0){
      const li = document.createElement('li');
      li.textContent = '該当する店舗はありません。';
      li.style.color = '#666';
      ul.appendChild(li);
      return;
    }
    const sort = document.getElementById('sort') ? document.getElementById('sort').value : 'relevance';
    const center = map.getCenter();
    const enriched = list.map(m=>{
      const distance = m.item.lat && m.item.lon ? haversine(center.lat, center.lng, m.item.lat, m.item.lon) : null;
      const rating = avgRating(m.item);
      return {m, distance, rating};
    });
    if(sort === 'distance') enriched.sort((a,b)=> (a.distance||9999) - (b.distance||9999));
    else if(sort === 'rating') enriched.sort((a,b)=> (b.rating||0) - (a.rating||0));
    const groups = {};
    enriched.forEach(e=>{
      const p = e.m.item.prefecture || 'その他';
      if(!groups[p]) groups[p] = [];
      groups[p].push(e);
    });
    const sortedPref = Object.keys(groups).sort();
    sortedPref.forEach(pref=>{
      const header = document.createElement('li');
      header.style.padding = '8px 6px';
      header.style.background = '#fafafa';
      header.style.fontWeight = '700';
      header.textContent = `${pref} ・ ${groups[pref].length}件`;
      ul.appendChild(header);
      groups[pref].forEach((e)=>{
        const m = e.m;
        const li = document.createElement('li');
        const highlightedName = highlightSearchTerm(escapeHtml(m.item.name), query);
        const prefecture = m.item.prefecture ? `<span class="pref">${escapeHtml(m.item.prefecture)}</span>` : '';
        const placeholder = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="72" height="56"><rect fill="%23eeeeee" width="100%25" height="100%25"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="10" fill="%23999">No Image</text></svg>';
        const thumbUrl = (m.item.photo && String(m.item.photo).trim()) ? m.item.photo : placeholder;
        const thumb = `<div class="thumb"><img src="${thumbUrl}" alt="${escapeHtml(m.item.name)}" onerror="this.src='${placeholder}'"></div>`;
        const distanceText = e.distance!=null ? `${e.distance.toFixed(2)} km` : '位置情報なし';
        const ratingHtml = e.rating!=null ? `<span class="stars">${'★'.repeat(Math.round(e.rating))}</span> <span style="font-size:12px;color:#666;margin-left:6px">${e.rating.toFixed(1)}</span>` : '<span style="font-size:12px;color:#999">未評価</span>';
        li.innerHTML = `
          <div class="shop-card">
            ${thumb}
            <div class="meta">
              <div><span class="name">${highlightedName}</span> ${prefecture}</div>
              <div class="addr">${escapeHtml(m.item.address || '')}</div>
              <div class="meta-row">
                <div>${ratingHtml}</div>
                <div style="font-size:12px;color:#666">${distanceText}</div>
              </div>
            </div>
          </div>
        `;
        li.addEventListener('click', ()=>{
          flyToShop(m);
          showDetail(m.item);
        });
        ul.appendChild(li);
      });
    });
    generateIndexTabs();
    renderListView();
  }

  function flyToShop(entry){
    if(!entry || !entry.item) return;
    map.flyTo({center:[entry.item.lon, entry.item.lat], zoom:15});
    try{
      const html = popupHtml(entry.item);
      new maplibregl.Popup({offset:12}).setLngLat([entry.item.lon, entry.item.lat]).setHTML(html).addTo(map);
    }catch(e){}
  }

  function getListViewItems(query, sortBy){
    const q = normalizeText(query || '');
    let list = shopMarkers.slice();
    if(q){
      list = list.filter(m => {
        const name = normalizeText(m.item.name || '');
        const address = normalizeText(m.item.address || '');
        const city = normalizeText(m.item.city || '');
        const prefecture = normalizeText(m.item.prefecture || '');
        return name.includes(q) || address.includes(q) || city.includes(q) || prefecture.includes(q);
      });
    }
    if(sortBy === 'name'){
      list.sort((a,b)=>(a.item.name||'').localeCompare(b.item.name||'', 'ja'));
    } else if(sortBy === 'prefecture'){
      list.sort((a,b)=>{
        const r = (a.item.prefecture||'').localeCompare(b.item.prefecture||'', 'ja');
        return r || (a.item.name||'').localeCompare(b.item.name||'', 'ja');
      });
    }
    return list;
  }

  function renderListView(){
    const view = document.getElementById('shop-list-view');
    if(!view) return;
    const query = document.getElementById('list-search') ? document.getElementById('list-search').value : '';
    const sortBy = document.getElementById('list-sort') ? document.getElementById('list-sort').value : 'order';
    const items = getListViewItems(query, sortBy);
    const countLabel = document.getElementById('list-count');
    if(countLabel) countLabel.textContent = `計 ${items.length} 件`;
    if(items.length === 0){
      view.innerHTML = '<div style="padding:16px;color:#666">該当する店舗はありません。</div>';
      return;
    }

    const rows = items.map((m, index)=>{
      const item = m.item;
      const prefecture = item.prefecture ? `<span class="prefecture">${item.prefecture}</span>` : '';
      return `
        <tr data-index="${index}">
          <td class="rank">${index + 1}</td>
          <td class="name">${escapeHtml(item.name)}</td>
          <td>${prefecture}</td>
          <td class="address">${escapeHtml(item.address || '')}</td>
          <td class="coords">${item.lat != null && item.lon != null ? `${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}` : ''}</td>
        </tr>`;
    }).join('');

    view.innerHTML = `
      <table class="shop-list-table">
        <thead>
          <tr>
            <th class="rank">No</th>
            <th>店舗名</th>
            <th>都道府県</th>
            <th>住所</th>
            <th>座標</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    view.querySelectorAll('tbody tr').forEach((tr, idx)=>{
      tr.addEventListener('click', ()=>{
        const markerEntry = items[idx];
        flyToShop(markerEntry);
        const mapTabButton = document.querySelector('.main-tab-btn[data-tab="map"]');
        if(mapTabButton) mapTabButton.click();
      });
    });
  }

  function activateMainTabs(){
    const buttons = document.querySelectorAll('.main-tab-btn');
    const contents = document.querySelectorAll('.main-tab-content');
    buttons.forEach(btn => btn.addEventListener('click', ()=>{
      buttons.forEach(b=>b.classList.toggle('active', b===btn));
      contents.forEach(c=> c.classList.toggle('active', c.dataset.tab === btn.dataset.tab));
      if(btn.dataset.tab === 'list'){
        renderListView();
      }
    }));
  }

  function escapeRegExp(value){
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHtml(text){
    if(!text) return '';
    return String(text).replace(/[&<>"]+/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[ch] || ch);
  }

  function highlightSearchTerm(text, query){
    if(!query) return text;
    const escaped = escapeRegExp(query);
    const regex = new RegExp(`(${escaped})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  function getFilteredMarkers(query){
    const q = normalizeText(query || '');
    const activeChips = document.querySelectorAll('#genre-filters .genre-chip.active');
    const activeGenres = Array.from(activeChips).map(c=>c.dataset.genre).filter(Boolean);
    return shopMarkers.filter(m => {
      const name = normalizeText(m.item.name || '');
      const address = normalizeText(m.item.address || '');
      const city = normalizeText(m.item.city || '');
      const prefecture = normalizeText(m.item.prefecture || '');
      const genre = (m.item.genre || '').toLowerCase();
      const matchesQuery = q === '' || name.includes(q) || address.includes(q) || city.includes(q) || prefecture.includes(q);
      const matchesGenre = activeGenres.length === 0 || activeGenres.map(g=>g.toLowerCase()).includes(genre);
      return matchesQuery && matchesGenre;
    });
  }

  async function overpassSearch(name){
    const q = name.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&'); 
    const bbox = '20,122,46,154';
    const body = `[out:json][timeout:25];(node["name"~"${q}",i](${bbox});way["name"~"${q}",i](${bbox});relation["name"~"${q}",i](${bbox}););out center;`;
    const url = 'https://overpass-api.de/api/interpreter';
    try{
      const res = await fetch(url, { method:'POST', body });
      if(!res.ok) throw new Error('Overpass error ' + res.status);
      const data = await res.json();
      const items = data.elements.map(el=>{
        const lat = el.type === 'node' ? el.lat : (el.center && el.center.lat);
        const lon = el.type === 'node' ? el.lon : (el.center && el.center.lon);
        return {
          name: el.tags && (el.tags.name || el.tags['name:ja'] || ''),
          lat: lat,
          lon: lon,
          address: [el.tags && el.tags['addr:full'], el.tags && el.tags['addr:street'], el.tags && el.tags['addr:city']].filter(Boolean).join(' '),
          hours: el.tags && (el.tags.opening_hours || ''),
          photo: null,
          url: el.tags && el.tags.website,
          _remote: true,
        };
      }).filter(it=>it.lat && it.lon && it.name);
      return items;
    }catch(err){
      throw err;
    }
  }

  function loadGoogleSheetData() {
    console.log('Loading Google Sheets data...');
    return fetch(GOOGLE_SHEET_CSV_URL)
      .then(r => {
        if(!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(csvText => {
        const data = parseCSV(csvText);
        console.log('Google Sheets parsed rows:', data.length);
        let added = 0;
        let parsedCoords = 0;
        let missingCoords = 0;

        data.forEach(d => {
          if(!shops.some(s => normalizeText(s.name) === normalizeText(d.name || s.name) && normalizeText(s.address) === normalizeText(d.address || s.address))){
            shops.push(d);
          }
          const normalized = normalizeItem(d);
          if(normalized && normalized.lat != null && normalized.lon != null){
            parsedCoords += 1;
          } else {
            missingCoords += 1;
          }
          addMarker(d, true);
          added += 1;
        });

        console.log(`Google Sheets imported ${added} rows: coords OK=${parsedCoords}, missing=${missingCoords}`);
        refreshShopsSource();
        setupGenreChips();
        populateList();
      })
      .catch(err => {
        console.warn('Googleスプレッドシートからのデータ読み込み失敗:', err);
      });
  }

  async function reverseGeocode(lat, lon){
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=ja&addressdetails=1`;
    try{
      const res = await fetch(url, { headers: { 'User-Agent': 'ra-men-map/1.0 (+https://example.com)' } });
      if(!res.ok) throw new Error('Reverse geocode failed');
      const data = await res.json();
      return data.address || {};
    }catch(err){
      return null;
    }
  }

  function formatRegionLabel(address){
    if(!address) return '';
    const prefecture = address.state || address['県'] || address.region || '';
    const city = address.city || address.town || address.village || address.county || '';
    return [prefecture, city].filter(Boolean).join(' ');
  }

  function updateRegionText(text){
    const label = document.getElementById('region-label');
    if(!label) return;
    label.textContent = text || '位置情報を表示';
  }

  function setBaseMapStyle(style){
    const osmVisible = style === 'osm' ? 'visible' : 'none';
    const satVisible = style === 'satellite' ? 'visible' : 'none';
    if(map.getLayer('osm-layer')) map.setLayoutProperty('osm-layer', 'visibility', osmVisible);
    if(map.getLayer('satellite-layer')) map.setLayoutProperty('satellite-layer', 'visibility', satVisible);
  }

  function setupGeolocation(){
    try{
      if(typeof maplibregl.GeolocateControl === 'function'){
        currentLocationControl = new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showAccuracyCircle: true,
          showUserLocation: true
        });
        map.addControl(currentLocationControl, 'top-left');
      }
    }catch(err){}
  }

  function locateCurrentPosition(){
    if(currentLocationControl && typeof currentLocationControl.trigger === 'function'){
      currentLocationControl.trigger();
      return;
    }
    if(!navigator.geolocation){
      alert('このブラウザでは位置情報が利用できません。');
      return;
    }
    navigator.geolocation.getCurrentPosition((pos)=>{
      const lon = pos.coords.longitude;
      const lat = pos.coords.latitude;
      map.flyTo({center:[lon, lat], zoom: 14});
      new maplibregl.Popup({offset:12}).setLngLat([lon, lat]).setHTML('<div>現在地</div>').addTo(map);
    }, (err)=>{
      alert('現在地の取得に失敗しました。位置情報の利用を許可してください。');
    }, { enableHighAccuracy: true, timeout: 10000 });
  }

  function haversine(lat1, lon1, lat2, lon2){
    const toRad = deg => deg * Math.PI / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2)
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
      * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  function scheduleRegionUpdate(){
    const center = map.getCenter();
    const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${map.getZoom().toFixed(2)}`;
    if(key === lastRegionKey) return;
    lastRegionKey = key;
    if(regionTimeout) clearTimeout(regionTimeout);
    regionTimeout = setTimeout(async ()=>{
      const address = await reverseGeocode(center.lat, center.lng);
      updateRegionText(formatRegionLabel(address));
    }, 250);
  }

  let regionTimeout = null;
  let lastRegionKey = '';

  map.on('load', ()=>{
    map.addSource('osm', {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256
    });
    map.addLayer({
      id: 'osm-layer',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-opacity': 1 }
    });

    map.addSource('satellite', {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256
    });
    map.addLayer({
      id: 'satellite-layer',
      type: 'raster',
      source: 'satellite',
      paint: { 'raster-opacity': 1 }
    });

    setBaseMapStyle('osm');
    setupGeolocation();

    const mapStyleSelect = document.getElementById('map-style');
    if(mapStyleSelect){
      mapStyleSelect.addEventListener('change', (ev)=>{
        setBaseMapStyle(ev.target.value);
      });
    }
    const locateBtn = document.getElementById('locate-btn');
    if(locateBtn){
      locateBtn.addEventListener('click', locateCurrentPosition);
    }

    try{
      map.addSource(SHOPS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 40
      });

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SHOPS_SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step',['get', 'point_count'],'#51bbd6',10,'#f1f075',30,'#f28cb1'],
          'circle-radius': ['step',['get', 'point_count'],12,10,18,30,24],
          'circle-opacity': 0.8,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff'
        }
      });

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SHOPS_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold','Arial Unicode MS Bold'],
          'text-size': 12
        },
        paint: { 'text-color': '#000' }
      });

      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: SHOPS_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'match', ['get', 'genre'], 
            '豚骨', GENRE_COLORS['豚骨'] || '#c0392b',
            '醤油', GENRE_COLORS['醤油'] || '#3498db', 
            '味噌', GENRE_COLORS['味噌'] || '#f1c40f',
            '塩', GENRE_COLORS['塩'] || '#2ecc71', 
            '家系', GENRE_COLORS['家系'] || '#34495e',
            '二郎系', GENRE_COLORS['二郎系'] || '#9b59b6',
            'iekei', GENRE_COLORS['iekei'] || '#34495e',
            'tsukemen', GENRE_COLORS['tsukemen'] || '#8e44ad',
            'jiro', GENRE_COLORS['jiro'] || '#9b59b6',
            'aburasoba', GENRE_COLORS['aburasoba'] || '#d35400',
            'jimotokei', GENRE_COLORS['jimotokei'] || '#27ae60',
            'school', GENRE_COLORS['school'] || '#2563eb',
            'station', GENRE_COLORS['station'] || '#dc2626',
            'park', GENRE_COLORS['park'] || '#16a34a',
            'tourism', GENRE_COLORS['tourism'] || '#f59e0b',
            '#c0392b'
          ],
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      });

      map.on('click', 'clusters', function(e){
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        if(!features || !features.length) return;
        const clusterId = features[0].properties.cluster_id;
        map.getSource(SHOPS_SOURCE_ID).getClusterExpansionZoom(clusterId, function(err, zoom){
          if(err) return;
          map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
        });
      });

      map.on('click', 'unclustered-point', function(e){
        const feature = e.features && e.features[0];
        if(!feature) return;
        const props = feature.properties || {};
        let item = null;
        try{ item = JSON.parse(props.item); }catch(err){ item = { name: props.name || '' }; }
        const coords = feature.geometry.coordinates.slice();
        new maplibregl.Popup({offset:12}).setLngLat(coords).setHTML(popupHtml(item)).addTo(map);
      });

      map.on('mouseenter', 'clusters', ()=> map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'clusters', ()=> map.getCanvas().style.cursor = '');
      map.on('mouseenter', 'unclustered-point', ()=> map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'unclustered-point', ()=> map.getCanvas().style.cursor = '');
    }catch(err){}

    loadGoogleSheetData();
    scheduleRegionUpdate();
  });

  map.on('moveend', scheduleRegionUpdate);
  map.on('zoomend', scheduleRegionUpdate);

  const searchInput = document.getElementById('search');
  const nationwideCheckbox = document.getElementById('nationwide');
  if(nationwideCheckbox) nationwideCheckbox.checked = false;
  let searchTimeout = null;
  searchInput.addEventListener('input', (ev)=>{
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async ()=>{
      const q = ev.target.value || '';
      document.querySelectorAll('#index-tabs button').forEach(b=>b.classList.remove('active'));
      const allBtn = document.querySelector('#index-tabs button:first-child');
      if(allBtn) allBtn.classList.add('active');
      
      const nationwide = nationwideCheckbox ? nationwideCheckbox.checked : false;
      const status = document.getElementById('search-status');
      
      if(nationwide && q.trim().length>1){
        status.textContent = '全国検索中...';
        clearRemoteMarkers();
        
        try {
          const items = await overpassSearch(q);
          let added = 0;
          items.forEach(it=>{
            if(!isDuplicateItem(it)){
              it.reviews = [];
              addMarker(it, true);
              added++;
            }
          });
          refreshShopsSource();
          populateList(getFilteredMarkers(q));
          status.textContent = `取得 ${items.length} 件、追加 ${added} 件`;
        } catch (err) {
          status.textContent = `エラー: ${err.message}`;
        }
      }else{
        const results = getFilteredMarkers(q);
        populateList(results);
        document.getElementById('search-status').textContent = q ? `検索結果 ${results.length} 件` : '';
      }
    }, 150);
  });

  searchInput.addEventListener('keydown', (ev)=>{
    if(ev.key === 'Enter'){
      ev.preventDefault();
      const q = ev.target.value || '';
      const filtered = getFilteredMarkers(q);
      if(filtered.length>0){
        const m = filtered[0];
        flyToShop(m);
      }
    }
  });

  activateMainTabs();
  const listSearch = document.getElementById('list-search');
  if(listSearch) listSearch.addEventListener('input', renderListView);
  const listSort = document.getElementById('list-sort');
  if(listSort) listSort.addEventListener('change', renderListView);

  const sortSelect = document.getElementById('sort');
  if(sortSelect) sortSelect.addEventListener('change', ()=>{
    const q = document.getElementById('search').value || '';
    populateList(getFilteredMarkers(q));
  });

  function exportCSV(){
    const q = document.getElementById('search').value || '';
    const rows = getFilteredMarkers(q);
    const center = map.getCenter();
    const lines = [];
    const header = ['name','lat','lon','address','hours','url','rating','distance_km'];
    lines.push(header.join(','));
    rows.forEach(r=>{
      const it = r.item;
      const rating = avgRating(it);
      const dist = it.lat && it.lon ? haversine(center.lat, center.lng, it.lat, it.lon).toFixed(3) : '';
      const vals = [it.name, it.lat, it.lon, it.address||'', it.hours||'', it.url||'', rating!=null?rating.toFixed(2):'', dist];
      const csvLine = vals.map(v=> typeof v === 'string' && v.includes(',') ? '"'+v.replace(/"/g,'""')+'"' : v).join(',');
      lines.push(csvLine);
    });
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ramen_shops.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  const exportBtn = document.getElementById('export-csv');
  if(exportBtn) exportBtn.addEventListener('click', exportCSV);

  function setupGenreChips(){
    const container = document.getElementById('genre-filters');
    if(!container) return;
    container.innerHTML = '';
    const genres = new Set(shopMarkers.map(m=> (m.item.genre || '').trim()).filter(Boolean));
    const preferred = ['豚骨','醤油','味噌','塩','家系','二郎系','school','station','park','tourism', 'iekei', 'tsukemen', 'jiro', 'aburasoba', 'jimotokei'];
    const others = Array.from(genres).filter(g=>!preferred.includes(g)).sort();
    const ordered = preferred.filter(g=>genres.has(g)).concat(others);
    ordered.forEach(g=>{
      const btn = document.createElement('button');
      btn.className = 'genre-chip';
      btn.dataset.genre = g;
      btn.textContent = g;
      btn.addEventListener('click', ()=>{
        btn.classList.toggle('active');
        populateList(getFilteredMarkers(document.getElementById('search').value || ''));
      });
      container.appendChild(btn);
    });
  }

  const presetContainer = document.getElementById('preset-buttons');
  if(presetContainer){
    presetContainer.addEventListener('click', (ev)=>{
      const btn = ev.target.closest('.preset-btn');
      if(!btn) return;
      const p = btn.dataset.preset;
      if(p === 'university'){
        map.flyTo({center: center, zoom:15});
      } else if(p === 'famous'){
        fitBoundsForMarkers(shopMarkers.map(m=>m.item));
      } else if(p === 'chain'){
        const chains = ['一蘭','山岡家','丸源','幸楽苑','丸亀製麺'];
        const filtered = shopMarkers.filter(m=> chains.some(name=> (m.item.name||'').includes(name)));
        if(filtered.length>0){
          populateList(filtered);
          fitBoundsForMarkers(filtered.map(f=>f.item));
        } else {
          alert('チェーン店が見つかりませんでした。');
        }
      }
    });
  }

  function fitBoundsForMarkers(items){
    const pts = items.filter(it=>it.lat!=null && it.lon!=null).map(it=>[it.lon, it.lat]);
    if(pts.length===0) return;
    const lons = pts.map(p=>p[0]);
    const lats = pts.map(p=>p[1]);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    map.fitBounds([[minLon, minLat],[maxLon, maxLat]], { padding:40 });
  }

  const loadDataBtn = document.getElementById('load-data');
  const dataFileInput = document.getElementById('data-file');

  function clearLocalData(){
    shopMarkers.forEach(m=>{ try{ if(m.marker && typeof m.marker.remove === 'function') m.marker.remove(); }catch(e){} });
    shopMarkers = [];
    remoteMarkers = [];
    shops.length = 0;
  }

  function normalizeCSVHeader(header){
    if(header == null) return '';
    let key = String(header).trim().toLowerCase();
    key = key.replace(/\(.*?\)/g, '');
    key = key.replace(/例.*$/g, '');
    key = key.replace(/[\r\n]/g, ' ');
    key = key.replace(/[\s、・,]+/g, '');
    key = key.replace(/[^\w\u3040-\u30ff\u4e00-\u9fff]+/g, '');
    return key;
  }

  function parseCSV(text){
    text = String(text).replace(/^\uFEFF/, '');
    const rows = [];
    let inQuotes = false;
    let current = '';
    let row = [];

    for(let i = 0; i < text.length; i++){
      const ch = text[i];
      if(ch === '"'){
        if(inQuotes && text[i+1] === '"'){
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if(ch === ',' && !inQuotes){
        row.push(current);
        current = '';
      } else if((ch === '\n' || ch === '\r') && !inQuotes){
        if(ch === '\r' && text[i+1] === '\n') continue;
        row.push(current);
        rows.push(row);
        row = [];
        current = '';
      } else {
        current += ch;
      }
    }

    if(current !== '' || row.length > 0){
      row.push(current);
      rows.push(row);
    }

    const filtered = rows.filter(r => r.some(cell => String(cell).trim() !== ''));
    if(filtered.length === 0) return [];
    const headers = filtered[0].map(normalizeCSVHeader);
    return filtered.slice(1).map(line => {
      const item = {};
      headers.forEach((key, idx) => {
        item[key] = line[idx] !== undefined ? String(line[idx]).trim() : '';
      });
      return item;
    });
  }

  function loadLocalDataset(items){
    if(!Array.isArray(items)) return;
    clearLocalData();
    items.forEach(item=>{
      if(item && item.name){
        const norm = normalizeItem(item);
        if(norm && norm.lat != null && norm.lon != null){
          if(!item.reviews) item.reviews = [];
          addMarker(item, true);
        }
      }
    });
    refreshShopsSource();
    setupGenreChips();
    populateList();
    document.getElementById('search-status').textContent = `${shopMarkers.length} 件のローカルデータを読み込みました。`;
  }

  if(loadDataBtn && dataFileInput){
    loadDataBtn.addEventListener('click', ()=> dataFileInput.click());
    dataFileInput.addEventListener('change', async (ev)=>{
      const file = ev.target.files && ev.target.files[0];
      if(!file) return;
      try{
        const text = await file.text();
        if(file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv'){
          const parsed = parseCSV(text);
          if(parsed.length>0){
            loadLocalDataset(parsed);
          }else{
            alert('CSV の解析に失敗しました。フォーマットを確認してください。');
          }
        } else {
          const parsed = JSON.parse(text);
          if(Array.isArray(parsed)){
            loadLocalDataset(parsed);
          }else if(parsed && Array.isArray(parsed.data)){
            loadLocalDataset(parsed.data);
          }else{
            alert('JSON の形式が不正です。配列形式で店舗データを指定してください。');
          }
        }
      }catch(err){
        console.error('Local dataset load failed', err);
        alert('ファイルの読み込みに失敗しました。形式を確認してください。');
      } finally {
        ev.target.value = '';
      }
    });
  }

  function saveResults(){
    const q = document.getElementById('search').value || '';
    const rows = getFilteredMarkers(q);
    const data = {
      query: q,
      timestamp: new Date().toISOString(),
      results: rows.map(r=>({
        name: r.item.name,
        lat: r.item.lat,
        lon: r.item.lon,
        address: r.item.address,
        hours: r.item.hours,
        url: r.item.url,
        rating: avgRating(r.item),
        reviews: r.item.reviews || []
      }))
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], {type:'application/json;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ramen_results_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    alert(`${rows.length}件の検索結果を保存しました。`);
  }
  const saveBtn = document.getElementById('save-results');
  if(saveBtn) saveBtn.addEventListener('click', saveResults);

  function showDetail(item){
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.tabIndex = -1;
    const modal = document.createElement('div');
    modal.className = 'modal';
    const rating = avgRating(item);
    
    const placeholder = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="140"><rect fill="%23eeeeee" width="100%25" height="100%25"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="14" fill="%23999">No Image</text></svg>';
    const imgSrc = (item.photo && String(item.photo).trim()) ? item.photo : placeholder;
    
    modal.innerHTML = `
      <button class="btn-close">閉じる</button>
      <h3>${item.name}</h3>
      <img src="${imgSrc}" alt="${item.name}" style="max-width:100%;height:auto;margin-bottom:8px" onerror="this.src='${placeholder}'">
      <div>${item.address||''}</div>
      <div>${item.hours||''}</div>
      ${item.url?`<div><a href="${item.url}" target="_blank">公式サイト</a></div>`:''}
      <div style="margin-top:8px">評価: ${rating!=null?rating.toFixed(1):'未評価'}</div>
      <h4>レビュー</h4>
      <ul class="review-list"></ul>
      <form id="review-form">
        <label>点数: <select id="review-score"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></label>
        <div><textarea id="review-comment" placeholder="感想（任意）" style="width:100%;height:60px;margin-top:6px"></textarea></div>
        <div style="margin-top:8px"><button type="submit">レビュー投稿</button></div>
      </form>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function renderReviews(){
      const ul = modal.querySelector('.review-list');
      ul.innerHTML = '';
      if(!item.reviews || item.reviews.length===0){
        const li = document.createElement('li'); li.textContent = 'まだレビューはありません。'; ul.appendChild(li); return;
      }
      item.reviews.slice().reverse().forEach(r=>{
        const li = document.createElement('li');
        li.innerHTML = `<strong>評価 ${r.score}</strong> <div style="font-size:12px;color:#666">${new Date(r.date).toLocaleString()}</div><div>${r.comment||''}</div>`;
        ul.appendChild(li);
      });
    }
    renderReviews();
    
    modal.querySelector('.btn-close').addEventListener('click', ()=>{ overlay.remove(); });
    overlay.addEventListener('click', (ev)=>{ if(ev.target === overlay) overlay.remove(); });
    
    modal.querySelector('#review-form').addEventListener('submit', (ev)=>{
      ev.preventDefault();
      const score = parseInt(modal.querySelector('#review-score').value,10);
      const comment = modal.querySelector('#review-comment').value.trim();
      if(!item.reviews) item.reviews = [];
      item.reviews.push({score, comment, date: Date.now()});
      renderReviews();
      refreshShopsSource();
      populateList(getFilteredMarkers(document.getElementById('search').value || ''));
    });
  }
})();