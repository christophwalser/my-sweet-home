// Export of the 3D view's walls, rooms and furniture as glTF binary (.glb): one file with
// geometry, materials and textures, in meters with the y axis up as glTF requires. Read by
// Blender, game engines, web viewers and many CAD and BIM programs.

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { EXPORTED_GROUPS } from "./objExport";

/**
 * The exported groups of `content` under a root that turns centimeters into meters. The
 * groups are copied (sharing geometry and materials), so the 3D view stays as it is.
 */
export function gltfScene(content: THREE.Object3D): THREE.Group {
  content.updateMatrixWorld(true);
  const root = new THREE.Group();
  root.name = "home";
  root.scale.setScalar(0.01);
  for (const name of EXPORTED_GROUPS) {
    const group = content.getObjectByName(name);
    if (!group || !group.visible) continue;
    const copy = group.clone(true);
    // Where the group lies in the view, without the parents it leaves behind
    group.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    root.add(copy);
  }
  return root;
}

/** The exported groups of `content` as glTF binary, base64 encoded. */
export async function buildGlb(content: THREE.Object3D): Promise<string> {
  const exporter = new GLTFExporter();
  const glb = (await exporter.parseAsync(gltfScene(content), {
    binary: true,
    onlyVisible: true,
  })) as ArrayBuffer;
  return toBase64(new Uint8Array(glb));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
