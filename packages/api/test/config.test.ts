import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
function tempDir() { const dir=mkdtempSync(join(tmpdir(),'tokkl-config-')); after(()=>rmSync(dir,{recursive:true,force:true})); return dir; }
test('URL selects storage while unrelated current and legacy settings retain their behavior',()=>{
 const dir=tempDir(); const {config,notices}=loadConfig({TOKKL_DATA_DIR:dir,TOKKL_DATABASE_URL:'sqlite::memory:',TIMETRACK_WEB_ROOT:join(dir,'web'),TIMETRACK_TRUST_PROXY:'yes',TOKKL_SESSION_DAYS:'7',TOKKL_SETUP_CODE:'CODE'});
 assert.equal(config.storage.backend,'sqlite'); assert.equal(config.webRoot,join(dir,'web')); assert.equal(config.trustProxy,true); assert.equal(config.sessionDays,7); assert.equal(config.setupCode,'CODE'); assert.equal(notices.length,1);
 assert.equal(loadConfig({TOKKL_DATA_DIR:dir,TOKKL_SESSION_DAYS:'5',TIMETRACK_SESSION_DAYS:'9'}).config.sessionDays,5);
});
test('absent selector defaults without creating files',()=>{const dir=tempDir();assert.deepEqual(loadConfig({TOKKL_DATA_DIR:dir}).config.storage,{backend:'sqlite',filename:join(dir,'tokkl.sqlite'),busyTimeoutMs:5000}); assert.deepEqual(readdirSync(dir),[]);});
test('old settings or default filename require explicit selection and leave data untouched',()=>{
 for(const name of ['TOKKL_DATABASE','TIMETRACK_DATABASE','file']) {const dir=tempDir();writeFileSync(join(dir,'timetrack.sqlite'),'keep');const env={TOKKL_DATA_DIR:dir,...(name==='file'?{}:{[name]:join(dir,'old.sqlite')})};assert.throws(()=>loadConfig(env),/explicit TOKKL_DATABASE_URL/);assert.deepEqual(readdirSync(dir),['timetrack.sqlite']);}
 const dir=tempDir();writeFileSync(join(dir,'timetrack.sqlite'),'keep');assert.equal(loadConfig({TOKKL_DATA_DIR:dir,TOKKL_DATABASE_URL:'sqlite::memory:'}).config.storage.backend,'sqlite');
});
test('invalid explicit selector refuses without exposing credentials or creating a fallback',()=>{const dir=tempDir();assert.throws(()=>loadConfig({TOKKL_DATA_DIR:dir,TOKKL_DATABASE_URL:'bad://secret:credential@host/data'}),{message:'Invalid TOKKL_DATABASE_URL'});assert.deepEqual(readdirSync(dir),[]);});
