import { escapeHtml as e, rubyHtml, keyFor, isReady, isIncremental, courseStats, orderedLessons } from '/modules/domain.mjs';
import { markdown, roadmapSvg, planHtml, curriculumHtml } from '/modules/book.mjs';
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
  if(change.kind==='reader'){state.reader[change.courseId]={lessonId:change.lessonId,...change.value};const p=state.progress[k]||{};state.progress[k]={...p,percent:p.readAt?100:Math.max(p.percent||0,change.value.percent||0),scrollY:change.value.scrollY,startedAt:p.startedAt||new Date().toISOString()};const indicator=$('#lesson-progress');if(indicator)indicator.textContent='学习进度：'+(state.progress[k].readAt?'已完成':Math.round(state.progress[k].percent||0)+'% · 阅读中');}
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
  if(c?.lessons.some(l=>l.id===route.lessonId&&isReady(l))){const article=$('.reader'),height=Math.max(1,(article?.offsetHeight||document.documentElement.scrollHeight)-innerHeight),top=article?article.getBoundingClientRect().top+scrollY:0;const percent=Math.max(0,Math.min(99,Math.round((scrollY-top)/height*100)));queue(c.id,route.lessonId,'reader',{scrollY:Math.round(window.scrollY),percent});}
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
function badge(c){const label={legacy:'导入课程',planned:'课程规划','in-progress':'分批生成',complete:isIncremental(c)?'全部已生成':'完整课程'}[c.completeness];return `<span class="pill">${label}</span>`;}
function unit(c){return isIncremental(c)?'节':'章';}
function learningLabel(c,l){const p=state.progress[keyFor(c.id,l.id)];return !isReady(l)?'待生成':p?.readAt?'已完成':p?.startedAt||p?.percent?'阅读中 '+Math.round(p.percent||0)+'%':'未开始';}
function generationPanel(c){if(!isIncremental(c))return '';const s=courseStats(c);return `<section class="panel generation-panel"><div><p class="eyebrow">COURSE IN PROGRESS</p><h2>教材生成 ${s.ready} / ${s.total} 节</h2><p>规划共 ${s.chapters} 章、${s.total} 节。每次在 Codex 聊天中生成 1–3 节详细教材。</p><progress value="${s.ready}" max="${s.total}" aria-label="教材生成进度"></progress></div>${s.ready<s.total?'<button class="btn primary" data-action="generate-next">生成接下来 1–3 节</button>':'<span class="pill">全部教材已生成</span>'}</section>`;}
function library(){
  const subjects=[...new Set(state.courses.map(c=>c.subject))];
  return `<div class="page-heading"><div><p class="eyebrow">YOUR PERSONAL LIBRARY</p><h1>我的课程库<span class="count">${state.courses.length}</span></h1><p class="muted">从一个想学的主题，到一本属于你的课程书。</p></div><button class="btn primary" data-action="create">＋ 在 Codex 中创建课程</button></div>
  <div class="library-tools"><label class="search"><span>⌕</span><input id="search" type="search" placeholder="搜索课程名称或科目" aria-label="搜索课程"></label><select id="subject-filter" aria-label="筛选科目"><option value="">所有科目</option>${subjects.map(s=>`<option>${e(s)}</option>`).join('')}</select><button class="btn subtle" data-action="import">导入课程</button></div>
  <div class="course-grid" id="course-grid">${state.courses.length?state.courses.map((c,i)=>`<a class="course-card" data-course="${e((c.title+' '+c.subject).toLowerCase())}" data-subject="${e(c.subject)}" href="${courseUrl(c)}"><div class="book-cover tone-${i%3}"><span class="cover-subject">${e(c.subject)}</span><h2>${e(c.title)}</h2><p>${e(c.subtitle)}</p><span class="cover-mark">K / ${String(i+1).padStart(2,'0')}</span></div><div class="card-body"><div class="row">${badge(c)}<span class="muted">${courseStats(c).chapters} 章${isIncremental(c)?' / '+c.lessons.length+' 节':''}</span></div><p>${e(c.description)}</p>${state.reader[c.id]?`<p class="muted small">上次学习：${e(c.lessons.find(l=>l.id===state.reader[c.id].lessonId)?.title||'')}</p>`:''}<div class="card-foot"><span>已完成 ${countRead(c)} / ${c.lessons.length} ${unit(c)}${isIncremental(c)?' · 已生成 '+courseStats(c).ready+' 节':''}</span><b>进入课程 ↗</b></div></div></a>`).join(''):`<div class="empty"><div class="empty-book">本</div><h2>第一门课程，从一句话开始</h2><p>在当前 Codex 聊天中说明想学的科目。<br>Codex 会了解你的目标、基础和时间，先规划课程，再每次生成 1–3 节详细教材。</p><button class="btn primary" data-action="create">查看创建方式</button></div>`}</div><p id="no-match" class="muted hidden">没有找到匹配的课程。</p>
  <div class="library-note"><span>01 / 对话明确目标</span><span>02 / 规划目录与路线</span><span>03 / 每次生成 1–3 节，逐步学习</span></div>`;
}
function sources(c){return `<ul class="sources">${c.sources.map(s=>`<li>${s.url?`<a href="${e(s.url)}" target="_blank" rel="noreferrer">${e(s.title)} ↗</a>`:e(s.title)}<small>${e(s.note||s.usage||'')}</small></li>`).join('')}</ul>`;}
function projects(c){return c.projects.map(p=>`<section class="project"><h3>${e(p.title)}</h3>${markdown(p.description)}<ol>${p.steps.map(s=>`<li>${e(s)}</li>`).join('')}</ol><p><b>完成标准：</b>${p.criteria.map(e).join('；')}</p></section>`).join('');}
function overview(c){
  const resume=c.lessons.find(l=>l.id===state.reader[c.id]?.lessonId&&isReady(l))||c.lessons.find(isReady)||c.lessons[0];
  return `<div class="course-intro"><div><p class="eyebrow">${e(c.subject)} / COURSE</p><h1>${e(c.title)}</h1><p class="lead">${e(c.description)}</p><div class="row">${badge(c)}<span>${courseStats(c).chapters} 章${isIncremental(c)?' / '+c.lessons.length+' 节':''} · 已完成 ${countRead(c)} ${unit(c)}</span></div></div><div class="continue-box"><span class="eyebrow">NEXT PAGE</span><h3>${e(resume.title)}</h3><p class="muted small">${e(learningLabel(c,resume))}</p>${linkButton(state.reader[c.id]?'继续上次学习 →':isReady(resume)?'开始学习 →':'查看课程规划 →',lessonUrl(c,resume),'primary')}</div></div>
  ${generationPanel(c)}${c.completeness==='legacy'?'<p class="notice">此课程未提供完整的学习计划和综合项目，可阅读已有教材。</p>':''}
  <div class="two-columns"><section class="panel"><p class="eyebrow">THE DESTINATION</p><h2>这门课为你解决什么</h2><p>${e(c.brief.goal)}</p><dl><div><dt>当前基础</dt><dd>${e(c.brief.level||'以课程前置要求为准')}</dd></div><div><dt>时间安排</dt><dd>${e(c.brief.minutesPerDay||'—')} 分钟 / 天 · ${e(c.brief.daysPerWeek||'—')} 天 / 周</dd></div></dl><h3>完成后，你将能够</h3><ul>${c.outcomes.map(x=>`<li>${e(x)}</li>`).join('')}</ul></section><section class="panel"><p class="eyebrow">HOW TO LEARN</p><h2>沿着知识的顺序学习</h2><p>先看目录和大纲路线图，理解每章的作用，再进入课件。讲解之后有例子、自测和实践任务，笔记会自动保存。</p><div class="quick-links">${linkButton('查看课程目录 ↗',courseUrl(c,'contents'),'secondary')}${linkButton('查看完整计划 ↗',courseUrl(c,'plan'),'secondary')}${linkButton('打开电子书 ↗',courseUrl(c,'book'),'secondary')}</div></section></div>
  ${c.projects.length?`<section class="panel"><p class="eyebrow">LEARN BY MAKING</p><h2>综合实践项目</h2>${projects(c)}</section>`:''}
  <section class="panel"><h2>参考与延伸阅读</h2>${sources(c)||'<p>暂无外部参考资料。</p>'}</section>
  <section class="panel danger-zone"><div><h2>课程管理</h2><p>删除本课程及其笔记、草稿和进度。需要两步确认。</p></div><button class="btn danger-outline" data-action="delete-start">删除这门课程</button></section>`;
}
function contents(c){const groups=c.chapters||[{title:'课程目录',lessonIds:c.lessons.map(l=>l.id)}];return `<div class="section-heading"><p class="eyebrow">TABLE OF CONTENTS</p><h1>目录与课件</h1><p class="muted">${isIncremental(c)?courseStats(c).chapters+' 章 / '+c.lessons.length+' 节；待生成小节可查看目标与知识点。':'每个章节包含详细讲解、练习与实践任务。'}阅读百分比记录最远阅读位置，完成状态由“标记已完成”确认。</p></div>${generationPanel(c)}${groups.map(group=>`<section class="chapter-group"><h2>${e(group.title)}</h2><div class="syllabus">${group.lessonIds.map(id=>{const l=c.lessons.find(l=>l.id===id),i=c.lessons.indexOf(l),p=state.progress[keyFor(c.id,id)];return `<a class="syllabus-item ${isReady(l)?'':'planned-item'}" href="${lessonUrl(c,l)}"><span class="chapter-number">${String(i+1).padStart(2,'0')}</span><div><div class="row"><h3>${e(l.title)}</h3><span class="pill">${e(learningLabel(c,l))}</span></div><p>${e(l.objective)}</p>${l.knowledgePoints?'<p>'+l.knowledgePoints.map(e).join(' · ')+'</p>':''}<small>${l.minutes} 分钟 · ${isReady(l)?l.sections.length+' 个讲解内容块':'教材待生成'} · 前置：${l.prerequisites.map(id=>e(c.lessons.find(x=>x.id===id).title)).join('、')||'无'}</small>${isReady(l)?'<progress value="'+(p?.readAt?100:p?.percent||0)+'" max="100" aria-label="'+e(l.title)+'学习进度"></progress>':''}</div><b>↗</b></a>`}).join('')}</div></section>`).join('')}`;}
function roadmap(c){return `<div class="section-heading"><p class="eyebrow">THE BIG PICTURE</p><h1>大纲路线图</h1><p class="muted">从上到下学习。箭头表示前置知识，点击章节即可进入课件。</p></div><section class="panel">${curriculumHtml(c)||'<p>按目录查看章节结构。</p>'}</section><div class="panel map">${roadmapSvg(c)}</div><section class="panel"><h2>知识之间如何连接</h2>${c.roadmap.edges.length?`<ul>${c.roadmap.edges.map(x=>`<li><b>${e(c.lessons.find(l=>l.id===x.from).title)} → ${e(c.lessons.find(l=>l.id===x.to).title)}</b><p>${e(x.reason)}</p></li>`).join('')}</ul>`:'<p>这些章节可以独立学习，可按目录顺序阅读。</p>'}</section>`;}
function sectionHtml(s){return `<section class="lesson-section"><h2>${e(s.title)}</h2><div class="prose">${markdown(s.body)}</div>${s.example?`<div class="example">${rubyHtml(s.example)}</div>`:''}${s.translation?`<div class="translation prose">${markdown(s.translation)}</div>`:''}</section>`;}
function questionsHtml(l,interactive=true){return l.questions.map((q,i)=>`<section class="question"><h3>${i+1}. ${e(q.q)}</h3>${interactive?`<div class="options">${q.options.map((o,j)=>`<button class="option" data-action="answer" data-question="${e(q.id)}" data-option="${j}">${String.fromCharCode(65+j)}. ${rubyHtml(o)}</button>`).join('')}</div><div class="answer-result" id="answer-${e(q.id)}" aria-live="polite"></div>`:`<ol>${q.options.map(o=>`<li>${rubyHtml(o)}</li>`).join('')}</ol><details><summary>参考答案与解析</summary><p>${rubyHtml(q.options[q.answer])}：${rubyHtml(q.why)}</p></details>`}</section>`).join('');}
function reader(c,id){
  const l=c.lessons.find(l=>l.id===id);if(!l)return '<h1>找不到这个章节</h1>';
  if(!isReady(l))return `<section class="panel planned-lesson"><p class="eyebrow">PLANNED LESSON</p><h1>${e(l.title)}</h1><span class="pill">待生成</span><p>${e(l.objective)}</p><h2>本节知识点</h2><ul>${l.knowledgePoints.map(p=>`<li>${e(p)}</li>`).join('')}</ul><p>此处展示课程规划。详细讲解、例子、练习解析与实践任务将在生成后出现。</p><button class="btn primary" data-action="generate-next" data-lesson-id="${e(l.id)}">查看生成提示词</button></section>${generationPanel(c)}`;
  const i=c.lessons.indexOf(l),key=keyFor(c.id,l.id);
  return `<div class="reader-layout"><aside class="reader-toc"><p class="eyebrow">课程目录</p>${c.lessons.map((x,n)=>`<a class="${l.id===x.id?'active':''}" href="${lessonUrl(c,x)}"><span>${String(n+1).padStart(2,'0')}</span>${e(x.title)}</a>`).join('')}</aside><article class="reader"><header class="lesson-header"><p class="eyebrow">CHAPTER ${String(i+1).padStart(2,'0')} / ${c.lessons.length} · ${l.minutes} MIN</p><h1>${e(l.title)}</h1><p class="lead">${e(l.objective)}</p>${l.importanceReason?`<p class="notice">为什么学：${e(l.importanceReason)}</p>`:''}</header>
  <p id="lesson-progress" class="notice">学习进度：${e(learningLabel(c,l))}</p>${l.sections.map(sectionHtml).join('')}<section class="lesson-section"><p class="eyebrow">CHECK YOUR UNDERSTANDING</p><h2>理解自测</h2><p class="muted small">点击选项查看解析。</p>${questionsHtml(l)}</section>
  <section class="lesson-section"><p class="eyebrow">PUT IT INTO PRACTICE</p><h2>实践任务</h2><div class="prose">${markdown(l.task||'')}</div><ul>${l.criteria.map(x=>`<li>${e(x)}</li>`).join('')}</ul><label class="field-label" for="task-draft">我的实践草稿</label><textarea id="task-draft" data-draft="task" rows="5" placeholder="在这里练习，内容会自动保存">${e(state.taskDrafts[key]||'')}</textarea></section>
  <section class="lesson-section"><h2>本章笔记</h2><label class="field-label" for="lesson-note">记下你的理解、例句或疑问</label><textarea id="lesson-note" data-draft="note" rows="6" placeholder="不用点击保存，离开或关闭时也会保留">${e(state.notes[key]||'')}</textarea></section>
  <footer class="reader-footer"><button class="btn secondary" data-action="read">${state.progress[key]?.readAt?'✓ 已完成':'标记已完成'}</button><div>${i?linkButton('← 上一'+unit(c),lessonUrl(c,c.lessons[i-1]),'subtle'):''}${i<c.lessons.length-1?linkButton('下一'+unit(c)+' →',lessonUrl(c,c.lessons[i+1]),'primary'):linkButton('返回课程概览',courseUrl(c),'primary')}</div></footer>${isIncremental(c)?generationPanel(c):''}</article></div>`;
}
function ebook(c){return `<div class="section-heading row"><div><p class="eyebrow">COURSE BOOK</p><h1>课程电子书</h1><p class="muted">${isIncremental(c)?'已生成 '+courseStats(c).ready+' / '+c.lessons.length+' 节。下载内容为当前快照，待生成部分仅含规划。':'教材与计划可下载后离线阅读。'}</p></div><a class="btn primary" href="/api/book?course=${uri(c.id)}" download>${isIncremental(c)&&courseStats(c).ready<c.lessons.length?'下载当前教材与规划 ↓':'下载完整电子书 ↓'}</a></div><article class="ebook panel"><h1>${e(c.title)}</h1>${curriculumHtml(c)}<h2>完整学习计划</h2>${planHtml(c)}${c.lessons.map((l,i)=>`<article class="book-chapter" id="book-${l.id}"><p class="eyebrow">LESSON ${i+1} · ${isReady(l)?'已生成':'待生成'}</p><h2>${e(l.title)}</h2><p>${e(l.objective)}</p>${isReady(l)?l.sections.map(sectionHtml).join('')+'<h3>练习与解析</h3>'+questionsHtml(l,false)+'<h3>实践任务</h3>'+markdown(l.task||'')+'<ul>'+l.criteria.map(x=>'<li>'+e(x)+'</li>').join('')+'</ul>':'<p>此节尚未生成，当前仅提供课程规划。</p>'}</article>`).join('')}<h2>综合项目</h2>${projects(c)}<h2>参考资料</h2>${sources(c)}</article>`;}
function render(){
  if(!state)return;const r=parseRoute(),c=state.courses.find(c=>c.id===r.courseId);
  route=r;let body;
  if(r.view!=='course')body=library();
  else if(!c)body='<div class="empty"><h1>这门课程不存在</h1><a href="#/courses">返回课程库</a></div>';
  else{
    const content=r.tab==='overview'?overview(c):r.tab==='contents'?contents(c):r.tab==='roadmap'?roadmap(c):r.tab==='plan'?`<div class="section-heading"><p class="eyebrow">A PLAN YOU CAN FOLLOW</p><h1>学习计划</h1></div><section class="panel plan">${planHtml(c)}</section>`:r.tab==='book'?ebook(c):reader(c,r.lessonId);
    body=`<div class="course-context"><a href="#/courses">← 返回课程库</a><span>${e(c.subject)} / ${e(c.title)}</span></div><nav class="course-tabs" aria-label="课程内部导航">${tabs.map(([id,label])=>`<a href="${courseUrl(c,id)}" class="${r.tab===id||(r.tab==='lesson'&&id==='contents')?'active':''}">${label}</a>`).join('')}</nav>${content}`;
  }
  $('#app').innerHTML=`<header class="topbar"><a class="brand" href="#/courses"><span class="brand-mark"><img src="/icon-128.png" width="43" height="43" alt=""></span><span><b>Kotoba</b><small>我的学习室</small></span></a><div class="top-actions"><span class="save-status" id="save-status" role="status">${pending.size?'正在自动保存…':'已自动保存'}</span><button class="btn subtle small" data-action="backup">数据备份</button></div></header><main id="main" class="workspace ${r.tab==='lesson'?'reading':''}" tabindex="-1">${body}</main><footer class="app-footer"><span>KOTOBA · 把想学的，变成学会的。</span><span>本地课程库 / 0.3.0</span></footer>`;
  document.title=(c?c.title+' · ':'')+'Kotoba 学习室';
  restoring=true;const saved=r.tab==='lesson'?(state.progress[keyFor(c?.id,r.lessonId)]||((state.reader[c?.id]?.lessonId===r.lessonId)?state.reader[c.id]:null)):null;
  requestAnimationFrame(()=>{window.scrollTo(0,saved?saved.scrollY||0:0);requestAnimationFrame(()=>{restoring=false;savePosition();});});
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
function createDialog(){dialog('在 Codex 中规划课程',`<p>在此项目的 Codex 聊天中说明学习主题，先规划全部内容，再按学习进度生成教材。</p><div class="prompt-box">我要学习【填写科目】。请按 COURSE_AUTHORING.md 集中了解尚未明确的需求，先生成完整大纲、章与节目录、思维导图、章节数和学习计划，发布课程规划后停止。随后在明确要求时，每次生成 1–3 节尽可能详细的教材，包含充分讲解、知识点、例子、练习解析和实践验收，并追加到同一门课程。</div><ol class="dialog-steps"><li><b>先规划全程</b><p>明确目标、章节、小节、知识点和依赖关系。</p></li><li><b>每次精讲 1–3 节</b><p>按需追加教材，重点是讲清每个知识点。</p></li><li><b>接续学习</b><p>目录区分待生成和已生成内容，自动保存每节进度与停留位置。</p></li></ol><button class="btn primary" data-action="copy-prompt">复制创建提示词</button>`);}
function generationDialog(c,target){const pending=orderedLessons(c).filter(l=>!isReady(l)),chosen=c.lessons.find(l=>l.id===target&&!isReady(l));const next=chosen&&chosen.prerequisites.every(id=>isReady(c.lessons.find(l=>l.id===id)))?[chosen]:pending.slice(0,3);if(!next.length){toast('全部小节已生成。');return;}const prompt='请按本项目 COURSE_AUTHORING.md 读取课程 '+c.id+' 的规划与已有教材（版本 '+c.revision+'），本次仅生成 '+next.length+' 节：'+next.map(l=>l.id+'「'+l.title+'」：'+l.knowledgePoints.join('、')).join('；')+'。逐点充分讲清基础、原因、步骤、例子、对比、常见错误、练习和详细解析，并给出可独立完成的实践与验收。不因时长或篇幅压缩教学内容。使用 append 追加到同一课程，保留已有教材、笔记和学习进度；本批完成后停止。';dialog('生成接下来的详细教材',`<p>复制到当前项目的 Codex 聊天。应用本身不执行模型调用。</p><div class="prompt-box">${e(prompt)}</div><button class="btn primary" data-action="copy-prompt">复制生成提示词</button>`);}

async function importFile(kind){
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.onchange=async()=>{try{
    const file=input.files[0];if(!file)return;if(file.size>64*1024*1024)throw new Error('文件不能超过64MB。');
    const value=JSON.parse(await file.text());
    await flush();if(pending.size)throw new Error('请等待草稿保存成功后再导入。');
    await api(kind==='course'?'course/import':'restore',kind==='course'?{course:value}:value);
    await load();$('#modal').close();render();toast(kind==='course'?'课程已加入课程库。':'课程库已恢复。');
  }catch(err){toast(err.message,true);}};input.click();
}
document.addEventListener('click',async event=>{
  const anchor=event.target.closest('[data-book-anchor]');if(anchor){event.preventDefault();document.getElementById(anchor.dataset.bookAnchor)?.scrollIntoView();return;}
  const el=event.target.closest('[data-action]');if(!el)return;
  try{
    const action=el.dataset.action,c=state.courses.find(c=>c.id===route.courseId),l=c?.lessons.find(l=>l.id===route.lessonId);
    if(action==='create')createDialog();
    if(action==='generate-next')generationDialog(c,el.dataset.lessonId);
    if(action==='delete-start')deleteStart(c);
    if(action==='delete-next')await deleteNext(el);
    if(action==='delete-final')await deleteFinal(el);
    if(action==='close')$('#modal').close();
    if(action==='copy-prompt'){await navigator.clipboard.writeText($('.prompt-box').textContent);toast('已复制，在 Codex 聊天中粘贴即可。');}
    if(action==='import')importFile('course');
    if(action==='backup')dialog('课程库与备份',`<p>备份包含课程、已读进度、笔记、当前实践草稿和阅读位置。</p><div class="dialog-actions"><a class="btn primary" href="/api/backup" download>导出课程库备份</a><button class="btn secondary" data-action="restore">从备份恢复</button></div><p class="muted small">恢复会替换当前课程库；恢复前的课程库保存在本机快照中。</p>`);
    if(action==='restore')dialog('恢复课程库',`<p>恢复文件会替换当前课程库。请先导出一份当前备份。</p><button class="btn primary" data-action="restore-file">选择备份文件并恢复</button>`);
    if(action==='restore-file')importFile('backup');
    if(action==='read'){await api('lesson/read',{courseId:c.id,lessonId:l.id});state.progress[keyFor(c.id,l.id)]={...state.progress[keyFor(c.id,l.id)],percent:100,readAt:new Date().toISOString()};el.textContent='✓ 已完成';if($('#lesson-progress'))$('#lesson-progress').textContent='学习进度：已完成';toast('已保存学习进度。');}
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
    // A restored plan can make a formerly readable lesson unavailable.
    for(const [key,change] of pending)if(!fresh.state.courses.some(c=>c.id===change.courseId&&c.lessons.some(l=>l.id===change.lessonId&&isReady(l))))pending.delete(key);
    persistPending();await flush();if(pending.size)return;
    const previousCourse=state.courses.find(c=>c.id===route.courseId);await load();
    const currentCourse=state.courses.find(c=>c.id===route.courseId);
    if(previousCourse?.revision!==currentCourse?.revision&&currentCourse)render();
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
    if(state.courses.some(c=>c.id===change.courseId&&c.lessons.some(l=>l.id===change.lessonId&&isReady(l)))){
      const k=change.courseId+':'+change.lessonId+':'+change.kind;
      const versionKey=k;
      if(change.stamp>=(state.draftVersions[versionKey]||0)){pending.set(k,change);updateLocal(change);}
      lastStamp=Math.max(lastStamp,change.stamp);
    }
  }}catch{}
  render();flush();setInterval(poll,2500);
}catch(err){$('#app').innerHTML=`<div class="empty"><h1>暂时无法打开课程库</h1><p>${e(err.message)}</p><p>请重新打开桌面上的 Kotoba 学习室快捷方式，再刷新此页。</p></div>`;}
