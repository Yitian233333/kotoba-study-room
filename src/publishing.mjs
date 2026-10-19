import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert, validateCourse, appendCourseBatch } from './domain.mjs';
import { bookHtml } from './book.mjs';

// Failed exports or database commits restore previous files and learning data.
function persist(store,dataDir,change,{create=false}={}) {
  const staged=[],changed=[];
  try {
    return store.update(state=>{
      const course=change(state),directory=resolve(dataDir,'courses',course.id);
      mkdirSync(directory,{recursive:true});
      for(const [name,content] of [['course.json',JSON.stringify(course,null,2)],['book.html',bookHtml(course)]]) {
        const path=resolve(directory,name);
        assert(!existsSync(path)||(!create&&statSync(path).isFile()), '课程输出已存在或目标不是文件，请先核对输出目录。');
        const previous=existsSync(path)?readFileSync(path):null,temp=path+'.'+randomUUID()+'.tmp';
        staged.push({path,temp,previous});writeFileSync(temp,content,{encoding:'utf8',flag:'wx'});
      }
      for(const file of staged){renameSync(file.temp,file.path);changed.push(file);}
      return course;
    });
  } catch(error) {
    for(const file of changed.reverse()) {
      if(file.previous===null){if(existsSync(file.path))unlinkSync(file.path);}
      else {writeFileSync(file.temp,file.previous);renameSync(file.temp,file.path);}
    }
    throw error;
  } finally {for(const file of staged)if(existsSync(file.temp))unlinkSync(file.temp);}
}

export function publishCourse(store,dataDir,input,{plan=false}={}) {
  const course=structuredClone(validateCourse(input,{requireComplete:!plan}));
  if(plan)assert(course.generationMode==='incremental'&&course.completeness==='planned'&&course.revision===0, '首次发布应为版本0的完整课程规划，所有小节保持待生成。');
  course.createdAt=course.createdAt||new Date().toISOString();
  return persist(store,dataDir,state=>{
    assert(!state.courses.some(c=>c.id===course.id), '课程编号已存在，请使用新编号以保留已有教材和笔记。');
    state.courses.push(course);return course;
  },{create:true});
}

export function publishBatch(store,dataDir,batch) {
  return persist(store,dataDir,state=>{
    const index=state.courses.findIndex(c=>c.id===batch?.courseId);
    assert(index>=0,'课程不存在，请先发布课程规划。');
    const course=appendCourseBatch(state.courses[index],batch);
    state.courses[index]=course;return course;
  });
}
