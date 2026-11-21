# Erste Schritte

My Sweet Home plant Häuser in 2D und zeigt sie in 3D. Es öffnet und speichert Dateien von Sweet Home 3D (`.sh3d`), so kannst du jederzeit zwischen beiden Programmen wechseln.

Das Fenster hat vier Bereiche:

- **Katalog** links: Möbel und Texturen zum Platzieren, mit Suchfeld. Darunter die Möbel des offenen Hauses.
- **Plan** in der Mitte: Wände, Räume, Möbel, Bemaßungen und Texte von oben, ein Reiter pro Ebene.
- **3D-Ansicht** unter dem Plan: das Haus als Luftbild oder als Rundgang.
- **Eigenschaften** rechts: die Werte des gewählten Elements, oder des Hauses, wenn nichts gewählt ist.

Jede Änderung lässt sich mit **Strg+Z** rückgängig machen und mit **Strg+Y** wiederholen; das Menü **Bearbeiten** nennt den Schritt, und der Verlaufsknopf neben Rückgängig nimmt mehrere Schritte auf einmal zurück. **Strg+K** sucht alle Befehle nach Namen, auch nach einigen ihrer Buchstaben, und listet die zuletzt benutzten Befehle.

Die Menüleiste lässt sich wie in Windows bedienen: **Alt** oder **F10** springt hinein und unterstreicht die Zugriffstasten, **Alt** und ein Buchstabe öffnet ein Menü, die Pfeiltasten bewegen sich darin, ein Buchstabe springt zu den Einträgen, die damit beginnen. Das Menü **Ansicht** enthält Zoom, Raster, Lineale und Magnetismus, blendet den Katalog (**F6**) und die Eigenschaften (**F4**) aus, zeigt nur den Plan oder nur die 3D-Ansicht und stellt die Größe der Oberfläche ein. Eine Seitenleiste lässt sich auch an ihrem Rand zuschieben; der Griff am Fensterrand holt sie zurück.

Fehler bleiben im Fenster stehen, bis du sie schließt; die Statusleiste unter dem Plan listet die Meldungen des Fensters.

# Plan zeichnen

Wähle ein Werkzeug in der Werkzeugleiste oder im Menü **Plan** und klicke in den Plan. Buchstaben wählen die Werkzeuge: **V** Auswählen, **H** Plan verschieben, **W** Wände, **F** Räume, **L** Linien, **D** Bemaßung, **T** Text, **M** Messen, **G** Hilfslinien. Auch die Tasten **1** bis **6** wählen Wände, Räume, Linien, Bemaßung, Text und das Messwerkzeug, in der Reihenfolge der Werkzeugleiste. Eine zweite Ziffer direkt danach wählt die weiteren Einträge aus dem Menü des Knopfs, ab 1 gezählt: **1** und dann **1** wählt runde Wände, **2** und dann **1** **Raum aus Wänden**, **4** und dann **1** das Höhenmaß, **6** und dann **1** die Hilfslinie. **Leertaste** halten und ziehen verschiebt den Plan mit jedem Werkzeug.

## Wände

- Klicke den Startpunkt, dann jede Ecke. **Doppelklick** oder **Enter** beendet die Wand, **Esc** verwirft, was gerade gezeichnet wird, **Rücktaste** entfernt den letzten Punkt.
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
- **Wände dieses Raums** in den Eigenschaften gibt allen Wandseiten, die dem Raum zugewandt sind, dieselbe Farbe, Textur, Oberfläche und Sockelleiste, egal in welcher Richtung jede Wand gezeichnet wurde. Eine Wand, die länger ist als der Raum, ändert sich auf ihrer ganzen Seite.

## Dächer

