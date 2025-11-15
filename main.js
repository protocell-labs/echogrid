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

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7.5);
    dirLight.castShadow = true;
    scene.add(dirLight);

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
        1.2,   // strength
        0.4,   // radius
        0.85   // threshold
    );
    composer.addPass(bloomPass);




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
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

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


