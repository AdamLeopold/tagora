import * as THREE from 'three';
import { createStage, COLORS, clamp01, lerp } from './stage.js';

/**
 * 1,000 Workers on a grid. As the section scrolls, a task fans out from the
 * centre and wakes them up in a wave; trusted-tier workers glow cyan,
 * open-tier workers magenta.
 */
export function initSwarm(canvas) {
  const { scene, camera, onTick, onResize } = createStage(canvas, {
    bloom: { strength: 0.75, radius: 0.45, threshold: 0.32 },
  });
  scene.fog = new THREE.Fog(0x04050a, 12, 34);

  const COLS = 40;
  const ROWS = 25;
  const COUNT = COLS * ROWS;
  const GAP = 0.42;

  const world = new THREE.Group();
  scene.add(world);

  const geo = new THREE.BoxGeometry(0.26, 1, 0.26);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  world.add(mesh);

  const cells = [];
  let maxD = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = (c - (COLS - 1) / 2) * GAP;
      const z = (r - (ROWS - 1) / 2) * GAP;
      const d = Math.hypot(x, z * 1.2) + Math.random() * 0.6;
      maxD = Math.max(maxD, d);
      cells.push({ x, z, d, trusted: Math.random() < 0.55, phase: Math.random() * Math.PI * 2 });
    }
  }
  cells.forEach((cell) => (cell.d /= maxD));
  const activeOrder = cells.map((c) => c.d).sort((a, b) => a - b);

  // the task beacon
  const beacon = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 2), new THREE.MeshBasicMaterial({ color: COLORS.violet }));
  const orbWire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.75, 1),
    new THREE.MeshBasicMaterial({ color: COLORS.cyan, wireframe: true, transparent: true, opacity: 0.5 }),
  );
  beacon.add(orb, orbWire);
  beacon.position.y = 3.2;
  world.add(beacon);

  // expanding shockwave ring on the floor
  const wave = new THREE.Mesh(
    new THREE.RingGeometry(0.98, 1, 128),
    new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  );
  wave.rotation.x = -Math.PI / 2;
  wave.position.y = 0.01;
  world.add(wave);

  // beams from beacon to a sample of active workers
  const BEAMS = 80;
  const beamPos = new Float32Array(BEAMS * 6);
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPos, 3));
  const beams = new THREE.LineSegments(
    beamGeo,
    new THREE.LineBasicMaterial({ color: COLORS.violet, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  world.add(beams);
  const beamTargets = Array.from({ length: BEAMS }, () => (Math.random() * COUNT) | 0);

  onResize((w, h) => {
    const wide = w > 900;
    world.position.x = wide ? 3.2 : 0;
    world.scale.setScalar(wide ? 1 : 0.7);
    camera.fov = h > w ? 70 : 45;
    camera.updateProjectionMatrix();
  });

  const dummy = new THREE.Object3D();
  const cTrusted = new THREE.Color(COLORS.cyan).multiplyScalar(0.62);
  const cOpen = new THREE.Color(COLORS.magenta).multiplyScalar(0.62);
  const cIdle = new THREE.Color(0x1a2236);
  const col = new THREE.Color();

  let progress = 0;
  const state = { active: 1 };

  onTick((t) => {
    const reach = clamp01(progress * 1.15);
    let active = 0;
    cells.forEach((cell, i) => {
      const on = cell.d <= reach;
      const edge = clamp01((reach - cell.d) * 12);
      if (on) active++;
      const h = on ? 0.1 + edge * (0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3 + cell.phase))) : 0.05;
      dummy.position.set(cell.x, 0, cell.z);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.copy(cIdle).lerp(cell.trusted ? cTrusted : cOpen, edge * (0.75 + 0.25 * Math.sin(t * 4 + cell.phase)));
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    state.active = Math.max(1, Math.min(COUNT, active));

    const radius = reach * maxD;
    wave.scale.setScalar(Math.max(0.01, radius));
    wave.material.opacity = reach > 0 && reach < 1 ? 0.4 : 0;

    beamTargets.forEach((idx, k) => {
      const cell = cells[idx];
      const on = cell.d <= reach;
      beamPos.set(on ? [0, 3.2, 0, cell.x, 0.4, cell.z] : [0, 3.2, 0, 0, 3.2, 0], k * 6);
    });
    beamGeo.attributes.position.needsUpdate = true;

    orb.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    orbWire.rotation.set(t * 0.4, t * 0.6, 0);
    beacon.position.y = 3.2 + Math.sin(t * 1.2) * 0.15;

    world.rotation.y = lerp(-0.5, 0.35, progress) + Math.sin(t * 0.15) * 0.05;
    camera.position.set(0, lerp(12, 9.5, progress), lerp(16, 14, progress));
    camera.lookAt(world.position.x * 0.5, 0.5, 0);
  });

  // keep sorted thresholds around for a smooth counter
  state.countAt = (p) => {
    const reach = clamp01(p * 1.15);
    let lo = 0;
    let hi = activeOrder.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (activeOrder[mid] <= reach) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(1, lo);
  };

  return {
    setProgress(p) {
      progress = p;
    },
    state,
  };
}
