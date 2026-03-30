/**
 * Celozaslonska soseska: nebo, sonce, hiše · brez kartic.
 */

/* global THREE */

const LABELS = {
  h1: "Hiša 1",
  h2: "Hiša 2",
};

let state = { sunPct: 70, hour: 12, loadMul: { h1: 1, h2: 1 } };

/** Model (1 h): kW ≡ kWh/h — skladno z izvirnim opisom tokov. */
const HOUSES_SPEC = [
  { id: "h1", pvRated: 4.2, baseLoad: 3.8 },
  { id: "h2", pvRated: 6.5, baseLoad: 2.4 },
];

const EUR_IMPORT = 0.18;
const EUR_EXPORT = 0.07;
const CO2_KG_KWH = 0.35;

/** Dnevni faktor PV: 6–20 h, vrh okoli poldneva. */
function daytimeFactor(hour) {
  const u = THREE.MathUtils.clamp((hour - 6) / 14, 0, 1);
  return 0.06 + 0.94 * Math.sin(u * Math.PI);
}

function gridMoneyEurPerH(importKwh, exportKwh) {
  return importKwh * EUR_IMPORT - exportKwh * EUR_EXPORT;
}

function gridCo2KgPerH(importKwh, exportKwh) {
  return importKwh * CO2_KG_KWH - exportKwh * CO2_KG_KWH * 0.12;
}

function simulate(st) {
  const weather = st.sunPct / 100;
  const day = daytimeFactor(st.hour ?? 12);
  const houses = HOUSES_SPEC.map((h) => {
    const mul = st.loadMul[h.id] ?? 1;
    const load = h.baseLoad * mul;
    const pv = h.pvRated * weather * day;
    return { pv, load, net: pv - load };
  });
  const excess = houses.map((h) => Math.max(0, h.net));
  const deficit = houses.map((h) => Math.max(0, -h.net));
  const sumE = excess.reduce((a, b) => a + b, 0);
  const sumD = deficit.reduce((a, b) => a + b, 0);
  const transfer = Math.min(sumE, sumD);
  const flows = [];
  if (transfer > 0.001 && sumE > 0 && sumD > 0) {
    for (let i = 0; i < houses.length; i++) {
      for (let j = 0; j < houses.length; j++) {
        if (i === j) continue;
        const kw = transfer * (excess[i] / sumE) * (deficit[j] / sumD);
        if (kw > 0.02) flows.push({ from: i, to: j, kw });
      }
    }
  }
  const totalNet = houses.reduce((a, h) => a + h.net, 0);
  let gridImport = 0;
  let gridExport = 0;
  if (totalNet > 0) gridExport = totalNet;
  else gridImport = -totalNet;
  const shareSum = flows.reduce((a, f) => a + f.kw, 0);
  const totalPv = houses.reduce((a, h) => a + h.pv, 0);
  return { houses, flows, gridImport, gridExport, shareSum, totalPv };
}

function makeRenderer(container, w, h) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  return renderer;
}

function createSkySphere(scene) {
  const uniforms = {
    topColor: { value: new THREE.Color(0x6ba8e8) },
    horizonColor: { value: new THREE.Color(0xd4e8f5) },
  };
  const skyGeo = new THREE.SphereGeometry(120, 32, 24);
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vWorldPosition;
      void main() {
        vec3 n = normalize(vWorldPosition);
        float t = clamp(n.y * 0.55 + 0.45, 0.0, 1.0);
        t = pow(t, 0.85);
        gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  skyMat.fog = false;
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -100;
  scene.add(sky);
  return uniforms;
}

function buildHouseGroup(wallColor, roofColor) {
  const group = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(1.12, 0.78, 0.92),
    new THREE.MeshLambertMaterial({ color: wallColor })
  );
  wall.position.y = 0.39;
  group.add(wall);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 0.4, 4),
    new THREE.MeshLambertMaterial({ color: roofColor })
  );
  roof.position.y = 0.78 + 0.2;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);
  const win = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.26),
    new THREE.MeshLambertMaterial({
      color: 0x1e2832,
      emissive: new THREE.Color(0x000000),
    })
  );
  win.position.set(0, 0.42, 0.47);
  group.add(win);
  return { group, win };
}

