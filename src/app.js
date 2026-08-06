import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader }    from 'three/addons/loaders/RGBELoader.js';
import { PRESETS }       from './presets.js';

// ── Workers — external files, no blob URL needed ────────────────────
const _mainWorkerURL = 'workers/pbr.js';
const worker = new Worker(_mainWorkerURL);

// ── Three.js setup ────────────────────────────────────────────────────
const wrap = document.getElementById('view-3d');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdce0e5);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 3, 5);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;
wrap.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.rotateSpeed = 0.8;
controls.minDistance = 1;
controls.maxDistance = 20;

const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
dirLight.position.set(5, 8, 5);
scene.add(dirLight);
// Rim light — subtle backlight for depth separation
const rim  = new THREE.DirectionalLight(0xddeeff, 0.5); rim.position.set(-5, 3, -5); scene.add(rim);
// Fill light — soft shadow fill from below
const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(0, -4, 3); scene.add(fill);

// Resize: always sync camera aspect (free), only resize buffer when requested
const _canvasWrap = document.getElementById('canvas-wrap');
let _rw = 0, _rh = 0;
let _needsRender = true;
function requestRender() { _needsRender = true; }

function onResize(updateBuffer = true) {
  const w = _canvasWrap.clientWidth, h = _canvasWrap.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (updateBuffer && (w !== _rw || h !== _rh)) {
    _rw = w; _rh = h;
    renderer.setSize(w, h, true);
    requestRender();
  }
}

// Retry until layout resolves — critical on mobile where flex layout
// isn't calculated at script parse time
function _initResize() {
  if (_canvasWrap.clientWidth && _canvasWrap.clientHeight) {
    onResize(true);
  } else {
    requestAnimationFrame(_initResize);
  }
}
_initResize();
window.addEventListener('resize', onResize);

// Demand-render loop — only renders when something actually changed
function animationLoop() {
  requestAnimationFrame(animationLoop);
  // Aspect sync during CSS transitions (cached DOM ref — cheap)
  const aspect = _canvasWrap.clientWidth / (_canvasWrap.clientHeight || 1);
  if (Math.abs(camera.aspect - aspect) > 0.001) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    _needsRender = true;
  }
  controls.update(); // damping — flags needsRender via 'change' event
  if (_needsRender) {
    _needsRender = false;
    renderer.render(scene, camera);
  }
}
controls.addEventListener('change', requestRender);
controls.addEventListener('start',  requestRender);
animationLoop();
requestRender();
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRender(); });

// ── Standard view snap ────────────────────────────────────────────────
const _STANDARD_VIEWS = [
  { name:'Front',  pos: new THREE.Vector3(0, 0,  7) },
  { name:'Back',   pos: new THREE.Vector3(0, 0, -7) },
  { name:'Right',  pos: new THREE.Vector3(7, 0,  0) },
  { name:'Left',   pos: new THREE.Vector3(-7,0,  0) },
  { name:'Top',    pos: new THREE.Vector3(0, 7,  0) },
  { name:'Bottom', pos: new THREE.Vector3(0,-7,  0) },
];

function snapToStandardView() {
  const cur = camera.position.clone().normalize();
  let best = _STANDARD_VIEWS[0], bestDot = -Infinity;
  for (const v of _STANDARD_VIEWS) {
    const d = cur.dot(v.pos.clone().normalize());
    if (d > bestDot) { bestDot = d; best = v; }
  }
  // Smooth tween to target
  const start = camera.position.clone();
  const end   = best.pos.clone();
  const dur   = 350, t0 = performance.now();
  function tween() {
    const t = Math.min((performance.now() - t0) / dur, 1);
    const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease-in-out
    camera.position.lerpVectors(start, end, e);
    camera.lookAt(controls.target);
    controls.update(); requestRender();
    if (t < 1) requestAnimationFrame(tween);
  }
  requestAnimationFrame(tween);
  // Show label
  const lbl = document.getElementById('view-label');
  if (lbl) {
    lbl.textContent = best.name;
    lbl.style.opacity = '1';
    clearTimeout(lbl._t);
    lbl._t = setTimeout(() => { lbl.style.opacity = '0'; }, 1200);
  }
}
window.snapToStandardView = snapToStandardView;

// Hide loading overlay — wait for first real render after layout resolves
const loadEl = document.getElementById('loading');
(function waitForFirstRender() {
  if (_rw && _rh) {
    renderer.render(scene, camera);
    loadEl.style.opacity = '0';
    setTimeout(() => { loadEl.style.display = 'none'; }, 400);
  } else {
    requestAnimationFrame(waitForFirstRender);
  }
})();

const hdriBase = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/';
let currentHdr = null, lightingMode = 'manual';

const mat = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 1.0, metalness: 0.0,
  side: THREE.DoubleSide, transparent: true, opacity: 1.0
});
let mesh = null;
const loadedMaps = {};
const propMap = {
  albedo:    'map',
  normal:    'normalMap',
  roughness: 'roughnessMap',
  ao:        'aoMap',
  metalness: 'metalnessMap',
  emissive:  'emissiveMap',
  height:    'displacementMap',
  opacity:   'alphaMap',
};

function buildShape(type) {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  const subs = parseInt(document.getElementById('geo-subs')?.value || 64);
  let geo;
  if      (type==='sphere')   geo = new THREE.SphereGeometry(2, subs, subs);
  else if (type==='cube')     geo = new THREE.BoxGeometry(3, 3, 3, subs, subs, subs);
  else if (type==='cylinder') geo = new THREE.CylinderGeometry(1.5, 1.5, 3, subs, subs);
  else { geo = new THREE.PlaneGeometry(6, 6, subs, subs); geo.rotateX(-Math.PI/2); }
  if (!geo.attributes.uv2)
    geo.setAttribute('uv2', new THREE.BufferAttribute(geo.attributes.uv.array.slice(), 2));
  mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  camera.position.set(0, type==='plane'?4:2, type==='plane'?4:6);
  controls.target.set(0,0,0); controls.update(); requestRender();
}
let _currentShape = 'sphere';
buildShape('sphere');

function setLight(x, y) {
  dirLight.position.setFromSphericalCoords(10,
    THREE.MathUtils.degToRad(90-y), THREE.MathUtils.degToRad(x));
  requestRender();
}
setLight(45, 45);

function setLightingMode(mode) {
  lightingMode = mode;
  if (mode === 'hdri') {
    dirLight.visible = rim.visible = fill.visible = false;
    renderer.toneMappingExposure = 2.0;
    mat.envMapIntensity = parseFloat(document.getElementById('hdri-intensity').value) || 0.6;
    mat.needsUpdate = true;
    if (!currentHdr) loadHDRI('studio_small_08_1k.hdr');
    document.getElementById('manual-light-ctrls').style.opacity = '0.35';
    document.getElementById('manual-light-ctrls').style.pointerEvents = 'none';
    document.getElementById('hdri-intensity-ctrl').style.opacity = '1';
    document.getElementById('hdri-intensity-ctrl').style.pointerEvents = '';
  } else {
    dirLight.visible = rim.visible = fill.visible = true;
    renderer.toneMappingExposure = 1.2;
    mat.envMapIntensity = 0; mat.needsUpdate = true;
    if (currentHdr) { currentHdr.dispose(); currentHdr = null; }
    scene.environment = null;
    scene.background = new THREE.Color(0xdce0e5);
    document.getElementById('manual-light-ctrls').style.opacity = '1';
    document.getElementById('manual-light-ctrls').style.pointerEvents = '';
    document.getElementById('hdri-intensity-ctrl').style.opacity = '0.35';
    document.getElementById('hdri-intensity-ctrl').style.pointerEvents = 'none';
    requestRender(4);
  }
}

function loadHDRI(filename) {
  new RGBELoader().load(hdriBase + filename, hdr => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    if (currentHdr) currentHdr.dispose();
    currentHdr = hdr;
    scene.environment = scene.background = hdr;
    requestRender(4);
  });
}

// Convert RGBA Uint8ClampedArray → data URL → Three texture
function rgbaToDataURL(rgba, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  return c.toDataURL('image/png');
}

function disposeSlot(prop) {
  if (mat[prop]?.isTexture) { mat[prop].dispose(); mat[prop] = null; }
}

function applyMaps(maps) {
  const keys = Object.keys(propMap);
  let loaded = 0;
  const texLoader = new THREE.TextureLoader();
  keys.forEach(key => {
    if (!maps[key]) { loaded++; return; }
    disposeSlot(propMap[key]);
    texLoader.load(maps[key], tex => {
      if (key==='albedo') tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const t = parseFloat(document.getElementById('tile').value) || 1;
      tex.repeat.set(t, t);
      loadedMaps[key] = tex;
      const eyeBtn = document.getElementById('eye-' + key);
      const eyeActive = !eyeBtn || eyeBtn.classList.contains('active');
      if (eyeActive) {
        mat[propMap[key]] = tex;
        if (key === 'normal') {
          const nsc = parseFloat(document.getElementById('nsc').value) || 1;
          mat.normalScale?.set(nsc, nsc);
        }
        if (key === 'ao') mat.aoMapIntensity = parseFloat(document.getElementById('aoi').value) || 0.6;
        if (key === 'emissive') {
          mat.emissive = new THREE.Color(0xffffff);
          mat.emissiveIntensity = parseFloat(document.getElementById('emi-intensity').value) || 1.0;
        }
        if (key === 'height') {
          const sv = parseFloat(document.getElementById('hgt-scale').value) || 0;
          mat.displacementScale = sv; mat.displacementBias = -sv / 2;
        }
        if (key === 'metalness') mat.metalness = 1.0;
        if (key === 'opacity') { mat.transparent = true; mat.alphaTest = 0.01; }
      }
      mat.needsUpdate = true; requestRender();
      if (++loaded === keys.length) { mat.needsUpdate = true; requestRender(); }
    });
  });
  mat.roughness = 1.0; mat.color.set(0xffffff);
  mat.envMapIntensity = lightingMode==='hdri'
    ? (parseFloat(document.getElementById('hdri-intensity').value)||2.0) : 0;
  mat.needsUpdate = true; requestRender(4);
}

function populate2D(maps) {
  const labels = {
    albedo:'Albedo', normal:'Normal', roughness:'Roughness', ao:'Ambient Occlusion',
    height:'Height', metalness:'Metalness', emissive:'Emissive', opacity:'Opacity',
  };
  Object.keys(labels).forEach(key => {
    const card = document.getElementById('card-'+key);
    if (!card || !maps[key]) return;
    card.innerHTML = `<div class="map-card-title"><span>${labels[key]}</span>
      <a class="btn-dl" href="${maps[key]}" download="${key}.png">&#8595; Save</a></div>
      <img src="${maps[key]}" alt="${labels[key]}">`;
  });
  if (maps.albedo) {
    document.getElementById('card-tile-test').innerHTML =
      `<div class="map-card-title"><span>Tiling Test (3×3)</span>
       <button class="btn-dl" id="btn-dl-tile">&#8595; Save</button></div>
       <div id="tile-test-canvas" style="background-image:url('${maps.albedo}')"></div>`;
    // Save button — renders the 3x3 tile to a canvas and downloads it
    document.getElementById('btn-dl-tile').addEventListener('click', () => {
      const src = maps.albedo;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width * 3; c.height = img.height * 3;
        const ctx = c.getContext('2d');
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 3; col++)
            ctx.drawImage(img, col * img.width, row * img.height);
        const a = document.createElement('a');
        a.href = c.toDataURL('image/png');
        a.download = currentFileName + '_tiled3x3.png';
        a.click();
      };
      img.src = src;
    });
  }
}

// ── Download All as ZIP (pure JS, no CDN dependency) ─────────────────
// Minimal ZIP builder — stores files uncompressed (STORE method)
function _buildZip(files) {
  // files: [{name, data: Uint8Array}]
  const encoder = new TextEncoder();
  const localHeaders = [];
  const centralDir   = [];
  let offset = 0;

  function u16(n) { return [n & 0xff, (n >> 8) & 0xff]; }
  function u32(n) { return [n & 0xff, (n>>8)&0xff, (n>>16)&0xff, (n>>24)&0xff]; }

  // CRC-32 table
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c;
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const parts = [];
  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const crc  = crc32(f.data);
    const size = f.data.length;
    const lh = new Uint8Array([
      0x50,0x4b,0x03,0x04, // local file header sig
      20,0,                 // version needed
      0,0,                  // flags
      0,0,                  // compression (STORE)
      0,0,0,0,              // mod time/date
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), 0,0, // fname len, extra len
      ...nameBytes,
    ]);
    localHeaders.push({ nameBytes, crc, size, offset });
    parts.push(lh, f.data);
    offset += lh.length + size;

    const cd = new Uint8Array([
      0x50,0x4b,0x01,0x02,  // central dir sig
      20,0, 20,0,            // versions
      0,0, 0,0,              // flags, compression
      0,0,0,0,               // mod time/date
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), 0,0, 0,0, 0,0, 0,0, 0,0,0,0,
      ...u32(localHeaders[localHeaders.length-1].offset),
      ...nameBytes,
    ]);
    centralDir.push(cd);
  }

  const cdSize   = centralDir.reduce((s, b) => s + b.length, 0);
  const cdOffset = offset;
  const eocd = new Uint8Array([
    0x50,0x4b,0x05,0x06, 0,0, 0,0,
    ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(cdOffset),
    0,0,
  ]);

  const totalLen = parts.reduce((s,b) => s+b.length, 0) + cdSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const b of [...parts, ...centralDir, eocd]) { out.set(b, pos); pos += b.length; }
  return out;
}

