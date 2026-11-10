// Export of the 3D view's walls, rooms and furniture as Wavefront OBJ with an MTL
// file and texture images, like Sweet Home 3D's "Export to OBJ format".
// Units are centimeters, the y axis points up.

import * as THREE from "three";
import { texturePending } from "./textures";

export interface ObjFiles {
  /** Content of the .obj file (references `mtlName`) */
  obj: string;
  /** Content of the .mtl file */
  mtl: string;
  /** Texture images: file name → PNG as base64 */
  textures: Record<string, string>;
}

/** Groups of the 3D view's content that are exported. */
const EXPORTED_GROUPS = ["walls", "rooms", "furniture"];

/** Builds the OBJ, MTL and texture files of the exported groups of `content`. */
export function buildObj(content: THREE.Object3D, mtlName: string): ObjFiles {
  content.updateMatrixWorld(true);
  const lines: string[] = [
    "# Exported by My Sweet Home",
    "# Units: centimeters, y axis up",
    `mtllib ${mtlName}`,
  ];
  const materials = new Map<string, { name: string; material: THREE.Material }>();
  const textureFiles = new Map<THREE.Texture, string>();
  const textures: Record<string, string> = {};
  const usedNames = new Set<string>();
  // OBJ indices are global and 1-based
  let vOffset = 1;
  let vtOffset = 1;
  let vnOffset = 1;
  let objectIndex = 0;

  const materialName = (m: THREE.Material, fallback: string): string => {
    const known = materials.get(m.uuid);
    if (known) return known.name;
    const base = sanitize(m.name || fallback);
    let name = base;
    for (let i = 2; usedNames.has(name); i++) name = `${base}_${i}`;
    usedNames.add(name);
    materials.set(m.uuid, { name, material: m });
    return name;
  };

  const textureFile = (tex: THREE.Texture): string | null => {
    const known = textureFiles.get(tex);
    if (known) return known;
    const png = textureToPng(tex);
    if (!png) return null;
    const name = `texture_${textureFiles.size + 1}.png`;
    textureFiles.set(tex, name);
    textures[name] = png;
    return name;
  };

  const normalMatrix = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const uv = new THREE.Vector2();

  for (const groupName of EXPORTED_GROUPS) {
    const group = content.getObjectByName(groupName);
    if (!group) continue;
    group.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const position = geometry.getAttribute("position");
      if (!position || position.count === 0) return;
      const normal = geometry.getAttribute("normal");
      const uvs = geometry.getAttribute("uv");
      const index = geometry.getIndex();
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // Mirrored pieces (negative scale) flip the winding of their faces
      const flip = mesh.matrixWorld.determinant() < 0;
      normalMatrix.getNormalMatrix(mesh.matrixWorld);

      objectIndex++;
      const label = objectLabel(mesh, groupName);
      lines.push(`o ${label}_${objectIndex}`);
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        lines.push(`v ${num(v.x)} ${num(v.y)} ${num(v.z)}`);
      }
      if (normal) {
        for (let i = 0; i < normal.count; i++) {
          n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
          lines.push(`vn ${num(n.x, 4)} ${num(n.y, 4)} ${num(n.z, 4)}`);
        }
      }

      // Faces per material group; UVs follow the texture transform of each material
      const groups =
        geometry.groups.length > 0
          ? geometry.groups
          : [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }];
      const vertexOf = (k: number) => (index ? index.getX(k) : k);
      for (const g of groups) {
        const material = meshMaterials[g.materialIndex ?? 0] ?? meshMaterials[0];
        if (!material) continue;
        const map = (material as THREE.MeshStandardMaterial).map ?? null;
        const hasUv = !!uvs && !!map && textureFile(map) !== null;
        let uvBase = 0;
        if (hasUv && uvs && map) {
          map.updateMatrix();
          uvBase = vtOffset;
          for (let i = 0; i < uvs.count; i++) {
            uv.set(uvs.getX(i), uvs.getY(i)).applyMatrix3(map.matrix);
            lines.push(`vt ${num(uv.x, 5)} ${num(uv.y, 5)}`);
          }
          vtOffset += uvs.count;
        }
        lines.push(`usemtl ${materialName(material, label)}`);
        const end = Math.min(g.start + g.count, index ? index.count : position.count);
        for (let k = g.start; k + 2 < end; k += 3) {
          const tri = [vertexOf(k), vertexOf(k + 1), vertexOf(k + 2)];
          if (flip) tri.reverse();
          const refs = tri.map((i) => {
            const vi = vOffset + i;
            const ti = hasUv ? `${uvBase + i}` : "";
            const ni = normal ? `${vnOffset + i}` : "";
            if (!ti && !ni) return `${vi}`;
            return ni ? `${vi}/${ti}/${ni}` : `${vi}/${ti}`;
          });
          lines.push(`f ${refs.join(" ")}`);
        }
      }
      vOffset += position.count;
      if (normal) vnOffset += normal.count;
    });
  }

  const mtl: string[] = ["# Exported by My Sweet Home"];
  for (const { name, material } of materials.values()) {
    const m = material as THREE.MeshStandardMaterial & THREE.MeshPhongMaterial;
    // three.js keeps colors linear; MTL files use sRGB values like the source models
    const color = { r: 1, g: 1, b: 1 };
    m.color?.getRGB(color, THREE.SRGBColorSpace);
    mtl.push("", `newmtl ${name}`);
    mtl.push(`Ka ${num(color.r, 4)} ${num(color.g, 4)} ${num(color.b, 4)}`);
    mtl.push(`Kd ${num(color.r, 4)} ${num(color.g, 4)} ${num(color.b, 4)}`);
    // Phong materials keep their shininess, standard ones derive it from the roughness
    const shininess =
      typeof m.shininess === "number"
        ? m.shininess
        : typeof m.roughness === "number"
          ? (1 - m.roughness) * 128
          : 0;
    const ks = Math.min(1, shininess / 128);
    mtl.push(`Ks ${num(ks, 4)} ${num(ks, 4)} ${num(ks, 4)}`);
    mtl.push(`Ns ${num(shininess, 2)}`);
    if (material.transparent && material.opacity < 1) mtl.push(`d ${num(material.opacity, 4)}`);
    mtl.push("illum 2");
    const file = m.map ? textureFiles.get(m.map) : undefined;
    if (file) mtl.push(`map_Kd ${file}`);
  }

  return { obj: `${lines.join("\n")}\n`, mtl: `${mtl.join("\n")}\n`, textures };
}

/** PNG (base64, without data URL prefix) of a texture's image, or null if it has none. */
function textureToPng(tex: THREE.Texture): string | null {
  const image = tex.image as CanvasImageSource & { width?: number; height?: number };
  if (texturePending(tex) || !image?.width || !image.height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(image, 0, 0);
    // three.js flips textures by default; the OBJ convention matches the unflipped image
    return canvas.toDataURL("image/png").split(",")[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Name of the home element a mesh belongs to: the piece name for furniture, else
 * the element name of the 3D view ("wall:…", "floor:…").
 */
function objectLabel(mesh: THREE.Object3D, groupName: string): string {
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
    if (typeof o.userData.label === "string") return sanitize(o.userData.label);
    if (o.name.includes(":")) return sanitize(o.name.split(":")[0]);
  }
  return sanitize(groupName);
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]+/g, "_") || "object";
}

function num(value: number, digits = 3): string {
  const s = value.toFixed(digits);
  // Trim trailing zeros to keep the file small
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
}
