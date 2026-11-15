// Realistische Beleuchtung: Himmel mit Sonne (Garten) und Studio-Umgebung (freies Modell).
// Beide werden als Umgebungskarte vorberechnet, damit Wasser, Glas und Metall echte Spiegelungen zeigen.
import * as THREE from 'three';
import { Sky } from './lib/Sky.js';
import { RoomEnvironment } from './lib/RoomEnvironment.js';

export function baueUmgebungen(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  // Sonnenstand: 48° Höhe, Richtung Südost
  const sonne = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 48), THREE.MathUtils.degToRad(150));
  const einstellen = (sky) => {
    sky.scale.setScalar(1000);
    const u = sky.material.uniforms;
    u.turbidity.value = 3; u.rayleigh.value = 1.3; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sonne);
  };
  const skyEnv = new Sky(); einstellen(skyEnv);
  const hilfsszene = new THREE.Scene(); hilfsszene.add(skyEnv);
  const himmelEnv = pmrem.fromScene(hilfsszene, 0, 0.1, 2000).texture;
  const studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sky = new Sky(); einstellen(sky); // sichtbarer Himmel im Hintergrund
  return { sky, himmelEnv, studioEnv, sonne };
}
