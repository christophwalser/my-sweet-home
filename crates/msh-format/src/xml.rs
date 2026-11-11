//! Minimal XML tree: parsing into [`RawElement`] and writing back in the style
//! of Sweet Home 3D (single quotes, 2-space indentation).

use crate::FormatError;
use msh_model::{Attrs, RawElement, RawNode};
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;

/// Parses an XML document and returns its root element.
pub fn parse(bytes: &[u8]) -> Result<RawElement, FormatError> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut stack: Vec<RawElement> = Vec::new();
    let mut root: Option<RawElement> = None;
    let mut buf = Vec::new();

    loop {
        let event = reader.read_event_into(&mut buf).map_err(xml_err)?;
        match event {
            Event::Start(e) => stack.push(start_element(&e)?),
            Event::Empty(e) => {
                let el = start_element(&e)?;
                attach(&mut stack, &mut root, el);
            }
            Event::End(_) => {
                let el = stack
                    .pop()
                    .ok_or_else(|| FormatError::Xml("unexpected end tag".into()))?;
                attach(&mut stack, &mut root, el);
            }
            Event::Text(t) => {
                push_text(&mut stack, &t);
            }
            Event::CData(t) => push_text(&mut stack, &t),
            Event::GeneralRef(r) => {
                let resolved = if let Some(c) = r.resolve_char_ref().map_err(xml_err)? {
                    c.to_string()
                } else {
                    match &*r {
                        "amp" => "&".into(),
                        "lt" => "<".into(),
                        "gt" => ">".into(),
                        "quot" => "\"".into(),
                        "apos" => "'".into(),
                        other => {
                            return Err(FormatError::Xml(format!("unknown entity &{other};")));
                        }
                    }
                };
                push_text(&mut stack, &resolved);
            }
            Event::Eof => break,
            // Declaration, comments, DOCTYPE, processing instructions: ignored
            _ => {}
        }
        buf.clear();
    }

    if !stack.is_empty() {
        return Err(FormatError::Xml("document ends inside an element".into()));
    }
    root.ok_or_else(|| FormatError::Xml("no root element".into()))
}

fn xml_err(e: impl std::fmt::Display) -> FormatError {
    FormatError::Xml(e.to_string())
}

fn start_element(e: &BytesStart<'_>) -> Result<RawElement, FormatError> {
    let name = e.name().as_ref().to_owned();
    let mut attrs = Attrs::new();
    for a in e.attributes() {
        let a = a.map_err(xml_err)?;
        let key = a.key.as_ref().to_owned();
        // Entities and character references only, without attribute value normalization,
        // so values read back exactly as written
        let value = quick_xml::escape::unescape(&a.value)
            .map_err(xml_err)?
            .into_owned();
        attrs.0.push((key, value));
    }
    Ok(RawElement {
        name,
        attrs,
        children: Vec::new(),
    })
}

fn attach(stack: &mut [RawElement], root: &mut Option<RawElement>, el: RawElement) {
    match stack.last_mut() {
        Some(parent) => parent.children.push(RawNode::Element(el)),
        None => *root = Some(el),
    }
}

fn push_text(stack: &mut [RawElement], s: &str) {
    if let Some(parent) = stack.last_mut() {
        if let Some(RawNode::Text(prev)) = parent.children.last_mut() {
            prev.push_str(s);
        } else {
            parent.children.push(RawNode::Text(s.to_owned()));
        }
    }
}

/// Writes an element as a complete XML document.
pub fn write_document(root: &RawElement) -> String {
    let mut out = String::with_capacity(64 * 1024);
    out.push_str("<?xml version='1.0'?>\n");
    write_element(&mut out, root, 0);
    out
}

fn write_element(out: &mut String, el: &RawElement, depth: usize) {
    indent(out, depth);
    out.push('<');
    out.push_str(&el.name);
    for (k, v) in el.attrs.iter() {
        out.push(' ');
        out.push_str(k);
        out.push_str("='");
        escape_attr(out, v);
        out.push('\'');
    }

    let has_elements = el.children.iter().any(|c| matches!(c, RawNode::Element(_)));
    let text: String = el
        .children
        .iter()
        .filter_map(|c| match c {
            RawNode::Text(t) => Some(t.as_str()),
            RawNode::Element(_) => None,
        })
        .collect();

    if !has_elements && text.is_empty() {
        out.push_str("/>\n");
    } else if !has_elements {
        // Text-only element (e.g. <text>): keep the text exactly as is
        out.push('>');
        escape_text(out, &text);
        out.push_str("</");
        out.push_str(&el.name);
        out.push_str(">\n");
    } else {
        out.push_str(">\n");
        for child in &el.children {
            match child {
                RawNode::Element(c) => write_element(out, c, depth + 1),
                // Whitespace between elements is replaced by our own indentation
                RawNode::Text(t) if t.trim().is_empty() => {}
                RawNode::Text(t) => {
                    indent(out, depth + 1);
                    escape_text(out, t);
                    out.push('\n');
                }
            }
        }
        indent(out, depth);
        out.push_str("</");
        out.push_str(&el.name);
        out.push_str(">\n");
    }
}

fn indent(out: &mut String, depth: usize) {
    for _ in 0..depth {
        out.push_str("  ");
    }
}

fn escape_attr(out: &mut String, v: &str) {
    for c in v.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\'' => out.push_str("&apos;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            '\t' => out.push_str("&#9;"),
            c => out.push(c),
        }
    }
}

fn escape_text(out: &mut String, v: &str) {
    for c in v.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\r' => out.push_str("&#13;"),
            c => out.push(c),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_write_roundtrip() {
        let src = "<?xml version='1.0'?>\n<home a='1 &amp; 2' b=\"x'y\">\n  <label x='1'>\n    <text>Line 1&#10;Line &lt;2&gt;</text>\n  </label>\n  <wall/>\n</home>\n";
        let root = parse(src.as_bytes()).unwrap();
        assert_eq!(root.name, "home");
        assert_eq!(root.attrs.0[0].1, "1 & 2");
        assert_eq!(root.attrs.0[1].1, "x'y");
        let out = write_document(&root);
        let again = parse(out.as_bytes()).unwrap();
        assert_eq!(root_without_ws(root), root_without_ws(again));
        assert!(out.contains("<text>Line 1\nLine &lt;2&gt;</text>"));
    }

    fn root_without_ws(mut el: RawElement) -> RawElement {
        el.children
            .retain(|c| !matches!(c, RawNode::Text(t) if t.trim().is_empty()));
        el.children = el
            .children
            .into_iter()
            .map(|c| match c {
                RawNode::Element(e) => RawNode::Element(root_without_ws(e)),
                t => t,
            })
            .collect();
        el
    }
}
