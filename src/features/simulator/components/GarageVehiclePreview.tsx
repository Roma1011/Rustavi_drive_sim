import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { Group, MathUtils } from 'three';
import { CarModel } from '../../../entities/car/CarModel';

function PreviewRig() {
  const groupRef = useRef<Group>(null);

  useFrame((state, delta) => {
    const group = groupRef.current;

    if (!group) {
      return;
    }

    group.rotation.y += delta * 0.38;
    group.rotation.x = MathUtils.damp(group.rotation.x, -0.08, 6, delta);
  });

  return (
    <group ref={groupRef} position={[0.8, -1.02, 0]} scale={1.14}>
      <CarModel bodyLean={0} />
    </group>
  );
}

export function GarageVehiclePreview() {
  return (
    <Canvas
      camera={{ fov: 31, position: [0, 1.32, 6.6] }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true }}
      shadows
    >
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#dff6ff', '#15314d', 1.2]} />
      <directionalLight castShadow intensity={1.9} position={[5, 8, 6]} shadow-mapSize-height={1024} shadow-mapSize-width={1024} />
      <directionalLight intensity={0.8} position={[-5, 4, -3]} />
      <Suspense fallback={null}>
        <PreviewRig />
        <ContactShadows
          blur={2.8}
          color="#0c1826"
          far={7}
          opacity={0.75}
          position={[0, -0.92, 0]}
          resolution={1024}
          scale={8.5}
        />
      </Suspense>
    </Canvas>
  );
}
