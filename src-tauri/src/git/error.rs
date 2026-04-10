use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum GitError {
    #[error("Git error: {0}")]
    Git(String),

    #[error("Repository not found: {0}")]
    RepoNotFound(String),

    #[error("Repository not open: {0}")]
    RepoNotOpen(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Operation failed: {0}")]
    OperationFailed(String),

    #[error("Credentials error: {0}")]
    Credentials(String),
}

impl From<git2::Error> for GitError {
    fn from(e: git2::Error) -> Self {
        GitError::Git(e.message().to_string())
    }
}

impl From<std::io::Error> for GitError {
    fn from(e: std::io::Error) -> Self {
        GitError::Io(e.to_string())
    }
}

pub type GitResult<T> = Result<T, GitError>;
