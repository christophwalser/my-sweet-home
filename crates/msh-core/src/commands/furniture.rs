//! Catalog search and furniture commands (including doors and windows).

use super::{deg, new_id, parse_color, rad, resolve_level, round2, target_ids, updated};
use crate::catalog::{CatalogIndex, EmbeddedResources, FurnitureEntry, embed_furniture_resources};
use crate::document::Document;
use crate::registry::{CommandError, Registry};
use msh_model::{
    Color, Furniture, Home, LightSource, LightSourceMaterial, Piece, PieceAttrs, PieceKind, Sash,
};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize, JsonSchema, Default, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
enum SearchKind {
    #[default]
    Furniture,
    Textures,
}

#[derive(Deserialize, JsonSchema)]
struct SearchParams {
    /// Words to search in name, category, tags and creator, e.g. "double bed" or "door"
    query: String,
    /// "furniture" (default) or "textures"
    kind: Option<SearchKind>,
    /// Maximum number of results (default 20)
    limit: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    /// Catalog ID from catalog_search, e.g. "eTeks#bed140x190"
    catalog_id: String,
    /// Center of the piece in the plan (cm)
    x: f32,
    y: f32,
    /// Rotation in degrees, clockwise (0 = as in the catalog icon)
    angle_deg: Option<f32>,
    /// Height of the bottom above the floor in cm (default from catalog)
    elevation: Option<f32>,
    /// Size in cm; defaults to the catalog size
    width: Option<f32>,
    depth: Option<f32>,
    height: Option<f32>,
    /// Name shown in the furniture list (default: catalog name)
    name: Option<String>,
    /// Color of the whole model as #RRGGBB
    color: Option<String>,
    /// Mirror the model
    mirrored: Option<bool>,
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct AddInWallParams {
    /// Catalog ID of a door or window from catalog_search
    catalog_id: String,
    /// ID of the wall the door or window is placed in
    wall_id: String,
    /// Distance in cm from the wall start to the center of the door or window
    offset: f32,
    /// Height of the bottom above the floor in cm (default from catalog, e.g. windows ~80)
    elevation: Option<f32>,
    width: Option<f32>,
    height: Option<f32>,
    /// Open to the other side of the wall
    flip: Option<bool>,
    /// Mirror the model (hinges on the other side)
    mirrored: Option<bool>,
    name: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    /// Piece to change (or use `ids`)
    id: Option<String>,
    /// Several pieces that get the same values (one undo step)
    ids: Option<Vec<String>>,
    x: Option<f32>,
    y: Option<f32>,
    angle_deg: Option<f32>,
    /// Turns each piece by this angle in degrees (clockwise) around its own center,
    /// starting from its current angle (not together with `angle_deg`)
    rotate_deg: Option<f32>,
    elevation: Option<f32>,
    width: Option<f32>,
    depth: Option<f32>,
    height: Option<f32>,
    name: Option<String>,
    /// Color as #RRGGBB, or "" to restore the model colors
    color: Option<String>,
    mirrored: Option<bool>,
    visible: Option<bool>,
    /// Doors and windows: the opening goes through the whole wall, also where the piece is
    /// thinner than the wall (a reveal)
    wall_cut_out_on_both_sides: Option<bool>,
    /// Tilt forward / backward in degrees (rotation around the width axis); not for doors,
    /// windows and pieces that cannot be rotated horizontally
    pitch_deg: Option<f32>,
    /// Tilt sideways in degrees (rotation around the depth axis)
    roll_deg: Option<f32>,
    /// Power of a light in percent (0..100)
    power: Option<f32>,
    /// Opening angle of the light cone of a lamp in degrees (lights downwards, through the
    /// bottom of the piece, tilted with it); 0 lights in all directions
    spot_angle_deg: Option<f32>,
    /// Show the name of the piece in the plan
    name_visible: Option<bool>,
    /// Text style of the name in the plan: size in cm, font family ("" = default), bold,
    /// italic
    name_font_size: Option<f32>,
    name_font_name: Option<String>,
    name_bold: Option<bool>,
    name_italic: Option<bool>,
    /// Changes of single materials of the model (by material name, see the model file)
    materials: Option<Vec<MaterialParams>>,
    /// Remove all material changes: the model shows its own materials again
    reset_materials: Option<bool>,
    /// Catalog ID of a texture for the whole piece (replaces its color), "" to remove it
    texture: Option<String>,
    /// Shininess of the whole piece from 0 (matt) to 1; Sweet Home 3D's "shiny" is 0.25. A
    /// negative value restores the model's own
    shininess: Option<f32>,
    /// Description of the piece, "" to remove it
    description: Option<String>,
    /// Price (in `currency`); a negative value removes it
    price: Option<f64>,
    /// Value added tax in percent of the price (e.g. 8.1); a negative value removes it
    vat_percent: Option<f64>,
    /// ISO 4217 code of the price, "" to remove it
    currency: Option<String>,
    /// Part of the base plan (not movable, locked with the base plan); doors and windows
    /// always are
    base_plan_item: Option<bool>,
    /// Reference object (terrain, scan, neighbor house): shown in the plan faint and in 3D,
    /// but not picked or snapped to in the plan; selected in the furniture list
    reference: Option<bool>,
    /// With one of width, depth and height: the other two change by the same factor, for
    /// each piece (default false)
    keep_proportions: Option<bool>,
}

/// A decimal for the file: at most `digits` decimals, without trailing zeros.
fn decimal_string(v: f64, digits: usize) -> String {
    let s = format!("{v:.digits$}");
    if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.').to_owned()
    } else {
        s
    }
}

