import { editorTitleStamp } from '../app/stageState'

export function renderExportPreview() {
  const { title, stamp } = editorTitleStamp()
  return `<div class="stage-export-modal"><div class="stage-export-sheet"><h3>Stage Plan Preview</h3><p>${title} • ${stamp}</p><div class="stage-export-drawing">Stage Plot Sheet Preview (vector foundation)</div><div class="stage-export-inputs"><h4>Input List Sheet</h4><p>Channel • Source • Mic/DI • Stand • Notes</p></div><div class="stage-export-actions"><button disabled title="PDF export coming soon; use SVG/JSON for now.">Export PDF</button><button>Export PNG</button><button>Export SVG</button><button>Export JSON</button><button>Copy Share Link</button><button data-close-export>Close</button></div></div></div>`
}
