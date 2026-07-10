# Ant Media Local Setup

This note is for verifying the Melogic Records Live Studio Ant Media foundation locally. It does not contain secrets.

## Required Runtime Values

- `ANT_MEDIA_PUBLIC_BASE_URL`: public HTTPS base URL for the Ant Media server.
- `ANT_MEDIA_APP_NAME`: Ant Media application name, usually `live`.
- `ANT_MEDIA_WEBHOOK_SECRET`: shared secret used by Melogic webhook endpoints.
- `ANT_MEDIA_ALLOWED_ORIGINS`: comma-separated allowed origins for webhook requests.

LiveKit remains the active browser publishing provider until the Ant Media browser publish adapter is completed. Ant Media status is surfaced in Live Studio through `getStreamingProviderStatus`.

## Local Verification

1. Start the web app locally.
2. Open `/studio/live?panel=program`.
3. Check the Program Mixer provider strip.
4. Select Ant Media only to verify status and diagnostics. Publishing should remain disabled until the secure server adapter is wired.
5. Use the Ant Media health endpoint to confirm webhook protection and safe public status fields.

## Callable Functions

- `getStreamingProviderStatus`
- `createAntMediaStreamSession`
- `getAntMediaPublishToken`
- `getAntMediaPlaybackToken`
- `stopAntMediaStreamSession`

The older `getAntMediaPublishAuthorization` and `getAntMediaPlaybackAuthorization` callable names are still exported for compatibility.
