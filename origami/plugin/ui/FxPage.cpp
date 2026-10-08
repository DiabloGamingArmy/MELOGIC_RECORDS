// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#include "FxPage.h"
#include "UserPreferences.h"
#include "SourceEntity.h"
#include "ModulationUiTelemetry.h"
#include "core/fx/FxFilter.h"
#include "core/dsp/Comb.h"
#include <cmath>
#include <cstring>
#include <limits>

namespace mct::origami::ui {
namespace {
using namespace mct::origami::fx;

constexpr int toolbarHeight=44;
constexpr int inspectorHeight=250;

// The same painter used by SYNTH's macro/LFO controls. The normalized FX
// position comes from the canonical evaluator, sampled on the message thread.
class FxFeedbackSlider final : public juce::Slider {
public:
    explicit FxFeedbackSlider(FxPage& page):page_(page) {
        // Reserve physical pixels for the modulation ring. Origami's authored
        // knob arc is intentionally oversized (0.54 * knob diameter), so an
        // independent outer track cannot fit inside the component unless the
        // base knob is drawn slightly smaller.
        getProperties().set("mct.origami.knobScale",0.82);
    }
    void paint(juce::Graphics& g) override {
        juce::Slider::paint(g);
        const auto& props=getProperties();
        const auto node=std::uint32_t(int(props["mct.mod.oscillator"]));
        const auto item=std::uint32_t(int(props["mct.mod.itemId"]));
        const ModAddress address{ModDestination::FxParameter,node,item};
        const auto range=fxKnobModulationRange(float(getValue()),address,page_.visualModulation(),modulationUiTelemetry().selectedSource);
        float current=float(getValue());
        const auto& frame=page_.visualFxFrame();
        for(std::size_t i=0;i<frame.count;++i)
            if(frame.bus[i]==fxAddressBus(address) && frame.node[i]==node && frame.parameter[i]==fxAddressParameter(address))
                current=juce::jlimit(0.0f,1.0f,current+frame.offset[i]);
        if(isRotary())
            paintKnobModulationOverlay(g,getLocalBounds().toFloat().expanded(1.0f),range.lo,range.hi,
                                       range.hasDepth,range.anyRoute,true,current,range.selected);
        else if(range.anyRoute) {
            const auto r=getLocalBounds().toFloat().reduced(3.0f);
            g.setColour(signalSourceColour());
            g.drawLine(r.getX()+r.getWidth()*range.lo,r.getBottom()-2,r.getX()+r.getWidth()*range.hi,r.getBottom()-2,1.5f);
            g.fillEllipse(juce::Rectangle<float>(4,4).withCentre({r.getX()+r.getWidth()*current,r.getBottom()-2}));
        }
        if(isMouseOverOrDragging()) {
            g.setColour(Palette::text().withAlpha(.32f));
            if(isRotary()) g.drawEllipse(getLocalBounds().toFloat().reduced(6.0f),1.0f);
            else g.drawRect(getLocalBounds().toFloat().reduced(.5f),1.0f);
        }
    }
private:
    FxPage& page_;
};

void configureKnob(juce::Slider& s) {
    s.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    s.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    s.setRotaryParameters(juce::MathConstants<float>::pi*1.20f,juce::MathConstants<float>::pi*2.80f,true);
    s.setMouseDragSensitivity(220);
    // The wheel navigates the graph; knobs change only by dragging.
    s.setScrollWheelEnabled(false);
}

// FX parameters advertise their canonical modulation destination exactly like
// every other Origami knob, so the editor's drag/drop, right-click menu and
// range overlays work without an FX-specific path.
void tagModulationDestination(juce::Slider& s,BusId bus,FxNodeId node,const FxParameterDescriptor& p) {
    auto& props=s.getProperties();
    props.set("mct.mod.destination",static_cast<int>(ModDestination::FxParameter));
    props.set("mct.mod.oscillator",static_cast<int>(node));
    // Bus-qualified parameter id (FX node IDs are unique per bus graph).
    props.set("mct.mod.itemId",static_cast<int>(fxParameterAddress(bus,node,p.id).itemId));
    props.set("mct.origami.knobDefault",double(p.defaultValue));
    s.setDoubleClickReturnValue(true,p.defaultValue);
}

std::vector<const FxParameterDescriptor*> parametersFor(const FxNode& node,bool quickOnly,
                                                        std::optional<FxParameterPage> page) {
    std::vector<const FxParameterDescriptor*> result;
    if(node.kind!=FxNodeKind::Effect) return result;
    if(const auto* d=findFxEffect(node.effect))
        for(std::size_t i=0;i<d->parameterCount;++i) {
            const auto& p=d->parameters[i];
            if(quickOnly && !p.quick) continue;
            if(page && p.page!=*page) continue;
            if(!node.parameterVisible(p)) continue; // variant/mode system
            result.push_back(&p);
        }
    return result;
}

const FxParameterDescriptor* parameterDescriptor(const FxNode& node,FxParameterId id) {
    if(const auto* d=findFxEffect(node.effect))
        for(std::size_t i=0;i<d->parameterCount;++i) if(d->parameters[i].id==id) return &d->parameters[i];
    return nullptr;
}

float physical(const FxNode& n,std::size_t index) {
    const auto* d=findFxEffect(n.effect);
    if(d==nullptr || index>=d->parameterCount) return 0.0f;
    const auto& p=d->parameters[index];
    return fxParameterValue(p,n.parameter(p.id).value_or(p.defaultValue));
}

juce::String valueText(const FxNode& n,const FxParameterDescriptor& p) {
    return juce::String(fxParameterText(p,n.parameter(p.id).value_or(p.defaultValue)));
}

juce::String sourceName(ModSource s) {
    using S=ModSource;
    if(const auto id=macroIdOf(s)) return "MACRO "+juce::String(int(id));
    switch(s) {
    case S::Env1:return "ENV 1"; case S::Env2:return "ENV 2"; case S::Env3:return "ENV 3";
    case S::Lfo1:return "LFO 1"; case S::Lfo2:return "LFO 2"; case S::Lfo3:return "LFO 3"; case S::Lfo4:return "LFO 4";
    case S::Random:return "RANDOM"; case S::Function:return "FUNCTION";
    case S::Chaos:return "CHAOS"; case S::Drift:return "DRIFT"; case S::Sequencer:return "SEQUENCER";
    case S::ModWheel:return "MOD WHEEL"; case S::Velocity:return "VELOCITY"; case S::Keytrack:return "KEYTRACK";
    case S::Aftertouch:return "AFTERTOUCH"; case S::PitchBend:return "PITCH BEND"; case S::NoteGate:return "NOTE GATE";
    default:break;
    }
    // N07: a processed route's source is a NODES output, never an anonymous "MODULATOR".
    return isOperatorSource(s) ? "NODES" : "UNKNOWN SOURCE";
}
// mct-origami-nested-modulation-manual-qa: a renamed macro shows its name.
juce::String sourceName(const ModulationState& m,ModSource s) {
    if(isInstanceSource(s)) return modulationSourceLabel(m,s);
    if(const auto id=macroIdOf(s)) return macroLabel(m,id);
    return sourceName(s);
}

// N07: the label of any route source, with the graph when it is processed
// ("NODES: SCALE / OFFSET", "NODES: SEQUENCER STEP"), as the Matrix names it.
juce::String routeSourceLabel(const ModulationState& m,ModSource s) {
    if(!isOperatorSource(s)) return sourceName(m,s);
    juce::String label="NODES";
    if(const auto* op=findControlOperator(m,operatorIdOf(s)))
        if(const auto* info=controlOpInfo(op->type)) {
            label+=": "+juce::String(info->label);
            if(info->outputCount>1) label+=" "+juce::String(controlOutputName(*info,operatorPortOf(s)));
        }
    return label;
}

struct SourceEntry { ModSource source; const char* group; };
// Canonical modulator references available in the current instrument.
std::vector<SourceEntry> availableSources(const ModulationState& m) {
    std::vector<SourceEntry> out;
    const ModSource envs[]{ModSource::Env1,ModSource::Env2,ModSource::Env3};
    for(int i=0;i<3;++i) if(m.envActiveMask&(1u<<i)) out.push_back({envs[i],"ENVELOPES"});
    const ModSource lfos[]{ModSource::Lfo1,ModSource::Lfo2,ModSource::Lfo3,ModSource::Lfo4};
    for(int i=0;i<4;++i) if(m.lfoActiveMask&(1u<<i)) out.push_back({lfos[i],"LFOS"});
    for(auto s:activeMacroSources(m)) out.push_back({s,"MACROS"});
    if(m.generatorActiveMask&0x02u) out.push_back({ModSource::Random,"GENERATORS"});
    if(m.generatorActiveMask&0x01u) out.push_back({ModSource::Function,"GENERATORS"});
    if(m.generatorActiveMask&0x04u) out.push_back({ModSource::Chaos,"GENERATORS"});
    if(m.generatorActiveMask&0x08u) out.push_back({ModSource::Drift,"GENERATORS"});
    if(m.generatorActiveMask&0x10u) out.push_back({ModSource::Sequencer,"GENERATORS"});
    for(auto s:{ModSource::Velocity,ModSource::ModWheel,ModSource::Keytrack,ModSource::Aftertouch,ModSource::PitchBend,ModSource::NoteGate})
        out.push_back({s,"PERFORMANCE"});
    for(const auto& a:m.instances) if(a.id) out.push_back({instanceSource(a.id),"INSTANCES"});
    return out;
}

float physicalById(const FxNode& n,FxParameterId id) {
    const auto* d=findFxEffect(n.effect);
    const auto* p=d ? findFxParameter(*d,id) : nullptr;
    return p ? fxParameterValue(*p,n.parameter(id).value_or(p->defaultValue)) : 0.0f;
}

// EQ: combined analytic response of the enabled bands (same SVF design as DSP).
float eqResponseDb(const FxNode& n,float hz) {
    static constexpr SvfShape shapes[6]{SvfShape::HighPass,SvfShape::LowShelf,SvfShape::Bell,SvfShape::Notch,SvfShape::HighShelf,SvfShape::LowPass};
    double magnitude=1.0;
    for(int b=0;b<8;++b) {
        const auto base=FxParameterId(100+b*10);
        if(physicalById(n,base+1)<0.5f) continue;
        const auto c=svfDesign(shapes[juce::jlimit(0,5,int(physicalById(n,base+2)))],physicalById(n,base+3),
                               physicalById(n,base+5),physicalById(n,base+4),48000.0);
        magnitude*=svfMagnitude(c,hz,48000.0);
    }
    return float(20.0*std::log10(std::max(magnitude,1.0e-6)));
}

// UI-generated pictures of what each effect does, driven by its canonical
// parameters. No audio is streamed to the UI to draw these.
void paintEffectPreview(juce::Graphics& g,juce::Rectangle<float> r,const FxNode& n,double sampleRate) {
    well(g,r.toNearestInt());
    const auto* d=findFxEffect(n.effect);
    if(d==nullptr) return;
    juce::Graphics::ScopedSaveState clipped(g);
    g.reduceClipRegion(r.toNearestInt());
    auto in=r.reduced(8.0f,7.0f).withTrimmedTop(12.0f);
    const auto ink=Palette::accent().withAlpha(n.enabled ? .85f : .28f);
    g.setColour(Palette::borderSoft().withAlpha(.8f));
    g.drawHorizontalLine(juce::roundToInt(in.getCentreY()),in.getX(),in.getRight());
    juce::Path path;
    const auto plot=[&](int count,const std::function<float(float)>& y01) {
        for(int i=0;i<=count;++i) {
            const float t=float(i)/float(count);
            const juce::Point<float> p{in.getX()+t*in.getWidth(),in.getBottom()-juce::jlimit(0.0f,1.0f,y01(t))*in.getHeight()};
            if(i==0) path.startNewSubPath(p); else path.lineTo(p);
        }
    };
    switch(d->visual) {
    case FxVisual::Transfer: {
        const float gain=std::pow(10.0f,physical(n,0)/20.0f),bias=physical(n,3);
        const float norm=std::max(std::abs(std::tanh(gain+bias)),std::abs(std::tanh(-gain+bias)));
        plot(64,[&](float t){return 0.5f+0.5f*std::tanh(gain*(2.0f*t-1.0f)+bias)/norm;});
        break;
    }
    case FxVisual::Taps: {
        const float time=physical(n,0),feedback=physical(n,1);
        const bool pingPong=physical(n,5)>=0.5f;
        const float spacing=in.getWidth()*std::sqrt(time/2000.0f)*0.9f+3.0f;
        float level=1.0f;
        g.setColour(ink);
        int tap=0;
        for(float x=in.getX()+2.0f;x<in.getRight() && level>.04f;x+=spacing,level*=std::max(feedback,0.08f),++tap) {
            const float h=level*in.getHeight()*0.5f;
            const bool up=!pingPong || tap%2==0;
            g.fillRect(juce::Rectangle<float>(x,up ? in.getCentreY()-h : in.getCentreY(),2.0f,h));
            if(feedback<0.01f) break;
        }
        return;
    }
    case FxVisual::Decay: {
        const float rt60=physical(n,1),pre=physical(n,4)/1000.0f,window=std::max(2.0f,rt60*1.2f);
        plot(64,[&](float t){
            const float seconds=t*window-pre;
            return seconds<0.0f ? 0.0f : std::exp(-6.9f*seconds/rt60)*0.95f;
        });
        auto fill=path;
        fill.lineTo(in.getRight(),in.getBottom());
        fill.lineTo(in.getX(),in.getBottom());
        fill.closeSubPath();
        g.setColour(ink.withMultipliedAlpha(.14f));
        g.fillPath(fill);
        break;
    }
    case FxVisual::Lfo: {
        const float cycles=juce::jlimit(0.5f,8.0f,physical(n,0)*2.0f),depth=physical(n,1);
        plot(96,[&](float t){return 0.5f+0.45f*depth*std::sin(juce::MathConstants<float>::twoPi*cycles*t);});
        g.setColour(ink.withMultipliedAlpha(.45f));
        juce::Path second;
        const float offset=physical(n,4)*juce::MathConstants<float>::pi;
        for(int i=0;i<=96;++i) {
            const float t=float(i)/96.0f;
            const juce::Point<float> p{in.getX()+t*in.getWidth(),in.getCentreY()-in.getHeight()*0.45f*depth*std::sin(juce::MathConstants<float>::twoPi*cycles*t+offset)};
            if(i==0) second.startNewSubPath(p); else second.lineTo(p);
        }
        g.strokePath(second,juce::PathStrokeType(1.0f));
        break;
    }
    case FxVisual::Comb: {
        const float f0=physical(n,0),fb=physical(n,1);
        const float scale=std::sqrt(1.0f-std::abs(fb));
        plot(160,[&](float t){
            const float hz=20.0f*std::pow(1000.0f,t);
            const float w=juce::MathConstants<float>::twoPi*hz/f0;
            const float mag=scale/std::sqrt(std::max(1.0e-4f,1.0f-2.0f*fb*std::cos(w)+fb*fb));
            return 0.5f+0.5f*juce::jlimit(-1.0f,1.0f,std::log10(mag)*0.6f);
        });
        break;
    }
    case FxVisual::Diffusion: {
        const float amount=physical(n,0),size=physical(n,1);
        g.setColour(ink);
        std::uint32_t seed=0x9e3779b9u;
        const int count=6+int(amount*28.0f);
        for(int i=0;i<count;++i) {
            seed=seed*1664525u+1013904223u;
            const float t=(float(i)+float(seed>>24)/255.0f)/float(count);
            const float x=in.getX()+t*in.getWidth()*(0.3f+0.7f*size);
            const float h=in.getHeight()*0.48f*std::exp(-2.5f*t)*(0.35f+0.65f*float((seed>>8)&255u)/255.0f);
            g.fillRect(juce::Rectangle<float>(x,in.getCentreY()-h,1.5f,h*2.0f));
        }
        return;
    }
    case FxVisual::FilterResponse: {
        const int type=int(physicalById(n,5));
        if(type==8) { // COMB
            const auto coefficients=dsp::combDesign(sampleRate,physicalById(n,1),physicalById(n,2),physicalById(n,4));
            plot(1024,[&](float t){
                const double hz=20.*std::pow(std::min(20000.,sampleRate*.499)/20.,t);
                const double magnitude=dsp::combMagnitude(coefficients,hz,sampleRate,physicalById(n,3));
                return .5f+juce::jlimit(-30.f,30.f,float(20*std::log10(std::max(magnitude,1e-6))))/60.f;
            });
            break;
        }
        const auto c=svfDesign(static_cast<SvfShape>(juce::jlimit(0,7,type)),physicalById(n,1),physicalById(n,6),physicalById(n,7),sampleRate);
        plot(160,[&](float t){
            const float db=float(20.0*std::log10(std::max(std::abs((1.0-double(physicalById(n,3)))+double(physicalById(n,3))*dsp::svfTransfer(c.g,c.k,c.m0,c.m1,c.m2,20.0*std::pow(std::min(20000.,sampleRate*.499)/20.,t),sampleRate)),1.0e-6)));
            return 0.5f+juce::jlimit(-30.0f,30.0f,db)/60.0f;
        });
        break;
    }
    case FxVisual::EqResponse: {
        plot(160,[&](float t){return 0.5f+juce::jlimit(-24.0f,24.0f,eqResponseDb(n,20.0f*std::pow(1000.0f,t)))/48.0f;});
        break;
    }
    case FxVisual::Compressor: {
        const bool multi=physicalById(n,1)>=0.5f;
        const float knee=physicalById(n,6);
        const auto curve=[&](float threshold,float ratio,float alpha) {
            juce::Path p;
            for(int i=0;i<=64;++i) {
                const float t=float(i)/64.0f,level=-60.0f+t*60.0f,over=level-threshold;
                const float slope=1.0f/std::max(1.0f,ratio)-1.0f;
                const float gr=(knee>0.0f && 2.0f*std::abs(over)<=knee) ? slope*(over+knee*0.5f)*(over+knee*0.5f)/(2.0f*knee) : (over>0.0f ? slope*over : 0.0f);
                const float out=level+gr;
                const juce::Point<float> q{in.getX()+t*in.getWidth(),in.getBottom()-(out+60.0f)/60.0f*in.getHeight()};
                if(i==0) p.startNewSubPath(q); else p.lineTo(q);
            }
            g.setColour(ink.withMultipliedAlpha(alpha));
            g.strokePath(p,juce::PathStrokeType(1.3f));
        };
        if(multi) { curve(physicalById(n,12),physicalById(n,13),0.6f); curve(physicalById(n,17),physicalById(n,18),0.8f); curve(physicalById(n,22),physicalById(n,23),1.0f); }
        else curve(physicalById(n,2),physicalById(n,3),1.0f);
        return;
    }
    case FxVisual::Phaser: {
        const int stages=2*(int(physicalById(n,5))+1);
        const float centre=physicalById(n,4);
        plot(160,[&](float t){
            const float hz=20.0f*std::pow(1000.0f,t);
            // Dry + all-pass chain: notches where the chain's phase hits odd multiples of pi.
            const float phase=float(stages)*2.0f*std::atan(hz/centre);
            const float mag=std::abs(std::cos(0.5f*phase));
            return 0.1f+0.85f*mag;
        });
        break;
    }
    case FxVisual::Spatial: {
        const int voices=int(physicalById(n,4))+2;
        const float width=physicalById(n,2),amount=physicalById(n,1);
        static constexpr float pans[4]{-0.9f,0.9f,-0.45f,0.45f};
        g.setColour(Palette::borderSoft());
        g.drawVerticalLine(juce::roundToInt(in.getCentreX()),in.getY(),in.getBottom());
        g.setColour(ink);
        g.fillEllipse(juce::Rectangle<float>(7.0f,7.0f).withCentre(in.getCentre()));
        for(int v=0;v<voices;++v) {
            const float x=in.getCentreX()+pans[v]*width*in.getWidth()*0.45f;
            const float y=in.getY()+in.getHeight()*(0.25f+0.5f*float(v)/float(std::max(1,voices-1)));
            const float r=3.0f+4.0f*amount;
            g.setColour(ink.withMultipliedAlpha(0.5f+0.5f*amount));
            g.fillEllipse(juce::Rectangle<float>(r,r).withCentre({x,y}));
        }
        return;
    }
    case FxVisual::Utility: {
        if(n.effect==FxEffectType::Gain) {
            const float db=physicalById(n,1);
            const float t=(db+48.0f)/72.0f;
            g.setColour(ink);
            g.fillRect(juce::Rectangle<float>(in.getX(),in.getCentreY()-4.0f,in.getWidth()*juce::jlimit(0.0f,1.0f,t),8.0f));
            if(physicalById(n,2)>=0.5f) text(g,"INV",in.toNearestInt(),Type::secondary,Palette::muted(),juce::Justification::topRight);
        } else {
            const float width=physicalById(n,3)>=0.5f ? 0.0f : physicalById(n,1);
            const float balance=physicalById(n,2);
            g.setColour(ink);
            g.drawEllipse(juce::Rectangle<float>(std::max(4.0f,in.getWidth()*0.4f*width),in.getHeight()*0.8f)
                              .withCentre({in.getCentreX()+balance*in.getWidth()*0.3f,in.getCentreY()}),1.3f);
        }
        return;
    }
    case FxVisual::Dynamics: {
        const float gain=physical(n,0),ceiling=physical(n,1);
        plot(64,[&](float t){
            const float inDb=-36.0f+t*42.0f;
            return (std::min(inDb+gain,ceiling)+36.0f)/42.0f;
        });
        g.setColour(signalShade(.6f,.5f));
        const float cy=in.getBottom()-(ceiling+36.0f)/42.0f*in.getHeight();
        g.drawHorizontalLine(juce::roundToInt(cy),in.getX(),in.getRight());
        break;
    }
    }
    g.setColour(ink);
    g.strokePath(path,juce::PathStrokeType(1.4f));
}


// P03: live overlays consume the bounded P02 snapshot on the message thread.
// They never feed values back into DSP. Frequency displays use a deliberately
// tiny direct DFT (64 input samples / 24 bins) only while a node is visible.
void paintLiveEffectTelemetry(juce::Graphics& g,juce::Rectangle<float> r,const FxNode& n,
                              const FxRenderer::NodeTelemetrySnapshot& t) {
    if(!t.valid || !n.enabled) return;
    const auto* d=findFxEffect(n.effect);
    if(d==nullptr) return;
    auto in=r.reduced(8.0f,7.0f).withTrimmedTop(12.0f);
    juce::Graphics::ScopedSaveState clipped(g);
    g.reduceClipRegion(in.toNearestInt());
    const auto live=signalShade(.88f,.72f);
    const float activity=juce::jlimit(0.0f,1.0f,std::max(t.peakLeft,t.peakRight)*1.4f);
    if(activity<=1.0e-4f) return;

    if(d->visual==FxVisual::Spatial || (d->visual==FxVisual::Utility && n.effect!=FxEffectType::Gain)) {
        // Actual post-node stereo relationship: L on X, R on Y.
        g.setColour(live.withAlpha(.20f+.45f*activity));
        for(std::size_t i=1;i<FxRenderer::telemetrySamples;++i) {
            const auto p0=juce::Point<float>{in.getCentreX()+t.left[i-1]*in.getWidth()*.42f,
                                             in.getCentreY()-t.right[i-1]*in.getHeight()*.42f};
            const auto p1=juce::Point<float>{in.getCentreX()+t.left[i]*in.getWidth()*.42f,
                                             in.getCentreY()-t.right[i]*in.getHeight()*.42f};
            g.drawLine({p0,p1},.8f);
        }
        return;
    }

    const bool spectral=d->visual==FxVisual::EqResponse || d->visual==FxVisual::FilterResponse
                     || d->visual==FxVisual::Comb || d->visual==FxVisual::Phaser
                     || d->visual==FxVisual::Transfer;
    if(spectral) {
        constexpr int bins=24;
        std::array<float,bins> mag{};
        float maximum=1.0e-6f;
        for(int k=1;k<bins;++k) {
            float re=0.0f,im=0.0f;
            for(std::size_t i=0;i<FxRenderer::telemetrySamples;++i) {
                const float x=.5f*(t.left[i]+t.right[i]);
                const float w=.5f-.5f*std::cos(juce::MathConstants<float>::twoPi*float(i)/float(FxRenderer::telemetrySamples-1));
                const float phase=juce::MathConstants<float>::twoPi*float(k)*float(i)/float(FxRenderer::telemetrySamples);
                re+=x*w*std::cos(phase); im-=x*w*std::sin(phase);
            }
            mag[k]=std::sqrt(re*re+im*im);
            maximum=std::max(maximum,mag[k]);
        }
        juce::Path spectrum;
        for(int k=1;k<bins;++k) {
            const float x=in.getX()+float(k-1)/float(bins-2)*in.getWidth();
            const float normalized=std::sqrt(juce::jlimit(0.0f,1.0f,mag[k]/maximum));
            const float y=in.getBottom()-normalized*in.getHeight()*.82f;
            if(k==1) spectrum.startNewSubPath(x,y); else spectrum.lineTo(x,y);
        }
        auto fill=spectrum; fill.lineTo(in.getRight(),in.getBottom()); fill.lineTo(in.getX(),in.getBottom()); fill.closeSubPath();
        g.setColour(live.withAlpha(.07f+.10f*activity)); g.fillPath(fill);
        g.setColour(live.withAlpha(.18f+.22f*activity)); g.strokePath(spectrum,juce::PathStrokeType(.9f));
        return;
    }

    // Time-domain activity for delay/reverb/modulation/dynamics/gain. The
    // parameter-derived model remains the bright foreground reference.
    juce::Path wave;
    for(std::size_t i=0;i<FxRenderer::telemetrySamples;++i) {
        const float x=in.getX()+float(i)/float(FxRenderer::telemetrySamples-1)*in.getWidth();
        const float mono=.5f*(t.left[i]+t.right[i]);
        const float y=in.getCentreY()-juce::jlimit(-1.0f,1.0f,mono)*in.getHeight()*.43f;
        if(i==0) wave.startNewSubPath(x,y); else wave.lineTo(x,y);
    }
    g.setColour(live.withAlpha(.18f+.28f*activity));
    g.strokePath(wave,juce::PathStrokeType(.9f));
}

juce::String kindLabel(FxNodeKind kind) {
    switch(kind) {
    case FxNodeKind::Source: return "AUDIO SOURCE";
    case FxNodeKind::Effect: return "EFFECT";
    case FxNodeKind::Split: case FxNodeKind::Merge: return "ROUTING NODE";
    case FxNodeKind::Send: return "SEND";
    case FxNodeKind::Return: return "RETURN";
    case FxNodeKind::Output: return "INSTRUMENT OUTPUT";
    }
    return {};
}

float meterHeight(float linear) {
    if(linear<=1.0e-5f) return 0.0f;
    return juce::jlimit(0.0f,1.0f,(20.0f*std::log10(linear)+60.0f)/60.0f);
}

constexpr const char* moduleDragPrefix="MCT_FX_MODULE:";
constexpr const char* sourceDragPrefix="MCT_MOD_SOURCE:";
}

std::optional<FxModuleSpec> FxModuleMenu::decode(int id) {
    if(id>0 && id<1000) {
        const auto type=static_cast<FxEffectType>(id);
        if(const auto* d=findFxEffect(type); d!=nullptr && d->processesAudio) return FxModuleSpec{FxModuleKind::Effect,type,0};
        return std::nullopt;
    }
    if(id==splitId) return FxModuleSpec{FxModuleKind::Split,FxEffectType::None,0};
    if(id==mergeId) return FxModuleSpec{FxModuleKind::Merge,FxEffectType::None,0};
    if(id>busBase && id<parameterPickerId) return FxModuleSpec{FxModuleKind::BusSource,FxEffectType::None,static_cast<FxBusId>(id-busBase)};
    return std::nullopt; // send/return/external: not implemented, never decodable
}

// ================================================================ node

FxNodeComponent::FxNodeComponent(FxPage& page,FxNodeId id):page_(page),id_(id) {
    for(auto* b:{&power_,&menu_,&remove_,&accessory_}) addChildComponent(b);
    power_.setClickingTogglesState(true);
    power_.setName("Power FX "+juce::String(id));
    power_.onClick=[this]{page_.setNodeEnabled(id_,power_.getToggleState());};
    menu_.setName("Menu FX "+juce::String(id));
    menu_.onClick=[this]{page_.selectNode(id_);showMenu();};
    remove_.setName("Delete FX "+juce::String(id));
    // Deleting destroys this component; defer so the click unwinds first.
    remove_.onClick=[this] {
        juce::Component::SafePointer<FxPage> safePage(&page_);
        const auto nodeId=id_;
        juce::MessageManager::callAsync([safePage,nodeId]{if(safePage!=nullptr) safePage->deleteNode(nodeId);});
    };
    accessory_.setName("MASTER OUT add module");
    accessory_.onClick=[this] {
        juce::Component::SafePointer<FxPage> safePage(&page_);
        page_.showModuleMenu(accessory_,false,[safePage](FxModuleSpec spec){if(safePage!=nullptr) safePage->insertBeforeOutput(spec);});
    };
}

FxNodeComponent::~FxNodeComponent()=default;

juce::Rectangle<int> FxNodeComponent::sizeFor(const FxNode& n) noexcept {
    switch(n.kind) {
    case FxNodeKind::Source: return {0,0,176,98}; // room for legible L / R input meters
    case FxNodeKind::Output: return {0,0,164,226};
    case FxNodeKind::Split: case FxNodeKind::Merge: {
        const int branches=juce::jmax<int>(n.ports.inputs,n.ports.outputs);
        return {0,0,104,juce::jmax(80,28*branches+36)};
    }
    case FxNodeKind::Effect: case FxNodeKind::Send: case FxNodeKind::Return: break;
    }
    return {0,0,216,180};
}

void FxNodeComponent::update(const FxNode& node,bool selected) {
    const bool effect=node.kind==FxNodeKind::Effect;
    previewDirty_|=node_.effect!=node.effect || node_.enabled!=node.enabled || node_.parameters.size()!=node.parameters.size();
    if(!previewDirty_) for(std::size_t i=0;i<node.parameters.size();++i)
        if(node_.parameters[i].id!=node.parameters[i].id || node_.parameters[i].value!=node.parameters[i].value) { previewDirty_=true; break; }
    node_=node;
    selected_=selected;
    power_.setVisible(effect);
    menu_.setVisible(effect);
    remove_.setVisible(effect || node.isRouting());
    accessory_.setVisible(node.kind==FxNodeKind::Output);
    power_.setToggleState(node.enabled,juce::dontSendNotification);

    const auto quick=parametersFor(node,true,std::nullopt);
    std::vector<FxParameterId> ids;
    for(const auto* p:quick) ids.push_back(p->id);
    if(ids!=quickIds_) {
        quick_.clear();
        quickIds_=ids;
        for(const auto* p:quick) {
            const auto pid=p->id;
            auto slider=std::make_unique<FxFeedbackSlider>(page_);
            configureKnob(*slider);
            slider->setRange(0.0,1.0,0.001);
            slider->setName("FX "+juce::String(id_)+" P"+juce::String(pid));
            tagModulationDestination(*slider,page_.selectedBus(),id_,*p);
            auto* raw=slider.get();
            slider->onDragStart=[this]{page_.selectNode(id_);page_.beginParameterGesture();};
            slider->onDragEnd=[this]{page_.endParameterGesture();};
            slider->onValueChange=[this,raw,pid]{page_.setParameter(id_,pid,float(raw->getValue()));};
            addAndMakeVisible(*slider);
            quick_.push_back(std::move(slider));
        }
    }
    for(std::size_t i=0;i<quick_.size();++i)
        if(!quick_[i]->isMouseButtonDown())
            quick_[i]->setValue(node.parameter(quickIds_[i]).value_or(0.0f),juce::dontSendNotification);
    // Low zoom: drop fine detail rather than drawing microscopic controls.
    updateDetail();

    if(drag_!=Drag::Move)
        setBounds(sizeFor(node).withPosition(juce::roundToInt(node.position.x),juce::roundToInt(node.position.y)));
    resized();
    repaint();
}

void FxNodeComponent::updateDetail() {
    const bool controls=page_.graphZoom()>=0.45f;
    for(auto& q:quick_) { q->setVisible(controls); q->setAlpha(node_.enabled ? 1.0f : .38f); }
    menu_.setVisible(node_.kind==FxNodeKind::Effect && page_.graphZoom()>=0.6f);
    repaint();
}
void FxNodeComponent::mouseEnter(const juce::MouseEvent&) { hovered_=true; repaint(); }
void FxNodeComponent::mouseExit(const juce::MouseEvent&) { hovered_=false; hoveredPort_.reset(); repaint(); }
void FxNodeComponent::mouseMove(const juce::MouseEvent& e) {
    const auto port=portAt(e.position);
    if(port!=hoveredPort_) { hoveredPort_=port; repaint(); }
}

void FxNodeComponent::setMeter(float left,float right) {
    if(std::abs(left-meterLeft_)<1.0e-6f && std::abs(right-meterRight_)<1.0e-6f) return;
    meterLeft_=left;
    meterRight_=right;
    repaint();
}

void FxNodeComponent::setTelemetry(const FxRenderer::NodeTelemetrySnapshot& telemetry) {
    if(telemetry.sequence==telemetry_.sequence && telemetry.valid==telemetry_.valid) return;
    telemetry_=telemetry;
    // Only the shared audio viewport is dynamic. Cached parameter/model art remains
    // untouched, avoiding expensive response redesign at timer cadence.
    if(node_.kind==FxNodeKind::Effect && page_.graphZoom()>=0.6f)
        repaint(AudioCardLayout::forBounds(getLocalBounds(),int(quick_.size())).viewport);
}

float FxNodeComponent::hitRadius() const noexcept {
    // Keep at least ~12 screen pixels of grab area at any zoom.
    return std::max(14.0f,12.0f/std::max(0.1f,page_.graphZoom()));
}

juce::Point<float> FxNodeComponent::portCentre(bool input,std::uint8_t port) const noexcept {
    const int count=input ? node_.ports.inputs : node_.ports.outputs;
    const float top=node_.isRouting() ? 28.0f : 0.0f;
    const float bottom=node_.kind==FxNodeKind::Output ? 44.0f : 0.0f;
    const float span=float(getHeight())-top-bottom;
    const float y=top+span*(float(port)+1.0f)/(float(count)+1.0f);
    return {input ? portRadius+1.5f : float(getWidth())-portRadius-1.5f,y};
}

std::optional<std::pair<bool,std::uint8_t>> FxNodeComponent::portAt(juce::Point<float> p) const noexcept {
    const float radius=hitRadius();
    for(std::uint8_t i=0;i<node_.ports.outputs;++i)
        if(p.getDistanceFrom(portCentre(false,i))<=radius) return std::make_pair(false,i);
    for(std::uint8_t i=0;i<node_.ports.inputs;++i)
        if(p.getDistanceFrom(portCentre(true,i))<=radius) return std::make_pair(true,i);
    return std::nullopt;
}

void FxNodeComponent::resized() {
    if(node_.kind==FxNodeKind::Effect) {
        auto row=getLocalBounds().removeFromTop(34).reduced(12,5);
        power_.setBounds(row.removeFromLeft(40));
        remove_.setBounds(row.removeFromRight(28));
        row.removeFromRight(4);
        menu_.setBounds(row.removeFromRight(30));
        const auto layout=AudioCardLayout::forBounds(getLocalBounds(),int(quick_.size()));
        for(std::size_t i=0;i<quick_.size();++i) quick_[i]->setBounds(layout.knob(int(i),int(quick_.size())));
    } else if(node_.isRouting()) {
        remove_.setBounds(getWidth()-32,4,26,22);
    } else if(node_.kind==FxNodeKind::Output) {
        accessory_.setBounds(getLocalBounds().removeFromBottom(40).reduced(10,6));
    }
}

void FxNodeComponent::paint(juce::Graphics& g) {
    const auto bounds=getLocalBounds().toFloat().reduced(.5f);
    const bool routing=node_.isRouting();
    const bool detailed=page_.graphZoom()>=0.6f;
    const auto body=routing || !node_.enabled ? Palette::panel() : Palette::raised();
    g.setColour(body);
    g.fillRect(bounds);
    if(!routing) {
        g.setColour(body.brighter(.05f));
        g.fillRect(bounds.withHeight(33.0f).reduced(1.0f));
        g.setColour(Palette::borderStrong().withAlpha(.30f));
        g.drawHorizontalLine(33,8.0f,float(getWidth()-8));
    }
    g.setColour(selected_ ? signalShade(.80f,.90f) : hovered_ ? Palette::borderStrong() : Palette::border());
    g.drawRect(bounds,1.0f);
    if(selected_) {
        g.setColour(signalShade(.80f,.18f));
        g.drawRect(bounds.reduced(1.0f),1.0f);
    }

    const auto local=getLocalBounds();
    switch(node_.kind) {
    case FxNodeKind::Effect: {
        const auto* d=findFxEffect(node_.effect);
        auto title=local.withHeight(34).withTrimmedLeft(58).withTrimmedRight(detailed ? 74 : 44);
        text(g,node_.name,title,11.5f,node_.enabled ? Palette::text() : Palette::muted());
        if(d==nullptr || !d->processesAudio)
            text(g,"NO DSP",title,Type::secondary,Palette::muted().withAlpha(.75f),juce::Justification::centredRight);
        if(!detailed) break;
        // Parameter previews are cached; a moving modulation dot must not
        // repeatedly design EQ filters or redraw an unchanged response.
        const auto layout=AudioCardLayout::forBounds(local,int(quick_.size()));
        const auto viewport=layout.viewport;
        const double previewRate=page_.responseSampleRate();
        if(previewDirty_ || !previewImage_.isValid() || previewRate_!=previewRate || previewImage_.getWidth()!=viewport.getWidth() || previewImage_.getHeight()!=viewport.getHeight()) {
            previewImage_=juce::Image(juce::Image::ARGB,viewport.getWidth(),viewport.getHeight(),true);
            juce::Graphics preview(previewImage_);
            paintEffectPreview(preview,previewImage_.getBounds().toFloat(),node_,previewRate);
            previewRate_=previewRate;
            previewDirty_=false;
        }
        g.drawImageAt(previewImage_,viewport.getX(),viewport.getY());
        paintLiveEffectTelemetry(g,viewport.toFloat(),node_,telemetry_);
        // The preview itself is primary. Keep model/bypass provenance as a quiet
        // caption rather than laying a prominent label over the visualization.
        text(g,node_.enabled ? "MODEL" : "BYPASSED",{18,42,getWidth()-36,12},Type::secondary,
             Palette::muted().withAlpha(.62f),juce::Justification::topRight);
        const auto quick=parametersFor(node_,true,std::nullopt);
        auto labels=layout.labels;
        const int width=labels.getWidth()/juce::jmax<int>(1,int(quick.size()));
        for(const auto* p:quick) text(g,p->label,labels.removeFromLeft(width),Type::label,Palette::muted(),juce::Justification::centred);
        break;
    }
    case FxNodeKind::Source: {
        // mct-origami-manual-qa-ui-wavetable-fixes: an audio INPUT endpoint,
        // not a generator: live L / R meters of the signal entering this
        // graph (MAIN: the synth voice sum; a user bus: its oscillator sends).
        text(g,page_.busName(node_.bus)+" IN",local.withHeight(32).reduced(12,0),11.5f,Palette::text());
        if(!detailed) break; // zoomed out: the title only
        auto lower=local.withTrimmedTop(36).withTrimmedBottom(6).withTrimmedLeft(12).withTrimmedRight(22);
        auto meters=lower.removeFromLeft(36);
        for(int channel=0;channel<2;++channel) {
            auto column=meters.removeFromLeft(18);
            auto meterWell=column.withTrimmedBottom(12).reduced(3,0);
            well(g,meterWell);
            const float linear=channel==0 ? meterLeft_ : meterRight_;
            const float level=meterHeight(linear);
            if(level>0.0f) {
                auto fill=meterWell.toFloat().reduced(1.5f);
                fill=fill.withTop(fill.getBottom()-fill.getHeight()*level);
                g.setColour(signalShade(.85f,.85f));
                g.fillRect(fill);
                if(linear>=0.891f) { g.setColour(signalSourceColour()); g.fillRect(fill.withHeight(2.0f)); } // within 1 dB of full scale
            }
            text(g,channel==0 ? "L" : "R",column.removeFromBottom(12),Type::secondary,Palette::muted(),juce::Justification::centred);
        }
        lower.removeFromLeft(8);
        text(g,node_.bus==mainBusId ? "SYNTH VOICE SUM" : "OSCILLATOR SENDS",lower.removeFromTop(lower.getHeight()/2),Type::secondary,Palette::muted());
        text(g,"STEREO AUDIO",lower,Type::secondary,Palette::muted().withAlpha(.75f));
        break;
    }
    case FxNodeKind::Output: {
        // MAIN OUT feeds the master; user buses end at their own bus output.
        text(g,page_.busName(page_.selectedBus())+" OUT",local.withHeight(32).reduced(14,0),11.5f,Palette::text());
        auto meterArea=local.withTrimmedTop(40).withTrimmedBottom(44+30);
        auto meters=meterArea.withSizeKeepingCentre(64,meterArea.getHeight());
        for(int channel=0;channel<2;++channel) {
            auto column=meters.removeFromLeft(32);
            auto meterWell=column.withTrimmedBottom(16).reduced(6,0);
            well(g,meterWell);
            const float level=meterHeight(channel==0 ? meterLeft_ : meterRight_);
            if(level>0.0f) {
                auto fill=meterWell.toFloat().reduced(2.0f);
                fill=fill.withTop(fill.getBottom()-fill.getHeight()*level);
                g.setColour(signalShade(.85f,.85f));
                g.fillRect(fill);
            }
            text(g,channel==0 ? "L" : "R",column.removeFromBottom(14),Type::secondary,Palette::muted(),juce::Justification::centred);
        }
        const float loud=std::max(meterLeft_,meterRight_);
        text(g,loud>1.0e-5f ? juce::String(20.0f*std::log10(loud),1)+" DB" : juce::String("-INF DB"),
             local.withTrimmedBottom(44).withTrimmedTop(local.getHeight()-44-26).withHeight(20),Type::secondary,Palette::secondary(),juce::Justification::centred);
        break;
    }
    case FxNodeKind::Split: case FxNodeKind::Merge: {
        text(g,node_.name,{10,4,getWidth()-44,22},10.5f,Palette::secondary());
        g.setColour(Palette::accent().withAlpha(.55f));
        const bool split=node_.kind==FxNodeKind::Split;
        const auto single=portCentre(split,0);
        const auto hub=juce::Point<float>(float(getWidth())*.5f,single.y);
        g.drawLine(juce::Line<float>(single,hub),1.3f);
        const int many=split ? node_.ports.outputs : node_.ports.inputs;
        for(std::uint8_t i=0;i<many;++i) g.drawLine(juce::Line<float>(hub,portCentre(!split,i)),1.3f);
        g.fillEllipse(juce::Rectangle<float>(6.0f,6.0f).withCentre(hub));
        break;
    }
    case FxNodeKind::Send: case FxNodeKind::Return: break;
    }

    // While a cable is being dragged, inputs that would accept it light up.
    const auto wire=page_.canvas().wireSource();
    const auto paintPort=[&](bool input,std::uint8_t port) {
        const auto c=portCentre(input,port);
        auto dot=juce::Rectangle<float>(portRadius*2.0f,portRadius*2.0f).withCentre(c);
        bool compatible=false;
        if(wire && input && wire->node!=id_) {
            const auto result=page_.graph().canConnect(*wire,{id_,port});
            compatible=result==FxEditResult::Ok || result==FxEditResult::InputOccupied || result==FxEditResult::OutputOccupied;
        }
        g.setColour(Palette::inset());
        g.fillEllipse(dot);
        const bool hot=hoveredPort_==std::make_optional(std::make_pair(input,port));
        g.setColour(compatible ? signalSourceColour() : wire && input ? Palette::borderSoft() : hot || hovered_ ? Palette::text() : Palette::borderStrong());
        g.drawEllipse(compatible || hot ? dot.expanded(2.0f) : dot,compatible || hot ? 1.6f : 1.2f);
    };
    for(std::uint8_t i=0;i<node_.ports.inputs;++i) paintPort(true,i);
    for(std::uint8_t i=0;i<node_.ports.outputs;++i) paintPort(false,i);
}

void FxNodeComponent::mouseDown(const juce::MouseEvent& e) {
    page_.grabKeyboardFocus();
    if(e.mods.isMiddleButtonDown()) { page_.canvas().mouseDown(e.getEventRelativeTo(&page_.canvas())); return; }
    const auto port=portAt(e.position);
    if(port && e.mods.isPopupMenu()) { page_.disconnectPort(id_,port->first,port->second); return; }
    page_.selectNode(id_); // selection always brings the node to the front
    if(port && !port->first) {
        drag_=Drag::Wire;
        page_.canvas().beginWire(id_,port->second);
        return;
    }
    if(e.mods.isPopupMenu() && node_.kind==FxNodeKind::Effect) { showMenu(); return; }
    drag_=Drag::Move;
    dragOrigin_=getPosition();
}

void FxNodeComponent::mouseDrag(const juce::MouseEvent& e) {
    if(drag_==Drag::Wire) {
        page_.canvas().dragWire(e.getEventRelativeTo(&page_.canvas()).getPosition());
    } else if(drag_==Drag::Move) {
        auto at=dragOrigin_+e.getOffsetFromDragStart();
        at.x=juce::jmax(0,at.x);
        at.y=juce::jmax(0,at.y);
        if(at!=getPosition()) {
            setTopLeftPosition(at);
            page_.canvas().nodeMoved(id_);
        }
    } else if(e.mods.isMiddleButtonDown()) {
        page_.canvas().mouseDrag(e.getEventRelativeTo(&page_.canvas()));
    }
}

void FxNodeComponent::mouseUp(const juce::MouseEvent& e) {
    const auto mode=drag_;
    drag_=Drag::None;
    if(mode==Drag::Wire) page_.canvas().endWire(e.getEventRelativeTo(&page_.canvas()).getPosition());
    else if(mode==Drag::Move && getPosition()!=dragOrigin_) page_.commitMove(id_,getPosition());
    else page_.canvas().mouseUp(e.getEventRelativeTo(&page_.canvas()));
}

void FxNodeComponent::showMenu() {
    juce::Component::SafePointer<FxPage> page(&page_);
    const auto id=id_;
    showNativeChoiceMenu(menu_,"EFFECT",{
        {1,node_.enabled ? "Bypass" : "Enable",true,"EFFECT"},
        {2,"Disconnect All",true,"EFFECT"},
        {3,"Delete",true,"EFFECT"}},0,[page,id](int choice) {
        if(page==nullptr) return;
        const auto* node=page->graph().findNode(id);
        if(node==nullptr) return;
        if(choice==1) page->setNodeEnabled(id,!node->enabled);
        if(choice==2) {
            for(std::uint8_t i=0;i<node->ports.inputs;++i) page->disconnectPort(id,true,i);
            if(const auto* again=page->graph().findNode(id))
                for(std::uint8_t i=0;i<again->ports.outputs;++i) page->disconnectPort(id,false,i);
        }
        if(choice==3) page->deleteNode(id);
    });
}

// ================================================================ canvas

// ================================================================ N07 node palette

class NodePalette::Field final : public juce::TextEditor {
public:
    explicit Field(NodePalette& owner):owner_(owner) {
        setName("NODE PALETTE SEARCH");
        setTextToShowWhenEmpty("Search nodes...",Palette::muted());
        setColour(juce::TextEditor::backgroundColourId,Palette::inset());
        setColour(juce::TextEditor::outlineColourId,Palette::borderSoft());
        setColour(juce::TextEditor::focusedOutlineColourId,signalSourceColour());
        setColour(juce::TextEditor::textColourId,Palette::text());
        setFont(juce::FontOptions(13.0f));
        onTextChange=[this]{ owner_.filter(); };
        onReturnKey=[this]{ owner_.chooseSelected(); };
        onEscapeKey=[this]{ owner_.dismiss(); };
    }
    bool keyPressed(const juce::KeyPress& key) override {
        if(key==juce::KeyPress::upKey) { owner_.moveSelection(-1); return true; }
        if(key==juce::KeyPress::downKey) { owner_.moveSelection(1); return true; }
        if(key==juce::KeyPress::tabKey) { owner_.moveSelection(key.getModifiers().isShiftDown() ? -1 : 1); return true; }
        return juce::TextEditor::keyPressed(key);
    }
private:
    NodePalette& owner_;
};

NodePalette::NodePalette():field_(std::make_unique<Field>(*this)) {
    setName("NODE PALETTE");
    addAndMakeVisible(*field_);
    setVisible(false);
    setWantsKeyboardFocus(false);
}

juce::String NodePalette::aliasesFor(const juce::String& label) {
    // Short names people type. Matched by prefix / substring like the label.
    static const std::pair<const char*,const char*> table[]{
        {"PROBABILITY","prob chance percent maybe"},{"SAMPLE & HOLD","s&h sh sample hold snapshot"},{"TRACK & HOLD","t&h th track"},
        {"SEQUENCER","seq step steps"},{"RANDOM","rand rnd random trigger"},{"RANDOM WALK","walk drunk brownian drift"},
        {"EUCLIDEAN","euclid bjorklund rhythm"},{"CLOCK DIVIDER","div divide divider"},{"EVENT DELAY","delay later offset"},
        {"EVENT MERGE","merge or join"},{"CHANCE SPLIT","split branch coin"},{"PATTERN","pattern mask gate steps"},
        {"COUNTER","count index"},{"SCALE / OFFSET","scale offset gain mul add"},{"SMOOTH","slew lag glide"},
        {"CLOCK","clock tick tempo metro"},{"THRESHOLD","thresh compare gate"},{"ENV TRIGGER","env retrigger envelope"},
        {"TOGGLE","flip flop latch"},{"SWITCH","select mux"},{"QUANTIZE","quant steps"},{"REMAP","map range"},
        {"CURVE","shape exp log"},{"CLAMP","limit"},{"CONSTANT","value fixed"},{"Delay","echo"},{"Reverb","verb room hall"},
        {"Compressor","comp dyn dynamics"},{"Drive","dist distortion saturation"},{"Parameter...","param destination target"}};
    for(const auto& [name,aliases]:table) if(label.equalsIgnoreCase(name)) return aliases;
    return {};
}

void NodePalette::open(std::vector<Entry> entries,juce::Point<int> at,const juce::String& title) {
    all_=std::move(entries);
    title_=title;
    field_->setText({},juce::dontSendNotification);
    selected_=0; scroll_=0;
    filter();
    const int height=30+8+rowHeight*visibleRows+10;
    if(auto* parent=getParentComponent()) {
        auto bounds=juce::Rectangle<int>(at.x,at.y,width,height);
        bounds=bounds.constrainedWithin(parent->getLocalBounds().reduced(6));
        setBounds(bounds);
    } else setBounds(at.x,at.y,width,height);
    setVisible(true);
    toFront(false);
    field_->grabKeyboardFocus();
}

void NodePalette::dismiss() {
    if(!isVisible()) return;
    setVisible(false);
    if(auto* parent=getParentComponent()) parent->grabKeyboardFocus();
}

void NodePalette::setQuery(const juce::String& q) { field_->setText(q,false); filter(); } // TextEditor notifies asynchronously
juce::String NodePalette::query() const { return field_->getText(); }
std::vector<NodePalette::Entry> NodePalette::results() const { return shown_; }

void NodePalette::filter() {
    const auto q=field_->getText().trim().toLowerCase();
    shown_.clear();
    if(q.isEmpty()) shown_=all_;
    else {
        // Rank: label prefix < word prefix in label < alias prefix < substring
        // (label / alias) < category. Stable within a rank (catalog order).
        std::vector<std::pair<int,std::size_t>> ranked;
        for(std::size_t i=0;i<all_.size();++i) {
            const auto label=all_[i].label.toLowerCase(),group=all_[i].group.toLowerCase();
            const auto aliases=aliasesFor(all_[i].label).toLowerCase();
            juce::StringArray words; words.addTokens(label+" "+aliases," /&()-.",""); 
            int rank=-1;
            if(label.startsWith(q)) rank=0;
            else if(std::any_of(words.begin(),words.end(),[&](const juce::String& w){ return w.startsWith(q); })) rank=1;
            else if((" "+aliases+" ").contains(" "+q)) rank=2;
            else if(label.contains(q) || aliases.contains(q)) rank=3;
            else if(group.contains(q)) rank=4;
            if(rank>=0) ranked.push_back({rank,i});
        }
        std::stable_sort(ranked.begin(),ranked.end(),[](auto a,auto b){ return a.first<b.first; });
        for(const auto& r:ranked) shown_.push_back(all_[r.second]);
    }
    selected_=0;
    for(std::size_t i=0;i<shown_.size();++i) if(shown_[i].enabled) { selected_=int(i); break; }
    scroll_=0;
    repaint();
}

void NodePalette::moveSelection(int delta) {
    if(shown_.empty()) return;
    int next=selected_;
    for(std::size_t step=0;step<shown_.size();++step) {
        next=(next+delta+int(shown_.size()))%int(shown_.size());
        if(shown_[std::size_t(next)].enabled) break;
    }
    selected_=next;
    if(selected_<scroll_) scroll_=selected_;
    if(selected_>=scroll_+visibleRows) scroll_=selected_-visibleRows+1;
    repaint();
}

bool NodePalette::chooseSelected() {
    if(selected_<0 || selected_>=int(shown_.size()) || !shown_[std::size_t(selected_)].enabled) return false;
    const int id=shown_[std::size_t(selected_)].id;
    dismiss();
    if(onChoose) onChoose(id);
    return true;
}

void NodePalette::resized() { field_->setBounds(getLocalBounds().reduced(8).removeFromTop(30).withTrimmedTop(0)); }

void NodePalette::paint(juce::Graphics& g) {
    auto b=getLocalBounds().toFloat();
    g.setColour(Palette::panel()); g.fillRoundedRectangle(b,5.0f);
    g.setColour(Palette::borderStrong()); g.drawRoundedRectangle(b.reduced(0.5f),5.0f,1.0f);
    auto list=getLocalBounds().reduced(8).withTrimmedTop(38);
    if(shown_.empty()) { text(g,"No matching node",list.removeFromTop(rowHeight),10.5f,Palette::muted()); return; }
    for(int r=0;r<visibleRows && scroll_+r<int(shown_.size());++r) {
        const auto& e=shown_[std::size_t(scroll_+r)];
        auto row=list.removeFromTop(rowHeight);
        if(scroll_+r==selected_) { g.setColour(signalSourceColour().withAlpha(0.22f)); g.fillRoundedRectangle(row.toFloat(),3.0f); }
        const auto colour=e.enabled ? Palette::text() : Palette::muted();
        text(g,e.label,row.reduced(8,0).withTrimmedRight(110),11.0f,colour);
        text(g,e.enabled ? e.group : e.reason,row.reduced(8,0),Type::secondary,Palette::muted(),juce::Justification::centredRight);
    }
    if(int(shown_.size())>visibleRows)
        text(g,juce::String(shown_.size())+" results",getLocalBounds().reduced(10,4).removeFromBottom(13),Type::secondary,Palette::muted(),juce::Justification::centredRight);
}

void NodePalette::mouseDown(const juce::MouseEvent& e) {
    const auto list=getLocalBounds().reduced(8).withTrimmedTop(38);
    if(!list.contains(e.getPosition())) return;
    const int row=scroll_+(e.getPosition().y-list.getY())/rowHeight;
    if(row>=0 && row<int(shown_.size()) && shown_[std::size_t(row)].enabled) { selected_=row; chooseSelected(); }
}

void NodePalette::mouseWheelMove(const juce::MouseEvent&,const juce::MouseWheelDetails& wheel) {
    const int maxScroll=std::max(0,int(shown_.size())-visibleRows);
    scroll_=juce::jlimit(0,maxScroll,scroll_+(wheel.deltaY<0 ? 1 : -1));
    repaint();
}

// ================================================================ CONTROL node

namespace {
// Socket geometry by signal (never colour alone): AUDIO circle, CONTROL
// diamond, EVENT square, GATE bar.
void paintSocket(juce::Graphics& g,ControlSignal signal,juce::Point<float> c,float r,bool filled,juce::Colour outline,float stroke) {
    if(signal==ControlSignal::Control) {
        juce::Path d;
        d.startNewSubPath(c.x,c.y-r); d.lineTo(c.x+r,c.y); d.lineTo(c.x,c.y+r); d.lineTo(c.x-r,c.y); d.closeSubPath();
        g.setColour(filled ? Palette::text() : Palette::inset()); g.fillPath(d);
        g.setColour(outline); g.strokePath(d,juce::PathStrokeType(stroke));
        return;
    }
    const auto box=signal==ControlSignal::Gate ? juce::Rectangle<float>(r*2.2f,r*1.25f).withCentre(c)
                                               : juce::Rectangle<float>(r*1.5f,r*1.5f).withCentre(c);
    g.setColour(filled ? Palette::text() : Palette::inset()); g.fillRect(box);
    g.setColour(outline); g.drawRect(box,stroke);
}
}

ControlNodeComponent::ControlNodeComponent(FxPage& page,nodes::ControlNodeKey key):page_(page) {
    view_.key=key;
    setSize(width,64);
    remove_.setTooltip(key.kind==nodes::ControlNodeKind::Operator ? "Delete operator" : "Remove from canvas");
    remove_.onClick=[this]{
        if(view_.key.kind==nodes::ControlNodeKind::Operator) page_.deleteControlOperator(view_.key.op);
        else page_.removeControlNode(view_.key);
    };
    addChildComponent(remove_);
    primary_.setSliderStyle(juce::Slider::LinearBar);
    primary_.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    primary_.setName("CONTROL OPERATOR INLINE");
    primary_.onDragStart=[this]{ page_.beginOperatorGesture(); };
    primary_.onDragEnd=[this]{ page_.endOperatorGesture(); };
    primary_.onValueChange=[this]{
        if(view_.primaryParameter>=0 && primaryInitialised_)
            page_.setOperatorParameter(view_.key.op,std::size_t(view_.primaryParameter),float(primary_.getValue()));
    };
    addChildComponent(primary_);
}

std::uint8_t ControlNodeComponent::inputCount() const noexcept {
    switch(view_.key.kind) {
    case nodes::ControlNodeKind::Source: return 0;
    case nodes::ControlNodeKind::Parameter: return 1;
    case nodes::ControlNodeKind::Operator: return view_.inputs;
    }
    return 0;
}

std::uint8_t ControlNodeComponent::outputCount() const noexcept {
    if(!hasOutput()) return 0;
    return view_.key.kind==nodes::ControlNodeKind::Operator ? std::max<std::uint8_t>(1,view_.outputs) : 1;
}

namespace {
// Socket rows: inputs on the left, outputs on the right (one row each when a
// node has several outputs; a single output stays centred on the inputs).
int controlRows(const ControlNodeView& v) noexcept { return std::max({1,int(v.inputs),v.outputs>1 ? int(v.outputs) : 1}); }
constexpr float controlFirstRow=45.0f,controlRowPitch=22.0f;
// N07: preview cells keep a usable size. Up to 16 cells per row; a longer
// PATTERN wraps to a second row on a wider node (16 px cells at most 32 steps).
constexpr int previewCellsPerRow=16,previewRowHeight=22;
int previewRows(const ControlNodeView& v) noexcept { return v.cellCount>previewCellsPerRow ? 2 : 1; }
int controlPreviewHeight(const ControlNodeView& v) noexcept { return 8+previewRowHeight*previewRows(v); }
}

int ControlNodeComponent::widthFor(const ControlNodeView& v) noexcept {
    return v.preview!=ControlNodeView::Preview::None && v.cellCount>previewCellsPerRow ? 300 : width;
}

void ControlNodeComponent::setDetail(Detail d) {
    if(d==detail_) return;
    detail_=d;
    primary_.setVisible(view_.primaryParameter>=0 && detail_==Detail::Full);
    resized();
    repaint();
}

int ControlNodeComponent::heightFor(const ControlNodeView& v) noexcept {
    if(v.key.kind!=nodes::ControlNodeKind::Operator) return 64;
    return 34+controlRows(v)*22+(v.preview!=ControlNodeView::Preview::None ? controlPreviewHeight(v) : 0)+(v.primaryParameter>=0 ? 26 : 0)+8;
}

void ControlNodeComponent::setSequencerStep(int step) {
    if(step==sequencerStep_) return;
    sequencerStep_=step;
    repaint(previewBounds().getSmallestIntegerContainer().expanded(2));
}

juce::Rectangle<float> ControlNodeComponent::previewBounds() const noexcept {
    if(view_.preview==ControlNodeView::Preview::None) return {};
    const float top=34.0f+float(controlRows(view_))*22.0f+2.0f;
    return {22.0f,top,float(getWidth())-44.0f,float(controlPreviewHeight(view_))-6.0f};
}

std::optional<int> ControlNodeComponent::previewCellAt(juce::Point<float> p) const noexcept {
    const auto area=previewBounds();
    if(view_.cellCount<=0 || !area.contains(p) || detail_!=Detail::Full) return std::nullopt;
    const int perRow=std::min(view_.cellCount,previewCellsPerRow);
    const int row=juce::jlimit(0,previewRows(view_)-1,int((p.y-area.getY())/area.getHeight()*float(previewRows(view_))));
    const int column=juce::jlimit(0,perRow-1,int((p.x-area.getX())/area.getWidth()*float(perRow)));
    const int cell=row*previewCellsPerRow+column;
    return cell<view_.cellCount ? std::optional<int>(cell) : std::nullopt;
}

void ControlNodeComponent::setActivity(float activity,bool gateOpen) {
    if(std::abs(activity-activity_)<0.02f && gateOpen==gateOpen_) return;
    activity_=activity; gateOpen_=gateOpen;
    repaint();
}

void ControlNodeComponent::update(const ControlNodeView& view) {
    const bool resize=heightFor(view)!=getHeight() || widthFor(view)!=getWidth();
    view_=view;
    remove_.setVisible(view.removable);
    primary_.setVisible(view.primaryParameter>=0 && detail_==Detail::Full);
    if(view.primaryParameter>=0) {
        primaryInitialised_=false;
        primary_.setRange(view.primaryMinimum,view.primaryMaximum,view.primaryInteger ? 1.0 : 0.0);
        if(!primary_.isMouseButtonDown()) primary_.setValue(view.primaryValue,juce::dontSendNotification);
        primaryInitialised_=true;
    }
    setName("CONTROL "+view.title+" "+view.detail);
    if(resize) setSize(widthFor(view),heightFor(view)); else resized();
    repaint();
}

juce::Point<float> ControlNodeComponent::portCentre(nodes::PortDirection direction,std::uint8_t index) const noexcept {
    const bool input=direction==nodes::PortDirection::Input;
    const float x=input ? 9.0f : float(getWidth())-9.0f;
    if(view_.key.kind!=nodes::ControlNodeKind::Operator) return {x,float(getHeight())*0.5f};
    if(input || view_.outputs>1) return {x,controlFirstRow+controlRowPitch*float(index)};
    return {x,controlFirstRow+11.0f*float(std::max(1,int(view_.inputs))-1)}; // a single output centred on the inputs
}

std::optional<std::pair<nodes::PortDirection,std::uint8_t>> ControlNodeComponent::portAt(juce::Point<float> p) const noexcept {
    // At least 9 px on screen at any zoom; where targets overlap (zoomed out),
    // the nearest socket wins, so adjacent outputs are never ambiguous.
    const float radius=std::max(11.0f,9.0f/std::max(0.1f,page_.graphZoom()));
    std::optional<std::pair<nodes::PortDirection,std::uint8_t>> best;
    float bestDistance=radius;
    for(std::uint8_t i=0;i<outputCount();++i)
        if(const float d=p.getDistanceFrom(portCentre(nodes::PortDirection::Output,i)); d<=bestDistance) { bestDistance=d; best=std::make_pair(nodes::PortDirection::Output,i); }
    for(std::uint8_t i=0;i<inputCount();++i)
        if(const float d=p.getDistanceFrom(portCentre(nodes::PortDirection::Input,i)); d<=bestDistance) { bestDistance=d; best=std::make_pair(nodes::PortDirection::Input,i); }
    return best;
}

std::optional<nodes::ControlEndpoint> ControlNodeComponent::endpoint(nodes::PortDirection direction,std::uint8_t index) const noexcept {
    const auto& key=view_.key;
    if(direction==nodes::PortDirection::Output) {
        if(key.kind==nodes::ControlNodeKind::Source) return nodes::ControlEndpoint::fromSource(key.source);
        if(key.kind==nodes::ControlNodeKind::Operator && index<outputCount()) return nodes::ControlEndpoint::fromOperator(key.op,index);
        return std::nullopt;
    }
    if(key.kind==nodes::ControlNodeKind::Parameter) return nodes::ControlEndpoint::toParameter(key.destination);
    if(key.kind==nodes::ControlNodeKind::Operator && index<inputCount()) return nodes::ControlEndpoint::toInput(key.op,index);
    return std::nullopt;
}

void ControlNodeComponent::resized() {
    remove_.setBounds(getWidth()-(hasOutput() ? 52 : 32),5,24,22);
    if(view_.primaryParameter>=0) primary_.setBounds(getLocalBounds().reduced(22,0).withTrimmedTop(getHeight()-30).withHeight(18));
}

void ControlNodeComponent::paint(juce::Graphics& g) {
    auto b=getLocalBounds().toFloat().reduced(1.0f);
    const auto kind=view_.key.kind;
    const bool op=kind==nodes::ControlNodeKind::Operator;
    g.setColour(op ? Palette::raised().brighter(0.04f) : Palette::raised());
    g.fillRoundedRectangle(b,4.0f);
    // Restrained hierarchy: SOURCE carries a left rule (producer), PARAMETER a
    // right rule (terminal), OPERATOR a header band (processor).
    g.setColour(Palette::text().withAlpha(0.55f));
    if(kind==nodes::ControlNodeKind::Source) g.fillRect(b.withWidth(2.0f).reduced(0.0f,6.0f));
    if(kind==nodes::ControlNodeKind::Parameter) g.fillRect(b.withX(b.getRight()-2.0f).withWidth(2.0f).reduced(0.0f,6.0f));
    if(op) { g.setColour(Palette::inset()); g.fillRect(b.withHeight(30.0f).reduced(1.0f,1.0f)); }
    g.setColour(view_.selected ? signalSourceColour() : hovered_ ? Palette::borderStrong() : Palette::borderSoft());
    g.drawRoundedRectangle(b,4.0f,view_.selected ? 1.6f : 1.0f);
    // N05 activity: a brief restrained flash when an EVENT fires (UI timer).
    if(activity_>0.02f) {
        g.setColour(signalSourceColour().withAlpha(0.65f*activity_));
        g.drawRoundedRectangle(b.reduced(1.5f),4.0f,1.6f);
    }
    const int left=kind==nodes::ControlNodeKind::Source ? 12 : 22;
    auto top=getLocalBounds().withTrimmedLeft(left).withTrimmedRight(hasOutput() ? 26 : 12).removeFromTop(26).withTrimmedTop(6);
    if(detail_==Detail::Minimal) {
        // Fit view: identity + ports only. The title keeps a readable on-screen
        // size (>= Type::secondary px) by growing in graph units as the zoom falls.
        const float zoom=std::max(0.1f,page_.graphZoom());
        const float size=juce::jlimit(10.5f,30.0f,Type::secondary/zoom);
        g.setColour(Palette::text());
        g.setFont(juce::FontOptions(size,juce::Font::bold));
        g.drawFittedText(view_.title,getLocalBounds().reduced(20,4),juce::Justification::centred,2,0.7f);
    } else {
        text(g,view_.title,top.withTrimmedRight(view_.removable ? 26 : 0),detail_==Detail::Full ? 10.5f : 12.0f,Palette::text());
        if(detail_==Detail::Full) text(g,nodes::toString(view_.domain),top.withTrimmedRight(view_.removable ? 30 : 0),Type::secondary,Palette::muted(),juce::Justification::centredRight);
    }
    g.setColour(Palette::muted());
    g.setFont(juce::FontOptions(Type::secondary));
    if(detail_==Detail::Minimal) {
        // no secondary text at fit zoom
    } else if(op) {
        if(detail_==Detail::Full) g.drawText(view_.detail,juce::Rectangle<int>(left,18,getWidth()-left-30,12),juce::Justification::centredLeft);
        // Port labels are unreadable below full detail (sockets keep the type shape).
        if(detail_==Detail::Full) for(std::uint8_t i=0;i<inputCount();++i) {
            const auto c=portCentre(nodes::PortDirection::Input,i);
            g.drawText(view_.inputNames[i],juce::Rectangle<float>(c.x+10.0f,c.y-7.0f,40.0f,14.0f),juce::Justification::centredLeft);
        }
        if(detail_==Detail::Full) for(std::uint8_t p=0;p<outputCount();++p) {
            const auto out=portCentre(nodes::PortDirection::Output,p);
            const auto name=view_.outputNames[p].isNotEmpty() ? view_.outputNames[p] : juce::String("OUT");
            g.drawText(name,juce::Rectangle<float>(out.x-78.0f,out.y-7.0f,68.0f,14.0f),juce::Justification::centredRight);
        }
        // N06 previews: the canonical sequence with its current step, or the
        // PATTERN / EUCLIDEAN cells (PATTERN cells toggle on click).
        if(view_.preview!=ControlNodeView::Preview::None && view_.cellCount>0 && detail_==Detail::Full) {
            const auto area=previewBounds();
            const int perRow=std::min(view_.cellCount,previewCellsPerRow);
            const float w=area.getWidth()/float(perRow),h=area.getHeight()/float(previewRows(view_));
            g.setColour(Palette::inset()); g.fillRect(area);
            for(int i=0;i<view_.cellCount;++i) {
                auto cell=juce::Rectangle<float>(area.getX()+w*float(i%previewCellsPerRow),area.getY()+h*float(i/previewCellsPerRow),w,h).reduced(1.0f,1.0f);
                const bool current=view_.preview==ControlNodeView::Preview::Sequencer && i==sequencerStep_;
                if(view_.preview==ControlNodeView::Preview::Sequencer) {
                    const float v=juce::jlimit(-1.0f,1.0f,view_.cells[std::size_t(i)]);
                    const float mid=cell.getCentreY(),h=cell.getHeight()*0.5f*std::abs(v);
                    g.setColour(current ? signalSourceColour() : Palette::text().withAlpha(0.55f));
                    g.fillRect(cell.withY(v>=0.0f ? mid-h : mid).withHeight(std::max(1.0f,h)));
                    if(current) { g.setColour(signalSourceColour().withAlpha(0.8f)); g.drawRect(cell,1.0f); }
                } else {
                    const bool on=view_.cells[std::size_t(i)]>=0.5f;
                    g.setColour(on ? Palette::text().withAlpha(0.8f) : Palette::borderSoft());
                    if(on) g.fillRect(cell.reduced(1.0f)); else g.drawRect(cell.reduced(1.0f),1.0f);
                }
            }
        }
    } else {
        if(detail_==Detail::Full)
            g.drawFittedText(view_.detail,getLocalBounds().withTrimmedLeft(left).withTrimmedRight(hasOutput() ? 26 : 12).withTrimmedTop(28),
                             juce::Justification::topLeft,2,0.9f);
    }
    // While a CONTROL cable is dragged, inputs it could reach light up.
    const auto wire=page_.canvas().controlWireSource();
    const auto backwards=page_.canvas().controlWireTarget(); // N06: dragged from an input: outputs light up
    const auto paintPort=[&](nodes::PortDirection direction,std::uint8_t index) {
        bool compatible=false;
        if(wire && direction==nodes::PortDirection::Input)
            if(const auto to=endpoint(direction,index)) compatible=page_.canConnectControlEdge(*wire,*to);
        if(backwards && direction==nodes::PortDirection::Output)
            if(const auto from=endpoint(direction,index)) compatible=page_.canConnectControlEdge(*from,*backwards);
        const auto signal=direction==nodes::PortDirection::Input ? view_.inputSignals[index] : view_.outputSignals[index];
        // A GATE output fills while open; others fill when linked.
        const bool filled=direction==nodes::PortDirection::Output && signal==ControlSignal::Gate ? gateOpen_ : view_.linked;
        paintSocket(g,signal,portCentre(direction,index),compatible ? 6.5f : 5.5f,filled,
                    compatible ? signalSourceColour() : hovered_ ? Palette::text() : Palette::borderStrong(),compatible ? 1.6f : 1.2f);
    };
    for(std::uint8_t i=0;i<inputCount();++i) paintPort(nodes::PortDirection::Input,i);
    for(std::uint8_t p=0;p<outputCount();++p) paintPort(nodes::PortDirection::Output,p);
}

void ControlNodeComponent::paintOverChildren(juce::Graphics& g) {
    if(view_.primaryParameter<0 || !primary_.isVisible()) return;
    // The inline control's label and value read on top of its bar.
    const auto row=primary_.getBounds().reduced(5,0);
    g.setColour(Palette::text().withAlpha(0.9f));
    g.setFont(juce::FontOptions(Type::secondary));
    g.drawText(view_.primaryLabel,row,juce::Justification::centredLeft);
    const float value=float(primary_.getValue());
    juce::String shown=view_.primaryInteger ? juce::String(juce::roundToInt(value)) : juce::String(value,3);
    if(view_.opType==ControlOpType::Smooth || view_.opType==ControlOpType::Pulse) shown+=" s";
    if(view_.opType==ControlOpType::Clock) shown=view_.primaryParameter==2 ? juce::String(clockDivisionLabel(juce::roundToInt(value))) : juce::String(value,2)+" Hz";
    if(view_.opType==ControlOpType::Sequencer) shown=value>=0.5f ? "EXTERNAL" : "INTERNAL";
    if(view_.opType==ControlOpType::Counter && view_.primaryParameter==1) shown=value>=1.5f ? "PING-PONG" : value>=0.5f ? "CLAMP" : "WRAP";
    g.drawText(shown,row,juce::Justification::centredRight);
}

void ControlNodeComponent::showMenu() {
    juce::Component::SafePointer<FxPage> page(&page_);
    const auto key=view_.key;
    juce::Component::SafePointer<ControlNodeComponent> self(this);
    std::vector<NativeChoiceItem> items;
    if(key.kind==nodes::ControlNodeKind::Source) items.push_back({1,"Connect to Parameter...",true,"CONTROL"});
    // N06: parameters are driven from the node's (unambiguous) CONTROL output.
    int controlPort=0;
    if(key.kind==nodes::ControlNodeKind::Operator) {
        const auto* info=view_.opType!=ControlOpType::None ? controlOpInfo(view_.opType) : nullptr;
        controlPort=info!=nullptr ? nodes::controlAutoOutputPort(*info,ControlSignal::Control) : -1;
        if(controlPort>=0) items.push_back({1,"Connect to Parameter...",true,"CONTROL"});
        items.push_back({3,"Duplicate",true,"OPERATOR"});
        items.push_back({4,"Delete",true,"OPERATOR"});
    } else {
        items.push_back({2,"Remove from Canvas",view_.removable,"CONTROL",false,view_.removable ? juce::String() : juce::String("Delete its connections first")});
    }
    showNativeChoiceMenu(*this,view_.title,items,0,[page,key,self,controlPort](int choice) {
        if(page==nullptr) return;
        if(choice==1 && self!=nullptr)
            page->showParameterPicker(*self,key.kind==nodes::ControlNodeKind::Operator ? operatorSource(key.op,std::uint8_t(std::max(0,controlPort))) : key.source,std::nullopt);
        if(choice==2) page->removeControlNode(key);
        if(choice==3) page->duplicateControlOperator(key.op);
        if(choice==4) page->deleteControlOperator(key.op);
    });
}

void ControlNodeComponent::mouseDown(const juce::MouseEvent& e) {
    page_.grabKeyboardFocus();
    if(e.mods.isMiddleButtonDown()) { page_.canvas().mouseDown(e.getEventRelativeTo(&page_.canvas())); return; }
    if(e.mods.isPopupMenu()) { showMenu(); return; }
    // N06: a PATTERN cell toggles its step (one undo step).
    if(view_.preview==ControlNodeView::Preview::Pattern)
        if(const auto cell=previewCellAt(e.position)) { page_.togglePatternStep(view_.key.op,*cell); drag_=Drag::None; return; }
    // N07: Shift-click toggles membership in the selection; dragging a node of
    // a multi-selection moves the whole group (one undo step).
    if(e.mods.isShiftDown() && !portAt(e.position)) { page_.toggleControlNodeSelection(view_.key); drag_=Drag::None; return; }
    const bool inGroup=page_.selectedControlNodes().size()>1 && page_.controlNodeSelected(view_.key);
    if(!inGroup) page_.selectControlNode(view_.key);
    toFront(false);
    if(const auto port=portAt(e.position); port && port->first==nodes::PortDirection::Output) {
        if(const auto from=endpoint(port->first,port->second)) {
            drag_=Drag::Wire;
            page_.canvas().beginControlWire(*from,portCentre(port->first,port->second)+getPosition().toFloat());
            return;
        }
    }
    // N06: dragging backwards from an unconnected operator input.
    if(const auto port=portAt(e.position); port && port->first==nodes::PortDirection::Input
       && view_.key.kind==nodes::ControlNodeKind::Operator && port->second<3 && !view_.inputConnected[port->second]) {
        if(const auto to=endpoint(port->first,port->second)) {
            drag_=Drag::Wire;
            page_.canvas().beginControlWireFromInput(*to,portCentre(port->first,port->second)+getPosition().toFloat());
            return;
        }
    }
    drag_=inGroup ? Drag::Group : Drag::Move;
    dragOrigin_=getPosition();
    if(inGroup)
        for(auto* node:page_.canvas().controlNodes())
            if(page_.controlNodeSelected(node->key())) node->groupDragOrigin_=node->getPosition();
}

void ControlNodeComponent::mouseDrag(const juce::MouseEvent& e) {
    if(e.mods.isMiddleButtonDown()) { page_.canvas().mouseDrag(e.getEventRelativeTo(&page_.canvas())); return; }
    if(drag_==Drag::Wire) { page_.canvas().dragControlWire(e.getEventRelativeTo(&page_.canvas()).getPosition()); return; }
    if(drag_==Drag::Group) {
        for(auto* node:page_.canvas().controlNodes())
            if(page_.controlNodeSelected(node->key())) { node->setTopLeftPosition(node->groupDragOrigin_+e.getOffsetFromDragStart()); page_.canvas().controlNodeMoved(node->key()); }
        return;
    }
    if(drag_!=Drag::Move) return;
    setTopLeftPosition(dragOrigin_+e.getOffsetFromDragStart());
    page_.canvas().controlNodeMoved(view_.key);
}

void ControlNodeComponent::mouseUp(const juce::MouseEvent& e) {
    if(e.mods.isMiddleButtonDown()) { page_.canvas().mouseUp(e.getEventRelativeTo(&page_.canvas())); return; }
    if(drag_==Drag::Wire) page_.canvas().endControlWire(e.getEventRelativeTo(&page_.canvas()).getPosition());
    else if(drag_==Drag::Move && getPosition()!=dragOrigin_)
        page_.moveControlNode(view_.key,{float(getX()),float(getY())},true);
    else if(drag_==Drag::Group && getPosition()!=dragOrigin_)
        page_.moveControlNodes(page_.selectedControlNodes(),(getPosition()-dragOrigin_).toFloat());
    drag_=Drag::None;
}

// ================================================================ canvas

FxCanvas::FxCanvas(FxPage& page):page_(page) {}

void FxCanvas::updateExtent() {
    juce::Rectangle<int> content;
    for(const auto& [id,node]:nodes_) content=content.getUnion(node->getBounds());
    for(const auto& node:controlNodes_) content=content.getUnion(node->getBounds());
    // Graph space extends well beyond the content so large graphs can grow.
    setSize(juce::jmax(minWidth_,content.getRight()+900),juce::jmax(minHeight_,content.getBottom()+600));
}

std::vector<ControlNodeComponent*> FxCanvas::controlNodes() const {
    std::vector<ControlNodeComponent*> out;
    for(const auto& node:controlNodes_) out.push_back(node.get());
    return out;
}

void FxCanvas::setControlDetail(ControlNodeComponent::Detail detail) {
    for(auto& node:controlNodes_) node->setDetail(detail);
}

void FxCanvas::beginMarquee(juce::Point<float> p,bool additive) {
    marqueeActive_=true; marqueeAdditive_=additive; marqueeStart_=p; marquee_={p,p};
}

void FxCanvas::dragMarquee(juce::Point<float> p) {
    if(!marqueeActive_) return;
    repaint(marquee_.getSmallestIntegerContainer().expanded(2));
    marquee_=juce::Rectangle<float>(marqueeStart_,p);
    repaint(marquee_.getSmallestIntegerContainer().expanded(2));
}

void FxCanvas::endMarquee() {
    if(!marqueeActive_) return;
    marqueeActive_=false;
    repaint(marquee_.getSmallestIntegerContainer().expanded(2));
    std::vector<nodes::ControlNodeKey> keys=marqueeAdditive_ ? page_.selectedControlNodes() : std::vector<nodes::ControlNodeKey>{};
    for(const auto& node:controlNodes_)
        if(marquee_.intersects(node->getBounds().toFloat()) && std::find(keys.begin(),keys.end(),node->key())==keys.end()) keys.push_back(node->key());
    page_.setControlNodeSelection(std::move(keys));
}

ControlNodeComponent* FxCanvas::controlNode(const nodes::ControlNodeKey& key) const noexcept {
    for(const auto& node:controlNodes_) if(node->key()==key) return node.get();
    return nullptr;
}

void FxCanvas::rebuildControl(const std::vector<ControlNodeView>& views,const std::vector<ControlLinkView>& links) {
    // Reconcile by canonical identity: components survive refreshes.
    controlNodes_.erase(std::remove_if(controlNodes_.begin(),controlNodes_.end(),[&views](const auto& node) {
        return std::none_of(views.begin(),views.end(),[&node](const ControlNodeView& v){ return v.key==node->key(); });
    }),controlNodes_.end());
    for(const auto& v:views) {
        auto* node=controlNode(v.key);
        if(node==nullptr) {
            controlNodes_.push_back(std::make_unique<ControlNodeComponent>(page_,v.key));
            node=controlNodes_.back().get();
            node->setDetail(ControlNodeComponent::detailFor(page_.graphZoom()));
            addAndMakeVisible(*node);
        }
        if(!node->isMouseButtonDown()) node->setTopLeftPosition(juce::roundToInt(v.x),juce::roundToInt(v.y));
        node->update(v);
    }
    controlWires_.clear();
    for(const auto& link:links) {
        controlWires_.push_back({link,{},{}});
        computeControlWire(controlWires_.back());
    }
    updateExtent();
    repaint();
}

void FxCanvas::computeControlWire(ControlWire& wire) const {
    const auto* from=controlNode(wire.link.from);
    const auto* to=controlNode(wire.link.to);
    if(from==nullptr || to==nullptr) { wire.path.clear(); wire.area={}; return; }
    const auto input=wire.link.route!=0 ? std::uint8_t(0) : wire.link.targetInput;
    wire.path=curve(from->portCentre(nodes::PortDirection::Output,wire.link.sourcePort)+from->getPosition().toFloat(),
                    to->portCentre(nodes::PortDirection::Input,input)+to->getPosition().toFloat());
    wire.area=wire.path.getBounds().getSmallestIntegerContainer().expanded(int(wireHitRadius())+6);
}

std::optional<FxCanvas::ControlHit> FxCanvas::controlLinkAt(juce::Point<float> p) const noexcept {
    std::optional<ControlHit> best;
    float bestDistance=wireHitRadius();
    for(const auto& wire:controlWires_) {
        if(wire.path.isEmpty() || !wire.area.contains(p.toInt())) continue;
        juce::Point<float> nearest;
        wire.path.getNearestPoint(p,nearest);
        const float distance=p.getDistanceFrom(nearest);
        if(distance<=bestDistance) { bestDistance=distance; best=ControlHit{wire.link.route,wire.link.targetOperator,wire.link.targetInput}; }
    }
    return best;
}

void FxCanvas::controlNodeMoved(const nodes::ControlNodeKey& key) {
    for(auto& wire:controlWires_) {
        if(wire.link.from!=key && wire.link.to!=key) continue;
        repaint(wire.area);
        computeControlWire(wire);
        repaint(wire.area);
    }
}

void FxCanvas::beginControlWireFromInput(const nodes::ControlEndpoint& to,juce::Point<float> start) {
    controlWireActive_=true;
    controlWireReverse_=true;
    controlWireTo_=to;
    controlWireStart_=controlWireEnd_=start;
    for(auto& n:controlNodes_) n->repaint(); // highlight outputs that could feed it
}

void FxCanvas::beginControlWire(const nodes::ControlEndpoint& from,juce::Point<float> start) {
    controlWireActive_=true;
    controlWireReverse_=false;
    controlWireFrom_=from;
    controlWireStart_=controlWireEnd_=start;
    for(auto& n:controlNodes_) n->repaint(); // highlight inputs it could reach
}

void FxCanvas::dragControlWire(juce::Point<int> p) {
    controlWireEnd_=p.toFloat();
    repaint();
}

void FxCanvas::endControlWire(juce::Point<int> p) {
    if(!controlWireActive_) return;
    const auto from=controlWireFrom_;
    const auto target=controlWireTo_;
    const bool reverse=controlWireReverse_;
    controlWireActive_=false;
    controlWireReverse_=false;
    for(auto& n:controlNodes_) n->repaint();
    repaint();
    // CONTROL cables land only on CONTROL-layer ports of the matching
    // direction. AUDIO ports never accept them: the signal types differ.
    const auto wanted=reverse ? nodes::PortDirection::Output : nodes::PortDirection::Input;
    bool overNode=false;
    for(const auto& node:controlNodes_) {
        if(!node->getBounds().expanded(20).contains(p)) continue;
        overNode=overNode || node->getBounds().contains(p);
        const auto port=node->portAt((p-node->getPosition()).toFloat());
        if(!port || port->first!=wanted) continue;
        if(const auto end=node->endpoint(port->first,port->second)) {
            if(reverse) page_.connectControlEdge(*end,target); else page_.connectControlEdge(from,*end);
            return;
        }
    }
    // N06: dropped on empty canvas: offer the nodes that can complete the cable.
    const bool overAudio=std::any_of(nodes_.begin(),nodes_.end(),[p](const auto& n){ return n.second->getBounds().contains(p); });
    if(!overNode && !overAudio && p.getDistanceFrom(controlWireStart_.toInt())>12)
        page_.showControlCreateMenu(*this,reverse ? target : from,toGraph(p.toFloat()));
}

FxNodeComponent* FxCanvas::nodeComponent(FxNodeId id) const noexcept {
    const auto it=nodes_.find(id);
    return it==nodes_.end() ? nullptr : it->second.get();
}

std::vector<FxNodeId> FxCanvas::nodeZOrder() const {
    std::vector<FxNodeId> order;
    for(auto* child:getChildren())
        if(auto* node=dynamic_cast<FxNodeComponent*>(child)) order.push_back(node->id());
    return order;
}

void FxCanvas::bringToFront(FxNodeId id) {
    if(auto* node=nodeComponent(id)) node->toFront(false);
}

juce::Rectangle<int> FxCanvas::contentBounds() const {
    juce::Rectangle<int> content;
    for(const auto& [id,node]:nodes_) content=content.isEmpty() ? node->getBounds() : content.getUnion(node->getBounds());
    for(const auto& wire:wires_) for(const auto& h:wire.handles) content=content.getUnion(juce::Rectangle<int>(int(h.x),int(h.y),1,1));
    for(const auto& node:controlNodes_) content=content.isEmpty() ? node->getBounds() : content.getUnion(node->getBounds());
    return content;
}

float FxCanvas::wireHitRadius() const noexcept {
    return std::max(10.0f,10.0f/std::max(0.1f,page_.graphZoom()));
}

void FxCanvas::rebuild(const FxGraph& graph,FxNodeId selected,int minWidth,int minHeight) {
    // Reconcile by stable ID: components survive edits; only added/removed
    // nodes create or destroy components. Existing z-order is preserved.
    for(auto it=nodes_.begin();it!=nodes_.end();)
        it=graph.findNode(it->first)==nullptr ? nodes_.erase(it) : std::next(it);
    juce::Rectangle<int> content;
    for(const auto& node:graph.nodes()) {
        auto& component=nodes_[node.id];
        if(component==nullptr) {
            component=std::make_unique<FxNodeComponent>(page_,node.id);
            addAndMakeVisible(*component);
        }
        component->update(node,node.id==selected);
        content=content.getUnion(component->getBounds());
    }
    minWidth_=minWidth; minHeight_=minHeight;
    updateExtent();
    wires_.clear();
    wires_.reserve(graph.connections().size());
    for(const auto& c:graph.connections()) {
        wires_.push_back({c,{},{},{}});
        computeWire(wires_.back());
    }
    repaint();
}

juce::Point<float> FxCanvas::portInCanvas(FxNodeId id,bool input,std::uint8_t port) const noexcept {
    const auto* node=nodeComponent(id);
    if(node==nullptr) return {};
    return node->portCentre(input,port)+node->getPosition().toFloat();
}

juce::Path FxCanvas::curve(juce::Point<float> a,juce::Point<float> b) {
    const float dx=juce::jmax(40.0f,std::abs(b.x-a.x)*.5f);
    juce::Path p;
    p.startNewSubPath(a);
    p.cubicTo(a.x+dx,a.y,b.x-dx,b.y,b.x,b.y);
    return p;
}

juce::Path FxCanvas::curveThrough(const std::vector<juce::Point<float>>& pts) {
    // Cardinal spline through every routing point, with horizontal tangents
    // at the ports so the cable still leaves/enters each port cleanly.
    juce::Path p;
    p.startNewSubPath(pts.front());
    const auto n=pts.size();
    std::vector<juce::Point<float>> tangent(n);
    tangent.front()={3.0f*juce::jmax(40.0f,std::abs(pts[1].x-pts[0].x)*.5f),0.0f};
    tangent.back()={3.0f*juce::jmax(40.0f,std::abs(pts[n-1].x-pts[n-2].x)*.5f),0.0f};
    for(std::size_t i=1;i+1<n;++i) tangent[i]=(pts[i+1]-pts[i-1])*0.5f;
    for(std::size_t i=0;i+1<n;++i) p.cubicTo(pts[i]+tangent[i]/3.0f,pts[i+1]-tangent[i+1]/3.0f,pts[i+1]);
    return p;
}

void FxCanvas::computeWire(Wire& wire) const {
    const auto a=portInCanvas(wire.connection.from.node,false,wire.connection.from.port);
    const auto b=portInCanvas(wire.connection.to.node,true,wire.connection.to.port);
    wire.handles.clear();
    for(const auto& p:wire.connection.layout) wire.handles.push_back({p.x,p.y});
    if(wire.handles.empty()) {
        wire.path=curve(a,b);
    } else {
        std::vector<juce::Point<float>> pts{a};
        pts.insert(pts.end(),wire.handles.begin(),wire.handles.end());
        pts.push_back(b);
        wire.path=curveThrough(pts);
    }
    wire.area=wire.path.getBounds().getSmallestIntegerContainer().expanded(int(wireHitRadius())+6);
}

std::optional<FxConnectionId> FxCanvas::connectionAt(juce::Point<float> p) const noexcept {
    std::optional<FxConnectionId> best;
    float bestDistance=wireHitRadius();
    for(const auto& wire:wires_) {
        if(!wire.area.expanded(int(wireHitRadius())).contains(p.toInt())) continue;
        juce::Point<float> nearest;
        wire.path.getNearestPoint(p,nearest);
        const float distance=p.getDistanceFrom(nearest);
        if(distance<=bestDistance) { bestDistance=distance; best=wire.connection.id; }
    }
    return best;
}

std::optional<std::pair<FxConnectionId,std::size_t>> FxCanvas::layoutPointAt(juce::Point<float> p) const noexcept {
    const float radius=std::max(pointHitRadius,pointHitRadius/std::max(0.1f,page_.graphZoom()));
    for(const auto& wire:wires_)
        for(std::size_t i=0;i<wire.handles.size();++i)
            if(p.getDistanceFrom(wire.handles[i])<=radius) return std::make_pair(wire.connection.id,i);
    return std::nullopt;
}

std::size_t FxCanvas::layoutInsertIndex(FxConnectionId id,juce::Point<float> p) const noexcept {
    for(const auto& wire:wires_) {
        if(wire.connection.id!=id) continue;
        std::vector<juce::Point<float>> pts{portInCanvas(wire.connection.from.node,false,wire.connection.from.port)};
        pts.insert(pts.end(),wire.handles.begin(),wire.handles.end());
        pts.push_back(portInCanvas(wire.connection.to.node,true,wire.connection.to.port));
        std::size_t best=0;
        float bestDistance=std::numeric_limits<float>::max();
        for(std::size_t i=0;i+1<pts.size();++i) {
            juce::Point<float> nearest;
            const float d=juce::Line<float>(pts[i],pts[i+1]).getDistanceFromPoint(p,nearest);
            if(d<bestDistance) { bestDistance=d; best=i; }
        }
        return best;
    }
    return 0;
}

void FxCanvas::nodeMoved(FxNodeId id) {
    for(auto& wire:wires_) {
        if(wire.connection.from.node!=id && wire.connection.to.node!=id) continue;
        repaint(wire.area);
        computeWire(wire);
        repaint(wire.area);
    }
}

void FxCanvas::beginWire(FxNodeId id,std::uint8_t port) {
    wireActive_=true;
    wireFrom_={id,port};
    wireEnd_=portInCanvas(id,false,port);
    for(auto& [nodeId,node]:nodes_) node->repaint(); // highlight compatible inputs
}

void FxCanvas::dragWire(juce::Point<int> p) {
    const auto start=portInCanvas(wireFrom_.node,false,wireFrom_.port);
    repaint(curve(start,wireEnd_).getBounds().getSmallestIntegerContainer().expanded(6));
    wireEnd_=p.toFloat();
    repaint(curve(start,wireEnd_).getBounds().getSmallestIntegerContainer().expanded(6));
}

void FxCanvas::clearNodes() {
    wireActive_=false;
    controlWireActive_=false;
    controlWireReverse_=false;
    hoverPoint_.reset();
    dragPoint_.reset();
    wires_.clear();
    nodes_.clear();
    repaint();
}

void FxCanvas::cancelWire() {
    if(!wireActive_) return;
    wireActive_=false;
    for(auto& [id,node]:nodes_) node->repaint();
    repaint();
}

void FxCanvas::endWire(juce::Point<int> p) {
    if(!wireActive_) return;
    const auto from=wireFrom_;
    cancelWire();
    // The graph is only mutated once a valid input port receives the cable;
    // empty canvas or an invalid port cancels cleanly.
    for(const auto& [id,node]:nodes_) {
        if(!node->getBounds().expanded(20).contains(p)) continue;
        const auto port=node->portAt((p-node->getPosition()).toFloat());
        if(port && port->first) { page_.connectPorts(from,{id,port->second}); return; }
    }
}

void FxCanvas::paint(juce::Graphics& g) {
    ++paints_;
    g.fillAll(juce::Colour(0xff0a0a0a));
    const auto clip=g.getClipBounds();
    const int grid=page_.graphZoom()<0.6f ? 48 : 24;
    g.setColour(Palette::borderSoft().withAlpha(.55f));
    for(int y=(clip.getY()/grid)*grid;y<clip.getBottom();y+=grid)
        for(int x=(clip.getX()/grid)*grid;x<clip.getRight();x+=grid)
            g.fillRect(x,y,1,1);

    for(const auto& wire:wires_) {
        if(!wire.area.intersects(clip)) continue;
        g.setColour(signalShade(.9f,.10f));
        g.strokePath(wire.path,juce::PathStrokeType(4.5f));
        g.setColour(signalShade(.95f,.88f));
        g.strokePath(wire.path,juce::PathStrokeType(1.5f));
        g.setColour(signalSourceColour());
        for(const auto& end:{wire.path.getPointAlongPath(0.0f),wire.path.getPointAlongPath(wire.path.getLength())})
            g.fillEllipse(juce::Rectangle<float>(5.0f,5.0f).withCentre(end));
        for(std::size_t i=0;i<wire.handles.size();++i) {
            const bool active=(hoverPoint_ && hoverPoint_->first==wire.connection.id && hoverPoint_->second==i)
                           || (dragPoint_ && dragPoint_->first==wire.connection.id && dragPoint_->second==i);
            const float radius=active ? 5.5f : 4.5f;
            auto dot=juce::Rectangle<float>(radius*2.0f,radius*2.0f).withCentre(wire.handles[i]);
            g.setColour(Palette::inset());
            g.fillEllipse(dot);
            g.setColour(active ? signalSourceColour() : Palette::accent().withAlpha(.85f));
            g.drawEllipse(dot,1.3f);
        }
    }
    // CONTROL relationships: thin white cables (AUDIO cables are thick red),
    // dashed when inactive or when the crossing is not modelled by NODES.
    for(const auto& wire:controlWires_) {
        if(wire.path.isEmpty() || !wire.area.intersects(clip)) continue;
        const bool muted=!wire.link.enabled || !wire.link.supported;
        if(wire.link.signal!=ControlSignal::Control) {
            // EVENT: short dashes; GATE: long dashes (thin, never coloured by type).
            juce::Path dashed;
            const float eventDashes[]{2.0f,3.0f},gateDashes[]{7.0f,3.0f};
            juce::PathStrokeType(wire.link.selected ? 2.0f : 1.2f).createDashedStroke(dashed,wire.path,
                wire.link.signal==ControlSignal::Event ? eventDashes : gateDashes,2);
            g.setColour(wire.link.selected ? signalSourceColour() : Palette::text().withAlpha(.72f));
            g.fillPath(dashed);
        } else if(wire.link.selected) {
            g.setColour(signalSourceColour());
            g.strokePath(wire.path,juce::PathStrokeType(2.2f));
        } else if(muted) {
            juce::Path dashed;
            const float dashes[]{4.0f,4.0f};
            juce::PathStrokeType(1.1f).createDashedStroke(dashed,wire.path,dashes,2);
            g.setColour(Palette::text().withAlpha(.35f));
            g.fillPath(dashed);
        } else {
            g.setColour(Palette::text().withAlpha(.72f));
            g.strokePath(wire.path,juce::PathStrokeType(1.2f));
        }
    }
    if(marqueeActive_) {
        g.setColour(signalSourceColour().withAlpha(0.12f)); g.fillRect(marquee_);
        g.setColour(signalSourceColour().withAlpha(0.7f)); g.drawRect(marquee_,1.0f/std::max(0.1f,page_.graphZoom()));
    }
    if(controlWireActive_) {
        // A cable picked up from an input is drawn output-to-input as well.
        auto pending=controlWireReverse_ ? curve(controlWireEnd_,controlWireStart_) : curve(controlWireStart_,controlWireEnd_);
        juce::Path dashed;
        const float dashes[]{3.0f,3.0f};
        juce::PathStrokeType(1.1f).createDashedStroke(dashed,pending,dashes,2);
        g.setColour(Palette::text().withAlpha(.8f));
        g.fillPath(dashed);
    }
    if(wireActive_) {
        auto pending=curve(portInCanvas(wireFrom_.node,false,wireFrom_.port),wireEnd_);
        juce::Path dashed;
        const float dashes[]{5.0f,4.0f};
        juce::PathStrokeType(1.3f).createDashedStroke(dashed,pending,dashes,2);
        g.setColour(Palette::accent().withAlpha(.8f));
        g.fillPath(dashed);
    }
}

void FxCanvas::showControlLinkMenu(const ControlHit& hit) {
    // INSERT NODE splices an operator into this CONTROL cable atomically.
    std::vector<NativeChoiceItem> items;
    // Only nodes whose first input takes this cable's signal and whose output
    // matches what the cable fed (a route always carries CONTROL).
    // (N06: typed by the cable's actual output port; multi-output nodes feed
    // the consumer from their unambiguous matching port.)
    for(const auto type:page_.controlInsertTypes(hit.route,hit.op,hit.input))
        if(const auto* info=controlOpInfo(type))
            { NativeChoiceItem item{int(type),juce::String(info->label),true,juce::String("INSERT NODE / ")+juce::String(info->category).toUpperCase()};
              item.path={"INSERT NODE",juce::String(info->category).toUpperCase()};
              items.push_back(item); }
    constexpr int removeId=1000;
    items.push_back({removeId,hit.route!=0 ? "Delete Modulation" : "Disconnect",true,"CONNECTION"});
    juce::Component::SafePointer<FxPage> page(&page_);
    showNativeChoiceMenu(*this,"CONTROL",items,0,[page,hit](int choice) {
        if(page==nullptr) return;
        if(choice==removeId) {
            if(hit.route!=0) page->deleteControlLink(hit.route); else page->disconnectControlInput(hit.op,hit.input);
            return;
        }
        const auto type=static_cast<ControlOpType>(choice);
        if(hit.route!=0) page->insertControlOperatorOnRoute(hit.route,type);
        else page->insertControlOperatorOnInput(hit.op,hit.input,type);
    },NativeMenuLayout::Hierarchical);
}

void FxCanvas::showConnectionMenu(FxConnectionId id,juce::Point<float> at) {
    const auto* connection=page_.graph().findConnection(id);
    if(connection==nullptr) return;
    auto items=page_.moduleMenuItems(false);
    for(auto& item:items) { item.path.insert(0,"INSERT MODULE"); item.group="INSERT MODULE / "+item.group; }
    constexpr int addPoint=3001,resetRouting=3002,removeConnection=3003;
    items.push_back({addPoint,"Add Routing Point",true,"CONNECTION"});
    items.push_back({resetRouting,"Reset Routing",!connection->layout.empty(),"CONNECTION"});
    items.push_back({removeConnection,"Remove Connection",true,"CONNECTION"});
    juce::Component::SafePointer<FxPage> page(&page_);
    const auto graphAt=toGraph(at);
    const auto pointIndex=layoutInsertIndex(id,at);
    showNativeChoiceMenu(*this,"CONNECTION",items,0,[page,id,graphAt,pointIndex](int choice) {
        if(page==nullptr) return;
        if(choice==addPoint) { page->document().edit([&](FxGraph& g){return g.addLayoutPoint(id,pointIndex,graphAt)==FxEditResult::Ok;}); page->syncFromModel(); return; }
        if(choice==resetRouting) { page->resetConnectionRouting(id); return; }
        if(choice==removeConnection) { page->removeConnection(id); return; }
        if(const auto spec=FxModuleMenu::decode(choice)) page->insertModuleOnConnection(id,*spec,graphAt);
    },NativeMenuLayout::Hierarchical);
}

void FxCanvas::mouseDown(const juce::MouseEvent& e) {
    page_.grabKeyboardFocus();
    const auto position=e.position;
    if(e.mods.isMiddleButtonDown()) {
        panning_=true;
        panMouseStart_=e.getEventRelativeTo(&page_.graphView()).position;
        panViewStart_=page_.graphView().pan();
        return;
    }
    if(const auto point=layoutPointAt(position)) {
        if(e.mods.isPopupMenu()) {
            juce::Component::SafePointer<FxPage> page(&page_);
            const auto target=*point;
            showNativeChoiceMenu(*this,"ROUTING POINT",{
                {1,"Remove Routing Point",true,"ROUTING"},
                {2,"Reset Routing",true,"ROUTING"}},0,[page,target](int choice) {
                if(page==nullptr) return;
                if(choice==1) page->removeLayoutPoint(target.first,target.second);
                if(choice==2) page->resetConnectionRouting(target.first);
            });
            return;
        }
        dragPoint_=point;
        return;
    }
    if(const auto hit=controlLinkAt(position)) {
        if(hit->route!=0) page_.selectControlLink(hit->route); else page_.selectControlEdge(hit->op,hit->input);
        if(e.mods.isPopupMenu()) showControlLinkMenu(*hit);
        return;
    }
    if(e.mods.isPopupMenu()) {
        if(const auto wire=connectionAt(position)) { showConnectionMenu(*wire,position); return; }
        // Right-click empty space: the SAME module catalog, created at the click.
        const auto at=toGraph(position);
        juce::Component::SafePointer<FxPage> page(&page_);
        page_.showModuleMenu(*this,true,[page,at](FxModuleSpec spec){if(page!=nullptr) page->addModuleAt(spec,at);},at);
        return;
    }
    page_.selectNode(invalidFxNodeId);
    // N07: left-drag on empty canvas draws a selection marquee (Shift adds);
    // Option/Alt-drag, middle-drag and the trackpad pan.
    if(!e.mods.isAltDown()) {
        if(!e.mods.isShiftDown()) page_.setControlNodeSelection({});
        beginMarquee(position,e.mods.isShiftDown());
        return;
    }
    panning_=true;
    panMouseStart_=e.getEventRelativeTo(&page_.graphView()).position;
    panViewStart_=page_.graphView().pan();
}

void FxCanvas::mouseDrag(const juce::MouseEvent& e) {
    if(dragPoint_) {
        page_.moveLayoutPoint(dragPoint_->first,dragPoint_->second,toGraph(e.position),true);
        return;
    }
    if(marqueeActive_) { dragMarquee(e.position); return; }
    if(panning_) {
        auto& view=page_.graphView();
        const auto now=e.getEventRelativeTo(&view).position;
        view.setView(view.zoom(),panViewStart_-(now-panMouseStart_));
    }
}

void FxCanvas::mouseUp(const juce::MouseEvent& e) {
    if(dragPoint_) {
        page_.moveLayoutPoint(dragPoint_->first,dragPoint_->second,toGraph(e.position),false);
        dragPoint_.reset();
        repaint();
    }
    endMarquee();
    panning_=false;
}

void FxCanvas::mouseMove(const juce::MouseEvent& e) {
    const auto hover=layoutPointAt(e.position);
    if(hover!=hoverPoint_) { hoverPoint_=hover; repaint(); }
    setMouseCursor(hover ? juce::MouseCursor::DraggingHandCursor
                   : connectionAt(e.position) || controlLinkAt(e.position) ? juce::MouseCursor::PointingHandCursor
                                              : juce::MouseCursor::NormalCursor);
}

void FxCanvas::mouseExit(const juce::MouseEvent&) {
    if(hoverPoint_) { hoverPoint_.reset(); repaint(); }
}

void FxCanvas::mouseDoubleClick(const juce::MouseEvent& e) {
    if(layoutPointAt(e.position)) return;
    if(const auto wire=connectionAt(e.position)) page_.addLayoutPoint(*wire,toGraph(e.position));
}

bool FxCanvas::isInterestedInDragSource(const SourceDetails& details) {
    const auto d=details.description.toString();
    return d.startsWith(moduleDragPrefix) || d.startsWith("MCT_SYNTH_FILTER:");
}

void FxCanvas::itemDropped(const SourceDetails& details) {
    if(details.description.toString().startsWith("MCT_SYNTH_FILTER:")) {
        page_.addSynthFilterCopy(toGraph(details.localPosition.toFloat()),std::uint32_t(details.description.toString().fromFirstOccurrenceOf(":",false,false).getIntValue()));
        return;
    }
    const int id=details.description.toString().fromFirstOccurrenceOf(moduleDragPrefix,false,false).getIntValue();
    if(const auto spec=FxModuleMenu::decode(id)) page_.addModuleAt(*spec,toGraph(details.localPosition.toFloat()));
}

// ================================================================ graph view

FxGraphView::FxGraphView(FxCanvas& canvas):canvas_(canvas) {
    addAndMakeVisible(canvas_);
    for(auto* bar:{&horizontal_,&vertical_}) {
        addAndMakeVisible(*bar);
        bar->addListener(this);
        bar->setAutoHide(false);
    }
}

FxGraphView::~FxGraphView() {
    horizontal_.removeListener(this);
    vertical_.removeListener(this);
}

juce::Rectangle<int> FxGraphView::viewport() const noexcept {
    return getLocalBounds().withTrimmedRight(10).withTrimmedBottom(10);
}

juce::Point<float> FxGraphView::graphToView(FxPoint p) const noexcept {
    return {p.x*zoom_-pan_.x,p.y*zoom_-pan_.y};
}

FxPoint FxGraphView::viewToGraph(juce::Point<float> p) const noexcept {
    return {(p.x+pan_.x)/zoom_,(p.y+pan_.y)/zoom_};
}

void FxGraphView::setView(float zoom,juce::Point<float> pan) {
    zoom_=std::isfinite(zoom) ? juce::jlimit(minZoom,maxZoom,zoom) : 1.0f;
    pan_=pan;
    apply();
}

void FxGraphView::zoomAround(float zoom,juce::Point<float> anchor) {
    // Keep the graph point under the pointer under the pointer.
    const auto g=viewToGraph(anchor);
    zoom_=juce::jlimit(minZoom,maxZoom,zoom);
    pan_={g.x*zoom_-anchor.x,g.y*zoom_-anchor.y};
    apply();
}

void FxGraphView::panBy(juce::Point<float> delta) {
    pan_+=delta;
    apply();
}

void FxGraphView::fitTo(juce::Rectangle<int> graphBounds) {
    if(graphBounds.isEmpty()) return;
    const auto area=viewport().toFloat();
    const auto content=graphBounds.toFloat().expanded(40.0f);
    zoom_=juce::jlimit(minZoom,maxZoom,std::min(area.getWidth()/content.getWidth(),area.getHeight()/content.getHeight()));
    pan_={content.getCentreX()*zoom_-area.getWidth()*0.5f,content.getCentreY()*zoom_-area.getHeight()*0.5f};
    apply();
}

void FxGraphView::contentChanged() { apply(); }

void FxGraphView::apply() {
    const auto area=viewport();
    const float width=float(canvas_.getWidth())*zoom_,height=float(canvas_.getHeight())*zoom_;
    pan_.x=juce::jlimit(0.0f,std::max(0.0f,width-float(area.getWidth())),pan_.x);
    pan_.y=juce::jlimit(0.0f,std::max(0.0f,height-float(area.getHeight())),pan_.y);
    canvas_.setTransform(juce::AffineTransform::scale(zoom_).translated(-pan_.x,-pan_.y));
    const juce::ScopedValueSetter<bool> guard(updating_,true);
    horizontal_.setRangeLimits(0.0,std::max<double>(width,area.getWidth()));
    horizontal_.setCurrentRange(pan_.x,area.getWidth());
    vertical_.setRangeLimits(0.0,std::max<double>(height,area.getHeight()));
    vertical_.setCurrentRange(pan_.y,area.getHeight());
    if(onViewChanged) onViewChanged();
}

void FxGraphView::resized() {
    auto area=getLocalBounds();
    vertical_.setBounds(area.removeFromRight(10).withTrimmedBottom(10));
    horizontal_.setBounds(area.removeFromBottom(10));
    apply();
}

void FxGraphView::scrollBarMoved(juce::ScrollBar* bar,double start) {
    if(updating_) return;
    if(bar==&horizontal_) pan_.x=float(start); else pan_.y=float(start);
    apply();
}

void FxGraphView::mouseWheelMove(const juce::MouseEvent& e,const juce::MouseWheelDetails& wheel) {
    const auto at=e.getEventRelativeTo(this).position;
    if(e.mods.isCommandDown() || e.mods.isCtrlDown()) {
        zoomAround(zoom_*std::exp(wheel.deltaY*1.6f),at);
        return;
    }
    constexpr float speed=420.0f;
    if(e.mods.isShiftDown()) panBy({-wheel.deltaY*speed,0.0f});
    else panBy({-wheel.deltaX*speed,-wheel.deltaY*speed});
}

void FxGraphView::mouseMagnify(const juce::MouseEvent& e,float scaleFactor) {
    zoomAround(zoom_*scaleFactor,e.getEventRelativeTo(this).position);
}

// ================================================================ sidebar

class FxSidebar::List final : public juce::Component {
public:
    explicit List(FxSidebar& owner):owner_(owner) {}
    void paint(juce::Graphics& g) override {
        const auto& rows=owner_.rows(owner_.tab());
        for(std::size_t i=0;i<rows.size();++i) {
            const auto& row=rows[i];
            if(row.modulationSource) continue; // a hosted ModulationSourceRow paints itself
            auto r=rowBounds(i);
            if(row.header) { text(g,row.label,r.withTrimmedTop(12),Type::secondary,Palette::muted()); continue; }
            SourceEntityStyle style;
            style.label=row.label; style.badge=row.badge; style.detail=row.detail;
            style.draggable=row.dragDescription.isNotEmpty();
            style.enabled=row.enabled; style.active=row.active;
            style.hovered=int(i)==hover_ && row.enabled && (row.onClick || style.draggable);
            for(const auto& m:row.magnitudes) style.magnitudes.push_back(m.amount);
            paintSourceEntityRow(g,r,style);
        }
    }
    void mouseMove(const juce::MouseEvent& e) override {
        const int index=indexAt(e.getPosition());
        if(index!=hover_) { hover_=index; repaint(); }
    }
    void mouseExit(const juce::MouseEvent&) override { hover_=-1; repaint(); }
    void mouseDown(const juce::MouseEvent& e) override {
        pressed_=indexAt(e.getPosition());
        dragged_=false;
        ringRoute_=0;
        if(pressed_<0) return;
        const auto& row=owner_.rows(owner_.tab())[std::size_t(pressed_)];
        if(e.mods.isPopupMenu()) {
            if(row.onSecondaryClick) row.onSecondaryClick();
            pressed_=-1;
            return;
        }
        // Magnitude rings edit the SAME canonical route as Synth / Matrix.
        const std::size_t rings=std::min<std::size_t>(row.magnitudes.size(),3);
        for(std::size_t m=0;m<rings;++m)
            if(sourceEntityRing(rowBounds(std::size_t(pressed_)),m,row.active).expanded(4.0f).contains(e.position)) {
                ringRoute_=row.magnitudes[m].routeId;
                ringStartAmount_=row.magnitudes[m].amount;
                ringStartY_=e.position.y;
            }
    }
    void mouseDrag(const juce::MouseEvent& e) override {
        if(pressed_<0) return;
        const auto& row=owner_.rows(owner_.tab())[std::size_t(pressed_)];
        if(ringRoute_!=0) {
            if(row.onMagnitude) row.onMagnitude(ringRoute_,juce::jlimit(-1.0f,1.0f,ringStartAmount_+(ringStartY_-e.position.y)/60.0f));
            return;
        }
        if(dragged_ || e.getDistanceFromDragStart()<6 || row.dragDescription.isEmpty() || !row.enabled) return;
        if(auto* container=juce::DragAndDropContainer::findParentDragContainerFor(this)) {
            dragged_=true;
            juce::Image image(juce::Image::ARGB,190,32,true);
            {
                juce::Graphics g(image);
                SourceEntityStyle style;
                style.label=row.label; style.draggable=true; style.selected=true;
                paintSourceEntityRow(g,{0,0,190,32},style);
            }
            container->startDragging(row.dragDescription,this,juce::ScaledImage(image));
        }
    }
    void mouseUp(const juce::MouseEvent& e) override {
        const int index=indexAt(e.getPosition());
        if(!dragged_ && ringRoute_==0 && index>=0 && index==pressed_) {
            const auto& row=owner_.rows(owner_.tab())[std::size_t(index)];
            if(row.enabled && row.onClick) row.onClick();
        }
        pressed_=-1;
        ringRoute_=0;
    }
    int contentHeight() const { return bounds_.empty() ? 8 : bounds_.back().getBottom()+8; }
    // Row geometry for the current tab (FxSidebar::layoutList).
    std::vector<juce::Rectangle<int>> bounds_;
private:
    juce::Rectangle<int> rowBounds(std::size_t i) const {
        return i<bounds_.size() ? bounds_[i] : juce::Rectangle<int>{0,int(i)*rowHeight,getWidth(),rowHeight-4};
    }
    int indexAt(juce::Point<int> p) const {
        const auto& rows=owner_.rows(owner_.tab());
        for(std::size_t i=0;i<rows.size();++i)
            if(!rows[i].header && !rows[i].modulationSource && rowBounds(i).contains(p)) return int(i);
        return -1;
    }
    FxSidebar& owner_;
    int hover_=-1,pressed_=-1;
    bool dragged_=false;
    std::uint32_t ringRoute_=0;
    float ringStartAmount_=0.0f,ringStartY_=0.0f;
};

FxSidebar::FxSidebar():list_(std::make_unique<List>(*this)) {
    const char* names[]{"SOURCES","MODULATORS","FILTERS","BUSES","MATRIX"};
    for(int i=0;i<tabCount;++i) {
        auto& tab=tabs_[std::size_t(i)];
        tab.setButtonText(names[i]);
        tab.setClickingTogglesState(true);
        tab.setRadioGroupId(0x46534231);
        tab.setToggleState(i==0,juce::dontSendNotification);
        tab.setName(juce::String("FX sidebar ")+names[i]);
        tab.onClick=[this,i]{if(tabs_[std::size_t(i)].getToggleState()) { setTab(static_cast<Tab>(i)); if(onTabChanged) onTabChanged(tab_); }};
        addAndMakeVisible(tab);
    }
    viewport_.setViewedComponent(list_.get(),false);
    viewport_.setScrollBarsShown(true,false);
    viewport_.setScrollBarThickness(8);
    addAndMakeVisible(viewport_);
}

FxSidebar::~FxSidebar() {
    modulatorRows_.clear();
    viewport_.setViewedComponent(nullptr,false);
}

void FxSidebar::setTab(Tab tab) {
    tab_=tab;
    for(int i=0;i<tabCount;++i) tabs_[std::size_t(i)].setToggleState(i==static_cast<int>(tab),juce::dontSendNotification);
    resized();
    list_->repaint();
}

void FxSidebar::setRows(Tab tab,std::vector<Row> rows) {
    juce::String signature;
    for(const auto& r:rows) signature<<r.label<<"|"<<r.badge<<"|"<<int(r.active)<<int(r.enabled)<<";";
    bool changed=signature!=signatures_[static_cast<std::size_t>(tab)];
    signatures_[static_cast<std::size_t>(tab)]=signature;
    rows_[static_cast<std::size_t>(tab)]=std::move(rows); // fresh callbacks either way
    // Modulator cards change height with their route count: that is a layout
    // change of the list, independent of which tab is showing.
    if(tab==Tab::Modulators) changed|=syncModulatorRows();
    if(changed) { layoutList(); list_->repaint(); }
}

void FxSidebar::setMatrixView(juce::Component* view) {
    if(matrixView_!=nullptr) removeChildComponent(matrixView_);
    matrixView_=view;
    if(matrixView_!=nullptr) addChildComponent(matrixView_);
    resized();
}

const ModulationSourceRow* FxSidebar::modulatorRow(ModSource source) const noexcept {
    for(const auto& row:modulatorRows_) if(row->source()==source) return row.get();
    return nullptr;
}

bool FxSidebar::syncModulatorRows() {
    const auto& rows=rows_[static_cast<std::size_t>(Tab::Modulators)];
    bool changed=false;
    std::vector<std::unique_ptr<ModulationSourceRow>> next;
    for(const auto& row:rows) {
        if(!row.modulationSource) continue;
        const auto source=*row.modulationSource;
        std::unique_ptr<ModulationSourceRow> card;
        for(auto& existing:modulatorRows_)
            if(existing!=nullptr && existing->source()==source) card=std::move(existing);
        if(card==nullptr) {
            changed=true;
            card=std::make_unique<ModulationSourceRow>(source,row.label,"MOD SOURCE TAB FX "+row.label);
            card->setClickingTogglesState(false);
            card->setToggleState(selectedModulator_==source,juce::dontSendNotification);
            // Callbacks resolve the CURRENT row: rows are rebuilt on every refresh.
            const auto current=[this,source]()->const Row* {
                for(const auto& r:rows_[static_cast<std::size_t>(Tab::Modulators)])
                    if(r.modulationSource==source) return &r;
                return nullptr;
            };
            card->onRouteAmount=[current](std::uint32_t id,float amount){
                if(const auto* r=current(); r!=nullptr && r->onMagnitude) r->onMagnitude(id,amount);
            };
            card->onRouteRemove=[current](std::uint32_t id){
                if(const auto* r=current(); r!=nullptr && r->onRemoveRoute) r->onRemoveRoute(id);
            };
            card->onHoverChanged=[this]{repaint();};
            card->onClick=[this,source,current]{
                selectedModulator_=source;
                for(auto& c:modulatorRows_) c->setToggleState(c->source()==source,juce::dontSendNotification);
                if(const auto* r=current(); r!=nullptr && r->onClick) r->onClick();
            };
            list_->addChildComponent(*card);
        }
        std::vector<ModulationSourceRoute> routes;
        for(const auto& m:row.magnitudes) routes.push_back({m.routeId,m.amount});
        changed|=card->setRoutes(std::move(routes));
        next.push_back(std::move(card));
    }
    for(auto& stale:modulatorRows_) if(stale!=nullptr) { list_->removeChildComponent(stale.get()); changed=true; }
    modulatorRows_=std::move(next);
    return changed;
}

void FxSidebar::layoutList() {
    const auto& rows=rows_[static_cast<std::size_t>(tab_)];
    const int width=juce::jmax(1,viewport_.getWidth()-10);
    auto& bounds=list_->bounds_;
    bounds.clear();
    int y=0;
    for(const auto& row:rows) {
        if(row.modulationSource) {
            // The SYNTH card's own height rule; same 2 px gap as the SYNTH rail.
            const int h=ModulationSourceRow::heightFor(row.magnitudes.size());
            bounds.push_back({0,y,width,h-2});
            y+=h;
        } else {
            bounds.push_back({0,y,width,rowHeight-4});
            y+=rowHeight;
        }
    }
    const bool showCards=tab_==Tab::Modulators;
    for(auto& card:modulatorRows_) {
        card->setVisible(showCards);
        for(std::size_t i=0;showCards && i<rows.size();++i)
            if(rows[i].modulationSource==card->source()) card->setBounds(bounds[i]);
    }
    list_->setSize(width,std::max(viewport_.getHeight(),list_->contentHeight()));
}

void FxSidebar::paintOverChildren(juce::Graphics& g) {
    if(tab_!=Tab::Modulators || !routeLabel) return;
    for(const auto& card:modulatorRows_) {
        if(card->hoveredRoute()==0 || !card->isShowing()) continue;
        paintModulationRouteTooltip(g,routeLabel(card->hoveredRoute()),getLocalPoint(card.get(),card->hoverPoint()),
                                    getLocalBounds().toFloat().reduced(4.0f));
        break;
    }
}

void FxSidebar::resized() {
    auto area=getLocalBounds().reduced(10,10);
    auto tabs=area.removeFromTop(60);
    // SOURCES / MODULATORS / FILTERS over BUSES / MATRIX: readable segmented tabs.
    auto top=tabs.removeFromTop(28),bottom=tabs.withTrimmedTop(4);
    const int third=top.getWidth()/3;
    tabs_[0].setBounds(top.removeFromLeft(third).reduced(1,0));
    tabs_[1].setBounds(top.removeFromLeft(third).reduced(1,0));
    tabs_[2].setBounds(top.reduced(1,0));
    tabs_[3].setBounds(bottom.removeFromLeft(bottom.getWidth()/2).reduced(1,0));
    tabs_[4].setBounds(bottom.reduced(1,0));
    area.removeFromTop(6);
    const bool matrix=tab_==Tab::Matrix && matrixView_!=nullptr;
    viewport_.setVisible(!matrix);
    if(matrixView_!=nullptr) { matrixView_->setVisible(matrix); matrixView_->setBounds(area); }
    viewport_.setBounds(area);
    layoutList();
}

void FxSidebar::paint(juce::Graphics& g) {
    g.fillAll(Palette::panel());
    g.setColour(Palette::borderSoft());
    g.drawVerticalLine(getWidth()-1,0.0f,float(getHeight()));
}

// ================================================================ modal / global FX

FxModalOverlay::FxModalOverlay() {
    setWantsKeyboardFocus(true);
    setVisible(false);
}

void FxModalOverlay::show(juce::Component& content,juce::Rectangle<int> panelSize) {
    if(content_!=nullptr && content_!=&content) removeChildComponent(content_);
    content_=&content;
    panelSize_=panelSize;
    addAndMakeVisible(content);
    setVisible(true);
    toFront(true);
    resized();
    grabKeyboardFocus();
}

void FxModalOverlay::dismiss() {
    if(!isVisible()) return;
    setVisible(false);
    if(onDismissed) onDismissed();
}

void FxModalOverlay::resized() {
    if(content_!=nullptr) content_->setBounds(panelSize_.withCentre(getLocalBounds().getCentre()));
}

void FxModalOverlay::paint(juce::Graphics& g) { g.fillAll(juce::Colours::black.withAlpha(.55f)); }

void FxModalOverlay::mouseDown(const juce::MouseEvent& e) {
    if(content_==nullptr || !content_->getBounds().contains(e.getPosition())) dismiss();
}

bool FxModalOverlay::keyPressed(const juce::KeyPress& key) {
    if(key==juce::KeyPress::escapeKey) { dismiss(); return true; }
    return false;
}

FxGlobalFxEditor::FxGlobalFxEditor(FxWorkspace& workspace):workspace_(workspace) {
    const char* names[]{"INPUT","DRY/WET","WIDTH","OUTPUT"};
    const double lo[]{-24.0,0.0,0.0,-24.0},hi[]{24.0,1.0,2.0,24.0},defaults[]{0.0,1.0,1.0,0.0};
    for(std::size_t i=0;i<knobs_.size();++i) {
        auto& k=knobs_[i];
        configureKnob(k);
        k.setRange(lo[i],hi[i],0.001);
        k.setName(juce::String("FX Global ")+names[i]);
        k.getProperties().set("mct.origami.knobDefault",defaults[i]);
        k.onValueChange=[this]{commit();};
        addAndMakeVisible(k);
    }
    order_.addItem("POST MASTER",int(FxOrder::PostMaster));
    order_.addItem("PRE MASTER",int(FxOrder::PreMaster));
    bypass_.addItem("CROSSFADE",int(FxBypassMode::Crossfade));
    bypass_.addItem("HARD",int(FxBypassMode::Hard));
    bypass_.addItem("TAIL PRESERVE",int(FxBypassMode::TailPreserve));
    order_.setName("FX Global order");
    bypass_.setName("FX Global bypass mode");
    for(auto* c:{&order_,&bypass_}) { c->onChange=[this]{commit();}; addAndMakeVisible(c); }
    close_.setName("FX Global close");
    close_.onClick=[this]{if(onClose) onClose();};
    addAndMakeVisible(close_);
    sync();
}

void FxGlobalFxEditor::sync() {
    const juce::ScopedValueSetter<bool> guard(syncing_,true);
    const auto& s=workspace_.globals();
    const float values[]{s.inputGainDb,s.dryWet,s.width,s.outputGainDb};
    for(std::size_t i=0;i<knobs_.size();++i)
        if(!knobs_[i].isMouseButtonDown()) knobs_[i].setValue(values[i],juce::dontSendNotification);
    order_.setSelectedId(int(s.order),juce::dontSendNotification);
    bypass_.setSelectedId(int(s.bypass),juce::dontSendNotification);
    repaint();
}

void FxGlobalFxEditor::commit() {
    if(syncing_) return;
    FxGlobalSettings s;
    s.inputGainDb=float(knobs_[0].getValue());
    s.dryWet=float(knobs_[1].getValue());
    s.width=float(knobs_[2].getValue());
    s.outputGainDb=float(knobs_[3].getValue());
    s.order=static_cast<FxOrder>(order_.getSelectedId());
    s.bypass=static_cast<FxBypassMode>(bypass_.getSelectedId());
    // GLOBAL FX acts on the summed master of every bus, not on one bus graph.
    workspace_.setGlobals(s);
    repaint();
}

void FxGlobalFxEditor::resized() {
    auto area=getLocalBounds().reduced(18,12);
    close_.setBounds(area.removeFromTop(28).removeFromRight(32));
    area.removeFromTop(26);
    auto knobs=area.removeFromTop(104).withTrimmedBottom(34);
    const int width=knobs.getWidth()/4;
    for(auto& k:knobs_) k.setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(52,52));
    area.removeFromTop(12);
    order_.setBounds(area.removeFromTop(28).withTrimmedLeft(130).withWidth(190));
    area.removeFromTop(30);
    bypass_.setBounds(area.removeFromTop(28).withTrimmedLeft(130).withWidth(190));
}

