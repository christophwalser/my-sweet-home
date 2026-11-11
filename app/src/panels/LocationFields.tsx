// Location of the home, stored in the compass as in Sweet Home 3D: address search (online,
// OpenStreetMap Nominatim), latitude, longitude, time zone and the north direction, which
// can be turned to match a map. Shown in the 3D view settings and the home properties.

import { useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useStore } from "../store";
import { Field } from "./fields";
import NorthMapDialog from "./NorthMapDialog";

type Found = { name: string; latitude: number; longitude: number };

/** IANA time zones known to the WebView (offline). */
function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
}

/** Time zone of this computer, used while the home has none. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Degrees of an angle in radians, rounded to `digits` decimals (null stays null). */
function degrees(rad: number | null | undefined, digits: number): string | null {
  if (rad == null) return null;
  const f = 10 ** digits;
  return String(Math.round(((rad * 180) / Math.PI) * f) / f);
}

export default function LocationFields() {
  const opened = useStore((s) => s.opened);
  const run = useStore((s) => s.run);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  if (!opened) return null;
  const c = opened.home.compass?.attrs;
  const timeZone = c?.time_zone || localTimeZone();
  const located = c?.latitude != null && c?.longitude != null;

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
      time_zone: timeZone,
    });
    setFound(null);
    setQuery(f.name.split(",").slice(0, 3).join(","));
  };

  return (
    <>
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
        type="text"
        unit="°"
        value={degrees(c?.latitude, 4)}
        onCommit={(v) => {
          const n = Number.parseFloat(String(v).replace(",", "."));
          if (Number.isFinite(n)) void run("location_set", { latitude: n });
        }}
      />
      <Field
        label={t("Longitude")}
        type="text"
        unit="°"
        value={degrees(c?.longitude, 4)}
        onCommit={(v) => {
          const n = Number.parseFloat(String(v).replace(",", "."));
          if (Number.isFinite(n)) void run("location_set", { longitude: n });
        }}
      />
      <label className="prop-row">
        <span className="prop-label">{t("Time zone")}</span>
        <select
          value={timeZone}
          onChange={(e) => void run("location_set", { time_zone: e.currentTarget.value })}
        >
          {[...new Set([timeZone, ...timeZones()])].map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={t("North direction")}
        type="text"
        unit="°"
        value={degrees(c?.north_direction ?? 0, 1)}
        onCommit={(v) => {
          const n = Number.parseFloat(String(v).replace(",", "."));
          if (Number.isFinite(n)) void run("compass_update", { north_direction_deg: n });
        }}
      />
      <div className="prop-row">
        <button
          type="button"
          disabled={!located}
          title={located ? undefined : t("Set the location first.")}
          onClick={() => setMapOpen(true)}
        >
          {t("Align north with the map…")}
        </button>
      </div>
      {!located && (
        <p className="muted small">{t("No location set yet: the sun is computed for Paris.")}</p>
      )}
      {mapOpen && <NorthMapDialog onClose={() => setMapOpen(false)} />}
    </>
  );
}
