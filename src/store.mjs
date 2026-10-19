import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initialState, migrateState, validateState } from './domain.mjs';

export class Store {
  constructor(path) {
    mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL); INSERT OR IGNORE INTO meta VALUES(1,0); CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,reason TEXT NOT NULL,data TEXT NOT NULL);');
    const row=this.db.prepare('SELECT data FROM state WHERE id=1').get();
    if(!row)this.db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify(initialState()));
    else if(JSON.parse(row.data).schemaVersion===1){
      this.update(()=>migrateState(JSON.parse(row.data)),true);
      // Purge the removed answer history from old database snapshots as well.
      const snapshots=this.db.prepare('SELECT id,data FROM snapshots').all();
      for(const snapshot of snapshots)this.db.prepare('UPDATE snapshots SET data=? WHERE id=?').run(JSON.stringify(migrateState(JSON.parse(snapshot.data))),snapshot.id);
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
    }
  }
  read(){return JSON.parse(this.db.prepare('SELECT data FROM state WHERE id=1').get().data);}
  revision(){return this.db.prepare('SELECT revision FROM meta WHERE id=1').get().revision;}
  update(fn,replace=false){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const state=this.read(),result=fn(state),next=replace?result:state;next.updatedAt=new Date().toISOString();
      this.db.prepare('UPDATE state SET data=? WHERE id=1').run(JSON.stringify(next));
      this.db.exec('UPDATE meta SET revision=revision+1 WHERE id=1; COMMIT');return result;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  restore(input){
    const restored=input.schemaVersion===1?migrateState(input):validateState(input);
    this.update(s=>{
      this.db.prepare('INSERT INTO snapshots(created_at,reason,data) VALUES(?,?,?)').run(new Date().toISOString(),'before-import',JSON.stringify(s));
      return restored;
    },true);
  }
  close(){this.db.close();}
}
