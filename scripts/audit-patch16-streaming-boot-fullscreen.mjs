import fs from "node:fs"
const h=fs.readFileSync("music.html","utf8"),j=fs.readFileSync("src/music.js","utf8"),c=fs.readFileSync("src/styles/music.css","utf8")
const x=[
["first-paint loader",h.includes('id="streaming-first-paint"')],
["loader before module",h.indexOf("streaming-first-paint")<h.indexOf("/src/music.js")],
["M artwork",h.includes("melogic-logo-mark-white-transparent.png")],
["canonical handoff",j.includes("document.querySelector('#streaming-first-paint')?.remove()")],
["expandable player marker",j.includes("data-expandable-player")],
["delegated expansion",j.includes("function bindExpandableMusicPlayer()")],
["back control",j.includes("data-close-fullscreen-player")],
["escape close",j.includes("event.key === 'Escape'")],
["rerender preservation",j.includes("playerWasExpanded")],
["fullscreen styles",c.includes("Patch 16: authoritative expandable Streaming player")]
]
let n=0;for(const [k,v] of x){console.log(`${v?"PASS":"FAIL"}  ${k}`);if(!v)n++}if(n)process.exit(1);console.log("\nPatch 16 audit passed.")
