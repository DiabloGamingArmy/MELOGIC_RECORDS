# StageMaker Export

StageMaker export is currently a frontend blueprint preview that can be printed or saved as a PDF through the browser.

## Included

- Project title, project id, owner fallback, version, generated time, created time, last updated time, and units.
- Stage dimensions and stage type.
- Static top-view SVG blueprint generated from StagePlan objects.
- Technical summary counts for fixtures, audio inputs, cameras, rigging, video, power, and exported objects.
- Equipment list with object number, name, category, type, position, size, rotation, and notes.
- Project and object notes.
- Readiness and warning summaries.

## Export Options

- Include grid.
- Include object labels.
- Include equipment list.
- Include notes.
- Include hidden objects.
- Group equipment by category.
- Paper orientation preference for the preview.

## Category Mapping

- Staging: stage, deck, riser, platform, booth, primitive box-like objects.
- Audio: speaker, subwoofer, monitor, mic, mixer, DI, playback, wedge.
- Lighting: fixture, light, wash, spot, par, moving head, LED bar.
- Video: LED wall, screen, projector, projection.
- Camera: camera, tripod.
- Rigging: truss, rigging, hoist, point, hang.
- Power: power, distro, cable, electrical.
- Notes: note, label, text.
- Miscellaneous: unknown or uncategorized objects.

## Known Limitations

- Server-side PDF generation is not implemented.
- CSV equipment list export is not implemented.
- Dedicated input list, lighting patch sheet, and rigging sheet exports are not separate files yet.
- Shareable public blueprint links and branded export templates are future work.
