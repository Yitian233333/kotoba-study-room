import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { initialState, validateCourse, validateState, migrateState, applyAutosave, markRead } from '../src/domain.mjs';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';
import { bookHtml, markdown, roadmapSvg } from '../src/book.mjs';
import { courseFixture,legacyFixture } from './fixture.mjs';
const root=resolve(import.meta.dirname,'..');
const temporary=()=>mkdtempSync(join(tmpdir(),'kotoba-v2-test-'));
function cleanup(dir){const p=resolve(dir);assert.equal(dirname(p),resolve(tmpdir()));assert.match(basename(p),/^kotoba-v2-test-/);rmSync(p,{recursive:true,force:true});}
test('fresh library has no course or independent learner history',()=>{
  const s=initialState();assert.deepEqual(s.courses,[]);for(const k of ['profile','attempts','events','reviews','taskAnswers'])assert.equal(k in s,false);
});
test('migration preserves course, notes, read progress and deletes old answer details',()=>{
  const s=migrateState(legacyFixture());assert.equal(s.courses.length,1);assert.equal(s.courses[0].completeness,'legacy');
  assert.equal(s.notes['legacy-sample:alpha'],'保留的笔记');assert.ok(s.progress['legacy-sample:alpha'].readAt);
  assert.deepEqual(s.taskDrafts,{});assert.doesNotMatch(JSON.stringify(s),/明确删除|旧任务答案|"attempts"|"reviews"|"events"/);
});
test('database migration also sanitizes historical snapshots',()=>{
  const dir=temporary(),path=join(dir,'kotoba.sqlite'),db=new DatabaseSync(path),raw=JSON.stringify(legacyFixture());
  db.exec('CREATE TABLE state(id INTEGER PRIMARY KEY,data TEXT);CREATE TABLE snapshots(id INTEGER PRIMARY KEY,created_at TEXT,reason TEXT,data TEXT)');
  db.prepare('INSERT INTO state VALUES(1,?)').run(raw);db.prepare('INSERT INTO snapshots VALUES(1,?,?,?)').run('now','old',raw);db.close();
  const store=new Store(path);try{assert.equal(store.read().schemaVersion,2);const snapshot=store.db.prepare('SELECT data FROM snapshots').get().data;assert.doesNotMatch(snapshot,/明确删除|旧任务答案|"attempts"/);assert.match(snapshot,/保留的笔记/);}finally{store.close();cleanup(dir);}
});
test('complete course accepts general subjects and more than twelve chapters',()=>{
  const c=courseFixture();c.subject='程序设计';c.lessons=Array.from({length:18},(_,i)=>({...structuredClone(c.lessons[0]),id:'chapter-'+i,prerequisites:[],questions:c.lessons[0].questions.map((q,j)=>({...q,id:'q-'+i+'-'+j}))}));
  c.roadmap.edges=[];c.plan.weeks[0].lessonIds=c.lessons.map(l=>l.id);assert.equal(validateCourse(c,{requireComplete:true}).lessons.length,18);
});
test('publication rejects outline-only content and incomplete plans',()=>{
  const c=courseFixture();assert.doesNotThrow(()=>validateCourse(c,{requireComplete:true}));
  c.lessons[0].sections=[{title:'大纲',body:'待生成'},{title:'知识点',body:'略'}];assert.throws(()=>validateCourse(c,{requireComplete:true}),/占位/);
  const d=courseFixture();d.plan.weeks[0].lessonIds=[];assert.throws(()=>validateCourse(d,{requireComplete:true}),/覆盖所有/);
  const legacy=migrateState(legacyFixture()).courses[0];assert.throws(()=>validateCourse(legacy,{requireComplete:true}),/只能发布完整/);
});
test('prerequisites, graph consistency and cycles are checked',()=>{
  const c=courseFixture();c.lessons[1].prerequisites=['missing'];assert.throws(()=>validateCourse(c),/不存在/);
  const d=courseFixture();d.lessons[0].prerequisites=[d.lessons[1].id];assert.throws(()=>validateCourse(d),/循环/);
  const g=courseFixture();g.roadmap.edges=[];assert.throws(()=>validateCourse(g),/遗漏/);
});
test('state import never reintroduces old history fields',()=>{
  const s=initialState();s.attempts=['old'];s.events=['old'];const valid=validateState(s);assert.equal(valid.attempts,undefined);assert.equal(valid.events,undefined);
});
test('latest autosave wins, only current task draft is retained',()=>{
  const s=initialState(),c=courseFixture(),l=c.lessons[0];s.courses=[c];
  const change={courseId:c.id,lessonId:l.id,kind:'task',value:'最新文本',stamp:200};
  applyAutosave(s,[change]);applyAutosave(s,[{...change,stamp:100,value:'过时请求'}]);assert.equal(s.taskDrafts[c.id+':'+l.id],'最新文本');assert.equal(s.attempts,undefined);
  applyAutosave(s,[{...change,lessonId:c.lessons[1].id,kind:'reader',stamp:200,value:{scrollY:700}}]);
  applyAutosave(s,[{...change,kind:'reader',stamp:100,value:{scrollY:300}}]);assert.equal(s.reader[c.id].lessonId,c.lessons[1].id);
});
test('autosave survives database restart and a bad batch rolls back',()=>{
  const dir=temporary(),path=join(dir,'db.sqlite');let store=new Store(path);const c=courseFixture(),l=c.lessons[0],base={courseId:c.id,lessonId:l.id,stamp:1};
  try{
    store.update(s=>s.courses.push(c));store.update(s=>applyAutosave(s,[{...base,kind:'note',value:'持久笔记'},{...base,kind:'reader',value:{scrollY:650}}]));store.update(s=>markRead(s,c.id,l.id));
    assert.throws(()=>store.update(s=>applyAutosave(s,[{...base,kind:'note',value:'不应写入',stamp:2},{...base,lessonId:'missing',kind:'note',value:'x'}])));
    store.close();store=new Store(path);assert.equal(store.read().notes[c.id+':'+l.id],'持久笔记');assert.equal(store.read().reader[c.id].scrollY,650);assert.ok(store.read().progress[c.id+':'+l.id].readAt);
  }finally{store.close();cleanup(dir);}
});
test('complete offline ebook includes all chapters, plan, graph, projects and safe text',()=>{
  const c=courseFixture(),book=bookHtml(c);for(const l of c.lessons){assert.ok(book.includes(l.title));assert.ok(book.includes(l.sections[0].body));}
  for(const str of ['完整学习计划','大纲路线图','综合项目','参考答案与解析'])assert.ok(book.includes(str));assert.match(book,/<svg/);
  assert.equal(markdown('<script>alert(1)</script>'),'<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.match(roadmapSvg(c),/#\/course\//);
});
test('CLI publishes whole course and ebook once; invalid course stays out of library',()=>{
  const dir=temporary(),file=join(dir,'course.json'),c=courseFixture(),env={...process.env,KOTOBA_DATA_DIR:dir};writeFileSync(file,JSON.stringify(c));
  const run=command=>spawnSync(process.execPath,[join(root,'scripts/course.mjs'),command,file],{env,encoding:'utf8',windowsHide:true});
  try{
    assert.equal(run('validate').status,0);assert.equal(run('publish').status,0);assert.ok(existsSync(join(dir,'courses',c.id,'book.html')));
    const original=readFileSync(join(dir,'courses',c.id,'course.json'),'utf8');assert.equal(run('publish').status,1);assert.equal(readFileSync(join(dir,'courses',c.id,'course.json'),'utf8'),original);
    c.id='incomplete';c.lessons[0].sections[0].body='TODO';writeFileSync(file,JSON.stringify(c));assert.equal(run('publish').status,1);
    const store=new Store(join(dir,'kotoba.sqlite'));assert.equal(store.read().courses.length,1);store.close();assert.equal(existsSync(join(dir,'courses','incomplete','book.html')),false);
  }finally{cleanup(dir);}
});
test('HTTP supports authenticated exit beacon, complete import, catalog and library backup',async()=>{
  const dir=temporary(),app=createApp({dataDir:dir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.server.address().port;
  try{
    let data=await (await fetch(url+'/api/state')).json();assert.equal(data.state.courses.length,0);const token=data.token;
    const post=(path,body,extra={})=>fetch(url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Kotoba-Token':token,...extra},body:JSON.stringify(body)});
    const c=courseFixture();assert.equal((await post('course/import',{course:c})).status,201);
    assert.equal((await post('course/import',{course:c})).status,400);
    assert.equal((await post('autosave',{changes:[]},{origin:'https://untrusted.example'})).status,403);
    const changes=[{courseId:c.id,lessonId:c.lessons[0].id,kind:'note',value:'退出时的笔记',stamp:10}];
    assert.equal((await fetch(url+'/api/autosave',{method:'POST',headers:{'Content-Type':'application/json',origin:url},body:JSON.stringify({token,changes})})).status,200);
    const backup=await (await fetch(url+'/api/backup')).json();assert.equal(backup.notes[c.id+':'+c.lessons[0].id],'退出时的笔记');assert.equal(backup.attempts,undefined);
    assert.equal((await (await fetch(url+'/api/catalog')).json()).count,1);
    assert.match(await (await fetch(url+'/api/book?course='+c.id)).text(),/完整学习计划/);
    assert.equal((await fetch(url+'/api/history')).status,404);assert.equal((await post('attempt',{})).status,404);
    assert.equal((await fetch(url+'/modules/book.mjs')).status,200);
  }finally{await new Promise(r=>app.server.close(r));app.store.close();cleanup(dir);}
});
