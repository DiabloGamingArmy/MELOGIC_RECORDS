const refs=new Map();
export function isSouraDesktopRuntime(){return Boolean(globalThis.__TAURI_INTERNALS__||globalThis.__TAURI__||/Tauri/i.test(navigator.userAgent||''))}
export function getNativeFilePath(file){return typeof file?.path==='string'?file.path:''}
export function registerDesktopLocalAudioReference(runtimeId,file){
 if(!runtimeId||!file||!isSouraDesktopRuntime())return null;
 const old=refs.get(runtimeId); if(old?.objectUrl)try{URL.revokeObjectURL(old.objectUrl)}catch{}
 const ref={runtimeId,file,nativePath:getNativeFilePath(file),objectUrl:URL.createObjectURL(file),fileName:file.name||'Audio',fileSizeBytes:Number(file.size)||0,contentType:file.type||'audio/*',registeredAt:Date.now()};
 refs.set(runtimeId,ref); return ref
}
export function getDesktopLocalAudioReference(id){return refs.get(id)||null}
export function releaseDesktopLocalAudioReference(id){const r=refs.get(id);if(!r)return false;if(r.objectUrl)try{URL.revokeObjectURL(r.objectUrl)}catch{};refs.delete(id);return true}
export function getSouraImportPersistenceMode(){return isSouraDesktopRuntime()?'desktop-local-first':'web-cloud-required'}
