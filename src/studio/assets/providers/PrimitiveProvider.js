export class PrimitiveProvider {
  constructor() { this.id = 'primitive'; this.sourceType = 'primitive' }
  async listAssets() { return [] }
  async resolveAsset() { throw new Error('The Soura Primitives catalog is not connected yet.') }
}

