// Settings of the 3D view: ground and sky, light, walls transparency, and the sun
// (location of the home found by address search, date and time). Not modal: the 3D
// view shows each change at once.

import { useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { Field, toHex } from "../panels/fields";
import TextureField from "../panels/TextureField";
import { useStore } from "../store";
import type { SunInfo } from "./View3D";

type Props = {
  sun: SunInfo | null;
  onClose: () => void;
};

type Found = { name: string; latitude: number; longitude: number };

/** IANA time zones known to the WebView (offline). */
function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
}

/** Date and time "now" in a time zone, as the date and time inputs expect them. */
function nowIn(timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

const DEFAULT_LIGHT_GRAY = 0xd0;

export default function View3DSettings({ sun, onClose }: Props) {
  const opened = useStore((s) => s.opened);
  const run = useStore((s) => s.run);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!opened) return null;
  const env = opened.home.environment;
  const a = env?.attrs;
  const texture = (role: string) => env?.textures.find((t) => t.role === role) ?? null;
  const light =
    a?.light_color == null
      ? 100
      : Math.round((((a.light_color >> 8) & 0xff) / DEFAULT_LIGHT_GRAY) * 100);
  const transparency = Math.round((a?.walls_alpha ?? 0) * 100);
  const update = (params: Record<string, unknown>) => void run("view3d_update", params);
  const north = opened.home.compass?.attrs.north_direction ?? 0;

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      // Errors are shown here, next to the search field
      const r = (await api.execute("location_search", { query: q, limit: 6 })) as {
        results: Found[];
      };
      setFound(r.results);
    } catch (e) {
      setSearchError(String(e));
      setFound(null);
    } finally {
      setSearching(false);
    }
  };

  const choose = (f: Found) => {
    void run("location_set", {
      latitude: f.latitude,
      longitude: f.longitude,
      // The time zone cannot be derived offline from the position: the home's one (or
      // this computer's) is kept and can be changed below
      time_zone: sun?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    setFound(null);
    setQuery(f.name.split(",").slice(0, 3).join(","));
  };

  return (
    <div className="settings3d-panel" role="dialog" aria-label={t("3D view settings")}>
      <header className="dialog-header">
        <h2>{t("3D view settings")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Close")}>
          {"✕"}
        </button>
      </header>

      <fieldset className="settings3d-group">
        <legend>{t("Ground and sky")}</legend>
        <Field
          label={t("Ground color")}
          type="color"
          value={toHex(a?.ground_color ?? 0xa8a8a8)}
          onCommit={(v) => update({ ground_color: v })}
        />
        <TextureField
          label={t("Ground texture")}
          current={texture("groundTexture")}
          onCommit={(id) => update({ ground_texture: id })}
        />
        <Field
          label={t("Sky color")}
          type="color"
          value={toHex(a?.sky_color ?? 0xcce4fc)}
          onCommit={(v) => update({ sky_color: v })}
        />
        <TextureField
          label={t("Sky texture")}
          current={texture("skyTexture")}
          onCommit={(id) => update({ sky_texture: id })}
        />
      </fieldset>

      <fieldset className="settings3d-group">
        <legend>{t("Light and walls")}</legend>
        <label className="prop-row">
          <span className="prop-label">{t("Light brightness")}</span>
          <input
            key={`light-${light}`}
            type="range"
            min={0}
            max={120}
            step={5}
            defaultValue={light}
            onPointerUp={(e) => update({ light_brightness: Number(e.currentTarget.value) })}
            onKeyUp={(e) => update({ light_brightness: Number(e.currentTarget.value) })}
          />
          <span className="prop-unit">{light} %</span>
        </label>
        <label className="prop-row">
          <span className="prop-label">{t("Walls transparency")}</span>
          <input
            key={`walls-${transparency}`}
            type="range"
            min={0}
            max={90}
            step={10}
            defaultValue={transparency}
            onPointerUp={(e) => update({ walls_transparency: Number(e.currentTarget.value) })}
            onKeyUp={(e) => update({ walls_transparency: Number(e.currentTarget.value) })}
          />
          <span className="prop-unit">{transparency} %</span>
        </label>
      </fieldset>

      <fieldset className="settings3d-group">
        <legend>{t("Location")}</legend>
        <form
          className="settings3d-search"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            value={query}
            placeholder={t("Address or place")}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button type="submit" disabled={searching || !query.trim()}>
            {searching ? t("Searching…") : t("Search")}
          </button>
        </form>
        <p className="muted small">{t("Searched online with OpenStreetMap Nominatim.")}</p>
        {searchError && <p className="settings3d-error">{searchError}</p>}
        {found && found.length === 0 && <p className="muted small">{t("Nothing found.")}</p>}
        {found && found.length > 0 && (
          <ul className="settings3d-results">
            {found.map((f) => (
              <li key={`${f.latitude},${f.longitude},${f.name}`}>
                <button
                  type="button"
                  onClick={() => choose(f)}
                  title={`${f.latitude}, ${f.longitude}`}
                >
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field
          label={t("Latitude")}
          type="number"
          unit="°"
          value={sun ? String(sun.latitude) : null}
          onCommit={(v) => void run("location_set", { latitude: Number(v) })}
        />
        <Field
          label={t("Longitude")}
          type="number"
          unit="°"
          value={sun ? String(sun.longitude) : null}
          onCommit={(v) => void run("location_set", { longitude: Number(v) })}
        />
        <label className="prop-row">
          <span className="prop-label">{t("Time zone")}</span>
          <select
            value={sun?.time_zone ?? "UTC"}
            onChange={(e) => void run("location_set", { time_zone: e.currentTarget.value })}
          >
            {[...new Set([sun?.time_zone ?? "UTC", ...timeZones()])].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <Field
          label={t("North direction")}
          type="number"
          unit="°"
          value={Math.round(((north * 180) / Math.PI) * 10) / 10}
          onCommit={(v) => void run("compass_update", { north_direction_deg: Number(v) })}
        />
        {sun && !sun.location_set && (
          <p className="muted small">{t("No location set yet: the sun is computed for Paris.")}</p>
        )}
      </fieldset>

      <fieldset className="settings3d-group">
        <legend>{t("Sun")}</legend>
        <Field
          label={t("Follow the current time")}
          type="checkbox"
          value={sun?.follow_clock ?? false}
          onCommit={(v) => void run("sun_update", { follow_clock: v === true })}
        />
        <label className="prop-row">
          <span className="prop-label">{t("Date")}</span>
          <input
            key={`date-${sun?.date}`}
            type="date"
            defaultValue={sun?.date}
            disabled={sun?.follow_clock}
            onBlur={(e) => {
              if (e.currentTarget.value && e.currentTarget.value !== sun?.date) {
                void run("sun_update", { date: e.currentTarget.value });
              }
            }}
          />
        </label>
        <label className="prop-row">
          <span className="prop-label">{t("Time")}</span>
          <input
            key={`time-${sun?.time}`}
            type="time"
            defaultValue={sun?.time}
            disabled={sun?.follow_clock}
            onBlur={(e) => {
              if (e.currentTarget.value && e.currentTarget.value !== sun?.time) {
                void run("sun_update", { time: e.currentTarget.value });
              }
            }}
          />
        </label>
        <div className="settings3d-buttons">
          <button
            type="button"
            disabled={sun?.follow_clock}
            onClick={() => void run("sun_update", nowIn(sun?.time_zone ?? "UTC"))}
          >
            {t("Now")}
          </button>
          <button
            type="button"
            disabled={sun?.follow_clock}
            onClick={() =>
              void run("sun_update", { date: `${new Date().getFullYear()}-06-21`, time: "12:00" })
            }
          >
            {t("Summer noon")}
          </button>
          <button
            type="button"
            disabled={sun?.follow_clock}
            onClick={() =>
              void run("sun_update", { date: `${new Date().getFullYear()}-12-21`, time: "12:00" })
            }
          >
            {t("Winter noon")}
          </button>
        </div>
        {sun && (
          <p className="muted small">
            {sun.elevation > 0
              ? t("Sun {v0}° above the horizon, {v1} ({v2}°)", {
                  v0: Math.round(sun.elevation),
                  v1: compassPoint(sun.azimuth),
                  v2: Math.round(sun.azimuth),
                })
              : t("The sun is below the horizon (night).")}
            {sun.follow_clock ? ` · ${sun.date} ${sun.time}` : ""}
          </p>
        )}
      </fieldset>
    </div>
  );
}

/** Compass point of an azimuth (degrees clockwise from north). */
function compassPoint(azimuth: number): string {
  const names = [
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest",
  ];
  return names[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8];
}
