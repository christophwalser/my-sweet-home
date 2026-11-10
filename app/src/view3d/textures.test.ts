import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { boxProjectedUvs, cachedTexture, texturePending } from "./textures";

/** UV of vertex `i` of a geometry. */
const uvAt = (g: THREE.BufferGeometry, i: number) => {
  const uv = g.getAttribute("uv");
  return [uv.getX(i), uv.getY(i)];
};

describe("boxProjectedUvs", () => {
  it("maps front faces to x and height in centimeters of the piece", () => {
    // A door leaf 1 × 2 model units, scaled to 80 × 200 cm
    const plane = new THREE.PlaneGeometry(1, 2);
    const g = boxProjectedUvs(plane, new THREE.Matrix4().makeScale(80, 100, 1));
    expect(g.getAttribute("uv").count).toBe(g.getAttribute("position").count);
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const [u, v] = uvAt(g, i);
      expect(u).toBeCloseTo(pos.getX(i) * 80);
      expect(v).toBeCloseTo(pos.getY(i) * 100);
    }
  });

  it("uses depth and height on the sides and x and depth on top", () => {
    const box = new THREE.BoxGeometry(2, 4, 6);
    const g = boxProjectedUvs(box, new THREE.Matrix4());
    const pos = g.getAttribute("position");
    const normal = g.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      const [u, v] = uvAt(g, i);
      if (Math.abs(normal.getX(i)) > 0.5) {
        expect([u, v]).toEqual([pos.getZ(i), pos.getY(i)]);
      } else if (Math.abs(normal.getY(i)) > 0.5) {
        expect([u, v]).toEqual([pos.getX(i), pos.getZ(i)]);
      } else {
        expect([u, v]).toEqual([pos.getX(i), pos.getY(i)]);
      }
    }
  });

  it("leaves the shared geometry of the model unchanged", () => {
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.deleteAttribute("uv");
    const g = boxProjectedUvs(plane, new THREE.Matrix4());
    expect(g).not.toBe(plane);
    expect(plane.getAttribute("uv")).toBeUndefined();
  });
});

describe("cachedTexture", () => {
  it("gives each call its own texture and marks it loading until the image is there", () => {
    const a = cachedTexture("http://localhost/missing-a.png");
    const b = cachedTexture("http://localhost/missing-a.png");
    expect(a).not.toBe(b);
    expect(texturePending(a)).toBe(true);
    expect(texturePending(new THREE.Texture())).toBe(false);
  });
});
