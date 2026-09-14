//! Test-only per-thread Rust allocator tripwire. Does not measure C++/driver allocators.
use std::{
    alloc::{GlobalAlloc, Layout, System},
    cell::Cell,
};
thread_local! {
    static ENABLED: Cell<bool> = const { Cell::new(false) };
    static COUNTS: Cell<(usize, usize)> = const { Cell::new((0, 0)) };
}
struct CountingAllocator;
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;
fn count(allocation: bool) {
    if ENABLED.try_with(Cell::get).unwrap_or(false) {
        let _ = COUNTS.try_with(|counts| {
            let (allocs, frees) = counts.get();
            counts.set((
                allocs + usize::from(allocation),
                frees + usize::from(!allocation),
            ));
        });
    }
}
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count(true);
        System.alloc(layout)
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        count(true);
        System.alloc_zeroed(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        count(false);
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        count(true);
        count(false);
        System.realloc(ptr, layout, size)
    }
}
pub fn measure(work: impl FnOnce()) -> (usize, usize) {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            ENABLED.with(|flag| flag.set(false));
        }
    }
    COUNTS.with(|counts| counts.set((0, 0)));
    ENABLED.with(|flag| flag.set(true));
    let reset = Reset;
    work();
    drop(reset);
    COUNTS.with(Cell::get)
}

#[test]
fn midi_handoff_and_meter_do_not_allocate_or_free() {
    use super::{
        rt_diagnostics::{CallbackMeter, RealtimeDiagnostics},
        rt_queue,
    };
    use std::{sync::Arc, time::Instant};
    let (mut tx, mut rx) = rt_queue::channel(4096);
    let diagnostics = Arc::new(RealtimeDiagnostics::default());
    let mut meter = CallbackMeter::new(Arc::clone(&diagnostics), 48000);
    let mut total = 0;
    let counts = measure(|| {
        for _ in 0..100 {
            for value in 0..4096 {
                let _ = tx.push(value);
            }
            for _ in 0..4 {
                let start = Instant::now();
                rx.drain_bounded(1024, |value| total += value);
                meter.finish(start, 128);
            }
            diagnostics.record_stream_error(&cpal::StreamError::BufferUnderrun);
        }
    });
    assert_eq!(counts, (0, 0));
    assert_eq!(total, 100 * (4095 * 4096 / 2));
    assert_eq!(diagnostics.snapshot().callbacks, 400);
}
