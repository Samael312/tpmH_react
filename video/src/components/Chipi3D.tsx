import { ThreeCanvas } from "@remotion/three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useThree } from "@react-three/fiber";

// El mismo modelo que la landing (frontend/public/models/Chipi_Waving.glb) y el mismo bucle de saludo sin corte
// que components/landing/ChipiMascot3D.tsx: dos copias del subclip (frames 15-56 a 24 fps) desfasadas medio ciclo,
// con pesos en ventana seno. Aquí el tiempo sale del número de frame, así cada frame del render es determinista.

let gltfPromise: Promise<GLTF> | null = null;
function loadChipi(): Promise<GLTF> {
  if (!gltfPromise) {
    gltfPromise = new Promise((resolve, reject) => {
      new GLTFLoader().load(staticFile("chipi.glb"), resolve, undefined, reject);
    });
  }
  return gltfPromise;
}

const LOOP_FPS = 24;
const LOOP_START = 15;
const LOOP_END = 56;

function ChipiModel({ gltf, yaw, onReady }: { gltf: GLTF; yaw: number; onReady: () => void }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const advance = useThree((s) => s.advance);

  // Una copia por instancia (el GLB se carga una vez y se clona con su esqueleto).
  const { root, mixer, a, b, loop, bodySize } = useMemo(() => {
    const root = cloneSkinned(gltf.scene);
    const group = new THREE.Group();
    group.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const clip = THREE.AnimationUtils.subclip(gltf.animations[0], "waveA", LOOP_START, LOOP_END, LOOP_FPS);
    const clipB = clip.clone();
    clipB.name = "waveB";
    const a = mixer.clipAction(clip);
    const b = mixer.clipAction(clipB);
    [a, b].forEach((x) => {
      x.setLoop(THREE.LoopRepeat, Infinity);
      x.play();
    });
    // Mide el cuerpo ya posado (caja precisa sobre los vértices con piel); la caja rápida de una malla con esqueleto
    // ignora la escala de los huesos y sale ~100 veces más pequeña. Luego se normaliza a 2 unidades de alto.
    mixer.update(0);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group, true);
    const raw = box.getSize(new THREE.Vector3());
    const k = 2 / Math.max(raw.y, 1e-6);
    root.position.sub(box.getCenter(new THREE.Vector3()));
    group.scale.setScalar(k);
    return { root: group, mixer, a, b, loop: clip.duration, bodySize: raw.multiplyScalar(k) };
  }, [gltf]);

  // Encuadre: todo el cuerpo dentro del canvas con un poco de margen (igual que la web). Se hace durante el render,
  // no en un efecto: Remotion captura el frame en cuanto React termina y un efecto llegaría un frame tarde.
  const fov = (camera.fov * Math.PI) / 180;
  const aspect = size.width / size.height;
  const pad = 1.12;
  const d = Math.max((bodySize.y * pad) / (2 * Math.tan(fov / 2)), (bodySize.x * pad) / (2 * Math.tan(fov / 2) * aspect));
  if (camera.position.z !== d) {
    camera.position.set(0, 0, d);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  // ThreeCanvas de Remotion solo pinta cuando cambia el frame: se fuerza un pintado con el modelo ya montado
  // y se libera el render después, para que ningún fotograma salga sin Chipi.
  useEffect(() => {
    advance(performance.now());
    const id = requestAnimationFrame(() => {
      advance(performance.now());
      onReady();
    });
    return () => cancelAnimationFrame(id);
  }, [advance, onReady]);

  const t = frame / fps;
  const tA = t % loop;
  const tB = (t + loop / 2) % loop;
  a.time = tA;
  b.time = tB;
  a.setEffectiveWeight(Math.max(0.001, Math.sin((Math.PI * tA) / loop)));
  b.setEffectiveWeight(Math.max(0.001, Math.sin((Math.PI * tB) / loop)));
  mixer.update(0);
  root.rotation.y = yaw + Math.sin(t * 1.3) * 0.12; // balanceo suave, como en la landing

  return <primitive object={root} />;
}

/** Copia un objeto con mallas con esqueleto (SkeletonUtils.clone, sin depender de su ruta de import). */
function cloneSkinned(source: THREE.Object3D): THREE.Object3D {
  const sourceLookup = new Map<THREE.Object3D, THREE.Object3D>();
  const cloneLookup = new Map<THREE.Object3D, THREE.Object3D>();
  const clone = source.clone();
  const walk = (a: THREE.Object3D, b: THREE.Object3D) => {
    sourceLookup.set(b, a);
    cloneLookup.set(a, b);
    a.children.forEach((c, i) => walk(c, b.children[i]));
  };
  walk(source, clone);
  clone.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const src = sourceLookup.get(node) as THREE.SkinnedMesh;
    mesh.skeleton = src.skeleton.clone();
    mesh.bindMatrix.copy(src.bindMatrix);
    mesh.skeleton.bones = src.skeleton.bones.map((bone) => cloneLookup.get(bone) as THREE.Bone);
    mesh.bind(mesh.skeleton, mesh.bindMatrix);
  });
  return clone;
}

export function Chipi3D({ width, height, yaw = 0 }: { width: number; height: number; yaw?: number }) {
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const [handle] = useState(() => delayRender("Cargando chipi.glb"));
  const released = useRef(false);
  const release = useCallback(() => {
    if (released.current) return;
    released.current = true;
    continueRender(handle);
  }, [handle]);
  useEffect(() => {
    loadChipi()
      .then(setGltf)
      .catch((e) => {
        console.error("No se pudo cargar chipi.glb", e);
        release();
      });
  }, [release]);

  // El lienzo se monta cuando el GLB ya está cargado, así su primer pintado ya incluye el modelo.
  if (!gltf) return <div style={{ width, height }} />;
  return (
    <ThreeCanvas width={width} height={height} camera={{ fov: 30, near: 0.1, far: 100 }} gl={{ antialias: true, alpha: true }}>
      {/* Luces con la paleta rosa/púrpura de la sección de Chipi en la web */}
      <ambientLight color="#fce7f3" intensity={1.6} />
      <directionalLight color="#ffffff" intensity={2.1} position={[2.5, 4, 5]} />
      <pointLight color="#ec4899" intensity={8} distance={15} position={[-3, 1, 3]} />
      <pointLight color="#a855f7" intensity={7} distance={15} position={[3, -1, -2]} />
      <ChipiModel gltf={gltf} yaw={yaw} onReady={release} />
    </ThreeCanvas>
  );
}
