//! Typisierter Zugriff auf XML-Attribute.
//!
//! Das Modell kennt kein XML. Es arbeitet nur mit einer geordneten Liste von
//! Attributnamen und -werten ([`Attrs`]). `msh-format` macht daraus XML und
//! umgekehrt. Attribute, die das Modell nicht kennt, bleiben in der Liste und
//! werden beim Speichern unverändert zurückgeschrieben.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Fehler beim Interpretieren von Attributen.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AttrError {
    #[error("Pflichtattribut '{0}' fehlt")]
    Missing(&'static str),
    #[error("Attribut '{name}' hat einen ungültigen Wert '{value}'")]
    Invalid { name: &'static str, value: String },
}

/// Geordnete Attributliste eines Elements.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attrs(pub Vec<(String, String)>);

impl Attrs {
    pub fn new() -> Self {
        Self(Vec::new())
    }

    /// Entfernt ein Attribut und gibt seinen Wert zurück.
    pub fn take(&mut self, name: &str) -> Option<String> {
        let pos = self.0.iter().position(|(n, _)| n == name)?;
        Some(self.0.remove(pos).1)
    }

    pub fn push(&mut self, name: &str, value: impl Into<String>) {
        self.0.push((name.to_owned(), value.into()));
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.0.iter().map(|(n, v)| (n.as_str(), v.as_str()))
    }
}

/// Ein einzelner Wert, der als Attribut gelesen und geschrieben werden kann.
pub trait AttrScalar: Sized {
    fn parse_attr(name: &'static str, value: &str) -> Result<Self, AttrError>;
    fn format_attr(&self) -> String;
}

/// Ein Feld eines Modellstructs: Pflichtwert (`T`) oder optional (`Option<T>`).
pub trait AttrField: Sized {
    fn take_from(attrs: &mut Attrs, name: &'static str) -> Result<Self, AttrError>;
    fn put_into(&self, attrs: &mut Attrs, name: &'static str);
}

impl<T: AttrScalar> AttrField for Option<T> {
    fn take_from(attrs: &mut Attrs, name: &'static str) -> Result<Self, AttrError> {
        attrs
            .take(name)
            .map(|v| T::parse_attr(name, &v))
            .transpose()
    }
    fn put_into(&self, attrs: &mut Attrs, name: &'static str) {
        if let Some(v) = self {
            attrs.push(name, v.format_attr());
        }
    }
}

macro_rules! required_field {
    ($($t:ty),*) => {$(
        impl AttrField for $t {
            fn take_from(attrs: &mut Attrs, name: &'static str) -> Result<Self, AttrError> {
                let v = attrs.take(name).ok_or(AttrError::Missing(name))?;
                <$t as AttrScalar>::parse_attr(name, &v)
            }
            fn put_into(&self, attrs: &mut Attrs, name: &'static str) {
                attrs.push(name, self.format_attr());
            }
        }
    )*};
}
required_field!(String, f32, i64, bool, Color);

impl AttrScalar for String {
    fn parse_attr(_: &'static str, value: &str) -> Result<Self, AttrError> {
        Ok(value.to_owned())
    }
    fn format_attr(&self) -> String {
        self.clone()
    }
}

impl AttrScalar for f32 {
    fn parse_attr(name: &'static str, value: &str) -> Result<Self, AttrError> {
        value.trim().parse().map_err(|_| AttrError::Invalid {
            name,
            value: value.to_owned(),
        })
    }
    fn format_attr(&self) -> String {
        format_java_float(*self)
    }
}

impl AttrScalar for i64 {
    fn parse_attr(name: &'static str, value: &str) -> Result<Self, AttrError> {
        value.trim().parse().map_err(|_| AttrError::Invalid {
            name,
            value: value.to_owned(),
        })
    }
    fn format_attr(&self) -> String {
        self.to_string()
    }
}

impl AttrScalar for bool {
    fn parse_attr(name: &'static str, value: &str) -> Result<Self, AttrError> {
        match value {
            "true" => Ok(true),
            "false" => Ok(false),
            _ => Err(AttrError::Invalid {
                name,
                value: value.to_owned(),
            }),
        }
    }
    fn format_attr(&self) -> String {
        self.to_string()
    }
}

/// Farbe als ARGB, im Format `AARRGGBB` (hexadezimal) gespeichert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Color(pub u32);

impl fmt::Display for Color {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:08X}", self.0)
    }
}

impl AttrScalar for Color {
    fn parse_attr(name: &'static str, value: &str) -> Result<Self, AttrError> {
        u32::from_str_radix(value.trim(), 16)
            .map(Color)
            .map_err(|_| AttrError::Invalid {
                name,
                value: value.to_owned(),
            })
    }
    fn format_attr(&self) -> String {
        self.to_string()
    }
}

/// Formatiert eine Gleitkommazahl so, wie Java `Float.toString` es für
/// typische Werte tut: ganze Zahlen mit `.0`, sonst die kürzeste exakte
/// Darstellung. Sweet Home 3D liest beides mit `Float.parseFloat`.
pub fn format_java_float(v: f32) -> String {
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 1e7 {
        format!("{v:.1}")
    } else {
        format!("{v}")
    }
}

/// Definiert ein Struct, dessen Felder 1:1 XML-Attributen entsprechen.
///
/// Zusätzlich zu den angegebenen Feldern bekommt das Struct `extra_attrs`:
/// unbekannte Attribute, die beim Speichern unverändert zurückgeschrieben werden.
/// Erzeugt `from_attrs` (liest alle Attribute) und `to_attrs` (schreibt sie in
/// Definitionsreihenfolge, unbekannte am Ende).
macro_rules! attr_struct {
    (
        $(#[$meta:meta])*
        pub struct $name:ident {
            $( $(#[$fmeta:meta])* $field:ident : $ty:ty => $xml:literal ),* $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
        pub struct $name {
            $(
                $(#[$fmeta])*
                #[serde(default)]
                pub $field: $ty,
            )*
            /// Unbekannte Attribute (z. B. aus neueren Sweet-Home-3D-Versionen).
            #[serde(default, skip_serializing_if = "crate::attrs::Attrs::is_empty")]
            pub extra_attrs: $crate::attrs::Attrs,
        }

        impl $name {
            /// Liest die bekannten Attribute; der Rest landet in `extra_attrs`.
            pub fn from_attrs(
                mut attrs: $crate::attrs::Attrs,
            ) -> Result<Self, $crate::attrs::AttrError> {
                Ok(Self {
                    $( $field: <$ty as $crate::attrs::AttrField>::take_from(&mut attrs, $xml)?, )*
                    extra_attrs: attrs,
                })
            }

            /// Schreibt alle Attribute in Definitionsreihenfolge, unbekannte am Ende.
            pub fn to_attrs(&self) -> $crate::attrs::Attrs {
                let mut attrs = $crate::attrs::Attrs::new();
                $( $crate::attrs::AttrField::put_into(&self.$field, &mut attrs, $xml); )*
                attrs.0.extend(self.extra_attrs.0.iter().cloned());
                attrs
            }
        }
    };
}
pub(crate) use attr_struct;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn java_float_format() {
        assert_eq!(format_java_float(250.0), "250.0");
        assert_eq!(format_java_float(96.63731), "96.63731");
        assert_eq!(format_java_float(-0.004761905), "-0.004761905");
        assert_eq!(format_java_float(0.0), "0.0");
    }

    #[test]
    fn color_roundtrip() {
        let c = Color::parse_attr("color", "FF00376B").unwrap();
        assert_eq!(c.0, 0xFF00376B);
        assert_eq!(c.format_attr(), "FF00376B");
        assert_eq!(Color(0x00A8A8A8).format_attr(), "00A8A8A8");
    }

    #[test]
    fn unknown_attributes_stay() {
        let mut a = Attrs(vec![
            ("x".into(), "1.5".into()),
            ("futureAttr".into(), "abc".into()),
        ]);
        let x: f32 = AttrField::take_from(&mut a, "x").unwrap();
        assert_eq!(x, 1.5);
        assert_eq!(a.0, vec![("futureAttr".to_string(), "abc".to_string())]);
    }

    #[test]
    fn missing_required_is_error() {
        let mut a = Attrs::new();
        let r: Result<f32, _> = AttrField::take_from(&mut a, "x");
        assert_eq!(r, Err(AttrError::Missing("x")));
    }
}
