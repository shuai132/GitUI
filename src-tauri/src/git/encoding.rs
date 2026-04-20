//! 字符编码自适应工具：解决 git 仓库里 commit message / 文件内容 /
//! ref 名等字段可能不是 UTF-8 的场景。
//!
//! 三类来源各走独立优先级链：
//!
//! - **commit 文本**（message / summary / author 名邮）：
//!   `Commit::message_encoding()` 显式声明 → UTF-8 试解 → chardetng 检测 → lossy 兜底
//! - **diff 文件内容**：
//!   `.gitattributes` 的 `working-tree-encoding` → UTF-8 试解 → chardetng 检测 → lossy 兜底
//!   （按 `DiffDelta` 边界单独检测，绝不跨文件）
//! - **ref 名**（branch / tag / remote / submodule）：
//!   git 规范要求 UTF-8，违规仅做 `from_utf8_lossy`，不上检测以避免短串误判
//!
//! UTF-8 试解走 `std::str::from_utf8`，O(n) 极快；纯 UTF-8 仓库的所有调用
//! 都在第一步即返回，零额外开销。

use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_8};

fn lookup_encoding(name: &str) -> Option<&'static Encoding> {
    Encoding::for_label(name.as_bytes())
}

/// 手动剥离 BOM 并返回对应的编码提示。
/// 返回：(剥离后的字节切片, BOM 识别出的编码)
fn strip_bom(bytes: &[u8]) -> (&[u8], Option<&'static Encoding>) {
    if let Some((enc, bom_len)) = Encoding::for_bom(bytes) {
        return (&bytes[bom_len..], Some(enc));
    }
    (bytes, None)
}

/// 用指定 encoding 解码字节流；非法序列会自动用替换字符代替（不会 panic）。
/// 注意：此函数会手动剥离 BOM，并强制使用指定编码解码剩余内容，不允许自动切换编码。
pub fn decode_with(encoding: &'static Encoding, bytes: &[u8]) -> String {
    let (clean_bytes, _bom_enc) = strip_bom(bytes);
    // 使用 decode_without_bom_handling 确保不因为内容里的误导性 BOM 自动跳转编码
    let (cow, _) = encoding.decode_without_bom_handling(clean_bytes);
    cow.into_owned()
}

fn detect_and_decode(bytes: &[u8]) -> String {
    let (clean_bytes, bom_enc) = strip_bom(bytes);
    if let Some(enc) = bom_enc {
        return decode_with(enc, bytes);
    }
    let mut det = EncodingDetector::new();
    det.feed(clean_bytes, true);
    let encoding = det.guess(None, false);
    decode_with(encoding, bytes)
}

/// commit message / summary / author 名 / email 的解码入口。
pub fn decode_commit_text(bytes: &[u8], hint: Option<&str>) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Some(name) = hint {
        if let Some(enc) = lookup_encoding(name) {
            // 如果显式声明了 UTF-8，我们依然先看是否有 BOM
            return decode_with(enc, bytes);
        }
    }
    
    let (clean_bytes, bom_enc) = strip_bom(bytes);
    if let Some(enc) = bom_enc {
        return decode_with(enc, bytes);
    }
    
    if std::str::from_utf8(clean_bytes).is_ok() {
        return decode_with(UTF_8, bytes);
    }
    detect_and_decode(bytes)
}

/// 选定一段连续字节流的最佳解码 Encoding。
pub fn detect_file_encoding(
    bytes: &[u8],
    attr_encoding: Option<&str>,
    file_bom_enc: Option<&'static Encoding>,
) -> &'static Encoding {
    if let Some(enc) = file_bom_enc {
        return enc;
    }

    let (clean_bytes, bom_enc) = strip_bom(bytes);
    if let Some(enc) = bom_enc {
        return enc;
    }

    if let Some(name) = attr_encoding {
        if let Some(enc) = lookup_encoding(name) {
            return enc;
        }
    }
    
    if std::str::from_utf8(clean_bytes).is_ok() {
        return UTF_8;
    }
    
    let mut det = EncodingDetector::new();
    det.feed(clean_bytes, true);
    det.guess(None, false)
}

/// branch / tag / remote / submodule 名等 ref 字符串的解码。
///
/// git ref 规范要求 UTF-8，违规情况罕见；为避免 chardetng 对极短字符串误判，
/// 这里直接做 lossy。保证不 panic、不丢字节、可参与字符串相等比较与搜索。
pub fn decode_ref_name(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::GBK;

    #[test]
    fn utf8_passthrough() {
        let s = "hello 世界";
        assert_eq!(decode_commit_text(s.as_bytes(), None), s);
        assert_eq!(decode_commit_text(s.as_bytes(), Some("utf-8")), s);
    }

    #[test]
    fn empty_bytes() {
        assert_eq!(decode_commit_text(&[], None), "");
        assert_eq!(decode_commit_text(&[], Some("utf-8")), "");
    }

    #[test]
    fn gbk_with_hint() {
        let original = "初始提交：GBK message";
        let (encoded, _, _) = GBK.encode(original);
        assert_eq!(decode_commit_text(&encoded, Some("GBK")), original);
        assert_eq!(decode_commit_text(&encoded, Some("gb2312")), original);
    }

    #[test]
    fn gbk_without_hint_falls_back_to_detection() {
        let original = "中文注释一段比较长的文本以便检测器有足够样本判断编码";
        let (encoded, _, _) = GBK.encode(original);
        let decoded = decode_commit_text(&encoded, None);
        assert_eq!(decoded, original);
    }

    #[test]
    fn detect_file_encoding_picks_utf8_for_ascii() {
        let bytes = b"hello world\n";
        let enc = detect_file_encoding(bytes, None, None);
        assert_eq!(enc, UTF_8);
    }

    #[test]
    fn detect_file_encoding_respects_attribute() {
        let bytes = b"hello"; // ASCII，UTF-8 也可以读，但 attr 优先
        let enc = detect_file_encoding(bytes, Some("Shift_JIS"), None);
        assert_eq!(enc.name(), "Shift_JIS");
    }

    #[test]
    fn utf8_with_bom() {
        let original = "BOM test 中文";
        let mut bytes = vec![0xef, 0xbb, 0xbf];
        bytes.extend_from_slice(original.as_bytes());
        
        // decode_commit_text should strip BOM
        assert_eq!(decode_commit_text(&bytes, None), original);
        
        // detect_file_encoding should return UTF_8
        let enc = detect_file_encoding(&bytes, None, None);
        assert_eq!(enc, UTF_8);
    }

    #[test]
    fn utf16_with_bom() {
        let original = "ABC 中文";
        // Manual UTF-16LE bytes for "ABC 中文"
        // A: 41 00, B: 42 00, C: 43 00, space: 20 00
        // 中: 2D 4E, 文: 87 65  (U+4E2D, U+6587)
        let mut bytes = vec![0xff, 0xfe]; // LE BOM
        bytes.extend_from_slice(&[0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x20, 0x00, 0x2D, 0x4E, 0x87, 0x65]);
        
        // detect_file_encoding should return UTF_16LE
        let enc = detect_file_encoding(&bytes, None, None);
        assert_eq!(enc, encoding_rs::UTF_16LE);
        
        assert_eq!(decode_with(enc, &bytes), original);
    }

    #[test]
    fn ref_name_lossy() {
        assert_eq!(decode_ref_name(b"main"), "main");
        // 非法 UTF-8 字节
        let s = decode_ref_name(&[0xff, 0xfe, b'a']);
        assert!(s.contains('a'));
    }
}
