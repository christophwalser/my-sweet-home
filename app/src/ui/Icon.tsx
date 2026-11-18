// Icon set of the UI (24 px grid, 1.75 stroke, round caps), drawn with currentColor.
// Generated from the P12a design mock-up; edit the paths here to change an icon.

import type { JSX } from "react";

const PATHS = {
  new: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M12 11v6M9 14h6" />
    </>
  ),
  open: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M7 3v5h8V3" />
      <rect x="7" y="13" width="10" height="6" rx="1" />
    </>
  ),
  recent: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v3h16v-3" />
    </>
  ),
  export: (
    <>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M4 17v3h16v-3" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
  exit: (
    <>
      <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </>
  ),
  cut: (
    <>
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8.1 16 16 4M15.9 16 8 4" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  paste: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  pastestyle: (
    <>
      <path d="M4 4h12v5H4z" />
      <path d="M16 6.5h3v5h-8v3" />
      <rect x="9" y="14.5" width="4" height="6.5" rx="1" />
    </>
  ),
  duplicate: (
    <>
      <rect x="3" y="3" width="12" height="12" rx="2" />
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M15 13v4M13 15h4" />
    </>
  ),
  delete: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  selectall: (
    <>
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <path d="M9 9h6v6H9z" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </>
  ),
  select: (
    <>
      <path d="M5 3l13 8-6 1.5L9 19z" />
    </>
  ),
  pan: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  wall: (
    <>
      <rect x="3" y="9" width="18" height="6" />
      <path d="M6 15l6-6M11 15l6-6M16 15l5-5" />
    </>
  ),
  arcwall: (
    <>
      <path d="M3 19a9 9 0 0 1 18 0" />
      <path d="M7.5 19a4.5 4.5 0 0 1 9 0" />
      <path d="M5 13.5l2.3 1.7M9.5 10.6l1 2.6M15.5 10.4l-1 2.7" />
    </>
  ),
  room: (
    <>
      <path d="M4 5h11l5 5v9H4z" />
      <path d="M8 15h5" />
    </>
  ),
  roomauto: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M7 7h10v10H7z" />
      <path d="M12 10v4M10 12h4" />
    </>
  ),
  polyline: (
    <>
      <path d="M3 17l5-8 5 5 4-7 4 3" />
      <circle cx="3" cy="17" r="1.3" />
      <circle cx="21" cy="10" r="1.3" />
    </>
  ),
  dimension: (
    <>
      <path d="M4 8v8M20 8v8M4 12h16" />
      <path d="m7 9-3 3 3 3M17 9l3 3-3 3" />
    </>
  ),
  heightdim: (
    <>
      <path d="M8 4h8M8 20h8M12 4v16" />
      <path d="m9 7 3-3 3 3M9 17l3 3 3-3" />
    </>
  ),
  text: (
    <>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </>
  ),
  measure: (
    <>
      <path d="M3 17 17 3l4 4L7 21z" />
      <path d="m7 13 2 2M10 10l2 2M13 7l2 2" />
    </>
  ),
  guide: (
    <>
      <path d="M4 7v10M20 7v10" />
      <path d="M7 12h2.5M11 12h2M14.5 12H17" />
    </>
  ),
  joinwalls: (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 4v12h12" />
    </>
  ),
  splitwall: (
    <>
      <rect x="3" y="9" width="7" height="6" />
      <rect x="14" y="9" width="7" height="6" />
      <path d="M12 5v2M12 11v2M12 17v2" />
    </>
  ),
  reverse: (
    <>
      <path d="M4 8h14l-3-3M20 16H6l3 3" />
    </>
  ),
  zoomin: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4M8 11h6M11 8v6" />
    </>
  ),
  zoomout: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4M8 11h6" />
    </>
  ),
  zoomfit: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5M12 12h.01" />
    </>
  ),
  maximize: (
    <>
      <path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6" />
    </>
  ),
  restore: (
    <>
      <path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6" />
    </>
  ),
  collapseup: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 15.5l3-3 3 3" />
    </>
  ),
  collapsedown: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 15h18M9 8.5l3 3 3-3" />
    </>
  ),
  rulers: (
    <>
      <path d="M3 3h18v5H8v13H3z" />
      <path d="M7 3v2M11 3v3M15 3v2M19 3v3M3 12h2M3 16h3" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  background: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </>
  ),
  level: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  leveladd: (
    <>
      <path d="m11 3 8 4.5-8 4.5-8-4.5z" />
      <path d="m3 12 8 4.5 3-1.7" />
      <path d="M19 15v6M16 18h6" />
    </>
  ),
  alllevels: (
    <>
      <path d="m12 2 9 5-9 5-9-5z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </>
  ),
  hidden: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A9.6 9.6 0 0 1 12 5c6 0 9.5 7 9.5 7a15.6 15.6 0 0 1-2.7 3.5" />
      <path d="M6.6 6.6A15.4 15.4 0 0 0 2.5 12s3.5 7 9.5 7a9.4 9.4 0 0 0 4.3-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  furniture: (
    <>
      <path d="M7 3h10v8H7zM5 11h14v3H5zM7 14v7M17 14v7" />
    </>
  ),
  texture: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 12h9V3M12 21v-9h9" />
    </>
  ),
  library: (
    <>
      <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15-3.5 1z" />
    </>
  ),
  door: (
    <>
      <path d="M3 20h4M17 20h4M7 20V7" />
      <path d="M7 7a13 13 0 0 1 13 13" />
    </>
  ),
  window: (
    <>
      <path d="M3 12h2M19 12h2" />
      <rect x="5" y="9" width="14" height="6" />
      <path d="M12 9v6" />
    </>
  ),
  staircase: (
    <>
      <path d="M3 21h4v-4h4v-4h4V9h4V5h2" />
    </>
  ),
  group: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
      <path d="M3 15v6h6M15 3h6v6" />
    </>
  ),
  ungroup: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
      <path d="M15 6h3M6 18v-3" />
    </>
  ),
  align: (
    <>
      <path d="M4 3v18" />
      <rect x="7" y="6" width="10" height="4" rx="1" />
      <rect x="7" y="14" width="6" height="4" rx="1" />
    </>
  ),
  distribute: (
    <>
      <path d="M4 4v16M20 4v16" />
      <rect x="7" y="8" width="3" height="8" rx="1" />
      <rect x="14" y="8" width="3" height="8" rx="1" />
    </>
  ),
  flip: (
    <>
      <path d="M12 3v18" />
      <path d="M9 7 4 17h5zM15 7l5 10h-5z" />
    </>
  ),
  flipv: (
    <>
      <path d="M3 12h18" />
      <path d="M7 9 17 4v5zM7 15l10 5v-5z" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  light: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
    </>
  ),
  aerial: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  visit: (
    <>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 7v7l-3 7M12 14l3 7M8 11l4-3 4 3" />
    </>
  ),
  viewpoint: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  photo: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v12H4z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </>
  ),
  shadows: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M5 20h16l-4-6H9z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: (
    <>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </>
  ),
  location: (
    <>
      <path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 5 3 7h-6z" />
      <path d="m12 19-3-7h6z" />
    </>
  ),
  detach: (
    <>
      <rect x="3" y="7" width="14" height="14" rx="2" />
      <path d="M13 3h8v8M21 3l-9 9" />
    </>
  ),
  plugin: (
    <>
      <path d="M9 3h4v2.5a2 2 0 1 0 4 0V3h4v6h-2.5a2 2 0 1 0 0 4H21v8h-8v-2.5a2 2 0 1 0-4 0V21H3v-8h2.5a2 2 0 1 0 0-4H3V3z" />
    </>
  ),
  script: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 10 3 2-3 2M12 15h5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17.5v.01" />
    </>
  ),
  update: (
    <>
      <path d="M20 12a8 8 0 0 1-14.9 4M4 12a8 8 0 0 1 14.9-4" />
      <path d="M19 3v5h-5M5 21v-5h5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
  chevdown: (
    <>
      <path d="m6 9 6 6 6-6" />
    </>
  ),
  chevright: (
    <>
      <path d="m9 6 6 6-6 6" />
    </>
  ),
  check: (
    <>
      <path d="m5 12 5 5 9-10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  magnet: (
    <>
      <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z" />
      <path d="M6 8h4M14 8h4" />
    </>
  ),
  angle: (
    <>
      <path d="M4 19h16M4 19 15 6" />
      <path d="M10 19a6 6 0 0 0-1.6-4.1" />
    </>
  ),
  snapobject: (
    <>
      <rect x="4" y="4" width="10" height="10" />
      <circle cx="14" cy="14" r="3" />
      <path d="M14 8v3M14 17v3M8 14h3M17 14h3" />
    </>
  ),
  more: (
    <>
      <path d="M12 6h.01M12 12h.01M12 18h.01" />
    </>
  ),
  drag: (
    <>
      <path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" />
    </>
  ),
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof PATHS;

/** Names of all icons (for the icon overview and tests). */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/** An icon of the set; decorative unless a `label` is given. */
export default function Icon({
  name,
  size = 20,
  label,
  className,
}: {
  name: IconName;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      {PATHS[name]}
    </svg>
  );
}