- **Plan › Dach über den Wänden** (oder der Dach-Knopf der Werkzeugleiste) setzt ein Dach über die Wände der gezeigten Ebene. Ein Haus in L-, T- oder U-Form bekommt je Rechteck ein eigenes Dach; kleine Versprünge der Wände und abgeschrägte Ecken werden überdacht. **Dach über einem Rechteck…** nimmt stattdessen drei Klicks: zwei Ecken einer Seite und einen Punkt auf der gegenüberliegenden Seite.
- Der Plan zeigt ein Dach als Linien: den Rand strichpunktiert, First und Grate durchgezogen. Ein Klick auf eine Linie wählt das Dach; Klicks in seiner Fläche erreichen die Räume und Möbel darunter. Das Dach und seine Griffe ziehst du wie bei Möbeln: Die Neigung bleibt, die Höhe folgt.
- Die Eigenschaften legen die Form (Sattel-, Walm-, Pult- oder Flachdach), die Dachneigung, den Dachüberstand, die Dicke und die Höhe der Wandoberkante fest, an der das Dach ansetzt. **First drehen** lässt den First eines Satteldachs in die andere Richtung laufen; **Gefälle drehen** setzt die niedrige Kante eines Pultdachs eine Seite weiter.
- Unter **Kanten** ist jede Kante eine Traufe (dort steigt das Dach an) oder ein Giebel (Wand bis unters Dach), z. B. ein Walm nur an einem Ende.
- **Dachdeckung** und **Giebelwände** bekommen je eine Farbe oder eine Textur, z. B. Dachziegel und den Putz des Hauses. Eine Textur wird statt der Farbe in ihrer echten Größe gezeigt; auf dem Dach laufen ihre Reihen parallel zur Traufe.
- **3D-Ansicht › Dächer** lässt die Dächer in der 3D-Ansicht weg, um von oben in die Räume zu sehen.
- Gespeichert wird ein Dach als Möbelstück mit erzeugtem Modell: Sweet Home 3D zeigt es an, ändern lässt es sich nur in My Sweet Home. Dächer, die aufeinandertreffen (Haus in L-Form), durchdringen sich; Wände werden nicht an das Dach angepasst.

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

**Plan › Hintergrundbild importieren** legt einen eingescannten Plan oder eine PDF-Seite unter den Plan. Markiere eine bekannte Länge und tippe sie ein, dann setze den Nullpunkt. Danach zeichnest du Wände und Räume maßstabsgetreu darauf. Die Länge gibst du in der Einheit der Einstellungen ein (oder mit Einheit, z. B. `8,73 m`); **Deckkraft** legt fest, wie stark das Bild unter dem Plan durchscheint. Auch eine Karte kann das Hintergrundbild sein: Klicke in den Hausdetails auf **Norden an der Karte ausrichten…**, bringe die Wände mit dem Gebäude zur Deckung und wähle **Karte als Hintergrundbild übernehmen**. Die Karte (© OpenStreetMap-Mitwirkende) liegt dann maßstäblich unter dem Plan des gezeigten Geschosses, gedreht wie der Plan.

## Gelände und Scans als Referenzobjekte

Geländemodelle, Laserscans oder Nachbarhäuser sind **Referenzobjekte**: Der Plan zeigt sie blass zuunterst, unter dem Hintergrundbild; Klicks, der Auswahlrahmen und der Magnetismus übergehen sie, so zeichnest du Wände und Räume ungestört darauf. Sie sind keine Möbel: Sie stehen nicht in der Möbelliste, und der Plan zeigt sie unter jeder Ebene über ihrer eigenen. Möbel eines tieferen Geschosses, die in das angezeigte Geschoss hineinragen (z. B. ein hohes Geländemodell), erscheinen genauso; Treppen bleiben wählbar.

