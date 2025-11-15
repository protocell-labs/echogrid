// main.js (ES module)

import * as THREE from "three";
import { OrbitControls } from "OrbitControls";
import { GLTFLoader } from "GLTFLoader";

// -------------------------------
// Constants & helpers
// -------------------------------
const F_MIN = 3000;
const F_MAX = 3000000000;
const SOURCE_RANGE = 6;

// density 1–5 → points per unit
function mapDensityToPPU(densityValue) {
  const base = 1.0;
  const step = 0.5; // 1→1.0, 2→1.5, 3→2.0, 4→2.5, 5→3.0
  return base + (densityValue - 1) * step;
}

function mapSliderToFrequency(v) {
  const t = v / 100;
  const logMin = Math.log10(F_MIN);
  const logMax = Math.log10(F_MAX);
  const logF = logMin + (logMax - logMin) * t;
  return Math.pow(10, logF);
}

function getVisualLambdaFromFrequency(f) {
  if (!isFinite(f) || f <= 0) return 2.0;
  const norm = (f - F_MIN) / (F_MAX - F_MIN);
  const clamped = Math.max(0, Math.min(1, norm));
  return 4.0 - 3.0 * clamped; // 4 → 1
}

function mapSliderToSource(v) {
  const t = v / 100;
  return t * SOURCE_RANGE;
}

// -------------------------------
// Scene setup
// -------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(10, 10, 18);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(10, 15, 8);
scene.add(dirLight);

const ambient = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambient);

// -------------------------------
// Optional GLB (visual only)
// -------------------------------
if (GLTFLoader) {
  const loader = new GLTFLoader();
  loader.load(
    "models/obstacle1.glb",
    (gltf) => {
      const root = gltf.scene;
      root.position.set(0, 0, 0);
      scene.add(root);
      root.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = false;
          obj.receiveShadow = false;
        }
      });
      console.log("Loaded obstacle1.glb");
    },
    undefined,
    (err) => console.warn("Failed to load obstacle1.glb", err)
  );
}

// -------------------------------
// Field volume (position + size)
// -------------------------------
const fieldCenter = new THREE.Vector3(0, 0, 0);
const fieldSize   = new THREE.Vector3(8, 8, 8);

let resX = 0, resY = 0, resZ = 0;
let totalPoints = 0;

// -------------------------------
// Point cloud + shaders
// -------------------------------
let points = null;
let geometry = null;
let material = null;

const vertexShader = `
  uniform float uTime;
  uniform vec3  uSource1Pos;
  uniform vec3  uSource2Pos;
  uniform float uK1;
  uniform float uOmega1;
  uniform float uK2;
  uniform float uOmega2;
  uniform float uPointSize;

  varying float vAmplitude;

  float ampFromSource(vec3 pos, vec3 src, float k, float omega, float t) {
    vec3 d = pos - src;
    float r = length(d) + 1e-6;
    float phase = k * r - omega * t;
    return sin(phase) / (1.0 + 0.3 * r);
  }

  void main() {
    vec3 p = position;

    float A1 = ampFromSource(p, uSource1Pos, uK1, uOmega1, uTime);
    float A2 = ampFromSource(p, uSource2Pos, uK2, uOmega2, uTime);
    float A  = A1 + A2;

    vAmplitude = A;

    float amplitudeScale = 0.4;
    p.y += A * amplitudeScale;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uPointSize;
  }
`;

const fragmentShader = `
  precision highp float;
  varying float vAmplitude;

  void main() {
    float a = clamp(vAmplitude * 1.5, -1.0, 1.0);
    float r = max(0.0,  a);
    float b = max(0.0, -a);
    float g = 0.2 * (1.0 - abs(a));
    gl_FragColor = vec4(r, g, b, 1.0);
  }
`;

