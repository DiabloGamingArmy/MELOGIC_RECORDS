#import <Cocoa/Cocoa.h>
#import <Foundation/Foundation.h>

#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"

#include <algorithm>
#include <cstring>
#include <memory>
#include <string>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace {

struct SouraVst3EditorInfo { int width; int height; int resizable; };

static void writeError(char* buffer, int capacity, const std::string& message) {
  if (!buffer || capacity <= 0) return;
  const auto count = std::min<int>(capacity - 1, static_cast<int>(message.size()));
  std::memcpy(buffer, message.data(), count);
  buffer[count] = 0;
}

class Frame final : public IPlugFrame {
public:
  Frame() = default;
  void setWindow(NSWindow* window, IPlugView* view) { window_ = window; view_ = view; }

  tresult PLUGIN_API resizeView(IPlugView* view, ViewRect* newSize) override {
    if (!view || !newSize || view != view_ || !window_) return kInvalidArgument;

    __block tresult result = kResultTrue;

    void (^applyResize)(void) = ^{
      if (resizeInProgress_) {
        result = kResultTrue;
        return;
      }

      ViewRect current {};
      if (view_->getSize(&current) == kResultTrue
          && current.left == newSize->left
          && current.top == newSize->top
          && current.right == newSize->right
          && current.bottom == newSize->bottom) {
        result = kResultTrue;
        return;
      }

      const auto width = newSize->right - newSize->left;
      const auto height = newSize->bottom - newSize->top;
      if (width <= 0 || height <= 0) {
        result = kInvalidArgument;
        return;
      }

      resizeInProgress_ = true;

      [window_ setContentSize:NSMakeSize(width, height)];

      ViewRect accepted = *newSize;
      const auto onSizeResult = view_->onSize(&accepted);
      if (onSizeResult != kResultTrue && onSizeResult != kResultOk) {
        result = onSizeResult;
      }

      resizeInProgress_ = false;
    };

    if ([NSThread isMainThread]) {
      applyResize();
    } else {
      dispatch_sync(dispatch_get_main_queue(), applyResize);
    }

    return result;
  }

  tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
    if (FUnknownPrivate::iidEqual(iid, IPlugFrame::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) {
      *obj = static_cast<IPlugFrame*>(this); addRef(); return kResultTrue;
    }
    *obj = nullptr; return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return 1000; }
  uint32 PLUGIN_API release() override { return 1000; }
private:
  __weak NSWindow* window_ {nil};
  IPlugView* view_ {nullptr};
  bool resizeInProgress_ {false};
};

struct HostInstance {
  VST3::Hosting::Module::Ptr module;
  IPtr<PlugProvider> provider;
  OPtr<IComponent> component;
  OPtr<IEditController> controller;
  IPtr<IAudioProcessor> processor;
  HostProcessData processData;
  EventList inputEvents;
  ProcessContext processContext {};
  int maxBlockSize {512};
  double sampleRate {48000.0};
  NSWindow* editorWindow {nil};
  IPtr<IPlugView> plugView;
  std::unique_ptr<Frame> frame;

  ~HostInstance() {
    if (processor) processor->setProcessing(false);
    if (component) component->setActive(false);
    if (plugView) {
      plugView->setFrame(nullptr);
      plugView->removed();
      plugView = nullptr;
    }
    if (editorWindow) {
      dispatch_async(dispatch_get_main_queue(), ^{ [editorWindow close]; });
      editorWindow = nil;
    }
    provider = nullptr;
    controller = nullptr;
    component = nullptr;
    processor = nullptr;
    module.reset();
  }
};

static std::once_flag contextOnce;
static HostApplication* hostApplication = nullptr;

static void ensureHostContext() {
  std::call_once(contextOnce, [] {
    hostApplication = new HostApplication();
    PluginContextFactory::instance().setPluginContext(hostApplication);
  });
}

