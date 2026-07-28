const root = typeof globalThis !== 'undefined' ? globalThis : this;

function isValidLatLon(lat, lon) {
  return typeof lat === 'number' && typeof lon === 'number'
    && Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function parseCoordinatePair(value) {
  if (value == null) return null;

  const text = String(value)
    .trim()
    .replace(/[()（）\uFEFF]/g, '');

  if (!text) return null;

  const numbers = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!numbers || numbers.length < 2) return null;

  const first = Number(numbers[0]);
  const second = Number(numbers[1]);

  if (isValidLatLon(first, second)) return { lat: first, lon: second };
  if (isValidLatLon(second, first)) return { lat: second, lon: first };
  return null;
}

function normalizeText(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/[^\w\u3040-\u30ff\u4e00-\u9fff]+/g, '').trim();
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;

  const normalized = {};
  for (const key of Object.keys(item)) {
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

  const rawPhotos = normalized.photos || normalized['写真'] || normalized['画像'] || normalized.images || [];
  const photoCandidates = [];
  if (Array.isArray(rawPhotos)) {
    rawPhotos.forEach((entry) => {
      if (typeof entry === 'string' && entry.trim()) photoCandidates.push(entry.trim());
    });
  } else if (typeof rawPhotos === 'string' && rawPhotos.trim()) {
    photoCandidates.push(rawPhotos.trim());
  }

  const primaryPhoto = normalized.photo || normalized.image || normalized.img || photoCandidates[0] || '';
  const photos = [primaryPhoto, ...photoCandidates.filter((photo) => photo && photo !== primaryPhoto)].filter(Boolean);

  const result = {
    name: normalized.name || normalized.shop || normalized.title || normalized['店舗名'] || normalized['店名'] || normalized['名前'] || '',
    address: normalized.address || normalized.addr || normalized['住所'] || '',
    hours: normalized.hours || normalized.openinghours || normalized.open || normalized['営業時間'] || '',
    photo: primaryPhoto,
    photos,
    url: normalized.url || normalized.website || '',
    city: normalized.city || '',
    prefecture: normalized.prefecture || normalized.state || normalized.region || normalized['県'] || '',
    _remote: normalized._remote || false,
    genre: normalized.genre || normalized.category || normalized.type || normalized['ジャンル'] || normalized['カテゴリー'] || '',
    reviews: Array.isArray(normalized.reviews) ? normalized.reviews : [],
  };

  let lat = null;
  let lon = null;

  const combined = normalized['座標'] || normalized['緯度経度'] || normalized['latlon'] || normalized['coordinates'] || normalized['location'] || normalized['coordinate'] || normalized['緯度経度'] || normalized['緯度、経度'] || normalized['緯度経度例'] || normalized['緯度経度例'] || normalized['緯度経度'] || normalized['緯度、経度'];
  const combinedPair = parseCoordinatePair(combined);
  if (combinedPair) {
    lat = combinedPair.lat;
    lon = combinedPair.lon;
  } else {
    const rawLat = normalized.lat || normalized.latitude || normalized['緯度'];
    const rawLon = normalized.lon || normalized.longitude || normalized.lng || normalized.lngt || normalized['経度'];
    const parsedPair = parseCoordinatePair(rawLat) || parseCoordinatePair(rawLon) || parseCoordinatePair(`${rawLat || ''} ${rawLon || ''}`);
    if (parsedPair) {
      lat = parsedPair.lat;
      lon = parsedPair.lon;
    } else {
      const cleanedLat = rawLat != null ? Number(String(rawLat).trim().replace(/[()（）\uFEFF]/g, '')) : null;
      const cleanedLon = rawLon != null ? Number(String(rawLon).trim().replace(/[()（）\uFEFF]/g, '')) : null;
      if (isValidLatLon(cleanedLat, cleanedLon)) {
        lat = cleanedLat;
        lon = cleanedLon;
      } else if (isValidLatLon(cleanedLon, cleanedLat)) {
        lat = cleanedLon;
        lon = cleanedLat;
      }
    }
  }

  result.lat = isValidLatLon(lat, lon) ? lat : null;
  result.lon = isValidLatLon(lat, lon) ? lon : null;
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isValidLatLon,
    parseCoordinatePair,
    normalizeText,
    normalizeItem,
  };
}

if (root) {
  root.CoordinateUtils = {
    isValidLatLon,
    parseCoordinatePair,
    normalizeText,
    normalizeItem,
  };
}
