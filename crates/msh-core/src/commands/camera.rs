//! Camera path for videos and video settings.
//!
//! As in Sweet Home 3D, the path is a list of cameras (key points) stored in the
//! environment with the role `cameraPath`; a video moves through them at constant speed.
//! Rendering the video needs the 3D view and is a live-only operation of the app.

use super::rad;
use crate::registry::{CommandError, Registry};
use msh_model::{Camera, CameraAttrs, Environment, Home};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

/// Role of the cameras of the video path.
const PATH_ROLE: &str = "cameraPath";
/// Default horizontal field of view of new key points (63°, as Sweet Home 3D's observer).
const DEFAULT_FOV: f32 = 1.1;
/// Defaults of Sweet Home 3D's video settings (width is ours: 320 px is small today).
const DEFAULT_VIDEO_WIDTH: i64 = 640;
const DEFAULT_ASPECT: &str = "RATIO_4_3";
const DEFAULT_FRAME_RATE: i64 = 25;
/// Speed of the viewer in m/s (2.4 km/h).
const DEFAULT_SPEED: f32 = 2400.0 / 3600.0;
/// Turning speed of the viewer in rad/s.
pub const TURN_SPEED: f32 = std::f32::consts::FRAC_PI_4;

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    /// Name of a stored point of view of the home to use as key point
    stored: Option<String>,
    /// Viewer position in cm (plan coordinates)
    x: Option<f32>,
    y: Option<f32>,
    /// Eye elevation in cm (default 170)
    z: Option<f32>,
    /// View direction in degrees, clockwise in the plan; 0 looks towards +y (down the plan)
    yaw: Option<f32>,
    /// Downward tilt in degrees (negative looks up), default 0
    pitch: Option<f32>,
    /// Point to look at instead of yaw / pitch (plan coordinates in cm)
    look_at_x: Option<f32>,
    look_at_y: Option<f32>,
    /// Elevation of the point to look at (default: eye elevation)
    look_at_z: Option<f32>,
    /// Horizontal field of view in degrees (default 63)
    field_of_view: Option<f32>,
    /// Insert before this key point (0-based) instead of appending
    index: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
struct RemoveParams {
    /// Index of the key point (0-based)
    index: usize,
}

#[derive(Deserialize, JsonSchema)]
struct NoParams {}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
enum Aspect {
    #[serde(rename = "4:3")]
    R4x3,
    #[serde(rename = "16:9")]
    R16x9,
    #[serde(rename = "24:10")]
    R24x10,
}

#[derive(Deserialize, JsonSchema)]
struct VideoSettingsParams {
    /// Video width in pixels (16..3840)
    width: Option<i64>,
    /// "4:3", "16:9" or "24:10"
    aspect_ratio: Option<Aspect>,
    /// Frames per second (1..60)
    frame_rate: Option<i64>,
    /// Speed of the viewer in m/s (default 0.67 = 2.4 km/h)
    speed: Option<f32>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "camera_path_get",
        "Returns the camera path of the video (key points with position in cm and angles in \
         degrees), the video settings with the resulting duration, and the stored points of view \
         that can be used as key points.",
        false,
        |doc, _: NoParams| Ok(path_info(doc.home())),
    );
    r.add(
        "camera_path_add",
        "Adds a key point to the camera path of the video: a stored point of view (`stored`), or \
         a position (x, y, optional z = eye elevation) with a view direction given by yaw / pitch \
         or by a point to look at. The video moves from key point to key point at the video \
         speed; render it with the live tool render_video.",
        true,
        |doc, p: AddParams| {
            let camera = key_point(doc.home(), &p)?;
            let env = environment(doc.home_mut());
            let count = path_len(env);
            let index = p.index.unwrap_or(count).min(count);
            insert_path_camera(env, index, camera);
            Ok(json!({ "index": index, "count": count + 1 }))
        },
    );
    r.add(
        "camera_path_remove",
        "Removes a key point (0-based index) from the camera path of the video.",
        true,
        |doc, p: RemoveParams| {
            let env = environment(doc.home_mut());
            let positions: Vec<usize> = path_positions(env);
            let at = *positions.get(p.index).ok_or_else(|| {
                CommandError::failed(format!(
                    "no key point {} (the path has {})",
                    p.index,
                    positions.len()
                ))
            })?;
            env.cameras.remove(at);
            Ok(json!({ "count": positions.len() - 1 }))
        },
    );
    r.add(
        "camera_path_clear",
        "Removes all key points of the camera path of the video.",
        true,
        |doc, _: NoParams| {
            let env = environment(doc.home_mut());
            let before = env.cameras.len();
            env.cameras.retain(|c| c.attrs.role != PATH_ROLE);
            Ok(json!({ "removed": before - env.cameras.len() }))
        },
    );
    r.add(
        "video_settings_update",
        "Changes the video settings stored in the home: width, aspect ratio, frame rate and \
         speed of the viewer.",
        true,
        |doc, p: VideoSettingsParams| {
            let a = &mut environment(doc.home_mut()).attrs;
            if let Some(w) = p.width {
                a.video_width = Some(w.clamp(16, 3840));
            }
            if let Some(r) = p.aspect_ratio {
                a.video_aspect_ratio = Some(
                    match r {
                        Aspect::R4x3 => "RATIO_4_3",
                        Aspect::R16x9 => "RATIO_16_9",
                        Aspect::R24x10 => "RATIO_24_10",
                    }
                    .into(),
                );
            }
            if let Some(f) = p.frame_rate {
                a.video_frame_rate = Some(f.clamp(1, 60));
            }
            if let Some(s) = p.speed {
                if !(s > 0.0 && s <= 100.0) {
                    return Err(CommandError::failed("speed must be between 0 and 100 m/s"));
                }
                a.video_speed = Some(s);
            }
            Ok(video_settings(doc.home()))
        },
    );
}

