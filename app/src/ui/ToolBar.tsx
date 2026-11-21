// Tool bar: quick access to the most used commands, in groups. Split buttons run the variant
// chosen last with one click; only their small arrow opens the other variants.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { formatShortcut, t } from "../i18n";
import { usePreferences } from "../preferences";
import { useStore } from "../store";
import { type Command, command, isEnabled, type MenuEntry, runCommand } from "./commands";
import Icon, { type IconName } from "./Icon";
import MenuList from "./MenuList";
import { useDarkMode, useUi } from "./uiStore";
import { stepLabel } from "./undoLabels";

/** Tooltip of a command: label, shortcut and hint. */
function tip(c: Command): string {
  return `${c.label}${c.shortcut ? ` (${formatShortcut(c.shortcut)})` : ""}${c.hint ? `\n${c.hint}` : ""}`;
}

/** Open state of a drop-down that closes on a click outside of it or on Escape. */
function useDropdown(): [boolean, (open: boolean) => void, React.RefObject<HTMLDivElement | null>] {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return [open, setOpen, ref];
}

function ToolButton({
  id,
  icon,
  text,
  plain,
}: {
  id: string;
  icon?: IconName;
  text?: string;
  /** Not shown as pressed when the command is checked */
  plain?: boolean;
}) {
  const c = command(id);
  const checked = plain ? undefined : c.checked?.();
  return (
    <button
      type="button"
      className={`tool-button ${checked ? "on" : ""}`}
      disabled={!isEnabled(c)}
      aria-pressed={checked}
      title={tip(c)}
      aria-label={c.label}
      onClick={() => runCommand(c)}
    >
      <Icon name={icon ?? c.icon ?? "help"} />
      {text && <span className="tool-text">{text}</span>}
    </button>
  );
}

/** Button that runs the remembered variant; its arrow lists all variants. */
function SplitButton({ button, variants }: { button: string; variants: string[] }) {
  const remembered = useUi((s) => s.variants[button]);
  const setVariant = useUi((s) => s.setVariant);
  const [open, setOpen, ref] = useDropdown();
  // The active variant (also when chosen by shortcut or menu), else the one chosen last
  const active = variants.find((id) => command(id).checked?.());
  const current = command(
    active ?? (variants.includes(remembered ?? "") ? (remembered as string) : variants[0]),
  );
  const checked = active !== undefined;
  const entries: MenuEntry[] = variants.map((id) => {
    const c = command(id);
    return {
      kind: "command",
      command: {
        ...c,
        run: () => {
          setVariant(button, id);
          return c.run();
        },
      },
    };
  });
  return (
    <div className="tool-anchor" ref={ref}>
      <div className="tool-split">
        <button
          type="button"
          className={`tool-button ${checked ? "on" : ""}`}
          disabled={!isEnabled(current)}
          aria-pressed={checked}
          title={tip(current)}
          aria-label={current.label}
          onClick={() => runCommand(current)}
        >
          <Icon name={current.icon ?? "help"} />
        </button>
        <button
          type="button"
          className={`tool-button tool-arrow ${open ? "on" : ""}`}
          disabled={!isEnabled(current)}
          title={t("Variants of {v0}", { v0: current.label.toLowerCase() })}
          aria-label={t("Variants of {v0}", { v0: current.label.toLowerCase() })}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevdown" size={12} />
        </button>
      </div>
      {open && <MenuList entries={entries} label={current.label} onDone={() => setOpen(false)} />}
    </div>
  );
}

/** Button that only opens a menu (levels, alignment). */
function MenuButton({
  label,
  icon,
  text,
  disabled,
  entries,
}: {
  label: string;
  icon: IconName;
  text?: string;
  disabled?: boolean;
  entries: () => MenuEntry[];
}) {
  const [open, setOpen, ref] = useDropdown();
  return (
    <div className="tool-anchor" ref={ref}>
      <button
        type="button"
        className={`tool-button ${open ? "on" : ""}`}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={icon} />
        {text && <span className="tool-text">{text}</span>}
        <Icon name="chevdown" size={12} className="tool-chevron" />
      </button>
      {open && <MenuList entries={entries()} label={label} onDone={() => setOpen(false)} />}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add a border and legend
    <div role="group" aria-label={label} className="tool-group">
      {children}
    </div>
  );
}

const cmd = (id: string): MenuEntry => ({ kind: "command", command: command(id) });

