| Scenario | 1 voice median / p99 µs | 8 voices | 16 voices |
|---|---:|---:|---:|
| MAIN only | 17.8 / 18.5 | 61.8 / 64.6 | 109.7 / 122.5 |
| FILTER only | 22.8 / 24.5 | 104.8 / 108.2 | 190.3 / 205.6 |
| MAIN + FILTER | 22.9 / 23.9 | 104.4 / 108.6 | 188.0 / 201.5 |
| MAIN + FILTER + BUS | 36.5 / 37.6 | 131.8 / 143.6 | 238.0 / 249.9 |
| four OSC multi sends | 51.3 / 53.6 | 205.1 / 219.6 | 385.4 / 408.0 |
| maximum 16 OSC 16 sends | 149.3 / 162.0 | 766.9 / 788.8 | 1477.0 / 1513.1 |
| dry + serial chain | 41.2 / 43.8 | 163.7 / 175.8 | 299.4 / 315.2 |

| Existing scenario | Before median µs | After median µs | Change |
|---|---:|---:|---:|
| 1 osc, 1 voices | 16.8 | 17.8 | +6.0% |
| 1 osc, 8 voices | 61.2 | 61.7 | +0.8% |
| 1 osc, 16 voices | 109.8 | 109.2 | -0.5% |
| Synth filters shared four OSC, 16 voices | 304.5 | 345.3 | +13.4% |
| Synth filters maximum eight serial, 16 voices | 750.9 | 792.1 | +5.5% |
