// Synthetic structural fixtures only. Not a curriculum or a learner profile.
export function courseFixture(){
  const body='这是自动化测试使用的通用文本。程序应完整保存这段内容，在阅读页面安全渲染，并在导出的电子书中保留。测试会核对章节、前置引用和学习安排之间的一致性。这段文字不属于任何用户课程，也不承担教学用途。';
  const lessons=['alpha','beta'].map((id,i)=>({
    id,title:'结构验证章节 '+(i+1),objective:'验证章节正文与练习展示。',summary:'程序结构测试。',minutes:10,prerequisites:i?['alpha']:[],
    importanceReason:'用来验证前置章节、路线图和学习计划的引用保持一致。',
    sections:[{title:'正文渲染检查',body:body.repeat(2)},{title:'安全输出检查',body,example:'示例内容',translation:'对应说明'}],
    questions:[{id:id+'-question',q:'本数据的用途是什么？',options:['自动化程序验证','个性化学习课程'],answer:0,why:'这是合成的测试数据，仅用于程序验证。'}],
    task:'核对页面保存和展示是否正确。',criteria:['正文完整','输入保留']
  }));
  return {
    id:'qa-complete',title:'结构验证样本',subtitle:'仅用于自动化测试',subject:'程序验证',completeness:'complete',description:'合成结构数据，不是可供学习的课程。',lessons,
    brief:{goal:'验证课程数据结构',level:'合成测试输入',minutesPerDay:10,daysPerWeek:1,weeks:2},outcomes:['核对所有功能能正确处理课程结构。'],
    plan:{overview:'合成测试安排。',weeks:[{title:'验证阶段一',lessonIds:lessons.map(l=>l.id),activities:['核对展示与保存。']},{title:'验证阶段二',lessonIds:[],activities:['验证恢复与导出。']}],dailyTemplate:[{title:'结构检查',minutes:10}]},
    roadmap:{edges:[{from:'alpha',to:'beta',reason:'验证前置章节引用。'}]},
    projects:[{title:'集成验证',description:'检查数据从导入到阅读与导出的完整过程。',steps:['导入','阅读','导出'],criteria:['内容一致']}],sources:[]
  };
}
export function legacyFixture(){
  const course=courseFixture();course.id='legacy-sample';delete course.completeness;
  return {schemaVersion:1,courses:[course],profile:{level:'test',minutes:10,days:1,weeks:2},
    progress:{'legacy-sample:alpha':{readAt:'2000-01-01T00:00:00Z'}},
    notes:{'legacy-sample:alpha':'保留的笔记'},attempts:[{answer:'明确删除的旧答题明细'}],
    taskAnswers:{'legacy-sample:alpha':'旧任务答案'},events:[{type:'answer'}],reviews:{old:true}};
}
export function planFixture(){
  const course=courseFixture(),base=course.lessons[0],ids=['alpha','beta','gamma','delta','epsilon'];
  course.id='qa-incremental';course.title='分批课程结构样本';course.generationMode='incremental';course.completeness='planned';course.revision=0;
  course.lessons=ids.map((id,i)=>({...structuredClone(base),id,title:'结构验证小节 '+(i+1),status:'planned',prerequisites:i?[ids[i-1]]:[],knowledgePoints:['核对数据引用','核对保存规则'],sections:[],questions:[],task:'',criteria:[],coverage:[]}));
  course.chapters=[{id:'foundation',title:'结构基础',lessonIds:ids.slice(0,2)},{id:'application',title:'结构应用',lessonIds:ids.slice(2)}];
  course.plan.weeks[0].lessonIds=ids;course.roadmap.edges=ids.slice(1).map((id,i)=>({from:ids[i],to:id,reason:'验证前置顺序'}));
  return course;
}
export function batchFixture(course,ids=['alpha']){
  const text='合成结构测试正文，用于验证程序能够保存充分展开的讲解、示例、练习解析和实践标准。这不是实际课程教材，不应发布到真实课程库。';
  return {courseId:course.id,expectedRevision:course.revision,lessons:ids.map(id=>({id,
    sections:['现象与基础','规则与推导','完整示例','错误与迁移'].map(title=>({title,body:text.repeat(12)})),
    questions:Array.from({length:3},(_,i)=>({id:id+'-check-'+i,q:'验证合成数据的处理流程 '+i,options:['符合结构','不符合结构'],answer:0,why:text.repeat(2)})),
    task:text.repeat(3),criteria:['检查内容完整','检查引用一致','检查保存结果'],
    coverage:course.lessons.find(l=>l.id===id).knowledgePoints.map((point,i)=>({point,sectionTitles:[i?'规则与推导':'现象与基础']}))
  }))};
}
