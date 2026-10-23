import * as THREE from 'three';
import { createStage, makeLabel, starfield, COLORS, clamp01, ease, lerp } from './stage.js';

export const STEP_COUNT = 10;

function bezier(a, b, lift, t, out) {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  mid.y += lift;
  const u = 1 - t;
  out.set(
    u * u * a.x + 2 * u * t * mid.x + t * t * b.x,
    u * u * a.y + 2 * u * t * mid.y + t * t * b.y,
    u * u * a.z + 2 * u * t * mid.z + t * t * b.z,
  );
  return out;
}

export function initEnclave(canvas) {
  const { scene, camera, onTick, onResize } = createStage(canvas, {
    bloom: { strength: 1.05, radius: 0.6, threshold: 0.06 },
  });
  scene.add(starfield(1200, 50, 0x6b7cff));

  const world = new THREE.Group();
  scene.add(world);

  const P = {
    twin: new THREE.Vector3(-3.3, -0.2, 0),
    router: new THREE.Vector3(0, 2.5, -0.5),
    enclave: new THREE.Vector3(3.7, -0.2, 0),
    chain: new THREE.Vector3(0.4, -3.1, 0.4),
  };

  // twin
  const twin = new THREE.Group();
  twin.position.copy(P.twin);
  const twinCore = new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 48), new THREE.MeshBasicMaterial({ color: COLORS.violet }));
  const twinWire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.95, 1),
    new THREE.MeshBasicMaterial({ color: COLORS.violet, wireframe: true, transparent: true, opacity: 0.35 }),
  );
  const twinHalo = new THREE.Mesh(
    new THREE.TorusGeometry(1.25, 0.025, 8, 100),
    new THREE.MeshBasicMaterial({ color: COLORS.violet, transparent: true, opacity: 0.8 }),
  );
  twin.add(twinCore, twinWire, twinHalo);
  const twinLabel = makeLabel('调用方孪生');
  twinLabel.position.set(0, -1.65, 0);
  twin.add(twinLabel);
  world.add(twin);

  // router
  const router = new THREE.Group();
  router.position.copy(P.router);
  const routerMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshBasicMaterial({ color: COLORS.cyan, wireframe: true }));
  const routerCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: COLORS.cyan }));
  router.add(routerMesh, routerCore);
  const routerLabel = makeLabel('Tagora 路由器');
  routerLabel.position.set(0, 0.85, 0);
  router.add(routerLabel);
  world.add(router);

  // enclave (glass box + core)
  const enclave = new THREE.Group();
  enclave.position.copy(P.enclave);
  const boxGeo = new THREE.BoxGeometry(2.2, 2.2, 2.2);
  const glass = new THREE.Mesh(
    boxGeo,
    new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.06, depthWrite: false }),
  );
  const glassEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeo),
    new THREE.LineBasicMaterial({ color: COLORS.cyan, transparent: true }),
  );
  const encCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), new THREE.MeshBasicMaterial({ color: COLORS.lime, wireframe: true }));
  enclave.add(glass, glassEdges, encCore);
  world.add(enclave);
  const enclaveLabel = makeLabel('一次性隔离区 · TEE');
  enclaveLabel.position.copy(P.enclave).add(new THREE.Vector3(0, -1.75, 0));
  world.add(enclaveLabel);

  // shatter fragments
  const FRAG = 260;
  const fragGeo = new THREE.TetrahedronGeometry(0.09);
  const frags = new THREE.InstancedMesh(
    fragGeo,
    new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 1 }),
    FRAG,
  );
  const fragSeed = Array.from({ length: FRAG }, () => {
    const face = (Math.random() * 6) | 0;
    const p = new THREE.Vector3((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2);
    const axis = face >> 1;
    p.setComponent(axis, (face & 1 ? 1 : -1) * 1.1);
    return {
      p: p.add(P.enclave),
      v: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.3) * 2, (Math.random() - 0.5) * 2).multiplyScalar(2.2),
      r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
    };
  });
  world.add(frags);
  const dummy = new THREE.Object3D();

  // chain
  const chain = new THREE.Group();
  chain.position.copy(P.chain);
  const blocks = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    const b = new THREE.Group();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x0b1408, transparent: true, opacity: 0.9 }));
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: COLORS.lime, transparent: true }));
    b.add(m, e);
    b.position.x = (i - 2) * 1.05;
    chain.add(b);
    blocks.push({ b, e });
    if (i > 0) {
      const link = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.43, 6),
        new THREE.MeshBasicMaterial({ color: COLORS.lime, transparent: true, opacity: 0.5 }),
      );
      link.rotation.z = Math.PI / 2;
      link.position.x = (i - 2) * 1.05 - 0.525;
      chain.add(link);
    }
  }
  const chainLabel = makeLabel('链上结算 · 只记哈希');
  chainLabel.position.set(0, -0.8, 0);
  chain.add(chainLabel);
  world.add(chain);

  // packets
  function packet(color, size = 0.16, label) {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(size, size, size);
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color })));
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(size * 1.6, 16, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    g.add(glow);
    if (label) {
      const l = makeLabel(label, { size: 34 });
      l.position.y = 0.42;
      g.add(l);
      g.userData.label = l;
    }
    g.visible = false;
    world.add(g);
    return g;
  }
  const pkt = {
    request: packet(COLORS.cyan, 0.16, '任务请求'),
    cards: packet(COLORS.cyan, 0.16, '能力卡'),
    attest: packet(COLORS.lime, 0.18, '远程证明'),
    data: packet(COLORS.magenta, 0.26, '🔒 密文数据'),
    result: packet(COLORS.magenta, 0.22, '🔒 密文结果'),
    hash1: packet(COLORS.lime, 0.12, '凭证哈希'),
    hash2: packet(COLORS.lime, 0.12),
    pay: packet(0xffd166, 0.18, '$ 支付'),
  };

  // trail line for data path
  const trailMat = new THREE.LineDashedMaterial({ color: COLORS.magenta, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0 });
  const trailPts = [];
  for (let i = 0; i <= 60; i++) trailPts.push(bezier(P.twin, P.enclave, 1.4, i / 60, new THREE.Vector3()));
  const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(trailPts), trailMat);
  trail.computeLineDistances();
  world.add(trail);

  onResize((w, h) => {
    const wide = w > 900;
    world.position.x = wide ? 4.9 : 0;
    world.position.y = wide ? 0.2 : 1.8;
    world.scale.setScalar(wide ? 0.88 : 0.6);
    camera.fov = h > w ? 62 : 45;
    camera.updateProjectionMatrix();
  });

  let progress = 0;
  const state = { step: 0 };
  const tmp = new THREE.Vector3();

  function fly(obj, from, to, lift, t) {
    obj.visible = t > 0 && t < 1;
    if (!obj.visible) return;
    bezier(from, to, lift, ease(t), tmp);
    obj.position.copy(tmp);
    obj.rotation.set(t * 6, t * 8, 0);
  }

  onTick((time) => {
    const s = progress * STEP_COUNT; // 0..10
    const step = Math.min(STEP_COUNT - 1, Math.floor(s));
    state.step = step;
    const local = (k) => clamp01((s - k) / 0.85);

    // idle motion
    twinWire.rotation.set(time * 0.3, time * 0.4, 0);
    twinHalo.rotation.set(Math.PI / 2 + Math.sin(time) * 0.2, time * 0.5, 0);
    routerMesh.rotation.y = time * 0.8;
    encCore.rotation.set(time, time * 1.3, 0);

    // 0 request, 1 cards
    fly(pkt.request, P.twin, P.router, 0.8, local(0));
    fly(pkt.cards, P.router, P.twin, 0.8, local(1));

    // 2 enclave materialises
    const appear = ease(local(2));
    // 7 shatter
    const shatter = clamp01((s - 7) / 0.9);
    const alive = appear * (shatter > 0 ? 0 : 1);
    enclave.visible = alive > 0.001;
    enclave.scale.setScalar(Math.max(0.001, appear));
    glassEdges.material.opacity = alive * (0.75 + Math.sin(time * 6) * 0.25);
    enclaveLabel.material.opacity = alive;
    enclave.rotation.y = Math.sin(time * 0.5) * 0.25;

    // 3 attestation, 4 twin verifies
    fly(pkt.attest, P.enclave, P.twin, 2.1, local(3));
    const verified = s >= 4.3;
    const verifyPulse = clamp01((s - 4) / 0.6);
    twinHalo.material.color.setHex(verified ? COLORS.lime : COLORS.violet);
    twinHalo.scale.setScalar(1 + (s > 4 && s < 5 ? Math.sin(verifyPulse * Math.PI) * 0.35 : 0));

    // 5 data, 6 result
    trailMat.opacity = s > 5 && s < 7 ? 0.7 : 0;
    fly(pkt.data, P.twin, P.enclave, 1.4, local(5));
    fly(pkt.result, P.enclave, P.twin, 1.4, local(6));
    encCore.material.color.setHex(s > 5.85 && s < 7 ? COLORS.magenta : COLORS.lime);

    // shatter fragments
    frags.visible = shatter > 0 && shatter < 1;
    if (frags.visible) {
      frags.material.opacity = 1 - shatter;
      fragSeed.forEach((f, i) => {
        dummy.position.copy(f.p).addScaledVector(f.v, ease(shatter));
        dummy.rotation.set(f.r.x * shatter, f.r.y * shatter, f.r.z * shatter);
        dummy.scale.setScalar(1 - shatter * 0.6);
        dummy.updateMatrix();
        frags.setMatrixAt(i, dummy.matrix);
      });
      frags.instanceMatrix.needsUpdate = true;
    }

    // 8 hashes to chain, newest block lights up
    const newBlock = blocks[4];
    fly(pkt.hash1, P.enclave, P.chain.clone().add(new THREE.Vector3(2.1, 0, 0)), 0.6, local(8));
    fly(pkt.hash2, P.enclave, P.chain.clone().add(new THREE.Vector3(2.1, 0, 0)), 1.2, clamp01(local(8) - 0.12));
    const blockOn = ease(clamp01((s - 8.6) / 0.4));
    newBlock.b.scale.setScalar(0.4 + blockOn * 0.6);
    newBlock.e.material.opacity = 0.25 + blockOn * 0.75;
    blocks.forEach((bl, i) => {
      if (i < 4) bl.b.rotation.y = Math.sin(time * 0.6 + i) * 0.15;
    });

    // 9 payment
    fly(pkt.pay, P.twin, P.chain.clone().add(new THREE.Vector3(2.1, 0, 0)), 1, local(9));

    camera.position.set(lerp(-1.5, 1.2, progress) + Math.sin(time * 0.2) * 0.3, 1.1, lerp(12.5, 11.5, progress));
    camera.lookAt(world.position.x * 0.45, world.position.y * 0.4, 0);
  });

  return {
    setProgress(p) {
      progress = p;
    },
    state,
  };
}