void FxGlobalFxEditor::paint(juce::Graphics& g) {
    const auto& s=workspace_.globals();
    g.fillAll(Palette::panel());
    g.setColour(Palette::border());
    g.drawRect(getLocalBounds());
    auto area=getLocalBounds().reduced(18,12);
    text(g,"GLOBAL FX",area.removeFromTop(28),13.0f,Palette::text());
    text(g,"INPUT  >  BUS GRAPHS  >  DRY/WET  >  WIDTH  >  OUTPUT",area.removeFromTop(26),Type::secondary,Palette::muted());
    auto knobs=area.removeFromTop(104);
    auto values=knobs.removeFromBottom(16),labels=knobs.removeFromBottom(18);
    const int width=labels.getWidth()/4;
    const juce::String texts[]{juce::String(s.inputGainDb,1)+" dB",juce::String(juce::roundToInt(s.dryWet*100))+"%",
                               juce::String(juce::roundToInt(s.width*100))+"%",juce::String(s.outputGainDb,1)+" dB"};
    int i=0;
    for(const char* n:{"INPUT","DRY/WET","WIDTH","OUTPUT"}) {
        text(g,n,labels.removeFromLeft(width),Type::label,Palette::muted(),juce::Justification::centred);
        text(g,texts[i++],values.removeFromLeft(width),Type::label,Palette::secondary(),juce::Justification::centred);
    }
    area.removeFromTop(12);
    text(g,"FX ORDER",area.removeFromTop(28),10.0f,Palette::secondary());
    text(g,s.order==FxOrder::PreMaster ? "Voices > bus graphs > master gain (drive/limit before volume)."
                                       : "Voices > master gain > bus graphs.",area.removeFromTop(24),Type::secondary,Palette::muted());
    area.removeFromTop(6);
    text(g,"BYPASS MODE",area.removeFromTop(28),10.0f,Palette::secondary());
    text(g,s.bypass==FxBypassMode::Hard ? "Effect PWR switches instantly."
         : s.bypass==FxBypassMode::TailPreserve ? "Bypassed effects stop taking input; delay/reverb tails ring out."
                                                : "Effect PWR crossfades over 10 ms.",area.removeFromTop(24),Type::secondary,Palette::muted());
}