// Build a PNG data URL from an ImageData-like source on a canvas
function _imageDataToDataURL(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(src instanceof ImageData ? src : new ImageData(new Uint8ClampedArray(src), w, h), 0, 0);
  return c.toDataURL('image/png');
}

// Build a 2x2 tiled preview data URL from a source image data URL
function _buildTilePreview(dataUrl) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width * 2; c.height = img.height * 2;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      ctx.drawImage(img, img.width, 0);
      ctx.drawImage(img, 0, img.height);
      ctx.drawImage(img, img.width, img.height);
      res(c.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}

// Build a 3D shader preview — zooms camera out slightly for framing, renders, restores
function _buildShaderPreview() {
  try {
    const origPos = camera.position.clone();
    camera.position.multiplyScalar(1.35);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    camera.position.copy(origPos);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return dataUrl;
  } catch { return null; }
}

// Build a 2D flat material preview — composite: albedo + AO darkening + emissive overlay
function _build2DPreview(maps) {
  return new Promise(res => {
    const albedoUrl = maps.albedo;
    if (!albedoUrl) { res(null); return; }
    const img = new Image();
    img.onload = () => {
      const w = img.width, h = img.height;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      // Base: albedo
      ctx.drawImage(img, 0, 0);
      // AO darkening
      if (maps.ao) {
        const aoImg = new Image();
        aoImg.onload = () => {
          ctx.save();
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.6;
          ctx.drawImage(aoImg, 0, 0, w, h);
          ctx.restore();
          applyEmissive();
        };
        aoImg.src = maps.ao;
      } else { applyEmissive(); }
      function applyEmissive() {
        if (maps.emissive) {
          const emiImg = new Image();
          emiImg.onload = () => {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = 0.8;
            ctx.drawImage(emiImg, 0, 0, w, h);
            ctx.restore();
            res(c.toDataURL('image/png'));
          };
          emiImg.src = maps.emissive;
        } else { res(c.toDataURL('image/png')); }
      }
    };
    img.src = albedoUrl;
  });
}

function _dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Resize a dataUrl image to target dimensions, returns a new dataUrl
function _resizeDataUrl(dataUrl, tw, th) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      c.getContext('2d').drawImage(img, 0, 0, tw, th);
      res(c.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}

// Normalize all maps to the same resolution
async function _normalizeMaps(maps) {
  const resEl = document.getElementById('output-res');
  const targetRes = parseInt(resEl?.value || '0');
  if (!targetRes) return maps; // 0 = source resolution, no resize

  const normalized = {};
  await Promise.all(Object.entries(maps).map(async ([key, dataUrl]) => {
    normalized[key] = await _resizeDataUrl(dataUrl, targetRes, targetRes);
  }));
  return normalized;
}

async function downloadZip(maps, name) {
  // Normalize all maps to the same resolution
  const normalizedMaps = await _normalizeMaps(maps);

  const files = [];
  // Map textures
  for (const [key, dataUrl] of Object.entries(normalizedMaps)) {
    files.push({ name: `${name}_${key}.png`, data: _dataUrlToBytes(dataUrl) });
  }
  // 3D shader preview
  const shaderPreview = _buildShaderPreview();
  if (shaderPreview) files.push({ name: `${name}_preview_3d.png`, data: _dataUrlToBytes(shaderPreview) });
  // 2D flat material preview (composite: albedo + AO + emissive)
  const preview2d = await _build2DPreview(normalizedMaps);
  if (preview2d) files.push({ name: `${name}_preview_2d.png`, data: _dataUrlToBytes(preview2d) });
  // 2x2 tiled preview — use the 2D composite as source so it shows the full material
  const tileSource = preview2d || normalizedMaps.albedo
    || (stackImageData ? _imageDataToDataURL(stackImageData, stackImageData.width, stackImageData.height) : null)
    || (loadedImageData ? _imageDataToDataURL(loadedImageData, loadedImageData.width, loadedImageData.height) : null);
  if (tileSource) {
    const tileUrl = await _buildTilePreview(tileSource);
    files.push({ name: `${name}_tiled_2x2.png`, data: _dataUrlToBytes(tileUrl) });
  }
  const zipData = _buildZip(files);
  const blob = new Blob([zipData], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_pbr_maps.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ── Map channel toggles — now handled by eye buttons in each card ─────
// (old .map-toggle buttons removed; toggleMapEye() handles this)

function sl(id, vid, dec, cb) {
  const el = document.getElementById(id), vl = document.getElementById(vid);
  if (!el||!vl) return;
  el.addEventListener('input', () => { const v=parseFloat(el.value); vl.textContent=v.toFixed(dec); cb(v); });
  // Click value label → inline numeric input
  vl.style.cursor = 'text';
  vl.title = 'Click to enter a value';
  vl.addEventListener('click', () => {
    const cur = el.value;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = cur; inp.step = el.step || 'any';
    inp.style.cssText = 'width:52px;font-size:11px;font-weight:600;color:#c4b5fd;background:#1a1b22;border:1px solid #702af8;border-radius:4px;padding:1px 4px;outline:none;text-align:right';
    vl.replaceWith(inp);
    inp.focus(); inp.select();
    const confirm = () => {
      const raw = parseFloat(inp.value);
      if (!isNaN(raw)) {
        // Extend range if needed
        if (raw < parseFloat(el.min)) el.min = raw;
        if (raw > parseFloat(el.max)) el.max = raw;
        el.value = raw;
        el.dispatchEvent(new Event('input'));
      }
      const newVl = document.createElement('b');
      newVl.id = vid; newVl.textContent = isNaN(raw) ? cur : raw.toFixed(dec);
      newVl.style.cursor = 'text'; newVl.title = 'Click to enter a value';
      inp.replaceWith(newVl);
      // Re-attach click listener to new element
      sl._attachClick(newVl, el, vid, dec, cb);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { inp.value = cur; confirm(); } });
    inp.addEventListener('blur', confirm);
  });
}
sl._attachClick = function(vl, el, vid, dec, cb) {
  vl.addEventListener('click', () => {
    const cur = el.value;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = cur; inp.step = el.step || 'any';
    inp.style.cssText = 'width:52px;font-size:11px;font-weight:600;color:#c4b5fd;background:#1a1b22;border:1px solid #702af8;border-radius:4px;padding:1px 4px;outline:none;text-align:right';
    vl.replaceWith(inp);
    inp.focus(); inp.select();
    const confirm = () => {
      const raw = parseFloat(inp.value);
      if (!isNaN(raw)) {
        if (raw < parseFloat(el.min)) el.min = raw;
        if (raw > parseFloat(el.max)) el.max = raw;
        el.value = raw;
        el.dispatchEvent(new Event('input'));
      }
      const newVl = document.createElement('b');
      newVl.id = vid; newVl.textContent = isNaN(raw) ? cur : raw.toFixed(dec);
      newVl.style.cursor = 'text'; newVl.title = 'Click to enter a value';
      inp.replaceWith(newVl);
      sl._attachClick(newVl, el, vid, dec, cb);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { inp.value = cur; confirm(); } });
    inp.addEventListener('blur', confirm);
  });
};
sl('tile','vtile',1, v => { ['map','normalMap','roughnessMap','aoMap','metalnessMap','emissiveMap','displacementMap'].forEach(k=>{if(mat[k])mat[k].repeat.set(v,v);}); requestRender(); });
sl('nsc','vnsc',1, v => { if(mat.normalScale) mat.normalScale.set(v,v); requestRender(); });
sl('aoi','vaoi',1, v => { mat.aoMapIntensity=v; mat.needsUpdate=true; requestRender(); });
// Kelvin to RGB — maps color temperature to a THREE.Color
function kelvinToColor(k) {
  // Simplified Tanner Helland algorithm
  k = Math.max(1000, Math.min(12000, k)) / 100;
  let r, g, b;
  r = k <= 66 ? 255 : 329.698727446 * Math.pow(k - 60, -0.1332047592);
  if (k <= 66) g = 99.4708025861 * Math.log(k) - 161.1195681661;
  else         g = 288.1221695283 * Math.pow(k - 60, -0.0755148492);
  b = k >= 66 ? 255 : (k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307);
  return new THREE.Color(Math.max(0,Math.min(255,r))/255, Math.max(0,Math.min(255,g))/255, Math.max(0,Math.min(255,b))/255);
}

sl('li','vli',1,   v => { dirLight.intensity=v; requestRender(); });
sl('amb','vamb',1, v => { ambLight.intensity=v; requestRender(); });
sl('kelvin','vkelvin',0, v => {
  document.getElementById('vkelvin').textContent = Math.round(v) + 'K';
  const col = kelvinToColor(v);
  dirLight.color.copy(col);
  // Tint ambient slightly (less saturated)
  ambLight.color.set(new THREE.Color().lerpColors(col, new THREE.Color(1,1,1), 0.6));
  requestRender();
});
sl('lx','vlx',0, () => setLight(+document.getElementById('lx').value, +document.getElementById('ly').value));
sl('ly','vly',0, () => setLight(+document.getElementById('lx').value, +document.getElementById('ly').value));
sl('hdri-intensity','vhdrii',1, v => { mat.envMapIntensity=v; mat.needsUpdate=true; requestRender(); });
sl('exposure','vexp',1, v => { renderer.toneMappingExposure=v; requestRender(); });
sl('opacity-slider','vopacity',2, v => { mat.opacity=v; mat.transparent=v<1; mat.needsUpdate=true; requestRender(4); });
sl('hgt-scale','vhgtscale',2, v => {
  autoEnableEye('eye-height');
  const eyeBtn = document.getElementById('eye-height');
  const active = !eyeBtn || eyeBtn.classList.contains('active');
  if (mapOverrides['height']) {
    // Uploaded map — directly set displacement
    if (active) { mat.displacementScale = v; mat.displacementBias = -v / 2; mat.needsUpdate = true; requestRender(); }
    return;
  }
  if (mat.displacementMap && active) {
    mat.displacementScale = v; mat.displacementBias = -v / 2;
    mat.needsUpdate = true; requestRender();
  }
  setSpinner('hgt-scale', true);
  runLivePreview('height', 'hgt-scale');
});
// Subdivisions — rebuilds geometry so displacement has enough vertices
sl('geo-subs','vsubs',0, () => buildShape(_currentShape));

// ── Context menus ─────────────────────────────────────────────────────
const SHAPE_ICONS = {
  sphere:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="3" ry="6"/><line x1="2" y1="8" x2="14" y2="8"/></svg>',
  plane:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="12" height="7" rx="1"/></svg>',
  cube:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 10.5L8 13.5L13 10.5V5.5L8 2.5L3 5.5z"/><line x1="8" y1="13.5" x2="8" y2="8"/><line x1="3" y1="5.5" x2="8" y2="8"/><line x1="13" y1="5.5" x2="8" y2="8"/></svg>',
  cylinder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="5" rx="5" ry="2"/><ellipse cx="8" cy="11" rx="5" ry="2"/><line x1="3" y1="5" x2="3" y2="11"/><line x1="13" y1="5" x2="13" y2="11"/></svg>',
};
const ctxShape    = document.getElementById('ctx-shape');
const ctxLighting = document.getElementById('ctx-lighting');
const tbShape     = document.getElementById('tb-shape-wrap');
const tbLight     = document.getElementById('tb-lighting-btn');

function closeAllCtx() { ctxShape.classList.remove('open'); ctxLighting.classList.remove('open'); }
function openCtx(menu, btn) {
  closeAllCtx();
  const r = btn.getBoundingClientRect();
  menu.style.top  = (r.bottom + 6) + 'px';
  menu.style.right = (window.innerWidth - r.right) + 'px';
  menu.style.left = 'auto';
  menu.classList.add('open');
}

tbShape.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); ctxShape.classList.contains('open') ? closeAllCtx() : openCtx(ctxShape, tbShape); });
tbLight.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); ctxLighting.classList.contains('open') ? closeAllCtx() : openCtx(ctxLighting, tbLight); });
// Left-click also opens the menus
tbShape.addEventListener('click', e => { e.stopPropagation(); ctxShape.classList.contains('open') ? closeAllCtx() : openCtx(ctxShape, tbShape); });
tbLight.addEventListener('click', e => { e.stopPropagation(); ctxLighting.classList.contains('open') ? closeAllCtx() : openCtx(ctxLighting, tbLight); });

