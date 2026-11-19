// Standard views of the aerial view (top, the four sides, four isometric views) and the
// change between perspective and parallel projection.

import * as THREE from "three";
import { t } from "../i18n";

export const STANDARD_VIEWS = [
  "top",
  "north",
  "east",
  "south",
  "west",
  "isoNE",
  "isoSE",
  "isoSW",
  "isoNW",
] as const;

export type StandardView = (typeof STANDARD_VIEWS)[number];

/** Names of the standard views in menus. */
export function standardViewLabel(view: StandardView): string {
  switch (view) {
    case "top":
      return t("Top view");
    case "north":
      return t("From the north");
    case "east":
      return t("From the east");
    case "south":
      return t("From the south");
    case "west":
      return t("From the west");
    case "isoNE":
      return t("Isometric from the northeast");
    case "isoSE":
      return t("Isometric from the southeast");
    case "isoSW":
      return t("Isometric from the southwest");
    case "isoNW":
      return t("Isometric from the northwest");
  }
}

/** Elevation of the camera in an isometric view (the three axes look equally long). */
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
/**
 * The top view looks down from a hair south of the vertical: straight down the turning of
 * the view would be lost, and this way north is up on the screen.
 */
const TOP_TILT = 0.001;

/** Where the camera stands: degrees clockwise from north, and its elevation in radians. */
const PLACES: Record<StandardView, [number, number]> = {
  top: [180, Math.PI / 2 - TOP_TILT],
  north: [0, 0],
  east: [90, 0],
  south: [180, 0],
  west: [270, 0],
  isoNE: [45, ISO_ELEVATION],
  isoSE: [135, ISO_ELEVATION],
  isoSW: [225, ISO_ELEVATION],
  isoNW: [315, ISO_ELEVATION],
};

/**
 * View direction of a standard view in three.js coordinates (x = plan x, y up, z = plan y).
 * `north` is the north direction of the compass in radians (0: north is up in the plan).
 */
export function viewDirection(view: StandardView, north: number): THREE.Vector3 {
  const [azimuth, elevation] = PLACES[view];
  const a = north + THREE.MathUtils.degToRad(azimuth);
  // From the home towards the camera, like the direction towards the sun (`sun_get`)
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(a),
    Math.sin(elevation),
    -Math.cos(elevation) * Math.cos(a),
  ).negate();
}

/**
 * Half the height of the parallel view that shows the same part of the scene at the point
 * the view turns around as a perspective camera `distance` away from it.
 */
export function parallelHalfHeight(distance: number, verticalFovDeg: number): number {
  return distance * Math.tan(THREE.MathUtils.degToRad(verticalFovDeg) / 2);
}

/** Inverse of {@link parallelHalfHeight}: distance of the perspective camera. */
export function perspectiveDistance(halfHeight: number, verticalFovDeg: number): number {
  return halfHeight / Math.tan(THREE.MathUtils.degToRad(verticalFovDeg) / 2);
}

/**
 * Angle in radians (clockwise) by which a north arrow drawn pointing up has to be turned so
 * that it points north on the screen. `right` and `up` are the screen axes of the camera in
 * the scene.
 */
export function northOnScreen(right: THREE.Vector3, up: THREE.Vector3, north: number): number {
  const n = new THREE.Vector3(Math.sin(north), 0, -Math.cos(north));
  return Math.atan2(n.dot(right), n.dot(up));
}
