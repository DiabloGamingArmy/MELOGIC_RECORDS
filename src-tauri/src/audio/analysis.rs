use std::{
  collections::hash_map::DefaultHasher,
  fs,
  hash::{Hash, Hasher},
  path::PathBuf,
};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const ANALYSIS_VERSION: &str = "soura-analysis-1.0.0";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAnalysisSource {
  pub id: String,
  #[serde(default)]
  pub revision: String,
  #[serde(default)]
  pub name: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioAnalysisRequest {
  pub source: NativeAnalysisSource,
  pub sample_rate: u32,
  pub channels: Vec<Vec<f32>>,
  #[serde(default = "default_profile")]
  pub profile: String,
  #[serde(default = "default_scope")]
  pub scope: String,
  #[serde(default = "default_mode")]
  pub mode: String,
}

fn default_profile() -> String { "standard".to_string() }
fn default_scope() -> String { "track".to_string() }
fn default_mode() -> String { "independent".to_string() }

fn linear_to_db(value: f64) -> f64 {
  if value > 1e-12 { 20.0 * value.log10() } else { -120.0 }
}

fn cache_key(request: &NativeAudioAnalysisRequest) -> String {
  let mut hasher = DefaultHasher::new();
  ANALYSIS_VERSION.hash(&mut hasher);
  request.source.id.hash(&mut hasher);
  request.source.revision.hash(&mut hasher);
  request.sample_rate.hash(&mut hasher);
  request.channels.len().hash(&mut hasher);
  request.profile.hash(&mut hasher);
  format!("{:016x}", hasher.finish())
}

fn cache_path(app: &AppHandle, request: &NativeAudioAnalysisRequest) -> Result<PathBuf, String> {
  let directory = app.path().app_cache_dir()
    .map_err(|error| format!("Native analysis cache directory is unavailable: {error}"))?
    .join("audio-analysis")
    .join(ANALYSIS_VERSION);
  fs::create_dir_all(&directory)
    .map_err(|error| format!("Native analysis cache could not be created: {error}"))?;
  Ok(directory.join(format!("{}.json", cache_key(request))))
}

fn fft_power(samples: &[f64]) -> Vec<f64> {
  let size = samples.len().next_power_of_two().max(2);
  let mut real = vec![0.0; size];
  let mut imag = vec![0.0; size];
  for (index, sample) in samples.iter().enumerate() {
    let window = 0.5 - 0.5 * ((2.0 * std::f64::consts::PI * index as f64) / (samples.len().saturating_sub(1).max(1) as f64)).cos();
    real[index] = sample * window;
  }
  let mut swap = 0usize;
  for index in 1..size {
    let mut bit = size >> 1;
    while swap & bit != 0 { swap ^= bit; bit >>= 1; }
    swap ^= bit;
    if index < swap { real.swap(index, swap); imag.swap(index, swap); }
  }
  let mut length = 2;
  while length <= size {
    let angle = -2.0 * std::f64::consts::PI / length as f64;
    let w_length_real = angle.cos();
    let w_length_imag = angle.sin();
    for offset in (0..size).step_by(length) {
      let mut w_real = 1.0;
      let mut w_imag = 0.0;
      for index in 0..(length / 2) {
        let even = offset + index;
        let odd = even + length / 2;
        let odd_real = real[odd] * w_real - imag[odd] * w_imag;
        let odd_imag = real[odd] * w_imag + imag[odd] * w_real;
        real[odd] = real[even] - odd_real;
        imag[odd] = imag[even] - odd_imag;
        real[even] += odd_real;
        imag[even] += odd_imag;
        let next_w_real = w_real * w_length_real - w_imag * w_length_imag;
        w_imag = w_real * w_length_imag + w_imag * w_length_real;
        w_real = next_w_real;
      }
    }
    length <<= 1;
  }
  (0..size / 2).map(|index| (real[index] * real[index] + imag[index] * imag[index]) / (size * size) as f64).collect()
}

fn band_energies(spectrum: &[f64], sample_rate: f64, fft_size: usize) -> Value {
  let definitions = [
    ("sub", 20.0, 60.0), ("bass", 60.0, 200.0), ("lowMid", 200.0, 500.0),
    ("mid", 500.0, 2000.0), ("upperMid", 2000.0, 5000.0),
    ("presence", 5000.0, 10000.0), ("air", 10000.0, 24000.0),
  ];
  let mut values = Vec::new();
  let mut total = 0.0;
  for (name, low, high) in definitions {
    let low_bin = ((low * fft_size as f64 / sample_rate).floor() as usize).max(1);
    let high_bin = ((high.min(sample_rate / 2.0) * fft_size as f64 / sample_rate).ceil() as usize).min(spectrum.len().saturating_sub(1));
    let energy = if low_bin <= high_bin { spectrum[low_bin..=high_bin].iter().sum() } else { 0.0 };
    values.push((name, energy));
    total += energy;
  }
  let mut object = serde_json::Map::new();
  for (name, energy) in values { object.insert(name.to_string(), json!(if total > 1e-12 { energy / total } else { 0.0 })); }
  Value::Object(object)
}

fn analyze(request: &NativeAudioAnalysisRequest) -> Result<Value, String> {
  if request.channels.is_empty() { return Err("Native audio analysis received no channels.".to_string()); }
  let length = request.channels.iter().map(Vec::len).min().unwrap_or(0);
  let channel_count = request.channels.len();
  let sample_rate = request.sample_rate.max(8000) as f64;
  let frame_size = match request.profile.as_str() { "quick" => 1024, "deep" => 4096, _ => 2048 };
  let hop_size = if request.profile == "quick" { frame_size } else { 1024 };
  let mut sum = 0.0;
  let mut sum_squares = 0.0;
  let mut peak = 0.0f64;
  let mut clipping_samples = 0u64;
  let mut left_squares = 0.0;
  let mut right_squares = 0.0;
  let mut cross = 0.0;
  let mut mid_squares = 0.0;
  let mut side_squares = 0.0;
  let mut low_left = 0.0;
  let mut low_right = 0.0;
  let mut low_mid_squares = 0.0;
  let mut low_side_squares = 0.0;
  let low_pass_pole = (-2.0 * std::f64::consts::PI * 200.0 / sample_rate).exp();
  for index in 0..length {
    let mut mono = 0.0;
    for channel in &request.channels {
      let value = channel[index] as f64;
      mono += value / channel_count as f64;
      peak = peak.max(value.abs());
      if value.abs() >= 0.999 { clipping_samples += 1; }
    }
    sum += mono;
    sum_squares += mono * mono;
    if channel_count > 1 {
      let left = request.channels[0][index] as f64;
      let right = request.channels[1][index] as f64;
      left_squares += left * left;
      right_squares += right * right;
      cross += left * right;
      let mid = (left + right) * 0.5;
      let side = (left - right) * 0.5;
      mid_squares += mid * mid;
      side_squares += side * side;
      low_left = (1.0 - low_pass_pole) * left + low_pass_pole * low_left;
      low_right = (1.0 - low_pass_pole) * right + low_pass_pole * low_right;
      let low_mid = (low_left + low_right) * 0.5;
      let low_side = (low_left - low_right) * 0.5;
      low_mid_squares += low_mid * low_mid;
      low_side_squares += low_side * low_side;
    }
  }
  let rms = (sum_squares / length.max(1) as f64).sqrt();
  let duration = length as f64 / sample_rate;
  let left_rms = (left_squares / length.max(1) as f64).sqrt();
  let right_rms = (right_squares / length.max(1) as f64).sqrt();
  let correlation_denominator = (left_squares * right_squares).sqrt();
  let correlation = if channel_count > 1 && correlation_denominator > 1e-12 { Some((cross / correlation_denominator).clamp(-1.0, 1.0)) } else { None };
  let frame_count = if length == 0 { 0 } else { ((length.saturating_sub(1)) / hop_size) + 1 };
  let mut frames = Vec::with_capacity(frame_count);
  let mut band_sums = [0.0f64; 7];
  let band_names = ["sub", "bass", "lowMid", "mid", "upperMid", "presence", "air"];
  let mut centroids = Vec::new();
  let mut rolloffs = Vec::new();
  let mut previous_rms = 0.0;
  for frame_index in 0..frame_count {
    let start = frame_index * hop_size;
    let end = (start + frame_size).min(length);
    let mut mono = vec![0.0f64; frame_size];
    let mut frame_sum = 0.0;
    let mut frame_squares = 0.0;
    let mut frame_peak = 0.0f64;
    let mut frame_clips = 0u64;
    for sample_index in start..end {
      let value = request.channels.iter().map(|channel| channel[sample_index] as f64).sum::<f64>() / channel_count as f64;
      mono[sample_index - start] = value;
      frame_sum += value;
      frame_squares += value * value;
      frame_peak = frame_peak.max(value.abs());
      if value.abs() >= 0.999 { frame_clips += 1; }
    }
    let count = end.saturating_sub(start).max(1);
    let frame_rms = (frame_squares / count as f64).sqrt();
    let spectrum = fft_power(&mono);
    let bands = band_energies(&spectrum, sample_rate, frame_size);
    for (index, name) in band_names.iter().enumerate() { band_sums[index] += bands.get(*name).and_then(Value::as_f64).unwrap_or(0.0); }
    let total_power: f64 = spectrum.iter().sum();
    let centroid = if total_power > 1e-12 { spectrum.iter().enumerate().map(|(bin, power)| power * bin as f64 * sample_rate / frame_size as f64).sum::<f64>() / total_power } else { 0.0 };
    let mut cumulative = 0.0;
    let mut rolloff = 0.0;
    for (bin, power) in spectrum.iter().enumerate() { cumulative += power; if cumulative >= total_power * 0.85 { rolloff = bin as f64 * sample_rate / frame_size as f64; break; } }
    centroids.push(centroid);
    rolloffs.push(rolloff);
    let (frame_left_rms, frame_right_rms, frame_correlation) = if channel_count > 1 {
      let mut ls = 0.0; let mut rs = 0.0; let mut cr = 0.0;
      for index in start..end { let l = request.channels[0][index] as f64; let r = request.channels[1][index] as f64; ls += l*l; rs += r*r; cr += l*r; }
      let denominator = (ls * rs).sqrt();
      ((ls / count as f64).sqrt(), (rs / count as f64).sqrt(), if denominator > 1e-12 { Some((cr / denominator).clamp(-1.0, 1.0)) } else { None })
    } else { (0.0, 0.0, None) };
    frames.push(json!({
      "startSeconds": start as f64 / sample_rate, "endSeconds": end as f64 / sample_rate,
      "peak": frame_peak, "rms": frame_rms, "dcOffset": frame_sum / count as f64,
      "clippingSamples": frame_clips, "leftRms": frame_left_rms, "rightRms": frame_right_rms,
      "correlation": frame_correlation, "spectralCentroidHz": centroid, "spectralRolloffHz": rolloff,
      "bandEnergy": bands, "chroma": vec![0.0; 12], "onsetStrength": (frame_rms - previous_rms).max(0.0)
    }));
    previous_rms = previous_rms * 0.55 + frame_rms * 0.45;
  }
  let mut aggregate_bands = serde_json::Map::new();
  for (index, name) in band_names.iter().enumerate() { aggregate_bands.insert(name.to_string(), json!(band_sums[index] / frame_count.max(1) as f64)); }
  let clipping_detection = if clipping_samples > 0 { vec![json!({ "id": "clipping-summary", "type": "probable-clipping", "label": format!("{} samples at or above the clipping threshold", clipping_samples), "severity": (clipping_samples as f64 / 64.0).clamp(0.3, 1.0), "confidence": 0.99 })] } else { Vec::new() };
  Ok(json!({
    "version": ANALYSIS_VERSION,
    "mode": request.mode,
    "scope": request.scope,
    "profile": request.profile,
    "source": { "id": request.source.id, "revision": request.source.revision, "name": request.source.name, "sampleRate": request.sample_rate, "channelCount": channel_count, "durationSeconds": duration },
    "measurements": {
      "levels": { "samplePeakDbfs": linear_to_db(peak), "estimatedTruePeakDbtp": linear_to_db(peak), "rmsDbfs": linear_to_db(rms), "estimatedIntegratedLufs": linear_to_db(rms) - 0.691, "maximumShortTermLufs": linear_to_db(rms) - 0.691, "maximumMomentaryLufs": linear_to_db(rms) - 0.691, "loudnessRangeLu": 0.0, "crestFactorDb": linear_to_db(peak) - linear_to_db(rms), "dcOffset": sum / length.max(1) as f64, "clippingSamples": clipping_samples, "durationSeconds": duration },
      "dynamics": { "transientDensityPerSecond": 0.0, "macroVariationDb": 0.0, "microVariationDb": 0.0, "noiseFloorEstimateDbfs": linear_to_db(rms) },
      "spectral": { "bands": aggregate_bands, "centroidHz": if centroids.is_empty() { 0.0 } else { centroids.iter().sum::<f64>() / centroids.len() as f64 }, "rolloffHz": if rolloffs.is_empty() { 0.0 } else { rolloffs.iter().sum::<f64>() / rolloffs.len() as f64 }, "resonanceCandidates": [] },
      "stereo": { "channelCount": channel_count, "leftRmsDbfs": linear_to_db(left_rms), "rightRmsDbfs": linear_to_db(right_rms), "balanceDb": if channel_count > 1 { linear_to_db(right_rms) - linear_to_db(left_rms) } else { 0.0 }, "correlation": correlation, "widthSideMidRatio": if mid_squares > 1e-12 { (side_squares / mid_squares).sqrt() } else { 0.0 }, "lowFrequencyStereoRatio": if low_mid_squares > 1e-12 { (low_side_squares / low_mid_squares).sqrt() } else { 0.0 }, "monoCompatible": correlation.map(|value| value >= -0.1).unwrap_or(true) },
      "musical": { "bpm": Value::Null, "bpmConfidence": 0.0, "beatsSeconds": [], "onsetsSeconds": [], "key": Value::Null, "scale": Value::Null, "keyConfidence": 0.0, "tuningHz": 440.0, "tuningConfidence": 0.0, "chroma": vec![0.0; 12] },
      "waveform": []
    },
    "detections": clipping_detection,
    "recommendations": [],
    "timelineFindings": [],
    "confidence": { "levels": 1.0, "dynamics": (duration / 5.0).clamp(0.25, 1.0), "spectral": (duration / 3.0).clamp(0.25, 1.0), "stereo": if channel_count > 1 { (duration / 2.0).clamp(0.4, 1.0) } else { 1.0 }, "musical": 0.0 },
    "metadata": { "provider": "native", "signalStage": "source", "cache": "miss", "analyzedAt": "native", "analysisMs": 0.0, "framesProcessed": frame_count, "standards": { "loudness": "non-standard RMS-derived estimate", "truePeak": "sample peak only" }, "warnings": ["Native standardized EBU R128 loudness is not yet enabled; displayed loudness is explicitly estimated."] },
    "frameFeatures": frames
  }))
}

pub fn analyze_with_cache(app: &AppHandle, request: NativeAudioAnalysisRequest) -> Result<Value, String> {
  let path = cache_path(app, &request)?;
  if let Ok(contents) = fs::read_to_string(&path) {
    if let Ok(mut cached) = serde_json::from_str::<Value>(&contents) {
      cached["metadata"]["cache"] = json!("hit");
      cached["metadata"]["analysisMs"] = json!(0.0);
      return Ok(cached);
    }
  }
  let result = analyze(&request)?;
  if let Ok(serialized) = serde_json::to_vec(&result) {
    let temporary = path.with_extension("json.tmp");
    if fs::write(&temporary, serialized).is_ok() { let _ = fs::rename(temporary, path); }
  }
  Ok(result)
}