// Touch support — long-press OR tap opens the menu on mobile
function addTouchMenu(btn, menu) {
  let pressTimer = null;
  btn.addEventListener('touchstart', e => {
    e.preventDefault();
    // Short tap toggles menu (no long-press needed on mobile)
    pressTimer = setTimeout(() => { pressTimer = null; }, 300);
    menu.classList.contains('open') ? closeAllCtx() : openCtx(menu, btn);
  }, { passive: false });
  btn.addEventListener('touchend', e => { e.preventDefault(); if (pressTimer) clearTimeout(pressTimer); }, { passive: false });
}
addTouchMenu(tbShape, ctxShape);
addTouchMenu(tbLight, ctxLighting);
// Suppress browser context menu globally on toolbar area
document.getElementById('toolbar').addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('click', e => { if (!e.target.closest('.ctx-menu') && !e.target.closest('.tb-btn')) closeAllCtx(); });
document.addEventListener('touchstart', e => { if (!e.target.closest('.ctx-menu') && !e.target.closest('.tb-btn')) closeAllCtx(); }, { passive: true });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllCtx(); });

// Shape menu items
ctxShape.querySelectorAll('.ctx-item').forEach(item => {
  item.addEventListener('click', () => {
    const shape = item.dataset.shape;
    _currentShape = shape;
    buildShape(shape);
    ctxShape.querySelectorAll('.ctx-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    tbShape.innerHTML = SHAPE_ICONS[shape];
    closeAllCtx();
  });
});

// Lighting menu items
document.getElementById('ctx-manual').addEventListener('click', () => {
  setLightingMode('manual');
  document.getElementById('ctx-manual').classList.add('active');
  document.getElementById('ctx-hdri').classList.remove('active');
  tbLight.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><circle cx="8" cy="8" r="3"/><line x1="8" y1="1" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="1" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="15" y2="8"/><line x1="3" y1="3" x2="4.5" y2="4.5"/><line x1="11.5" y1="11.5" x2="13" y2="13"/><line x1="13" y1="3" x2="11.5" y2="4.5"/><line x1="4.5" y1="11.5" x2="3" y2="13"/></svg>';
  tbLight.classList.remove('light-hdri');
  closeAllCtx();
});
document.getElementById('ctx-hdri').addEventListener('click', () => {
  setLightingMode('hdri');
  document.getElementById('ctx-hdri').classList.add('active');
  document.getElementById('ctx-manual').classList.remove('active');
  tbLight.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><circle cx="8" cy="8" r="6"/><path d="M2 8 Q5 4 8 8 Q11 12 14 8"/><line x1="2" y1="8" x2="14" y2="8"/></svg>';
  tbLight.classList.add('light-hdri');
  closeAllCtx();
});
ctxLighting.querySelectorAll('.ctx-hdri-opt').forEach(item => {
  item.addEventListener('click', () => {
    const hdr = item.dataset.hdri;
    // Switch to HDRI mode and load this preset
    setLightingMode('hdri');
    loadHDRI(hdr);
    document.getElementById('ctx-hdri').classList.add('active');
    document.getElementById('ctx-manual').classList.remove('active');
    ctxLighting.querySelectorAll('.ctx-hdri-opt').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    tbLight.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><circle cx="8" cy="8" r="6"/><path d="M2 8 Q5 4 8 8 Q11 12 14 8"/><line x1="2" y1="8" x2="14" y2="8"/></svg>';
    tbLight.classList.add('light-hdri');
    closeAllCtx();
  });
});

// ── 2D / 3D toggle ────────────────────────────────────────────────────
const view3d = document.getElementById('view-3d');
const view2d = document.getElementById('view-2d');
const sec3d  = document.getElementById('section-3d-controls');

function setViewMode(mode) {
  if (mode === '3d') {
    view3d.classList.remove('hidden'); view2d.classList.remove('visible');
    sec3d.style.display = '';
    document.getElementById('btn-3d').classList.add('active');
    document.getElementById('btn-2d').classList.remove('active');
    document.getElementById('tb-shape-wrap').style.visibility = '';
    document.getElementById('tb-lighting-btn').style.visibility = '';
    // Deferred resize after display change settles
    setTimeout(onResize, 50);
  } else {
    view3d.classList.add('hidden'); view2d.classList.add('visible');
    sec3d.style.display = 'none';
    document.getElementById('btn-2d').classList.add('active');
    document.getElementById('btn-3d').classList.remove('active');
    document.getElementById('tb-shape-wrap').style.visibility = 'hidden';
    document.getElementById('tb-lighting-btn').style.visibility = 'hidden';
    closeAllCtx();
  }
}
document.getElementById('btn-3d').onclick = () => setViewMode('3d');
document.getElementById('btn-2d').onclick = () => setViewMode('2d');

// ── File input ────────────────────────────────────────────────────────
let loadedImageData = null, currentFileName = 'texture';
let thumbObjectURL = null;
const dropZone = document.getElementById('drop-zone');
const thumb    = document.getElementById('preview-thumb');
const hint     = dropZone.querySelector('.hint');
const genBtn   = document.getElementById('btn-generate');
const statusEl = document.getElementById('status');

function setStatus(msg, cls) { statusEl.textContent = msg; statusEl.className = cls || ''; }

// ── Input mode: image vs solid color ─────────────────────────────────
function setInputMode(mode) {
  document.getElementById('input-image-mode').style.display = mode === 'image' ? '' : 'none';
  document.getElementById('input-color-mode').style.display = mode === 'color' ? '' : 'none';
  const bImg = document.getElementById('btn-input-image');
  const bCol = document.getElementById('btn-input-color');
  if (mode === 'image') {
    bImg.style.borderColor='#702af8'; bImg.style.background='rgba(112,42,248,.15)'; bImg.style.color='#a78bfa';
    bCol.style.borderColor='#2d2f3d'; bCol.style.background='transparent'; bCol.style.color='#94a3b8';
  } else {
    bCol.style.borderColor='#702af8'; bCol.style.background='rgba(112,42,248,.15)'; bCol.style.color='#a78bfa';
    bImg.style.borderColor='#2d2f3d'; bImg.style.background='transparent'; bImg.style.color='#94a3b8';
    document.getElementById('btn-apply-color').disabled = false;
  }
}

function setBaseColor(hex) {
  document.getElementById('base-color-picker').value = hex;
  document.getElementById('base-color-label').textContent = hex;
}

function applyBaseColor() {
  const hex = document.getElementById('base-color-picker').value;
  document.getElementById('base-color-label').textContent = hex;
  // Parse hex → RGB
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  // Build a 512×512 solid-color ImageData
  const size = 512;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i*4]=r; data[i*4+1]=g; data[i*4+2]=b; data[i*4+3]=255;
  }
  const imgData = new ImageData(data, size, size);
  // Reuse the loadFile pipeline but feed it ImageData directly
  currentFileName = 'color_' + hex.replace('#','');
  document.getElementById('file-name').textContent = 'Solid color: ' + hex;
  loadedImageData = imgData;
  initPipeline(imgData);
  genBtn.disabled = false;
  setStatus('Ready — solid color ' + hex, '');
  // Apply as albedo preview on sphere
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.getContext('2d').putImageData(imgData, 0, 0);
  applyMaps({ albedo: c.toDataURL('image/png') });
  document.getElementById('canvas-hint').style.display = 'none';
  document.getElementById('btn-tile-test').style.display = '';
  resetPills();

  // Collapse picker — show compact swatch
  document.getElementById('color-picker-expanded').style.display = 'none';
  const collapsed = document.getElementById('color-picker-collapsed');
  collapsed.style.display = 'flex';
  document.getElementById('color-swatch-preview').style.background = hex;
  document.getElementById('color-swatch-label').textContent = hex;
}

// Update label when color picker changes
document.getElementById('base-color-picker')?.addEventListener('input', e => {
  document.getElementById('base-color-label').textContent = e.target.value;
});

window.setInputMode  = setInputMode;
window.setBaseColor  = setBaseColor;
window.applyBaseColor = applyBaseColor;

// ── Material Presets ──────────────────────────────────────────────────
function _setSlider(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function applyPreset(preset) {
  // Switch to solid color mode and apply the preset color
  setInputMode('color');
  document.getElementById('base-color-picker').value = preset.color;
  document.getElementById('base-color-label').textContent = preset.color;
  applyBaseColor();

  // Set all generation sliders (after a tick so loadedImageData is ready)
  setTimeout(() => {
    _setSlider('ns',            preset.ns);
    _setSlider('ra',            preset.ra);
    _setSlider('rb',            preset.rb);
    _setSlider('aogen',         preset.aogen);
    _setSlider('hgt-scale',     preset.hgtScale);
    _setSlider('hgt-contrast',  preset.hgtContrast);
    _setSlider('met-threshold', preset.metThreshold);
    _setSlider('met-contrast',  preset.metContrast);
    _setSlider('emi-threshold', preset.emiThreshold);
    _setSlider('emi-intensity', preset.emiIntensity);
    _setSlider('opa-threshold', preset.opaThreshold);

    // hgt-invert checkbox
    const inv = document.getElementById('hgt-invert');
    if (inv) inv.checked = preset.hgtInvert ?? false;

    // Set eye toggles — turn on/off per preset
    Object.entries(preset.maps).forEach(([key, on]) => {
      const btn = document.getElementById('eye-' + key);
      if (!btn) return;
      const isActive = btn.classList.contains('active');
      if (on && !isActive) btn.click();
      else if (!on && isActive) btn.click();
    });

    // Lighting
    _setSlider('li',     preset.li);
    _setSlider('amb',    preset.amb);
    _setSlider('kelvin', preset.kelvin);

    // Highlight active preset button
    document.querySelectorAll('.preset-btn').forEach(b => {
      b.style.borderColor = b.dataset.preset === preset.name ? '#702af8' : '#2d2f3d';
      b.style.background  = b.dataset.preset === preset.name ? 'rgba(112,42,248,.1)' : '#111218';
    });
  }, 50);
}
window.applyPreset = applyPreset;

function togglePresetPanel() {
  const panel = document.getElementById('preset-panel');
  const isOpen = panel.style.display === 'flex';
  panel.style.display = isOpen ? 'none' : 'flex';
  document.getElementById('tb-preset-btn').classList.toggle('light-hdri', !isOpen);
}
window.togglePresetPanel = togglePresetPanel;

// Close preset panel when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#preset-panel') && !e.target.closest('#tb-preset-btn')) {
    const panel = document.getElementById('preset-panel');
    if (panel) panel.style.display = 'none';
    document.getElementById('tb-preset-btn')?.classList.remove('light-hdri');
  }
});

// Build preset grid
(function buildPresetGrid() {
  const grid = document.getElementById('preset-grid');
  if (!grid) return;
  PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.dataset.preset = p.name;
    btn.innerHTML = `
      <div class="preset-swatch" style="background:${p.swatch}"></div>
      <span class="preset-name">${p.name}</span>
      <span class="preset-tags">${p.tags}</span>`;
    btn.addEventListener('click', () => {
      applyPreset(p);
      // Close panel after selection
      document.getElementById('preset-panel').style.display = 'none';
      document.getElementById('tb-preset-btn')?.classList.remove('light-hdri');
    });
    grid.appendChild(btn);
  });
})();

function loadFile(file) {
  currentFileName = file.name.replace(/\.[^.]+$/, '');
  if (thumbObjectURL) URL.revokeObjectURL(thumbObjectURL);
  thumbObjectURL = URL.createObjectURL(file);
  thumb.src = thumbObjectURL; thumb.style.display = 'block'; hint.style.display = 'none';
  document.getElementById('file-name').textContent = file.name;
  genBtn.disabled = true;
  setStatus('Loading image…', '');
  resetPills();

  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    loadedImageData = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    initPipeline(loadedImageData);
    genBtn.disabled = false;
    setStatus('Ready — adjust sliders to preview live', '');
    const smChecked = document.getElementById('chk-seamless').checked;
    document.getElementById('seamless-opts').style.display = smChecked ? '' : 'none';
    document.getElementById('btn-seamless-only').style.display = smChecked ? '' : 'none';
    document.getElementById('btn-seamless-only').disabled = false;

    // Apply raw texture to shader immediately, then kick off live preview for normal group only
    const rawDataUrl = c.toDataURL('image/png');
    applyMaps({ albedo: rawDataUrl });
    document.getElementById('canvas-hint').style.display = 'none';
    document.getElementById('btn-tile-test').style.display = '';
    // Only auto-preview the normal/roughness/ao group if their sliders are non-zero
    const anyBaseSlider = +document.getElementById('ns').value > 0
      || +document.getElementById('ra').value > 0
      || +document.getElementById('aogen').value > 0;
    if (anyBaseSlider) runLivePreview('all');
  };
  img.onerror = () => setStatus('Failed to load image', 'err');
  img.src = thumbObjectURL;
}

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag'); if(e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
document.getElementById('file-input').addEventListener('change', e => { if(e.target.files[0]) loadFile(e.target.files[0]); });

// ── Tile test ─────────────────────────────────────────────────────────
const _tileModal       = document.getElementById('tile-test-modal');
const _tileCanvas      = document.getElementById('tile-test-modal-canvas');
const _tileGuideCanvas = document.getElementById('tile-test-guide-canvas');
let _tileGuidesOn = true;

