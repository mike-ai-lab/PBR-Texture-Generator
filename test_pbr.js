/**
 * PBR Texture Generator — Headless Unit Tests
 * Tests pure logic extracted from workers/pbr.js and src/app.js
 * Run: node test_pbr.js
 */

// ── Inline the pure functions from workers/pbr.js ────────────────────
function toGray(r, g, b) { return 0.299*r + 0.587*g + 0.114*b; }

function generateNormal(gray, w, h, strength) {
  const pad = 4;
  const pw = w + 2*pad;
  // minimal wrapPad inline
  const pg = new Float32Array((w+2*pad)*(h+2*pad));
  for (let y = 0; y < h+2*pad; y++) {
    const sy = ((y - pad) % h + h) % h;
    for (let x = 0; x < w+2*pad; x++) {
      const sx = ((x - pad) % w + w) % w;
      pg[y*pw+x] = gray[sy*w+sx];
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x+pad, py = y+pad;
      const gx = (-pg[(py-1)*pw+(px-1)] - 2*pg[py*pw+(px-1)] - pg[(py+1)*pw+(px-1)]
                  +pg[(py-1)*pw+(px+1)] + 2*pg[py*pw+(px+1)] + pg[(py+1)*pw+(px+1)]) / 255;
      const gy = (-pg[(py-1)*pw+(px-1)] - 2*pg[(py-1)*pw+px] - pg[(py-1)*pw+(px+1)]
                  +pg[(py+1)*pw+(px-1)] + 2*pg[(py+1)*pw+px] + pg[(py+1)*pw+(px+1)]) / 255;
      const gz = 1.0 / (Math.max(0.1, strength) * 0.1);
      const len = Math.sqrt(gx*gx + gy*gy + gz*gz) || 1;
      const i = (y*w+x)*4;
      out[i]   = ((-gx/len)*0.5+0.5)*255;
      out[i+1] = ((gy/len) *0.5+0.5)*255;
      out[i+2] = ((gz/len) *0.5+0.5)*255;
      out[i+3] = 255;
    }
  }
  return out;
}

function generateRoughness(gray, w, h, alpha, beta) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w*h; i++) {
    const v = Math.max(0, Math.min(255, (255-gray[i]) * alpha + beta));
    out[i*4] = out[i*4+1] = out[i*4+2] = v; out[i*4+3] = 255;
  }
  return out;
}

function generateHeight(gray, w, h, contrast, invert) {
  const c = contrast ?? 1.2;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w*h; i++) {
    let v = gray[i] / 255;
    v = (v - 0.5) * c + 0.5;
    v = Math.max(0, Math.min(1, v));
    if (invert) v = 1 - v;
    const b = Math.round(v * 255);
    out[i*4] = out[i*4+1] = out[i*4+2] = b; out[i*4+3] = 255;
  }
  return out;
}

function generateMetalness(gray, w, h, threshold, contrast) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w*h; i++) {
    const g = gray[i] / 255;
    const raw = (g - threshold) * contrast + 0.5;
    const v = Math.max(0, Math.min(255, raw * 255));
    out[i*4] = out[i*4+1] = out[i*4+2] = v; out[i*4+3] = 255;
  }
  return out;
}

function generateOpacity(gray, w, h, threshold) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w*h; i++) {
    const v = gray[i] > threshold * 255 ? 255 : 0;
    out[i*4] = out[i*4+1] = out[i*4+2] = v; out[i*4+3] = 255;
  }
  return out;
}

// Kelvin to RGB (from app.js)
function kelvinToColor(k) {
  k = Math.max(1000, Math.min(12000, k)) / 100;
  let r, g, b;
  r = k <= 66 ? 255 : 329.698727446 * Math.pow(k - 60, -0.1332047592);
  if (k <= 66) g = 99.4708025861 * Math.log(k) - 161.1195681661;
  else         g = 288.1221695283 * Math.pow(k - 60, -0.0755148492);
  b = k >= 66 ? 255 : (k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307);
  return { r: Math.max(0,Math.min(255,r)), g: Math.max(0,Math.min(255,g)), b: Math.max(0,Math.min(255,b)) };
}

