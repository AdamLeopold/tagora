import * as THREE from 'three';
import { createStage, makeLabel, COLORS, clamp01, ease, lerp } from './stage.js';

const LAYER_COLORS = [0x3ee7ff, 0x5fb2ff, 0x8b5cf6, 0xc05cf6, 0xff4ecd, 0xb6ff3b];
const LAYER_NAMES = ['L1 静态分析', 'L2 功能测试', 'L3 边界输入', 'L4 对抗测试', 'L5 资源成本', 'L6 线上复检'];

function cardTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 640;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 640);
  grad.addColorStop(0, '#16193a');
  grad.addColorStop(1, '#07080f');
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(6, 6, 1012, 628, 48);
  g.fill();
  const bgrad = g.createLinearGradient(0, 0, 1024, 0);
  bgrad.addColorStop(0, '#3ee7ff');
  bgrad.addColorStop(0.5, '#8b5cf6');
  bgrad.addColorStop(1, '#ff4ecd');
  g.strokeStyle = bgrad;
  g.lineWidth = 8;
  g.stroke();

  g.fillStyle = '#8b5cf6';
  g.font = '600 30px "JetBrains Mono",monospace';
  g.fillText('CAPABILITY CARD', 60, 92);
  g.fillStyle = '#e8ecf5';
  g.font = '700 54px "Space Grotesk","Noto Sans SC",sans-serif';
  g.fillText('pdf-parse / example', 60, 162);
  g.fillStyle = '#8a93a8';
  g.font = '28px "JetBrains Mono",monospace';
  g.fillText('v1.4.2 · sha256:9f3c…a71e', 60, 208);

  const rows = [
    ['表格', 0.81],
    ['公式', 0.74],
    ['扫描件', 0.69],
    ['中文', 0.88],
  ];
  rows.forEach(([k, v], i) => {
    const y = 280 + i * 70;
    g.fillStyle = '#8a93a8';
    g.font = '32px "Noto Sans SC",sans-serif';
    g.fillText(k, 60, y + 12);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.roundRect(200, y - 8, 620, 22, 11);
    g.fill();
    g.fillStyle = bgrad;
    g.beginPath();
    g.roundRect(200, y - 8, 620 * v, 22, 11);
    g.fill();
    g.fillStyle = '#e8ecf5';
    g.font = '600 32px "JetBrains Mono",monospace';
    g.fillText(v.toFixed(2), 850, y + 12);
  });
  g.fillStyle = '#b6ff3b';
  g.font = '600 30px "JetBrains Mono",monospace';
  g.fillText('✓ VERIFIED · TRUSTED TIER', 60, 590);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function initVerify(canvas) {
  const { scene, camera, onTick, onResize } = createStage(canvas, {
    bloom: { strength: 0.9, radius: 0.55, threshold: 0.3 },
  });
  scene.fog = new THREE.Fog(0x04050a, 14, 34);

  const world = new THREE.Group();
  scene.add(world);

  const N = 6;
  const spacing = 2.3;
  const x0 = -((N - 1) * spacing) / 2;
  const dim = new THREE.Color(0x34456a);

  // rail
  const rail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 22, 8),
    new THREE.MeshBasicMaterial({ color: 0x2a3550 }),
  );
  rail.rotation.z = Math.PI / 2;
  world.add(rail);

  const rings = [];
  for (let i = 0; i < N; i++) {
    const x = x0 + i * spacing;
    const color = new THREE.Color(LAYER_COLORS[i]);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.03, 12, 120), new THREE.MeshBasicMaterial({ color: dim.clone() }));
    ring.rotation.y = Math.PI / 2;
    ring.position.x = x;
    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(1.8, 0.008, 6, 120, Math.PI * 1.3),
      new THREE.MeshBasicMaterial({ color: dim.clone(), transparent: true, opacity: 0.6 }),
    );
    outer.rotation.y = Math.PI / 2;
    outer.position.x = x;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.52, 64),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    disc.rotation.y = Math.PI / 2;
    disc.position.x = x;
    // ticks around the ring
    const ticks = new THREE.Group();
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), new THREE.MeshBasicMaterial({ color: dim.clone() }));
      tick.position.set(0, Math.cos(a) * 1.72, Math.sin(a) * 1.72);
      tick.rotation.x = -a;
      ticks.add(tick);
    }
    ticks.position.x = x;
    const label = makeLabel(LAYER_NAMES[i], { size: 40, color: '#aab4ca', bg: 'rgba(8,10,20,0.85)' });
    label.position.set(x, 2.45, 0);
    label.material.opacity = 0.35;
    world.add(ring, outer, disc, ticks, label);
    rings.push({ x, ring, outer, disc, ticks, label, color });
  }

  // the tool under test
  const cubeGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const cube = new THREE.Group();
  const body = new THREE.Mesh(cubeGeo, new THREE.MeshBasicMaterial({ color: 0x0a0f1d, transparent: true, opacity: 0.92 }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cubeGeo), new THREE.LineBasicMaterial({ color: 0xffd166 }));
  const coreDot = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  cube.add(body, edges, coreDot);
  world.add(cube);

  const tag = makeLabel('README: SOTA · 99% · blazing fast', { size: 34, color: '#ffd166', border: 'rgba(255,209,102,.4)' });
  world.add(tag);

  // resulting card
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2),
    new THREE.MeshBasicMaterial({ map: cardTexture(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  world.add(card);

  // scan sparks
  const SPARKS = 220;
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkSeed = Array.from({ length: SPARKS }, () => ({
    a: Math.random() * Math.PI * 2,
    r: 0.3 + Math.random() * 1.3,
    s: 0.5 + Math.random(),
  }));
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.05,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  world.add(new THREE.Points(sparkGeo, sparkMat));

  const grid = new THREE.GridHelper(60, 60, 0x1a2540, 0x0c1222);
  grid.position.y = -2.2;
  world.add(grid);

  onResize((w, h) => {
    const wide = w > 900;
    world.position.x = wide ? 4.4 : 0;
    world.scale.setScalar(wide ? 0.8 : 0.55);
    world.position.y = wide ? -0.3 : 1.4;
    camera.fov = h > w ? 60 : 45;
    camera.updateProjectionMatrix();
  });

  let progress = 0;
  let layer = -1;
  const state = { layer: -1, done: false };

  onTick((t) => {
    const p = progress;
    const travel = ease(clamp01(p / 0.82));
    const x = lerp(-9.5, x0 + (N - 1) * spacing + 2.2, travel);
    const c = ease(clamp01((p - 0.82) / 0.14));

    // find the active layer
    layer = -1;
    let near = 0;
    let nearIdx = -1;
    rings.forEach((r, i) => {
      if (x > r.x) layer = i;
      const n = Math.max(0, 1 - Math.abs(x - r.x) / 1.1);
      if (n > near) {
        near = n;
        nearIdx = i;
      }
      const lit = x > r.x ? 1 : n;
      r.ring.material.color.copy(dim).lerp(r.color, lit);
      r.outer.material.color.copy(dim).lerp(r.color, lit);
      r.ticks.children.forEach((tk) => tk.material.color.copy(dim).lerp(r.color, lit));
      r.disc.material.opacity = n * 0.38;
      r.outer.rotation.x = t * (i % 2 ? 0.6 : -0.6);
      r.ticks.rotation.x = -t * 0.25;
      r.label.material.opacity = 0.3 + lit * 0.7;
    });
    state.layer = layer;
    state.done = c > 0.5;

    // tool cube
    cube.position.set(lerp(x, 2.6, c), lerp(0, 0.35, c), lerp(0, 3, c));
    const spin = 1 - c;
    cube.rotation.set(t * 0.7 * spin, t * 0.9 * spin, 0);
    cube.scale.setScalar(1 - c * 0.9);
    const edgeColor = layer >= 0 ? rings[layer].color : new THREE.Color(0xffd166);
    edges.material.color.copy(edgeColor);
    coreDot.material.color.copy(edgeColor);
    coreDot.rotation.y = t * 2;

    // README tag dissolves as the cube enters the first ring
    tag.position.set(x, 1.25, 0);
    tag.material.opacity = clamp01(1 - (x - (x0 - 1.4)) / 1.2);

    // sparks at the active ring
    if (nearIdx >= 0) {
      const rx = rings[nearIdx].x;
      sparkSeed.forEach((s, i) => {
        const a = s.a + t * s.s * 2;
        sparkPos[i * 3] = rx + Math.sin(t * 7 + i) * 0.08;
        sparkPos[i * 3 + 1] = Math.cos(a) * s.r;
        sparkPos[i * 3 + 2] = Math.sin(a) * s.r;
      });
      sparkGeo.attributes.position.needsUpdate = true;
      sparkMat.color.copy(rings[nearIdx].color);
    }
    sparkMat.opacity = near * 0.9;

    // card reveal
    card.position.set(2.6, lerp(-0.2, 0.35, c), lerp(1, 3, c));
    card.rotation.set(-0.06, lerp(-1.4, -0.5, c) + Math.sin(t * 0.8) * 0.05 * c, 0);
    card.material.opacity = c;
    card.scale.setScalar(lerp(0.3, 1.45, c));

    world.rotation.y = 0.36 - p * 0.1;
    camera.position.set(lerp(-1, 1, p), lerp(3.4, 2.6, p), 14);
    camera.lookAt(world.position.x * 0.45, 0, 0);
  });

  return {
    setProgress(p) {
      progress = p;
    },
    state,
  };
}
