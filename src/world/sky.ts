import * as THREE from 'three';

/** Gradient sky dome with a soft sun glow. Follows the camera. */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(-0.35, 0.3, -0.88).normalize() },
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSun;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          float h = max(vDir.y, 0.0);
          vec3 color = mix(uHorizon, uTop, pow(h, 0.6));
          float sun = max(dot(normalize(vDir), uSunDir), 0.0);
          color += uSun * (pow(sun, 400.0) * 0.9 + pow(sun, 12.0) * 0.18);
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  update(camera: THREE.Camera, top: THREE.Color, horizon: THREE.Color, sun: THREE.Color): void {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTop.value.copy(top);
    this.uniforms.uHorizon.value.copy(horizon);
    this.uniforms.uSun.value.copy(sun);
  }
}