function _drawTileGuides() {
  const w = _tileCanvas.width, h = _tileCanvas.height;
  _tileGuideCanvas.width  = w;
  _tileGuideCanvas.height = h;
  const ctx = _tileGuideCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!_tileGuidesOn) return;
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(112,42,248,0.85)';
  // vertical centre line
  ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
  // horizontal centre line
  ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
  // corner label hints
  ctx.restore();
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = 'rgba(167,139,250,0.9)';
  ctx.textAlign = 'center';
  ctx.fillText('SEAM', w/2, 14);
  ctx.fillText('SEAM', w/2, h - 4);
  ctx.save();
  ctx.translate(10, h/2);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('SEAM', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(w - 4, h/2);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('SEAM', 0, 0);
  ctx.restore();
}

function openTileTest() {
  if (!loadedImageData) return;
  const src = stackImageData || loadedImageData;
  const tw = src.width, th = src.height;
  _tileCanvas.width  = tw * 2;
  _tileCanvas.height = th * 2;
  const ctx = _tileCanvas.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = tw; tmp.height = th;
  tmp.getContext('2d').putImageData(src, 0, 0);
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 2; col++)
      ctx.drawImage(tmp, col * tw, row * th);
  _drawTileGuides();
  _tileModal.style.display = 'flex';
}

function toggleTileGuides() {
  _tileGuidesOn = !_tileGuidesOn;
  const btn = document.getElementById('btn-toggle-guides');
  btn.textContent = _tileGuidesOn ? 'Guidelines ON' : 'Guidelines OFF';
  btn.style.background    = _tileGuidesOn ? 'rgba(112,42,248,.2)' : 'transparent';
  btn.style.borderColor   = _tileGuidesOn ? '#702af8' : '#2d2f3d';
  btn.style.color         = _tileGuidesOn ? '#a78bfa' : '#4a4f6a';
  _drawTileGuides();
}

function closeTileTest() { _tileModal.style.display = 'none'; }
_tileModal.addEventListener('click', e => { if (e.target === _tileModal) closeTileTest(); });
window.openTileTest   = openTileTest;
window.closeTileTest  = closeTileTest;
window.toggleTileGuides = toggleTileGuides;

// ── Pill helpers ──────────────────────────────────────────────────────
const PILL_MAP  = { albedo:'pill-alb', normal:'pill-nrm', roughness:'pill-rgh', ao:'pill-ao', height:'pill-hgt', metalness:'pill-met', emissive:'pill-emi', opacity:'pill-opa' };
const PILL_SUFFIX = { albedo:'alb', normal:'nrm', roughness:'rgh', ao:'ao', height:'hgt', metalness:'met', emissive:'emi', opacity:'opa' };
const STEP_PILL = {
  'Saving albedo…':            'pill-alb',
  'Generating normal map…':    'pill-nrm',
  'Generating roughness map…': 'pill-rgh',
  'Generating AO map…':        'pill-ao',
  'Generating height map…':    'pill-hgt',
  'Generating metalness map…': 'pill-met',
  'Generating emissive map…':  'pill-emi',
  'Generating opacity map…':   'pill-opa',
};
function resetPills() {
  Object.values(PILL_MAP).forEach(id => {
    const el = document.getElementById(id);
    el.className = 'map-row';
    el.querySelector('.map-row-icon').textContent = '—';
    el.style.borderColor = '';
  });
  Object.values(PILL_SUFFIX).forEach(s => {
    ['btn-eye-','btn-regen-','btn-dl-'].forEach(p => {
      const b = document.getElementById(p+s);
      if (b) b.disabled = true;
    });
  });
  // Re-enable buttons for any active overrides
  Object.keys(mapOverrides).forEach(key => {
    const s = PILL_SUFFIX[key];
    ['btn-eye-','btn-regen-','btn-dl-'].forEach(p => {
      const b = document.getElementById(p+s);
      if (b) b.disabled = false;
    });
    const el = document.getElementById(PILL_MAP[key]);
    if (el) {
      el.classList.add('done');
      el.querySelector('.map-row-icon').textContent = '↑';
      el.style.borderColor = '#92400e';
    }
  });
}
function setPillWorking(id) {
  if (!id) return;
  const el = document.getElementById(id);
  el.classList.add('working');
  el.querySelector('.map-row-icon').textContent = '…';
}
function setPillDone(id) {
  if (!id) return;
  const el = document.getElementById(id);
  el.classList.remove('working'); el.classList.add('done');
  el.querySelector('.map-row-icon').textContent = '✔';
  // Enable action buttons
  const key = Object.keys(PILL_MAP).find(k => PILL_MAP[k] === id);
  if (key) {
    const s = PILL_SUFFIX[key];
    ['btn-eye-','btn-regen-','btn-dl-'].forEach(p => {
      const b = document.getElementById(p+s);
      if (b) b.disabled = false;
    });
  }
}

// ── Generate ──────────────────────────────────────────────────────────
let lastMaps = null;
let lastPill = null;

genBtn.addEventListener('click', () => {
  if (!loadedImageData) return;
  genBtn.disabled = true; resetPills(); lastPill = null;

  const pWrap = document.getElementById('progress-wrap');
  const pBar  = document.getElementById('progress-bar');
  const pLbl  = document.getElementById('progress-label');
  pWrap.style.display = 'block';
  pBar.style.width = '0%'; pBar.style.background = '#4f8ef7';
  pLbl.textContent = 'Starting…';
  setStatus('Generating…', '');

  // Use stackImageData (post-pipeline) if available, else raw loaded image
  const srcData = stackImageData || loadedImageData;
  const rgba = new Uint8ClampedArray(srcData.data);

  // Helper to get pixels for a specific channel — override takes priority
  const channelPixels = key => {
    const ov = window._overridePixels?.[key];
    return ov ? new Uint8ClampedArray(ov.data) : rgba;
  };
  const channelSize = key => {
    const ov = window._overridePixels?.[key];
    return ov ? { width: ov.width, height: ov.height } : { width: srcData.width, height: srcData.height };
  };

  // For channels with overrides, generate from override pixels (sliders still apply)
  // For channels without overrides, use albedo source as before
  // We run one worker per override-channel + one for the base channels
  // Simple approach: the main worker uses albedo, then we patch in override-derived maps after
  worker.postMessage({
    rgba,
    width:               srcData.width,
    height:              srcData.height,
    normalStrength:      +document.getElementById('ns').value,
    roughAlpha:          +document.getElementById('ra').value,
    roughBeta:           +document.getElementById('rb').value,
    aoAlpha:             +document.getElementById('aogen').value,
    heightScale:        +document.getElementById('hgt-scale').value,
    heightContrast:      +document.getElementById('hgt-contrast').value,
    heightInvert:        document.getElementById('hgt-invert').checked,
    metalnessThreshold:  +document.getElementById('met-threshold').value,
    metalnessContrast:   +document.getElementById('met-contrast').value,
    emissiveThreshold:   +document.getElementById('emi-threshold').value,
    emissiveIntensity:   +document.getElementById('emi-intensity').value,
    opacityThreshold:    +document.getElementById('opa-threshold').value,
    enableNormal:    document.getElementById('eye-normal')?.classList.contains('active') ?? true,
    enableRoughness: document.getElementById('eye-roughness')?.classList.contains('active') ?? true,
    enableAO:        document.getElementById('eye-ao')?.classList.contains('active') ?? true,
    enableHeight:    document.getElementById('eye-height')?.classList.contains('active') ?? false,
    enableMetalness: document.getElementById('eye-metalness')?.classList.contains('active') ?? false,
    enableEmissive:  document.getElementById('eye-emissive')?.classList.contains('active') ?? false,
    enableOpacity:   document.getElementById('eye-opacity')?.classList.contains('active') ?? false,
    makeSeamlessFlag: document.getElementById('chk-seamless').checked,
    blendRatio:      +document.getElementById('blend-ratio').value,
    workSize:        +(document.getElementById('work-size')?.value || 512),
  }, [rgba.buffer]);

  worker.onmessage = e => {
    const d = e.data;

    if (d.type === 'progress') {
      const pct = Math.round((d.step / d.total) * 100);
      pBar.style.width = pct + '%';
      pLbl.textContent = d.label;
      setStatus(d.label, '');
      if (lastPill) setPillDone(lastPill);
      lastPill = STEP_PILL[d.label] || null;
      if (lastPill) setPillWorking(lastPill);
    }

    if (d.type === 'done') {
      if (lastPill) setPillDone(lastPill);
      pBar.style.width = '100%';
      pLbl.textContent = '✔ Complete';

      // Helper — is this map's eye on?
      const eyeOn = key => {
        const btn = document.getElementById('eye-' + key);
        return !btn || btn.classList.contains('active'); // no eye btn = always on (albedo, roughness)
      };

      // Build maps only for what was generated AND eye is on
      const maps = {};
      maps.albedo = rgbaToDataURL(new Uint8ClampedArray(d.albedo), d.width, d.height);
      setPillDone(PILL_MAP['albedo']);
      if (d.normal && eyeOn('normal')) {
        maps.normal = rgbaToDataURL(new Uint8ClampedArray(d.normal), d.width, d.height);
        setPillDone(PILL_MAP['normal']);
      }
      if (d.roughness && eyeOn('roughness')) {
        maps.roughness = rgbaToDataURL(new Uint8ClampedArray(d.roughness), d.width, d.height);
        setPillDone(PILL_MAP['roughness']);
      }
      if (d.ao && eyeOn('ao')) {
        maps.ao = rgbaToDataURL(new Uint8ClampedArray(d.ao), d.width, d.height);
        setPillDone(PILL_MAP['ao']);
      }
      if (d.heightMap && eyeOn('height')) {
        maps.height = rgbaToDataURL(new Uint8ClampedArray(d.heightMap), d.width, d.height);
        setPillDone(PILL_MAP['height']);
      }
      if (d.metalness && eyeOn('metalness')) {
        maps.metalness = rgbaToDataURL(new Uint8ClampedArray(d.metalness), d.width, d.height);
        setPillDone(PILL_MAP['metalness']);
      }
      if (d.emissive && eyeOn('emissive')) {
        maps.emissive = rgbaToDataURL(new Uint8ClampedArray(d.emissive), d.width, d.height);
        setPillDone(PILL_MAP['emissive']);
      }
      if (d.opacity && eyeOn('opacity')) {
        maps.opacity = rgbaToDataURL(new Uint8ClampedArray(d.opacity), d.width, d.height);
        setPillDone(PILL_MAP['opacity']);
      }
      // For channels with uploaded overrides, use them directly in maps — no re-processing.
      // The slider adjustments for those channels only affect material properties, not the texture data.
      const overrideKeys = Object.keys(mapOverrides);
      overrideKeys.forEach(key => {
        if (eyeOn(key)) {
          maps[key] = mapOverrides[key];
          if (!lastMaps) lastMaps = {};
          lastMaps[key] = mapOverrides[key];
          const el = document.getElementById(PILL_MAP[key]);
          if (el) { el.classList.remove('working'); el.classList.add('done'); el.querySelector('.map-row-icon').textContent = '↑'; el.style.borderColor = '#92400e'; }
          const s = PILL_SUFFIX[key];
          ['btn-eye-','btn-regen-','btn-dl-'].forEach(p => { const b=document.getElementById(p+s); if(b) b.disabled=false; });
        }
      });
      _finishGenerate(maps);

      function _finishGenerate(maps) {
        const p = _currentParams();
        Object.keys(mapParams).forEach(k => { mapParams[k] = p; });
        applyMaps(maps);
        populate2D(maps);
        setStatus('Done — ' + currentFileName, 'ok');
        document.getElementById('canvas-hint').style.display = 'none';
        const dlBtn = document.getElementById('btn-dl-all');
        dlBtn.disabled = false;
        dlBtn.style.borderColor = '#702af8'; dlBtn.style.color = '#a78bfa';
        dlBtn.onclick = () => downloadZip(maps, currentFileName);
        setTimeout(() => { pWrap.style.display = 'none'; }, 2000);
        genBtn.disabled = false;
      }
    } // end d.type === 'done'
  };
});

// generation slider labels + live preview
const _previewWorkerURL = 'workers/pbr.js';

function rgbaToObjectURL(rgba, w, h) {
  // Returns a blob: URL instead of a data: URL — much smaller string, revokable
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  // Synchronously convert to blob URL via toDataURL then immediately hand off
  return c.toDataURL('image/png'); // still data URL but canvas is GC'd immediately
}

// Map which slider groups produce which worker output keys
const _groupKeys = {
  normal:    ['normal', 'roughness', 'ao'],
  metalness: ['metalness'],
  emissive:  ['emissive'],
  height:    ['height'],
  all:       ['albedo', 'normal', 'roughness', 'ao', 'height', 'metalness', 'emissive'],
};
const _groupDebounce = {};
const _groupWorker   = {};