// ================================================================ inspector

// mct-origami-nodes-n01: the old SELECTED EFFECT and EFFECT PARAMETERS
// panels are now two untitled sections of one MODULE PARAMETERS inspector
// ("how does the selected module behave?"). Same contentBounds/paintContent
// contract as Panel, without a panel shell of their own.
class InspectorSection : public juce::Component {
public:
    void paint(juce::Graphics& g) override { paintContent(g,contentBounds()); }
    juce::Rectangle<int> contentBounds() const { return getLocalBounds(); }
protected:
    virtual void paintContent(juce::Graphics&,juce::Rectangle<int>) {}
};

class FxPage::SelectedPanel final : public InspectorSection {
public:
    explicit SelectedPanel(FxPage& page):page_(page) {
        for(auto* b:{&power_,&remove_}) addChildComponent(b);
        power_.setClickingTogglesState(true);
        power_.setName("Power FX inspector");
        power_.onClick=[this]{if(node_) page_.setNodeEnabled(node_->id,power_.getToggleState());};
        remove_.onClick=[this]{if(node_) page_.deleteNode(node_->id);};
    }
    juce::String headline() const { return node_ ? juce::String(node_->name) : juce::String("NO NODE SELECTED"); }
    void show(const FxGraph& graph,FxNodeId id) {
        const auto* node=graph.findNode(id);
        if(node!=nullptr) node_=*node; else node_.reset();
        // Quick (primary) controls first, then other main controls, max 5.
        std::vector<const FxParameterDescriptor*> params;
        if(node_) {
            for(const auto* p:parametersFor(*node_,true,std::nullopt))
                if(p->curve!=FxParameterCurve::Choice && params.size()<5) params.push_back(p);
            for(const auto* p:parametersFor(*node_,false,FxParameterPage::Main))
                if(p->curve!=FxParameterCurve::Choice && params.size()<5 && std::find(params.begin(),params.end(),p)==params.end())
                    params.push_back(p);
        }
        std::vector<FxParameterId> ids;
        for(const auto* p:params) ids.push_back(p->id);
        if(ids!=ids_ || shownId_!=id) {
            knobs_.clear();
            ids_=ids;
            shownId_=id;
            for(const auto* p:params) {
                const auto pid=p->id;
                auto knob=std::make_unique<FxFeedbackSlider>(page_);
                configureKnob(*knob);
                knob->setRange(0.0,1.0,0.001);
                knob->setName("FX inspector P"+juce::String(pid));
                tagModulationDestination(*knob,page_.selectedBus(),id,*p);
                auto* raw=knob.get();
                knob->onDragStart=[this]{page_.beginParameterGesture();};
                knob->onDragEnd=[this]{page_.endParameterGesture();};
                knob->onValueChange=[this,raw,pid]{if(node_) page_.setParameter(node_->id,pid,float(raw->getValue()));};
                addAndMakeVisible(*knob);
                knobs_.push_back(std::move(knob));
            }
        }
        params_=params;
        for(std::size_t i=0;i<knobs_.size();++i)
            if(!knobs_[i]->isMouseButtonDown())
                knobs_[i]->setValue(node_->parameter(ids_[i]).value_or(0.0f),juce::dontSendNotification);
        const bool effect=node_ && node_->kind==FxNodeKind::Effect;
        power_.setVisible(effect);
        power_.setToggleState(effect && node_->enabled,juce::dontSendNotification);
        remove_.setVisible(node_ && (effect || node_->isRouting()));
        resized();
        repaint();
    }
    void resized() override {
        auto area=contentBounds().reduced(12,6).withTrimmedTop(6);
        auto row=area.removeFromTop(26);
        power_.setBounds(row.removeFromLeft(42));
        remove_.setBounds(row.removeFromRight(30));
        area.removeFromTop(6);
        const auto layout=AudioCardLayout::forBody(area,int(knobs_.size()),48,28);
        for(std::size_t i=0;i<knobs_.size();++i) knobs_[i]->setBounds(layout.knob(int(i),int(knobs_.size())));
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(12,6).withTrimmedTop(6);
        if(!node_) {
            text(g,"NO NODE SELECTED",area.withTrimmedBottom(area.getHeight()/2),11.0f,Palette::secondary(),juce::Justification::centredBottom);
            text(g,"No module selected",area.withTrimmedTop(area.getHeight()/2+4),Type::secondary,Palette::muted(),juce::Justification::centredTop);
            return;
        }
        auto row=area.removeFromTop(26);
        const bool effect=node_->kind==FxNodeKind::Effect;
        text(g,node_->name,row.withTrimmedLeft(effect ? 52 : 0).withTrimmedRight(36),12.0f,Palette::text());
        text(g,kindLabel(node_->kind),row.withTrimmedRight(38),Type::secondary,Palette::muted(),juce::Justification::centredRight);
        area.removeFromTop(6);
        auto display=area.withHeight(60);
        if(effect) {
            const auto layout=AudioCardLayout::forBody(area,int(knobs_.size()),48,28);
            paintEffectPreview(g,layout.viewport.toFloat(),*node_,page_.responseSampleRate());
            auto labels=layout.labels;
            auto values=labels.removeFromBottom(14);
            const int width=labels.getWidth()/juce::jmax(1,int(params_.size()));
            for(const auto* p:params_) {
                text(g,p->label,labels.removeFromLeft(width),Type::label,Palette::muted(),juce::Justification::centred);
                text(g,valueText(*node_,*p),values.removeFromLeft(width),Type::label,Palette::secondary(),juce::Justification::centred);
            }
            return;
        }
        well(g,display);
        auto lines=display.reduced(10,6);
        const auto line=[&](const juce::String& s,juce::Colour c){text(g,s,lines.removeFromTop(16),Type::secondary,c);};
        // Socket names come from the model's port descriptors.
        const auto names=[&](nodes::PortDirection direction) {
            juce::StringArray list;
            for(const auto& port:fxNodePorts(*node_)) if(port.direction==direction) list.add(juce::String(port.name).toUpperCase());
            return list.isEmpty() ? juce::String("-") : list.joinIntoString("  ");
        };
        line("IN  "+names(nodes::PortDirection::Input)+"   /   OUT  "+names(nodes::PortDirection::Output),Palette::secondary());
        switch(node_->kind) {
        case FxNodeKind::Split: line("Copies one signal into parallel branches.",Palette::muted()); break;
        case FxNodeKind::Merge: line("Averages its live branches (1/N): parallel paths stay at unity.",Palette::muted()); break;
        case FxNodeKind::Source: line("Named audio bus entering its node graph.",Palette::muted()); break;
        case FxNodeKind::Output: line("Final instrument output, after GLOBAL FX.",Palette::muted()); break;
        case FxNodeKind::Effect: case FxNodeKind::Send: case FxNodeKind::Return: break;
        }
    }
    FxPage& page_;
    std::optional<FxNode> node_;
    FxNodeId shownId_=invalidFxNodeId;
    juce::TextButton power_{"PWR"},remove_{"X"};
    std::vector<std::unique_ptr<juce::Slider>> knobs_;
    std::vector<FxParameterId> ids_;
    std::vector<const FxParameterDescriptor*> params_;
};

