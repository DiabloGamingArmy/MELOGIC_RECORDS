//! Native stream lifecycle. Control transitions are serialized by engine state;
//! backend callbacks only publish failure states with atomic operations.
use serde::Serialize;
use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[repr(u8)]
pub enum DeviceState {
    Uninitialized,
    Initializing,
    Running,
    DeviceLost,
    Failed,
    Stopped,
}
#[derive(Default)]
pub struct DeviceLifecycle {
    state: AtomicU8,
}
impl DeviceLifecycle {
    pub fn state(&self) -> DeviceState {
        match self.state.load(Ordering::Acquire) {
            0 => DeviceState::Uninitialized,
            1 => DeviceState::Initializing,
            2 => DeviceState::Running,
            3 => DeviceState::DeviceLost,
            4 => DeviceState::Failed,
            _ => DeviceState::Stopped,
        }
    }
    pub fn begin(&self) {
        self.state
            .store(DeviceState::Initializing as u8, Ordering::Release);
    }
    pub fn started(&self) -> bool {
        // A failure delivered while CPAL builds/starts the stream must not be
        // overwritten with RUNNING when the control call eventually returns.
        self.state
            .compare_exchange(
                DeviceState::Initializing as u8,
                DeviceState::Running as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
    pub fn fail(&self) {
        self.state
            .store(DeviceState::Failed as u8, Ordering::Release);
    }
    pub fn stop(&self) {
        self.state
            .store(DeviceState::Stopped as u8, Ordering::Release);
    }
    pub fn running(&self) -> bool {
        self.state() == DeviceState::Running
    }
    pub fn stream_error(&self, error: &cpal::StreamError) {
        match error {
            cpal::StreamError::DeviceNotAvailable | cpal::StreamError::StreamInvalidated => {
                self.state
                    .store(DeviceState::DeviceLost as u8, Ordering::Release);
            }
            cpal::StreamError::BufferUnderrun => {} // XRUN does not imply device loss.
            _ => self.fail(),
        }
    }
}
/// Controls actually exposed by the current native API. Neither the diagnostic
/// stream nor the direct VST3 host implements device/config selection yet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDeviceCapabilities {
    pub output_device_selection: bool,
    pub input_device_selection: bool,
    pub input_capture: bool,
    pub sample_rate_selection: bool,
    pub buffer_size_selection: bool,
    pub channel_selection: bool,
    pub latency_reporting: bool,
}
impl Default for NativeDeviceCapabilities {
    fn default() -> Self {
        Self {
            output_device_selection: false,
            input_device_selection: false,
            input_capture: false,
            sample_rate_selection: false,
            buffer_size_selection: false,
            channel_selection: false,
            latency_reporting: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_failure_cannot_be_overwritten_by_late_success() {
        let state = DeviceLifecycle::default();
        assert_eq!(state.state(), DeviceState::Uninitialized);
        state.begin();
        state.stream_error(&cpal::StreamError::DeviceNotAvailable);
        assert!(!state.started());
        assert_eq!(state.state(), DeviceState::DeviceLost);
    }
    #[test]
    fn concurrent_start_and_loss_always_end_in_lost_state() {
        for _ in 0..1000 {
            let state = DeviceLifecycle::default();
            state.begin();
            std::thread::scope(|scope| {
                scope.spawn(|| state.stream_error(&cpal::StreamError::DeviceNotAvailable));
                state.started();
            });
            assert_eq!(state.state(), DeviceState::DeviceLost);
        }
    }

    #[test]
    fn nonfatal_xrun_keeps_stream_running_but_invalidation_stops_it() {
        let state = DeviceLifecycle::default();
        state.begin();
        assert!(state.started());
        state.stream_error(&cpal::StreamError::BufferUnderrun);
        assert!(state.running());
        state.stream_error(&cpal::StreamError::StreamInvalidated);
        assert!(!state.running());
        state.stop();
        assert_eq!(state.state(), DeviceState::Stopped);
    }
}
