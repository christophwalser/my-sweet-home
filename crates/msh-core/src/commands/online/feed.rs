//! Catalog feeds of the users' own catalog servers (format `msh-catalog`, see
//! docs/CATALOG_FEED.md): one JSON file listing models, textures and libraries, on a web
//! server or a file share. An access token is sent to the feed's own host only.

use super::{
    Found, Kind, Source, agent, download_dir, extract_library, failed, file_name, matches,
    safe_relative,
};
use crate::registry::CommandError;
use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Largest feed and largest preview image.
const MAX_FEED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES: u64 = 1024 * 1024;
const MAX_FILE_BYTES: u64 = 500 * 1024 * 1024;

#[derive(Deserialize, Debug)]
pub(super) struct Feed {
    format: String,
    version: u32,
    #[serde(default)]
    pub(super) name: Option<String>,
    pub(super) items: Vec<FeedItem>,
}

#[derive(Deserialize, Debug, Clone)]
pub(super) struct FeedItem {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    name: String,
    url: String,
    #[serde(default)]
    files: Vec<FeedFile>,
    thumbnail: Option<String>,
    category: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    author: Option<String>,
    license: Option<String>,
    size: Option<u64>,
    width: Option<f32>,
    depth: Option<f32>,
    height: Option<f32>,
    door_or_window: Option<bool>,
    tile_width: Option<f32>,
    tile_height: Option<f32>,
}

#[derive(Deserialize, Debug, Clone)]
struct FeedFile {
    path: String,
    url: String,
}

/// Where a feed or one of its files is: on the web or in the file system.
#[derive(Debug, Clone, PartialEq)]
enum Location {
    Web(url::Url),
    File(PathBuf),
}

fn location(address: &str) -> Result<Location, CommandError> {
    let a = address.trim();
    let lower = a.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        url::Url::parse(a)
            .map(Location::Web)
            .map_err(|e| failed("invalid catalog address", e))
    } else if lower.starts_with("file:") {
        url::Url::parse(a)
            .ok()
            .and_then(|u| u.to_file_path().ok())
            .map(Location::File)
            .ok_or_else(|| CommandError::failed("invalid file address of the catalog"))
    } else if a.is_empty() {
        Err(CommandError::failed("the catalog has no address"))
    } else {
        Ok(Location::File(PathBuf::from(a)))
    }
}

/// An address of the feed (absolute, or relative to the feed) as location.
fn resolve(feed: &Location, address: &str) -> Result<Location, CommandError> {
    let lower = address.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("file:") {
        return location(address);
    }
    match feed {
        Location::Web(base) => base
            .join(address)
            .map(Location::Web)
            .map_err(|e| failed("invalid address in the catalog", e)),
        Location::File(path) => {
            let p = Path::new(address);
            if p.is_absolute() || address.starts_with("\\\\") {
                Ok(Location::File(p.to_owned()))
            } else {
                let rel = safe_relative(address)
                    .ok_or_else(|| CommandError::failed("invalid path in the catalog"))?;
                Ok(Location::File(
                    path.parent().unwrap_or(Path::new(".")).join(rel),
                ))
            }
        }
    }
}

/// Reads a location; the token goes to the feed's own host only.
fn read(
    loc: &Location,
    feed: &Location,
    token: Option<&str>,
    limit: u64,
) -> Result<Vec<u8>, CommandError> {
    let mut data = Vec::new();
    match loc {
        Location::Web(url) => {
            let mut req = ureq::get(url.as_str())
                .header("User-Agent", agent())
                .config()
                .timeout_global(Some(Duration::from_secs(600)))
                .build();
            let same_host = matches!(feed, Location::Web(f) if f.host_str() == url.host_str() && f.port_or_known_default() == url.port_or_known_default());
            if let (Some(t), true) = (token.filter(|t| !t.trim().is_empty()), same_host) {
                req = req.header("Authorization", format!("Bearer {}", t.trim()));
            }
            let response = req
                .call()
                .map_err(|e| failed("the catalog server did not answer", e))?;
            response
                .into_body()
                .into_with_config()
                .limit(limit + 1)
                .reader()
                .take(limit + 1)
                .read_to_end(&mut data)
                .map_err(|e| failed("cannot read from the catalog server", e))?;
        }
        Location::File(path) => {
            std::fs::File::open(path)
                .and_then(|f| f.take(limit + 1).read_to_end(&mut data))
                .map_err(|e| failed(&format!("cannot read {}", path.display()), e))?;
        }
    }
    if data.len() as u64 > limit {
        return Err(CommandError::failed("the catalog file is too large"));
    }
    Ok(data)
}

