// GPU renderer for the animated effects and transitions. The expressions of catalog.js are compiled to GLSL
// fragment shaders; the preview draws with them in real time and the export sends every frame through the same
// shaders (src/fxExport.js), so both show the same picture.
import { parse } from './expr.js';

// ---- Expression -> GLSL (one expression per colour channel; ch 0 = red, 1 = green, 2 = blue).
function toGlsl(ast, mode, ch) {
  const f = (v) => {
    const s = String(v);
    return /[.e]/.test(s) ? s : `${s}.0`;
  };
  const go = (n) => {
    switch (n.k) {
      case 'num': return `(${f(n.v)})`;
      case 'var': return { X: 'X', Y: 'Y', W: 'W', H: 'H', T: 'T', P: 'P', PI: '3.14159265358979', E: '2.71828182845905' }[n.v];
      case 'neg': return `(-${go(n.a)})`;
      case 'seq': return `(${go(n.a)},${go(n.b)})`;
      case 'bin': return n.op === '^' ? `fpow(${go(n.a)},${go(n.b)})` : `(${go(n.a)}${n.op}${go(n.b)})`;
      case 'call': {
        const a = n.args.map(go);
        switch (n.f) {
          case 'if': return `((${a[0]})!=0.0?(${a[1]}):(${a[2]}))`;
          case 'ifnot': return `((${a[0]})==0.0?(${a[1]}):(${a[2]}))`;
          case 'lt': return `float((${a[0]})<(${a[1]}))`;
          case 'lte': return `float((${a[0]})<=(${a[1]}))`;
          case 'gt': return `float((${a[0]})>(${a[1]}))`;
          case 'gte': return `float((${a[0]})>=(${a[1]}))`;
          case 'eq': return `float((${a[0]})==(${a[1]}))`;
          case 'not': return `float((${a[0]})==0.0)`;
          case 'between': return `float((${a[0]})>=(${a[1]})&&(${a[0]})<=(${a[2]}))`;
          case 'clip': return `clamp(${a[0]},${a[1]},${a[2]})`;
          case 'mod': return `fmodf(${a[0]},${a[1]})`;
          case 'hypot': return `length(vec2(${a[0]},${a[1]}))`;
          case 'atan2': return `atan(${a[0]},${a[1]})`;
          case 'round': return `floor((${a[0]})+0.5)`;
          case 'trunc': return `ftrunc(${a[0]})`;
          case 'log': return `log(${a[0]})`;
          case 'pow': return `fpow(${a[0]},${a[1]})`;
          case 'st': return `(r${n.args[0].v} = (${a[1]}))`;
          case 'ld': return `r${n.args[0].v}`;
          case 'hash': return `hash1(${a[0]})`;
          case 'fract': return `fract(${a[0]})`;
          case 'smooth': return `smooth3(${a[0]},${a[1]},${a[2]})`;
          case 'S': return `smp(uA,${a[0]},${a[1]})[${ch}]`;
          case 'L': return `dot(smp(uA,${a[0]},${a[1]}).rgb,vec3(0.299,0.587,0.114))`;
          case 'A': if (mode !== 'transition') throw new Error('A() is for transitions'); return `smp(uA,${a[0]},${a[1]})[${ch}]`;
          case 'B': if (mode !== 'transition') throw new Error('B() is for transitions'); return `smp(uB,${a[0]},${a[1]})[${ch}]`;
          case 'LA': if (mode !== 'transition') throw new Error('LA() is for transitions'); return `dot(smp(uA,${a[0]},${a[1]}).rgb,vec3(0.299,0.587,0.114))`;
          case 'LB': if (mode !== 'transition') throw new Error('LB() is for transitions'); return `dot(smp(uB,${a[0]},${a[1]}).rgb,vec3(0.299,0.587,0.114))`;
          case 'C': return `(${a[ch]})`;
          case 'PR': return `smp(uA,${a[0]},${a[1]}).r`;
          case 'PG': return `smp(uA,${a[0]},${a[1]}).g`;
          case 'PB': return `smp(uA,${a[0]},${a[1]}).b`;
          default: return `${n.f}(${a.join(',')})`;
        }
      }
      default: throw new Error('bad node');
    }
  };
  return go(ast);
}

