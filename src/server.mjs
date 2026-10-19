import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { assert, applyAutosave, markRead, validateCourse, removeCourse, isIncremental } from './domain.mjs';
import { bookHtml } from './book.mjs';
import { publishBatch } from './publishing.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png'};
export function catalogKey(s){return s.courses.map(c=>c.id+':'+(c.revision??'')+':'+(c.updatedAt||c.createdAt||'')).join('|');}
export function createApp({dataDir=process.env.KOTOBA_DATA_DIR||resolve(root,'data'),now=Date.now}={}){
  mkdirSync(dataDir,{recursive:true});const store=new Store(resolve(dataDir,'kotoba.sqlite')),token=randomBytes(24).toString('hex');
  const deletions=new Map(),fingerprint=c=>createHash('sha256').update(JSON.stringify(c)).digest('hex');
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  async function readBody(req){
    let size=0;const parts=[];
    for await(const part of req){size+=part.length;assert(size<=64*1024*1024,'课程或备份文件不能超过64MB。');parts.push(part);}
    try{return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}catch{throw new Error('文件不是有效JSON。');}
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const port=server.address()?.port;
      if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return json(res,403,{error:'仅允许本机访问。'});
      const url=new URL(req.url,'http://'+req.headers.host),path=url.pathname;
      let body;
      if(req.method!=='GET'){
        if(req.headers.origin&&req.headers.origin!==url.origin)return json(res,403,{error:'请求来源无效。'});
        body=await readBody(req);
        const supplied=path==='/api/autosave'?(req.headers['x-kotoba-token']||body.token):req.headers['x-kotoba-token'];
        if(supplied!==token)return json(res,403,{error:'页面连接已更新，请刷新后重试。'});
      }
      if(path==='/api/health'&&req.method==='GET')return json(res,200,{app:'kotoba',version:'0.3.0',projectRoot:root});
      if(path==='/api/state'&&req.method==='GET'){
        const state=store.read();return json(res,200,{state,token,revision:store.revision(),catalogKey:catalogKey(state)});
      }
      if(path==='/api/catalog'&&req.method==='GET'){
        const s=store.read();return json(res,200,{catalogKey:catalogKey(s),count:s.courses.length});
      }
      if(path==='/api/autosave'&&req.method==='POST'){
        store.update(s=>applyAutosave(s,body.changes));
        return json(res,200,{ok:true,revision:store.revision(),savedAt:new Date().toISOString()});
      }
      if(path==='/api/lesson/read'&&req.method==='POST'){
        store.update(s=>markRead(s,body.courseId,body.lessonId));return json(res,200,{ok:true});
      }
      if(path==='/api/course/import'&&req.method==='POST'){
        const c=validateCourse(body.course||body);assert(c.completeness==='complete'||isIncremental(c),'请导入完整课程或分批课程规划。');
        store.update(s=>{assert(!s.courses.some(x=>x.id===c.id),'课程编号已存在，请给新版本使用不同编号。');s.courses.push(c);});
        return json(res,201,{ok:true,courseId:c.id});
      }
      if(path==='/api/course/batch'&&req.method==='POST'){
        const c=publishBatch(store,dataDir,body);return json(res,200,{ok:true,courseId:c.id,revision:c.revision,completeness:c.completeness});
      }
      if(path==='/api/course/delete/prepare'&&req.method==='POST'){
        const c=store.read().courses.find(c=>c.id===body.courseId);assert(c,'课程不存在，可能已经删除。');
        for(const [key,value] of deletions)if(value.expiresAt<=now())deletions.delete(key);
        assert(deletions.size<100,'待确认操作过多，请稍后重试。');
        const confirmationToken=randomBytes(24).toString('hex'),expiresAt=now()+5*60*1000;
        deletions.set(confirmationToken,{courseId:c.id,title:c.title,fingerprint:fingerprint(c),expiresAt});
        return json(res,200,{confirmationToken,courseId:c.id,title:c.title,expiresAt});
      }
      if(path==='/api/course/delete'&&req.method==='POST'){
        const confirmation=deletions.get(body.confirmationToken);
        assert(confirmation&&confirmation.expiresAt>now(),'删除确认已失效，请重新开始。');
        assert(body.courseId===confirmation.courseId&&body.confirmedTitle===confirmation.title,'课程名称不匹配，尚未删除。');
        store.update(s=>{
          const c=s.courses.find(c=>c.id===confirmation.courseId);
          assert(c&&fingerprint(c)===confirmation.fingerprint,'课程内容已变化，请重新核对后删除。');
          removeCourse(s,c.id);
        });
        deletions.delete(body.confirmationToken);
        return json(res,200,{ok:true,courseId:confirmation.courseId});
      }
      if(path==='/api/backup'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="kotoba-library.json"','Cache-Control':'no-store'});
        return res.end(JSON.stringify(store.read(),null,2));
      }
      if(path==='/api/restore'&&req.method==='POST'){
        store.restore(body);deletions.clear();return json(res,200,{ok:true});
      }
      if(path==='/api/book'&&req.method==='GET'){
        const c=store.read().courses.find(c=>c.id===url.searchParams.get('course'));assert(c,'课程不存在。');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="course-book.html"','Cache-Control':'no-store'});return res.end(bookHtml(c));
      }
      if(path==='/api/course/file'&&req.method==='GET'){
        const c=store.read().courses.find(c=>c.id===url.searchParams.get('course'));assert(c,'课程不存在。');
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="course.json"','Cache-Control':'no-store'});return res.end(JSON.stringify(c,null,2));
      }
      if(path==='/api/shutdown'&&req.method==='POST'){
        json(res,200,{ok:true});setTimeout(()=>server.close(()=>store.close()),150);return;
      }
      if(path.startsWith('/api/'))return json(res,404,{error:'接口不存在。'});
      if(req.method!=='GET')return json(res,405,{error:'不支持此操作。'});
      let file;
      if(path.startsWith('/modules/')){
        const name=path.slice('/modules/'.length);assert(['domain.mjs','book.mjs'].includes(name),'模块不存在。');file=resolve(root,'src',name);
      }else{
        const publicDir=resolve(root,'public'),requested=path==='/'?'/index.html':decodeURIComponent(path);
        file=resolve(publicDir,'.'+requested);assert(file.startsWith(publicDir+sep),'页面不存在。');
      }
      if(!types[extname(file)]||!existsSync(file))return json(res,404,{error:'页面不存在。'});
      res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
      res.end(readFileSync(file));
    }catch(e){if(!res.headersSent)json(res,400,{error:e.message||'操作失败。'});else res.end();}
  });
  return{server,store,close(){server.close();store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createApp(),port=Number(process.env.PORT||4173);
  app.server.listen(port,'127.0.0.1',()=>console.log('Kotoba 0.3.0 课程库：http://127.0.0.1:'+port));
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口已被占用，请先停止旧版学习室。':e.message);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{app.close();process.exit(0);});
}
