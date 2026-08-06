// All pixel math runs in a Web Worker — no UI blocking

// ── Helpers ──────────────────────────────────────────────────────────
function toGray(r,g,b){ return 0.299*r + 0.587*g + 0.114*b; }

function wrapPad(ch, w, h, pad) {
  // Returns a new Float32Array of size (h+2*pad)*(w+2*pad) with tiled wrap padding
  const ow = w + 2*pad, oh = h + 2*pad;
  const out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    const sy = ((y - pad) % h + h) % h;
    for (let x = 0; x < ow; x++) {
      const sx = ((x - pad) % w + w) % w;
      out[y * ow + x] = ch[sy * w + sx];
    }
  }
  return out;
}

function gaussBlur(ch, w, h, sigma) {
  // Separable Gaussian blur on a Float32Array
  const r = Math.max(1, Math.ceil(sigma * 3));
  const kernel = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i*i)/(2*sigma*sigma)); kernel.push(v); sum += v; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r; k++) {
        const sx = ((x + k) % w + w) % w; // wrap
        v += ch[y * w + sx] * kernel[k + r];
      }
      tmp[y * w + x] = v;
    }
  }
  const out = new Float32Array(w * h);
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r; k++) {
        const sy = ((y + k) % h + h) % h; // wrap
        v += tmp[sy * w + x] * kernel[k + r];
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

// ── Map generators ───────────────────────────────────────────────────
function generateNormal(gray, w, h, strength) {
  const pad = 4;
  const pg = wrapPad(gray, w, h, pad);
  const pw = w + 2*pad;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + pad, py = y + pad;
      // Sobel 3x3
      const gx = (
        -pg[(py-1)*pw+(px-1)] - 2*pg[py*pw+(px-1)] - pg[(py+1)*pw+(px-1)]
        +pg[(py-1)*pw+(px+1)] + 2*pg[py*pw+(px+1)] + pg[(py+1)*pw+(px+1)]
      ) / 255;
      const gy = (
        -pg[(py-1)*pw+(px-1)] - 2*pg[(py-1)*pw+px] - pg[(py-1)*pw+(px+1)]
        +pg[(py+1)*pw+(px-1)] + 2*pg[(py+1)*pw+px] + pg[(py+1)*pw+(px+1)]
      ) / 255;
      const gz = 1.0 / (Math.max(0.1, strength) * 0.1);
      const len = Math.sqrt(gx*gx + gy*gy + gz*gz) || 1;
      const i = (y * w + x) * 4;
      out[i]   = ((-gx/len) * 0.5 + 0.5) * 255;
      out[i+1] = ((gy/len)  * 0.5 + 0.5) * 255;
      out[i+2] = ((gz/len)  * 0.5 + 0.5) * 255;
      out[i+3] = 255;
    }
  }
  return out;
}

function generateRoughness(gray, w, h, alpha, beta) {
  const inv = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) inv[i] = 255 - gray[i];
  const blurred = gaussBlur(inv, w, h, 1.0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, blurred[i] * alpha + beta));
    out[i*4] = out[i*4+1] = out[i*4+2] = v;
    out[i*4+3] = 255;
  }
  return out;
}

function generateAO(gray, w, h, alpha) {
  const inv = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) inv[i] = 255 - gray[i];
  const blur = gaussBlur(inv, w, h, 8.0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const ao = (gray[i] / 255) * ((255 - blur[i]) / 255) * 255;
    const v = Math.max(0, Math.min(255, ao * alpha));
    out[i*4] = out[i*4+1] = out[i*4+2] = v;
    out[i*4+3] = 255;
  }
  return out;
}

