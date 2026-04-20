fn main() {
    if std::env::var("GIT_HASH").is_err() {
        let is_release = std::process::Command::new("git")
            .args(["describe", "--exact-match", "--match", "v*"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !is_release {
            if let Ok(output) = std::process::Command::new("git")
                .args(["rev-parse", "--short", "HEAD"])
                .output()
            {
                if output.status.success() {
                    let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !hash.is_empty() {
                        println!("cargo:rustc-env=GIT_HASH={}", hash);
                    }
                }
            }
        }
    }
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs");
    println!("cargo:rerun-if-env-changed=GIT_HASH");

    tauri_build::build()
}
