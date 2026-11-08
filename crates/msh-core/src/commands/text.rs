//! Text styles of labels, room names and areas, dimension lines and furniture names.

use crate::registry::CommandError;
use msh_model::TextStyle;

/// Changes of a text style; `None` keeps the current value.
#[derive(Default, Clone)]
pub(super) struct StyleChange {
    pub size: Option<f32>,
    /// Font family; "" uses the default font
    pub font: Option<String>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
}

impl StyleChange {
    pub fn is_empty(&self) -> bool {
        self.size.is_none() && self.font.is_none() && self.bold.is_none() && self.italic.is_none()
    }

    fn apply(&self, style: &mut TextStyle) -> Result<(), CommandError> {
        if let Some(size) = self.size {
            if !size.is_finite() || size <= 0.0 {
                return Err(CommandError::failed("font size must be positive"));
            }
            style.font_size = size;
        }
        if let Some(f) = &self.font {
            style.font_name = Some(f.trim().to_string()).filter(|f| !f.is_empty());
        }
        // Sweet Home 3D writes bold and italic only when set
        if let Some(b) = self.bold {
            style.bold = b.then_some(true);
        }
        if let Some(i) = self.italic {
            style.italic = i.then_some(true);
        }
        Ok(())
    }
}

/// Applies `change` to a single optional style (labels, dimension lines, furniture names).
pub(super) fn update_style(
    slot: &mut Option<TextStyle>,
    default_size: f32,
    change: &StyleChange,
) -> Result<(), CommandError> {
    if change.is_empty() {
        return Ok(());
    }
    let style = slot.get_or_insert_with(|| TextStyle {
        font_size: default_size,
        ..Default::default()
    });
    change.apply(style)
}

/// Applies `change` to the style with `role` in a list (room name and area styles).
pub(super) fn update_role_style(
    styles: &mut Vec<TextStyle>,
    role: &str,
    default_size: f32,
    change: &StyleChange,
) -> Result<(), CommandError> {
    if change.is_empty() {
        return Ok(());
    }
    if !styles.iter().any(|t| t.role.as_deref() == Some(role)) {
        styles.push(TextStyle {
            role: Some(role.to_string()),
            font_size: default_size,
            ..Default::default()
        });
    }
    let style = styles
        .iter_mut()
        .find(|t| t.role.as_deref() == Some(role))
        .expect("style was added");
    change.apply(style)
}