- **Import.** Klicke im Möbelkatalog auf **Hinzufügen…** und wähle die Modelldatei (oder ziehe die Datei auf den Katalog); im Importdialog wählst du **Als Referenzobjekt**. **Einheit des Modells** gibt dem Modell seine echte Größe (ein Scan in Metern wird oft für Zentimeter gehalten). **Nullpunkt des Modells auf den Nullpunkt des Plans legen** behält den Platz, den das Modell in seiner Datei hat; zwei Modelle, die vom selben Punkt aus vermessen sind, liegen dann richtig nebeneinander. Ein Möbelstück, das schon im Haus steht, wird über das Kästchen in seinen Eigenschaften zum Referenzobjekt.
- **Gelände.** Ein Höhenraster als XYZ (Zeilen `Ost Nord Höhe`) oder ASC (Esri-ASCII-Raster), in Metern, wird zu einem Geländenetz; große Raster werden auf 300 Punkte je Seite ausgedünnt. Mit dem Kästchen **Gelände** macht der flache Boden in 3D dafür Platz. Stelle die **Höhe über Boden** ein (auch negativ), bis das Gelände am Haus anliegt. Punktwolken (PLY ohne Flächen, LAS, E57) lassen sich noch nicht lesen.
- **Wo sie erscheinen.** Der Knopf **… unter dem Plan** in der Statusleiste und die Hausdetails (Klick auf eine leere Stelle im Plan) listen die Referenzobjekte auf: Dort blendest du jedes im Plan und in 3D getrennt ein oder aus, stellst seine Deckkraft im Plan ein oder klickst auf seinen Namen, um es auszuwählen. Einen Scan, den du nur nachzeichnest, blendest du in 3D aus – dort würde er die danach gezeichneten Wände verdecken.
- **Über zwei Punkte ausrichten.** Klicke im Bereich eines Referenzobjekts auf **Über zwei Punkte ausrichten…**, dann auf einen Punkt darauf, auf seine Zielstelle im Plan, auf einen zweiten Punkt darauf und auf dessen Zielstelle: Es wird passend gedreht und verschoben. **Ausrichten und Größe anpassen…** skaliert es zusätzlich, sodass beide Punkte genau passen – für Modelle in unbekanntem Maßstab. Ecken, Kanten und Schnittlinien fangen die Klicks; Esc bricht ab.
- **Schnitt statt Draufsicht.** Die Draufsicht eines gescannten Hauses zeigt sein Dach. **Schnitt statt Draufsicht zeigen** zeigt, wo eine Ebene in der angegebenen Höhe über dem Boden des gezeigten Geschosses das Modell schneidet, z. B. seine Wände in 100 cm Höhe; jedes Geschoss zeigt seinen eigenen Schnitt. Mit **Die Schnittlinien fangen den Zeiger** zeichnest du Wände und Räume darauf nach („auf Schnittlinie“).
- **In ein Möbelstück umwandeln** im Bereich macht ein Referenzobjekt wieder zum Möbelstück.

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
- Oder doppelklicke ein Möbel im Katalog (oder drücke **Enter**) und klicke in den Plan: Das Möbel hängt in seiner Größe am Mauszeiger. **Shift+Klick** platziert mehrere, **Esc** beendet es.
- **Auswahl hierdurch ersetzen** im Menü eines Katalogeintrags tauscht die gewählten Möbel dagegen aus; Platz, Winkel, Höhe über Boden und Ebene bleiben.
- Der Katalog merkt sich die offenen Kategorien, zeigt **Favoriten** (Menü eines Eintrags) und die **zuletzt verwendeten** Möbel oben und stellt die Einträge als Liste oder Kacheln dar. Seine Zeilen lassen sich mit der Tastatur bedienen: Pfeiltasten, **Enter**, **Entf**, **Strg+D** und die Menütaste.
- **Ansicht › Magnetismus › Am Raster fangen** (oder der Schalter in der Statusleiste) setzt gezeichnete Punkte und verschobene Elemente auf die Rasterlinien; anfangs ist das aus. Es fängt das Raster, das du siehst: Den Abstand stellst du in der Statusleiste ein. Punkte, Flächen und Fluchten von Objekten haben Vorrang vor dem Raster; schalte **Objekte** aus, um nur das Raster zu haben. **Alt** schaltet jedes Fangen kurz aus.
- Türen und Fenster rasten in der nächsten Wand ein, übernehmen ihre Dicke und zeigen die Abstände zu den Wandenden und anderen Öffnungen. Entlang der Wand gezogen folgen sie der Maus in ganzen Zentimetern freien Platzes und fangen nur die Mitte des freien Platzes und Öffnungen, die in ihrer Flucht liegen; **Alt** schaltet das Fangen aus. Sie behalten die Seite, zu der sie öffnen, bis du sie auf der anderen Seite aus der Wand ziehst. In einer Wand, die dicker ist als die Tür, ziehst du sie quer zur Wand in die Mitte, bündig an eine Seite oder irgendwo dazwischen. Exakte Abstände zu den Wandenden oder zur nächsten Öffnung tippst du in den Eigenschaften unter **Abstand links / rechts** ein.
- Möbel, die auf einem Tisch, einem Regal oder einem anderen Möbel abgelegt werden, landen obendrauf.

## Möbel ändern

