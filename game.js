/* Roadster Loop - plain JS + three.js r128. Original car design and branding. */
(function () {
'use strict';

var THREE = window.THREE;
var $ = function (id) { return document.getElementById(id); };
var panel = $('panel');

if (!THREE) {
  panel.innerHTML = '<h2>Could not load three.js</h2><p>Check your connection and reload.</p>';
  return;
}

/* ------------------------------------------------------------------ constants */
var G = 9.81, MPH = 0.44704;
var R1 = 22, WALL = 14, R2 = 9, OVER = 22 * Math.PI / 180;   // ramp geometry
var ROAD_START = -170, RAMP_W = 16;
var CAR_H = 0.66, CAR_L = 2.3;                                // car hull half sizes (ride height / half length)
var THRUST = 26, GAS_DRAIN = 0.28, RING_GAS = 0.35, RING_PTS = 500;
var ANG_ACC = 7, ANG_DAMP = 1.3, SPIN0 = 0.8;
var RING_R = 3.2, RING_HIT = 4.2, RING_COUNT = 6;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function wrapPi(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

/* ------------------------------------------------------------------ ramp path (sampled by arc length) */
var pts = [], pathS = 0;
function pushPt(x, y, t) {
  if (pts.length) { var p = pts[pts.length - 1]; pathS += Math.hypot(x - p.x, y - p.y); }
  pts.push({ x: x, y: y, t: t, s: pathS });
}
var x0;
for (x0 = ROAD_START; x0 < 0; x0 += 10) pushPt(x0, 0, 0);                       // flat road
var rampStartIdx = pts.length;
var i;
for (i = 0; i <= 60; i++) { var a1 = i / 60 * Math.PI / 2; pushPt(R1 * Math.sin(a1), R1 - R1 * Math.cos(a1), a1); } // quarter-pipe r=22
var wallTop = R1 + WALL;
pushPt(R1, R1 + WALL * 0.5, Math.PI / 2);                                       // wall, height 14
pushPt(R1, wallTop, Math.PI / 2);
var cx2 = R1 - R2;
for (i = 1; i <= 24; i++) {                                                     // curl r=9, 22 deg past vertical
  var a2 = i / 24 * OVER;
  pushPt(cx2 + R2 * Math.cos(a2), wallTop + R2 * Math.sin(a2), Math.PI / 2 + a2);
}
var totalS = pathS, flatEndS = pts[rampStartIdx].s;
var lastPt = pts[pts.length - 1];

function sample(s) {
  if (s <= 0) return pts[0];
  if (s >= totalS) return lastPt;
  var lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { var m = (lo + hi) >> 1; if (pts[m].s <= s) lo = m; else hi = m; }
  var a = pts[lo], b = pts[hi], k = (s - a.s) / (b.s - a.s);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, t: a.t + (b.t - a.t) * k };
}

/* ------------------------------------------------------------------ renderer / scene */
var renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
} catch (e) {
  panel.innerHTML = '<h2>WebGL not available</h2><p>This game needs a browser with WebGL.</p>';
  return;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
var scene = new THREE.Scene();
var FOG = 0x120e38;
scene.fog = new THREE.Fog(FOG, 70, 420);
var camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1000);

function resize() {
  var w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* lights */
scene.add(new THREE.HemisphereLight(0x6a7bff, 0x1a1240, 0.75));
var moonLight = new THREE.DirectionalLight(0xbcd0ff, 0.8);
moonLight.position.set(-60, 120, 80);
scene.add(moonLight);

/* helpers */
function glowTexture(inner, outer) {
  var c = document.createElement('canvas'); c.width = c.height = 64;
  var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function windowTexture() {
  var c = document.createElement('canvas'); c.width = 64; c.height = 128;
  var g = c.getContext('2d');
  g.fillStyle = '#0a0d26'; g.fillRect(0, 0, 64, 128);
  for (var yy = 4; yy < 124; yy += 8) for (var xx = 4; xx < 60; xx += 8) {
    if (Math.random() < 0.4) { g.fillStyle = Math.random() < 0.7 ? '#ffd98a' : '#7fe6ff'; g.fillRect(xx, yy, 4, 5); }
  }
  return new THREE.CanvasTexture(c);
}

/* sky gradient, stars, moon */
(function () {
  var c = document.createElement('canvas'); c.width = 4; c.height = 256;
  var g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#02030c'); gr.addColorStop(0.55, '#0d0a33'); gr.addColorStop(0.85, '#2a1a63'); gr.addColorStop(1, '#4a2a80');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  var sky = new THREE.Mesh(new THREE.PlaneGeometry(2000, 700),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), fog: false }));
  sky.position.set(-100, 200, -360);
  scene.add(sky);

  var n = 700, pos = new Float32Array(n * 3);
  for (var k = 0; k < n; k++) { pos[k * 3] = rand(-900, 700); pos[k * 3 + 1] = rand(30, 420); pos[k * 3 + 2] = -340; }
  var sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })));

  var moon = new THREE.Mesh(new THREE.SphereGeometry(16, 32, 16), new THREE.MeshBasicMaterial({ color: 0xf2f4ff, fog: false }));
  moon.position.set(-150, 170, -330);
  scene.add(moon);
  var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(190,205,255,.55)', 'rgba(190,205,255,0)'), fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(120, 120, 1); halo.position.copy(moon.position);
  scene.add(halo);
})();