#[derive(Deserialize, JsonSchema)]
struct ReplaceParams {
    /// Piece to replace (or use `ids`)
    id: Option<String>,
    /// Several pieces that are all replaced by the catalog piece (one undo step)
    ids: Option<Vec<String>>,
    /// Catalog ID of the new piece (see catalog_search)
    catalog_id: String,
    /// Keep width, depth and height of the replaced piece instead of the catalog size
    keep_size: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct MaterialParams {
    /// Name of the material in the model
    name: String,
    /// Color as #RRGGBB, "" for the model's color
    color: Option<String>,
    /// Catalog ID of a texture, "" for the model's texture
    texture: Option<String>,
    /// Shininess from 0 (matt) to 1 (shiny), a negative value for the model's shininess
    shininess: Option<f32>,
}

/// Applies material changes to a piece; materials without any change are removed.
fn apply_materials(
    piece: &mut Piece,
    changes: &[MaterialParams],
    textures: &[Option<msh_model::Texture>],
) -> Result<(), CommandError> {
    for (change, texture) in changes.iter().zip(textures) {
        let index = match piece
            .materials
            .iter()
            .position(|m| m.attrs.name == change.name)
        {
            Some(i) => i,
            None => {
                piece.materials.push(msh_model::Material {
                    attrs: msh_model::MaterialAttrs {
                        name: change.name.clone(),
                        ..Default::default()
                    },
                    texture: None,
                    extra_children: Vec::new(),
                });
                piece.materials.len() - 1
            }
        };
        let m = &mut piece.materials[index];
        if let Some(c) = &change.color {
            m.attrs.color = super::optional_color(c)?;
            if m.attrs.color.is_some() {
                m.texture = None;
            }
        }
        if change.texture.is_some() {
            m.texture = texture.clone();
            if m.texture.is_some() {
                m.attrs.color = None;
            }
        }
        if let Some(s) = change.shininess {
            m.attrs.shininess = (s >= 0.0).then(|| s.clamp(0.0, 1.0));
        }
    }
    piece
        .materials
        .retain(|m| m.attrs.color.is_some() || m.texture.is_some() || m.attrs.shininess.is_some());
    Ok(())
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "catalog_search",
        "Searches the installed furniture or texture catalogs. Returns catalog IDs with name, \
         category and size (cm) for use with furniture_add, furniture_add_in_wall or as texture.",
        false,
        |_doc, p: SearchParams| {
            let words: Vec<String> = p
                .query
                .to_lowercase()
                .split_whitespace()
                .map(String::from)
                .collect();
            let matches = |fields: &[&str]| {
                let hay = fields.join(" ").to_lowercase();
                words.iter().all(|w| hay.contains(w.as_str()))
            };
            let limit = p.limit.unwrap_or(20);
            let index = CatalogIndex::get();
            let mut out: Vec<Value> = Vec::new();
            match p.kind.unwrap_or_default() {
                SearchKind::Furniture => {
                    for f in &index.furniture {
                        let i = &f.item;
                        let tags = i.tags.join(" ");
                        let fields = [
                            i.name.as_str(),
                            i.category.as_str(),
                            tags.as_str(),
                            i.creator.as_deref().unwrap_or(""),
                            i.id.as_deref().unwrap_or(""),
                        ];
                        if i.id.is_some() && matches(&fields) {
                            out.push(json!({
                                "catalog_id": i.id,
                                "name": i.name,
                                "category": i.category,
                                "width": i.width,
                                "depth": i.depth,
                                "height": i.height,
                                "elevation": i.elevation,
                                "door_or_window": i.door_or_window,
                                "light": is_light_item(&i.extra),
                                "creator": i.creator,
                                "license": i.license.as_ref().or(f.library_license.as_ref()),
                            }));
                        }
                        if out.len() >= limit {
                            break;
                        }
                    }
                }
                SearchKind::Textures => {
                    for t in &index.textures {
                        let i = &t.item;
                        let fields = [
                            i.name.as_str(),
                            i.category.as_str(),
                            i.creator.as_deref().unwrap_or(""),
                            i.id.as_deref().unwrap_or(""),
                        ];
                        if i.id.is_some() && matches(&fields) {
                            out.push(json!({
                                "catalog_id": i.id,
                                "name": i.name,
                                "category": i.category,
                                "width": i.width,
                                "height": i.height,
                            }));
                        }
                        if out.len() >= limit {
                            break;
                        }
                    }
                }
            }
            Ok(json!({ "results": out }))
        },
    );
    r.add(
        "furniture_add",
        "Places a piece of furniture from the catalog at (x, y). Its model and icon are embedded \
         in the home, so the saved file works without the catalog.",
        true,
        |doc, p: AddParams| {
            let level = resolve_level(doc.home(), p.level)?;
            let entry = catalog_entry(&p.catalog_id)?;
            let mut piece = piece_from_catalog(doc, &entry)?;
            let a = &mut piece.attrs;
            a.level = level;
            a.x = p.x;
            a.y = p.y;
            a.angle = p.angle_deg.map(rad).filter(|v| *v != 0.0);
            apply_size(a, p.width, p.depth, p.height);
            match p.elevation {
                Some(e) => a.elevation = Some(e),
                None if piece.kind != PieceKind::DoorOrWindow => {
                    fit_under_ceiling(doc.home(), &mut piece.attrs)
                }
                None => {}
            }
            let a = &mut piece.attrs;
            if let Some(n) = p.name {
                a.name = n;
            }
            if let Some(c) = &p.color {
                a.color = Some(parse_color(c)?);
            }
            if p.mirrored == Some(true) {
                a.model_mirrored = Some(true);
            }
            let id = a.id.clone().unwrap_or_default();
            doc.home_mut()
                .furniture
                .push(Furniture::Piece(Box::new(piece)));
            Ok(json!({ "id": id }))
        },
    );
    r.add(
        "furniture_replace",
        "Replaces pieces of furniture by a piece from the catalog. ID, position, angle, \
         elevation, level, visibility and mirroring stay; name, model, size and materials come \
         from the catalog (the size stays with keep_size).",
        true,
        |doc, p: ReplaceParams| {
            let entry = catalog_entry(&p.catalog_id)?;
            let targets = target_ids(p.id.clone(), p.ids.clone())?;
            for id in &targets {
                let mut new = piece_from_catalog(doc, &entry)?;
                let old = find_piece_mut(doc, id)?;
                let o = &old.attrs;
                let a = &mut new.attrs;
                a.id = o.id.clone();
                a.level = o.level.clone();
                a.x = o.x;
                a.y = o.y;
                a.angle = o.angle;
                a.elevation = o.elevation;
                a.visible = o.visible;
                a.name_visible = o.name_visible;
                a.model_mirrored = o.model_mirrored;
                a.bound_to_wall = o.bound_to_wall;
                if p.keep_size == Some(true) {
                    apply_size(a, Some(o.width), Some(o.depth), Some(o.height));
                } else if old.kind == PieceKind::DoorOrWindow && new.kind == PieceKind::DoorOrWindow
                {
                    // The depth of a door or window is fitted to its wall
                    new.attrs.depth = old.attrs.depth;
                }
                *old = new;
            }
            Ok(updated(&targets))
        },
    );
    r.add(
        "furniture_add_in_wall",
        "Places a door or window from the catalog in a wall: centered on the wall axis at `offset` \
         cm from the wall start, rotated along the wall, with its depth fitted to the wall thickness.",
        true,
        |doc, p: AddInWallParams| {
            let wall = doc
                .home()
                .walls
                .iter()
                .find(|w| w.attrs.id == p.wall_id)
                .ok_or_else(|| CommandError::failed(format!("unknown wall '{}'", p.wall_id)))?
                .clone();
            let entry = catalog_entry(&p.catalog_id)?;
            if !entry.item.door_or_window {
                return Err(CommandError::failed(format!(
                    "'{}' is not a door or window; use furniture_add",
                    p.catalog_id
                )));
            }
            let w = &wall.attrs;
            let length = wall.chord_length();
            if p.offset < 0.0 || p.offset > length {
                return Err(CommandError::failed(format!(
                    "offset {} is outside the wall (length {:.1} cm)",
                    p.offset, length
                )));
            }
            let mut piece = piece_from_catalog(doc, &entry)?;
            let a = &mut piece.attrs;
            let angle = (w.y_end - w.y_start).atan2(w.x_end - w.x_start);
            a.level = w.level.clone();
            a.x = w.x_start + angle.cos() * p.offset;
            a.y = w.y_start + angle.sin() * p.offset;
            let mut piece_angle = angle;
            if p.flip == Some(true) {
                piece_angle += std::f32::consts::PI;
            }
            a.angle = Some(normalize_angle(piece_angle)).filter(|v| *v != 0.0);
            apply_size(a, p.width, None, p.height);
            // Depth from the wall thickness (or its real depth with a reveal in thick walls)
            let natural = a.depth;
            fit_in_wall(a, w, Some(natural));
            if let Some(e) = p.elevation {
                a.elevation = Some(e);
            }
            if let Some(n) = p.name {
                a.name = n;
            }
            if p.mirrored == Some(true) {
                a.model_mirrored = Some(true);
            }
            a.bound_to_wall = Some(true);
            let id = a.id.clone().unwrap_or_default();
            doc.home_mut().furniture.push(Furniture::Piece(Box::new(piece)));
            Ok(json!({ "id": id, "x": round2(a_x(doc, &id)), "angle_deg": deg(normalize_angle(piece_angle)) }))
        },
    );
    r.add(
        "furniture_update",
        "Moves, rotates, resizes, renames, colors, mirrors or hides a piece of furniture, or \
         marks it as reference object (or several pieces with ids; x and y only for one piece).",
        true,
        |doc, p: UpdateParams| {
            // Textures of material changes are embedded once for all pieces
            let mut material_textures = Vec::new();
            for change in p.materials.iter().flatten() {
                let tex = super::wall::texture_for(doc, super::non_empty(&change.texture), "")?;
                // Sweet Home 3D writes material textures without a role attribute
                material_textures.push(tex.map(|t| msh_model::Texture { role: None, ..t }));
            }
            // The texture of the whole piece (written without a role, like Sweet Home 3D)
            let piece_texture = match &p.texture {
                Some(_) => Some(
                    super::wall::texture_for(doc, super::non_empty(&p.texture), "")?
                        .map(|t| msh_model::Texture { role: None, ..t }),
                ),
                None => None,
            };
            for (name, v) in [("price", p.price), ("vat_percent", p.vat_percent)] {
                if v.is_some_and(|v| !v.is_finite()) {
                    return Err(CommandError::failed(format!("{name} must be a number")));
                }
            }
            if p.vat_percent.is_some_and(|v| v >= 100.0) {
                return Err(CommandError::failed("vat_percent must be below 100"));
            }
            if p.shininess.is_some_and(|v| !v.is_finite()) {
                return Err(CommandError::failed("shininess must be a number"));
            }
            if p.rotate_deg.is_some_and(|v| !v.is_finite()) {
                return Err(CommandError::failed("rotate_deg must be a number"));
            }
            if p.rotate_deg.is_some() && p.angle_deg.is_some() {
                return Err(CommandError::failed(
                    "give either angle_deg or rotate_deg, not both",
                ));
            }
            let targets = target_ids(p.id.clone(), p.ids.clone())?;
            if targets.len() > 1 && (p.x.is_some() || p.y.is_some()) {
                return Err(CommandError::failed(
                    "x and y can only be changed for one piece at a time (use edit_move)",
                ));
            }
            for target in &targets {
                let piece = find_piece_mut(doc, target)?;
                let a = &mut piece.attrs;
                if let Some(v) = p.x {
                    a.x = v;
                }
                if let Some(v) = p.y {
                    a.y = v;
                }
                if let Some(v) = p.angle_deg {
                    a.angle = Some(normalize_angle(rad(v)));
                }
                if let Some(v) = p.rotate_deg {
                    a.angle = Some(normalize_angle(a.angle_or_default() + rad(v)));
                }
                if let Some(v) = p.elevation {
                    a.elevation = Some(v);
                }
                // Models that may not be deformed always keep their proportions
                if p.keep_proportions == Some(true) || a.deformable == Some(false) {
                    apply_size_proportional(a, p.width, p.depth, p.height);
                } else {
                    apply_size(a, p.width, p.depth, p.height);
                }
                if p.pitch_deg.is_some() || p.roll_deg.is_some() {
                    if piece.kind == PieceKind::DoorOrWindow
                        || a.horizontally_rotatable == Some(false)
                    {
                        return Err(CommandError::failed(format!(
                            "'{}' cannot be tilted",
                            a.name
                        )));
                    }
                    if let Some(v) = p.pitch_deg {
                        a.pitch = Some(rad(v.clamp(-180.0, 180.0))).filter(|v| *v != 0.0);
                    }
                    if let Some(v) = p.roll_deg {
                        a.roll = Some(rad(v.clamp(-180.0, 180.0))).filter(|v| *v != 0.0);
                    }
                }
                update_size_in_plan(a);
                if (p.power.is_some() || p.spot_angle_deg.is_some())
                    && piece.kind != PieceKind::Light
                {
                    return Err(CommandError::failed(format!("'{}' is not a light", a.name)));
                }
                if let Some(v) = p.power {
                    if !v.is_finite() {
                        return Err(CommandError::failed("power must be a number"));
                    }
                    a.power = Some((v.clamp(0.0, 100.0) / 100.0 * 1000.0).round() / 1000.0);
                }
                if let Some(v) = p.spot_angle_deg {
                    if !v.is_finite() {
                        return Err(CommandError::failed("spot_angle_deg must be a number"));
                    }
                    piece.properties.retain(|pr| pr.name != SPOT_ANGLE_PROPERTY);
                    if v > 0.0 {
                        piece.properties.push(msh_model::Property {
                            name: SPOT_ANGLE_PROPERTY.into(),
                            value: format!("{}", v.clamp(5.0, 170.0).round()),
                            kind: None,
                            ..Default::default()
                        });
                    }
                }
                let a = &mut piece.attrs;
                if let Some(v) = &p.name {
                    a.name = v.clone();
                }
                if let Some(c) = &p.color {
                    a.color = if c.is_empty() {
                        None
                    } else {
                        Some(parse_color(c)?)
                    };
                }
                if let Some(v) = p.mirrored {
                    a.model_mirrored = Some(v);
                }
                if let Some(v) = p.visible {
                    a.visible = Some(v);
                }
                if let Some(v) = p.wall_cut_out_on_both_sides {
                    a.wall_cut_out_on_both_sides = Some(v);
                }
                if let Some(v) = p.name_visible {
                    a.name_visible = v.then_some(true);
                }
                super::text::update_style(
                    &mut piece.text_style,
                    18.0,
                    &super::text::StyleChange {
                        size: p.name_font_size,
                        font: p.name_font_name.clone(),
                        bold: p.name_bold,
                        italic: p.name_italic,
                    },
                )?;
                if p.reset_materials == Some(true) {
                    piece.materials.clear();
                }
                if let Some(changes) = &p.materials {
                    apply_materials(piece, changes, &material_textures)?;
                }
                // Color and texture of the whole piece exclude each other, as in Sweet Home 3D
                if let Some(tex) = &piece_texture {
                    piece.texture = tex.clone();
                    if piece.texture.is_some() {
                        piece.attrs.color = None;
                    }
                } else if p.color.as_deref().is_some_and(|c| !c.is_empty()) {
                    piece.texture = None;
                }
                let a = &mut piece.attrs;
                if let Some(v) = p.shininess {
                    a.shininess = (v >= 0.0).then(|| v.clamp(0.0, 1.0));
                }
                if let Some(v) = &p.description {
                    a.description = (!v.is_empty()).then(|| v.clone());
                }
                if let Some(v) = p.price {
                    a.price = (v >= 0.0).then(|| decimal_string(v, 2));
                }
                if let Some(v) = p.vat_percent {
                    // Sweet Home 3D stores the VAT as a fraction of the price (0.2 = 20 %)
                    a.value_added_tax_percentage = (v >= 0.0).then(|| decimal_string(v / 100.0, 6));
                }
                if let Some(v) = &p.currency {
                    a.currency = (!v.is_empty()).then(|| v.to_ascii_uppercase());
                }
                if let Some(v) = p.reference {
                    piece.properties.retain(|pr| pr.name != REFERENCE_PROPERTY);
                    if v {
                        piece.properties.push(msh_model::Property {
                            name: REFERENCE_PROPERTY.into(),
                            value: "true".into(),
                            kind: None,
                            ..Default::default()
                        });
                    }
                }
                // Movable is the default; the file only says so when it is not
                if let Some(v) = p.base_plan_item
                    && piece.kind != PieceKind::DoorOrWindow
                {
                    a.movable = v.then_some(false);
                }
            }
            Ok(updated(&targets))
        },
    );
}

