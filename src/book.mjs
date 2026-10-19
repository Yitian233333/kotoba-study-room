import { escapeHtml as e, rubyHtml, orderedLessons, sourcesFor, isReady, isIncremental, courseStats } from './domain.mjs';

// Generation and learning progress are independent: a badge never means unread.
export function generationBadge(lessonOrGroup) {
  const lessons=Array.isArray(lessonOrGroup)?lessonOrGroup:[lessonOrGroup];
  const missing=lessons.filter(l=>!isReady(l)).length;
  if(!missing)return '';
  const label=Array.isArray(lessonOrGroup)?missing+' 节未生成':'未生成';
  return '<span class="generation-badge" title="详细教材尚未生成"><svg class="generation-icon" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 2H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h6M10 2v5h5L10 2ZM6 10h3M6 13h2"/><circle cx="14" cy="14" r="4"/><path d="M14 12v2l1.5 1"/></svg><span>'+label+'</span></span>';
}

function inline(text) {
  return rubyHtml(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');
}
export function markdown(value='') {
  const lines=String(value).split(/\r?\n/), out=[]; let paragraph=[], items=[], code=null;
  function flush() {
    if(paragraph.length){out.push('<p>'+paragraph.map(inline).join('<br>')+'</p>');paragraph=[];}
    if(items.length){out.push('<ul>'+items.map(x=>'<li>'+inline(x)+'</li>').join('')+'</ul>');items=[];}
  }
  for(const line of lines) {
    if(line.startsWith(String.fromCharCode(96).repeat(3))) {
      flush(); if(code){out.push('<pre><code>'+e(code.join('\n'))+'</code></pre>');code=null;}else code=[]; continue;
    }
    if(code){code.push(line);continue;}
    if(!line.trim()){flush();continue;}
    const h=line.match(/^(#{1,4})\s+(.+)/),li=line.match(/^\s*(?:[-*]|\d+[.)、])\s+(.+)/);
    if(h){flush();out.push('<h'+Math.min(5,h[1].length+2)+'>'+inline(h[2])+'</h'+Math.min(5,h[1].length+2)+'>');}
    else if(li){if(paragraph.length)flush();items.push(li[1]);}
    else{if(items.length)flush();paragraph.push(line);}
  }
  flush();if(code)out.push('<pre><code>'+e(code.join('\n'))+'</code></pre>');return out.join('');
}
export function roadmapSvg(c,{offline=false}={}) {
  const levels=new Map(),groups=new Map(),positions=new Map();
  for(const l of orderedLessons(c)) {
    const depth=l.prerequisites.length ? Math.max(...l.prerequisites.map(p=>levels.get(p)))+1 : 0;
    levels.set(l.id,depth);if(!groups.has(depth))groups.set(depth,[]);groups.get(depth).push(l);
  }
  const width=Math.max(600,...[...groups.values()].map(g=>g.length*242+30)),height=groups.size*122+35;
  for(const [depth,list] of groups)list.forEach((l,i)=>positions.set(l.id,{x:(width-list.length*242)/2+i*242+15,y:depth*122+20}));
  const marker='arrow-'+c.id;
  let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" width="'+width+'" height="'+height+'" role="img" aria-label="'+e(c.title)+'的大纲路线图"><defs><marker id="'+marker+'" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#91a1bd" stroke-width="1.4"/></marker></defs>';
  for(const edge of c.roadmap.edges) {
    const a=positions.get(edge.from),b=positions.get(edge.to);
    svg+='<path d="M'+(a.x+108)+','+(a.y+68)+' C'+(a.x+108)+','+(a.y+94)+' '+(b.x+108)+','+(b.y-26)+' '+(b.x+108)+','+b.y+'" fill="none" stroke="#a7b5ce" stroke-width="1.6" marker-end="url(#'+marker+')"/>';
  }
  c.lessons.forEach((l,i)=>{
    const p=positions.get(l.id),href=offline?'#lesson-'+l.id:'#/course/'+encodeURIComponent(c.id)+'/lesson/'+encodeURIComponent(l.id);
    svg+='<a href="'+href+'" aria-label="'+e(l.title)+(isReady(l)?'':'，详细教材未生成')+'"><rect x="'+p.x+'" y="'+p.y+'" width="216" height="68" rx="10" fill="'+(isReady(l)?'#ffffff':'#edf1f7')+'" stroke="#cbd7e9"'+(isReady(l)?'':' stroke-dasharray="5 3"')+'/><text x="'+(p.x+16)+'" y="'+(p.y+22)+'" font-family="system-ui,sans-serif" font-size="10" fill="#687b95">第 '+(i+1)+(isIncremental(c)?' 节':' 章')+' · '+(isReady(l)?l.minutes+' 分钟':'未生成')+'</text>'+(isReady(l)?'':'<g class="generation-map-icon" transform="translate('+(p.x+188)+' '+(p.y+12)+')" aria-hidden="true" fill="none" stroke="#805c20" stroke-width="1.4"><circle cx="7" cy="7" r="6"/><path d="M7 3v4l3 2"/></g>')+'<text x="'+(p.x+16)+'" y="'+(p.y+47)+'" font-family="system-ui,sans-serif" font-size="13" fill="#22344d">'+e(l.title.length>15?l.title.slice(0,15)+'…':l.title)+'</text></a>';
  });
  return svg+'</svg>';
}
export function planHtml(c) {
  return '<p>'+e(c.plan.overview)+'</p>'+c.plan.weeks.map((w,i)=>'<section class="plan-week"><h3>'+e(w.title||'第'+(i+1)+'周')+'</h3><ul>'+
    w.lessonIds.map(id=>{const l=c.lessons.find(l=>l.id===id);return '<li>'+e(l?.title)+' '+(l?generationBadge(l):'')+'</li>';}).join('')+'</ul><p>'+w.activities.map(e).join('；')+'</p></section>').join('')+
    (c.plan.dailyTemplate.length?'<h3>每次学习的安排</h3><ul>'+c.plan.dailyTemplate.map(d=>'<li>'+e(d.title)+'：'+e(d.minutes)+' 分钟</li>').join('')+'</ul>':'');
}
export function curriculumHtml(c,{offline=false}={}) {
  if(!isIncremental(c))return '';
  return '<div class="mind-tree"><h2>课程思维导图</h2><p>'+e(c.title)+'</p><ul>'+c.chapters.map(chapter=>'<li><strong>'+e(chapter.title)+'</strong> '+generationBadge(chapter.lessonIds.map(id=>c.lessons.find(l=>l.id===id)))+'<ul>'+chapter.lessonIds.map(id=>{
    const lesson=c.lessons.find(l=>l.id===id),href=offline?'#lesson-'+id:'#/course/'+encodeURIComponent(c.id)+'/lesson/'+encodeURIComponent(id);
    return '<li><a href="'+href+'">'+e(lesson.title)+'</a> '+(isReady(lesson)?'<small>已生成</small>':generationBadge(lesson))+'<ul>'+lesson.knowledgePoints.map(p=>'<li>'+e(p)+'</li>').join('')+'</ul></li>';
  }).join('')+'</ul></li>').join('')+'</ul></div>';
}
export function bookHtml(c) {
  const stats=courseStats(c),incremental=isIncremental(c);
  const chapters=c.lessons.map(l=>{
    const head='<article id="lesson-'+l.id+'"><h2>'+e(l.title)+'</h2><p>学习目标：'+e(l.objective)+'</p><p>为什么学：'+e(l.importanceReason||l.summary)+'</p>';
    if(!isReady(l))return head+generationBadge(l)+'<p><strong>待生成：此处仅为课程规划，尚无教材正文。</strong></p><ul>'+l.knowledgePoints.map(p=>'<li>'+e(p)+'</li>').join('')+'</ul></article>';
    return head+l.sections.map(s=>'<section><h3>'+e(s.title)+'</h3>'+markdown(s.body)+(s.example?'<div class="example">'+rubyHtml(s.example)+'</div>':'')+(s.translation?'<p>'+inline(s.translation)+'</p>':'')+'</section>').join('')+
      '<h3>练习与解析</h3>'+l.questions.map(q=>'<p><strong>'+e(q.q)+'</strong></p><ol>'+q.options.map(o=>'<li>'+inline(o)+'</li>').join('')+'</ol><details><summary>参考答案与解析</summary><p class="answer">'+inline(q.options[q.answer])+'：'+inline(q.why)+'</p></details>').join('')+
      '<h3>实践任务</h3>'+markdown(l.task||'')+'<ul>'+l.criteria.map(x=>'<li>'+e(x)+'</li>').join('')+'</ul></article>';
  }).join('');
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+e(c.title)+'</title><style>body{max-width:850px;margin:50px auto;padding:0 24px;font:17px/1.95 system-ui;color:#22344d}h1,h2,h3{line-height:1.5}article{break-before:page;margin:75px 0}blockquote,.example{background:#f0f4f9;padding:22px;border-radius:8px;white-space:pre-wrap}ruby rt{font-size:11px}a{color:#4057b2}pre{overflow:auto;background:#f0f4f9;padding:18px}li{margin:8px 0}.map{overflow:auto}.map svg{max-width:100%;height:auto}.answer{background:#f0f7f3;padding:12px}section{margin:30px 0}.mind-tree ul{border-left:1px solid #cbd7e9;padding-left:24px}.generation-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border:1px dashed #c4aa70;border-radius:5px;background:#faf5e8;color:#75521b;font:500 11px/1.5 system-ui,sans-serif;vertical-align:middle;white-space:nowrap}.generation-icon{flex-shrink:0}.chapter-group h2{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.syllabus-item .row{flex-wrap:wrap;gap:8px}.reader-toc a{align-items:flex-start;flex-wrap:wrap;column-gap:8px;row-gap:5px}.reader-toc a .toc-title{flex:1;min-width:90px;font:inherit;color:inherit}.reader-toc a .generation-badge{margin-left:25px;gap:4px;font-size:10px;color:#75521b}.reader-toc a .generation-badge span{color:inherit;font:inherit}.mind-tree .generation-badge{margin:3px 0}.book-chapter h2 .generation-badge{margin-left:8px}@media print{.map{overflow:visible}details>*{display:block!important}}</style><h1>'+e(c.title)+'</h1><p>'+e(c.description)+'</p>'+
    (incremental?'<p><strong>'+stats.chapters+' 章 / '+stats.total+' 节；已生成 '+stats.ready+' 节。</strong>本文件是当前版本快照；待生成部分仅展示规划，追加教材后请重新导出。</p>':'')+
    '<p>学习目标：'+e(c.brief.goal)+'</p><h2>学习成果</h2><ul>'+c.outcomes.map(o=>'<li>'+e(o)+'</li>').join('')+'</ul><h2>课程目录</h2><ol>'+c.lessons.map(l=>'<li><a href="#lesson-'+l.id+'">'+e(l.title)+'</a>'+' '+generationBadge(l)+'</li>').join('')+'</ol>'+curriculumHtml(c,{offline:true})+'<h2>大纲路线图</h2><div class="map">'+roadmapSvg(c,{offline:true})+'</div><h2>完整学习计划</h2>'+planHtml(c)+chapters+
    (c.projects.length?'<h2>综合项目</h2>'+c.projects.map(p=>'<h3>'+e(p.title)+'</h3><p>'+e(p.description)+'</p><ol>'+p.steps.map(x=>'<li>'+e(x)+'</li>').join('')+'</ol><p>验收：'+p.criteria.map(e).join('；')+'</p>').join(''):'')+
    '<h2>参考资料</h2>'+sourcesFor(c).map(s=>'<p>'+(s.url?'<a href="'+e(s.url)+'">'+e(s.title)+'</a>':e(s.title))+'<br>'+e(s.note||s.usage||'')+'</p>').join('')+'</html>';
}