/* ground, skyline */
var ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 700), new THREE.MeshStandardMaterial({ color: 0x0d1226, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(-100, -0.12, 0);
scene.add(ground);

(function () {
  var bases = [windowTexture(), windowTexture(), windowTexture()];
  for (var bx = -520; bx < 160; bx += 14) {
    var w = rand(12, 26), h = rand(30, 125), d = rand(12, 22);
    var tex = bases[(Math.random() * 3) | 0].clone();
    tex.needsUpdate = true; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(Math.ceil(w / 10), Math.ceil(h / 20));
    var b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ map: tex }));
    b.position.set(bx + rand(-4, 4), h / 2, -rand(110, 200));
    scene.add(b);
  }
})();

/* road */
(function () {
  var road = new THREE.Mesh(new THREE.BoxGeometry(460, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0x1b1f33, roughness: 0.85 }));
  road.position.set(-230, -0.05, 0);
  scene.add(road);
  var white = new THREE.MeshBasicMaterial({ color: 0xdfe8ff });
  for (var dx = -440; dx < -6; dx += 10) {
    var dash = new THREE.Mesh(new THREE.BoxGeometry(4, 0.02, 0.3), white);
    dash.position.set(dx, 0.01, 0); scene.add(dash);
  }
  var edgeMat = new THREE.MeshBasicMaterial({ color: 0x35f2ff });
  [-7.5, 7.5].forEach(function (z) {
    var e = new THREE.Mesh(new THREE.BoxGeometry(460, 0.03, 0.2), edgeMat);
    e.position.set(-230, 0.015, z); scene.add(e);
  });
  var lampTex = glowTexture('rgba(255,220,150,.9)', 'rgba(255,220,150,0)');
  var postMat = new THREE.MeshStandardMaterial({ color: 0x2a3050 });
  var headMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (var lx = -430; lx < -10; lx += 30) [-10.5, 10.5].forEach(function (z) {
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 7, 6), postMat);
    post.position.set(lx, 3.5, z); scene.add(post);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), headMat);
    head.position.set(lx, 7.1, z); scene.add(head);
    var gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampTex, blending: THREE.AdditiveBlending, depthWrite: false }));
    gl.scale.set(9, 9, 1); gl.position.set(lx, 7.1, z); scene.add(gl);
  });
})();

