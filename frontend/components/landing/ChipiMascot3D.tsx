"use client";

// Mascota de Chipi en 3D real, cargada desde /models/Chipi_Waving.glb
// (malla + animación de saludo). Sigue el mismo patrón de montaje que
// HeroScene.tsx: escena/cámara/renderer manual, sin @react-three/fiber,
// con su propio loop de animación y cleanup en el unmount.
//
// Para que no se vea "flotando" como un objeto pegado en la sección:
//  - El canvas queda con fondo transparente (alpha: true) y se monta
//    dentro del mismo halo/resplandor decorativo que usaba la versión 2D.
//  - Hay una sombra de contacto (elipse CSS difuminada) anclada a la
//    base del contenedor, igual que la sombra del SVG anterior.
//  - Las luces usan los mismos tonos rosa/púrpura del gradiente de fondo
//    de ChipiSection, en vez de una luz blanca genérica de "visor".
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Loader2 } from "lucide-react";

const MODEL_URL = "/models/Chipi_Waving.glb";

export default function ChipiMascot3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;

    // ─── Escena base (mismo esqueleto que HeroScene) ───
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      32,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0.15, 6.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // ─── Luces con la misma paleta rosa/púrpura de la sección ───
    const ambient = new THREE.AmbientLight("#fce7f3", 1.1); // pink-100, luz de relleno suave
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight("#ffffff", 1.4);
    keyLight.position.set(2.5, 4, 5);
    scene.add(keyLight);

    const pinkRim = new THREE.PointLight("#ec4899", 6, 15); // pink-500
    pinkRim.position.set(-3, 1, 3);
    scene.add(pinkRim);

    const purpleRim = new THREE.PointLight("#a855f7", 5, 15); // purple-500
    purpleRim.position.set(3, -1, -2);
    scene.add(purpleRim);

    // ─── Carga del modelo ───
    const loader = new GLTFLoader();
    let mixer: THREE.AnimationMixer | null = null;
    let modelRoot: THREE.Object3D | null = null;
    let actionA: THREE.AnimationAction | null = null;
    let actionB: THREE.AnimationAction | null = null;
    let loopDuration = 0;

    loader.load(
      MODEL_URL,
      (gltf) => {
        if (cancelled) return;
        modelRoot = gltf.scene;

        // Centrar el modelo en el origen (sin re-escalarlo — dejamos que
        // sea la cámara la que se ajuste al tamaño real del .glb, así no
        // dependemos de adivinar en qué unidades se exportó la malla).
        const box = new THREE.Box3().setFromObject(modelRoot);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        modelRoot.position.x -= center.x;
        modelRoot.position.y -= center.y;
        modelRoot.position.z -= center.z;

        scene.add(modelRoot);

        // Encuadre: calculamos la distancia de cámara necesaria para que
        // el cuerpo completo (alto Y ancho) entre en el frame, con margen
        // (`framePadding`) para que no quede pegado al anillo decorativo.
        // Antes había un "targetHeight" fijo que asumía un tamaño de malla
        // que no coincidía con el .glb re-exportado, y eso dejaba la
        // cámara metida dentro del modelo (por eso se veía recortado y
        // mirando hacia arriba, desde la barbilla).
        const fovRad = (camera.fov * Math.PI) / 180;
        const aspect = mount.clientWidth / mount.clientHeight;
        const framePadding = 1.15;
        const distanceForHeight =
          (size.y * framePadding) / (2 * Math.tan(fovRad / 2));
        const distanceForWidth =
          (size.x * framePadding) / (2 * Math.tan(fovRad / 2) * aspect);
        const distance = Math.max(distanceForHeight, distanceForWidth);

        camera.position.set(0, 0, distance);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(modelRoot);
          // El clip completo (exportado de Mixamo) no está pensado para
          // loopear. Los frames 15-56 (de 62, a 24fps) son el mejor punto
          // de corte que hay en los datos (encontrado comparando pose Y
          // velocidad de cada hueso), pero el match sigue sin ser
          // perfecto — por eso el corte se seguía notando con un solo
          // action en LoopRepeat.
          //
          // Para tapar ese resto de imperfección: se reproducen DOS
          // copias del mismo subclip en paralelo, desfasadas medio ciclo
          // entre sí, y se cruza el peso de una a la otra con una ventana
          // seno que vale ~0 justo en el corte de cada copia y ~1 a
          // mitad de su ciclo. Como están desfasadas medio ciclo, cuando
          // una está pasando por su corte la otra está a mitad de
          // camino (peso alto) — el corte nunca queda visible.
          const sourceClip = gltf.animations[0];
          const LOOP_FPS = 24;
          const LOOP_START_FRAME = 15;
          const LOOP_END_FRAME = 56;
          const waveClipA = THREE.AnimationUtils.subclip(
            sourceClip,
            "chipiWaveLoopA",
            LOOP_START_FRAME,
            LOOP_END_FRAME,
            LOOP_FPS
          );
          const waveClipB = waveClipA.clone();
          waveClipB.name = "chipiWaveLoopB";
          loopDuration = waveClipA.duration;

          actionA = mixer.clipAction(waveClipA);
          actionB = mixer.clipAction(waveClipB);
          [actionA, actionB].forEach((a) => {
            a.setLoop(THREE.LoopRepeat, Infinity);
            a.play();
          });
          actionB.time = loopDuration / 2; // desfasada medio ciclo
        }

        setLoaded(true);
      },
      undefined,
      (error) => {
        console.error("No se pudo cargar Chipi_Waving.glb:", error);
        if (!cancelled) setFailed(true);
      }
    );

    // ─── Interacción con mouse (parallax sutil, igual que HeroScene) ───
    const mouse = { x: 0, y: 0 };
    const handleMouseMove = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      mouse.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    window.addEventListener("mousemove", handleMouseMove);

    // ─── Loop de animación ───
    const clock = new THREE.Clock();
    let frameId: number;

    const animate = () => {
      const delta = clock.getDelta();
      mixer?.update(delta);

      if (actionA && actionB && loopDuration > 0) {
        // Ventana seno: ~0 en el corte del clip (t=0 o t=duration), ~1
        // a mitad de camino. Como B está desfasada medio ciclo, sus
        // "puntos ciegos" (peso 0) coinciden con la mitad segura de A
        // y viceversa — normalizado para que siempre sumen 1.
        const wA = Math.max(0, Math.sin((Math.PI * actionA.time) / loopDuration));
        const wB = Math.max(0, Math.sin((Math.PI * actionB.time) / loopDuration));
        const sum = wA + wB || 1;
        actionA.setEffectiveWeight(wA / sum);
        actionB.setEffectiveWeight(wB / sum);
      }

      if (modelRoot) {
        modelRoot.rotation.y += (mouse.x * 0.35 - modelRoot.rotation.y) * 0.04;
      }

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
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      mixer?.stopAllAction();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      if (mount && renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full max-w-[280px] mx-auto h-[420px]">
      {/* Resplandor detrás de la mascota — mismo halo que la versión 2D */}
      <div className="absolute -inset-8 bg-gradient-to-br from-pink-500/30 via-rose-500/20 to-purple-500/30 rounded-full blur-2xl scale-90 animate-pulse pointer-events-none" />
      {/* Anillo punteado decorativo */}
      <div className="absolute inset-2 rounded-full border-2 border-dashed border-pink-400/25 animate-spin-slow pointer-events-none" />
      {/* Sombra de contacto en el piso, para anclar el modelo a la sección */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-40 h-6 bg-slate-950/30 rounded-full blur-md pointer-events-none" />

      <div ref={mountRef} className="relative w-full h-full" />

      {!loaded && !failed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-8 h-8 text-pink-300 animate-spin" />
        </div>
      )}

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-xs text-slate-400 px-6">
          No se pudo cargar la mascota 3D.
        </div>
      )}

      {/* Destellos junto a la mascota, igual que en la versión 2D */}
      <span className="absolute top-[26%] right-[6%] w-2.5 h-2.5 rounded-full bg-pink-300 animate-ping" />
      <span className="absolute top-[18%] right-[16%] w-1.5 h-1.5 rounded-full bg-purple-300 animate-ping" style={{ animationDelay: "0.6s" }} />
    </div>
  );
}
