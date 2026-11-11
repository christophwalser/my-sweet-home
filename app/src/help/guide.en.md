# Getting started

My Sweet Home plans homes in 2D and shows them in 3D. It opens and saves Sweet Home 3D files (`.sh3d`), so you can switch between both programs at any time.

The window has four parts:

- **Catalog** on the left: furniture and textures to place, with a search field. Below it, the furniture of the open home.
- **Plan** in the middle: walls, rooms, furniture, dimensions and texts seen from above, one tab per level.
- **3D view** below the plan: the home as an aerial view or as a virtual visit.
- **Properties** on the right: the values of the selected element, or of the home when nothing is selected.

Every change can be undone with **Ctrl+Z** and redone with **Ctrl+Y**. **Ctrl+K** searches all commands by name.

# Drawing the plan

Choose a tool in the tool bar or in the **Plan** menu, then click in the plan. The keys **1** to **6** choose walls, rooms, lines, dimensions, texts and the measure tool, in the order of the tool bar.

## Walls

- Click the start point, then each corner. **Double-click** or **Enter** ends the wall, **Escape** cancels it, **Backspace** removes the last point.
- Type a length and press **Enter** to fix the next wall at that length.
- Magnetism snaps to right angles, 45°, parallel walls and wall ends; hold **Shift** for 1° steps and **Alt** to switch magnetism off for a moment.
- Select a wall to change its thickness, height (also different at both ends), length, colors, textures, surface (matt or shiny), baseboards and pattern. **Make 90°** straightens the corner to the next wall.
- Round walls are drawn with the arrow next to the wall tool.

## Rooms

- Click the corners of a room, or **double-click** inside walls to create a room that fills them.
- The properties set the name, the floor and ceiling (color, texture, matt or shiny) and whether the area is shown. Drag the name or area in the plan to move it.

## Dimensions, texts and lines

- The dimension tool measures between two clicks; a third click places the dimension line.
- Texts and polylines (straight or curved) have their own tools; their style is set in the properties.
- The measure tool shows a distance without adding anything to the plan. Its second mode, the **ruler**, draws a guide line that stays in the plan to help place elements; it is saved with the home but not printed. Select a ruler and press **Del** to remove it, or use **Plan › Delete rulers of this level**. Color and dashes of a ruler are set in its properties; the defaults for new rulers and the color of the measure tool are under **Preferences › Tools**.

## Background image

**Plan › Import background image** places a scanned plan or a page of a PDF under the plan. Mark a known length and type it in, then set the origin. Walls and rooms can then be drawn on top at the right scale.

## Locking the base plan

**Plan › Lock base plan** keeps walls, rooms, texts, doors, windows and fixed furniture from being selected, so only movable furniture can be moved.

# Levels and stairs

- The **Levels** menu adds levels above, at the same elevation, or deletes one. Each level has a tab above the plan.
- The properties of a level set its name, elevation, height and floor thickness.
- A staircase from the catalog cuts a hole in the floor above. In the virtual visit you can walk up its steps.
- **3D view › All levels** shows the levels above the selected one too.

# Furniture

## Placing furniture

- Drag a piece from the catalog into the plan.
- Doors and windows snap into the nearest wall, take its thickness and show the distances to the wall ends and other openings.
- Pieces dropped onto a table, a shelf or another piece land on top of it.

## Changing furniture

- Drag a piece to move it, use its handles to rotate it, change its elevation, height and size. Arrow keys move the selection by 1 cm (with **Shift** 10 cm).
- The properties set name, description, position, angle, tilt, size, color or texture of the whole piece, surface (like the model, matt, shiny), mirror image, visibility and whether it belongs to the base plan.
- **Materials** changes the color, texture and shininess of single parts of the model.
- When several elements are selected, the properties list them below the common values: **×** takes one out of the selection, a click on its name selects only it.
- Several pieces can be grouped, aligned and distributed (**Furniture** menu). **Paste style** gives the selection the colors and textures of the copied element.

## Furniture list

The list below the catalog shows the furniture of the home. Click a column header to sort. **Columns…** chooses the columns; the choice is saved in the home, as in Sweet Home 3D.

## Prices

Choose a currency in **Preferences › General › Prices** to see prices. The properties then have a price field (and VAT when value added tax is switched on), and the furniture list can show price columns with a total.

# Textures and libraries

- Texture fields in the properties open a searchable list of all textures.
- **Furniture › Add to library** imports models (OBJ, DAE, 3DS, glTF, FBX, STL, 3MF, PLY, VRML, ZIP) and textures (JPG, PNG, BMP, GIF, WebP, TIFF, SVG, material packages). Files can also be dropped onto the catalog.
- **Libraries…** opens the library editor: create libraries, change the properties of items, move them to other categories, import and remove.
- **Add… › Search online…** in the catalog searches the free libraries of Sweet Home 3D, ambientCG and Poly Haven and imports with one click.

Everything you import is stored in Sweet Home 3D's library folders, so both programs use it.

# 3D view

- **Aerial view**: drag to turn around the home, right-drag to move, the wheel zooms. Double-click a surface to turn around that point.
- **Virtual visit**: drag to look around, **W A S D** or the arrow keys to walk, **Q / E** down and up, **Shift** faster. Walls stop you; open doors let you through. The visitor is shown in the plan and can be moved there.
- **Points of view** stores and recalls camera positions.
- **3D settings** set ground and sky, light and wall transparency, the location (search by address) and the date and time of the sun.

# Photos and videos

- **Create photo** renders the current 3D view: **Draft** in seconds, **Good** and **Best** with path tracing (soft shadows, indirect light, glass). Lenses: normal, fisheye or a 360° panorama.
- Choose stored points of view in the photo dialog to render a photo of each into a folder in one go.
- **Create video** renders a flight along a camera path that you record from points in the 3D view.

# Print and export

**File › Print / export** prints or saves the furniture list, the plan of each level and the 3D view as PDF. Choose paper, orientation and scale (e.g. 1:100). Header and footer may contain `$pageNumber`, `$pageCount`, `$planScale`, `$name`, `$file`, `$date` and `$time`.

The same dialog exports the plan as PDF, SVG or PNG, the furniture list as CSV and the 3D model as OBJ.

# Preferences

**Preferences** (gear in the tool bar) sets units (cm, mm, m, inch), the grid, magnetism and angle steps, the defaults of new walls, rooms and texts, the 3D quality and walking speed, the theme and language, autosave, prices and online catalogs.

# Files and safety

- **File › New**, **Open** and **Save** work with Sweet Home 3D files. Each home opens in its own window; **Open recent** lists the last homes.
- Every few minutes a copy of changed homes is kept. After a crash the next start offers to open these copies.
- Homes saved here open in Sweet Home 3D 7 and keep everything Sweet Home 3D stores, also what this program does not show.

# Automation

Everything the window can do is also a command for scripts and AI assistants:

- `msh` on the command line works on files (`msh exec` reads one command per line) or, with `--live`, on the home open in the window.
- `msh mcp` starts a server for AI assistants such as Claude (Model Context Protocol). They can build and change homes, take pictures of the 3D view and check their work.

`msh commands` lists all commands with their parameters.

# Keyboard shortcuts

**Help › Keyboard shortcuts** lists all shortcuts of the menus and the keys of the plan and the 3D view.
