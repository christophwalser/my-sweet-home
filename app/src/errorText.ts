// Error messages for the error bar: the English messages of the core (written for the CLI and
// AI agents) turned into a translated explanation of what went wrong and what to do.

import { t } from "./i18n";

type Rule = [RegExp, (m: RegExpMatchArray) => string];

const RULES: Rule[] = [
  [/^nothing to undo$/, () => t("There is nothing to undo.")],
  [/^nothing to redo$/, () => t("There is nothing to redo.")],
  [/^the clipboard is empty/, () => t("The clipboard is empty. Copy an element first.")],
  [
    /^unknown (wall|room|level|label|polyline|guide|dimension line|piece of furniture|texture|piece) /,
    () => t("The element no longer exists. It may have been deleted or changed by undo."),
  ],
  [
    /^no piece '/,
    () => t("The element no longer exists. It may have been deleted or changed by undo."),
  ],
  [/^no stored point of view/, () => t("This point of view no longer exists.")],
  [/^a wall cannot be joined to itself$/, () => t("A wall cannot be joined to itself.")],
  [
    /^arc walls cannot be joined$/,
    () => t("Round walls cannot be joined. Only straight walls can."),
  ],
  [
    /^parallel walls cannot be joined$/,
    () => t("Parallel walls cannot be joined: their axes never meet."),
  ],
  [
    /^the walls are on different levels$/,
    () => t("The walls are on different levels. Select walls of one level."),
  ],
  [/^wall_join needs/, () => t("Select the walls to join.")],
  [/^the selected walls are joined already$/, () => t("The selected walls are joined already.")],
  [
    /^the walls cross each other/,
    () => t("The walls cross each other. Split one of them at the crossing first."),
  ],
  [
    /^this end of the wall is not joined$/,
    () => t("This end of the wall is not joined to another wall."),
  ],
  [/^arc walls cannot be split$/, () => t("Round walls cannot be split.")],
  [/^arc walls cannot be rotated this way$/, () => t("Round walls cannot be rotated this way.")],
  [
    /^(a wall has no length|the wall has no direction)$/,
    () => t("The wall has no length: its start and end are at the same point."),
  ],
  [/^a wall path needs at least 2 points$/, () => t("A wall needs at least 2 points.")],
  [
    /^there is already a room with this outline/,
    () => t("These walls already enclose a room. Select it to change it."),
  ],
  [
    /^the point \(.*\) is not enclosed by walls$/,
    () => t("The walls do not enclose this point. Click inside walls that form a closed outline."),
  ],
  [/^a room needs at least 3 points$/, () => t("A room needs at least 3 corners.")],
  [/^a polyline needs at least 2 points$/, () => t("A line needs at least 2 points.")],
  [/^a guide needs two different points$/, () => t("A guide line needs two different points.")],
  [
    /^(a group needs at least two pieces|give the IDs of at least two pieces)$/,
    () => t("Select at least two pieces of furniture."),
  ],
  [
    /^the pieces are on different levels$/,
    () => t("The pieces of furniture are on different levels."),
  ],
  [/^label text must not be empty$/, () => t("The text must not be empty.")],
  [/^the (name is empty|name must not be empty)$/, () => t("The name must not be empty.")],
  [/^the category is empty$/, () => t("The category must not be empty.")],
  [/must be positive$/, () => t("The value must be greater than zero.")],
  [/(must be a number|must be numbers|must be finite numbers)$/, () => t("Enter a number.")],
  [/^invalid color/, () => t("The color is not valid.")],
  [/^unknown time zone/, () => t("The time zone is unknown.")],
  [/^this time does not exist/, () => t("This time does not exist: the clock changes then.")],
  [/is not (HH:MM|YYYY-MM-DD|YYYY-MM-DDTHH:MM)$/, () => t("The date or time is not valid.")],
  [/^the search text is empty$/, () => t("Enter a search text.")],
  [
    /^address search failed: (.*)$/,
    (m) =>
      t("The address search failed. Check the internet connection. ({reason})", { reason: m[1] }),
  ],
  [
    /^unexpected answer of the address search/,
    () => t("The address search sent an unexpected answer."),
  ],
  [
    /^(map download failed|unreadable map tile|map could not be written)/,
    () => t("The map could not be loaded. Check the internet connection."),
  ],
  [
    /^(the catalog server did not answer|cannot read from the catalog server|the online source did not answer|the download failed|unexpected answer of)/,
    () => t("The server did not answer as expected. Check the internet connection and try again."),
  ],
  [/^the download is larger than 500 MB$/, () => t("The download is larger than 500 MB.")],
  [
    /^(the download is no ZIP file|cannot read the ZIP file|the ZIP file contains no library|not a valid library|.* contains no furniture or texture catalog)/,
    () => t("The file is no furniture or texture library."),
  ],
  [/^the user library folder is unknown$/, () => t("The folder of your libraries is unknown.")],
  [
    /^the home does not contain the models of these pieces/,
    () =>
      t(
        "The home does not contain the models of this furniture. Copy its items in the catalog instead.",
      ),
  ],
  [/^the icon is not a PNG image$/, () => t("The icon must be a PNG image.")],
  [
    /^the model contains no triangles$/,
    () => t("The model contains no surfaces that could be shown."),
  ],
  [/^the model files are larger than 200 MB$/, () => t("The model files are larger than 200 MB.")],
  [/^invalid glTF model/, () => t("The model file is damaged or not supported.")],
  [
    /^(ZIP error|XML error|invalid structure|element <)/,
    () => t("The file is damaged or not a Sweet Home 3D file."),
  ],
  [
    /^(I\/O error|cannot read|cannot write)(.*)$/,
    (m) =>
      t(
        "The file could not be read or written. Check that it exists and is not open elsewhere. ({reason})",
        {
          reason: m[0],
        },
      ),
  ],
];

/** Translated explanation of an error raised by a command (or anything else). */
export function errorText(error: unknown): string {
  const raw = String(error)
    .replace(/^Error: /, "")
    .trim();
  // Wrong parameters name the command; the reason is what counts
  const message = raw.replace(/^invalid parameters for '[^']*': /, "");
  for (const [re, text] of RULES) {
    const m = message.match(re);
    if (m) return text(m);
  }
  return t("The action failed: {reason}", { reason: message });
}
