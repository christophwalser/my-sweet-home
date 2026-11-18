# Getting started

My Sweet Home plans homes in 2D and shows them in 3D. It opens and saves Sweet Home 3D files (`.sh3d`), so you can switch between both programs at any time.

The window has four parts:

- **Catalog** on the left: furniture and textures to place, with a search field. Below it, the furniture of the open home.
- **Plan** in the middle: walls, rooms, furniture, dimensions and texts seen from above, one tab per level.
- **3D view** below the plan: the home as an aerial view or as a virtual visit.
- **Properties** on the right: the values of the selected element, or of the home when nothing is selected.

Every change can be undone with **Ctrl+Z** and redone with **Ctrl+Y**; the **Edit** menu names the step, and the history button beside undo takes back several steps at once. **Ctrl+K** searches all commands by name, also by a few of their letters, and lists the commands used last.

The menu bar works as in Windows: **Alt** or **F10** goes to it and underlines the access keys, **Alt** and a letter opens a menu, the arrow keys move in it, a letter goes to the entries starting with it. The **View** menu holds the zoom, the grid, the rulers and the magnetism, hides the catalog (**F6**) and the properties (**F4**), shows the plan or the 3D view alone and sets the size of the user interface. A side panel can also be dragged shut at its edge; the grip at the window edge brings it back.

Errors stay in the window until you close them; the status bar under the plan lists the messages of the window.

# Drawing the plan

Choose a tool in the tool bar or in the **Plan** menu, then click in the plan. Letters choose the tools: **V** select, **H** move the plan, **W** walls, **F** rooms, **L** lines, **D** dimensions, **T** texts, **M** measure, **G** guide lines. The keys **1** to **6** choose walls, rooms, lines, dimensions, texts and the measure tool too, in the order of the tool bar. A second digit right after it chooses the further entries of the button's drop-down, counted from 1: **1** then **1** chooses round walls, **2** then **1** **Room from walls**, **4** then **1** the height dimension, **6** then **1** the guide line. Hold **Space** and drag to move the plan with any tool.

## Walls

- Click the start point, then each corner. **Double-click** or **Enter** ends the wall, **Escape** discards what is being drawn, **Backspace** removes the last point.
- Type a length and press **Enter** to fix the next wall at that length. Units and arithmetic work too: `3.5m`, `5'3"`, `240+11.5`. **Tab** switches to the angle (degrees, clockwise from the x axis); the value not typed follows the mouse. `@dx,dy` places the point relative to the last one, `#x,y` at absolute coordinates, `300<45` gives length and angle at once.
- Magnetism snaps to right angles, 45°, parallel walls, wall ends, wall faces (a new wall also starts flush with the corner of a wall face), the foot of the perpendicular on a nearby wall and guide lines; hold **Shift** for 1° steps and **Alt** to switch magnetism off for a moment.
- Select a wall to change its thickness, height (also different at both ends), length, colors, textures, surface (matt or shiny), baseboards and pattern; **Top** gives a wall lower than the ceiling (e.g. a half-height wall) its own color and texture on top. **Make 90°** straightens the corner to the next wall.
- Round walls are drawn with the arrow next to the wall tool; their arc is set above the plan and later in the properties.
- Above the plan the wall tool shows its options: thickness, height and **Draw by**. With **Draw by › Left side** or **Right side** the clicked points are one face of the wall, not its axis: draw a room by its inner dimensions or a house by its outer ones. The dashed line shows the clicked points, the filled shape where the wall will be.
- **Direction** in the properties turns a wall around its start to an exact angle. **Stays in place** chooses what a new thickness keeps: the axis or one side of the wall.

## Rooms

- Click the corners of a room, or **double-click** inside walls to create a room that fills them. Walls that already enclose a room give no second one.
- A selected room has a handle in the middle of each edge: drag it to add a corner, or with **Shift** to move the whole edge parallel. Dragged corners snap to right angles and straight lines with the neighboring edges.
- The properties set the name, the floor and ceiling (color, texture, matt or shiny) and whether the area is shown. Drag the name or area in the plan to move it.
- **Walls of this room** in the properties gives all wall sides that face the room the same color, texture, surface and baseboard, whatever the direction each wall was drawn in. A wall longer than the room changes on its whole side.

