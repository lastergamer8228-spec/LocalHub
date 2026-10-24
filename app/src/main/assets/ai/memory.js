/* Local IndexedDB adapter. Versioned store schema; no engine logic or data wipe.
 * Role/session ownership of individual records is a separate, pending audit.
 */
(function (global) {
  'use strict';
  var AI = global.LH_AI = global.LH_AI || {};
  var DB_NAME = 'localhub_ai', DB_VERSION = 2;
  var STORES = [
    'memories','knowledge','tasks','automations','plugins','settings','chats',
    'context','cognitive_state','personal_model','active_goal',
    'episodes','procedures','facts','backups','incidents','transactions','audit','journals',
    'personal_memories','personal_profile','personal_context','personal_goals',
    'personal_state','personal_habits','personal_goals_history','active_personal_goal',
    'personal_routines','personal_sequences','routine_history','suggestion_memory','brain_timeline'
  ];
  function open() {
    return new Promise(function (resolve,reject) {
      if (!global.indexedDB) { reject(new Error('Local database is unavailable in this browser.')); return; }
      var request=global.indexedDB.open(DB_NAME,DB_VERSION), blocked=false;
      request.onupgradeneeded=function(){
        var db=request.result;
        STORES.forEach(function(name){if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});});
      };
      request.onblocked=function(){blocked=true;reject(new Error('Database upgrade is blocked. Close older LocalHub tabs and reload; do not delete your data.'));};
      request.onerror=function(){reject(request.error || new Error('Could not open local database.'));};
      request.onsuccess=function(){
        var db=request.result;
        db.onversionchange=function(){db.close();};
        if(blocked)db.close();else resolve(db);
      };
    });
  }
  function transaction(name,mode,operation) {
    if(STORES.indexOf(name)<0)return Promise.reject(new Error('Unknown local store: '+name));
    return open().then(function(db){
      return new Promise(function(resolve,reject){
        var tx, value, settled=false;
        function finish(error){if(settled)return;settled=true;db.close();if(error)reject(error);else resolve(value);}
        try {
          tx=db.transaction(name,mode);
          tx.oncomplete=function(){finish();};
          tx.onabort=function(){finish(tx.error || new Error('Local database transaction was aborted.'));};
          tx.onerror=function(){finish(tx.error || new Error('Local database transaction failed.'));};
          var request=operation(tx.objectStore(name));
          request.onsuccess=function(){value=request.result;};
        } catch(error){finish(error);}
      });
    });
  }
  AI.Memory={
    open:open,
    put:function(name,obj){
      if(!obj || typeof obj!=='object')return Promise.reject(new Error('A memory record must be an object.'));
      if(!obj.id)obj.id=name+'_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      if(!obj.createdAt)obj.createdAt=Date.now();
      obj.updatedAt=Date.now();
      return transaction(name,'readwrite',function(store){return store.put(obj);}).then(function(){return obj;});
    },
    getAll:function(name){return transaction(name,'readonly',function(store){return store.getAll();}).then(function(rows){return rows || [];});},
    get:function(name,id){return transaction(name,'readonly',function(store){return store.get(id);});},
    remove:function(name,id){return transaction(name,'readwrite',function(store){return store.delete(id);});},
    clear:function(name){return transaction(name,'readwrite',function(store){return store.clear();});}
  };
})(window);
