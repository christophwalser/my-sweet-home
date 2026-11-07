// Conversion between Sweet Home 3D cameras (plan coordinates, yaw / pitch) and three.js.

import * as THREE from "three";

/** A camera in Sweet Home 3D terms: position in cm, angles in radians. */
export type CameraPose = {
  x: number;
  y: number;
  /** Eye elevation */
  z: number;
  yaw: number;
  /** Positive looks down */
  pitch: number;
  /** Horizontal field of view */
  fov: number;
};

/**
 * View direction of a Sweet Home 3D camera in three.js coordinates.
 * Sweet Home 3D orients the view with rotY(π − yaw) · rotX(−pitch) applied to
 * the default view direction (0, 0, −1); a positive pitch looks down.
 */
export function cameraDirection(yaw: number, pitch: number): THREE.Vector3 {
  return new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  );
}

/** Sweet Home 3D stores the horizontal field of view; three.js expects the vertical one. */
export function verticalFov(horizontal: number, aspect: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal / 2) / aspect));
}

/** Pose of a three.js camera (inverse of {@link applyPose}). */
export function cameraPose(camera: THREE.PerspectiveCamera, hfov: number): CameraPose {
  const dir = camera.getWorldDirection(new THREE.Vector3());
  return {
    x: camera.position.x,
    y: camera.position.z,
    z: camera.position.y,
    yaw: Math.atan2(-dir.x, dir.z),
    pitch: -Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)),
    fov: hfov,
  };
}

/** Places a three.js camera at a pose (the aspect ratio of the camera is kept). */
export function applyPose(camera: THREE.PerspectiveCamera, pose: CameraPose): void {
  camera.position.set(pose.x, pose.z, pose.y);
  camera.up.set(0, 1, 0);
  camera.lookAt(camera.position.clone().add(cameraDirection(pose.yaw, pose.pitch)));
  camera.fov = verticalFov(pose.fov, camera.aspect);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
