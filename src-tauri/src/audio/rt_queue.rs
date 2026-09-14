//! Fixed-capacity, single-producer/single-consumer handoff. No retry loops.
//! Endpoints are not Clone and require &mut access, enforcing one user per side.
use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

struct Storage<T: Copy> {
    slots: Box<[UnsafeCell<MaybeUninit<T>>]>,
    read: AtomicUsize,
    write: AtomicUsize,
}
// SAFETY: only Sender writes the unpublished slot; only Receiver reads published
// slots. Release/acquire publishes initialization and prevents reuse until read.
// T is Copy (no element destructor); endpoints never expose slot references.
unsafe impl<T: Copy + Send> Sync for Storage<T> {}

pub struct Sender<T: Copy> {
    storage: Arc<Storage<T>>,
}
pub struct Receiver<T: Copy> {
    storage: Arc<Storage<T>>,
}

pub fn channel<T: Copy>(capacity: usize) -> (Sender<T>, Receiver<T>) {
    assert!(capacity > 0 && capacity < usize::MAX);
    let storage = Arc::new(Storage {
        slots: (0..=capacity)
            .map(|_| UnsafeCell::new(MaybeUninit::uninit()))
            .collect(),
        read: AtomicUsize::new(0),
        write: AtomicUsize::new(0),
    });
    (
        Sender {
            storage: Arc::clone(&storage),
        },
        Receiver { storage },
    )
}

impl<T: Copy> Sender<T> {
    pub fn push(&mut self, value: T) -> Result<(), T> {
        let s = &self.storage;
        let write = s.write.load(Ordering::Relaxed);
        let next = (write + 1) % s.slots.len();
        if next == s.read.load(Ordering::Acquire) {
            return Err(value);
        }
        // SAFETY: this slot is exclusively owned by this producer until publish.
        unsafe {
            (*s.slots[write].get()).write(value);
        }
        s.write.store(next, Ordering::Release);
        Ok(())
    }
}
impl<T: Copy> Receiver<T> {
    pub fn pop(&mut self) -> Option<T> {
        let s = &self.storage;
        let read = s.read.load(Ordering::Relaxed);
        if read == s.write.load(Ordering::Acquire) {
            return None;
        }
        // SAFETY: acquire observed the producer's initialized slot; it cannot be
        // overwritten until this consumer publishes its next read index.
        let value = unsafe { (*s.slots[read].get()).assume_init_read() };
        s.read.store((read + 1) % s.slots.len(), Ordering::Release);
        Some(value)
    }

    pub fn drain_bounded(&mut self, limit: usize, mut consume: impl FnMut(T)) -> usize {
        let mut consumed = 0;
        for _ in 0..limit {
            match self.pop() {
                Some(value) => {
                    consume(value);
                    consumed += 1;
                }
                None => break,
            }
        }
        consumed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_empty_wrap_and_fifo() {
        let (mut tx, mut rx) = channel(2);
        assert_eq!(rx.pop(), None);
        for i in 0..1000 {
            assert_eq!(tx.push(i), Ok(()));
            assert_eq!(tx.push(i + 1), Ok(()));
            assert_eq!(tx.push(i + 2), Err(i + 2));
            assert_eq!(rx.pop(), Some(i));
            assert_eq!(rx.pop(), Some(i + 1));
            assert_eq!(rx.pop(), None);
        }
    }
    #[test]
    fn continuous_refill_cannot_extend_callback_budget() {
        let (mut tx, mut rx) = channel(4096);
        for i in 0..4096 {
            tx.push(i).unwrap();
        }
        let mut expected = 0;
        assert_eq!(
            rx.drain_bounded(1024, |value| {
                assert_eq!(value, expected);
                tx.push(4096 + expected).unwrap();
                expected += 1;
            }),
            1024
        );
        assert_eq!(rx.pop(), Some(1024));
    }
    #[test]
    fn threaded_fifo_stress() {
        let (mut tx, mut rx) = channel(31);
        let writer = std::thread::spawn(move || {
            for value in 0..100_000 {
                while tx.push(value).is_err() {
                    std::thread::yield_now();
                }
            }
        });
        for expected in 0..100_000 {
            loop {
                if let Some(value) = rx.pop() {
                    assert_eq!(value, expected);
                    break;
                }
                std::thread::yield_now();
            }
        }
        writer.join().unwrap();
    }
}
