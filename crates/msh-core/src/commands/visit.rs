//! Cameras of the 3D view and points of view.
//!
//! A home has a camera for the aerial view (`topCamera`) and one for the virtual
//! visitor (`observerCamera`); `home.camera` says which one the 3D view uses. Stored
//! points of view are cameras with the role `storedCamera`, as in Sweet Home 3D (an
//! `observerCamera` element for the visit, a `camera` element for the aerial view).

use super::rad;
use crate::registry::{CommandError, Registry};
use msh_model::{Camera, CameraAttrs, Home};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

const STORED_ROLE: &str = "storedCamera";
/// Default eye elevation of the visitor in cm.
const DEFAULT_EYE: f32 = 170.0;
/// Default horizontal field of view (63°, as Sweet Home 3D's observer).
const DEFAULT_FOV: f32 = 1.1;
/// Points of view kept per home (Sweet Home 3D keeps 50).
const MAX_STORED: usize = 50;

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(super) enum Mode {
    /// Virtual visit (observer camera)
    Observer,
    /// Aerial view (top camera)
    Aerial,
}

impl Mode {
    fn role(self) -> &'static str {
        match self {
            Mode::Observer => "observerCamera",
            Mode::Aerial => "topCamera",
        }
    }
}

#[derive(Deserialize, JsonSchema)]
struct PoseParams {
    /// Camera position in cm (plan coordinates)
    x: Option<f32>,
    y: Option<f32>,
    /// Eye elevation in cm
    z: Option<f32>,
    /// View direction in degrees, clockwise in the plan; 0 looks towards +y (down the plan)
    yaw: Option<f32>,
    /// Downward tilt in degrees (negative looks up)
    pitch: Option<f32>,
    /// Horizontal field of view in degrees (2..170)
    field_of_view: Option<f32>,
}

#[derive(Deserialize, JsonSchema)]
struct CameraSetParams {
    /// Camera to change: "observer" (virtual visit) or "aerial"
    mode: Mode,
    #[serde(flatten)]
    pose: PoseParams,
    /// Also make this the camera of the 3D view
    activate: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct StoreParams {
    /// Name of the point of view (an existing one with this name is replaced)
    name: String,
    /// Camera to store: "observer" or "aerial" (default: the camera of the 3D view)
    mode: Option<Mode>,
    /// Position and direction to store instead of the current camera
    #[serde(flatten)]
    pose: PoseParams,
}

#[derive(Deserialize, JsonSchema)]
struct NameParams {
    /// Name of the point of view
    name: String,
}

#[derive(Deserialize, JsonSchema)]
struct NoParams {}

pub(super) fn register(r: &mut Registry) {
    r.add_view(
        "camera_set",
        "Moves the camera of the virtual visit (mode \"observer\") or of the aerial view \
         (\"aerial\"): position in cm, eye elevation z, yaw / pitch and field of view in \
         degrees. Omitted values stay. With activate the 3D view switches to this camera. \
         Camera changes are not undone.",
        |doc, p: CameraSetParams| {
            let home = doc.home_mut();
            let cam = camera_mut(home, p.mode);
            apply_pose(&mut cam.attrs, &p.pose)?;
            let json = pose_json(&cam.attrs);
            if p.activate == Some(true) {
                home.attrs.camera = Some(p.mode.role().into());
            }
            Ok(json)
        },
    );
    r.add(
        "camera_get",
        "Returns the cameras of the 3D view (virtual visit and aerial view) and which one is \
         active.",
        false,
        |doc, _: NoParams| {
            let home = doc.home();
            let get = |m: Mode| {
                home.cameras
                    .iter()
                    .find(|c| c.attrs.role == m.role())
                    .map(|c| pose_json(&c.attrs))
            };
            Ok(json!({
                "active": active_mode(home),
                "observer": get(Mode::Observer),
                "aerial": get(Mode::Aerial),
            }))
        },
    );
    r.add(
        "viewpoint_list",
        "Lists the stored points of view of the home (name, mode, position and direction).",
        false,
        |doc, _: NoParams| Ok(json!({ "points_of_view": stored_json(doc.home()) })),
    );
    r.add(
        "viewpoint_store",
        "Stores a point of view under a name: the current camera of the 3D view (or of the given \
         mode), or a position and direction given here.",
        true,
        |doc, p: StoreParams| {
            let name = p.name.trim();
            if name.is_empty() {
                return Err(CommandError::failed("the name must not be empty"));
            }
            let home = doc.home_mut();
            let mode = p.mode.unwrap_or_else(|| mode_of(active_mode(home)));
            let mut attrs = camera_mut(home, mode).attrs.clone();
            apply_pose(&mut attrs, &p.pose)?;
            attrs.id = None;
            attrs.role = STORED_ROLE.into();
            attrs.name = Some(name.to_owned());
            let camera = Camera {
                observer: mode == Mode::Observer,
                attrs,
                ..Default::default()
            };
            // Newest first, as in Sweet Home 3D's menu
            home.cameras.retain(|c| {
                !(c.attrs.role == STORED_ROLE && c.attrs.name.as_deref() == Some(name))
            });
            let first = home
                .cameras
                .iter()
                .position(|c| c.attrs.role == STORED_ROLE)
                .unwrap_or(home.cameras.len());
            home.cameras.insert(first, camera);
            let mut count = 0;
            home.cameras.retain(|c| {
                if c.attrs.role != STORED_ROLE {
                    return true;
                }
                count += 1;
                count <= MAX_STORED
            });
            Ok(json!({ "points_of_view": stored_json(home) }))
        },
    );
    r.add_view(
        "viewpoint_go",
        "Moves the 3D view to a stored point of view (switching between virtual visit and aerial \
         view as stored).",
        |doc, p: NameParams| {
            let home = doc.home_mut();
            let stored = find_stored(home, &p.name)?.clone();
            let mode = if stored.observer {
                Mode::Observer
            } else {
                Mode::Aerial
            };
            let cam = camera_mut(home, mode);
            let a = &mut cam.attrs;
            a.x = stored.attrs.x;
            a.y = stored.attrs.y;
            a.z = stored.attrs.z;
            a.yaw = stored.attrs.yaw;
            a.pitch = stored.attrs.pitch;
            a.field_of_view = stored.attrs.field_of_view;
            let json = pose_json(a);
            home.attrs.camera = Some(mode.role().into());
            Ok(json)
        },
    );
    r.add(
        "viewpoint_delete",
        "Deletes a stored point of view.",
        true,
        |doc, p: NameParams| {
            let home = doc.home_mut();
            find_stored(home, &p.name)?;
            home.cameras.retain(|c| {
                !(c.attrs.role == STORED_ROLE && c.attrs.name.as_deref() == Some(p.name.as_str()))
            });
            Ok(json!({ "points_of_view": stored_json(home) }))
        },
    );
}

fn active_mode(home: &Home) -> &'static str {
    if home.attrs.camera.as_deref() == Some("observerCamera") {
        "observer"
    } else {
        "aerial"
    }
}

