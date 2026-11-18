# Erste Schritte

My Sweet Home plant Häuser in 2D und zeigt sie in 3D. Es öffnet und speichert Dateien von Sweet Home 3D (`.sh3d`), so kannst du jederzeit zwischen beiden Programmen wechseln.

Das Fenster hat vier Bereiche:

- **Katalog** links: Möbel und Texturen zum Platzieren, mit Suchfeld. Darunter die Möbel des offenen Hauses.
- **Plan** in der Mitte: Wände, Räume, Möbel, Bemaßungen und Texte von oben, ein Reiter pro Ebene.
- **3D-Ansicht** unter dem Plan: das Haus als Luftbild oder als Rundgang.
- **Eigenschaften** rechts: die Werte des gewählten Elements, oder des Hauses, wenn nichts gewählt ist.

Jede Änderung lässt sich mit **Strg+Z** rückgängig machen und mit **Strg+Y** wiederholen. **Strg+K** sucht alle Befehle nach Namen.

# Plan zeichnen

Wähle ein Werkzeug in der Werkzeugleiste oder im Menü **Plan** und klicke in den Plan. Buchstaben wählen die Werkzeuge: **V** Auswählen, **H** Plan verschieben, **W** Wände, **F** Räume, **L** Linien, **D** Bemaßung, **T** Text, **M** Messen, **G** Hilfslinien. Auch die Tasten **1** bis **6** wählen Wände, Räume, Linien, Bemaßung, Text und das Messwerkzeug, in der Reihenfolge der Werkzeugleiste. Eine zweite Ziffer direkt danach wählt die weiteren Einträge aus dem Menü des Knopfs, ab 1 gezählt: **1** und dann **1** wählt runde Wände, **2** und dann **1** **Raum aus Wänden**, **4** und dann **1** das Höhenmaß, **6** und dann **1** die Hilfslinie. **Leertaste** halten und ziehen verschiebt den Plan mit jedem Werkzeug.

## Wände

- Klicke den Startpunkt, dann jede Ecke. **Doppelklick**, **Enter** oder **Esc** beendet die Wand, **Rücktaste** entfernt den letzten Punkt.
- Tippe eine Länge und drücke **Enter**, um die nächste Wand auf diese Länge festzulegen. Einheiten und Rechnen gehen auch: `3.5m`, `5'3"`, `240+11.5`. **Tab** wechselt zum Winkel (Grad, im Uhrzeigersinn ab der x-Achse); der nicht getippte Wert folgt der Maus. `@dx,dy` setzt den Punkt relativ zum letzten, `#x,y` auf absolute Koordinaten, `300<45` gibt Länge und Winkel auf einmal.
- Der Magnetismus rastet an rechten Winkeln, 45°, parallelen Wänden, Wandenden, Wandflächen (eine neue Wand beginnt auch bündig mit der Ecke einer Wandfläche), dem Lotfußpunkt auf einer nahen Wand und Hilfslinien ein; halte **Umschalt** für 1°-Schritte und **Alt**, um ihn kurz auszuschalten.
- Wähle eine Wand, um Dicke, Höhe (auch verschieden an beiden Enden), Länge, Farben, Texturen, Oberfläche (matt oder glänzend), Sockelleisten und Muster zu ändern; **Oberseite** gibt einer Wand, die nicht bis zur Decke reicht (z. B. einer halbhohen Wand), oben eine eigene Farbe und Textur. **Auf 90° stellen** richtet die Ecke zur nächsten Wand aus.
- Runde Wände zeichnest du mit dem Pfeil neben dem Wandwerkzeug; ihren Bogen stellst du über dem Plan und später in den Eigenschaften ein.
- Über dem Plan zeigt das Wandwerkzeug seine Optionen: Dicke, Höhe und **Zeichnen an**. Mit **Zeichnen an › Linke Seite** oder **Rechte Seite** sind die geklickten Punkte eine Wandfläche statt der Achse: So zeichnest du einen Raum nach lichten Maßen oder ein Haus nach Außenmaßen. Die gestrichelte Linie zeigt die geklickten Punkte, die gefüllte Fläche die spätere Wand.
- **Richtung** in den Eigenschaften dreht eine Wand um ihren Anfang auf einen genauen Winkel. **Fest bleibt** wählt, was bei einer neuen Dicke stehen bleibt: die Achse oder eine Wandseite.

## Räume

