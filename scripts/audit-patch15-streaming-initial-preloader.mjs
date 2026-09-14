import fs from "node:fs"
const js = fs.readFileSync("src/music.js", "utf8")
const checks = [
  ["canonical loader imported", js.includes("initPagePreloader, renderPagePreloaderMarkup")],
  ["initial loader helper", js.includes("function mountStreamingInitialPreloader()")],
  ["canonical markup reused", js.includes("renderPagePreloaderMarkup()")],
  ["mounted before startup", js.includes("mountStreamingInitialPreloader()\nloadMusicPage()")],
  ["settled after startup", js.includes("settleStreamingInitialPreloader()")],
  ["auth retained", js.includes("state.currentUser = await waitForInitialAuthState()")],
  ["catalog retained", js.includes("const [featured, newest, artists, recent, popular, liveStreams] = await Promise.all([")],
]
let failed = 0
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed++ }
if (failed) process.exit(1)
console.log("\nPatch 15 Streaming initial-preloader audit passed.")
