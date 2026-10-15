// Post-processing: the scene is rendered into an HDR (half-float, multisampled) target, then
//   bloom      dual-filter downsample/upsample chain of everything above a soft threshold
//   composite  exposure, ACES filmic tone mapping, contrast/saturation grade, vignette,
//              speed-dependent chromatic fringe at the screen edges, fine film grain, sRGB encode
// No external post-processing library: a handful of small shaders and render targets.
import * as THREE from 'three';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const PREFILTER = `uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold; uniform float knee; varying vec2 vUv;
  vec3 tap(vec2 o){ return texture2D(tSrc, vUv + o * texel).rgb; }
  void main(){
    vec3 c = (tap(vec2(-1.0,-1.0)) + tap(vec2(1.0,-1.0)) + tap(vec2(-1.0,1.0)) + tap(vec2(1.0,1.0))) * 0.25;
    c = min(c, vec3(60.0)); // tame fireflies
    if (any(isnan(c))) c = vec3(0.0);
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float contrib = max(soft, br - threshold) / max(br, 1e-4);
    gl_FragColor = vec4(c * contrib, 1.0);
  }`;

// dual Kawase filters
const DOWN = `uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
  void main(){
    vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
    s += texture2D(tSrc, vUv + vec2(-1.0,-1.0) * texel).rgb;
    s += texture2D(tSrc, vUv + vec2( 1.0,-1.0) * texel).rgb;
    s += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * texel).rgb;
    s += texture2D(tSrc, vUv + vec2( 1.0, 1.0) * texel).rgb;
    gl_FragColor = vec4(s / 8.0, 1.0);
  }`;
const UP = `uniform sampler2D tSrc; uniform vec2 texel; uniform float weight; varying vec2 vUv;
  void main(){
    vec3 s = vec3(0.0);
    s += texture2D(tSrc, vUv + vec2(-2.0, 0.0) * texel).rgb;
    s += texture2D(tSrc, vUv + vec2( 2.0, 0.0) * texel).rgb;
    s += texture2D(tSrc, vUv + vec2( 0.0,-2.0) * texel).rgb;
    s += texture2D(tSrc, vUv + vec2( 0.0, 2.0) * texel).rgb;
    s += texture2D(tSrc, vUv + vec2(-1.0,-1.0) * texel).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2( 1.0,-1.0) * texel).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * texel).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2( 1.0, 1.0) * texel).rgb * 2.0;
    gl_FragColor = vec4(s / 12.0 * weight, 1.0);
  }`;

const COMPOSITE = `uniform sampler2D tScene; uniform sampler2D tBloom; uniform float bloom; uniform float exposure;
  uniform float contrast; uniform float saturation; uniform float vignette; uniform float grain; uniform float time;
  uniform float fringe; uniform vec3 lift; uniform vec3 gain; varying vec2 vUv;
  vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
  vec3 aces(vec3 c){
    const mat3 inM = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));
    const mat3 outM = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));
    c *= 1.0 / 0.6; c = inM * c; c = RRTAndODTFit(c); c = outM * c; return clamp(c, 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 37.0) * 43758.5453); }
  void main(){
    vec2 d = vUv - 0.5;
    float r2 = dot(d, d);
    vec3 col;
    if (fringe > 0.0005) {
      vec2 o = d * r2 * fringe;
      col = vec3(texture2D(tScene, vUv - o).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv + o).b);
    } else col = texture2D(tScene, vUv).rgb;
    vec3 bl = texture2D(tBloom, vUv).rgb;
    if (any(isnan(bl))) bl = vec3(0.0);
    col += bl * bloom;
    col = aces(col * exposure);
    // grade in display-ish space
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, saturation);
    col = (col - 0.5) * contrast + 0.5;
    col = col * gain + lift * (1.0 - col);
    col *= mix(1.0, smoothstep(0.85, 0.2, r2 * 2.2), vignette);
    col = toSRGB(clamp(col, 0.0, 1.0));
    col += (hash(vUv * 731.0) - 0.5) * grain;
    gl_FragColor = vec4(col, 1.0);
  }`;

