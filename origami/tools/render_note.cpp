#include "core/Engine.h"
#include "core/preset/Patch.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>
namespace {
void le(std::ostream& out, std::uint32_t value, unsigned bytes) { for(unsigned i=0;i<bytes;++i) out.put(static_cast<char>((value>>(i*8))&255)); }
}
int main(int argc,char** argv) {
    if(argc!=2) {std::cerr<<"Usage: origami_render output.wav\n";return 1;}
    constexpr unsigned rate=48000,frames=rate*3;
    mct::origami::OrigamiEngine engine;
    if(!engine.prepare(rate,257,2)) return 1;
    engine.applyPatchState(mct::origami::Patch{}.parameters);
    std::vector<float> left(frames),right(frames);
    engine.noteOn(60,.8f);
    for(unsigned offset=0;offset<frames;) {
        if(offset==rate*2) engine.noteOff(60);
        const unsigned boundary=offset<rate*2?rate*2:frames;
        const auto count=std::min(257u,boundary-offset);float* outputs[]{left.data()+offset,right.data()+offset};
        if(!engine.process(outputs,2,count)) return 1;offset+=count;
    }
    std::ofstream file(argv[1],std::ios::binary);if(!file) {std::cerr<<"Cannot open WAV destination\n";return 1;}
    file.write("RIFF",4);le(file,36+frames*4,4);file.write("WAVEfmt ",8);le(file,16,4);le(file,1,2);le(file,2,2);le(file,rate,4);le(file,rate*4,4);le(file,4,2);le(file,16,2);file.write("data",4);le(file,frames*4,4);
    float peak=0;
    for(unsigned i=0;i<frames;++i) for(float value:{left[i],right[i]}) {
        if(!std::isfinite(value)) {std::cerr<<"Nonfinite audio\n";return 1;}
        peak=std::max(peak,std::abs(value));
        const auto pcm=static_cast<std::int32_t>(std::clamp(std::lround(value*32768),-32768l,32767l));le(file,static_cast<std::uint32_t>(pcm),2);
    }
    file.close();if(!file) return 1;
    std::cout<<"MCT Origami C4 saw, 48 kHz stereo PCM16, 3 seconds, peak "<<peak<<" -> "<<argv[1]<<'\n';return 0;
}
