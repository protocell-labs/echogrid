// main.js (ES module)

import * as THREE from "three";
import { OrbitControls } from "OrbitControls";
import { GLTFLoader } from "GLTFLoader";

// -------------------------------
// Constants & helpers
// -------------------------------

let model = null; // GLB root, for material switching

let gridMaterial;
let gridWireMaterial;
let gridPointsMaterial;

let currentMaterialMode = "gridTransparent"; // default material


const F_MIN = 3000;
const F_MAX = 3000000000;

// Default bounds before GLB is loaded (a safe cube around origin)
const DEFAULT_RANGE = 6;

// Bounds within which we map sliders for field center & sources
const boundsMin = new THREE.Vector3(-DEFAULT_RANGE, -DEFAULT_RANGE, -DEFAULT_RANGE);
const boundsMax = new THREE.Vector3(DEFAULT_RANGE, DEFAULT_RANGE, DEFAULT_RANGE);
const boundsCenter = new THREE.Vector3(0, 0, 0);

// density 1–5 → points per unit
function mapDensityToPPU(densityValue) {
  // New lower-density range: 1..4
  // 1 → 0.2, 2 → 0.4, 3 → 0.6, 4 → 0.8, 5 → 1.0
  if (densityValue <= 5) {
    const minPpu = 0.2;                     // very low density
    const stepLow = (1.0 - minPpu) / 4.0;   // 0.2 per step
    return minPpu + (densityValue - 1) * stepLow;
  }
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

// Map slider [-100,100] to [min,max] on a given axis
function mapSliderToBounds(v, min, max) {
  const t = (v + 100) / 200; // -100→0, 0→0.5, 100→1
  return min + (max - min) * t;
}




function createGridMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLineColor: { value: new THREE.Color(0x0000ff) }, // blue
      uBgColor: { value: new THREE.Color(0x000000) },   // black
      uScale: { value: 0.8 },                           // grid density
      uThickness: { value: 0.02 }                       // line thickness
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;

        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      uniform vec3 uLineColor;
      uniform vec3 uBgColor;
      uniform float uScale;
      uniform float uThickness;

      void main() {
        vec3 n  = normalize(vWorldNormal);
        vec3 an = abs(n);
        vec2 coord;

        if (an.y >= an.x && an.y >= an.z) {
          coord = vWorldPos.xz;
        } else if (an.x >= an.y && an.x >= an.z) {
          coord = vWorldPos.zy;
        } else {
          coord = vWorldPos.xy;
        }

        coord *= uScale;

        vec2 grid = abs(fract(coord) - 0.5);
        float distToLine = min(grid.x, grid.y);
        float mask = step(distToLine, uThickness);

        vec3 color = mix(uBgColor, uLineColor, mask);
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
}

function createGridWireMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLineColor: { value: new THREE.Color(0x0000ff) },
      uScale: { value: 0.8 },
      uThickness: { value: 0.02 }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      uniform vec3 uLineColor;
      uniform float uScale;
      uniform float uThickness;

      void main() {
        vec3 n  = normalize(vWorldNormal);
        vec3 an = abs(n);
        vec2 coord;

        if (an.y >= an.x && an.y >= an.z) {
          coord = vWorldPos.xz;
        } else if (an.x >= an.y && an.x >= an.z) {
          coord = vWorldPos.zy;
        } else {
          coord = vWorldPos.xy;
        }

        coord *= uScale;

        vec2 grid = abs(fract(coord) - 0.5);
        float distToLine = min(grid.x, grid.y);
        float mask = step(distToLine, uThickness);

        vec3 color = uLineColor;
        float alpha = mask;
        if (alpha <= 0.0) discard;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
}

function createGridPointsMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPointColor: { value: new THREE.Color(0x0000ff) },
      uScale: { value: 0.75 },
      uRadius: { value: 0.10 }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      uniform vec3 uPointColor;
      uniform float uScale;
      uniform float uRadius;

      void main() {
        vec3 n  = normalize(vWorldNormal);
        vec3 an = abs(n);
        vec2 coord;

        if (an.y >= an.x && an.y >= an.z) {
          coord = vWorldPos.xz;
        } else if (an.x >= an.y && an.x >= an.z) {
          coord = vWorldPos.zy;
        } else {
          coord = vWorldPos.xy;
        }

        coord *= uScale;

        vec2 local = fract(coord) - 0.5;
        float dist = length(local);
        float mask = step(dist, uRadius);

        if (mask <= 0.0) discard;

        vec3 color = uPointColor;
        gl_FragColor = vec4(color, mask);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
}



function applyMaterialMode(mode) {
  currentMaterialMode = mode;
  if (!model) return; // GLB not loaded yet

  model.traverse((child) => {
    if (!child.isMesh) return;

    switch (mode) {
      case "grid":
        if (gridMaterial) child.material = gridMaterial;
        break;

      case "gridTransparent":
        if (gridWireMaterial) child.material = gridWireMaterial;
        break;

      case "gridPoints":
        if (gridPointsMaterial) child.material = gridPointsMaterial;
        break;
    }
  });
}


// -------------------------------
// Scene setup
// -------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.set(0, 50, 0); //200, 400, 200


const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// After creating controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Set the point the camera should orbit around / look at:
controls.target.set(0, 150, 0);
controls.update(); // apply immediately


const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(10, 15, 8);
scene.add(dirLight);

const ambient = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambient);