- Klicke die Ecken eines Raums, oder **doppelklicke** zwischen Wände, um einen Raum zu erzeugen, der sie ausfüllt. Wände, die schon einen Raum umschließen, ergeben keinen zweiten.
- Ein ausgewählter Raum hat in der Mitte jeder Kante einen Griff: Ziehen fügt eine Ecke ein, mit **Umschalt** verschiebt es die ganze Kante parallel. Gezogene Ecken rasten rechtwinklig und in Flucht mit den Nachbarkanten ein.
- In den Eigenschaften legst du Namen, Boden und Decke (Farbe, Textur, matt oder glänzend) fest und ob die Fläche angezeigt wird. Name und Fläche lassen sich im Plan verschieben.

## Bemaßungen, Texte und Linien

- Das Bemaßungswerkzeug misst zwischen zwei Klicks; ein dritter Klick platziert die Maßlinie.
- Texte und Polylinien (gerade oder gebogen) haben eigene Werkzeuge; ihren Stil legst du in den Eigenschaften fest.
- Einen Text tippst du direkt an der geklickten Stelle im Plan; **Enter** beendet, **Umschalt+Enter** beginnt eine neue Zeile. Ein **Doppelklick** auf einen Text ändert ihn dort.
- Das Messwerkzeug zeigt einen Abstand, ohne etwas zum Plan hinzuzufügen. Wie bei Wänden lässt sich sein Endpunkt (und der einer Hilfslinie) tippen: eine Länge, **Tab** für den Winkel, oder `@dx,dy`. Sein zweiter Modus, die **Hilfslinie**, zeichnet eine Linie, die zum Platzieren von Elementen im Plan bleibt; sie wird mit dem Haus gespeichert, aber nicht gedruckt. Zum Entfernen eine Hilfslinie auswählen und **Entf** drücken, oder **Plan › Hilfslinien dieser Ebene löschen**. Farbe und Strichart einer Hilfslinie stehen in ihren Eigenschaften, und **Auf allen Ebenen** zeigt sie auf jeder Ebene, z. B. um die Geschosse aufeinander auszurichten; Hilfslinien lassen sich wie andere Elemente kopieren und einfügen; die Vorgaben für neue Hilfslinien und die Farbe des Messwerkzeugs unter **Einstellungen › Werkzeuge**. **Hilfslinie im Abstand…** im Kontextmenü einer Wand oder einer Hilfslinie fügt eine parallele Hilfslinie hinzu: Maus auf ihre Seite bewegen und klicken, oder den Abstand (ab der Wandfläche) tippen und **Enter** drücken.

## Präzision und Magnetismus

- Die Statusleiste unter dem Plan schaltet den Magnetismus ein und aus (**F9**) und getrennt davon Winkel, Objekte (**F3**: Enden, Mitten, Flächen und Ecken von Wänden, Räumen und Möbeln) und Hilfslinien. Der Knopf mit Fangradius und Winkelschritt (oder ein Rechtsklick auf die Leiste) ändert sie. Sie zeigt auch die Position der Maus.
- Elemente rasten an Enden, Mitten und Linien von Hilfslinien ein und an deren Schnittpunkten mit Wänden und anderen Hilfslinien.
- Die Markierung zeigt, woran ein Punkt einrastet: ein Quadrat für Enden und Ecken, ein Dreieck für Mitten, ein Kreuz für Schnittpunkte, ⊥ für den Lotfußpunkt, eine Raute für Punkte von Hilfslinien, ein Kreis für einen Punkt auf einer Linie.
- Verschobene Möbel und andere Elemente richten sich an Kanten und Mitten naher Möbel und an Wandflächen aus; eine gestrichelte Linie zeigt den Partner. Zwischen zwei Möbeln rasten sie auf gleiche Abstände ein („= 60“). Ein einzelnes Möbel zeigt seine Abstände zur nächsten Wand oder zum nächsten Möbel in jede Richtung.
- Ist ein Möbel ausgewählt, klicke einen seiner Abstände an und tippe einen Wert: Das Möbel rückt genau auf diesen Abstand.
- Gezogene Elemente bewegen sich in Schritten von 1 cm, beim Hineinzoomen feiner (bis 1 mm); mit **Alt** frei. **Umschalt** beim Ziehen hält die Bewegung auf einer Achse (bei einem einzelnen Möbel oder einer Wand entlang ihrer eigenen Richtung).
- Die Pfeiltasten verschieben die Auswahl um 1 cm, mit **Umschalt** um 10 cm und mit **Alt** um 1 mm.
- Zahlenfelder in den Eigenschaften rechnen: `240+11.5`, `3m - 12cm`, und ändern den Wert relativ mit `+5`, `+-5`, `*2` oder `/2`. Pfeiltasten und Mausrad ändern den Wert im Feld schrittweise (mit **Umschalt** um 10 Schritte); **Enter** übernimmt ihn, **Esc** nimmt die Eingabe zurück.

