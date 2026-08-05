// Pure-JS enhance ops
function sharpenJS(rgba, w, h, strength) {
  const src = new Uint8ClampedArray(rgba);
  const out = new Uint8ClampedArray(rgba.length);
  const k = strength;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const get = (dx, dy) => {
          const nx = Math.max(0, Math.min(w-1, x+dx));
          const ny = Math.max(0, Math.min(h-1, y+dy));
          return src[(ny*w+nx)*4+c];
        };
        const lap = get(-1,0)+get(1,0)+get(0,-1)+get(0,1) - 4*src[i+c];
        out[i+c] = Math.max(0, Math.min(255, src[i+c] - k * lap));
      }
      out[i+3] = 255;
    }
  }
  return out;
}

function normalizeJS(rgba, w, h, clip) {
  const n = w * h;
  const hist = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) hist[c][rgba[i*4+c]]++;
  const out = new Uint8ClampedArray(rgba.length);
  const clipPx = Math.round(n * clip / 100);
  const lut = hist.map(h => {
    let lo = 0, hi = 255, sum = 0;
    for (let v = 0; v < 256; v++) { sum += h[v]; if (sum > clipPx) { lo = v; break; } }
    sum = 0;
    for (let v = 255; v >= 0; v--) { sum += h[v]; if (sum > clipPx) { hi = v; break; } }
    return Array.from({length:256}, (_,v) => Math.max(0,Math.min(255, Math.round((v-lo)*255/(hi-lo||1)))));
  });
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[i*4+c] = lut[c][rgba[i*4+c]];
    out[i*4+3] = 255;
  }
  return out;
}

function denoiseJS(rgba, w, h, strength) {
  // Guided Image Filter — O(N) linear time, excellent edge preservation.
  // Uses the noisy image as its own guide (self-guided filtering).
  // Far faster than NLM and better quality than bilateral for textures.
  const r = Math.round(4 + strength * 6);   // window radius: 4..10px
  const eps = (10 + strength * 30) ** 2;    // regularization: 10..40 squared
  const n = w * h;

  // Split into float channels
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = rgba[i*4]   / 255;
    G[i] = rgba[i*4+1] / 255;
    B[i] = rgba[i*4+2] / 255;
  }

  // Box filter (fast O(N) sliding window sum)
  function boxFilter(src, w, h, r) {
    const tmp = new Float32Array(src.length);
    const dst = new Float32Array(src.length);
    // Horizontal pass
    for (let y = 0; y < h; y++) {
      let sum = 0, count = 0;
      for (let x = 0; x < w; x++) {
        sum += src[y*w+x];
        count++;
        if (x > r) { sum -= src[y*w+(x-r-1)]; count--; }
        const start = Math.max(0, x-r);
        tmp[y*w+x] = sum / (x - start + 1);
      }
    }
    // Vertical pass
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let y = 0; y < h; y++) {
        sum += tmp[y*w+x];
        count++;
        if (y > r) { sum -= tmp[(y-r-1)*w+x]; count--; }
        const start = Math.max(0, y-r);
        dst[y*w+x] = sum / (y - start + 1);
      }
    }
    return dst;
  }

  // Guided filter per channel (self-guided: guide = input)
  function guidedChannel(p, w, h, r, eps) {
    const meanP  = boxFilter(p, w, h, r);
    const meanP2 = boxFilter(p.map((v,i) => v*v), w, h, r);
    const varP   = meanP2.map((v,i) => v - meanP[i]*meanP[i]);
    const a      = varP.map((v,i) => v / (v + eps));
    const b      = meanP.map((v,i) => meanP[i] - a[i]*meanP[i]);
    const meanA  = boxFilter(a, w, h, r);
    const meanB  = boxFilter(b, w, h, r);
    return p.map((v,i) => Math.max(0, Math.min(1, meanA[i]*p[i] + meanB[i])));
  }

  const outR = guidedChannel(R, w, h, r, eps);
  const outG = guidedChannel(G, w, h, r, eps);
  const outB = guidedChannel(B, w, h, r, eps);

  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < n; i++) {
    out[i*4]   = Math.round(outR[i] * 255);
    out[i*4+1] = Math.round(outG[i] * 255);
    out[i*4+2] = Math.round(outB[i] * 255);
    out[i*4+3] = 255;
  }
  return out;
}

function bilinearResize(rgba, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = x*(sw/dw), sy = y*(sh/dh);
      const x0=Math.floor(sx), y0=Math.floor(sy);
      const x1=Math.min(x0+1,sw-1), y1=Math.min(y0+1,sh-1);
      const fx=sx-x0, fy=sy-y0;
      const i=(y*dw+x)*4;
      for (let c=0;c<4;c++) {
        out[i+c]=Math.round(
          rgba[(y0*sw+x0)*4+c]*(1-fx)*(1-fy)+
          rgba[(y0*sw+x1)*4+c]*fx*(1-fy)+
          rgba[(y1*sw+x0)*4+c]*(1-fx)*fy+
          rgba[(y1*sw+x1)*4+c]*fx*fy);
      }
    }
  }
  return out;
}

function upscaleJS(rgba, w, h) {
  return { data: bilinearResize(rgba, w, h, w*2, h*2), width: w*2, height: h*2 };
}

self.onmessage = function(e) {
  const { op, rgba, width, height, params } = e.data;
  try {
    let result;
    if (op === 'sharpen')   result = { data: sharpenJS(rgba, width, height, params.strength), width, height };
    if (op === 'normalize') result = { data: normalizeJS(rgba, width, height, params.clip), width, height };
    if (op === 'denoise') {
      // Multi-pass guided filter: more passes = stronger denoise, still O(N)
      const passes = params.passes || 1;
      let buf = rgba;
      for (let p = 0; p < passes; p++) buf = denoiseJS(buf, width, height, params.strength);
      result = { data: buf, width, height };
    }
    if (op === 'upscale')   result = upscaleJS(rgba, width, height);
    self.postMessage({ type: 'done', ...result }, [result.data.buffer]);
  } catch(err) {
    self.postMessage({ type: 'error', message: String(err.message || err) });
  }
};
