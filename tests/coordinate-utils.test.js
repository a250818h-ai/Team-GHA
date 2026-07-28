const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCoordinatePair, normalizeItem } = require('../coordinate-utils.js');

test('parseCoordinatePair handles Japanese comma separators', () => {
  assert.deepStrictEqual(parseCoordinatePair('35.862664、139.969901'), {
    lat: 35.862664,
    lon: 139.969901,
  });
});

test('parseCoordinatePair handles slash and parenthesis formats', () => {
  assert.deepStrictEqual(parseCoordinatePair('（35.862664 / 139.969901）'), {
    lat: 35.862664,
    lon: 139.969901,
  });
});

test('parseCoordinatePair handles space-separated coordinates', () => {
  assert.deepStrictEqual(parseCoordinatePair('35.862664 139.969901'), {
    lat: 35.862664,
    lon: 139.969901,
  });
});

test('normalizeItem extracts coordinates from a Google Form-like field', () => {
  const item = {
    name: 'テスト店',
    address: '千葉県柏市',
    '緯度、経度': '35.862664、139.969901',
  };

  const normalized = normalizeItem(item);
  assert.equal(normalized.name, 'テスト店');
  assert.equal(normalized.lat, 35.862664);
  assert.equal(normalized.lon, 139.969901);
});

test('normalizeItem keeps photo URLs in a normalized photos array', () => {
  const item = {
    name: '写真付き店',
    photo: 'https://example.com/cover.jpg',
    photos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
  };

  const normalized = normalizeItem(item);
  assert.deepStrictEqual(normalized.photos, ['https://example.com/cover.jpg', 'https://example.com/a.jpg', 'https://example.com/b.jpg']);
  assert.equal(normalized.photo, 'https://example.com/cover.jpg');
});
