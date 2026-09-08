import { keyAlterations } from './scoreTheory.js'

const staffState = (measure, staff) => ({
  clef: staff.isTab ? 'tab' : measure.staffClefs?.[staff.id] || staff.clef,
  key: measure.staffKeys?.[staff.id] || measure.key || 'C',
  numerator: measure.numerator,
  denominator: measure.denominator
})
const sameKey = (a, b) => {
  const left = keyAlterations(a), right = keyAlterations(b)
  return ['A','B','C','D','E','F','G'].every(step => (left[step] || 0) === (right[step] || 0))
}

/** Musical state, not mounted DOM, determines which stave modifiers are needed. */
export function signatureDisplay(measure, previousMeasure, staff, isSystemStart) {
  const current = staffState(measure, staff)
  const previous = previousMeasure ? staffState(previousMeasure, staff) : null
  const clefChanged = !!previous && current.clef !== previous.clef
  const keyChanged = !!previous && !sameKey(current.key, previous.key)
  const timeChanged = !!previous && (current.numerator !== previous.numerator || current.denominator !== previous.denominator)
  const pitched = !staff.isTab && current.clef !== 'percussion'
  return {
    ...current,
    showClef: !previous || isSystemStart || clefChanged,
    showKey: pitched && (!previous || isSystemStart || keyChanged),
    // Conventional meter: initial appearance and changes, not every new line.
    showTime: !staff.isTab && (!previous || timeChanged),
    cancelKey: pitched && keyChanged ? previous.key : undefined,
    smallClef: clefChanged && !isSystemStart
  }
}

export function annotateSystemCells(cells) {
  return cells.map((cell, index) => ({
    ...cell,
    isSystemStart: index === 0 || cells[index - 1].system !== cell.system,
    previousMeasure: cells[index - 1]?.measure || null
  }))
}
