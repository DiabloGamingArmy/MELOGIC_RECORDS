//! Control-plane retirement. The audio callback never sends to this channel,
//! waits, or destroys a retired resource. A readiness predicate proves quiescence;
//! the collection interval affects reclamation latency, never memory safety.
use std::{sync::mpsc, thread, time::Duration};

pub trait Retired: Send + 'static {
    /// True only after every callback reference is gone and cannot be reacquired.
    fn ready(&mut self) -> bool;
}

pub struct Reclaimer<T: Retired> {
    sender: mpsc::Sender<T>,
}
impl<T: Retired> Clone for Reclaimer<T> {
    fn clone(&self) -> Self {
        Self {
            sender: self.sender.clone(),
        }
    }
}
impl<T: Retired> Reclaimer<T> {
    pub fn new() -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel::<T>();
        thread::Builder::new()
            .name("soura-plugin-reclaimer".into())
            .spawn(move || {
                let mut pending = Vec::<T>::new();
                let interval = Duration::from_millis(10);
                loop {
                    match receiver.recv_timeout(interval) {
                        Ok(item) => pending.push(item),
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            if pending.is_empty() {
                                break;
                            }
                            // Senders are gone, but a backend may still own a callback.
                            // No deadline permits reclaiming it before ready() is true.
                            thread::park_timeout(interval);
                        }
                    }
                    let mut index = 0;
                    while index < pending.len() {
                        if pending[index].ready() {
                            drop(pending.swap_remove(index));
                        } else {
                            index += 1;
                        }
                    }
                }
            })
            .map_err(|error| format!("Could not start Soura plugin reclamation: {error}"))?;
        Ok(Self { sender })
    }

    /// Control thread only. The resource is returned if the worker has failed.
    pub fn retire(&self, resource: T) -> Result<(), T> {
        self.sender.send(resource).map_err(|error| error.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    struct Fixture {
        lease: Arc<()>,
        destroyed: mpsc::Sender<String>,
    }
    impl Retired for Fixture {
        fn ready(&mut self) -> bool {
            Arc::get_mut(&mut self.lease).is_some()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert_eq!(Arc::strong_count(&self.lease), 1);
            self.destroyed
                .send(thread::current().name().unwrap_or("unnamed").into())
                .unwrap();
        }
    }
    #[test]
    fn callback_lease_prevents_reclamation_and_never_destroys_on_callback_thread() {
        let reclaimer = Reclaimer::new().unwrap();
        let (destroyed, received) = mpsc::channel();
        let lease = Arc::new(());
        let callback = Arc::clone(&lease);
        let mut retired = Fixture { lease, destroyed };
        assert!(!retired.ready());
        assert!(reclaimer.retire(retired).is_ok());
        assert!(received.try_recv().is_err());
        thread::Builder::new()
            .name("fixture-audio-callback".into())
            .spawn(move || {
                let counts = super::super::rt_test_alloc::measure(|| drop(callback));
                assert_eq!(counts, (0, 0));
            })
            .unwrap()
            .join()
            .unwrap();
        assert_eq!(
            received.recv_timeout(Duration::from_secs(2)).unwrap(),
            "soura-plugin-reclaimer"
        );
    }
}
