// MODULE IMPORTS

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { GLTFLoader } from 'GLTFLoader';
import { EffectComposer } from 'EffectComposer';
import { RenderPass } from 'RenderPass';
import { UnrealBloomPass } from 'UnrealBloomPass';
import { ShaderPass } from 'ShaderPass';





// ---------- Basic three.js setup ----------
const container = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

const BG_COLOR = 0x05070a;
renderer.setClearColor(BG_COLOR, 1.0);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 8, 13);
camera.lookAt(0, -1, 0);

// ---------- Orbit Controls ----------
/*
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;     // smooth movement
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false;
controls.enablePan = false;        // optional: lock panning
controls.minDistance = 5;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.48;  // prevent camera going under scene
*/


// simple lights (mainly for the grid; points use custom shader)
const light = new THREE.DirectionalLight(0xffffff, 1.0);
light.position.set(5, 10, 5);
scene.add(light);
scene.add(new THREE.AmbientLight(0x404040));

// ---------- Simulation parameters ----------
const SIM_SIZE   = 256;     // horizontal resolution per layer
const NUM_LAYERS = 1;       // vertical slices
const TEX_HEIGHT = SIM_SIZE * NUM_LAYERS; // stacked texture height

const PLANE_SIZE    = 12;   // horizontal world size
const LAYER_SPACING = 0.1;  // world-space distance between layers

// ---------- Render targets ----------
const rtOptions = {
  wrapS: THREE.ClampToEdgeWrapping,
  wrapT: THREE.ClampToEdgeWrapping,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  type: THREE.FloatType,
  depthBuffer: false,
  stencilBuffer: false,
};

let rtCurr   = new THREE.WebGLRenderTarget(SIM_SIZE, TEX_HEIGHT, rtOptions);
let rtPrev   = new THREE.WebGLRenderTarget(SIM_SIZE, TEX_HEIGHT, rtOptions);
let rtTemp   = new THREE.WebGLRenderTarget(SIM_SIZE, TEX_HEIGHT, rtOptions);
let sourceRT = new THREE.WebGLRenderTarget(SIM_SIZE, TEX_HEIGHT, rtOptions);

// clear helper
function clearRT(rt) {
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1.0); // pure black = no displacement/source
  renderer.clear();
  renderer.setRenderTarget(null);
  renderer.setClearColor(BG_COLOR, 1.0);
}

clearRT(rtCurr);
clearRT(rtPrev);
clearRT(rtTemp);
clearRT(sourceRT);