## Dimensions, texts and lines

- The dimension tool measures between two clicks; a third click places the dimension line.
- Texts and polylines (straight or curved) have their own tools; their style is set in the properties.
- A text is typed right where you click in the plan; **Enter** finishes, **Shift+Enter** starts a new line. **Double-click** a text to change it in place.
- The measure tool shows a distance without adding anything to the plan. Like walls, its end point (and that of a guide line) can be typed: a length, **Tab** for the angle, or `@dx,dy`. Its second mode, the **guide line**, draws a line that stays in the plan to help place elements; it is saved with the home but not printed. Select a guide line and press **Del** to remove it, or use **Plan › Delete guide lines of this level**. Color and dashes of a guide line are set in its properties, and **On all levels** shows it on every level, e.g. to line up the floors; guide lines can be copied and pasted like other elements; the defaults for new guide lines and the color of the measure tool are under **Preferences › Tools**. **Guide line at a distance…** in the context menu of a wall or guide line adds a parallel guide line: move the mouse to its side and click, or type the distance (from the wall face) and press **Enter**.

## Precision and magnetism

- The status bar under the plan switches the magnetism on and off (**F9**) and, separately, its angles, objects (**F3**: ends, middles, faces and corners of walls, rooms and furniture) and guide lines. The button with the snap radius and angle step (or a right click on the bar) changes them. It also shows the position of the mouse.
- Elements snap to the ends, middles and lines of guide lines and to their crossings with walls and other guide lines.
- The marker shows what a point snaps to: a square for ends and corners, a triangle for middles, a cross for crossings, ⊥ for the foot of a perpendicular, a diamond for guide line points, a circle for a point on a line.
- Moved furniture and other elements line up with the edges and middles of nearby furniture and with wall faces; a dashed line shows the partner. Between two pieces they snap to equal gaps (“= 60”). A single piece shows its distances to the next wall or piece in every direction.
- When a piece is selected, click one of its distances and type a value: the piece moves to exactly that distance.
- Dragged elements move in steps of 1 cm, finer when you zoom in (down to 1 mm); with **Alt** they move freely. **Shift** while dragging keeps the move on one axis (for a single piece or wall along its own direction).
- The arrow keys move the selection by 1 cm, with **Shift** by 10 cm and with **Alt** by 1 mm.
- Number fields in the properties calculate: `240+11.5`, `3m - 12cm`, and change the value relatively with `+5`, `+-5`, `*2` or `/2`. The arrow keys and the mouse wheel step the value in a field (with **Shift** by 10 steps); **Enter** applies it, **Escape** takes the typed value back.

## Background image

**Plan › Import background image** places a scanned plan or a page of a PDF under the plan. Mark a known length and type it in, then set the origin. Walls and rooms can then be drawn on top at the right scale. The length is typed in the unit of the preferences (or with a unit, e.g. `8.73 m`); **Opacity** sets how strongly the image shows under the plan.

## Terrain and scans as reference objects

Terrain models, laser scans or neighbor houses imported as furniture are marked as **Reference object** in their properties. The plan then shows them faint at the bottom, under the background image: clicks, the rubber band and the magnetism ignore them, so walls and rooms are drawn on top undisturbed. The home details (click an empty spot of the plan) list the reference objects: show or hide each one there, or click its name to select and change it; the 3D view shows them as before. Reference objects are not furniture: they are not in the furniture list, and the plan shows them under every level above their own. **Make it a piece of furniture** in their panel turns one back. Pieces of a lower level that reach up into the shown level (e.g. a tall terrain model) are shown the same way; staircases stay selectable.

## Locking the base plan

**Plan › Lock base plan** keeps walls, rooms, texts, doors, windows and fixed furniture from being selected, so only movable furniture can be moved.

# Levels and stairs

