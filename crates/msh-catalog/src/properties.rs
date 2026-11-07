//! Parser for Java `.properties` files (ISO-8859-1 with `\uXXXX` escapes).

use std::collections::BTreeMap;

/// Parses the content of a `.properties` file. For duplicate keys the last
/// value wins (as in Java).
pub fn parse(bytes: &[u8]) -> BTreeMap<String, String> {
    // ISO-8859-1: every byte is exactly one Unicode character
    let text: String = bytes.iter().map(|&b| b as char).collect();
    let mut map = BTreeMap::new();
    let mut lines = text.lines();

    while let Some(first) = lines.next() {
        let trimmed = first.trim_start_matches([' ', '\t', '\x0c']);
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
            continue;
        }
        // Continuation lines: odd number of backslashes at the end of the line
        let mut logical = trimmed.to_owned();
        while ends_with_continuation(&logical) {
            logical.pop();
            match lines.next() {
                Some(next) => logical.push_str(next.trim_start_matches([' ', '\t', '\x0c'])),
                None => break,
            }
        }
        let (key, value) = split_key_value(&logical);
        map.insert(unescape(key), unescape(value));
    }
    map
}

fn ends_with_continuation(s: &str) -> bool {
    s.chars().rev().take_while(|&c| c == '\\').count() % 2 == 1
}

fn split_key_value(line: &str) -> (&str, &str) {
    let mut escaped = false;
    for (i, c) in line.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            '=' | ':' | ' ' | '\t' | '\x0c' => {
                let key = &line[..i];
                let mut rest = line[i..].trim_start_matches([' ', '\t', '\x0c']);
                if !matches!(c, '=' | ':') {
                    if let Some(r) = rest.strip_prefix(['=', ':']) {
                        rest = r.trim_start_matches([' ', '\t', '\x0c']);
                    }
                } else {
                    rest = rest[1..].trim_start_matches([' ', '\t', '\x0c']);
                }
                return (key, rest);
            }
            _ => {}
        }
    }
    (line, "")
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('f') => out.push('\x0c'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    Some(ch) => out.push(ch),
                    None => {
                        // Combine surrogate pairs (e.g. emojis)
                        if let Ok(hi) = u16::from_str_radix(&hex, 16) {
                            let rest: String = chars.clone().take(6).collect();
                            if let Some(lo_hex) = rest.strip_prefix("\\u")
                                && let Ok(lo) = u16::from_str_radix(lo_hex, 16)
                                && let Some(Ok(ch)) = char::decode_utf16([hi, lo]).next()
                            {
                                out.push(ch);
                                for _ in 0..6 {
                                    chars.next();
                                }
                                continue;
                            }
                        }
                        out.push('\u{FFFD}');
                    }
                }
            }
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_java_properties() {
        let src = b"# comment\n! another comment\nid#1=eTeks#bed\nname#1 = Bed 140\\u00D7190\nkey\\ with\\ spaces:value\nlong=one, \\\n    two\nempty=\nk2 v2\nlatin=\xe4\n";
        let m = parse(src);
        assert_eq!(m["id#1"], "eTeks#bed");
        assert_eq!(m["name#1"], "Bed 140×190");
        assert_eq!(m["key with spaces"], "value");
        assert_eq!(m["long"], "one, two");
        assert_eq!(m["empty"], "");
        assert_eq!(m["k2"], "v2");
        assert_eq!(m["latin"], "ä");
    }

    #[test]
    fn surrogate_pairs() {
        let m = parse(b"e=\\uD83D\\uDE00!\n");
        assert_eq!(m["e"], "😀!");
    }
}
