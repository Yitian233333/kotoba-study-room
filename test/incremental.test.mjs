import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join,dirname,basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialState,validateCourse,validateState,appendCourseBatch,applyAutosave,markRead,courseStats } from '../src/domain.mjs';
import { publishCourse,publishBatch } from '../src/publishing.mjs';
import { bookHtml,curriculumHtml } from '../src/book.mjs';
import { Store } from '../src/store.mjs';
import { createApp,catalogKey } from '../src/server.mjs';
import { planFixture,batchFixture,courseFixture } from './fixture.mjs';
const root=resolve(import.meta.dirname,'..');
const temporary=()=>mkdtempSync(join(tmpdir(),'kotoba-incremental-test-'));
function cleanup(dir){assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.match(basename(dir),/^kotoba-incremental-test-/);rmSync(dir,{recursive:true,force:true});}

test('a plan validates complete chapter coverage, knowledge points, schedule and dependencies',()=>{
  const c=planFixture();assert.doesNotThrow(()=>validateCourse(c));assert.deepEqual(courseStats(c),{chapters:2,total:5,ready:0});
  for(const mutate of [d=>d.chapters[1].lessonIds.pop(),d=>d.chapters[1].lessonIds.push('alpha'),d=>d.lessons[0].knowledgePoints=[],d=>d.plan.weeks[0].lessonIds=[],d=>d.lessons[0].sections=[{title:'不应出现',body:'正文'}]]){
    const d=structuredClone(c);mutate(d);assert.throws(()=>validateCourse(d));
  }
  assert.throws(()=>validateCourse(c,{requireComplete:true}));
});
test('batches accept one to three sections, track revisions and reject skips or overwrites',()=>{
  const plan=planFixture(),first=appendCourseBatch(plan,batchFixture(plan,['alpha','beta','gamma']));
  assert.equal(first.revision,1);assert.equal(first.completeness,'in-progress');assert.equal(courseStats(first).ready,3);assert.equal(courseStats(plan).ready,0);
  assert.throws(()=>appendCourseBatch(plan,batchFixture(plan,['alpha','beta','gamma','delta'])),/1至3/);
  assert.throws(()=>appendCourseBatch(plan,batchFixture(plan,[])),/1至3/);
  assert.throws(()=>appendCourseBatch(plan,batchFixture(plan,['beta'])),/前置/);
  assert.throws(()=>appendCourseBatch(first,batchFixture(plan,['delta'])),/版本/);
  assert.throws(()=>appendCourseBatch(first,batchFixture(first,['alpha'])),/覆盖/);
  const duplicate=batchFixture(plan,['alpha','alpha']);assert.throws(()=>appendCourseBatch(plan,duplicate),/重复/);
  const final=appendCourseBatch(first,batchFixture(first,['delta','epsilon']));assert.equal(final.completeness,'complete');assert.equal(final.revision,2);
  assert.notEqual(catalogKey({courses:[plan]}),catalogKey({courses:[first]}));
});
test('detailed lessons reject thin bodies, missing explanations and false coverage references',()=>{
  const c=planFixture();
  for(const mutate of [b=>b.lessons[0].sections[0].body='摘要',b=>b.lessons[0].coverage.pop(),b=>b.lessons[0].coverage[0].sectionTitles=['不存在'],b=>b.lessons[0].questions[0].why='正确',b=>b.lessons[0].task='自行练习',b=>b.lessons[0].title='擅自改名']){
    const b=batchFixture(c);mutate(b);assert.throws(()=>appendCourseBatch(c,b));
  }
});
test('append preserves all learning data and existing content across database restart',()=>{
  const dir=temporary();let store=new Store(join(dir,'kotoba.sqlite'));
  try{
    const plan=publishCourse(store,dir,planFixture(),{plan:true});publishBatch(store,dir,batchFixture(plan));
    store.update(s=>{applyAutosave(s,[{courseId:plan.id,lessonId:'alpha',kind:'note',value:'合成笔记',stamp:100},{courseId:plan.id,lessonId:'alpha',kind:'reader',value:{scrollY:240,percent:35},stamp:101}]);markRead(s,plan.id,'alpha');});
    const before=store.read(),ready=before.courses[0],next=publishBatch(store,dir,batchFixture(ready,['beta']));
    for(const field of ['notes','progress','reader','draftVersions','taskDrafts'])assert.deepEqual(store.read()[field],before[field]);
    assert.deepEqual(next.lessons[0],ready.lessons[0]);assert.equal(JSON.parse(readFileSync(join(dir,'courses',plan.id,'course.json'),'utf8')).revision,2);
    store.close();store=new Store(join(dir,'kotoba.sqlite'));assert.equal(store.read().courses[0].revision,2);assert.doesNotThrow(()=>validateState(store.read()));
  }finally{store.close();cleanup(dir);}
});
test('failed export rolls back the batch and leaves the existing course JSON intact',()=>{
  const dir=temporary(),store=new Store(join(dir,'kotoba.sqlite'));
  try{
    const plan=publishCourse(store,dir,planFixture(),{plan:true}),path=join(dir,'courses',plan.id,'book.html'),json=join(dir,'courses',plan.id,'course.json');
    rmSync(path);mkdirSync(path);const before=store.read(),bytes=readFileSync(json);
    assert.throws(()=>publishBatch(store,dir,batchFixture(plan)));assert.deepEqual(store.read(),before);assert.deepEqual(readFileSync(json),bytes);
  }finally{store.close();cleanup(dir);}
});
test('each lesson keeps reading position while the latest timestamp determines course resume',()=>{
  const s=initialState(),c=courseFixture();s.courses=[c];
  const change=(lessonId,stamp,scrollY,percent)=>({courseId:c.id,lessonId,kind:'reader',stamp,value:{scrollY,percent}});
  applyAutosave(s,[change('alpha',100,500,40),change('beta',200,200,20),change('alpha',150,700,55)]);
  assert.equal(s.reader[c.id].lessonId,'beta');assert.equal(s.progress[c.id+':alpha'].scrollY,700);assert.equal(s.progress[c.id+':alpha'].percent,55);
  applyAutosave(s,[change('alpha',120,10,2)]);assert.equal(s.progress[c.id+':alpha'].scrollY,700);
  applyAutosave(s,[change('alpha',300,100,5)]);assert.equal(s.progress[c.id+':alpha'].percent,55);assert.equal(s.progress[c.id+':alpha'].scrollY,100);
  markRead(s,c.id,'alpha');applyAutosave(s,[change('alpha',400,0,0)]);assert.equal(s.progress[c.id+':alpha'].percent,100);assert.ok(s.progress[c.id+':alpha'].readAt);
  assert.doesNotThrow(()=>validateState(s));assert.throws(()=>applyAutosave(s,[change('alpha',500,0,101)]));
  const planned=initialState();planned.courses=[planFixture()];assert.throws(()=>markRead(planned,planned.courses[0].id,'alpha'),/尚未生成/);
});
test('offline book labels pending content and includes the full chapter knowledge map',()=>{
  const c=planFixture(),html=bookHtml(c);assert.match(html,/待生成/);assert.match(html,/已生成 0 节/);assert.match(html,/课程思维导图/);assert.match(curriculumHtml(c),/核对数据引用/);
  const next=appendCourseBatch(c,batchFixture(c));assert.match(bookHtml(next),/已生成 1 节/);assert.match(bookHtml(next),/参考答案与解析/);
});
test('CLI can plan and append without replacing the course or its exports',()=>{
  const dir=temporary();
  try{
    const plan=planFixture(),input=join(dir,'input.json'),env={...process.env,KOTOBA_DATA_DIR:dir},run=command=>spawnSync(process.execPath,[join(root,'scripts/course.mjs'),command,input],{env,encoding:'utf8',windowsHide:true});
    writeFileSync(input,JSON.stringify(plan));assert.equal(run('plan').status,0);
    writeFileSync(input,JSON.stringify(batchFixture(plan)));assert.equal(run('append').status,0);assert.equal(run('append').status,1);
    const course=JSON.parse(readFileSync(join(dir,'courses',plan.id,'course.json'),'utf8'));assert.equal(course.revision,1);assert.equal(courseStats(course).ready,1);
    const shown=spawnSync(process.execPath,[join(root,'scripts/course.mjs'),'show',plan.id],{env,encoding:'utf8',windowsHide:true});assert.equal(shown.status,0);assert.equal(JSON.parse(shown.stdout).revision,1);
  }finally{cleanup(dir);}
});
test('HTTP imports planned courses, authenticates batch updates and rejects stale versions',async()=>{
  const dir=temporary(),app=createApp({dataDir:dir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  try{
    const url='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(url+'/api/state')).json(),c=planFixture(),post=(path,body,headers={})=>fetch(url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Kotoba-Token':token,...headers},body:JSON.stringify(body)});
    assert.equal((await post('course/import',{course:c})).status,201);const batch=batchFixture(c);
    assert.equal((await post('course/batch',batch,{'X-Kotoba-Token':'wrong'})).status,403);
    assert.equal((await post('lesson/read',{courseId:c.id,lessonId:'alpha'})).status,400);
    assert.equal((await post('course/batch',batch)).status,200);assert.equal((await post('course/batch',batch)).status,400);
    assert.match(await(await fetch(url+'/api/book?course='+c.id)).text(),/已生成 1 节/);
  }finally{await new Promise(r=>app.server.close(r));app.store.close();cleanup(dir);}
});