// ---------- Simulation quad (compute pass) ----------
const simScene  = new THREE.Scene();
const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const simMaterial = new THREE.ShaderMaterial({
  uniforms: {
    u_prev:       { value: rtCurr.texture },           // u^t
    u_prevPrev:   { value: rtPrev.texture },           // u^{t-1}
    u_sources:    { value: sourceRT.texture },
    u_resolution: { value: new THREE.Vector2(SIM_SIZE, TEX_HEIGHT) },
    u_c:          { value: 0.25 },    // horizontal wave speed
    u_cz:         { value: 0.25 },    // vertical coupling
    u_damping:    { value: 0.01 },
    u_layers:     { value: NUM_LAYERS },
    u_gridSize:   { value: new THREE.Vector2(SIM_SIZE, SIM_SIZE) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D u_prev;
    uniform sampler2D u_prevPrev;
    uniform sampler2D u_sources;
    uniform vec2 u_resolution; // (SIM_SIZE, TEX_HEIGHT)
    uniform vec2 u_gridSize;   // (SIM_SIZE, SIM_SIZE)
    uniform float u_c;
    uniform float u_cz;
    uniform float u_damping;
    uniform float u_layers;

    // decode which layer this texel belongs to, and its local UV in that layer
    void decodeLayer(in vec2 uv, out float layerIndex, out vec2 localUv) {
      float L = u_layers;
      float vScaled = uv.y * L;   // 0..L
      layerIndex = floor(vScaled);
      float vLocal = fract(vScaled);
      localUv = vec2(uv.x, vLocal);
    }

    vec2 encodeLayer(float layerIndex, vec2 localUv) {
      float L = u_layers;
      float v = (layerIndex + localUv.y) / L;
      return vec2(localUv.x, v);
    }

    // obstacle mask per layer (here: same cross in all layers, you can vary by layerIndex)
    float obstacleMask(vec2 localUv, float layerIndex) {
      float m = 0.0;
      if (localUv.x > 0.47 && localUv.x < 0.53 && localUv.y > 0.2 && localUv.y < 0.8) m = 1.0;
      if (localUv.y > 0.47 && localUv.y < 0.53 && localUv.x > 0.2 && localUv.x < 0.8) m = 1.0;
      return m;
    }

    void main() {
      float L = u_layers;

      // which layer & local UV
      float layerIndex;
      vec2 localUv;
      decodeLayer(vUv, layerIndex, localUv);

      // obstacles: pin displacement to 0
      float obs = obstacleMask(localUv, layerIndex);
      if (obs > 0.5) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // local texel size inside one slice (SIM_SIZE x SIM_SIZE)
      vec2 texelLocal = 1.0 / u_gridSize;
      float layerStepV = 1.0 / L;

      // sample center from stacked texture
      vec2 uvCenter = encodeLayer(layerIndex, localUv);
      float center = texture2D(u_prev, uvCenter).r;

      // neighbors in x/y within the SAME layer
      vec2 localUp    = localUv + vec2(0.0, texelLocal.y);
      vec2 localDown  = localUv - vec2(0.0, texelLocal.y);
      vec2 localLeft  = localUv - vec2(texelLocal.x, 0.0);
      vec2 localRight = localUv + vec2(texelLocal.x, 0.0);

      localUp.y    = clamp(localUp.y,    0.0, 1.0);
      localDown.y  = clamp(localDown.y,  0.0, 1.0);
      localLeft.x  = clamp(localLeft.x,  0.0, 1.0);
      localRight.x = clamp(localRight.x, 0.0, 1.0);

      float up    = texture2D(u_prev, encodeLayer(layerIndex, localUp)).r;
      float down  = texture2D(u_prev, encodeLayer(layerIndex, localDown)).r;
      float left  = texture2D(u_prev, encodeLayer(layerIndex, localLeft)).r;
      float right = texture2D(u_prev, encodeLayer(layerIndex, localRight)).r;

      float lapXY = (up + down + left + right - 4.0 * center);

      // vertical neighbors (between layers)
      float lapZ = 0.0;
      if (layerIndex > 0.0) {
        vec2 uvBelow = uvCenter - vec2(0.0, layerStepV);
        lapZ += texture2D(u_prev, uvBelow).r;
      } else {
        lapZ += center; // boundary condition
      }
      if (layerIndex < L - 1.0) {
        vec2 uvAbove = uvCenter + vec2(0.0, layerStepV);
        lapZ += texture2D(u_prev, uvAbove).r;
      } else {
        lapZ += center; // boundary condition
      }
      lapZ -= 2.0 * center;

      float prevPrev = texture2D(u_prevPrev, uvCenter).r;
      float src      = texture2D(u_sources, uvCenter).r;

      float next = (2.0 - u_damping) * center
                 - (1.0 - u_damping) * prevPrev
                 + u_c  * u_c  * lapXY
                 + u_cz * u_cz * lapZ
                 + src;

      next = clamp(next, -5.0, 5.0);
      gl_FragColor = vec4(next, 0.0, 0.0, 1.0);
    }
  `
});

const simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMaterial);
simScene.add(simQuad);

// ---------- Source drawing quad (impulses into atlas) ----------
const sourceScene = new THREE.Scene();
const sourceMaterial = new THREE.ShaderMaterial({
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthTest: false,
  depthWrite: false,
  uniforms: {
    u_center:   { value: new THREE.Vector2(0.5, 0.5) }, // atlas UV
    u_radius:   { value: 0.03 },                        // radius in UV space
    u_strength: { value: 2.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform vec2 u_center;
    uniform float u_radius;
    uniform float u_strength;

    void main() {
      float d = distance(vUv, u_center);
      float impulse = exp(- (d * d) / (u_radius * u_radius)) * u_strength;
      gl_FragColor = vec4(impulse, 0.0, 0.0, 1.0);
    }
  `
});

const sourceQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sourceMaterial);
sourceScene.add(sourceQuad);

const pendingSources = []; // { uvx, uvy, layer, strength, radius }

// ---------- Point-cloud visualization over all layers ----------
const pointGeometry = new THREE.BufferGeometry();
const positions = [];
const uvs = [];
const layers = [];

for (let k = 0; k < NUM_LAYERS; k++) {
  const yOffset = (k - (NUM_LAYERS - 1) / 2) * LAYER_SPACING;
  for (let y = 0; y < SIM_SIZE; y++) {
    for (let x = 0; x < SIM_SIZE; x++) {
      const u = x / (SIM_SIZE - 1);
      const v = y / (SIM_SIZE - 1);

      const posX = (u - 0.5) * PLANE_SIZE;
      const posZ = (v - 0.5) * PLANE_SIZE;

      positions.push(posX, yOffset, posZ);
      uvs.push(u, v);
      layers.push(k);
    }
  }
}

pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
pointGeometry.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
pointGeometry.setAttribute('layer',    new THREE.Float32BufferAttribute(layers, 1));

const pointsMaterial = new THREE.ShaderMaterial({
  uniforms: {
    u_heightMap: { value: rtCurr.texture },
    u_amplitude: { value: 0.7 },
    u_pointSize: { value: 0.22 },
    u_layers:    { value: NUM_LAYERS },
  },
  vertexShader: /* glsl */`
    uniform sampler2D u_heightMap;
    uniform float u_amplitude;
    uniform float u_pointSize;
    uniform float u_layers;

    attribute float layer;

    varying float vHeight;

    void main() {
      float L = u_layers;
      vec2 localUv = uv; // 0..1 inside slice

      // UV inside stacked atlas
      float vAtlas = (layer + localUv.y) / L;
      vec2 sampleUv = vec2(localUv.x, vAtlas);

      float h = texture2D(u_heightMap, sampleUv).r;
      vHeight = h;

      vec3 displaced = vec3(position.x,
                            position.y + h * u_amplitude,
                            position.z);

      vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
      gl_Position = projectionMatrix * viewMatrix * worldPos;

      float dist = length(worldPos.xyz - cameraPosition);
      gl_PointSize = u_pointSize * (1.0 / dist) * 80.0;
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying float vHeight;

    void main() {
      vec2 c = gl_PointCoord - 0.5;
      if (dot(c, c) > 0.25) discard;

      float h = vHeight;

      // red–white–blue symmetric map
      float t = clamp(h * 1.5 + 0.5, 0.0, 1.0);
      vec3 blue  = vec3(0.1, 0.2, 0.9);
      vec3 white = vec3(1.0, 1.0, 1.0);
      vec3 red   = vec3(1.0, 0.2, 0.1);

      vec3 midColor = mix(blue,  white, smoothstep(0.0, 0.5, t));
      vec3 color    = mix(midColor, red, smoothstep(0.5, 1.0, t));

      gl_FragColor = vec4(color, 1.0);
    }
  `,
  depthTest: true,
  depthWrite: true,
});
const points = new THREE.Points(pointGeometry, pointsMaterial);
scene.add(points);

// optional grid on bottom layer
const bottomLayerY = (0 - (NUM_LAYERS - 1) / 2) * LAYER_SPACING;
const grid = new THREE.GridHelper(PLANE_SIZE, 20, 0x444444, 0x222222);
grid.position.y = bottomLayerY;
scene.add(grid);

// ---------- Invisible plane for click-to-emit on bottom layer ----------
const clickPlaneGeom = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
const clickPlaneMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.0,
});
const clickPlane = new THREE.Mesh(clickPlaneGeom, clickPlaneMat);
clickPlane.rotation.x = -Math.PI / 2;
clickPlane.position.y = bottomLayerY;
scene.add(clickPlane);

