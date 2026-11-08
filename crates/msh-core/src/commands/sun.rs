//! Location of the home, date and time of the sun, and the settings of the 3D view.
//!
//! The location is stored in the compass (latitude, longitude, time zone), the date and
//! time in the cameras of the 3D view (`time`, milliseconds since 1970 UTC), as in Sweet
//! Home 3D. The sun position is computed offline from both. Whether the sun follows the
//! clock is a property of the home (Sweet Home 3D keeps unknown properties).

use super::visit::{Mode, camera_mut};
use super::wall::texture_for;
use super::{color_hex, optional_color};
use crate::registry::{CommandError, Registry};
use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use msh_model::{Compass, CompassAttrs, Environment, Home, Property};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

/// Home property: the sun follows the current time instead of the stored one.
pub const FOLLOW_CLOCK_PROPERTY: &str = "mySweetHome.sunFollowsClock";
/// Location used while the home has none (Paris, as Sweet Home 3D's example homes).
const DEFAULT_LATITUDE: f64 = 48.8667;
const DEFAULT_LONGITUDE: f64 = 2.3333;
/// Light color of Sweet Home 3D's default homes (gray 0xD0 = "100 %" brightness here).
const DEFAULT_LIGHT_GRAY: f32 = 208.0;
const NOMINATIM_URL: &str = "https://nominatim.openstreetmap.org/search";

#[derive(Deserialize, JsonSchema)]
struct SearchParams {
    /// Address, place or postal code, e.g. "Marienplatz 1, München"
    query: String,
    /// Number of results (1..10, default 5)
    limit: Option<u32>,
}

