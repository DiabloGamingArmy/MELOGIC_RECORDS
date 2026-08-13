pub mod commands;
mod analysis;
mod dsp;
mod engine;

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