fn environment(home: &mut Home) -> &mut Environment {
    home.environment.get_or_insert_with(Environment::default)
}

/// Indices of the path cameras in `env.cameras`.
fn path_positions(env: &Environment) -> Vec<usize> {
    env.cameras
        .iter()
        .enumerate()
        .filter(|(_, c)| c.attrs.role == PATH_ROLE)
        .map(|(i, _)| i)
        .collect()
}

fn path_len(env: &Environment) -> usize {
    path_positions(env).len()
}

fn insert_path_camera(env: &mut Environment, index: usize, camera: Camera) {
    let positions = path_positions(env);
    let at = match positions.get(index) {
        Some(&i) => i,
        None => positions.last().map_or(env.cameras.len(), |&i| i + 1),
    };
    env.cameras.insert(at, camera);
}

/// Number of key points of the video path (a video needs at least two).
pub fn camera_path_len(home: &Home) -> usize {
    camera_path(home).len()
}

/// The key points of the video path.
fn camera_path(home: &Home) -> Vec<&CameraAttrs> {
    home.environment
        .iter()
        .flat_map(|e| e.cameras.iter())
        .filter(|c| c.attrs.role == PATH_ROLE)
        .map(|c| &c.attrs)
        .collect()
}

fn key_point(home: &Home, p: &AddParams) -> Result<Camera, CommandError> {
    let attrs = if let Some(name) = &p.stored {
        let stored = home
            .cameras
            .iter()
            .find(|c| c.attrs.role == "storedCamera" && c.attrs.name.as_deref() == Some(name))
            .ok_or_else(|| CommandError::failed(format!("no stored point of view '{name}'")))?;
        CameraAttrs {
            id: None,
            name: None,
            role: PATH_ROLE.into(),
            fixed_size: None,
            renderer: None,
            ..stored.attrs.clone()
        }
    } else {
        let (Some(x), Some(y)) = (p.x, p.y) else {
            return Err(CommandError::failed("give `stored` or x and y"));
        };
        let z = p.z.unwrap_or(170.0);
        let (yaw, pitch) = match (p.look_at_x, p.look_at_y) {
            (Some(tx), Some(ty)) => {
                let (dx, dy) = (tx - x, ty - y);
                let dz = p.look_at_z.unwrap_or(z) - z;
                if dx.hypot(dy) < 1e-3 && dz.abs() < 1e-3 {
                    return Err(CommandError::failed("the point to look at is the position"));
                }
                // Direction in the plan: (-sin yaw, cos yaw); a positive pitch looks down
                ((-dx).atan2(dy), (-dz).atan2(dx.hypot(dy)))
            }
            _ => (rad(p.yaw.unwrap_or(0.0)), rad(p.pitch.unwrap_or(0.0))),
        };
        CameraAttrs {
            role: PATH_ROLE.into(),
            lens: Some("PINHOLE".into()),
            x,
            y,
            z,
            yaw,
            pitch,
            field_of_view: p.field_of_view.map_or(DEFAULT_FOV, rad),
            ..Default::default()
        }
    };
    Ok(Camera {
        observer: false,
        attrs,
        ..Default::default()
    })
}

/// Rounded to 2 decimals as f64, so JSON shows no f32 noise (478.77, not 478.7699890136719).
fn r2(v: f32) -> f64 {
    (f64::from(v) * 100.0).round() / 100.0
}