export function shaderSource(src, mode) {
  const ast = parse(src);
  const regs = Array.from({ length: 10 }, (_, i) => `float r${i} = 0.0;`).join(' ');
  const chan = (c) => `{ ${regs} o[${c}] = ${toGlsl(ast, mode, c)}; }`;
  return `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float W;
uniform float H;
uniform float T;
uniform float P;
out vec4 outColor;
float X;
float Y;
// Pixels are 0..255 like the CPU version; textures are sampled at pixel centres (nearest).
vec4 smp(sampler2D s, float x, float y) {
  return texture(s, (vec2(clamp(floor(x), 0.0, W - 1.0), clamp(floor(y), 0.0, H - 1.0)) + 0.5) / vec2(W, H)) * 255.0;
}
float ftrunc(float v) { return v < 0.0 ? ceil(v) : floor(v); }
float fmodf(float a, float b) { return a - b * ftrunc(a / b); }
float fpow(float a, float b) { return pow(abs(a), b) * (a < 0.0 && mod(b, 2.0) == 1.0 ? -1.0 : 1.0); }
float hash1(float v) { return fract(sin(v * 12.9898 + 4.1414) * 43758.5453); }
float smooth3(float a, float b, float v) { float t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
void main() {
  X = floor(gl_FragCoord.x);
  Y = H - 1.0 - floor(gl_FragCoord.y);
  vec3 o;
  ${chan(0)}
  ${chan(1)}
  ${chan(2)}
  outColor = vec4(clamp(o / 255.0, 0.0, 1.0), ${mode === 'effect' ? 'smp(uA, X, Y).a / 255.0' : '1.0'});
}`;
}

// A 3D LUT pass: the LUT is a 2D texture of N slices (blue) of N x N (red across, green down); the color is
// looked up with linear filtering inside a slice and mixed between the two nearest slices. K: intensity 0..1.
const LUT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uL;
uniform float W;
uniform float H;
uniform float N;
uniform float K;
out vec4 outColor;
void main() {
  vec2 px = vec2(floor(gl_FragCoord.x), H - 1.0 - floor(gl_FragCoord.y));
  vec4 src = texture(uA, (px + 0.5) / vec2(W, H));
  vec3 c = clamp(src.rgb, 0.0, 1.0);
  float b = c.b * (N - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, N - 1.0);
  float f = b - b0;
  float x = c.r * (N - 1.0) + 0.5;
  float y = (c.g * (N - 1.0) + 0.5) / N;
  vec3 l0 = texture(uL, vec2((b0 * N + x) / (N * N), y)).rgb;
  vec3 l1 = texture(uL, vec2((b1 * N + x) / (N * N), y)).rgb;
  outColor = vec4(mix(c, mix(l0, l1, f), K), src.a);
}`;

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// True morph cut (P3-03): the flow texture (uFlow, LINEAR) holds the A->B
// displacement in frame fractions. A is sampled P*flow behind the output
// pixel, B (1-P)*flow ahead of it, then the two warped pictures crossfade.
// At P=0 the warp is zero and the output is exactly A; at P=1 exactly B.
// Sampling is nearest (like smp() above), coordinates are top-down pixels.
const MORPH_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uFlow;
uniform float W;
uniform float H;
uniform float P;
uniform float S;
out vec4 outColor;
vec4 smp(sampler2D s, float x, float y) {
  return texture(s, (vec2(clamp(floor(x), 0.0, W - 1.0), clamp(floor(y), 0.0, H - 1.0)) + 0.5) / vec2(W, H)) * 255.0;
}
void main() {
  float X = floor(gl_FragCoord.x);
  float Y = H - 1.0 - floor(gl_FragCoord.y);
  vec2 f = (texture(uFlow, (vec2(X, Y) + 0.5) / vec2(W, H)).rg - 0.5) * 2.0 * 0.25;
  vec3 ca = smp(uA, X - P * f.x * W * S, Y - P * f.y * H * S).rgb;
  vec3 cb = smp(uB, X + (1.0 - P) * f.x * W * S, Y + (1.0 - P) * f.y * H * S).rgb;
  outColor = vec4(clamp(mix(ca, cb, P) / 255.0, 0.0, 1.0), 1.0);
}`;