/* ramp */
(function () {
  var sh = new THREE.Shape();
  sh.moveTo(0, 0);
  for (var k = rampStartIdx + 1; k < pts.length; k++) sh.lineTo(pts[k].x, pts[k].y);
  sh.lineTo(36, lastPt.y); sh.lineTo(36, 0); sh.closePath();
  var geo = new THREE.ExtrudeGeometry(sh, { depth: RAMP_W, bevelEnabled: false });
  geo.translate(0, 0, -RAMP_W / 2);
  var capMat = new THREE.MeshStandardMaterial({ color: 0x1b2a6a, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  var surfMat = new THREE.MeshStandardMaterial({ color: 0x232b52, roughness: 0.5, metalness: 0.3 });
  scene.add(new THREE.Mesh(geo, [capMat, surfMat]));

  var neon = new THREE.MeshBasicMaterial({ color: 0x35f2ff });
  [-RAMP_W / 2, RAMP_W / 2].forEach(function (z) {
    var arr = [];
    for (var k2 = rampStartIdx; k2 < pts.length; k2++) arr.push(new THREE.Vector3(pts[k2].x, pts[k2].y + 0.05, z));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arr), 160, 0.16, 6, false), neon));
  });
  var rungMat = new THREE.MeshBasicMaterial({ color: 0xff3fd2 });
  for (var ss = flatEndS + 3; ss < totalS - 0.5; ss += 3.5) {
    var p = sample(ss);
    var rung = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, RAMP_W - 0.6), rungMat);
    rung.position.set(p.x - Math.sin(p.t) * 0.08, p.y + Math.cos(p.t) * 0.08, 0);
    rung.rotation.z = p.t; scene.add(rung);
  }
  // support frame behind ramp
  var frame = new THREE.MeshStandardMaterial({ color: 0x151b3a });
  for (var fz = -RAMP_W / 2; fz <= RAMP_W / 2; fz += RAMP_W / 2) {
    var col = new THREE.Mesh(new THREE.BoxGeometry(0.6, lastPt.y, 0.6), frame);
    col.position.set(36, lastPt.y / 2, fz); scene.add(col);
  }
})();

/* ------------------------------------------------------------------ the car (original design) */
var carGroup = new THREE.Group();
var wheels = [], plumes = [];
(function () {
  var paint = new THREE.MeshStandardMaterial({ color: 0x14b8da, metalness: 0.55, roughness: 0.28 });
  var dark = new THREE.MeshStandardMaterial({ color: 0x0b0f1a, metalness: 0.3, roughness: 0.6 });
  var glass = new THREE.MeshStandardMaterial({ color: 0x07111f, metalness: 0.9, roughness: 0.08 });
  var body = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), paint);
  body.scale.set(CAR_L, 0.42, 0.95); body.position.y = -0.02; carGroup.add(body);
  var cabin = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), glass);
  cabin.scale.set(1.15, 0.4, 0.78); cabin.position.set(-0.2, 0.28, 0); carGroup.add(cabin);
  var split = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.08, 1.7), dark);
  split.position.y = -0.42; carGroup.add(split);
  var wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.6), paint);
  wing.position.set(-2.05, 0.46, 0); carGroup.add(wing);
  [-0.6, 0.6].forEach(function (z) {
    var strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), dark);
    strut.position.set(-2.0, 0.34, z); carGroup.add(strut);
  });
  var tyre = new THREE.MeshStandardMaterial({ color: 0x090a10, roughness: 0.9 });
  var rimMat = new THREE.MeshBasicMaterial({ color: 0x8ff6ff });
  [[1.38, 0.92], [1.38, -0.92], [-1.38, 0.92], [-1.38, -0.92]].forEach(function (wp) {
    var wg = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 20); wg.rotateX(Math.PI / 2);
    var w = new THREE.Mesh(wg, tyre);
    w.position.set(wp[0], -0.28, wp[1]);
    var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.32), rimMat);
    w.add(spoke);
    var spoke2 = spoke.clone(); spoke2.rotation.z = Math.PI / 2; w.add(spoke2);
    carGroup.add(w); wheels.push(w);
  });
  var hl = new THREE.MeshBasicMaterial({ color: 0xeaffff });
  [-0.5, 0.5].forEach(function (z) {
    var h = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.45), hl);
    h.position.set(2.2, 0.02, z); carGroup.add(h);
  });
  var bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 1.5), new THREE.MeshBasicMaterial({ color: 0xff2a55 }));
  bar.position.set(-2.27, 0.12, 0); carGroup.add(bar);

  // four floor thruster ports + plumes (exhaust points down; car is pushed along its up axis)
  var portMat = new THREE.MeshBasicMaterial({ color: 0x4aa8ff });
  var plumeMat = new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  var coreMat = new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  [[1.35, 0.62], [1.35, -0.62], [-1.35, 0.62], [-1.35, -0.62]].forEach(function (pp) {
    var port = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12), portMat);
    port.position.set(pp[0], -0.46, pp[1]); carGroup.add(port);
    var cg = new THREE.ConeGeometry(0.22, 1, 12, 1, true); cg.rotateX(Math.PI);
    var cone = new THREE.Mesh(cg, plumeMat); cone.visible = false; carGroup.add(cone);
    var cg2 = new THREE.ConeGeometry(0.1, 1, 10, 1, true); cg2.rotateX(Math.PI);
    var core = new THREE.Mesh(cg2, coreMat); cone.add(core);
    plumes.push({ mesh: cone, x: pp[0], z: pp[1] });
  });
  var under = new THREE.PointLight(0x4ad8ff, 1.1, 20);
  under.position.set(0, -0.8, 0); carGroup.add(under);
})();
scene.add(carGroup);

