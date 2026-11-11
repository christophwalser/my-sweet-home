//! Size limits for reading ZIP entries of untrusted files (`.sh3d`, `.sh3f`, `.sh3t`, model
//! and texture packages).
//!
//! The size stored in a ZIP header is not trusted: data is read through a limit, and the
//! buffer grows with the data actually read. This keeps crafted files and ZIP bombs from
//! exhausting memory, which would abort the whole application.

use std::io::{self, Read};

/// Largest uncompressed size of a single entry.
pub const MAX_ENTRY_SIZE: u64 = 512 * 1024 * 1024;

/// Largest uncompressed size of all entries of one file.
pub const MAX_TOTAL_SIZE: u64 = 1024 * 1024 * 1024;

/// Largest buffer reserved up front from the size a ZIP header declares.
const MAX_INITIAL_CAPACITY: u64 = 16 * 1024 * 1024;

/// Reads one entry of at most [`MAX_ENTRY_SIZE`] bytes; `declared_size` (from the ZIP
/// header) only sizes the initial buffer.
pub fn read_entry(reader: impl Read, declared_size: u64) -> io::Result<Vec<u8>> {
    read_limited(reader, declared_size, MAX_ENTRY_SIZE)
}

/// Remaining size for the entries of one file, starting at [`MAX_TOTAL_SIZE`].
#[derive(Debug, Clone, Copy)]
pub struct SizeBudget {
    remaining: u64,
}

impl Default for SizeBudget {
    fn default() -> Self {
        Self::new(MAX_TOTAL_SIZE)
    }
}

impl SizeBudget {
    pub fn new(total: u64) -> Self {
        Self { remaining: total }
    }

    /// Reads one entry like [`read_entry`] and charges it to the budget.
    pub fn read_entry(&mut self, reader: impl Read, declared_size: u64) -> io::Result<Vec<u8>> {
        let limit = self.remaining.min(MAX_ENTRY_SIZE);
        let data = read_limited(reader, declared_size, limit)?;
        self.remaining -= data.len() as u64;
        Ok(data)
    }
}

fn read_limited(reader: impl Read, declared_size: u64, limit: u64) -> io::Result<Vec<u8>> {
    let capacity = declared_size.min(limit).min(MAX_INITIAL_CAPACITY);
    let mut data = Vec::with_capacity(usize::try_from(capacity).unwrap_or(0));
    reader
        .take(limit.saturating_add(1))
        .read_to_end(&mut data)?;
    if data.len() as u64 > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "the file contains more data than allowed ({} MB)",
                limit / (1024 * 1024)
            ),
        ));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn huge_declared_size_does_not_reserve_memory() {
        let data = read_entry(&b"abc"[..], u64::MAX).unwrap();
        assert_eq!(data, b"abc");
        assert!(data.capacity() as u64 <= MAX_INITIAL_CAPACITY);
    }

    #[test]
    fn budget_limits_the_total_size() {
        let mut budget = SizeBudget::new(5);
        assert_eq!(budget.read_entry(&b"abc"[..], 3).unwrap(), b"abc");
        let err = budget.read_entry(&b"abc"[..], 3).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn entry_exactly_at_the_limit_is_accepted() {
        let mut budget = SizeBudget::new(3);
        assert_eq!(budget.read_entry(&b"abc"[..], 0).unwrap(), b"abc");
    }
}
