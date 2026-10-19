import { escapeHtml as e, rubyHtml, keyFor } from '/modules/domain.mjs';
import { markdown, roadmapSvg, planHtml } from '/modules/book.mjs';
const $=s=>document.querySelector(s), uri=encodeURIComponent;
let state,token='',catalog='',route=null,saveTimer,scrollTimer,toastTimer,inFlight=null,restoring=false;
let stampCounter=0,lastStamp=0,deletion=null;
const pending=new Map(), answers=new Map(), storageKey='kotoba-v2-pending';
const tabs=[['overview','课程概览'],['contents','目录与课件'],['roadmap','大纲路线图'],['plan','学习计划'],['book','电子书']];
const courseUrl=(c,tab='overview')=>'#/course/'+uri(c.id)+(tab==='overview'?'':'/'+tab);
const lessonUrl=(c,l)=>courseUrl(c,'lesson/'+uri(l.id));
const countRead=c=>c.lessons.filter(l=>state.progress[keyFor(c.id,l.id)]?.readAt).length;
const linkButton=(label,url,cls='')=>`<a class="btn ${cls}" href="${url}">${label}</a>`;
function toast(text,error=false){const el=$('#toast');el.textContent=text;el.className='toast visible'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),5000);}
async function api(path,body){
  const r=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Kotoba-Token':token},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'操作未完成。');return data;
}
async function load(){const data=await api('state');state=data.state;token=data.token;catalog=data.catalogKey;}
function parseRoute(){const p=(location.hash||'#/courses').slice(2).split('/').map(decodeURIComponent);return {view:p[0],courseId:p[1],tab:p[2]||'overview',lessonId:p[3]};}
function stamp(){return lastStamp=Math.max(Date.now()*1000+(stampCounter++%1000),lastStamp+1);}
function status(message){const el=$('#save-status');if(el)el.textContent=message||(pending.size?'正在自动保存…':'已自动保存');}
function persistPending(){try{localStorage.setItem(storageKey,JSON.stringify([...pending.values()]));}catch{status('草稿存储已满，正在写入本地服务…');}}
function updateLocal(change){
  const k=keyFor(change.courseId,change.lessonId);
  if(change.kind==='note')state.notes[k]=change.value;
  if(change.kind==='task')state.taskDrafts[k]=change.value;
  if(change.kind==='reader')state.reader[change.courseId]={lessonId:change.lessonId,...change.value};
}
function queue(courseId,lessonId,kind,value){
  const change={courseId,lessonId,kind,value,stamp:stamp()},key=courseId+':'+lessonId+':'+kind;
  pending.set(key,change);updateLocal(change);persistPending();status();clearTimeout(saveTimer);saveTimer=setTimeout(flush,350);
}
async function flush(){
  if(inFlight||!pending.size)return inFlight;
  const batch=[...pending.values()].slice(0,100);
  inFlight=(async()=>{
    try{
      await api('autosave',{changes:batch});
      for(const c of batch){const k=c.courseId+':'+c.lessonId+':'+c.kind;if(pending.get(k)?.stamp===c.stamp)pending.delete(k);}
      persistPending();status();
    }catch{status('连接中断，草稿已留在此浏览器，连接后自动保存');}
  })();
  await inFlight;inFlight=null;if(pending.size){clearTimeout(saveTimer);saveTimer=setTimeout(flush,1500);}
}
function savePosition(){
  if(restoring||route?.tab!=='lesson')return;
  const c=state?.courses.find(c=>c.id===route.courseId);
  if(c?.lessons.some(l=>l.id===route.lessonId))queue(c.id,route.lessonId,'reader',{scrollY:Math.round(window.scrollY)});
}
function exitSave(){
  savePosition();persistPending();
  const changes=[...pending.values()];
  // Normal writes are debounced; beacon covers an immediate close before the debounce.
  for(let i=0;i<changes.length;i+=20){
    const body=new Blob([JSON.stringify({token,changes:changes.slice(i,i+20)})],{type:'application/json'});
    if(body.size<60000)navigator.sendBeacon('/api/autosave',body);
  }
}
function badge(c){return `<span class="pill ${c.completeness==='legacy'?'legacy':''}">${c.completeness==='legacy'?'导入课程':'完整课程'}</span>`;}
function library(){
  const subjects=[...new Set(state.courses.map(c=>c.subject))];
  return `<div class="page-heading"><div><p class="eyebrow">YOUR PERSONAL LIBRARY</p><h1>我的课程库<span class="count">${state.courses.length}</span></h1><p class="muted">从一个想学的主题，到一本属于你的课程书。</p></div><button class="btn primary" data-action="create">＋ 在 Codex 中创建课程</button></div>
  <div class="library-tools"><label class="search"><span>⌕</span><input id="search" type="search" placeholder="搜索课程名称或科目" aria-label="搜索课程"></label><select id="subject-filter" aria-label="筛选科目"><option value="">所有科目</option>${subjects.map(s=>`<option>${e(s)}</option>`).join('')}</select><button class="btn subtle" data-action="import">导入课程</button></div>
  <div class="course-grid" id="course-grid">${state.courses.length?state.courses.map((c,i)=>`<a class="course-card" data-course="${e((c.title+' '+c.subject).toLowerCase())}" data-subject="${e(c.subject)}" href="${courseUrl(c)}"><div class="book-cover tone-${i%3}"><span class="cover-subject">${e(c.subject)}</span><h2>${e(c.title)}</h2><p>${e(c.subtitle)}</p><span class="cover-mark">K / ${String(i+1).padStart(2,'0')}</span></div><div class="card-body"><div class="row">${badge(c)}<span class="muted">${c.lessons.length} 章</span></div><p>${e(c.description)}</p><div class="card-foot"><span>已读 ${countRead(c)} / ${c.lessons.length} 章</span><b>进入课程 ↗</b></div></div></a>`).join(''):`<div class="empty"><div class="empty-book">本</div><h2>第一门课程，从一句话开始</h2><p>在当前 Codex 聊天中说明想学的科目。<br>Codex 会了解你的目标、基础和时间，再生成完整教材、路线和计划。</p><button class="btn primary" data-action="create">查看创建方式</button></div>`}</div><p id="no-match" class="muted hidden">没有找到匹配的课程。</p>
  <div class="library-note"><span>01 / 对话明确目标</span><span>02 / 一次生成完整课程</span><span>03 / 在课程中阅读与练习</span></div>`;
}
function sources(c){return `<ul class="sources">${c.sources.map(s=>`<li>${s.url?`<a href="${e(s.url)}" target="_blank" rel="noreferrer">${e(s.title)} ↗</a>`:e(s.title)}<small>${e(s.note||s.usage||'')}</small></li>`).join('')}</ul>`;}
function projects(c){return c.projects.map(p=>`<section class="project"><h3>${e(p.title)}</h3>${markdown(p.description)}<ol>${p.steps.map(s=>`<li>${e(s)}</li>`).join('')}</ol><p><b>完成标准：</b>${p.criteria.map(e).join('；')}</p></section>`).join('');}
function overview(c){
  const resume=c.lessons.find(l=>l.id===state.reader[c.id]?.lessonId)||c.lessons[0];
  return `<div class="course-intro"><div><p class="eyebrow">${e(c.subject)} / COURSE</p><h1>${e(c.title)}</h1><p class="lead">${e(c.description)}</p><div class="row">${badge(c)}<span>${c.lessons.length} 章 · 已读 ${countRead(c)} 章</span></div></div><div class="continue-box"><span class="eyebrow">NEXT PAGE</span><h3>${e(resume.title)}</h3>${linkButton(state.reader[c.id]?'继续阅读 →':'开始阅读 →',lessonUrl(c,resume),'primary')}</div></div>
  ${c.completeness==='legacy'?'<p class="notice">此课程未提供完整的学习计划和综合项目，可阅读已有教材。</p>':''}
  <div class="two-columns"><section class="panel"><p class="eyebrow">THE DESTINATION</p><h2>这门课为你解决什么</h2><p>${e(c.brief.goal)}</p><dl><div><dt>当前基础</dt><dd>${e(c.brief.level||'以课程前置要求为准')}</dd></div><div><dt>时间安排</dt><dd>${e(c.brief.minutesPerDay||'—')} 分钟 / 天 · ${e(c.brief.daysPerWeek||'—')} 天 / 周</dd></div></dl><h3>完成后，你将能够</h3><ul>${c.outcomes.map(x=>`<li>${e(x)}</li>`).join('')}</ul></section><section class="panel"><p class="eyebrow">HOW TO LEARN</p><h2>沿着知识的顺序学习</h2><p>先看目录和大纲路线图，理解每章的作用，再进入课件。讲解之后有例子、自测和实践任务，笔记会自动保存。</p><div class="quick-links">${linkButton('查看课程目录 ↗',courseUrl(c,'contents'),'secondary')}${linkButton('查看完整计划 ↗',courseUrl(c,'plan'),'secondary')}${linkButton('打开电子书 ↗',courseUrl(c,'book'),'secondary')}</div></section></div>
  ${c.projects.length?`<section class="panel"><p class="eyebrow">LEARN BY MAKING</p><h2>综合实践项目</h2>${projects(c)}</section>`:''}
  <section class="panel"><h2>参考与延伸阅读</h2>${sources(c)||'<p>暂无外部参考资料。</p>'}</section>
  <section class="panel danger-zone"><div><h2>课程管理</h2><p>删除本课程及其笔记、草稿和进度。需要两步确认。</p></div><button class="btn danger-outline" data-action="delete-start">删除这门课程</button></section>`;
}
function contents(c){return `<div class="section-heading"><p class="eyebrow">TABLE OF CONTENTS</p><h1>目录与课件</h1><p class="muted">每个章节包含知识讲解、例子、自测和实践任务。</p></div><div class="syllabus">${c.lessons.map((l,i)=>`<a class="syllabus-item" href="${lessonUrl(c,l)}"><span class="chapter-number">${String(i+1).padStart(2,'0')}</span><div><div class="row"><h2>${e(l.title)}</h2>${state.progress[keyFor(c.id,l.id)]?.readAt?'<span class="pill">已读</span>':''}</div><p>${e(l.objective)}</p>${l.importanceReason?`<p class="importance">为什么学：${e(l.importanceReason)}</p>`:''}<small>${l.minutes} 分钟 · ${l.sections.length} 节讲解 · 前置：${l.prerequisites.map(id=>e(c.lessons.find(x=>x.id===id).title)).join('、')||'无，从这里开始'}</small></div><b>↗</b></a>`).join('')}</div>`;}
function roadmap(c){return `<div class="section-heading"><p class="eyebrow">THE BIG PICTURE</p><h1>大纲路线图</h1><p class="muted">从上到下学习。箭头表示前置知识，点击章节即可进入课件。</p></div><div class="panel map">${roadmapSvg(c)}</div><section class="panel"><h2>知识之间如何连接</h2>${c.roadmap.edges.length?`<ul>${c.roadmap.edges.map(x=>`<li><b>${e(c.lessons.find(l=>l.id===x.from).title)} → ${e(c.lessons.find(l=>l.id===x.to).title)}</b><p>${e(x.reason)}</p></li>`).join('')}</ul>`:'<p>这些章节可以独立学习，可按目录顺序阅读。</p>'}</section>`;}
function sectionHtml(s){return `<section class="lesson-section"><h2>${e(s.title)}</h2><div class="prose">${markdown(s.body)}</div>${s.example?`<div class="example">${rubyHtml(s.example)}</div>`:''}${s.translation?`<div class="translation prose">${markdown(s.translation)}</div>`:''}</section>`;}
function questionsHtml(l,interactive=true){return l.questions.map((q,i)=>`<section class="question"><h3>${i+1}. ${e(q.q)}</h3>${interactive?`<div class="options">${q.options.map((o,j)=>`<button class="option" data-action="answer" data-question="${e(q.id)}" data-option="${j}">${String.fromCharCode(65+j)}. ${rubyHtml(o)}</button>`).join('')}</div><div class="answer-result" id="answer-${e(q.id)}" aria-live="polite"></div>`:`<ol>${q.options.map(o=>`<li>${rubyHtml(o)}</li>`).join('')}</ol><details><summary>参考答案与解析</summary><p>${rubyHtml(q.options[q.answer])}：${rubyHtml(q.why)}</p></details>`}</section>`).join('');}
function reader(c,id){
  const l=c.lessons.find(l=>l.id===id);if(!l)return '<h1>找不到这个章节</h1>';
  const i=c.lessons.indexOf(l),key=keyFor(c.id,l.id);
  return `<div class="reader-layout"><aside class="reader-toc"><p class="eyebrow">课程目录</p>${c.lessons.map((x,n)=>`<a class="${l.id===x.id?'active':''}" href="${lessonUrl(c,x)}"><span>${String(n+1).padStart(2,'0')}</span>${e(x.title)}</a>`).join('')}</aside><article class="reader"><header class="lesson-header"><p class="eyebrow">CHAPTER ${String(i+1).padStart(2,'0')} / ${c.lessons.length} · ${l.minutes} MIN</p><h1>${e(l.title)}</h1><p class="lead">${e(l.objective)}</p>${l.importanceReason?`<p class="notice">为什么学：${e(l.importanceReason)}</p>`:''}</header>
  ${l.sections.map(sectionHtml).join('')}<section class="lesson-section"><p class="eyebrow">CHECK YOUR UNDERSTANDING</p><h2>理解自测</h2><p class="muted small">点击选项查看解析。</p>${questionsHtml(l)}</section>
  <section class="lesson-section"><p class="eyebrow">PUT IT INTO PRACTICE</p><h2>实践任务</h2><div class="prose">${markdown(l.task||'')}</div><ul>${l.criteria.map(x=>`<li>${e(x)}</li>`).join('')}</ul><label class="field-label" for="task-draft">我的实践草稿</label><textarea id="task-draft" data-draft="task" rows="5" placeholder="在这里练习，内容会自动保存">${e(state.taskDrafts[key]||'')}</textarea></section>
  <section class="lesson-section"><h2>本章笔记</h2><label class="field-label" for="lesson-note">记下你的理解、例句或疑问</label><textarea id="lesson-note" data-draft="note" rows="6" placeholder="不用点击保存，离开或关闭时也会保留">${e(state.notes[key]||'')}</textarea></section>
  <footer class="reader-footer"><button class="btn secondary" data-action="read">${state.progress[key]?.readAt?'✓ 已读本章':'标记本章已读'}</button><div>${i?linkButton('← 上一章',lessonUrl(c,c.lessons[i-1]),'subtle'):''}${i<c.lessons.length-1?linkButton('下一章 →',lessonUrl(c,c.lessons[i+1]),'primary'):linkButton('返回课程概览',courseUrl(c),'primary')}</div></footer></article></div>`;
}
function ebook(c){return `<div class="section-heading row"><div><p class="eyebrow">THE COMPLETE BOOK</p><h1>课程电子书</h1><p class="muted">所有课件与计划汇集在这里，也可下载到本地离线阅读。</p></div><a class="btn primary" href="/api/book?course=${uri(c.id)}" download>下载完整电子书 ↓</a></div><article class="ebook panel"><h1>${e(c.title)}</h1><p class="lead">${e(c.description)}</p><h2>目录</h2><ol>${c.lessons.map(l=>`<li><a href="#book-${l.id}" data-book-anchor="book-${l.id}">${e(l.title)}</a></li>`).join('')}</ol><h2>大纲路线图</h2><div class="map">${roadmapSvg(c)}</div><h2>完整学习计划</h2>${planHtml(c)}${c.lessons.map((l,i)=>`<article class="book-chapter" id="book-${l.id}"><p class="eyebrow">CHAPTER ${i+1}</p><h1>${e(l.title)}</h1><p>本章目标：${e(l.objective)}</p><p>为什么学：${e(l.importanceReason||l.summary)}</p>${l.sections.map(sectionHtml).join('')}<h2>练习与解析</h2>${questionsHtml(l,false)}<h2>实践任务</h2>${markdown(l.task||'')}<ul>${l.criteria.map(x=>`<li>${e(x)}</li>`).join('')}</ul></article>`).join('')}<h2>综合项目</h2>${projects(c)}<h2>参考资料</h2>${sources(c)}</article>`;}
function render(){
  if(!state)return;const r=parseRoute(),c=state.courses.find(c=>c.id===r.courseId);
  route=r;let body;
  if(r.view!=='course')body=library();
  else if(!c)body='<div class="empty"><h1>这门课程不存在</h1><a href="#/courses">返回课程库</a></div>';
  else{
    const content=r.tab==='overview'?overview(c):r.tab==='contents'?contents(c):r.tab==='roadmap'?roadmap(c):r.tab==='plan'?`<div class="section-heading"><p class="eyebrow">A PLAN YOU CAN FOLLOW</p><h1>学习计划</h1></div><section class="panel plan">${planHtml(c)}</section>`:r.tab==='book'?ebook(c):reader(c,r.lessonId);
    body=`<div class="course-context"><a href="#/courses">← 返回课程库</a><span>${e(c.subject)} / ${e(c.title)}</span></div><nav class="course-tabs" aria-label="课程内部导航">${tabs.map(([id,label])=>`<a href="${courseUrl(c,id)}" class="${r.tab===id||(r.tab==='lesson'&&id==='contents')?'active':''}">${label}</a>`).join('')}</nav>${content}`;
  }
  $('#app').innerHTML=`<header class="topbar"><a class="brand" href="#/courses"><span class="brand-mark"><img src="/icon-128.png" width="43" height="43" alt=""></span><span><b>Kotoba</b><small>我的学习室</small></span></a><div class="top-actions"><span class="save-status" id="save-status" role="status">${pending.size?'正在自动保存…':'已自动保存'}</span><button class="btn subtle small" data-action="backup">数据备份</button></div></header><main id="main" class="workspace ${r.tab==='lesson'?'reading':''}" tabindex="-1">${body}</main><footer class="app-footer"><span>KOTOBA · 把想学的，变成学会的。</span><span>本地课程库 / 0.2.1</span></footer>`;
  document.title=(c?c.title+' · ':'')+'Kotoba 学习室';
  restoring=true;const saved=r.tab==='lesson'?state.reader[c?.id]:null;
  requestAnimationFrame(()=>{window.scrollTo(0,saved&&saved.lessonId===r.lessonId?saved.scrollY||0:0);requestAnimationFrame(()=>{restoring=false;});});
}
function filterLibrary(){const query=($('#search')?.value||'').toLowerCase(),subject=$('#subject-filter')?.value;let visible=0;document.querySelectorAll('.course-card').forEach(el=>{const match=el.dataset.course.includes(query)&&(!subject||el.dataset.subject===subject);el.hidden=!match;if(match)visible++;});$('#no-match')?.classList.toggle('hidden',visible>0||!state.courses.length);}
function dialog(title,body){const m=$('#modal');m.innerHTML=`<div class="dialog-head"><h2 id="modal-title">${e(title)}</h2><button class="icon-btn" data-action="close" aria-label="关闭">×</button></div>${body}`;if(!m.open)m.showModal();}
function deleteStart(c){
  if(!c)return;
  deletion={courseId:c.id,title:c.title};
  dialog('删除课程 · 第 1 步 / 共 2 步',`<p>请先核对要删除的课程。</p><div class="delete-summary"><strong>${e(c.title)}</strong><span>${e(c.subject)} · ${c.lessons.length} 章 · 已读 ${countRead(c)} 章</span></div><p>课程、笔记、实践草稿和阅读进度将从课程库中删除。已下载的电子书和导出文件仍会保留。此操作无法在程序中撤销。</p><a href="/api/course/file?course=${uri(c.id)}" download>先导出这门课程 ↓</a><div class="dialog-actions"><button class="btn secondary" data-action="close" autofocus>保留课程</button><button class="btn danger-outline" data-action="delete-next">我已了解，继续核对</button></div>`);
  $('#modal [data-action="close"].btn').focus();
}
async function deleteNext(el){
  if(!deletion)return;
  const current=deletion;el.disabled=true;
  try{
    await flush();if(pending.size)throw new Error('请等待草稿保存成功后再删除。');
    const confirmation=await api('course/delete/prepare',{courseId:current.courseId});
    if(deletion!==current||!$('#modal').open)return;
    Object.assign(current,confirmation);
    dialog('最后确认 · 第 2 步 / 共 2 步',`<p>请手动输入完整课程名称，确认删除：</p><p class="delete-course-name">${e(current.title)}</p><label class="field-label" for="delete-course-title">完整课程名称（须完全一致）</label><input id="delete-course-title" class="delete-title-input" type="text" autocomplete="off" spellcheck="false" aria-describedby="delete-help"><p id="delete-help" class="muted small">核对有效期为 5 分钟。输入匹配后才能删除；按 Esc 可取消。</p><p id="delete-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" data-action="close">取消，保留课程</button><button class="btn danger" data-action="delete-final" disabled>确认删除课程</button></div>`);
    $('#delete-course-title').focus();
  }finally{el.disabled=false;}
}
async function deleteFinal(el){
  const current=deletion,input=$('#delete-course-title');
  if(!current?.confirmationToken||input?.value!==current.title||el.disabled)return;
  el.disabled=true;input.disabled=true;
  // Closing while the request is pending could make a completed delete look cancelled.
  deletion.busy=true;$('#modal').querySelectorAll('[data-action="close"]').forEach(b=>b.disabled=true);
  try{
    await api('course/delete',{courseId:current.courseId,confirmationToken:current.confirmationToken,confirmedTitle:input.value});
    for(const [key,change] of pending)if(change.courseId===current.courseId)pending.delete(key);
    persistPending();answers.clear();await load();
    $('#modal').close();location.hash='#/courses';render();toast('课程及其笔记、草稿和进度已删除。');
  }catch(err){$('#delete-error').textContent=err.message;}
  finally{
    if(deletion===current){deletion.busy=false;input.disabled=false;el.disabled=input.value!==current.title;$('#modal').querySelectorAll('[data-action="close"]').forEach(b=>b.disabled=false);}
  }
}
function createDialog(){dialog('在 Codex 聊天中创建完整课程',`<p>打开此项目的 Codex 聊天，发送下面这句话。也可以直接在当前聊天里告诉 Codex 你想学什么。</p><div class="prompt-box">我要学习【填写科目】。请按本项目 COURSE_AUTHORING.md 的流程，一次集中询问尚未明确的目标、基础、时间和偏好，然后一次完成整门课程、详细教材、学习计划、大纲路线图和电子书，并发布到我的课程库。</div><ol class="dialog-steps"><li><b>集中了解需求</b><p>一次说明目标、基础、学习时间和偏好，已有答案无需重复。</p></li><li><b>完整编写后发布</b><p>详细基础讲解、例子、练习解析与项目全部写好，再一次加入课程库。</p></li><li><b>回到这里开始学习</b><p>生成完成后，课程会自动出现在列表中。</p></li></ol><button class="btn primary" data-action="copy-prompt">复制创建提示词</button>`);}
async function importFile(kind){
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.onchange=async()=>{try{
    const file=input.files[0];if(!file)return;if(file.size>64*1024*1024)throw new Error('文件不能超过64MB。');
    const value=JSON.parse(await file.text());
    await flush();if(pending.size)throw new Error('请等待草稿保存成功后再导入。');
    await api(kind==='course'?'course/import':'restore',kind==='course'?{course:value}:value);
    await load();$('#modal').close();render();toast(kind==='course'?'完整课程已加入课程库。':'课程库已恢复。');
  }catch(err){toast(err.message,true);}};input.click();
}
document.addEventListener('click',async event=>{
  const anchor=event.target.closest('[data-book-anchor]');if(anchor){event.preventDefault();document.getElementById(anchor.dataset.bookAnchor)?.scrollIntoView();return;}
  const el=event.target.closest('[data-action]');if(!el)return;
  try{
    const action=el.dataset.action,c=state.courses.find(c=>c.id===route.courseId),l=c?.lessons.find(l=>l.id===route.lessonId);
    if(action==='create')createDialog();
    if(action==='delete-start')deleteStart(c);
    if(action==='delete-next')await deleteNext(el);
    if(action==='delete-final')await deleteFinal(el);
    if(action==='close')$('#modal').close();
    if(action==='copy-prompt'){await navigator.clipboard.writeText($('.prompt-box').textContent);toast('已复制，在 Codex 聊天中粘贴即可。');}
    if(action==='import')importFile('course');
    if(action==='backup')dialog('课程库与备份',`<p>备份包含课程、已读进度、笔记、当前实践草稿和阅读位置。</p><div class="dialog-actions"><a class="btn primary" href="/api/backup" download>导出课程库备份</a><button class="btn secondary" data-action="restore">从备份恢复</button></div><p class="muted small">恢复会替换当前课程库；恢复前的课程库保存在本机快照中。</p>`);
    if(action==='restore')dialog('恢复课程库',`<p>恢复文件会替换当前课程库。请先导出一份当前备份。</p><button class="btn primary" data-action="restore-file">选择备份文件并恢复</button>`);
    if(action==='restore-file')importFile('backup');
    if(action==='read'){await api('lesson/read',{courseId:c.id,lessonId:l.id});state.progress[keyFor(c.id,l.id)]={readAt:new Date().toISOString()};el.textContent='✓ 已读本章';toast('已保存已读进度。');}
    if(action==='answer'){
      const q=l.questions.find(q=>q.id===el.dataset.question),chosen=Number(el.dataset.option);
      answers.set(q.id,chosen);el.parentElement.querySelectorAll('button').forEach((b,j)=>b.classList.toggle('chosen',j===chosen));
      const result=document.getElementById('answer-'+q.id);result.className='answer-result shown';result.innerHTML=`<b>${chosen===q.answer?'回答正确':'再想一想，参考答案是 '+String.fromCharCode(65+q.answer)}</b><p>${rubyHtml(q.why)}</p>`;
    }
  }catch(err){toast(err.message,true);}
});
document.addEventListener('input',event=>{
  const el=event.target;if(el.matches('[data-draft]'))queue(route.courseId,route.lessonId,el.dataset.draft,el.value);
  if(el.id==='search')filterLibrary();
  if(el.id==='delete-course-title')$('#modal [data-action="delete-final"]').disabled=el.value!==deletion?.title;
});
$('#modal').addEventListener('close',()=>{deletion=null;});
$('#modal').addEventListener('cancel',event=>{if(deletion?.busy)event.preventDefault();});
document.addEventListener('change',event=>{if(event.target.id==='subject-filter')filterLibrary();});
window.addEventListener('hashchange',()=>{if($('#modal').open&&!deletion?.busy)$('#modal').close();savePosition();flush();render();});
window.addEventListener('scroll',()=>{if(restoring)return;clearTimeout(scrollTimer);scrollTimer=setTimeout(savePosition,220);},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')exitSave();});
window.addEventListener('pagehide',exitSave);
window.addEventListener('online',flush);
async function poll(){
  try{
    const data=await api('catalog');if(data.catalogKey===catalog)return;
    const fresh=await api('state'),ids=new Set(fresh.state.courses.map(c=>c.id));
    // Discard only drafts for deleted courses; keep valid unsaved drafts in other tabs.
    for(const [key,change] of pending)if(!ids.has(change.courseId))pending.delete(key);
    persistPending();await flush();if(pending.size)return;
    await load();
    if(route.view!=='course'||!ids.has(route.courseId)){
      if($('#modal').open&&!deletion?.busy)$('#modal').close();
      if(route.view==='course')location.hash='#/courses';
      render();toast('课程库已更新。');
    }
  }catch{}
}
try{
  await load();
  for(const version of Object.values(state.draftVersions))lastStamp=Math.max(lastStamp,version);
  try{for(const change of JSON.parse(localStorage.getItem(storageKey)||'[]')){
    if(state.courses.some(c=>c.id===change.courseId&&c.lessons.some(l=>l.id===change.lessonId))){
      const k=change.courseId+':'+change.lessonId+':'+change.kind;
      const versionKey=change.kind==='reader'?change.courseId+':reader':k;
      if(change.stamp>=(state.draftVersions[versionKey]||0)){pending.set(k,change);updateLocal(change);}
      lastStamp=Math.max(lastStamp,change.stamp);
    }
  }}catch{}
  render();flush();setInterval(poll,2500);
}catch(err){$('#app').innerHTML=`<div class="empty"><h1>暂时无法打开课程库</h1><p>${e(err.message)}</p><p>请重新打开桌面上的 Kotoba 学习室快捷方式，再刷新此页。</p></div>`;}