// ── Seamless pipeline ────────────────────────────────────────────────
function cosineMask(h, w, blendPx) {
  const mask = new Float32Array(w * h);
  const rampH = new Float32Array(h);
  const rampW = new Float32Array(w);
  for (let i = 0; i < h; i++) {
    if (i < blendPx)      rampH[i] = (1 - Math.cos(Math.PI * i / blendPx)) * 0.5;
    else if (i >= h - blendPx) rampH[i] = (1 - Math.cos(Math.PI * (h - 1 - i) / blendPx)) * 0.5;
    else rampH[i] = 1;
  }
  for (let x = 0; x < w; x++) {
    if (x < blendPx)      rampW[x] = (1 - Math.cos(Math.PI * x / blendPx)) * 0.5;
    else if (x >= w - blendPx) rampW[x] = (1 - Math.cos(Math.PI * (w - 1 - x) / blendPx)) * 0.5;
    else rampW[x] = 1;
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      mask[y * w + x] = rampH[y] * rampW[x];
  return mask;
}

function pyrDown(ch, w, h) {
  const ow = Math.floor(w / 2), oh = Math.floor(h / 2);
  const out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      out[y*ow+x] = (ch[(y*2)*w+(x*2)] + ch[(y*2)*w+(x*2+1)] +
                     ch[(y*2+1)*w+(x*2)] + ch[(y*2+1)*w+(x*2+1)]) * 0.25;
    }
  return { data: out, w: ow, h: oh };
}

function pyrUp(ch, sw, sh, tw, th) {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(x * 0.5, sw - 1), sy = Math.min(y * 0.5, sh - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0+1, sw-1), y1 = Math.min(y0+1, sh-1);
      const fx = sx - x0, fy = sy - y0;
      out[y*tw+x] = ch[y0*sw+x0]*(1-fx)*(1-fy) + ch[y0*sw+x1]*fx*(1-fy)
                  + ch[y1*sw+x0]*(1-fx)*fy      + ch[y1*sw+x1]*fx*fy;
    }
  }
  return out;
}

function pyramidBlend(a, b, mask, w, h, levels) {
  // Build Gaussian pyramids
  const gpA = [{ data: a, w, h }];
  const gpB = [{ data: b, w, h }];
  const gpM = [{ data: mask, w, h }];
  for (let l = 0; l < levels - 1; l++) {
    gpA.push(pyrDown(gpA[l].data, gpA[l].w, gpA[l].h));
    gpB.push(pyrDown(gpB[l].data, gpB[l].w, gpB[l].h));
    gpM.push(pyrDown(gpM[l].data, gpM[l].w, gpM[l].h));
  }
  // Build Laplacian pyramids
  const lpA = [], lpB = [];
  for (let l = 0; l < levels - 1; l++) {
    const upA = pyrUp(gpA[l+1].data, gpA[l+1].w, gpA[l+1].h, gpA[l].w, gpA[l].h);
    const upB = pyrUp(gpB[l+1].data, gpB[l+1].w, gpB[l+1].h, gpB[l].w, gpB[l].h);
    const la = new Float32Array(gpA[l].data.length);
    const lb = new Float32Array(gpB[l].data.length);
    for (let i = 0; i < la.length; i++) { la[i] = gpA[l].data[i] - upA[i]; lb[i] = gpB[l].data[i] - upB[i]; }
    lpA.push({ data: la, w: gpA[l].w, h: gpA[l].h });
    lpB.push({ data: lb, w: gpB[l].w, h: gpB[l].h });
  }
  lpA.push(gpA[levels-1]);
  lpB.push(gpB[levels-1]);
  // Blend each level
  const blended = lpA.map((la, l) => {
    const lb = lpB[l], gm = gpM[l];
    const out = new Float32Array(la.data.length);
    for (let i = 0; i < out.length; i++) out[i] = la.data[i] * gm.data[i] + lb.data[i] * (1 - gm.data[i]);
    return { data: out, w: la.w, h: la.h };
  });
  // Collapse
  let result = blended[levels - 1];
  for (let l = levels - 2; l >= 0; l--) {
    const up = pyrUp(result.data, result.w, result.h, blended[l].w, blended[l].h);
    const out = new Float32Array(up.length);
    for (let i = 0; i < out.length; i++) out[i] = up[i] + blended[l].data[i];
    result = { data: out, w: blended[l].w, h: blended[l].h };
  }
  return result.data;
}

function roll(ch, w, h, dy, dx) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = ((y - dy) % h + h) % h;
    for (let x = 0; x < w; x++) {
      const sx = ((x - dx) % w + w) % w;
      out[y * w + x] = ch[sy * w + sx];
    }
  }
  return out;
}