function runLivePreview(group = 'all', sliderId = null) {
  if (!loadedImageData) return;
  clearTimeout(_groupDebounce[group]);
  _groupDebounce[group] = setTimeout(() => {
    if (_groupWorker[group]) { _groupWorker[group].terminate(); _groupWorker[group] = null; }

    // Use override pixels for this group's channel if available, else albedo
    const overrideKey = group === 'all' ? null : group; // group name matches channel key
    const overrideSrc = overrideKey && window._overridePixels?.[overrideKey];
    const srcData = overrideSrc || stackImageData || loadedImageData;
    const rgba = new Uint8ClampedArray(srcData.data.buffer.slice(0));
    const w = new Worker(_previewWorkerURL);
    _groupWorker[group] = w;

    w.postMessage({
      rgba,
      width:               srcData.width,
      height:              srcData.height,
      normalStrength:      +document.getElementById('ns').value,
      roughAlpha:          +document.getElementById('ra').value,
      roughBeta:           +document.getElementById('rb').value,
      aoAlpha:             +document.getElementById('aogen').value,
      heightScale:        +document.getElementById('hgt-scale').value,
    heightContrast:      +document.getElementById('hgt-contrast').value,
    heightInvert:        document.getElementById('hgt-invert').checked,
      metalnessThreshold:  +document.getElementById('met-threshold').value,
      metalnessContrast:   +document.getElementById('met-contrast').value,
      emissiveThreshold:   +document.getElementById('emi-threshold').value,
      emissiveIntensity:   +document.getElementById('emi-intensity').value,
      opacityThreshold:    +document.getElementById('opa-threshold').value,
      enableNormal:    group === 'normal'    || group === 'all',
      enableRoughness: group === 'roughness' || group === 'all',
      enableAO:        group === 'ao'        || group === 'all',
      enableHeight:    group === 'height'    || (group === 'all' && +document.getElementById('hgt-scale').value > 0),
      enableMetalness: group === 'metalness' || (group === 'all' && +document.getElementById('met-contrast').value > 1),
      enableEmissive:  group === 'emissive'  || (group === 'all' && +document.getElementById('emi-intensity').value > 0),
      enableOpacity:   group === 'opacity'   || (group === 'all' && +document.getElementById('opa-threshold').value < 1),
      makeSeamlessFlag: false, blendRatio: 0.25, workSize: 512,
    }, [rgba.buffer]);

    w.onerror = () => {
      if (sliderId) setSpinner(sliderId, false);
      _groupWorker[group] = null;
    };
    w.onmessage = e => {
      if (e.data.type === 'progress') return; // ignore progress events
      if (e.data.type !== 'done') { if (sliderId) setSpinner(sliderId, false); return; }
      const d = e.data;
      const dw = d.width, dh = d.height;

      // Fast path: createImageBitmap from raw RGBA — no PNG encode/decode round-trip
      const makeTex = (rgba, colorSpace) => {
        const imgData = new ImageData(new Uint8ClampedArray(rgba), dw, dh);
        return createImageBitmap(imgData).then(bmp => {
          const tex = new THREE.CanvasTexture(bmp);
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(parseFloat(document.getElementById('tile').value) || 1,
                         parseFloat(document.getElementById('tile').value) || 1);
          if (colorSpace) tex.colorSpace = colorSpace;
          return tex;
        });
      };

      // Build only the entries for the maps this group produces
      const texEntries = [];
      if (group === 'all' || group === 'normal') {
        // Only update albedo if we used the actual albedo as source (not an override's pixels)
        const overrideSrcUsed = group !== 'all' && window._overridePixels?.[group];
        if (d.albedo && !overrideSrcUsed) texEntries.push(['albedo', d.albedo, THREE.SRGBColorSpace]);
        if (d.normal) texEntries.push(['normal', d.normal, null]);
      }
      if (group === 'all' || group === 'roughness') {
        if (d.roughness) texEntries.push(['roughness', d.roughness, null]);
      }
      if (group === 'all' || group === 'ao') {
        if (d.ao) texEntries.push(['ao', d.ao, null]);
      }
      if ((group === 'all' || group === 'height')    && d.heightMap) texEntries.push(['height',    d.heightMap, null]);
      if ((group === 'all' || group === 'metalness') && d.metalness) texEntries.push(['metalness', d.metalness, null]);
      if ((group === 'all' || group === 'emissive')  && d.emissive)  texEntries.push(['emissive',  d.emissive,  null]);
      if ((group === 'all' || group === 'opacity')   && d.opacity)   texEntries.push(['opacity',   d.opacity,   null]);

      // Always hide spinner immediately on done, before async texture upload
      if (sliderId) setSpinner(sliderId, false);

      if (texEntries.length === 0) {
        w.terminate(); _groupWorker[group] = null; return;
      }

      Promise.all(texEntries.map(([, data, cs]) => makeTex(data, cs))).then(textures => {
        texEntries.forEach(([key], i) => {
          const tex = textures[i];
          if (loadedMaps[key]?.isTexture) loadedMaps[key].dispose();
          loadedMaps[key] = tex;
          // Only bind to material if eye is explicitly active
          const eyeBtn = document.getElementById('eye-' + key);
          const eyeActive = !eyeBtn || eyeBtn.classList.contains('active');
          if (eyeActive && propMap[key]) {
            mat[propMap[key]] = tex;
          }
        });

        if (group === 'all' || group === 'normal') {
          mat.roughness = 1.0;
          mat.color.set(0xffffff);
          const nsc = parseFloat(document.getElementById('nsc').value) || 1;
          mat.normalScale?.set(nsc, nsc);
        }
        if (group === 'all' || group === 'ao') {
          mat.aoMapIntensity = parseFloat(document.getElementById('aoi').value) || 0.6;
        }
        // Only set emissive scalars if eye-emissive is explicitly on
        if ((group === 'all' || group === 'emissive') && d.emissive) {
          const eyeEmi = document.getElementById('eye-emissive');
          if (eyeEmi?.classList.contains('active')) {
            mat.emissive = new THREE.Color(0xffffff);
            mat.emissiveIntensity = parseFloat(document.getElementById('emi-intensity').value) || 1.0;
          }
        }
        // Only set displacement if eye-height is explicitly on
        if ((group === 'all' || group === 'height') && d.heightMap) {
          const eyeHgt = document.getElementById('eye-height');
          if (eyeHgt?.classList.contains('active')) {
            const sv = parseFloat(document.getElementById('hgt-scale').value) || 0;
            mat.displacementScale = sv; mat.displacementBias = -sv / 2;
          }
        }
        // Only set metalness scalar if eye-metalness is explicitly on
        if ((group === 'all' || group === 'metalness') && d.metalness) {
          const eyeMet = document.getElementById('eye-metalness');
          if (eyeMet?.classList.contains('active')) mat.metalness = 1.0;
        }
        // Only enable transparency if eye-opacity is explicitly on
        if ((group === 'all' || group === 'opacity') && d.opacity) {
          const eyeOpa = document.getElementById('eye-opacity');
          if (eyeOpa?.classList.contains('active')) {
            mat.transparent = true; mat.alphaTest = 0.01;
          }
        }

        mat.needsUpdate = true;
        requestRender();
        setStatus('✓', 'ok');
        w.terminate();
        _groupWorker[group] = null;
      });
    };
  }, 300);
}

// ── Map upload overrides ──────────────────────────────────────────────
// Tracks which channels have user-uploaded maps (bypasses generation)
const mapOverrides = {}; // key → dataUrl

function loadMapOverride(key, input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const dataUrl = ev.target.result;
    mapOverrides[key] = dataUrl;

    // Decode to ImageData for worker-based slider processing
    if (!window._overridePixels) window._overridePixels = {};
    const _img = new Image();
    _img.onload = () => {
      const _c = document.createElement('canvas');
      _c.width = _img.width; _c.height = _img.height;
      _c.getContext('2d').drawImage(_img, 0, 0);
      window._overridePixels[key] = _c.getContext('2d').getImageData(0, 0, _c.width, _c.height);
    };
    _img.src = dataUrl;

    // Store in lastMaps so preview/download work
    if (!lastMaps) lastMaps = {};
    lastMaps[key] = dataUrl;

    // Apply to shader immediately
    const texLoader = new THREE.TextureLoader();
    texLoader.load(dataUrl, tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(parseFloat(document.getElementById('tile').value) || 1,
                     parseFloat(document.getElementById('tile').value) || 1);
      if (key === 'albedo') tex.colorSpace = THREE.SRGBColorSpace;
      if (loadedMaps[key]?.isTexture) loadedMaps[key].dispose();
      loadedMaps[key] = tex;
      const eyeBtn = document.getElementById('eye-' + key);
      if (!eyeBtn || eyeBtn.classList.contains('active')) {
        if (propMap[key]) mat[propMap[key]] = tex;
        if (key === 'emissive') { mat.emissive = new THREE.Color(0xffffff); mat.emissiveIntensity = 1.0; }
        if (key === 'metalness') mat.metalness = 1.0;
        if (key === 'opacity') { mat.transparent = true; mat.alphaTest = 0.01; }
        if (key === 'height') {
          const sv = parseFloat(document.getElementById('hgt-scale').value) || 0;
          mat.displacementScale = sv; mat.displacementBias = -sv / 2;
        }
        mat.needsUpdate = true; requestRender();
      }
    });

    // Mark pill as uploaded (↑) — amber border
    const pillId = PILL_MAP[key];
    if (pillId) {
      const el = document.getElementById(pillId);
      el.classList.remove('working'); el.classList.add('done');
      el.querySelector('.map-row-icon').textContent = '↑';
      el.style.borderColor = '#92400e';
      const s = PILL_SUFFIX[key];
      ['btn-eye-','btn-regen-','btn-dl-'].forEach(p => {
        const b = document.getElementById(p + s);
        if (b) b.disabled = false;
      });
    }

    // Show clear button on card
    const clearBtn = document.getElementById('clear-' + key);
    if (clearBtn) clearBtn.classList.add('visible');

    // Update slider labels to reflect intensity-mode when override is active
    const labelMap = {
      normal:    ['vns',    'Bump Intensity'],
      roughness: ['vra',    'Roughness Amount'],
      ao:        ['vaogen', 'AO Strength'],
      height:    ['vhgtscale', 'Displacement'],
      metalness: ['vmetth', 'Metalness Amount'],
      emissive:  ['vemiint','Glow Intensity'],
      opacity:   ['vopath', 'Opacity Cutoff'],
    };
    if (labelMap[key]) {
      const card = document.getElementById('card-gen-' + key);
      if (card) {
        const rows = card.querySelectorAll('.ctrl-row span:first-child');
        if (rows[0]) rows[0].dataset.origLabel = rows[0].dataset.origLabel || rows[0].textContent;
        // Only relabel the primary slider row
        const primaryRow = labelMap[key];
        const lbl = card.querySelector('.ctrl-row span:first-child');
        if (lbl) { lbl.dataset.origLabel = lbl.dataset.origLabel || lbl.textContent; lbl.textContent = primaryRow[1]; }
      }
    }

    // Reset file input so same file can be re-selected
    input.value = '';
  };
  reader.readAsDataURL(file);
}

function clearMapOverride(key) {
  delete mapOverrides[key];
  if (window._overridePixels) delete window._overridePixels[key];

  // Remove from lastMaps so it won't go in ZIP
  if (lastMaps) delete lastMaps[key];

  // Remove from shader
  const prop = propMap[key];
  if (prop && mat[prop]?.isTexture) { mat[prop].dispose(); mat[prop] = null; }
  if (loadedMaps[key]?.isTexture) { loadedMaps[key].dispose(); delete loadedMaps[key]; }
  if (key === 'emissive') { mat.emissive = new THREE.Color(0x000000); mat.emissiveIntensity = 0; }
  if (key === 'metalness') mat.metalness = 0;
  if (key === 'opacity') { mat.alphaMap = null; mat.transparent = false; mat.alphaTest = 0; }
  if (key === 'height') { mat.displacementScale = 0; mat.displacementBias = 0; }
  mat.needsUpdate = true; requestRender();

  // Reset pill
  const pillId = PILL_MAP[key];
  if (pillId) {
    const el = document.getElementById(pillId);
    el.className = 'map-row';
    el.querySelector('.map-row-icon').textContent = '—';
    el.style.borderColor = '';
    const s = PILL_SUFFIX[key];
    ['btn-eye-','btn-regen-','btn-dl-'].forEach(p => {
      const b = document.getElementById(p+s);
      if (b) b.disabled = true;
    });
  }

  // Remove clear button from card
  const clearBtn = document.getElementById('clear-' + key);
  if (clearBtn) clearBtn.classList.remove('visible');

  // Restore original slider labels
  const card = document.getElementById('card-gen-' + key);
  if (card) {
    const lbl = card.querySelector('.ctrl-row span:first-child');
    if (lbl?.dataset.origLabel) lbl.textContent = lbl.dataset.origLabel;
  }
}

window.loadMapOverride  = loadMapOverride;
window.clearMapOverride = clearMapOverride;