## Hintergrundbild

**Plan › Hintergrundbild importieren** legt einen eingescannten Plan oder eine PDF-Seite unter den Plan. Markiere eine bekannte Länge und tippe sie ein, dann setze den Nullpunkt. Danach zeichnest du Wände und Räume maßstabsgetreu darauf.

## Gelände und Scans als Referenzobjekte

Geländemodelle, Laserscans oder Nachbarhäuser, die als Möbel importiert sind, markierst du in ihren Eigenschaften als **Referenzobjekt**. Der Plan zeigt sie dann blass zuunterst, unter dem Hintergrundbild: Klicks, der Auswahlrahmen und der Magnetismus übergehen sie, so zeichnest du Wände und Räume ungestört darauf. Die Hausdetails (Klick auf eine leere Stelle im Plan) listen die Referenzobjekte auf: dort blendest du jedes ein oder aus, oder klickst auf seinen Namen, um es auszuwählen und zu ändern; im 3D bleiben sie unverändert. Referenzobjekte sind keine Möbel: Sie stehen nicht in der Möbelliste, und der Plan zeigt sie unter jeder Ebene über ihrer eigenen. **In ein Möbelstück umwandeln** in ihrem Bereich macht eines wieder zum Möbelstück. Möbel eines tieferen Geschosses, die in das angezeigte Geschoss hineinragen (z. B. ein hohes Geländemodell), erscheinen genauso; Treppen bleiben wählbar.

## Grundplan sperren

**Plan › Grundplan sperren** verhindert, dass Wände, Räume, Texte, Türen, Fenster und feste Möbel ausgewählt werden; nur bewegliche Möbel lassen sich dann verschieben.

# Ebenen und Treppen

- Das Menü **Ebenen** fügt Ebenen darüber oder auf gleicher Höhe hinzu oder löscht eine. Jede Ebene hat einen Reiter über dem Plan; **+** neben den Reitern fügt eine Ebene hinzu, ein Rechtsklick auf einen Reiter benennt sie um, dupliziert, verschiebt oder löscht sie. Ein durchgestrichenes Auge kennzeichnet eine in 3D ausgeblendete Ebene.
- **Ebene duplizieren…** beginnt das nächste Geschoss: Die Wände der Ebene werden in eine neue Ebene darüber kopiert, genau über ihre Originale. Mit den Haken kommen Räume, Türen und Fenster, Möbel oder Texte mit.
- Die Eigenschaften einer Ebene legen Name, Höhe über Boden, Höhe und Bodendicke fest. Mit **Ebenen darüber mitverschieben** verschiebt eine neue Höhe über Boden oder Höhe die Ebenen darüber mit; mit **Wände an Höhe anpassen** erhalten die Wände in voller Ebenenhöhe die neue Höhe, niedrigere wie Brüstungen behalten ihre.
- Die Ebene darunter liegt blass unter dem Plan, und ihre Wandenden und Wandecken ziehen den Zeiger an, sodass Wände genau übereinander stehen. Die Statusleiste schaltet diese Unterlage auf die Ebene darüber oder aus.
- Um einzelne Wände und Räume auf eine andere Ebene zu übernehmen: kopieren, zur Ebene wechseln und einfügen. Die Kopien liegen genau über den Originalen. Auf der eigenen Ebene eingefügt, werden sie um 20 cm versetzt.
- Eine Treppe aus dem Katalog schneidet ein Loch in den Boden darüber. Im Rundgang kannst du ihre Stufen hinaufgehen.
- **Ebenen** in der 3D-Ansicht legt fest, was sie zeigt: nur die gewählte Ebene, die Ebenen bis zu ihr oder alle. Die Haken darunter blenden einzelne Ebenen in 3D aus.

# Möbel

## Möbel platzieren

