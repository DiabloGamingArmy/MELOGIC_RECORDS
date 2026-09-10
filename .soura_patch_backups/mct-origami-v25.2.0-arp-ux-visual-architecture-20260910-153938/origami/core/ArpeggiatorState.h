// mct-origami-v25.1.0-arp-advanced-page
#pragma once
namespace mct::origami {

struct ArpeggiatorState {
    enum class Direction : int { Up=0, Down=1, UpDown=2, Order=3, Random=4 };

    bool enabled=false;
    bool syncToDaw=true;
    int rateIndex=2;
    Direction direction=Direction::Up;
    int octaveSpan=1;
    float gate=0.72f;
    float swing=0.0f;
    bool latch=false;
    double internalTempo=120.0;
};

} // namespace mct::origami
