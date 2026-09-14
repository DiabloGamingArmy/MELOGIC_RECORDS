pub mod commands;
mod analysis;
mod dsp;
mod engine;
pub(crate) mod rt_queue;
pub(crate) mod rt_diagnostics;

use std::sync::Mutex;

pub use engine::NativeAudioEngine;

pub struct NativeAudioState {
  pub engine: Mutex<NativeAudioEngine>,
}

impl Default for NativeAudioState {
  fn default() -> Self {
    Self {
      engine: Mutex::new(
        NativeAudioEngine::new()
      ),
    }
  }
}

#[cfg(test)]
pub(crate) mod rt_test_alloc;
