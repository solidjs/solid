//! xxHash32 over UTF-8 bytes, matching the JS implementation vendored in
//! vite-plugin-solid (`src/server-functions/xxhash32.ts`, itself hoisted from
//! solid-start). Server-function IDs are `hash(relative path)-<counter>`, a
//! frozen wire contract — the hex digest here must match the JS output
//! byte-for-byte so manifests from either compiler are interchangeable.
//!
//! The JS source decomposes each 32-bit multiply into 16-bit halves to stay
//! within float53 precision; that decomposition is exactly `u32` wrapping
//! arithmetic, so the straightforward port below reproduces it.

const PRIME32_1: u32 = 2654435761;
const PRIME32_2: u32 = 2246822519;
const PRIME32_3: u32 = 3266489917;
const PRIME32_4: u32 = 668265263;
const PRIME32_5: u32 = 374761393;

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

pub(crate) fn xxhash32(input: &str, seed: u32) -> u32 {
    let bytes = input.as_bytes();
    let len = bytes.len();

    let mut acc: u32;
    let mut offset = 0usize;

    if len >= 16 {
        let mut acc_n = [
            seed.wrapping_add(PRIME32_1).wrapping_add(PRIME32_2),
            seed.wrapping_add(PRIME32_2),
            seed,
            seed.wrapping_sub(PRIME32_1),
        ];

        // The JS loop advances one 4-byte lane at a time and gates on the
        // 16-byte-aligned stripe start (`(offset & 0xfffffff0) <= len - 16`).
        let limit = len - 16;
        let mut lane = 0usize;
        while (offset & !15) <= limit {
            let value = read_u32(bytes, offset);
            let mixed = acc_n[lane]
                .wrapping_add(value.wrapping_mul(PRIME32_2))
                .rotate_left(13);
            acc_n[lane] = mixed.wrapping_mul(PRIME32_1);
            lane = (lane + 1) & 0x3;
            offset += 4;
        }

        acc = acc_n[0]
            .rotate_left(1)
            .wrapping_add(acc_n[1].rotate_left(7))
            .wrapping_add(acc_n[2].rotate_left(12))
            .wrapping_add(acc_n[3].rotate_left(18));
    } else {
        acc = seed.wrapping_add(PRIME32_5);
    }

    acc = acc.wrapping_add(len as u32);

    while offset + 4 <= len {
        let value = read_u32(bytes, offset);
        acc = acc
            .wrapping_add(value.wrapping_mul(PRIME32_3))
            .rotate_left(17)
            .wrapping_mul(PRIME32_4);
        offset += 4;
    }

    while offset < len {
        acc = acc
            .wrapping_add(u32::from(bytes[offset]).wrapping_mul(PRIME32_5))
            .rotate_left(11)
            .wrapping_mul(PRIME32_1);
        offset += 1;
    }

    acc ^= acc >> 15;
    acc = acc.wrapping_mul(PRIME32_2);
    acc ^= acc >> 13;
    acc = acc.wrapping_mul(PRIME32_3);
    acc ^= acc >> 16;

    acc
}

/// The JS side renders IDs with `xxHash32(text).toString(16)` — lowercase
/// hex, no zero padding.
pub(crate) fn xxhash32_hex(input: &str) -> String {
    format!("{:x}", xxhash32(input, 0))
}

#[cfg(test)]
mod tests {
    use super::xxhash32;

    // Reference values from the canonical xxHash32 implementation (the JS
    // port is bit-exact with it).
    #[test]
    fn matches_known_vectors() {
        assert_eq!(xxhash32("", 0), 0x02cc5d05);
        assert_eq!(xxhash32("a", 0), 0x550d7456);
        assert_eq!(xxhash32("abc", 0), 0x32d153ff);
        assert_eq!(
            xxhash32("Nobody inspects the spammish repetition", 0),
            0xe2293b2f
        );
    }
}
