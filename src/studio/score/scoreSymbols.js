export const DYNAMICS = ['ppp','pp','p','mp','mf','f','ff','fff']
export const ARTICULATIONS = { accent:'a>',marcato:'a^',staccato:'a.',staccatissimo:'av',tenuto:'a-',fermata:'a@a' }
export const ORNAMENTS = { trill:'tr',mordent:'mordent_inverted',turn:'turn','inverted-turn':'turn_inverted' }
export const SYMBOL_TYPES = ['dynamic','crescendo','diminuendo','slur','chord','rehearsal','text','clef']
export function normalizeScoreSymbol(input, id) {
  if (!input || !SYMBOL_TYPES.includes(input.type)) return null
  const beat=Number(input.beat)
  if (!Number.isFinite(beat)||beat<0) return null
  const symbol={...input,id:input.id||id,beat,staff:input.staff||'',placement:input.placement==='below'?'below':'above',text:String(input.text||'').slice(0,1000)}
  if(input.type==='dynamic'&&!DYNAMICS.includes(symbol.text)) return null
  if(['crescendo','diminuendo','slur'].includes(input.type)) symbol.endBeat=Math.max(beat+.0625,Number(input.endBeat)||beat+1)
  if(input.type==='slur'&&(!input.startNote||!input.endNote)) return null
  return symbol
}
export function upsertScoreSymbol(document, symbol, id) {
  const normalized=normalizeScoreSymbol(symbol,id)
  if(!normalized)return false
  const i=document.symbols.findIndex(s=>s.id===normalized.id)
  if(i<0)document.symbols.push(normalized);else document.symbols[i]=normalized
  return true
}
export const GM_DRUM_MAP = {
  35:{pitch:65,head:'normal',name:'Acoustic bass drum'},36:{pitch:65,head:'normal',name:'Bass drum'},
  38:{pitch:72,head:'normal',name:'Snare'},40:{pitch:72,head:'normal',name:'Electric snare'},
  42:{pitch:77,head:'x',name:'Closed hi-hat'},44:{pitch:67,head:'x',name:'Pedal hi-hat'},46:{pitch:77,head:'x',name:'Open hi-hat'},
  41:{pitch:67,head:'normal',name:'Low floor tom'},43:{pitch:69,head:'normal',name:'High floor tom'},45:{pitch:71,head:'normal',name:'Low tom'},47:{pitch:74,head:'normal',name:'Mid tom'},48:{pitch:76,head:'normal',name:'High tom'},49:{pitch:81,head:'x',name:'Crash'},51:{pitch:79,head:'x',name:'Ride'}
}
export function drumDisplay(pitch, mapping=GM_DRUM_MAP) {return mapping[pitch]||{pitch:72,head:'x',name:`Unmapped drum ${pitch}`}}
