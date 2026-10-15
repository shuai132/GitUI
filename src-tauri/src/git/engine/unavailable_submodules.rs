use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
};

use git2::{Repository, RepositoryOpenFlags};

use super::GitEngine;

impl GitEngine {
    /// Classify failed startup paths using surviving parent metadata, including
    /// modules no longer declared by the currently checked-out branch.
    pub fn find_submodule_repo_paths(paths: &[String]) -> Vec<String> {
        let targets: Vec<_> = paths
            .iter()
            .filter_map(|path| normalize_path(Path::new(path)).map(|target| (path, target)))
            .collect();
        let mut visited = HashSet::new();
        let mut scanned_modules = HashSet::new();
        let mut submodule_paths = HashSet::new();
        for (_, target) in &targets {
            for ancestor in target.ancestors().skip(1) {
                if !visited.insert(ancestor.to_path_buf()) {
                    continue;
                }
                let Ok(repo) = Repository::open_ext(
                    ancestor,
                    RepositoryOpenFlags::NO_SEARCH,
                    std::iter::empty::<&Path>(),
                ) else {
                    continue;
                };
                if let (Some(workdir), Ok(submodules)) = (repo.workdir(), repo.submodules()) {
                    for submodule in submodules {
                        if let Some(path) = normalize_path(&workdir.join(submodule.path())) {
                            submodule_paths.insert(path);
                        }
                    }
                }
                for gitdir in [repo.path(), repo.commondir()] {
                    let modules = gitdir.join("modules");
                    if scanned_modules.insert(modules.clone()) {
                        collect_module_workdirs(&modules, &mut submodule_paths);
                    }
                }
            }
        }
        targets
            .into_iter()
            .filter_map(|(original, target)| {
                submodule_paths.contains(&target).then(|| original.clone())
            })
            .collect()
    }
}

fn collect_module_workdirs(root: &Path, paths: &mut HashSet<PathBuf>) {
    // Module names can contain slashes. Only descend through name directories;
    // once a gitdir is found, inspect its config and nested modules, never objects.
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        if path.join("HEAD").is_file()
            || path.join("config").is_file()
            || path.join("objects").is_dir()
        {
            if let Ok(config) = git2::Config::open(&path.join("config")) {
                if let Ok(worktree) = config.get_path("core.worktree") {
                    if let Some(workdir) = normalize_path(&path.join(worktree)) {
                        paths.insert(workdir);
                    }
                }
            }
            pending.push(path.join("modules"));
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&path) else {
            continue;
        };
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                pending.push(entry.path());
            }
        }
    }
}