/* ------------------------------------------------------------------ audio */
var actx = null;
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume();
}
function beep(freq, dur, type, vol) {
  if (!actx) return;
  var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  o.type = type || 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + dur);
}

/* ------------------------------------------------------------------ game state */
var state = 'title';          // title | countdown | drive | air | landed | result
var keys = { left: false, right: false };
var thrustHeld = false;
var lockUntil = 0;
var cdStart = 0, greenT = 0, greenOn = false, lightsOn = [false, false, false, false];
var reaction = 0, vt = 0, vAcc = 0, driveS = 0, driveV = 0;
var px = 0, py = 0, vx = 0, vy = 0, theta = 0, omega = 0;
var gas = 1, thrusting = false, ringsHit = 0, airTime = 0, maxH = 0, ringScore = 0, bonusScore = 0;
var landedT = 0, landTilt = 0, landKind = '', resultAt = 0, wheelSpin = 0;
var rings = [], debris = [];
var msgUntil = 0;
var best = 0;
try { best = parseInt(localStorage.getItem('roadsterLoopBest') || '0', 10) || 0; } catch (e) { best = 0; }

var camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
var elScore = $('score'), elRings = $('rings'), elSpeed = $('speed'), elAlt = $('alt');
var elGas = $('gas'), elGasFill = $('gas-fill'), elMsg = $('message'), elLights = $('lights');

function now() { return performance.now() / 1000; }
function setMsg(text, cls, dur) {
  elMsg.textContent = text; elMsg.className = 'show' + (cls ? ' ' + cls : '');
  msgUntil = dur ? now() + dur : 0;
}
function clearMsg() { elMsg.className = ''; msgUntil = 0; }

function setCar(x, y, th) {
  carGroup.position.set(x, y, 0);
  carGroup.rotation.z = th;
}
function clearObjects() {
  rings.forEach(function (r) { scene.remove(r.mesh); });
  debris.forEach(function (d) { scene.remove(d.mesh); });
  rings = []; debris = [];
}
function resetLights() {
  for (var k = 0; k < 4; k++) $('l' + k).className = 'light';
  lightsOn = [false, false, false, false]; greenOn = false;
  elLights.classList.remove('hidden');
}

function resetRun() {
  clearObjects(); resetLights(); clearMsg();
  var p = sample(0);
  px = p.x; py = CAR_H; theta = 0; omega = 0; vx = vy = 0;
  gas = 1; ringsHit = 0; ringScore = 0; bonusScore = 0; airTime = 0; maxH = 0; thrusting = false;
  vAcc = 0; driveS = 0; driveV = 0; wheelSpin = 0;
  setCar(px, py, 0);
  camPos.set(px + 6, 4.5, 14); camLook.set(px + 3, 1.2, 0);
}

