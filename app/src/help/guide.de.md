# Erste Schritte

My Sweet Home plant Häuser in 2D und zeigt sie in 3D. Es öffnet und speichert Dateien von Sweet Home 3D (`.sh3d`), so kannst du jederzeit zwischen beiden Programmen wechseln.

Das Fenster hat vier Bereiche:

- **Katalog** links: Möbel und Texturen zum Platzieren, mit Suchfeld. Darunter die Möbel des offenen Hauses.
- **Plan** in der Mitte: Wände, Räume, Möbel, Bemaßungen und Texte von oben, ein Reiter pro Ebene.
- **3D-Ansicht** unter dem Plan: das Haus als Luftbild oder als Rundgang.
- **Eigenschaften** rechts: die Werte des gewählten Elements, oder des Hauses, wenn nichts gewählt ist.

Jede Änderung lässt sich mit **Strg+Z** rückgängig machen und mit **Strg+Y** wiederholen. **Strg+K** sucht alle Befehle nach Namen.

# Plan zeichnen

Wähle ein Werkzeug in der Werkzeugleiste oder im Menü **Plan** und klicke in den Plan.

## Wände

- Klicke den Startpunkt, dann jede Ecke. **Doppelklick** oder **Enter** beendet die Wand, **Esc** bricht ab, **Rücktaste** entfernt den letzten Punkt.
- Tippe eine Länge und drücke **Enter**, um die nächste Wand auf diese Länge festzulegen.
- Der Magnetismus rastet an rechten Winkeln, 45°, parallelen Wänden und Wandenden ein; halte **Umschalt** für 1°-Schritte und **Alt**, um ihn kurz auszuschalten.
- Wähle eine Wand, um Dicke, Höhe (auch verschieden an beiden Enden), Länge, Farben, Texturen, Oberfläche (matt oder glänzend), Sockelleisten und Muster zu ändern. **Auf 90° stellen** richtet die Ecke zur nächsten Wand aus.
- Runde Wände zeichnest du mit dem Pfeil neben dem Wandwerkzeug.

## Räume

- Klicke die Ecken eines Raums, oder **doppelklicke** zwischen Wände, um einen Raum zu erzeugen, der sie ausfüllt.
- In den Eigenschaften legst du Namen, Boden und Decke (Farbe, Textur, matt oder glänzend) fest und ob die Fläche angezeigt wird. Name und Fläche lassen sich im Plan verschieben.

## Bemaßungen, Texte und Linien

- Das Bemaßungswerkzeug misst zwischen zwei Klicks; ein dritter Klick platziert die Maßlinie.
- Texte und Polylinien (gerade oder gebogen) haben eigene Werkzeuge; ihren Stil legst du in den Eigenschaften fest.
- Das Messwerkzeug zeigt einen Abstand, ohne etwas zum Plan hinzuzufügen.

## Hintergrundbild

**Plan › Hintergrundbild importieren** legt einen eingescannten Plan oder eine PDF-Seite unter den Plan. Markiere eine bekannte Länge und tippe sie ein, dann setze den Nullpunkt. Danach zeichnest du Wände und Räume maßstabsgetreu darauf.

## Grundplan sperren

**Plan › Grundplan sperren** verhindert, dass Wände, Räume, Texte, Türen, Fenster und feste Möbel ausgewählt werden; nur bewegliche Möbel lassen sich dann verschieben.

# Ebenen und Treppen

- Das Menü **Ebenen** fügt Ebenen darüber oder auf gleicher Höhe hinzu oder löscht eine. Jede Ebene hat einen Reiter über dem Plan.
- Die Eigenschaften einer Ebene legen Name, Höhe über Boden, Höhe und Bodendicke fest.
- Eine Treppe aus dem Katalog schneidet ein Loch in den Boden darüber. Im Rundgang kannst du ihre Stufen hinaufgehen.
- **3D-Ansicht › Alle Ebenen** zeigt auch die Ebenen über der gewählten.

# Möbel

## Möbel platzieren

- Ziehe ein Möbel aus dem Katalog in den Plan.
- Türen und Fenster rasten in der nächsten Wand ein, übernehmen ihre Dicke und zeigen die Abstände zu den Wandenden und anderen Öffnungen.
- Möbel, die auf einem Tisch, einem Regal oder einem anderen Möbel abgelegt werden, landen obendrauf.

## Möbel ändern

- Ziehe ein Möbel, um es zu verschieben; mit seinen Griffen drehst du es und änderst Höhe über Boden, Höhe und Größe. Die Pfeiltasten verschieben die Auswahl um 1 cm (mit **Umschalt** 10 cm).
- In den Eigenschaften legst du Name, Beschreibung, Position, Winkel, Neigung, Größe, Farbe oder Textur des ganzen Möbels, Oberfläche (wie das Modell, matt, glänzend), Spiegelung, Sichtbarkeit und Zugehörigkeit zum Grundplan fest.
- **Materialien** ändert Farbe, Textur und Glanz einzelner Teile des Modells.
- Mehrere Möbel lassen sich gruppieren, ausrichten und verteilen (Menü **Möbel**). **Stil einfügen** gibt der Auswahl die Farben und Texturen des kopierten Elements.

## Möbelliste