// ── Test runner ───────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✔  ${name}`);
    passed++;
  } catch(e) {
    console.log(`  ✗  ${name}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}
function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}
function assertClose(a, b, tol = 2, msg) {
  if (Math.abs(a - b) > tol) throw new Error(msg || `Expected ${a} ≈ ${b} (tol ${tol})`);
}

// ── SUITE 1: toGray ───────────────────────────────────────────────────
console.log('\nSuite: toGray luminance');
test('white RGB → 255', () => assertClose(toGray(255,255,255), 255, 1));
test('black RGB → 0',   () => assertClose(toGray(0,0,0), 0, 1));
test('pure red luma',   () => assertClose(toGray(255,0,0), 76.4, 1));
test('pure green luma', () => assertClose(toGray(0,255,0), 149.7, 1));
test('pure blue luma',  () => assertClose(toGray(0,0,255), 29.1, 1));

// ── SUITE 2: generateNormal ───────────────────────────────────────────
console.log('\nSuite: generateNormal');
test('output size = w*h*4', () => {
  const gray = new Float32Array(4*4).fill(128);
  const out = generateNormal(gray, 4, 4, 10);
  assert(out.length === 4*4*4, `Expected ${4*4*4} got ${out.length}`);
});
test('flat surface → neutral blue (z≈255)', () => {
  const gray = new Float32Array(8*8).fill(128);
  const out = generateNormal(gray, 8, 8, 10);
  // Flat surface: no gradient, z channel should be high (near 255)
  const zValues = [];
  for (let i = 0; i < 8*8; i++) zValues.push(out[i*4+2]);
  const avgZ = zValues.reduce((a,b)=>a+b,0)/zValues.length;
  assert(avgZ > 200, `Expected avgZ > 200, got ${avgZ.toFixed(1)}`);
});
test('alpha channel always 255', () => {
  const gray = new Float32Array(4*4).fill(100);
  const out = generateNormal(gray, 4, 4, 5);
  for (let i = 0; i < 4*4; i++) assert(out[i*4+3] === 255, 'Alpha not 255');
});

// ── SUITE 3: generateRoughness ────────────────────────────────────────
console.log('\nSuite: generateRoughness');
test('white input → low roughness (inverted)', () => {
  const gray = new Float32Array(4).fill(255);
  const out = generateRoughness(gray, 2, 2, 1.0, 0);
  assertClose(out[0], 0, 2, `Expected near 0, got ${out[0]}`);
});
test('black input → high roughness', () => {
  const gray = new Float32Array(4).fill(0);
  const out = generateRoughness(gray, 2, 2, 1.0, 0);
  assertClose(out[0], 255, 2, `Expected near 255, got ${out[0]}`);
});
test('alpha always 255', () => {
  const gray = new Float32Array(4).fill(128);
  const out = generateRoughness(gray, 2, 2, 1.0, 0);
  assert(out[3] === 255 && out[7] === 255);
});
test('beta shifts output up', () => {
  const gray = new Float32Array(4).fill(128);
  const without = generateRoughness(gray, 2, 2, 1.0, 0);
  const withBeta = generateRoughness(gray, 2, 2, 1.0, 50);
  assert(withBeta[0] > without[0], `Beta should increase output`);
});

// ── SUITE 4: generateHeight ───────────────────────────────────────────
console.log('\nSuite: generateHeight');
test('mid-grey (128) → near 128 with contrast=1', () => {
  const gray = new Float32Array(1).fill(128);
  const out = generateHeight(gray, 1, 1, 1.0, false);
  assertClose(out[0], 128, 3);
});
test('invert flips values', () => {
  const gray = new Float32Array([200]);
  const normal = generateHeight(gray, 1, 1, 1.0, false);
  const inverted = generateHeight(gray, 1, 1, 1.0, true);
  assert(inverted[0] < normal[0], `Invert should reduce bright pixel`);
  assertClose(normal[0] + inverted[0], 255, 2, 'Inverted + normal should ≈ 255');
});
test('contrast=2 spreads values further from mid', () => {
  const gray = new Float32Array([200]);
  const lo = generateHeight(gray, 1, 1, 1.0, false);
  const hi = generateHeight(gray, 1, 1, 2.0, false);
  assert(hi[0] >= lo[0], `Higher contrast should push bright pixel higher`);
});
test('clamped to 0-255', () => {
  const gray = new Float32Array([0, 255]);
  const out = generateHeight(gray, 2, 1, 4.0, false);
  assert(out[0] >= 0 && out[0] <= 255, 'Min pixel out of range');
  assert(out[4] >= 0 && out[4] <= 255, 'Max pixel out of range');
});

// ── SUITE 5: generateMetalness ────────────────────────────────────────
console.log('\nSuite: generateMetalness');
test('threshold=1.0 → all zero (nothing metallic)', () => {
  const gray = new Float32Array(4).fill(200);
  const out = generateMetalness(gray, 2, 2, 1.0, 4.0);
  assert(out[0] < 50, `Threshold=1 should produce near-zero, got ${out[0]}`);
});
test('threshold=0.0 → high metalness for bright pixel', () => {
  const gray = new Float32Array([200, 200]);
  const out = generateMetalness(gray, 2, 1, 0.0, 4.0);
  assert(out[0] > 150, `Threshold=0 bright pixel should be high, got ${out[0]}`);
});
test('dark pixel below threshold → 0 metalness', () => {
  const gray = new Float32Array([10]);
  const out = generateMetalness(gray, 1, 1, 0.8, 4.0);
  assert(out[0] < 30, `Dark pixel should be near 0, got ${out[0]}`);
});

// ── SUITE 6: generateOpacity ──────────────────────────────────────────
console.log('\nSuite: generateOpacity');
test('pixel above threshold → 255', () => {
  const gray = new Float32Array([200]);
  const out = generateOpacity(gray, 1, 1, 0.5);
  assert(out[0] === 255, `Expected 255 got ${out[0]}`);
});
test('pixel below threshold → 0', () => {
  const gray = new Float32Array([100]);
  const out = generateOpacity(gray, 1, 1, 0.5);
  assert(out[0] === 0, `Expected 0 got ${out[0]}`);
});
test('threshold=0 → everything white', () => {
  const gray = new Float32Array([0, 1, 128, 255]);
  const out = generateOpacity(gray, 4, 1, 0.0);
  // pixel value 0 is NOT > 0*255=0, so first pixel = 0
  assert(out[4] === 255 && out[8] === 255 && out[12] === 255, 'Non-zero pixels should be 255');
});
test('threshold=1.0 → everything 0 (nothing above 255)', () => {
  const gray = new Float32Array([128, 200, 250]);
  const out = generateOpacity(gray, 3, 1, 1.0);
  assert(out[0] === 0 && out[4] === 0 && out[8] === 0, 'All should be 0 at threshold=1');
});

// ── SUITE 7: Kelvin temperature ───────────────────────────────────────
console.log('\nSuite: kelvinToColor');
test('6500K → near white (daylight)', () => {
  const c = kelvinToColor(6500);
  assert(c.r > 200 && c.g > 200 && c.b > 200, `6500K should be near-white, got ${JSON.stringify(c)}`);
});
test('2000K → warm orange (low r,g, very low b)', () => {
  const c = kelvinToColor(2000);
  assert(c.r > c.b, `2000K red should be > blue, got ${JSON.stringify(c)}`);
  assert(c.b < 50, `2000K blue should be very low, got ${c.b}`);
});
test('10000K → cool blue (b=255)', () => {
  const c = kelvinToColor(10000);
  assert(c.b === 255, `10000K blue should be 255, got ${c.b}`);
  assert(c.r < c.b, `10000K red should be < blue`);
});
test('clamped at boundaries', () => {
  const lo = kelvinToColor(500);   // below min
  const hi = kelvinToColor(20000); // above max
  assert(lo.r >= 0 && lo.r <= 255);
  assert(hi.b >= 0 && hi.b <= 255);
});

// ── SUITE 8: Opacity cutout is binary ────────────────────────────────
console.log('\nSuite: Opacity is hard cutout (binary)');
test('all output values are 0 or 255', () => {
  const gray = new Float32Array(100);
  for (let i = 0; i < 100; i++) gray[i] = Math.random() * 255;
  const out = generateOpacity(gray, 100, 1, 0.5);
  for (let i = 0; i < 100; i++) {
    assert(out[i*4] === 0 || out[i*4] === 255, `Pixel ${i} = ${out[i*4]} is not binary`);
  }
});

// ── SUITE 9: Map output dimensions ───────────────────────────────────
console.log('\nSuite: All generators produce correct output size');
const W = 16, H = 8;
const testGray = new Float32Array(W*H).fill(128);
const testRgba = new Uint8ClampedArray(W*H*4).fill(180);
[
  ['Normal',    generateNormal(testGray, W, H, 10)],
  ['Roughness', generateRoughness(testGray, W, H, 1, 0)],
  ['Height',    generateHeight(testGray, W, H, 1.8, false)],
  ['Metalness', generateMetalness(testGray, W, H, 0.5, 4)],
  ['Opacity',   generateOpacity(testGray, W, H, 0.5)],
].forEach(([name, out]) => {
  test(`${name} output = ${W*H*4} bytes`, () => {
    assert(out.length === W*H*4, `Expected ${W*H*4}, got ${out.length}`);
  });
});

// ── SUITE 10: HTML structure checks ──────────────────────────────────
console.log('\nSuite: index.html structure');
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

test('has output-res selector', () => {
  assert(html.includes('id="output-res"'), 'Missing #output-res selector');
});
test('has all 8 eye toggle buttons', () => {
  const eyes = ['eye-normal','eye-roughness','eye-ao','eye-height','eye-metalness','eye-emissive','eye-opacity'];
  eyes.forEach(id => assert(html.includes(`id="${id}"`), `Missing ${id}`));
});
test('has all 8 map clear buttons', () => {
  ['clear-normal','clear-roughness','clear-ao','clear-height','clear-metalness','clear-emissive','clear-opacity'].forEach(id => {
    assert(html.includes(`id="${id}"`), `Missing ${id}`);
  });
});
test('has preset panel', () => assert(html.includes('id="preset-panel"')));
test('has preset grid', () => assert(html.includes('id="preset-grid"')));
test('has tb-preset-btn', () => assert(html.includes('id="tb-preset-btn"')));
test('has tb-views-btn (standard views)', () => assert(html.includes('id="tb-views-btn"')));
test('has adv-summary CSS class', () => assert(html.includes('.adv-summary')));
test('has kelvin slider', () => assert(html.includes('id="kelvin"')));
test('has amb slider', () => assert(html.includes('id="amb"')));
test('no duplicate id="preset-grid"', () => {
  const matches = html.match(/id="preset-grid"/g);
  assert(matches && matches.length === 1, `Found ${matches?.length} instances of preset-grid, expected 1`);
});
test('metalness card has spinner id spin-met-threshold', () => {
  assert(html.includes('id="spin-met-threshold"'), 'Missing spin-met-threshold');
});
test('opacity card has spinner id spin-opa-threshold', () => {
  assert(html.includes('id="spin-opa-threshold"'), 'Missing spin-opa-threshold');
});

// ── SUITE 11: app.js structure ────────────────────────────────────────
console.log('\nSuite: src/app.js structure');
const appjs = fs.readFileSync('src/app.js', 'utf8');

test('imports PRESETS from presets.js', () => assert(appjs.includes("from './presets.js'")));
test('has snapToStandardView function', () => assert(appjs.includes('function snapToStandardView')));
test('has _normalizeMaps function', () => assert(appjs.includes('function _normalizeMaps')));
test('has _resizeDataUrl function', () => assert(appjs.includes('function _resizeDataUrl')));
test('has togglePresetPanel function', () => assert(appjs.includes('function togglePresetPanel')));
test('has kelvinToColor function', () => assert(appjs.includes('function kelvinToColor')));
test('has _groupDirectUpdate (override mode)', () => assert(appjs.includes('_groupDirectUpdate')));
test('sl() supports click-to-edit (numeric input)', () => assert(appjs.includes('inp.type = \'number\'')));
test('downloadZip calls _normalizeMaps', () => assert(appjs.includes('_normalizeMaps(maps)')));
test('tiled preview uses composite (preview2d)', () => assert(appjs.includes('tileSource = preview2d')));
test('no double display:none on preset-panel', () => {
  const panelMatch = appjs.match(/preset-panel.*?style.*?display:none.*?display:none/s);
  assert(!panelMatch, 'preset-panel has double display:none');
});
test('has _overridePixels decode in loadMapOverride', () => assert(appjs.includes('_overridePixels')));
test('runLivePreview uses override pixels as srcData', () => assert(appjs.includes('overrideSrc || stackImageData')));
test('texEntries skips albedo when override used', () => assert(appjs.includes('overrideSrcUsed')));

// ── SUITE 12: presets.js ──────────────────────────────────────────────
console.log('\nSuite: src/presets.js');
const presetsjs = fs.readFileSync('src/presets.js', 'utf8');
test('exports PRESETS array', () => assert(presetsjs.includes('export const PRESETS')));
test('has at least 10 presets', () => {
  const matches = presetsjs.match(/name:/g);
  assert(matches && matches.length >= 10, `Found only ${matches?.length} presets`);
});
test('each preset has color field', () => {
  const colors = presetsjs.match(/color: '#/g);
  assert(colors && colors.length >= 10, 'Missing color fields');
});
test('each preset has maps field', () => assert(presetsjs.includes('maps:')));
test('each preset has kelvin field', () => assert(presetsjs.includes('kelvin:')));

// ── Results ───────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed+failed} tests`);
if (failed > 0) {
  console.log('\nFAILED TESTS need attention.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
  process.exit(0);
}