// EQUALIZER band editor: analytic response, draggable band points (frequency
// x gain), band selection, add/remove (enable/disable stable band slots).
class FxEqEditor final : public juce::Component {
public:
    explicit FxEqEditor(FxPage& page):page_(page) {
        for(int b=0;b<8;++b) {
            auto& button=bands_[std::size_t(b)];
            button.setButtonText(juce::String(b+1));
            button.setName("FX EQ band "+juce::String(b+1));
            button.onClick=[this,b]{select(b);};
            addAndMakeVisible(button);
        }
        on_.setName("FX EQ on"); on_.setClickingTogglesState(true);
        on_.onClick=[this]{set(1,on_.getToggleState() ? 1.0f : 0.0f);};
        type_.setName("FX EQ type");
        type_.onClick=[this] {
            std::vector<NativeChoiceItem> items;
            const char* names[]{"LOW CUT","LOW SHELF","BELL","NOTCH","HIGH SHELF","HIGH CUT"};
            for(int i=0;i<6;++i) items.push_back({i+1,names[i],true,"BAND TYPE"});
            juce::Component::SafePointer<FxEqEditor> safe(this);
            showNativeChoiceMenu(type_,"BAND TYPE",items,0,[safe](int c){if(safe!=nullptr && c>0) safe->set(2,float(c-1)/5.0f);});
        };
        add_.setName("FX EQ add band");
        add_.onClick=[this] {
            for(int b=0;b<8;++b) if(value(b,1)<0.5f) { selected_=b; set(1,1.0f); return; }
        };
        remove_.setName("FX EQ remove band");
        remove_.onClick=[this]{set(1,0.0f);};
        for(auto* s:{&freq_,&gain_,&q_}) {
            s->setSliderStyle(juce::Slider::LinearHorizontal);
            s->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
            s->setRange(0.0,1.0,0.001);
            s->setScrollWheelEnabled(false);
            s->onDragStart=[this]{page_.beginParameterGesture();};
            s->onDragEnd=[this]{page_.endParameterGesture();};
            addAndMakeVisible(*s);
        }
        freq_.setName("FX EQ freq"); gain_.setName("FX EQ gain"); q_.setName("FX EQ q");
        freq_.onValueChange=[this]{set(3,float(freq_.getValue()));};
        gain_.onValueChange=[this]{set(4,float(gain_.getValue()));};
        q_.onValueChange=[this]{set(5,float(q_.getValue()));};
        for(auto* b:{&on_,&type_,&add_,&remove_}) addAndMakeVisible(*b);
    }
    int selectedBand() const noexcept { return selected_; }
    void select(int band) { selected_=juce::jlimit(0,7,band); sync(); }
    void setNode(const FxNode& node) { node_=node; sync(); }
    void paint(juce::Graphics& g) override {
        const auto area=curveArea();
        well(g,area.toNearestInt());
        auto in=area.reduced(8.0f,6.0f);
        g.setColour(Palette::borderSoft());
        for(const float db:{-12.0f,0.0f,12.0f}) g.drawHorizontalLine(juce::roundToInt(yFor(db,in)),in.getX(),in.getRight());
        for(const float hz:{100.0f,1000.0f,10000.0f}) g.drawVerticalLine(juce::roundToInt(xFor(hz,in)),in.getY(),in.getBottom());
        juce::Path path;
        for(int i=0;i<=200;++i) {
            const float hz=20.0f*std::pow(1000.0f,float(i)/200.0f);
            const juce::Point<float> p{xFor(hz,in),yFor(eqResponseDb(node_,hz),in)};
            if(i==0) path.startNewSubPath(p); else path.lineTo(p);
        }
        g.setColour(Palette::accent().withAlpha(.9f));
        g.strokePath(path,juce::PathStrokeType(1.5f));
        for(int b=0;b<8;++b) {
            if(value(b,1)<0.5f) continue;
            const auto c=point(b,in);
            const float r=b==selected_ ? 6.0f : 4.5f;
            g.setColour(Palette::inset());
            g.fillEllipse(juce::Rectangle<float>(r*2,r*2).withCentre(c));
            g.setColour(b==selected_ ? signalSourceColour() : Palette::accent());
            g.drawEllipse(juce::Rectangle<float>(r*2,r*2).withCentre(c),1.4f);
            text(g,juce::String(b+1),juce::Rectangle<float>(18,13).withCentre(c.translated(0,-13)).toNearestInt(),Type::secondary,Palette::muted(),juce::Justification::centred);
        }
        auto row=controlsArea();
        text(g,"FREQ "+juce::String(fxParameterText(*descriptor(selected_,3),value(selected_,3))),freq_.getBounds().translated(0,-14).withHeight(13),Type::secondary,Palette::muted());
        text(g,"GAIN "+juce::String(fxParameterText(*descriptor(selected_,4),value(selected_,4))),gain_.getBounds().translated(0,-14).withHeight(13),Type::secondary,Palette::muted());
        text(g,"Q "+juce::String(fxParameterText(*descriptor(selected_,5),value(selected_,5))),q_.getBounds().translated(0,-14).withHeight(13),Type::secondary,Palette::muted());
        (void)row;
    }
    void resized() override {
        auto area=getLocalBounds();
        area.removeFromTop(int(curveArea().getHeight())+6);
        auto buttons=area.removeFromTop(24);
        for(auto& b:bands_) b.setBounds(buttons.removeFromLeft(30).reduced(1,0));
        buttons.removeFromLeft(8);
        remove_.setBounds(buttons.removeFromRight(76).reduced(1,0));
        add_.setBounds(buttons.removeFromRight(100).reduced(1,0));
        area.removeFromTop(16);
        auto row=area.removeFromTop(24);
        on_.setBounds(row.removeFromLeft(48).reduced(1,0));
        type_.setBounds(row.removeFromLeft(110).reduced(2,0));
        row.removeFromLeft(8);
        const int w=row.getWidth()/3;
        freq_.setBounds(row.removeFromLeft(w).reduced(4,4));
        gain_.setBounds(row.removeFromLeft(w).reduced(4,4));
        q_.setBounds(row.reduced(4,4));
    }
    void mouseDown(const juce::MouseEvent& e) override {
        dragging_=-1;
        const auto in=curveArea().reduced(8.0f,6.0f);
        for(int b=0;b<8;++b)
            if(value(b,1)>=0.5f && e.position.getDistanceFrom(point(b,in))<12.0f) { dragging_=b; selected_=b; sync(); page_.beginParameterGesture(); return; }
    }
    void mouseDrag(const juce::MouseEvent& e) override {
        if(dragging_<0) return;
        const auto in=curveArea().reduced(8.0f,6.0f);
        const float t=juce::jlimit(0.0f,1.0f,(e.position.x-in.getX())/in.getWidth());
        const float db=juce::jlimit(-24.0f,24.0f,(in.getCentreY()-e.position.y)/(in.getHeight()*0.5f)*24.0f);
        page_.setParameter(page_.selectedNode(),id(dragging_,3),t);
        page_.setParameter(page_.selectedNode(),id(dragging_,4),(db+24.0f)/48.0f);
    }
    void mouseUp(const juce::MouseEvent&) override { if(dragging_>=0) page_.endParameterGesture(); dragging_=-1; }
private:
    static FxParameterId id(int band,int field) { return FxParameterId(100+band*10+field); }
    const FxParameterDescriptor* descriptor(int band,int field) const { return findFxParameter(*findFxEffect(FxEffectType::Equalizer),id(band,field)); }
    float value(int band,int field) const { return node_.parameter(id(band,field)).value_or(descriptor(band,field)->defaultValue); }
    void set(int field,float v) { if(!syncing_) page_.setParameter(page_.selectedNode(),id(selected_,field),v); }
    juce::Rectangle<float> curveArea() const { return getLocalBounds().toFloat().withHeight(78.0f); }
    juce::Rectangle<int> controlsArea() const { return getLocalBounds().withTrimmedTop(110); }
    static float xFor(float hz,juce::Rectangle<float> in) { return in.getX()+std::log(hz/20.0f)/std::log(1000.0f)*in.getWidth(); }
    static float yFor(float db,juce::Rectangle<float> in) { return in.getCentreY()-juce::jlimit(-24.0f,24.0f,db)/24.0f*in.getHeight()*0.5f; }
    juce::Point<float> point(int b,juce::Rectangle<float> in) const {
        return {xFor(fxParameterValue(*descriptor(b,3),value(b,3)),in),yFor(fxParameterValue(*descriptor(b,4),value(b,4)),in)};
    }
    void sync() {
        const juce::ScopedValueSetter<bool> guard(syncing_,true);
        for(int b=0;b<8;++b) {
            bands_[std::size_t(b)].setToggleState(b==selected_,juce::dontSendNotification);
            bands_[std::size_t(b)].setAlpha(value(b,1)>=0.5f ? 1.0f : 0.45f);
        }
        on_.setToggleState(value(selected_,1)>=0.5f,juce::dontSendNotification);
        on_.setButtonText(value(selected_,1)>=0.5f ? "ON" : "OFF");
        type_.setButtonText(juce::String(fxParameterText(*descriptor(selected_,2),value(selected_,2))));
        if(!freq_.isMouseButtonDown()) freq_.setValue(value(selected_,3),juce::dontSendNotification);
        if(!gain_.isMouseButtonDown()) gain_.setValue(value(selected_,4),juce::dontSendNotification);
        if(!q_.isMouseButtonDown()) q_.setValue(value(selected_,5),juce::dontSendNotification);
        bool anyOff=false;
        for(int b=0;b<8;++b) anyOff|=value(b,1)<0.5f;
        add_.setEnabled(anyOff);
        repaint();
    }
    FxPage& page_;
    FxNode node_;
    int selected_=2,dragging_=-1;
    bool syncing_=false;
    std::array<juce::TextButton,8> bands_;
    juce::TextButton on_{"ON"},type_{"BELL"},add_{"+ ADD BAND"},remove_{"REMOVE"};
    juce::Slider freq_,gain_,q_;
};

class FxPage::ParametersPanel final : public InspectorSection {
public:
    static constexpr int rowHeight=32;
    explicit ParametersPanel(FxPage& page,ModulationBindings bindings):page_(page),bindings_(std::move(bindings)) {
        const char* names[]{"MAIN","MODULATION","ADVANCED"};
        for(int i=0;i<3;++i) {
            auto& tab=tabs_[std::size_t(i)];
            tab.setButtonText(names[i]);
            tab.setClickingTogglesState(true);
            tab.setRadioGroupId(0x4658);
            tab.setToggleState(i==0,juce::dontSendNotification);
            tab.onClick=[this,i]{if(tabs_[std::size_t(i)].getToggleState()) selectTab(i);};
            addAndMakeVisible(tab);
        }
        viewport_.setViewedComponent(&rows_,false);
        viewport_.setScrollBarsShown(true,false);
        viewport_.setScrollBarThickness(8);
        addAndMakeVisible(viewport_);
    }
    ~ParametersPanel() override { viewport_.setViewedComponent(nullptr,false); }
    int tab() const noexcept { return tab_; }
    std::size_t modulationRows() const noexcept { return rows_.modulation.size(); }
    void selectTab(int index) {
        tab_=juce::jlimit(0,2,index);
        for(int i=0;i<3;++i) tabs_[std::size_t(i)].setToggleState(i==tab_,juce::dontSendNotification);
        show(page_.graph(),page_.selectedNode(),routes_);
    }
    void show(const FxGraph& graph,FxNodeId id,const std::array<ModRoute,ModulationState::capacity>& routes) {
        routes_=routes;
        const auto* node=graph.findNode(id);
        if(node!=nullptr) node_=*node; else node_.reset();
        // MODULATION rows: canonical routes whose destination is this node.
        std::vector<ModRoute> targeting;
        if(node_ && node_->kind==FxNodeKind::Effect)
            for(const auto& r:routes)
                if(r.id && isFxDestination(r.destination.parameter) && r.destination.oscillator==node_->id
                   && fxAddressBus(r.destination)==page_.selectedBus()) targeting.push_back(r);
        std::vector<std::uint64_t> signature;
        for(const auto& r:targeting) signature.push_back((std::uint64_t(r.id)<<32)|(std::uint64_t(r.source)<<16)|fxAddressParameter(r.destination));
        std::vector<FxParameterId> visible;
        if(node_) for(const auto* p:parametersFor(*node_,false,tab_==2 ? FxParameterPage::Advanced : FxParameterPage::Main)) visible.push_back(p->id);
        if(shownId_!=id || shownTab_!=tab_ || (node_ && node_->effect!=shownEffect_) || (tab_==1 && signature!=modulationSignature_)
           || visible!=visibleIds_) {
            visibleIds_=visible;
            shownId_=id;
            shownTab_=tab_;
            shownEffect_=node_ ? node_->effect : FxEffectType::None;
            modulationSignature_=signature;
            rebuild(targeting);
        }
        for(auto& e:rows_.entries) {
            const float v=node_->parameter(e.descriptor->id).value_or(e.descriptor->defaultValue);
            if(e.slider && !e.slider->isMouseButtonDown()) e.slider->setValue(v,juce::dontSendNotification);
            if(e.toggle && e.descriptor->choices>2) e.toggle->setButtonText(juce::String(fxParameterText(*e.descriptor,v)));
            else if(e.toggle) { e.toggle->setToggleState(v>=0.5f,juce::dontSendNotification); e.toggle->setButtonText(juce::String(fxParameterText(*e.descriptor,v))); }
        }
        for(auto& m:rows_.modulation)
            for(const auto& r:targeting)
                if(r.id==m.route.id) { m.route=r; if(!m.amount->isMouseButtonDown()) m.amount->setValue(r.amount,juce::dontSendNotification); }
        if(eq_!=nullptr && node_) eq_->setNode(*node_);
        rows_.node=node_;
        rows_.tab=tab_;
        resized();
        rows_.repaint();
    }
    void resized() override {
        auto area=contentBounds().reduced(12,6).withTrimmedTop(6);
        auto tabs=area.removeFromTop(28);
        for(auto& tab:tabs_) tab.setBounds(tabs.removeFromLeft(124).reduced(2,0));
        area.removeFromTop(8);
        viewport_.setBounds(area);
        const int width=area.getWidth()-10;
        const int lines=tab_==1 ? int(rows_.modulation.size())+2 : int(rows_.entries.size());
        rows_.setSize(width,juce::jmax(area.getHeight(),eq_!=nullptr ? 156 : lines*rowHeight+4));
        if(eq_!=nullptr) eq_->setBounds(0,0,width,156);
        for(std::size_t i=0;i<rows_.entries.size();++i) {
            auto row=juce::Rectangle<int>(0,int(i)*rowHeight,width,rowHeight).withTrimmedLeft(120).withTrimmedRight(96).reduced(0,6);
            if(rows_.entries[i].slider) rows_.entries[i].slider->setBounds(row);
            if(rows_.entries[i].toggle) rows_.entries[i].toggle->setBounds(row.withWidth(rows_.entries[i].descriptor->choices>2 ? 140 : 80));
        }
        for(std::size_t i=0;i<rows_.modulation.size();++i) {
            auto row=juce::Rectangle<int>(0,rowHeight+int(i)*rowHeight,width,rowHeight).reduced(0,4);
            auto& m=rows_.modulation[i];
            m.remove->setBounds(row.removeFromRight(30));
            row.removeFromRight(6);
            row.removeFromRight(56); // painted amount value
            row.removeFromLeft(130);
            m.source->setBounds(row.removeFromLeft(118));
            row.removeFromLeft(8);
            m.amount->setBounds(row.reduced(0,3));
        }
    }
private:
    struct Entry {
        const FxParameterDescriptor* descriptor=nullptr;
        std::unique_ptr<juce::Slider> slider;
        std::unique_ptr<juce::TextButton> toggle;
    };
    struct ModRow {
        ModRoute route;
        std::unique_ptr<juce::Slider> amount;
        std::unique_ptr<juce::TextButton> source,remove;
    };
    struct Rows final : public juce::Component {
        std::vector<Entry> entries;
        std::vector<ModRow> modulation;
        std::optional<FxNode> node;
        int tab=0;
        void paint(juce::Graphics& g) override {
            auto area=getLocalBounds();
            if(!node || node->kind!=FxNodeKind::Effect) {
                text(g,node ? "No parameters" : "No module selected",
                     area.removeFromTop(26),Type::label,Palette::muted());
                return;
            }
            if(tab==1) {
                text(g,modulation.empty() ? "No modulation. Drag a modulator onto any knob, or right-click a knob > Assign Modulator."
                                          : "Routes from Origami's modulation system targeting this effect:",
                     area.removeFromTop(rowHeight),Type::secondary,Palette::muted());
                for(const auto& m:modulation) {
                    auto row=area.removeFromTop(rowHeight);
                    juce::String param="PARAM";
                    if(const auto* p=parameterDescriptor(*node,fxAddressParameter(m.route.destination))) param=p->label;
                    text(g,juce::String(node->name)+" / "+param,row.removeFromLeft(130),Type::label,Palette::secondary());
                    row.removeFromRight(36); // remove button
                    text(g,(m.route.amount>=0.0f?"+":"")+juce::String(m.route.amount,2),row.removeFromRight(52),Type::label,
                         Palette::secondary(),juce::Justification::centredRight);
                }
                return;
            }
            if(node->effect==FxEffectType::Equalizer && tab==0) return; // band editor paints itself
            if(entries.empty()) { text(g,"No advanced parameters for this effect.",area.removeFromTop(26),Type::label,Palette::muted()); return; }
            for(const auto& e:entries) {
                auto line=area.removeFromTop(rowHeight);
                text(g,e.descriptor->label,line.removeFromLeft(114),10.0f,Palette::secondary());
                text(g,valueText(*node,*e.descriptor),line.removeFromRight(92),10.0f,Palette::muted(),juce::Justification::centredRight);
            }
        }
    };
    void rebuild(const std::vector<ModRoute>& targeting) {
        rows_.entries.clear();
        rows_.modulation.clear();
        eq_.reset();
        if(!node_ || node_->kind!=FxNodeKind::Effect) return;
        const auto nodeId=node_->id;
        if(node_->effect==FxEffectType::Equalizer && tab_==0) {
            // Band editor instead of 40 generic rows; same canonical parameters.
            eq_=std::make_unique<FxEqEditor>(page_);
            rows_.addAndMakeVisible(*eq_);
            eq_->setNode(*node_);
            return;
        }
        if(tab_==1) {
            for(const auto& route:targeting) {
                ModRow row{route,std::make_unique<juce::Slider>(),std::make_unique<juce::TextButton>(routeSourceLabel(page_.controlState(),route.source)),
                           std::make_unique<juce::TextButton>("X")};
                auto* amount=row.amount.get();
                amount->setSliderStyle(juce::Slider::LinearHorizontal);
                amount->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
                amount->setRange(-1.0,1.0,0.001);
                amount->setName("FX modulation amount "+juce::String(route.id));
                const auto routeId=route.id;
                amount->onValueChange=[this,amount,routeId]{updateRoute(routeId,[amount](ModRoute& r){r.amount=float(amount->getValue());});};
                row.source->setName("FX modulation source "+juce::String(route.id));
                auto* sourceButton=row.source.get();
                row.source->onClick=[this,sourceButton,routeId]{chooseSource(*sourceButton,routeId);};
                row.remove->setName("FX modulation remove "+juce::String(route.id));
                row.remove->onClick=[this,routeId] {
                    juce::Component::SafePointer<FxPage> page(&page_);
                    auto remove=bindings_.removeRoute;
                    juce::MessageManager::callAsync([page,remove,routeId]{if(remove) remove(routeId); if(page!=nullptr) page->syncFromModel();});
                };
                for(juce::Component* c:{static_cast<juce::Component*>(row.amount.get()),static_cast<juce::Component*>(row.source.get()),
                                        static_cast<juce::Component*>(row.remove.get())}) rows_.addAndMakeVisible(c);
                rows_.modulation.push_back(std::move(row));
            }
            return;
        }
        for(const auto* p:parametersFor(*node_,false,tab_==0 ? FxParameterPage::Main : FxParameterPage::Advanced)) {
            Entry entry;
            entry.descriptor=p;
            const auto pid=p->id;
            if(p->curve==FxParameterCurve::Choice && p->choices>2) {
                // Variant selector (FILTER TYPE, PHASER STAGES, ...): native menu.
                entry.toggle=std::make_unique<juce::TextButton>(p->label);
                entry.toggle->setName("FX parameter "+juce::String(p->key));
                auto* raw=entry.toggle.get();
                const auto* descriptor=p;
                raw->onClick=[this,raw,pid,nodeId,descriptor] {
                    std::vector<NativeChoiceItem> items;
                    for(int c=0;c<descriptor->choices;++c)
                        items.push_back({c+1,descriptor->choiceLabels ? juce::String(descriptor->choiceLabels[c]) : juce::String(c),true,descriptor->label});
                    juce::Component::SafePointer<ParametersPanel> safe(this);
                    showNativeChoiceMenu(*raw,descriptor->label,items,0,[safe,pid,nodeId,descriptor](int choice) {
                        if(safe!=nullptr && choice>0) safe->page_.setParameter(nodeId,pid,fxChoiceNormalized(*descriptor,choice-1));
                    });
                };
                rows_.addAndMakeVisible(*raw);
            } else if(p->curve==FxParameterCurve::Choice) {
                entry.toggle=std::make_unique<juce::TextButton>("OFF");
                entry.toggle->setClickingTogglesState(true);
                entry.toggle->setName("FX parameter "+juce::String(p->key));
                auto* raw=entry.toggle.get();
                raw->onClick=[this,raw,pid,nodeId]{page_.setParameter(nodeId,pid,raw->getToggleState() ? 1.0f : 0.0f);};
                rows_.addAndMakeVisible(*raw);
            } else {
                entry.slider=std::make_unique<FxFeedbackSlider>(page_);
                auto* raw=entry.slider.get();
                raw->setSliderStyle(juce::Slider::LinearHorizontal);
                raw->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
                raw->setRange(0.0,1.0,0.001);
                raw->setScrollWheelEnabled(false);
                raw->setName("FX parameter "+juce::String(p->key));
                tagModulationDestination(*raw,page_.selectedBus(),nodeId,*p);
                raw->onDragStart=[this]{page_.beginParameterGesture();};
                raw->onDragEnd=[this]{page_.endParameterGesture();};
                raw->onValueChange=[this,raw,pid,nodeId]{page_.setParameter(nodeId,pid,float(raw->getValue()));};
                rows_.addAndMakeVisible(*raw);
            }
            rows_.entries.push_back(std::move(entry));
        }
    }
    void updateRoute(std::uint32_t id,const std::function<void(ModRoute&)>& change) {
        for(auto& m:rows_.modulation) {
            if(m.route.id!=id) continue;
            change(m.route);
            if(bindings_.route) bindings_.route(m.route);
            rows_.repaint();
        }
    }
    void chooseSource(juce::TextButton& anchor,std::uint32_t id) {
        if(!bindings_.snapshot) return;
        const auto state=bindings_.snapshot();
        std::vector<NativeChoiceItem> items;
        for(const auto& s:availableSources(state.modulation)) items.push_back({int(s.source),sourceName(state.modulation,s.source),true,s.group});
        juce::Component::SafePointer<ParametersPanel> safe(this);
        showNativeChoiceMenu(anchor,"SOURCE",items,0,[safe,id](int choice) {
            if(safe==nullptr || choice<=0) return;
            const auto source=static_cast<ModSource>(choice);
            for(const auto& r:safe->routes_)
                for(auto& m:safe->rows_.modulation)
                    if(m.route.id==id && r.id && r.id!=id && r.source==source && r.destination==m.route.destination) return; // no duplicates
            safe->updateRoute(id,[source](ModRoute& r){r.source=source;r.bipolar=source>=ModSource::Lfo1 && source<=ModSource::Lfo4;});
            safe->page_.syncFromModel();
        });
    }
    FxPage& page_;
    ModulationBindings bindings_;
    std::optional<FxNode> node_;
    std::array<ModRoute,ModulationState::capacity> routes_{};
    std::array<juce::TextButton,3> tabs_;
    juce::Viewport viewport_;
    Rows rows_;
    int tab_=0,shownTab_=-1;
    FxNodeId shownId_=0xffffffffu;
    FxEffectType shownEffect_=FxEffectType::None;
    std::vector<std::uint64_t> modulationSignature_;
    std::vector<FxParameterId> visibleIds_;
    std::unique_ptr<FxEqEditor> eq_;
};

