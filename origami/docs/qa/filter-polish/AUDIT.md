# Visual audit before edits

Baseline e4b82f5d048bb6c2331ef876815eb8fc8c249036; clean working tree.
The new request supplies text but no new image attachment. The prior committed
actual panel renders, including the 8 kHz state in whole-synth.png, are the
available visual baseline. Inspected the current actual paint/layout and shared
primitives before editing.

Representative panel 662x355, normal editor 1440x900:
- Panel title shelf 31 px, text (10,5,642,22), shared content (4,28,654,323).
- Rail (4,32,116,319); SOURCE (8,37,108,18); list (8,55,108,262).
- First row y58, height34; row pitch36, six-dot shared grip. Footer y322,
  height24, remove width52 / gap3 / add width53. Eight rows scroll, fixed footer.
- Selected editor from shared rail x126,width528; inner region x130,width520.
- Header (130,32,520,32), then 6 px gap.
- Type label width78, selector104x24; Out145x24 at most, power48x24.
- Response (130,70,520,165); plot (138,78,504,149); labels embedded at floor.
- Parameters (130,243,520,96); inner stack y255..327, five104px cells.
  Slider98x55 then label104x17; editable value boxes66x17. Full-width grouping.
- Bottom12px, graph/parameters gap8. Header/graph/parameters share horizontal
  bounds but independently consume vertical space. Header/Source tops differ5px.
- Fill uses signalSurfaceColour(.46,.22); lone +18dB (or +36 for Gain types)
  sits in plot. Existing zero-dB line lacks a label. Only100/1k/10k references.
- Handle x is effective cutoff but y=1-resonance; it floats near graph floor.
- Outer panel, rail, SOURCE, source rows, header, selectors, graph and value fields
  all carry rectangles. Header perimeter duplicates interactive-control borders.
- Shared paintKnob has truthful active arc and pointer, but no inactive arc track;
  zero controls appear less present. Shared Slider styling supports reuse.

Plan: named filter editor metrics; compact selector strip centered on SOURCE
header, remove structural header border, dedicated axis gutters, approximately
20% shorter graph / approximately29% shorter plotting height, centered84%
parameter bank and equal stack dimensions. Use shared ToggleButton, shared knob
primitive with optional neutral track, native choice menus and existing theme.
Keep rail/title/footer metrics unchanged for Modulation consistency. Attach handle
to actual transfer at effective cutoff, including that point in the response path;
use anchored vertical gestures so moving it onto the curve does not change values
on mouse-down. No DSP, response function, log-axis semantics, routing, state,
modulation compiler or Panic changes are needed.
