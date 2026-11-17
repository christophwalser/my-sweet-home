# Getting started

My Sweet Home plans homes in 2D and shows them in 3D. It opens and saves Sweet Home 3D files (`.sh3d`), so you can switch between both programs at any time.

The window has four parts:

- **Catalog** on the left: furniture and textures to place, with a search field. Below it, the furniture of the open home.
- **Plan** in the middle: walls, rooms, furniture, dimensions and texts seen from above, one tab per level.
- **3D view** below the plan: the home as an aerial view or as a virtual visit.
- **Properties** on the right: the values of the selected element, or of the home when nothing is selected.

Every change can be undone with **Ctrl+Z** and redone with **Ctrl+Y**. **Ctrl+K** searches all commands by name.

# Drawing the plan

Choose a tool in the tool bar or in the **Plan** menu, then click in the plan. The keys **1** to **6** choose walls, rooms, lines, dimensions, texts and the measure tool, in the order of the tool bar. A second digit right after it chooses the further entries of the button's drop-down, counted from 1: **1** then **1** chooses round walls, **2** then **1** **Room from walls**, **4** then **1** the height dimension, **6** then **1** the ruler.

## Walls

- Click the start point, then each corner. **Double-click**, **Enter** or **Escape** ends the wall, **Backspace** removes the last point.
- Type a length and press **Enter** to fix the next wall at that length. Units and arithmetic work too: `3.5m`, `5'3"`, `240+11.5`. **Tab** switches to the angle (degrees, clockwise from the x axis); the value not typed follows the mouse. `@dx,dy` places the point relative to the last one, `#x,y` at absolute coordinates, `300<45` gives length and angle at once.
- Magnetism snaps to right angles, 45°, parallel walls, wall ends, wall faces (a new wall also starts flush with the corner of a wall face), the foot of the perpendicular on a nearby wall and rulers; hold **Shift** for 1° steps and **Alt** to switch magnetism off for a moment.
- Select a wall to change its thickness, height (also different at both ends), length, colors, textures, surface (matt or shiny), baseboards and pattern; **Top** gives a wall lower than the ceiling (e.g. a half-height wall) its own color and texture on top. **Make 90°** straightens the corner to the next wall.
- Round walls are drawn with the arrow next to the wall tool.

## Rooms

- Click the corners of a room, or **double-click** inside walls to create a room that fills them. Walls that already enclose a room give no second one.
- A selected room has a handle in the middle of each edge: drag it to add a corner, or with **Shift** to move the whole edge parallel. Dragged corners snap to right angles and straight lines with the neighboring edges.
- The properties set the name, the floor and ceiling (color, texture, matt or shiny) and whether the area is shown. Drag the name or area in the plan to move it.

## Dimensions, texts and lines

- The dimension tool measures between two clicks; a third click places the dimension line.
- Texts and polylines (straight or curved) have their own tools; their style is set in the properties.
- A text is typed right where you click in the plan; **Enter** finishes, **Shift+Enter** starts a new line. **Double-click** a text to change it in place.
- The measure tool shows a distance without adding anything to the plan. Like walls, its end point (and that of a ruler) can be typed: a length, **Tab** for the angle, or `@dx,dy`. Its second mode, the **ruler**, draws a guide line that stays in the plan to help place elements; it is saved with the home but not printed. Select a ruler and press **Del** to remove it, or use **Plan › Delete rulers of this level**. Color and dashes of a ruler are set in its properties, and **On all levels** shows it on every level, e.g. to line up the floors; rulers can be copied and pasted like other elements; the defaults for new rulers and the color of the measure tool are under **Preferences › Tools**. **Ruler at a distance…** in the context menu of a wall or ruler adds a parallel ruler: move the mouse to its side and click, or type the distance (from the wall face) and press **Enter**.

## Precision and magnetism

