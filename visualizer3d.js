/**
 * Three.js Cryptographic Signature Core
 * Visualizes cryptographic state, key generation, and message dispatches.
 */

export class CryptoVisualizer {
  constructor(canvasContainerId) {
    this.container = document.getElementById(canvasContainerId);
    if (!this.container) return;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.coreMesh = null;
    this.wireMesh = null;
    this.innerMesh = null;
    this.particles = null;
    this.rings = [];
    this.animationFrameId = null;
    this.isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.theme = document.documentElement.getAttribute('data-theme') || 'dark';

    this.state = {
      hasKey: false,
      pulseValue: 0,
      pulseSpeed: 0,
      targetSpeed: 0.008,
      rotationSpeedX: 0.004,
      rotationSpeedY: 0.008,
      burstTimer: 0,
      baseColor: 0x5ce1e6,
      accentColor: 0x22c55e,
      restingColor: 0x4f566b
    };

    this.init();
  }

  init() {
    if (typeof THREE === 'undefined') {
      console.warn('Three.js is not loaded.');
      return;
    }

    const width = this.container.clientWidth || 240;
    const height = this.container.clientHeight || 180;

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.z = 4.6;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    // Build Meshes
    this.createMeshes();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x5ce1e6, 2, 10);
    pointLight.position.set(2, 3, 4);
    this.scene.add(pointLight);
    this.pointLight = pointLight;

