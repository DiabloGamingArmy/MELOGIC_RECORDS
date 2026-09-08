// melogic-toolbox-foundation-v1
const handlers=new Map(),active=new Map()
export function registerToolHandler(slug,handler){const key=String(slug||'').trim();if(!key||typeof handler!=='function')throw new Error('Invalid Toolbox handler');handlers.set(key,handler);return()=>handlers.delete(key)}
export const hasToolHandler=slug=>handlers.has(String(slug||'').trim())
export async function executeTool(slug,payload={},opts={}){const key=String(slug||'').trim(),handler=handlers.get(key);if(!handler)throw new Error(`Tool "${key}" is not implemented yet.`);if(active.has(key))throw new Error(`Tool "${key}" is already running.`);const controller=new AbortController();active.set(key,controller);try{return await handler(payload,{signal:controller.signal,onProgress:opts.onProgress||(()=>{})})}finally{if(active.get(key)===controller)active.delete(key)}}
export function cancelToolRun(slug){const c=active.get(String(slug||'').trim());if(!c)return false;c.abort();return true}
