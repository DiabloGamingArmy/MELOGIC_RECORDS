// Compile the actual bridge with a deterministic processor; no audio device or
// third-party plugin is needed. SDK buffers and the FFI path remain real.
#include "../soura_vst3_host.mm"
#include <cstdlib>
#include <cstdio>

static void require(bool condition, const char* message) {
  if (!condition) { std::fprintf(stderr, "%s\n", message); std::abort(); }
}

class TestProcessor final : public IAudioProcessor {
public:
  bool fail {false};
  int seen {0};
  tresult PLUGIN_API queryInterface(const TUID, void** object) override { *object = nullptr; return kNoInterface; }
  uint32 PLUGIN_API addRef() override { return 1; }
  uint32 PLUGIN_API release() override { return 1; }
  tresult PLUGIN_API setBusArrangements(SpeakerArrangement*, int32, SpeakerArrangement*, int32) override { return kResultOk; }
  tresult PLUGIN_API getBusArrangement(BusDirection, int32, SpeakerArrangement&) override { return kResultOk; }
  tresult PLUGIN_API canProcessSampleSize(int32) override { return kResultOk; }
  uint32 PLUGIN_API getLatencySamples() override { return 0; }
  tresult PLUGIN_API setupProcessing(ProcessSetup&) override { return kResultOk; }
  tresult PLUGIN_API setProcessing(TBool) override { return kResultOk; }
  uint32 PLUGIN_API getTailSamples() override { return 0; }
  tresult PLUGIN_API process(ProcessData& data) override {
    Frame frame;
    ViewRect size {};
    require(frame.resizeView(nullptr, &size) == kResultFalse, "RT resize reached UI validation/dispatch");
    seen = data.inputEvents->getEventCount();
    return fail ? kResultFalse : kResultOk;
  }
};

int main() {
  TestProcessor processor;
  HostInstance host;
  host.processor = &processor;
  host.maxBlockSize = 1024;
  host.inputEvents.setMaxSize(soura_vst3_event_capacity());
  host.processData.inputEvents = &host.inputEvents;
  // Supply one known stereo frame block. Detach before HostProcessData destroys
  // buffers, since this test owns these arrays.
  float left[1024], right[1024], output[2048];
  std::fill_n(left, 1024, 0.25f);
  std::fill_n(right, 1024, -0.5f);
  float* channels[] = {left, right};
  AudioBusBuffers bus {};
  bus.numChannels = 2;
  bus.channelBuffers32 = channels;
  host.processData.numOutputs = 1;
  host.processData.outputs = &bus;

  for (int frames : {64, 128, 256, 512, 1024}) {
    for (int batch = 0; batch < 4; ++batch) {
      for (int i = 0; i < 1024; ++i) soura_vst3_note_on(&host, i % 128, 0.5f, 0);
      processor.fail = batch == 1;
      require(soura_vst3_process(&host, output, frames, 2) == (processor.fail ? 0 : 1), "processor result not propagated");
      require(processor.seen == 1024, "accepted MIDI missing from block");
      require(host.inputEvents.getEventCount() == 0, "failed block retained MIDI events");
      processor.fail = false;
      require(soura_vst3_process(&host, output, frames, 2) == 1, "recovery process failed");
      require(processor.seen == 0, "failed block replayed stale MIDI");
      for (int i = 0; i < frames; ++i) require(output[2*i] == 0.25f && output[2*i+1] == -0.5f, "interleaving changed");
    }
  }
  require(!inRealtimeProcess, "RT guard leaked into control thread");
  host.processData.numOutputs = 0;
  host.processData.outputs = nullptr;
  std::puts("PASS: native bridge MIDI capacity, failure cleanup, recovery, stereo output, buffer matrix");
}
