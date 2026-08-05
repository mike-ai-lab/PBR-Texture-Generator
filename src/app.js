import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader }    from 'three/addons/loaders/RGBELoader.js';

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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.minDistance = 1;
controls.maxDistance = 20;

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 3.0);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.bias = -0.001;
scene.add(dirLight);
const rim  = new THREE.DirectionalLight(0xddeeff, 1.0); rim.position.set(-5, 5, -5); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);  fill.position.set(0, -5, 3); scene.add(fill);

// Resize: always sync camera aspect (free), only resize buffer when requested
let _rw = 0, _rh = 0;
const _canvasWrap = document.getElementById('canvas-wrap'); // cache DOM ref — never query in rAF
function onResize(updateBuffer = true) {
  const w = _canvasWrap.clientWidth, h = _canvasWrap.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (updateBuffer && (w !== _rw || h !== _rh)) {
    _rw = w; _rh = h;
    renderer.setSize(w, h, true);
  }
}
onResize();
window.addEventListener('resize', onResize);
// Also run after first paint in case layout wasn't ready at parse time
requestAnimationFrame(onResize);

// Demand-render loop — only renders when something actually changed
let _needsRender = true;
function requestRender() { _needsRender = true; }
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

// Hide loading overlay
renderer.render(scene, camera);
const loadEl = document.getElementById('loading');
loadEl.style.opacity = '0';
setTimeout(() => { loadEl.style.display = 'none'; }, 400);

const hdriBase = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/';
let currentHdr = null, lightingMode = 'manual';

const mat = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.6, metalness: 0.0,
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
  // height → displacementMap is optional (needs extra geometry subdivisions), skip for now
};

function buildShape(type) {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  let geo;
  if      (type==='sphere')   geo = new THREE.SphereGeometry(2, 64, 64);
  else if (type==='cube')     geo = new THREE.BoxGeometry(3, 3, 3, 32, 32, 32);
  else if (type==='cylinder') geo = new THREE.CylinderGeometry(1.5, 1.5, 3, 64, 16);
  else { geo = new THREE.PlaneGeometry(6, 6, 64, 64); geo.rotateX(-Math.PI/2); }
  if (!geo.attributes.uv2)
    geo.setAttribute('uv2', new THREE.BufferAttribute(geo.attributes.uv.array.slice(), 2));
  mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  camera.position.set(0, type==='plane'?4:2, type==='plane'?4:6);
  controls.target.set(0,0,0); controls.update(); requestRender();
}
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
      const tog = document.getElementById('tog-'+key);
      if (!tog || tog.classList.contains('active')) {
        mat[propMap[key]] = tex;
        if (key === 'normal') {
          const nsc = parseFloat(document.getElementById('nsc').value) || 1;
          mat.normalScale?.set(nsc, nsc);
        }
        if (key === 'ao') mat.aoMapIntensity = parseFloat(document.getElementById('aoi').value) || 0.6;
      }
      mat.needsUpdate = true; requestRender(4);
      if (++loaded === keys.length) { mat.needsUpdate = true; requestRender(8); }
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
    height:'Height', metalness:'Metalness', emissive:'Emissive',
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