static HostInstance* createInstance(const char* path, double sampleRate, int maxBlockSize, std::string& error) {
  ensureHostContext();
  auto host = std::make_unique<HostInstance>();
  host->sampleRate = sampleRate;
  host->maxBlockSize = maxBlockSize;
  host->module = VST3::Hosting::Module::create(path, error);
  if (!host->module) return nullptr;

  auto factory = host->module->getFactory();
  for (auto& classInfo : factory.classInfos()) {
    if (classInfo.category() != kVstAudioEffectClass) continue;
    host->provider = owned(new PlugProvider(factory, classInfo, true));
    if (!host->provider || !host->provider->initialize()) { host->provider = nullptr; continue; }
    break;
  }
  if (!host->provider) { error = "No loadable VST3 audio-module class was found in the bundle."; return nullptr; }

  host->component = host->provider->getComponent();
  host->controller = host->provider->getController();
  if (!host->component) { error = "VST3 did not provide an IComponent."; return nullptr; }
  host->processor = U::cast<IAudioProcessor>(host->component);
  if (!host->processor) { error = "VST3 component does not implement IAudioProcessor."; return nullptr; }
  if (host->processor->canProcessSampleSize(kSample32) != kResultTrue) { error = "VST3 does not support 32-bit float processing."; return nullptr; }

  const auto eventInputs = host->component->getBusCount(kEvent, kInput);
  for (int32 i = 0; i < eventInputs; ++i) host->component->activateBus(kEvent, kInput, i, true);
  const auto audioOutputs = host->component->getBusCount(kAudio, kOutput);
  for (int32 i = 0; i < audioOutputs; ++i) host->component->activateBus(kAudio, kOutput, i, true);
  if (audioOutputs <= 0) { error = "VST3 exposes no audio output bus."; return nullptr; }

  host->inputEvents.setMaxSize(1024);
  host->processData.inputEvents = &host->inputEvents;
  host->processData.processContext = &host->processContext;
  host->processContext.sampleRate = sampleRate;
  host->processContext.tempo = 120.0;
  host->processData.prepare(*host->component, maxBlockSize, kSample32);

  ProcessSetup setup {kRealtime, kSample32, maxBlockSize, sampleRate};
  if (host->processor->setupProcessing(setup) != kResultTrue) { error = "IAudioProcessor::setupProcessing failed."; return nullptr; }
  if (host->component->setActive(true) != kResultTrue) { error = "IComponent::setActive(true) failed."; return nullptr; }
  if (host->processor->setProcessing(true) != kResultTrue) { error = "IAudioProcessor::setProcessing(true) failed."; return nullptr; }
  return host.release();
}

static void enqueueNote(HostInstance* host, bool on, int note, float velocity, int channel) {
  if (!host) return;
  Event event {};
  event.busIndex = 0;
  event.sampleOffset = 0;
  event.ppqPosition = 0;
  event.flags = Event::kIsLive;
  if (on) {
    event.type = Event::kNoteOnEvent;
    event.noteOn.channel = static_cast<int16>(channel);
    event.noteOn.pitch = static_cast<int16>(note);
    event.noteOn.tuning = 0.f;
    event.noteOn.velocity = velocity;
    event.noteOn.length = 0;
    event.noteOn.noteId = -1;
  } else {
    event.type = Event::kNoteOffEvent;
    event.noteOff.channel = static_cast<int16>(channel);
    event.noteOff.pitch = static_cast<int16>(note);
    event.noteOff.tuning = 0.f;
    event.noteOff.velocity = velocity;
    event.noteOff.noteId = -1;
  }
  host->inputEvents.addEvent(event);
}

} // namespace