// Real glow / bloom (CC-01): a dedicated multi-pass pipeline, NOT a single-pixel
// expression — extract the bright pass at half res, blur it separably at half
// and quarter res, composite it back tinted (add / screen). Working space is
// the pipeline's display-referred 0..1 RGB (no hidden gamma step, so preview
// and export agree); the source alpha passes through untouched and the glow is
// premultiplied by its mask, so transparent regions never leak colour. Blur
// edges use replicate (clamp) padding — no black fringe at the frame border.
// All shaders work in top-down pixel coords like shaderSource above.
const BLOOM_EXTRACT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform float uSW;
uniform float uSH;
uniform float uOW;
uniform float uOH;
uniform float uThreshold;
uniform float uSoftness;
uniform float uMask;
out vec4 outColor;
void main() {
  float X = floor(gl_FragCoord.x);
  float Y = uOH - 1.0 - floor(gl_FragCoord.y);
  float sx = X * 2.0;
  float sy = Y * 2.0;
  vec2 uv = vec2(uSW, uSH);
  vec4 c = vec4(0.0);
  c += texture(uA, (vec2(clamp(sx, 0.0, uSW - 1.0), clamp(sy, 0.0, uSH - 1.0)) + 0.5) / uv);
  c += texture(uA, (vec2(clamp(sx + 1.0, 0.0, uSW - 1.0), clamp(sy, 0.0, uSH - 1.0)) + 0.5) / uv);
  c += texture(uA, (vec2(clamp(sx, 0.0, uSW - 1.0), clamp(sy + 1.0, 0.0, uSH - 1.0)) + 0.5) / uv);
  c += texture(uA, (vec2(clamp(sx + 1.0, 0.0, uSW - 1.0), clamp(sy + 1.0, 0.0, uSH - 1.0)) + 0.5) / uv);
  c *= 0.25;
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float lo = max(0.0, uThreshold - uSoftness);
  float hi = min(1.0, uThreshold + uSoftness);
  float knee = smoothstep(lo, max(hi, lo + 0.001), luma);
  // Mask source: 0 = luma only, 1 = luma gated by alpha (opaque layers only).
  float m = knee * mix(1.0, c.a, uMask);
  outColor = vec4(c.rgb * m, m);
}`;

// Separable 9-tap Gaussian; the tap spacing grows with sigma so a wide radius
// is a real wide blur in one H+V pair, not a truncated kernel.
const BLOOM_BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform float W;
uniform float H;
uniform float uSigma;
uniform float uDir;
out vec4 outColor;
void main() {
  float X = floor(gl_FragCoord.x);
  float Y = H - 1.0 - floor(gl_FragCoord.y);
  vec2 px = vec2(X, Y);
  vec2 stepv = mix(vec2(1.0, 0.0), vec2(0.0, 1.0), uDir);
  float spacing = clamp(uSigma * 0.5, 1.0, 8.0);
  float s2 = max(uSigma * uSigma, 0.0001);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float fi = float(i);
    float off = fi * spacing;
    float wgt = exp(-0.5 * off * off / s2);
    vec2 p = vec2(clamp(px.x + stepv.x * off, 0.0, W - 1.0), clamp(px.y + stepv.y * off, 0.0, H - 1.0));
    acc += texture(uA, (p + 0.5) / vec2(W, H)) * wgt;
    wsum += wgt;
  }
  outColor = acc / wsum;
}`;