// ── Per-map eye toggles ───────────────────────────────────────────────
function toggleMapEye(key, btn) {
  const isActive = btn.classList.toggle('active');
  const prop = propMap[key];
  // Grey out the card when eye is off
  const card = btn.closest('.card');
  if (card) card.style.opacity = isActive ? '' : '0.38';
  if (!prop) return;
  if (isActive) {
    if (loadedMaps[key]) {
      mat[prop] = loadedMaps[key];
      if (key === 'emissive') { mat.emissive = new THREE.Color(0xffffff); mat.emissiveIntensity = 1.0; }
      if (key === 'metalness') mat.metalness = 1.0;
      if (key === 'opacity') { mat.transparent = true; mat.alphaTest = 0.01; }
      if (key === 'height') {
        const sv = parseFloat(document.getElementById('hgt-scale').value) || 0;
        mat.displacementScale = sv; mat.displacementBias = -sv / 2;
      }
      mat.needsUpdate = true; requestRender();
    }
  } else {
    mat[prop] = null;
    if (key === 'emissive') { mat.emissive = new THREE.Color(0x000000); mat.emissiveIntensity = 0; }
    if (key === 'metalness') mat.metalness = 0;
    if (key === 'opacity') { mat.transparent = false; mat.alphaTest = 0; }
    if (key === 'height') { mat.displacementScale = 0; mat.displacementBias = 0; }
    mat.needsUpdate = true; requestRender();
  }
}
window.toggleMapEye = toggleMapEye;

// Auto-enable eye when user moves a slider — call this from every slider handler
function autoEnableEye(eyeId) {
  const btn = document.getElementById(eyeId);
  if (btn && !btn.classList.contains('active')) {
    btn.classList.add('active');
    const card = btn.closest('.card');
    if (card) card.style.opacity = '';
  }
}

// ── Per-slider spinners ───────────────────────────────────────────────
// Each slider has its own spin-{id} element
function setSpinner(sliderId, on) {
  const el = document.getElementById('spin-' + sliderId);
  if (el) el.style.display = on ? 'inline-block' : 'none';
}

// Groups map slider IDs to their worker group
const _sliderGroup = {
  'ns': 'normal', 'ra': 'normal', 'rb': 'normal', 'aogen': 'normal',
  'hgt-scale': 'height',
  'met-threshold': 'metalness', 'met-contrast': 'metalness',
  'emi-threshold': 'emissive',  'emi-intensity': 'emissive',
  'opa-threshold': 'opacity',
};

// Maps each slider group to its eye button ID
const _groupEye = {
  'normal':    'eye-normal',
  'roughness': 'eye-roughness',
  'ao':        'eye-ao',
  'height':    'eye-height',
  'metalness': 'eye-metalness',
  'emissive':  'eye-emissive',
  'opacity':   'eye-opacity',
};

// Maps each group to the material property its slider directly controls (for override mode)
const _groupDirectProp = {
  normal:    (v) => { mat.normalScale?.set(parseFloat(document.getElementById('nsc').value)||1, parseFloat(document.getElementById('nsc').value)||1); mat.needsUpdate=true; requestRender(); },
  roughness: ()  => { mat.needsUpdate=true; requestRender(); }, // roughness map texture stays, no scalar to update
  ao:        ()  => { mat.aoMapIntensity = parseFloat(document.getElementById('aoi').value)||0.6; mat.needsUpdate=true; requestRender(); },
  height:    (v) => { mat.displacementScale=v; mat.displacementBias=-v/2; mat.needsUpdate=true; requestRender(); },
  metalness: ()  => { mat.needsUpdate=true; requestRender(); },
  emissive:  (v) => { mat.emissiveIntensity = parseFloat(document.getElementById('emi-intensity').value)||1; mat.needsUpdate=true; requestRender(); },
  opacity:   ()  => { mat.needsUpdate=true; requestRender(); },
};

// Maps each group to its direct Three.js material update when an override is loaded
const _groupDirectUpdate = {
  normal:    () => {
    const v = parseFloat(document.getElementById('ns').value) / 10; // 0-30 → 0-3
    mat.normalScale?.set(v, v); mat.needsUpdate = true; requestRender();
  },
  roughness: () => {
    const v = parseFloat(document.getElementById('ra').value); // 0-2 direct
    mat.roughness = v; mat.needsUpdate = true; requestRender();
  },
  ao:        () => {
    const v = parseFloat(document.getElementById('aogen').value);
    mat.aoMapIntensity = v; mat.needsUpdate = true; requestRender();
  },
  height:    () => {
    const v = parseFloat(document.getElementById('hgt-scale').value);
    mat.displacementScale = v; mat.displacementBias = -v / 2; mat.needsUpdate = true; requestRender();
  },
  metalness: () => {
    const v = parseFloat(document.getElementById('met-threshold').value); // repurpose as intensity 0-1
    mat.metalness = 1.0 - v; // threshold=0 → full metallic, threshold=1 → no metallic
    mat.needsUpdate = true; requestRender();
  },
  emissive:  () => {
    const v = parseFloat(document.getElementById('emi-intensity').value);
    mat.emissiveIntensity = v; mat.needsUpdate = true; requestRender();
  },
  opacity:   () => {
    const v = parseFloat(document.getElementById('opa-threshold').value);
    mat.alphaTest = v; mat.needsUpdate = true; requestRender();
  },
};

// ── Slider wiring — per slider spinner, per group worker ──────────────
function sliderGroup(entries, group) {
  entries.forEach(([id, vid, dec]) => {
    const el = document.getElementById(id), vl = document.getElementById(vid);
    if (!el || !vl) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      vl.textContent = v.toFixed(dec);
      if (_groupEye[group]) autoEnableEye(_groupEye[group]);
      // If this channel has an uploaded map, update material property directly — no re-processing
      if (mapOverrides[group] && _groupDirectUpdate[group]) {
        _groupDirectUpdate[group]();
        return;
      }
      setSpinner(id, true);
      runLivePreview(group, id);
    });
  });
}

sliderGroup([['ns','vns',0]], 'normal');
sliderGroup([['ra','vra',2], ['rb','vrb',0]], 'roughness');
sliderGroup([['aogen','vaogen',1]], 'ao');
sliderGroup([['met-threshold','vmetth',2], ['met-contrast','vmetcon',1]], 'metalness');
sliderGroup([['emi-threshold','vemith',2], ['emi-intensity','vemiint',1]], 'emissive');
sliderGroup([['hgt-contrast','vhgtcontrast',1]], 'height');
sliderGroup([['opa-threshold','vopath',2]], 'opacity');

// Invert toggle — re-runs height worker
document.getElementById('hgt-invert')?.addEventListener('change', () => {
  autoEnableEye('eye-height');
  setSpinner('hgt-scale', true);
  runLivePreview('height', 'hgt-scale');
});

// Seamless toggle
const chkSeamless  = document.getElementById('chk-seamless');
const seamlessOpts = document.getElementById('seamless-opts');
chkSeamless.addEventListener('change', () => {
  const on = chkSeamless.checked;
  seamlessOpts.style.display = on ? '' : 'none';
  const btn = document.getElementById('btn-seamless-only');
  btn.style.display = on ? '' : 'none';
  btn.disabled = !loadedImageData;
});

// ── Make Seamless Only ────────────────────────────────────────────────
const btnSeamlessOnly = document.getElementById('btn-seamless-only');
btnSeamlessOnly.addEventListener('click', () => {
  if (!loadedImageData) return;
  btnSeamlessOnly.disabled = true;
  btnSeamlessOnly.textContent = '💫 Processing…';
  setStatus('Making seamless…', '');

  const srcData = stackImageData || loadedImageData;
  const rgba = new Uint8ClampedArray(srcData.data);
  const _seamlessWorkerURL = 'workers/pbr.js';
  const w2 = new Worker(_seamlessWorkerURL);
  w2.postMessage({
    rgba,
    width:            srcData.width,
    height:           srcData.height,
    normalStrength:   1, roughAlpha: 1, roughBeta: 0, aoAlpha: 1,
    makeSeamlessFlag: true,
    blendRatio:       +document.getElementById('blend-ratio').value,
    workSize:         +(document.getElementById('work-size')?.value || 512),
    seamlessOnlyMode: true,
  }, [rgba.buffer]);

  w2.onmessage = e => {
    if (e.data.type === 'done') {
      const seamlessRgba = new Uint8ClampedArray(e.data.albedo);
      const dataUrl = rgbaToDataURL(seamlessRgba, e.data.width, e.data.height);

      // Update stack so maps generation uses the seamless result
      stackImageData = new ImageData(seamlessRgba, e.data.width, e.data.height);
      addLayer('Seamless', 'seamless', {}, new ImageData(seamlessRgba, e.data.width, e.data.height));

      // Update the shader albedo with the seamless result
      applyMaps({ albedo: dataUrl });
      document.getElementById('canvas-hint').style.display = 'none';

      // Store as current seamless result for download
      lastSeamlessUrl = dataUrl;

      // Show status with inline download button
      statusEl.innerHTML = `Seamless ready &nbsp;<a id="btn-dl-seamless" href="#"
        style="padding:2px 10px;font-size:10px;font-weight:600;background:transparent;border:1px solid #702af8;
        color:#a78bfa;border-radius:5px;cursor:pointer;text-decoration:none">↓ Save</a>`;
      statusEl.className = 'ok';
      document.getElementById('btn-dl-seamless').addEventListener('click', ev => {
        ev.preventDefault();
        if (!lastSeamlessUrl) return;
        const a = document.createElement('a');
        a.href = lastSeamlessUrl;
        a.download = currentFileName + '_seamless.png';
        a.click();
      });

      btnSeamlessOnly.disabled = false;
      btnSeamlessOnly.textContent = '⬡ Make Seamless Only';
      w2.terminate();

      // If maps were already generated, re-generate them from the new seamless base
      if (lastMaps) {
        setStatus('Re-generating maps from seamless texture…', '');
        genBtn.click();
      }
    }
  };
});
let lastSeamlessUrl = null;

// ── Per-map params store (updated on each full generate or regen) ─────
const mapParams = {
  albedo:    {},
  normal:    { normalStrength: 10 },
  roughness: { roughAlpha: 0.8, roughBeta: 50 },
  ao:        { aoAlpha: 1.5 },
};

function _currentParams() {
  return {
    normalStrength:     +document.getElementById('ns').value,
    roughAlpha:         +document.getElementById('ra').value,
    roughBeta:          +document.getElementById('rb').value,
    aoAlpha:            +document.getElementById('aogen').value,
    heightScale:        +document.getElementById('hgt-scale').value,
    heightContrast:     +document.getElementById('hgt-contrast').value,
    heightInvert:       document.getElementById('hgt-invert').checked,
    metalnessThreshold: +document.getElementById('met-threshold').value,
    metalnessContrast:  +document.getElementById('met-contrast').value,
    emissiveThreshold:  +document.getElementById('emi-threshold').value,
    emissiveIntensity:  +document.getElementById('emi-intensity').value,
    opacityThreshold:   +document.getElementById('opa-threshold').value,
  };
}

// ── Per-map regeneration ──────────────────────────────────────────────
function regenMap(key) {
  if (!loadedImageData) return;
  const pillId = PILL_MAP[key];
  setPillWorking(pillId);
  const p = _currentParams();
  mapParams[key] = p;
  const srcData = stackImageData || loadedImageData;
  const rgba = new Uint8ClampedArray(srcData.data.buffer.slice(0));
  const url = 'workers/pbr.js';
  const w = new Worker(url);
  w.postMessage({
    rgba, width: srcData.width, height: srcData.height,
    normalStrength: p.normalStrength, roughAlpha: p.roughAlpha,
    roughBeta: p.roughBeta, aoAlpha: p.aoAlpha,
    heightScale:        +document.getElementById('hgt-scale').value,
    heightContrast:      +document.getElementById('hgt-contrast').value,
    heightInvert:        document.getElementById('hgt-invert').checked,
    metalnessThreshold: +document.getElementById('met-threshold').value,
    metalnessContrast:  +document.getElementById('met-contrast').value,
    emissiveThreshold:  +document.getElementById('emi-threshold').value,
    emissiveIntensity:  +document.getElementById('emi-intensity').value,
    opacityThreshold:   +document.getElementById('opa-threshold').value,
    enableNormal: true, enableRoughness: true, enableAO: true,
    enableHeight: true, enableMetalness: true, enableEmissive: true, enableOpacity: true,
    makeSeamlessFlag: false, blendRatio: 0.25, workSize: 512,
  }, [rgba.buffer]);
  w.onmessage = e => {
    if (e.data.type !== 'done') return;
    const d = e.data;
    const keyField = key === 'height' ? 'heightMap' : key;
    const dataUrl = rgbaToDataURL(new Uint8ClampedArray(d[keyField] || d.albedo), d.width, d.height);
    if (!lastMaps) lastMaps = {};
    lastMaps[key] = dataUrl;
    applyMaps({ [key]: dataUrl });
    setPillDone(pillId);
    w.terminate();
  };
  w.onerror = () => { w.terminate(); };
}

// ── Per-map download ──────────────────────────────────────────────────
function downloadMap(key) {
  if (!lastMaps?.[key]) return;
  const a = document.createElement('a');
  a.href = lastMaps[key];
  a.download = `${currentFileName}_${key}.png`;
  a.click();
}
window.regenMap    = regenMap;
window.downloadMap = downloadMap;

