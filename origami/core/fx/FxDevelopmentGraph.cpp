// mct-origami-fx-page-foundation-p01
#include "core/fx/FxGraph.h"

namespace mct::origami::fx {
// DEVELOPMENT ONLY: a representative split/merge topology for inspecting the
// routing UI. Reached exclusively through TEMPLATES > Development Graph; the
// production default is makeDefaultFxGraph() (BUS 1 -> MASTER OUT).
FxGraph makeDevelopmentFxGraph() {
    FxGraph g;
    const auto source=g.addBusSource(fxMainBusId,{24.0f,190.0f});
    const auto drive=g.addEffect(FxEffectType::Drive,{200.0f,150.0f});
    const auto split=g.addSplit({450.0f,196.0f});
    const auto delay=g.addEffect(FxEffectType::Delay,{590.0f,24.0f});
    const auto reverb=g.addEffect(FxEffectType::Reverb,{590.0f,268.0f});
    const auto merge=g.addMerge({850.0f,196.0f});
    const auto output=g.addOutput({990.0f,150.0f});
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