- Ziehe ein Möbel, um es zu verschieben; mit seinen Griffen drehst du es und änderst Höhe über Boden, Höhe und Größe. Die Pfeiltasten verschieben die Auswahl um 1 cm (mit **Umschalt** 10 cm, mit **Alt** 1 mm). **Umschalt+Klick** oder **Strg+Klick** nimmt ein Element zur Auswahl hinzu oder heraus. **Tab** wählt das nächste Element unter der Maus, z. B. einen Raum unter einem Möbel. Ein Auswahlrechteck von links nach rechts wählt, was ganz darin liegt; von rechts nach links (gestrichelt) auch, was es berührt; mit **Umschalt** oder **Strg** ergänzt es die Auswahl. **Gleiche auswählen** im Kontextmenü wählt alle Elemente derselben Art auf der Ebene: alle Wände, alle Räume, die gleichen Möbel.
- In den Eigenschaften legst du Name, Beschreibung, Position, Winkel, Neigung, Größe, Farbe oder Textur des ganzen Möbels, Oberfläche (wie das Modell, matt, glänzend), Spiegelung, Sichtbarkeit und Zugehörigkeit zum Grundplan fest.
- **Materialien** ändert Farbe, Textur und Glanz einzelner Teile des Modells.
- Sind mehrere Elemente ausgewählt, listen die Eigenschaften sie unter den gemeinsamen Werten auf: **×** nimmt eines aus der Auswahl, ein Klick auf den Namen wählt nur dieses.
- **Bearbeiten › Drehen…** und **Verschieben…** drehen oder verschieben die Auswahl um eingetippte Werte, auch Wände, Räume und Texte, z. B. einen ganzen Grundriss um 90°. **R** dreht sie um 15°.
- Mehrere Möbel lassen sich gruppieren, ausrichten und verteilen (Menü **Möbel**). **Stil einfügen** gibt der Auswahl die Farben und Texturen des kopierten Elements; Dicke und Höhe von Wänden bleiben.

## Möbelliste

Die Liste unter dem Katalog zeigt die Möbel des Hauses. Ein Klick auf eine Spaltenüberschrift sortiert; die Reihenfolge bleibt gemerkt. **Spalten…** wählt die Spalten; die Auswahl wird wie in Sweet Home 3D im Haus gespeichert. Die Suche sieht in allen gezeigten Spalten nach. **Strg+Klick** nimmt eine Zeile zur Auswahl hinzu, **Shift+Klick** wählt einen Bereich, die Pfeiltasten gehen durch die Zeilen, **F2** oder ein Doppelklick auf den Namen benennt ein Möbel um. **Gleiche zusammenfassen** zeigt gleiche Möbel in einer Zeile mit ihrer Anzahl, wie eine Stückliste.

## Preise

Wähle eine Währung unter **Einstellungen › Allgemein › Preise**, um Preise zu sehen. Die Eigenschaften haben dann ein Preisfeld (und MwSt., wenn die Mehrwertsteuer eingeschaltet ist), und die Möbelliste kann Preisspalten mit Summe zeigen.

# Texturen und Bibliotheken

- Texturfelder in den Eigenschaften öffnen eine durchsuchbare Liste aller Texturen. **Drehen, skalieren, verschieben** unter einer Textur dreht sie (z. B. Parkett um 90°), ändert ihre Größe in Prozent und versetzt sie.
- Ziehe eine Textur aus dem Katalog auf einen Boden, eine Wandseite oder ein Möbel im Plan; die Fläche, auf der sie landet, wird hervorgehoben. Ein Doppelklick auf eine Textur gibt sie der Auswahl: dem Boden von Räumen, beiden Seiten von Wänden, ganzen Möbeln.
- Die Pipette neben einem Texturfeld übernimmt Farbe, Textur und Oberfläche von einer Wandseite, einem Boden oder einem Möbel, das du im Plan anklickst.
- Ein Farbfeld zeigt die Farbe als #RRGGBB, die sich auch eintippen lässt, und listet die im Haus schon verwendeten Farben. Ein Feld ohne Farbe ist durchgestrichen.
- **Möbel › Zur Bibliothek hinzufügen** importiert Modelle (OBJ, DAE, 3DS, glTF, FBX, STL, 3MF, PLY, VRML, ZIP) und Texturen (JPG, PNG, BMP, GIF, WebP, TIFF, SVG, Materialpakete). Dateien können auch auf den Katalog gezogen werden.
- **Bibliotheken…** öffnet den Bibliothekseditor: Bibliotheken anlegen, Eigenschaften von Einträgen ändern, in andere Kategorien verschieben, importieren und entfernen.
- **Hinzufügen…** im Katalog öffnet den Bibliothekseditor und gleich die Dateiauswahl: für 3D-Modelle unter **Möbel**, für Bilder unter **Texturen**.
- **Hinzufügen › Online suchen…** im Bibliothekseditor durchsucht die freien Bibliotheken von Sweet Home 3D, ambientCG und Poly Haven und importiert mit einem Klick.

