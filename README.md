# ECHOGRID – Urban-Scale Radio Wave Visualizer

[![Watch the video](https://img.youtube.com/vi/Sk3Tj72p_X4/maxresdefault.jpg)](https://www.youtube.com/watch?v=Sk3Tj72p_X4)

**ECHOGRID** is an interactive, WebGL-powered electromagnetic wave visualizer that simulates **radio wave interference** inside a 3D urban environment. The app loads a GLB model of a Hong Kong block section and visualizes how multiple electromagnetic emitters interfere through 3D space.

This project is a design prototype built with **Three.js** and **custom GLSL shaders**, developed within 24h during the Junction Utopia & Dystopia 2025 hackathon in Espoo, Finland.

🌐 [*Live demo (hosted on GitHub Pages)*](https://protocell-labs.github.io/echogrid/)


## Features


* **3D electromagnetic interference field**

  * Fully real-time wave superposition using GPU shaders
  * Adjustable emitter positions, frequencies, and motion
  * Dense volumetric point cloud simulation

* **Interactive UI**

  * Control field size, density, source positions, and frequency in real time
  * Automatic source movement with wandering behavior
  * Multiple rendering modes (solid grid, wire grid, point field)

* **Urban-scale context**

  * Loads a **GLB model** of a Hong Kong building block
  * Scene navigation via OrbitControls

* **Custom wave physics**

  * Simple propagation model
  * Frequency-dependent phase and wavelength
  * Per-point height and color based on interference amplitude


## Not Implemented Yet

* **Obstacle occlusion / wave shadowing**
  The simulation currently ignores geometry collisions.
  Implementing real wave–geometry interaction is a planned future step.


## Technologies Used

* **Three.js** (renderer, camera, OrbitControls, GLB loading)
* **GLSL compute-style point shaders** (wave simulation)
* **WebGL 2**
* **GitHub Pages** for deployment
* **ChatGPT 5.1** as a coding and editing aid


## Running Locally

No build step needed.

```
git clone <repo>
cd <repo>
python3 -m http.server
```

Then open:

```
http://localhost:8000
```


## Resources

Following resources were used to help build this project.

[Three-Dimensional Ray-Tracing-Based Propagation Prediction Model for Macrocellular Environment at Sub-6 GHz Frequencies - article](https://www.mdpi.com/2079-9292/13/8/1451)

[Solving a maze with waves: 3D rendering - YouTube](https://youtu.be/cyXDuhckvC8)

[3D waves in a Penrose unilluminable room - YouTube](https://youtu.be/hwoj_8RGoSE)

[A 3D Simulation Framework with Ray-Tracing Propagation for LoRaWAN Communication - GitHub](https://github.com/girtel/3DLoRaSimulator)

[And the winner is: The fastest particles solving a mazee - YouTube](https://youtu.be/vp5tyRyAxAI)

[Solving a maze with laser beams - YouTube](https://youtu.be/Ski3UOUtIdA)

[A 3D simulation framework with ray-tracing propagation for LoRaWAN communication - article](https://www.sciencedirect.com/science/article/pii/S2542660523002871#fn17)

[Ray Tracing for Wireless Communications - article](https://www.mathworks.com/help/comm/ug/ray-tracing-for-wireless-communications.html)

[WiThRay: A Versatile Ray-Tracing Simulator for Smart Wireless Environments - article](https://arxiv.org/pdf/2304.11385)

[Real-Time Electromagnetic Wave Simulator - YouTube](https://youtu.be/QlmfpFVq9Zo)

[A decade of WiFi - article](https://jasmcole.com/2024/10/18/a-decade-of-wifi/)


## License and copyright

MIT License (see LICENSE file). Copyright (c) 2025 {protocell:labs}