// mct-origami-nodes-n03-control
// MODULE PARAMETERS for the CONTROL layer. Source: identity + execution
// domain. Parameter: destination + domain (+ base value of a NODES parameter).
// Link: ENABLED / POLARITY / AMOUNT of the canonical route (the same values
// the Matrix row and the SYNTH ring edit) and its live contribution monitor.
namespace {
// N06 sequence step: a bipolar bar from the centre line (value -1..1), drag
// vertically to edit. Same Slider semantics (gestures, value) as every control.
class SequenceStepSlider final : public juce::Slider {
public:
    SequenceStepSlider() { setSliderStyle(juce::Slider::LinearBarVertical); setTextBoxStyle(juce::Slider::NoTextBox,false,0,0); }
    void paint(juce::Graphics& g) override {
        const auto b=getLocalBounds().toFloat();
        g.setColour(Palette::inset()); g.fillRect(b);
        g.setColour(Palette::borderSoft()); g.drawRect(b,1.0f);
        const float mid=b.getCentreY(),v=float(juce::jlimit(-1.0,1.0,getValue()));
        const float h=(b.getHeight()*0.5f-2.0f)*std::abs(v);
        g.setColour(Palette::text().withAlpha(isMouseOverOrDragging() ? 0.95f : 0.75f));
        g.fillRect(juce::Rectangle<float>(b.getX()+3.0f,v>=0.0f ? mid-h : mid,b.getWidth()-6.0f,std::max(1.0f,h)));
        g.setColour(Palette::muted().withAlpha(0.5f)); g.drawHorizontalLine(int(mid),b.getX()+2.0f,b.getRight()-2.0f);
    }
};
}

class FxPage::ControlInspector final : public juce::Component {
public:
    explicit ControlInspector(FxPage& page):page_(page) {
        enabled_.setName("CONTROL LINK ENABLED");
        enabled_.setClickingTogglesState(true);
        polarity_.setName("CONTROL LINK POLARITY");
        polarity_.setClickingTogglesState(true);
        amount_.setName("CONTROL LINK AMOUNT");
        amount_.setSliderStyle(juce::Slider::LinearHorizontal);
        amount_.setTextBoxStyle(juce::Slider::TextBoxRight,false,70,20);
        amount_.setRange(-100.0,100.0,0.1);
        amount_.setTextValueSuffix(" %");
        remove_.setName("CONTROL LINK DELETE");
        for(auto* c:std::initializer_list<juce::Component*>{&enabled_,&polarity_,&amount_,&remove_,&monitor_}) addChildComponent(c);
        enabled_.onClick=[this]{ edit([this](ModRoute& r){ r.enabled=enabled_.getToggleState(); }); };
        polarity_.onClick=[this]{ edit([this](ModRoute& r){ r.bipolar=polarity_.getToggleState(); }); };
        amount_.onValueChange=[this]{ edit([this](ModRoute& r){ r.amount=float(amount_.getValue()/100.0); }); };
        remove_.onClick=[this]{ if(route_.id) page_.deleteControlLink(route_.id); };
        disconnect_.setName("CONTROL EDGE DISCONNECT");
        disconnect_.onClick=[this]{ if(selection_.kind==ControlSelection::Kind::Edge) page_.disconnectControlInput(selection_.op,selection_.input); };
        addChildComponent(disconnect_);
    }
    void show(const ControlSelection& selection,const InstrumentState& state) {
        selection_=selection;
        lines_.clear();
        inputs_.clear();
        modulation_=state.modulation;
        const bool operatorNode=selection.kind==ControlSelection::Kind::Node && selection.key.kind==nodes::ControlNodeKind::Operator;
        const bool edge=selection.kind==ControlSelection::Kind::Edge;
        disconnect_.setVisible(edge);
        if(operatorNode) { showOperator(selection.key.op,state); return; }
        clearParameters();
        if(edge) {
            const auto* op=findControlOperator(state.modulation,selection.op);
            kind_="CONTROL CONNECTION";
            if(op!=nullptr) {
                const auto& in=op->inputs[selection.input];
                // N07: named ports on both ends (TRIG, RESET, WRAP...), never A / B guesses.
                const auto from=in.kind==ControlInput::Kind::Source ? page_.controlNodeTitle(nodes::sourceKey(in.source))
                                                                    : routeSourceLabel(state.modulation,operatorSource(in.op,in.port)).fromFirstOccurrenceOf("NODES: ",false,false);
                const auto* info=controlOpInfo(op->type);
                title_=from+"  >  "+page_.controlNodeTitle(nodes::operatorKey(op->id))+" "
                      +(info!=nullptr ? juce::String(controlInputName(*info,selection.input)) : juce::String("IN"));
                lines_.add("A processing connection: it feeds an operator input (one connection per input).");
            }
            for(auto* c:std::initializer_list<juce::Component*>{&enabled_,&polarity_,&amount_,&remove_,&monitor_}) c->setVisible(false);
            resized(); repaint();
            return;
        }
        const bool link=selection.kind==ControlSelection::Kind::Link;
        route_={};
        if(link) for(const auto& r:state.modulation.routes) if(r.id==selection.route) route_=r;
        if(link && route_.id) {
            juce::String fromTitle=page_.controlNodeTitle(nodes::sourceKey(route_.source));
            if(isOperatorSource(route_.source)) {
                // A processed route: the node (and, for multi-output nodes, the output) that drives it.
                fromTitle=page_.controlNodeTitle(nodes::operatorKey(operatorIdOf(route_.source)));
                if(const auto* op=findControlOperator(state.modulation,operatorIdOf(route_.source)))
                    if(const auto* info=controlOpInfo(op->type); info!=nullptr && info->outputCount>1)
                        fromTitle+=" "+juce::String(controlOutputName(*info,operatorPortOf(route_.source)));
            }
            title_=fromTitle+juce::String("  >  ")+page_.controlNodeDetail(nodes::parameterKey(route_.destination));
            kind_="MODULATION ROUTE";
            const auto from=nodes::sourceDomain(route_.source,state.modulation),to=nodes::destinationDomain(route_.destination);
            lines_.add(juce::String(nodes::toString(from))+" source  >  "+nodes::toString(to)+" parameter"
                       +(from==nodes::NodeExecutionDomain::Global && to==nodes::NodeExecutionDomain::Voice ? "  (same value for every voice)" : ""));
            if(!nodes::domainCrossingSupported(from,to))
                lines_.add("Created outside NODES: a per-voice source driving a global parameter is not modelled by NODES.");
            lines_.add("Shared with the Matrix row and the SYNTH ring: edits apply everywhere.");
            enabled_.setToggleState(route_.enabled,juce::dontSendNotification);
            enabled_.setButtonText(route_.enabled ? "ON" : "OFF");
            polarity_.setToggleState(route_.bipolar,juce::dontSendNotification);
            polarity_.setButtonText(route_.bipolar ? "BIPOLAR" : "UNIPOLAR");
            if(!amount_.isMouseButtonDown()) amount_.setValue(route_.amount*100.0,juce::dontSendNotification);
        } else if(selection.kind==ControlSelection::Kind::Node) {
            const auto& key=selection.key;
            title_=page_.controlNodeTitle(key);
            int links=0;
            for(const auto& r:state.modulation.routes)
                if(r.id && routeComplete(r) && (key.kind==nodes::ControlNodeKind::Source ? r.source==key.source : r.destination==key.destination)) ++links;
            if(key.kind==nodes::ControlNodeKind::Source) {
                kind_="CONTROL SOURCE";
                const auto domain=nodes::sourceDomain(key.source,state.modulation);
                lines_.add(juce::String(nodes::toString(domain))+(domain==nodes::NodeExecutionDomain::Global ? "  -  one value for the whole instrument" : "  -  one value per voice"));
                lines_.add("A view of the instrument's own source: edit its shape on SYNTH > MODULATORS.");
                lines_.add("Drives "+juce::String(links)+" parameter"+(links==1 ? "" : "s")+".  Drag its diamond onto a PARAMETER to connect.");
            } else {
                kind_="PARAMETER";
                title_=page_.controlNodeDetail(key);
                const auto domain=nodes::destinationDomain(key.destination);
                lines_.add(juce::String(nodes::toString(domain))+(domain==nodes::NodeExecutionDomain::Global ? "  -  consumed once per block" : "  -  consumed per voice"));
                if(isFxDestination(key.destination.parameter)) {
                    if(const auto* doc=page_.workspace().find(fxAddressBus(key.destination)))
                        if(const auto* node=doc->graph().findNode(key.destination.oscillator))
                            if(const auto* d=findFxEffect(node->effect))
                                if(const auto* p=findFxParameter(*d,fxAddressParameter(key.destination)))
                                    lines_.add("Base value: "+juce::String(fxParameterText(*p,node->parameter(p->id).value_or(p->defaultValue))));
                } else lines_.add("Base value: set on its own control; modulation is added to it.");
                lines_.add("Driven by "+juce::String(links)+" source"+(links==1 ? "" : "s")+".");
            }
        }
        for(auto* c:std::initializer_list<juce::Component*>{&enabled_,&polarity_,&amount_,&remove_,&monitor_}) c->setVisible(link && route_.id);
        if(!link || !route_.id) monitor_.clear();
        resized();
        repaint();
    }
    void sample(const ModulationState& modulation,const ModulationSourceSlots& slots,
                const std::array<std::uint32_t,ModulationState::maxControlOperators>& events={}) {
        if(op_!=0) {
            // Operator monitor: input value(s) and output value, from the
            // engine's bounded slot snapshot (no audio-thread access).
            const auto slot=controlOperatorSlot(modulation,op_);
            if(slot>=ModulationState::maxControlOperators) return;
            const float out=slots[CompiledModulation::sourceSlotCount+operatorOutputIndex(slot,0)];
            juce::String values;
            const auto& op=modulation.operators[slot];
            const auto* info=controlOpInfo(op.type);
            // CONTROL: value. GATE: OPEN / CLOSED. EVENT: running count.
            const auto show=[&](ControlSignal signal,float v,std::size_t eventSlot) {
                if(signal==ControlSignal::Gate) return juce::String(v>=0.5f ? "OPEN" : "CLOSED");
                if(signal==ControlSignal::Event) return "x"+juce::String(eventSlot<events.size() ? events[eventSlot] : 0u);
                return juce::String(v,3);
            };
            for(std::size_t k=0;k<inputs_.size();++k) {
                const auto& in=op.inputs[k];
                if(in.kind==ControlInput::Kind::None) { values+=inputs_[k]+" -    "; continue; }
                const auto source=in.kind==ControlInput::Kind::Source ? in.source : operatorSource(in.op,in.port);
                const float v=slots[modulationSourceSlot(source,modulation)];
                values+=inputs_[k]+" "+show(info ? info->inputSignals[k] : ControlSignal::Control,v,
                                            in.kind==ControlInput::Kind::Operator ? controlOperatorSlot(modulation,in.op) : events.size())+"    ";
            }
            if(info!=nullptr && info->outputCount>1) {
                for(std::size_t p=0;p<info->outputCount;++p)
                    values+=juce::String(controlOutputName(*info,p))+" "
                           +show(controlOutputSignalOf(*info,p),slots[CompiledModulation::sourceSlotCount+operatorOutputIndex(slot,p)],slot)+"    ";
            } else if(info!=nullptr && info->output!=ControlSignal::None) values+="OUT "+show(info->output,out,slot);
            if(values!=liveValues_) { liveValues_=values; repaint(); }
            monitor_.push(juce::jlimit(-1.0f,1.0f,out),true);
            return;
        }
        if(!route_.id) return;
        monitor_.push(routeContribution(route_,modulation,slots),route_.enabled && routeComplete(route_));
    }
    juce::Slider* operatorParameter(std::size_t index) noexcept { return index<params_.size() ? params_[index].get() : nullptr; }
    // N06: SEQUENCER inspector controls (0-7 steps, 8 STEPS, 9 RATE, 10 DIRECTION, 11 LOOP).
    juce::Slider* sequenceControl(std::size_t index) noexcept { return index<sequence_.size() ? sequence_[index].get() : nullptr; }
    juce::TextButton& enabledButton() noexcept { return enabled_; }
    juce::TextButton& polarityButton() noexcept { return polarity_; }
    juce::Slider& amountSlider() noexcept { return amount_; }
    juce::String title() const { return title_; }
    void resized() override {
        auto area=getLocalBounds().reduced(12,8);
        area.removeFromTop(48+16*lines_.size());
        if(op_!=0) {
            // Output monitor top-right, beside the identity lines (never clipped).
            monitor_.setBounds(getLocalBounds().reduced(12,8).removeFromRight(280).withTrimmedTop(18).withHeight(30));
            area.removeFromTop(18); // live values line
            auto grid=area.removeFromTop(int((params_.size()+1)/2)*30);
            const int column=grid.getWidth()/2;
            for(std::size_t i=0;i<params_.size();++i) {
                auto cell=juce::Rectangle<int>(grid.getX()+int(i%2)*column,grid.getY()+int(i/2)*30,column-12,26);
                params_[i]->setBounds(cell.withTrimmedLeft(84));
            }
            if(!sequence_.empty()) {
                // Step bars on the left, sequence settings (2 x 2) on the right.
                auto editor=area.removeFromTop(54);
                auto bars=editor.removeFromLeft(juce::jmin(editor.getWidth()/2,8*34));
                const int w=bars.getWidth()/8;
                for(std::size_t i=0;i<8;++i) sequence_[i]->setBounds(bars.getX()+int(i)*w+2,bars.getY()+12,w-4,bars.getHeight()-12);
                editor.removeFromLeft(16);
                const int half=editor.getWidth()/2;
                for(std::size_t i=0;i<4;++i)
                    sequence_[8+i]->setBounds(juce::Rectangle<int>(editor.getX()+int(i%2)*half,editor.getY()+4+int(i/2)*26,half-8,22).withTrimmedLeft(66));
            }
            return;
        }
        disconnect_.setBounds(area.removeFromTop(26).withWidth(110));
        area=getLocalBounds().reduced(12,8).withTrimmedTop(48+16*lines_.size());
        auto row=area.removeFromTop(26);
        enabled_.setBounds(row.removeFromLeft(56)); row.removeFromLeft(8);
        polarity_.setBounds(row.removeFromLeft(100)); row.removeFromLeft(8);
        remove_.setBounds(row.removeFromRight(70)); row.removeFromRight(8);
        amount_.setBounds(row);
        area.removeFromTop(8);
        monitor_.setBounds(area.removeFromTop(30).withWidth(juce::jmin(360,area.getWidth())));
    }
    void paint(juce::Graphics& g) override {
        auto area=getLocalBounds().reduced(12,8);
        text(g,kind_,area.removeFromTop(16),Type::secondary,Palette::muted());
        text(g,title_,area.removeFromTop(24),12.0f,Palette::text());
        area.removeFromTop(8);
        for(const auto& line:lines_) text(g,line,area.removeFromTop(16),Type::label,Palette::secondary());
        if(op_!=0) {
            text(g,liveValues_,area.removeFromTop(18),Type::label,Palette::text());
            for(std::size_t i=0;i<params_.size();++i)
                text(g,paramLabels_[i],params_[i]->getBounds().withX(params_[i]->getX()-84).withWidth(80),Type::secondary,Palette::muted());
            if(!sequence_.empty()) {
                text(g,"SEQUENCE",sequence_[0]->getBounds().withY(sequence_[0]->getY()-14).withHeight(13).withWidth(120),Type::secondary,Palette::muted());
                for(std::size_t i=8;i<sequence_.size();++i)
                    text(g,sequenceLabels_[int(i)],sequence_[i]->getBounds().withX(sequence_[i]->getX()-66).withWidth(62),Type::secondary,Palette::muted());
            }
        }
    }
private:
    template<typename Fn> void edit(Fn&& fn) {
        if(!route_.id) return;
        auto updated=route_;
        fn(updated);
        if(page_.updateControlLink(updated)) route_=updated;
        enabled_.setButtonText(route_.enabled ? "ON" : "OFF");
        polarity_.setButtonText(route_.bipolar ? "BIPOLAR" : "UNIPOLAR");
    }
    void clearParameters() {
        for(auto& p:params_) removeChildComponent(p.get());
        params_.clear(); paramLabels_.clear();
        op_=0; opType_=ControlOpType::None; liveValues_.clear();
        clearSequenceEditor();
    }
    // ---- N06 sequence editor: 8 step values + STEPS / RATE / DIRECTION / LOOP.
    void clearSequenceEditor() {
        for(auto& s:sequence_) removeChildComponent(s.get());
        sequence_.clear(); sequenceLabels_.clear();
    }
    void buildSequenceEditor(const SequencerSettings& settings) {
        if(sequence_.empty()) {
            const auto add=[this](juce::String label,double lo,double hi,double step,bool vertical,std::function<void(SequencerSettings&,double)> apply) {
                std::unique_ptr<juce::Slider> slider;
                if(vertical) slider=std::make_unique<SequenceStepSlider>(); else slider=std::make_unique<juce::Slider>();
                slider->setName("SEQUENCER "+label);
                slider->setSliderStyle(vertical ? juce::Slider::LinearBarVertical : juce::Slider::LinearHorizontal);
                slider->setTextBoxStyle(vertical ? juce::Slider::NoTextBox : juce::Slider::TextBoxRight,false,vertical ? 0 : 72,18);
                slider->setRange(lo,hi,step);
                auto* raw=slider.get();
                slider->onDragStart=[this]{ page_.beginOperatorGesture(); };
                slider->onDragEnd=[this]{ page_.endOperatorGesture(); };
                slider->onValueChange=[this,raw,apply]{
                    if(syncing_) return;
                    auto next=page_.sequencerSettings();
                    apply(next,raw->getValue());
                    page_.setSequencerSettings(next);
                };
                addAndMakeVisible(*slider);
                sequence_.push_back(std::move(slider));
                sequenceLabels_.add(label);
            };
            for(std::size_t i=0;i<8;++i)
                add("STEP "+juce::String(int(i)+1),-1.0,1.0,0.0,true,[i](SequencerSettings& s,double v){ s.steps[i]=float(v); });
            add("STEPS",1.0,8.0,1.0,false,[](SequencerSettings& s,double v){ s.activeSteps=std::uint32_t(juce::roundToInt(v)); });
            add("RATE",0.01,40.0,0.0,false,[](SequencerSettings& s,double v){ s.rateHz=float(v); });
            add("DIRECTION",1.0,3.0,1.0,false,[](SequencerSettings& s,double v){ s.direction=static_cast<SequenceDirection>(juce::roundToInt(v)); });
            add("LOOP",0.0,1.0,1.0,false,[](SequencerSettings& s,double v){ s.loop=v>=0.5; });
            sequence_[8]->setNumDecimalPlacesToDisplay(0);
            sequence_[9]->setSkewFactorFromMidPoint(4.0);
            sequence_[9]->setTextValueSuffix(" Hz");
            sequence_[9]->setNumDecimalPlacesToDisplay(2);
            sequence_[10]->textFromValueFunction=[](double v){ const char* n[]{"FORWARD","REVERSE","PING-PONG"}; return juce::String(n[juce::jlimit(0,2,juce::roundToInt(v)-1)]); };
            sequence_[11]->textFromValueFunction=[](double v){ return v>=0.5 ? juce::String("LOOP") : juce::String("ONE-SHOT"); };
        }
        syncing_=true;
        for(std::size_t i=0;i<8;++i) if(!sequence_[i]->isMouseButtonDown()) sequence_[i]->setValue(settings.steps[i],juce::dontSendNotification);
        const double values[]{double(settings.activeSteps),double(settings.rateHz),double(static_cast<int>(settings.direction)),settings.loop ? 1.0 : 0.0};
        for(std::size_t i=0;i<4;++i) if(!sequence_[8+i]->isMouseButtonDown()) { sequence_[8+i]->setValue(values[i],juce::dontSendNotification); sequence_[8+i]->updateText(); }
        for(std::size_t i=0;i<8;++i) sequence_[i]->setAlpha(i<settings.activeSteps ? 1.0f : 0.4f);
        syncing_=false;
    }
    void showOperator(std::uint32_t id,const InstrumentState& state) {
        const auto* op=findControlOperator(state.modulation,id);
        const auto* info=op ? controlOpInfo(op->type) : nullptr;
        route_={};
        for(auto* c:std::initializer_list<juce::Component*>{&enabled_,&polarity_,&amount_,&remove_}) c->setVisible(false);
        if(info==nullptr) { clearParameters(); monitor_.setVisible(false); repaint(); return; }
        kind_="OPERATOR";
        title_=juce::String(info->label);
        const bool voice=sourceIsVoice(operatorSource(id),state.modulation);
        const bool bipolar=sourceRange(operatorSource(id),state.modulation)==ControlRange::Bipolar;
        const juce::String output=info->output==ControlSignal::Gate ? "GATE (0 / 1)" : info->output==ControlSignal::Event ? "EVENT (one sample)"
                                : info->output==ControlSignal::None ? "acts on the voice" : (bipolar ? "BIPOLAR (-1..1)" : "UNIPOLAR (0..1)");
        lines_.add(juce::String(info->category).toUpperCase()+"  -  "+(voice ? "VOICE: evaluated per voice" : "GLOBAL: evaluated per sample")
                   +"  -  output "+output);
        juce::StringArray ports;
        const auto signalName=[](ControlSignal s){ return s==ControlSignal::None ? "none (acts on the voice)" : controlSignalName(s); };
        for(std::uint8_t k=0;k<info->inputs;++k) ports.add(juce::String(controlInputName(*info,k))+" ("+signalName(info->inputSignals[k])+")");
        juce::StringArray outs;
        for(std::size_t p=0;p<info->outputCount;++p) outs.add(juce::String(controlOutputName(*info,p))+" ("+signalName(controlOutputSignalOf(*info,p))+")");
        lines_.add((info->inputs==0 ? juce::String("No inputs") : "Inputs: "+ports.joinIntoString(", "))
                   +"   /   "+(info->outputCount>1 ? "Outputs: "+outs.joinIntoString(", ") : "Output: "+juce::String(signalName(info->output)))
                   +".  One connection per input.");
        for(std::uint8_t k=0;k<info->inputs;++k) inputs_.add(controlInputName(*info,k));
        if(op_!=id || opType_!=op->type) {
            clearParameters();
            op_=id; opType_=op->type;
            for(std::size_t i=0;i<info->parameterCount;++i) {
                const auto& p=info->parameters[i];
                auto slider=std::make_unique<FxFeedbackSlider>(page_);
                slider->setName("CONTROL OPERATOR PARAMETER "+juce::String(p.label));
                slider->setSliderStyle(juce::Slider::LinearHorizontal);
                slider->setTextBoxStyle(juce::Slider::TextBoxRight,false,72,18);
                slider->setNumDecimalPlacesToDisplay(p.integer ? 0 : 3);
                slider->setRange(p.minimum,p.maximum,p.integer ? 1.0 : 0.0);
                if(op->type==ControlOpType::Curve && i==0)
                    slider->textFromValueFunction=[](double v){ const char* names[]{"LINEAR","EXP","LOG","S-CURVE"}; return juce::String(names[juce::jlimit(0,3,juce::roundToInt(v))]); };
                if(op->type==ControlOpType::Remap && i==4)
                    slider->textFromValueFunction=[](double v){ return v>=0.5 ? juce::String("ON") : juce::String("OFF"); };
                // N05 choice parameters read as their names.
                const auto choice=[&](std::vector<juce::String> names) {
                    slider->textFromValueFunction=[names](double v){ return names[std::size_t(juce::jlimit(0,int(names.size())-1,juce::roundToInt(v)))]; };
                };
                if(op->type==ControlOpType::Clock && i==0) choice({"FREE","TEMPO"});
                if(op->type==ControlOpType::Clock && i==2)
                    slider->textFromValueFunction=[](double v){ return juce::String(clockDivisionLabel(juce::roundToInt(v))); };
                if(op->type==ControlOpType::Compare && i==0) choice({">","<",">=","<=","==","!="});
                if(op->type==ControlOpType::Edge && i==0) choice({"RISING","FALLING","BOTH"});
                if(op->type==ControlOpType::Counter && i==1) choice({"WRAP","CLAMP","PING-PONG"});
                if(op->type==ControlOpType::Sequencer && i==0) choice({"INTERNAL","EXTERNAL"});
                if(op->type==ControlOpType::EventDelay && i==0) choice({"MS","SYNC"});
                if(op->type==ControlOpType::EventDelay && i==2)
                    slider->textFromValueFunction=[](double v){ return juce::String(clockDivisionLabel(juce::roundToInt(v))); };
                if(op->type==ControlOpType::RandomWalk && i==4) choice({"CLAMP","REFLECT"});
                if(op->type==ControlOpType::Pattern && (i==1 || i==2)) // the 16 steps as a mask (x = on)
                    slider->textFromValueFunction=[](double v){ juce::String t; const int bits=juce::roundToInt(v);
                        for(int b=0;b<16;++b) t<<(((bits>>b)&1)!=0 ? "x" : "."); return t; };
                if(op->type==ControlOpType::EventDelay && i==1) slider->setTextValueSuffix(" ms");
                if(op->type==ControlOpType::Transport && i==0) choice({"START","STOP"});
                if(op->type==ControlOpType::EnvelopeTrigger && i==0)
                    slider->textFromValueFunction=[](double v){ return "ENV "+juce::String(juce::roundToInt(v)); };
                slider->updateText(); // the value may already equal the range start
                if(op->type==ControlOpType::Smooth) slider->setSkewFactorFromMidPoint(0.5);
                auto* raw=slider.get();
                slider->onDragStart=[this]{ page_.beginOperatorGesture(); };
                slider->onDragEnd=[this]{ page_.endOperatorGesture(); };
                slider->onValueChange=[this,raw,i]{ if(op_!=0 && !syncing_) page_.setOperatorParameter(op_,i,float(raw->getValue())); };
                addAndMakeVisible(*slider);
                params_.push_back(std::move(slider));
                paramLabels_.add(p.label);
            }
            monitor_.clear();
        }
        syncing_=true;
        for(std::size_t i=0;i<params_.size();++i)
            if(!params_[i]->isMouseButtonDown()) params_[i]->setValue(op->params[i],juce::dontSendNotification);
        syncing_=false;
        // N06: the SEQUENCER node edits the canonical sequence (SequencerSettings).
        if(op->type==ControlOpType::Sequencer) {
            lines_.add(juce::String("The instrument's one sequencer (steps shared with SYNTH).  ")
                       +(op->params[0]>=0.5f ? "EXTERNAL: each ADVANCE plays the next step; RESET (first) returns to the start."
                                             : "INTERNAL: runs at RATE; ADVANCE ignored; RESET restarts."));
            buildSequenceEditor(state.modulation.sequencer);
        } else clearSequenceEditor();
        monitor_.setVisible(true);
        resized();
        repaint();
    }
    FxPage& page_;
    ControlSelection selection_;
    ModulationState modulation_{};
    std::uint32_t op_=0;
    ControlOpType opType_=ControlOpType::None;
    std::vector<std::unique_ptr<juce::Slider>> params_,sequence_;
    juce::StringArray paramLabels_,inputs_,sequenceLabels_;
    juce::String liveValues_;
    bool syncing_=false;
    juce::TextButton disconnect_{"DISCONNECT"};
    ModRoute route_{};
    juce::String kind_,title_;
    juce::StringArray lines_;
    juce::TextButton enabled_{"ON"},polarity_{"UNIPOLAR"},remove_{"DELETE"};
    juce::Slider amount_;
    ModulationRouteMonitor monitor_;
};

// MODULE PARAMETERS: identity / preview / quick controls of the selected
// module on the left, its full tabbed parameter list on the right. A CONTROL
// selection shows the CONTROL inspector instead.
class FxPage::ModuleParametersPanel final : public Panel {
public:
    ModuleParametersPanel(SelectedPanel& selected,ParametersPanel& parameters,ControlInspector& control)
        :Panel("MODULE PARAMETERS"),selected_(selected),parameters_(parameters),control_(control) {
        addAndMakeVisible(selected_);
        addAndMakeVisible(parameters_);
        addChildComponent(control_);
    }
    void setControlMode(bool control) {
        if(control==control_.isVisible()) return;
        control_.setVisible(control);
        selected_.setVisible(!control);
        parameters_.setVisible(!control);
        repaint();
    }
    void resized() override {
        auto area=contentBounds();
        control_.setBounds(area);
        selected_.setBounds(area.removeFromLeft(juce::jlimit(240,380,area.getWidth()*2/5)));
        area.removeFromLeft(dividerGap);
        parameters_.setBounds(area);
    }
private:
    static constexpr int dividerGap=9;
    void paintContent(juce::Graphics& g,juce::Rectangle<int>) override {
        if(control_.isVisible()) return;
        const int x=selected_.getRight()+dividerGap/2;
        g.setColour(Palette::borderSoft());
        g.drawVerticalLine(x,float(selected_.getY()+8),float(selected_.getBottom()-8));
    }
    SelectedPanel& selected_;
    ParametersPanel& parameters_;
    ControlInspector& control_;
};

class FxPage::FxMacrosPanel final : public Panel {
public:
    explicit FxMacrosPanel(FxPage& page,ModulationBindings bindings):Panel("MACROS"),page_(page),bindings_(std::move(bindings)) {
        for(std::size_t i=0;i<sliders_.size();++i) {
            auto& s=sliders_[i];
            configureKnob(s);
            s.setRange(0.0,1.0,0.001);
            s.setName("FX Macro "+juce::String(int(i)+1));
            // The first four EXISTING canonical macros (by stable id): no second engine.
            s.onValueChange=[this,i]{if(bindings_.macro && ids_[i]!=0) bindings_.macro(unsigned(ids_[i]-1),float(sliders_[i].getValue()));};
            // mct-origami-nested-modulation-manual-qa: one DAW gesture per drag.
            s.onDragStart=[this,i]{ if(bindings_.macroGesture && ids_[i]!=0) bindings_.macroGesture(unsigned(ids_[i]-1),true); };
            s.onDragEnd=[this,i]{ if(bindings_.macroGesture && ids_[i]!=0) bindings_.macroGesture(unsigned(ids_[i]-1),false); };
            addAndMakeVisible(s);
        }
    }
    void sync(const InstrumentState& state) {
        const auto macros=activeMacroSources(state.modulation);
        bool changed=false;
        for(std::size_t i=0;i<sliders_.size();++i) {
            const auto id=i<macros.size() ? macroIdOf(macros[i]) : std::size_t(0);
            changed|=ids_[i]!=id; ids_[i]=id;
            const auto label=id!=0 ? macroLabel(state.modulation,id) : juce::String();
            changed|=labels_[i]!=label; labels_[i]=label;
            sliders_[i].setVisible(id!=0);
            if(id!=0 && !sliders_[i].isMouseButtonDown()) sliders_[i].setValue(state.modulation.macros[id-1],juce::dontSendNotification);
        }
        if(changed) repaint();
    }
    void paintOverChildren(juce::Graphics& g) override {
        for(std::size_t i=0;i<sliders_.size();++i) {
            if(ids_[i]==0 || !sliders_[i].isVisible()) continue;
            const auto range=fxKnobModulationRange(float(sliders_[i].getValue()),macroValueAddress(ids_[i]),
                                                   page_.visualModulation(),modulationUiTelemetry().selectedSource);
            const auto& runtime=page_.visualRuntime();
            const float current=(runtime.modulatedMacros & (1u<<(ids_[i]-1)))!=0
                ? runtime.effectiveMacros[ids_[i]-1] : float(sliders_[i].getValue());
            paintKnobModulationOverlay(g,sliders_[i].getBounds().toFloat().reduced(3),range.lo,range.hi,
                                       range.hasDepth,range.anyRoute,true,current,range.selected);
        }
    }
    void resized() override {
        auto area=contentBounds().reduced(12,6).withTrimmedTop(26);
        const int cell=area.getWidth()/4;
        for(std::size_t i=0;i<sliders_.size();++i)
            sliders_[i].setBounds(juce::Rectangle<int>(area.getX()+int(i)*cell,area.getY(),cell,area.getHeight()).withTrimmedBottom(40).withSizeKeepingCentre(52,52));
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(12,6).withTrimmedTop(6);
        text(g,"SHARED WITH SYNTH MACROS",area.removeFromTop(18),Type::secondary,Palette::muted());
        area.removeFromTop(2);
        const int cell=area.getWidth()/4;
        for(int i=0;i<4;++i) {
            if(ids_[std::size_t(i)]==0) continue;
            auto r=juce::Rectangle<int>(area.getX()+i*cell,area.getY(),cell,area.getHeight()).withTrimmedBottom(16);
            text(g,labels_[std::size_t(i)],r.removeFromBottom(16),Type::label,Palette::muted(),juce::Justification::centred);
        }
    }
    FxPage& page_;
    ModulationBindings bindings_;
    std::array<juce::Slider,4> sliders_;
    std::array<juce::String,4> labels_; // custom macro names (stable id)
    std::array<std::size_t,4> ids_{{1,2,3,4}};
};

