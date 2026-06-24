// Soura Signalsmith Stretch wrapper.
//
// This source is the intended Emscripten build target for the production
// Signalsmith engine. The checked-in browser integration requires a WASM
// module with the C ABI below; see docs/soura-wasm-dsp.md for the build path.

#include "signalsmith-stretch.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

int renderWithSignalsmith(
  const float* inputInterleaved,
  int inputFrames,
  int channels,
  int sampleRate,
  float semitones,
  float cents,
  float stretchRatio,
  float* outputInterleaved,
  int outputFrames,
  int qualityMode
) {
  if (!inputInterleaved || !outputInterleaved || inputFrames <= 0 || outputFrames <= 0 || channels <= 0) return -1;

  signalsmith::stretch::SignalsmithStretch<float> stretch;
  if (qualityMode <= 0) stretch.presetCheaper(channels, sampleRate);
  else stretch.presetDefault(channels, sampleRate);

  const float transpose = semitones + (cents / 100.0f);
  if (std::abs(transpose) > 0.0001f) stretch.setTransposeSemitones(transpose);

  std::vector<std::vector<float>> input(static_cast<size_t>(channels));
  std::vector<std::vector<float>> output(static_cast<size_t>(channels));
  for (int channel = 0; channel < channels; ++channel) {
    input[channel].resize(static_cast<size_t>(inputFrames));
    output[channel].assign(static_cast<size_t>(outputFrames), 0.0f);
    for (int frame = 0; frame < inputFrames; ++frame) {
      input[channel][frame] = inputInterleaved[(frame * channels) + channel];
    }
  }

  std::vector<float*> inputPtrs(static_cast<size_t>(channels));
  std::vector<float*> outputPtrs(static_cast<size_t>(channels));
  for (int channel = 0; channel < channels; ++channel) {
    inputPtrs[channel] = input[channel].data();
    outputPtrs[channel] = output[channel].data();
  }

  const float rate = stretchRatio > 0.0f ? 1.0f / stretchRatio : 1.0f;
  stretch.seek(inputPtrs.data(), inputFrames, rate);
  stretch.process(inputPtrs.data(), inputFrames, outputPtrs.data(), outputFrames);

  for (int frame = 0; frame < outputFrames; ++frame) {
    for (int channel = 0; channel < channels; ++channel) {
      outputInterleaved[(frame * channels) + channel] = output[channel][frame];
    }
  }

  return 0;
}

}  // namespace

extern "C" {

const char* soura_dsp_engine_id() {
  return "soura-wasm-signalsmith-v1";
}

const char* soura_dsp_engine_version() {
  return "signalsmith-stretch-1.3.2";
}

void* soura_malloc(int bytes) {
  if (bytes <= 0) return nullptr;
  return std::malloc(static_cast<size_t>(bytes));
}

void soura_free(void* ptr) {
  std::free(ptr);
}

int soura_render_time_stretch(
  const float* inputInterleaved,
  int inputFrames,
  int channels,
  int sampleRate,
  float stretchRatio,
  float* outputInterleaved,
  int outputFrames,
  int qualityMode
) {
  return renderWithSignalsmith(
    inputInterleaved,
    inputFrames,
    channels,
    sampleRate,
    0.0f,
    0.0f,
    stretchRatio,
    outputInterleaved,
    outputFrames,
    qualityMode
  );
}

int soura_render_pitch_shift(
  const float* inputInterleaved,
  int inputFrames,
  int channels,
  int sampleRate,
  float semitones,
  float cents,
  float* outputInterleaved,
  int outputFrames,
  int qualityMode
) {
  return renderWithSignalsmith(
    inputInterleaved,
    inputFrames,
    channels,
    sampleRate,
    semitones,
    cents,
    1.0f,
    outputInterleaved,
    outputFrames,
    qualityMode
  );
}

int soura_render_pitch_and_stretch(
  const float* inputInterleaved,
  int inputFrames,
  int channels,
  int sampleRate,
  float semitones,
  float cents,
  float stretchRatio,
  float* outputInterleaved,
  int outputFrames,
  int qualityMode
) {
  return renderWithSignalsmith(
    inputInterleaved,
    inputFrames,
    channels,
    sampleRate,
    semitones,
    cents,
    stretchRatio,
    outputInterleaved,
    outputFrames,
    qualityMode
  );
}

}