// --- Grid-style GLB materials ---
gridMaterial = createGridMaterial();
gridWireMaterial = createGridWireMaterial();
gridPointsMaterial = createGridPointsMaterial();


// -------------------------------
// Field volume (position + size)
// -------------------------------
const fieldCenter = new THREE.Vector3().copy(boundsCenter);
const fieldSize = new THREE.Vector3(8, 8, 8);

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
  uniform vec3  uSource3Pos;
  uniform float uK1;
  uniform float uOmega1;
  uniform float uK2;
  uniform float uOmega2;
  uniform float uK3;
  uniform float uOmega3;
  uniform float uPointSize;

  varying float vAmplitude;

  float ampFromSource(vec3 pos, vec3 src, float k, float omega, float t) {
    vec3 d = pos - src;
    float r = length(d) + 1e-6;
    float phase = k * r - omega * t;
    return sin(phase) / (1.0 + 0.05 * r);
  }

  void main() {
    vec3 p = position;

    float A1 = ampFromSource(p, uSource1Pos, uK1, uOmega1, uTime);
    float A2 = ampFromSource(p, uSource2Pos, uK2, uOmega2, uTime);
    float A3 = ampFromSource(p, uSource3Pos, uK3, uOmega3, uTime);
    float A  = A1 + A2 + A3;

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
    float alpha = abs(a);  
    gl_FragColor = vec4(r, 0.0, b, alpha);
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
        positions[idx] = x;
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
      uTime: { value: 0 },
      uSource1Pos: { value: new THREE.Vector3() },
      uSource2Pos: { value: new THREE.Vector3() },
      uSource3Pos: { value: new THREE.Vector3() },
      uK1: { value: 1.0 },
      uOmega1: { value: 1.0 },
      uK2: { value: 1.0 },
      uOmega2: { value: 1.0 },
      uK3: { value: 1.0 },
      uOmega3: { value: 1.0 },
      uPointSize: { value: 2.0 }
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });

  points = new THREE.Points(geometry, material);
  scene.add(points);
}

// -------------------------------
// Sources
// -------------------------------
const source1Mesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xffff00 })
);
scene.add(source1Mesh);

const source2Mesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xffff00 })
);
scene.add(source2Mesh);

const source3Mesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xffff00 })
);
scene.add(source3Mesh);

const source1Pos = new THREE.Vector3();
const source2Pos = new THREE.Vector3();
const source3Pos = new THREE.Vector3();

// Auto-move toggles
let source1Auto = true;
let source2Auto = true;
let source3Auto = true;

// Hard-coded velocities (you can tweak these)
const source1Velocity = new THREE.Vector3(1.6, 0.3, 1.0);
const source2Velocity = new THREE.Vector3(-1.2, 0.4, -1.4);
const source3Velocity = new THREE.Vector3(+1.2, 0.4, -1.4);

function updateSource1FromSliders() {
  const sx = Number(source1XSlider.value);
  const sy = Number(source1YSlider.value);
  const sz = Number(source1ZSlider.value);

  source1Pos.set(
    mapSliderToBounds(sx, boundsMin.x, boundsMax.x),
    mapSliderToBounds(sy, boundsMin.y, boundsMax.y),
    mapSliderToBounds(sz, boundsMin.z, boundsMax.z)
  );
  source1Mesh.position.copy(source1Pos);
}

