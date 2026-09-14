const STORAGE_KEY = 'melogic_persistent_music_playback_v1'
const MAX_AGE_MS = 1000 * 60 * 60 * 12
let globalAudio = null
let globalState = null
let listenersBound = false
function safeRead(){try{const p=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null');if(!p||!p.track?.streamAudioURL)return null;if(Date.now()-Number(p.savedAt||0)>MAX_AGE_MS)return null;return p}catch{return null}}
function safeWrite(v){try{sessionStorage.setItem(STORAGE_KEY,JSON.stringify(v))}catch{}}
export function snapshotPersistentMusicPlayback({track,audio,playing,volume,currentTime,duration}={}){
 if(!track?.streamAudioURL)return
 const mediaTime=Number(audio?.currentTime??currentTime??0)||0
 const snapshot={track,playing:playing===true&&audio?.paused!==true,volume:Number.isFinite(Number(volume))?Number(volume):.85,currentTime:mediaTime,duration:Number(audio?.duration||duration||track.duration||0)||0,savedAt:Date.now()}
 globalState=snapshot;safeWrite(snapshot)
}
export function clearPersistentMusicPlayback(){globalState=null;try{sessionStorage.removeItem(STORAGE_KEY)}catch{}if(globalAudio){globalAudio.pause();globalAudio.removeAttribute('src');globalAudio.load?.();globalAudio=null}}
export function readPersistentMusicPlayback(){return globalState||safeRead()}
export function claimPersistentMusicAudio(track,{volume=.85}={}){
 if(!track?.streamAudioURL)return null
 if(globalAudio&&globalAudio.dataset.melogicTrackId===String(track.id||'')){globalAudio.volume=volume;return globalAudio}
 if(globalAudio){globalAudio.pause();globalAudio.removeAttribute('src')}
 globalAudio=new Audio(track.streamAudioURL);globalAudio.preload='auto';globalAudio.volume=volume;globalAudio.dataset.melogicTrackId=String(track.id||'');return globalAudio
}
export async function resumePersistentMusicPlayback(){
 const saved=readPersistentMusicPlayback();if(!saved?.track?.streamAudioURL||!saved.playing)return null
 const audio=claimPersistentMusicAudio(saved.track,{volume:saved.volume});if(!audio)return null
 const elapsed=Math.max(0,(Date.now()-Number(saved.savedAt||Date.now()))/1000)
 const target=Math.max(0,Number(saved.currentTime||0)+elapsed)
 const seek=()=>{const max=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:target;audio.currentTime=Math.min(target,max)}
 if(audio.readyState>=1)seek();else audio.addEventListener('loadedmetadata',seek,{once:true})
 try{await audio.play()}catch{return audio}
 globalState={...saved,currentTime:target,savedAt:Date.now(),playing:true};safeWrite(globalState);return audio
}
export function installPersistentMusicNavigationBridge(){
 if(listenersBound)return;listenersBound=true
 window.addEventListener('pagehide',()=>{if(!globalAudio||!globalState?.track)return;snapshotPersistentMusicPlayback({track:globalState.track,audio:globalAudio,playing:!globalAudio.paused,volume:globalAudio.volume,duration:globalAudio.duration})})
 resumePersistentMusicPlayback().catch(()=>{})
}
export function adoptPersistentMusicState({track,audio,playing,volume,currentTime,duration}={}){
 if(!track?.streamAudioURL)return;globalAudio=audio||globalAudio;globalState={track,playing:playing===true,volume,currentTime,duration,savedAt:Date.now()};snapshotPersistentMusicPlayback({track,audio:globalAudio,playing,volume,currentTime,duration})
}
