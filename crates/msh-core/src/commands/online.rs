//! Online sources of furniture, textures and libraries: the free libraries of Sweet Home 3D
//! (on SourceForge), CC0 textures of ambientCG and CC0 textures and models of Poly Haven.
//!
//! `online_search` lists what a source offers, `online_download` fetches one item into a
//! temporary folder and returns its local path; the import commands (`library_import`,
//! `texture_import`, `furniture_import`) then add it to the user's libraries. Nothing is
//! sent to the sources except the search text.
//!
//! Users can add their own catalog servers as feeds (`source: "feed"`, see `feed` and
//! docs/CATALOG_FEED.md).

mod feed;

use crate::registry::{CommandError, Registry};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::Read;
use std::path::{Component, PathBuf};
use std::time::Duration;

/// Largest file downloaded from a source.
const MAX_DOWNLOAD_BYTES: u64 = 500 * 1024 * 1024;
const SOURCEFORGE_RSS: &str = "https://sourceforge.net/projects/sweethome3d/rss";
const SOURCEFORGE_FILES: &str = "https://sourceforge.net/projects/sweethome3d/files";
const AMBIENTCG_API: &str = "https://ambientcg.com/api/v3/assets";
const POLYHAVEN_API: &str = "https://api.polyhaven.com";

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum Source {
    /// Free furniture and texture libraries of Sweet Home 3D (.sh3f / .sh3t)
    Sh3d,
    /// CC0 textures (PBR materials) of ambientcg.com
    Ambientcg,
    /// CC0 textures and models of polyhaven.com
    Polyhaven,
    /// A catalog feed of the user's own catalog server (msh-catalog format): give `url`
    Feed,
}

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Furniture,
    Textures,
}

#[derive(Deserialize, JsonSchema)]
struct SearchParams {
    source: Source,
    /// furniture or textures (ambientCG has textures only)
    kind: Kind,
    /// Search words (all must match); empty lists everything
    query: Option<String>,
    /// First result (for paging, default 0)
    offset: Option<usize>,
    /// Number of results (default 40, at most 200)
    limit: Option<usize>,
    /// Feeds: address of the feed (https://…, a file or a file share)
    url: Option<String>,
    /// Feeds: access token, sent as bearer token to the feed's host only
    token: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct DownloadParams {
    source: Source,
    kind: Kind,
    /// ID of a search result
    id: String,
    /// Resolution of textures and models: 1k (default), 2k or 4k
    resolution: Option<String>,
    /// Feeds: address of the feed
    url: Option<String>,
    /// Feeds: access token
    token: Option<String>,
}

/// One item a source offers.
#[derive(Serialize, Debug, Clone, PartialEq)]
struct Found {
    id: String,
    name: String,
    /// Preview image (https), if the source has one
    thumbnail: Option<String>,
    author: Option<String>,
    license: String,
    /// Download size in bytes, if known
    size: Option<u64>,
    /// Real size of one texture tile in cm, if known
    width_cm: Option<f32>,
    height_cm: Option<f32>,
    /// Page of the item on the source's website
    page: Option<String>,
}

fn agent() -> String {
    format!(
        "MySweetHome/{} (home planner compatible with Sweet Home 3D)",
        env!("CARGO_PKG_VERSION")
    )
}

fn failed(what: &str, e: impl std::fmt::Display) -> CommandError {
    CommandError::failed(format!("{what}: {e}"))
}

fn get_text(url: &str, query: &[(&str, &str)]) -> Result<String, CommandError> {
    let mut req = ureq::get(url)
        .set("User-Agent", &agent())
        .timeout(Duration::from_secs(30));
    for (k, v) in query {
        req = req.query(k, v);
    }
    req.call()
        .map_err(|e| failed("the online source did not answer", e))?
        .into_string()
        .map_err(|e| failed("the online source sent no text", e))
}

fn get_bytes(url: &str) -> Result<Vec<u8>, CommandError> {
    let response = ureq::get(url)
        .set("User-Agent", &agent())
        .timeout(Duration::from_secs(600))
        .call()
        .map_err(|e| failed("the download failed", e))?;
    let mut data = Vec::new();
    response
        .into_reader()
        .take(MAX_DOWNLOAD_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|e| failed("the download failed", e))?;
    if data.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err(CommandError::failed("the download is larger than 500 MB"));
    }
    Ok(data)
}

/// Lower-case words of a search text.
fn words(query: Option<&str>) -> Vec<String> {
    query
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_lowercase)
        .collect()
}

