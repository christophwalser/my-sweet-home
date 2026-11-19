// File formats of the furniture and texture import. Most formats are read by msh-core (so
// the CLI and the MCP server can import them too); FBX and VRML have no reader there and are
// converted here with the loaders of three.js into GLB, which msh-core turns into OBJ.

import { join, tempDir } from "@tauri-apps/api/path";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { VRMLLoader } from "three/examples/jsm/loaders/VRMLLoader.js";
import { api } from "../api";

/** Model files the furniture import accepts. */
export const MODEL_EXTENSIONS = [
  "obj",
  "dae",
  "3ds",
  "gltf",
  "glb",
  "fbx",
  "zip",
  "kmz",
  "stl",
  "3mf",
  "ply",
  "wrl",
  "vrml",
  "xyz",
  "asc",
];
/** Height grids of terrain among them: placed as reference object that replaces the ground. */
export const TERRAIN_EXTENSIONS = ["xyz", "asc"];
/** Image files and material packages the texture import accepts. */
export const TEXTURE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "bmp",
  "gif",
  "webp",
  "tif",
  "tiff",
  "svg",
  "zip",
];
/** Library files of Sweet Home 3D. */
export const LIBRARY_EXTENSIONS = ["sh3f", "sh3t"];

/** Formats converted in the app (no reader in msh-core). */
const CONVERTED_HERE = ["fbx", "wrl", "vrml"];

export function extensionOf(path: string): string {
  const m = /\.([^.\\/]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
}

function directoryOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

function baseName(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

/** Resolves when all files the manager started loading are loaded (or after a timeout). */
function settled(manager: THREE.LoadingManager, started: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (!started()) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, 15000);
    manager.onLoad = () => {
      window.clearTimeout(timer);
      resolve();
    };
    manager.onError = () => {};
  });
}

/** Parses the model with `urls` mapping texture names to loadable URLs. */
function parse(ext: string, data: ArrayBuffer, manager: THREE.LoadingManager): THREE.Object3D {
  if (ext === "fbx") return new FBXLoader(manager).parse(data, "");
  const text = new TextDecoder().decode(data);
  return new VRMLLoader(manager).parse(text, "");
}

/**
 * Converts FBX and VRML models into a temporary GLB file and returns its path; other formats
 * are returned unchanged (msh-core reads them).
 */
export async function prepareModel(path: string): Promise<string> {
  const ext = extensionOf(path);
  if (!CONVERTED_HERE.includes(ext)) return path;
  const bytes = await api.readFile(path);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const dir = directoryOf(path);

  // First pass: which texture files does the model need?
  const wanted = new Set<string>();
  const probe = new THREE.LoadingManager();
  probe.setURLModifier((url) => {
    if (!url.startsWith("blob:") && !url.startsWith("data:")) wanted.add(url);
    // A transparent pixel, so the probe does not fail
    return "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  });
  parse(ext, data, probe);

  // Read them next to the model (by their path, else by their name) as blob URLs
  const urls = new Map<string, string>();
  for (const name of wanted) {
    const clean = decodeURIComponent(name.replace(/^file:\/\/\/?/, ""));
    for (const candidate of [
      /^[a-zA-Z]:[\\/]/.test(clean) ? clean : `${dir}\\${clean}`,
      `${dir}\\${baseName(clean)}`,
    ]) {
      try {
        const image = await api.readFile(candidate);
        const ext = extensionOf(candidate);
        const type = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
        urls.set(name, URL.createObjectURL(new Blob([new Uint8Array(image)], { type })));
        break;
      } catch {
        // Try the next place
      }
    }
  }

  // Second pass with the textures, then GLB
  let started = false;
  const manager = new THREE.LoadingManager();
  manager.onStart = () => {
    started = true;
  };
  manager.setURLModifier((url) => urls.get(url) ?? url);
  try {
    const model = parse(ext, data, manager);
    await settled(manager, () => started);
    // glTF is in meters: FBX is mostly in cm or mm, VRML in meters
    if (ext === "fbx") {
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      const largest = Math.max(size.x, size.y, size.z);
      if (largest > 1000) model.scale.multiplyScalar(0.001);
      else if (largest > 10) model.scale.multiplyScalar(0.01);
    }
    const scene = new THREE.Scene();
    scene.add(model);
    const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
    const target = await join(await tempDir(), `msh-import-${Date.now()}.glb`);
    await api.saveFile(target, new Uint8Array(glb));
    return target;
  } finally {
    for (const u of urls.values()) URL.revokeObjectURL(u);
  }
}

/** Writes dropped files into a new temporary folder; returns their paths in that folder. */
export async function saveDroppedFiles(files: File[]): Promise<string[]> {
  const dir = await join(await tempDir(), `msh-drop-${Date.now()}`);
  const paths: string[] = [];
  for (const f of files) {
    const target = await join(dir, f.name);
    await api.saveFile(target, new Uint8Array(await f.arrayBuffer()));
    paths.push(target);
  }
  return paths;
}