Die Liste unter dem Katalog zeigt die Möbel des Hauses. Ein Klick auf eine Spaltenüberschrift sortiert. **Spalten…** wählt die Spalten; die Auswahl wird wie in Sweet Home 3D im Haus gespeichert.

## Preise

Wähle eine Währung unter **Einstellungen › Allgemein › Preise**, um Preise zu sehen. Die Eigenschaften haben dann ein Preisfeld (und MwSt., wenn die Mehrwertsteuer eingeschaltet ist), und die Möbelliste kann Preisspalten mit Summe zeigen.

# Texturen und Bibliotheken

- Texturfelder in den Eigenschaften öffnen eine durchsuchbare Liste aller Texturen.
- **Möbel › Zur Bibliothek hinzufügen** importiert Modelle (OBJ, DAE, 3DS, glTF, FBX, STL, 3MF, PLY, VRML, ZIP) und Texturen (JPG, PNG, BMP, GIF, WebP, TIFF, SVG, Materialpakete). Dateien können auch auf den Katalog gezogen werden.
- **Bibliotheken…** öffnet den Bibliothekseditor: Bibliotheken anlegen, Eigenschaften von Einträgen ändern, in andere Kategorien verschieben, importieren und entfernen.
- **Hinzufügen… › Online suchen…** im Katalog durchsucht die freien Bibliotheken von Sweet Home 3D, ambientCG und Poly Haven und importiert mit einem Klick.

Alles Importierte liegt in den Bibliotheksordnern von Sweet Home 3D, so nutzen es beide Programme.

# 3D-Ansicht

- **Luftbild**: Ziehen dreht um das Haus, Ziehen mit der rechten Maustaste verschiebt, das Mausrad zoomt. Ein Doppelklick auf eine Fläche dreht künftig um diesen Punkt.
- **Rundgang**: Ziehen schaut umher, **W A S D** oder die Pfeiltasten gehen, **Q / E** runter und rauf, **Umschalt** schneller. Wände halten dich auf, offene Türen lassen dich durch. Der Besucher erscheint im Plan und lässt sich dort verschieben.
- **Blickpunkte** speichert Kamerapositionen und ruft sie wieder auf.
- **3D-Einstellungen** legen Boden und Himmel, Licht und Wandtransparenz, den Standort (Suche nach Adresse) sowie Datum und Uhrzeit der Sonne fest.

# Fotos und Videos

- **Foto erstellen** rendert die aktuelle 3D-Ansicht: **Entwurf** in Sekunden, **Gut** und **Beste** mit Pathtracing (weiche Schatten, indirektes Licht, Glas). Objektive: normal, Fischauge oder 360°-Panorama.
- Wähle im Fotodialog gespeicherte Blickpunkte, um in einem Durchgang von jedem ein Foto in einen Ordner zu rendern.
- **Video erstellen** rendert einen Flug entlang eines Kamerapfads, den du aus Punkten in der 3D-Ansicht aufnimmst.

# Drucken und Exportieren

**Datei › Drucken / exportieren** druckt oder speichert die Möbelliste, den Plan jeder Ebene und die 3D-Ansicht als PDF. Wähle Papier, Ausrichtung und Maßstab (z. B. 1:100). Kopf- und Fußzeile können `$pageNumber`, `$pageCount`, `$planScale`, `$name`, `$file`, `$date` und `$time` enthalten.

Derselbe Dialog exportiert den Plan als PDF, SVG oder PNG, die Möbelliste als CSV und das 3D-Modell als OBJ.

# Einstellungen

Die **Einstellungen** (Zahnrad in der Werkzeugleiste) legen Einheiten (cm, mm, m, Zoll), Raster, Magnetismus und Winkelstufen, die Vorgaben für neue Wände, Räume und Texte, 3D-Qualität und Gehgeschwindigkeit, Design und Sprache, Autosave, Preise und Online-Kataloge fest.

# Dateien und Sicherheit

- **Datei › Neu**, **Öffnen** und **Speichern** arbeiten mit Dateien von Sweet Home 3D. Jedes Haus öffnet in einem eigenen Fenster; **Zuletzt geöffnet** listet die letzten Häuser.
- Alle paar Minuten wird eine Kopie geänderter Häuser gesichert. Nach einem Absturz bietet der nächste Start an, diese Kopien zu öffnen.
- Hier gespeicherte Häuser öffnen sich in Sweet Home 3D 7 und behalten alles, was Sweet Home 3D speichert, auch das, was dieses Programm nicht anzeigt.

# Automatisierung

Alles, was das Fenster kann, ist auch ein Befehl für Skripte und KI-Assistenten:

- `msh` auf der Kommandozeile arbeitet mit Dateien (`msh exec` liest einen Befehl pro Zeile) oder, mit `--live`, mit dem Haus, das im Fenster offen ist.
- `msh mcp` startet einen Server für KI-Assistenten wie Claude (Model Context Protocol). Sie können Häuser bauen und ändern, Bilder der 3D-Ansicht aufnehmen und ihre Arbeit prüfen.

`msh commands` listet alle Befehle mit ihren Parametern.

# Tastenkürzel

**Hilfe › Tastenkürzel** listet alle Tastenkürzel der Menüs und die Tasten von Plan und 3D-Ansicht.
