// Page setup of the print and export dialog: paper, scale and title block as parameters of
// export_document and export_plan, and the title block remembered between sessions.

/** Papers offered, by the name the export commands take. */
export const PAPERS: [string, string][] = [
  ["a0", "A0"],
  ["a1", "A1"],
  ["a2", "A2"],
  ["a3", "A3"],
  ["a4", "A4"],
  ["a5", "A5"],
  ["letter", "Letter"],
  ["legal", "Legal"],
  ["tabloid", "Tabloid"],
];

/** Scales offered besides "fit to page" and a scale of one's own. */
export const SCALES = [20, 25, 50, 75, 100, 200, 250, 500, 1000];

/** Paper parameter: a named paper, or "custom" with width and height in mm. */
export function paperParam(choice: string, width: number, height: number): string {
  if (choice !== "custom") return choice;
  const w = Math.round(Math.min(5000, Math.max(50, width || 0)));
  const h = Math.round(Math.min(5000, Math.max(50, height || 0)));
  return `${w}x${h}`;
}

/**
 * Scale parameter: undefined to fit the plan to the page, else the denominator of a listed
 * scale or of one's own ("1:75", "75", "1 : 75").
 */
export function scaleParam(choice: string, custom: string): number | undefined {
  if (choice === "fit") return undefined;
  if (choice !== "custom") return Number(choice);
  const text = custom.replace(/\s/g, "").replace(/^1:/, "").replace(",", ".");
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The title block of plan pages: on or off, project and author. */
export type TitleBlockSetup = { on: boolean; project: string; author: string };

const TITLE_BLOCK_KEY = "msh.export.titleBlock";

export function loadTitleBlock(): TitleBlockSetup {
  try {
    const stored = JSON.parse(localStorage.getItem(TITLE_BLOCK_KEY) ?? "null");
    if (stored && typeof stored === "object") {
      return {
        on: stored.on === true,
        project: typeof stored.project === "string" ? stored.project : "",
        author: typeof stored.author === "string" ? stored.author : "",
      };
    }
  } catch {
    // Unreadable or no storage: defaults
  }
  return { on: false, project: "", author: "" };
}

export function saveTitleBlock(setup: TitleBlockSetup): void {
  try {
    localStorage.setItem(TITLE_BLOCK_KEY, JSON.stringify(setup));
  } catch {
    // Not remembered: no harm
  }
}

/** Parameters of the page setup shared by export_document and export_plan (PDF). */
export function pageParams(setup: {
  paper: string;
  orientation: string;
  scale: number | undefined;
  titleBlock: TitleBlockSetup;
}): Record<string, unknown> {
  const params: Record<string, unknown> = { paper: setup.paper };
  if (setup.orientation !== "auto") params.landscape = setup.orientation === "landscape";
  if (setup.scale !== undefined) params.scale = setup.scale;
  const tb = setup.titleBlock;
  if (tb.on) {
    params.title_block = {
      ...(tb.project.trim() && { project: tb.project.trim() }),
      ...(tb.author.trim() && { author: tb.author.trim() }),
    };
  }
  return params;
}
