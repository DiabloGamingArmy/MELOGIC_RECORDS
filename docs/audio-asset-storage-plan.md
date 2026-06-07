# Audio Asset Storage Plan

This plan covers stock sounds, one-shots, loops, multisamples, wavetables, impulse responses, preset packs, and future DAW instrument assets. Audio binary data should live in Firebase Storage, not Firestore.

## Storage Paths

- `audio/samples/{packId}/{assetId}.wav`
- `audio/previews/{assetId}.mp3`
- `audio/wavetables/{wavetableId}.wav`
- `audio/wavetables/{wavetableId}.json`
- `audio/instruments/{instrumentId}/samples/{note}_{velocity}.wav`
- `audio/presets/{instrumentId}/{presetId}.json`
- `audio/impulses/{irId}.wav`

Use Storage for every large binary asset. Firestore documents should only point to paths and store searchable metadata.

## Firestore Metadata

### `audioAssets/{assetId}`

```js
{
  type: "one-shot" | "loop" | "wavetable" | "multisample" | "preset" | "impulse-response",
  title,
  creatorUid,
  packId,
  storagePath,
  previewPath,
  duration,
  sampleRate,
  bitDepth,
  channels,
  bpm,
  key,
  tags,
  license,
  visibility,
  createdAt,
  updatedAt,
  checksum,
  version
}
```

### `soundPacks/{packId}`

```js
{
  title,
  description,
  creatorUid,
  coverPath,
  assetCount,
  tags,
  license,
  visibility,
  createdAt,
  updatedAt
}
```

### `instrumentDefinitions/{instrumentId}`

```js
{
  title,
  engineType: "sampler" | "wavetable" | "granular" | "drum-machine",
  manifestPath,
  presetCount,
  version,
  createdAt,
  updatedAt
}
```

## DAW Loading Strategy

- Load pack and instrument metadata first.
- Load preview MP3s for browsing.
- Fetch full WAV samples only when a user previews, places, or loads the asset into a project.
- Load only the selected instrument, preset, or wavetable.
- Do not fetch all wavetables or all samples on Studio startup.
- Use manifests for multisample maps so the DAW can request only the required note and velocity regions.

## Future Wavetable Synth Notes

- Store wavetable audio or frame data in Storage.
- Store lightweight wavetable metadata in Firestore.
- Store presets as JSON under `audio/presets/{instrumentId}/{presetId}.json`.
- Presets should reference wavetable IDs, modulation routing, envelopes, filters, effects, and macro defaults.
- Keep synth engine code separate from marketplace/product metadata.

## Caching Strategy

- Cache recently used previews, manifests, presets, and small metadata in browser storage or IndexedDB.
- Cache full audio assets only after explicit use or project load.
- Key cache entries by `storagePath`, `checksum`, and `version`.
- Invalidate cache when `version` or `checksum` changes.

## Security And Rules Considerations

- Public/free assets can be readable by anyone.
- Purchased marketplace assets should be readable only by entitled users.
- Draft/private assets should be readable only by creator/admin.
- Uploads require auth and should validate owner paths.
- Marketplace product assets should continue to follow the entitlement/library system.
- Firestore rules should protect metadata writes from spoofed ownership, unsafe visibility changes, and direct public publishing.
- Storage rules should prevent arbitrary cross-user writes and should not expose private audio paths without entitlement.

## Non-Goals

- Do not commit large audio files to Git.
- Do not store audio binary data in Firestore.
- Do not load the whole stock library into memory on page load.
