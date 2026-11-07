//! Datenmodell von My Sweet Home.
//!
//! Bildet das Projektformat von Sweet Home 3D 7.x 1:1 ab, damit Dateien
//! verlustfrei gelesen und geschrieben werden können. Fachlogik (Geometrie,
//! Commands) baut auf diesen Typen auf, steckt aber in eigenen Crates.

pub mod attrs;
pub mod home;

pub use attrs::{AttrError, Attrs, Color};
pub use home::*;