function addGroundRing(parent) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.88, 1.32, 40),
    new THREE.MeshBasicMaterial({
      color: 0x9ee8c0,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.renderOrder = -2;
  parent.add(ring);
  return ring;
}

/** mul: 0.4–1.6 → glow levo (nizko) / desno (visoko) */
function applyHouseGlow(mul, win, ring, pointLight, sunFactor) {
  const t = THREE.MathUtils.clamp((mul - 0.4) / 1.2, 0, 1);
  const warm = new THREE.Color(0xffaa66);
  win.material.emissive.copy(warm).multiplyScalar(t * 1.15 * (0.4 + 0.6 * sunFactor));
  win.material.color.setHSL(0.08, 0.35 + 0.3 * t, 0.12 + 0.38 * t);
  ring.material.opacity = 0.08 + 0.52 * t;
  pointLight.intensity = t * 3.2 * (0.5 + 0.5 * sunFactor);
}

function darkenHouseGroup(group, factor) {
  group.traverse((o) => {
    if (o.isMesh && o.material) {
      const m = o.material.clone();
      if (m.color) m.color.multiplyScalar(factor);
      o.material = m;
    }
  });
}

/** Sonce: krog, haloja, korona (torus), izsevki (palčke) */
function createSun3D() {
  const group = new THREE.Group();
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 40, 40),
    new THREE.MeshBasicMaterial({ color: 0xfff2cc })
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.95, 28, 28),
    new THREE.MeshBasicMaterial({ color: 0xffcc77, transparent: true, opacity: 0.32 })
  );
  const haloOuter = new THREE.Mesh(
    new THREE.SphereGeometry(3.0, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, opacity: 0.06 })
  );
  const corona = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.075, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0xffdd99, transparent: true, opacity: 0.42 })
  );
  corona.rotation.x = Math.PI / 2;

  const raysGroup = new THREE.Group();
  const rayLen = 3.4;
  const rayTh = 0.15;
  const n = 18;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(rayTh, rayTh, rayLen),
      new THREE.MeshBasicMaterial({
        color: 0xffe8b0,
        transparent: true,
        opacity: 0.88,
      })
    );
    const outward = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const center = outward.clone().multiplyScalar(1.05 + rayLen / 2);
    bar.position.copy(center);
    bar.lookAt(center.clone().add(outward));
    raysGroup.add(bar);
  }

  group.add(sunMesh);
  group.add(halo);
  group.add(haloOuter);
  group.add(corona);
  group.add(raysGroup);

  return { group, sunMesh, halo, haloOuter, corona, raysGroup };
}

/** @type {{ update: Function, resize: Function } | null} */
let neighborhood = null;

