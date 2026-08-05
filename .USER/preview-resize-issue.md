# Preview Pane Resize Issue — Code Extract for Gemini

## The Problem
On mobile, the 3D preview pane (WebGL/Three.js canvas) should smoothly shrink from ~45vh to 160px when the user scrolls the panel below it, then expand back when they scroll to the top — exactly like the reference mockup. 

**Current bugs:**
- Black flashes during/after the height transition
- Shape appears distorted/stretched during the transition
- The resize is not smooth — visible pixel stretching while CSS animates the height

---

## HTML Structure (mobile layout)

```
body (flex-column, overflow:hidden, height:100vh)
  └── #canvas-wrap   (flex:none, height:45vh → shrinks to 160px on scroll)
        └── #view-3d (position:absolute, inset:0)
              └── renderer.domElement (Three.js WebGL canvas, width:100%, height:100%)
  └── #panel         (flex:1, overflow-y:auto — THIS is the scrollable element)
        └── ... all the UI controls ...
```

---

## Our CSS (mobile)

```css
@media(max-width:768px){
  body {
    flex-direction: column;
    height: 100dvh;
    height: 100vh;
    overflow: hidden;
  }
  #canvas-wrap {
    order: 1;
    width: 100%;
    height: 45vh;
    min-height: 160px;
    flex: none;
    position: relative;
    z-index: 2;
    transform: translateZ(0);
    transition: height .32s cubic-bezier(.16,1,.3,1); /* smooth shrink animation */
  }
  #panel {
    width: 100%;
    min-width: 0;
    order: 2;
    flex: 1 1 0;
    min-height: 0;
    height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  #view-3d {
    position: absolute;
    inset: 0;
  }
}
@media(max-width:480px){
  #canvas-wrap { height: 42vh; }
}
```

---

## Our Three.js Renderer Setup

```js
const wrap = document.getElementById('view-3d');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdce0e5);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 3, 5);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);

// Canvas fills container via CSS
renderer.domElement.style.width  = '100%';
renderer.domElement.style.height = '100%';
renderer.domElement.style.display = 'block';
```

---

## Our Resize Function

```js
function onResize() {
  const cw = document.getElementById('canvas-wrap');
  const w = cw.clientWidth, h = cw.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false); // false = don't update CSS size
}
onResize();
window.addEventListener('resize', onResize);
```

---

## Our Animation Loop

```js
// Unconditional — renders every frame
function animationLoop() {
  requestAnimationFrame(animationLoop);
  controls.update();
  renderer.render(scene, camera);
}
animationLoop();
```

---

## Our Scroll Shrink Handler

```js
(function() {
  const panel      = document.getElementById('panel');
  const canvasWrap = document.getElementById('canvas-wrap');
  if (!panel || !canvasWrap) return;

  const EXPANDED  = window.innerWidth <= 480 ? '42vh' : '45vh';
  const SHRUNK    = '160px';
  const THRESHOLD = 40;

  let shrunk = false;

  panel.addEventListener('scroll', () => {
    const shouldShrink = panel.scrollTop > THRESHOLD;
    if (shouldShrink === shrunk) return;
    shrunk = shouldShrink;

    // Trigger CSS transition on container height
    canvasWrap.style.height = shrunk ? SHRUNK : EXPANDED;

    // Track the transition frame-by-frame so WebGL resolution stays in sync — no stretch
    const transitionEnd = performance.now() + 340;
    function trackResize() {
      onResize();
      if (performance.now() < transitionEnd) requestAnimationFrame(trackResize);
    }
    requestAnimationFrame(trackResize);
  }, { passive: true });
})();
```

---

## Reference Mockup (Gemini's implementation that works correctly)

The mockup (`pbr_texture_generator_3d_shader_preview.html`) does this **without any black flash or distortion**:

### Mockup CSS
```css
#preview-pane {
  transition: height 0.35s cubic-bezier(0.16, 1, 0.3, 1), 
              box-shadow 0.35s ease, 
              background-color 0.35s ease;
  will-change: height;
  /* initial: h-[48vh] min-h-[170px] max-h-[500px] */
}
/* canvas-container inside fills 100% w/h */
```

### Mockup Three.js renderer init
```js
renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
// canvas element is appended into canvas-container which is w-full h-full
```

### Mockup animation loop
```js
function animate() {
  requestAnimationFrame(animate); // unconditional, every frame
  controls.update();
  renderer.render(scene, camera);
}
animate();
```

### Mockup onWindowResize
```js
function onWindowResize() {
  const container = document.getElementById('canvas-container');
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}
window.addEventListener('resize', onWindowResize);
```

### Mockup scroll shrink handler
```js
function setupScrollBehavior() {
  const scrollPane    = document.getElementById('scroll-pane');
  const previewPane   = document.getElementById('preview-pane');

  scrollPane.addEventListener('scroll', () => {
    const scrollTop = scrollPane.scrollTop;

    if (scrollTop > 40) {
      previewPane.style.height = '180px';   // shrink
    } else {
      previewPane.style.height = '48vh';    // expand
    }

    // Sync Three.js renderer after transition
    setTimeout(onWindowResize, 50);
    setTimeout(onWindowResize, 200);
    setTimeout(onWindowResize, 360);
  });
}
```

---

## Key Differences to Investigate

1. **Mockup uses `renderer.setSize(w, h)` (with CSS update = true by default)** — our code uses `renderer.setSize(w, h, false)` which skips the CSS size update. Does this cause the canvas CSS size to mismatch the WebGL buffer and cause stretching/black?

2. **Mockup calls `onWindowResize` 3× at fixed delays (50, 200, 360ms)** — our code drives it every rAF frame during transition. Could the rAF loop be causing excessive buffer clears (black flashes)?

3. **Mockup does NOT set `renderer.domElement.style.width/height = '100%'`** — it relies on the container `canvas-container` being `w-full h-full` and the canvas naturally filling it at the pixel size set by `setSize`. Our canvas has CSS `width:100%; height:100%` which makes it scale via CSS independent of the WebGL buffer size.

4. **Mockup has no `preserveDrawingBuffer` issues** because `renderer.setSize` (with CSS=true) keeps the canvas element dimensions matching the buffer — so CSS never scales the buffer pixels.
