//! Bounded callback telemetry. Fixed storage, no callback logging or allocation.
//! Atomic snapshots are approximate during playback; exact after quiescence.
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};

const BINS: usize = 64;
#[derive(Default)]
pub struct RealtimeDiagnostics {
    callbacks: AtomicU64,
    last_duration_ns: AtomicU64,
    last_deadline_ns: AtomicU64,
    max_duration_ns: AtomicU64,
    deadline_misses: AtomicU64,
    histogram: Histogram,
    pub stream_errors: AtomicU64,
    device_lost: AtomicU64,
    stream_invalidated: AtomicU64,
    backend_xruns: AtomicU64,
    backend_errors: AtomicU64,
    pub process_failures: AtomicU64,
    pub oversized_buffers: AtomicU64,
    pub midi_overruns: AtomicU64,
}
struct Histogram([AtomicU64; BINS]);
impl Default for Histogram {
    fn default() -> Self {
        Self(std::array::from_fn(|_| AtomicU64::new(0)))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub callbacks: u64,
    pub last_duration_ns: u64,
    pub last_deadline_ns: u64,
    pub max_duration_ns: u64,
    pub deadline_misses: u64,
    pub stream_errors: u64,
    pub device_lost: u64,
    pub stream_invalidated: u64,
    pub backend_xruns: u64,
    pub backend_errors: u64,
    pub process_failures: u64,
    pub oversized_buffers: u64,
    pub midi_overruns: u64,
    // Log2 buckets: 1..62 cover [2^(i-1), 2^i-1] ns; bucket 0 is zero.
    // Bucket 63 includes all remaining durations (upper bound u64::MAX).
    pub duration_histogram: Vec<u64>,
    pub percentile_upper_bounds_ns: [u64; 5], // p50, p95, p99, p99.9, p99.99
}
impl RealtimeDiagnostics {
    // Keep category counts without formatting backend-owned strings on RT.
    pub fn record_stream_error(&self, error: &cpal::StreamError) {
        let counter = match error {
            cpal::StreamError::DeviceNotAvailable => &self.device_lost,
            cpal::StreamError::StreamInvalidated => &self.stream_invalidated,
            cpal::StreamError::BufferUnderrun => &self.backend_xruns,
            _ => &self.backend_errors,
        };
        counter.fetch_add(1, Ordering::Relaxed);
        self.stream_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> DiagnosticsSnapshot {
        let histogram: Vec<_> = self
            .histogram
            .0
            .iter()
            .map(|v| v.load(Ordering::Relaxed))
            .collect();
        let count: u64 = histogram.iter().sum();
        let percentile = |parts: u64| {
            if count == 0 {
                return 0;
            }
            let target = ((count as u128 * parts as u128 + 9999) / 10000) as u64;
            let mut total = 0;
            for (i, value) in histogram.iter().enumerate() {
                total += value;
                if total >= target {
                    return if i == 63 { u64::MAX } else { (1u64 << i) - 1 };
                }
            }
            u64::MAX
        };
        DiagnosticsSnapshot {
            callbacks: self.callbacks.load(Ordering::Relaxed),
            last_duration_ns: self.last_duration_ns.load(Ordering::Relaxed),
            last_deadline_ns: self.last_deadline_ns.load(Ordering::Relaxed),
            max_duration_ns: self.max_duration_ns.load(Ordering::Relaxed),
            deadline_misses: self.deadline_misses.load(Ordering::Relaxed),
            stream_errors: self.stream_errors.load(Ordering::Relaxed),
            device_lost: self.device_lost.load(Ordering::Relaxed),
            stream_invalidated: self.stream_invalidated.load(Ordering::Relaxed),
            backend_xruns: self.backend_xruns.load(Ordering::Relaxed),
            backend_errors: self.backend_errors.load(Ordering::Relaxed),
            process_failures: self.process_failures.load(Ordering::Relaxed),
            oversized_buffers: self.oversized_buffers.load(Ordering::Relaxed),
            midi_overruns: self.midi_overruns.load(Ordering::Relaxed),
            percentile_upper_bounds_ns: [5000, 9500, 9900, 9990, 9999].map(percentile),
            duration_histogram: histogram,
        }
    }
}

// Exactly one meter per stream. Local maxima/counts avoid CAS/retry loops.
pub struct CallbackMeter {
    diagnostics: Arc<RealtimeDiagnostics>,
    callbacks: u64,
    misses: u64,
    maximum: u64,
    histogram: [u64; BINS],
    sample_rate: u32,
}
impl CallbackMeter {
    pub fn new(diagnostics: Arc<RealtimeDiagnostics>, sample_rate: u32) -> Self {
        assert!(sample_rate > 0);
        Self {
            diagnostics,
            callbacks: 0,
            misses: 0,
            maximum: 0,
            histogram: [0; BINS],
            sample_rate,
        }
    }
    pub fn finish(&mut self, start: Instant, frames: usize) {
        self.record(
            start.elapsed().as_nanos().min(u64::MAX as u128) as u64,
            frames,
        );
    }
    fn record(&mut self, duration_ns: u64, frames: usize) {
        let deadline = ((frames as u128 * 1_000_000_000) / self.sample_rate as u128)
            .min(u64::MAX as u128) as u64;
        let bucket = (64 - duration_ns.leading_zeros() as usize).min(BINS - 1);
        self.callbacks += 1;
        self.misses += u64::from(duration_ns > deadline);
        self.maximum = self.maximum.max(duration_ns);
        self.histogram[bucket] += 1;
        let d = &self.diagnostics;
        d.last_duration_ns.store(duration_ns, Ordering::Relaxed);
        d.last_deadline_ns.store(deadline, Ordering::Relaxed);
        d.max_duration_ns.store(self.maximum, Ordering::Relaxed);
        d.deadline_misses.store(self.misses, Ordering::Relaxed);
        d.histogram.0[bucket].store(self.histogram[bucket], Ordering::Relaxed);
        d.callbacks.store(self.callbacks, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stream_error_categories_survive_handoff() {
        let d = RealtimeDiagnostics::default();
        d.record_stream_error(&cpal::StreamError::DeviceNotAvailable);
        d.record_stream_error(&cpal::StreamError::StreamInvalidated);
        d.record_stream_error(&cpal::StreamError::BufferUnderrun);
        let s = d.snapshot();
        assert_eq!(
            (
                s.stream_errors,
                s.device_lost,
                s.stream_invalidated,
                s.backend_xruns
            ),
            (3, 1, 1, 1)
        );
    }
    #[test]
    fn deadlines_cover_rate_and_buffer_matrix() {
        for rate in [44100, 48000, 88200, 96000] {
            for frames in [64, 128, 256, 512, 1024] {
                let d = Arc::new(RealtimeDiagnostics::default());
                let mut m = CallbackMeter::new(Arc::clone(&d), rate);
                let deadline = frames as u64 * 1_000_000_000 / rate as u64;
                m.record(deadline, frames);
                m.record(deadline + 1, frames);
                let s = d.snapshot();
                assert_eq!(s.callbacks, 2);
                assert_eq!(s.deadline_misses, 1);
                assert_eq!(s.last_deadline_ns, deadline);
                assert_eq!(s.max_duration_ns, deadline + 1);
                assert_eq!(s.duration_histogram.iter().sum::<u64>(), 2);
            }
        }
    }
    #[test]
    fn percentiles_are_bucket_upper_bounds_and_errors_are_observable() {
        let d = Arc::new(RealtimeDiagnostics::default());
        assert_eq!(d.snapshot().percentile_upper_bounds_ns, [0; 5]);
        let mut m = CallbackMeter::new(Arc::clone(&d), 48000);
        for _ in 0..9999 {
            m.record(100, 128);
        }
        m.record(1_000_000, 128);
        d.process_failures.fetch_add(1, Ordering::Relaxed);
        d.stream_errors.fetch_add(2, Ordering::Relaxed);
        d.oversized_buffers.fetch_add(3, Ordering::Relaxed);
        d.midi_overruns.fetch_add(4, Ordering::Relaxed);
        let s = d.snapshot();
        assert_eq!(s.percentile_upper_bounds_ns, [127; 5]);
        assert_eq!(s.max_duration_ns, 1_000_000);
        assert_eq!(
            (
                s.process_failures,
                s.stream_errors,
                s.oversized_buffers,
                s.midi_overruns
            ),
            (1, 2, 3, 4)
        );
    }
}
