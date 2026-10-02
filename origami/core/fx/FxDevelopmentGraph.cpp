// mct-origami-fx-page-foundation-p01
#include "core/fx/FxGraph.h"

namespace mct::origami::fx {
// DEVELOPMENT ONLY. This seed exists so the Patch 1 routing UI can be
// inspected with a representative split/merge topology. Replace it with the
// production default (SYNTH OUT -> MASTER OUT, SERIAL mode) once real effect
// DSP ships. None of these effect nodes process audio.
FxGraph makeDevelopmentFxGraph() {
    FxGraph g;
    const auto source=g.addSource(FxSourceType::SynthSum,{24.0f,176.0f});
    const auto drive=g.addEffect(FxEffectType::Drive,{196.0f,138.0f});
    const auto split=g.addSplit({430.0f,180.0f});
    const auto delay=g.addEffect(FxEffectType::Delay,{560.0f,28.0f});
    const auto reverb=g.addEffect(FxEffectType::Reverb,{560.0f,250.0f});
    const auto merge=g.addMerge({800.0f,180.0f});
    const auto output=g.addOutput({930.0f,146.0f});
    g.connect({source,0},{drive,0});
    g.connect({drive,0},{split,0});
    g.connect({split,0},{delay,0});
    g.connect({split,1},{reverb,0});
    g.connect({delay,0},{merge,0});
    g.connect({reverb,0},{merge,1});
    g.connect({merge,0},{output,0});
    return g;
}
}