// Plain 2x2 box downsample (half -> quarter res) for the wide halo scale.
const BLOOM_DOWN_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform float uSW;
uniform float uSH;
uniform float uOW;
uniform float uOH;
out vec4 outColor;
void main() {
  float X = floor(gl_FragCoord.x);
  float Y = uOH - 1.0 - floor(gl_FragCoord.y);
  float sx = X * 2.0;
  float sy = Y * 2.0;
  vec2 uv = vec2(uSW, uSH);
  vec4 c = vec4(0.0);
  c += texture(uA, (vec2(clamp(sx, 0.0, uSW - 1.0), clamp(sy, 0.0, uSH - 1.0)) + 0.5) / uv);
  c += texture(uA, (vec2(clamp(sx + 1.0, 0.0, uSW - 1.0), clamp(sy, 0.0, uSH - 1.0)) + 0.5) / uv);
  c += texture(uA, (vec2(clamp(sx, 0.0, uSW - 1.0), clamp(sy + 1.0, 0.0, uSH - 1.0)) + 0.5) / uv);
  c += texture(uA, (vec2(clamp(sx + 1.0, 0.0, uSW - 1.0), clamp(sy + 1.0, 0.0, uSH - 1.0)) + 0.5) / uv);
  outColor = c * 0.25;
}`;

const BLOOM_COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform float W;
uniform float H;
uniform float uIntensity;
uniform vec3 uColor;
uniform float uBlend;
uniform float uQuarter;
uniform float uPulse;
uniform float uSweep;
uniform float T;
out vec4 outColor;
void main() {
  float X = floor(gl_FragCoord.x);
  float Y = H - 1.0 - floor(gl_FragCoord.y);
  vec2 uv = (vec2(X, Y) + 0.5) / vec2(W, H);
  vec4 src = texture(uA, uv);
  vec3 tight = texture(uB, uv).rgb;
  vec3 wide = texture(uC, uv).rgb;
  vec3 bloom = (tight * 0.75 + wide * 0.5 * uQuarter) * uColor;
  float k = uIntensity;
  k *= 1.0 + uPulse * 0.4 * sin(T * 2.6);
  float sp = fract(T * 0.18);
  float d = (X + Y * 0.5) / (W + H * 0.5);
  float dd = abs(d - sp);
  dd = min(dd, 1.0 - dd);
  k *= 1.0 + uSweep * 1.5 * exp(-dd * dd * 36.0);
  vec3 add = clamp(src.rgb + bloom * k, 0.0, 1.0);
  vec3 scr = 1.0 - (1.0 - src.rgb) * (1.0 - clamp(bloom * k, 0.0, 1.0));
  outColor = vec4(mix(add, scr, clamp(uBlend, 0.0, 1.0)), src.a);
}`;