/// Catalog elevations of ceiling pieces (spots, ceiling lamps) assume Sweet Home 3D's 250 cm
/// rooms. On a lower level such a piece would stick out of the ceiling into the floor of the
/// level above and show there. A piece above the floor whose top is above the ceiling of its
/// level is lowered until its top touches the ceiling.
fn fit_under_ceiling(home: &Home, a: &mut PieceAttrs) {
    let elevation = a.elevation.unwrap_or(0.0);
    if elevation <= 0.0 {
        return;
    }
    let ceiling = match &a.level {
        Some(id) => home
            .levels
            .iter()
            .find(|l| &l.attrs.id == id)
            .map(|l| l.attrs.height),
        None => Some(home.attrs.wall_height.unwrap_or(250.0)),
    };
    let Some(ceiling) = ceiling.filter(|c| *c > 0.0) else {
        return;
    };
    let height = a.height_in_plan.unwrap_or(a.height);
    if elevation + height > ceiling + 0.01 {
        a.elevation = Some((ceiling - height).max(0.0)).filter(|e| *e > 0.0);
    }
}

fn catalog_entry(id: &str) -> Result<FurnitureEntry, CommandError> {
    CatalogIndex::get()
        .furniture_by_id(id)
        .cloned()
        .ok_or_else(|| {
            CommandError::failed(format!("unknown catalog ID '{id}' (use catalog_search)"))
        })
}