/* ------------------------------------------------------------------ run flow */
function startCountdown() {
  resetRun();
  panel.classList.add('hidden');
  state = 'countdown';
  cdStart = now();
  greenT = cdStart + 3.6 + rand(0.7, 2.0);
  setMsg('Wait for green', '', 0);
}

function falseStart() {
  beep(200, 0.3, 'square', 0.14);
  lockUntil = now() + 0.4;
  setMsg('Too early, wait for green', 'bad', 1.3);
  elLights.classList.remove('shake'); void elLights.offsetWidth; elLights.classList.add('shake');
}

function launch(t) {
  reaction = Math.max(0, t - greenT);
  var mph = clamp(90 - 5 * reaction, 70, 90);   // faster reaction = more speed (see README note)
  vt = mph * MPH;
  vAcc = 0; driveS = 0; driveV = 0;
  thrustHeld = false;          // a held key must be released and pressed again to fire thrusters
  state = 'drive';
  elLights.classList.add('hidden');
  setMsg('Ramp speed ' + Math.round(mph) + ' mph', 'good', 1.6);
  spawnRings();
}

function leaveRamp() {
  var p = lastPt;
  px = p.x - Math.sin(p.t) * CAR_H; py = p.y + Math.cos(p.t) * CAR_H;
  vx = driveV * Math.cos(p.t); vy = driveV * Math.sin(p.t);
  theta = p.t; omega = SPIN0;
  state = 'air';
  setMsg('Rotate with \u2190 \u2192 \u2022 Space = thrusters', '', 2.2);
}

function lowestPoint(y, th) { return y - (CAR_L * Math.abs(Math.sin(th)) + CAR_H * Math.abs(Math.cos(th))); }

/* rings are placed along the predicted unthrusted arc */
function spawnRings() {
  var topV = Math.sqrt(Math.max(vt * vt - G * lastPt.y, 90));
  var x = lastPt.x - Math.sin(lastPt.t) * CAR_H, y = lastPt.y + Math.cos(lastPt.t) * CAR_H;
  var ux = topV * Math.cos(lastPt.t), uy = topV * Math.sin(lastPt.t);
  var samples = [];
  for (var k = 0; k < 2000; k++) {
    ux += 0; uy -= G * 0.02; x += ux * 0.02; y += uy * 0.02;
    samples.push({ x: x, y: y, vx: ux, vy: uy });
    if (y < 1 && uy < 0) break;
  }
  var fr = [0.13, 0.27, 0.41, 0.55, 0.69, 0.83];
  var ringMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true });
  var haloMat = new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  for (var r = 0; r < RING_COUNT; r++) {
    var s = samples[Math.floor(fr[r] * (samples.length - 1))];
    var sp = Math.hypot(s.vx, s.vy) || 1, off = rand(-3.5, 3.5);
    var rx = s.x + (-s.vy / sp) * off, ry = Math.max(6, s.y + (s.vx / sp) * off);
    var g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.3, 12, 44), ringMat));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.9, 10, 44), haloMat));
    g.position.set(rx, ry, 0);
    scene.add(g);
    rings.push({ mesh: g, x: rx, y: ry, hit: false, t: 0, phase: Math.random() * 6 });
  }
}

function land() {
  var tilt = Math.abs(wrapPi(theta)) * 180 / Math.PI;
  landTilt = tilt;
  bonusScore += Math.floor(airTime * 100);
  if (tilt <= 25) { landKind = 'clean'; bonusScore += 500 + Math.round(500 * (1 - tilt / 25)); setMsg('Clean landing!', 'good', 2); beep(660, 0.2, 'triangle', 0.14); beep(990, 0.3, 'triangle', 0.1); }
  else if (tilt <= 60) { landKind = 'rough'; bonusScore += 150; setMsg('Rough landing', '', 2); beep(300, 0.25, 'sawtooth', 0.1); }
  else { landKind = 'crash'; setMsg('Crash!', 'bad', 2); beep(120, 0.5, 'sawtooth', 0.16); spawnDebris(); }
  thrusting = false;
  state = 'landed'; landedT = 0;
  if (landKind === 'crash') { vx *= 0.3; vy = 0; }
  else { py = Math.max(py, CAR_H); vy = 0; }
}