export class PostFX {
  constructor(renderer) {
    this.r = renderer;
    this.levels = 6;
    const hdr = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace };
    this.rt = new THREE.WebGLRenderTarget(4, 4, { ...hdr, samples: 4, depthBuffer: true });
    this.mips = [];
    for (let i = 0; i < this.levels; i++) this.mips.push(new THREE.WebGLRenderTarget(4, 4, { ...hdr, depthBuffer: false }));
    const mat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
    this.prefilter = mat(PREFILTER, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1.0 }, knee: { value: 0.5 } });
    this.down = mat(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.up = mat(UP, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, weight: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.composite = mat(COMPOSITE, {
      tScene: { value: this.rt.texture }, tBloom: { value: this.mips[0].texture }, bloom: { value: 0.6 }, exposure: { value: 1.0 },
      contrast: { value: 1.06 }, saturation: { value: 1.12 }, vignette: { value: 0.45 }, grain: { value: 0.025 }, time: { value: 0 },
      fringe: { value: 0 }, lift: { value: new THREE.Vector3(0.0, 0.004, 0.012) }, gain: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene(); this.qscene.add(this.quad);
    this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.w = 0; this.h = 0;
    this.time = 0;
    this.speed = 0;
  }

  setSize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.rt.setSize(w, h);
    let mw = Math.max(1, w >> 1), mh = Math.max(1, h >> 1);
    for (const m of this.mips) { m.setSize(mw, mh); mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); }
  }

  pass(material, target) {
    this.quad.material = material;
    this.r.setRenderTarget(target);
    this.r.render(this.qscene, this.qcam);
  }

  // look: {bloom, threshold, exposure, saturation, contrast, vignette, grain, fringe}
  render(scene, camera, dt, look = {}) {
    const r = this.r;
    const size = r.getDrawingBufferSize(_size);
    this.setSize(size.x, size.y);
    this.time = (this.time + dt) % 1000;
    const prevAuto = r.autoClear;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.autoClear = true;
    // bloom chain
    const p = this.prefilter.uniforms;
    p.tSrc.value = this.rt.texture; p.texel.value.set(1 / this.w, 1 / this.h);
    p.threshold.value = look.threshold ?? 1.0; p.knee.value = (look.threshold ?? 1.0) * 0.5;
    this.pass(this.prefilter, this.mips[0]);
    for (let i = 1; i < this.levels; i++) {
      const src = this.mips[i - 1];
      this.down.uniforms.tSrc.value = src.texture; this.down.uniforms.texel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.down, this.mips[i]);
    }
    r.autoClear = false;
    for (let i = this.levels - 1; i > 0; i--) {
      const src = this.mips[i];
      this.up.uniforms.tSrc.value = src.texture; this.up.uniforms.texel.value.set(0.5 / src.width, 0.5 / src.height);
      this.up.uniforms.weight.value = 1.0;
      this.pass(this.up, this.mips[i - 1]);
    }
    r.autoClear = true;
    // composite to screen
    const c = this.composite.uniforms;
    c.bloom.value = (look.bloom ?? 0.6) / this.levels * 2.2;
    c.exposure.value = look.exposure ?? 1.0;
    c.saturation.value = look.saturation ?? 1.12;
    c.contrast.value = look.contrast ?? 1.06;
    c.vignette.value = look.vignette ?? 0.32;
    c.grain.value = look.grain ?? 0.025;
    c.fringe.value = look.fringe ?? 0;
    c.time.value = this.time;
    this.pass(this.composite, null);
    r.autoClear = prevAuto;
  }

  dispose() {
    this.rt.dispose(); for (const m of this.mips) m.dispose();
    for (const m of [this.prefilter, this.down, this.up, this.composite]) m.dispose();
    this.quad.geometry.dispose();
  }
}
const _size = new THREE.Vector2();