    // Handle Resize
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);

    // Start Loop
    this.animate = this.animate.bind(this);
    this.animate();
  }

  createMeshes() {
    // Outer wireframe icosahedron
    const outerGeo = new THREE.IcosahedronGeometry(1.2, 1);
    const wireMat = new THREE.MeshBasicMaterial({
      color: this.state.restingColor,
      wireframe: true,
      transparent: true,
      opacity: 0.4
    });
    this.wireMesh = new THREE.Mesh(outerGeo, wireMat);
    this.scene.add(this.wireMesh);

    // Core solid faceted polyhedron
    const coreGeo = new THREE.OctahedronGeometry(0.7, 0);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x14161b,
      emissive: this.state.restingColor,
      emissiveIntensity: 0.2,
      roughness: 0.2,
      metalness: 0.8,
      flatShading: true
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.scene.add(this.coreMesh);

    // Inner glowing seed
    const innerGeo = new THREE.DodecahedronGeometry(0.35, 0);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x5ce1e6,
      wireframe: true,
      transparent: true,
      opacity: 0.6
    });
    this.innerMesh = new THREE.Mesh(innerGeo, innerMat);
    this.scene.add(this.innerMesh);

    // Orbit Ring
    const ringGeo = new THREE.RingGeometry(1.55, 1.58, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: this.state.restingColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 3;
    this.scene.add(ring);
    this.rings.push(ring);

    // Particle nodes for telemetry
    const particleCount = 40;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const r = 1.4 + Math.random() * 0.5;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: this.state.restingColor,
      size: 0.04,
      transparent: true,
      opacity: 0.5
    });
    this.particles = new THREE.Points(particleGeo, particleMat);
    this.scene.add(this.particles);
  }

  setTheme(theme) {
    this.theme = theme;
    const isDark = theme === 'dark';
    this.state.restingColor = isDark ? 0x4f566b : 0x94a3b8;
    this.state.baseColor = isDark ? 0x5ce1e6 : 0x0284c7;
    this.state.accentColor = isDark ? 0x22c55e : 0x16a34a;

    if (!this.state.hasKey) {
      if (this.wireMesh) this.wireMesh.material.color.setHex(this.state.restingColor);
      if (this.particles) this.particles.material.color.setHex(this.state.restingColor);
      if (this.rings[0]) this.rings[0].material.color.setHex(this.state.restingColor);
      if (this.coreMesh) {
        this.coreMesh.material.color.setHex(isDark ? 0x14161b : 0xe2e8f0);
        this.coreMesh.material.emissive.setHex(this.state.restingColor);
      }
    }
  }

  onKeyGenerated(did) {
    this.state.hasKey = true;
    this.state.burstTimer = 1.0;
    this.state.pulseSpeed = 0.08;

    // Seed colors and speeds from DID characters
    let seedVal = 0;
    for (let i = 0; i < did.length; i++) {
      seedVal = (seedVal + did.charCodeAt(i) * 17) % 360;
    }

    const isDark = this.theme === 'dark';
    const activeColor = isDark ? 0x5ce1e6 : 0x0284c7;
    const activeAccent = isDark ? 0x22c55e : 0x16a34a;

    if (this.wireMesh) {
      this.wireMesh.material.color.setHex(activeColor);
      this.wireMesh.material.opacity = 0.85;
    }
    if (this.coreMesh) {
      this.coreMesh.material.emissive.setHex(activeAccent);
      this.coreMesh.material.emissiveIntensity = 0.8;
    }
    if (this.innerMesh) {
      this.innerMesh.material.color.setHex(activeColor);
      this.innerMesh.material.opacity = 0.95;
    }
    if (this.particles) {
      this.particles.material.color.setHex(activeColor);
      this.particles.material.opacity = 0.9;
    }
    if (this.pointLight) {
      this.pointLight.color.setHex(activeColor);
    }
    if (this.rings[0]) {
      this.rings[0].material.color.setHex(activeAccent);
      this.rings[0].material.opacity = 0.6;
    }
  }

  onKeyCleared() {
    this.state.hasKey = false;
    const isDark = this.theme === 'dark';
    const rest = isDark ? 0x4f566b : 0x94a3b8;

    if (this.wireMesh) {
      this.wireMesh.material.color.setHex(rest);
      this.wireMesh.material.opacity = 0.35;
      this.wireMesh.scale.set(1, 1, 1);
    }
    if (this.coreMesh) {
      this.coreMesh.material.color.setHex(isDark ? 0x14161b : 0xe2e8f0);
      this.coreMesh.material.emissive.setHex(rest);
      this.coreMesh.material.emissiveIntensity = 0.2;
    }
    if (this.innerMesh) {
      this.innerMesh.material.color.setHex(rest);
      this.innerMesh.material.opacity = 0.4;
    }
    if (this.particles) {
      this.particles.material.color.setHex(rest);
      this.particles.material.opacity = 0.4;
    }
    if (this.rings[0]) {
      this.rings[0].material.color.setHex(rest);
      this.rings[0].material.opacity = 0.25;
    }
  }

  onMessageDispatched() {
    // Pulse animation
    this.state.burstTimer = 1.0;
    this.state.pulseValue = 0.35;
  }

  onResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    this.animationFrameId = requestAnimationFrame(this.animate);

    if (this.isReducedMotion) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const rotSpeed = this.state.hasKey ? 0.012 : 0.005;

    if (this.wireMesh) {
      this.wireMesh.rotation.x += rotSpeed * 0.7;
      this.wireMesh.rotation.y += rotSpeed;
    }

    if (this.coreMesh) {
      this.coreMesh.rotation.x -= rotSpeed * 1.2;
      this.coreMesh.rotation.y -= rotSpeed * 0.8;
    }

    if (this.innerMesh) {
      this.innerMesh.rotation.y += rotSpeed * 2.0;
    }

    if (this.particles) {
      this.particles.rotation.y -= rotSpeed * 0.5;
      this.particles.rotation.z += rotSpeed * 0.3;
    }

    if (this.rings[0]) {
      this.rings[0].rotation.z += rotSpeed * 0.8;
    }

    // Burst damping
    if (this.state.burstTimer > 0) {
      this.state.burstTimer -= 0.03;
      const s = 1 + Math.sin(this.state.burstTimer * Math.PI) * 0.25;
      if (this.wireMesh) this.wireMesh.scale.set(s, s, s);
      if (this.innerMesh) this.innerMesh.scale.set(s * 1.2, s * 1.2, s * 1.2);
    } else {
      if (this.wireMesh) this.wireMesh.scale.set(1, 1, 1);
      if (this.innerMesh) this.innerMesh.scale.set(1, 1, 1);
    }

    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.remove();
    }
  }
}