function spawnDebris() {
  var m = new THREE.MeshBasicMaterial({ color: 0xff8a3a });
  for (var k = 0; k < 26; k++) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), m);
    mesh.position.set(px, Math.max(py, 0.5), rand(-1, 1)); scene.add(mesh);
    debris.push({ mesh: mesh, vx: rand(-9, 9) + vx * 0.3, vy: rand(4, 14), vz: rand(-3, 3), t: 0 });
  }
}

function showResult() {
  state = 'result';
  var total = ringScore + bonusScore;
  var isBest = total > best;
  if (isBest) { best = total; try { localStorage.setItem('roadsterLoopBest', String(best)); } catch (e) {} }
  var title = landKind === 'clean' ? 'Clean landing!' : landKind === 'rough' ? 'Rough landing' : 'Crash!';
  panel.innerHTML =
    '<h2>' + title + '</h2>' +
    '<table>' +
    '<tr><td>Reaction</td><td>' + reaction.toFixed(3) + ' s</td></tr>' +
    '<tr><td>Ramp speed</td><td>' + Math.round(vt / MPH) + ' mph</td></tr>' +
    '<tr><td>Rings</td><td>' + ringsHit + ' / ' + RING_COUNT + ' (' + ringScore + ')</td></tr>' +
    '<tr><td>Air time</td><td>' + airTime.toFixed(1) + ' s</td></tr>' +
    '<tr><td>Max height</td><td>' + Math.round(maxH) + ' m</td></tr>' +
    '<tr><td>Landing tilt</td><td>' + Math.round(landTilt) + '\u00b0</td></tr>' +
    '<tr class="total"><td>Total</td><td>' + total + (isBest ? ' \u2605 new best' : '') + '</td></tr>' +
    '<tr><td>Best</td><td>' + best + '</td></tr>' +
    '</table>' +
    '<button class="btn" id="again">Run again (Space)</button>';
  panel.classList.remove('hidden');
  $('again').addEventListener('click', function (e) { e.stopPropagation(); onAction(); });
  $('again').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  lockUntil = now() + 0.6;
}

function showTitle() {
  panel.innerHTML =
    '<h1>Roadster <span>Loop</span></h1>' +
    '<p>Launch on green, ride the quarter-pipe, fly through the rings and stick the landing.</p>' +
    '<div class="keys">' +
    '<div><kbd>Space</kbd> / tap &mdash; launch on green, thrusters in the air</div>' +
    '<div><kbd>\u2190</kbd> <kbd>\u2192</kbd> &mdash; rotate the car</div>' +
    '<div>Rings: +500 points and +35% gas</div>' +
    '</div>' +
    '<p>Pressing before green does nothing but lock you out for 0.4 s.</p>' +
    '<button class="btn" id="startBtn">Start (Space)</button>';
  panel.classList.remove('hidden');
  $('startBtn').addEventListener('click', function (e) { e.stopPropagation(); onAction(); });
  $('startBtn').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
}

/* ------------------------------------------------------------------ input */
function onAction() {
  var t = now();
  if (t < lockUntil) return;
  ensureAudio();
  if (state === 'title' || state === 'result') { startCountdown(); return; }
  if (state === 'countdown') {
    if (!greenOn) falseStart(); else launch(t);
  }
}