// Origami-native destructive confirmation (never an OS alert).
class FxPage::ConfirmPanel final : public juce::Component {
public:
    explicit ConfirmPanel(FxPage& page):page_(page) {
        cancel_.setName("FX confirm cancel");
        confirm_.setName("FX confirm action");
        confirm_.setColour(juce::TextButton::textColourOffId,signalShade(1.0f,1.0f));
        confirm_.setColour(juce::TextButton::textColourOnId,signalShade(1.0f,1.0f));
        cancel_.onClick=[this]{page_.pendingConfirm_=nullptr;page_.overlay_.dismiss();};
        confirm_.onClick=[this] {
            auto action=std::move(page_.pendingConfirm_);
            page_.pendingConfirm_=nullptr;
            page_.overlay_.dismiss();
            if(action) action();
        };
        addAndMakeVisible(cancel_);
        addAndMakeVisible(confirm_);
    }
    void sync() { confirm_.setButtonText(page_.confirmAction_); repaint(); }
    void paint(juce::Graphics& g) override {
        g.fillAll(Palette::panel());
        g.setColour(signalShade(.6f,.8f));
        g.drawRect(getLocalBounds());
        auto area=getLocalBounds().reduced(22,18);
        text(g,page_.confirmTitle_,area.removeFromTop(28),13.0f,Palette::text());
        area.removeFromTop(6);
        g.setColour(Palette::secondary());
        g.setFont(juce::FontOptions(10.0f));
        g.drawFittedText(page_.confirmBody_,area.removeFromTop(48),juce::Justification::topLeft,3,1.0f);
    }
    void resized() override {
        auto row=getLocalBounds().reduced(22,18).removeFromBottom(32);
        confirm_.setBounds(row.removeFromRight(110));
        row.removeFromRight(10);
        cancel_.setBounds(row.removeFromRight(110));
    }
private:
    FxPage& page_;
    juce::TextButton cancel_{"CANCEL"},confirm_{"CLEAR"};
};

// ================================================================ page

// ---- N07 developer inspector (defined before the page owns one) ----------
class FxPage::DebugInspector final : public juce::Component {
public:
    explicit DebugInspector(FxPage& page):page_(page) { setName("NODES DEBUG INSPECTOR"); setInterceptsMouseClicks(false,false); }
    void paint(juce::Graphics& g) override {
        g.setColour(juce::Colours::black.withAlpha(0.82f)); g.fillRoundedRectangle(getLocalBounds().toFloat(),4.0f);
        g.setColour(Palette::borderStrong()); g.drawRoundedRectangle(getLocalBounds().toFloat().reduced(0.5f),4.0f,1.0f);
        auto area=getLocalBounds().reduced(10,8);
        g.setFont(juce::FontOptions(juce::Font::getDefaultMonospacedFontName(),10.0f,juce::Font::plain));
        for(const auto& line:page_.debugInspectorLines()) {
            if(area.getHeight()<12) break;
            g.setColour(line.startsWith("#") ? signalSourceColour() : Palette::text().withAlpha(0.9f));
            g.drawText(line.startsWith("#") ? line.substring(1) : line,area.removeFromTop(13),juce::Justification::centredLeft,true);
        }
    }
private:
    FxPage& page_;
};


FxPage::FxPage(FxWorkspace& workspace,ModulationBindings bindings,HostBindings host)
    : workspace_(workspace),document_(&workspace.document(mainBusId)),bindings_(std::move(bindings)),
      peaks_(host.peaks),host_(host),viewState_(host.view),canvas_(*this),view_(canvas_) {
    setWantsKeyboardFocus(true);
    const char* modeNames[]{"SERIAL","PARALLEL","SPLIT","SEND","CUSTOM"};
    for(int i=0;i<5;++i) {
        auto& b=modes_[std::size_t(i)];
        b.setButtonText(modeNames[i]);
        b.setClickingTogglesState(true);
        b.setRadioGroupId(0x4647);
        b.onClick=[this,i]{if(modes_[std::size_t(i)].getToggleState()) setRoutingMode(static_cast<FxRoutingMode>(i+1));};
        addAndMakeVisible(b);
    }
    // SEND needs send/return DSP, which does not exist yet: visibly pending.
    modes_[3].setEnabled(false);
    modes_[3].setTooltip("Send / return routing is pending");
    undo_.onClick=[this]{undo();};
    redo_.onClick=[this]{redo();};
    clear_.onClick=[this]{requestClear();};
    clear_.setColour(juce::TextButton::textColourOffId,signalShade(.95f,.9f));
    templates_.onClick=[this]{showTemplatesMenu(templates_);};
    add_.setName("FX toolbar add module");
    add_.onClick=[this]{showNodePalette(std::nullopt);}; // N07: searchable palette
    autoLayout_.setName("NODES AUTO LAYOUT");
    autoLayout_.setTooltip("Arrange the CONTROL graph left to right (layout only; undoable)");
    autoLayout_.onClick=[this]{autoLayoutControl();};
    zoomOut_.onClick=[this]{zoomOut();};
    zoomIn_.onClick=[this]{zoomIn();};
    zoomReset_.onClick=[this]{zoomReset();};
    zoomFit_.onClick=[this]{zoomToFit();};
    for(auto* b:{&undo_,&redo_,&clear_,&templates_,&add_,&zoomOut_,&zoomReset_,&zoomIn_,&zoomFit_,&autoLayout_}) addAndMakeVisible(b);
    addAndMakeVisible(sidebar_);
    sidebar_.onTabChanged=[this](FxSidebar::Tab){storeView();};
    sidebar_.routeLabel=[this](std::uint32_t id) {
        InstrumentState state;
        if(bindings_.snapshot) state=bindings_.snapshot();
        return modulationRouteTargetLabel(state,id);
    };
    addAndMakeVisible(view_);
    view_.onViewChanged=[this] {
        zoomReset_.setButtonText(juce::String(juce::roundToInt(view_.zoom()*100.0f))+"%");
        storeView();
        // N07 semantic zoom: level of detail follows the zoom (view only).
        const auto detail=ControlNodeComponent::detailFor(view_.zoom());
        canvas_.setControlDetail(detail);
        for(const auto& n:graph().nodes()) if(auto* c=canvas_.nodeComponent(n.id)) c->updateDetail();
        if(detail==ControlNodeComponent::Detail::Minimal) for(auto* node:canvas_.controlNodes()) node->repaint();
    };
    selectedPanel_=std::make_unique<SelectedPanel>(*this);
    parametersPanel_=std::make_unique<ParametersPanel>(*this,bindings_);
    macrosPanel_=std::make_unique<FxMacrosPanel>(*this,bindings_);
    confirmPanel_=std::make_unique<ConfirmPanel>(*this);
    controlInspector_=std::make_unique<ControlInspector>(*this);
    modulePanel_=std::make_unique<ModuleParametersPanel>(*selectedPanel_,*parametersPanel_,*controlInspector_);
    addAndMakeVisible(*modulePanel_);
    // Macros have one editing home on SYNTH. Keep the legacy component alive
    // for existing inspector bindings, but do not render duplicate knobs here.
    addChildComponent(*macrosPanel_);
    // NODES > MATRIX: the canonical Matrix view in its compact layout.
    matrix_=std::make_unique<ModulationMatrix>(bindings_,ModulationMatrix::Layout::Sidebar);
    sidebar_.setMatrixView(matrix_.get());
    addChildComponent(overlay_);
    addChildComponent(palette_);
    if(viewState_!=nullptr && viewState_->valid)
        sidebar_.setTab(static_cast<FxSidebar::Tab>(juce::jlimit(0,FxSidebar::tabCount-1,viewState_->sidebarTab)));
    refresh(true);
    refreshSidebar();
}

FxPage::~FxPage() {
    // P03: telemetry is on only while NODES is on screen; a closed editor
    // must not leave the audio thread publishing.
    if(host_.nodeTelemetryEnabled) host_.nodeTelemetryEnabled(bus_,false);
    stopTimer(); sidebar_.setMatrixView(nullptr);
}

juce::Component& FxPage::moduleParametersPanel() noexcept { return *modulePanel_; }
juce::Component& FxPage::macrosPanel() noexcept { return *macrosPanel_; }

void FxPage::visibilityChanged() {
    const bool visible=isVisible();
    if(host_.nodeTelemetryEnabled) host_.nodeTelemetryEnabled(bus_,visible);
    if(visible) { startTimerHz(30); if(modelDirty_ && document_!=nullptr) syncFromModel(); }
    else stopTimer();
}

void FxPage::storeView() {
    if(viewState_==nullptr) return;
    viewState_->zoom=view_.zoom();
    viewState_->panX=view_.pan().x;
    viewState_->panY=view_.pan().y;
    viewState_->sidebarTab=static_cast<int>(sidebar_.tab());
    viewState_->valid=true;
}

void FxPage::resized() {
    auto area=getLocalBounds();
    auto toolbar=area.removeFromTop(toolbarHeight).reduced(12,8);
    toolbar.removeFromLeft(132);
    for(auto& mode:modes_) mode.setBounds(toolbar.removeFromLeft(86).reduced(2,0));
    toolbar.removeFromLeft(18);
    zoomOut_.setBounds(toolbar.removeFromLeft(34).reduced(2,0));
    zoomReset_.setBounds(toolbar.removeFromLeft(62).reduced(2,0));
    zoomIn_.setBounds(toolbar.removeFromLeft(34).reduced(2,0));
    zoomFit_.setBounds(toolbar.removeFromLeft(52).reduced(2,0));
    toolbar.removeFromLeft(12);
    autoLayout_.setBounds(toolbar.removeFromLeft(110).reduced(2,0));
    add_.setBounds(toolbar.removeFromRight(140).reduced(2,0));
    toolbar.removeFromRight(10);
    templates_.setBounds(toolbar.removeFromRight(104).reduced(2,0));
    clear_.setBounds(toolbar.removeFromRight(74).reduced(2,0));
    redo_.setBounds(toolbar.removeFromRight(70).reduced(2,0));
    undo_.setBounds(toolbar.removeFromRight(70).reduced(2,0));

    // The sidebar owns the full height down to the keyboard; the graph sits
    // above the full-width MODULE PARAMETERS inspector on the right.
    sidebar_.setBounds(area.removeFromLeft(FxSidebar::width));
    auto inspector=area.removeFromBottom(inspectorHeight);
    const bool firstLayout=view_.getWidth()==0;
    view_.setBounds(area);
    macrosPanel_->setBounds({});
    modulePanel_->setBounds(inspector);
    overlay_.setBounds(getLocalBounds());
    if(debugInspector_) debugInspector_->setBounds(view_.getBounds().removeFromRight(400).removeFromTop(330).reduced(8));
    refresh(true);
    if(firstLayout && viewState_!=nullptr && viewState_->valid)
        view_.setView(viewState_->zoom,{viewState_->panX,viewState_->panY});
}

void FxPage::paint(juce::Graphics& g) {
    g.fillAll(Palette::background());
    auto toolbar=getLocalBounds().removeFromTop(toolbarHeight);
    g.setColour(Palette::panel());
    g.fillRect(toolbar);
    g.setColour(Palette::borderSoft());
    g.drawHorizontalLine(toolbar.getBottom()-1,0.0f,float(getWidth()));
    text(g,"NODE GRAPH",toolbar.reduced(14,0).withWidth(128),11.5f,Palette::secondary());
}

namespace { juce::Rectangle<float> nodeRect(FxCanvas&,const nodes::ControlNodeKey&); }

void FxPage::refreshVisualFeedback() {
    if(!isShowing()) return;
    ++visualRefreshCount_;
    if(bindings_.visualization) visualRuntime_=bindings_.visualization();
    if(visualPlan_->hasFxRoutes()) {
        const auto& snapshot=visualRuntime_;
        std::array<float,CompiledModulation::globalSourceCount> global{};
        std::array<float,CompiledModulation::voiceSourceCount> voice{};
        std::array<float,operatorOutputSlotCount> operators{};
        std::copy_n(snapshot.routeSources.begin(),global.size(),global.begin());
        std::copy_n(snapshot.routeSources.begin()+global.size(),voice.size(),voice.begin());
        std::copy_n(snapshot.routeSources.begin()+global.size()+voice.size(),operators.size(),operators.begin());
        visualPlan_->fxFrame(visualFxFrame_,global,&voice,&operators);
    } else visualFxFrame_.count=0;
    // Repaint only visible tagged controls. Static response previews do not
    // animate or recompute at timer cadence; the selected inspector is 30 Hz,
    // graph controls 15 Hz. At minimal zoom there are no visible graph knobs.
    const auto visit=[&](auto&& self,juce::Component& c)->void {
        if(!c.isVisible()) return;
        if(auto* slider=dynamic_cast<FxFeedbackSlider*>(&c)) {
            const auto visible=getLocalArea(slider,slider->getLocalBounds()).getIntersection(getLocalBounds());
            if(!visible.isEmpty()) slider->repaint();
            return;
        }
        for(auto* child:c.getChildren()) self(self,*child);
    };
    if((visualRefreshCount_&1u)==0 && graphZoom()>=.45f)
        for(const auto& n:graph().nodes()) if(auto* c=canvas_.nodeComponent(n.id))
            if(view_.getLocalArea(c,c->getLocalBounds()).intersects(view_.getLocalBounds())) visit(visit,*c);
    visit(visit,*modulePanel_);
    // Live audio previews: selected node every tick (30 Hz); other visible
    // effect nodes every other tick (15 Hz). Hidden/offscreen/minimal-zoom
    // nodes consume no node telemetry and perform no DFT work.
    if(host_.nodeTelemetry && graphZoom()>=.6f) {
        for(const auto& n:graph().nodes()) {
            if(n.kind!=FxNodeKind::Effect) continue;
            if(n.id!=selected_ && (visualRefreshCount_&1u)!=0) continue;
            auto* component=canvas_.nodeComponent(n.id);
            if(component==nullptr || !component->isVisible()) continue;
            const auto visible=view_.getLocalArea(component,component->getLocalBounds()).getIntersection(view_.getLocalBounds());
            if(visible.isEmpty()) continue;
            component->setTelemetry(host_.nodeTelemetry(bus_,n.id));
        }
    }
    if(visualRuntime_.modulatedMacros!=0) macrosPanel_->repaint();
}

void FxPage::timerCallback() {
    if(!isShowing()) return;
    refreshVisualFeedback();
    updateMeters();
    sampleControlMonitor();
    if(feedback_.isNotEmpty() && juce::Time::getMillisecondCounterHiRes()>feedbackUntil_) { feedback_.clear(); repaint(view_.getBounds()); }
    if(debugInspectorVisible()) debugInspector_->repaint();
}

bool FxPage::keyPressed(const juce::KeyPress& key) {
    const auto mods=key.getModifiers();
    const bool command=mods.isCommandDown() || mods.isCtrlDown();
    // mct-origami-nested-modulation-manual-qa: Escape is used only when it
    // closes or cancels something of Origami's (palette, overlay, a wire being
    // drawn; with CAPTURE KEYBOARD INPUT also a multi-selection). Otherwise
    // it stays with the host.
    if(key==juce::KeyPress::escapeKey) {
        if(palette_.isOpen()) { palette_.dismiss(); return true; }
        bool used=false;
        if(overlay_.isShowing()) { overlay_.dismiss(); used=true; }
        if(canvas_.wireSource()) { canvas_.cancelWire(); used=true; }
        if(captureKeyboardInput() && controlMulti_.size()>1) { setControlNodeSelection({}); used=true; }
        return used;
    }
    // CAPTURE KEYBOARD INPUT OFF (default): no NODES shortcut takes a key.
    // Returning false hands it back through the window to the host (Logic's
    // Musical Typing), rather than receiving it and doing nothing.
    if(!captureKeyboardInput()) return false;
    const auto ch=juce::CharacterFunctions::toLowerCase(key.getTextCharacter()!=0 ? key.getTextCharacter() : juce::juce_wchar(key.getKeyCode()));
    // N07 shortcuts (the palette's search field has focus while it is open,
    // so these never steal typing).
    if((key==juce::KeyPress::deleteKey || key==juce::KeyPress::backspaceKey) && !command && controlMulti_.size()>1) return deleteSelectedControlNodes();
    if(command && mods.isShiftDown() && ch=='d') { setDebugInspectorVisible(!debugInspectorVisible()); return true; }
    if(command && !mods.isShiftDown() && ch=='d') {
        auto keys=controlMulti_;
        if(keys.empty() && controlSelection_.kind==ControlSelection::Kind::Node) keys.push_back(controlSelection_.key);
        if(keys.size()==1 && keys[0].kind==nodes::ControlNodeKind::Operator) return duplicateControlOperator(keys[0].op).has_value();
        if(copySelectedControlNodes()>0) { const auto r=nodeRect(canvas_,keys.front()); return !pasteControlNodes(FxPoint{r.getX()+40.0f,r.getBottom()+30.0f}).empty(); }
        return false;
    }
    if(command && ch=='c') return copySelectedControlNodes()>0;
    if(command && ch=='v') {
        const auto mouse=view_.getMouseXYRelative().toFloat();
        const auto at=view_.getLocalBounds().toFloat().contains(mouse) ? std::optional<FxPoint>(view_.viewToGraph(mouse)) : std::nullopt;
        return !pasteControlNodes(at).empty();
    }
    if(command && ch=='a') { std::vector<nodes::ControlNodeKey> all; for(auto* n:canvas_.controlNodes()) all.push_back(n->key()); setControlNodeSelection(all); return true; }
    if(command && mods.isShiftDown() && ch=='l') { autoLayoutControl(); return true; }
    if(!command && (ch=='a' || key==juce::KeyPress::tabKey)) {
        const auto mouse=view_.getMouseXYRelative().toFloat();
        showNodePalette(view_.getLocalBounds().toFloat().contains(mouse) ? view_.viewToGraph(mouse) : viewCentre());
        return true;
    }
    if(!command && ch=='f' && (controlMulti_.size()>1 || controlSelection_.kind==ControlSelection::Kind::Node)) {
        juce::Rectangle<int> bounds;
        auto keys=controlMulti_; if(keys.empty()) keys.push_back(controlSelection_.key);
        for(const auto& k:keys) bounds=bounds.getUnion(nodeRect(canvas_,k).toNearestInt());
        if(!bounds.isEmpty()) { view_.fitTo(bounds); return true; }
    }
    if((key==juce::KeyPress::deleteKey || key==juce::KeyPress::backspaceKey) && !command) {
        if(controlSelection_.kind==ControlSelection::Kind::Link) return deleteControlLink(controlSelection_.route);
        if(controlSelection_.kind==ControlSelection::Kind::Edge) return disconnectControlInput(controlSelection_.op,controlSelection_.input);
        if(controlSelection_.kind==ControlSelection::Kind::Node && controlSelection_.key.kind==nodes::ControlNodeKind::Operator)
            return deleteControlOperator(controlSelection_.key.op);
    }
    if((key==juce::KeyPress::deleteKey || key==juce::KeyPress::backspaceKey) && !command && selected_!=invalidFxNodeId)
        return deleteNode(selected_);
    const auto c=juce::CharacterFunctions::toLowerCase(key.getTextCharacter()!=0 ? key.getTextCharacter() : juce::juce_wchar(key.getKeyCode()));
    if(command && c=='z') { if(mods.isShiftDown()) redo(); else undo(); return true; }
    if(command && c=='0') { zoomReset(); return true; }
    if(command && c=='1') { zoomToFit(); return true; }
    if(command && (c=='=' || c=='+')) { zoomIn(); return true; }
    if(command && c=='-') { zoomOut(); return true; }
    if(!command && c=='f') { zoomToFit(); return true; }
    return false;
}

fx::FxPoint FxPage::viewCentre() const {
    const auto area=view_.viewport().toFloat();
    return view_.viewToGraph(area.getCentre());
}

void FxPage::zoomIn() { view_.zoomAround(view_.zoom()*1.25f,view_.viewport().toFloat().getCentre()); }
void FxPage::zoomOut() { view_.zoomAround(view_.zoom()/1.25f,view_.viewport().toFloat().getCentre()); }
void FxPage::zoomReset() { view_.zoomAround(1.0f,view_.viewport().toFloat().getCentre()); }
void FxPage::zoomToFit() { view_.fitTo(canvas_.contentBounds()); }

// N07 synchronization model. syncFromModel (editor timer while NODES is
// shown, explicit callers) rebuilds the sidebar / CONTROL view only when the
// processor's model revision or the bus graph revision changed; the page's
// own edits refresh directly. modelChanged (model-change notifications)
// does no visual work while the page is hidden: the page is marked stale and
// catches up when shown. Telemetry (meters, monitors, activity) runs on the
// page timer (stopped while hidden) and touches only what it updates.
void FxPage::syncFromModel() {
    if(document_==nullptr) return;
    refresh(false);
    const std::uint64_t revision=bindings_.modelRevision ? bindings_.modelRevision() : 0;
    if(!modelDirty_ && revision!=0 && revision==lastModelRevision_ && lastSidebarGraphRevision_==document_->revision()) {
        ++uiDiagnostics_.skippedSyncs;
        return;
    }
    lastModelRevision_=revision; lastSidebarGraphRevision_=document_->revision(); modelDirty_=false;
    ++uiDiagnostics_.modelSyncs;
    refreshSidebar();
}

void FxPage::modelChanged() {
    if(getParentComponent()!=nullptr && !isVisible()) {
        // Hidden: the sidebar's modulator cards are the SYNTH rail's own rows
        // and must follow every route change; the CONTROL graph, its node
        // components and cable geometry wait until the page is shown.
        modelDirty_=true; ++uiDiagnostics_.hiddenSyncs;
        refreshSidebar(false);
        return;
    }
    syncFromModel();
}

std::uint32_t FxPage::canvasPaintCount() const noexcept { return canvas_.paintCount(); }

juce::String FxPage::busName(BusId bus) const {
    for(const auto& [id,name]:busNames_) if(id==bus) return name;
    return bus==mainBusId ? juce::String("MAIN") : "BUS "+juce::String(bus);
}

void FxPage::refreshSidebar(bool includeControl) {
    InstrumentState state;
    if(bindings_.snapshot) state=bindings_.snapshot();
    busNames_.clear();
    for(std::size_t i=0;i<state.buses.count;++i) busNames_.push_back({state.buses.buses[i].id,juce::String(state.buses.buses[i].label())});
    macrosPanel_->sync(state);
    if(parametersPanel_->tab()==1) parametersPanel_->show(graph(),selected_,state.modulation.routes);

    using Row=FxSidebar::Row;
    juce::Component::SafePointer<FxPage> safe(this);
    // SOURCES: this bus graph's audio input (never ENV/LFO/MIDI).
    sidebar_.setRows(FxSidebar::Tab::Sources,{
        {"AUDIO INPUT",{},{},{},true,false,true,{}},
        {busName(bus_)+" IN","THIS BUS",bus_==mainBusId ? "Synth voice sum" : "Oscillator sends to "+busName(bus_),{},true,true,false,
         [safe]{if(safe!=nullptr) safe->selectNode(safe->graph().sourceForBus(safe->selectedBus()));}},
        {"EXTERNAL IN","PENDING","Not available yet",{},false,false,false,{}}});

    // MODULATORS: the SYNTH page's own source cards (ModulationSourceRow), fed
    // from the same canonical routes: every route of the source, wherever it
    // lands, exactly as the SYNTH rail shows it.
    std::vector<Row> modulators;
    const char* lastGroup="";
    for(const auto& s:availableSources(state.modulation)) {
        if(std::strcmp(lastGroup,s.group)!=0) { modulators.push_back({s.group,{},{},{},true,false,true,{}}); lastGroup=s.group; }
        Row row{sourceName(state.modulation,s.source),{},{},juce::String(sourceDragPrefix)+juce::String(int(s.source)),true,false,false,{}};
        for(const auto& r:modulationSourceRoutes(state.modulation,s.source)) row.magnitudes.push_back({r.id,r.amount});
        row.active=!row.magnitudes.empty();
        row.modulationSource=s.source;
        row.onMagnitude=[safe](std::uint32_t id,float amount) {
            if(safe==nullptr || !safe->bindings_.snapshot || !safe->bindings_.route) return;
            for(auto r:safe->bindings_.snapshot().modulation.routes)
                if(r.id==id) { r.amount=amount; safe->bindings_.route(r); }
            safe->refreshSidebar();
        };
        row.onRemoveRoute=[safe](std::uint32_t id) {
            if(safe==nullptr || !safe->bindings_.removeRoute) return;
            safe->bindings_.removeRoute(id);
            safe->refreshSidebar();
        };
        modulators.push_back(std::move(row));
    }
    sidebar_.setRows(FxSidebar::Tab::Modulators,std::move(modulators));

    // Synth identities are navigation/copy sources, never Nodes aliases.
    std::vector<Row> filters{{"SYNTH / PER VOICE",{},{},{},true,false,true,{}}};
    if(state.modulation.filterEnabled) filters.push_back({"LEGACY LP","ON","Per oscillator, before buses / drag: post-mix copy","MCT_SYNTH_FILTER:0",true,true,false,[safe]{if(safe && safe->onOpenSynthFilter) safe->onOpenSynthFilter();}});
    for(const auto& f:state.modulation.synthFilters.filters) if(f.id) filters.push_back({"FILTER "+juce::String(f.id),f.power?"ON":"BYPASS","Drag: independent post-mix copy","MCT_SYNTH_FILTER:"+juce::String(f.id),true,true,false,[safe]{if(safe && safe->onOpenSynthFilter) safe->onOpenSynthFilter();}});
    sidebar_.setRows(FxSidebar::Tab::Filters,std::move(filters));

    // BUSES: one canonical bus model; selecting a bus shows its graph.
    std::vector<Row> buses{{"AUDIO BUSES",{},{},{},true,false,true,{}}};
    for(const auto& [id,name]:busNames_) {
        int effects=0;
        if(const auto* doc=workspace_.find(id)) for(const auto& n:doc->graph().nodes()) effects+=n.kind==FxNodeKind::Effect;
        const auto busId=id;
        Row row{name,effects ? juce::String(effects)+" FX" : juce::String(),busId==mainBusId ? "Permanent output bus" : "",
                {},true,busId==bus_,false,[safe,busId]{if(safe!=nullptr) safe->selectBus(busId);}};
        if(busId!=mainBusId)
            row.onSecondaryClick=[safe,busId] {
                if(safe==nullptr) return;
                showNativeChoiceMenu(safe->sidebar_,"BUS",{{1,"Delete Bus",true,"BUS"}},0,[safe,busId](int choice) {
                    if(safe!=nullptr && choice==1) safe->requestDeleteBus(busId);
                });
            };
        buses.push_back(std::move(row));
    }
    buses.push_back({"+ ADD BUS",{},busNames_.size()>=maxRenderBuses ? "Maximum of 8 buses" : "",{},
                     busNames_.size()<maxRenderBuses && bool(host_.addBus),false,false,[safe]{if(safe!=nullptr) safe->addBus();}});
    sidebar_.setRows(FxSidebar::Tab::Buses,std::move(buses));
    if(!includeControl) return;
    if(matrix_!=nullptr) matrix_->syncFromModel();
    refreshControl();
}

void FxPage::selectBus(BusId bus) {
    if(bus==bus_ && document_==workspace_.find(bus)) return;
    if(host_.nodeTelemetryEnabled) host_.nodeTelemetryEnabled(bus_,false);
    busViews_[bus_]={view_.zoom(),view_.pan()};
    bus_=bus;
    document_=&workspace_.document(bus);
    canvas_.clearNodes(); // node IDs are per bus graph: never reuse components across buses
    selected_=invalidFxNodeId;
    lastRevision_=0;
    refresh(true);
    if(const auto it=busViews_.find(bus);it!=busViews_.end()) view_.setView(it->second.first,it->second.second);
    else view_.setView(1.0f,{0.0f,0.0f});
    refreshSidebar();
    if(host_.nodeTelemetryEnabled && isShowing()) host_.nodeTelemetryEnabled(bus_,true);
}

BusId FxPage::addBus() {
    if(!host_.addBus) return 0;
    const auto id=host_.addBus();
    if(id!=0) { refreshSidebar(); selectBus(id); }
    return id;
}

bool FxPage::deleteBus(BusId bus) {
    if(bus==mainBusId || !host_.removeBus) return false;
    if(bus_==bus) selectBus(mainBusId); // stop viewing the graph before it goes
    const bool ok=host_.removeBus(bus);
    refreshSidebar();
    return ok;
}

void FxPage::requestDeleteBus(BusId bus) {
    if(bus==mainBusId) return;
    confirmTitle_="DELETE "+busName(bus)+"?";
    confirmBody_="This will remove its routing and processing graph. Oscillators that only sent to "
                 +busName(bus)+" return to MAIN at unity.";
    confirmAction_="DELETE";
    pendingConfirm_=[this,bus]{deleteBus(bus);};
    confirmPanel_->sync();
    overlay_.show(*confirmPanel_,{0,0,560,190});
}

FxNodeId FxPage::addSynthFilterCopy(FxPoint centre,SynthFilterId source) {
    // A post-mix FILTER module matching FILTER 1 (low-pass, cutoff, resonance).
    // The synth filter itself stays the single per-voice processor.
    InstrumentState state;
    if(bindings_.snapshot) state=bindings_.snapshot();
    const auto slot=synthFilterSlot(state.modulation.synthFilters,source);
    if(source && slot==maxSynthFilters) return invalidFxNodeId;
    const auto values=slot<maxSynthFilters ? state.modulation.synthFilters.filters[slot].values : SynthFilterValues{state.parameters[static_cast<std::size_t>(ParameterId::Cutoff)],state.parameters[static_cast<std::size_t>(ParameterId::Resonance)]};
    const float cutoff=values.cutoff,resonance=values.resonance;
    const auto created=addModuleAt({FxModuleKind::Effect,FxEffectType::Filter,0},centre);
    if(created==invalidFxNodeId) return created;
    const auto* d=findFxEffect(FxEffectType::Filter);
    const auto normalized=[](const FxParameterDescriptor& p,float value) {
        return p.curve==FxParameterCurve::Exponential ? std::log(value/p.minimum)/std::log(p.maximum/p.minimum)
                                                      : (value-p.minimum)/(p.maximum-p.minimum);
    };
    document_->edit([&](FxGraph& g) {
        g.setParameter(created,1,juce::jlimit(0.0f,1.0f,normalized(*findFxParameter(*d,1),juce::jlimit(20.0f,20000.0f,cutoff))));
        // Synth resonance [0,1] maps to Q [0.5,4] (ARCHITECTURE.md).
        g.setParameter(created,6,juce::jlimit(0.0f,1.0f,normalized(*findFxParameter(*d,6),0.5f+3.5f*resonance)));
        g.setParameter(created,5,fxChoiceNormalized(*findFxParameter(*d,5),int(slot<maxSynthFilters?state.modulation.synthFilters.filters[slot].type:dsp::FilterType::LowPass)));
        g.setParameter(created,7,juce::jlimit(0.0f,1.0f,normalized(*findFxParameter(*d,7),values.gain)));
        g.setParameter(created,3,values.mix);
        g.setParameter(created,8,juce::jlimit(0.0f,1.0f,normalized(*findFxParameter(*d,8),values.drive)));
        return true;
    });
    refresh(true);
    return created;
}

void FxPage::updateMeters() {
    if(!peaks_) return;
    const auto [left,right]=peaks_();
    meterLeft_=std::max(left,meterLeft_*0.86f);
    meterRight_=std::max(right,meterRight_*0.86f);
    if(meterLeft_<1.0e-5f) meterLeft_=0.0f;
    if(meterRight_<1.0e-5f) meterRight_=0.0f;
    if(auto* out=canvas_.nodeComponent(graph().outputNode())) out->setMeter(meterLeft_,meterRight_);
    // IN nodes: the real signal entering this graph, same ballistics as OUT.
    if(!host_.inputPeaks) return;
    for(const auto& node:graph().nodes()) {
        if(node.kind!=FxNodeKind::Source) continue;
        const auto [inL,inR]=host_.inputPeaks(node.bus);
        auto& m=inputMeters_[node.id];
        m.first=std::max(inL,m.first*0.86f); if(m.first<1.0e-5f) m.first=0.0f;
        m.second=std::max(inR,m.second*0.86f); if(m.second<1.0e-5f) m.second=0.0f;
        if(auto* c=canvas_.nodeComponent(node.id)) c->setMeter(m.first,m.second);
    }
}

void FxPage::refresh(bool force) {
    if(workspace_.find(bus_)!=document_) {
        // The bus was removed elsewhere (e.g. state restore): fall back to MAIN.
        bus_=mainBusId;
        document_=&workspace_.document(mainBusId);
        canvas_.clearNodes();
        selected_=invalidFxNodeId;
        force=true;
    }
    if(!force && lastRevision_==document_->revision()) return;
    if(lastRevision_!=document_->revision() && lastRevision_!=0 && !undoingGraph_) {
        graphSequences_.push_back(++editSequence_); // a graph edit, in the shared undo order
        graphRedoSequences_.clear();
    }
    lastRevision_=document_->revision();
    const auto& graph=document_->graph();
    if(graph.findNode(selected_)==nullptr) selected_=invalidFxNodeId;
    const auto area=view_.viewport();
    canvas_.rebuild(graph,selected_,int(float(area.getWidth())/view_.zoom())+1,int(float(area.getHeight())/view_.zoom())+1);
    view_.contentChanged();
    selectedPanel_->show(graph,selected_);
    InstrumentState state;
    if(bindings_.snapshot) state=bindings_.snapshot();
    parametersPanel_->show(graph,selected_,state.modulation.routes);
    refreshToolbar();
}

void FxPage::refreshToolbar() {
    const auto mode=static_cast<int>(document_->graph().routingMode())-1;
    for(int i=0;i<5;++i) modes_[std::size_t(i)].setToggleState(i==mode,juce::dontSendNotification);
    undo_.setEnabled(document_->canUndo() || !controlUndo_.empty());
    redo_.setEnabled(document_->canRedo() || !controlRedo_.empty());
}

void FxPage::selectNode(FxNodeId id) {
    if(graph().findNode(id)==nullptr) id=invalidFxNodeId;
    if(id!=invalidFxNodeId && controlSelection_.kind!=ControlSelection::Kind::None) {
        controlSelection_={};
        controlMulti_.clear();
        modulePanel_->setControlMode(false);
        refreshControl();
    }
    // The active node always comes to the front (UI-only; DSP order is the graph's).
    if(id!=invalidFxNodeId) canvas_.bringToFront(id);
    if(id==selected_) return;
    selected_=id;
    refresh(true);
}

bool FxPage::deleteNode(FxNodeId id) {
    const bool removed=document_->edit([id](FxGraph& g){return g.removeNodeBridging(id)==FxEditResult::Ok;});
    if(removed && selected_==id) selected_=invalidFxNodeId;
    refresh(true);
    return removed;
}

FxNodeId FxPage::addModule(const FxModuleSpec& spec) {
    if(spec.kind==FxModuleKind::BusSource) {
        if(spec.bus!=bus_) return invalidFxNodeId; // each graph's input is its own bus
        FxNodeId created=invalidFxNodeId;
        document_->edit([&](FxGraph& g){
            created=g.addBusSource(spec.bus,{40.0f,40.0f+120.0f*float(g.nodes().size()%5)});
            return created!=invalidFxNodeId;
        });
        if(created) selected_=created;
        refresh(true);
        return created;
    }
    if(spec.kind!=FxModuleKind::Effect) return addModuleAt(spec,viewCentre());
    // Workflow templates decide where an added effect goes. They never
    // rebuild the graph by themselves; they only shape new insertions.
    const auto mode=graph().routingMode();
    const auto output=graph().outputNode();
    const auto* outputWire=graph().connectionAt({output,0},true);
    FxNodeId created=invalidFxNodeId;
    if(mode==FxRoutingMode::Serial) {
        document_->edit([&](FxGraph& g){created=g.insertEffectBeforeOutput(spec.effect);return created!=invalidFxNodeId;});
    } else if(mode==FxRoutingMode::Parallel) {
        const auto* selected=graph().findNode(selected_);
        const bool chained=selected && selected->kind==FxNodeKind::Effect
            && graph().connectionAt({selected_,0},true) && graph().connectionAt({selected_,0},false);
        const auto wire=outputWire ? outputWire->id : 0u;
        document_->edit([&](FxGraph& g){
            created=chained ? g.parallelAroundNode(selected_,spec.effect) : wire ? g.parallelOnConnection(wire,spec.effect) : invalidFxNodeId;
            return created!=invalidFxNodeId;
        });
    } else if(mode==FxRoutingMode::Split) {
        const auto* fromSelected=graph().connectionAt({selected_,0},false);
        const auto wire=fromSelected ? fromSelected->id : outputWire ? outputWire->id : 0u;
        document_->edit([&](FxGraph& g){created=wire ? g.branchFromConnection(wire,spec.effect) : invalidFxNodeId;return created!=invalidFxNodeId;});
    }
    if(created==invalidFxNodeId) return addModuleAt(spec,viewCentre()); // CUSTOM, or nothing unambiguous to attach to
    selected_=created;
    refresh(true);
    canvas_.bringToFront(created);
    return created;
}

FxNodeId FxPage::addModuleAt(const FxModuleSpec& spec,FxPoint centre) {
    FxNodeId created=invalidFxNodeId;
    document_->edit([&](FxGraph& g){
        FxNode probe;
        probe.kind=spec.kind==FxModuleKind::Split ? FxNodeKind::Split : spec.kind==FxModuleKind::Merge ? FxNodeKind::Merge
                 : spec.kind==FxModuleKind::BusSource ? FxNodeKind::Source : FxNodeKind::Effect;
        probe.ports=fxPortTopology(probe.kind);
        const auto size=FxNodeComponent::sizeFor(probe);
        created=g.addModule(spec,{centre.x-float(size.getWidth())*0.5f,centre.y-float(size.getHeight())*0.5f});
        return created!=invalidFxNodeId;
    });
    if(created!=invalidFxNodeId) selected_=created;
    refresh(true);
    canvas_.bringToFront(created);
    return created;
}

