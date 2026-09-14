use std::{
  collections::HashMap,
  time::Instant,
  ffi::{CStr, CString},
  os::raw::{c_char, c_float, c_int, c_void},
  sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc,
    Mutex,
    OnceLock,
  },
};

use cpal::{traits::{DeviceTrait, HostTrait, StreamTrait}, SampleFormat, Stream, StreamConfig};
use crate::audio::{reclamation::{Reclaimer, Retired}, rt_queue, rt_diagnostics::{CallbackMeter, DiagnosticsSnapshot, RealtimeDiagnostics}};
use serde::Serialize;

#[repr(C)]
struct SouraVst3EditorInfo { width: c_int, height: c_int, resizable: c_int }

extern "C" {
  fn soura_vst3_create(path: *const c_char, sample_rate: f64, max_block_size: c_int, error: *mut c_char, error_capacity: c_int) -> *mut c_void;
  fn soura_vst3_event_capacity() -> c_int;
  fn soura_vst3_destroy(handle: *mut c_void);
  fn soura_vst3_note_on(handle: *mut c_void, note: c_int, velocity: c_float, channel: c_int);
  fn soura_vst3_note_off(handle: *mut c_void, note: c_int, velocity: c_float, channel: c_int);
  fn soura_vst3_process(handle: *mut c_void, output_interleaved: *mut c_float, frames: c_int, channels: c_int) -> c_int;
  fn soura_vst3_open_editor(handle: *mut c_void, info: *mut SouraVst3EditorInfo, error: *mut c_char, error_capacity: c_int) -> c_int;
}

#[derive(Clone, Copy)]
enum MidiEventKind { NoteOn, NoteOff }
#[derive(Clone, Copy)]
struct MidiEvent { kind: MidiEventKind, note: i32, velocity: f32, channel: i32 }

struct HostShared {
  handle: usize,
  diagnostics: Arc<RealtimeDiagnostics>,
  midi_budget: usize,
  gain_bits: AtomicU32,
  pan_bits: AtomicU32,
  muted: AtomicBool,
}
unsafe impl Send for HostShared {}
unsafe impl Sync for HostShared {}

// The retirement owner pins all callback backing allocations until the entire
// callback object has been released, even when CPAL's backend retains the stream.
struct PluginOwner {
  shared: Arc<HostShared>,
  midi: rt_queue::Sender<MidiEvent>,
}
impl Retired for PluginOwner {
  fn ready(&mut self) -> bool { Arc::get_mut(&mut self.shared).is_some() }
}
impl Drop for PluginOwner {
  fn drop(&mut self) {
    debug_assert_eq!(Arc::strong_count(&self.shared), 1);
    unsafe { soura_vst3_destroy(self.shared.handle as *mut c_void) };
  }
}
static PLUGIN_RECLAIMER: OnceLock<Result<Reclaimer<PluginOwner>, String>> = OnceLock::new();

struct HostedInstance {
  stream: Option<Stream>,
  owner: Option<PluginOwner>,
  reclaimer: Reclaimer<PluginOwner>,
  sample_rate: u32,
  channels: u16,
  max_block_size: i32,
}
impl Drop for HostedInstance {
  fn drop(&mut self) {
    drop(self.stream.take());
    if let Some(owner) = self.owner.take() {
      if let Err(mut owner) = self.reclaimer.retire(owner) {
        // A failed worker must never turn into destruction of a live plugin.
        log::error!("[soura-vst3-host] reclamation worker failed; restart Soura to release remaining native resources");
        if owner.ready() { drop(owner); } else { std::mem::forget(owner); }
      }
    }
  }
}

// Rust drops fields in declaration order. Release MIDI and diagnostics before
// the shared lease, so readiness also proves their callback references are gone.
struct VstCallback {
  midi: rt_queue::Receiver<MidiEvent>,
  meter: CallbackMeter,
  shared: Arc<HostShared>,
}
impl VstCallback {
  fn render(&mut self, output: &mut [f32], channels: usize, max_block: usize) {
    let started = Instant::now();
    render_block(&self.shared, &mut self.midi, output, channels, max_block);
    self.meter.finish(started, output.len() / channels);
  }
}