// ── Map preview modal ─────────────────────────────────────────────────
const _mpModal   = document.getElementById('map-preview-modal');
const _mpImg     = document.getElementById('map-preview-img');
const _mpTitle   = document.getElementById('map-preview-title');
const _mpInfo    = document.getElementById('map-preview-info');
const _mpDl      = document.getElementById('map-preview-dl');
const _mpVp      = document.getElementById('map-preview-viewport');

let _mpKey = null, _mpScale = 1, _mpPanX = 0, _mpPanY = 0;

const MAP_META = {
  albedo:    { label: 'Albedo (Base Color)',    desc: 'Raw diffuse color of the surface',              color: '#f59e0b' },
  normal:    { label: 'Normal Map',             desc: 'Surface bump directions (tangent space)',        color: '#6366f1' },
  roughness: { label: 'Roughness Map',          desc: 'Micro-surface roughness (0=mirror, 1=matte)',   color: '#64748b' },
  ao:        { label: 'Ambient Occlusion',      desc: 'Shadowed crevices and contact shadows',         color: '#34d399' },
  height:    { label: 'Height Map',             desc: 'Luminance-based surface displacement',          color: '#a78bfa' },
  metalness: { label: 'Metalness Map',          desc: 'Metallic vs. dielectric (0=non-metal, 1=metal)',color: '#94a3b8' },
  emissive:  { label: 'Emissive Map',           desc: 'Self-illuminated bright regions (glow)',        color: '#f87171' },
  opacity:   { label: 'Opacity Map',            desc: 'Transparency mask (0=invisible, 1=solid)',      color: '#cbd5e1' },
};

function _mpApplyTransform() {
  const vw = _mpVp.clientWidth, vh = _mpVp.clientHeight;
  const iw = _mpImg.naturalWidth * _mpScale, ih = _mpImg.naturalHeight * _mpScale;
  _mpImg.style.width  = iw + 'px';
  _mpImg.style.height = ih + 'px';
  _mpImg.style.left   = (_mpPanX + (vw - iw) / 2) + 'px';
  _mpImg.style.top    = (_mpPanY + (vh - ih) / 2) + 'px';
}

function _mpReset() {
  _mpScale = 1; _mpPanX = 0; _mpPanY = 0;
  _mpApplyTransform();
}

function openMapPreview(key) {
  if (!lastMaps?.[key]) return;
  _mpKey = key;
  const meta = MAP_META[key];
  _mpTitle.textContent = meta.label;
  _mpTitle.style.color = meta.color;
  _mpImg.src = lastMaps[key];
  _mpImg.onload = () => { _mpReset(); };
  // Build info panel
  const p = mapParams[key] || _currentParams();
  const src = stackImageData || loadedImageData;
  const chips = [
    `<span class="mp-info-chip">Size <b>${src?.width || '?'} × ${src?.height || '?'} px</b></span>`,
  ];
  if (key === 'normal')    chips.push(`<span class="mp-info-chip">Intensity <b>${p.normalStrength ?? '?'}</b></span>`);
  if (key === 'roughness') chips.push(`<span class="mp-info-chip">Scale <b>${p.roughAlpha ?? '?'}</b></span>`, `<span class="mp-info-chip">Bias <b>${p.roughBeta ?? '?'}</b></span>`);
  if (key === 'ao')        chips.push(`<span class="mp-info-chip">Strength <b>${p.aoAlpha ?? '?'}</b></span>`);
  if (key === 'height')    chips.push(`<span class="mp-info-chip">Scale <b>${p.heightScale ?? '?'}</b></span>`, `<span class="mp-info-chip">Contrast <b>${p.heightContrast ?? '?'}</b></span>`);
  if (key === 'metalness') chips.push(`<span class="mp-info-chip">Threshold <b>${p.metalnessThreshold ?? '?'}</b></span>`, `<span class="mp-info-chip">Contrast <b>${p.metalnessContrast ?? '?'}</b></span>`);
  if (key === 'emissive')  chips.push(`<span class="mp-info-chip">Threshold <b>${p.emissiveThreshold ?? '?'}</b></span>`, `<span class="mp-info-chip">Intensity <b>${p.emissiveIntensity ?? '?'}</b></span>`);
  if (key === 'opacity')   chips.push(`<span class="mp-info-chip">Threshold <b>${p.opacityThreshold ?? '?'}</b></span>`);
  _mpInfo.innerHTML = `
    <div class="mp-info-label" style="color:${meta.color}">${meta.label}</div>
    <div class="mp-info-desc">${meta.desc}</div>
    <div class="mp-info-chips">${chips.join('')}</div>`;
  _mpDl.onclick = () => downloadMap(key);
  _mpModal.classList.add('open');
}
window.openMapPreview = openMapPreview;

document.getElementById('map-preview-close').onclick = () => _mpModal.classList.remove('open');
_mpModal.addEventListener('click', e => { if (e.target === _mpModal) _mpModal.classList.remove('open'); });

// Zoom buttons
document.getElementById('mp-btn-zoomin').onclick  = () => { _mpScale = Math.min(_mpScale * 1.4, 8); _mpApplyTransform(); };
document.getElementById('mp-btn-zoomout').onclick = () => { _mpScale = Math.max(_mpScale / 1.4, 0.2); _mpApplyTransform(); };
document.getElementById('mp-btn-reset').onclick   = _mpReset;

// Scroll to zoom
_mpVp.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 0.87;
  _mpScale = Math.min(Math.max(_mpScale * factor, 0.2), 8);
  _mpApplyTransform();
}, { passive: false });

// Drag to pan
let _mpDragging = false, _mpDragX = 0, _mpDragY = 0;
_mpVp.addEventListener('mousedown', e => {
  _mpDragging = true; _mpDragX = e.clientX - _mpPanX; _mpDragY = e.clientY - _mpPanY;
  _mpVp.classList.add('grabbing');
});
window.addEventListener('mousemove', e => {
  if (!_mpDragging) return;
  _mpPanX = e.clientX - _mpDragX; _mpPanY = e.clientY - _mpDragY;
  _mpApplyTransform();
});
window.addEventListener('mouseup', () => { _mpDragging = false; _mpVp.classList.remove('grabbing'); });
// Touch pan
_mpVp.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    _mpDragging = true;
    _mpDragX = e.touches[0].clientX - _mpPanX;
    _mpDragY = e.touches[0].clientY - _mpPanY;
  }
}, { passive: true });
_mpVp.addEventListener('touchmove', e => {
  if (!_mpDragging || e.touches.length !== 1) return;
  _mpPanX = e.touches[0].clientX - _mpDragX;
  _mpPanY = e.touches[0].clientY - _mpDragY;
  _mpApplyTransform();
}, { passive: true });
_mpVp.addEventListener('touchend', () => { _mpDragging = false; });

// ── Layer engine (Photoshop model) ───────────────────────────────────
// layers[0] = {label:'Original', imageData, op:null, params:null, enabled:true}
// layers[n] = {label, imageData (cumulative result), op, params, enabled}

let layers = [];
let activeToolOp = null;
let originalImageData = null;
let stackImageData    = null;

// Enhance worker URL — external file
const _enhanceWorkerURL = 'workers/enhance.js';

function imgDataToDataURL(imgData) {
  const c = document.createElement('canvas');
  c.width = imgData.width; c.height = imgData.height;
  c.getContext('2d').putImageData(imgData, 0, 0);
  return c.toDataURL('image/png');
}

// Compute composite: replay all enabled layers through the enhance worker
// Returns the ImageData of the topmost enabled layer (or original if all disabled)
function getComposite() {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (layers[i].enabled) return layers[i].imageData;
  }
  return layers[0].imageData;
}

function updateLayerListUI() {
  const list = document.getElementById('layer-list');
  list.innerHTML = '';
  // Show layers bottom-to-top (original at bottom, latest at top) like Photoshop
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const isBase = i === 0;
    const paramsStr = layer.params
      ? Object.entries(layer.params).map(([k,v]) => `${k}: ${v}`).join(', ')
      : '';
    const row = document.createElement('div');
    row.className = 'layer-row' + (layer.enabled ? '' : ' disabled');
    row.dataset.index = i;
    row.innerHTML = `
      <svg class="layer-eye ${layer.enabled ? 'on' : ''}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" data-action="eye">
        <circle cx="8" cy="8" r="3"/><path d="M1 8 Q4 3 8 3 Q12 3 15 8 Q12 13 8 13 Q4 13 1 8"/>
      </svg>
      <span class="layer-name">${layer.label}</span>
      <span class="layer-params">${paramsStr}</span>
      ${!isBase ? `
        <button class="layer-btn" data-action="compare" title="Compare before/after">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="1" x2="6" y2="11"/><polyline points="3,4 1,6 3,8"/><polyline points="9,4 11,6 9,8"/></svg>
        </button>
        <button class="layer-btn" data-action="download" title="Download this layer">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="1" x2="6" y2="8"/><polyline points="3,5 6,8 9,5"/><line x1="1" y1="11" x2="11" y2="11"/></svg>
        </button>
        <button class="layer-btn" data-action="edit" title="Edit params">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2l2 2-6 6H2V8z"/></svg>
        </button>
        <button class="layer-btn" data-action="delete" title="Delete layer" style="color:#f87171">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
        </button>
      ` : `
        <button class="layer-btn" data-action="download" title="Download original">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="1" x2="6" y2="8"/><polyline points="3,5 6,8 9,5"/><line x1="1" y1="11" x2="11" y2="11"/></svg>
        </button>
      `}
    `;
    list.appendChild(row);
  }
  document.getElementById('btn-reset-pipeline').style.display = layers.length > 1 ? '' : 'none';
  document.getElementById('btn-dl-flattened').style.display = layers.length > 1 ? '' : 'none';

  // Wire row actions
  list.querySelectorAll('.layer-row').forEach(row => {
    const idx = parseInt(row.dataset.index);
    row.querySelector('[data-action="eye"]')?.addEventListener('click', () => toggleLayerVisibility(idx));
    row.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteLayer(idx));
    row.querySelector('[data-action="compare"]')?.addEventListener('click', () => openCompare(idx));
    row.querySelector('[data-action="edit"]')?.addEventListener('click', () => openParamEditor(layers[idx].op, layers[idx].params, idx));
    row.querySelector('[data-action="download"]')?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = imgDataToDataURL(layers[idx].imageData);
      a.download = `${currentFileName}_${layers[idx].label.replace(/\s+/g,'_').toLowerCase()}.png`;
      a.click();
    });
  });
}

function toggleLayerVisibility(idx) {
  layers[idx].enabled = !layers[idx].enabled;
  const composite = getComposite();
  applyMaps({ albedo: imgDataToDataURL(composite) });
  stackImageData = composite;
  updateLayerListUI();
}

function deleteLayer(idx) {
  if (idx === 0) return; // can't delete original
  layers.splice(idx, 1);
  stackImageData = getComposite();
  applyMaps({ albedo: imgDataToDataURL(stackImageData) });
  updateLayerListUI();
  setStatus('Layer removed', '');
}

function addLayer(label, op, params, resultImageData) {
  layers.push({ label, op, params, imageData: resultImageData, enabled: true });
  stackImageData = resultImageData;
  applyMaps({ albedo: imgDataToDataURL(stackImageData) });
  document.getElementById('canvas-hint').style.display = 'none';
  updateLayerListUI();
}

// ── Param editor popover ──────────────────────────────────────────────
const TOOL_DEFS = {
  denoise:   { label: 'Denoise',   params: [{ id:'strength', label:'Strength', min:0.1, max:1, step:0.1, def:0.5 }, { id:'passes', label:'Passes', min:1, max:4, step:1, def:1 }], badge:'JS' },
  sharpen:   { label: 'Sharpen',   params: [{ id:'strength', label:'Strength', min:0.1, max:2,  step:0.1, def:0.6 }], badge:'JS' },
  normalize: { label: 'Normalize', params: [{ id:'clip',     label:'Clip %',   min:0,   max:5,  step:0.5, def:1   }], badge:'JS' },
  upscale:   { label: 'Upscale 2\u00d7', params: [], badge:'AI', note:'Doubles resolution using Real-ESRGAN. Downloads once (~5MB), stays cached.' },
};

let editingLayerIdx = null;

