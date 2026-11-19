// Settings of the 3D view: ground and sky, light, walls transparency, section planes, the
// location of the home (LocationFields) and the sun study (date and time of the sun). Not
// modal and beside the view: the 3D view shows each change at once, sliders while they are
// dragged.

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { Field, toHex } from "../panels/fields";
import LocationFields from "../panels/LocationFields";
import TextureField from "../panels/TextureField";
import { useStore } from "../store";
import { useUi } from "../ui/uiStore";
import { formatLength, useUnit } from "../units";
import type { SectionSide } from "./select3d";
import { dayOfYear, fromDayOfYear, fromMinutes, sectionRange, toMinutes } from "./sunStudy";
import type { SunInfo } from "./View3D";

type Props = {
  /** Sun shown in the 3D view: the one of the home, or the previewed moment */
  sun: SunInfo | null;
  onClose: () => void;
  /** Shows the sun of a moment ("YYYY-MM-DDTHH:MM") without changing the home; null ends it */
  onPreviewSun: (at: string | null) => void;
  /** Shows a light brightness (1 = 100 %) or walls transparency (0..1) while a slider moves */
  onPreview: (preview: { light?: number; wallsAlpha?: number } | null) => void;
};

/** Minutes the sun moves on per step while the day is played, and the time between steps. */
const PLAY_STEP_MINUTES = 10;
const PLAY_INTERVAL_MS = 80;

const SIDES: [SectionSide, () => string][] = [
  ["front", () => t("the front (bottom of the plan)")],
  ["back", () => t("the back (top of the plan)")],
  ["left", () => t("the left")],
  ["right", () => t("the right")],
];

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

/**
 * A slider that shows its value while it is dragged (`onPreview`) and changes the home when
 * it is released (`onCommit`).
 */