fn a_x(doc: &Document, id: &str) -> f32 {
    let mut x = 0.0;
    doc.home().for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            x = p.attrs.x;
        }
    });
    x
}

fn normalize_angle(a: f32) -> f32 {
    a.rem_euclid(std::f32::consts::TAU)
}

/// Piece property with the opening angle of a lamp's light cone in degrees (our own; Sweet
/// Home 3D keeps it and lights in all directions).
pub const SPOT_ANGLE_PROPERTY: &str = "mySweetHome.spotAngle";

/// Piece property marking a reference object such as terrain or a scan (our own; Sweet Home 3D
/// keeps it and treats the piece as any other).
pub const REFERENCE_PROPERTY: &str = "mySweetHome.reference";

/// Size of the box around a tilted piece, as Sweet Home 3D stores it in `widthInPlan`,
/// `depthInPlan` and `heightInPlan`: the box rotated with Rz(−roll) · Rx(−pitch).
fn update_size_in_plan(a: &mut PieceAttrs) {
    let pitch = a.pitch.unwrap_or(0.0);
    let roll = a.roll.unwrap_or(0.0);
    if pitch == 0.0 && roll == 0.0 {
        a.width_in_plan = None;
        a.depth_in_plan = None;
        a.height_in_plan = None;
        return;
    }
    let (sp, cp) = (-pitch).sin_cos();
    let (sr, cr) = (-roll).sin_cos();
    let (mut min, mut max) = ([f32::MAX; 3], [f32::MIN; 3]);
    for &x in &[-a.width / 2.0, a.width / 2.0] {
        for &y in &[-a.height / 2.0, a.height / 2.0] {
            for &z in &[-a.depth / 2.0, a.depth / 2.0] {
                // Rx(−pitch), then Rz(−roll)
                let (y1, z1) = (y * cp - z * sp, y * sp + z * cp);
                let (x2, y2) = (x * cr - y1 * sr, x * sr + y1 * cr);
                for (i, v) in [x2, y2, z1].into_iter().enumerate() {
                    min[i] = min[i].min(v);
                    max[i] = max[i].max(v);
                }
            }
        }
    }
    let round = |v: f32| (v * 100.0).round() / 100.0;
    a.width_in_plan = Some(round(max[0] - min[0]));
    a.height_in_plan = Some(round(max[1] - min[1]));
    a.depth_in_plan = Some(round(max[2] - min[2]));
}