pub(super) fn parse_feed(text: &str) -> Result<Feed, CommandError> {
    let feed: Feed = serde_json::from_str(text)
        .map_err(|e| failed("the catalog is no valid msh-catalog feed", e))?;
    if feed.format != "msh-catalog" || feed.version < 1 {
        return Err(CommandError::failed(
            "the catalog is no msh-catalog feed (see docs/CATALOG_FEED.md)",
        ));
    }
    Ok(feed)
}

fn load(address: &str, token: Option<&str>) -> Result<(Feed, Location), CommandError> {
    let loc = location(address)?;
    let data = read(&loc, &loc, token, MAX_FEED_BYTES)?;
    let feed = parse_feed(&String::from_utf8_lossy(&data))?;
    Ok((feed, loc))
}

fn is_library(item: &FeedItem) -> bool {
    item.kind == "library"
}

/// Whether the item belongs to the furniture or texture side of the catalog.
pub(super) fn of_kind(item: &FeedItem, kind: Kind) -> bool {
    let url = item.url.to_ascii_lowercase();
    match (item.kind.as_str(), kind) {
        ("model", Kind::Furniture) | ("texture", Kind::Textures) => true,
        // Libraries by their file type; a ZIP may hold either
        ("library", Kind::Furniture) => !url.ends_with(".sh3t"),
        ("library", Kind::Textures) => !url.ends_with(".sh3f"),
        _ => false,
    }
}

/// Items of the feed of `kind` matching the words, in the feed's order.
pub(super) fn filter<'a>(feed: &'a Feed, kind: Kind, words: &[String]) -> Vec<&'a FeedItem> {
    feed.items
        .iter()
        .filter(|i| of_kind(i, kind))
        .filter(|i| {
            let text = format!(
                "{} {} {} {}",
                i.name,
                i.category.as_deref().unwrap_or_default(),
                i.tags.join(" "),
                i.author.as_deref().unwrap_or_default()
            );
            matches(words, &text)
        })
        .collect()
}

/// A preview image as data URL (the app shows images of any server this way).
fn thumbnail(feed: &Location, item: &FeedItem, token: Option<&str>) -> Option<String> {
    let address = item.thumbnail.as_deref()?;
    let loc = resolve(feed, address).ok()?;
    let data = read(&loc, feed, token, MAX_THUMBNAIL_BYTES).ok()?;
    let lower = address.to_ascii_lowercase();
    let mime = if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(data)
    ))
}

pub(super) fn search(
    address: &str,
    token: Option<&str>,
    kind: Kind,
    words: &[String],
    offset: usize,
    limit: usize,
) -> Result<(Vec<Found>, usize, Option<String>), CommandError> {
    let (feed, loc) = load(address, token)?;
    let all = filter(&feed, kind, words);
    let total = all.len();
    let found = all
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|i| Found {
            id: i.id.clone(),
            name: i.name.clone(),
            thumbnail: thumbnail(&loc, i, token),
            author: i.author.clone(),
            license: i.license.clone().unwrap_or_default(),
            size: i.size,
            width_cm: i.tile_width,
            height_cm: i.tile_height.or(i.tile_width),
            page: None,
        })
        .collect();
    Ok((found, total, feed.name.clone()))
}

/// File name for a downloaded item: the last part of its address, else its name.
fn download_name(item: &FeedItem) -> String {
    let last = item
        .url
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default();
    let name = file_name(&percent_decode(last));
    if name.contains('.') {
        name
    } else {
        file_name(&item.name)
    }
}

fn percent_decode(s: &str) -> String {
    url::form_urlencoded::parse(s.replace('+', "%2B").as_bytes())
        .map(|(k, v)| {
            if v.is_empty() {
                k.into_owned()
            } else {
                format!("{k}={v}")
            }
        })
        .collect::<Vec<_>>()
        .join("&")
}