const BLOOM_COPY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform float W;
uniform float H;
out vec4 outColor;
void main() {
  float X = floor(gl_FragCoord.x);
  float Y = H - 1.0 - floor(gl_FragCoord.y);
  outColor = texture(uA, (vec2(X, Y) + 0.5) / vec2(W, H));
}`;

// One WebGL2 context renders everything; the result is read back or drawn from `canvas`.
export class FxGL {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL 2 is not available, so animated effects cannot be drawn.');
    this.gl = gl;
    // The graphics driver can drop the context (GPU reset): start a new one at the next draw.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (shared === this) shared = null;
    });
    this.programs = new Map();
    // PF-04 GPU-readback reduction: the readback scratch buffers are
    // allocated ONCE (grown only when a bigger frame arrives) and reused
    // for every frame, instead of two fresh w*h*4 buffers per frame (one
    // for readPixels, one for the row flip). At 1080p that was ~16 MB of
    // garbage per exported frame. read() returns the SHARED flipped
    // buffer — callers must consume it synchronously or copy it before
    // holding it: the fx pass batches 4 frames per fxWrite IPC call, so
    // pushing the shared buffer aliases all four to the last-painted
    // frame (the export then steps 4 frames at a time).
    this._rb = { px: null, flipped: null, bytes: 0 };
    this.readbackFrames = 0;
    this.readbackBytes = 0;
    this.tex = [gl.createTexture(), gl.createTexture()];
    for (const t of this.tex) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    // Effects chain through two framebuffer textures.
    this.fbTex = [gl.createTexture(), gl.createTexture()];
    this.fb = [gl.createFramebuffer(), gl.createFramebuffer()];
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  program(src, mode) {
    const key = `${mode}|${src}`;
    let p = this.programs.get(key);
    if (p) return p;
    const { gl } = this;
    const sh = (type, code) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Effect shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, shaderSource(src, mode)));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Effect shader: ${gl.getProgramInfoLog(p)}`);
    this.programs.set(key, p);
    return p;
  }

  // source: an image, video, canvas, ImageBitmap, or { data: Uint8Array RGBA top-down, width, height }.
  upload(unit, source, w, h) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[unit]);
    if (source.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  size(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  // The LUT program and the LUT's texture (made once per LUT).
  lutProgram() {
    if (this.lutProg) return this.lutProg;
    const { gl } = this;
    const sh = (type, code) => {
      const x = gl.createShader(type);
      gl.shaderSource(x, code);
      gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(`LUT shader: ${gl.getShaderInfoLog(x)}`);
      return x;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, LUT_FRAG));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`LUT shader: ${gl.getProgramInfoLog(p)}`);
    this.lutProg = p;
    return p;
  }

  lutTexture(lut) {
    this.lutTex = this.lutTex || new WeakMap();
    let t = this.lutTex.get(lut);
    if (t) return t;
    const { gl } = this;
    t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.size * lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
    this.lutTex.set(lut, t);
    return t;
  }

  draw(prog, w, h, uniforms, target = null) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, 'uA'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uB'), 1);
    gl.uniform1f(gl.getUniformLocation(prog, 'W'), w);
    gl.uniform1f(gl.getUniformLocation(prog, 'H'), h);
    gl.uniform1f(gl.getUniformLocation(prog, 'T'), uniforms.T || 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'P'), uniforms.P || 0);
    if (uniforms.lut) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexture(uniforms.lut));
      gl.uniform1i(gl.getUniformLocation(prog, 'uL'), 3);
      gl.uniform1f(gl.getUniformLocation(prog, 'N'), uniforms.lut.size);
      gl.uniform1f(gl.getUniformLocation(prog, 'K'), uniforms.K ?? 1);
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Runs effect passes [{ expr, T }] one after another on `source` (w x h); the result is in this.canvas.
  // A pass may also be { lut, K } (3D LUT) or { bloom, T } (CC-01 multi-pass bloom, resolved in
  // fx/params.js) — the bloom runs its own extract -> blur -> composite pipeline below.
  effects(source, w, h, passes) {
    const { gl } = this;
    this.size(w, h);
    this.upload(0, source, w, h);
    passes.forEach((pass, i) => {
      const last = i === passes.length - 1;
      let target = null;
      if (!last) {
        // Render into a texture, then use it as the input of the next effect.
        const k = i % 2;
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.fbTex[k]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[k]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTex[k], 0);
        target = this.fb[k];
      }
      if (pass.bloom) {
        // Intensity 0 renders unchanged: an intermediate no-op leaves the
        // source in texture unit 0 for the next pass; a final one copies it
        // to the canvas so the frame is still produced.
        if ((pass.bloom.intensity ?? 1) <= 0.001) {
          if (last) this.bloomQuad(this.bloomProgram('copy'), null, w, h, (gl2, prog) => {
            gl2.activeTexture(gl2.TEXTURE0);
            gl2.bindTexture(gl2.TEXTURE_2D, this.tex[0]);
            gl2.uniform1i(gl2.getUniformLocation(prog, 'uA'), 0);
            gl2.uniform1f(gl2.getUniformLocation(prog, 'W'), w);
            gl2.uniform1f(gl2.getUniformLocation(prog, 'H'), h);
          });
          return;
        }
        this.bloom(w, h, pass.bloom, pass.T || 0, target);
      } else if (pass.lut) this.draw(this.lutProgram(), w, h, { lut: pass.lut, K: pass.K }, target);
      else this.draw(this.program(pass.expr, 'effect'), w, h, { T: pass.T }, target);
      if (!last) {
        // The framebuffer is upside down compared with uploads, so copy it back through a canvas-free path:
        // read it and upload as the next source. PF-04: the readback reuses
        // the instance scratch buffers (no per-pass allocation).
        this.upload(0, { data: this.readPixelsFlipped(w, h) }, w, h);
      }
    });
    return this.canvas;
  }

  transition(a, b, w, h, P, src) {
    this.size(w, h);
    this.upload(0, a, w, h);
    this.upload(1, b, w, h);
    this.draw(this.program(src, 'transition'), w, h, { P });
    return this.canvas;
  }

  // True morph cut (P3-03): warp A forward along the flow field and B
  // backward along it, then crossfade. `flow` is { data: Uint8Array RGBA,
  // width, height } from morph.js flowTextureData: R/G hold the flow in frame
  // fractions, mapped from [-0.25, 0.25] to [0, 255]; the texture is LINEAR
  // filtered, so the coarse grid interpolates smoothly. Same maths as the
  // CPU reference (morph.js renderMorphCPU), nearest sampling like smp().
  morphProgram() {
    if (this.morphProg) return this.morphProg;
    const { gl } = this;
    const sh = (type, code) => {
      const x = gl.createShader(type);
      gl.shaderSource(x, code);
      gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(`Morph shader: ${gl.getShaderInfoLog(x)}`);
      return x;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, MORPH_FRAG));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Morph shader: ${gl.getProgramInfoLog(p)}`);
    this.morphProg = p;
    return p;
  }

  morph(a, b, w, h, P, flow, strength = 1) {
    const { gl } = this;
    this.size(w, h);
    this.upload(0, a, w, h);
    this.upload(1, b, w, h);
    if (!this.flowTex) {
      this.flowTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.flowTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.flowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, flow.width, flow.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, flow.data);
    const prog = this.morphProgram();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, 'uA'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uB'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'uFlow'), 2);
    gl.uniform1f(gl.getUniformLocation(prog, 'W'), w);
    gl.uniform1f(gl.getUniformLocation(prog, 'H'), h);
    gl.uniform1f(gl.getUniformLocation(prog, 'P'), P);
    gl.uniform1f(gl.getUniformLocation(prog, 'S'), strength);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  // Read the current framebuffer into the shared scratch buffers and
  // return the flipped (top-row-first) RGBA. The returned buffer is REUSED
  // by the next read — consume it synchronously, do not hold it.
  readPixelsFlipped(w, h) {
    const { gl } = this;
    const bytes = w * h * 4;
    if (!this._rb.px || this._rb.bytes < bytes) {
      this._rb.px = new Uint8Array(bytes);
      this._rb.flipped = new Uint8Array(bytes);
      this._rb.bytes = bytes;
    }
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this._rb.px);
    return flipRowsInto(this._rb.px, w, h, this._rb.flipped);
  }

  // The last result as RGBA, top row first (shared buffer — see above).
  read(w, h) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.readbackFrames++;
    this.readbackBytes += w * h * 4;
    return this.readPixelsFlipped(w, h);
  }

  // Readback accounting for profiling (PF-04): frames read back + bytes
  // moved, and the scratch allocation that serves all of them.
  readbackStats() {
    return { frames: this.readbackFrames, bytes: this.readbackBytes, scratchBytes: this._rb.bytes };
  }

  // ---- Real glow / bloom (CC-01) ----
  // The source is already in texture unit 0 (this.tex[0]); the composite
  // lands in `target` (null = this canvas). Quality: 0 = half-res only, one
  // blur pair; 1 = + quarter-res wide halo, two pairs; 2 = three pairs.
  bloomProgram(kind) {
    this.bloomProg = this.bloomProg || {};
    let p = this.bloomProg[kind];
    if (p) return p;
    const { gl } = this;
    const frag = { extract: BLOOM_EXTRACT_FRAG, blur: BLOOM_BLUR_FRAG, down: BLOOM_DOWN_FRAG, composite: BLOOM_COMPOSITE_FRAG, copy: BLOOM_COPY_FRAG }[kind];
    const sh = (type, code) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Bloom shader (${kind}): ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Bloom shader (${kind}): ${gl.getProgramInfoLog(p)}`);
    this.bloomProg[kind] = p;
    return p;
  }

  // Draw a fullscreen quad with a bloom program into `target` at vw x vh.
  bloomQuad(prog, target, vw, vh, bind) {
    const { gl } = this;
    gl.viewport(0, 0, vw, vh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.useProgram(prog);
    bind(gl, prog);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // The two ping-pong textures + framebuffers of one bloom level, at w x h
  // (LINEAR so the composite's upsample is smooth; reallocated on resize).
  bloomLevel(level, w, h) {
    this.bloomLevels = this.bloomLevels || {};
    let lv = this.bloomLevels[level];
    const { gl } = this;
    if (!lv) {
      lv = { tex: [gl.createTexture(), gl.createTexture()], fb: [gl.createFramebuffer(), gl.createFramebuffer()], w: 0, h: 0 };
      for (const t of lv.tex) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      this.bloomLevels[level] = lv;
    }
    if (lv.w !== w || lv.h !== h) {
      for (let i = 0; i < 2; i++) {
        gl.bindTexture(gl.TEXTURE_2D, lv.tex[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, lv.fb[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lv.tex[i], 0);
      }
      lv.w = w;
      lv.h = h;
    }
    return lv;
  }

  // One directional blur pass of a level; returns the index now holding it.
  bloomBlurPass(lv, src, w, h, sigma, dir) {
    const dst = 1 - src;
    this.bloomQuad(this.bloomProgram('blur'), lv.fb[dst], w, h, (gl, prog) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, lv.tex[src]);
      gl.uniform1i(gl.getUniformLocation(prog, 'uA'), 0);
      gl.uniform1f(gl.getUniformLocation(prog, 'W'), w);
      gl.uniform1f(gl.getUniformLocation(prog, 'H'), h);
      gl.uniform1f(gl.getUniformLocation(prog, 'uSigma'), sigma);
      gl.uniform1f(gl.getUniformLocation(prog, 'uDir'), dir);
    });
    return dst;
  }

  // One H+V blur pair on a level.
  bloomBlur(lv, cur, w, h, sigma) {
    cur = this.bloomBlurPass(lv, cur, w, h, sigma, 0);
    return this.bloomBlurPass(lv, cur, w, h, sigma, 1);
  }

  bloom(w, h, p, T, target) {
    const { gl } = this;
    const hw = Math.max(2, Math.floor(w / 2));
    const hh = Math.max(2, Math.floor(h / 2));
    const qw = Math.max(2, Math.floor(w / 4));
    const qh = Math.max(2, Math.floor(h / 4));
    const half = this.bloomLevel('half', hw, hh);
    const quarter = (p.quality ?? 1) >= 1 ? this.bloomLevel('quarter', qw, qh) : null;
    const sigma = 1 + (p.radius ?? 0.45) * 14;
    const iters = p.quality === 0 ? 1 : p.quality === 1 ? 2 : 3;
    const U = (prog, name) => gl.getUniformLocation(prog, name);
    // 1) Soft-knee highlight extraction at half res.
    this.bloomQuad(this.bloomProgram('extract'), half.fb[0], hw, hh, (gl2, prog) => {
      gl2.activeTexture(gl2.TEXTURE0);
      gl2.bindTexture(gl2.TEXTURE_2D, this.tex[0]);
      gl2.uniform1i(U(prog, 'uA'), 0);
      gl2.uniform1f(U(prog, 'uSW'), w);
      gl2.uniform1f(U(prog, 'uSH'), h);
      gl2.uniform1f(U(prog, 'uOW'), hw);
      gl2.uniform1f(U(prog, 'uOH'), hh);
      gl2.uniform1f(U(prog, 'uThreshold'), p.threshold ?? 0.55);
      gl2.uniform1f(U(prog, 'uSoftness'), p.softness ?? 0.35);
      gl2.uniform1f(U(prog, 'uMask'), p.mask ?? 0);
    });
    // 2) Separable blur at half res (the tight glow).
    let cur = 0;
    for (let i = 0; i < iters; i++) cur = this.bloomBlur(half, cur, hw, hh, sigma);
    // 3) Wide halo: downsample to quarter res and blur there.
    let qcur = 0;
    if (quarter) {
      this.bloomQuad(this.bloomProgram('down'), quarter.fb[0], qw, qh, (gl2, prog) => {
        gl2.activeTexture(gl2.TEXTURE0);
        gl2.bindTexture(gl2.TEXTURE_2D, half.tex[cur]);
        gl2.uniform1i(U(prog, 'uA'), 0);
        gl2.uniform1f(U(prog, 'uSW'), hw);
        gl2.uniform1f(U(prog, 'uSH'), hh);
        gl2.uniform1f(U(prog, 'uOW'), qw);
        gl2.uniform1f(U(prog, 'uOH'), qh);
      });
      for (let i = 0; i < 2; i++) qcur = this.bloomBlur(quarter, qcur, qw, qh, 1 + (p.radius ?? 0.45) * 10);
    }
    // 4) Composite: original + tight glow + wide halo, tinted, add/screen.
    const color = p.color || [1, 0.9, 0.75];
    this.bloomQuad(this.bloomProgram('composite'), target, w, h, (gl2, prog) => {
      gl2.activeTexture(gl2.TEXTURE0);
      gl2.bindTexture(gl2.TEXTURE_2D, this.tex[0]);
      gl2.activeTexture(gl2.TEXTURE1);
      gl2.bindTexture(gl2.TEXTURE_2D, half.tex[cur]);
      gl2.activeTexture(gl2.TEXTURE2);
      gl2.bindTexture(gl2.TEXTURE_2D, quarter ? quarter.tex[qcur] : half.tex[cur]);
      gl2.uniform1i(U(prog, 'uA'), 0);
      gl2.uniform1i(U(prog, 'uB'), 1);
      gl2.uniform1i(U(prog, 'uC'), 2);
      gl2.uniform1f(U(prog, 'W'), w);
      gl2.uniform1f(U(prog, 'H'), h);
      gl2.uniform1f(U(prog, 'uIntensity'), p.intensity ?? 1);
      gl2.uniform3f(U(prog, 'uColor'), color[0], color[1], color[2]);
      gl2.uniform1f(U(prog, 'uBlend'), p.blend ?? 0);
      gl2.uniform1f(U(prog, 'uQuarter'), quarter ? 1 : 0);
      gl2.uniform1f(U(prog, 'uPulse'), p.pulse ?? 0);
      gl2.uniform1f(U(prog, 'uSweep'), p.sweep ?? 0);
      gl2.uniform1f(U(prog, 'T'), T || 0);
    });
    // The composite drew at full res; the caller (effects / draw) expects it.
    gl.viewport(0, 0, w, h);
  }
}

// Flip the rows of a bottom-up RGBA frame into `out` (top row first).
// `out` must hold px.length bytes; it is returned, so callers can reuse
// one scratch buffer across frames instead of allocating per frame.
export function flipRowsInto(px, w, h, out) {
  const row = w * 4;
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

function flipRows(px, w, h) {
  return flipRowsInto(px, w, h, new Uint8Array(px.length));
}

let shared = null;
export function fxGL() {
  if (!shared) shared = new FxGL();
  return shared;
}
