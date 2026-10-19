export function assert(ok, message) { if (!ok) throw new Error(message); }
const text = (v, max = 200000) => typeof v === 'string' && v.length <= max;
const list = (v, max = 1000) => Array.isArray(v) && v.length <= max;
export const keyFor = (courseId, lessonId) => courseId + ':' + lessonId;
export const isReady = lesson => lesson.status !== 'planned';
export const isIncremental = course => course.generationMode === 'incremental';
export function courseStats(course) {
  return { chapters: course.chapters?.length || course.lessons.length, total: course.lessons.length,
    ready: course.lessons.filter(isReady).length };
}
export function initialState() {
  return { schemaVersion: 2, courses: [], progress: {}, notes: {}, taskDrafts: {}, reader: {}, draftVersions: {}, updatedAt: new Date().toISOString() };
}
export function sourcesFor(course) {
  return course.sources || [];
}
export function migrateState(input) {
  if (input?.schemaVersion === 2) return validateState(input);
  assert(input?.schemaVersion === 1, '不是受支持的课程库备份。');
  const s = initialState();
  s.courses = (input.courses || []).map(c => ({
    ...c, completeness: 'legacy', sources: sourcesFor(c),
    brief: { goal: input.profile?.target || '旧版课程：可继续阅读', level: input.profile?.level || '未填写',
      minutesPerDay: input.profile?.minutes || 30, daysPerWeek: input.profile?.days || 5, weeks: input.profile?.weeks || 1 },
    outcomes: c.lessons.map(l => l.objective), plan: { overview: '此课程从旧版迁移，尚未按新的完整课程规则生成计划。', weeks: [], dailyTemplate: [] },
    projects: [], roadmap: { edges: c.lessons.flatMap(l => l.prerequisites.map(from => ({ from, to: l.id, reason: '先掌握前置知识' }))) }
  }));
  s.progress = input.progress || {}; s.notes = input.notes || {};
  // Deliberately discard attempts, historical task answers, events, reviews and global learner profiles.
  return validateState(s);
}
export function validateCourse(c, { requireComplete = false } = {}) {
  assert(c && text(c.id, 100) && /^[a-z0-9][a-z0-9-]*$/.test(c.id), '课程编号需为小写英文、数字和连字符。');
  for (const k of ['subject', 'title', 'subtitle', 'description']) assert(text(c[k], k === 'description' ? 6000 : 200) && c[k].trim(), '课程缺少 ' + k);
  assert(list(c.lessons) && c.lessons.length > 0, '课程没有章节。');
  const incremental = isIncremental(c);
  assert(c.completeness === 'complete' || (!requireComplete && (c.completeness === 'legacy' || (incremental && ['planned','in-progress'].includes(c.completeness)))), '只能发布完整课程；分批课程请使用 plan 命令发布规划。');
  assert(!requireComplete || c.completeness === 'complete', '课程尚未全部生成。');
  const ids = new Set(), questions = new Set();
  for (const l of c.lessons) {
    assert(text(l.id, 100) && /^[a-z0-9][a-z0-9-]*$/.test(l.id) && !ids.has(l.id), '章节编号无效或重复。'); ids.add(l.id);
    for (const k of ['title','objective','summary']) assert(text(l[k], 6000) && l[k].trim(), '章节缺少 ' + k);
    assert(Number.isFinite(l.minutes) && l.minutes >= 1 && l.minutes <= 10000, '章节预计时间无效。');
    assert(list(l.prerequisites) && l.prerequisites.every(x => text(x, 100)), '章节前置关系无效。');
    if (incremental) {
      assert(['planned','ready'].includes(l.status), '小节需明确标注 planned 或 ready。');
      assert(text(l.importanceReason,6000) && l.importanceReason.trim(), '小节缺少重要性说明。');
      assert(list(l.knowledgePoints,100) && l.knowledgePoints.length > 0 && l.knowledgePoints.every(p=>text(p,1000)&&p.trim()) && new Set(l.knowledgePoints).size===l.knowledgePoints.length, '每节需列出不重复的具体知识点。');
      if (!isReady(l)) {
        assert(list(l.sections) && !l.sections.length && list(l.questions) && !l.questions.length && !l.task && list(l.criteria) && !l.criteria.length && (!l.coverage || (list(l.coverage)&&!l.coverage.length)), '待生成小节只能包含规划，不能混入正文或练习。');
        continue;
      }
    }
    assert(list(l.sections, 100) && l.sections.length >= 2, '每章应包含详细讲解，不能只有一个摘要。');
    for (const s of l.sections) {
      assert(text(s.title, 300) && s.title.trim() && text(s.body) && s.body.trim(), '讲解标题或正文为空。');
      assert(!/^(TODO|TBD|待补充|待生成|略)[。.! ]*$/i.test(s.body.trim()), '课程含未完成的占位正文。');
      for (const k of ['example','translation']) if (s[k] != null) assert(text(s[k]), '例子或解释格式无效。');
    }
    assert(list(l.questions, 100) && list(l.criteria, 100) && l.criteria.every(x=>text(x,12000)), '练习或任务检查要点无效。');
    for (const q of l.questions) {
      assert(text(q.id,100) && /^[a-z0-9][a-z0-9-]*$/.test(q.id) && !questions.has(q.id) && text(q.q,12000) && q.q.trim() && text(q.why,20000) && q.why.trim(), '题目编号重复或题目内容无效。'); questions.add(q.id);
      assert(list(q.options,10) && q.options.length >= 2 && q.options.every(o=>text(o,10000)), '客观题选项无效。');
      assert(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, '正确答案不在选项内。');
    }
    if (c.completeness === 'complete' || incremental) {
      assert(l.sections.reduce((n,s)=>n+s.body.length,0) >= 240, '章节「' + l.title + '」讲解过少，请补充基础知识与推导。');
      assert(l.questions.length > 0 && text(l.task,20000) && l.task.trim() && l.criteria.length > 0, '完整章节需包含练习、实践任务及检查要点。');
      assert(text(l.importanceReason,6000) && l.importanceReason.trim(), '请解释章节「' + l.title + '」的重要性。');
    }
    if (incremental) {
      assert(l.sections.length>=4 && l.sections.every(s=>s.body.length>=200) && l.sections.reduce((n,s)=>n+s.body.length,0)>=2400, '详细小节至少需要四个充分展开的内容块和2400字符正文；长度只是最低结构检查。');
      assert(new Set(l.sections.map(s=>s.title)).size===l.sections.length, '内容块标题不能重复。');
      assert(l.questions.length>=3 && l.questions.every(q=>q.why.length>=60) && l.task.length>=120 && l.criteria.length>=3, '详细小节需至少三道带充分解析的自测、完整实践任务和三条验收标准。');
      assert(list(l.coverage,100) && l.coverage.length===l.knowledgePoints.length, '需提供每个知识点与正文内容块的覆盖对应。');
      const covered=new Set();
      for(const item of l.coverage){
        assert(item && l.knowledgePoints.includes(item.point) && !covered.has(item.point) && list(item.sectionTitles,100) && item.sectionTitles.length>0 && item.sectionTitles.every(title=>l.sections.some(s=>s.title===title)), '知识点覆盖存在遗漏、重复或无效内容块。');
        covered.add(item.point);
      }
    }
  }
  const done = new Set(), visiting = new Set();
  function visit(id) {
    assert(ids.has(id), '前置章节不存在：' + id); assert(!visiting.has(id), '课程前置关系形成循环。');
    if (done.has(id)) return; visiting.add(id);
    c.lessons.find(l=>l.id===id).prerequisites.forEach(visit); visiting.delete(id); done.add(id);
  }
  c.lessons.forEach(l=>visit(l.id));
  assert(c.brief && text(c.brief.goal,12000) && c.brief.goal.trim(), '课程缺少学习目标。');
  if(c.completeness==='complete'||incremental){
    assert(text(c.brief.level,6000) && c.brief.level.trim(),'请记录当前学习基础。');
    assert(Number.isFinite(c.brief.minutesPerDay) && c.brief.minutesPerDay>0 && c.brief.minutesPerDay<=1440 && Number.isInteger(c.brief.daysPerWeek) && c.brief.daysPerWeek>=1 && c.brief.daysPerWeek<=7 && Number.isFinite(c.brief.weeks) && c.brief.weeks>0,'请记录有效的学习时间预算。');
  }
  assert(list(c.outcomes) && c.outcomes.length > 0 && c.outcomes.every(o=>text(o,12000)), '课程缺少学习成果。');
  assert(c.plan && text(c.plan.overview,20000) && list(c.plan.weeks) && list(c.plan.dailyTemplate,100), '课程缺少学习计划。');
  const scheduled = new Set();
  for(const d of c.plan.dailyTemplate)assert(text(d.title,300) && Number.isFinite(d.minutes) && d.minutes>0,'每日学习安排无效。');
  for (const week of c.plan.weeks) {
    assert(text(week.title,300) && list(week.lessonIds) && list(week.activities,100) && week.activities.every(a=>text(a,12000)), '计划条目无效。');
    for (const id of week.lessonIds) { assert(ids.has(id), '计划引用了不存在的章节。'); scheduled.add(id); }
  }
  if (c.completeness === 'complete' || incremental) assert(c.lessons.every(l=>scheduled.has(l.id)), '完整计划必须覆盖所有章节。');
  assert(c.roadmap && list(c.roadmap.edges,10000), '课程缺少大纲路线图。');
  const edges = new Set();
  for (const edge of c.roadmap.edges) {
    assert(ids.has(edge.from) && ids.has(edge.to) && text(edge.reason,6000), '路线图边的引用或说明无效。');
    assert(c.lessons.find(l=>l.id===edge.to).prerequisites.includes(edge.from), '路线图与章节前置关系不一致。');
    edges.add(edge.from + ':' + edge.to);
  }
  for (const l of c.lessons) for (const p of l.prerequisites) assert(edges.has(p+':'+l.id), '路线图遗漏了一条前置关系。');
  if (incremental) {
    assert(Number.isSafeInteger(c.revision) && c.revision>=0, '分批课程缺少有效版本号。');
    assert(list(c.chapters) && c.chapters.length>0, '需先规划章节和小节目录。');
    const assigned=new Set(),chapters=new Set();
    for(const chapter of c.chapters){
      assert(chapter && text(chapter.id,100) && /^[a-z0-9][a-z0-9-]*$/.test(chapter.id) && !chapters.has(chapter.id) && text(chapter.title,300) && chapter.title.trim() && list(chapter.lessonIds) && chapter.lessonIds.length>0, '章节目录无效或重复。');
      chapters.add(chapter.id);
      for(const id of chapter.lessonIds){assert(ids.has(id)&&!assigned.has(id), '小节必须且只能属于一个章节。');assigned.add(id);}
    }
    assert(assigned.size===ids.size, '章节目录必须覆盖全部小节。');
    const ready=c.lessons.filter(isReady);
    assert(c.completeness===(ready.length===c.lessons.length?'complete':ready.length?'in-progress':'planned'), '课程生成状态与小节状态不一致。');
    for(const lesson of ready)assert(lesson.prerequisites.every(id=>isReady(c.lessons.find(l=>l.id===id))), '需先生成前置小节。');
  }
  assert(list(c.projects,100), '课程项目列表无效。');
  for (const p of c.projects) assert(text(p.title,300) && text(p.description,20000) && list(p.steps,100) && p.steps.every(x=>text(x,20000)) && list(p.criteria,100) && p.criteria.every(x=>text(x,12000)), '综合项目缺少内容。');
  assert(list(c.sources,1000), '参考资料列表无效。');
  for (const s of c.sources) {
    assert(text(s.title,1000) && text(s.url,4000), '参考资料格式无效。');
    if (s.url) { const u = new URL(s.url); assert(['https:','http:'].includes(u.protocol) && !u.username && !u.password, '参考链接只支持普通网页地址。'); }
  }
  return c;
}
export function appendCourseBatch(course,batch) {
  validateCourse(course);
  assert(isIncremental(course), '此课程未启用分批生成；请创建新的课程规划以保留原教材和笔记。');
  assert(batch?.courseId===course.id && batch.expectedRevision===course.revision, '课程版本已变化，请重新读取课程后生成批次。');
  assert(list(batch.lessons,3) && batch.lessons.length>=1, '每批只能生成1至3节。');
  const next=structuredClone(course),seen=new Set();
  const contentFields=['id','sections','questions','task','criteria','coverage'];
  for(const input of batch.lessons){
    assert(input && !seen.has(input.id) && Object.keys(input).every(k=>contentFields.includes(k)), '批次小节重复或包含规划之外的字段。');seen.add(input.id);
    const lesson=next.lessons.find(l=>l.id===input.id);
    assert(lesson && !isReady(lesson), '只能填充已规划且尚未生成的小节，不能覆盖已有教材。');
    for(const key of contentFields.filter(k=>k!=='id'))lesson[key]=structuredClone(input[key]);
    lesson.status='ready';
  }
  next.revision++;
  next.updatedAt=new Date().toISOString();
  next.completeness=next.lessons.every(isReady)?'complete':'in-progress';
  return validateCourse(next);
}
export function validateState(input) {
  assert(input?.schemaVersion === 2 && list(input.courses,1000), '课程库备份格式无效。');
  input.courses.forEach(c=>validateCourse(c));
  assert(new Set(input.courses.map(c=>c.id)).size === input.courses.length, '课程编号重复。');
  const s = initialState(); s.courses=input.courses;
  for (const k of ['progress','notes','taskDrafts','reader','draftVersions']) {
    assert(input[k] && typeof input[k] === 'object' && !Array.isArray(input[k]), '保存数据格式无效：'+k); s[k]=input[k];
  }
  for (const k of ['notes','taskDrafts']) for (const [id,v] of Object.entries(s[k])) assert(text(id,250) && text(v,200000), '笔记或作答草稿过长。');
  for(const v of Object.values(s.reader))assert(v && text(v.lessonId,100) && Number.isFinite(v.scrollY) && v.scrollY>=0 && v.scrollY<100000000,'阅读位置无效。');
  for(const v of Object.values(s.progress)){
    assert(v && typeof v==='object' && (text(v.readAt,100)||Number.isFinite(v.percent)), '学习进度无效。');
    if(v.readAt!==undefined)assert(text(v.readAt,100),'完成时间无效。');
    if(v.percent!==undefined)assert(Number.isFinite(v.percent)&&v.percent>=0&&v.percent<=100,'阅读百分比无效。');
    if(v.scrollY!==undefined)assert(Number.isFinite(v.scrollY)&&v.scrollY>=0&&v.scrollY<100000000,'小节阅读位置无效。');
    for(const name of ['startedAt','updatedAt'])if(v[name]!==undefined)assert(text(v[name],100),'学习时间无效。');
  }
  for(const v of Object.values(s.draftVersions))assert(Number.isSafeInteger(v) && v>=0,'草稿版本无效。');
  s.updatedAt=typeof input.updatedAt === 'string' ? input.updatedAt : s.updatedAt; return s;
}
export function getLesson(s, courseId, lessonId) {
  const course=s.courses.find(c=>c.id===courseId), lesson=course?.lessons.find(l=>l.id===lessonId);
  assert(lesson, '没有找到这节课。'); assert(isReady(lesson), '该小节尚未生成，不能保存学习进度。'); return {course,lesson};
}
export function applyAutosave(s, changes) {
  assert(list(changes,100), '自动保存数据无效。');
  for (const change of changes) {
    getLesson(s,change.courseId,change.lessonId);
    assert(['note','task','reader'].includes(change.kind), '不支持的保存类型。');
    assert(Number.isSafeInteger(change.stamp) && change.stamp >= 0, '保存版本无效。');
    const k=keyFor(change.courseId,change.lessonId), versionKey=k+':'+change.kind;
    if ((s.draftVersions[versionKey] || 0) > change.stamp) continue;
    if (change.kind==='reader') {
      assert(change.value && Number.isFinite(change.value.scrollY) && change.value.scrollY>=0 && change.value.scrollY<100000000, '阅读位置无效。');
      const percent=change.value.percent??0;
      assert(Number.isFinite(percent)&&percent>=0&&percent<=100,'阅读百分比无效。');
      const at=new Date().toISOString(),previous=s.progress[k]||{},globalKey=change.courseId+':reader';
      s.progress[k]={...previous,percent:previous.readAt?100:Math.max(previous.percent||0,Math.min(99,percent)),scrollY:change.value.scrollY,startedAt:previous.startedAt||at,updatedAt:at};
      if(change.stamp>=(s.draftVersions[globalKey]||0)){
        s.reader[change.courseId]={lessonId:change.lessonId,scrollY:change.value.scrollY,at};s.draftVersions[globalKey]=change.stamp;
      }
    } else {
      assert(text(change.value,200000), '文本不能超过20万字符。');
      s[change.kind==='note'?'notes':'taskDrafts'][k]=change.value;
    }
    s.draftVersions[versionKey]=change.stamp;
  }
}
export function markRead(s,courseId,lessonId) {
  getLesson(s,courseId,lessonId); const k=keyFor(courseId,lessonId);
  const at=new Date().toISOString();s.progress[k]={...s.progress[k],percent:100,readAt:at,updatedAt:at};
}
export function removeCourse(s,courseId) {
  assert(s.courses.some(c=>c.id===courseId),'课程不存在，可能已经删除。');
  s.courses=s.courses.filter(c=>c.id!==courseId);
  for(const field of ['progress','notes','taskDrafts','draftVersions']) {
    for(const key of Object.keys(s[field]))if(key.startsWith(courseId+':'))delete s[field][key];
  }
  delete s.reader[courseId];
}
export const escapeHtml = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function rubyHtml(v) {
  return escapeHtml(v).replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g,(_,a,b)=>'<ruby>'+a+'<rt>'+b+'</rt></ruby>');
}
export function orderedLessons(c) {
  const output=[],done=new Set();
  while(output.length<c.lessons.length) {
    const l=c.lessons.find(l=>!done.has(l.id)&&l.prerequisites.every(p=>done.has(p)));
    assert(l,'课程存在循环依赖。');output.push(l);done.add(l.id);
  }return output;
}
