// MODULE IMPORTS

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { GLTFLoader } from 'GLTFLoader';
import { EffectComposer } from 'EffectComposer';
import { RenderPass } from 'RenderPass';
import { UnrealBloomPass } from 'UnrealBloomPass';
import { ShaderPass } from 'ShaderPass';




let scene, camera, renderer;
let controls;
let composer;
let clock;
let mixer = null;      // for animations from the GLTF, if any
let model = null;      // reference to the loaded model


// Materials + mode
let gridMaterial;
let gridWireMaterial;
let gridPointsMaterial;
let solidMaterial;
let basicMaterial;
let currentMaterialMode = 'grid';





function createGridMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uLineColor: { value: new THREE.Color(0x00ff00) }, // neon green
            uBgColor: { value: new THREE.Color(0x000000) }, // black
            uScale: { value: 0.2 },   // grid density
            uThickness: { value: 0.02 }   // line thickness
        },
        vertexShader: `
            varying vec3 vWorldPos;
            varying vec3 vWorldNormal;

            void main() {
                // world-space position
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPos.xyz;

                // world-space normal (assumes uniform scaling)
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
                // Use the dominant normal component to choose projection plane
                vec3 n  = normalize(vWorldNormal);
                vec3 an = abs(n);

                vec2 coord;

                if (an.y >= an.x && an.y >= an.z) {
                    // Top/bottom faces -> project onto XZ
                    coord = vWorldPos.xz;
                } else if (an.x >= an.y && an.x >= an.z) {
                    // Faces pointing +/-X -> project onto YZ
                    coord = vWorldPos.zy; // (z, y)
                } else {
                    // Faces pointing +/-Z -> project onto XY
                    coord = vWorldPos.xy;
                }

                // Scale controls cell size
                coord *= uScale;

                // Make repeating 0..1 pattern
                vec2 grid = abs(fract(coord) - 0.5);

                // Distance to nearest line in either direction
                float distToLine = min(grid.x, grid.y);

                // Line mask
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
            uLineColor: { value: new THREE.Color(0x00ff00) }, // neon green
            uScale: { value: 0.2 },   // grid density
            uThickness: { value: 0.02 }   // line thickness
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
                // dominant-axis planar mapping (same as solid grid)
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

                // line mask
                float mask = step(distToLine, uThickness);

                // neon lines with alpha only on lines
                vec3 color = uLineColor;
                float alpha = mask;

                if (alpha <= 0.0) discard; // optional: fully discard non-line fragments

                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,                  // allow alpha
        depthWrite: false,                  // avoid depth-writing issues with transparency
        side: THREE.DoubleSide,             // see the wires from inside & outside
        blending: THREE.AdditiveBlending    // nice glow when lines overlap
    });
}




function createGridPointsMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uPointColor: { value: new THREE.Color(0x00ff00) }, // neon green
            uScale: { value: 0.75 },   // higher = denser points
            uRadius: { value: 0.10 }    // point size inside each cell (0–0.5)
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
                // dominant-axis planar mapping (same as the other materials)
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

                // Scale = how dense the grid is
                coord *= uScale;

                // Local coords inside each cell, centered at 0,0
                vec2 local = fract(coord) - 0.5;

                // Distance from cell center -> roundish dots
                float dist = length(local);

                // Mask: only keep fragments close enough to cell centers
                float mask = step(dist, uRadius);

                if (mask <= 0.0) discard;

                vec3 color = uPointColor;
                gl_FragColor = vec4(color, mask);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });
}




function applyMaterialMode(mode) {
    currentMaterialMode = mode;

    if (!model) return; // model not loaded yet

    model.traverse((child) => {
        if (!child.isMesh) return;

        switch (mode) {
            case 'grid':
                if (gridMaterial) child.material = gridMaterial;
                break;

            case 'gridTransparent':
                if (gridWireMaterial) child.material = gridWireMaterial;
                break;

            case 'gridPoints':
                if (gridPointsMaterial) child.material = gridPointsMaterial;
                break;
        }
    });
}





function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); // or any background color you want

    // Camera
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        2000
    );

    // Higher and further away, looking down at the city
    camera.position.set(0, 500, -500);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    document.body.appendChild(renderer.domElement);


    // Uniform lighting: simple ambient light, no shadows
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    // OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Focus closer to the base of the model
    controls.target.set(0, 0, 0);
    controls.update();



    // Post-processing
    composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5,   // strength
        0.2,   // radius
        0.1    // threshold
    );

    //composer.addPass(bloomPass);



    // === GRID MATERIAL SETUP ===
    gridMaterial = createGridMaterial();
    gridWireMaterial = createGridWireMaterial();
    gridPointsMaterial = createGridPointsMaterial();

    // shared color for all modes
    const neonColor = new THREE.Color(0x00ff00);

    // Solid unlit neon
    solidMaterial = new THREE.MeshBasicMaterial({
        color: neonColor
    });

    // Lit neon (responds to lights, in case you add them later)
    basicMaterial = new THREE.MeshStandardMaterial({
        color: neonColor,
        metalness: 0.1,
        roughness: 0.4
    });




    // === GUI WIRING ===
    const materialSelect = document.getElementById('material-select');
    if (materialSelect) {
        materialSelect.value = currentMaterialMode;

        materialSelect.addEventListener('change', (event) => {
            const mode = event.target.value;
            applyMaterialMode(mode);
        });
    }


    // Clock for animations
    clock = new THREE.Clock();


    // GLTF Loader
    const loader = new GLTFLoader();

    // Replace this path with your actual model path:
    // e.g. 'models/myModel.glb' or 'assets/city.gltf'
    loader.load(
        'models/obstacle1.glb', // <-- change to your file
        (gltf) => {
            model = gltf.scene;
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = false;

                    // keep a reference to the original GLTF material
                    child.userData.originalMaterial = child.material;

                    // default material (will get overridden by applyMaterialMode anyway)
                    child.material = gridMaterial;
                }
            });

            // Apply whatever mode is currently selected in the GUI
            applyMaterialMode(currentMaterialMode);


            // Position/scale your model so it looks good
            model.position.set(0, 0, 0);
            model.scale.set(1, 1, 1); // adjust if it’s too big or too small

            scene.add(model);

            // Handle animations if present
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(model);
                gltf.animations.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    action.play();
                });
            }

            console.log('GLTF model loaded:', gltf);
        },
        (xhr) => {
            // progress callback (optional)
            if (xhr.total) {
                console.log(`${(xhr.loaded / xhr.total) * 100}% loaded`);
            } else {
                console.log(`${xhr.loaded} bytes loaded`);
            }
        },
        (error) => {
            console.error('An error happened while loading the GLTF:', error);
        }
    );


    window.addEventListener('resize', onWindowResize);
}







function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);

    controls.update();

    // If you’re using post-processing:
    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}




function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);

    if (composer) {
        composer.setSize(width, height);
    }
}




init();
animate();