fn normalize_path(path: &Path) -> Option<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    // Resolve aliases through the nearest surviving ancestor; the target itself
    // is usually missing, so canonicalizing the full path would lose the match.
    for ancestor in normalized.ancestors() {
        if let Ok(existing) = ancestor.canonicalize() {
            return Some(existing.join(normalized.strip_prefix(ancestor).ok()?));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_utils::TestRepo;
    use std::fs;

    fn path_string(path: &Path) -> String {
        path.to_str().unwrap().to_string()
    }

    #[test]
    fn recognizes_a_missing_current_submodule_but_not_an_unrelated_nested_repo() {
        let parent = TestRepo::new();
        fs::write(
            parent.dir.path().join(".gitmodules"),
            "[submodule \"network\"]\n\tpath = lib/asio_net\n\turl = https://example.invalid/net\n",
        )
        .unwrap();
        let module = path_string(&parent.dir.path().join("lib/asio_net"));
        let independent = path_string(&parent.dir.path().join("lib/independent"));
        let outside = tempfile::tempdir().unwrap();
        let unrelated = path_string(&outside.path().join("missing"));

        assert_eq!(
            GitEngine::find_submodule_repo_paths(&[independent, module.clone(), unrelated,]),
            vec![module]
        );
    }

    #[test]
    fn recognizes_historical_modules_without_current_declarations_or_local_registration() {
        let parent = TestRepo::new();
        let gitdir = parent.repo.path().join("modules/custom/network");
        let module = parent.dir.path().join("lib/asio_net");
        // A real module gitdir remains after its workdir and .gitmodules disappear.
        let stored = Repository::init_bare(&gitdir).unwrap();
        stored
            .config()
            .unwrap()
            .set_str("core.worktree", "../../../../lib/asio_net")
            .unwrap();
        drop(stored);
        assert!(!module.exists());
        assert!(!parent.dir.path().join(".gitmodules").exists());
        let target = path_string(&module);

        assert_eq!(
            GitEngine::find_submodule_repo_paths(&[target.clone()]),
            vec![target]
        );
    }

    #[test]
    fn recognizes_nested_modules_and_does_not_treat_object_contents_as_repositories() {
        let parent = TestRepo::new();
        let outer_gitdir = parent.repo.path().join("modules/outer");
        let outer = Repository::init_bare(&outer_gitdir).unwrap();
        outer
            .config()
            .unwrap()
            .set_str("core.worktree", "../../../vendor/outer")
            .unwrap();
        let inner_gitdir = outer_gitdir.join("modules/custom/inner");
        let inner = Repository::init_bare(&inner_gitdir).unwrap();
        let inner_path = parent.dir.path().join("vendor/outer/lib/inner");
        inner
            .config()
            .unwrap()
            .set_str("core.worktree", inner_path.to_str().unwrap())
            .unwrap();
        let fake = Repository::init_bare(outer_gitdir.join("objects/not-a-module")).unwrap();
        let unrelated = parent.dir.path().join("unrelated");
        fake.config()
            .unwrap()
            .set_str("core.worktree", unrelated.to_str().unwrap())
            .unwrap();
        let targets = vec![path_string(&unrelated), path_string(&inner_path)];

        assert_eq!(
            GitEngine::find_submodule_repo_paths(&targets),
            vec![path_string(&inner_path)]
        );
    }

    #[test]
    fn recognizes_modules_of_a_linked_worktree_using_common_metadata() {
        let parent = TestRepo::new();
        let container = tempfile::tempdir().unwrap();
        let linked_path = container.path().join("linked");
        parent.repo.worktree("linked", &linked_path, None).unwrap();
        let module = linked_path.join("vendor/child");
        let stored = Repository::init_bare(parent.repo.path().join("modules/child")).unwrap();
        stored
            .config()
            .unwrap()
            .set_str("core.worktree", module.to_str().unwrap())
            .unwrap();
        let target = path_string(&module);

        assert_eq!(
            GitEngine::find_submodule_repo_paths(&[target.clone()]),
            vec![target]
        );
    }

    #[test]
    fn recognizes_modules_in_private_worktree_metadata() {
        let parent = TestRepo::new();
        let container = tempfile::tempdir().unwrap();
        let linked_path = container.path().join("linked");
        parent.repo.worktree("linked", &linked_path, None).unwrap();
        let linked = Repository::open(&linked_path).unwrap();
        let module = linked_path.join("vendor/child");
        let stored = Repository::init_bare(linked.path().join("modules/child")).unwrap();
        stored
            .config()
            .unwrap()
            .set_str("core.worktree", module.to_str().unwrap())
            .unwrap();
        let target = path_string(&module);

        assert_eq!(
            GitEngine::find_submodule_repo_paths(&[target.clone()]),
            vec![target]
        );
    }

    #[cfg(unix)]
    #[test]
    fn recognizes_a_missing_module_through_a_symlinked_parent() {
        let parent = TestRepo::new();
        let container = tempfile::tempdir().unwrap();
        let alias = container.path().join("alias");
        std::os::unix::fs::symlink(parent.dir.path(), &alias).unwrap();
        let module = parent.dir.path().join("vendor/child");
        let stored = Repository::init_bare(parent.repo.path().join("modules/child")).unwrap();
        stored
            .config()
            .unwrap()
            .set_str("core.worktree", module.to_str().unwrap())
            .unwrap();
        let target = path_string(&alias.join("vendor/child"));

        assert_eq!(
            GitEngine::find_submodule_repo_paths(&[target.clone()]),
            vec![target]
        );
    }
}