function makeSeamless(rgba, origW, origH, blendRatio, workSize) {
  // Downscale to workSize
  const scale = Math.min(1, workSize / Math.max(origW, origH));
  const ww = Math.max(4, Math.round(origW * scale));
  const wh = Math.max(4, Math.round(origH * scale));

  // Bilinear downscale — one channel at a time (we process R,G,B then upscale)
  function resizeChannel(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const sx = x * (sw / dw), sy = y * (sh / dh);
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(x0+1, sw-1), y1 = Math.min(y0+1, sh-1);
        const fx = sx - x0, fy = sy - y0;
        out[y*dw+x] = src[y0*sw+x0]*(1-fx)*(1-fy) + src[y0*sw+x1]*fx*(1-fy)
                    + src[y1*sw+x0]*(1-fx)*fy      + src[y1*sw+x1]*fx*fy;
      }
    }
    return out;
  }

  const channels = [0,1,2].map(c => {
    const ch = new Float32Array(origW * origH);
    for (let i = 0; i < origW * origH; i++) ch[i] = rgba[i*4+c];
    return scale < 1 ? resizeChannel(ch, origW, origH, ww, wh) : ch;
  });

  const blendPx = Math.max(8, Math.round(Math.min(ww, wh) * Math.max(blendRatio, 0.30)));

  const resultChannels = channels.map(ch => {
    const shifted = roll(ch, ww, wh, Math.floor(wh/2), Math.floor(ww/2));
    const mask    = cosineMask(wh, ww, blendPx);
    const blended = pyramidBlend(shifted, ch, mask, ww, wh, 4);
    const back    = roll(blended, ww, wh, -Math.floor(wh/2), -Math.floor(ww/2));
    // Upsample back to original
    return scale < 1 ? resizeChannel(back, ww, wh, origW, origH) : back;
  });

  const out = new Uint8ClampedArray(origW * origH * 4);
  for (let i = 0; i < origW * origH; i++) {
    out[i*4]   = Math.max(0, Math.min(255, resultChannels[0][i]));
    out[i*4+1] = Math.max(0, Math.min(255, resultChannels[1][i]));
    out[i*4+2] = Math.max(0, Math.min(255, resultChannels[2][i]));
    out[i*4+3] = 255;
  }
  return out;
}

// ── Map generators ───────────────────────────────────────────────────

// Enhanced Height Engine: Frequency separation & contrast normalization
// Height: exact same algorithm as Gemini mockup — luminance + contrast curve + invert
// No blur, no frequency separation — just a direct pixel-level contrast adjustment
function generateHeight(gray, w, h, contrast, invert) {
  const c = contrast ?? 1.2;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let v = gray[i] / 255;
    v = (v - 0.5) * c + 0.5;
    v = Math.max(0, Math.min(1, v));
    if (invert) v = 1 - v;
    const b = Math.round(v * 255);
    out[i*4] = out[i*4+1] = out[i*4+2] = b;
    out[i*4+3] = 255;
  }
  return out;
}

// Metalness: luminance threshold — bright highlights = metallic
// bias shifts the threshold (0=nothing metallic, 1=everything metallic)
function generateMetalness(gray, w, h, threshold, contrast) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const g = gray[i] / 255;
    // Sigmoid-like contrast curve around threshold
    const raw = (g - threshold) * contrast + 0.5;
    const v   = Math.max(0, Math.min(255, raw * 255));
    out[i*4] = out[i*4+1] = out[i*4+2] = v;
    out[i*4+3] = 255;
  }
  return out;
}

// Emissive: extract bright regions above threshold as glow
// Returns an RGBA map (can be tinted by emissiveColor in shader)
function generateEmissive(rgba, w, h, threshold, intensity) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i*4] / 255, g = rgba[i*4+1] / 255, b = rgba[i*4+2] / 255;
    const lum = 0.299*r + 0.587*g + 0.114*b;
    const factor = Math.max(0, (lum - threshold) / (1 - threshold + 0.001)) * intensity;
    out[i*4]   = Math.min(255, rgba[i*4]   * factor);
    out[i*4+1] = Math.min(255, rgba[i*4+1] * factor);
    out[i*4+2] = Math.min(255, rgba[i*4+2] * factor);
    out[i*4+3] = 255;
  }
  return out;
}

// Opacity: luminance threshold — cut-out mask for leaves/glass/water
function generateOpacity(gray, w, h, threshold) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = gray[i] > threshold * 255 ? 255 : 0;
    out[i*4] = out[i*4+1] = out[i*4+2] = v;
    out[i*4+3] = 255;
  }
  return out;
}