function updateSource2FromSliders() {
  const sx = Number(source2XSlider.value);
  const sy = Number(source2YSlider.value);
  const sz = Number(source2ZSlider.value);

  source2Pos.set(
    mapSliderToBounds(sx, boundsMin.x, boundsMax.x),
    mapSliderToBounds(sy, boundsMin.y, boundsMax.y),
    mapSliderToBounds(sz, boundsMin.z, boundsMax.z)
  );
  source2Mesh.position.copy(source2Pos);
}

function updateSource3FromSliders() {
  const sx = Number(source3XSlider.value);
  const sy = Number(source3YSlider.value);
  const sz = Number(source3ZSlider.value);

  source3Pos.set(
    mapSliderToBounds(sx, boundsMin.x, boundsMax.x),
    mapSliderToBounds(sy, boundsMin.y, boundsMax.y),
    mapSliderToBounds(sz, boundsMin.z, boundsMax.z)
  );
  source3Mesh.position.copy(source3Pos);
}

// -------------------------------
// Optional GLB (for bounds + visuals)
// -------------------------------
if (GLTFLoader) {
  const loader = new GLTFLoader();
  loader.load(
    "models/obstacle1.glb",
    (gltf) => {
      const root = gltf.scene;
      root.position.set(0, 0, 0);

      model = root; // store reference for material switching
      scene.add(model);

      model.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = false;
          obj.receiveShadow = false;

          // optional: remember original material
          obj.userData.originalMaterial = obj.material;

          // initial material (will be overridden by applyMaterialMode as well)
          obj.material = gridMaterial;
        }
      });

      // Apply whatever mode is currently selected
      applyMaterialMode(currentMaterialMode);

      // Compute bounding box in world space
      model.updateWorldMatrix(true, true);
      const bbox = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      bbox.getCenter(boundsCenter);

      boundsMin.copy(bbox.min);
      boundsMax.copy(bbox.max);

      console.log("GLB bounds:", boundsMin, boundsMax, "size:", size);

      // --- 1) Snap field center to model center ---
      fieldCenter.copy(boundsCenter);

      // Snap field position sliders to "center" (slider 0 → center)
      fieldPosXSlider.value = "0";
      fieldPosYSlider.value = "0";
      fieldPosZSlider.value = "0";

      // --- 2) Snap both sources to model center ---
      source1XSlider.value = "-15";
      source1YSlider.value = "0";
      source1ZSlider.value = "0";
      source2XSlider.value = "0";
      source2YSlider.value = "0";
      source2ZSlider.value = "-30";
      source3XSlider.value = "-20";
      source3YSlider.value = "0";
      source3ZSlider.value = "+30";

      // Update source positions using new bounds & slider values
      updateSource1FromSliders();
      updateSource2FromSliders();
      updateSource3FromSliders();

      // --- 3) Let field size sliders extend over the entire model ---
      // Ensure slider max covers at least the full bbox extent on each axis
      const minSize = 0.5; // don't go too tiny
      fieldSizeXSlider.min = String(minSize);
      fieldSizeYSlider.min = String(minSize);
      fieldSizeZSlider.min = String(minSize);

      fieldSizeXSlider.max = String(Math.max(size.x, minSize));
      fieldSizeYSlider.max = String(Math.max(size.y, minSize));
      fieldSizeZSlider.max = String(Math.max(size.z, minSize));

      // Set initial size to cover the whole model on each axis
      fieldSizeXSlider.value = String(size.x) / 1;
      fieldSizeYSlider.value = String(size.y) / 20;
      fieldSizeZSlider.value = String(size.z) / 1;

      // Update field size from sliders
      updateFieldSizeFromSliders();

      // Rebuild point cloud with new center, bounds, and size
      buildPointCloud();
      updateLabels();
    },
    undefined,
    (err) => console.warn("Failed to load obstacle1.glb", err)
  );
}

// -------------------------------
// UI wiring
// -------------------------------
const densitySlider = document.getElementById("densitySlider");

// Field volume sliders
const fieldPosXSlider = document.getElementById("fieldPosXSlider");
const fieldPosYSlider = document.getElementById("fieldPosYSlider");
const fieldPosZSlider = document.getElementById("fieldPosZSlider");
const fieldSizeXSlider = document.getElementById("fieldSizeXSlider");
const fieldSizeYSlider = document.getElementById("fieldSizeYSlider");
const fieldSizeZSlider = document.getElementById("fieldSizeZSlider");

// Source sliders
const freq1Slider = document.getElementById("freq1Slider");
const source1XSlider = document.getElementById("source1XSlider");
const source1YSlider = document.getElementById("source1YSlider");
const source1ZSlider = document.getElementById("source1ZSlider");