fn apply_size(a: &mut PieceAttrs, width: Option<f32>, depth: Option<f32>, height: Option<f32>) {
    if let Some(v) = width.filter(|v| *v > 0.0) {
        a.width = v;
    }
    if let Some(v) = depth.filter(|v| *v > 0.0) {
        a.depth = v;
    }
    if let Some(v) = height.filter(|v| *v > 0.0) {
        a.height = v;
    }
}

/// Like [`apply_size`], but one given dimension scales the other two by the same factor.
fn apply_size_proportional(
    a: &mut PieceAttrs,
    width: Option<f32>,
    depth: Option<f32>,
    height: Option<f32>,
) {
    let given = [(width, a.width), (depth, a.depth), (height, a.height)];
    let mut factors = given
        .iter()
        .filter_map(|(new, old)| new.filter(|v| *v > 0.0 && *old > 0.0).map(|v| v / old));
    match (factors.next(), factors.next()) {
        (Some(f), None) => apply_size(a, Some(a.width * f), Some(a.depth * f), Some(a.height * f)),
        _ => apply_size(a, width, depth, height),
    }
}

pub(super) fn find_piece_mut<'a>(
    doc: &'a mut Document,
    id: &str,
) -> Result<&'a mut Piece, CommandError> {
    fn walk<'a>(items: &'a mut [Furniture], id: &str) -> Option<&'a mut Piece> {
        for item in items {
            match item {
                Furniture::Piece(p) if p.attrs.id.as_deref() == Some(id) => return Some(p),
                Furniture::Group(g) => {
                    if let Some(p) = walk(&mut g.items, id) {
                        return Some(p);
                    }
                }
                _ => {}
            }
        }
        None
    }
    walk(&mut doc.home_mut().furniture, id)
        .ok_or_else(|| CommandError::failed(format!("unknown piece of furniture '{id}'")))
}

