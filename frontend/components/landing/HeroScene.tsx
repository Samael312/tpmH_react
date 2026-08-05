"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function HeroScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ─── Escena base ───
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 9);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // ─── Campo de partículas (esfera de puntos) ───
    const PARTICLE_COUNT = 1400;
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const basePositions = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const radius = 4.2 + Math.random() * 1.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta) * 0.6;
      const z = radius * Math.cos(phi);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      basePositions[i * 3] = x;
      basePositions[i * 3 + 1] = y;
      basePositions[i * 3 + 2] = z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );

    const material = new THREE.PointsMaterial({
      size: 0.045,
      color: new THREE.Color("#f472b6"), // pink-400
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // Segunda capa, más tenue, en rose/rosa claro, rotando al revés
    const material2 = material.clone();
    material2.color = new THREE.Color("#fda4af"); // rose-300
    material2.opacity = 0.45;
    material2.size = 0.03;
    const points2 = new THREE.Points(geometry, material2);
    points2.scale.setScalar(1.35);
    scene.add(points2);

    // Luz suave (no afecta a PointsMaterial pero deja el hook listo si se
    // agregan mallas sólidas más adelante)
    const light = new THREE.PointLight("#ec4899", 2, 20);
    light.position.set(3, 3, 5);
    scene.add(light);

    // ─── Interacción con mouse (parallax sutil) ───
    const mouse = { x: 0, y: 0 };
    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", handleMouseMove);

    // ─── Loop de animación ───
    // ─── Loop de animación ───
    const startTime = performance.now();
    let frameId: number;

    const animate = () => {
      const t = (performance.now() - startTime) / 1000;

      // Ondulación orgánica de las partículas
      const posAttr = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3;
        const wave =
          Math.sin(t * 0.6 + basePositions[ix] * 0.5) * 0.15 +
          Math.cos(t * 0.4 + basePositions[ix + 2] * 0.5) * 0.15;
        posAttr.array[ix + 1] = basePositions[ix + 1] + wave;
      }
      posAttr.needsUpdate = true;

      points.rotation.y = t * 0.06 + mouse.x * 0.15;
      points.rotation.x = mouse.y * 0.08;
      points2.rotation.y = -t * 0.04 - mouse.x * 0.1;
      points2.rotation.x = -mouse.y * 0.05;

      camera.position.x += (mouse.x * 0.6 - camera.position.x) * 0.02;
      camera.position.y += (-mouse.y * 0.4 - camera.position.y) * 0.02;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    // ─── Resize ───
    const handleResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    // ─── Cleanup ───
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      geometry.dispose();
      material.dispose();
      material2.dispose();
      renderer.dispose();
      if (mount && renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}