fn mode_of(name: &str) -> Mode {
    if name == "observer" {
        Mode::Observer
    } else {
        Mode::Aerial
    }
}

/// The camera of a mode, created with Sweet Home 3D's defaults if the home has none.
pub(super) fn camera_mut(home: &mut Home, mode: Mode) -> &mut Camera {
    let role = mode.role();
    let index = match home.cameras.iter().position(|c| c.attrs.role == role) {
        Some(i) => i,
        None => {
            let attrs = match mode {
                Mode::Observer => CameraAttrs {
                    role: role.into(),
                    lens: Some("PINHOLE".into()),
                    x: 50.0,
                    y: 50.0,
                    z: DEFAULT_EYE,
                    yaw: 7.0 * std::f32::consts::FRAC_PI_4,
                    pitch: std::f32::consts::PI / 16.0,
                    field_of_view: DEFAULT_FOV,
                    ..Default::default()
                },
                Mode::Aerial => CameraAttrs {
                    role: role.into(),
                    lens: Some("PINHOLE".into()),
                    x: 50.0,
                    y: 1050.0,
                    z: 1010.0,
                    yaw: std::f32::consts::PI,
                    pitch: std::f32::consts::FRAC_PI_4,
                    field_of_view: DEFAULT_FOV,
                    ..Default::default()
                },
            };
            home.cameras.push(Camera {
                observer: mode == Mode::Observer,
                attrs,
                ..Default::default()
            });
            home.cameras.len() - 1
        }
    };
    &mut home.cameras[index]
}

fn apply_pose(a: &mut CameraAttrs, p: &PoseParams) -> Result<(), CommandError> {
    for v in [p.x, p.y, p.z, p.yaw, p.pitch, p.field_of_view]
        .into_iter()
        .flatten()
    {
        if !v.is_finite() {
            return Err(CommandError::failed("camera values must be finite numbers"));
        }
    }
    if let Some(f) = p.field_of_view
        && !(2.0..=170.0).contains(&f)
    {
        return Err(CommandError::failed(
            "field_of_view must be between 2 and 170 degrees",
        ));
    }
    if let Some(v) = p.x {
        a.x = v;
    }
    if let Some(v) = p.y {
        a.y = v;
    }
    if let Some(v) = p.z {
        a.z = v;
    }
    if let Some(v) = p.yaw {
        a.yaw = rad(v);
    }
    if let Some(v) = p.pitch {
        a.pitch = rad(v.clamp(-90.0, 90.0));
    }
    if let Some(v) = p.field_of_view {
        a.field_of_view = rad(v);
    }
    Ok(())
}

fn find_stored<'a>(home: &'a Home, name: &str) -> Result<&'a Camera, CommandError> {
    home.cameras
        .iter()
        .find(|c| c.attrs.role == STORED_ROLE && c.attrs.name.as_deref() == Some(name))
        .ok_or_else(|| CommandError::failed(format!("no stored point of view '{name}'")))
}

/// Rounded to 2 decimals as f64, so JSON shows no f32 noise.
fn r2(v: f32) -> f64 {
    (f64::from(v) * 100.0).round() / 100.0
}

fn pose_json(a: &CameraAttrs) -> Value {
    json!({
        "x": r2(a.x),
        "y": r2(a.y),
        "z": r2(a.z),
        "yaw": r2(a.yaw.to_degrees().rem_euclid(360.0)),
        "pitch": r2(a.pitch.to_degrees()),
        "field_of_view": r2(a.field_of_view.to_degrees()),
    })
}

fn stored_json(home: &Home) -> Vec<Value> {
    home.cameras
        .iter()
        .filter(|c| c.attrs.role == STORED_ROLE)
        .map(|c| {
            let mut v = pose_json(&c.attrs);
            v["name"] = json!(c.attrs.name.clone().unwrap_or_default());
            v["mode"] = json!(if c.observer { "observer" } else { "aerial" });
            v
        })
        .collect()
}
