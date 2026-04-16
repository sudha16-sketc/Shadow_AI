// HeroModel.jsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { useGLTF, useAnimations, OrbitControls } from "@react-three/drei";

function Model({ url }) {
  const group = useRef();

  const { scene, animations } = useGLTF(url);
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    if (actions) {
      Object.values(actions).forEach((action) => {
        action.reset().fadeIn(0.5).play();
        action.setLoop(THREE.LoopRepeat);
      });
    }
  }, [actions]);

  return <primitive ref={group} object={scene} scale={2} />;
}

export default function HeroModel() {
  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 1, 5], fov: 60 }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={1} />
        <directionalLight position={[5, 5, 5]} intensity={2} />

        <Model url="/buster_drone.glb" />

        <OrbitControls enableZoom={false} />
      </Canvas>
    </div>
  );
}