pub struct NativeVst3HostState { instances: Mutex<HashMap<String, HostedInstance>> }
impl Default for NativeVst3HostState {
  fn default() -> Self { Self { instances: Mutex::new(HashMap::new()) } }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVst3HostStatus {
  instance_id: String,
  ready: bool,
  sample_rate: u32,
  channels: u16,
  max_block_size: i32,
  audio_route: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVst3EditorStatus { width: i32, height: i32, resizable: bool }

fn ffi_error(buffer: &[c_char]) -> String {
  unsafe { CStr::from_ptr(buffer.as_ptr()).to_string_lossy().to_string() }
}

fn apply_mix(output: &mut [f32], channels: usize, shared: &HostShared) {
  if shared.muted.load(Ordering::Acquire) {
    output.fill(0.0);
    return;
  }
  let gain = f32::from_bits(shared.gain_bits.load(Ordering::Relaxed)).clamp(0.0, 2.0);
  let pan = f32::from_bits(shared.pan_bits.load(Ordering::Relaxed)).clamp(-1.0, 1.0);
  if channels < 2 {
    for sample in output.iter_mut() { *sample *= gain; }
    return;
  }
  let angle = (pan + 1.0) * std::f32::consts::FRAC_PI_4;
  let left_gain = angle.cos() * gain;
  let right_gain = angle.sin() * gain;
  for frame in output.chunks_mut(channels) {
    if let Some(left) = frame.get_mut(0) { *left *= left_gain; }
    if let Some(right) = frame.get_mut(1) { *right *= right_gain; }
    for sample in frame.iter_mut().skip(2) { *sample *= gain; }
  }
}

// Hard work ceiling; also limited to the capacity reported by the C++ bridge.
const MIDI_EVENTS_PER_CALLBACK: usize = 1024;
const MIDI_QUEUE_CAPACITY: usize = 4096;

fn render_block(shared: &HostShared, midi: &mut rt_queue::Receiver<MidiEvent>, output: &mut [f32], channels: usize, max_block_size: usize) {
  let frames = output.len() / channels;
  if frames == 0 || frames > max_block_size {
    shared.diagnostics.oversized_buffers.fetch_add(1, Ordering::Relaxed);
    output.fill(0.0);
    return;
  }
  midi.drain_bounded(shared.midi_budget, |event| unsafe {
    match event.kind {
      MidiEventKind::NoteOn => soura_vst3_note_on(shared.handle as *mut c_void, event.note, event.velocity, event.channel),
      MidiEventKind::NoteOff => soura_vst3_note_off(shared.handle as *mut c_void, event.note, event.velocity, event.channel),
    }
  });
  let ok = unsafe { soura_vst3_process(shared.handle as *mut c_void, output.as_mut_ptr(), frames as c_int, channels as c_int) };
  if ok == 0 {
    shared.diagnostics.process_failures.fetch_add(1, Ordering::Relaxed);
    output.fill(0.0);
    return;
  }
  apply_mix(output, channels, shared);
}

fn build_stream(shared: Arc<HostShared>, midi: rt_queue::Receiver<MidiEvent>, config: &StreamConfig, sample_format: SampleFormat, device: &cpal::Device, max_block_size: i32) -> Result<Stream, String> {
  let channels = usize::from(config.channels);
  if channels == 0 || config.sample_rate == 0 { return Err("Invalid native VST3 stream configuration.".into()); }
  let errors = Arc::clone(&shared.diagnostics);
  let err = move |error| { errors.record_stream_error(&error); };
  let meter = CallbackMeter::new(Arc::clone(&shared.diagnostics), config.sample_rate);
  let mut callback = VstCallback { midi, meter, shared };
  match sample_format {
    SampleFormat::F32 => device.build_output_stream(
      config,
      move |output: &mut [f32], _| {
        callback.render(output, channels, max_block_size as usize);
      },
      err,
      None,
    ).map_err(|e| format!("Could not build VST3 F32 output stream: {e}")),
    _ => Err(format!("Native VST3 Host v1 currently requires an F32 output device; current format is {sample_format:?}.")),
  }
}

#[tauri::command]
pub fn native_vst3_host_create(
  state: tauri::State<'_, NativeVst3HostState>,
  instance_id: String,
  path: String,
  sample_rate: f64,
  max_block_size: i32,
) -> Result<NativeVst3HostStatus, String> {
  let mut instances = state.instances.lock().map_err(|_| "VST3 host state lock failed".to_string())?;
  if let Some(existing) = instances.get(&instance_id) {
    return Ok(NativeVst3HostStatus { instance_id, ready: true, sample_rate: existing.sample_rate, channels: existing.channels, max_block_size: existing.max_block_size, audio_route: "soura-native-vst3-direct".into() });
  }

  let reclaimer = PLUGIN_RECLAIMER.get_or_init(Reclaimer::new).as_ref().map_err(Clone::clone)?.clone();
  let host = cpal::default_host();
  let device = host.default_output_device().ok_or_else(|| "No native output device is available for VST3 hosting.".to_string())?;
  let supported = device.default_output_config().map_err(|e| format!("Could not read native output configuration: {e}"))?;
  let config: StreamConfig = supported.clone().into();
  let actual_sample_rate = config.sample_rate as f64;
  if (sample_rate - actual_sample_rate).abs() > 1.0 {
    log::info!("[soura-vst3-host] using native device sample rate {} instead of requested {}", actual_sample_rate, sample_rate);
  }
  let actual_max_block = max_block_size.max(8192);

  let cpath = CString::new(path.clone()).map_err(|_| "VST3 path contains an invalid NUL byte".to_string())?;
  let mut error = vec![0 as c_char; 2048];
  let handle = unsafe { soura_vst3_create(cpath.as_ptr(), actual_sample_rate, actual_max_block, error.as_mut_ptr(), error.len() as c_int) };
  if handle.is_null() { return Err(format!("Could not instantiate VST3 '{}': {}", path, ffi_error(&error))); }

  let (midi_tx, midi_rx) = rt_queue::channel(MIDI_QUEUE_CAPACITY);
  let shared = Arc::new(HostShared {
    handle: handle as usize,
    diagnostics: Arc::new(RealtimeDiagnostics::default()),
    midi_budget: (unsafe { soura_vst3_event_capacity() } as usize).min(MIDI_EVENTS_PER_CALLBACK),
    gain_bits: AtomicU32::new(1.0f32.to_bits()),
    pan_bits: AtomicU32::new(0.0f32.to_bits()),
    muted: AtomicBool::new(false),
  });
  let mut instance = HostedInstance {
    stream: None, owner: Some(PluginOwner { shared, midi: midi_tx }), reclaimer,
    sample_rate: config.sample_rate, channels: config.channels, max_block_size: actual_max_block,
  };
  let shared = Arc::clone(&instance.owner.as_ref().unwrap().shared);
  instance.stream = Some(build_stream(shared, midi_rx, &config, supported.sample_format(), &device, actual_max_block)?);
  instance.stream.as_ref().unwrap().play().map_err(|e| format!("Could not start VST3 output stream: {e}"))?;

  let status = NativeVst3HostStatus {
    instance_id: instance_id.clone(), ready: true, sample_rate: config.sample_rate,
    channels: config.channels, max_block_size: actual_max_block,
    audio_route: "soura-native-vst3-direct".into(),
  };
  instances.insert(instance_id, instance);
  Ok(status)
}

#[tauri::command]
pub fn native_vst3_host_note_on(state: tauri::State<'_, NativeVst3HostState>, instance_id: String, note: i32, velocity: f32, channel: i32) -> Result<(), String> {
  let mut instances = state.instances.lock().map_err(|_| "VST3 host state lock failed".to_string())?;
  let instance = instances.get_mut(&instance_id).ok_or_else(|| "Native VST3 instance is not running.".to_string())?;
  let owner = instance.owner.as_mut().unwrap();
  owner.midi.push(MidiEvent { kind: MidiEventKind::NoteOn, note: note.clamp(0, 127), velocity: velocity.clamp(0.0, 1.0), channel: channel.clamp(0, 15) }).map_err(|_| { owner.shared.diagnostics.midi_overruns.fetch_add(1, Ordering::Relaxed); "Native VST3 MIDI queue is full; event was not accepted.".to_string() })
}

#[tauri::command]
pub fn native_vst3_host_note_off(state: tauri::State<'_, NativeVst3HostState>, instance_id: String, note: i32, velocity: f32, channel: i32) -> Result<(), String> {
  let mut instances = state.instances.lock().map_err(|_| "VST3 host state lock failed".to_string())?;
  let instance = instances.get_mut(&instance_id).ok_or_else(|| "Native VST3 instance is not running.".to_string())?;
  let owner = instance.owner.as_mut().unwrap();
  owner.midi.push(MidiEvent { kind: MidiEventKind::NoteOff, note: note.clamp(0, 127), velocity: velocity.clamp(0.0, 1.0), channel: channel.clamp(0, 15) }).map_err(|_| { owner.shared.diagnostics.midi_overruns.fetch_add(1, Ordering::Relaxed); "Native VST3 MIDI queue is full; event was not accepted.".to_string() })
}

#[tauri::command]
pub fn native_vst3_host_set_mix(state: tauri::State<'_, NativeVst3HostState>, instance_id: String, gain: f32, pan: f32, muted: bool) -> Result<(), String> {
  let instances = state.instances.lock().map_err(|_| "VST3 host state lock failed".to_string())?;
  let instance = instances.get(&instance_id).ok_or_else(|| "Native VST3 instance is not running.".to_string())?;
  instance.owner.as_ref().unwrap().shared.gain_bits.store(gain.clamp(0.0, 2.0).to_bits(), Ordering::Relaxed);
  instance.owner.as_ref().unwrap().shared.pan_bits.store(pan.clamp(-1.0, 1.0).to_bits(), Ordering::Relaxed);
  instance.owner.as_ref().unwrap().shared.muted.store(muted, Ordering::Release);
  Ok(())
}

#[tauri::command]
pub fn native_vst3_host_open_editor(state: tauri::State<'_, NativeVst3HostState>, instance_id: String) -> Result<NativeVst3EditorStatus, String> {
  let instances = state.instances.lock().map_err(|_| "VST3 host state lock failed".to_string())?;
  let instance = instances.get(&instance_id).ok_or_else(|| "Native VST3 instance is not running.".to_string())?;
  let mut info = SouraVst3EditorInfo { width: 0, height: 0, resizable: 0 };
  let mut error = vec![0 as c_char; 2048];
  let result = unsafe { soura_vst3_open_editor(instance.owner.as_ref().unwrap().shared.handle as *mut c_void, &mut info, error.as_mut_ptr(), error.len() as c_int) };
  if result == 0 { return Err(format!("Could not open VST3 editor: {}", ffi_error(&error))); }
  Ok(NativeVst3EditorStatus { width: info.width, height: info.height, resizable: info.resizable != 0 })
}

#[tauri::command]
pub fn native_vst3_host_dispose(state: tauri::State<'_, NativeVst3HostState>, instance_id: String) -> Result<(), String> {
  let mut instances = state.instances.lock().map_err(|_| "VST3 host state lock failed".to_string())?;
  // HostedInstance retires the plugin after stopping output. Reclamation waits
  // for backend-held callback references without waiting on the audio thread.
  drop(instances.remove(&instance_id));
  Ok(())
}

/// Read counters on the control plane; this command never enters the callback.
#[tauri::command]
pub fn native_vst3_host_get_diagnostics(state: tauri::State<'_, NativeVst3HostState>, instance_id: String) -> Result<DiagnosticsSnapshot, String> {
  let instances = state.instances.lock().map_err(|_| "VST3 host state lock failed".to_string())?;
  let instance = instances.get(&instance_id).ok_or_else(|| "Native VST3 instance is not running.".to_string())?;
  Ok(instance.owner.as_ref().unwrap().shared.diagnostics.snapshot())
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn rejected_buffer_is_silent_counted_and_keeps_pending_midi() {
    let (mut tx, mut rx) = rt_queue::channel(2);
    tx.push(MidiEvent { kind: MidiEventKind::NoteOff, note: 60, velocity: 0.0, channel: 0 }).ok().unwrap();
    let shared = HostShared {
      handle: 0, diagnostics: Arc::new(RealtimeDiagnostics::default()), midi_budget: MIDI_EVENTS_PER_CALLBACK,
      gain_bits: AtomicU32::new(1.0f32.to_bits()), pan_bits: AtomicU32::new(0.0f32.to_bits()), muted: AtomicBool::new(false),
    };
    let mut output = [1.0; 130];
    let counts = crate::audio::rt_test_alloc::measure(|| render_block(&shared, &mut rx, &mut output, 2, 64));
    assert_eq!(counts, (0, 0));
    assert!(output.iter().all(|sample| *sample == 0.0));
    assert_eq!(shared.diagnostics.snapshot().oversized_buffers, 1);
    assert_eq!(rx.pop().unwrap().note, 60);
  }
  #[test]
  fn complete_callback_drop_keeps_backing_storage_off_audio_thread() {
    let (tx, rx) = rt_queue::channel(MIDI_QUEUE_CAPACITY);
    let shared = Arc::new(HostShared {
      handle: 0, diagnostics: Arc::new(RealtimeDiagnostics::default()), midi_budget: MIDI_EVENTS_PER_CALLBACK,
      gain_bits: AtomicU32::new(1.0f32.to_bits()), pan_bits: AtomicU32::new(0.0f32.to_bits()), muted: AtomicBool::new(false),
    });
    let callback = VstCallback {
      midi: rx, meter: CallbackMeter::new(Arc::clone(&shared.diagnostics), 48000), shared: Arc::clone(&shared),
    };
    let mut owner = PluginOwner { shared, midi: tx };
    assert!(!owner.ready());
    std::thread::spawn(move || {
      let counts = crate::audio::rt_test_alloc::measure(|| drop(callback));
      assert_eq!(counts, (0, 0));
    }).join().unwrap();
    assert!(owner.ready());
    // Null test handle: teardown of backing allocations occurs here, off RT.
    drop(owner);
  }

  #[test]
  fn native_event_capacity_covers_callback_budget() {
    assert!(unsafe { soura_vst3_event_capacity() } >= MIDI_EVENTS_PER_CALLBACK as i32);
  }
}