const freq2Slider = document.getElementById("freq2Slider");
const source2XSlider = document.getElementById("source2XSlider");
const source2YSlider = document.getElementById("source2YSlider");
const source2ZSlider = document.getElementById("source2ZSlider");

const freq3Slider = document.getElementById("freq3Slider");
const source3XSlider = document.getElementById("source3XSlider");
const source3YSlider = document.getElementById("source3YSlider");
const source3ZSlider = document.getElementById("source3ZSlider");

const source1AutoToggle = document.getElementById("source1AutoToggle");
const source2AutoToggle = document.getElementById("source2AutoToggle");
const source3AutoToggle = document.getElementById("source3AutoToggle");

const labelsDiv = document.getElementById("labels");

let densitySliderVal = Number(densitySlider.value);
let freq1SliderVal = Number(freq1Slider.value);
let freq2SliderVal = Number(freq2Slider.value);
let freq3SliderVal = Number(freq3Slider.value);

let freq1 = mapSliderToFrequency(freq1SliderVal);
let freq2 = mapSliderToFrequency(freq2SliderVal);
let freq3 = mapSliderToFrequency(freq3SliderVal);


function updateAutoSource(dt, pos, vel) {
  // How much random steering per second
  const wanderStrength = 1.5;    // tweakable
  const maxSpeed = 20.0;          // units per second, tweakable

  // Smoothly perturb the velocity each frame
  vel.x += (Math.random() - 0.5) * wanderStrength * dt;
  vel.y += (Math.random() - 0.5) * wanderStrength * dt;
  vel.z += (Math.random() - 0.5) * wanderStrength * dt;

  // Clamp speed for smoothness
  const speed = vel.length();
  if (speed > maxSpeed) {
    vel.multiplyScalar(maxSpeed / speed);
  }

  // Move the source
  pos.addScaledVector(vel, dt);

  // Bounce inside bounds
  ["x", "y", "z"].forEach((axis) => {
    const min = boundsMin[axis];
    const max = boundsMax[axis];
    if (pos[axis] < min) {
      pos[axis] = min;
      vel[axis] = Math.abs(vel[axis]);
    } else if (pos[axis] > max) {
      pos[axis] = max;
      vel[axis] = -Math.abs(vel[axis]);
    }
  });
}

// Inverse mapping: world → slider value [-100, 100]
function mapWorldToSlider(v, min, max) {
  const t = (v - min) / (max - min); // 0..1
  return t * 200 - 100;              // 0→-100, 0.5→0, 1→100
}


const materialSelect = document.getElementById("materialSelect");
if (materialSelect) {
  // set default
  materialSelect.value = currentMaterialMode;

  materialSelect.addEventListener("change", (event) => {
    const mode = event.target.value;
    applyMaterialMode(mode);
  });
}