function openParamEditor(op, currentParams, layerIdx) {
  activeToolOp = op;
  editingLayerIdx = (layerIdx !== undefined) ? layerIdx : null;
  const def = TOOL_DEFS[op];
  const editor = document.getElementById('pipe-param-editor');
  const inner  = document.getElementById('ppe-inner');

  inner.innerHTML = `<div style="font-size:10px;font-weight:600;color:#c4b5fd;margin-bottom:8px">${def.label} <span style="font-size:8px;background:rgba(112,42,248,.2);border:1px solid #702af8;color:#a78bfa;padding:1px 5px;border-radius:3px">${def.badge}</span></div>`;
  def.params.forEach(p => {
    const val = currentParams ? (currentParams[p.id] ?? p.def) : p.def;
    if (p.type === 'select') {
      const opts = p.options.map(o => `<option value="${o.v}"${o.v===val?' selected':''}>${o.l}</option>`).join('');
      inner.innerHTML += `<div class="ctrl-row" style="margin-bottom:4px"><span>${p.label}</span></div>
        <select id="ppe-${p.id}" style="width:100%;margin-bottom:8px;background:#12131a;border:1px solid #2d2f3d;color:#c4b5fd;border-radius:6px;padding:4px 6px;font-size:10px">${opts}</select>`;
    } else {
      inner.innerHTML += `
        <div class="ctrl-row"><span>${p.label}</span><b id="ppe-v-${p.id}">${val}</b></div>
        <input type="range" id="ppe-${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}" style="margin-bottom:8px">
      `;
    }
  });
  if (def.note) inner.innerHTML += `<div style="font-size:9px;color:#4a4f6a;line-height:1.5">${def.note}</div>`;

  // Wire slider labels (range only)
  def.params.forEach(p => {
    if (p.type === 'select') return;
    const sl = document.getElementById('ppe-' + p.id);
    const vl = document.getElementById('ppe-v-' + p.id);
    if (sl && vl) sl.addEventListener('input', () => vl.textContent = parseFloat(sl.value).toFixed(p.step < 1 ? 1 : 0));
  });

  // Mark active tool button
  document.querySelectorAll('.pipe-tool-btn').forEach(b => b.classList.remove('busy'));
  document.getElementById('ptool-' + op)?.classList.add('busy');

  editor.classList.add('open');
  document.getElementById('ppe-apply').dataset.op = op;
}

function closeParamEditor() {
  document.getElementById('pipe-param-editor').classList.remove('open');
  document.querySelectorAll('.pipe-tool-btn').forEach(b => b.classList.remove('busy'));
  activeToolOp = null;
  editingLayerIdx = null;
}

document.getElementById('ppe-cancel').addEventListener('click', closeParamEditor);

document.getElementById('ppe-apply').addEventListener('click', () => {
  const op  = document.getElementById('ppe-apply').dataset.op;
  const def = TOOL_DEFS[op];
  const params = {};
  def.params.forEach(p => {
    const el = document.getElementById('ppe-' + p.id);
    params[p.id] = p.type === 'select' ? el.value : parseFloat(el.value);
  });

  // If editing existing layer, delete it first then re-apply from its predecessor
  if (editingLayerIdx !== null) {
    const prevIdx = editingLayerIdx - 1;
    const srcData = layers[prevIdx].imageData;
    layers.splice(editingLayerIdx, 1);
    stackImageData = layers[layers.length-1]?.imageData || originalImageData;
    runEnhanceOp(op, params, def.label, srcData);
  } else {
    runEnhanceOp(op, params, def.label, stackImageData || originalImageData);
  }
  closeParamEditor();
});

// Wire tool buttons to open param editor
document.querySelectorAll('.pipe-tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const op = btn.dataset.op;
    if (activeToolOp === op) { closeParamEditor(); return; }
    openParamEditor(op, null, undefined);
  });
});

// ── Run enhance operation ─────────────────────────────────────────────
function setToolsBusy(busy) {
  document.querySelectorAll('.pipe-tool-btn').forEach(b => { if (!b.classList.contains('busy')) b.disabled = busy || !loadedImageData; });
  document.getElementById('ppe-apply').disabled = busy;
}

function runEnhanceOp(op, params, label, srcImageData) {
  setToolsBusy(true);
  const errLog = document.getElementById('ai-error-log');
  if (errLog) { errLog.textContent = ''; errLog.style.display = 'none'; }
  setStatus('Processing: ' + label + '…', '');
  _runInWorker(op, params, label, srcImageData);
}

function _runInWorker(op, params, label, srcImageData) {
  const ew = new Worker(_enhanceWorkerURL);
  const rgba = new Uint8ClampedArray(srcImageData.data);

  ew.onmessage = e => {
    const d = e.data;
    if (d.type === 'error') { setStatus('Error: ' + d.message, 'err'); setToolsBusy(false); ew.terminate(); return; }
    if (d.type === 'done') {
      const resultData = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
      addLayer(label, op, params, resultData);
      setStatus(label + ' layer added ✔', 'ok');
      setToolsBusy(false);
      ew.terminate();
    }
  };
  ew.onerror = err => {
    setStatus('Worker error: ' + err.message, 'err');
    setToolsBusy(false);
    ew.terminate();
  };

  ew.postMessage({ op, rgba, width: srcImageData.width, height: srcImageData.height, params }, [rgba.buffer]);
}

// ── Compare modal ─────────────────────────────────────────────────────
const compareModal = document.getElementById('compare-modal');

function openCompare(layerIdx) {
  const after  = layers[layerIdx];
  const before = layers[layerIdx - 1] || layers[0];
  document.getElementById('compare-title').textContent = `${before.label}  →  ${after.label}`;
  document.getElementById('compare-before').style.backgroundImage = `url('${imgDataToDataURL(before.imageData)}')`;
  document.getElementById('compare-after').style.backgroundImage  = `url('${imgDataToDataURL(after.imageData)}')`;
  compareZoom = 1; comparePanX = 0; comparePanY = 0;
  applyCompareTransform();
  setCompareSplit(50);
  compareModal.classList.add('open');
}

function setCompareSplit(pct) {
  document.getElementById('compare-after').style.clipPath = `inset(0 ${100-pct}% 0 0)`;
  document.getElementById('compare-divider').style.left = pct + '%';
  document.getElementById('compare-handle').style.left = pct + '%';
}

document.getElementById('compare-close').addEventListener('click', () => compareModal.classList.remove('open'));
compareModal.addEventListener('click', e => { if (e.target === compareModal) compareModal.classList.remove('open'); });

const vp = document.getElementById('compare-viewport');
let dragging = false;
let compareZoom = 1;
let comparePanX = 0, comparePanY = 0;

function applyCompareTransform() {
  const t = `scale(${compareZoom}) translate(${comparePanX}px, ${comparePanY}px)`;
  document.getElementById('compare-before').style.transform = t;
  document.getElementById('compare-after').style.transform = t;
}

// Zoom with scroll wheel
vp.addEventListener('wheel', e => {
  e.preventDefault();
  compareZoom = Math.max(0.5, Math.min(5, compareZoom - e.deltaY * 0.001));
  applyCompareTransform();
}, { passive: false });

// Reset zoom on double-click
vp.addEventListener('dblclick', () => {
  compareZoom = 1; comparePanX = 0; comparePanY = 0;
  applyCompareTransform();
});
function handleCompareDrag(e) {
  if (!dragging) return;
  const r = vp.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  setCompareSplit(Math.max(0, Math.min(100, x / r.width * 100)));
}
vp.addEventListener('mousedown',  () => { dragging = true; });
vp.addEventListener('touchstart', () => { dragging = true; }, { passive:true });
document.addEventListener('mouseup',   () => { dragging = false; });
document.addEventListener('touchend',  () => { dragging = false; });
document.addEventListener('mousemove', handleCompareDrag);
document.addEventListener('touchmove', handleCompareDrag, { passive:true });

// ── Init / Reset ──────────────────────────────────────────────────────
function initPipeline(imgData) {
  originalImageData = imgData;
  stackImageData    = imgData;
  layers = [{ label: 'Original', op: null, params: null, imageData: imgData, enabled: true }];
  closeParamEditor();
  updateLayerListUI();
  document.querySelectorAll('.pipe-tool-btn').forEach(b => b.disabled = false);
}

document.getElementById('btn-reset-pipeline').addEventListener('click', () => {
  if (!originalImageData) return;
  // Flatten: composite becomes the new base, all layers collapsed into one
  const composite = getComposite();
  originalImageData = composite;
  stackImageData = composite;
  layers = [{ label: 'Original (flattened)', op: null, params: null, imageData: composite, enabled: true }];
  applyMaps({ albedo: imgDataToDataURL(composite) });
  updateLayerListUI();
  setStatus('Layers flattened into new base ✔', 'ok');
});

document.getElementById('btn-dl-flattened').addEventListener('click', () => {
  const composite = getComposite();
  const a = document.createElement('a');
  a.href = imgDataToDataURL(composite);
  a.download = `${currentFileName}_flattened.png`;
  a.click();
});
const blendEl = document.getElementById('blend-ratio');
const blendVl = document.getElementById('vblend');
blendEl.addEventListener('input', () => {
  blendVl.textContent = parseFloat(blendEl.value).toFixed(2);
  smUpdateOverlay();
});

// ── Seamless preview modal ────────────────────────────────────────────
const smModal   = document.getElementById('seamless-modal');
const smCanvas  = document.getElementById('sm-canvas');
const smCtx     = smCanvas.getContext('2d');
const smBlendSl = document.getElementById('sm-blend-slider');
const smBlendVl = document.getElementById('sm-vblend');
const smOvH     = document.getElementById('sm-ov-h');
const smOvV     = document.getElementById('sm-ov-v');
let smImage = null;

function smDraw() {
  if (!smImage) return;
  const sz = smCanvas.width, half = sz / 2;
  smCtx.clearRect(0, 0, sz, sz);
  smCtx.drawImage(smImage, 0, 0, half, half);
  smCtx.drawImage(smImage, half, 0, half, half);
  smCtx.drawImage(smImage, 0, half, half, half);
  smCtx.drawImage(smImage, half, half, half, half);
  smCtx.strokeStyle = 'rgba(255,255,255,0.3)';
  smCtx.setLineDash([4, 4]);
  smCtx.beginPath();
  smCtx.moveTo(half, 0); smCtx.lineTo(half, sz);
  smCtx.moveTo(0, half); smCtx.lineTo(sz, half);
  smCtx.stroke(); smCtx.setLineDash([]);
}

function smUpdateOverlay() {
  if (!smModal.classList.contains('open')) return;
  const pct = parseInt(smBlendSl.value);
  smOvH.style.height = pct + '%';
  smOvV.style.width  = pct + '%';
  smBlendVl.textContent = pct + '%';
  blendEl.value = (pct / 100).toFixed(2);
  blendVl.textContent = blendEl.value;
}

function smOpen() {
  if (!thumbObjectURL) return;
  const wrapEl = document.getElementById('sm-canvas-wrap');
  const s = Math.min(wrapEl.clientWidth || 540, wrapEl.clientHeight || 540);
  smCanvas.width = smCanvas.height = s || 540;
  smImage = new Image();
  smImage.onload = () => { smDraw(); smUpdateOverlay(); };
  smImage.src = thumbObjectURL;
  smBlendSl.value = Math.round(parseFloat(blendEl.value) * 100);
  smModal.classList.add('open');
  requestAnimationFrame(() => {
    const s2 = Math.min(wrapEl.clientWidth, wrapEl.clientHeight);
    smCanvas.width = smCanvas.height = s2;
    smDraw(); smUpdateOverlay();
  });
}

smBlendSl.addEventListener('input', smUpdateOverlay);
document.getElementById('btn-sm-preview').addEventListener('click', smOpen);
document.getElementById('btn-sm-cancel').addEventListener('click', () => smModal.classList.remove('open'));
document.getElementById('btn-sm-apply').addEventListener('click', () => {
  smModal.classList.remove('open');
  setStatus('Blend width set to ' + blendEl.value, '');
});
smModal.addEventListener('click', e => { if (e.target === smModal) smModal.classList.remove('open'); });

// ── Mobile shrinking preview on panel scroll ──────────────────────
(function() {
  const panel = document.getElementById('panel');
  const canvasWrap = document.getElementById('canvas-wrap');
  if (!panel || !canvasWrap) return;

  const FULL_VH  = 0.45;
  const MIN_PX   = Math.round(window.innerHeight * 0.33);
  const SCROLL_RANGE = 160;
  let _shrinkResizeTimer = null;

  function updatePreviewHeight() {
    if (window.innerWidth > 768) { canvasWrap.style.height = ''; return; }
    const scrolled = Math.min(panel.scrollTop, SCROLL_RANGE);
    const fullPx = window.innerHeight * FULL_VH;
    const t = scrolled / SCROLL_RANGE;
    const ease = 1 - Math.pow(1 - t, 3);
    const h = Math.round(fullPx - (fullPx - MIN_PX) * ease);
    canvasWrap.style.height = h + 'px';
    // Debounced renderer sync — avoids calling setSize on every scroll pixel
    clearTimeout(_shrinkResizeTimer);
    _shrinkResizeTimer = setTimeout(() => onResize(true), 80);
  }

  panel.addEventListener('scroll', updatePreviewHeight, { passive: true });
  window.addEventListener('resize', () => { if (window.innerWidth > 768) canvasWrap.style.height = ''; });
})();

// ── Page unload — release all GPU + worker resources ──────────────────
window.addEventListener('beforeunload', () => {
  Object.values(_groupWorker).forEach(w => w?.terminate());
  worker.terminate();
  // Revoke blob URLs
  if (thumbObjectURL) URL.revokeObjectURL(thumbObjectURL);
  // Dispose Three.js GPU resources
  ['map','normalMap','roughnessMap','aoMap'].forEach(k => { if (mat[k]?.isTexture) mat[k].dispose(); });
  mat.dispose();
  if (mesh) { mesh.geometry.dispose(); }
  if (currentHdr) currentHdr.dispose();
  renderer.dispose();
});