Alles Importierte liegt in den Bibliotheksordnern von Sweet Home 3D, so nutzen es beide Programme.

# 3D-Ansicht

- **Luftbild**: Ziehen dreht um das Haus, Ziehen mit der rechten Maustaste verschiebt, das Mausrad zoomt zum Mauszeiger. Ein Doppelklick auf eine Fläche dreht künftig um diesen Punkt. Die Pfeiltasten drehen die Ansicht, **Umschalt** und die Pfeiltasten verschieben sie, **+** und **-** zoomen; am Horizont ist Schluss.
- **Auswählen und verschieben**: Ein Klick wählt Möbel, eine Wand oder einen Raum, auch im Plan; **Strg** oder **Umschalt** fügt zur Auswahl hinzu. Was im Plan gewählt ist, ist in 3D umrandet. Ein gewähltes Möbel lässt sich über den Boden ziehen (**Esc** bricht ab). **Esc** in der 3D-Ansicht hebt die Auswahl auf, **Entf** löscht sie.
- **Ansichten** zeigt das Haus von oben, von Norden, Osten, Süden oder Westen und in vier Isometrien, passt das Haus ein oder zoomt auf die Auswahl. **Parallelprojektion** zeichnet das Luftbild ohne Perspektive. Der Pfeil rechts unten zeigt nach Norden.
- **Rundgang**: Ziehen schaut umher, **W A S D** oder die Pfeiltasten gehen, **Q / E** runter und rauf, **Umschalt** schneller. Wände halten dich auf, offene Türen lassen dich durch. Der Besucher erscheint im Plan und lässt sich dort verschieben.
- **Blickpunkte** speichert Kamerapositionen mit einem kleinen Bild. Ein Klick springt hin; daneben stehen **Umbenennen** (oder **F2**), **Aktualisieren** (setzt ihn auf die aktuelle Ansicht) und **Löschen** (fragt nach). **Esc** schließt das Menü.
- **3D-Einstellungen** legen Boden und Himmel, Licht und Wandtransparenz, den Standort (Suche nach Adresse) sowie Datum und Uhrzeit der Sonne fest. Die Schieber zeigen ihre Wirkung schon beim Ziehen. **Tageszeit** und **Tag im Jahr** bewegen die Sonne, **Tag abspielen** lässt sie laufen; **Schatten** steht ebenfalls dort. **Schnitt** schneidet das Haus oberhalb einer Höhe oder von einer Seite auf, um hineinzuschauen; er wird nicht gespeichert und erscheint nicht in Fotos. Den Standort kannst du auch in den Eigenschaften des Hauses festlegen. **Norden an der Karte ausrichten** zeigt die Wände über einer Karte des Standorts: Drehe sie mit dem Mausrad, bis sie auf das Gebäude passen, dann zeigt der Kompass nach Norden. Ziehen an den Wänden verschiebt sie, Ziehen daneben verschiebt die Karte; **Strg+Mausrad** oder die Knöpfe zoomen.
- Die Lampen der Ebene, auf der du stehst, beleuchten den Rundgang; Wände halten das Licht der Lampen in deiner Nähe auf.

# Fotos und Videos

- **Foto erstellen** rendert die aktuelle 3D-Ansicht: **Entwurf** in Sekunden, **Gut** und **Beste** mit Pathtracing (weiche Schatten, indirektes Licht, Glas). Objektive: normal, Fischauge oder 360°-Panorama. Das Panel bleibt neben der Ansicht, du kannst sie also weiter drehen. Größen: die Proportionen der Ansicht, HD, Full HD, 4K oder A4 bei 300 dpi. **Dateiformat** wählt PNG oder JPEG. Größe, Qualität und Format werden gemerkt.
- Wähle im Fotopanel gespeicherte Blickpunkte, um in einem Durchgang von jedem ein Foto in einen Ordner zu rendern.
- **Video erstellen** rendert einen Flug entlang eines Kamerapfads, den du aus Punkten in der 3D-Ansicht aufnimmst. Jeder Punkt zeigt, was die Kamera dort sieht; ein Klick springt hin, die Pfeile ändern die Reihenfolge. Der Pfad ist im Plan eingezeichnet, solange das Panel offen ist.

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
