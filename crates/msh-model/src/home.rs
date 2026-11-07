//! The project (`Home`) and all of its elements.
//!
//! The structs mirror the XML format of Sweet Home 3D 7.x (`Home.xml`, DTD in
//! the Javadoc of `HomeXMLHandler`) 1:1. Lengths are in centimeters, angles in
//! radians, colors in ARGB. Optional attributes are `Option`, so that saving
//! writes exactly what was read.

use crate::attrs::{Color, attr_struct};
use serde::{Deserialize, Serialize};

/// An element the model does not know. It is written back unchanged on save.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct RawElement {
    pub name: String,
    pub attrs: crate::attrs::Attrs,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<RawNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RawNode {
    Element(RawElement),
    Text(String),
}

// ---------------------------------------------------------------- Home

attr_struct! {
    pub struct HomeAttrs {
        version: Option<i64> => "version",
        name: Option<String> => "name",
        /// `topCamera` or `observerCamera`
        camera: Option<String> => "camera",
        selected_level: Option<String> => "selectedLevel",
        wall_height: Option<f32> => "wallHeight",
        base_plan_locked: Option<bool> => "basePlanLocked",
        furniture_sorted_property: Option<String> => "furnitureSortedProperty",
        furniture_descending_sorted: Option<bool> => "furnitureDescendingSorted",
    }
}

/// A complete project.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Home {
    pub attrs: HomeAttrs,
    pub properties: Vec<Property>,
    pub furniture_visible_properties: Vec<String>,
    pub environment: Option<Environment>,
    pub background_image: Option<BackgroundImage>,
    pub print: Option<Print>,
    pub compass: Option<Compass>,
    pub cameras: Vec<Camera>,
    pub levels: Vec<Level>,
    pub furniture: Vec<Furniture>,
    pub walls: Vec<Wall>,
    pub rooms: Vec<Room>,
    pub polylines: Vec<Polyline>,
    pub dimension_lines: Vec<DimensionLine>,
    pub labels: Vec<Label>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

impl Home {
    /// Calls `f` for every piece of furniture, including pieces inside groups.
    pub fn for_each_piece<'a>(&'a self, mut f: impl FnMut(&'a Piece)) {
        fn walk<'a>(items: &'a [Furniture], f: &mut impl FnMut(&'a Piece)) {
            for item in items {
                match item {
                    Furniture::Piece(p) => f(p),
                    Furniture::Group(g) => walk(&g.items, f),
                }
            }
        }
        walk(&self.furniture, &mut f);
    }

    /// Number of pieces of furniture (groups are expanded).
    pub fn piece_count(&self) -> usize {
        let mut n = 0;
        self.for_each_piece(|_| n += 1);
        n
    }
}

attr_struct! {
    pub struct Property {
        name: String => "name",
        value: String => "value",
        /// `STRING` (default) or `CONTENT`
        kind: Option<String> => "type",
    }
}

attr_struct! {
    pub struct EnvironmentAttrs {
        ground_color: Option<Color> => "groundColor",
        background_image_visible_on_ground_3d: Option<bool> => "backgroundImageVisibleOnGround3D",
        sky_color: Option<Color> => "skyColor",
        light_color: Option<Color> => "lightColor",
        walls_alpha: Option<f32> => "wallsAlpha",
        all_levels_visible: Option<bool> => "allLevelsVisible",
        observer_camera_elevation_adjusted: Option<bool> => "observerCameraElevationAdjusted",
        /// Spelled with a double "l", as in the original format
        ceiling_light_color: Option<Color> => "ceillingLightColor",
        drawing_mode: Option<String> => "drawingMode",
        subpart_size_under_light: Option<f32> => "subpartSizeUnderLight",
        photo_width: Option<i64> => "photoWidth",
        photo_height: Option<i64> => "photoHeight",
        photo_aspect_ratio: Option<String> => "photoAspectRatio",
        photo_quality: Option<i64> => "photoQuality",
        video_width: Option<i64> => "videoWidth",
        video_aspect_ratio: Option<String> => "videoAspectRatio",
        video_quality: Option<i64> => "videoQuality",
        video_speed: Option<f32> => "videoSpeed",
        video_frame_rate: Option<i64> => "videoFrameRate",
    }
}

/// Environment (ground, sky, light, photo and video settings).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Environment {
    pub attrs: EnvironmentAttrs,
    pub properties: Vec<Property>,
    /// Camera path for videos
    pub cameras: Vec<Camera>,
    /// `groundTexture` and/or `skyTexture`
    pub textures: Vec<Texture>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

