🛠️ Fix Guide: Smooth Shrinking 3D Shader Preview (No Flashes or Distortion)This guide breaks down the root causes of the black flashes, shape distortion, and jittery CSS animations in your local PBR texture preview implementation, and provides the exact fixed code snippets to replace in your codebase.🔍 Root Cause Analysis1. Why Black Flashes Occur (WebGL Buffer Reallocation)In WebGL, calling renderer.setSize(w, h) changes the underlying <canvas> element's width and height attributes (the resolution of the GPU render target).The Mistake: Calling renderer.setSize() inside a requestAnimationFrame (rAF) loop on every single frame during a CSS height transition (18–20 times in 300ms).Why it flashes: Every time JavaScript mutates canvas.width or canvas.height, the WebGL context immediately clears its drawing buffer to black/transparent. Because the browser compositor and Three.js render loops run asynchronously, there is a single-frame frame-buffer clear gap on each frame, producing severe black flickering on mobile GPUs (Adreno, Mali, Apple Silicon).2. Why Distortion & Squishing OccurWhen #canvas-wrap shrinks from 45vh to 160px, its aspect ratio changes dramatically (e.g., from ~1:1 square to a wide 16:5 rectangle).The Mistake: Using renderer.setSize(w, h, false) while relying on renderer.domElement.style.width = '100%' and style.height = '100%' without updating camera.aspect live on every frame.Why it distorts: CSS stretches the existing WebGL frame to fit the container. If the camera's projection matrix (camera.aspect) doesn't continuously match the container's real-time aspect ratio (clientWidth / clientHeight), the rendered sphere will look squished vertically or stretched horizontally.3. CSS Transition & Compositing BottlenecksMutating height on an element containing a WebGL context forces browser layout recalculation.Using height transitions without proper hardware acceleration hints (contain: strict, will-change: height) can cause micro-jank on mobile browsers.🚀 The Complete 3-Step SolutionStep 1: Fix onResize & Continuous Aspect Ratio SyncingModify your onResize function so it can continuously update camera.aspect without constantly destroying and recreating WebGL buffers./* STREAMING_CHUNK: Continuous aspect ratio and buffer resize handler */
function onResize(updateBuffer = true) {
  const cw = document.getElementById('canvas-wrap');
  if (!cw) return;
  
  const w = cw.clientWidth;
  const h = cw.clientHeight;
  if (!w || !h) return;

  // 1. ALWAYS update camera aspect ratio immediately (Zero cost, no WebGL buffer clear!)
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // 2. ONLY resize WebGL drawing buffer when requested (e.g. end of transition or debounced)
  if (updateBuffer) {
    renderer.setSize(w, h, true); // updateStyle = true keeps CSS and buffer size in sync
  }
}
Step 2: Update the Animation Loop to Keep Camera Aspect SmoothIn your main animationLoop, check if the canvas aspect ratio matches the DOM wrapper aspect ratio. If they differ during a CSS height animation, update camera.aspect live every frame. This prevents all aspect ratio distortion at 60fps with zero black flashes!/* STREAMING_CHUNK: Animation loop with aspect ratio sync */
function animationLoop() {
  requestAnimationFrame(animationLoop);

  // Smoothly update camera matrix if container aspect ratio changed during CSS transition
  const cw = document.getElementById('canvas-wrap');
  if (cw && cw.clientHeight > 0) {
    const currentAspect = cw.clientWidth / cw.clientHeight;
    if (Math.abs(camera.aspect - currentAspect) > 0.001) {
      camera.aspect = currentAspect;
      camera.updateProjectionMatrix();
    }
  }

  controls.update();
  renderer.render(scene, camera);
}
animationLoop();
Step 3: Replace the Scroll Shrink Event ListenerReplace your current panel.addEventListener('scroll', ...) script with timed keyframe resizes using setTimeout. This allows CSS to handle the 60fps smooth height transition, while camera.aspect keeps the geometry shape crisp, and renderer.setSize() updates the buffer pixel resolution cleanly at key intervals./* STREAMING_CHUNK: Scroll shrink handler with non-flashing buffer sync */
(function setupScrollShrink() {
  const panel = document.getElementById('panel');
  const canvasWrap = document.getElementById('canvas-wrap');
  if (!panel || !canvasWrap) return;

  const EXPANDED  = window.innerWidth <= 480 ? '42vh' : '45vh';
  const SHRUNK    = '160px';
  const THRESHOLD = 40;

  let isShrunk = false;

  panel.addEventListener('scroll', () => {
    const shouldShrink = panel.scrollTop > THRESHOLD;
    if (shouldShrink === isShrunk) return;
    isShrunk = shouldShrink;

    // 1. Trigger smooth CSS height transition
    canvasWrap.style.height = isShrunk ? SHRUNK : EXPANDED;

    // 2. Schedule discrete WebGL buffer resizes (no black flashing!)
    // Update buffer at start, mid-point, and conclusion of transition
    onResize(true);
    setTimeout(() => onResize(true), 120);
    setTimeout(() => onResize(true), 250);
    setTimeout(() => onResize(true), 360);
  }, { passive: true });
})();
🎨 Recommended CSS AdjustmentsEnsure your #canvas-wrap and #view-3d CSS match hardware-accelerated rendering rules:/* STREAMING_CHUNK: Optimized CSS layout rules */
#canvas-wrap {
  order: 1;
  width: 100%;
  height: 45vh;
  min-height: 160px;
  flex: none;
  position: relative;
  z-index: 2;
  will-change: height;
  transition: height 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  background-color: #0f111a; /* Prevents white flashes if context is restored */
}

#view-3d {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

#view-3d canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
📊 Summary ChecklistIssueCauseFixBlack FlashingCalling renderer.setSize() every frame inside rAF loop.Use discrete setTimeout calls for setSize(), updating camera.aspect live instead.Shape DistortionCamera aspect matrix not updating while CSS height shrinks container.Sync camera.aspect = containerWidth / containerHeight every frame inside animationLoop().Pixel StretchingMismatch between WebGL buffer resolution and CSS dimensions.Use renderer.setSize(w, h, true) at the end of the 0.35s CSS height animation.