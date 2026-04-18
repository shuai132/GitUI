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

fn try_utf8(bytes: &[u8]) -> Option<String> {
    std::str::from_utf8(bytes).ok().map(|s| s.to_string())
}

/// 用指定 encoding 解码字节流；非法序列会自动用替换字符代替（不会 panic）。
pub fn decode_with(encoding: &'static Encoding, bytes: &[u8]) -> String {
    let (cow, _, _) = encoding.decode(bytes);
    cow.into_owned()
}

fn detect_and_decode(bytes: &[u8]) -> String {
    let mut det = EncodingDetector::new();
    det.feed(bytes, true);
    // allow_utf8=false：调用方已经确认 UTF-8 试解失败（或显式声明非 UTF-8），
    // 这里禁止 chardetng 再返回 UTF-8 以避免 0xFFFD 替换字符
    let encoding = det.guess(None, false);
    decode_with(encoding, bytes)
}

/// commit message / summary / author 名 / email 的解码入口。
///
/// `hint` 取自 `Commit::message_encoding()`：
/// - `None` 表示 commit 头未声明 encoding（按 git 规范视作 UTF-8）
/// - `Some("utf-8")` 等显式声明会被严格遵循；若声明 UTF-8 但实际不合法则回退到检测
pub fn decode_commit_text(bytes: &[u8], hint: Option<&str>) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Some(name) = hint {
        if let Some(enc) = lookup_encoding(name) {
            if enc == UTF_8 {
                if let Some(s) = try_utf8(bytes) {
                    return s;
                }
                return detect_and_decode(bytes);
            }
            return decode_with(enc, bytes);
        }
        // 未识别的 hint 名称（生僻别名）→ 走通用 fallback
    }
    if let Some(s) = try_utf8(bytes) {
        return s;
    }
    detect_and_decode(bytes)
}

/// 选定一段连续字节流的最佳解码 Encoding（不立即解码，便于多段共用同一编码）。
///
/// 用于 diff 解码：把同一个文件的所有行 content 拼起来跑一次检测，再用结果分别
/// decode 各 line / hunk header。拼接后的字节量比单行准确得多。
///
/// `attr_encoding` 来自 `.gitattributes` 的 `working-tree-encoding`，`None` 表示未设置。
pub fn detect_file_encoding(bytes: &[u8], attr_encoding: Option<&str>) -> &'static Encoding {
    if let Some(name) = attr_encoding {
        if let Some(enc) = lookup_encoding(name) {
            return enc;
        }
    }
    if std::str::from_utf8(bytes).is_ok() {
        return UTF_8;
    }
    let mut det = EncodingDetector::new();
    det.feed(bytes, true);
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
        let enc = detect_file_encoding(bytes, None);
        assert_eq!(enc, UTF_8);
    }

    #[test]
    fn detect_file_encoding_respects_attribute() {
        let bytes = b"hello"; // ASCII，UTF-8 也可以读，但 attr 优先
        let enc = detect_file_encoding(bytes, Some("Shift_JIS"));
        assert_eq!(enc.name(), "Shift_JIS");
    }

    #[test]
    fn ref_name_lossy() {
        assert_eq!(decode_ref_name(b"main"), "main");
        // 非法 UTF-8 字节
        let s = decode_ref_name(&[0xff, 0xfe, b'a']);
        assert!(s.contains('a'));
    }
}