fn matches(words: &[String], text: &str) -> bool {
    let text = text.to_lowercase();
    words.iter().all(|w| text.contains(w))
}

/// A temporary folder for one download (emptied first).
fn download_dir(source: Source, id: &str) -> Result<PathBuf, CommandError> {
    let safe: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let dir = std::env::temp_dir()
        .join("msh-online")
        .join(format!("{source:?}-{safe}").to_lowercase());
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| failed("cannot create a temporary folder", e))?;
    Ok(dir)
}

/// A file name for a name of the source (keeps letters, digits, spaces and a few signs).
fn file_name(name: &str) -> String {
    let n: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " -_().".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let n = n.trim().to_owned();
    if n.is_empty() { "item".into() } else { n }
}

// ---------------------------------------------------------------- Sweet Home 3D (SourceForge)

/// Library ZIPs of the newest version folder in a SourceForge RSS listing.
fn parse_sh3d_rss(xml: &str, words: &[String]) -> Vec<Found> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut items: Vec<(String, Option<u64>)> = Vec::new();
    let mut in_title = false;
    let mut title = String::new();
    let mut size: Option<u64> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                "item" => {
                    title.clear();
                    size = None;
                }
                "title" => in_title = true,
                "content" => {
                    size = e.attributes().flatten().find_map(|a| {
                        (a.key.local_name().as_ref() == "filesize")
                            .then(|| a.value.parse().ok())
                            .flatten()
                    });
                }
                _ => {}
            },
            Ok(Event::CData(t)) if in_title => {
                title.push_str(&t.into_inner());
            }
            Ok(Event::Text(t)) if in_title => {
                title.push_str(&t.into_inner());
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                "title" => in_title = false,
                "item" => items.push((title.trim().to_owned(), size)),
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    // The listing is newest first: the folder of the first ZIP is the current version
    let folder = |path: &str| path.rsplit_once('/').map(|(f, _)| f.to_owned());
    let Some(newest) = items
        .iter()
        .find(|(p, _)| p.to_ascii_lowercase().ends_with(".zip"))
        .and_then(|(p, _)| folder(p))
    else {
        return Vec::new();
    };
    items
        .into_iter()
        .filter(|(p, _)| {
            p.to_ascii_lowercase().ends_with(".zip") && folder(p).as_ref() == Some(&newest)
        })
        .filter_map(|(path, size)| {
            let file = path.rsplit('/').next()?.trim_end_matches(".zip").to_owned();
            let version = newest.rsplit('-').next().unwrap_or_default();
            let name = file
                .trim_start_matches("3DModels-")
                .trim_start_matches("Textures-")
                .trim_end_matches(&format!("-{version}"))
                .replace('-', " ")
                .replace("CC 0", "CC0")
                .replace("CC BY", "CC-BY");
            let license = if name.contains("CC0") {
                "CC0"
            } else if name.contains("CC-BY") {
                "CC-BY"
            } else {
                "Free (see the library)"
            };
            matches(words, &name).then(|| Found {
                id: path.clone(),
                name,
                thumbnail: None,
                author: None,
                license: license.into(),
                size,
                width_cm: None,
                height_cm: None,
                page: Some(format!("{SOURCEFORGE_FILES}{newest}/")),
            })
        })
        .collect()
}

fn search_sh3d(kind: Kind, words: &[String]) -> Result<Vec<Found>, CommandError> {
    let path = match kind {
        Kind::Furniture => "/SweetHome3D-models",
        Kind::Textures => "/SweetHome3D-textures",
    };
    // SourceForge refuses an encoded slash in the path parameter (and a limit parameter);
    // its listing is newest first, which is all we need
    let xml = get_text(&format!("{SOURCEFORGE_RSS}?path={path}"), &[])?;
    Ok(parse_sh3d_rss(&xml, words))
}

/// Downloads a library ZIP and unpacks its .sh3f / .sh3t file.
fn download_sh3d(id: &str) -> Result<Value, CommandError> {
    if !id.starts_with("/SweetHome3D-") || id.contains("..") || !id.ends_with(".zip") {
        return Err(CommandError::failed("unknown Sweet Home 3D library"));
    }
    let data = get_bytes(&format!("{SOURCEFORGE_FILES}{id}/download"))?;
    let dir = download_dir(Source::Sh3d, id.rsplit('/').next().unwrap_or(id))?;
    extract_library(data, &dir)
}