// ---------- Raycaster / input ----------
const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(clickPlane);

  if (hits.length > 0) {
    const uv = hits[0].uv; // 0..1
    // fix orientation (mirroring) to match sim grid
    const uvx = uv.x;
    const uvy = 1.0 - uv.y;

    pendingSources.push({
      uvx,
      uvy,
      layer: 0,          // bottom layer
      strength: 1.0,
      radius: 0.02,
    });
  }
}

renderer.domElement.addEventListener('pointerdown', onPointerDown);

// ---------- Simulation step ----------
function stepSimulation() {
  // 1) clear sources atlas
  renderer.setRenderTarget(sourceRT);
  renderer.setClearColor(0x000000, 1.0);
  renderer.clear();

  // 2) write impulses for this frame
  for (const src of pendingSources) {
    const vAtlas = (src.layer + src.uvy) / NUM_LAYERS; // local->atlas
    sourceMaterial.uniforms.u_center.value.set(src.uvx, vAtlas);
    sourceMaterial.uniforms.u_radius.value   = src.radius;
    sourceMaterial.uniforms.u_strength.value = src.strength;
    renderer.render(sourceScene, simCamera);
  }
  pendingSources.length = 0;

  renderer.setRenderTarget(null);
  renderer.setClearColor(BG_COLOR, 1.0);

  // 3) run compute: rtCurr & rtPrev -> rtTemp
  simMaterial.uniforms.u_prev.value     = rtCurr.texture;
  simMaterial.uniforms.u_prevPrev.value = rtPrev.texture;

  renderer.setRenderTarget(rtTemp);
  renderer.render(simScene, simCamera);
  renderer.setRenderTarget(null);

  // 4) rotate buffers
  const oldPrev = rtPrev;
  rtPrev = rtCurr;
  rtCurr = rtTemp;
  rtTemp = oldPrev;

  // 5) update visualization
  pointsMaterial.uniforms.u_heightMap.value = rtCurr.texture;
}

// ---------- Resize ----------
function onWindowResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onWindowResize);

// ---------- Loop ----------
function animate() {
  requestAnimationFrame(animate);
  stepSimulation();
  //controls.update(); 
  renderer.render(scene, camera);
}

animate();
