import * as THREE from 'three';
import { createStage, starfield, COLORS } from './stage.js';

/**
 * Hero: the Tagora core with three orbits of Workers. Light packets travel
 * between workers and the core, standing in for calls being routed.
 */
export function initHero(canvas) {
  const { scene, camera, onTick, onResize } = createStage(canvas, {
    bloom: { strength: 1.25, radius: 0.65, threshold: 0.05 },
  });
  camera.position.set(0, 0, 13);
  scene.fog = new THREE.FogExp2(0x04050a, 0.028);

  const world = new THREE.Group();
  scene.add(world);
  const rig = new THREE.Group();
  world.add(rig);

  // core
  const coreGeo = new THREE.IcosahedronGeometry(1.5, 1);
  const shell = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0x0a1426, transparent: true, opacity: 0.85 }));
  const wire = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeo), new THREE.LineBasicMaterial({ color: COLORS.cyan }));
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 3), new THREE.MeshBasicMaterial({ color: COLORS.violet }));
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.9, 1.95, 128),
    new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  rig.add(shell, wire, inner, halo);

  // orbits of worker nodes
  const nodes = [];
  const nodeGeo = new THREE.OctahedronGeometry(0.075, 0);
  const orbitDefs = [
    { r: 3.1, tilt: 0.35, roll: 0.2, count: 16, speed: 0.16, color: COLORS.cyan },
    { r: 4.6, tilt: -0.55, roll: -0.3, count: 26, speed: -0.09, color: COLORS.violet },
    { r: 6.2, tilt: 1.15, roll: 0.4, count: 36, speed: 0.055, color: COLORS.magenta },
  ];
  for (const def of orbitDefs) {
    const orbit = new THREE.Group();
    orbit.rotation.set(def.tilt, 0, def.roll);
    rig.add(orbit);
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * def.r, 0, Math.sin(a) * def.r));
    }
    orbit.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.16 }),
      ),
    );
    const spin = new THREE.Group();
    orbit.add(spin);
    for (let i = 0; i < def.count; i++) {
      const a = (i / def.count) * Math.PI * 2 + Math.random() * 0.1;
      const m = new THREE.Mesh(nodeGeo, new THREE.MeshBasicMaterial({ color: def.color }));
      m.position.set(Math.cos(a) * def.r, 0, Math.sin(a) * def.r);
      spin.add(m);
      nodes.push(m);
    }
    def.spin = spin;
  }

  // routed calls: packets + beams between a node and the core
  const PACKETS = 28;
  const packets = [];
  const beamPos = new Float32Array(PACKETS * 6);
  const beamCol = new Float32Array(PACKETS * 6);
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPos, 3));
  beamGeo.setAttribute('color', new THREE.BufferAttribute(beamCol, 3));
  const beams = new THREE.LineSegments(
    beamGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  rig.add(beams);
  const pGeo = new THREE.SphereGeometry(0.055, 10, 10);
  const palette = [new THREE.Color(COLORS.cyan), new THREE.Color(COLORS.magenta), new THREE.Color(COLORS.lime)];
  for (let i = 0; i < PACKETS; i++) {
    const col = palette[i % palette.length];
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: col }));
    m.userData = { node: null, t: Math.random(), speed: 0.35 + Math.random() * 0.5, out: Math.random() < 0.5, col };
    rig.add(m);
    packets.push(m);
  }

  world.add(starfield(2400, 70));

  const mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX / window.innerWidth - 0.5;
    mouse.y = e.clientY / window.innerHeight - 0.5;
  });

  let scrollFade = 0;
  window.addEventListener('scroll', () => {
    scrollFade = Math.min(1, window.scrollY / window.innerHeight);
  });

  onResize((w) => {
    const wide = w > 900;
    rig.position.x = wide ? 3.6 : 0;
    rig.position.y = wide ? 0 : 1.2;
    rig.scale.setScalar(wide ? 1 : 0.72);
  });

  const tmp = new THREE.Vector3();
  const local = new THREE.Vector3();
  onTick((t, dt) => {
    for (const d of orbitDefs) d.spin.rotation.y += d.speed * dt;
    shell.rotation.set(t * 0.07, t * 0.15, 0);
    wire.rotation.copy(shell.rotation);
    inner.rotation.y = -t * 0.5;
    inner.scale.setScalar(1 + Math.sin(t * 2.2) * 0.08);
    halo.rotation.set(Math.PI / 2 + Math.sin(t * 0.4) * 0.3, t * 0.2, 0);

    packets.forEach((p, i) => {
      const u = p.userData;
      u.t += dt * u.speed;
      if (!u.node || u.t > 1) {
        u.t = 0;
        u.node = nodes[(Math.random() * nodes.length) | 0];
        u.out = Math.random() < 0.5;
      }
      u.node.getWorldPosition(tmp);
      local.copy(tmp);
      rig.worldToLocal(local);
      const k = u.out ? u.t : 1 - u.t;
      p.position.copy(local).multiplyScalar(k);
      const fade = Math.sin(u.t * Math.PI);
      beamPos.set([local.x, local.y, local.z, 0, 0, 0], i * 6);
      beamCol.set([u.col.r * fade, u.col.g * fade, u.col.b * fade, 0, 0, 0], i * 6);
    });
    beamGeo.attributes.position.needsUpdate = true;
    beamGeo.attributes.color.needsUpdate = true;

    world.rotation.y = t * 0.02;
    camera.position.x += (mouse.x * 2.2 - camera.position.x) * 0.03;
    camera.position.y += (-mouse.y * 1.6 - camera.position.y) * 0.03;
    camera.position.z = 13 + scrollFade * 5;
    camera.lookAt(0, 0, 0);
  });
}
