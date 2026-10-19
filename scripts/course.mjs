import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { validateCourse, courseStats, assert } from '../src/domain.mjs';
import { bookHtml } from '../src/book.mjs';
import { publishCourse, publishBatch } from '../src/publishing.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=resolve(process.env.KOTOBA_DATA_DIR||resolve(root,'data'));
const [command,arg]=process.argv.slice(2);
function readJson(path){assert(path,'请提供 JSON 文件路径。');return JSON.parse(readFileSync(resolve(path),'utf8').replace(/^\uFEFF/,''));}
try{
  if(command==='brief'){
    assert(arg?.trim(),'请提供科目。');mkdirSync(resolve(dataDir,'briefs'),{recursive:true});
    const file=resolve(dataDir,'briefs',Date.now()+'.json');
    writeFileSync(file,JSON.stringify({subject:arg,goal:null,level:null,minutesPerDay:null,daysPerWeek:null,weeks:null,deadline:null,preferences:null,status:'interviewing',generationMode:'incremental'},null,2),'utf8');
    console.log(JSON.stringify({briefPath:file,nextQuestion:'请集中说明学习目标、当前基础、可用时间、期限和偏好；已有答案无需重复。需求明确后先规划全部章节与小节，再每次生成1至3节详细教材。'},null,2));
  }else if(command==='validate'){
    const course=validateCourse(readJson(arg));bookHtml(course);
    console.log(JSON.stringify({ok:true,id:course.id,...courseStats(course),completeness:course.completeness,bodyCharacters:course.lessons.reduce((n,l)=>n+l.sections.reduce((m,s)=>m+s.body.length,0),0)},null,2));
  }else if(['plan','append','publish'].includes(command)){
    const input=readJson(arg),store=new Store(resolve(dataDir,'kotoba.sqlite'));
    try{
      const course=command==='append'?publishBatch(store,dataDir,input):publishCourse(store,dataDir,input,{plan:command==='plan'});
      console.log(JSON.stringify({ok:true,courseId:course.id,...courseStats(course),revision:course.revision,completeness:course.completeness,coursePath:resolve(dataDir,'courses',course.id,'course.json'),bookPath:resolve(dataDir,'courses',course.id,'book.html')},null,2));
    }finally{store.close();}
  }else if(command==='list'||command==='show'){
    const store=new Store(resolve(dataDir,'kotoba.sqlite'));
    try{
      const courses=store.read().courses;
      const result=command==='show'?courses.find(c=>c.id===arg):courses.map(c=>({id:c.id,title:c.title,...courseStats(c),revision:c.revision,completeness:c.completeness}));
      assert(result,'课程不存在。');console.log(JSON.stringify(result,null,2));
    }finally{store.close();}
  }else{
    console.log('使用方法：node scripts/course.mjs brief "学习主题" | validate <course.json> | plan <plan.json> | append <batch.json> | show <course-id> | publish <complete-course.json> | list');
    if(command)process.exitCode=1;
  }
}catch(e){console.error(e.message);process.exitCode=1;}