attr_struct! {
    pub struct BackgroundImage {
        image: String => "image",
        scale_distance: f32 => "scaleDistance",
        scale_distance_x_start: f32 => "scaleDistanceXStart",
        scale_distance_y_start: f32 => "scaleDistanceYStart",
        scale_distance_x_end: f32 => "scaleDistanceXEnd",
        scale_distance_y_end: f32 => "scaleDistanceYEnd",
        x_origin: Option<f32> => "xOrigin",
        y_origin: Option<f32> => "yOrigin",
        visible: Option<bool> => "visible",
    }
}

attr_struct! {
    pub struct PrintAttrs {
        header_format: Option<String> => "headerFormat",
        footer_format: Option<String> => "footerFormat",
        plan_scale: Option<f32> => "planScale",
        furniture_printed: Option<bool> => "furniturePrinted",
        plan_printed: Option<bool> => "planPrinted",
        view_3d_printed: Option<bool> => "view3DPrinted",
        paper_width: f32 => "paperWidth",
        paper_height: f32 => "paperHeight",
        paper_top_margin: f32 => "paperTopMargin",
        paper_left_margin: f32 => "paperLeftMargin",
        paper_bottom_margin: f32 => "paperBottomMargin",
        paper_right_margin: f32 => "paperRightMargin",
        paper_orientation: String => "paperOrientation",
    }
}

/// Print settings.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Print {
    pub attrs: PrintAttrs,
    /// IDs of the printed levels
    pub printed_levels: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