/// Creates a piece from a catalog item and embeds its resources. Catalog values
/// in cm or degrees are converted to the relative values stored in Home.xml.
fn piece_from_catalog(doc: &mut Document, entry: &FurnitureEntry) -> Result<Piece, CommandError> {
    let item = &entry.item;
    let EmbeddedResources {
        model,
        icon,
        plan_icon,
        model_size,
    } = embed_furniture_resources(doc, entry)?;
    let x = &item.extra;
    let num = |k: &str| x.get(k).and_then(|v| v.trim().parse::<f32>().ok());
    let nums = |k: &str| -> Vec<f32> {
        x.get(k)
            .map(|v| {
                v.split_whitespace()
                    .filter_map(|s| s.parse().ok())
                    .collect()
            })
            .unwrap_or_default()
    };
    let flag = |k: &str| x.get(k).map(|v| v.trim().eq_ignore_ascii_case("true"));
    let (w, d, h) = (item.width, item.depth, item.height);

    let is_light = is_light_item(x);
    let is_shelf_unit = x.contains_key("shelfElevations") || x.contains_key("shelfBoxes");
    let kind = if item.door_or_window {
        PieceKind::DoorOrWindow
    } else if is_light {
        PieceKind::Light
    } else if is_shelf_unit {
        PieceKind::ShelfUnit
    } else {
        PieceKind::Piece
    };

    let mut attrs = PieceAttrs {
        id: Some(new_id(match kind {
            PieceKind::DoorOrWindow => "doorOrWindow",
            PieceKind::Light => "light",
            PieceKind::ShelfUnit => "shelfUnit",
            _ => "pieceOfFurniture",
        })),
        catalog_id: item.id.clone(),
        name: item.name.clone(),
        creator: item.creator.clone(),
        license: item
            .license
            .clone()
            .or_else(|| entry.library_license.clone()),
        model,
        icon,
        plan_icon,
        width: w,
        depth: d,
        height: h,
        elevation: (item.elevation != 0.0).then_some(item.elevation),
        model_size: model_size.or_else(|| num("modelSize").map(|v| v as i64)),
        movable: (!item.movable).then_some(false),
        model_rotation: x.get("modelRotation").cloned(),
        staircase_cut_out_shape: x.get("staircaseCutOutShape").cloned(),
        back_face_shown: flag("backFaceShown").filter(|v| *v),
        resizable: flag("resizable").filter(|v| !*v),
        deformable: flag("deformable").filter(|v| !*v),
        texturable: flag("texturable").filter(|v| !*v),
        horizontally_rotatable: flag("horizontallyRotatable").filter(|v| !*v),
        drop_on_top_elevation: num("dropOnTopElevation").filter(|_| h > 0.0).map(|v| v / h),
        ..Default::default()
    };
    let mut sashes = Vec::new();
    let mut light_sources = Vec::new();
    let mut shelves = Vec::new();
    if kind == PieceKind::ShelfUnit && w > 0.0 && d > 0.0 && h > 0.0 {
        // Sweet Home 3D keeps shelves relative to the size, so they follow resizing
        for e in nums("shelfElevations") {
            shelves.push(msh_model::Shelf {
                elevation: Some(e / h),
                ..Default::default()
            });
        }
        for b in nums("shelfBoxes").as_chunks::<6>().0 {
            shelves.push(msh_model::Shelf {
                x_lower: Some(b[0] / w),
                y_lower: Some(b[1] / d),
                z_lower: Some(b[2] / h),
                x_upper: Some(b[3] / w),
                y_upper: Some(b[4] / d),
                z_upper: Some(b[5] / h),
                ..Default::default()
            });
        }
    }

    if kind == PieceKind::DoorOrWindow {
        attrs.door_or_window = None; // implied by the element name
        attrs.wall_thickness = num("doorOrWindowWallThickness")
            .filter(|_| d > 0.0)
            .map(|v| v / d);
        attrs.wall_distance = num("doorOrWindowWallDistance")
            .filter(|_| d > 0.0)
            .map(|v| v / d);
        attrs.cut_out_shape = x.get("doorOrWindowCutOutShape").cloned();
        attrs.wall_cut_out_on_both_sides = flag("doorOrWindowWallCutOutOnBothSides");
        attrs.width_depth_deformable = flag("doorOrWindowWidthDepthDeformable");
        let (xs, ys, ws) = (
            nums("doorOrWindowSashXAxis"),
            nums("doorOrWindowSashYAxis"),
            nums("doorOrWindowSashWidth"),
        );
        let (ss, es) = (
            nums("doorOrWindowSashStartAngle"),
            nums("doorOrWindowSashEndAngle"),
        );
        for i in 0..xs
            .len()
            .min(ys.len())
            .min(ws.len())
            .min(ss.len())
            .min(es.len())
        {
            sashes.push(Sash {
                x_axis: xs[i] / w,
                y_axis: ys[i] / d,
                width: ws[i] / w,
                start_angle: ss[i].to_radians(),
                end_angle: es[i].to_radians(),
                ..Default::default()
            });
        }
    }
    if kind == PieceKind::Light {
        attrs.power = Some(0.5);
        let (xs, ys, zs) = (
            nums("lightSourceX"),
            nums("lightSourceY"),
            nums("lightSourceZ"),
        );
        let colors: Vec<&str> = x
            .get("lightSourceColor")
            .map(|c| c.split_whitespace().collect())
            .unwrap_or_default();
        let diameters = nums("lightSourceDiameter");
        for i in 0..xs.len().min(ys.len()).min(zs.len()) {
            let color = colors
                .get(i)
                .and_then(|c| u32::from_str_radix(c.trim_start_matches('#'), 16).ok())
                .unwrap_or(0xFFFFFF);
            light_sources.push(LightSource {
                x: xs[i] / w,
                y: ys[i] / d,
                z: zs[i] / h,
                color: Color(color & 0x00FF_FFFF),
                diameter: diameters.get(i).map(|v| v / w),
                ..Default::default()
            });
        }
    }
    // Sweet Home 3D 7: parts of the model with these materials are the light sources
    let light_source_materials = x
        .get("lightSourceMaterialName")
        .map(|v| {
            v.split_whitespace()
                .map(|name| LightSourceMaterial {
                    name: name.to_owned(),
                    ..Default::default()
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(Piece {
        kind,
        attrs,
        sashes,
        light_sources,
        light_source_materials,
        shelves,
        ..Default::default()
    })
}

/// A catalog item is a lamp: it has light source points or (Sweet Home 3D 7) materials of
/// its model that are light sources.
fn is_light_item(extra: &std::collections::BTreeMap<String, String>) -> bool {
    extra.contains_key("lightSourceX") || extra.contains_key("lightSourceMaterialName")
}

/// Depth of a door or window from the catalog (its real depth), if its catalog item is known.
fn catalog_depth(a: &msh_model::PieceAttrs) -> Option<f32> {
    let id = a.catalog_id.as_deref()?;
    CatalogIndex::get()
        .furniture_by_id(id)
        .map(|e| e.item.depth)
}

/// Fits a door or window into a wall. The part `wallThickness` of its depth is the wall: in a
/// wall up to that thick the depth follows the wall thickness and this part lies centered on
/// the wall (like Sweet Home 3D's magnetism). In a thicker wall the piece keeps its real depth
/// (`natural`, else its current depth), so frame and handle are not stretched; it sits flush
/// with the wall side it opens to and the opening goes through the whole wall (a reveal).
/// Its position along the wall stays.
pub(super) fn fit_in_wall(
    a: &mut msh_model::PieceAttrs,
    w: &msh_model::WallAttrs,
    natural: Option<f32>,
) {
    let fraction = a.wall_thickness.unwrap_or(1.0).max(0.01);
    // Wall part center from the wall axis towards the front (local +y) of the piece
    let mut shift = 0.0;
    if a.resizable != Some(false) && a.width_depth_deformable != Some(false) {
        let natural = natural.unwrap_or(a.depth);
        let part = natural * fraction;
        if w.thickness > part + 0.5 {
            a.depth = natural;
            shift = (w.thickness - part) / 2.0;
            a.wall_cut_out_on_both_sides = Some(true);
        } else {
            a.depth = w.thickness / fraction;
        }
    }
    let (dx, dy) = (w.x_end - w.x_start, w.y_end - w.y_start);
    let len = dx.hypot(dy);
    if len < 1e-3 {
        return;
    }
    let (ux, uy) = (dx / len, dy / len);
    let t = (a.x - w.x_start) * ux + (a.y - w.y_start) * uy;
    let (px, py) = (w.x_start + ux * t, w.y_start + uy * t);
    // Middle of the wall part, measured from the piece center towards its front (local +y)
    let wall_part = -a.depth / 2.0 + (a.wall_distance.unwrap_or(0.0) + fraction / 2.0) * a.depth;
    let (s, c) = a.angle_or_default().sin_cos();
    a.x = px + s * (wall_part - shift);
    a.y = py - c * (wall_part - shift);
}

/// Refits the doors and windows standing in walls whose thickness changed (`old` thickness by
/// wall ID): pieces parallel to the wall with their center inside the old wall.
pub(super) fn refit_openings(home: &mut msh_model::Home, old: &[(String, f32)]) {
    for (id, old_thickness) in old {
        let Some(wall) = home
            .walls
            .iter()
            .find(|w| &w.attrs.id == id)
            .map(|w| w.attrs.clone())
        else {
            continue;
        };
        let (dx, dy) = (wall.x_end - wall.x_start, wall.y_end - wall.y_start);
        let len = dx.hypot(dy);
        if len < 1e-3 || wall.arc_extent.is_some_and(|e| e != 0.0) {
            continue;
        }
        let (ux, uy) = (dx / len, dy / len);
        let wall_angle = dy.atan2(dx);
        fn walk(
            items: &mut [Furniture],
            wall: &msh_model::WallAttrs,
            u: (f32, f32),
            len: f32,
            wall_angle: f32,
            old_thickness: f32,
        ) {
            for item in items {
                match item {
                    Furniture::Group(g) => {
                        walk(&mut g.items, wall, u, len, wall_angle, old_thickness)
                    }
                    Furniture::Piece(p) => {
                        let a = &mut p.attrs;
                        if p.kind != PieceKind::DoorOrWindow
                            || a.level != wall.level
                            || a.bound_to_wall == Some(false)
                        {
                            continue;
                        }
                        let diff =
                            (a.angle_or_default() - wall_angle).rem_euclid(std::f32::consts::PI);
                        let parallel = diff < 0.02 || diff > std::f32::consts::PI - 0.02;
                        let (rx, ry) = (a.x - wall.x_start, a.y - wall.y_start);
                        let t = rx * u.0 + ry * u.1;
                        let across = (rx * -u.1 + ry * u.0).abs();
                        if parallel
                            && (0.0..=len).contains(&t)
                            && across <= old_thickness / 2.0 + 0.5
                        {
                            let natural = catalog_depth(a);
                            fit_in_wall(a, wall, natural);
                        }
                    }
                }
            }
        }
        walk(
            &mut home.furniture,
            &wall,
            (ux, uy),
            len,
            wall_angle,
            *old_thickness,
        );
    }
}