function PreviewSlider({
  label,
  value,
  min,
  max,
  step,
  text,
  onPreview,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Value as shown beside the slider */
  text: (value: number) => string;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [live, setLive] = useState<number | null>(null);
  // The value of the home takes over when it arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new value ends the drag
  useEffect(() => setLive(null), [value]);
  const shown = live ?? value;
  const commit = () => {
    if (live !== null) onCommit(live);
  };
  return (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          setLive(v);
          onPreview(v);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="prop-unit">{text(shown)}</span>
    </label>
  );
}

export default function View3DSettings({ sun, onClose, onPreviewSun, onPreview }: Props) {
  const opened = useStore((s) => s.opened);
  const run = useStore((s) => s.run);
  const selectedLevel = useStore((s) => s.selectedLevel);
  const shadows = useUi((s) => s.shadows);
  const setShadows = useUi((s) => s.setShadows);
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);
  const unit = useUnit();
  const [playing, setPlaying] = useState(false);
  /** Moment shown by the sun study and not stored in the home yet */
  const [pending, setPending] = useState<{ date: string; time: string } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const sunRef = useRef(sun);
  sunRef.current = sun;
  const closing = useRef({ onPreviewSun, onPreview });
  closing.current = { onPreviewSun, onPreview };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const study = (date: string, time: string) => {
    pendingRef.current = { date, time };
    setPending({ date, time });
    closing.current.onPreviewSun(`${date}T${time}`);
  };
  const commitStudy = () => {
    const moment = pendingRef.current;
    if (!moment) return;
    pendingRef.current = null;
    setPending(null);
    void run("sun_update", moment);
  };
  // The day runs: the sun moves on until it is stopped, then the home takes its time
  // biome-ignore lint/correctness/useExhaustiveDependencies: the timer reads the sun of the moment
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const now = pendingRef.current ?? sunRef.current;
      if (!now) return;
      study(now.date, fromMinutes((toMinutes(now.time) + PLAY_STEP_MINUTES) % 1440));
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing]);
  // A preview that was not stored ends with the panel
  useEffect(
    () => () => {
      if (pendingRef.current) closing.current.onPreviewSun(null);
      closing.current.onPreview(null);
    },
    [],
  );

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
  const range = sectionRange(opened.home, selectedLevel);
  const date = pending?.date ?? sun?.date ?? "";
  const time = pending?.time ?? sun?.time ?? "12:00";
  const fixed = !sun || sun.follow_clock;

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
        <PreviewSlider
          label={t("Light brightness")}
          value={light}
          min={0}
          max={120}
          step={5}
          text={(v) => `${v} %`}
          onPreview={(v) => onPreview({ light: v / 100 })}
          onCommit={(v) => update({ light_brightness: v })}
        />
        <PreviewSlider
          label={t("Walls transparency")}
          value={transparency}
          min={0}
          max={90}
          step={10}
          text={(v) => `${v} %`}
          onPreview={(v) => onPreview({ wallsAlpha: v / 100 })}
          onCommit={(v) => update({ walls_transparency: v })}
        />
      </fieldset>

      <fieldset className="settings3d-group">
        <legend>{t("Section")}</legend>
        <label className="prop-row prop-check">
          <input
            type="checkbox"
            checked={section.horizontal !== null}
            onChange={(e) =>
              setSection({ horizontal: e.currentTarget.checked ? range.start : null })
            }
          />
          <span>{t("Cut away everything above a height")}</span>
        </label>
        {section.horizontal !== null && (
          <label className="prop-row">
            <span className="prop-label">{t("Height above the ground")}</span>
            <input
              type="range"
              min={0}
              max={range.max}
              step={5}
              value={Math.min(section.horizontal, range.max)}
              onChange={(e) => setSection({ horizontal: Number(e.currentTarget.value) })}
            />
            <span className="prop-unit">{formatLength(section.horizontal, unit)}</span>
          </label>
        )}
        <label className="prop-row prop-check">
          <input
            type="checkbox"
            checked={section.vertical !== null}
            onChange={(e) =>
              setSection({
                vertical: e.currentTarget.checked ? { side: "front", position: 0.5 } : null,
              })
            }
          />
          <span>{t("Cut away a part from one side")}</span>
        </label>
        {section.vertical && (
          <>
            <label className="prop-row">
              <span className="prop-label">{t("Cut away from")}</span>
              <select
                value={section.vertical.side}
                onChange={(e) =>
                  setSection({
                    vertical: {
                      side: e.currentTarget.value as SectionSide,
                      position: section.vertical?.position ?? 0.5,
                    },
                  })
                }
              >
                {SIDES.map(([side, label]) => (
                  <option key={side} value={side}>
                    {label()}
                  </option>
                ))}
              </select>
            </label>
            <label className="prop-row">
              <span className="prop-label">{t("Part cut away")}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(section.vertical.position * 100)}
                onChange={(e) =>
                  setSection({
                    vertical: {
                      side: section.vertical?.side ?? "front",
                      position: Number(e.currentTarget.value) / 100,
                    },
                  })
                }
              />
              <span className="prop-unit">{Math.round(section.vertical.position * 100)} %</span>
            </label>
          </>
        )}
        <p className="muted small">
          {t("A section only opens the view into the home: it is not stored and not in photos.")}
        </p>
      </fieldset>

      <fieldset className="settings3d-group">
        <legend>{t("Location")}</legend>
        <LocationFields />
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
          <span className="prop-label">{t("Time of day")}</span>
          <input
            type="range"
            min={0}
            max={1435}
            step={5}
            value={toMinutes(time)}
            disabled={fixed || playing}
            onChange={(e) => study(date, fromMinutes(Number(e.currentTarget.value)))}
            onPointerUp={commitStudy}
            onKeyUp={commitStudy}
            onBlur={commitStudy}
          />
          <span className="prop-unit">{time}</span>
        </label>
        <label className="prop-row">
          <span className="prop-label">{t("Day of the year")}</span>
          <input
            type="range"
            min={1}
            max={365}
            step={1}
            value={dayOfYear(date)}
            disabled={fixed || playing}
            onChange={(e) => study(fromDayOfYear(date, Number(e.currentTarget.value)), time)}
            onPointerUp={commitStudy}
            onKeyUp={commitStudy}
            onBlur={commitStudy}
          />
          <span className="prop-unit">{date.slice(5)}</span>
        </label>
        <div className="settings3d-buttons">
          <button
            type="button"
            disabled={fixed}
            aria-pressed={playing}
            onClick={() => {
              if (playing) commitStudy();
              setPlaying(!playing);
            }}
            title={t("Lets the sun run through the day; stopping keeps the time shown")}
          >
            {playing ? t("Stop") : t("Play the day")}
          </button>
          <label className="settings3d-check">
            <input
              type="checkbox"
              checked={shadows}
              onChange={(e) => setShadows(e.currentTarget.checked)}
            />
            {t("Shadows")}
          </label>
        </div>
        <label className="prop-row">
          <span className="prop-label">{t("Date")}</span>
          <input
            key={`date-${sun?.date}`}
            type="date"
            defaultValue={sun?.date}
            disabled={fixed || playing}
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
            disabled={fixed || playing}
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
            disabled={fixed || playing}
            onClick={() => void run("sun_update", nowIn(sun?.time_zone ?? "UTC"))}
          >
            {t("Now")}
          </button>
          <button
            type="button"
            disabled={fixed || playing}
            onClick={() =>
              void run("sun_update", { date: `${new Date().getFullYear()}-06-21`, time: "12:00" })
            }
          >
            {t("Summer noon")}
          </button>
          <button
            type="button"
            disabled={fixed || playing}
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