function buildPointCloud() {
  if (points) {
    scene.remove(points);
    points.geometry.dispose();
    points.material.dispose();
    points = null;
  }

  const ppu = mapDensityToPPU(densitySliderVal);

  resX = Math.max(2, Math.round(fieldSize.x * ppu));
  resY = Math.max(2, Math.round(fieldSize.y * ppu));
  resZ = Math.max(2, Math.round(fieldSize.z * ppu));

  totalPoints = resX * resY * resZ;

  const positions = new Float32Array(totalPoints * 3);

  let i = 0;
  for (let ix = 0; ix < resX; ix++) {
    const x = fieldCenter.x + (ix / (resX - 1) - 0.5) * fieldSize.x;
    for (let iy = 0; iy < resY; iy++) {
      const y = fieldCenter.y + (iy / (resY - 1) - 0.5) * fieldSize.y;
      for (let iz = 0; iz < resZ; iz++) {
        const z = fieldCenter.z + (iz / (resZ - 1) - 0.5) * fieldSize.z;

        const idx = i * 3;
        positions[idx]     = x;
        positions[idx + 1] = y;
        positions[idx + 2] = z;
        i++;
      }
    }
  }

  geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  material = new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: 0 },
      uSource1Pos: { value: new THREE.Vector3() },
      uSource2Pos: { value: new THREE.Vector3() },
      uK1:         { value: 1.0 },
      uOmega1:     { value: 1.0 },
      uK2:         { value: 1.0 },
      uOmega2:     { value: 1.0 },
      uPointSize:  { value: 3.0 }
    },
    vertexShader,
    fragmentShader,
    transparent: false,
    depthTest: true
  });

  points = new THREE.Points(geometry, material);
  scene.add(points);
}

// -------------------------------
// Sources
// -------------------------------
const source1Mesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xff4040 })
);
scene.add(source1Mesh);

const source2Mesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x40ff40 })
);
scene.add(source2Mesh);

const source1Pos = new THREE.Vector3();
const source2Pos = new THREE.Vector3();

function updateSource1FromSliders() {
  const sx = Number(source1XSlider.value);
  const sy = Number(source1YSlider.value);
  const sz = Number(source1ZSlider.value);

  source1Pos.set(
    mapSliderToSource(sx),
    mapSliderToSource(sy),
    mapSliderToSource(sz)
  );
  source1Mesh.position.copy(source1Pos);
}

function updateSource2FromSliders() {
  const sx = Number(source2XSlider.value);
  const sy = Number(source2YSlider.value);
  const sz = Number(source2ZSlider.value);

  source2Pos.set(
    mapSliderToSource(sx),
    mapSliderToSource(sy),
    mapSliderToSource(sz)
  );
  source2Mesh.position.copy(source2Pos);
}

// -------------------------------
// UI wiring
// -------------------------------
const densitySlider   = document.getElementById("densitySlider");

// Field volume sliders
const fieldPosXSlider   = document.getElementById("fieldPosXSlider");
const fieldPosYSlider   = document.getElementById("fieldPosYSlider");
const fieldPosZSlider   = document.getElementById("fieldPosZSlider");
const fieldSizeXSlider  = document.getElementById("fieldSizeXSlider");
const fieldSizeYSlider  = document.getElementById("fieldSizeYSlider");
const fieldSizeZSlider  = document.getElementById("fieldSizeZSlider");

// Source sliders
const freq1Slider     = document.getElementById("freq1Slider");
const source1XSlider  = document.getElementById("source1XSlider");
const source1YSlider  = document.getElementById("source1YSlider");
const source1ZSlider  = document.getElementById("source1ZSlider");

const freq2Slider     = document.getElementById("freq2Slider");
const source2XSlider  = document.getElementById("source2XSlider");
const source2YSlider  = document.getElementById("source2YSlider");
const source2ZSlider  = document.getElementById("source2ZSlider");

const labelsDiv       = document.getElementById("labels");

let densitySliderVal = Number(densitySlider.value);
let freq1SliderVal   = Number(freq1Slider.value);
let freq2SliderVal   = Number(freq2Slider.value);

let freq1 = mapSliderToFrequency(freq1SliderVal);
let freq2 = mapSliderToFrequency(freq2SliderVal);

function updateFieldCenterFromSliders() {
  fieldCenter.set(
    mapSliderToSource(Number(fieldPosXSlider.value)),
    mapSliderToSource(Number(fieldPosYSlider.value)),
    mapSliderToSource(Number(fieldPosZSlider.value))
  );
}

function updateFieldSizeFromSliders() {
  fieldSize.set(
    Number(fieldSizeXSlider.value),
    Number(fieldSizeYSlider.value),
    Number(fieldSizeZSlider.value)
  );
}