extern "C" {

void* soura_vst3_create(const char* path, double sampleRate, int maxBlockSize, char* error, int errorCapacity) {
  if (!path) { writeError(error, errorCapacity, "VST3 path is null."); return nullptr; }
  std::string message;
  auto* instance = createInstance(path, sampleRate, maxBlockSize, message);
  if (!instance) writeError(error, errorCapacity, message.empty() ? "Unknown VST3 initialization error." : message);
  return instance;
}

void soura_vst3_destroy(void* handle) { delete static_cast<HostInstance*>(handle); }
void soura_vst3_note_on(void* handle, int note, float velocity, int channel) { enqueueNote(static_cast<HostInstance*>(handle), true, note, velocity, channel); }
void soura_vst3_note_off(void* handle, int note, float velocity, int channel) { enqueueNote(static_cast<HostInstance*>(handle), false, note, velocity, channel); }

int soura_vst3_process(void* handle, float* output, int frames, int channels) {
  auto* host = static_cast<HostInstance*>(handle);
  if (!host || !output || frames <= 0 || frames > host->maxBlockSize || channels <= 0) return 0;
  host->processData.numSamples = frames;
  {
      if (host->processor->process(host->processData) != kResultOk) return 0;
    host->inputEvents.clear();
  }
  if (host->processData.numOutputs <= 0 || !host->processData.outputs) return 0;
  const auto& bus = host->processData.outputs[0];
  if (bus.numChannels <= 0 || !bus.channelBuffers32) return 0;
  for (int frame = 0; frame < frames; ++frame) {
    for (int ch = 0; ch < channels; ++ch) {
      const int sourceCh = std::min(ch, bus.numChannels - 1);
      auto* source = bus.channelBuffers32[sourceCh];
      output[frame * channels + ch] = source ? source[frame] : 0.f;
    }
  }
  return 1;
}

int soura_vst3_open_editor(void* handle, SouraVst3EditorInfo* info, char* error, int errorCapacity) {
  auto* host = static_cast<HostInstance*>(handle);
  if (!host || !host->controller) { writeError(error, errorCapacity, "VST3 has no edit controller."); return 0; }
  __block int result = 0;
  void (^work)(void) = ^{
    if (host->editorWindow) { [host->editorWindow makeKeyAndOrderFront:nil]; result = 1; return; }
    auto view = owned(host->controller->createView(ViewType::kEditor));
    if (!view) { writeError(error, errorCapacity, "VST3 does not provide an editor view."); return; }
    if (view->isPlatformTypeSupported(kPlatformTypeNSView) != kResultTrue) { writeError(error, errorCapacity, "VST3 editor does not support an NSView host."); return; }
    ViewRect rect {};
    if (view->getSize(&rect) != kResultTrue) { writeError(error, errorCapacity, "VST3 editor did not report a valid size."); return; }
    const int width = std::max<int>(1, rect.right - rect.left);
    const int height = std::max<int>(1, rect.bottom - rect.top);
    NSRect contentRect = NSMakeRect(0, 0, width, height);
    NSWindowStyleMask mask = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable;
    if (view->canResize() == kResultTrue) mask |= NSWindowStyleMaskResizable;
    NSWindow* window = [[NSWindow alloc] initWithContentRect:contentRect styleMask:mask backing:NSBackingStoreBuffered defer:NO];
    [window setTitle:@"Soura VST3"];
    [window center];
    host->frame = std::make_unique<Frame>();
    host->frame->setWindow(window, view.get());
    view->setFrame(host->frame.get());
    if (view->attached((__bridge void*)window.contentView, kPlatformTypeNSView) != kResultTrue) {
      view->setFrame(nullptr); host->frame.reset(); [window close]; writeError(error, errorCapacity, "VST3 editor attachment failed."); return;
    }
    host->plugView = view;
    host->editorWindow = window;
    [window makeKeyAndOrderFront:nil];
    if (info) { info->width = width; info->height = height; info->resizable = view->canResize() == kResultTrue ? 1 : 0; }
    result = 1;
  };
  if ([NSThread isMainThread]) work(); else dispatch_sync(dispatch_get_main_queue(), work);
  return result;
}

} // extern C