FxNodeId FxPage::insertModuleOnConnection(FxConnectionId connection,const FxModuleSpec& spec,FxPoint centre) {
    // One atomic edit: A -> B becomes A -> X -> B, or nothing changes.
    FxNodeId created=invalidFxNodeId;
    FxNode probe;
    probe.kind=spec.kind==FxModuleKind::Split ? FxNodeKind::Split : spec.kind==FxModuleKind::Merge ? FxNodeKind::Merge : FxNodeKind::Effect;
    probe.ports=fxPortTopology(probe.kind);
    const auto size=FxNodeComponent::sizeFor(probe);
    document_->edit([&](FxGraph& g){
        created=g.insertModuleOnConnection(connection,spec,{centre.x-float(size.getWidth())*0.5f,centre.y-float(size.getHeight())*0.5f});
        return created!=invalidFxNodeId;
    });
    if(created!=invalidFxNodeId) selected_=created;
    refresh(true);
    canvas_.bringToFront(created);
    return created;
}

FxNodeId FxPage::insertBeforeOutput(const FxModuleSpec& spec) {
    const auto output=graph().outputNode();
    const auto* out=graph().findNode(output);
    if(out==nullptr || spec.kind==FxModuleKind::BusSource) return addModule(spec);
    const FxPoint near{out->position.x-150.0f,out->position.y+90.0f};
    if(const auto* wire=graph().connectionAt({output,0},true)) return insertModuleOnConnection(wire->id,spec,near);
    const auto created=addModuleAt(spec,near);
    if(created!=invalidFxNodeId && spec.kind==FxModuleKind::Effect) connectPorts({created,0},{output,0});
    return created;
}

bool FxPage::removeConnection(FxConnectionId id) {
    const bool ok=document_->edit([id](FxGraph& g){return g.disconnect(id);});
    refresh(true);
    return ok;
}

bool FxPage::resetConnectionRouting(FxConnectionId id) {
    const bool ok=document_->edit([id](FxGraph& g){
        const auto* c=g.findConnection(id);
        if(c==nullptr || c->layout.empty()) return false;
        while(!g.findConnection(id)->layout.empty()) g.removeLayoutPoint(id,0);
        return true;
    });
    refresh(true);
    return ok;
}

bool FxPage::addLayoutPoint(FxConnectionId connection,FxPoint at) {
    const auto index=canvas_.layoutInsertIndex(connection,{at.x,at.y});
    const bool ok=document_->edit([&](FxGraph& g){return g.addLayoutPoint(connection,index,at)==FxEditResult::Ok;});
    refresh(true);
    return ok;
}

bool FxPage::moveLayoutPoint(FxConnectionId connection,std::size_t index,FxPoint at,bool live) {
    if(live) {
        if(!gestureActive_) beginParameterGesture();
        const bool ok=document_->gestureEdit([&](FxGraph& g){return g.moveLayoutPoint(connection,index,at)==FxEditResult::Ok;});
        refresh(false);
        return ok;
    }
    if(gestureActive_) endParameterGesture();
    return true;
}

bool FxPage::removeLayoutPoint(FxConnectionId connection,std::size_t index) {
    const bool ok=document_->edit([&](FxGraph& g){return g.removeLayoutPoint(connection,index)==FxEditResult::Ok;});
    refresh(true);
    return ok;
}

void FxPage::setRoutingMode(FxRoutingMode mode) {
    if(mode==FxRoutingMode::Send) { refreshToolbar(); return; } // pending, never faked
    document_->edit([mode](FxGraph& g){g.setRoutingMode(mode);return true;});
    refresh(true);
}

void FxPage::requestClear() {
    confirmTitle_="CLEAR "+busName(bus_)+" GRAPH?";
    confirmBody_="This will remove all processing and routing modules from "+busName(bus_)+". "
                 +busName(bus_)+" IN > "+busName(bus_)+" OUT remains; other buses are untouched. UNDO restores it.";
    confirmAction_="CLEAR";
    pendingConfirm_=[this]{confirmClear();};
    confirmPanel_->sync();
    overlay_.show(*confirmPanel_,{0,0,560,190});
}

void FxPage::confirmClear() {
    overlay_.dismiss();
    // One canonical transaction (one undo step). Connections and their routing
    // points go with the modules; the processor prunes FX modulation routes.
    document_->edit([](FxGraph& g){g.clearProcessing();return true;});
    selected_=invalidFxNodeId;
    refresh(true);
}

// One UNDO/REDO for the page: graph edits (the bus document) and CONTROL
// edits (NODES authoring) are undone in the order they were made.
void FxPage::undo() {
    const auto graphTop=graphSequences_.empty() ? 0u : graphSequences_.back();
    if(!controlUndo_.empty() && (controlUndo_.back().sequence>graphTop || !document_->canUndo())) { undoControl(); return; }
    if(!document_->canUndo()) return;
    undoingGraph_=true;
    document_->undo();
    if(!graphSequences_.empty()) { graphRedoSequences_.push_back(graphSequences_.back()); graphSequences_.pop_back(); }
    refresh(true);
    undoingGraph_=false;
}
void FxPage::redo() {
    const auto graphNext=graphRedoSequences_.empty() ? ~std::uint64_t{0} : graphRedoSequences_.back();
    if(!controlRedo_.empty() && (controlRedo_.back().sequence<graphNext || !document_->canRedo())) { redoControl(); return; }
    if(!document_->canRedo()) return;
    undoingGraph_=true;
    document_->redo();
    if(!graphRedoSequences_.empty()) { graphSequences_.push_back(graphRedoSequences_.back()); graphRedoSequences_.pop_back(); }
    refresh(true);
    undoingGraph_=false;
}

void FxPage::commitMove(FxNodeId id,juce::Point<int> topLeft) {
    document_->edit([&](FxGraph& g){return g.moveNode(id,{float(topLeft.x),float(topLeft.y)})==FxEditResult::Ok;});
    refresh(true);
}

bool FxPage::connectPorts(FxPortRef from,FxPortRef to) {
    const bool ok=document_->edit([&](FxGraph& g) {
        g.disconnectPort(to.node,true,to.port);
        g.disconnectPort(from.node,false,from.port);
        return g.connect(from,to)==FxEditResult::Ok;
    });
    refresh(true);
    return ok;
}

void FxPage::disconnectPort(FxNodeId id,bool input,std::uint8_t port) {
    document_->edit([&](FxGraph& g){return g.disconnectPort(id,input,port)>0;});
    refresh(true);
}

void FxPage::setNodeEnabled(FxNodeId id,bool enabled) {
    document_->edit([&](FxGraph& g){return g.setEnabled(id,enabled)==FxEditResult::Ok;});
    refresh(true);
}

void FxPage::beginParameterGesture() {
    document_->beginGesture();
    gestureActive_=true;
}

void FxPage::setParameter(FxNodeId id,FxParameterId parameter,float value) {
    const auto apply=[&](FxGraph& g){return g.setParameter(id,parameter,value)==FxEditResult::Ok;};
    if(gestureActive_) document_->gestureEdit(apply); else document_->edit(apply);
    refresh(false);
}

void FxPage::endParameterGesture() {
    gestureActive_=false;
    document_->endGesture();
    refreshToolbar();
}

// The Add Module catalog. Every item carries its STRUCTURED category path
// (family, then category) from canonical metadata, so menus nest it as real
// submenus; `group` keeps the joined label for flat views and search.
namespace {
NativeChoiceItem catalogItem(int id,const juce::String& text,bool enabled,juce::StringArray path,juce::String reason={}) {
    NativeChoiceItem item{id,text,enabled,path.joinIntoString(" / "),false,std::move(reason)};
    item.path=std::move(path);
    return item;
}
// An operator type that is really in the catalog (the N04 list ends with a
// None sentinel, which must never become a blank entry).
const ControlOpInfo* catalogOpInfo(ControlOpType type) noexcept {
    const auto* info=type!=ControlOpType::None ? controlOpInfo(type) : nullptr;
    return info!=nullptr && info->label!=nullptr && info->category!=nullptr ? info : nullptr;
}
}

std::vector<NativeChoiceItem> FxPage::moduleMenuItems(bool allowSources) const {
    std::vector<NativeChoiceItem> items;
    for(const auto category:{FxCategory::Dynamics,FxCategory::FilterEq,FxCategory::Distortion,FxCategory::Modulation,
                             FxCategory::Spatial,FxCategory::Time,FxCategory::Utility})
        for(const auto& d:fxEffectCatalog())
            if(d.processesAudio && d.category==category)
                // One category (FxCategory), even when its name reads "FILTER / EQ".
                items.push_back(catalogItem(int(d.type),juce::String(d.label),true,{"AUDIO","EFFECTS",fxCategoryName(category)}));
    items.push_back(catalogItem(FxModuleMenu::splitId,"Split",true,{"AUDIO","ROUTING"}));
    items.push_back(catalogItem(FxModuleMenu::mergeId,"Merge",true,{"AUDIO","ROUTING"}));
    if(allowSources) {
        InstrumentState state;
        if(bindings_.snapshot) state=bindings_.snapshot();
        // A bus graph's audio input is its own bus.
        if(graph().sourceForBus(bus_)==invalidFxNodeId)
            items.push_back(catalogItem(FxModuleMenu::busBase+int(bus_),busName(bus_)+" IN",true,{"AUDIO","SOURCES"}));
        (void)state;
        // CONTROL: views of the instrument's own sources, and PARAMETER.
        std::vector<ModSource> primary{ModSource::Lfo1,ModSource::Lfo2,ModSource::Lfo3,ModSource::Lfo4,ModSource::Env1,ModSource::Env2,ModSource::Env3};
        for(const auto s:activeMacroSources(state.modulation)) primary.push_back(s);
        primary.push_back(ModSource::Random);
        for(const auto& a:state.modulation.instances) if(a.id) primary.push_back(instanceSource(a.id));
        for(const auto s:primary)
            if(nodes::controlSourceActive(s,state.modulation))
                items.push_back(catalogItem(FxModuleMenu::controlSourceBase+int(s),sourceName(state.modulation,s),!controlNodeShown(nodes::sourceKey(s)),{"CONTROL","MODULATION SOURCES"},"Already on the canvas"));
        for(const auto s:{ModSource::Function,ModSource::Chaos,ModSource::Drift,ModSource::Sequencer,
                          ModSource::Velocity,ModSource::ModWheel,ModSource::Keytrack,ModSource::Aftertouch,ModSource::PitchBend,ModSource::NoteGate})
            if(nodes::controlSourceActive(s,state.modulation))
                items.push_back(catalogItem(FxModuleMenu::controlSourceBase+int(s),sourceName(state.modulation,s),!controlNodeShown(nodes::sourceKey(s)),{"CONTROL","MODULATION SOURCES"},"Already on the canvas"));
        // Processing nodes: family (CONTROL / EVENT / SEQUENCING), then the
        // node's own category from its ControlOpInfo.
        const auto addOps=[&](const auto& catalog,const char* family) {
            for(const auto type:catalog)
                if(const auto* info=catalogOpInfo(type)) {
                    const bool creatable=nodes::controlOperatorCreatable(state.modulation,type);
                    juce::StringArray path;
                    if(type==ControlOpType::Transport) path={"EVENTS","TRANSPORT"};
                    else if(juce::String(family)=="EVENTS" && juce::String(info->category)=="Sources") path={"EVENTS","NOTE / GATE / TRIGGER"};
                    else if(juce::String(info->category)=="Targets") path={"EVENTS","TARGETS"};
                    else if(juce::String(family)=="EVENTS") path={"LOGIC / GENERATIVE",juce::String(info->category).toUpperCase()};
                    else path={family,juce::String(info->category).toUpperCase()};
                    items.push_back(catalogItem(FxModuleMenu::controlOperatorBase+int(type),juce::String(info->label),creatable,
                                                path,
                                                creatable ? juce::String() : juce::String("The instrument has one sequencer: it is already on the canvas")));
                }
        };
        addOps(controlOpCatalog(),"CONTROL");
        addOps(controlEventOpCatalog(),"EVENTS");
        addOps(controlSequencingOpCatalog(),"LOGIC / GENERATIVE");
        items.push_back(catalogItem(FxModuleMenu::parameterPickerId,"Parameter...",true,{"CONTROL","UTILITIES"}));
    }
    return items;
}

std::vector<int> FxPage::moduleMenuIds(bool allowSources) const {
    std::vector<int> ids;
    for(const auto& item:moduleMenuItems(allowSources)) if(item.enabled) ids.push_back(item.id);
    return ids;
}

void FxPage::showModuleMenu(juce::Component& anchor,bool allowSources,std::function<void(FxModuleSpec)> chosen,
                            std::optional<FxPoint> at) {
    juce::Component::SafePointer<FxPage> safe(this);
    juce::Component::SafePointer<juce::Component> anchorRef(&anchor);
    showNativeChoiceMenu(anchor,"ADD MODULE",moduleMenuItems(allowSources),0,[safe,chosen,at,anchorRef](int choice) {
        if(safe==nullptr) return;
        if(choice>=FxModuleMenu::controlOperatorBase) { safe->addControlOperator(static_cast<ControlOpType>(choice-FxModuleMenu::controlOperatorBase),at); return; }
        if(choice>=FxModuleMenu::controlSourceBase) { safe->addControlSource(static_cast<ModSource>(choice-FxModuleMenu::controlSourceBase),at); return; }
        if(choice==FxModuleMenu::parameterPickerId) { safe->showParameterPicker(anchorRef!=nullptr ? *anchorRef : *safe,std::nullopt,at); return; }
        if(const auto spec=FxModuleMenu::decode(choice); spec && chosen) chosen(*spec);
    },NativeMenuLayout::Hierarchical);
}

// ================================================================ CONTROL layer

juce::Slider& FxPage::controlAmountSlider() noexcept { return controlInspector_->amountSlider(); }
juce::Button& FxPage::controlEnabledButton() noexcept { return controlInspector_->enabledButton(); }
juce::Button& FxPage::controlPolarityButton() noexcept { return controlInspector_->polarityButton(); }
juce::Slider* FxPage::controlSequenceControl(std::size_t index) noexcept { return controlInspector_->sequenceControl(index); }

bool FxPage::controlNodeShown(const nodes::ControlNodeKey& key) const noexcept {
    const auto index=controlGraph_.find(key);
    return index && *index<controlNodeShown_.size() && controlNodeShown_[*index];
}

bool FxPage::controlLinkShown(std::uint32_t route) const noexcept {
    for(std::size_t i=0;i<controlGraph_.links.size();++i)
        if(controlGraph_.links[i].routeId==route) return i<controlLinkShown_.size() && controlLinkShown_[i];
    return false;
}

juce::String FxPage::controlNodeTitle(const nodes::ControlNodeKey& key) const {
    if(key.kind==nodes::ControlNodeKind::Operator) {
        if(const auto* op=findControlOperator(controlModulation_,key.op))
            if(const auto* info=controlOpInfo(op->type)) return juce::String(info->label);
        return "OPERATOR";
    }
    return key.kind==nodes::ControlNodeKind::Source ? sourceName(controlModulation_,key.source) : juce::String("PARAMETER");
}

juce::String FxPage::controlNodeDetail(const nodes::ControlNodeKey& key) const {
    if(key.kind==nodes::ControlNodeKind::Source) return "CONTROL OUT";
    if(key.kind==nodes::ControlNodeKind::Operator) {
        const auto* op=findControlOperator(controlModulation_,key.op);
        const auto* info=op ? controlOpInfo(op->type) : nullptr;
        if(info==nullptr) return {};
        const auto dot=juce::String(juce::CharPointer_UTF8(" \xc2\xb7 "));
        if(op->type==ControlOpType::Clock)
            return op->params[0]>=0.5f ? "SYNC"+dot+clockDivisionLabel(int(std::lround(op->params[2])))
                                       : "FREE"+dot+juce::String(op->params[1],2)+" Hz";
        if(info->output==ControlSignal::Gate) return juce::String(info->category).toUpperCase()+dot+"GATE OUT";
        if(info->output==ControlSignal::Event) return juce::String(info->category).toUpperCase()+dot+"EVENT OUT";
        if(info->output==ControlSignal::None) return juce::String(info->category).toUpperCase();
        const bool bipolar=sourceRange(operatorSource(key.op),controlModulation_)==ControlRange::Bipolar;
        return juce::String(info->category).toUpperCase()+dot+(bipolar ? "BIPOLAR" : "UNIPOLAR");
    }
    const auto label=modulationDestinationLabel(destinationCatalog_,key.destination);
    return label.isNotEmpty() ? label : juce::String("UNAVAILABLE DESTINATION");
}

bool FxPage::connectableControl(ModSource source,const ModAddress& address) const {
    if(!bindings_.snapshot) return false;
    const auto check=nodes::checkControlLink(bindings_.snapshot(),source,address);
    return check.creatable() || check.result==nodes::ControlLinkResult::Exists;
}

void FxPage::refreshControl() {
    ++uiDiagnostics_.controlRebuilds;
    InstrumentState state;
    if(bindings_.snapshot) state=bindings_.snapshot();
    controlModulation_=state.modulation;
    visualPlan_->compile(state.modulation,state.oscillators,true);
    destinationCatalog_=modulationDestinationCatalog(state,bindings_);
    auto& layout=controlLayout();
    controlGraph_=nodes::deriveControlGraph(state.modulation,layout);
    // Pin default positions of shown nodes so nothing jumps when other
    // relationships appear or disappear (view metadata only).
    if(isShowing())
        for(const auto& node:controlGraph_.nodes)
            if(const auto* e=layout.find(node.key); e==nullptr || !e->positioned) layout.setPosition(node.key,node.x,node.y);
    // Visibility: NODES parameters belong to one bus graph and are shown only
    // over that bus; everything else is instrument-wide.
    const auto& graph=controlGraph_;
    controlNodeShown_.assign(graph.nodes.size(),false);
    controlLinkShown_.assign(graph.links.size(),false);
    const auto onThisBus=[this](const nodes::ControlGraphNode& n) {
        return n.key.kind!=nodes::ControlNodeKind::Parameter || !isFxDestination(n.key.destination.parameter)
            || fxAddressBus(n.key.destination)==bus_;
    };
    for(std::size_t i=0;i<graph.links.size();++i)
        if(onThisBus(graph.nodes[graph.links[i].parameter])) {
            controlLinkShown_[i]=true;
            controlNodeShown_[graph.links[i].source]=true;
            controlNodeShown_[graph.links[i].parameter]=true;
        }
    for(std::size_t i=0;i<graph.nodes.size();++i)
        if((graph.nodes[i].placed || graph.nodes[i].key.kind==nodes::ControlNodeKind::Operator) && onThisBus(graph.nodes[i]))
            controlNodeShown_[i]=true;
    // A selection whose relationship vanished (deleted in any view) clears.
    if(controlSelection_.kind==ControlSelection::Kind::Link && !controlLinkShown(controlSelection_.route)) controlSelection_={};
    if(controlSelection_.kind==ControlSelection::Kind::Node && !controlNodeShown(controlSelection_.key)) controlSelection_={};
    controlMulti_.erase(std::remove_if(controlMulti_.begin(),controlMulti_.end(),[this](const nodes::ControlNodeKey& k){ return !controlNodeShown(k); }),controlMulti_.end());
    if(controlSelection_.kind==ControlSelection::Kind::Edge) {
        const auto* op=findControlOperator(state.modulation,controlSelection_.op);
        if(op==nullptr || op->inputs[controlSelection_.input].kind==ControlInput::Kind::None) controlSelection_={};
    }

    std::vector<bool> linkedNode(graph.nodes.size(),false);
    for(const auto& l:graph.links) linkedNode[l.source]=linkedNode[l.parameter]=true;
    // The one inline control per operator type (full editing: inspector).
    const auto primaryFor=[](const ControlOperator& op) {
        switch(op.type) {
        case ControlOpType::ScaleOffset: case ControlOpType::Constant: case ControlOpType::Smooth: case ControlOpType::Quantize:
        case ControlOpType::Threshold: case ControlOpType::Pulse: case ControlOpType::Counter: return 0;
        case ControlOpType::Curve: return 1;
        case ControlOpType::Clock: return op.params[0]>=0.5f ? 2 : 1; // DIVISION when synced, else RATE
        // N06
        case ControlOpType::Sequencer: case ControlOpType::Probability: case ControlOpType::ChanceSplit:
        case ControlOpType::Pattern: case ControlOpType::RandomWalk: return 0;
        case ControlOpType::Euclidean: return 1;
        case ControlOpType::EventDelay: return op.params[0]>=0.5f ? 2 : 1;
        default: return -1;
        }
    };
    std::vector<FxCanvas::ControlNodeView> views;
    for(std::size_t i=0;i<graph.nodes.size();++i) {
        if(!controlNodeShown_[i]) continue;
        const auto& n=graph.nodes[i];
        const auto* entry=layout.find(n.key);
        const bool positioned=entry!=nullptr && entry->positioned;
        FxCanvas::ControlNodeView v;
        v.key=n.key;
        v.x=positioned ? entry->x : n.x;
        v.y=positioned ? entry->y : n.y;
        v.title=controlNodeTitle(n.key);
        v.detail=controlNodeDetail(n.key);
        v.domain=n.domain;
        v.selected=controlNodeSelected(n.key);
        v.linked=linkedNode[i];
        v.removable=n.key.kind==nodes::ControlNodeKind::Operator || !linkedNode[i];
        if(n.key.kind==nodes::ControlNodeKind::Operator)
            if(const auto* op=findControlOperator(state.modulation,n.key.op))
                if(const auto* info=controlOpInfo(op->type)) {
                    v.inputs=info->inputs;
                    for(std::size_t k=0;k<3;++k) { v.inputNames[k]=controlInputName(*info,k); v.inputSignals[k]=info->inputSignals[k]; }
                    v.outputSignal=info->output;
                    v.opType=op->type;
                    v.outputs=info->outputCount;
                    for(std::size_t p=0;p<maxControlOutputs;++p) {
                        v.outputSignals[p]=controlOutputSignalOf(*info,p);
                        v.outputNames[p]=info->outputCount>1 || info->outputNames[p]!=nullptr ? juce::String(controlOutputName(*info,p)) : juce::String();
                    }
                    for(std::size_t k=0;k<3;++k) v.inputConnected[k]=op->inputs[k].kind!=ControlInput::Kind::None;
                    // N06 previews (the canonical sequence; pattern / euclidean cells).
                    if(op->type==ControlOpType::Sequencer) {
                        v.preview=ControlNodeView::Preview::Sequencer;
                        v.cellCount=int(std::clamp<std::uint32_t>(state.modulation.sequencer.activeSteps,1,8));
                        for(int c=0;c<v.cellCount;++c) v.cells[std::size_t(c)]=state.modulation.sequencer.steps[std::size_t(c)];
                    } else if(op->type==ControlOpType::Pattern) {
                        v.preview=ControlNodeView::Preview::Pattern;
                        v.cellCount=juce::jlimit(1,32,juce::roundToInt(op->params[0]));
                        const auto bits=std::uint32_t(juce::roundToInt(op->params[1]))|(std::uint32_t(juce::roundToInt(op->params[2]))<<16);
                        for(int c=0;c<v.cellCount;++c) v.cells[std::size_t(c)]=((bits>>c)&1u)!=0 ? 1.0f : 0.0f;
                    } else if(op->type==ControlOpType::Euclidean) {
                        v.preview=ControlNodeView::Preview::Euclidean;
                        v.cellCount=juce::jlimit(1,32,juce::roundToInt(op->params[0]));
                        for(int c=0;c<v.cellCount;++c)
                            v.cells[std::size_t(c)]=euclideanHit(v.cellCount,juce::roundToInt(op->params[1]),juce::roundToInt(op->params[2]),c) ? 1.0f : 0.0f;
                    }
                    const int primary=primaryFor(*op);
                    if(primary>=0 && primary<int(info->parameterCount)) {
                        const auto& p=info->parameters[std::size_t(primary)];
                        v.primaryParameter=primary;
                        v.primaryLabel=p.label;
                        v.primaryValue=op->params[std::size_t(primary)];
                        v.primaryMinimum=p.minimum;
                        v.primaryMaximum=p.maximum;
                        v.primaryInteger=p.integer;
                    }
                }
        views.push_back(v);
    }
    std::vector<FxCanvas::ControlLinkView> links;
    for(std::size_t i=0;i<graph.links.size();++i) {
        if(!controlLinkShown_[i]) continue;
        const auto& l=graph.links[i];
        bool enabled=true;
        if(l.isRoute()) for(const auto& r:state.modulation.routes) if(r.id==l.routeId) enabled=r.enabled && r.amount!=0.0f;
        const bool selected=l.isRoute() ? controlSelection_.kind==ControlSelection::Kind::Link && controlSelection_.route==l.routeId
                                        : controlSelection_.kind==ControlSelection::Kind::Edge && controlSelection_.op==l.targetOperator
                                          && controlSelection_.input==l.targetInput;
        ControlSignal signal=ControlSignal::Control;
        if(graph.nodes[l.source].key.kind==nodes::ControlNodeKind::Operator)
            if(const auto* op=findControlOperator(state.modulation,graph.nodes[l.source].key.op))
                if(const auto* info=controlOpInfo(op->type)) signal=controlOutputSignalOf(*info,l.sourcePort);
        links.push_back({l.routeId,graph.nodes[l.source].key,graph.nodes[l.parameter].key,l.targetOperator,l.targetInput,l.supported,enabled,selected,signal,l.sourcePort});
    }
    canvas_.rebuildControl(views,links);
    const bool control=controlSelection_.kind!=ControlSelection::Kind::None;
    modulePanel_->setControlMode(control);
    if(control) controlInspector_->show(controlSelection_,state);
}

bool FxPage::addControlSource(ModSource source,std::optional<FxPoint> at) {
    if(!bindings_.snapshot || !nodes::controlSourceExposed(source)
       || !nodes::controlSourceActive(source,bindings_.snapshot().modulation)) return false;
    auto& layout=controlLayout();
    const auto key=nodes::sourceKey(source);
    layout.setPlaced(key,true);
    if(at) layout.setPosition(key,at->x,at->y); // else: the CONTROL column below the audio graph
    refreshControl();
    selectControlNode(key);
    return true;
}

bool FxPage::addParameterNode(const ModAddress& address,std::optional<FxPoint> at) {
    if(address.parameter==ModDestination::None) return false;
    auto& layout=controlLayout();
    const auto key=nodes::parameterKey(address);
    layout.setPlaced(key,true);
    if(at) layout.setPosition(key,at->x,at->y);
    refreshControl();
    selectControlNode(key);
    return true;
}

nodes::ControlLinkCheck FxPage::connectControl(ModSource source,const ModAddress& address) {
    nodes::ControlLinkCheck check;
    if(!bindings_.snapshot || !bindings_.addRoute || !bindings_.route || !bindings_.removeRoute) return check;
    check=nodes::checkControlLink(bindings_.snapshot(),source,address);
    if(check.result==nodes::ControlLinkResult::Exists) { refreshControl(); selectControlLink(check.existingRoute); return check; }
    if(!check.creatable()) return check;
    pushControlUndo();
    // The canonical route, through the same bindings as SYNTH and the Matrix:
    // a blank route (ON / UNIPOLAR / none / none / 0%) whose ends are then set.
    const auto id=bindings_.addRoute();
    ModRoute route{};
    for(const auto& r:bindings_.snapshot().modulation.routes) if(r.id==id) route=r;
    route.source=source;
    route.destination=address;
    if(id==0 || route.id!=id || !bindings_.route(route)) {
        if(id!=0) bindings_.removeRoute(id);
        check.result=nodes::ControlLinkResult::DestinationUnavailable;
        return check;
    }
    check.existingRoute=id;
    refreshControl();
    selectControlLink(id);
    return check;
}

bool FxPage::deleteControlLink(std::uint32_t route) {
    if(route==0 || !bindings_.removeRoute) return false;
    pushControlUndo();
    const bool removed=bindings_.removeRoute(route);
    if(removed && controlSelection_.kind==ControlSelection::Kind::Link && controlSelection_.route==route) controlSelection_={};
    refreshControl();
    return removed;
}

bool FxPage::updateControlLink(const ModRoute& route) {
    if(!bindings_.route || route.id==0) return false;
    if(!operatorGesture_) pushControlUndo();
    if(!bindings_.route(route)) { if(!operatorGesture_ && !controlUndo_.empty()) controlUndo_.pop_back(); return false; }
    refreshControl();
    return true;
}

bool FxPage::removeControlNode(const nodes::ControlNodeKey& key) {
    if(key.kind==nodes::ControlNodeKind::Operator) return deleteControlOperator(key.op);
    if(bindings_.snapshot)
        for(const auto& r:bindings_.snapshot().modulation.routes)
            if(r.id && routeComplete(r) && (key.kind==nodes::ControlNodeKind::Source ? r.source==key.source : r.destination==key.destination))
                return false; // linked: delete its relationships first
    const bool removed=controlLayout().remove(key);
    if(controlSelection_.kind==ControlSelection::Kind::Node && controlSelection_.key==key) controlSelection_={};
    refreshControl();
    return removed;
}

void FxPage::moveControlNode(const nodes::ControlNodeKey& key,FxPoint at,bool commit) {
    if(commit) pushControlUndo(); // a completed move is one undo step
    controlLayout().setPosition(key,at.x,at.y);
    if(commit) refreshControl();
}

// ---------------------------------------------------------------- N04 operators

FxPage::ControlSnapshot FxPage::captureControl(bool withSequencer) const {
    ControlSnapshot snapshot;
    if(bindings_.snapshot) {
        const auto m=bindings_.snapshot().modulation;
        snapshot.routes=m.routes; snapshot.nextRouteId=m.nextRouteId;
        snapshot.operators=m.operators; snapshot.nextOperatorId=m.nextOperatorId;
        snapshot.hasSequencer=withSequencer;
        snapshot.sequencer=m.sequencer;
    }
    snapshot.layout=host_.controlLayout!=nullptr ? *host_.controlLayout : localControlLayout_;
    return snapshot;
}

bool FxPage::applyControl(const ControlSnapshot& snapshot) {
    if(!bindings_.snapshot || !bindings_.modulation) return false;
    // Only the CONTROL relationships are restored; source settings are untouched.
    auto m=bindings_.snapshot().modulation;
    m.routes=snapshot.routes; m.nextRouteId=std::max(m.nextRouteId,snapshot.nextRouteId);
    m.operators=snapshot.operators; m.nextOperatorId=std::max(m.nextOperatorId,snapshot.nextOperatorId);
    if(snapshot.hasSequencer) m.sequencer=snapshot.sequencer; // sequence edits only
    // N07: a layout-only step (move, align, auto layout) never republishes the
    // model, so it can never reach the engine or the compiler.
    const auto current=bindings_.snapshot().modulation;
    const auto sameRoutes=[&]{ for(std::size_t i=0;i<m.routes.size();++i) { const auto& a=m.routes[i]; const auto& b=current.routes[i]; if(a.id!=b.id || a.enabled!=b.enabled || a.source!=b.source || !(a.destination==b.destination) || a.amount!=b.amount || a.bipolar!=b.bipolar) return false; } return true; };
    const bool modelChanged=!sameRoutes() || m.operators!=current.operators || m.nextOperatorId!=current.nextOperatorId
                         || m.nextRouteId!=current.nextRouteId || (snapshot.hasSequencer && std::memcmp(&m.sequencer,&current.sequencer,sizeof(SequencerSettings))!=0);
    if(modelChanged && !bindings_.modulation(m)) return false;
    controlLayout()=snapshot.layout;
    refreshControl();
    refreshToolbar();
    return true;
}

void FxPage::pushControlUndo(bool withSequencer) {
    auto snapshot=captureControl(withSequencer);
    snapshot.sequence=++editSequence_;
    controlUndo_.push_back(std::move(snapshot));
    if(controlUndo_.size()>64) controlUndo_.erase(controlUndo_.begin());
    controlRedo_.clear();
    refreshToolbar();
}

bool FxPage::commitControl(const ModulationState& next) {
    if(!bindings_.modulation) return false;
    pushControlUndo();
    if(!bindings_.modulation(next)) { controlUndo_.pop_back(); refreshToolbar(); return false; }
    refreshControl();
    return true;
}

bool FxPage::undoControl() {
    if(controlUndo_.empty()) return false;
    auto target=controlUndo_.back();
    controlUndo_.pop_back();
    auto current=captureControl(target.hasSequencer);
    current.sequence=target.sequence;
    controlRedo_.push_back(std::move(current));
    return applyControl(target);
}

bool FxPage::redoControl() {
    if(controlRedo_.empty()) return false;
    auto target=controlRedo_.back();
    controlRedo_.pop_back();
    auto current=captureControl(target.hasSequencer);
    current.sequence=target.sequence;
    controlUndo_.push_back(std::move(current));
    return applyControl(target);
}

void FxPage::placeOperatorBetween(std::uint32_t id,const nodes::ControlNodeKey& from,const nodes::ControlNodeKey& to) {
    // Where each end is drawn now: its stored position, else its derived one.
    const auto position=[this](const nodes::ControlNodeKey& key)->std::optional<juce::Point<float>> {
        if(const auto* e=controlLayout().find(key); e!=nullptr && e->positioned) return juce::Point<float>(e->x,e->y);
        if(const auto i=controlGraph_.find(key)) return juce::Point<float>(controlGraph_.nodes[*i].x,controlGraph_.nodes[*i].y);
        return std::nullopt;
    };
    const auto a=position(from),b=position(to);
    if(a && b) controlLayout().setPosition(nodes::operatorKey(id),(a->x+b->x)*0.5f,(a->y+b->y)*0.5f);
}

std::optional<std::uint32_t> FxPage::addControlOperator(ControlOpType type,std::optional<FxPoint> at) {
    if(!bindings_.snapshot) return std::nullopt;
    ModulationState next; std::uint32_t id=0;
    if(!nodes::addControlOperator(bindings_.snapshot().modulation,type,next,id)) return std::nullopt;
    if(!commitControl(next)) return std::nullopt;
    if(at) controlLayout().setPosition(nodes::operatorKey(id),at->x,at->y);
    selectControlNode(nodes::operatorKey(id));
    return id;
}

bool FxPage::canConnectControlEdge(const nodes::ControlEndpoint& from,const nodes::ControlEndpoint& to) const {
    if(!bindings_.snapshot) return false;
    const auto check=nodes::checkControlEdge(bindings_.snapshot(),from,to);
    return check.creatable() || check.result==nodes::ControlLinkResult::Exists;
}

namespace {
// N07: concise, specific reasons for a refused connection (graph feedback).
juce::String connectionReason(const nodes::ControlLinkCheck& check,const ModulationState& m,const nodes::ControlEndpoint& from,const nodes::ControlEndpoint& to) {
    using R=nodes::ControlLinkResult;
    const auto name=[](ControlSignal s){ return juce::String(controlSignalName(s)); };
    switch(check.result) {
    case R::TypeMismatch: {
        const auto into=name(nodes::controlInputSignal(m,to));
        return name(nodes::controlOutputSignal(m,from))+" output cannot feed "+(into.startsWithChar('E') ? "an " : "a ")+into+" input";
    }
    case R::DomainCrossing: return "Per-voice output cannot drive a global parameter or node";
    case R::InputOccupied: return "Input already connected";
    case R::WouldCreateCycle: return "That connection would create a feedback loop";
    case R::DestinationUnavailable: return "Parameter not available in this instrument";
    case R::CapacityExceeded: return "Modulation is full (32 routes)";
    case R::SourceInactive: return "Source not active: add it on SYNTH first";
    case R::SourceNotExposed: return "That source is not available in NODES";
    default: return "Not a valid connection";
    }
}
}

nodes::ControlLinkCheck FxPage::connectControlEdge(const nodes::ControlEndpoint& from,const nodes::ControlEndpoint& to) {
    nodes::ControlLinkCheck check;
    if(!bindings_.snapshot) return check;
    if(to.kind==nodes::ControlEndpoint::Kind::Parameter) {
        check=connectControl(from.outputSource(),to.destination);
        if(!check.creatable() && check.result!=nodes::ControlLinkResult::Exists) {
            ++uiDiagnostics_.rejectedConnections;
            showGraphFeedback(connectionReason(check,controlModulation_,from,to));
        }
        return check;
    }
    const auto state=bindings_.snapshot();
    check=nodes::checkControlEdge(state,from,to);
    if(!check.creatable()) {
        ++uiDiagnostics_.rejectedConnections;
        showGraphFeedback(connectionReason(check,state.modulation,from,to));
        return check;
    }
    ModulationState next;
    if(!nodes::connectControlInput(state,from,to.op,to.input,next) || !commitControl(next)) {
        check.result=nodes::ControlLinkResult::InvalidPort;
        return check;
    }
    selectControlEdge(to.op,to.input);
    return check;
}

bool FxPage::disconnectControlInput(std::uint32_t op,std::uint8_t input) {
    if(!bindings_.snapshot) return false;
    ModulationState next;
    if(!nodes::disconnectControlInput(bindings_.snapshot().modulation,op,input,next)) return false;
    if(controlSelection_.kind==ControlSelection::Kind::Edge) controlSelection_={};
    return commitControl(next);
}

std::optional<std::uint32_t> FxPage::insertControlOperatorOnRoute(std::uint32_t route,ControlOpType type) {
    if(!bindings_.snapshot) return std::nullopt;
    const auto state=bindings_.snapshot();
    ModulationState next; std::uint32_t id=0;
    if(!nodes::insertControlOperatorOnRoute(state,route,type,next,id)) return std::nullopt;
    pushControlUndo();
    for(const auto& r:state.modulation.routes)
        if(r.id==route)
            placeOperatorBetween(id,isOperatorSource(r.source) ? nodes::operatorKey(operatorIdOf(r.source)) : nodes::sourceKey(r.source),
                                 nodes::parameterKey(r.destination));
    if(!bindings_.modulation || !bindings_.modulation(next)) { applyControl(controlUndo_.back()); controlUndo_.pop_back(); return std::nullopt; }
    refreshControl();
    selectControlNode(nodes::operatorKey(id));
    return id;
}

std::optional<std::uint32_t> FxPage::insertControlOperatorOnInput(std::uint32_t op,std::uint8_t input,ControlOpType type) {
    if(!bindings_.snapshot) return std::nullopt;
    const auto state=bindings_.snapshot();
    ModulationState next; std::uint32_t id=0;
    if(!nodes::insertControlOperatorOnInput(state,op,input,type,next,id)) return std::nullopt;
    pushControlUndo();
    if(const auto* target=findControlOperator(state.modulation,op)) {
        const auto& in=target->inputs[input];
        placeOperatorBetween(id,in.kind==ControlInput::Kind::Source ? nodes::sourceKey(in.source) : nodes::operatorKey(in.op),nodes::operatorKey(op));
    }
    if(!bindings_.modulation || !bindings_.modulation(next)) { applyControl(controlUndo_.back()); controlUndo_.pop_back(); return std::nullopt; }
    refreshControl();
    selectControlNode(nodes::operatorKey(id));
    return id;
}

bool FxPage::deleteControlOperator(std::uint32_t op) {
    if(!bindings_.snapshot) return false;
    ModulationState next;
    if(!nodes::deleteControlOperator(bindings_.snapshot().modulation,op,next)) return false;
    pushControlUndo();
    if(!bindings_.modulation || !bindings_.modulation(next)) { controlUndo_.pop_back(); refreshToolbar(); return false; }
    controlLayout().remove(nodes::operatorKey(op));
    if(controlSelection_.key==nodes::operatorKey(op) || controlSelection_.op==op) controlSelection_={};
    refreshControl();
    return true;
}