- Ziehe ein Möbel aus dem Katalog in den Plan. In der Nähe einer Wand dreht es sich schon beim Ziehen mit dem Rücken zur Wand.
- Türen und Fenster rasten in der nächsten Wand ein, übernehmen ihre Dicke und zeigen die Abstände zu den Wandenden und anderen Öffnungen.
- Möbel, die auf einem Tisch, einem Regal oder einem anderen Möbel abgelegt werden, landen obendrauf.

## Möbel ändern

- Ziehe ein Möbel, um es zu verschieben; mit seinen Griffen drehst du es und änderst Höhe über Boden, Höhe und Größe. Die Pfeiltasten verschieben die Auswahl um 1 cm (mit **Umschalt** 10 cm, mit **Alt** 1 mm). **Umschalt+Klick** oder **Strg+Klick** nimmt ein Element zur Auswahl hinzu oder heraus. **Tab** wählt das nächste Element unter der Maus, z. B. einen Raum unter einem Möbel. Ein Auswahlrechteck von links nach rechts wählt, was ganz darin liegt; von rechts nach links (gestrichelt) auch, was es berührt; mit **Umschalt** oder **Strg** ergänzt es die Auswahl. **Gleiche auswählen** im Kontextmenü wählt alle Elemente derselben Art auf der Ebene: alle Wände, alle Räume, die gleichen Möbel.
- In den Eigenschaften legst du Name, Beschreibung, Position, Winkel, Neigung, Größe, Farbe oder Textur des ganzen Möbels, Oberfläche (wie das Modell, matt, glänzend), Spiegelung, Sichtbarkeit und Zugehörigkeit zum Grundplan fest.
- **Materialien** ändert Farbe, Textur und Glanz einzelner Teile des Modells.
- Sind mehrere Elemente ausgewählt, listen die Eigenschaften sie unter den gemeinsamen Werten auf: **×** nimmt eines aus der Auswahl, ein Klick auf den Namen wählt nur dieses.
- **Bearbeiten › Drehen…** und **Verschieben…** drehen oder verschieben die Auswahl um eingetippte Werte, auch Wände, Räume und Texte, z. B. einen ganzen Grundriss um 90°. **R** dreht sie um 15°.
- Mehrere Möbel lassen sich gruppieren, ausrichten und verteilen (Menü **Möbel**). **Stil einfügen** gibt der Auswahl die Farben und Texturen des kopierten Elements; Dicke und Höhe von Wänden bleiben.

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
- **3D-Einstellungen** legen Boden und Himmel, Licht und Wandtransparenz, den Standort (Suche nach Adresse) sowie Datum und Uhrzeit der Sonne fest. Den Standort kannst du auch in den Eigenschaften des Hauses festlegen. **Norden an der Karte ausrichten** zeigt die Wände über einer Karte des Standorts: Drehe sie mit dem Mausrad, bis sie auf das Gebäude passen, dann zeigt der Kompass nach Norden. Ziehen an den Wänden verschiebt sie, Ziehen daneben verschiebt die Karte; **Strg+Mausrad** oder die Knöpfe zoomen.
- Lampen beleuchten den Rundgang; Wände halten das Licht der Lampen in deiner Nähe auf.

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
- **Keine Planungs- oder Baugarantie:** Maße, Flächen, Mengen und Preise sind nicht geprüft und können ungenau sein, und nichts wird auf Statik, Bauvorschriften oder Genehmigungen geprüft. Lass Pläne von Fachleuten prüfen, bevor du baust, kaufst oder bestellst. My Sweet Home ist freie Software ohne Gewährleistung (GNU GPL 3 oder neuer) und steht in keiner Verbindung zu den Herstellern von Sweet Home 3D.

# Automatisierung

Alles, was das Fenster kann, ist auch ein Befehl für Skripte und KI-Assistenten:

- `msh` auf der Kommandozeile arbeitet mit Dateien (`msh exec` liest einen Befehl pro Zeile) oder, mit `--live`, mit dem Haus, das im Fenster offen ist.
- `msh mcp` startet einen Server für KI-Assistenten wie Claude (Model Context Protocol). Sie können Häuser bauen und ändern, Bilder der 3D-Ansicht aufnehmen und ihre Arbeit prüfen.

`msh commands` listet alle Befehle mit ihren Parametern.

# Tastenkürzel

**Hilfe › Tastenkürzel** listet alle Tastenkürzel der Menüs und die Tasten von Plan und 3D-Ansicht.
