"""
Generates a self-contained 3D texture preview HTML and opens it in the browser.
Textures are embedded as base64 data URIs to avoid CORS/file:// restrictions in Chrome.
"""
import os
import base64
import webbrowser


def _b64(path: str) -> str:
    """Read an image file and return a data URI string."""
    if not path or not os.path.isfile(path):
        return ""
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "bmp": "image/bmp", "webp": "image/webp"}.get(ext, "image/png")
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{data}"


def launch_preview(result_paths: dict[str, str], mat_name: str) -> None:
    """Write preview HTML next to the maps and open it."""
    mat_dir = os.path.dirname(next(iter(result_paths.values())))
    html_path = os.path.join(mat_dir, "preview.html")

    alb = _b64(result_paths.get("albedo", ""))
    nrm = _b64(result_paths.get("normal", ""))
    rgh = _b64(result_paths.get("roughness", ""))
    ao  = _b64(result_paths.get("ao", ""))

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>3D Preview — {mat_name}</title>
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ background:#13131a; color:#e2e8f0; font-family:'Segoe UI',sans-serif; overflow:hidden; }}
  #canvas-container {{ position:fixed; inset:0; }}

  /* ── Sidebar ── */
  #ui {{
    position:fixed; top:0; right:0; width:300px; height:100vh;
    background:rgba(20,20,30,0.92); backdrop-filter:blur(14px);
    border-left:1px solid rgba(255,255,255,0.07);
    display:flex; flex-direction:column;
    overflow-y:auto; z-index:10;
  }}
  #ui-header {{
    padding:18px 20px 12px;
    border-bottom:1px solid rgba(255,255,255,0.07);
  }}
  #ui-header h1 {{ font-size:15px; font-weight:700; color:#fff; letter-spacing:.3px; }}
  #ui-header p  {{ font-size:11px; color:#64748b; margin-top:2px; }}
  .section {{ padding:14px 20px; border-bottom:1px solid rgba(255,255,255,0.05); }}
  .section-title {{
    font-size:10px; font-weight:700; letter-spacing:1.2px;
    color:#4f8ef7; text-transform:uppercase; margin-bottom:10px;
  }}

  /* Map status pills */
  .map-pill {{
    display:flex; align-items:center; justify-content:space-between;
    font-size:12px; color:#94a3b8;
    padding:5px 10px; background:rgba(255,255,255,0.04);
    border-radius:6px; margin-bottom:6px;
  }}
  .dot {{ width:8px; height:8px; border-radius:50%; background:#ef4444; }}
  .dot.ok {{ background:#10b981; }}

  /* Sliders */
  .ctrl {{ margin-bottom:10px; }}
  .ctrl-header {{ display:flex; justify-content:space-between; font-size:12px; color:#94a3b8; margin-bottom:4px; }}
  .ctrl-header span:last-child {{ color:#4f8ef7; font-weight:600; }}
  input[type=range] {{
    width:100%; accent-color:#4f8ef7; height:3px;
    background: linear-gradient(to right, #4f8ef7 var(--pct,50%), #2d3748 var(--pct,50%));
    border-radius:2px; outline:none; cursor:pointer;
  }}
  select {{
    width:100%; padding:7px 10px; font-size:12px;
    background:#1e2433; border:1px solid #2d3748; color:#e2e8f0;
    border-radius:7px; outline:none; cursor:pointer;
  }}
  select:focus {{ border-color:#4f8ef7; }}

  /* Bottom hint */
  #hint {{ padding:12px 20px; font-size:10px; color:#475569; line-height:1.6; margin-top:auto; }}

  /* Loading overlay */
  #loading {{
    position:fixed; inset:0; background:#13131a;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    z-index:99; transition:opacity .4s;
  }}
  .spinner {{
    width:44px; height:44px; border-radius:50%;
    border:3px solid rgba(255,255,255,0.08);
    border-top-color:#4f8ef7;
    animation:spin .8s linear infinite;
    margin-bottom:14px;
  }}
  @keyframes spin {{ to {{ transform:rotate(360deg); }} }}
  #loading p {{ font-size:13px; color:#64748b; }}
</style>
</head>
<body>

<div id="loading"><div class="spinner"></div><p id="load-text">Loading…</p></div>
<div id="canvas-container"></div>

<div id="ui">
  <div id="ui-header">
    <h1>⬡ 3D Texture Preview</h1>
    <p id="mat-name">{mat_name}</p>
  </div>

  <div class="section">
    <div class="section-title">Loaded Maps</div>
    <div class="map-pill"><span>Albedo</span>    <div class="dot" id="s-alb"></div></div>
    <div class="map-pill"><span>Normal</span>    <div class="dot" id="s-nrm"></div></div>
    <div class="map-pill"><span>Roughness</span> <div class="dot" id="s-rgh"></div></div>
    <div class="map-pill"><span>Ambient Occ.</span><div class="dot" id="s-ao"></div></div>
  </div>

  <div class="section">
    <div class="section-title">Geometry</div>
    <select id="shape">
      <option value="plane">Plane (Floor)</option>
      <option value="sphere">Sphere</option>
      <option value="cube">Cube</option>
      <option value="cylinder">Cylinder</option>
    </select>
  </div>

  <div class="section">
    <div class="section-title">Material</div>
    <div class="ctrl">
      <div class="ctrl-header"><span>Texture Tiling</span><span id="v-tile">1.0×</span></div>
      <input type="range" id="s-tile" min="0.5" max="10" step="0.5" value="1">
    </div>
    <div class="ctrl">
      <div class="ctrl-header"><span>Normal Strength</span><span id="v-nrm">1.0</span></div>
      <input type="range" id="s-nrm-str" min="0" max="3" step="0.1" value="1">
    </div>
    <div class="ctrl">
      <div class="ctrl-header"><span>AO Intensity</span><span id="v-ao">1.0</span></div>
      <input type="range" id="s-ao-int" min="0" max="2" step="0.1" value="1">
    </div>
    <div class="ctrl">
      <div class="ctrl-header"><span>Env Reflections</span><span id="v-env">1.0</span></div>
      <input type="range" id="s-env" min="0" max="3" step="0.1" value="1">
    </div>
  </div>

  <div class="section">
    <div class="section-title">Lighting</div>
    <div class="ctrl">
      <div class="ctrl-header"><span>Intensity</span><span id="v-lint">2.0</span></div>
      <input type="range" id="s-lint" min="0" max="5" step="0.1" value="2">
    </div>
    <div class="ctrl">
      <div class="ctrl-header"><span>Rotation X</span><span id="v-lx">45°</span></div>
      <input type="range" id="s-lx" min="-180" max="180" step="1" value="45">
    </div>
    <div class="ctrl">
      <div class="ctrl-header"><span>Rotation Y</span><span id="v-ly">45°</span></div>
      <input type="range" id="s-ly" min="-180" max="180" step="1" value="45">
    </div>
  </div>

  <div id="hint">
    Left drag · Rotate<br>
    Right drag · Pan<br>
    Scroll · Zoom
  </div>
</div>

<script async src="https://unpkg.com/es-module-shims@1.8.0/dist/es-module-shims.js"></script>
<script type="importmap">
{{ "imports": {{ "three": "https://unpkg.com/three@0.160.0/build/three.module.js", "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/" }} }}
</script>

<script type="module">
import * as THREE from 'three';
import {{ OrbitControls }} from 'three/addons/controls/OrbitControls.js';
import {{ RGBELoader }} from 'three/addons/loaders/RGBELoader.js';

const MAPS = {{
  albedo:    '{alb}',
  normal:    '{nrm}',
  roughness: '{rgh}',
  ao:        '{ao}',
}};

let camera, scene, renderer, controls, dirLight, mesh, mat;
const textures = {{}};
const imgs = {{}};

init();

function init() {{
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x13131a);

  camera = new THREE.PerspectiveCamera(45, contentWidth() / window.innerHeight, 0.1, 100);
  camera.position.set(0, 3, 5);

  renderer = new THREE.WebGLRenderer({{ antialias: true }});
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(contentWidth(), window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 1;
  controls.maxDistance = 20;

  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.bias = -0.001;
  setLightPos(45, 45);
  scene.add(dirLight);

  scene.add(new THREE.DirectionalLight(0xaaccff, 0.4)).position.set(-5, 5, -5);

  new RGBELoader()
    .setPath('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/')
    .load('studio_small_08_1k.hdr', hdr => {{
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = hdr;
    }});

  loadTextures();
  setupSliders();
  window.addEventListener('resize', onResize);
  renderer.setAnimationLoop(() => {{ controls.update(); renderer.render(scene, camera); }});
}}

function contentWidth() {{ return window.innerWidth - 300; }}

function loadTextures() {{
  const loader = new THREE.TextureLoader();
  const keys = Object.keys(MAPS);
  let done = 0;

  keys.forEach(k => {{
    loader.load(MAPS[k],
      tex => {{
        if (k === 'albedo') tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        textures[k] = tex;
        document.getElementById('s-' + (k === 'albedo' ? 'alb' : k === 'roughness' ? 'rgh' : k)).classList.add('ok');
        if (++done === keys.length) finalize();
      }},
      undefined,
      () => {{ if (++done === keys.length) finalize(); }}
    );
  }});
}}

function finalize() {{
  mat = new THREE.MeshStandardMaterial({{
    map:              textures.albedo    || null,
    normalMap:        textures.normal    || null,
    normalScale:      new THREE.Vector2(1, 1),
    roughnessMap:     textures.roughness || null,
    roughness:        1.0,
    aoMap:            textures.ao        || null,
    aoMapIntensity:   1.0,
    envMapIntensity:  1.0,
  }});
  if (!textures.albedo)    mat.color.setHex(0xaaaaaa);
  if (!textures.roughness) mat.roughness = 0.5;

  buildShape('plane');

  document.getElementById('loading').style.opacity = '0';
  setTimeout(() => document.getElementById('loading').style.display = 'none', 400);
}}

function buildShape(type) {{
  if (mesh) {{ scene.remove(mesh); mesh.geometry.dispose(); }}
  const geoms = {{
    plane:    () => {{ const g = new THREE.PlaneGeometry(6,6,64,64); g.rotateX(-Math.PI/2); return g; }},
    sphere:   () => new THREE.SphereGeometry(2,64,64),
    cube:     () => new THREE.BoxGeometry(3,3,3,32,32,32),
    cylinder: () => new THREE.CylinderGeometry(1.5,1.5,3,64,16),
  }};
  const geo = (geoms[type] || geoms.plane)();
  if (!geo.attributes.uv2)
    geo.setAttribute('uv2', new THREE.BufferAttribute(geo.attributes.uv.array.slice(), 2));

  mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  camera.position.set(0, type === 'plane' ? 4 : 2, type === 'plane' ? 4 : 6);
  controls.target.set(0,0,0);
  controls.update();
}}

function setLightPos(x, y) {{
  const r = 10;
  const phi   = THREE.MathUtils.degToRad(90 - y);
  const theta = THREE.MathUtils.degToRad(x);
  dirLight.position.setFromSphericalCoords(r, phi, theta);
}}

function sl(id, valId, suffix, cb) {{
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  const upd = () => {{ const v = parseFloat(el.value); vl.textContent = v.toFixed(1) + (suffix||''); cb(v); updateTrack(el); }};
  el.addEventListener('input', upd);
  updateTrack(el);
}}

function updateTrack(el) {{
  const pct = (el.value - el.min) / (el.max - el.min) * 100;
  el.style.setProperty('--pct', pct + '%');
}}

function setupSliders() {{
  sl('s-tile',    'v-tile',  '×', v => Object.values(textures).forEach(t => t && t.repeat.set(v,v)));
  sl('s-nrm-str', 'v-nrm',  '',  v => mat && mat.normalScale?.set(v,v));
  sl('s-ao-int',  'v-ao',   '',  v => mat && (mat.aoMapIntensity = v));
  sl('s-env',     'v-env',  '',  v => mat && (mat.envMapIntensity = v));
  sl('s-lint',    'v-lint', '',  v => dirLight && (dirLight.intensity = v));
  sl('s-lx',      'v-lx',  '°', () => setLightPos(parseFloat(document.getElementById('s-lx').value), parseFloat(document.getElementById('s-ly').value)));
  sl('s-ly',      'v-ly',  '°', () => setLightPos(parseFloat(document.getElementById('s-lx').value), parseFloat(document.getElementById('s-ly').value)));

  document.getElementById('shape').addEventListener('change', e => buildShape(e.target.value));
}}

function onResize() {{
  camera.aspect = contentWidth() / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(contentWidth(), window.innerHeight);
}}
</script>
</body>
</html>"""

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    # Use a simple file URI — base64 data means no cross-origin requests needed
    webbrowser.open("file:///" + html_path.replace("\\", "/"))