attr_struct! {
    pub struct CompassAttrs {
        x: f32 => "x",
        y: f32 => "y",
        diameter: f32 => "diameter",
        north_direction: Option<f32> => "northDirection",
        longitude: Option<f32> => "longitude",
        latitude: Option<f32> => "latitude",
        time_zone: Option<String> => "timeZone",
        visible: Option<bool> => "visible",
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Compass {
    pub attrs: CompassAttrs,
    pub properties: Vec<Property>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

// ---------------------------------------------------------------- Cameras

attr_struct! {
    pub struct CameraAttrs {
        id: Option<String> => "id",
        /// `topCamera`, `observerCamera`, `storedCamera` or `cameraPath`
        role: String => "attribute",
        name: Option<String> => "name",
        lens: Option<String> => "lens",
        x: f32 => "x",
        y: f32 => "y",
        z: f32 => "z",
        yaw: f32 => "yaw",
        pitch: f32 => "pitch",
        time: Option<i64> => "time",
        field_of_view: f32 => "fieldOfView",
        renderer: Option<String> => "renderer",
        /// only for `observerCamera`
        fixed_size: Option<bool> => "fixedSize",
    }
}

/// Camera (top view) or observer (virtual visitor).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Camera {
    /// `true` for the `observerCamera` element, otherwise `camera`
    pub observer: bool,
    pub attrs: CameraAttrs,
    pub properties: Vec<Property>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

// ---------------------------------------------------------------- Levels

attr_struct! {
    pub struct LevelAttrs {
        id: String => "id",
        name: String => "name",
        elevation: f32 => "elevation",
        floor_thickness: f32 => "floorThickness",
        height: f32 => "height",
        elevation_index: Option<i64> => "elevationIndex",
        visible: Option<bool> => "visible",
        viewable: Option<bool> => "viewable",
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Level {
    pub attrs: LevelAttrs,
    pub properties: Vec<Property>,
    pub background_image: Option<BackgroundImage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

// ---------------------------------------------------------------- Furniture

/// Kind of piece of furniture (= XML element name).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum PieceKind {
    #[default]
    Piece,
    DoorOrWindow,
    Light,
    ShelfUnit,
}

impl PieceKind {
    pub fn element_name(self) -> &'static str {
        match self {
            PieceKind::Piece => "pieceOfFurniture",
            PieceKind::DoorOrWindow => "doorOrWindow",
            PieceKind::Light => "light",
            PieceKind::ShelfUnit => "shelfUnit",
        }
    }

    pub fn from_element_name(name: &str) -> Option<Self> {
        Some(match name {
            "pieceOfFurniture" => PieceKind::Piece,
            "doorOrWindow" => PieceKind::DoorOrWindow,
            "light" => PieceKind::Light,
            "shelfUnit" => PieceKind::ShelfUnit,
            _ => return None,
        })
    }
}

attr_struct! {
    /// Attributes of all furniture kinds. Which ones occur depends on [`PieceKind`].
    pub struct PieceAttrs {
        // furnitureCommonAttributes
        id: Option<String> => "id",
        level: Option<String> => "level",
        catalog_id: Option<String> => "catalogId",
        name: String => "name",
        creator: Option<String> => "creator",
        model: Option<String> => "model",
        icon: Option<String> => "icon",
        plan_icon: Option<String> => "planIcon",
        x: f32 => "x",
        y: f32 => "y",
        elevation: Option<f32> => "elevation",
        angle: Option<f32> => "angle",
        pitch: Option<f32> => "pitch",
        roll: Option<f32> => "roll",
        horizontally_rotatable: Option<bool> => "horizontallyRotatable",
        width: f32 => "width",
        width_in_plan: Option<f32> => "widthInPlan",
        depth: f32 => "depth",
        depth_in_plan: Option<f32> => "depthInPlan",
        height: f32 => "height",
        height_in_plan: Option<f32> => "heightInPlan",
        model_size: Option<i64> => "modelSize",
        visible: Option<bool> => "visible",
        movable: Option<bool> => "movable",
        description: Option<String> => "description",
        information: Option<String> => "information",
        license: Option<String> => "license",
        model_mirrored: Option<bool> => "modelMirrored",
        name_visible: Option<bool> => "nameVisible",
        name_angle: Option<f32> => "nameAngle",
        name_x_offset: Option<f32> => "nameXOffset",
        name_y_offset: Option<f32> => "nameYOffset",
        price: Option<String> => "price",
        // pieceOfFurnitureCommonAttributes
        drop_on_top_elevation: Option<f32> => "dropOnTopElevation",
        /// 3x3 matrix, 9 space-separated numbers
        model_rotation: Option<String> => "modelRotation",
        model_centered_at_origin: Option<bool> => "modelCenteredAtOrigin",
        back_face_shown: Option<bool> => "backFaceShown",
        model_flags: Option<i64> => "modelFlags",
        door_or_window: Option<bool> => "doorOrWindow",
        resizable: Option<bool> => "resizable",
        deformable: Option<bool> => "deformable",
        texturable: Option<bool> => "texturable",
        staircase_cut_out_shape: Option<String> => "staircaseCutOutShape",
        color: Option<Color> => "color",
        shininess: Option<f32> => "shininess",
        value_added_tax_percentage: Option<String> => "valueAddedTaxPercentage",
        currency: Option<String> => "currency",
        // doorOrWindow
        wall_thickness: Option<f32> => "wallThickness",
        wall_distance: Option<f32> => "wallDistance",
        wall_width: Option<f32> => "wallWidth",
        wall_left: Option<f32> => "wallLeft",
        wall_height: Option<f32> => "wallHeight",
        wall_top: Option<f32> => "wallTop",
        /// SVG path of the wall cut-out
        cut_out_shape: Option<String> => "cutOutShape",
        wall_cut_out_on_both_sides: Option<bool> => "wallCutOutOnBothSides",
        width_depth_deformable: Option<bool> => "widthDepthDeformable",
        bound_to_wall: Option<bool> => "boundToWall",
        // light
        power: Option<f32> => "power",
    }
}

impl PieceAttrs {
    pub fn elevation_or_default(&self) -> f32 {
        self.elevation.unwrap_or(0.0)
    }
    pub fn angle_or_default(&self) -> f32 {
        self.angle.unwrap_or(0.0)
    }
    pub fn is_visible(&self) -> bool {
        self.visible.unwrap_or(true)
    }
}

/// A piece of furniture, a door or window, a light or a shelf unit.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Piece {
    pub kind: PieceKind,
    pub attrs: PieceAttrs,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sashes: Vec<Sash>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub light_sources: Vec<LightSource>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub light_source_materials: Vec<LightSourceMaterial>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shelves: Vec<Shelf>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    pub text_style: Option<TextStyle>,
    pub texture: Option<Texture>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub materials: Vec<Material>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transformations: Vec<Transformation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

attr_struct! {
    pub struct GroupAttrs {
        id: Option<String> => "id",
        level: Option<String> => "level",
        name: String => "name",
        x: Option<f32> => "x",
        y: Option<f32> => "y",
        elevation: Option<f32> => "elevation",
        angle: Option<f32> => "angle",
        width: Option<f32> => "width",
        depth: Option<f32> => "depth",
        height: Option<f32> => "height",
        drop_on_top_elevation: Option<f32> => "dropOnTopElevation",
        visible: Option<bool> => "visible",
        movable: Option<bool> => "movable",
        description: Option<String> => "description",
        information: Option<String> => "information",
        license: Option<String> => "license",
        creator: Option<String> => "creator",
        model_mirrored: Option<bool> => "modelMirrored",
        name_visible: Option<bool> => "nameVisible",
        name_angle: Option<f32> => "nameAngle",
        name_x_offset: Option<f32> => "nameXOffset",
        name_y_offset: Option<f32> => "nameYOffset",
        price: Option<String> => "price",
    }
}

/// A furniture group.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct FurnitureGroup {
    pub attrs: GroupAttrs,
    pub items: Vec<Furniture>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    pub text_style: Option<TextStyle>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Furniture {
    Piece(Box<Piece>),
    Group(Box<FurnitureGroup>),
}

attr_struct! {
    pub struct Sash {
        x_axis: f32 => "xAxis",
        y_axis: f32 => "yAxis",
        width: f32 => "width",
        start_angle: f32 => "startAngle",
        end_angle: f32 => "endAngle",
    }
}

attr_struct! {
    pub struct LightSource {
        x: f32 => "x",
        y: f32 => "y",
        z: f32 => "z",
        color: Color => "color",
        diameter: Option<f32> => "diameter",
    }
}

attr_struct! {
    pub struct LightSourceMaterial {
        name: String => "name",
    }
}

attr_struct! {
    pub struct Shelf {
        elevation: Option<f32> => "elevation",
        x_lower: Option<f32> => "xLower",
        y_lower: Option<f32> => "yLower",
        z_lower: Option<f32> => "zLower",
        x_upper: Option<f32> => "xUpper",
        y_upper: Option<f32> => "yUpper",
        z_upper: Option<f32> => "zUpper",
    }
}

attr_struct! {
    pub struct TextStyle {
        /// `nameStyle`, `areaStyle` or `lengthStyle`
        role: Option<String> => "attribute",
        font_name: Option<String> => "fontName",
        font_size: f32 => "fontSize",
        bold: Option<bool> => "bold",
        italic: Option<bool> => "italic",
        alignment: Option<String> => "alignment",
    }
}

attr_struct! {
    pub struct Texture {
        /// e.g. `floorTexture`, `leftSideTexture`, `groundTexture`
        role: Option<String> => "attribute",
        catalog_id: Option<String> => "catalogId",
        name: String => "name",
        creator: Option<String> => "creator",
        width: f32 => "width",
        height: f32 => "height",
        x_offset: Option<f32> => "xOffset",
        y_offset: Option<f32> => "yOffset",
        angle: Option<f32> => "angle",
        scale: Option<f32> => "scale",
        fitting_area: Option<bool> => "fittingArea",
        left_to_right_oriented: Option<bool> => "leftToRightOriented",
        image: String => "image",
    }
}

attr_struct! {
    pub struct MaterialAttrs {
        name: String => "name",
        key: Option<String> => "key",
        color: Option<Color> => "color",
        shininess: Option<f32> => "shininess",
    }
}

/// Modified material of a 3D model.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Material {
    pub attrs: MaterialAttrs,
    pub texture: Option<Texture>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

attr_struct! {
    pub struct Transformation {
        name: String => "name",
        /// 3x4 matrix, 12 space-separated numbers
        matrix: String => "matrix",
    }
}

// ---------------------------------------------------------------- Walls

attr_struct! {
    pub struct WallAttrs {
        id: String => "id",
        level: Option<String> => "level",
        wall_at_start: Option<String> => "wallAtStart",
        wall_at_end: Option<String> => "wallAtEnd",
        x_start: f32 => "xStart",
        y_start: f32 => "yStart",
        x_end: f32 => "xEnd",
        y_end: f32 => "yEnd",
        height: Option<f32> => "height",
        height_at_end: Option<f32> => "heightAtEnd",
        thickness: f32 => "thickness",
        arc_extent: Option<f32> => "arcExtent",
        pattern: Option<String> => "pattern",
        top_color: Option<Color> => "topColor",
        left_side_color: Option<Color> => "leftSideColor",
        left_side_shininess: Option<f32> => "leftSideShininess",
        right_side_color: Option<Color> => "rightSideColor",
        right_side_shininess: Option<f32> => "rightSideShininess",
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Wall {
    pub attrs: WallAttrs,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    /// `leftSideTexture` and/or `rightSideTexture`
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub textures: Vec<Texture>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub baseboards: Vec<Baseboard>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

impl Wall {
    /// Length of the wall (the chord for arc walls).
    pub fn chord_length(&self) -> f32 {
        let a = &self.attrs;
        (a.x_end - a.x_start).hypot(a.y_end - a.y_start)
    }
}

attr_struct! {
    pub struct BaseboardAttrs {
        /// `leftSideBaseboard` or `rightSideBaseboard`
        role: String => "attribute",
        thickness: f32 => "thickness",
        height: f32 => "height",
        color: Option<Color> => "color",
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Baseboard {
    pub attrs: BaseboardAttrs,
    pub texture: Option<Texture>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

// ---------------------------------------------------------------- Rooms

attr_struct! {
    pub struct RoomAttrs {
        id: Option<String> => "id",
        level: Option<String> => "level",
        name: Option<String> => "name",
        name_angle: Option<f32> => "nameAngle",
        name_x_offset: Option<f32> => "nameXOffset",
        name_y_offset: Option<f32> => "nameYOffset",
        area_visible: Option<bool> => "areaVisible",
        area_angle: Option<f32> => "areaAngle",
        area_x_offset: Option<f32> => "areaXOffset",
        area_y_offset: Option<f32> => "areaYOffset",
        floor_visible: Option<bool> => "floorVisible",
        floor_color: Option<Color> => "floorColor",
        floor_shininess: Option<f32> => "floorShininess",
        ceiling_visible: Option<bool> => "ceilingVisible",
        ceiling_color: Option<Color> => "ceilingColor",
        ceiling_shininess: Option<f32> => "ceilingShininess",
        ceiling_flat: Option<bool> => "ceilingFlat",
    }
}

attr_struct! {
    pub struct Point {
        x: f32 => "x",
        y: f32 => "y",
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Room {
    pub attrs: RoomAttrs,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    /// `nameStyle` and/or `areaStyle`
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub text_styles: Vec<TextStyle>,
    /// `floorTexture` and/or `ceilingTexture`
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub textures: Vec<Texture>,
    pub points: Vec<Point>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

impl Room {
    /// Polygon area in cm² (shoelace formula, assumes no self-intersections).
    pub fn area(&self) -> f32 {
        let p = &self.points;
        if p.len() < 3 {
            return 0.0;
        }
        let mut sum = 0.0f64;
        for i in 0..p.len() {
            let a = &p[i];
            let b = &p[(i + 1) % p.len()];
            sum += f64::from(a.x) * f64::from(b.y) - f64::from(b.x) * f64::from(a.y);
        }
        (sum.abs() / 2.0) as f32
    }
}

// ---------------------------------------------------------------- Polylines, dimensions, labels

attr_struct! {
    pub struct PolylineAttrs {
        id: Option<String> => "id",
        level: Option<String> => "level",
        thickness: Option<f32> => "thickness",
        cap_style: Option<String> => "capStyle",
        join_style: Option<String> => "joinStyle",
        dash_style: Option<String> => "dashStyle",
        dash_pattern: Option<String> => "dashPattern",
        dash_offset: Option<f32> => "dashOffset",
        start_arrow_style: Option<String> => "startArrowStyle",
        end_arrow_style: Option<String> => "endArrowStyle",
        elevation: Option<f32> => "elevation",
        color: Option<Color> => "color",
        closed_path: Option<bool> => "closedPath",
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Polyline {
    pub attrs: PolylineAttrs,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    pub points: Vec<Point>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

attr_struct! {
    pub struct DimensionLineAttrs {
        id: Option<String> => "id",
        level: Option<String> => "level",
        x_start: f32 => "xStart",
        y_start: f32 => "yStart",
        elevation_start: Option<f32> => "elevationStart",
        x_end: f32 => "xEnd",
        y_end: f32 => "yEnd",
        elevation_end: Option<f32> => "elevationEnd",
        offset: f32 => "offset",
        end_mark_size: Option<f32> => "endMarkSize",
        pitch: Option<f32> => "pitch",
        color: Option<Color> => "color",
        visible_in_3d: Option<bool> => "visibleIn3D",
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct DimensionLine {
    pub attrs: DimensionLineAttrs,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    pub text_style: Option<TextStyle>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}

attr_struct! {
    pub struct LabelAttrs {
        id: Option<String> => "id",
        level: Option<String> => "level",
        x: f32 => "x",
        y: f32 => "y",
        angle: Option<f32> => "angle",
        elevation: Option<f32> => "elevation",
        pitch: Option<f32> => "pitch",
        color: Option<Color> => "color",
        outline_color: Option<Color> => "outlineColor",
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Label {
    pub attrs: LabelAttrs,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    pub text_style: Option<TextStyle>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_children: Vec<RawElement>,
}
