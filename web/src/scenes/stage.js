import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const BG = 0x04050a;
export const COLORS = {
  cyan: 0x3ee7ff,
  violet: 0x8b5cf6,
  magenta: 0xff4ecd,
  lime: 0xb6ff3b,
  dim: 0x1d2638,
  white: 0xffffff,
};

/**
 * A canvas-bound renderer that only draws while visible on screen.
 * Every scene in the page is built on top of this.
 */
export function createStage(canvas, { bloom, fov = 45 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(BG, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 200);

  let composer = null;
  if (bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(256, 256), bloom.strength ?? 1, bloom.radius ?? 0.5, bloom.threshold ?? 0),
    );
    composer.addPass(new OutputPass());
  }

  const resizeHooks = [];
  const size = { w: 1, h: 1 };
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    size.w = w;
    size.h = h;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    resizeHooks.forEach((f) => f(w, h));
  }
  new ResizeObserver(resize).observe(canvas);

  let visible = false;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '120px' }).observe(canvas);

  const ticks = [];
  const t0 = performance.now();
  let last = 0;
  renderer.setAnimationLoop(() => {
    const t = (performance.now() - t0) / 1000;
    const dt = Math.min(t - last, 0.05);
    last = t;
    if (!visible) return;
    ticks.forEach((f) => f(t, dt));
    if (!composer) {
      renderer.render(scene, camera);
      return;
    }
    // Labels are drawn in a second pass so bloom never smears their text.
    const labels = [];
    scene.traverse((o) => {
      if (o.userData.noBloom && o.visible) labels.push(o);
    });
    labels.forEach((o) => (o.visible = false));
    composer.render();
    if (!labels.length) return;
    const hidden = [];
    scene.traverse((o) => {
      if ((o.isMesh || o.isLine || o.isPoints || o.isSprite) && o.visible && !o.userData.noBloom) {
        hidden.push(o);
        o.visible = false;
      }
    });
    labels.forEach((o) => (o.visible = true));
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = true;
    hidden.forEach((o) => (o.visible = true));
  });

  resize();
  return {
    renderer,
    scene,
    camera,
    size,
    onTick: (f) => ticks.push(f),
    onResize: (f) => {
      resizeHooks.push(f);
      resize();
    },
  };
}

/** A text label rendered to a canvas texture, always facing the camera. */
export function makeLabel(text, { color = '#e8ecf5', size = 44, bg = 'rgba(8,10,20,0.75)', border = 'rgba(255,255,255,0.18)' } = {}) {
  const pad = 22;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `700 ${size}px "Space Grotesk","Noto Sans SC",sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = size + pad * 1.4;
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.strokeStyle = border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(1.5, 1.5, w - 3, h - 3, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.userData.noBloom = true;
  const scale = 0.0085;
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

export function starfield(count = 2000, radius = 60, color = 0x8fa3ff) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = radius * (0.35 + Math.random() * 0.65);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
}

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const lerp = (a, b, t) => a + (b - a) * t;
