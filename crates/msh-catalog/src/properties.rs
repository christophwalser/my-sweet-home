//! Parser für Java-`.properties`-Dateien (ISO-8859-1 mit `\uXXXX`-Escapes).

use std::collections::BTreeMap;

/// Parst den Inhalt einer `.properties`-Datei. Bei doppelten Schlüsseln gewinnt
/// der letzte Wert (wie in Java).
pub fn parse(bytes: &[u8]) -> BTreeMap<String, String> {
    // ISO-8859-1: jedes Byte ist genau ein Unicode-Zeichen
    let text: String = bytes.iter().map(|&b| b as char).collect();
    let mut map = BTreeMap::new();
    let mut lines = text.lines();

    while let Some(first) = lines.next() {
        let trimmed = first.trim_start_matches([' ', '\t', '\x0c']);
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
            continue;
        }
        // Fortsetzungszeilen: ungerade Anzahl Backslashes am Zeilenende
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
                        // Surrogatpaare (z. B. Emojis) zusammensetzen
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
        let src = b"# Kommentar\n! auch Kommentar\nid#1=eTeks#bed\nname#1 = Bett 140\\u00D7190\nkey\\ with\\ spaces:wert\nlong=eins, \\\n    zwei\nempty=\nk2 v2\nlatin=\xe4\n";
        let m = parse(src);
        assert_eq!(m["id#1"], "eTeks#bed");
        assert_eq!(m["name#1"], "Bett 140×190");
        assert_eq!(m["key with spaces"], "wert");
        assert_eq!(m["long"], "eins, zwei");
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
