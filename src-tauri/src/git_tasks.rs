use std::sync::{Arc, OnceLock};

use tokio::sync::Semaphore;

use crate::git::error::{GitError, GitResult};

struct TaskPools {
    local: Arc<Semaphore>,
    network: Arc<Semaphore>,
}

impl TaskPools {
    fn new() -> Self {
        let local_limit = std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(2)
            .clamp(2, 4);
        Self {
            local: Arc::new(Semaphore::new(local_limit)),
            network: Arc::new(Semaphore::new(2)),
        }
    }
}

fn pools() -> &'static TaskPools {
    static POOLS: OnceLock<TaskPools> = OnceLock::new();
    POOLS.get_or_init(TaskPools::new)
}

pub async fn run_git<T: Send + 'static>(
    operation: impl FnOnce() -> GitResult<T> + Send + 'static,
) -> GitResult<T> {
    run_with_limit(Arc::clone(&pools().local), operation).await
}

pub async fn run_network<T: Send + 'static>(
    operation: impl FnOnce() -> GitResult<T> + Send + 'static,
) -> GitResult<T> {
    run_with_limit(Arc::clone(&pools().network), operation).await
}

async fn run_with_limit<T: Send + 'static>(
    limit: Arc<Semaphore>,
    operation: impl FnOnce() -> GitResult<T> + Send + 'static,
) -> GitResult<T> {
    // 排队不占阻塞线程；取消 await 后，已启动任务仍持有名额直到真正结束。
    let permit = limit
        .acquire_owned()
        .await
        .map_err(|error| GitError::OperationFailed(format!("Git task queue closed: {error}")))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        operation()
    })
    .await
    .map_err(|error| GitError::OperationFailed(format!("Git task failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        time::Duration,
    };
    use tokio::{sync::oneshot, task::JoinHandle};

    async fn occupy(limit: Arc<Semaphore>) -> (JoinHandle<GitResult<()>>, mpsc::Sender<()>) {
        let (started_tx, started_rx) = oneshot::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let task = tokio::spawn(run_with_limit(limit, move || {
            let _ = started_tx.send(());
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            Ok(())
        }));
        started_rx.await.unwrap();
        (task, release_tx)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn blocking_work_leaves_async_worker_and_network_capacity_separate() {
        let pools = TaskPools {
            local: Arc::new(Semaphore::new(1)),
            network: Arc::new(Semaphore::new(1)),
        };
        let (network, release) = occupy(pools.network).await;
        let async_thread = std::thread::current().id();
        let local_thread = tokio::time::timeout(
            Duration::from_secs(1),
            run_with_limit(pools.local, || Ok(std::thread::current().id())),
        )
        .await
        .unwrap()
        .unwrap();
        assert_ne!(local_thread, async_thread);
        release.send(()).unwrap();
        network.await.unwrap().unwrap();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn queued_tasks_do_not_start_past_limit_and_can_be_cancelled() {
        let limit = Arc::new(Semaphore::new(2));
        let (first, release_first) = occupy(Arc::clone(&limit)).await;
        let (second, release_second) = occupy(Arc::clone(&limit)).await;
        let ran = Arc::new(AtomicBool::new(false));
        let ran_queued = Arc::clone(&ran);
        let queued = tokio::spawn(run_with_limit(Arc::clone(&limit), move || {
            ran_queued.store(true, Ordering::SeqCst);
            Ok(())
        }));
        tokio::task::yield_now().await;
        assert!(!ran.load(Ordering::SeqCst));
        assert_eq!(limit.available_permits(), 0);
        queued.abort();
        assert!(queued.await.unwrap_err().is_cancelled());
        release_first.send(()).unwrap();
        release_second.send(()).unwrap();
        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
        assert!(!ran.load(Ordering::SeqCst));
        assert_eq!(limit.available_permits(), 2);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cancelling_a_running_await_keeps_its_permit_until_real_completion() {
        let limit = Arc::new(Semaphore::new(1));
        let (running, release) = occupy(Arc::clone(&limit)).await;
        running.abort();
        assert!(running.await.unwrap_err().is_cancelled());
        assert_eq!(limit.available_permits(), 0);
        release.send(()).unwrap();
        // 后续任务只有在真正退出阻塞闭包后才能执行，且没有名额泄漏。
        assert_eq!(
            run_with_limit(Arc::clone(&limit), || Ok(42)).await.unwrap(),
            42
        );
        assert_eq!(limit.available_permits(), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn queued_git_write_rechecks_its_captured_head_at_execution() {
        use crate::git::{engine::GitEngine, test_utils::TestRepo};
        let fixture = TestRepo::new();
        let path = fixture.path_str().to_string();
        let head = fixture.repo.head().unwrap();
        let expected_head = head.target().unwrap().to_string();
        let expected_ref = head.name().unwrap().to_string();
        let limit = Arc::new(Semaphore::new(1));
        let (busy, release) = occupy(Arc::clone(&limit)).await;
        let queued = tokio::spawn(run_with_limit(limit, move || {
            GitEngine::create_commit(&path, "queued commit", Some(&expected_head), &expected_ref)
        }));
        tokio::task::yield_now().await;
        let parent = head.peel_to_commit().unwrap();
        let signature = fixture.repo.signature().unwrap();
        let external = fixture
            .repo
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "external commit",
                &parent.tree().unwrap(),
                &[&parent],
            )
            .unwrap();
        release.send(()).unwrap();
        busy.await.unwrap().unwrap();
        let failure = queued.await.unwrap().unwrap_err();
        assert!(
            matches!(failure, GitError::OperationFailed(message) if message.contains("context changed"))
        );
        assert_eq!(
            GitEngine::open(fixture.path_str())
                .unwrap()
                .head()
                .unwrap()
                .target(),
            Some(external)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn business_errors_and_panics_release_capacity() {
        let limit = Arc::new(Semaphore::new(1));
        let failure = run_with_limit::<()>(Arc::clone(&limit), || {
            Err(GitError::RepoNotOpen("captured-repo".into()))
        })
        .await
        .unwrap_err();
        assert!(matches!(failure, GitError::RepoNotOpen(id) if id == "captured-repo"));
        let panic = run_with_limit::<()>(Arc::clone(&limit), || panic!("test task panic"))
            .await
            .unwrap_err();
        assert!(
            matches!(panic, GitError::OperationFailed(message) if message.contains("test task panic"))
        );
        assert_eq!(limit.available_permits(), 1);
        run_with_limit(limit, || Ok(())).await.unwrap();
    }
}
