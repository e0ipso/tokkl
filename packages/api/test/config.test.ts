import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
function tempDir() { const dir=mkdtempSync(join(tmpdir(),'tokkl-config-')); after(()=>rmSync(dir,{recursive:true,force:true})); return dir; }
test('URL selects storage while unrelated current and legacy settings retain their behavior',()=>{
 const dir=tempDir(); const {config,notices}=loadConfig({TOKKL_DATA_DIR:dir,TOKKL_DATABASE_URL:'sqlite::memory:',TIMETRACK_WEB_ROOT:join(dir,'web'),TIMETRACK_TRUST_PROXY:'2',TOKKL_SESSION_DAYS:'7',TOKKL_SETUP_CODE:'CODE'});
 assert.equal(config.storage.backend,'sqlite'); assert.equal(config.webRoot,join(dir,'web')); assert.equal(config.trustProxy,2); assert.equal(config.sessionDays,7); assert.equal(config.setupCode,'CODE'); assert.equal(notices.length,1);
 assert.equal(loadConfig({TOKKL_DATA_DIR:dir,TOKKL_SESSION_DAYS:'5',TIMETRACK_SESSION_DAYS:'9'}).config.sessionDays,5);
});
test('absent selector defaults without creating files',()=>{const dir=tempDir();assert.deepEqual(loadConfig({TOKKL_DATA_DIR:dir}).config.storage,{backend:'sqlite',filename:join(dir,'tokkl.sqlite'),busyTimeoutMs:5000}); assert.deepEqual(readdirSync(dir),[]);});
test('old settings or default filename require explicit selection and leave data untouched',()=>{
 for(const name of ['TOKKL_DATABASE','TIMETRACK_DATABASE','file']) {const dir=tempDir();writeFileSync(join(dir,'timetrack.sqlite'),'keep');const env={TOKKL_DATA_DIR:dir,...(name==='file'?{}:{[name]:join(dir,'old.sqlite')})};assert.throws(()=>loadConfig(env),/explicit TOKKL_DATABASE_URL/);assert.deepEqual(readdirSync(dir),['timetrack.sqlite']);}
 const dir=tempDir();writeFileSync(join(dir,'timetrack.sqlite'),'keep');assert.equal(loadConfig({TOKKL_DATA_DIR:dir,TOKKL_DATABASE_URL:'sqlite::memory:'}).config.storage.backend,'sqlite');
});
test('invalid explicit selector refuses without exposing credentials or creating a fallback',()=>{const dir=tempDir();assert.throws(()=>loadConfig({TOKKL_DATA_DIR:dir,TOKKL_DATABASE_URL:'bad://secret:credential@host/data'}),{message:'Invalid TOKKL_DATABASE_URL'});assert.deepEqual(readdirSync(dir),[]);});
test('TOKKL_TRUST_PROXY accepts off, a hop count or proxy addresses and ranges, and rejects anything else',()=>{
 const dir=tempDir(); const trust=(value:string|undefined)=>loadConfig({TOKKL_DATA_DIR:dir,TOKKL_TRUST_PROXY:value}).config.trustProxy;
 assert.equal(trust(undefined),false); assert.equal(trust(''),false); assert.equal(trust('0'),false);
 assert.equal(trust('1'),1); assert.equal(trust('3'),3);
 assert.deepEqual(trust('10.0.0.1, 192.168.0.0/16,::1 , fd00::/8,0.0.0.0/0'),['10.0.0.1','192.168.0.0/16','::1','fd00::/8','0.0.0.0/0']);
 for(const value of ['true','yes','on','false','no','off','-1','1.5','10.0.0.0/33','::/129','10.0.0.0/','10.0.0.0/8/1','10.0.0.1,,10.0.0.2','proxy.example.com','loopback','9'.repeat(309),'9007199254740993']) {
  assert.throws(()=>trust(value),(error:Error)=>/TOKKL_TRUST_PROXY/.test(error.message)&&/hop/.test(error.message)&&/CIDR/.test(error.message),value);
 }
});
test('startup names TOKKL_TRUST_PROXY when its value is invalid',async()=>{
 const dir=tempDir();
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/index.ts',import.meta.url))],{env:{...process.env,TOKKL_DATA_DIR:dir,TOKKL_DATABASE_URL:'sqlite::memory:',TOKKL_TRUST_PROXY:'true',HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
 let logs=''; child.stdout.on('data',b=>{logs+=String(b);}); child.stderr.on('data',b=>{logs+=String(b);});
 const deadline=setTimeout(()=>child.kill('SIGKILL'),10000);
 try { assert.equal(await new Promise<number|null>(r=>child.once('exit',r)),1); } finally { clearTimeout(deadline); }
 assert.match(logs,/Startup failed\. Invalid TOKKL_TRUST_PROXY/); assert.doesNotMatch(logs,/tokkl listening/);
});
