# Callback performance

Apple M5 Pro, 64 GiB RAM, Release build; actual AudioProcessor callbacks, 256 samples. One oscillator, held notes, serial stages. Existing benchmark warm-up and 1.5-second measurement window; finite output hashes, no spectral misses/requests/compiles. These results describe this machine and fixture, not universal host guarantees.

| Rate (kHz) | Voices | Stages | Median µs | p99 µs | Median deadline | p99 deadline |
| --- | --- | --- | --- | --- | --- | --- |
| 48.0 | 1 | zero filters | 19.2 | 24.1 | 0.36% | 0.45% |
| 48.0 | 1 | one ordinary | 23.5 | 26.8 | 0.44% | 0.50% |
| 48.0 | 1 | 1 Comb | 22.2 | 29.2 | 0.42% | 0.55% |
| 48.0 | 1 | 4 Comb | 34.5 | 42.4 | 0.65% | 0.79% |
| 48.0 | 1 | 8 Comb | 57.6 | 73.1 | 1.08% | 1.37% |
| 48.0 | 8 | zero filters | 60.6 | 75.3 | 1.14% | 1.41% |
| 48.0 | 8 | one ordinary | 113.4 | 128.4 | 2.13% | 2.41% |
| 48.0 | 8 | 1 Comb | 110.7 | 129.3 | 2.07% | 2.42% |
| 48.0 | 8 | 4 Comb | 194.0 | 215.0 | 3.64% | 4.03% |
| 48.0 | 8 | 8 Comb | 357.3 | 381.3 | 6.70% | 7.15% |
| 48.0 | 16 | zero filters | 107.5 | 122.9 | 2.02% | 2.30% |
| 48.0 | 16 | one ordinary | 216.7 | 234.6 | 4.06% | 4.40% |
| 48.0 | 16 | 1 Comb | 210.7 | 229.8 | 3.95% | 4.31% |
| 48.0 | 16 | 4 Comb | 386.5 | 411.7 | 7.25% | 7.72% |
| 48.0 | 16 | 8 Comb | 762.0 | 793.2 | 14.29% | 14.87% |
| 192.0 | 1 | zero filters | 16.2 | 20.6 | 1.22% | 1.54% |
| 192.0 | 1 | one ordinary | 22.8 | 28.7 | 1.71% | 2.15% |
| 192.0 | 1 | 1 Comb | 22.0 | 26.0 | 1.65% | 1.95% |
| 192.0 | 1 | 4 Comb | 33.7 | 39.2 | 2.53% | 2.94% |
| 192.0 | 1 | 8 Comb | 56.0 | 69.4 | 4.20% | 5.20% |
| 192.0 | 8 | zero filters | 59.1 | 72.5 | 4.43% | 5.43% |
| 192.0 | 8 | one ordinary | 112.6 | 130.0 | 8.44% | 9.75% |
| 192.0 | 8 | 1 Comb | 109.6 | 125.9 | 8.22% | 9.44% |
| 192.0 | 8 | 4 Comb | 193.5 | 214.0 | 14.52% | 16.05% |
| 192.0 | 8 | 8 Comb | 363.7 | 388.1 | 27.28% | 29.11% |
| 192.0 | 16 | zero filters | 107.0 | 123.3 | 8.03% | 9.25% |
| 192.0 | 16 | one ordinary | 215.0 | 234.1 | 16.12% | 17.56% |
| 192.0 | 16 | 1 Comb | 209.2 | 229.3 | 15.69% | 17.20% |
| 192.0 | 16 | 4 Comb | 386.8 | 412.2 | 29.01% | 30.92% |
| 192.0 | 16 | 8 Comb | 775.1 | 827.4 | 58.13% | 62.06% |

The final writer-page pre-touch does not change callback processing. Banks are retained during audio operation and rebuilt while audio is stopped.