function updateFieldCenterFromSliders() {
  fieldCenter.set(
    mapSliderToBounds(Number(fieldPosXSlider.value), boundsMin.x, boundsMax.x),
    mapSliderToBounds(Number(fieldPosYSlider.value), boundsMin.y, boundsMax.y),
    mapSliderToBounds(Number(fieldPosZSlider.value), boundsMin.z, boundsMax.z)
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
  const MHz3 = freq3 / 1e6;

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
    "<br>Source 3 freq: " + freq3.toExponential(3) + " Hz (" + MHz3.toFixed(3) + " MHz)" +
    "<br>Source 3 pos: (" +
    source3Pos.x.toFixed(2) + ", " +
    source3Pos.y.toFixed(2) + ", " +
    source3Pos.z.toFixed(2) + ")";
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

freq3Slider.addEventListener("input", () => {
  freq3SliderVal = Number(freq3Slider.value);
  freq3 = mapSliderToFrequency(freq3SliderVal);
  updateLabels();
});

source1XSlider.addEventListener("input", () => { updateSource1FromSliders(); updateLabels(); });
source1YSlider.addEventListener("input", () => { updateSource1FromSliders(); updateLabels(); });
source1ZSlider.addEventListener("input", () => { updateSource1FromSliders(); updateLabels(); });

source2XSlider.addEventListener("input", () => { updateSource2FromSliders(); updateLabels(); });
source2YSlider.addEventListener("input", () => { updateSource2FromSliders(); updateLabels(); });
source2ZSlider.addEventListener("input", () => { updateSource2FromSliders(); updateLabels(); });

source3XSlider.addEventListener("input", () => { updateSource3FromSliders(); updateLabels(); });
source3YSlider.addEventListener("input", () => { updateSource3FromSliders(); updateLabels(); });
source3ZSlider.addEventListener("input", () => { updateSource3FromSliders(); updateLabels(); });

source1AutoToggle.addEventListener("change", () => {
  source1Auto = source1AutoToggle.checked;
});

source2AutoToggle.addEventListener("change", () => {
  source2Auto = source2AutoToggle.checked;
});

source3AutoToggle.addEventListener("change", () => {
  source3Auto = source3AutoToggle.checked;
});


// Initial setup (before GLB bounds override)
updateFieldCenterFromSliders();
updateFieldSizeFromSliders();
updateSource1FromSliders();
updateSource2FromSliders();
updateSource3FromSliders();
buildPointCloud();
updateLabels();

// -------------------------------
// Animation
// -------------------------------
const clock = new THREE.Clock();
let lastTime = 0;

function animate() {
  requestAnimationFrame(animate);

  const t = clock.getElapsedTime();

  let dt = t - lastTime;
  lastTime = t;
  // Clamp dt to avoid huge jumps if tab was inactive
  dt = Math.min(dt, 0.05);

  // Auto-move sources if toggled
  if (source1Auto) {
    updateAutoSource(dt, source1Pos, source1Velocity);
    source1Mesh.position.copy(source1Pos);

    // keep sliders in sync
    source1XSlider.value = mapWorldToSlider(source1Pos.x, boundsMin.x, boundsMax.x).toFixed(0);
    source1YSlider.value = mapWorldToSlider(source1Pos.y, boundsMin.y, boundsMax.y).toFixed(0);
    source1ZSlider.value = mapWorldToSlider(source1Pos.z, boundsMin.z, boundsMax.z).toFixed(0);
  }

  if (source2Auto) {
    updateAutoSource(dt, source2Pos, source2Velocity);
    source2Mesh.position.copy(source2Pos);

    // keep sliders in sync
    source2XSlider.value = mapWorldToSlider(source2Pos.x, boundsMin.x, boundsMax.x).toFixed(0);
    source2YSlider.value = mapWorldToSlider(source2Pos.y, boundsMin.y, boundsMax.y).toFixed(0);
    source2ZSlider.value = mapWorldToSlider(source2Pos.z, boundsMin.z, boundsMax.z).toFixed(0);
  }

    if (source3Auto) {
    updateAutoSource(dt, source3Pos, source3Velocity);
    source3Mesh.position.copy(source3Pos);

    // keep sliders in sync
    source3XSlider.value = mapWorldToSlider(source3Pos.x, boundsMin.x, boundsMax.x).toFixed(0);
    source3YSlider.value = mapWorldToSlider(source3Pos.y, boundsMin.y, boundsMax.y).toFixed(0);
    source3ZSlider.value = mapWorldToSlider(source3Pos.z, boundsMin.z, boundsMax.z).toFixed(0);
  }

  if (material) {
    const lambdaVis1 = getVisualLambdaFromFrequency(freq1);
    const lambdaVis2 = getVisualLambdaFromFrequency(freq2);
    const lambdaVis3 = getVisualLambdaFromFrequency(freq3);

    const k1 = (2 * Math.PI) / lambdaVis1;
    const k2 = (2 * Math.PI) / lambdaVis2;
    const k3 = (2 * Math.PI) / lambdaVis3;

    const norm1 = (freq1 - F_MIN) / (F_MAX - F_MIN);
    const norm2 = (freq2 - F_MIN) / (F_MAX - F_MIN);
    const norm3 = (freq3 - F_MIN) / (F_MAX - F_MIN);

    const omega1 = 2 * Math.PI * (0.5 + Math.max(0, Math.min(1, norm1)) * 2.0);
    const omega2 = 2 * Math.PI * (0.5 + Math.max(0, Math.min(1, norm2)) * 2.0);
    const omega3 = 2 * Math.PI * (0.5 + Math.max(0, Math.min(1, norm3)) * 2.0);

    material.uniforms.uTime.value = t;
    material.uniforms.uSource1Pos.value.copy(source1Pos);
    material.uniforms.uSource2Pos.value.copy(source2Pos);
    material.uniforms.uSource3Pos.value.copy(source3Pos);
    material.uniforms.uK1.value = k1;
    material.uniforms.uOmega1.value = omega1;
    material.uniforms.uK2.value = k2;
    material.uniforms.uOmega2.value = omega2;
    material.uniforms.uK3.value = k3;
    material.uniforms.uOmega3.value = omega3;
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
