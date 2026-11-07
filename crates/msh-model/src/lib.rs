//! Data model of My Sweet Home.
//!
//! Mirrors the project format of Sweet Home 3D 7.x 1:1, so that files can be
//! read and written without loss. Domain logic (geometry, commands) builds on
//! these types but lives in separate crates.

pub mod attrs;
pub mod home;

pub use attrs::{AttrError, Attrs, Color};
pub use home::*;