pub(super) fn download(
    address: &str,
    token: Option<&str>,
    id: &str,
) -> Result<Value, CommandError> {
    let (feed, loc) = load(address, token)?;
    let item = feed
        .items
        .iter()
        .find(|i| i.id == id)
        .ok_or_else(|| CommandError::failed(format!("the catalog has no item '{id}'")))?;
    let data = read(&resolve(&loc, &item.url)?, &loc, token, MAX_FILE_BYTES)?;
    let dir = download_dir(Source::Feed, id)?;
    if is_library(item)
        && !item.url.to_ascii_lowercase().ends_with(".sh3f")
        && !item.url.to_ascii_lowercase().ends_with(".sh3t")
    {
        // A library in a ZIP
        return extract_library(data, &dir);
    }
    // Models and textures get the item's name (the import takes it as default name);
    // libraries keep their file name
    let file = download_name(item);
    let target = if is_library(item) {
        dir.join(&file)
    } else {
        let ext = file.rsplit_once('.').map(|(_, e)| e).unwrap_or("bin");
        dir.join(format!("{}.{ext}", file_name(&item.name)))
    };
    std::fs::write(&target, data).map_err(|e| failed("cannot write the download", e))?;
    for f in &item.files {
        let Some(rel) = safe_relative(&f.path) else {
            continue;
        };
        let bytes = read(&resolve(&loc, &f.url)?, &loc, token, MAX_FILE_BYTES)?;
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| failed("cannot write the download", e))?;
        }
        std::fs::write(&path, bytes).map_err(|e| failed("cannot write the download", e))?;
    }
    let kind = match item.kind.as_str() {
        "library" => "library",
        "texture" => "texture",
        _ => "model",
    };
    Ok(json!({
        "path": target,
        "type": kind,
        "name": if kind == "library" { download_name(item) } else { item.name.clone() },
        "creator": item.author,
        "license": item.license,
        "category": item.category.clone().or(feed.name.clone()),
        "width_cm": item.tile_width,
        "height_cm": item.tile_height.or(item.tile_width),
        "width": item.width,
        "depth": item.depth,
        "height": item.height,
        "door_or_window": item.door_or_window,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"{"format":"msh-catalog","version":1,"name":"ACME","items":[
{"id":"chair","type":"model","name":"Chair Oslo","url":"models/chair oslo.zip","category":"Chairs","tags":["oak"],"author":"ACME","license":"internal","width":52},
{"id":"oak","type":"texture","name":"Oak floor","url":"textures/oak.jpg","tile_width":120,"tile_height":20},
{"id":"kitchens","type":"library","name":"Kitchens","url":"libraries/kitchens.sh3f"},
{"id":"tiles","type":"library","name":"Tiles","url":"libraries/tiles.sh3t"}]}"#;

    #[test]
    fn feed_items_are_filtered_by_kind_and_words() {
        let feed = parse_feed(FEED).unwrap();
        let ids = |kind, q: &str| {
            let w: Vec<String> = q.split_whitespace().map(str::to_lowercase).collect();
            filter(&feed, kind, &w)
                .iter()
                .map(|i| i.id.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(Kind::Furniture, ""), ["chair", "kitchens"]);
        assert_eq!(ids(Kind::Textures, ""), ["oak", "tiles"]);
        assert_eq!(ids(Kind::Furniture, "oak"), ["chair"]);
        assert_eq!(ids(Kind::Furniture, "chairs acme"), ["chair"]);
    }

    #[test]
    fn other_formats_are_refused() {
        assert!(parse_feed(r#"{"format":"other","version":1,"items":[]}"#).is_err());
        assert!(parse_feed("not json").is_err());
    }

    #[test]
    fn addresses_are_resolved_against_the_feed() {
        let web = location("https://cat.example.com/msh/catalog.json").unwrap();
        assert_eq!(
            resolve(&web, "models/a.zip").unwrap(),
            Location::Web(url::Url::parse("https://cat.example.com/msh/models/a.zip").unwrap())
        );
        assert_eq!(
            resolve(&web, "/files/b.jpg").unwrap(),
            Location::Web(url::Url::parse("https://cat.example.com/files/b.jpg").unwrap())
        );
        let share = location(r"\\server\catalog\catalog.json").unwrap();
        assert_eq!(
            resolve(&share, "models/a.zip").unwrap(),
            Location::File(PathBuf::from(r"\\server\catalog").join("models/a.zip"))
        );
        assert!(resolve(&share, "../secret.txt").is_err());
    }

    #[test]
    fn local_feed_is_searched_and_downloaded() {
        let dir = std::env::temp_dir().join(format!("msh-feed-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("textures")).unwrap();
        std::fs::write(dir.join("catalog.json"), FEED).unwrap();
        std::fs::write(dir.join("textures/oak.jpg"), b"jpeg").unwrap();
        let address = dir.join("catalog.json").to_string_lossy().into_owned();
        let (found, total, name) = search(&address, None, Kind::Textures, &[], 0, 10).unwrap();
        assert_eq!((total, name.as_deref()), (2, Some("ACME")));
        assert_eq!(
            (found[0].width_cm, found[0].height_cm),
            (Some(120.0), Some(20.0))
        );
        let d = download(&address, None, "oak").unwrap();
        assert_eq!(d["type"], "texture");
        assert_eq!(d["category"], "ACME");
        // Models and textures are named after the item
        assert!(Path::new(d["path"].as_str().unwrap()).ends_with("Oak floor.jpg"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn download_names_come_from_the_address() {
        let feed = parse_feed(FEED).unwrap();
        assert_eq!(download_name(&feed.items[0]), "chair oslo.zip");
    }
}
