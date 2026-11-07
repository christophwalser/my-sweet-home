# Testkorpus

| Ordner | Inhalt | Im Repo |
|---|---|---|
| `examples/` | Beispielprojekte aus Sweet Home 3D 7.6.1 (`Examples.jar`), Autoren Véronique und Emmanuel Puybaret, Lizenz CC-BY 3.0 oder GNU GPL | ja |
| `private/` | Eigene `.sh3d`-Dateien zum Testen | nein (`.gitignore`) |

Die Round-Trip-Tests in `crates/msh-format/tests/roundtrip.rs` lesen jede Datei,
schreiben sie neu, lesen sie wieder und vergleichen Element für Element.
Dateien in `private/` werden automatisch mitgetestet, wenn vorhanden.