export default function ToolBar() {
  // Re-render when anything the buttons show changes
  const opened = useStore((s) => s.opened);
  useStore((s) => s.selection);
  useStore((s) => s.tool);
  const viewMode = useStore((s) => s.viewMode);
  const selectedLevel = useStore((s) => s.selectedLevel);
  useUi((s) => s.theme);
  usePreferences((s) => s.grid);
  const dark = useDarkMode();
  const setViewMode = useStore((s) => s.setViewMode);

  const levels = [...(opened?.home.levels ?? [])].sort(
    (a, b) =>
      a.attrs.elevation - b.attrs.elevation ||
      (a.attrs.elevation_index ?? 0) - (b.attrs.elevation_index ?? 0),
  );
  const levelName = levels.find((l) => l.attrs.id === selectedLevel)?.attrs.name;
  const locked = opened?.home.attrs.base_plan_locked === true;

  return (
    <div role="toolbar" aria-label={t("Tools")} className="tool-bar">
      <Group label={t("File")}>
        <ToolButton id="file.new" />
        <ToolButton id="file.open" />
        <ToolButton id="file.save" />
      </Group>
      <Group label={t("History")}>
        <ToolButton id="edit.undo" />
        <ToolButton id="edit.redo" />
        <MenuButton
          label={t("History: undo several steps at once")}
          icon="recent"
          disabled={!opened?.undoHistory?.length}
          entries={() =>
            (opened?.undoHistory ?? []).map(
              (step, i): MenuEntry => ({
                kind: "command",
                command: {
                  id: `history.${i}`,
                  label: `${i + 1}. ${stepLabel(step)}`,
                  icon: "undo",
                  // Undoes this step and all newer ones
                  run: async () => {
                    for (let n = 0; n <= i; n++) await useStore.getState().undo();
                  },
                },
              }),
            )
          }
        />
      </Group>
      <Group label={t("Selection")}>
        <ToolButton id="tool.select" />
        <ToolButton id="tool.pan" />
      </Group>
      <Group label={t("Draw")}>
        <SplitButton button="walls" variants={["tool.wall", "tool.arcwall"]} />
        <SplitButton button="rooms" variants={["tool.room", "tool.roomauto"]} />
        <ToolButton id="tool.polyline" />
        <SplitButton button="roofs" variants={["roof.add", "roof.addRect"]} />
        <SplitButton
          button="stairs"
          variants={["stair.add", "stair.addL", "stair.addU", "stair.addSpiral", "opening.add"]}
        />
        <SplitButton button="dimensions" variants={["tool.dimension", "tool.heightdim"]} />
        <ToolButton id="tool.label" />
        <SplitButton button="measure" variants={["tool.measure", "tool.ruler"]} />
      </Group>
      <Group label={t("Levels")}>
        <MenuButton
          label={t("Levels")}
          icon="level"
          text={levelName ?? t("No levels")}
          disabled={!opened}
          entries={() => [
            ...levels.map(
              (l): MenuEntry => ({
                kind: "command",
                command: {
                  id: `level.select.${l.attrs.id}`,
                  label: l.attrs.name,
                  icon: "level",
                  checked: () => useStore.getState().selectedLevel === l.attrs.id,
                  run: () => useStore.getState().selectLevel(l.attrs.id),
                },
              }),
            ),
            ...(levels.length ? [{ kind: "separator" } as MenuEntry] : []),
            cmd("level.add"),
            cmd("level.addSame"),
            cmd("level.duplicate"),
            { kind: "separator" },
            cmd("level.rename"),
            cmd("level.delete"),
          ]}
        />
        <ToolButton id="level.add" />
      </Group>
      <Group label={t("Arrange")}>
        <MenuButton
          label={t("Align and distribute the selected furniture")}
          icon="align"
          disabled={!opened}
          entries={() => [
            cmd("furniture.align.left"),
            cmd("furniture.align.right"),
            cmd("furniture.align.front"),
            cmd("furniture.align.back"),
            cmd("furniture.align.top"),
            cmd("furniture.align.bottom"),
            cmd("furniture.align.side_by_side"),
            { kind: "separator" },
            cmd("furniture.distributeH"),
            cmd("furniture.distributeV"),
          ]}
        />
        <SplitButton button="flip" variants={["edit.flipH", "edit.flipV"]} />
        <ToolButton id="furniture.rotate" />
      </Group>
      <Group label={t("View")}>
        <ToolButton id="plan.zoomOut" />
        <ToolButton id="plan.fit" />
        <ToolButton id="plan.zoomIn" />
        <ToolButton id="edit.lockBasePlan" icon={locked ? "lock" : "unlock"} />
      </Group>
      <span className="spacer" />
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add a border and legend */}
      <div role="group" aria-label={t("3D view mode")} className="view-mode">
        <button
          type="button"
          className={`chip ${viewMode === "aerial" ? "on" : ""}`}
          aria-pressed={viewMode === "aerial"}
          disabled={!opened}
          onClick={() => setViewMode("aerial")}
          title={t("Aerial view (F7)")}
        >
          <Icon name="aerial" size={16} />
          <span className="chip-text">{t("Aerial view")}</span>
        </button>
        <button
          type="button"
          className={`chip ${viewMode === "observer" ? "on" : ""}`}
          aria-pressed={viewMode === "observer"}
          disabled={!opened}
          onClick={() => setViewMode("observer")}
          title={t("Virtual visit (F8)")}
        >
          <Icon name="visit" size={16} />
          <span className="chip-text">{t("Virtual visit")}</span>
        </button>
      </div>
      <ToolButton id="view3d.photo" />
      <ToolButton id="view3d.video" />
      <ToolButton id="window.theme" icon={dark ? "sun" : "moon"} plain />
      <ToolButton id="file.preferences" />
    </div>
  );
}