function initNeighborhoodScene(container) {
  if (typeof THREE === "undefined") return null;

  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc8dde8, 28, 95);

  const skyUniforms = createSkySphere(scene);

  const camera = new THREE.PerspectiveCamera(44, w / Math.max(h, 1), 0.1, 200);
  camera.position.set(0, 3.95, 10.1);
  camera.lookAt(0, 0.55, 1.0);

  const renderer = makeRenderer(container, w, h);
  renderer.setClearColor(0xc8dde8, 1);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshLambertMaterial({ color: 0x4d6b52 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  const sunParts = createSun3D();
  const sunGroup = sunParts.group;
  const sunMesh = sunParts.sunMesh;
  const halo = sunParts.halo;
  const haloOuter = sunParts.haloOuter;
  const sunCorona = sunParts.corona;
  const sunRays = sunParts.raysGroup;
  scene.add(sunGroup);

  const sunLight = new THREE.DirectionalLight(0xfff5e6, 0.62);
  sunLight.position.copy(sunGroup.position);
  scene.add(sunLight);

  const hemi = new THREE.HemisphereLight(0xb8d8f0, 0x3d4a3a, 0.42);
  scene.add(hemi);

  const mainScale = 1.72;
  const mx = 1.55;
  const mz = 1.15;

  const m1 = buildHouseGroup(0xe2edf5, 0x95a8b8);
  m1.group.position.set(-mx, 0, mz);
  m1.group.scale.setScalar(mainScale);
  m1.ring = addGroundRing(m1.group);
  scene.add(m1.group);

  const m2 = buildHouseGroup(0xd8e6f0, 0x8fa0b0);
  m2.group.position.set(mx, 0, mz);
  m2.group.scale.setScalar(mainScale);
  m2.ring = addGroundRing(m2.group);
  scene.add(m2.group);

  const glowPt1 = new THREE.PointLight(0xffddaa, 0, 12);
  glowPt1.position.set(-mx, 1.05, mz + 0.65);
  scene.add(glowPt1);

  const glowPt2 = new THREE.PointLight(0xffddaa, 0, 12);
  glowPt2.position.set(mx, 1.05, mz + 0.65);
  scene.add(glowPt2);

  const spot1 = new THREE.SpotLight(0xfff8ee, 0.52, 26, Math.PI / 4.5, 0.45, 1);
  spot1.position.set(-mx, 6.8, 4.5);
  const t1 = new THREE.Object3D();
  t1.position.set(-mx, 0.55, mz);
  scene.add(t1);
  spot1.target = t1;
  scene.add(spot1);

  const spot2 = new THREE.SpotLight(0xfff8ee, 0.52, 26, Math.PI / 4.5, 0.45, 1);
  spot2.position.set(mx, 6.8, 4.5);
  const t2 = new THREE.Object3D();
  t2.position.set(mx, 0.55, mz);
  scene.add(t2);
  spot2.target = t2;
  scene.add(spot2);

  const wallWhite = 0xffffff;
  const roofWhite = 0xeeeeee;

  function placeBackgroundHouses() {
    const count = 26;
    const minDist = 4.8;
    const maxDist = 28;
    const placed = [];
    let tries = 0;
    const maxTries = 900;

    function tooClose(x, z) {
      if (Math.abs(x) < 4.2 && z > -2 && z < 4.8) return true;
      if (Math.hypot(x + mx, z - mz) < 4.0) return true;
      if (Math.hypot(x - mx, z - mz) < 4.0) return true;
      for (const p of placed) {
        if (Math.hypot(x - p.x, z - p.z) < 2.0) return true;
      }
      return false;
    }

    while (placed.length < count && tries < maxTries) {
      tries++;
      const ang = Math.random() * Math.PI * 2;
      const r = minDist + Math.random() * (maxDist - minDist);
      const x = Math.cos(ang) * r + (Math.random() - 0.5) * 2.8;
      const z = Math.sin(ang) * r * 0.92 + (Math.random() - 0.5) * 3.2 - 0.5;
      if (tooClose(x, z)) continue;
      placed.push({
        x,
        z,
        ry: Math.random() * Math.PI * 2,
        sc: 0.92 + Math.random() * 0.42,
      });
    }

    placed.forEach(({ x, z, ry, sc }) => {
      const { group } = buildHouseGroup(wallWhite, roofWhite);
      group.position.set(x, 0, z);
      group.rotation.y = ry;
      group.scale.setScalar(sc);
      scene.add(group);
    });
  }

  placeBackgroundHouses();

  const flowGroup = new THREE.Group();
  scene.add(flowGroup);

  const particleGroup = new THREE.Group();
  flowGroup.add(particleGroup);

  const pH1 = new THREE.Vector3(-mx, 1.38, mz + 0.22);
  const pH2 = new THREE.Vector3(mx, 1.38, mz + 0.22);
  const pMid = new THREE.Vector3(0, 0.95, mz + 0.38);
  /** Priključek na omrežje: tla med hišama, spodaj v kadru (proti kamere). */
  const pGridBottom = new THREE.Vector3(0, 0.08, mz + 2.85);

  const flowDyn = {
    sun1: { curve: null, show: false, str: 0 },
    sun2: { curve: null, show: false, str: 0 },
    share: { curve: null, show: false, str: 0 },
    grid: { curve: null, show: false, str: 0 },
  };

  function getCurve(p0, p1, liftY) {
    const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    mid.y += liftY;
    return new THREE.QuadraticBezierCurve3(p0, mid, p1);
  }

  function makeFlowLine(hex) {
    const g = new THREE.BufferGeometry();
    const m = new THREE.LineBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
    });
    const line = new THREE.Line(g, m);
    flowGroup.add(line);
    return line;
  }

  function setBezier3(line, p0, p1, liftY) {
    const curve = getCurve(p0, p1, liftY);
    line.geometry.setFromPoints(curve.getPoints(40));
    return curve;
  }

  function makeParticleStrip(hex, n, size = 0.15, baseOpacity = 0.75) {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({
      color: hex,
      size,
      transparent: true,
      opacity: baseOpacity,
      depthTest: true,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    particleGroup.add(pts);
    return { pts, arr, n };
  }

  const PT_N = 52;
  const partSun1 = makeParticleStrip(0x66ffaa, PT_N);
  const partSun2 = makeParticleStrip(0x66ffcc, PT_N);
  const partShare = makeParticleStrip(0x88ccff, PT_N);
  // Uvoz/izvoz "heartbeat": increase size + density for better visibility.
  const partGrid = makeParticleStrip(0xffccaa, PT_N + 22, 0.22, 0.9);

  const lineSun1 = makeFlowLine(0x55ee99);
  const lineSun2 = makeFlowLine(0x55ee99);
  const lineShare = makeFlowLine(0x66aaee);
  const lineGrid = makeFlowLine(0xddccff);

  function updateFlowLines(sim) {
    const pSun = new THREE.Vector3();
    sunGroup.getWorldPosition(pSun);

    const maxPv = Math.max(sim.houses[0].pv, sim.houses[1].pv, 0.01);
    const pv1 = sim.houses[0].pv;
    const pv2 = sim.houses[1].pv;

    flowDyn.sun1.curve = setBezier3(lineSun1, pSun, pH1, 1.45);
    lineSun1.visible = pv1 > 0.04;
    lineSun1.material.opacity = 0.18 + 0.55 * (pv1 / maxPv);
    flowDyn.sun1.show = lineSun1.visible;
    flowDyn.sun1.str = pv1 / maxPv;

    flowDyn.sun2.curve = setBezier3(lineSun2, pSun, pH2, 1.45);
    lineSun2.visible = pv2 > 0.04;
    lineSun2.material.opacity = 0.18 + 0.55 * (pv2 / maxPv);
    flowDyn.sun2.show = lineSun2.visible;
    flowDyn.sun2.str = pv2 / maxPv;

    let showed = false;
    for (let i = 0; i < sim.flows.length; i++) {
      const f = sim.flows[i];
      if (f.kw < 0.04) continue;
      const a = f.from === 0 ? pH1 : pH2;
      const b = f.to === 0 ? pH1 : pH2;
      flowDyn.share.curve = setBezier3(lineShare, a, b, 0.6);
      lineShare.material.opacity = 0.26 + 0.48 * Math.min(1, f.kw / 2.5);
      lineShare.visible = true;
      flowDyn.share.show = true;
      flowDyn.share.str = Math.min(1, f.kw / 2.2);
      showed = true;
      break;
    }
    if (!showed) {
      lineShare.visible = false;
      flowDyn.share.show = false;
      flowDyn.share.curve = null;
    }

    const gi = sim.gridImport;
    const ge = sim.gridExport;
    // Lower threshold so you can still see the heartbeat at moderate flows.
    if (gi > 0.025) {
      flowDyn.grid.curve = setBezier3(lineGrid, pGridBottom, pMid, 1.15);
      lineGrid.visible = true;
      lineGrid.material.color.setHex(0xffaa99);
      lineGrid.material.opacity = 0.36 + 0.6 * Math.min(1, gi / 4);
      flowDyn.grid.show = true;
      flowDyn.grid.str = Math.min(1, gi / 4);
    } else if (ge > 0.025) {
      flowDyn.grid.curve = setBezier3(lineGrid, pMid, pGridBottom, 1.15);
      lineGrid.visible = true;
      lineGrid.material.color.setHex(0xffee99);
      lineGrid.material.opacity = 0.36 + 0.6 * Math.min(1, ge / 4);
      flowDyn.grid.show = true;
      flowDyn.grid.str = Math.min(1, ge / 4);
    } else {
      lineGrid.visible = false;
      flowDyn.grid.show = false;
      flowDyn.grid.curve = null;
    }
  }

  function applySunPosition(hour) {
    const u = THREE.MathUtils.clamp((hour - 6) / 14, 0, 1);
    // Leva → desno; nižje v kadru (prej je bilo y ~8–11, izven zgornjega roba pogleda).
    const x = -7.2 + 14.4 * u;
    const y = 3.85 + 2.1 * Math.sin(u * Math.PI);
    const z = -3.6;
    sunGroup.position.set(x, y, z);
    sunLight.position.copy(sunGroup.position);
  }

  let flowPhase = 0;

  function animateParticles() {
    flowPhase += 0.022;
    function step(key, part) {
      const d = flowDyn[key];
      if (!d.show || !d.curve) {
        part.pts.visible = false;
        return;
      }
      part.pts.visible = true;
      const c = d.curve;
      const spd = 0.12 + 0.35 * d.str;
      for (let i = 0; i < part.n; i++) {
        const t = (i / part.n + flowPhase * spd) % 1;
        const p = c.getPoint(t);
        part.arr[i * 3] = p.x;
        part.arr[i * 3 + 1] = p.y;
        part.arr[i * 3 + 2] = p.z;
      }
      part.pts.geometry.attributes.position.needsUpdate = true;
      part.pts.material.opacity = key === "grid" ? 0.25 + 0.7 * d.str : 0.2 + 0.55 * d.str;
    }
    step("sun1", partSun1);
    step("sun2", partSun2);
    step("share", partShare);
    step("grid", partGrid);
  }

  function update(st, sim) {
    applySunPosition(st.hour ?? 12);
    const t = st.sunPct / 100;
    const mul1 = st.loadMul.h1;
    const mul2 = st.loadMul.h2;
    const s = 0.92 + 0.28 * t;
    sunMesh.scale.setScalar(s);
    halo.scale.setScalar(0.98 + 0.22 * t);
    haloOuter.scale.setScalar(0.95 + 0.2 * t);
    const c = new THREE.Color().setHSL(0.1, 0.25 + 0.45 * t, 0.5 + 0.32 * t);
    sunMesh.material.color.copy(c);
    halo.material.opacity = 0.22 + 0.28 * t;
    haloOuter.material.opacity = 0.04 + 0.12 * t;
    sunCorona.material.opacity = 0.22 + 0.35 * t;
    sunCorona.scale.setScalar(0.85 + 0.2 * t);
    sunRays.scale.setScalar(0.85 + 0.25 * t);
    const rayOp = 0.88 * (0.35 + 0.65 * t);
    sunRays.traverse((o) => {
      if (o.isMesh && o.material) o.material.opacity = rayOp;
    });
    sunLight.intensity = 0.25 + 0.75 * t;
    sunLight.color.copy(c);

    skyUniforms.topColor.value.setHSL(0.58, 0.35 + 0.15 * t, 0.62 + 0.08 * t);
    skyUniforms.horizonColor.value.setHSL(0.55, 0.12, 0.88 + 0.04 * t);

    applyHouseGlow(mul1, m1.win, m1.ring, glowPt1, t);
    applyHouseGlow(mul2, m2.win, m2.ring, glowPt2, t);

    updateFlowLines(sim);
  }

  function resize() {
    const el = container;
    const nw = el.clientWidth || window.innerWidth;
    const nh = el.clientHeight || window.innerHeight;
    if (nh < 2) return;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  }

  function tick() {
    requestAnimationFrame(tick);
    animateParticles();
    sunMesh.rotation.y += 0.0018;
    halo.rotation.y -= 0.0009;
    haloOuter.rotation.y += 0.0004;
    sunCorona.rotation.z += 0.0012;
    sunRays.rotation.y += 0.002;
    renderer.render(scene, camera);
  }
  tick();

  applySunPosition(12);

  return { update, resize };
}

function initNeighborhood() {
  const wrap = document.getElementById("wrapScene");
  if (!wrap) return;
  neighborhood = initNeighborhoodScene(wrap);
  requestAnimationFrame(() => {
    if (neighborhood) neighborhood.resize();
  });
  window.addEventListener("resize", () => {
    if (neighborhood) neighborhood.resize();
  });
}

const els = {
  sunSlider: document.getElementById("sunSlider"),
  sunValue: document.getElementById("sunValue"),
  hourSlider: document.getElementById("hourSlider"),
  hourValue: document.getElementById("hourValue"),
  load1Slider: document.getElementById("load1Slider"),
  load1Value: document.getElementById("load1Value"),
  load2Slider: document.getElementById("load2Slider"),
  load2Value: document.getElementById("load2Value"),
  labelH1: document.getElementById("labelH1"),
  labelH2: document.getElementById("labelH2"),
};

els.labelH1.textContent = LABELS.h1;
els.labelH2.textContent = LABELS.h2;

function updateEnergyHud(sim) {
  const elPv = document.getElementById("hudPv");
  const elShare = document.getElementById("hudShare");
  const elGrid = document.getElementById("hudGrid");
  const elEco = document.getElementById("hudEco");
  if (!elPv || !elShare || !elGrid) return;
  elPv.textContent = `Sončna proizvodnja (skupaj): ${sim.totalPv.toFixed(2)} kWh/h`;
  elShare.textContent =
    sim.shareSum > 0.02
      ? `Deljenje med hišama: ${sim.shareSum.toFixed(2)} kWh/h`
      : "Deljenje: ni aktivno (ni hkrati presežka in manjka)";
  elGrid.textContent =
    sim.gridImport >= sim.gridExport
      ? `Omrežje: uvoz ${sim.gridImport.toFixed(2)} kWh/h`
      : `Omrežje: izvoz ${sim.gridExport.toFixed(2)} kWh/h`;
  if (elEco) {
    const eur = gridMoneyEurPerH(sim.gridImport, sim.gridExport);
    const co2 = gridCo2KgPerH(sim.gridImport, sim.gridExport);
    elEco.textContent = `Ocena omrežja: ${eur.toFixed(2)} €/h, ${co2.toFixed(3)} kg CO₂/h`;
  }
}

function render() {
  const sim = simulate(state);
  if (neighborhood) neighborhood.update(state, sim);
  updateEnergyHud(sim);
}

const modalOverlayEl = document.getElementById("sliderModalOverlay");
const modalCloseEl = document.getElementById("sliderModalClose");
const modalTitleEl = document.getElementById("sliderModalTitle");
const modalQuestionEl = document.getElementById("sliderModalQuestion");

let sliderModalOpen = false;
let sliderModalTimer = null;
let sliderModalPending = null;

function sliderLabel(sliderId) {
  switch (sliderId) {
    case "sunSlider":
      return "Sonce (oblačnost)";
    case "hourSlider":
      return "Ura dneva";
    case "load1Slider":
      return "Hiša 1 poraba";
    case "load2Slider":
      return "Hiša 2 poraba";
    default:
      return "Drsnik";
  }
}

function sliderValueToDisplay(sliderId, v) {
  switch (sliderId) {
    case "sunSlider":
    case "load1Slider":
    case "load2Slider":
      return `${Math.round(v)}%`;
    case "hourSlider": {
      const num = Number(v);
      return `${num.toFixed(2).replace(/\.?0+$/, "")} h`;
    }
    default:
      return String(v);
  }
}

function bucketForSlider(sliderId, v) {
  if (sliderId === "sunSlider") {
    // 0–33 / 34–66 / 67–100
    if (v < 34) return "low";
    if (v < 67) return "mid";
    return "high";
  }
  if (sliderId === "hourSlider") {
    // 6–10 / 10–14 / 14–20
    if (v < 10) return "low";
    if (v <= 14) return "mid";
    return "high";
  }
  if (sliderId === "load1Slider" || sliderId === "load2Slider") {
    // 40–79 / 80–120 / 121–160
    if (v < 80) return "low";
    if (v <= 120) return "mid";
    return "high";
  }
  return "mid";
}

function reflectiveQuestion(sliderId, direction, toValue) {
  const bucket = bucketForSlider(sliderId, toValue);
  const label = sliderLabel(sliderId);

  const q = {
    sunSlider: {
      up: {
        low: "Zelo oblačno je postalo bolj sončno. Ali si lahko predstavljaš, ali bo v soseski zdaj več 'viška' PV energije za deljenje, ali pa bo še vedno prevladoval uvoz iz omrežja?",
        mid: "Zmerno povečanje sončne moči. Bo to dovolj, da se preklopi iz uvoza v deljenje/izvoz, ali bo razlika še vedno majhna?",
        high: "Pri že zelo sončnih razmerah dodatno povečaš sončno moč. Ali pričakuješ, da bodo tokovi in deljenje rasli sorazmerno, ali pa naletiš na omejitev—poraba hiš namreč ostane enaka?",
      },
      down: {
        low: "Ko sončno moč še znižaš (bolj oblačno), kaj se najprej spremeni v ravnotežju med hišami in omrežjem—več uvoza ali manj deljenja?",
        mid: "Ko sončno moč v zmernem območju zmanjšaš, katera hiša bo najprej začutila pomanjkanje in zakaj?",
        high: "Če pri zelo sončnem dnevu sončno moč zmanjšuješ, ali obstaja 'preklopna točka', ko se soseska začne zanašati bolj na omrežje kot na izvoz?",
      },
    },
    hourSlider: {
      up: {
        low: "Premakneš uro proti kasnejšemu dopoldnevu. Ali lahko predvidiš, ali bo PV proizvodnja kmalu dovolj, da zmanjša uvoz, in katera hiša bi takrat dobila večvišek?",
        mid: "Ko se približuješ poznejšemu poldnevu, ali bo še vedno v 'vrhu' proizvodnje ali bo že začelo zaostajati za porabo?",
        high: "Ko greš bolj proti večeru, PV pada. Ali bi pričakoval, da se deljenje zmanjša in poveča uvoz, tudi če poraba hiš ostane enaka?",
      },
      down: {
        low: "Če se vrneš proti zgodnjemu jutru, kako hitro pade dnevni faktor PV in kaj to naredi s tokovi energije?",
        mid: "Zamakneš uro nazaj znotraj vrha. Ali se deljenje med hišama sploh opazi, ali pa se spremeni predvsem omrežna izmenjava?",
        high: "Če se premakneš nazaj proti močnejšemu popoldnevu, ali se pojavi več viška za deljenje, ali pa še vedno ostanete večinoma odvisni od omrežja?",
      },
    },
    load1Slider: {
      up: {
        low: "Povečaš porabo Hiše 1. Ali se ob tem bolj krepi uvoz iz omrežja ali pa se zmanjša izvoz/deljenje med hišama?",
        mid: "Ko porabo povečaš iz zmerne proti višji, ali obstaja trenutek, ko Hiša 1 preide iz deljenja v pomanjkanje?",
        high: "Pri zelo visoki porabi Hiše 1. Ali dodatno povečanje spremeni sistem precej, ali pa si že v stanju, kjer poraba skoraj vedno prevesi proizvodnjo?",
      },
      down: {
        low: "Zmanjšaš porabo Hiše 1. Je takrat realno pričakovati, da bo ta hiša pogosteje 'donor' viška, in zakaj?",
        mid: "Če porabo zmanjšaš nazaj proti zmerni, se bo omrežna izmenjava najprej umirila, ali pa se spremeni predvsem med-hišna izmenjava?",
        high: "Ko pri zelo visoki porabi Hiše 1 porabo znižaš, ali lahko hitro preideš iz uvoznega stanja v izvoz/deljenje—kje bi bila ta meja?",
      },
    },
    load2Slider: {
      up: {
        low: "Povečaš porabo Hiše 2. Ali se ob tem bolj krepi uvoz iz omrežja ali pa se zmanjša izvoz/deljenje med hišama?",
        mid: "Ko porabo povečaš iz zmerne proti višji, ali obstaja trenutek, ko Hiša 2 preide iz deljenja v pomanjkanje?",
        high: "Pri zelo visoki porabi Hiše 2. Ali dodatno povečanje spremeni sistem precej, ali pa si že v stanju, kjer poraba skoraj vedno prevesi proizvodnjo?",
      },
      down: {
        low: "Zmanjšaš porabo Hiše 2. Je takrat realno pričakovati, da bo ta hiša pogosteje 'donor' viška, in zakaj?",
        mid: "Če porabo zmanjšaš nazaj proti zmerni, se bo omrežna izmenjava najprej umirila, ali pa se spremeni predvsem med-hišna izmenjava?",
        high: "Ko pri zelo visoki porabi Hiše 2 porabo znižaš, ali lahko hitro preideš iz uvoznega stanja v izvoz/deljenje—kje bi bila ta meja?",
      },
    },
  };

  const bySlider = q[sliderId];
  if (!bySlider || !bySlider[direction]) return `Kako si opazil(a) spremembo pri ${label}?`;
  return bySlider[direction][bucket] || `Kako si opazil(a) spremembo pri ${label}?`;
}

function directionToSlv(direction) {
  if (direction === "up") return "povečal si";
  return "zmanjšal si";
}

function openSliderModal({ sliderId, direction, fromValue, toValue }) {
  if (!modalOverlayEl || !modalTitleEl || !modalQuestionEl) return;
  sliderModalOpen = true;
  modalOverlayEl.classList.add("is-open");
  modalOverlayEl.setAttribute("aria-hidden", "false");

  const label = sliderLabel(sliderId);
  const deltaText = `${sliderValueToDisplay(sliderId, fromValue)} → ${sliderValueToDisplay(sliderId, toValue)}`;

  modalTitleEl.textContent = `${label}: ${directionToSlv(direction)} (${deltaText})`;
  modalQuestionEl.textContent = reflectiveQuestion(sliderId, direction, toValue);

  if (modalCloseEl) modalCloseEl.focus();
}

function closeSliderModal() {
  if (!modalOverlayEl) return;
  sliderModalOpen = false;
  modalOverlayEl.classList.remove("is-open");
  modalOverlayEl.setAttribute("aria-hidden", "true");
}

function requestSliderModal(payload) {
  if (!payload) return;
  if (sliderModalOpen) return; // ne prekrivamo modalov med drsanjem
  sliderModalPending = payload;
  if (sliderModalTimer) window.clearTimeout(sliderModalTimer);
  sliderModalTimer = window.setTimeout(() => {
    openSliderModal(sliderModalPending);
    sliderModalPending = null;
  }, 220);
}

if (modalCloseEl) {
  modalCloseEl.addEventListener("click", () => closeSliderModal());
}
if (modalOverlayEl) {
  modalOverlayEl.addEventListener("click", (e) => {
    if (e.target === modalOverlayEl) closeSliderModal();
  });
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSliderModal();
});