- The **Levels** menu adds levels above, at the same elevation, or deletes one. Each level has a tab above the plan; **+** next to the tabs adds a level, a right-click on a tab renames, duplicates, moves or deletes it. A crossed-out eye marks a level hidden in 3D.
- **Duplicate level…** starts the next storey: the walls of the level are copied to a new level on top, exactly above their originals. Tick rooms, doors and windows, furniture or texts to copy them too.
- The properties of a level set its name, elevation, height and floor thickness. With **Levels above follow** a new elevation or height moves the levels above along; with **Walls follow the height** the walls as high as the level get the new height, lower ones such as parapets keep theirs.
- The level below lies faded under the plan, and its wall ends and corners attract the pointer, so walls land exactly above each other. The status bar switches this underlay to the level above or off.
- To take single walls and rooms to another level, copy them, switch to that level and paste: the copies lie exactly above the originals. Pasted on their own level they are moved by 20 cm.
- A staircase from the catalog cuts a hole in the floor above. In the virtual visit you can walk up its steps.
- **Levels** in the 3D view chooses what it shows: only the selected level, the levels up to it or all of them. The ticks below switch single levels off for 3D.

# Furniture

## Placing furniture

- Drag a piece from the catalog into the plan. Near a wall it turns with its back to the wall already while you drag it.
- Or double-click a piece in the catalog (or press **Enter**) and click in the plan: the piece hangs at the pointer at its size. **Shift+click** places several, **Esc** ends it.
- **Replace the selection with this** in the menu of a catalog item swaps the selected pieces for it; place, angle, elevation and level stay.
- The catalog remembers the open categories, lists **Favorites** (menu of an item) and the pieces **used last** on top, and shows the items as a list or as tiles. Its rows take the keyboard: arrow keys, **Enter**, **Delete**, **Ctrl+D** and the menu key.
- Doors and windows snap into the nearest wall, take its thickness and show the distances to the wall ends and other openings.
- Pieces dropped onto a table, a shelf or another piece land on top of it.

## Changing furniture

- Drag a piece to move it, use its handles to rotate it, change its elevation, height and size. Arrow keys move the selection by 1 cm (with **Shift** 10 cm, with **Alt** 1 mm). **Shift+click** or **Ctrl+click** adds an element to the selection or takes it out. **Tab** selects the next element under the mouse, e.g. a room under a piece. A rubber band dragged from left to right selects what lies inside it; dragged from right to left (dashed) also what it touches; with **Shift** or **Ctrl** it adds to the selection. **Select similar** in the context menu selects all elements of the same kind on the level: all walls, all rooms, the same furniture.
- The properties set name, description, position, angle, tilt, size, color or texture of the whole piece, surface (like the model, matt, shiny), mirror image, visibility and whether it belongs to the base plan.
- **Materials** changes the color, texture and shininess of single parts of the model.
- When several elements are selected, the properties list them below the common values: **×** takes one out of the selection, a click on its name selects only it.
- **Edit › Rotate…** and **Move…** turn or move the selection by typed values: walls, rooms and texts too, e.g. a whole floor plan by 90°. **R** turns it by 15°.
- Several pieces can be grouped, aligned and distributed (**Furniture** menu). **Paste style** gives the selection the colors and textures of the copied element; the thickness and height of walls stay.

## Furniture list

The list below the catalog shows the furniture of the home. Click a column header to sort; the order is remembered. **Columns…** chooses the columns; the choice is saved in the home, as in Sweet Home 3D. The search looks in all shown columns. **Ctrl+click** adds a row to the selection, **Shift+click** selects a range, the arrow keys walk the rows, **F2** or a double-click on the name renames a piece. **Combine equal pieces** shows equal pieces in one row with their number, like a parts list.

## Prices

Choose a currency in **Preferences › General › Prices** to see prices. The properties then have a price field (and VAT when value added tax is switched on), and the furniture list can show price columns with a total.

# Textures and libraries

- Texture fields in the properties open a searchable list of all textures. **Rotate, resize, shift** below a texture turns it (e.g. parquet by 90°), changes its size in percent and shifts it.
- Drag a texture from the catalog onto a floor, a wall side or a piece of furniture in the plan; the surface it will land on is highlighted. A double-click on a texture gives it to the selection: the floor of rooms, both sides of walls, whole pieces.
- The pipette beside a texture field takes color, texture and surface from a wall side, floor or piece you click in the plan.
- A color field shows the color as #RRGGBB, which can be typed, and lists the colors already used in the home. A field without a color is struck through.
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