window.addEventListener('keydown', function (e) {
  if (e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
  else if (e.code === 'Space' && !e.repeat) { thrustHeld = true; onAction(); }
});
window.addEventListener('keyup', function (e) {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  else if (e.code === 'Space') thrustHeld = false;
});
window.addEventListener('blur', function () { keys.left = keys.right = thrustHeld = false; });

$('game').addEventListener('pointerdown', function () { thrustHeld = true; onAction(); });
window.addEventListener('pointerup', function () { thrustHeld = false; });
window.addEventListener('pointercancel', function () { thrustHeld = false; });

function holdBtn(id, key) {
  var b = $(id);
  b.addEventListener('pointerdown', function (e) { e.stopPropagation(); keys[key] = true; b.classList.add('down'); ensureAudio(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
    b.addEventListener(ev, function () { keys[key] = false; b.classList.remove('down'); });
  });
}
holdBtn('btnLeft', 'left'); holdBtn('btnRight', 'right');

/* ------------------------------------------------------------------ update */
function updateCountdown(t) {
  var ct = t - cdStart;
  for (var k = 0; k < 4; k++) {
    if (!lightsOn[k] && ct >= 0.9 * (k + 1)) { lightsOn[k] = true; $('l' + k).className = 'light on'; beep(520, 0.12, 'sine', 0.1); }
  }
  if (!greenOn && lightsOn[3] && t >= greenT) {
    greenOn = true; $('l3').className = 'light green'; beep(880, 0.25, 'sine', 0.15); setMsg('GO!', 'good', 1);
  }
}

function updateDrive(dt) {
  var p = sample(driveS);
  if (p.y < 0.01 && driveS < flatEndS) {
    var accel = vt * vt / (2 * (-15 - ROAD_START));
    vAcc = Math.min(vt, vAcc + accel * dt); driveV = vAcc;
  } else {
    driveV = Math.sqrt(Math.max(vt * vt - G * p.y, 90));
  }
  driveS += driveV * dt;
  wheelSpin -= driveV * dt / 0.38;
  if (driveS >= totalS) { leaveRamp(); return; }
  p = sample(driveS);
  px = p.x - Math.sin(p.t) * CAR_H; py = p.y + Math.cos(p.t) * CAR_H; theta = p.t;
}

function updateAir(dt) {
  var u = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  omega += (u * ANG_ACC - omega * ANG_DAMP) * dt;
  theta += omega * dt;
  thrusting = thrustHeld && gas > 0;
  var ax = 0, ay = -G;
  if (thrusting) {
    ax += -Math.sin(theta) * THRUST; ay += Math.cos(theta) * THRUST;   // reaction to exhaust out of the floor ports
    gas = Math.max(0, gas - GAS_DRAIN * dt);
  }
  vx += ax * dt; vy += ay * dt; px += vx * dt; py += vy * dt;
  airTime += dt; maxH = Math.max(maxH, py);
  for (var k = 0; k < rings.length; k++) {
    var r = rings[k];
    if (!r.hit && Math.hypot(px - r.x, py - r.y) < RING_HIT) {
      r.hit = true; r.t = 0; ringsHit++; ringScore += RING_PTS; gas = Math.min(1, gas + RING_GAS);
      beep(880 + ringsHit * 90, 0.18, 'triangle', 0.12); beep(1320 + ringsHit * 90, 0.22, 'sine', 0.08);
    }
  }
  if (lowestPoint(py, theta) <= 0 && vy < 0) land();
}

function updateLanded(dt) {
  landedT += dt;
  if (landKind !== 'crash') {
    var target = Math.round(theta / (Math.PI * 2)) * Math.PI * 2;
    theta += (target - theta) * Math.min(1, dt * 10);
    py += (CAR_H - py) * Math.min(1, dt * 10);
    vx *= Math.exp(-2.0 * dt);
    px += vx * dt;
    wheelSpin -= vx * dt / 0.38;
  } else {
    py = Math.max(py, lowestPoint(py, theta) < 0 ? py - lowestPoint(py, theta) : py);
    vx *= Math.exp(-4 * dt); px += vx * dt;
  }
  if (landedT > 1.6) showResult();
}

function updateEffects(dt, t) {
  rings.forEach(function (r) {
    if (r.hit) {
      r.t += dt; var s = 1 + r.t * 4;
      r.mesh.scale.set(s, s, s);
      r.mesh.children.forEach(function (c) { c.material.opacity = Math.max(0, 1 - r.t * 2.5); });
      if (r.t > 0.45) r.mesh.visible = false;
    } else {
      r.mesh.rotation.y = Math.sin(t * 2 + r.phase) * 0.35;
      var pulse = 1 + Math.sin(t * 5 + r.phase) * 0.04; r.mesh.scale.set(pulse, pulse, pulse);
    }
  });
  for (var k = debris.length - 1; k >= 0; k--) {
    var d = debris[k]; d.t += dt; d.vy -= G * dt;
    d.mesh.position.x += d.vx * dt; d.mesh.position.y += d.vy * dt; d.mesh.position.z += d.vz * dt;
    d.mesh.rotation.x += dt * 6; d.mesh.rotation.y += dt * 5;
    if (d.mesh.position.y < 0.15) { d.mesh.position.y = 0.15; d.vy *= -0.35; d.vx *= 0.7; }
    if (d.t > 3) { scene.remove(d.mesh); debris.splice(k, 1); }
  }
  plumes.forEach(function (p) {
    p.mesh.visible = thrusting;
    if (thrusting) {
      var L = 1.7 + Math.random() * 0.6;
      p.mesh.scale.set(1 + Math.random() * 0.2, L, 1 + Math.random() * 0.2);
      p.mesh.position.set(p.x, -0.48 - L / 2, p.z);
    }
  });
  wheels.forEach(function (w) { w.rotation.z = wheelSpin; });
}

function updateCamera(dt) {
  var ox, lx, z, yy, ly;
  if (state === 'air' || state === 'landed' || state === 'result') {
    ox = 0; lx = 0; z = 46 + clamp(py, 0, 100) * 0.55; yy = py * 0.7 + 6; ly = py * 0.85 + 2;
  } else if (state === 'drive') {
    ox = 10; lx = 8; z = 26 + py * 0.5; yy = py * 0.75 + 5; ly = py * 0.85 + 3;
  } else {
    ox = 6; lx = 3; z = 14; yy = 4.5; ly = 1.2;
  }
  var k = 1 - Math.exp(-dt * 3);
  camPos.x += (px + ox - camPos.x) * k; camPos.y += (yy - camPos.y) * k; camPos.z += (z - camPos.z) * k;
  camLook.x += (px + lx - camLook.x) * k; camLook.y += (ly - camLook.y) * k;
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

function updateHUD() {
  elScore.textContent = String(ringScore + bonusScore + (state === 'air' ? Math.floor(airTime * 100) : 0));
  elRings.textContent = String(ringsHit);
  var spd = state === 'drive' ? driveV : state === 'air' ? Math.hypot(vx, vy) : state === 'landed' ? Math.abs(vx) : 0;
  elSpeed.textContent = String(Math.round(spd / MPH));
  elAlt.textContent = String(Math.max(0, Math.round(py - CAR_H)));
  elGasFill.style.width = (gas * 100).toFixed(1) + '%';
  elGas.classList.toggle('low', gas < 0.2);
}

var last = performance.now();
function frame(ms) {
  requestAnimationFrame(frame);
  var dt = Math.min(0.033, (ms - last) / 1000); last = ms;
  var t = ms / 1000;
  if (dt <= 0) return;

  if (state === 'countdown') updateCountdown(t);
  else if (state === 'drive') updateDrive(dt);
  else if (state === 'air') updateAir(dt);
  else if (state === 'landed') updateLanded(dt);

  if (state === 'drive' || state === 'air' || state === 'landed') setCar(px, py, theta);
  else if (state === 'countdown') setCar(px, py, 0);
  if (state !== 'air') thrusting = false;

  updateEffects(dt, t);
  updateCamera(dt);
  updateHUD();
  if (msgUntil && now() > msgUntil) clearMsg();
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ boot */
resetRun();
showTitle();
requestAnimationFrame(frame);
})();