- The status bar under the plan switches the magnetism on and off (**F9**) and, separately, its angles, objects (**F3**: ends, middles, faces and corners of walls, rooms and furniture) and rulers. The button with the snap radius and angle step (or a right click on the bar) changes them. It also shows the position of the mouse.
- Elements snap to the ends, middles and lines of rulers and to their crossings with walls and other rulers.
- The marker shows what a point snaps to: a square for ends and corners, a triangle for middles, a cross for crossings, ⊥ for the foot of a perpendicular, a diamond for ruler points, a circle for a point on a line.
- Moved furniture and other elements line up with the edges and middles of nearby furniture and with wall faces; a dashed line shows the partner. Between two pieces they snap to equal gaps (“= 60”). A single piece shows its distances to the next wall or piece in every direction.
- When a piece is selected, click one of its distances and type a value: the piece moves to exactly that distance.
- Dragged elements move in steps of 1 cm, finer when you zoom in (down to 1 mm); with **Alt** they move freely. **Shift** while dragging keeps the move on one axis (for a single piece or wall along its own direction).
- The arrow keys move the selection by 1 cm, with **Shift** by 10 cm and with **Alt** by 1 mm.
- Number fields in the properties calculate: `240+11.5`, `3m - 12cm`, and change the value relatively with `+5`, `+-5`, `*2` or `/2`. The arrow keys and the mouse wheel step the value in a field (with **Shift** by 10 steps); **Enter** applies it.

## Background image

**Plan › Import background image** places a scanned plan or a page of a PDF under the plan. Mark a known length and type it in, then set the origin. Walls and rooms can then be drawn on top at the right scale.

## Terrain and scans as reference objects

Terrain models, laser scans or neighbor houses imported as furniture are marked as **Reference object** in their properties. The plan then shows them faint at the bottom, under the background image: clicks, the rubber band and the magnetism ignore them, so walls and rooms are drawn on top undisturbed. The home details (click an empty spot of the plan) list the reference objects: show or hide each one there, or click its name to select and change it; the 3D view shows them as before. Reference objects are not furniture: they are not in the furniture list, and the plan shows them under every level above their own. **Make it a piece of furniture** in their panel turns one back. Pieces of a lower level that reach up into the shown level (e.g. a tall terrain model) are shown the same way; staircases stay selectable.

## Locking the base plan

**Plan › Lock base plan** keeps walls, rooms, texts, doors, windows and fixed furniture from being selected, so only movable furniture can be moved.

# Levels and stairs

- The **Levels** menu adds levels above, at the same elevation, or deletes one. Each level has a tab above the plan.
- The properties of a level set its name, elevation, height and floor thickness.
- A staircase from the catalog cuts a hole in the floor above. In the virtual visit you can walk up its steps.
- **3D view › All levels** shows the levels above the selected one too.

# Furniture

## Placing furniture

- Drag a piece from the catalog into the plan. Near a wall it turns with its back to the wall already while you drag it.
- Doors and windows snap into the nearest wall, take its thickness and show the distances to the wall ends and other openings.
- Pieces dropped onto a table, a shelf or another piece land on top of it.

## Changing furniture

- Drag a piece to move it, use its handles to rotate it, change its elevation, height and size. Arrow keys move the selection by 1 cm (with **Shift** 10 cm, with **Alt** 1 mm). **Shift+click** adds an element to the selection or takes it out. **Tab** selects the next element under the mouse, e.g. a room under a piece. A rubber band dragged from left to right selects what lies inside it; dragged from right to left (dashed) also what it touches.
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
- **3D settings** set ground and sky, light and wall transparency, the location (search by address) and the date and time of the sun. The location can also be set in the properties of the home. **Align north with the map** shows the walls over a map of the location: turn them with the mouse wheel until they match the building, and the compass points north. Drag the walls to move them, drag beside them to move the map; **Ctrl+wheel** or the buttons zoom.
- Lamps light the virtual visit; walls stop the light of the lamps nearest to you.

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
- **No planning or building guarantee:** dimensions, areas, quantities and prices are not verified and may be inaccurate, and nothing is checked against structural safety, building codes or permits. Have plans checked by qualified professionals before you build, buy or order anything. My Sweet Home is free software without warranty (GNU GPL 3 or later) and not affiliated with the makers of Sweet Home 3D.

# Automation

Everything the window can do is also a command for scripts and AI assistants:

- `msh` on the command line works on files (`msh exec` reads one command per line) or, with `--live`, on the home open in the window.
- `msh mcp` starts a server for AI assistants such as Claude (Model Context Protocol). They can build and change homes, take pictures of the 3D view and check their work.

`msh commands` lists all commands with their parameters.

# Keyboard shortcuts

**Help › Keyboard shortcuts** lists all shortcuts of the menus and the keys of the plan and the 3D view.
