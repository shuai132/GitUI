fn git_revision(args: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let revision = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!revision.is_empty()).then_some(revision)
}

fn main() {
    let build_commit = std::env::var("GITUI_BUILD_COMMIT")
        .ok()
        .filter(|commit| !commit.is_empty())
        .or_else(|| git_revision(&["rev-parse", "HEAD"]));
    if let Some(commit) = build_commit.as_deref() {
        println!("cargo:rustc-env=GITUI_BUILD_COMMIT={commit}");
    }

    if std::env::var("GIT_HASH").is_err() {
        let is_release = std::process::Command::new("git")
            .args(["describe", "--exact-match", "--match", "v*"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !is_release {
            let display_hash = git_revision(&["rev-parse", "--short", "HEAD"]).or_else(|| {
                build_commit
                    .as_deref()
                    .and_then(|commit| commit.get(..7))
                    .map(str::to_string)
            });
            if let Some(hash) = display_hash {
                println!("cargo:rustc-env=GIT_HASH={hash}");
            }
        }
    }
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs");
    println!("cargo:rerun-if-env-changed=GIT_HASH");
    println!("cargo:rerun-if-env-changed=GITUI_BUILD_COMMIT");

    tauri_build::build()
}