els.sunSlider.addEventListener("input", () => {
  const fromValue = state.sunPct;
  const toValue = Number(els.sunSlider.value);
  if (toValue !== fromValue) {
    requestSliderModal({
      sliderId: "sunSlider",
      direction: toValue > fromValue ? "up" : "down",
      fromValue,
      toValue,
    });
  }
  state.sunPct = toValue;
  els.sunValue.textContent = `${state.sunPct}%`;
  render();
});

if (els.hourSlider && els.hourValue) {
  els.hourSlider.addEventListener("input", () => {
    const fromValue = state.hour ?? 12;
    const toValue = Number(els.hourSlider.value);
    if (toValue !== fromValue) {
      requestSliderModal({
        sliderId: "hourSlider",
        direction: toValue > fromValue ? "up" : "down",
        fromValue,
        toValue,
      });
    }
    state.hour = toValue;
    els.hourValue.textContent = `${state.hour.toFixed(2).replace(/\.?0+$/, "")} h`;
    render();
  });
}

function bindLoad(slider, valueEl, id) {
  slider.addEventListener("input", () => {
    const fromPct = (state.loadMul[id] ?? 1) * 100;
    const toPct = Number(slider.value);
    if (toPct !== fromPct) {
      requestSliderModal({
        sliderId: slider.id,
        direction: toPct > fromPct ? "up" : "down",
        fromValue: fromPct,
        toValue: toPct,
      });
    }

    state.loadMul[id] = toPct / 100;
    valueEl.textContent = `${slider.value}%`;
    render();
  });
}

bindLoad(els.load1Slider, els.load1Value, "h1");
bindLoad(els.load2Slider, els.load2Value, "h2");

function sync() {
  els.sunSlider.value = String(state.sunPct);
  els.sunValue.textContent = `${state.sunPct}%`;
  if (els.hourSlider && els.hourValue) {
    els.hourSlider.value = String(state.hour ?? 12);
    const h = state.hour ?? 12;
    els.hourValue.textContent = `${Number(h).toFixed(2).replace(/\.?0+$/, "")} h`;
  }
  els.load1Slider.value = String(Math.round(state.loadMul.h1 * 100));
  els.load1Value.textContent = `${Math.round(state.loadMul.h1 * 100)}%`;
  els.load2Slider.value = String(Math.round(state.loadMul.h2 * 100));
  els.load2Value.textContent = `${Math.round(state.loadMul.h2 * 100)}%`;
}

sync();
initNeighborhood();
render();
