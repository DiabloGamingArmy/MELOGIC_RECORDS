# Origami native CI

Patch 04 makes Origami's native C++ audio product a first-class CI target.

The mandatory gates are:

- Release realtime gate
- ASan + UBSan CTest gate
- macOS plugin-format validation: VST3 via pluginval, AU via auval, Standalone bundle smoke check

CI pins JUCE 9.0.2 and pluginval v1.0.4 for reproducibility.

Local commands:

```bash
JUCE_DIR=/path/to/JUCE ./scripts/run-rt-gate.sh
JUCE_DIR=/path/to/JUCE ./scripts/run-sanitizers.sh
JUCE_DIR=/path/to/JUCE ./scripts/validate-plugins-macos.sh
```
