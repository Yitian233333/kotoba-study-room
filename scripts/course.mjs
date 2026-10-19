import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { validateCourse, assert } from '../src/domain.mjs';
import { bookHtml } from '../src/book.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=resolve(process.env.KOTOBA_DATA_DIR||resolve(root,'data'));
const [command,arg]=process.argv.slice(2);
function readCourse(path){assert(path,'请提供完整课程 JSON 的路径。');return validateCourse(JSON.parse(readFileSync(resolve(path),'utf8').replace(/^\uFEFF/,'')),{requireComplete:true});}
try{
  if(command==='brief'){
    assert(arg?.trim(),'请提供科目。');mkdirSync(resolve(dataDir,'briefs'),{recursive:true});
    const file=resolve(dataDir,'briefs',Date.now()+'.json');
    writeFileSync(file,JSON.stringify({subject:arg,goal:null,level:null,minutesPerDay:null,daysPerWeek:null,weeks:null,deadline:null,preferences:null,status:'interviewing'},null,2),'utf8');
    console.log(JSON.stringify({briefPath:file,nextQuestion:'你希望学完后，能用'+arg+'完成什么具体事情？'},null,2));
  }else if(command==='validate'){
    const course=readCourse(arg);bookHtml(course);
    console.log(JSON.stringify({ok:true,id:course.id,chapters:course.lessons.length,bodyCharacters:course.lessons.reduce((n,l)=>n+l.sections.reduce((m,s)=>m+s.body.length,0),0)},null,2));
  }else if(command==='publish'){
    const course=readCourse(arg),book=bookHtml(course),store=new Store(resolve(dataDir,'kotoba.sqlite'));
    const dir=resolve(dataDir,'courses',course.id),files=[resolve(dir,'course.json'),resolve(dir,'book.html')];
    let committed=false,created=false;
    try{
      assert(!store.read().courses.some(c=>c.id===course.id),'课程编号已存在。为修订版本使用新的课程编号，保留原课程笔记。');
      mkdirSync(dir,{recursive:true});
      assert(files.every(p=>!existsSync(p)&&!existsSync(p+'.tmp')),'课程输出文件已存在，请检查课程编号。');
      created=true;
      writeFileSync(files[0]+'.tmp',JSON.stringify(course,null,2),'utf8');writeFileSync(files[1]+'.tmp',book,'utf8');
      renameSync(files[0]+'.tmp',files[0]);renameSync(files[1]+'.tmp',files[1]);
      store.update(s=>{assert(!s.courses.some(c=>c.id===course.id),'课程编号已存在。');s.courses.push({...course,createdAt:course.createdAt||new Date().toISOString()});});
      committed=true;
      console.log(JSON.stringify({ok:true,courseId:course.id,chapters:course.lessons.length,coursePath:files[0],bookPath:files[1],message:'完整课程已发布，课程列表将在几秒内自动更新。'},null,2));
    }catch(e){
      if(created&&!committed&&!store.read().courses.some(c=>c.id===course.id)){
        for(const p of files)for(const candidate of [p+'.tmp',p])if(existsSync(candidate))unlinkSync(candidate);
      }
      throw e;
    }finally{store.close();}
  }else if(command==='list'){
    const store=new Store(resolve(dataDir,'kotoba.sqlite'));
    try{console.log(JSON.stringify(store.read().courses.map(c=>({id:c.id,title:c.title,chapters:c.lessons.length,completeness:c.completeness})),null,2));}finally{store.close();}
  }else{
    console.log('使用方法：node scripts/course.mjs brief "日语" | validate <course.json> | publish <course.json> | list');
    if(command)process.exitCode=1;
  }
}catch(e){console.error(e.message);process.exitCode=1;}