// ── Download All as ZIP (JSZip via CDN) ──────────────────────────────
async function downloadZip(maps, name) {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = new JSZip();
  for (const [key, dataUrl] of Object.entries(maps)) {
    const b64 = dataUrl.split(',')[1];
    zip.file(`${name}_${key}.png`, b64, { base64: true });
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_pbr_maps.zip`;
  a.click();
}

// ── Map channel toggles ───────────────────────────────────────────────
document.querySelectorAll('.map-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.map;
    const active = btn.classList.toggle('active');
    if (active) { if (loadedMaps[key]) { mat[propMap[key]] = loadedMaps[key]; mat.needsUpdate=true; requestRender(4); } }
    else         { mat[propMap[key]] = null; mat.needsUpdate=true; requestRender(4); }
  });
});

function sl(id, vid, dec, cb) {
  const el = document.getElementById(id), vl = document.getElementById(vid);
  if (!el||!vl) return;
  el.addEventListener('input', () => { const v=parseFloat(el.value); vl.textContent=v.toFixed(dec); cb(v); });
}
sl('tile','vtile',1, v => { ['map','normalMap','roughnessMap','aoMap','metalnessMap','emissiveMap'].forEach(k=>{if(mat[k])mat[k].repeat.set(v,v);}); requestRender(); });
sl('nsc','vnsc',1, v => { if(mat.normalScale) mat.normalScale.set(v,v); requestRender(); });
sl('aoi','vaoi',1, v => { mat.aoMapIntensity=v; mat.needsUpdate=true; requestRender(); });
sl('li','vli',1,   v => { dirLight.intensity=v; requestRender(); });
sl('lx','vlx',0, () => setLight(+document.getElementById('lx').value, +document.getElementById('ly').value));
sl('ly','vly',0, () => setLight(+document.getElementById('lx').value, +document.getElementById('ly').value));
sl('hdri-intensity','vhdrii',1, v => { mat.envMapIntensity=v; mat.needsUpdate=true; requestRender(); });
sl('exposure','vexp',1, v => { renderer.toneMappingExposure=v; requestRender(); });
sl('opacity-slider','vopacity',2, v => { mat.opacity=v; mat.transparent=v<1; mat.needsUpdate=true; requestRender(4); });

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

    // Apply raw texture to shader immediately, then kick off live preview
    const rawDataUrl = c.toDataURL('image/png');
    applyMaps({ albedo: rawDataUrl });
    document.getElementById('canvas-hint').style.display = 'none';
    document.getElementById('btn-tile-test').style.display = '';
    // Auto-generate preview maps so 3D shader shows PBR on load
    runLivePreview();
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
const PILL_MAP  = { albedo:'pill-alb', normal:'pill-nrm', roughness:'pill-rgh', ao:'pill-ao', height:'pill-hgt', metalness:'pill-met', emissive:'pill-emi' };
const PILL_SUFFIX = { albedo:'alb', normal:'nrm', roughness:'rgh', ao:'ao', height:'hgt', metalness:'met', emissive:'emi' };
const STEP_PILL = {
  'Saving albedo…':            'pill-alb',
  'Generating normal map…':    'pill-nrm',
  'Generating roughness map…': 'pill-rgh',
  'Generating AO map…':        'pill-ao',
  'Generating height map…':    'pill-hgt',
  'Generating metalness map…': 'pill-met',
  'Generating emissive map…':  'pill-emi',
};
function resetPills() {
  Object.values(PILL_MAP).forEach(id => {
    const el = document.getElementById(id);
    el.className = 'map-row';
    el.querySelector('.map-row-icon').textContent = '—';
  });
  ['alb','nrm','rgh','ao','hgt','met','emi'].forEach(s => {
    ['btn-eye-','btn-regen-','btn-dl-'].forEach(p => {
      const b = document.getElementById(p+s);
      if (b) b.disabled = true;
    });
  });
}
function setPillWorking(id) {
  if (!id) return;
  const el = document.getElementById(id);
  el.classList.add('working');
  el.querySelector('.map-row-icon').textContent = '💫';
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

  worker.postMessage({
    rgba,
    width:               srcData.width,
    height:              srcData.height,
    normalStrength:      +document.getElementById('ns').value,
    roughAlpha:          +document.getElementById('ra').value,
    roughBeta:           +document.getElementById('rb').value,
    aoAlpha:             +document.getElementById('aogen').value,
    heightScale:         +document.getElementById('hgt-scale').value,
    metalnessThreshold:  +document.getElementById('met-threshold').value,
    metalnessContrast:   +document.getElementById('met-contrast').value,
    emissiveThreshold:   +document.getElementById('emi-threshold').value,
    emissiveIntensity:   +document.getElementById('emi-intensity').value,
    enableHeight:    true,
    enableMetalness: true,
    enableEmissive:  true,
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
      Object.values(PILL_MAP).forEach(id => setPillDone(id));
      pBar.style.width = '100%';
      pLbl.textContent = '✔ Complete';

      const maps = {
        albedo:    rgbaToDataURL(new Uint8ClampedArray(d.albedo),    d.width, d.height),
        normal:    rgbaToDataURL(new Uint8ClampedArray(d.normal),    d.width, d.height),
        roughness: rgbaToDataURL(new Uint8ClampedArray(d.roughness), d.width, d.height),
        ao:        rgbaToDataURL(new Uint8ClampedArray(d.ao),        d.width, d.height),
        ...(d.heightMap  && { height:    rgbaToDataURL(new Uint8ClampedArray(d.heightMap),  d.width, d.height) }),
        ...(d.metalness  && { metalness: rgbaToDataURL(new Uint8ClampedArray(d.metalness),  d.width, d.height) }),
        ...(d.emissive   && { emissive:  rgbaToDataURL(new Uint8ClampedArray(d.emissive),   d.width, d.height) }),
      };
      lastMaps = maps;
      // Store params used for this generation
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
  };
});

// generation slider labels + live preview
let _previewDebounce = null;
let _previewWorker = null;
// Cache worker blob URL — created once, reused for every preview run
const _previewWorkerURL = 'workers/pbr.js';

function rgbaToObjectURL(rgba, w, h) {
  // Returns a blob: URL instead of a data: URL — much smaller string, revokable
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  // Synchronously convert to blob URL via toDataURL then immediately hand off
  return c.toDataURL('image/png'); // still data URL but canvas is GC'd immediately
}

function runLivePreview() {
  if (!loadedImageData) return;
  clearTimeout(_previewDebounce);
  _previewDebounce = setTimeout(() => {
    if (_previewWorker) { _previewWorker.terminate(); _previewWorker = null; }
    setStatus('Previewing…', '');
    const srcData = stackImageData || loadedImageData;
    // Slice a copy of the buffer — original ImageData stays intact
    const rgba = new Uint8ClampedArray(srcData.data.buffer.slice(0));
    _previewWorker = new Worker(_previewWorkerURL);
    _previewWorker.postMessage({
      rgba,
      width:               srcData.width,
      height:              srcData.height,
      normalStrength:      +document.getElementById('ns').value,
      roughAlpha:          +document.getElementById('ra').value,
      roughBeta:           +document.getElementById('rb').value,
      aoAlpha:             +document.getElementById('aogen').value,
      heightScale:         +document.getElementById('hgt-scale').value,
      metalnessThreshold:  +document.getElementById('met-threshold').value,
      metalnessContrast:   +document.getElementById('met-contrast').value,
      emissiveThreshold:   +document.getElementById('emi-threshold').value,
      emissiveIntensity:   +document.getElementById('emi-intensity').value,
      enableHeight: true, enableMetalness: true, enableEmissive: true,
      makeSeamlessFlag: false,
      blendRatio:       0.25,
      workSize:         512,
    }, [rgba.buffer]); // transfer — no copy in postMessage
    _previewWorker.onerror = () => { setStatus('Preview error', 'err'); _previewWorker = null; };
    _previewWorker.onmessage = e => {
      if (e.data.type !== 'done') return;
      const d = e.data;
      const w = d.width, h = d.height;
      const texLoader = new THREE.TextureLoader();
      const loadTex = (data, colorSpace) => new Promise(res => {
        // Create a temporary canvas, extract URL, then let canvas GC
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
        const url = cv.toDataURL('image/png');
        texLoader.load(url, tex => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(parseFloat(document.getElementById('tile').value) || 1,
                         parseFloat(document.getElementById('tile').value) || 1);
          if (colorSpace) tex.colorSpace = colorSpace;
          res(tex);
        });
      });
      Promise.all([
        loadTex(d.albedo,    THREE.SRGBColorSpace),
        loadTex(d.normal,    null),
        loadTex(d.roughness, null),
        loadTex(d.ao,        null),
      ]).then(([albTex, nrmTex, rghTex, aoTex]) => {
        // Dispose old textures before replacing
        ['map','normalMap','roughnessMap','aoMap'].forEach(k => {
          if (mat[k]?.isTexture) { mat[k].dispose(); mat[k] = null; }
        });
        mat.map = albTex;           loadedMaps.albedo    = albTex;
        mat.normalMap = nrmTex;     loadedMaps.normal    = nrmTex;
        mat.roughnessMap = rghTex;  loadedMaps.roughness = rghTex;
        mat.aoMap = aoTex;          loadedMaps.ao        = aoTex;
        mat.roughness = 1.0;
        mat.color.set(0xffffff);
        mat.normalScale?.set(
          parseFloat(document.getElementById('nsc').value) || 1,
          parseFloat(document.getElementById('nsc').value) || 1
        );
        mat.aoMapIntensity = parseFloat(document.getElementById('aoi').value) || 0.6;
        mat.needsUpdate = true;
        requestRender();
        setStatus('Live preview ✓', 'ok');
        _previewWorker.terminate();
        _previewWorker = null;
      });
    };
  }, 300);
}

[['ns','vns',0],['ra','vra',2],['rb','vrb',0],['aogen','vaogen',1]].forEach(([id,vid,d]) => {
  const el=document.getElementById(id), vl=document.getElementById(vid);
  if(el&&vl) el.addEventListener('input', () => {
    vl.textContent = parseFloat(el.value).toFixed(d);
    runLivePreview();
  });
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
    normalStrength: +document.getElementById('ns').value,
    roughAlpha:     +document.getElementById('ra').value,
    roughBeta:      +document.getElementById('rb').value,
    aoAlpha:        +document.getElementById('aogen').value,
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
    metalnessThreshold: +document.getElementById('met-threshold').value,
    metalnessContrast:  +document.getElementById('met-contrast').value,
    emissiveThreshold:  +document.getElementById('emi-threshold').value,
    emissiveIntensity:  +document.getElementById('emi-intensity').value,
    enableHeight: true, enableMetalness: true, enableEmissive: true,
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
  // Build info chips
  const p = mapParams[key] || _currentParams();
  const src = stackImageData || loadedImageData;
  const chips = [
    `<span class="mp-info-chip">Size <b>${src?.width || '?'}×${src?.height || '?'} px</b></span>`,
    `<span class="mp-info-chip">Type <b>${meta.label.split('(')[0].trim()}</b></span>`,
  ];
  if (key === 'normal')    chips.push(`<span class="mp-info-chip">Strength <b>${p.normalStrength ?? '?'}</b></span>`);
  if (key === 'roughness') chips.push(`<span class="mp-info-chip">Alpha <b>${p.roughAlpha ?? '?'}</b></span>`, `<span class="mp-info-chip">Offset <b>${p.roughBeta ?? '?'}</b></span>`);
  if (key === 'ao')        chips.push(`<span class="mp-info-chip">Intensity <b>${p.aoAlpha ?? '?'}</b></span>`);
  chips.push(`<span class="mp-info-chip" style="color:#6b7280">${meta.desc}</span>`);
  _mpInfo.innerHTML = chips.join('');
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
  // Terminate workers
  if (_previewWorker) { _previewWorker.terminate(); }
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