/// Unpacks the .sh3f / .sh3t file of a library ZIP into `dir`.
fn extract_library(data: Vec<u8>, dir: &std::path::Path) -> Result<Value, CommandError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|e| failed("the download is no ZIP file", e))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| failed("cannot read the ZIP file", e))?;
        let name = entry
            .name()
            .map_err(|e| failed("cannot read the ZIP file", e))?
            .replace('\\', "/");
        let lower = name.to_ascii_lowercase();
        if !(lower.ends_with(".sh3f") || lower.ends_with(".sh3t")) {
            continue;
        }
        let file = name.rsplit('/').next().unwrap_or(&name).to_owned();
        let target = dir.join(&file);
        let mut out =
            std::fs::File::create(&target).map_err(|e| failed("cannot write the library", e))?;
        let limit = msh_format::limits::MAX_ENTRY_SIZE;
        let copied = std::io::copy(&mut (&mut entry).take(limit + 1), &mut out)
            .map_err(|e| failed("cannot write the library", e))?;
        if copied > limit {
            drop(out);
            let _ = std::fs::remove_file(&target);
            return Err(CommandError::failed(
                "the library in the ZIP file is too large",
            ));
        }
        return Ok(json!({ "path": target, "type": "library", "name": file }));
    }
    Err(CommandError::failed("the ZIP file contains no library"))
}

// ---------------------------------------------------------------- ambientCG

