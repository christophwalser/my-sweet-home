//! Mapping between the XML tree of `Home.xml` and the model.
//!
//! Reading: known child elements go into the typed fields, everything else
//! into `extra_children`. Writing: child elements in the order of the
//! Sweet Home 3D 7.x DTD, unknown ones last.

use crate::FormatError;
use msh_model::*;

type R<T> = Result<T, FormatError>;

// ================================================================ Reading

/// Reads the root element `<home>`.
pub fn read_home(root: RawElement) -> R<Home> {
    if root.name != "home" {
        return Err(FormatError::Structure(format!(
            "root element is <{}> instead of <home>",
            root.name
        )));
    }
    let mut h = Home {
        attrs: attrs(&root.name, root.attrs, HomeAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(root.children) {
        match c.name.as_str() {
            "property" => push_leaf(
                c,
                &mut h.properties,
                &mut h.extra_children,
                Property::from_attrs,
            )?,
            "furnitureVisibleProperty" => {
                let mut a = c.attrs;
                match a.take("name") {
                    Some(n) if a.is_empty() => h.furniture_visible_properties.push(n),
                    _ => h.extra_children.push(RawElement {
                        name: c.name,
                        attrs: a,
                        children: c.children,
                    }),
                }
            }
            "environment" => h.environment = Some(read_environment(c)?),
            "backgroundImage" => {
                h.background_image = leaf(c, &mut h.extra_children, BackgroundImage::from_attrs)?
            }
            "print" => h.print = Some(read_print(c)?),
            "compass" => h.compass = Some(read_compass(c)?),
            "camera" | "observerCamera" => h.cameras.push(read_camera(c)?),
            "level" => h.levels.push(read_level(c)?),
            "pieceOfFurniture" | "doorOrWindow" | "light" | "shelfUnit" | "furnitureGroup" => {
                h.furniture.push(read_furniture(c)?)
            }
            "wall" => h.walls.push(read_wall(c)?),
            "room" => h.rooms.push(read_room(c)?),
            "polyline" => h.polylines.push(read_polyline(c)?),
            "dimensionLine" => h.dimension_lines.push(read_dimension_line(c)?),
            "label" => h.labels.push(read_label(c)?),
            _ => h.extra_children.push(c),
        }
    }
    Ok(h)
}

fn elements(children: Vec<RawNode>) -> impl Iterator<Item = RawElement> {
    children.into_iter().filter_map(|c| match c {
        RawNode::Element(e) => Some(e),
        RawNode::Text(_) => None,
    })
}

fn has_child_elements(el: &RawElement) -> bool {
    el.children.iter().any(|c| matches!(c, RawNode::Element(_)))
}

fn attrs<T>(element: &str, a: Attrs, f: fn(Attrs) -> Result<T, AttrError>) -> R<T> {
    f(a).map_err(|source| FormatError::Attr {
        element: element.to_owned(),
        source,
    })
}

/// Reads an element without child elements. If it has some anyway, it is kept
/// unchanged in `extra`, so that nothing gets lost.
fn leaf<T>(
    el: RawElement,
    extra: &mut Vec<RawElement>,
    f: fn(Attrs) -> Result<T, AttrError>,
) -> R<Option<T>> {
    if has_child_elements(&el) {
        extra.push(el);
        return Ok(None);
    }
    attrs(&el.name, el.attrs, f).map(Some)
}

fn push_leaf<T>(
    el: RawElement,
    list: &mut Vec<T>,
    extra: &mut Vec<RawElement>,
    f: fn(Attrs) -> Result<T, AttrError>,
) -> R<()> {
    if let Some(v) = leaf(el, extra, f)? {
        list.push(v);
    }
    Ok(())
}

fn read_environment(el: RawElement) -> R<Environment> {
    let mut e = Environment {
        attrs: attrs(&el.name, el.attrs, EnvironmentAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        match c.name.as_str() {
            "property" => push_leaf(
                c,
                &mut e.properties,
                &mut e.extra_children,
                Property::from_attrs,
            )?,
            "camera" | "observerCamera" => e.cameras.push(read_camera(c)?),
            "texture" => push_leaf(
                c,
                &mut e.textures,
                &mut e.extra_children,
                Texture::from_attrs,
            )?,
            _ => e.extra_children.push(c),
        }
    }
    Ok(e)
}

fn read_print(el: RawElement) -> R<Print> {
    let mut p = Print {
        attrs: attrs(&el.name, el.attrs, PrintAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        if c.name == "printedLevel" && !has_child_elements(&c) && c.attrs.0.len() == 1 {
            let mut a = c.attrs;
            if let Some(level) = a.take("level") {
                p.printed_levels.push(level);
                continue;
            }
            p.extra_children.push(RawElement {
                name: c.name,
                attrs: a,
                children: c.children,
            });
        } else {
            p.extra_children.push(c);
        }
    }
    Ok(p)
}

fn read_compass(el: RawElement) -> R<Compass> {
    let mut c = Compass {
        attrs: attrs(&el.name, el.attrs, CompassAttrs::from_attrs)?,
        ..Default::default()
    };
    for ch in elements(el.children) {
        match ch.name.as_str() {
            "property" => push_leaf(
                ch,
                &mut c.properties,
                &mut c.extra_children,
                Property::from_attrs,
            )?,
            _ => c.extra_children.push(ch),
        }
    }
    Ok(c)
}

fn read_camera(el: RawElement) -> R<Camera> {
    let mut c = Camera {
        observer: el.name == "observerCamera",
        attrs: attrs(&el.name, el.attrs, CameraAttrs::from_attrs)?,
        ..Default::default()
    };
    for ch in elements(el.children) {
        match ch.name.as_str() {
            "property" => push_leaf(
                ch,
                &mut c.properties,
                &mut c.extra_children,
                Property::from_attrs,
            )?,
            _ => c.extra_children.push(ch),
        }
    }
    Ok(c)
}

fn read_level(el: RawElement) -> R<Level> {
    let mut l = Level {
        attrs: attrs(&el.name, el.attrs, LevelAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        match c.name.as_str() {
            "property" => push_leaf(
                c,
                &mut l.properties,
                &mut l.extra_children,
                Property::from_attrs,
            )?,
            "backgroundImage" => {
                l.background_image = leaf(c, &mut l.extra_children, BackgroundImage::from_attrs)?
            }
            _ => l.extra_children.push(c),
        }
    }
    Ok(l)
}

fn read_furniture(el: RawElement) -> R<Furniture> {
    if el.name == "furnitureGroup" {
        let mut g = FurnitureGroup {
            attrs: attrs(&el.name, el.attrs, GroupAttrs::from_attrs)?,
            ..Default::default()
        };
        for c in elements(el.children) {
            match c.name.as_str() {
                "pieceOfFurniture" | "doorOrWindow" | "light" | "shelfUnit" | "furnitureGroup" => {
                    g.items.push(read_furniture(c)?)
                }
                "property" => push_leaf(
                    c,
                    &mut g.properties,
                    &mut g.extra_children,
                    Property::from_attrs,
                )?,
                "textStyle" => {
                    g.text_style = leaf(c, &mut g.extra_children, TextStyle::from_attrs)?
                }
                _ => g.extra_children.push(c),
            }
        }
        return Ok(Furniture::Group(Box::new(g)));
    }

    let kind = PieceKind::from_element_name(&el.name).ok_or_else(|| {
        FormatError::Structure(format!("unknown furniture element <{}>", el.name))
    })?;
    let mut p = Piece {
        kind,
        attrs: attrs(&el.name, el.attrs, PieceAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        match c.name.as_str() {
            "sash" => push_leaf(c, &mut p.sashes, &mut p.extra_children, Sash::from_attrs)?,
            "lightSource" => push_leaf(
                c,
                &mut p.light_sources,
                &mut p.extra_children,
                LightSource::from_attrs,
            )?,
            "lightSourceMaterial" => push_leaf(
                c,
                &mut p.light_source_materials,
                &mut p.extra_children,
                LightSourceMaterial::from_attrs,
            )?,
            "shelf" => push_leaf(c, &mut p.shelves, &mut p.extra_children, Shelf::from_attrs)?,
            "property" => push_leaf(
                c,
                &mut p.properties,
                &mut p.extra_children,
                Property::from_attrs,
            )?,
            "textStyle" => p.text_style = leaf(c, &mut p.extra_children, TextStyle::from_attrs)?,
            "texture" => p.texture = leaf(c, &mut p.extra_children, Texture::from_attrs)?,
            "material" => p.materials.push(read_material(c)?),
            "transformation" => push_leaf(
                c,
                &mut p.transformations,
                &mut p.extra_children,
                Transformation::from_attrs,
            )?,
            _ => p.extra_children.push(c),
        }
    }
    Ok(Furniture::Piece(Box::new(p)))
}

fn read_material(el: RawElement) -> R<Material> {
    let mut m = Material {
        attrs: attrs(&el.name, el.attrs, MaterialAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        match c.name.as_str() {
            "texture" => m.texture = leaf(c, &mut m.extra_children, Texture::from_attrs)?,
            _ => m.extra_children.push(c),
        }
    }
    Ok(m)
}

fn read_wall(el: RawElement) -> R<Wall> {
    let mut w = Wall {
        attrs: attrs(&el.name, el.attrs, WallAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        match c.name.as_str() {
            "property" => push_leaf(
                c,
                &mut w.properties,
                &mut w.extra_children,
                Property::from_attrs,
            )?,
            "texture" => push_leaf(
                c,
                &mut w.textures,
                &mut w.extra_children,
                Texture::from_attrs,
            )?,
            "baseboard" => {
                let mut b = Baseboard {
                    attrs: attrs(&c.name, c.attrs, BaseboardAttrs::from_attrs)?,
                    ..Default::default()
                };
                for t in elements(c.children) {
                    match t.name.as_str() {
                        "texture" => {
                            b.texture = leaf(t, &mut b.extra_children, Texture::from_attrs)?
                        }
                        _ => b.extra_children.push(t),
                    }
                }
                w.baseboards.push(b);
            }
            _ => w.extra_children.push(c),
        }
    }
    Ok(w)
}

fn read_room(el: RawElement) -> R<Room> {
    let mut r = Room {
        attrs: attrs(&el.name, el.attrs, RoomAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        match c.name.as_str() {
            "property" => push_leaf(
                c,
                &mut r.properties,
                &mut r.extra_children,
                Property::from_attrs,
            )?,
            "textStyle" => push_leaf(
                c,
                &mut r.text_styles,
                &mut r.extra_children,
                TextStyle::from_attrs,
            )?,
            "texture" => push_leaf(
                c,
                &mut r.textures,
                &mut r.extra_children,
                Texture::from_attrs,
            )?,
            "point" => push_leaf(c, &mut r.points, &mut r.extra_children, Point::from_attrs)?,
            _ => r.extra_children.push(c),
        }
    }
    Ok(r)
}

fn read_polyline(el: RawElement) -> R<Polyline> {
    let mut p = Polyline {
        attrs: attrs(&el.name, el.attrs, PolylineAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        match c.name.as_str() {
            "property" => push_leaf(
                c,
                &mut p.properties,
                &mut p.extra_children,
                Property::from_attrs,
            )?,
            "point" => push_leaf(c, &mut p.points, &mut p.extra_children, Point::from_attrs)?,
            _ => p.extra_children.push(c),
        }
    }
    Ok(p)
}

fn read_dimension_line(el: RawElement) -> R<DimensionLine> {
    let mut d = DimensionLine {
        attrs: attrs(&el.name, el.attrs, DimensionLineAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        match c.name.as_str() {
            "property" => push_leaf(
                c,
                &mut d.properties,
                &mut d.extra_children,
                Property::from_attrs,
            )?,
            "textStyle" => d.text_style = leaf(c, &mut d.extra_children, TextStyle::from_attrs)?,
            _ => d.extra_children.push(c),
        }
    }
    Ok(d)
}

fn read_label(el: RawElement) -> R<Label> {
    let mut l = Label {
        attrs: attrs(&el.name, el.attrs, LabelAttrs::from_attrs)?,
        ..Default::default()
    };
    for c in elements(el.children) {
        match c.name.as_str() {
            "property" => push_leaf(
                c,
                &mut l.properties,
                &mut l.extra_children,
                Property::from_attrs,
            )?,
            "textStyle" => l.text_style = leaf(c, &mut l.extra_children, TextStyle::from_attrs)?,
            "text" if !has_child_elements(&c) => {
                l.text = c
                    .children
                    .into_iter()
                    .filter_map(|n| match n {
                        RawNode::Text(t) => Some(t),
                        RawNode::Element(_) => None,
                    })
                    .collect();
            }
            _ => l.extra_children.push(c),
        }
    }
    Ok(l)
}

// ================================================================ Writing

/// Creates the root element `<home>`.
pub fn write_home(h: &Home) -> RawElement {
    let mut ch = Vec::new();
    ch.extend(
        h.properties
            .iter()
            .map(|p| leaf_el("property", p.to_attrs())),
    );
    for name in &h.furniture_visible_properties {
        let mut a = Attrs::new();
        a.push("name", name.clone());
        ch.push(leaf_el("furnitureVisibleProperty", a));
    }
    if let Some(e) = &h.environment {
        ch.push(write_environment(e));
    }
    if let Some(b) = &h.background_image {
        ch.push(leaf_el("backgroundImage", b.to_attrs()));
    }
    if let Some(p) = &h.print {
        ch.push(write_print(p));
    }
    if let Some(c) = &h.compass {
        let mut cc: Vec<RawElement> = props(&c.properties);
        cc.extend(c.extra_children.iter().cloned());
        ch.push(el("compass", c.attrs.to_attrs(), cc));
    }
    ch.extend(h.cameras.iter().map(write_camera));
    ch.extend(h.levels.iter().map(write_level));
    ch.extend(h.furniture.iter().map(write_furniture));
    ch.extend(h.walls.iter().map(write_wall));
    ch.extend(h.rooms.iter().map(write_room));
    ch.extend(h.polylines.iter().map(write_polyline));
    ch.extend(h.dimension_lines.iter().map(write_dimension_line));
    ch.extend(h.labels.iter().map(write_label));
    ch.extend(h.extra_children.iter().cloned());
    el("home", h.attrs.to_attrs(), ch)
}

fn el(name: &str, attrs: Attrs, children: Vec<RawElement>) -> RawElement {
    RawElement {
        name: name.to_owned(),
        attrs,
        children: children.into_iter().map(RawNode::Element).collect(),
    }
}

fn leaf_el(name: &str, attrs: Attrs) -> RawElement {
    el(name, attrs, Vec::new())
}

fn props(p: &[Property]) -> Vec<RawElement> {
    p.iter()
        .map(|p| leaf_el("property", p.to_attrs()))
        .collect()
}

fn write_environment(e: &Environment) -> RawElement {
    let mut ch = props(&e.properties);
    ch.extend(e.cameras.iter().map(write_camera));
    ch.extend(e.textures.iter().map(|t| leaf_el("texture", t.to_attrs())));
    ch.extend(e.extra_children.iter().cloned());
    el("environment", e.attrs.to_attrs(), ch)
}

fn write_print(p: &Print) -> RawElement {
    let mut ch: Vec<RawElement> = p
        .printed_levels
        .iter()
        .map(|l| {
            let mut a = Attrs::new();
            a.push("level", l.clone());
            leaf_el("printedLevel", a)
        })
        .collect();
    ch.extend(p.extra_children.iter().cloned());
    el("print", p.attrs.to_attrs(), ch)
}

fn write_camera(c: &Camera) -> RawElement {
    let mut ch = props(&c.properties);
    ch.extend(c.extra_children.iter().cloned());
    el(
        if c.observer {
            "observerCamera"
        } else {
            "camera"
        },
        c.attrs.to_attrs(),
        ch,
    )
}

fn write_level(l: &Level) -> RawElement {
    let mut ch = props(&l.properties);
    if let Some(b) = &l.background_image {
        ch.push(leaf_el("backgroundImage", b.to_attrs()));
    }
    ch.extend(l.extra_children.iter().cloned());
    el("level", l.attrs.to_attrs(), ch)
}

fn write_furniture(f: &Furniture) -> RawElement {
    match f {
        Furniture::Group(g) => {
            let mut ch: Vec<RawElement> = g.items.iter().map(write_furniture).collect();
            ch.extend(props(&g.properties));
            if let Some(t) = &g.text_style {
                ch.push(leaf_el("textStyle", t.to_attrs()));
            }
            ch.extend(g.extra_children.iter().cloned());
            el("furnitureGroup", g.attrs.to_attrs(), ch)
        }
        Furniture::Piece(p) => {
            let mut ch: Vec<RawElement> = Vec::new();
            ch.extend(p.sashes.iter().map(|s| leaf_el("sash", s.to_attrs())));
            ch.extend(
                p.light_sources
                    .iter()
                    .map(|s| leaf_el("lightSource", s.to_attrs())),
            );
            ch.extend(
                p.light_source_materials
                    .iter()
                    .map(|s| leaf_el("lightSourceMaterial", s.to_attrs())),
            );
            ch.extend(p.shelves.iter().map(|s| leaf_el("shelf", s.to_attrs())));
            ch.extend(props(&p.properties));
            if let Some(t) = &p.text_style {
                ch.push(leaf_el("textStyle", t.to_attrs()));
            }
            if let Some(t) = &p.texture {
                ch.push(leaf_el("texture", t.to_attrs()));
            }
            ch.extend(p.materials.iter().map(write_material));
            ch.extend(
                p.transformations
                    .iter()
                    .map(|t| leaf_el("transformation", t.to_attrs())),
            );
            ch.extend(p.extra_children.iter().cloned());
            el(p.kind.element_name(), p.attrs.to_attrs(), ch)
        }
    }
}

fn write_material(m: &Material) -> RawElement {
    let mut ch = Vec::new();
    if let Some(t) = &m.texture {
        ch.push(leaf_el("texture", t.to_attrs()));
    }
    ch.extend(m.extra_children.iter().cloned());
    el("material", m.attrs.to_attrs(), ch)
}

fn write_wall(w: &Wall) -> RawElement {
    let mut ch = props(&w.properties);
    ch.extend(w.textures.iter().map(|t| leaf_el("texture", t.to_attrs())));
    for b in &w.baseboards {
        let mut bc = Vec::new();
        if let Some(t) = &b.texture {
            bc.push(leaf_el("texture", t.to_attrs()));
        }
        bc.extend(b.extra_children.iter().cloned());
        ch.push(el("baseboard", b.attrs.to_attrs(), bc));
    }
    ch.extend(w.extra_children.iter().cloned());
    el("wall", w.attrs.to_attrs(), ch)
}

fn write_room(r: &Room) -> RawElement {
    let mut ch = props(&r.properties);
    ch.extend(
        r.text_styles
            .iter()
            .map(|t| leaf_el("textStyle", t.to_attrs())),
    );
    ch.extend(r.textures.iter().map(|t| leaf_el("texture", t.to_attrs())));
    ch.extend(r.points.iter().map(|p| leaf_el("point", p.to_attrs())));
    ch.extend(r.extra_children.iter().cloned());
    el("room", r.attrs.to_attrs(), ch)
}

fn write_polyline(p: &Polyline) -> RawElement {
    let mut ch = props(&p.properties);
    ch.extend(p.points.iter().map(|pt| leaf_el("point", pt.to_attrs())));
    ch.extend(p.extra_children.iter().cloned());
    el("polyline", p.attrs.to_attrs(), ch)
}

fn write_dimension_line(d: &DimensionLine) -> RawElement {
    let mut ch = props(&d.properties);
    if let Some(t) = &d.text_style {
        ch.push(leaf_el("textStyle", t.to_attrs()));
    }
    ch.extend(d.extra_children.iter().cloned());
    el("dimensionLine", d.attrs.to_attrs(), ch)
}

fn write_label(l: &Label) -> RawElement {
    let mut ch = props(&l.properties);
    if let Some(t) = &l.text_style {
        ch.push(leaf_el("textStyle", t.to_attrs()));
    }
    ch.push(RawElement {
        name: "text".into(),
        attrs: Attrs::new(),
        children: vec![RawNode::Text(l.text.clone())],
    });
    ch.extend(l.extra_children.iter().cloned());
    el("label", l.attrs.to_attrs(), ch)
}
