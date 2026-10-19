import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { createApp } from '../src/server.mjs';
import { applyAutosave,markRead } from '../src/domain.mjs';
import { courseFixture } from './fixture.mjs';

test('two-stage deletion requires exact title, a live one-use token and unchanged course; preserves other courses',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'kotoba-delete-test-'));let time=1000;
  const app=createApp({dataDir:dir,now:()=>time});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+app.server.address().port,token=(await(await fetch(url+'/api/state')).json()).token;
  const post=(path,body,headers={})=>fetch(url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Kotoba-Token':token,...headers},body:JSON.stringify(body)});
  const c=courseFixture(),other={...structuredClone(c),id:c.id+'-other'};
  try{
    app.store.update(s=>{
      s.courses=[c,other];
      for(const course of s.courses){
        const base={courseId:course.id,lessonId:course.lessons[0].id,stamp:1};
        applyAutosave(s,[{...base,kind:'note',value:'合成笔记'},{...base,kind:'task',value:'合成草稿'},{...base,kind:'reader',value:{scrollY:100}}]);markRead(s,base.courseId,base.lessonId);
      }
    });
    const before=app.store.read();
    assert.equal((await post('course/delete',{courseId:c.id,confirmedTitle:c.title})).status,400);
    assert.equal((await post('course/delete/prepare',{courseId:c.id},{origin:'https://untrusted.example'})).status,403);
    const prepare=async()=>{const response=await post('course/delete/prepare',{courseId:c.id});assert.equal(response.status,200);return response.json();};
    const prepared=await prepare();assert.deepEqual(app.store.read(),before,'first confirmation must not delete anything');
    const request={courseId:c.id,confirmationToken:prepared.confirmationToken,confirmedTitle:c.title};
    assert.equal((await post('course/delete',{...request,confirmedTitle:c.title+' '})).status,400);
    assert.equal((await post('course/delete',{...request,courseId:other.id})).status,400);
    assert.deepEqual(app.store.read(),before);
    time+=300001;assert.equal((await post('course/delete',request)).status,400);
    const changed=await prepare();app.store.update(s=>{s.courses[0].description+=' changed';});
    assert.equal((await post('course/delete',{...request,confirmationToken:changed.confirmationToken})).status,400);
    const fresh=await prepare();request.confirmationToken=fresh.confirmationToken;
    assert.equal((await post('course/delete',request)).status,200);
    assert.equal((await post('course/delete',request)).status,400,'confirmation is single use');
    const after=app.store.read();assert.deepEqual(after.courses,[other]);
    for(const field of ['notes','taskDrafts','progress','draftVersions']){
      assert.ok(!Object.keys(after[field]).some(key=>key.startsWith(c.id+':')));
      for(const [key,value] of Object.entries(before[field]))if(key.startsWith(other.id+':'))assert.deepEqual(after[field][key],value);
    }
    assert.deepEqual(after.reader,{[other.id]:before.reader[other.id]});
    assert.equal((await post('autosave',{changes:[{courseId:c.id,lessonId:c.lessons[0].id,kind:'note',value:'late',stamp:2}]})).status,400);
    assert.deepEqual(app.store.read(),after,'late autosave cannot resurrect a deleted course');
    assert.equal((await(await fetch(url+'/api/catalog')).json()).count,1);
    assert.equal((await fetch(url+'/api/book?course='+c.id)).status,400);
    const restoreToken=await(await post('course/delete/prepare',{courseId:other.id})).json();
    assert.equal((await post('restore',after)).status,200);
    assert.equal((await post('course/delete',{courseId:other.id,confirmationToken:restoreToken.confirmationToken,confirmedTitle:other.title})).status,400,'restore invalidates pending delete confirmations');
  }finally{
    await new Promise(r=>app.server.close(r));app.store.close();
    assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.match(basename(dir),/^kotoba-delete-test-/);rmSync(dir,{recursive:true,force:true});
  }
});