fn parse_ambientcg(body: &str) -> Result<(Vec<Found>, usize), CommandError> {
    let v: Value =
        serde_json::from_str(body).map_err(|e| failed("unexpected answer of ambientCG", e))?;
    let total = v["totalResults"].as_u64().unwrap_or(0) as usize;
    let found = v["assets"]
        .as_array()
        .map(|assets| {
            assets
                .iter()
                .filter_map(|a| {
                    let id = a["id"].as_str()?.to_owned();
                    let dim = |k: &str| {
                        a["dimensions"][k]
                            .as_f64()
                            .filter(|v| *v > 0.0)
                            .map(|v| v as f32)
                    };
                    Some(Found {
                        name: a["title"].as_str().unwrap_or(&id).to_owned(),
                        thumbnail: a["thumbnails"]["256-PNG"]
                            .as_str()
                            .or_else(|| a["thumbnails"]["128-PNG"].as_str())
                            .map(str::to_owned),
                        author: Some("ambientCG".into()),
                        license: "CC0".into(),
                        size: a["downloads"]
                            .as_array()
                            .and_then(|d| d.iter().find(|x| x["attributes"] == "1K-JPG"))
                            .and_then(|x| x["size"].as_u64()),
                        width_cm: dim("width"),
                        height_cm: dim("height"),
                        page: a["url"].as_str().map(str::to_owned),
                        id,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok((found, total))
}

fn search_ambientcg(
    query: &str,
    offset: usize,
    limit: usize,
) -> Result<(Vec<Found>, usize), CommandError> {
    let body = get_text(
        AMBIENTCG_API,
        &[
            ("type", "material"),
            ("q", query),
            ("sort", "popular"),
            ("limit", &limit.to_string()),
            ("offset", &offset.to_string()),
            ("include", "title,thumbnails,dimensions,downloads,url"),
        ],
    )?;
    parse_ambientcg(&body)
}

/// URL of the material package (ZIP) in the resolution, from an ambientCG answer.
fn ambientcg_zip(body: &str, resolution: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    let downloads = v["assets"][0]["downloads"].as_array()?;
    let wanted = format!("{}-JPG", resolution.to_ascii_uppercase());
    downloads
        .iter()
        .find(|d| d["attributes"] == wanted.as_str())
        .or_else(|| downloads.iter().find(|d| d["attributes"] == "1K-JPG"))
        .and_then(|d| d["url"].as_str())
        .map(str::to_owned)
}

fn download_ambientcg(id: &str, resolution: &str) -> Result<Value, CommandError> {
    let body = get_text(
        AMBIENTCG_API,
        &[("id", id), ("include", "title,downloads,dimensions")],
    )?;
    let (found, _) = parse_ambientcg(&body)?;
    let item = found
        .into_iter()
        .next()
        .ok_or_else(|| CommandError::failed("unknown ambientCG material"))?;
    let url = ambientcg_zip(&body, resolution)
        .ok_or_else(|| CommandError::failed("the material has no JPG download"))?;
    let data = get_bytes(&url)?;
    let path = download_dir(Source::Ambientcg, id)?.join(format!("{}.zip", file_name(&item.name)));
    std::fs::write(&path, data).map_err(|e| failed("cannot write the download", e))?;
    Ok(json!({
        "path": path, "type": "texture", "name": item.name, "creator": "ambientCG",
        "license": "CC0", "width_cm": item.width_cm, "height_cm": item.height_cm,
    }))
}

// ---------------------------------------------------------------- Poly Haven

/// Assets of a Poly Haven listing (`/assets?t=…`) matching the words, most downloaded first.
fn parse_polyhaven(body: &str, words: &[String], kind: Kind) -> Result<Vec<Found>, CommandError> {
    let v: Value =
        serde_json::from_str(body).map_err(|e| failed("unexpected answer of Poly Haven", e))?;
    let map = v
        .as_object()
        .ok_or_else(|| CommandError::failed("unexpected answer of Poly Haven"))?;
    let mut found: Vec<(u64, Found)> = map
        .iter()
        .filter_map(|(id, a)| {
            let name = a["name"].as_str().unwrap_or(id).to_owned();
            let list = |k: &str| {
                a[k].as_array()
                    .map(|x| {
                        x.iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .unwrap_or_default()
            };
            let text = format!("{id} {name} {} {}", list("tags"), list("categories"));
            if !matches(words, &text) {
                return None;
            }
            let authors = a["authors"]
                .as_object()
                .map(|o| o.keys().cloned().collect::<Vec<_>>().join(", "));
            // Texture dimensions are in mm
            let dim = |i: usize| {
                (kind == Kind::Textures)
                    .then(|| a["dimensions"][i].as_f64())
                    .flatten()
                    .filter(|v| *v > 0.0)
                    .map(|v| (v / 10.0) as f32)
            };
            Some((
                a["download_count"].as_u64().unwrap_or(0),
                Found {
                    id: id.clone(),
                    name,
                    thumbnail: a["thumbnail_url"].as_str().map(str::to_owned),
                    author: authors,
                    license: "CC0".into(),
                    size: None,
                    width_cm: dim(0),
                    height_cm: dim(1),
                    page: Some(format!("https://polyhaven.com/a/{id}")),
                },
            ))
        })
        .collect();
    found.sort_by_key(|(downloads, f)| (std::cmp::Reverse(*downloads), f.name.clone()));
    Ok(found.into_iter().map(|(_, f)| f).collect())
}

fn search_polyhaven(kind: Kind, words: &[String]) -> Result<Vec<Found>, CommandError> {
    let t = if kind == Kind::Textures {
        "textures"
    } else {
        "models"
    };
    let body = get_text(&format!("{POLYHAVEN_API}/assets"), &[("t", t)])?;
    parse_polyhaven(&body, words, kind)
}

/// A relative path inside the download folder that does not leave it.
fn safe_relative(name: &str) -> Option<PathBuf> {
    let p = PathBuf::from(name.replace('\\', "/"));
    p.components()
        .all(|c| matches!(c, Component::Normal(_)))
        .then_some(p)
}

fn download_polyhaven(kind: Kind, id: &str, resolution: &str) -> Result<Value, CommandError> {
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(CommandError::failed("unknown Poly Haven asset"));
    }
    let info: Value = serde_json::from_str(&get_text(&format!("{POLYHAVEN_API}/info/{id}"), &[])?)
        .map_err(|e| failed("unexpected answer of Poly Haven", e))?;
    let name = info["name"].as_str().unwrap_or(id).to_owned();
    let authors = info["authors"]
        .as_object()
        .map(|o| o.keys().cloned().collect::<Vec<_>>().join(", "));
    let files: Value =
        serde_json::from_str(&get_text(&format!("{POLYHAVEN_API}/files/{id}"), &[])?)
            .map_err(|e| failed("unexpected answer of Poly Haven", e))?;
    let pick = |group: &Value| -> Option<Value> {
        group.get(resolution).or_else(|| group.get("1k")).cloned()
    };
    let dir = download_dir(Source::Polyhaven, id)?;
    match kind {
        Kind::Textures => {
            let file = pick(&files["Diffuse"])
                .and_then(|r| r["jpg"]["url"].as_str().map(str::to_owned))
                .ok_or_else(|| CommandError::failed("the texture has no color map"))?;
            let path = dir.join(format!("{}.jpg", file_name(&name)));
            std::fs::write(&path, get_bytes(&file)?)
                .map_err(|e| failed("cannot write the download", e))?;
            let dim = |i: usize| info["dimensions"][i].as_f64().map(|v| (v / 10.0) as f32);
            Ok(json!({
                "path": path, "type": "texture", "name": name,
                "creator": authors.map(|a| format!("{a} (Poly Haven)")).unwrap_or("Poly Haven".into()),
                "license": "CC0", "width_cm": dim(0), "height_cm": dim(1),
            }))
        }
        Kind::Furniture => {
            let gltf = pick(&files["gltf"])
                .map(|r| r["gltf"].clone())
                .filter(|g| g["url"].is_string())
                .ok_or_else(|| CommandError::failed("the model has no glTF download"))?;
            // The main file gets the asset's name: the import takes it as the default name
            let main = dir.join(format!("{}.gltf", file_name(&name)));
            std::fs::write(&main, get_bytes(gltf["url"].as_str().unwrap_or_default())?)
                .map_err(|e| failed("cannot write the download", e))?;
            if let Some(include) = gltf["include"].as_object() {
                for (rel, f) in include {
                    let (Some(rel), Some(url)) = (safe_relative(rel), f["url"].as_str()) else {
                        continue;
                    };
                    let target = dir.join(rel);
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent)
                            .map_err(|e| failed("cannot write the download", e))?;
                    }
                    std::fs::write(&target, get_bytes(url)?)
                        .map_err(|e| failed("cannot write the download", e))?;
                }
            }
            Ok(json!({
                "path": main, "type": "model", "name": name,
                "creator": authors.map(|a| format!("{a} (Poly Haven)")).unwrap_or("Poly Haven".into()),
                "license": "CC0",
            }))
        }
    }
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "online_search",
        "Searches an online source: 'sh3d' (the free furniture and texture libraries of Sweet \
         Home 3D), 'ambientcg' (CC0 textures), 'polyhaven' (CC0 textures and furniture \
         models) or 'feed' (a catalog server of the user, msh-catalog format; give url and, if \
         needed, token). Returns items with id, name, preview image, author, license and, for \
         textures, the real size of one tile. Download one with online_download.",
        false,
        |_doc, p: SearchParams| {
            let w = words(p.query.as_deref());
            let offset = p.offset.unwrap_or(0);
            let limit = p.limit.unwrap_or(40).clamp(1, 200);
            let (items, total) = match (p.source, p.kind) {
                (Source::Ambientcg, Kind::Furniture) => {
                    return Err(CommandError::failed("ambientCG offers textures only"));
                }
                (Source::Ambientcg, Kind::Textures) => {
                    search_ambientcg(p.query.as_deref().unwrap_or_default(), offset, limit)?
                }
                (Source::Sh3d, kind) => {
                    let all = search_sh3d(kind, &w)?;
                    let total = all.len();
                    (all.into_iter().skip(offset).take(limit).collect(), total)
                }
                (Source::Polyhaven, kind) => {
                    let all = search_polyhaven(kind, &w)?;
                    let total = all.len();
                    (all.into_iter().skip(offset).take(limit).collect(), total)
                }
                (Source::Feed, kind) => {
                    let url = p.url.as_deref().ok_or_else(|| CommandError::failed("give the url of the feed"))?;
                    let (items, total, name) = feed::search(url, p.token.as_deref(), kind, &w, offset, limit)?;
                    return Ok(json!({ "items": items, "total": total, "offset": offset, "catalog": name }));
                }
            };
            Ok(json!({ "items": items, "total": total, "offset": offset }))
        },
    );
    r.add(
        "online_download",
        "Downloads an item found with online_search into a temporary folder and returns its \
         local path and kind: a library (import it with library_import), a texture (with \
         texture_import, using the returned size, name and creator) or a furniture model \
         (with furniture_import).",
        false,
        |_doc, p: DownloadParams| {
            let resolution = p.resolution.as_deref().unwrap_or("1k").to_ascii_lowercase();
            if !matches!(resolution.as_str(), "1k" | "2k" | "4k") {
                return Err(CommandError::failed("resolution must be 1k, 2k or 4k"));
            }
            match p.source {
                Source::Sh3d => download_sh3d(&p.id),
                Source::Ambientcg => download_ambientcg(&p.id, &resolution),
                Source::Polyhaven => download_polyhaven(p.kind, &p.id, &resolution),
                Source::Feed => feed::download(
                    p.url
                        .as_deref()
                        .ok_or_else(|| CommandError::failed("give the url of the feed"))?,
                    p.token.as_deref(),
                    &p.id,
                ),
            }
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sh3d_rss_lists_the_newest_libraries() {
        let rss = r#"<?xml version="1.0"?><rss xmlns:media="http://video.search.yahoo.com/mrss/"><channel>
<item><title><![CDATA[/SweetHome3D-models/3DModels-1.9.3/3DModels-BlendSwap-CC-0-1.9.3.zip]]></title>
<media:content type="application/zip" url="https://x/download" filesize="23762967"/></item>
<item><title><![CDATA[/SweetHome3D-models/3DModels-1.9.3/3DModels-Contributions-1.9.3.zip]]></title>
<media:content type="application/zip" url="https://y/download" filesize="29028667"/></item>
<item><title><![CDATA[/SweetHome3D-models/3DModels-1.9.2/3DModels-Contributions-1.9.2.zip]]></title>
<media:content type="application/zip" url="https://z/download" filesize="1"/></item>
</channel></rss>"#;
        let all = parse_sh3d_rss(rss, &[]);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "BlendSwap CC0");
        assert_eq!(all[0].license, "CC0");
        assert_eq!(all[0].size, Some(23762967));
        assert_eq!(all[1].name, "Contributions");
        let some = parse_sh3d_rss(rss, &words(Some("contri")));
        assert_eq!(some.len(), 1);
    }

    #[test]
    fn ambientcg_answer_gives_tile_size_and_package() {
        let body = r#"{"totalResults":295,"assets":[{"id":"Wood096","title":"Wood 096",
"url":"https://ambientcg.com/a/Wood096","dimensions":{"width":50,"height":50,"depth":0},
"thumbnails":{"256-PNG":"https://img/256.png"},
"downloads":[{"attributes":"1K-JPG","url":"https://ambientcg.com/get?file=Wood096_1K-JPG.zip","size":5358165},
{"attributes":"2K-JPG","url":"https://ambientcg.com/get?file=Wood096_2K-JPG.zip","size":19620619}]}]}"#;
        let (found, total) = parse_ambientcg(body).unwrap();
        assert_eq!(total, 295);
        assert_eq!(found[0].name, "Wood 096");
        assert_eq!(
            (found[0].width_cm, found[0].height_cm),
            (Some(50.0), Some(50.0))
        );
        assert_eq!(found[0].size, Some(5358165));
        assert_eq!(
            ambientcg_zip(body, "2k").as_deref(),
            Some("https://ambientcg.com/get?file=Wood096_2K-JPG.zip")
        );
        // A resolution that is not offered falls back to 1K
        assert!(ambientcg_zip(body, "4k").unwrap().contains("1K-JPG"));
    }

    #[test]
    fn polyhaven_listing_is_filtered_and_sorted() {
        let body = r#"{
"oak_floor":{"name":"Oak Floor","tags":["wood","floor"],"categories":["floor"],"authors":{"Rob":"All"},"dimensions":[2000,1000],"download_count":5,"thumbnail_url":"https://cdn/oak.png"},
"walnut":{"name":"Walnut Veneer","tags":["wood"],"categories":["wood"],"authors":{"Jen":"All"},"dimensions":[1000,1000],"download_count":50},
"brick":{"name":"Red Brick","tags":["brick"],"categories":["wall"],"download_count":99}}"#;
        let found = parse_polyhaven(body, &words(Some("wood")), Kind::Textures).unwrap();
        assert_eq!(
            found.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
            ["walnut", "oak_floor"]
        );
        assert_eq!(
            (found[1].width_cm, found[1].height_cm),
            (Some(200.0), Some(100.0))
        );
        assert_eq!(found[1].author.as_deref(), Some("Rob"));
        // Models have no tile size
        let models = parse_polyhaven(body, &[], Kind::Furniture).unwrap();
        assert!(models.iter().all(|f| f.width_cm.is_none()));
    }

    #[test]
    fn unsafe_names_are_refused() {
        assert!(safe_relative("../x.jpg").is_none());
        assert!(safe_relative("textures/a.jpg").is_some());
        assert_eq!(file_name("Arm Chair 01"), "Arm Chair 01");
        assert_eq!(file_name("a/b:c"), "a_b_c");
    }

    #[test]
    #[ignore = "needs the internet"]
    fn live_search_of_all_sources() {
        assert!(!search_sh3d(Kind::Furniture, &[]).unwrap().is_empty());
        assert!(!search_ambientcg("wood", 0, 5).unwrap().0.is_empty());
        assert!(
            !search_polyhaven(Kind::Furniture, &words(Some("chair")))
                .unwrap()
                .is_empty()
        );
    }
}