fn point_json(a: &CameraAttrs) -> Value {
    json!({
        "x": r2(a.x),
        "y": r2(a.y),
        "z": r2(a.z),
        // Sweet Home 3D keeps turning past 360°: show the direction in 0..360
        "yaw": r2(a.yaw.to_degrees().rem_euclid(360.0)),
        "pitch": r2(a.pitch.to_degrees()),
        "field_of_view": r2(a.field_of_view.to_degrees()),
    })
}

/// Video settings with defaults (width and height in pixels, speed in m/s).
pub fn video_settings(home: &Home) -> Value {
    let a = home.environment.as_ref().map(|e| &e.attrs);
    let width = a.and_then(|a| a.video_width).unwrap_or(DEFAULT_VIDEO_WIDTH);
    let aspect = a
        .and_then(|a| a.video_aspect_ratio.clone())
        .unwrap_or_else(|| DEFAULT_ASPECT.into());
    let ratio = match aspect.as_str() {
        "RATIO_16_9" => 16.0 / 9.0,
        "RATIO_24_10" => 2.4,
        _ => 4.0 / 3.0,
    };
    let frame_rate = a
        .and_then(|a| a.video_frame_rate)
        .unwrap_or(DEFAULT_FRAME_RATE);
    let speed = a.and_then(|a| a.video_speed).unwrap_or(DEFAULT_SPEED);
    let frames = frame_count(&camera_path(home), speed, frame_rate as f32);
    json!({
        "width": width,
        // Even sizes, as video encoders need them
        "height": ((width as f64 / ratio / 2.0).round() * 2.0) as i64,
        "aspect_ratio": match aspect.as_str() {
            "RATIO_16_9" => "16:9",
            "RATIO_24_10" => "24:10",
            _ => "4:3",
        },
        "frame_rate": frame_rate,
        "speed": r2(speed),
        "frames": frames,
        "duration_seconds": r2(frames as f32 / frame_rate as f32),
    })
}

/// Number of frames of a video along `path` (same timing as the app's video renderer):
/// each segment lasts as long as the slower of moving at `speed` (m/s) and turning at
/// [`TURN_SPEED`].
pub fn frame_count(path: &[&CameraAttrs], speed: f32, frame_rate: f32) -> usize {
    if path.is_empty() {
        return 0;
    }
    let mut frames = 1;
    for w in path.windows(2) {
        let (a, b) = (w[0], w[1]);
        let distance = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2) + (b.z - a.z).powi(2)).sqrt();
        let yaw = angle_delta(a.yaw, b.yaw).abs();
        let pitch = (b.pitch - a.pitch).abs();
        let seconds = (distance / (speed * 100.0)).max(yaw.max(pitch) / TURN_SPEED);
        frames += ((seconds * frame_rate).round() as usize).max(1);
    }
    frames
}

/// Shortest signed angle from `a` to `b` in radians.
fn angle_delta(a: f32, b: f32) -> f32 {
    let tau = std::f32::consts::TAU;
    let d = (b - a).rem_euclid(tau);
    if d > std::f32::consts::PI { d - tau } else { d }
}

fn path_info(home: &Home) -> Value {
    let points: Vec<Value> = camera_path(home).into_iter().map(point_json).collect();
    let stored: Vec<Value> = home
        .cameras
        .iter()
        .filter(|c| c.attrs.role == "storedCamera")
        .map(|c| {
            let mut v = point_json(&c.attrs);
            v["name"] = json!(c.attrs.name);
            v
        })
        .collect();
    json!({
        "points": points,
        "video": video_settings(home),
        "stored_points_of_view": stored,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cam(x: f32, yaw: f32) -> CameraAttrs {
        CameraAttrs {
            x,
            yaw,
            ..Default::default()
        }
    }

    #[test]
    fn frames_follow_the_slower_of_moving_and_turning() {
        // 2 m at 1 m/s and 25 fps: 50 frames + the first one
        let (a, b) = (cam(0.0, 0.0), cam(200.0, 0.0));
        assert_eq!(frame_count(&[&a, &b], 1.0, 25.0), 51);
        // Turning by 90° at 45°/s takes 2 s even without moving
        let (a, b) = (cam(0.0, 0.1), cam(0.0, 0.1 + std::f32::consts::FRAC_PI_2));
        assert_eq!(frame_count(&[&a, &b], 1.0, 25.0), 51);
        // The short way round: from 350° to 10° is a 20° turn
        assert!((angle_delta(rad(350.0), rad(10.0)) - rad(20.0)).abs() < 1e-4);
    }
}