function updateLabels() {
  const MHz1 = freq1 / 1e6;
  const MHz2 = freq2 / 1e6;

  labelsDiv.innerHTML =
    "Field center: (" +
    fieldCenter.x.toFixed(2) + ", " +
    fieldCenter.y.toFixed(2) + ", " +
    fieldCenter.z.toFixed(2) + ")" +
    "<br>Field size: (" +
    fieldSize.x.toFixed(1) + " × " +
    fieldSize.y.toFixed(1) + " × " +
    fieldSize.z.toFixed(1) + ")" +
    "<br>Grid: " + resX + " × " + resY + " × " + resZ +
    " ≈ " + totalPoints.toLocaleString() + " points" +
    "<br>Source 1 freq: " + freq1.toExponential(3) + " Hz (" + MHz1.toFixed(3) + " MHz)" +
    "<br>Source 1 pos: (" +
    source1Pos.x.toFixed(2) + ", " +
    source1Pos.y.toFixed(2) + ", " +
    source1Pos.z.toFixed(2) + ")" +
    "<br>Source 2 freq: " + freq2.toExponential(3) + " Hz (" + MHz2.toFixed(3) + " MHz)" +
    "<br>Source 2 pos: (" +
    source2Pos.x.toFixed(2) + ", " +
    source2Pos.y.toFixed(2) + ", " +
    source2Pos.z.toFixed(2) + ")";
}

// --- listeners ---
densitySlider.addEventListener("input", () => {
  densitySliderVal = Number(densitySlider.value);
  buildPointCloud();
  updateLabels();
});

fieldPosXSlider.addEventListener("input", () => { updateFieldCenterFromSliders(); buildPointCloud(); updateLabels(); });
fieldPosYSlider.addEventListener("input", () => { updateFieldCenterFromSliders(); buildPointCloud(); updateLabels(); });
fieldPosZSlider.addEventListener("input", () => { updateFieldCenterFromSliders(); buildPointCloud(); updateLabels(); });

fieldSizeXSlider.addEventListener("input", () => { updateFieldSizeFromSliders(); buildPointCloud(); updateLabels(); });
fieldSizeYSlider.addEventListener("input", () => { updateFieldSizeFromSliders(); buildPointCloud(); updateLabels(); });
fieldSizeZSlider.addEventListener("input", () => { updateFieldSizeFromSliders(); buildPointCloud(); updateLabels(); });

freq1Slider.addEventListener("input", () => {
  freq1SliderVal = Number(freq1Slider.value);
  freq1 = mapSliderToFrequency(freq1SliderVal);
  updateLabels();
});

freq2Slider.addEventListener("input", () => {
  freq2SliderVal = Number(freq2Slider.value);
  freq2 = mapSliderToFrequency(freq2SliderVal);
  updateLabels();
});

source1XSlider.addEventListener("input", () => { updateSource1FromSliders(); updateLabels(); });
source1YSlider.addEventListener("input", () => { updateSource1FromSliders(); updateLabels(); });
source1ZSlider.addEventListener("input", () => { updateSource1FromSliders(); updateLabels(); });

source2XSlider.addEventListener("input", () => { updateSource2FromSliders(); updateLabels(); });
source2YSlider.addEventListener("input", () => { updateSource2FromSliders(); updateLabels(); });
source2ZSlider.addEventListener("input", () => { updateSource2FromSliders(); updateLabels(); });

// Initial setup
updateFieldCenterFromSliders();
updateFieldSizeFromSliders();
updateSource1FromSliders();
updateSource2FromSliders();
buildPointCloud();
updateLabels();

// -------------------------------
// Animation
// -------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const t = clock.getElapsedTime();

  if (material) {
    const lambdaVis1 = getVisualLambdaFromFrequency(freq1);
    const lambdaVis2 = getVisualLambdaFromFrequency(freq2);

    const k1 = (2 * Math.PI) / lambdaVis1;
    const k2 = (2 * Math.PI) / lambdaVis2;

    const norm1 = (freq1 - F_MIN) / (F_MAX - F_MIN);
    const norm2 = (freq2 - F_MIN) / (F_MAX - F_MIN);

    const omega1 = 2 * Math.PI * (0.5 + Math.max(0, Math.min(1, norm1)) * 2.0);
    const omega2 = 2 * Math.PI * (0.5 + Math.max(0, Math.min(1, norm2)) * 2.0);

    material.uniforms.uTime.value       = t;
    material.uniforms.uSource1Pos.value.copy(source1Pos);
    material.uniforms.uSource2Pos.value.copy(source2Pos);
    material.uniforms.uK1.value         = k1;
    material.uniforms.uOmega1.value     = omega1;
    material.uniforms.uK2.value         = k2;
    material.uniforms.uOmega2.value     = omega2;
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