#[derive(Deserialize, JsonSchema)]
struct SunParams {
    /// Date in the time zone of the home, "YYYY-MM-DD"
    date: Option<String>,
    /// Time of day in the time zone of the home, "HH:MM"
    time: Option<String>,
    /// The sun follows the current time (the stored date and time are kept for later)
    follow_clock: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct SunGetParams {
    /// Compute for this moment instead ("YYYY-MM-DDTHH:MM" in the time zone of the home)
    at: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct LocationParams {
    /// Latitude in degrees (north positive)
    latitude: Option<f64>,
    /// Longitude in degrees (east positive)
    longitude: Option<f64>,
    /// IANA time zone, e.g. "Europe/Berlin"
    time_zone: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct NoParams {}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Lens {
    /// Like the eye (Sweet Home 3D: "normal")
    Normal,
    /// Ideal camera without depth of field
    Pinhole,
    /// 180° circular image
    Fisheye,
    /// 360° panorama (equirectangular, width = 2 × height)
    Spherical,
}

#[derive(Deserialize, JsonSchema)]
struct PhotoParams {
    /// Lens of the photo: "normal", "pinhole", "fisheye" or "spherical"
    lens: Option<Lens>,
    /// Add a light under the ceiling of each room in photos
    ceiling_lights: Option<bool>,
    /// Photo size in pixels
    width: Option<i64>,
    height: Option<i64>,
}

#[derive(Deserialize, JsonSchema)]
struct View3dParams {
    /// Show all levels in the 3D view (otherwise the selected level and the ones below)
    all_levels_visible: Option<bool>,
    /// Color of the ground "#RRGGBB" ("" = default)
    ground_color: Option<String>,
    /// Catalog texture of the ground ("" = none, the color is used)
    ground_texture: Option<String>,
    /// Color of the sky "#RRGGBB" ("" = default)
    sky_color: Option<String>,
    /// Catalog texture of the sky ("" = none, the color is used)
    sky_texture: Option<String>,
    /// Brightness of the light in percent (0..120, default 100)
    light_brightness: Option<f32>,
    /// Transparency of the walls in percent (0 = opaque .. 90)
    walls_transparency: Option<f32>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "location_search",
        "Searches an address or place online (OpenStreetMap Nominatim) and returns matching \
         locations with latitude and longitude; set one with location_set.",
        false,
        |_, p: SearchParams| search(&p.query, p.limit.unwrap_or(5).clamp(1, 10)),
    );
    r.add(
        "location_set",
        "Sets the geographic location of the home (stored in the compass): latitude and \
         longitude in degrees and the IANA time zone (e.g. \"Europe/Berlin\"). The sun \
         position is computed from it.",
        true,
        |doc, p: LocationParams| {
            if let Some(tz) = &p.time_zone {
                tz.parse::<Tz>()
                    .map_err(|_| CommandError::failed(format!("unknown time zone '{tz}'")))?;
            }
            for v in [p.latitude, p.longitude].into_iter().flatten() {
                if !v.is_finite() {
                    return Err(CommandError::failed(
                        "latitude and longitude must be numbers",
                    ));
                }
            }
            let a = &mut compass_mut(doc.home_mut()).attrs;
            if let Some(v) = p.latitude {
                a.latitude = Some(v.clamp(-90.0, 90.0).to_radians() as f32);
            }
            if let Some(v) = p.longitude {
                a.longitude = Some(v.clamp(-180.0, 180.0).to_radians() as f32);
            }
            if let Some(tz) = p.time_zone {
                a.time_zone = Some(tz);
            }
            Ok(sun_json(doc.home(), None))
        },
    );
    r.add(
        "sun_update",
        "Sets the date and time of the sun (in the time zone of the home), or lets the sun \
         follow the current time. Without a stored time the sun stands at summer noon.",
        true,
        |doc, p: SunParams| {
            let home = doc.home_mut();
            if p.date.is_some() || p.time.is_some() {
                let tz = time_zone(home);
                let current = stored_time(home).with_timezone(&tz);
                let date = match &p.date {
                    Some(d) => NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| {
                        CommandError::failed(format!("date '{d}' is not YYYY-MM-DD"))
                    })?,
                    None => current.date_naive(),
                };
                let time = match &p.time {
                    Some(t) => NaiveTime::parse_from_str(t, "%H:%M")
                        .map_err(|_| CommandError::failed(format!("time '{t}' is not HH:MM")))?,
                    None => current.time(),
                };
                let local = tz
                    .from_local_datetime(&date.and_time(time))
                    .earliest()
                    .ok_or_else(|| {
                        CommandError::failed("this time does not exist (clock change)")
                    })?;
                let ms = local.with_timezone(&Utc).timestamp_millis();
                for mode in [Mode::Aerial, Mode::Observer] {
                    camera_mut(home, mode).attrs.time = Some(ms);
                }
            }
            if let Some(follow) = p.follow_clock {
                home.properties
                    .retain(|pr| pr.name != FOLLOW_CLOCK_PROPERTY);
                if follow {
                    home.properties.push(Property {
                        name: FOLLOW_CLOCK_PROPERTY.into(),
                        value: "true".into(),
                        kind: None,
                        ..Default::default()
                    });
                }
            }
            Ok(sun_json(doc.home(), None))
        },
    );
    r.add(
        "sun_get",
        "Returns the location, date and time of the sun and its position: azimuth (degrees \
         clockwise from north), elevation above the horizon and the direction in the plan \
         (taking the north direction of the compass into account).",
        false,
        |doc, p: SunGetParams| {
            let at = match &p.at {
                Some(s) => {
                    let tz = time_zone(doc.home());
                    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M")
                        .map_err(|_| {
                            CommandError::failed(format!("'{s}' is not YYYY-MM-DDTHH:MM"))
                        })?;
                    let local = tz
                        .from_local_datetime(&naive)
                        .earliest()
                        .ok_or_else(|| CommandError::failed("this time does not exist"))?;
                    Some(local.with_timezone(&Utc))
                }
                None => None,
            };
            Ok(sun_json(doc.home(), at))
        },
    );
    r.add(
        "render_settings_update",
        "Changes the photo settings stored in the home: lens (normal, pinhole, fisheye, \
         spherical), lights under the ceilings of the rooms, and the size in pixels. The date and \
         time of the photo are those of the sun (sun_update).",
        true,
        |doc, p: PhotoParams| {
            let home = doc.home_mut();
            if let Some(lens) = p.lens {
                let value = match lens {
                    Lens::Normal => "NORMAL",
                    Lens::Pinhole => "PINHOLE",
                    Lens::Fisheye => "FISHEYE",
                    Lens::Spherical => "SPHERICAL",
                };
                for mode in [Mode::Aerial, Mode::Observer] {
                    camera_mut(home, mode).attrs.lens = Some(value.into());
                }
            }
            let env = home.environment.get_or_insert_with(Environment::default);
            if let Some(on) = p.ceiling_lights {
                // Sweet Home 3D's ceiling light color: gray 0xD0 when on, black when off
                env.attrs.ceiling_light_color =
                    Some(msh_model::Color(if on { 0xFFD0_D0D0 } else { 0xFF00_0000 }));
            }
            if let Some(w) = p.width {
                env.attrs.photo_width = Some(w.clamp(16, 8192));
            }
            if let Some(h) = p.height {
                env.attrs.photo_height = Some(h.clamp(16, 8192));
            }
            Ok(photo_json(doc.home()))
        },
    );
    r.add(
        "render_settings_get",
        "Returns the photo settings of the home: lens, ceiling lights and size.",
        false,
        |doc, _: NoParams| Ok(photo_json(doc.home())),
    );
    r.add(
        "view3d_update",
        "Changes the settings of the 3D view stored in the home: all levels visible, ground and \
         sky color or texture, light brightness and walls transparency.",
        true,
        |doc, p: View3dParams| {
            let ground_tex = match p.ground_texture.as_deref() {
                Some("") | None => None,
                Some(id) => texture_for(doc, Some(id), "groundTexture")?,
            };
            let sky_tex = match p.sky_texture.as_deref() {
                Some("") | None => None,
                Some(id) => texture_for(doc, Some(id), "skyTexture")?,
            };
            let ground_color = p.ground_color.as_deref().map(optional_color).transpose()?;
            let sky_color = p.sky_color.as_deref().map(optional_color).transpose()?;
            let env = doc
                .home_mut()
                .environment
                .get_or_insert_with(Environment::default);
            let a = &mut env.attrs;
            if let Some(v) = p.all_levels_visible {
                a.all_levels_visible = Some(v);
            }
            if let Some(c) = ground_color {
                a.ground_color = c;
            }
            if let Some(c) = sky_color {
                a.sky_color = c;
            }
            if let Some(b) = p.light_brightness {
                if !b.is_finite() {
                    return Err(CommandError::failed("light_brightness must be a number"));
                }
                let gray = (DEFAULT_LIGHT_GRAY * b.clamp(0.0, 120.0) / 100.0).round() as u32;
                let gray = gray.min(255);
                a.light_color = Some(msh_model::Color(
                    0xFF00_0000 | gray << 16 | gray << 8 | gray,
                ));
            }
            if let Some(t) = p.walls_transparency {
                if !t.is_finite() {
                    return Err(CommandError::failed("walls_transparency must be a number"));
                }
                a.walls_alpha = Some((t.clamp(0.0, 90.0) / 100.0 * 100.0).round() / 100.0);
            }
            for (role, value, new) in [
                ("groundTexture", &p.ground_texture, ground_tex),
                ("skyTexture", &p.sky_texture, sky_tex),
            ] {
                if value.is_some() {
                    env.textures.retain(|t| t.role.as_deref() != Some(role));
                    env.textures.extend(new);
                }
            }
            Ok(view3d_json(doc.home()))
        },
    );
}

fn compass_mut(home: &mut Home) -> &mut Compass {
    home.compass.get_or_insert_with(|| Compass {
        attrs: CompassAttrs {
            x: -100.0,
            y: 50.0,
            diameter: 100.0,
            north_direction: Some(0.0),
            visible: Some(true),
            ..Default::default()
        },
        properties: Vec::new(),
        extra_children: Vec::new(),
    })
}

/// Time zone of the home: the compass's, else the one of this computer, else UTC.
fn time_zone(home: &Home) -> Tz {
    home.compass
        .as_ref()
        .and_then(|c| c.attrs.time_zone.as_deref())
        .and_then(|s| s.parse().ok())
        .or_else(|| iana_time_zone::get_timezone().ok()?.parse().ok())
        .unwrap_or(Tz::UTC)
}

fn follows_clock(home: &Home) -> bool {
    home.properties
        .iter()
        .any(|p| p.name == FOLLOW_CLOCK_PROPERTY && p.value == "true")
}

/// Date and time stored in the camera of the 3D view, or noon of the summer solstice.
fn stored_time(home: &Home) -> DateTime<Utc> {
    let active = if home.attrs.camera.as_deref() == Some("observerCamera") {
        "observerCamera"
    } else {
        "topCamera"
    };
    let ms = home
        .cameras
        .iter()
        .find(|c| c.attrs.role == active)
        .or_else(|| {
            home.cameras
                .iter()
                .find(|c| matches!(c.attrs.role.as_str(), "topCamera" | "observerCamera"))
        })
        .and_then(|c| c.attrs.time);
    if let Some(dt) = ms.and_then(DateTime::from_timestamp_millis) {
        return dt;
    }
    let tz = time_zone(home);
    let year = Utc::now().with_timezone(&tz).year();
    let noon = NaiveDate::from_ymd_opt(year, 6, 21)
        .and_then(|d| d.and_hms_opt(12, 0, 0))
        .and_then(|n| tz.from_local_datetime(&n).earliest());
    noon.map_or_else(Utc::now, |t| t.with_timezone(&Utc))
}

/// Latitude and longitude of the home in degrees (default location if none is set).
fn location(home: &Home) -> (f64, f64, bool) {
    let c = home.compass.as_ref().map(|c| &c.attrs);
    match (c.and_then(|a| a.latitude), c.and_then(|a| a.longitude)) {
        (Some(lat), Some(lon)) => (
            f64::from(lat).to_degrees(),
            f64::from(lon).to_degrees(),
            true,
        ),
        _ => (DEFAULT_LATITUDE, DEFAULT_LONGITUDE, false),
    }
}

/// Position of the sun as (azimuth clockwise from north, elevation), both in degrees.
/// Low-precision formulas of the Astronomical Almanac (about 0.01° until 2050).
pub fn sun_position(at: DateTime<Utc>, latitude: f64, longitude: f64) -> (f64, f64) {
    let n = at.timestamp_millis() as f64 / 86_400_000.0 + 2_440_587.5 - 2_451_545.0;
    let l = (280.460 + 0.985_647_4 * n).rem_euclid(360.0);
    let g = (357.528 + 0.985_600_3 * n).rem_euclid(360.0).to_radians();
    let lambda = (l + 1.915 * g.sin() + 0.020 * (2.0 * g).sin()).to_radians();
    let epsilon = (23.439 - 0.000_000_4 * n).to_radians();
    let ra = (epsilon.cos() * lambda.sin()).atan2(lambda.cos());
    let dec = (epsilon.sin() * lambda.sin()).asin();
    let gmst_hours = (18.697_374_558 + 24.065_709_824_419_08 * n).rem_euclid(24.0);
    let ha = (gmst_hours * 15.0 + longitude).to_radians() - ra;
    let lat = latitude.to_radians();
    let elevation = (lat.sin() * dec.sin() + lat.cos() * dec.cos() * ha.cos()).asin();
    let azimuth = (-ha.sin()).atan2(dec.tan() * lat.cos() - lat.sin() * ha.cos());
    (
        azimuth.to_degrees().rem_euclid(360.0),
        elevation.to_degrees(),
    )
}

fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn sun_json(home: &Home, at: Option<DateTime<Utc>>) -> Value {
    let follow = follows_clock(home);
    let now = at.unwrap_or_else(|| {
        if follow {
            Utc::now()
        } else {
            stored_time(home)
        }
    });
    let tz = time_zone(home);
    let local = now.with_timezone(&tz);
    let (lat, lon, located) = location(home);
    let (azimuth, elevation) = sun_position(now, lat, lon);
    let north = home
        .compass
        .as_ref()
        .and_then(|c| c.attrs.north_direction)
        .map_or(0.0, f64::from);
    // Towards the sun in plan coordinates (x right, y down, z up)
    let a = north + azimuth.to_radians();
    let e = elevation.to_radians();
    json!({
        "latitude": r2(lat),
        "longitude": r2(lon),
        "location_set": located,
        "time_zone": tz.name(),
        "follow_clock": follow,
        "date": local.format("%Y-%m-%d").to_string(),
        "time": local.format("%H:%M").to_string(),
        "utc_ms": now.timestamp_millis(),
        "azimuth": r2(azimuth),
        "elevation": r2(elevation),
        "north_direction": r2(north.to_degrees()),
        "direction": [
            (e.cos() * a.sin() * 10_000.0).round() / 10_000.0,
            (-e.cos() * a.cos() * 10_000.0).round() / 10_000.0,
            (e.sin() * 10_000.0).round() / 10_000.0,
        ],
    })
}

fn photo_json(home: &Home) -> Value {
    let active = if home.attrs.camera.as_deref() == Some("observerCamera") {
        "observerCamera"
    } else {
        "topCamera"
    };
    let lens = home
        .cameras
        .iter()
        .find(|c| c.attrs.role == active)
        .and_then(|c| c.attrs.lens.as_deref())
        .unwrap_or("PINHOLE")
        .to_lowercase();
    let a = home.environment.as_ref().map(|e| &e.attrs);
    let ceiling = a
        .and_then(|a| a.ceiling_light_color)
        .is_some_and(|c| c.0 & 0x00FF_FFFF != 0);
    json!({
        "lens": lens,
        "ceiling_lights": ceiling,
        "width": a.and_then(|a| a.photo_width),
        "height": a.and_then(|a| a.photo_height),
    })
}

fn view3d_json(home: &Home) -> Value {
    let env = home.environment.as_ref();
    let a = env.map(|e| &e.attrs);
    let texture = |role: &str| {
        env.and_then(|e| e.textures.iter().find(|t| t.role.as_deref() == Some(role)))
            .map(|t| t.name.clone())
    };
    let gray = a
        .and_then(|a| a.light_color)
        .map_or(DEFAULT_LIGHT_GRAY, |c| ((c.0 >> 8) & 0xFF) as f32);
    json!({
        "all_levels_visible": a.and_then(|a| a.all_levels_visible).unwrap_or(false),
        "ground_color": color_hex(a.and_then(|a| a.ground_color)),
        "ground_texture": texture("groundTexture"),
        "sky_color": color_hex(a.and_then(|a| a.sky_color)),
        "sky_texture": texture("skyTexture"),
        "light_brightness": (gray / DEFAULT_LIGHT_GRAY * 100.0).round(),
        "walls_transparency": (a.and_then(|a| a.walls_alpha).unwrap_or(0.0) * 100.0).round(),
    })
}

/// Address search with OpenStreetMap Nominatim (one request per user action, as its
/// usage policy asks; identified by the application name).
fn search(query: &str, limit: u32) -> Result<Value, CommandError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(CommandError::failed("the search text is empty"));
    }
    let agent = format!(
        "MySweetHome/{} (home planner compatible with Sweet Home 3D)",
        env!("CARGO_PKG_VERSION")
    );
    let body = ureq::get(NOMINATIM_URL)
        .set("User-Agent", &agent)
        .query("q", query)
        .query("format", "jsonv2")
        .query("limit", &limit.to_string())
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| CommandError::failed(format!("address search failed: {e}")))?
        .into_string()
        .map_err(|e| CommandError::failed(format!("address search failed: {e}")))?;
    let found: Vec<Value> = serde_json::from_str(&body).map_err(|e| {
        CommandError::failed(format!("unexpected answer of the address search: {e}"))
    })?;
    let results: Vec<Value> = found
        .iter()
        .filter_map(|r| {
            let lat: f64 = r["lat"].as_str()?.parse().ok()?;
            let lon: f64 = r["lon"].as_str()?.parse().ok()?;
            Some(json!({
                "name": r["display_name"].as_str().unwrap_or_default(),
                "latitude": (lat * 10_000.0).round() / 10_000.0,
                "longitude": (lon * 10_000.0).round() / 10_000.0,
            }))
        })
        .collect();
    Ok(json!({ "results": results }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sun_at_solstice_noon_in_paris() {
        // 2026-06-21 11:52 UTC is about solar noon in Paris: sun in the south, 64.6° high
        let at = Utc.with_ymd_and_hms(2026, 6, 21, 11, 52, 0).unwrap();
        let (azimuth, elevation) = sun_position(at, 48.8667, 2.3333);
        assert!((azimuth - 180.0).abs() < 2.0, "azimuth {azimuth}");
        assert!((elevation - 64.6).abs() < 0.3, "elevation {elevation}");
    }

    #[test]
    fn sun_rises_in_the_east_and_is_down_at_night() {
        // Berlin, 2026-03-20: equinox, sunrise about 05:05 UTC due east
        let morning = Utc.with_ymd_and_hms(2026, 3, 20, 6, 0, 0).unwrap();
        let (azimuth, elevation) = sun_position(morning, 52.52, 13.405);
        assert!((80.0..110.0).contains(&azimuth), "azimuth {azimuth}");
        assert!(elevation > 0.0 && elevation < 15.0, "elevation {elevation}");
        let night = Utc.with_ymd_and_hms(2026, 3, 20, 23, 0, 0).unwrap();
        assert!(sun_position(night, 52.52, 13.405).1 < -20.0);
    }
}