std::optional<std::uint32_t> FxPage::duplicateControlOperator(std::uint32_t op) {
    if(!bindings_.snapshot) return std::nullopt;
    const auto m=bindings_.snapshot().modulation;
    const auto* original=findControlOperator(m,op);
    if(original==nullptr) return std::nullopt;
    ModulationState next; std::uint32_t id=0;
    if(!nodes::addControlOperator(m,original->type,next,id)) return std::nullopt;
    next.operators[controlOperatorSlot(next,id)].params=original->params; // settings, never connections
    // N07: placed just below the original (never on top of it), then selected.
    const auto original_=nodeRect(canvas_,nodes::operatorKey(op));
    if(!commitControl(next)) return std::nullopt;
    if(!original_.isEmpty()) controlLayout().setPosition(nodes::operatorKey(id),original_.getX(),original_.getBottom()+20.0f);
    selectControlNode(nodes::operatorKey(id));
    return id;
}

// ---------------------------------------------------------------- N06 typed menus / drag-to-create

namespace {
template<typename Fn> void forEachControlNodeType(Fn&& fn) {
    for(const auto type:controlOpCatalog()) if(catalogOpInfo(type)!=nullptr) fn(type);
    for(const auto type:controlEventOpCatalog()) if(catalogOpInfo(type)!=nullptr) fn(type);
    for(const auto type:controlSequencingOpCatalog()) if(catalogOpInfo(type)!=nullptr) fn(type);
}
juce::String controlMenuGroup(const ControlOpInfo& info,const juce::String& prefix) {
    return prefix+juce::String(info.category).toUpperCase();
}
}

std::vector<ControlOpType> FxPage::controlInsertTypes(std::uint32_t route,std::uint32_t op,std::uint8_t input) const {
    std::vector<ControlOpType> types;
    if(!bindings_.snapshot) return types;
    const auto& m=controlModulation_;
    // What the cable carries (its source port's signal) and what its consumer expects.
    ControlSignal carried=ControlSignal::Control,expected=ControlSignal::Control;
    if(route==0) {
        const auto* target=findControlOperator(m,op);
        const auto* info=target ? controlOpInfo(target->type) : nullptr;
        if(info==nullptr || input>=info->inputs) return types;
        expected=info->inputSignals[input];
        const auto& in=target->inputs[input];
        carried=in.kind==ControlInput::Kind::Operator
            ? nodes::controlOutputSignal(m,nodes::ControlEndpoint::fromOperator(in.op,in.port)) : ControlSignal::Control;
    }
    forEachControlNodeType([&](ControlOpType type) {
        const auto* info=controlOpInfo(type);
        if(info==nullptr || info->inputs==0 || info->inputSignals[0]!=carried) return;
        if(nodes::controlAutoOutputPort(*info,expected)<0 || !nodes::controlOperatorCreatable(m,type)) return;
        if(std::find(types.begin(),types.end(),type)==types.end()) types.push_back(type);
    });
    return types;
}

std::vector<NativeChoiceItem> FxPage::controlCreateItems(const nodes::ControlEndpoint& dangling) const {
    std::vector<NativeChoiceItem> items;
    if(!bindings_.snapshot) return items;
    const auto& m=controlModulation_;
    const bool fromOutput=dangling.isOutput();
    const auto signal=fromOutput ? nodes::controlOutputSignal(m,dangling) : nodes::controlInputSignal(m,dangling);
    if(signal==ControlSignal::None) return items;
    forEachControlNodeType([&](ControlOpType type) {
        const auto* info=controlOpInfo(type);
        if(info==nullptr) return;
        bool fits=false;
        if(fromOutput) { for(std::uint8_t k=0;k<info->inputs;++k) fits|=info->inputSignals[k]==signal; }
        else fits=nodes::controlAutoOutputPort(*info,signal)>=0;
        if(!fits) return;
        const bool creatable=nodes::controlOperatorCreatable(m,type);
        NativeChoiceItem item{FxModuleMenu::controlOperatorBase+int(type),juce::String(info->label),creatable,
                              controlMenuGroup(*info,juce::String(nodes::toString(nodes::nodeSignal(signal)))+" / "),false,
                              creatable ? juce::String() : juce::String("The instrument has one sequencer")};
        item.path={nodes::toString(nodes::nodeSignal(signal)),juce::String(info->category).toUpperCase()};
        items.push_back(item);
    });
    // CONTROL only: a PARAMETER terminates the cable; a canonical source feeds it.
    if(signal==ControlSignal::Control && fromOutput) items.push_back({FxModuleMenu::parameterPickerId,"Parameter...",true,"CONTROL"});
    if(signal==ControlSignal::Control && !fromOutput) {
        std::vector<ModSource> feeds{ModSource::Lfo1,ModSource::Lfo2,ModSource::Lfo3,ModSource::Lfo4,ModSource::Env1,ModSource::Env2,ModSource::Env3};
        for(const auto& a:m.instances) if(a.id) feeds.push_back(instanceSource(a.id));
        for(const auto macro:activeMacroSources(m)) feeds.push_back(macro);
        feeds.push_back(ModSource::Random); feeds.push_back(ModSource::Sequencer);
        for(const auto s:feeds)
            if(nodes::controlSourceExposed(s) && nodes::controlSourceActive(s,m))
                { NativeChoiceItem item{FxModuleMenu::controlSourceBase+int(s),sourceName(m,s),true,"CONTROL / SOURCES"}; item.path={"CONTROL","SOURCES"}; items.push_back(item); }
    }
    return items;
}

void FxPage::showControlCreateMenu(juce::Component& anchor,const nodes::ControlEndpoint& dangling,FxPoint at) {
    // N07: the searchable palette, filtered for the dangling cable.
    if(!paletteEntries(dangling).empty()) { showNodePalette(at,dangling); return; }
    const auto items=controlCreateItems(dangling);
    if(items.empty()) return;
    juce::Component::SafePointer<FxPage> safe(this);
    juce::Component::SafePointer<juce::Component> anchorRef(&anchor);
    showNativeChoiceMenu(anchor,dangling.isOutput() ? "CONNECT TO" : "FEED FROM",items,0,[safe,dangling,at,anchorRef](int choice) {
        if(safe==nullptr) return;
        if(choice==FxModuleMenu::parameterPickerId) {
            safe->showParameterPicker(anchorRef!=nullptr ? *anchorRef : *safe,dangling.outputSource(),at);
            return;
        }
        if(choice>=FxModuleMenu::controlOperatorBase) {
            safe->createConnectedControlOperator(static_cast<ControlOpType>(choice-FxModuleMenu::controlOperatorBase),dangling,at);
            return;
        }
        if(choice>=FxModuleMenu::controlSourceBase) {
            const auto source=static_cast<ModSource>(choice-FxModuleMenu::controlSourceBase);
            safe->addControlSource(source,at);
            safe->connectControlEdge(nodes::ControlEndpoint::fromSource(source),dangling);
        }
    });
}

std::optional<std::uint32_t> FxPage::createConnectedControlOperator(ControlOpType type,const nodes::ControlEndpoint& dangling,std::optional<FxPoint> at) {
    if(!bindings_.snapshot || !bindings_.modulation) return std::nullopt;
    auto state=bindings_.snapshot();
    const auto* info=controlOpInfo(type);
    if(info==nullptr) return std::nullopt;
    ModulationState next; std::uint32_t id=0;
    if(!nodes::addControlOperator(state.modulation,type,next,id)) return std::nullopt;
    auto probe=state; probe.modulation=next;
    ModulationState connected;
    if(dangling.isOutput()) {
        // Into the first input that takes the cable's signal.
        const auto signal=nodes::controlOutputSignal(state.modulation,dangling);
        std::optional<std::uint8_t> input;
        for(std::uint8_t k=0;k<info->inputs && !input;++k) if(info->inputSignals[k]==signal) input=k;
        if(!input || !nodes::connectControlInput(probe,dangling,id,*input,connected)) return std::nullopt;
    } else {
        // From the one output port that matches the input (never a guess).
        const int port=nodes::controlAutoOutputPort(*info,nodes::controlInputSignal(state.modulation,dangling));
        if(port<0 || dangling.kind!=nodes::ControlEndpoint::Kind::OperatorInput) return std::nullopt;
        if(!nodes::connectControlInput(probe,nodes::ControlEndpoint::fromOperator(id,std::uint8_t(port)),dangling.op,dangling.input,connected)) return std::nullopt;
    }
    if(!commitControl(connected)) return std::nullopt; // node + connection: one undo step
    if(at) controlLayout().setPosition(nodes::operatorKey(id),at->x,at->y);
    selectControlNode(nodes::operatorKey(id));
    return id;
}

bool FxPage::togglePatternStep(std::uint32_t op,int step) {
    if(!bindings_.snapshot || step<0 || step>=32) return false;
    const auto& m=controlModulation_;
    const auto* node=findControlOperator(m,op);
    if(node==nullptr || node->type!=ControlOpType::Pattern) return false;
    // Steps 1-16 and 17-32 are two integer bit-mask parameters.
    const std::size_t index=step<16 ? 1 : 2;
    const auto bits=std::uint32_t(juce::roundToInt(node->params[index]))^(1u<<std::uint32_t(step%16));
    return setOperatorParameter(op,index,float(bits));
}

SequencerSettings FxPage::sequencerSettings() const {
    return bindings_.snapshot ? bindings_.snapshot().modulation.sequencer : SequencerSettings{};
}

bool FxPage::setSequencerSettings(const SequencerSettings& settings) {
    if(!bindings_.snapshot || !bindings_.modulation) return false;
    auto m=bindings_.snapshot().modulation;
    const auto& a=m.sequencer;
    if(a.rateHz==settings.rateHz && a.steps==settings.steps && a.activeSteps==settings.activeSteps && a.direction==settings.direction
       && a.loop==settings.loop && a.probability==settings.probability && a.ratchets==settings.ratchets && a.humanize==settings.humanize) return true;
    m.sequencer=settings;
    // The canonical SequencerSettings: the SYNTH sequencer editor shows the same steps.
    if(!operatorGesture_) pushControlUndo(true);
    else if(!controlUndo_.empty() && !controlUndo_.back().hasSequencer) { controlUndo_.back().hasSequencer=true; controlUndo_.back().sequencer=bindings_.snapshot().modulation.sequencer; }
    if(!bindings_.modulation(m)) { if(!operatorGesture_) controlUndo_.pop_back(); return false; }
    refreshControl();
    return true;
}

void FxPage::beginOperatorGesture() {
    if(operatorGesture_) return;
    pushControlUndo(); // the whole drag is one undo step
    operatorGesture_=true;
}

void FxPage::endOperatorGesture() { operatorGesture_=false; }

bool FxPage::setOperatorParameter(std::uint32_t op,std::size_t index,float value) {
    if(!bindings_.snapshot || !bindings_.modulation || index>=controlOpParameterCount) return false;
    auto m=bindings_.snapshot().modulation;
    const auto slot=controlOperatorSlot(m,op);
    if(slot>=m.operators.size()) return false;
    const auto* info=controlOpInfo(m.operators[slot].type);
    if(info==nullptr || index>=info->parameterCount) return false;
    const auto& p=info->parameters[index];
    float v=std::isfinite(value) ? std::clamp(value,p.minimum,p.maximum) : p.defaultValue;
    if(p.integer) v=std::round(v);
    if(m.operators[slot].params[index]==v) return true;
    m.operators[slot].params[index]=v;
    if(!operatorGesture_) pushControlUndo();
    if(!bindings_.modulation(m)) { if(!operatorGesture_) controlUndo_.pop_back(); return false; }
    refreshControl();
    return true;
}

void FxPage::selectControlEdge(std::uint32_t op,std::uint8_t input) {
    if(selected_!=invalidFxNodeId) { selected_=invalidFxNodeId; refresh(true); }
    controlMulti_.clear();
    controlSelection_={ControlSelection::Kind::Edge,{},0,op,input};
    refreshControl();
}

void FxPage::selectControlNode(const nodes::ControlNodeKey& key) {
    if(selected_!=invalidFxNodeId) { selected_=invalidFxNodeId; refresh(true); }
    controlMulti_={key};
    controlSelection_={ControlSelection::Kind::Node,key,0};
    refreshControl();
}

void FxPage::selectControlLink(std::uint32_t route) {
    if(selected_!=invalidFxNodeId) { selected_=invalidFxNodeId; refresh(true); }
    controlMulti_.clear();
    controlSelection_={ControlSelection::Kind::Link,{},route};
    refreshControl();
}

std::vector<NativeChoiceItem> FxPage::parameterPickerItems(std::optional<ModSource> source) const {
    InstrumentState state;
    if(bindings_.snapshot) state=bindings_.snapshot();
    const auto catalog=modulationDestinationCatalog(state,bindings_);
    std::vector<NativeChoiceItem> items;
    for(std::size_t i=0;i<catalog.size();++i) {
        const auto& e=catalog[i];
        // Nested targets (LFO RATE, MACRO, route DEPTH) are routed from the
        // Matrix and SYNTH; the NODES PARAMETER picker is unchanged.
        if(e.group==nestedDestinationGroup) continue;
        // Synth parameters first, then this instrument's NODES parameters.
        const auto group=e.group.startsWith("NODES") ? e.group : "SYNTH / "+e.group.toUpperCase();
        bool enabled=true;
        juce::String reason;
        if(source) {
            const auto check=nodes::checkControlLink(state,*source,e.address);
            enabled=check.creatable() || check.result==nodes::ControlLinkResult::Exists;
            if(!enabled) reason=juce::String(nodes::toString(check.result));
        }
        items.push_back({int(i)+1,enabled || reason.isEmpty() ? e.label : e.label+"  -  "+reason,enabled,group,false,reason});
    }
    return items;
}

std::optional<ModAddress> FxPage::parameterPickerAddress(int itemId) const {
    InstrumentState state;
    if(bindings_.snapshot) state=bindings_.snapshot();
    const auto catalog=modulationDestinationCatalog(state,bindings_);
    if(itemId<1 || itemId>int(catalog.size())) return std::nullopt;
    return catalog[std::size_t(itemId-1)].address;
}

void FxPage::showParameterPicker(juce::Component& anchor,std::optional<ModSource> source,std::optional<FxPoint> at) {
    juce::Component::SafePointer<FxPage> safe(this);
    showNativeChoiceMenu(anchor,"PARAMETER",parameterPickerItems(source),0,[safe,source,at](int choice) {
        if(safe==nullptr) return;
        const auto address=safe->parameterPickerAddress(choice);
        if(!address) return;
        safe->addParameterNode(*address,at);
        if(source) safe->connectControl(*source,*address);
    });
}

void FxPage::sampleControlMonitor() {
    const bool operatorNode=controlSelection_.kind==ControlSelection::Kind::Node && controlSelection_.key.kind==nodes::ControlNodeKind::Operator;
    if(!bindings_.visualization) return;
    // N05 activity: compare bounded monotonic EVENT counters, decay on this
    // timer; GATE outputs show their published state. Display only.
    // N06: a node shows activity when ANY output is an EVENT / GATE (COUNTER WRAP,
    // SEQUENCER STEP EVENT...); the SEQUENCER preview follows the engine's step.
    const auto eventful=[](const ControlOpInfo& info) {
        for(std::size_t p=0;p<info.outputCount;++p) if(controlOutputSignalOf(info,p)!=ControlSignal::Control) return true;
        return false;
    };
    bool familyVisible=false;
    for(const auto& op:controlModulation_.operators)
        if(op.id) if(const auto* info=controlOpInfo(op.type); info!=nullptr && eventful(*info)) familyVisible=true;
    if(!familyVisible && controlSelection_.kind!=ControlSelection::Kind::Link && !operatorNode) return;
    const auto visual=bindings_.visualization();
    for(std::size_t slot=0;slot<controlModulation_.operators.size();++slot) {
        const auto& op=controlModulation_.operators[slot];
        if(!op.id) continue;
        const auto* info=controlOpInfo(op.type);
        if(info==nullptr || !eventful(*info)) continue;
        if(op.type==ControlOpType::Sequencer)
            if(auto* node=canvas_.controlNode(nodes::operatorKey(op.id))) node->setSequencerStep(int(visual.sequencerStep));
        if(visual.operatorEvents[slot]!=lastEventCounts_[slot]) { eventActivity_[slot]=1.0f; lastEventCounts_[slot]=visual.operatorEvents[slot]; }
        else eventActivity_[slot]*=0.7f;
        if(auto* node=canvas_.controlNode(nodes::operatorKey(op.id)))
            node->setActivity(eventActivity_[slot],visual.routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(slot,0)]>=0.5f);
    }
    if(controlSelection_.kind!=ControlSelection::Kind::Link && !operatorNode) return;
    controlInspector_->sample(controlModulation_,visual.routeSources,visual.operatorEvents);
}

void FxPage::applyTemplate(int id) {
    switch(id) {
    case 1: document_->edit([](FxGraph& g){g=makeDefaultFxGraph();return true;}); break;
    case 2: document_->edit([](FxGraph& g){g=makeSerialChainTemplate();return true;}); break;
    case 3: document_->edit([](FxGraph& g){g=makeParallelTemplate();return true;}); break;
    case 4: document_->edit([](FxGraph& g){return g.applyTemplate(FxRoutingMode::Serial);}); break;
    case 10: document_->edit([](FxGraph& g){g=makeDevelopmentFxGraph();return true;}); break;
    default: return;
    }
    selected_=invalidFxNodeId;
    refresh(true);
    zoomToFit();
}

void FxPage::showTemplatesMenu(juce::Component& anchor) {
    juce::Component::SafePointer<FxPage> safe(this);
    showNativeChoiceMenu(anchor,"TEMPLATES",{
        {1,"Empty (BUS 1 > MASTER OUT)",true,"GRAPH PRESETS"},
        {2,"Serial Chain (Drive > Delay > Reverb)",true,"GRAPH PRESETS"},
        {3,"Parallel Processing (dry + Reverb)",true,"GRAPH PRESETS"},
        {5,"Delay / Reverb Send (pending)",false,"GRAPH PRESETS"},
        {4,"Rearrange Current as Serial Chain",true,"CURRENT GRAPH"},
        {10,"Development Graph",true,"DEVELOPMENT"}},0,[safe](int choice) {
        if(safe!=nullptr) safe->applyTemplate(choice);
    });
}

juce::String FxPage::inspectorHeadline() const { return selectedPanel_->headline(); }

juce::String FxPage::parameterTabName() const {
    const char* names[]{"MAIN","MODULATION","ADVANCED"};
    return names[parametersPanel_->tab()];
}

void FxPage::selectParameterTab(int index) { parametersPanel_->selectTab(index); }

std::size_t FxPage::modulationRowCount() const { return parametersPanel_->modulationRows(); }


// ================================================================ N07 selection / layout / palette / clipboard / diagnostics

bool FxPage::controlNodeSelected(const nodes::ControlNodeKey& key) const noexcept {
    if(std::find(controlMulti_.begin(),controlMulti_.end(),key)!=controlMulti_.end()) return true;
    return controlSelection_.kind==ControlSelection::Kind::Node && controlSelection_.key==key;
}

void FxPage::setControlNodeSelection(std::vector<nodes::ControlNodeKey> keys) {
    if(keys.size()==1) { selectControlNode(keys.front()); return; }
    if(selected_!=invalidFxNodeId) { selected_=invalidFxNodeId; refresh(true); }
    controlMulti_=std::move(keys);
    // The inspector follows the most recently added node of a group.
    if(controlMulti_.empty()) { if(controlSelection_.kind==ControlSelection::Kind::Node) controlSelection_={}; }
    else controlSelection_={ControlSelection::Kind::Node,controlMulti_.back(),0};
    refreshControl();
}

void FxPage::toggleControlNodeSelection(const nodes::ControlNodeKey& key) {
    auto keys=controlMulti_;
    if(keys.empty() && controlSelection_.kind==ControlSelection::Kind::Node) keys.push_back(controlSelection_.key);
    const auto it=std::find(keys.begin(),keys.end(),key);
    if(it!=keys.end()) keys.erase(it); else keys.push_back(key);
    if(keys.size()==1) { selectControlNode(keys.front()); return; }
    setControlNodeSelection(std::move(keys));
}

namespace {
juce::Rectangle<float> nodeRect(FxCanvas& canvas,const nodes::ControlNodeKey& key) {
    if(auto* node=canvas.controlNode(key)) return node->getBounds().toFloat();
    return {};
}
}

bool FxPage::deleteSelectedControlNodes() {
    if(!bindings_.snapshot || !bindings_.modulation) return false;
    auto keys=controlMulti_;
    if(keys.empty() && controlSelection_.kind==ControlSelection::Kind::Node) keys.push_back(controlSelection_.key);
    if(keys.empty()) return false;
    auto next=bindings_.snapshot().modulation;
    bool modelChanged=false,layoutChanged=false;
    for(const auto& key:keys)
        if(key.kind==nodes::ControlNodeKind::Operator) {
            ModulationState out;
            if(nodes::deleteControlOperator(next,key.op,out)) { next=out; modelChanged=true; }
        }
    std::size_t kept=0;
    pushControlUndo(); // nodes, their connections and the layout: one step
    for(const auto& key:keys) {
        if(key.kind==nodes::ControlNodeKind::Operator) { layoutChanged|=controlLayout().remove(key); continue; }
        // Canonical SOURCE / PARAMETER nodes: views of instrument state. They
        // leave the canvas only when nothing connects to them.
        bool linked=false;
        for(const auto& r:next.routes)
            if(r.id && routeComplete(r) && (key.kind==nodes::ControlNodeKind::Source ? r.source==key.source : r.destination==key.destination)) linked=true;
        for(const auto& op:next.operators)
            for(const auto& in:op.inputs) linked|=key.kind==nodes::ControlNodeKind::Source && in.kind==ControlInput::Kind::Source && in.source==key.source;
        if(linked) { ++kept; continue; }
        layoutChanged|=controlLayout().remove(key);
    }
    if(!modelChanged && !layoutChanged) { controlUndo_.pop_back(); refreshToolbar(); if(kept) showGraphFeedback("Linked sources and parameters stay: delete their connections first"); return false; }
    if(modelChanged && !bindings_.modulation(next)) { applyControl(controlUndo_.back()); controlUndo_.pop_back(); return false; }
    controlMulti_.clear(); controlSelection_={};
    refreshControl();
    if(kept) showGraphFeedback("Linked sources and parameters stay: delete their connections first");
    return true;
}

void FxPage::moveControlNodes(const std::vector<nodes::ControlNodeKey>& keys,juce::Point<float> delta) {
    if(keys.empty()) return;
    pushControlUndo(); // the whole group move is one undo step (layout only)
    for(const auto& key:keys) {
        juce::Point<float> at;
        if(const auto* e=controlLayout().find(key); e!=nullptr && e->positioned) at={e->x,e->y};
        else if(const auto i=controlGraph_.find(key)) at={controlGraph_.nodes[*i].x,controlGraph_.nodes[*i].y};
        controlLayout().setPosition(key,at.x+delta.x,at.y+delta.y);
    }
    refreshControl();
}

bool FxPage::alignControlNodes(Align mode) {
    auto keys=controlMulti_;
    const bool distribute=mode==Align::DistributeHorizontally || mode==Align::DistributeVertically;
    if(keys.size()<(distribute ? 3u : 2u)) return false;
    std::vector<juce::Rectangle<float>> rects;
    for(const auto& k:keys) rects.push_back(nodeRect(canvas_,k));
    float left=1e9f,right=-1e9f,top=1e9f,centre=0.0f;
    for(const auto& r:rects) { left=std::min(left,r.getX()); right=std::max(right,r.getRight()); top=std::min(top,r.getY()); centre+=r.getCentreX(); }
    centre/=float(rects.size());
    pushControlUndo();
    if(distribute) {
        std::vector<std::size_t> order(keys.size());
        for(std::size_t i=0;i<order.size();++i) order[i]=i;
        const bool horizontal=mode==Align::DistributeHorizontally;
        std::sort(order.begin(),order.end(),[&](std::size_t a,std::size_t b){ return horizontal ? rects[a].getCentreX()<rects[b].getCentreX() : rects[a].getCentreY()<rects[b].getCentreY(); });
        const auto first=rects[order.front()],last=rects[order.back()];
        const float from=horizontal ? first.getCentreX() : first.getCentreY(),to=horizontal ? last.getCentreX() : last.getCentreY();
        for(std::size_t i=0;i<order.size();++i) {
            const auto& r=rects[order[i]];
            const float c=from+(to-from)*float(i)/float(order.size()-1);
            controlLayout().setPosition(keys[order[i]],horizontal ? c-r.getWidth()*0.5f : r.getX(),horizontal ? r.getY() : c-r.getHeight()*0.5f);
        }
    } else
        for(std::size_t i=0;i<keys.size();++i) {
            const auto& r=rects[i];
            float x=r.getX(),y=r.getY();
            if(mode==Align::Left) x=left;
            if(mode==Align::Center) x=centre-r.getWidth()*0.5f;
            if(mode==Align::Right) x=right-r.getWidth();
            if(mode==Align::Top) y=top;
            controlLayout().setPosition(keys[i],x,y);
        }
    refreshControl();
    return true;
}

std::size_t FxPage::autoLayoutControl() {
    pushControlUndo(); // layout only: one undo step, no DSP change
    const auto count=nodes::autoLayoutControlGraph(controlModulation_,controlLayout());
    refreshControl();
    return count;
}

std::vector<NodePalette::Entry> FxPage::paletteEntries(std::optional<nodes::ControlEndpoint> dangling) const {
    std::vector<NodePalette::Entry> entries;
    const auto items=dangling ? controlCreateItems(*dangling) : moduleMenuItems(true);
    // Search stays flat; each result names its category path for context
    // ("EFFECTS > DISTORTION", "EVENT > STATEFUL").
    for(const auto& item:items) {
        const auto path=nativeChoicePath(item);
        entries.push_back({item.id,item.text,path.isEmpty() ? item.group : path.joinIntoString(" > "),
                           item.tooltip.isNotEmpty() ? item.tooltip : juce::String("Unavailable"),item.enabled});
    }
    return entries;
}

void FxPage::addFromCatalog(int choice,std::optional<FxPoint> at) {
    if(choice>=FxModuleMenu::controlOperatorBase) { addControlOperator(static_cast<ControlOpType>(choice-FxModuleMenu::controlOperatorBase),at); return; }
    if(choice>=FxModuleMenu::controlSourceBase) { addControlSource(static_cast<ModSource>(choice-FxModuleMenu::controlSourceBase),at); return; }
    if(choice==FxModuleMenu::parameterPickerId) { showParameterPicker(*this,std::nullopt,at); return; }
    if(const auto spec=FxModuleMenu::decode(choice)) { if(at) addModuleAt(*spec,*at); else addModule(*spec); }
}

void FxPage::showNodePalette(std::optional<FxPoint> at,std::optional<nodes::ControlEndpoint> dangling) {
    const auto entries=paletteEntries(dangling);
    if(entries.empty()) return;
    juce::Point<int> where;
    if(at) where=(view_.graphToView(*at)+view_.getPosition().toFloat()).toInt();
    else where={add_.getRight()-NodePalette::width,add_.getBottom()+4};
    juce::Component::SafePointer<FxPage> safe(this);
    palette_.onChoose=[safe,at,dangling](int id) {
        if(safe==nullptr) return;
        if(!dangling) { safe->addFromCatalog(id,at); return; }
        const auto point=at.value_or(safe->viewCentre());
        if(id==FxModuleMenu::parameterPickerId) { safe->showParameterPicker(*safe,dangling->outputSource(),point); return; }
        if(id>=FxModuleMenu::controlOperatorBase) { safe->createConnectedControlOperator(static_cast<ControlOpType>(id-FxModuleMenu::controlOperatorBase),*dangling,point); return; }
        if(id>=FxModuleMenu::controlSourceBase) {
            const auto source=static_cast<ModSource>(id-FxModuleMenu::controlSourceBase);
            safe->addControlSource(source,point);
            safe->connectControlEdge(nodes::ControlEndpoint::fromSource(source),*dangling);
        }
    };
    palette_.open(entries,where,dangling ? juce::String(dangling->isOutput() ? "CONNECT TO" : "FEED FROM") : juce::String("ADD MODULE"));
}

std::size_t FxPage::copySelectedControlNodes() {
    auto keys=controlMulti_;
    if(keys.empty() && controlSelection_.kind==ControlSelection::Kind::Node) keys.push_back(controlSelection_.key);
    Clipboard clip;
    float left=1e9f,top=1e9f;
    std::vector<juce::Point<float>> positions;
    for(const auto& key:keys) {
        if(key.kind!=nodes::ControlNodeKind::Operator) continue; // canonical nodes are never copied
        const auto* op=findControlOperator(controlModulation_,key.op);
        if(op==nullptr) continue;
        clip.operators.push_back(*op);
        const auto r=nodeRect(canvas_,key);
        positions.push_back(r.getPosition());
        left=std::min(left,r.getX()); top=std::min(top,r.getY());
    }
    for(const auto& p:positions) clip.offsets.push_back({p.x-left,p.y-top});
    if(clip.operators.empty()) return 0;
    clipboard_=std::move(clip);
    return clipboard_.operators.size();
}

std::vector<std::uint32_t> FxPage::pasteControlNodes(std::optional<FxPoint> at) {
    std::vector<std::uint32_t> created;
    if(clipboard_.operators.empty() || !bindings_.snapshot || !bindings_.modulation) return created;
    auto next=bindings_.snapshot().modulation;
    std::vector<std::pair<std::uint32_t,std::uint32_t>> ids; // old -> new
    bool skippedSequencer=false;
    for(const auto& op:clipboard_.operators) {
        if(!nodes::controlOperatorCreatable(next,op.type)) { skippedSequencer|=op.type==ControlOpType::Sequencer; continue; }
        ModulationState out; std::uint32_t id=0;
        if(!nodes::addControlOperator(next,op.type,out,id)) break; // capacity
        out.operators[controlOperatorSlot(out,id)].params=op.params;
        next=out;
        ids.push_back({op.id,id});
    }
    const auto mapped=[&](std::uint32_t old)->std::uint32_t { for(const auto& [o,n]:ids) if(o==old) return n; return 0; };
    // Only connections BETWEEN copied nodes are recreated (fresh ids, same ports).
    for(const auto& op:clipboard_.operators) {
        const auto self=mapped(op.id);
        if(self==0) continue;
        auto& target=next.operators[controlOperatorSlot(next,self)];
        for(std::size_t k=0;k<op.inputs.size();++k)
            if(op.inputs[k].kind==ControlInput::Kind::Operator)
                if(const auto from=mapped(op.inputs[k].op)) target.inputs[k]={ControlInput::Kind::Operator,ModSource::None,from,op.inputs[k].port};
    }
    if(ids.empty()) { if(skippedSequencer) showGraphFeedback("The instrument has one sequencer: it was not pasted"); return created; }
    InstrumentState probe=bindings_.snapshot(); probe.modulation=next;
    if(!validModulation(next,probe.oscillators)) { showGraphFeedback("Paste failed: the copied nodes no longer fit this graph"); return created; }
    if(!commitControl(next)) return created;
    const auto base=at.value_or(FxPoint{viewCentre().x-110.0f,viewCentre().y-60.0f});
    std::vector<nodes::ControlNodeKey> keys;
    for(std::size_t i=0;i<clipboard_.operators.size();++i)
        if(const auto id=mapped(clipboard_.operators[i].id)) {
            const auto offset=i<clipboard_.offsets.size() ? clipboard_.offsets[i] : juce::Point<float>{};
            controlLayout().setPosition(nodes::operatorKey(id),base.x+offset.x,base.y+offset.y);
            created.push_back(id); keys.push_back(nodes::operatorKey(id));
        }
    if(skippedSequencer) showGraphFeedback("The instrument has one sequencer: it was not pasted");
    setControlNodeSelection(keys);
    return created;
}

void FxPage::showGraphFeedback(const juce::String& message) {
    feedback_=message;
    feedbackUntil_=juce::Time::getMillisecondCounterHiRes()+2600.0;
    repaint(view_.getBounds());
}

void FxPage::paintOverChildren(juce::Graphics& g) {
    if(feedback_.isEmpty()) return;
    // Concise, Origami-native, transient: bottom centre of the graph.
    const auto area=view_.getBounds();
    const int width=juce::jmin(area.getWidth()-40,juce::GlyphArrangement::getStringWidthInt(juce::FontOptions(11.0f),feedback_)+40);
    auto toast=juce::Rectangle<int>(width,30).withCentre({area.getCentreX(),area.getBottom()-32});
    g.setColour(Palette::panel().withAlpha(0.96f)); g.fillRoundedRectangle(toast.toFloat(),4.0f);
    g.setColour(signalSourceColour().withAlpha(0.8f)); g.drawRoundedRectangle(toast.toFloat().reduced(0.5f),4.0f,1.0f);
    text(g,feedback_,toast,11.0f,Palette::text(),juce::Justification::centred);
}

// ---- developer inspector ----------------------------------------------------

void FxPage::setDebugInspectorVisible(bool visible) {
    if(!debugInspector_) { debugInspector_=std::make_unique<DebugInspector>(*this); addChildComponent(*debugInspector_); }
    debugInspector_->setVisible(visible);
    if(visible) { resized(); debugInspector_->toFront(false); }
}

bool FxPage::debugInspectorVisible() const noexcept { return debugInspector_!=nullptr && debugInspector_->isVisible(); }

juce::StringArray FxPage::validateControlGraphReport() const {
    juce::StringArray lines;
    for(const auto& issue:nodes::validateControlGraph(controlModulation_))
        lines.add(juce::String(nodes::toString(issue.kind))+(issue.op ? "  op "+juce::String(issue.op)+" in "+juce::String(int(issue.input)) : juce::String())
                  +(issue.route ? "  route "+juce::String(issue.route) : juce::String()));
    return lines;
}

juce::StringArray FxPage::debugInspectorLines() const {
    juce::StringArray lines;
    const auto signal=[](ControlSignal s){ return controlSignalName(s); };
    lines.add("#NODES DEBUG");
    if(bindings_.modelRevision) lines.add("model revision   "+juce::String((juce::int64)bindings_.modelRevision()));
    if(bindings_.nodesDiagnostics) {
        const auto d=bindings_.nodesDiagnostics();
        lines.add("plan  compiles "+juce::String(d.compiles)+"  param updates "+juce::String(d.parameterUpdates)+"  skips "+juce::String(d.compileSkips));
        lines.add("state revision "+juce::String((juce::int64)d.stateRevision)+"  delay overflow "+juce::String(d.eventDelayOverflows)+"  QoS suppressed "+juce::String(d.suppressedBlocks));
    }
    const auto& u=uiDiagnostics_;
    lines.add("ui    syncs "+juce::String(u.modelSyncs)+" skipped "+juce::String(u.skippedSyncs)+" hidden "+juce::String(u.hiddenSyncs)
              +" rebuilds "+juce::String(u.controlRebuilds)+" paints "+juce::String(canvasPaintCount())+" rejected "+juce::String(u.rejectedConnections));
    const auto issues=validateControlGraphReport();
    lines.add("validator  "+(issues.isEmpty() ? juce::String("graph valid") : juce::String(issues.size())+" issue(s)"));
    for(const auto& issue:issues) lines.add("  ! "+issue);
    const auto& m=controlModulation_;
    ModulationSourceSlots slots{};
    if(bindings_.visualization) slots=bindings_.visualization().routeSources;
    const auto& sel=controlSelection_;
    if(sel.kind==ControlSelection::Kind::Node && sel.key.kind==nodes::ControlNodeKind::Operator) {
        const auto slot=controlOperatorSlot(m,sel.key.op);
        const auto* op=findControlOperator(m,sel.key.op);
        const auto* info=op ? controlOpInfo(op->type) : nullptr;
        if(info!=nullptr) {
            const bool voice=sourceIsVoice(operatorSource(op->id),m);
            lines.add("#OPERATOR "+juce::String(info->label));
            lines.add("id "+juce::String(op->id)+"  type "+juce::String(int(op->type))+"  slot "+juce::String(slot)+"  domain "+(voice ? "VOICE" : "GLOBAL"));
            lines.add(juce::String("state  ")+(voice ? "per voice: voice.state["+juce::String(slot)+"]" : "global state["+juce::String(slot)+"]"));
            for(std::size_t k=0;k<info->inputs;++k) {
                const auto& in=op->inputs[k];
                juce::String from=in.kind==ControlInput::Kind::None ? "-" : in.kind==ControlInput::Kind::Source ? "source "+juce::String(int(in.source))
                                 : "op "+juce::String(in.op)+" port "+juce::String(int(in.port));
                lines.add("in "+juce::String(int(k))+" "+controlInputName(*info,k)+" ("+signal(info->inputSignals[k])+") <- "+from);
            }
            for(std::size_t p=0;p<info->outputCount;++p) {
                const auto index=CompiledModulation::sourceSlotCount+operatorOutputIndex(slot,p);
                lines.add("out "+juce::String(int(p))+" "+controlOutputName(*info,p)+" ("+signal(controlOutputSignalOf(*info,p))+")  monitor "
                          +juce::String(int(index))+" = "+juce::String(index<slots.size() ? slots[index] : 0.0f,4));
            }
        }
    } else if(sel.kind==ControlSelection::Kind::Link) {
        for(const auto& r:m.routes) if(r.id==sel.route) {
            lines.add("#ROUTE "+juce::String(r.id));
            lines.add(juce::String("source ")+(isOperatorSource(r.source) ? "op "+juce::String(operatorIdOf(r.source))+" port "+juce::String(int(operatorPortOf(r.source)))
                                                                         : "canonical "+juce::String(int(r.source))));
            lines.add("destination "+juce::String(int(r.destination.parameter))+" osc "+juce::String(r.destination.oscillator)+" item "+juce::String(r.destination.itemId));
            lines.add("amount "+juce::String(r.amount,3)+(r.bipolar ? "  BIPOLAR" : "  UNIPOLAR")+(r.enabled ? "" : "  OFF"));
            const auto index=modulationSourceSlot(r.source,m);
            lines.add("monitor slot "+juce::String(int(index))+" = "+juce::String(index<slots.size() ? slots[index] : 0.0f,4));
        }
    } else if(sel.kind==ControlSelection::Kind::Edge) {
        if(const auto* op=findControlOperator(m,sel.op)) {
            const auto& in=op->inputs[sel.input];
            lines.add("#CONNECTION -> op "+juce::String(sel.op)+" input "+juce::String(int(sel.input)));
            lines.add(in.kind==ControlInput::Kind::Operator ? "from op "+juce::String(in.op)+" output "+juce::String(int(in.port))
                                                            : "from source "+juce::String(int(in.source)));
        }
    } else if(!controlMulti_.empty()) lines.add("#SELECTION "+juce::String(controlMulti_.size())+" nodes");
    return lines;
}

}
