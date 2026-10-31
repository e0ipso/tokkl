import { fork } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import type { StorageConfig } from '../../../src/storage/config.ts';
export function migrationChild(config: StorageConfig, mode: 'concurrent' | 'interrupt' | 'held' | 'baseline' | 'held-baseline') {
  const child=fork(new URL('./migrationChild.ts',import.meta.url),[], { env:{...process.env,TOKKL_TEST_CONFIG:JSON.stringify(config),TOKKL_TEST_MODE:mode},stdio:['ignore','ignore','pipe','ipc'] });
  let stderr=''; child.stderr!.on('data',chunk=>{stderr+=chunk});
  const messages: unknown[]=[];
  child.on('message',message=>messages.push(message));
  const exited=once(child,'exit');
  const waitMessage=async(expected:string)=>{
    const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
    try {
      while(!messages.includes(expected)) {
        const result=await Promise.race([once(child,'message').then(([message])=>({message})),exited.then(()=>({exit:true}))]);
        assert.ok(!('exit' in result),`migration child exited: ${stderr} ${JSON.stringify(messages)}`);
        if('message' in result && typeof result.message==='object') assert.fail(JSON.stringify(result.message));
      }
    } finally { clearTimeout(timer); }
  };
  return {child,waitMessage,exited,messages};
}
