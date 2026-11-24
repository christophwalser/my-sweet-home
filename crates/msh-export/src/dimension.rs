//! How the dimensions of a home look: end marks, unit and decimals of their lengths, text size.
//! Sweet Home 3D has no such style; it is kept in a property of the home. The app formats
//! lengths the same way (`app/src/plan2d/dimensionStyle.ts`).

use crate::plan::format_length;
use msh_model::Home;
use serde::{Deserialize, Serialize};

/// Home property with the style as JSON.
pub const DIMENSION_STYLE_PROPERTY: &str = "mySweetHome.dimensionStyle";

/// Mark at both ends of a dimension line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndMark {
    #[default]
    Slash,
    Arrow,
    Dot,
    None,
}

/// Unit of the lengths.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DimensionUnit {
    /// As everywhere else: the unit of the preferences in the app, meters from 1 m on in files
    #[default]
    Auto,
    Mm,
    Cm,
    M,
    /// DIN 1356: centimeters below 1 m, else meters, millimeters raised, no unit (88⁵, 2,01)
    Din,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DimensionStyle {
    pub mark: EndMark,
    pub unit: DimensionUnit,
    /// Decimals of mm, cm and m (default 0, 1 and 2)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decimals: Option<u8>,
    /// Write the unit behind mm, cm and m
    pub show_unit: bool,
    /// Decimal comma instead of a point
    pub comma: bool,
    /// Text size in cm of dimensions without a text style of their own (default 18)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f32>,
}

impl Default for DimensionStyle {
    fn default() -> Self {
        Self {
            mark: EndMark::Slash,
            unit: DimensionUnit::Auto,
            decimals: None,
            show_unit: true,
            comma: false,
            font_size: None,
        }
    }
}

/// Style of the dimensions of a home (the default one if it has none or an unreadable one).
pub fn dimension_style(home: &Home) -> DimensionStyle {
    home.properties
        .iter()
        .find(|p| p.name == DIMENSION_STYLE_PROPERTY)
        .and_then(|p| serde_json::from_str(&p.value).ok())
        .unwrap_or_default()
}

/// The digits as raised characters.
fn raised(n: u64) -> String {
    const DIGITS: [char; 10] = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
    n.to_string()
        .bytes()
        .map(|b| DIGITS[usize::from(b - b'0')])
        .collect()
}

impl DimensionStyle {
    fn separator(&self, text: String) -> String {
        if self.comma {
            text.replace('.', ",")
        } else {
            text
        }
    }

    /// A length in cm as the dimensions show it.
    pub fn format(&self, cm: f32) -> String {
        let cm = f64::from(cm);
        let (factor, decimals, unit) = match self.unit {
            DimensionUnit::Auto => return self.separator(format_length(cm as f32)),
            DimensionUnit::Din => return self.din(cm),
            DimensionUnit::Mm => (10.0, 0, "mm"),
            DimensionUnit::Cm => (1.0, 1, "cm"),
            DimensionUnit::M => (0.01, 2, "m"),
        };
        let decimals = usize::from(self.decimals.unwrap_or(decimals).min(4));
        // Rounded half up before it is written, as in the app: f32 lengths such as 42.55 lie
        // a little below what was meant
        let scale = 10f64.powi(decimals as i32);
        let value = (cm * factor * scale + 1e-4).round() / scale;
        let text = self.separator(format!("{value:.decimals$}"));
        if self.show_unit {
            format!("{text} {unit}")
        } else {
            text
        }
    }

    fn din(&self, cm: f64) -> String {
        let mm = (cm.abs() * 10.0 + 1e-4).round() as u64;
        let sign = if cm < 0.0 && mm > 0 { "-" } else { "" };
        let whole = mm / 10;
        let rest = if mm.is_multiple_of(10) {
            String::new()
        } else {
            raised(mm % 10)
        };
        let text = if whole >= 100 {
            self.separator(format!("{}.{:02}", whole / 100, whole % 100))
        } else {
            whole.to_string()
        };
        format!("{sign}{text}{rest}")
    }

    /// An elevation in cm as an elevation mark shows it: in m with a sign, "±0.00" for zero,
    /// millimeters only if there are any.
    pub fn format_elevation(&self, cm: f32) -> String {
        let mm = (f64::from(cm) * 10.0).round() as i64;
        let sign = match mm {
            0 => "\u{b1}",
            1.. => "+",
            _ => "-",
        };
        let (m, rest) = (mm.unsigned_abs() / 1000, mm.unsigned_abs() % 1000);
        let text = if rest % 10 == 0 {
            format!("{m}.{:02}", rest / 10)
        } else {
            format!("{m}.{rest:03}")
        };
        format!("{sign}{}", self.separator(text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style(unit: DimensionUnit) -> DimensionStyle {
        DimensionStyle {
            unit,
            ..Default::default()
        }
    }

    // The same cases as in app/src/plan2d/dimensionStyle.test.ts
    #[test]
    fn lengths_in_every_unit() {
        assert_eq!(style(DimensionUnit::Mm).format(88.5), "885 mm");
        assert_eq!(style(DimensionUnit::Cm).format(88.55), "88.6 cm");
        assert_eq!(style(DimensionUnit::M).format(201.0), "2.01 m");
        let fine = DimensionStyle {
            decimals: Some(3),
            comma: true,
            show_unit: false,
            ..style(DimensionUnit::M)
        };
        assert_eq!(fine.format(201.25), "2,013");
        assert_eq!(style(DimensionUnit::Auto).format(250.0), "2.50 m");
    }

    #[test]
    fn din_raises_the_millimeters() {
        let din = DimensionStyle {
            comma: true,
            ..style(DimensionUnit::Din)
        };
        assert_eq!(din.format(88.5), "88⁵");
        assert_eq!(din.format(11.5), "11⁵");
        assert_eq!(din.format(24.0), "24");
        assert_eq!(din.format(99.96), "1,00");
        assert_eq!(din.format(201.0), "2,01");
        assert_eq!(din.format(1036.5), "10,36⁵");
    }

    #[test]
    fn elevations_have_a_sign() {
        let s = DimensionStyle {
            comma: true,
            ..Default::default()
        };
        assert_eq!(s.format_elevation(0.0), "±0,00");
        assert_eq!(s.format_elevation(262.0), "+2,62");
        assert_eq!(s.format_elevation(262.5), "+2,625");
        assert_eq!(s.format_elevation(-12.0), "-0,12");
        assert_eq!(s.format_elevation(0.02), "±0,00");
    }

    #[test]
    fn an_unreadable_style_is_the_default() {
        let mut home = Home::default();
        assert_eq!(dimension_style(&home), DimensionStyle::default());
        home.properties.push(msh_model::Property {
            name: DIMENSION_STYLE_PROPERTY.into(),
            value: r#"{"unit":"din","comma":true}"#.into(),
            kind: None,
            ..Default::default()
        });
        let s = dimension_style(&home);
        assert!(s.unit == DimensionUnit::Din && s.comma && s.show_unit);
        home.properties[0].value = "{".into();
        assert_eq!(dimension_style(&home), DimensionStyle::default());
    }
}
