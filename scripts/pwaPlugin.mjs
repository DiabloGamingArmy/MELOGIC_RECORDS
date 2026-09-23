import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export function melogicPwaPlugin() {
  let outputDir
  let assets = []
  return {
    name: 'melogic-pwa',
    configResolved(config) { if (config.command === 'build') outputDir = resolve(config.root, config.build.outDir) },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const updated = html.replace(/(<meta\s+name="viewport"\s+content=")([^"]*)("\s*\/?>)/i, (_, before, value, after) => `${before}${value.includes('viewport-fit') ? value : `${value}, viewport-fit=cover`}${after}`)
        const tags = [
          { tag: 'script', attrs: { type: 'module', src: '/src/pwa/register.js' }, injectTo: 'head' },
          ...['apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'mobile-web-app-capable'].filter(name => !html.includes(`name="${name}"`)).map(name => ({ tag: 'meta', attrs: { name, content: name.endsWith('status-bar-style') ? 'black' : 'yes' }, injectTo: 'head' }))
        ]
        return { html: updated, tags }
      }
    },
    generateBundle(_, bundle) {
      assets = Object.keys(bundle).filter(name => /^assets\/.*\.(js|css|woff2?)$/.test(name)).sort()
    },
    async closeBundle() {
      if (!outputDir) return
      const path = resolve(outputDir, 'melogic-push-sw.js')
      const worker = await readFile(path, 'utf8')
      const offline = await readFile(resolve(outputDir, 'offline.html'))
      const manifest = await readFile(resolve(outputDir, 'manifest.webmanifest'))
      const version = createHash('sha256').update(worker).update(offline).update(manifest).update(assets.join('\n')).digest('hex').slice(0, 16)
      await writeFile(path, worker.replaceAll('__MELOGIC_PWA_BUILD__', version))
      await writeFile(resolve(outputDir, 'melogic-build.json'), JSON.stringify({ build: version }, null, 2) + '\n')
    }
  }
}