// ── Worker message handler ────────────────────────────────────────────
self.onmessage = function(e) {
  const { rgba, width, height, normalStrength, roughAlpha, roughBeta, aoAlpha,
          heightScale, heightContrast, heightInvert,
          metalnessThreshold, metalnessContrast,
          emissiveThreshold, emissiveIntensity,
          opacityThreshold,
          enableNormal, enableRoughness, enableAO,
          enableHeight, enableMetalness, enableEmissive, enableOpacity,
          makeSeamlessFlag, blendRatio, workSize, seamlessOnlyMode } = e.data;

  let pixels = rgba;

  if (makeSeamlessFlag) {
    self.postMessage({ type: 'progress', step: 1, total: 5, label: 'Making seamless…' });
    pixels = makeSeamless(rgba, width, height, blendRatio, workSize);
  }

  if (seamlessOnlyMode) {
    self.postMessage({ type: 'done', albedo: pixels, normal: null, roughness: null, ao: null, width, height },
      [pixels.buffer]);
    return;
  }

  // Count enabled maps for progress
  const extraMaps = (enableHeight ? 1 : 0) + (enableMetalness ? 1 : 0) + (enableEmissive ? 1 : 0) + (enableOpacity ? 1 : 0);
  const baseMaps = 1 + (enableNormal ? 1 : 0) + (enableRoughness ? 1 : 0) + (enableAO ? 1 : 0); // albedo + enabled base maps
  const total = (makeSeamlessFlag ? 1 : 0) + baseMaps + extraMaps;
  let step = makeSeamlessFlag ? 1 : 0;

  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++)
    gray[i] = toGray(pixels[i*4], pixels[i*4+1], pixels[i*4+2]);

  self.postMessage({ type: 'progress', step: ++step, total, label: 'Saving albedo…' });

  let nrmData = null, rghData = null, aoData = null;

  if (enableNormal !== false) {
    self.postMessage({ type: 'progress', step: ++step, total, label: 'Generating normal map…' });
    nrmData = generateNormal(gray, width, height, normalStrength);
  }
  if (enableRoughness !== false) {
    self.postMessage({ type: 'progress', step: ++step, total, label: 'Generating roughness map…' });
    rghData = generateRoughness(gray, width, height, roughAlpha, roughBeta);
  }
  if (enableAO !== false) {
    self.postMessage({ type: 'progress', step: ++step, total, label: 'Generating AO map…' });
    aoData = generateAO(gray, width, height, aoAlpha);
  }

  let hgtData = null, metData = null, emiData = null, opaData = null;

  if (enableHeight) {
    self.postMessage({ type: 'progress', step: ++step, total, label: 'Generating height map…' });
    hgtData = generateHeight(gray, width, height, heightContrast ?? 1.8, heightInvert ?? false);
  }
  if (enableMetalness) {
    self.postMessage({ type: 'progress', step: ++step, total, label: 'Generating metalness map…' });
    metData = generateMetalness(gray, width, height, metalnessThreshold ?? 0.6, metalnessContrast ?? 4.0);
  }
  if (enableEmissive) {
    self.postMessage({ type: 'progress', step: ++step, total, label: 'Generating emissive map…' });
    emiData = generateEmissive(pixels, width, height, emissiveThreshold ?? 0.8, emissiveIntensity ?? 2.0);
  }
  if (enableOpacity) {
    self.postMessage({ type: 'progress', step: ++step, total, label: 'Generating opacity map…' });
    opaData = generateOpacity(gray, width, height, opacityThreshold ?? 0.5);
  }

  const transfers = [pixels.buffer];
  if (nrmData) transfers.push(nrmData.buffer);
  if (rghData) transfers.push(rghData.buffer);
  if (aoData)  transfers.push(aoData.buffer);
  if (hgtData) transfers.push(hgtData.buffer);
  if (metData) transfers.push(metData.buffer);
  if (emiData) transfers.push(emiData.buffer);
  if (opaData) transfers.push(opaData.buffer);

  self.postMessage({
    type: 'done',
    albedo: pixels, normal: nrmData, roughness: rghData, ao: aoData,
    heightMap: hgtData, metalness: metData, emissive: emiData, opacity: opaData,
    width, height
  }, transfers);
};