# Test corpus

| Folder | Content | In repository |
|---|---|---|
| `examples/` | Example projects from Sweet Home 3D 7.6.1 (`Examples.jar`), authors Véronique and Emmanuel Puybaret, license CC-BY 3.0 or GNU GPL | yes |
| `private/` | Personal `.sh3d` files for testing | no (`.gitignore`) |

The round-trip tests in `crates/msh-format/tests/roundtrip.rs` read every file, write it
again, read it back and compare element by element. Files in `private/` are tested
automatically when present.
