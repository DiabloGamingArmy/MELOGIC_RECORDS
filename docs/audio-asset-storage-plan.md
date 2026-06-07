# Audio Asset Storage Plan

Melogic DAW audio assets use metadata-first loading. Firestore stores catalog records and permissions data only. Firebase Storage stores audio and preset files. The app should never load every asset at startup.

## Firebase Storage

- `audio/wavetables/{packId}/{wavetableId}.wav`
- `audio/samples/{packId}/{assetId}.wav`
- `audio/previews/{assetId}.mp3`
- `audio/instruments/{instrumentId}/samples/{note}_{velocity}.wav`
- `audio/presets/{instrumentId}/{presetId}.json`

Large audio binaries should not be committed to Git and should not be stored in Firestore.

## Firestore

`audioAssets/{assetId}`

```json
{
  "type": "wavetable",
  "title": "Saw Stack",
  "creatorUid": "system",
  "storagePath": "audio/wavetables/basic/saw.wav",
  "previewPath": "audio/previews/saw-stack.mp3",
  "packId": "melogic-basic-waves",
  "frameCount": 3,
  "frameSize": 2048,
  "sampleRate": 44100,
  "tags": ["basic", "bright"],
  "visibility": "public",
  "license": "Melogic stock",
  "checksum": "sha256-or-generated-id",
  "version": 1
}
```

Additional collections:

- `soundPacks`
- `instrumentDefinitions`
- `instrumentPresets`

## Security

- Public/free assets: readable by anyone.
- Purchased marketplace assets: readable by entitled users.
- Draft assets: readable by creator and admins.
- Upload and publishing tools should be admin/backend controlled.

## Client Loading

The DAW asset service lists metadata first, resolves Storage URLs only when the user selects an asset, and keeps a session URL cache. Future IndexedDB hooks can cache decoded audio buffers or fetched blobs without changing the Firestore model.
