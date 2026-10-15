
const SUPABASE_URL='https://rbhslphjvqxtoleephdk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_XkAyinrprmor3xfbFfRkpA_b6Yug7Nh';
const APP_PUBLIC_URL='https://jayrodaniel20.github.io/registro-ocurrencias/';
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
let cloudUser=null;
let adminHomeStatsCache={students:0,occurrences:0,today:0,follow:0,loaded:false,updatedAt:0};
let adminHomeStatsLoading=false;
async function refreshAdminHomeStats(force=false){
  if(activeRole()!=='admin_general'||!cloudUser||!supabaseClient)return;
  const now=Date.now();
  if(adminHomeStatsLoading)return;
  if(!force&&adminHomeStatsCache.loaded&&(now-adminHomeStatsCache.updatedAt)<15000){
    applyAdminHomeStats();
    return;
  }
  adminHomeStatsLoading=true;
  try{
    const today=new Date().toISOString().slice(0,10);
    const [studentsRes,occRes,todayRes,followRes]=await Promise.all([
      supabaseClient.from('students').select('id',{count:'exact',head:true}),
      supabaseClient.from('occurrences').select('id',{count:'exact',head:true}),
      supabaseClient.from('occurrences').select('id',{count:'exact',head:true}).eq('occurrence_date',today),
      supabaseClient.from('occurrences').select('id',{count:'exact',head:true}).eq('requires_follow',true).or('follow_status.is.null,follow_status.neq.closed')
    ]);
    const firstError=[studentsRes,occRes,todayRes,followRes].find(r=>r&&r.error)?.error;
    if(firstError)throw firstError;
    adminHomeStatsCache={
      students:studentsRes.count||0,
      occurrences:occRes.count||0,
      today:todayRes.count||0,
      follow:followRes.count||0,
      loaded:true,
      updatedAt:Date.now()
    };
    applyAdminHomeStats();
  }catch(err){
    console.error('No se pudieron cargar los indicadores administrativos',err);
  }finally{
    adminHomeStatsLoading=false;
  }
}
function applyAdminHomeStats(){
  if(activeRole()!=='admin_general'||!adminHomeStatsCache.loaded)return;
  if($('statStudents'))$('statStudents').textContent=adminHomeStatsCache.students;
  if($('statOcc'))$('statOcc').textContent=adminHomeStatsCache.occurrences;
  if($('statToday'))$('statToday').textContent=adminHomeStatsCache.today;
  if($('statFollow'))$('statFollow').textContent=adminHomeStatsCache.follow;
}

let localBypass=false;
let activeMembershipId=localStorage.getItem('sage_active_membership')||'';
let swRegistration=null;
let refreshingForUpdate=false;
let accessContext={role:null,institutionId:null,institution:null,membership:null,memberships:[],roles:[],teacherMembership:null,auxiliaryMembership:null,directorMembership:null,adminMembership:null};
let adminCache={institutions:[],profiles:[],memberships:[]};
let adminClassroomState={institutionId:'',classrooms:[]};
let adminUserGroup='pending';
let classroomAccessState={userId:null,institutionId:null,userName:'',role:null,classrooms:[],selected:new Set(),types:new Map()};
let currentClassroomAccess=new Map();
let directorCache={profiles:[],classrooms:[],students:[],occurrences:[]};
const DBKEY='registro_ocurrencias_v1';
const APP_VERSION='2.2.22';
const SCHEMA_VERSION=3;
const OCCURRENCE_SUBTYPES={
  'Convivencia':['Desacuerdo entre compañeros','Dificultad para respetar turnos','Conflicto por materiales o espacios','Incumplimiento de acuerdos de convivencia','Dificultad para integrarse al grupo','Situación que requiere revisión por Dirección','Otro'],
  'Conducta':['Interrupciones frecuentes','Dificultad para seguir indicaciones','Dificultad para autorregularse','Conducta inusual observada','Uso inadecuado de materiales o espacios','Situación que requiere revisión por Dirección','Otro'],
  'Aprendizaje':['Dificultad para comprender consignas','Dificultad persistente en una actividad o competencia','Trabajo incompleto','Requiere apoyo adicional','Baja participación en actividades de aprendizaje','Progreso destacado','Otro'],
  'Participación':['Participación activa','Colaboración con compañeros','Liderazgo positivo','Poca participación','Dificultad para incorporarse a la actividad','Iniciativa destacada','Otro'],
  'Responsabilidad':['Falta recurrente de materiales','Tarea o trabajo no presentado','Tardanza recurrente','Inasistencia que requiere seguimiento','Incumplimiento de compromiso escolar','Cuidado inadecuado de materiales','Otro'],
  'Situación positiva':['Logro académico destacado','Actitud solidaria','Liderazgo positivo','Mejora en el cumplimiento de acuerdos','Esfuerzo y perseverancia','Cuidado del entorno o materiales','Otro'],
  'Incidente':['Accidente leve','Malestar físico','Pérdida o daño accidental de material','Situación de seguridad sin violencia','Situación que requiere revisión por Dirección','Otro'],
  'Comunicación con familia':['Reunión solicitada','Información relevante comunicada por la familia','Compromiso asumido por la familia','Dificultad para contactar a la familia','Seguimiento de un acuerdo con la familia','Otro'],
  'Otro':['Otro']
};
const SENSITIVE_SUBTYPES=new Set(['Situación que requiere revisión por Dirección']);
const $=id=>document.getElementById(id);
function showAuthMessage(msg,type='ok'){const el=$('authMessage');el.textContent=msg;el.className='auth-message show '+(type==='err'?'err':'ok')}
function clearAuthMessage(){const el=$('authMessage');el.textContent='';el.className='auth-message'}
function showAuthTab(tab){clearAuthMessage();$('tabLogin').classList.toggle('active',tab==='login');$('tabSignup').classList.toggle('active',tab==='signup');$('authLogin').classList.toggle('active',tab==='login');$('authSignup').classList.toggle('active',tab==='signup')}
function setAuthGate(show){$('authGate').classList.toggle('hidden',!show)}
function hasRole(role){return accessContext.roles.includes(role)}
function activeMembership(){return accessContext.memberships.find(m=>m.id===activeMembershipId)||accessContext.membership||null}
function activeRole(){return activeMembership()?.role||null}
function activeInstitution(){return activeMembership()?.institutions||null}
function activeInstitutions(){
  const seen=new Set();
  return accessContext.memberships.map(m=>m.institutions).filter(i=>i&&i.id&&!seen.has(i.id)&&seen.add(i.id));
}
function roleSummary(){return accessContext.roles.length?accessContext.roles.map(roleLabel).join(' + '):'Sin asignar'}
function institutionSummary(){const arr=activeInstitutions();return arr.length?arr.map(i=>i.name).join(' · '):'Sin asignar'}
function updateAccountUi(){
  const email=cloudUser?.email||'';
  if($('accountEmailLabel'))$('accountEmailLabel').textContent=email||'No iniciada';
  if($('accountStateLabel')){$('accountStateLabel').textContent=cloudUser?'Cuenta conectada':'Modo local';$('accountStateLabel').style.background=cloudUser?'#eaf8ef':'#edf3ff';$('accountStateLabel').style.color=cloudUser?'#17653a':'#0e4ea7'}
  if($('logoutBtn'))$('logoutBtn').style.display=cloudUser?'inline-block':'none';
  if($('loginBtn'))$('loginBtn').style.display=cloudUser?'none':'inline-block';
  if($('storageModeLabel'))$('storageModeLabel').textContent=cloudUser?'Nube + local':'Local';
  if(db&&db.profile){db.profile.cloudUserId=cloudUser?.id||null;db.profile.email=email||null;db.profile.mode=cloudUser?'authenticated':'local';localStorage.setItem(DBKEY,JSON.stringify(db));}
  if($('syncNowBtn'))$('syncNowBtn').style.display=cloudUser?'inline-block':'none';
  if($('accountRoleLabel'))$('accountRoleLabel').textContent=roleSummary();
  if($('accountInstitutionLabel'))$('accountInstitutionLabel').textContent=institutionSummary();
  updateRoleUi();
  updateSyncUi();
}

function roleLabel(role){return ({admin_general:'Administrador general',director:'Director',docente:'Docente',auxiliar:'Auxiliar de educación',especialista_ugel:'Especialista UGEL'})[role]||'Sin asignar'}
function roleIcon(role){return ({admin_general:'🛡️',director:'🏛️',docente:'👤',auxiliar:'🧩',especialista_ugel:'🏢'})[role]||'👤'}
function rolePriority(role){return ({admin_general:4,especialista_ugel:3,director:2,docente:1,auxiliar:1})[role]||0}
function membershipLabel(m){return `${roleLabel(m.role)}${m.institutions?.name?' — '+m.institutions.name:''}`}
function updateNavCount(){const nav=document.querySelector('nav');if(!nav)return;const visible=[...nav.querySelectorAll('button')].filter(b=>getComputedStyle(b).display!=='none').length;nav.style.setProperty('--nav-count',Math.max(1,visible));}
function renderRoleSwitcher(){
  const card=$('roleSwitcherCard'),sel=$('activeRoleSelect'),pill=$('activeRolePill'),inst=$('activeRoleInstitution');
  if(!card||!sel)return;
  if(!cloudUser||accessContext.memberships.length<2){card.style.display='none';return;}
  card.style.display='block';
  sel.innerHTML=accessContext.memberships.map(m=>`<option value="${m.id}">${esc(membershipLabel(m))}</option>`).join('');
  const current=activeMembership();
  if(current)sel.value=current.id;
  if(pill)pill.textContent=current?`${roleIcon(current.role)} ${roleLabel(current.role)}`:'Sin asignar';
  if(inst)inst.textContent=current?.institutions?.name?`Institución activa: ${current.institutions.name}`:(current?.role==='admin_general'?'Acceso general al sistema':'Sin institución específica');
}
function viewAllowed(id){
  if(!cloudUser)return true;
  const role=activeRole();
  if(id==='inicio')return true;
  if(role==='docente'||role==='auxiliar')return ['salones','estudiantes','ocurrencia','historial','reportes'].includes(id);
  if(role==='director')return id==='institucion';
  if(role==='admin_general')return id==='administracion';
  if(role==='especialista_ugel')return id==='institucion';
  return false;
}
function defaultViewForActiveRole(){
  const role=activeRole();
  if(role==='admin_general')return 'administracion';
  if(role==='director'||role==='especialista_ugel')return 'institucion';
  return 'inicio';
}
async function switchActiveMembership(id){
  if(!accessContext.memberships.some(m=>m.id===id))return;
  activeMembershipId=id;localStorage.setItem('sage_active_membership',id);
  accessContext.membership=activeMembership();
  accessContext.role=activeRole();
  accessContext.institution=activeInstitution();
  accessContext.institutionId=activeMembership()?.institution_id||null;
  await refreshCurrentClassroomAccess();
  // Al cambiar de rol/institución, reemplaza la vista local con el alcance permitido.
  // No sube datos del contexto anterior, evitando contaminación entre instituciones.
  if(cloudUser&&['docente','auxiliar'].includes(activeRole())){
    try{const remote=await fetchCloudRows();replaceLocalWithCloud(remote);localStorage.setItem(DBKEY,JSON.stringify(db));refreshAll();}catch(e){console.warn('No se pudo refrescar el contexto activo:',e);}
  }
  updateRoleUi();
  const target=defaultViewForActiveRole();go(target);
  if(activeRole()==='admin_general')loadAdminPanel();
  if(activeRole()==='director')loadDirectorDashboard();
  toast(`Modo ${roleLabel(activeRole())} activado`);
}
function updateRoleUi(){
  const current=activeMembership();
  const role=current?.role||null;
  const chip=$('headerRoleChip');
  if(chip){
    if(cloudUser&&role){
      chip.style.display='inline-flex';chip.textContent=`${roleIcon(role)} ${roleLabel(role)}`;
      chip.className='role-chip '+(role==='admin_general'?'admin':role==='director'?'director':'');
    } else chip.style.display='none';
  }
  if($('accountRoleLabel'))$('accountRoleLabel').textContent=roleSummary();
  if($('accountInstitutionLabel'))$('accountInstitutionLabel').textContent=institutionSummary();
  const teacherViews=['salones','estudiantes','ocurrencia','historial','reportes'];
  const canTeach=!cloudUser||role==='docente'||role==='auxiliar';
  document.querySelectorAll('nav button[data-view]').forEach(btn=>{
    const v=btn.dataset.view;
    if(teacherViews.includes(v))btn.style.display=canTeach?'flex':'none';
    else if(v==='administracion')btn.style.display=role==='admin_general'?'flex':'none';
    else if(v==='institucion')btn.style.display=(role==='director'||role==='especialista_ugel')?'flex':'none';
    else btn.style.display='flex';
  });
  const quick=document.querySelector('#inicio .quick');if(quick)quick.style.display=canTeach?'':'none';
  renderRoleSwitcher();
  updateNavCount();
}
async function refreshCurrentClassroomAccess(){
  currentClassroomAccess=new Map();
  if(!cloudUser)return currentClassroomAccess;
  try{
    let q=supabaseClient.from('user_classroom_access').select('classroom_id,access_type,active,institution_id').eq('user_id',cloudUser.id).eq('active',true);
    if(accessContext.institutionId)q=q.eq('institution_id',accessContext.institutionId);
    const {data,error}=await q;
    if(error)throw error;
    (data||[]).forEach(a=>currentClassroomAccess.set(a.classroom_id,a.access_type||'shared'));
  }catch(e){console.warn('No se pudieron cargar los accesos a salones:',e);}
  return currentClassroomAccess;
}
function classroomAccessType(classroomId){return currentClassroomAccess.get(classroomId)||''}
function canManageClassroomStudents(c){return !!c&&!c.sharedReadOnly||!!c?.responsibleManaged}

async function loadAccessContext(){
  accessContext={role:null,institutionId:null,institution:null,membership:null,memberships:[],roles:[],teacherMembership:null,auxiliaryMembership:null,directorMembership:null,adminMembership:null};
  if(!cloudUser){updateRoleUi();updateAccountUi();return accessContext;}
  try{
    const {data,error}=await supabaseClient.from('user_memberships').select('id,user_id,role,institution_id,active,valid_from,valid_until,institutions(id,name,modular_code,ugel,region,educational_level)').eq('user_id',cloudUser.id).eq('active',true);
    if(error)throw error;
    const valid=(data||[]).filter(m=>!m.valid_until||Date.parse(m.valid_until)>Date.now()).sort((a,b)=>rolePriority(b.role)-rolePriority(a.role));
    const primary=valid[0]||null;
    const teacher=valid.find(m=>m.role==='docente')||null;
    const auxiliary=valid.find(m=>m.role==='auxiliar')||null;
    const director=valid.find(m=>m.role==='director')||null;
    const admin=valid.find(m=>m.role==='admin_general')||null;
    let selected=valid.find(m=>m.id===activeMembershipId)||primary;
    if(selected){activeMembershipId=selected.id;localStorage.setItem('sage_active_membership',selected.id);}
    accessContext={
      role:selected?.role||null,
      institutionId:selected?.institution_id||null,
      institution:selected?.institutions||null,
      membership:selected,
      memberships:valid,
      roles:[...new Set(valid.map(m=>m.role))],
      teacherMembership:teacher,
      auxiliaryMembership:auxiliary,
      directorMembership:director,
      adminMembership:admin
    };
  }catch(e){console.warn('No se pudieron cargar los roles:',e);}
  await refreshCurrentClassroomAccess();
  updateRoleUi();updateAccountUi();updateProfileSummary();
  if(activeRole()==='admin_general')loadAdminPanel();
  if(activeRole()==='director')loadDirectorDashboard();
  return accessContext;
}

function openLoginGate(){
  localBypass=false;
  showAuthTab('login');
  clearAuthMessage();
  setAuthGate(true);
}

function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''))}
function uuidNow(){return crypto.randomUUID()}
function ensureCloudMap(){
  db.meta=db.meta||{};
  db.meta.cloudIdMap=db.meta.cloudIdMap||{classrooms:{},students:{},occurrences:{},groups:{}};
  for(const k of ['classrooms','students','occurrences','groups'])db.meta.cloudIdMap[k]=db.meta.cloudIdMap[k]||{};
  return db.meta.cloudIdMap;
}
function mappedUuid(kind,localId){
  if(!localId)return null;
  const map=ensureCloudMap()[kind];
  if(map[localId]&&isUuid(map[localId]))return map[localId];
  const id=isUuid(localId)?localId:uuidNow();
  map[localId]=id;
  return id;
}
function localMigrationCounts(){return {classrooms:db.classrooms.length,students:db.students.length,occurrences:db.occurrences.length}}
async function cloudCounts(){
  const tables=['classrooms','students','occurrences'];
  const out={};
  for(const t of tables){
    const {count,error}=await supabaseClient.from(t).select('*',{count:'exact',head:true});
    if(error)throw error; out[t]=count||0;
  }
  return out;
}
async function refreshCloudMigrationStatus(){
  const box=$('cloudMigrationSummary'); if(!box)return;
  if(!cloudUser){box.textContent='Inicia sesión para revisar el estado.';return}
  box.innerHTML='Consultando la nube…';
  try{
    const l=localMigrationCounts(),c=await cloudCounts();
    const last=db.meta?.cloudMigratedAt?new Date(db.meta.cloudMigratedAt).toLocaleString():'Nunca';
    box.innerHTML=`<div><b>En este dispositivo:</b> ${l.classrooms} salones · ${l.students} estudiantes · ${l.occurrences} ocurrencias</div><div style="margin-top:5px"><b>En tu cuenta:</b> ${c.classrooms} salones · ${c.students} estudiantes · ${c.occurrences} ocurrencias</div><div style="margin-top:5px"><b>Última copia manual:</b> ${esc(last)}</div>`;
  }catch(e){box.innerHTML=`<span style="color:#9d1d1d">No se pudo consultar la nube: ${esc(e.message||e)}</span>`}
}
function cloudRows(options={}){
  const uid=cloudUser.id, dirtyOnly=!!options.dirtyOnly, remote=options.remote||null;
  const remoteMaps={
    classrooms:new Map((remote?.classrooms||[]).map(r=>[r.id,r])),
    students:new Map((remote?.students||[]).map(r=>[r.id,r])),
    occurrences:new Map((remote?.occurrences||[]).map(r=>[r.id,r]))
  };
  const shouldUpload=(kind,item)=>{
    if(dirtyOnly && item.syncState!=='local')return false;
    const cloudId=mappedUuid(kind,item.id);
    const rr=remoteMaps[kind].get(cloudId);
    if(!rr)return true;
    // Si la nube cambió después que esta copia local, la nube gana para evitar sobrescribir datos más nuevos.
    return dateMs(item.updatedAt)>=dateMs(rr.updated_at);
  };
  const activeInst=accessContext.institutionId||null;
  const contextOk=item=>!activeInst||!item.institutionId||item.institutionId===activeInst;
  const allowedIds=new Set([...currentClassroomAccess.keys()]);
  const roomAllowed=c=>contextOk(c)&&(!allowedIds.size||allowedIds.has(c.id)||allowedIds.has(mappedUuid('classrooms',c.id))||c.responsibleManaged);
  const ownClassrooms=db.classrooms.filter(c=>roomAllowed(c)&&!c.sharedReadOnly&&(!c.cloudOwnerId||c.cloudOwnerId===uid)&&shouldUpload('classrooms',c));
  const ownClassroomIds=new Set(ownClassrooms.map(c=>c.id));
  const ownStudents=db.students.filter(st=>contextOk(st)&&(ownClassroomIds.has(st.classroomId)||allowedIds.has(st.classroomId)||st.responsibleManaged)&&(!st.sharedReadOnly||st.responsibleManaged)&&(!st.cloudOwnerId||st.cloudOwnerId===uid||st.responsibleManaged)&&shouldUpload('students',st));
  const ownOccurrences=db.occurrences.filter(o=>contextOk(o)&&(ownClassroomIds.has(o.classroomId)||allowedIds.has(o.classroomId))&&(!o.cloudOwnerId||o.cloudOwnerId===uid)&&shouldUpload('occurrences',o));
  const classrooms=ownClassrooms.map(c=>({id:mappedUuid('classrooms',c.id),user_id:c.cloudOwnerId||uid,institution_id:c.institutionId||activeInst||null,level:c.level||null,grade:c.grade||null,section:c.section||null,name:c.name||[c.grade,c.section].filter(Boolean).join(' ')||'Salón',created_at:c.createdAt||nowISO(),updated_at:c.updatedAt||c.createdAt||nowISO()}));
  const students=ownStudents.map(st=>({id:mappedUuid('students',st.id),user_id:st.cloudOwnerId||uid,institution_id:st.institutionId||activeInst||null,classroom_id:st.classroomId?mappedUuid('classrooms',st.classroomId):null,name:st.name,grade:st.grade||null,section:st.section||null,created_at:st.createdAt||nowISO(),updated_at:st.updatedAt||st.createdAt||nowISO()}));
  const occurrences=ownOccurrences.map(o=>({id:mappedUuid('occurrences',o.id),user_id:uid,institution_id:o.institutionId||activeInst||null,classroom_id:o.classroomId?mappedUuid('classrooms',o.classroomId):null,student_id:o.studentId?mappedUuid('students',o.studentId):null,student_name:o.studentName||'Estudiante',grade:o.grade||null,section:o.section||null,occurrence_date:o.date||new Date().toISOString().slice(0,10),occurrence_time:o.time||null,place:o.place||null,type:o.type||null,subtype:o.subtype||null,description:o.description||'',actions:o.actions||null,follow_text:o.followText||null,requires_follow:!!o.requiresFollow,follow_status:o.requiresFollow?(o.followStatus||'pending'):null,follow_date:o.followDate||null,follow_note:o.followNote||null,group_id:o.groupId?mappedUuid('groups',o.groupId):null,created_at:o.createdAt||nowISO(),updated_at:o.updatedAt||o.createdAt||nowISO()}));
  return {classrooms,students,occurrences};
}
async function uploadLocalDataToCloud(){
  if(!cloudUser)return alert('Primero inicia sesión.');
  const n=localMigrationCounts();
  const msg=`Se copiarán a tu cuenta:\n\n• ${n.classrooms} salones\n• ${n.students} estudiantes\n• ${n.occurrences} ocurrencias\n\nTus datos locales NO se borrarán. Esta acción todavía no activa la sincronización automática. ¿Continuar?`;
  if(!confirm(msg))return;
  const btn=$('cloudUploadBtn'); const old=btn.textContent; btn.disabled=true; btn.textContent='Subiendo…';
  try{
    // perfil/configuración
    let {error}=await supabaseClient.from('profiles').upsert({id:cloudUser.id,email:cloudUser.email||null,display_name:db.config?.teacher||db.profile?.displayName||null,updated_at:nowISO()},{onConflict:'id'}); if(error)throw error;
    ({error}=await supabaseClient.from('user_settings').upsert({user_id:cloudUser.id,school_name:db.config?.school||null,teacher_name:db.config?.teacher||null,default_level:db.config?.level||null,default_class_name:db.config?.className||null,updated_at:nowISO()},{onConflict:'user_id'})); if(error)throw error;
    const rows=cloudRows();
    if(rows.classrooms.length){({error}=await supabaseClient.from('classrooms').upsert(rows.classrooms,{onConflict:'id'}));if(error)throw error}
    if(rows.students.length){({error}=await supabaseClient.from('students').upsert(rows.students,{onConflict:'id'}));if(error)throw error}
    if(rows.occurrences.length){({error}=await supabaseClient.from('occurrences').upsert(rows.occurrences,{onConflict:'id'}));if(error)throw error}
    db.meta.cloudMigratedAt=nowISO();db.meta.cloudMigratedUserId=cloudUser.id;db.classrooms.forEach(x=>x.syncState='uploaded');db.students.forEach(x=>x.syncState='uploaded');db.occurrences.forEach(x=>x.syncState='uploaded');localStorage.setItem(DBKEY,JSON.stringify(db));
    toast('Copia en la nube completada'); await refreshCloudMigrationStatus();
    alert('Copia completada correctamente. Tus datos locales se mantienen en este dispositivo. El siguiente paso será probar la descarga/sincronización en otro dispositivo.');
  }catch(e){alert('No se pudo completar la copia en la nube. No se borró ningún dato local.\n\nDetalle: '+(e.message||e));}
  finally{btn.disabled=false;btn.textContent=old}
}


function ensureDeletionQueue(){
  db.meta=db.meta||{};
  db.meta.deleted=db.meta.deleted||{classrooms:[],students:[],occurrences:[]};
  for(const k of ['classrooms','students','occurrences'])db.meta.deleted[k]=Array.isArray(db.meta.deleted[k])?db.meta.deleted[k]:[];
  return db.meta.deleted;
}
function queueCloudDelete(kind,localId){
  if(!cloudUser||!localId)return;
  const cloudId=mappedUuid(kind,localId);
  const q=ensureDeletionQueue()[kind];
  if(!q.some(x=>x.id===cloudId))q.push({id:cloudId,deletedAt:nowISO()});
}
function pendingSyncCount(){
  const dirty=[...db.classrooms,...db.students,...db.occurrences].filter(x=>x.syncState==='local'&&(!x.sharedReadOnly||x.responsibleManaged)&&(!x.cloudOwnerId||!cloudUser||x.cloudOwnerId===cloudUser.id||x.responsibleManaged)).length;
  const q=ensureDeletionQueue();
  return dirty+q.classrooms.length+q.students.length+q.occurrences.length;
}
function updateSyncUi(){
  const status=$('syncStatusLabel'),last=$('lastSyncLabel'),pending=$('pendingSyncLabel');
  const count=pendingSyncCount();
  if(pending)pending.textContent=count;
  if(last)last.textContent=db.meta?.lastSyncAt?new Date(db.meta.lastSyncAt).toLocaleString():'Nunca';
  if(status){
    let txt='Sin conexión',bg='#fff5df',fg='#8b5a00';
    if(cloudUser){txt=count?'Pendiente':'Sincronizado';bg=count?'#fff5df':'#eaf8ef';fg=count?'#8b5a00':'#17653a'}
    status.textContent=txt;status.style.background=bg;status.style.color=fg;
  }
}
function dateMs(v){const n=Date.parse(v||'');return Number.isFinite(n)?n:0}
function findLocalByCloudId(kind,cloudId){
  const arr=kind==='classrooms'?db.classrooms:kind==='students'?db.students:db.occurrences;
  const map=ensureCloudMap()[kind];
  for(const item of arr){
    if(item.id===cloudId||map[item.id]===cloudId)return item;
  }
  return null;
}
function cloudToLocal(kind,row){
  const owner=row.user_id||null;
  const accessType=kind==='classrooms'?classroomAccessType(row.id):(kind==='students'?classroomAccessType(row.classroom_id):'');
  const responsible=accessType==='responsible';
  const shared=!!(cloudUser&&owner&&owner!==cloudUser.id&&!responsible);
  if(kind==='classrooms')return {id:row.id,ownerId:owner||db.profile.id,cloudOwnerId:owner,institutionId:row.institution_id||accessContext.institutionId||null,sharedReadOnly:!!(cloudUser&&owner&&owner!==cloudUser.id),responsibleManaged:responsible,level:row.level||'Primaria',grade:row.grade||'',section:row.section||'',name:row.name||'Salón',createdAt:row.created_at||nowISO(),updatedAt:row.updated_at||row.created_at||nowISO(),syncState:'synced'};
  if(kind==='students')return {id:row.id,ownerId:owner||db.profile.id,cloudOwnerId:owner,institutionId:row.institution_id||accessContext.institutionId||null,sharedReadOnly:shared,responsibleManaged:responsible,classroomId:row.classroom_id||null,name:row.name||'',grade:row.grade||'',section:row.section||'',createdAt:row.created_at||nowISO(),updatedAt:row.updated_at||row.created_at||nowISO(),syncState:'synced'};
  return {id:row.id,ownerId:owner||db.profile.id,cloudOwnerId:owner,institutionId:row.institution_id||accessContext.institutionId||null,classroomId:row.classroom_id||null,studentId:row.student_id||null,studentName:row.student_name||'Estudiante',grade:row.grade||'',section:row.section||'',date:row.occurrence_date||'',time:row.occurrence_time||'',place:row.place||'',type:row.type||'',subtype:row.subtype||'',description:row.description||'',actions:row.actions||'',followText:row.follow_text||'',requiresFollow:!!row.requires_follow,followStatus:row.requires_follow?(row.follow_status||'pending'):'',followDate:row.follow_date||'',followNote:row.follow_note||'',groupId:row.group_id||null,createdAt:row.created_at||nowISO(),updatedAt:row.updated_at||row.created_at||nowISO(),syncState:'synced'};
}

function normStudentPart(v){
  return (v||'').toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\u200B-\u200D\uFEFF]/g,'')
    .replace(/[º°ª.]/g,'')
    .trim().toLowerCase().replace(/\s+/g,' ');
}
function normStudentName(v){
  return normStudentPart(v).replace(/[^a-z0-9ñ ]/g,'').replace(/\s+/g,' ').trim();
}
function normStudentGrade(v){
  const c=normStudentPart(v).replace(/\s+/g,'');
  const m=c.match(/\d+/);
  return m?String(parseInt(m[0],10)):c.replace(/[^a-z0-9]/g,'');
}
function normStudentSection(v){
  return normStudentPart(v).replace(/[^a-z0-9ñ]/g,'');
}
function normStudentKey(name,grade,section){
  return `${normStudentName(name)}|${normStudentGrade(grade)}|${normStudentSection(section)}`;
}
function collapseLocalStudentDuplicates(){
  const groups=new Map();
  for(const s of db.students){
    const key=normStudentKey(s.name,s.grade,s.section)+'|'+(s.classroomId||'');
    if(!key.replace(/\|/g,''))continue;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(s);
  }
  let removed=0;
  for(const [key,rows] of groups){
    if(rows.length<2)continue;
    rows.sort((a,b)=>{
      const ao=db.occurrences.filter(o=>o.studentId===a.id).length;
      const bo=db.occurrences.filter(o=>o.studentId===b.id).length;
      if(ao!==bo)return bo-ao;
      return dateMs(a.createdAt)-dateMs(b.createdAt);
    });
    const keep=rows[0];
    for(const dup of rows.slice(1)){
      db.occurrences.forEach(o=>{
        if(o.studentId===dup.id || normStudentKey(o.studentName,o.grade,o.section)===key){
          o.studentId=keep.id;
          o.studentName=keep.name;
          o.grade=keep.grade;
          o.section=keep.section;
          o.classroomId=keep.classroomId||o.classroomId||null;
          o.updatedAt=nowISO();
          if(o.syncState!=='local')o.syncState='local';
        }
      });
      const map=ensureCloudMap().students;
      if(map[dup.id]&&!map[keep.id])map[keep.id]=map[dup.id];
      delete map[dup.id];
      db.students=db.students.filter(s=>s.id!==dup.id);
      removed++;
    }
  }
  return removed;
}
async function cleanupCloudStudentDuplicates(remoteStudents){
  const groups=new Map();
  for(const r of (remoteStudents||[]).filter(x=>!cloudUser||!x.user_id||x.user_id===cloudUser.id)){
    const key=normStudentKey(r.name,r.grade,r.section)+'|'+(r.classroom_id||'');
    if(!key.replace(/\|/g,''))continue;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(r);
  }
  let removed=0;
  for(const rows of groups.values()){
    if(rows.length<2)continue;
    const counts=[];
    for(const r of rows){
      const {count,error}=await supabaseClient.from('occurrences').select('id',{count:'exact',head:true}).eq('student_id',r.id);
      if(error)throw error;
      counts.push([r,count||0]);
    }
    counts.sort((a,b)=>b[1]-a[1] || dateMs(a[0].created_at)-dateMs(b[0].created_at));
    const keep=counts[0][0];
    for(const [dup] of counts.slice(1)){
      let {error}=await supabaseClient.from('occurrences').update({
        student_id:keep.id,
        student_name:keep.name,
        grade:keep.grade,
        section:keep.section,
        classroom_id:keep.classroom_id||dup.classroom_id||null,
        updated_at:nowISO()
      }).eq('student_id',dup.id);
      if(error)throw error;
      ({error}=await supabaseClient.from('students').delete().eq('id',dup.id));
      if(error)throw error;
      removed++;
    }
  }
  return removed;
}

function applyCloudRow(kind,row){
  let local=findLocalByCloudId(kind,row.id);
  const incoming=cloudToLocal(kind,row);
  const arr=kind==='classrooms'?db.classrooms:kind==='students'?db.students:db.occurrences;
  // Para estudiantes antiguos creados antes de la nube, intenta emparejar por nombre+grado+sección
  // antes de crear una nueva fila local. Esto evita duplicados entre laptop y celular.
  if(!local&&kind==='students'){
    const key=normStudentKey(row.name,row.grade,row.section);
    local=db.students.find(s=>normStudentKey(s.name,s.grade,s.section)===key)||null;
    if(local){ensureCloudMap().students[local.id]=row.id;}
  }
  if(!local){arr.push(incoming);ensureCloudMap()[kind][incoming.id]=row.id;return}
  if(dateMs(row.updated_at)>dateMs(local.updatedAt)){
    const oldId=local.id;
    Object.assign(local,incoming,{id:oldId,syncState:'synced'});
    ensureCloudMap()[kind][oldId]=row.id;
  }
}
async function activeInstitutionUserIds(){
  const inst=accessContext.institutionId;
  if(!inst)return new Set([cloudUser?.id].filter(Boolean));
  const {data,error}=await supabaseClient.from('user_memberships')
    .select('user_id,role,institution_id,active,valid_until')
    .eq('institution_id',inst).eq('active',true);
  if(error)throw error;
  const now=Date.now();
  return new Set((data||[])
    .filter(m=>!m.valid_until||Date.parse(m.valid_until)>now)
    .map(m=>m.user_id).filter(Boolean));
}
async function fetchCloudRows(){
  const role=activeRole();
  const inst=accessContext.institutionId;
  const out={classrooms:[],students:[],occurrences:[]};

  // Administrador general no debe mezclar datos institucionales en la vista operativa.
  if(role==='admin_general')return out;

  // Docentes y auxiliares: SOLO salones expresamente autorizados en la institución activa.
  if(role==='docente'||role==='auxiliar'){
    await refreshCurrentClassroomAccess();
    const allowed=[...currentClassroomAccess.keys()];
    if(!allowed.length){
      // Compatibilidad temporal: si el docente tiene una sola institución docente y todavía
      // no recibió asignaciones, conserva únicamente sus propios datos. Nunca datos ajenos.
      const sameRoleInsts=(accessContext.memberships||[]).filter(m=>m.role===role&&m.institution_id);
      if(role==='docente'&&sameRoleInsts.length===1){
        let r=await supabaseClient.from('classrooms').select('*').eq('user_id',cloudUser.id).eq('institution_id',inst);if(r.error)throw r.error;out.classrooms=r.data||[];
        const ids=out.classrooms.map(x=>x.id);
        if(ids.length){
          r=await supabaseClient.from('students').select('*').eq('institution_id',inst).in('classroom_id',ids);if(r.error)throw r.error;out.students=r.data||[];
          r=await supabaseClient.from('occurrences').select('*').eq('institution_id',inst).in('classroom_id',ids);if(r.error)throw r.error;out.occurrences=r.data||[];
        }
      }
      return out;
    }
    let r=await supabaseClient.from('classrooms').select('*').eq('institution_id',inst).in('id',allowed);if(r.error)throw r.error;out.classrooms=r.data||[];
    r=await supabaseClient.from('students').select('*').eq('institution_id',inst).in('classroom_id',allowed);if(r.error)throw r.error;out.students=r.data||[];
    r=await supabaseClient.from('occurrences').select('*').eq('institution_id',inst).in('classroom_id',allowed);if(r.error)throw r.error;out.occurrences=r.data||[];
    return out;
  }

  // Director: solo información perteneciente a usuarios activos de SU institución.
  if(role==='director'&&inst){
    const members=[...(await activeInstitutionUserIds())];
    if(!members.length)return out;
    let r=await supabaseClient.from('classrooms').select('*').eq('institution_id',inst).in('user_id',members);if(r.error)throw r.error;out.classrooms=r.data||[];
    const classIds=out.classrooms.map(x=>x.id);
    if(classIds.length){
      r=await supabaseClient.from('students').select('*').eq('institution_id',inst).in('classroom_id',classIds);if(r.error)throw r.error;out.students=r.data||[];
      r=await supabaseClient.from('occurrences').select('*').eq('institution_id',inst).in('classroom_id',classIds);if(r.error)throw r.error;out.occurrences=r.data||[];
    }
    return out;
  }

  // Otros roles: por seguridad, no descargan información operativa.
  return out;
}

function reconcileRemoteDeletions(remote){
  const specs=[['classrooms','classrooms'],['students','students'],['occurrences','occurrences']];
  for(const [kind,key] of specs){
    const ids=new Set((remote[key]||[]).map(r=>r.id));
    const arr=kind==='classrooms'?db.classrooms:kind==='students'?db.students:db.occurrences;
    const kept=arr.filter(item=>{
      if(item.syncState==='local')return true;
      const cid=ensureCloudMap()[kind][item.id]||(isUuid(item.id)?item.id:null);
      return !cid||ids.has(cid);
    });
    if(kind==='classrooms')db.classrooms=kept;
    else if(kind==='students')db.students=kept;
    else db.occurrences=kept;
  }
}
async function applyPendingDeletes(){
  const q=ensureDeletionQueue();
  for(const [kind,table] of [['occurrences','occurrences'],['students','students'],['classrooms','classrooms']]){
    for(const item of [...q[kind]]){
      const {error}=await supabaseClient.from(table).delete().eq('id',item.id);
      if(error)throw error;
      q[kind]=q[kind].filter(x=>x.id!==item.id);
    }
  }
}
async function uploadDirtyLocal(remote){
  let {error}=await supabaseClient.from('profiles').upsert({id:cloudUser.id,email:cloudUser.email||null,display_name:db.config?.teacher||db.profile?.displayName||null,updated_at:nowISO()},{onConflict:'id'}); if(error)throw error;
  ({error}=await supabaseClient.from('user_settings').upsert({user_id:cloudUser.id,school_name:db.config?.school||null,teacher_name:db.config?.teacher||null,default_level:db.config?.level||null,default_class_name:db.config?.className||null,updated_at:nowISO()},{onConflict:'user_id'})); if(error)throw error;
  const rows=cloudRows({dirtyOnly:true,remote});
  if(rows.classrooms.length){({error}=await supabaseClient.from('classrooms').upsert(rows.classrooms,{onConflict:'id'}));if(error)throw error}
  if(rows.students.length){({error}=await supabaseClient.from('students').upsert(rows.students,{onConflict:'id'}));if(error)throw error}
  if(rows.occurrences.length){({error}=await supabaseClient.from('occurrences').upsert(rows.occurrences,{onConflict:'id'}));if(error)throw error}
  return rows;
}
function replaceLocalWithCloud(remote){
  // Después de una sincronización exitosa, Supabase es la fuente principal de verdad.
  // Se reconstruye la copia local desde la nube para que celular y laptop converjan al mismo estado.
  const cm=ensureCloudMap();
  cm.classrooms={};cm.students={};cm.occurrences={};
  db.classrooms=(remote.classrooms||[]).map(r=>{const x=cloudToLocal('classrooms',r);cm.classrooms[x.id]=r.id;return x});
  db.students=(remote.students||[]).map(r=>{const x=cloudToLocal('students',r);cm.students[x.id]=r.id;return x});
  db.occurrences=(remote.occurrences||[]).map(r=>{const x=cloudToLocal('occurrences',r);cm.occurrences[x.id]=r.id;return x});
}
async function syncNow(){
  if(!cloudUser)return alert('Primero inicia sesión.');
  if(!navigator.onLine){updateSyncUi();return alert('No hay conexión a internet. Tus cambios siguen guardados en este dispositivo.');}
  const btn=$('syncNowBtn'),old=btn.textContent;btn.disabled=true;btn.textContent='Sincronizando…';
  try{
    await refreshCurrentClassroomAccess();
    // 1) Elimina en la nube lo que fue eliminado localmente.
    await applyPendingDeletes();

    // 2) Lee la nube antes de subir cambios. Si existe una versión remota más reciente,
    //    esa versión prevalece para evitar que una copia antigua de otro equipo la sobrescriba.
    let remote=await fetchCloudRows();
    let localDupes=collapseLocalStudentDuplicates();

    // 3) Sube SOLO cambios locales pendientes, nunca toda la copia del dispositivo.
    await uploadDirtyLocal(remote);

    // 4) Descarga de nuevo la nube y la convierte en la única copia visible del dispositivo.
    //    Así laptop y celular muestran exactamente lo mismo después de sincronizar.
    remote=await fetchCloudRows();
    replaceLocalWithCloud(remote);
    localDupes+=collapseLocalStudentDuplicates();
    db.profile=db.profile||{};
    db.profile.cloudUserId=cloudUser.id;
    db.profile.email=cloudUser.email||null;
    db.profile.mode='authenticated';

    db.classrooms.forEach(x=>x.syncState='synced');
    db.students.forEach(x=>x.syncState='synced');
    db.occurrences.forEach(x=>x.syncState='synced');
    db.meta.lastSyncAt=nowISO();
    db.meta.cloudMigratedAt=db.meta.cloudMigratedAt||db.meta.lastSyncAt;
    localStorage.setItem(DBKEY,JSON.stringify(db));
    refreshAll();updateSyncUi();
    toast(`Sincronización completada · ${db.students.length} estudiante(s)${localDupes?' · duplicados locales corregidos':''}`);
  }catch(e){
    updateSyncUi();
    alert('No se pudo completar la sincronización. Tus datos locales siguen guardados.\n\nDetalle: '+(e.message||e));
  }finally{btn.disabled=false;btn.textContent=old}
}
window.addEventListener('online',()=>{updateSyncUi();toast('Conexión recuperada')});
window.addEventListener('offline',()=>{updateSyncUi();toast('Sin conexión · trabajando en local')});

async function createAccount(){
  clearAuthMessage();
  const name=$('signupName').value.trim(),email=$('signupEmail').value.trim().toLowerCase(),p1=$('signupPassword').value,p2=$('signupPassword2').value;
  if(!name||!email||!p1)return showAuthMessage('Completa nombre, correo y contraseña.','err');
  if(p1.length<6)return showAuthMessage('La contraseña debe tener al menos 6 caracteres.','err');
  if(p1!==p2)return showAuthMessage('Las contraseñas no coinciden.','err');
  const {data,error}=await supabaseClient.auth.signUp({email,password:p1,options:{data:{display_name:name},emailRedirectTo:APP_PUBLIC_URL}});
  if(error)return showAuthMessage(error.message,'err');
  if(data.session){cloudUser=data.user;setAuthGate(false);updateAccountUi();await ensureProfileIdentity(true);await loadAccessContext();toast('Cuenta creada e iniciada');}
  else showAuthMessage('Cuenta creada. Revisa tu correo y pulsa el enlace de confirmación. Después vuelve a la app e inicia sesión.');
}
async function loginAccount(){
  clearAuthMessage();
  const email=$('loginEmail').value.trim().toLowerCase(),password=$('loginPassword').value;
  if(!email||!password)return showAuthMessage('Escribe tu correo y contraseña.','err');
  const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error){
    const msg=String(error.message||error);
    if(/invalid login credentials/i.test(msg))return showAuthMessage('Correo o contraseña incorrectos. Verifica los datos e inténtalo nuevamente.','err');
    if(/email not confirmed/i.test(msg))return showAuthMessage('Este correo todavía no está confirmado en Supabase. Comunícalo al administrador para habilitar la cuenta.','err');
    return showAuthMessage(msg,'err');
  }
  cloudUser=data.user;localBypass=false;setAuthGate(false);updateAccountUi();await ensureProfileIdentity(true);await loadAccessContext();refreshAll();go(defaultViewForActiveRole());toast('Sesión iniciada');
}
async function logoutAccount(){
  if(!confirm('¿Cerrar sesión en este dispositivo? Tus datos locales no se borrarán.'))return;
  await supabaseClient.auth.signOut();cloudUser=null;accessContext={role:null,institutionId:null,institution:null,membership:null};updateAccountUi();setAuthGate(true);showAuthTab('login');showAuthMessage('Sesión cerrada. Tus datos locales siguen guardados.');
}
async function requestPasswordReset(){
  clearAuthMessage();
  const email=$('loginEmail').value.trim();
  if(!email)return showAuthMessage('Escribe primero tu correo electrónico.','err');
  const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:APP_PUBLIC_URL});
  if(error)return showAuthMessage(error.message,'err');
  showAuthMessage('Te enviamos un enlace para cambiar tu contraseña. Revisa también la carpeta de spam.');
}
async function saveNewPassword(){
  const p1=$('newPassword').value,p2=$('newPassword2').value;
  if(p1.length<6)return alert('La contraseña debe tener al menos 6 caracteres.');
  if(p1!==p2)return alert('Las contraseñas no coinciden.');
  const {error}=await supabaseClient.auth.updateUser({password:p1});
  if(error)return alert(error.message);
  $('passwordDialog').close();toast('Contraseña actualizada');
}
function continueLocalMode(){localBypass=true;setAuthGate(false);updateAccountUi();refreshAll();toast('Modo local activo');}
async function initAuth(){
  const {data:sessionData,error:sessionError}=await supabaseClient.auth.getSession();
  cloudUser=sessionData?.session?.user||null;
  if(cloudUser){
    const {data:userData,error:userError}=await supabaseClient.auth.getUser();
    if(userError||!userData?.user){cloudUser=null;}
    else cloudUser=userData.user;
  }
  updateAccountUi();
  if(cloudUser){setAuthGate(false);await ensureProfileIdentity(true);await loadAccessContext();go(defaultViewForActiveRole())}else if(!localBypass){setAuthGate(true)}
  supabaseClient.auth.onAuthStateChange((event,session)=>{
    cloudUser=session?.user||null;updateAccountUi();
    if(event==='PASSWORD_RECOVERY'){$('passwordDialog').showModal();setAuthGate(false)}
    else if(event==='SIGNED_IN'){setAuthGate(false);setTimeout(async()=>{await ensureProfileIdentity(true);await loadAccessContext();go(defaultViewForActiveRole())},0)}
    else if(event==='SIGNED_OUT'){accessContext={role:null,institutionId:null,institution:null,membership:null};updateRoleUi();if(!localBypass)setAuthGate(true)}
  });
}

function escAttr(v){return esc(v).replace(/"/g,'&quot;')}
async function loadAdminPanel(){
  if(!hasRole('admin_general')||!cloudUser)return;
  const usersBox=$('adminUsers'),instBox=$('adminInstitutions'),summary=$('adminSummary');
  if(usersBox)usersBox.innerHTML='<div class="muted small">Consultando usuarios…</div>';
  try{
    const [iRes,pRes,mRes]=await Promise.all([
      supabaseClient.from('institutions').select('*').order('name'),
      supabaseClient.from('profiles').select('id,display_name,email,created_at').order('created_at'),
      supabaseClient.from('user_memberships').select('id,user_id,role,institution_id,active,valid_from,valid_until,assigned_by,institutions(id,name,modular_code)').order('created_at',{ascending:false})
    ]);
    for(const r of [iRes,pRes,mRes])if(r.error)throw r.error;
    adminCache={institutions:iRes.data||[],profiles:pRes.data||[],memberships:mRes.data||[]};
    const classInst=$('adminClassInstitution');
    if(classInst){const prev=classInst.value;classInst.innerHTML='<option value="">Seleccionar institución…</option>'+adminCache.institutions.filter(i=>i.active!==false).map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('');if([...classInst.options].some(o=>o.value===prev))classInst.value=prev;}
    if(instBox)instBox.innerHTML=adminCache.institutions.length?adminCache.institutions.map(i=>`<div class="institution-admin-item"><b>${esc(i.name)}</b><div class="muted small">CM ${esc(i.modular_code||'—')} · ${esc(i.ugel||'—')} · ${esc(i.educational_level||'—')} · ${i.active===false?'Inactiva':'Activa'}</div><div class="actions"><button class="btn secondary" type="button" onclick="openInstitutionEdit('${i.id}')">Editar institución</button></div></div>`).join(''):'No hay instituciones registradas.';
    const active=adminCache.memberships.filter(m=>m.active&&(!m.valid_until||Date.parse(m.valid_until)>Date.now()));
    if(summary)summary.innerHTML=`<div><b>${adminCache.institutions.length}</b> instituciones</div><div style="margin-top:6px"><b>${adminCache.profiles.length}</b> usuarios registrados</div><div style="margin-top:6px"><b>${active.filter(m=>m.role==='director').length}</b> directores activos</div><div style="margin-top:6px"><b>${active.filter(m=>m.role==='docente').length}</b> docentes asignados</div><div style="margin-top:6px"><b>${active.filter(m=>m.role==='auxiliar').length}</b> auxiliares asignados</div>`;
    renderAdminUsers();
    if($('adminClassInstitution')?.value)await loadAdminClassrooms();
  }catch(e){if(usersBox)usersBox.innerHTML=`<div style="color:#9d1d1d">No se pudo cargar la administración: ${esc(e.message||e)}</div>`;}
}
function activeMembershipsFor(userId){return adminCache.memberships.filter(m=>m.user_id===userId&&m.active&&(!m.valid_until||Date.parse(m.valid_until)>Date.now()))}
function setAdminUserGroup(group){
  adminUserGroup=group==='assigned'?'assigned':'pending';
  renderAdminUsers();
}
function renderAdminUsers(){
  const box=$('adminUsers');if(!box)return;
  const activeNow=m=>m.active&&(!m.valid_until||Date.parse(m.valid_until)>Date.now());
  const active=adminCache.memberships.filter(activeNow);
  const assignedIds=new Set(active.map(m=>m.user_id));
  const pending=adminCache.profiles.filter(p=>!assignedIds.has(p.id));
  const assigned=adminCache.profiles.filter(p=>assignedIds.has(p.id));
  const pTab=$('adminPendingTab'),aTab=$('adminAssignedTab');
  if(pTab){pTab.textContent=`Por asignar (${pending.length})`;pTab.classList.toggle('active',adminUserGroup==='pending')}
  if(aTab){aTab.textContent=`Asignados (${assigned.length})`;aTab.classList.toggle('active',adminUserGroup==='assigned')}
  const instFilter=$('adminInstitutionFilter'),instWrap=$('adminInstitutionFilterWrap');
  if(instWrap)instWrap.style.display=adminUserGroup==='assigned'?'block':'none';
  if(instFilter){
    const prev=instFilter.value;
    instFilter.innerHTML='<option value="">Todas</option>'+adminCache.institutions.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('');
    if([...instFilter.options].some(o=>o.value===prev))instFilter.value=prev;
  }
  const q=(($('adminUserSearch')?.value)||'').trim().toLowerCase();
  const instSelected=adminUserGroup==='assigned'?(instFilter?.value||''):'';
  let list=(adminUserGroup==='assigned'?assigned:pending).filter(p=>{
    const text=`${p.display_name||''} ${p.email||''}`.toLowerCase();
    if(q&&!text.includes(q))return false;
    if(instSelected){
      const ms=activeMembershipsFor(p.id);
      if(!ms.some(m=>m.institution_id===instSelected))return false;
    }
    return true;
  });
  const instOpts=adminCache.institutions.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('');
  const groupLabel=adminUserGroup==='assigned'?'Asignados':'Por asignar';
  const groupHint=adminUserGroup==='assigned'?'Usuarios que ya tienen al menos una asignación activa.':'Cuentas registradas que todavía no tienen una asignación activa.';
  const head=`<div class="admin-group-title"><div><b>${groupLabel}</b><div class="small muted">${groupHint}</div></div><span class="pill">${list.length}</span></div>`;
  if(!list.length){box.innerHTML=head+`<div class="empty">${q||instSelected?'No hay usuarios que coincidan con el filtro.':adminUserGroup==='assigned'?'Todavía no hay usuarios asignados.':'No hay usuarios pendientes de asignación.'}</div>`;return;}
  box.innerHTML=head+list.map(p=>{
    const ms=activeMembershipsFor(p.id);const isSelf=p.id===cloudUser.id;
    const membershipsHtml=ms.length?ms.map(m=>`<div class="role-line"><span class="pill">${esc(roleLabel(m.role))}</span>${m?.institutions?.name?`<span class="pill">${esc(m.institutions.name)}</span>`:''}${['docente','auxiliar'].includes(m.role)&&m.institution_id?`<button class="btn secondary" style="padding:6px 10px;min-height:auto" type="button" onclick="openClassroomAccessManager('${p.id}','${m.institution_id}','${escAttr(p.display_name||p.email||'Usuario')}','${m.role}')">Asignar salones</button>`:''}${m.role==='admin_general'?`<span class="small muted">Rol protegido</span>`:`<button class="btn danger" style="padding:6px 10px;min-height:auto" type="button" onclick="deactivateMembership('${m.id}')">Desactivar</button>`}</div>`).join(''):'<div class="role-line"><span class="pill">Sin asignar</span></div>';
    const assignForm=`<div class="row" style="margin-top:10px"><div><label>Agregar rol</label><select id="role_${p.id}"><option value="">Seleccionar…</option><option value="docente">Docente</option><option value="auxiliar">Auxiliar de educación</option><option value="director">Director</option><option value="especialista_ugel">Especialista UGEL</option></select></div><div><label>Institución</label><select id="inst_${p.id}"><option value="">Seleccionar…</option>${instOpts}</select></div></div><div class="actions assign-actions"><button class="btn primary" type="button" onclick="assignUserRole('${p.id}')">${adminUserGroup==='assigned'?'Agregar otra asignación':'Asignar usuario'}</button></div>`;
    return `<div class="admin-user"><strong>${esc(p.display_name||'Perfil pendiente')}</strong><div class="small muted">${esc(p.email||'Sin correo visible')}</div>${membershipsHtml}${isSelf&&ms.some(m=>m.role==='admin_general')?'<div class="footer-note">Tu rol de Administrador general está protegido. Puedes agregar además un rol Docente o Auxiliar para registrar información de una institución.</div>':''}${assignForm}</div>`;
  }).join('');
}


function gradeOptionsForLevel(level,selected=''){
  const max=level==='Primaria'?6:5;
  return Array.from({length:max},(_,i)=>{const v=`${i+1}.°`;return `<option value="${v}" ${v===selected?'selected':''}>${v}</option>`}).join('');
}
function renderAdminClassroomFields(){
  const level=$('adminClassLevel')?.value||'Primaria';
  const initial=level==='Inicial';
  if($('adminInitialClassFields'))$('adminInitialClassFields').style.display=initial?'block':'none';
  if($('adminRegularClassFields'))$('adminRegularClassFields').style.display=initial?'none':'block';
  if(!initial&&$('adminClassGrade'))$('adminClassGrade').innerHTML=gradeOptionsForLevel(level,$('adminClassGrade').value);
  if($('adminClassGradeLabel'))$('adminClassGradeLabel').textContent=level==='Secundaria'?'Año':'Grado';
}
function renderAdminEditClassroomFields(){
  const level=$('adminEditClassLevel')?.value||'Primaria';
  const initial=level==='Inicial';
  if($('adminEditInitialFields'))$('adminEditInitialFields').style.display=initial?'block':'none';
  if($('adminEditRegularFields'))$('adminEditRegularFields').style.display=initial?'none':'block';
  if(!initial&&$('adminEditClassGrade'))$('adminEditClassGrade').innerHTML=gradeOptionsForLevel(level,$('adminEditClassGrade').dataset.selected||$('adminEditClassGrade').value);
  if($('adminEditClassGradeLabel'))$('adminEditClassGradeLabel').textContent=level==='Secundaria'?'Año':'Grado';
}
async function onAdminClassInstitutionChange(){
  const id=$('adminClassInstitution')?.value||'';
  const inst=adminCache.institutions.find(i=>i.id===id);
  if(inst&&['Inicial','Primaria','Secundaria'].includes(inst.educational_level))$('adminClassLevel').value=inst.educational_level;
  renderAdminClassroomFields();
  await loadAdminClassrooms();
}
async function loadAdminClassrooms(){
  if(!hasRole('admin_general'))return;
  const instId=$('adminClassInstitution')?.value||'';const box=$('adminClassroomList');
  adminClassroomState={institutionId:instId,classrooms:[]};
  if(!instId){if(box)box.innerHTML='<div class="muted small">Selecciona una institución para ver sus salones.</div>';return;}
  if(box)box.innerHTML='<div class="muted small">Consultando salones…</div>';
  try{
    const {data,error}=await supabaseClient.from('classrooms').select('id,user_id,institution_id,level,grade,section,name,created_at,updated_at').eq('institution_id',instId).order('level').order('grade').order('section').order('name');
    if(error)throw error;adminClassroomState.classrooms=data||[];renderAdminClassroomList();
  }catch(e){if(box)box.innerHTML=`<div style="color:#9d1d1d">No se pudieron cargar los salones. Ejecuta primero el SQL de la versión 2.2.20.<br><br>${esc(e.message||e)}</div>`;}
}
function renderAdminClassroomList(){
  const box=$('adminClassroomList');if(!box)return;const rows=adminClassroomState.classrooms||[];
  if(!rows.length){box.innerHTML='<div class="empty">Esta institución todavía no tiene salones oficiales.</div>';return;}
  const groups={};rows.forEach(c=>{const k=c.level||'Sin nivel';(groups[k]=groups[k]||[]).push(c)});
  box.innerHTML=Object.entries(groups).map(([level,list])=>`<div style="margin-top:12px"><b>${esc(level)}</b><div class="summary-list" style="margin-top:8px">${list.map(c=>`<div class="summary-item"><div class="split-head"><div><h4>${esc(c.name||[c.grade,c.section].filter(Boolean).join(' ')||'Salón')}</h4><div class="summary-meta">${esc(c.grade||'')}${c.section?' · Sección '+esc(c.section):''}</div></div><button class="btn secondary" type="button" onclick="openAdminClassroomEdit('${c.id}')">Editar</button><button class="btn danger" type="button" onclick="openAdminClassroomReset('${c.id}')">Reiniciar prueba</button></div></div>`).join('')}</div></div>`).join('');
}
function adminClassroomPayload(prefix='create'){
  const edit=prefix==='edit';
  const level=$(edit?'adminEditClassLevel':'adminClassLevel').value;
  if(level==='Inicial'){
    const grade=$(edit?'adminEditClassAge':'adminClassAge').value;
    const section=$(edit?'adminEditInitialSection':'adminInitialSection').value.trim().toUpperCase().replace(/\s+/g,' ');
    const name=$(edit?'adminEditClassName':'adminClassName').value.trim().replace(/\s+/g,' ');
    if(!name)throw new Error('Escribe el nombre del aula de Inicial.');
    return {level,grade,section,name};
  }
  const grade=$(edit?'adminEditClassGrade':'adminClassGrade').value;
  const section=$(edit?'adminEditClassSection':'adminClassSection').value.trim().toUpperCase().replace(/\s+/g,' ');
  if(!section)throw new Error('Escribe la sección.');
  return {level,grade,section,name:`${grade} ${section}`};
}
function adminClassroomDuplicate(payload,ignoreId=''){
  return (adminClassroomState.classrooms||[]).some(c=>{
    if(c.id===ignoreId)return false;
    if((c.level||'')!==payload.level)return false;
    if(payload.level==='Inicial')return (c.grade||'').toLowerCase()===payload.grade.toLowerCase()&&(c.name||'').trim().toLowerCase()===payload.name.trim().toLowerCase()&&(c.section||'').trim().toLowerCase()===payload.section.trim().toLowerCase();
    return (c.grade||'').toLowerCase()===payload.grade.toLowerCase()&&(c.section||'').trim().toLowerCase()===payload.section.trim().toLowerCase();
  });
}
async function createAdminClassroom(){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  const institutionId=$('adminClassInstitution')?.value||'';if(!institutionId)return alert('Selecciona primero la institución.');
  let payload;try{payload=adminClassroomPayload('create')}catch(e){return alert(e.message)}
  if(adminClassroomDuplicate(payload))return alert(payload.level==='Inicial'?'Ya existe un aula con esa edad, sección y nombre en esta institución.':'Ya existe ese grado/año y sección en esta institución.');
  try{
    const now=nowISO();const classroomId=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():uuidv4();const {error}=await supabaseClient.from('classrooms').insert({id:classroomId,user_id:cloudUser.id,institution_id:institutionId,...payload,created_at:now,updated_at:now});if(error)throw error;
    if($('adminClassName'))$('adminClassName').value='';if($('adminInitialSection'))$('adminInitialSection').value='';if($('adminClassSection'))$('adminClassSection').value='';toast('Salón oficial creado');await loadAdminClassrooms();
  }catch(e){alert('No se pudo crear el salón.\n\n'+(e.message||e));}
}
function openAdminClassroomEdit(id){
  const c=(adminClassroomState.classrooms||[]).find(x=>x.id===id);if(!c)return;
  $('adminEditClassId').value=c.id;$('adminEditClassInstitution').value=c.institution_id||adminClassroomState.institutionId;$('adminEditClassLevel').value=c.level||'Primaria';
  $('adminEditClassAge').value=c.grade||'3 años';$('adminEditInitialSection').value=c.section||'';$('adminEditClassName').value=c.name||'';$('adminEditClassSection').value=c.section||'';$('adminEditClassGrade').dataset.selected=c.grade||'1.°';
  renderAdminEditClassroomFields();if(c.level!=='Inicial')$('adminEditClassGrade').value=c.grade||'1.°';
  $('adminClassroomEditDialog').showModal();
}
async function saveAdminClassroomEdit(){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  const id=$('adminEditClassId').value,institutionId=$('adminEditClassInstitution').value;if(!id||!institutionId)return;
  let payload;try{payload=adminClassroomPayload('edit')}catch(e){return alert(e.message)}
  if(adminClassroomDuplicate(payload,id))return alert(payload.level==='Inicial'?'Ya existe otra aula con esa edad, sección y nombre.':'Ya existe otro salón con ese grado/año y sección.');
  try{
    const now=nowISO();let {error}=await supabaseClient.from('classrooms').update({...payload,institution_id:institutionId,updated_at:now}).eq('id',id).eq('institution_id',institutionId);if(error)throw error;
    ({error}=await supabaseClient.from('students').update({grade:payload.grade,section:payload.section,institution_id:institutionId,updated_at:now}).eq('classroom_id',id));if(error)throw error;
    ({error}=await supabaseClient.from('occurrences').update({grade:payload.grade,section:payload.section,institution_id:institutionId,updated_at:now}).eq('classroom_id',id));if(error)throw error;
    $('adminClassroomEditDialog').close();toast('Salón actualizado');await loadAdminClassrooms();
  }catch(e){alert('No se pudo actualizar el salón.\n\n'+(e.message||e));}
}

function openAdminClassroomReset(id){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  const c=(adminClassroomState.classrooms||[]).find(x=>x.id===id);if(!c)return;
  $('adminResetClassId').value=id;$('adminResetConfirm').value='';$('adminResetMode').value='keep';
  const label=c.name||[c.grade,c.section].filter(Boolean).join(' ')||'Salón';
  $('adminResetClassSummary').innerHTML=`<b>${esc(label)}</b><div class="small muted">${esc(c.level||'')} · ${esc(c.grade||'')} ${esc(c.section||'')}<br>Institución seleccionada: ${esc((adminCache.institutions.find(i=>i.id===(c.institution_id||adminClassroomState.institutionId))||{}).name||'')}</div>`;
  $('adminClassroomResetDialog').showModal();
}
async function confirmAdminClassroomReset(){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  const id=$('adminResetClassId').value,word=$('adminResetConfirm').value.trim().toUpperCase(),mode=$('adminResetMode').value;
  if(word!=='REINICIAR')return alert('Escribe REINICIAR para confirmar.');
  const deleteClassroom=mode==='delete';
  const msg=deleteClassroom?'Se eliminarán los datos de prueba y también el salón. Las cuentas de docentes y auxiliares NO se eliminarán. ¿Continuar?':'Se eliminarán estudiantes, ocurrencias y seguimientos de prueba. El salón y las cuentas de usuarios se conservarán. ¿Continuar?';
  if(!confirm(msg))return;
  try{
    const {data,error}=await supabaseClient.rpc('sage_reset_test_classroom',{p_classroom_id:id,p_delete_classroom:deleteClassroom});
    if(error)throw error;
    $('adminClassroomResetDialog').close();
    toast(deleteClassroom?'Salón de prueba eliminado':'Datos de prueba eliminados');
    await loadAdminClassrooms();
    if(typeof syncNow==='function')try{await syncNow()}catch(_e){}
  }catch(e){alert('No se pudo reiniciar el salón.\n\n'+(e.message||e));}
}

async function openClassroomAccessManager(userId,institutionId,userName,role){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  classroomAccessState={userId,institutionId,userName:userName||'Usuario',role:role||'',classrooms:[],selected:new Set(),types:new Map()};
  $('classroomAccessUser').textContent=`${classroomAccessState.userName} · ${roleLabel(role||'')} · Selecciona uno o varios salones.`;
  $('classroomAccessList').innerHTML='<div class="muted small">Cargando salones de la institución…</div>';
  $('classroomAccessDialog').showModal();
  try{
    const {data:classroomsData,error:cErr}=await supabaseClient.from('classrooms').select('id,user_id,institution_id,level,grade,section,name').eq('institution_id',institutionId).order('level').order('grade').order('section');
    if(cErr)throw cErr;
    const classrooms=classroomsData||[];
    const {data:access,error:aErr}=await supabaseClient.from('user_classroom_access').select('classroom_id,active,access_type').eq('user_id',userId).eq('active',true);
    if(aErr)throw aErr;
    classroomAccessState.classrooms=classrooms;
    classroomAccessState.selected=new Set((access||[]).map(a=>a.classroom_id));
    classroomAccessState.types=new Map((access||[]).map(a=>[a.classroom_id,a.access_type||'shared']));
    renderClassroomAccessList();
  }catch(e){$('classroomAccessList').innerHTML=`<div style="color:#9d1d1d">No se pudo cargar la asignación. Ejecuta primero el SQL de la versión 2.2.20.<br><br>${esc(e.message||e)}</div>`;}
}
function renderClassroomAccessList(){
  const box=$('classroomAccessList'); if(!box)return;
  const rows=classroomAccessState.classrooms||[];
  const canResponsible=classroomAccessState.role==='docente';
  box.innerHTML=rows.length?rows.map(c=>{const checked=classroomAccessState.selected.has(c.id)?'checked':'';const type=classroomAccessState.types.get(c.id)||'shared';const label=c.name||[c.grade,c.section].filter(Boolean).join(' ')||'Salón';return `<div class="access-row"><input type="checkbox" class="class-access-check" id="access_${c.id}" value="${c.id}" ${checked} onchange="toggleAccessType('${c.id}',this.checked)"><label for="access_${c.id}"><b>${esc(label)}</b><br><span class="small muted">${esc(c.level||'')} · ${esc(c.grade||'')} ${esc(c.section||'')}</span></label><select id="atype_${c.id}" class="access-type" ${checked?'':'disabled'}><option value="shared" ${type==='shared'?'selected':''}>Acceso compartido</option>${canResponsible?`<option value="responsible" ${type==='responsible'?'selected':''}>Docente responsable</option>`:''}</select></div>`}).join(''):'<div class="empty">No hay salones registrados todavía en esta institución.</div>';
}
function toggleAccessType(cid,checked){const el=$('atype_'+cid);if(el)el.disabled=!checked}
function setAllClassroomAccess(value){document.querySelectorAll('.class-access-check').forEach(x=>{x.checked=!!value;toggleAccessType(x.value,!!value)})}
async function saveClassroomAccess(){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  const st=classroomAccessState;if(!st.userId||!st.institutionId)return;
  const selected=[...document.querySelectorAll('.class-access-check:checked')].map(x=>({classroom_id:x.value,access_type:($('atype_'+x.value)?.value||'shared')}));
  if(st.role!=='docente'&&selected.some(x=>x.access_type==='responsible'))return alert('Solo un usuario con rol Docente puede ser asignado como docente responsable.');
  try{
    let {error}=await supabaseClient.from('user_classroom_access').delete().eq('user_id',st.userId).eq('institution_id',st.institutionId);if(error)throw error;
    const responsibleIds=selected.filter(x=>x.access_type==='responsible').map(x=>x.classroom_id);
    for(const cid of responsibleIds){
      ({error}=await supabaseClient.from('user_classroom_access').update({access_type:'shared',updated_at:nowISO()}).eq('classroom_id',cid).eq('access_type','responsible').eq('active',true));
      if(error)throw error;
    }
    if(selected.length){
      const now=nowISO();const rows=selected.map(x=>({user_id:st.userId,classroom_id:x.classroom_id,institution_id:st.institutionId,access_type:x.access_type,active:true,assigned_by:cloudUser.id,created_at:now,updated_at:now}));
      ({error}=await supabaseClient.from('user_classroom_access').insert(rows));if(error)throw error;
    }
    const nr=selected.filter(x=>x.access_type==='responsible').length;
    toast(`Acceso actualizado · ${selected.length} salón(es)${nr?` · ${nr} como responsable`:''}`);$('classroomAccessDialog').close();
  }catch(e){alert('No se pudo guardar el acceso a salones.\n\n'+(e.message||e));}
}

function openInstitutionEdit(id){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  const i=adminCache.institutions.find(x=>x.id===id);if(!i)return;
  $('editInstId').value=i.id;$('editInstName').value=i.name||'';$('editInstCode').value=i.modular_code||'';$('editInstLevel').value=i.educational_level||'Primaria';$('editInstUGEL').value=i.ugel||'';$('editInstRegion').value=i.region||'';$('editInstActive').value=i.active===false?'false':'true';
  $('institutionEditDialog').showModal();
}
async function saveInstitutionEdit(){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  const id=$('editInstId').value,name=$('editInstName').value.trim(),modular_code=$('editInstCode').value.trim(),educational_level=$('editInstLevel').value,ugel=$('editInstUGEL').value.trim(),region=$('editInstRegion').value.trim(),active=$('editInstActive').value==='true';
  if(!id||!name||!modular_code)return alert('Completa nombre y código modular.');
  const duplicated=adminCache.institutions.some(i=>i.id!==id&&(i.modular_code||'').trim()===modular_code);if(duplicated)return alert('Ya existe otra institución con ese código modular.');
  try{const {error}=await supabaseClient.from('institutions').update({name,modular_code,educational_level,ugel,region,active,updated_at:nowISO()}).eq('id',id);if(error)throw error;$('institutionEditDialog').close();toast('Institución actualizada');await loadAdminPanel();if(accessContext.memberships.some(m=>m.institution_id===id))await loadAccessContext();}
  catch(e){alert('No se pudo actualizar la institución.\n\n'+(e.message||e));}
}

async function createInstitution(){
  if(activeRole()!=='admin_general')return alert('Solo el Administrador general puede registrar instituciones.');
  const name=$('adminInstName')?.value.trim()||'', modularCode=$('adminInstCode')?.value.trim()||'', ugel=$('adminInstUGEL')?.value.trim()||'', region=$('adminInstRegion')?.value.trim()||'', educationalLevel=$('adminInstLevel')?.value||'Primaria';
  if(!name)return alert('Escribe el nombre de la institución.');
  if(!modularCode)return alert('Escribe el código modular.');
  if(adminCache.institutions.some(i=>(i.modular_code||'').trim()===modularCode))return alert('Ya existe una institución con ese código modular.');
  try{
    const {error}=await supabaseClient.from('institutions').insert({name,modular_code:modularCode,ugel,region,educational_level:educationalLevel,active:true,created_by:cloudUser.id,updated_at:new Date().toISOString()});
    if(error)throw error;
    ['adminInstName','adminInstCode','adminInstUGEL','adminInstRegion'].forEach(id=>{if($(id))$(id).value=''});
    if($('adminInstLevel'))$('adminInstLevel').value='Primaria';
    toast('Institución registrada');
    await loadAdminPanel();
  }catch(e){alert('No se pudo registrar la institución: '+(e.message||e));}
}

async function assignUserRole(userId){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  const role=$('role_'+userId)?.value||'',institutionId=$('inst_'+userId)?.value||'';
  if(!role)return alert('Selecciona un rol.');
  if(['docente','auxiliar','director'].includes(role)&&!institutionId)return alert('Selecciona la institución del usuario.');
  if(role==='especialista_ugel'&&!institutionId&&!confirm('El especialista quedará sin institución específica. ¿Continuar?'))return;
  const duplicate=activeMembershipsFor(userId).some(m=>m.role===role&&(m.institution_id||'')===(institutionId||''));
  if(duplicate)return alert('Este usuario ya tiene ese rol activo en la institución seleccionada.');
  if(!confirm(`¿Agregar el rol ${roleLabel(role)} a este usuario sin eliminar sus otros roles?`))return;
  try{
    const now=nowISO();
    const {error}=await supabaseClient.from('user_memberships').insert({user_id:userId,role,institution_id:institutionId||null,active:true,valid_from:now,assigned_by:cloudUser.id,updated_at:now});if(error)throw error;
    toast('Rol agregado correctamente');await loadAdminPanel();if(userId===cloudUser.id)await loadAccessContext();
  }catch(e){alert('No se pudo agregar el rol.\n\n'+(e.message||e));}
}
async function deactivateMembership(membershipId){
  if(!hasRole('admin_general'))return alert('Acceso no autorizado.');
  const m=adminCache.memberships.find(x=>x.id===membershipId);if(!m||m.role==='admin_general')return;
  if(!confirm(`¿Desactivar el rol ${roleLabel(m.role)}${m.institutions?.name?' de '+m.institutions.name:''}?`))return;
  const now=nowISO();const {error}=await supabaseClient.from('user_memberships').update({active:false,valid_until:now,updated_at:now}).eq('id',m.id);if(error)return alert(error.message);toast('Rol desactivado');await loadAdminPanel();if(m.user_id===cloudUser.id)await loadAccessContext();
}
async function loadDirectorDashboard(){
  if(!hasRole('director')||!accessContext.directorMembership?.institution_id)return;
  const box=$('directorOccurrences');if(box)box.innerHTML='<div class="muted small">Consultando información institucional…</div>';
  if($('directorInstitutionName'))$('directorInstitutionName').textContent=(accessContext.directorMembership?.institutions?.name||'Institución')+' · Consulta institucional en modo solo lectura.';
  try{
    const instId=accessContext.directorMembership.institution_id;
    const [pRes,cRes,sRes,oRes,mRes,aRes]=await Promise.all([
      supabaseClient.from('profiles').select('id,display_name,email'),
      supabaseClient.from('classrooms').select('*').eq('institution_id',instId).order('name'),
      supabaseClient.from('students').select('*').eq('institution_id',instId).order('name'),
      supabaseClient.from('occurrences').select('*').eq('institution_id',instId).order('occurrence_date',{ascending:false}).limit(1000),
      supabaseClient.from('user_memberships').select('user_id,role,institution_id,active').eq('institution_id',instId).eq('active',true),
      supabaseClient.from('user_classroom_access').select('user_id,classroom_id,institution_id,access_type,active').eq('institution_id',instId).eq('active',true)
    ]);
    for(const r of [pRes,cRes,sRes,oRes,mRes,aRes])if(r.error)throw r.error;
    const memberships=mRes.data||[], accesses=aRes.data||[];
    const institutionUserIds=new Set(memberships.map(m=>m.user_id));
    const recorderIds=new Set(memberships.filter(m=>['docente','auxiliar'].includes(m.role)).map(m=>m.user_id));
    const accessClassIds=new Set(accesses.map(a=>a.classroom_id));
    const classrooms=(cRes.data||[]); // Ya vienen filtrados estrictamente por institution_id.
    const classroomIds=new Set(classrooms.map(c=>c.id));
    directorCache={
      profiles:(pRes.data||[]).filter(p=>institutionUserIds.has(p.id)),
      memberships,
      accesses,
      classrooms,
      students:(sRes.data||[]).filter(st=>classroomIds.has(st.classroom_id)),
      occurrences:(oRes.data||[]).filter(o=>recorderIds.has(o.user_id)&&(!o.classroom_id||classroomIds.has(o.classroom_id)))
    };
    $('dirStatTeachers').textContent=directorCache.profiles.length;$('dirStatClassrooms').textContent=directorCache.classrooms.length;$('dirStatStudents').textContent=directorCache.students.length;$('dirStatOccurrences').textContent=directorCache.occurrences.length;
    const tf=$('dirTeacherFilter');if(tf){const old=tf.value;tf.innerHTML='<option value="">Todos</option>'+directorCache.profiles.map(p=>`<option value="${p.id}">${esc(p.display_name||p.email||'Responsable')}</option>`).join('');if([...tf.options].some(o=>o.value===old))tf.value=old;}
    const types=[...new Set(directorCache.occurrences.map(o=>o.type).filter(Boolean))].sort();const ty=$('dirTypeFilter');if(ty){const old=ty.value;ty.innerHTML='<option value="">Todos</option>'+types.map(t=>`<option>${esc(t)}</option>`).join('');if([...ty.options].some(o=>o.value===old))ty.value=old;}
    renderDirectorLevelFilter();renderDirectorGradeFilter();renderDirectorSectionFilter();renderDirectorTypeSummary();renderDirectorSubtypeFilter();renderDirectorOccurrences();
  }catch(e){if(box)box.innerHTML=`<div style="color:#9d1d1d">No se pudo consultar la información institucional: ${esc(e.message||e)}</div>`;}
}
function directorProfile(uid){return directorCache.profiles.find(p=>p.id===uid)||null;}
function directorUserRoles(uid){return [...new Set((directorCache.memberships||[]).filter(m=>m.user_id===uid&&m.active).map(m=>roleLabel(m.role)))];}
function directorUserClassrooms(uid){return (directorCache.accesses||[]).filter(a=>a.user_id===uid&&a.active).map(a=>{const c=directorCache.classrooms.find(x=>x.id===a.classroom_id);return c?{...c,access_type:a.access_type||'shared'}:null}).filter(Boolean);}
function openDirectorSummary(kind){
  const dlg=$('directorSummaryDialog'),title=$('directorSummaryTitle'),hint=$('directorSummaryHint'),box=$('directorSummaryContent');if(!dlg||!box)return;
  const classroomName=c=>c.name||[c.grade,c.section].filter(Boolean).join(' ')||'Salón';
  if(kind==='staff'){
    title.textContent='Personal registrado';hint.textContent='Usuarios asignados a esta institución · solo lectura.';
    const users=directorCache.profiles.slice().sort((a,b)=>(a.display_name||a.email||'').localeCompare(b.display_name||b.email||''));
    box.innerHTML=users.length?`<div class="summary-list">${users.map(p=>{const roles=directorUserRoles(p.id),rooms=directorUserClassrooms(p.id);return `<div class="summary-item"><h4>${esc(p.display_name||'Usuario')}</h4><div class="summary-meta">${esc(p.email||'Sin correo visible')}</div><div class="summary-tags">${roles.map(r=>`<span class="pill">${esc(r)}</span>`).join('')}</div>${rooms.length?`<div class="summary-meta" style="margin-top:8px"><b>Salones:</b> ${rooms.map(c=>`${esc(classroomName(c))} (${c.access_type==='responsible'?'responsable':'compartido'})`).join(' · ')}</div>`:'<div class="summary-meta" style="margin-top:8px">Sin salones asignados.</div>'}</div>`}).join('')}</div>`:'<div class="empty">No hay personal registrado.</div>';
  }else if(kind==='classrooms'){
    title.textContent='Salones registrados';hint.textContent='Detalle de salones, personal asignado y estudiantes.';
    const rooms=directorCache.classrooms.slice().sort((a,b)=>`${a.level||''}${a.grade||''}${a.section||''}`.localeCompare(`${b.level||''}${b.grade||''}${b.section||''}`));
    box.innerHTML=rooms.length?`<div class="summary-list">${rooms.map(c=>{const acc=(directorCache.accesses||[]).filter(a=>a.classroom_id===c.id&&a.active);const resp=acc.filter(a=>a.access_type==='responsible').map(a=>directorProfile(a.user_id)?.display_name||directorProfile(a.user_id)?.email||'Docente');const shared=acc.filter(a=>a.access_type!=='responsible').map(a=>directorProfile(a.user_id)?.display_name||directorProfile(a.user_id)?.email||'Usuario');const n=directorCache.students.filter(st=>st.classroom_id===c.id).length;return `<div class="summary-item"><h4>${esc(classroomName(c))}</h4><div class="summary-meta">${esc(c.level||'—')} · ${esc(c.grade||'—')} ${esc(c.section||'')}</div><div class="summary-meta" style="margin-top:6px"><b>Docente responsable:</b> ${resp.length?esc(resp.join(', ')):'No asignado'}</div><div class="summary-meta"><b>Accesos compartidos:</b> ${shared.length?esc(shared.join(', ')):'Ninguno'}</div><div class="summary-tags"><span class="pill">${n} estudiante(s)</span></div></div>`}).join('')}</div>`:'<div class="empty">No hay salones registrados.</div>';
  }else if(kind==='students'){
    title.textContent='Estudiantes registrados';hint.textContent='Estudiantes organizados por salón · solo lectura.';
    const rows=directorCache.students.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    box.innerHTML=rows.length?`<div class="summary-list">${rows.map(st=>{const c=directorCache.classrooms.find(x=>x.id===st.classroom_id);const occ=directorCache.occurrences.filter(o=>o.student_id===st.id||(!o.student_id&&o.student_name===st.name&&o.classroom_id===st.classroom_id)).length;return `<div class="summary-item"><h4>${esc(st.name||'Estudiante')}</h4><div class="summary-meta">${c?esc(classroomName(c)):'Sin salón'}${c?.level?' · '+esc(c.level):''}</div><div class="summary-tags"><span class="pill">${occ} ocurrencia(s)</span></div></div>`}).join('')}</div>`:'<div class="empty">No hay estudiantes registrados.</div>';
  }else{
    title.textContent='Ocurrencias registradas';hint.textContent='Usa los filtros del panel para revisar la información institucional.';
    box.innerHTML=`<div class="notice">Hay <b>${directorCache.occurrences.length}</b> ocurrencia(s) registradas. Puedes usar los filtros por nivel, grado/edad, sección, responsable, tipo, subtipo y fechas.</div><div class="actions"><button type="button" class="btn primary" onclick="document.getElementById('directorSummaryDialog').close();document.getElementById('directorOccurrencesCard').scrollIntoView({behavior:'smooth',block:'start'})">Ir al listado de ocurrencias</button></div>`;
  }
  dlg.showModal();
}
function directorClassroomForOccurrence(o){return directorCache.classrooms.find(c=>c.id===o.classroom_id)||null;}
function directorOccurrenceLevel(o){const c=directorClassroomForOccurrence(o);return (c?.level||'').trim();}
function directorOccurrenceGrade(o){const c=directorClassroomForOccurrence(o);return (c?.grade||o.grade||'').trim();}
function directorOccurrenceSection(o){const c=directorClassroomForOccurrence(o);return (c?.section||o.section||'').trim();}
function directorLevelOrder(v){return ({'Inicial':1,'Primaria':2,'Secundaria':3})[v]||99;}
function directorGradeOrder(level,v){const raw=String(v||'').toLowerCase().trim();if(level==='Inicial'){if(/0\s*a\s*2/.test(raw)||/0\s*[-–]\s*2/.test(raw))return 0;const n=parseInt(raw);return Number.isFinite(n)?n:99;}const n=parseInt(raw);return Number.isFinite(n)?n:99;}
function renderDirectorLevelFilter(){const el=$('dirLevelFilter');if(!el)return;const old=el.value;let vals=[...new Set(directorCache.classrooms.map(c=>(c.level||'').trim()).filter(Boolean))];if(accessContext.directorMembership?.institutions?.educational_level)vals.push(accessContext.directorMembership.institutions.educational_level);vals=[...new Set(vals)].sort((a,b)=>directorLevelOrder(a)-directorLevelOrder(b)||a.localeCompare(b));el.innerHTML='<option value="">Todos</option>'+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(vals.includes(old))el.value=old;}
function renderDirectorGradeFilter(){const el=$('dirGradeFilter');if(!el)return;const level=$('dirLevelFilter')?.value||'';const old=el.value;let vals=[...new Set(directorCache.classrooms.filter(c=>!level||(c.level||'')===level).map(c=>(c.grade||'').trim()).filter(Boolean))];if(level==='Inicial'){const standard=['0 a 2 años','3 años','4 años','5 años'];standard.forEach(v=>{if(directorCache.classrooms.some(c=>(c.level||'')==='Inicial'&&(c.grade||'').trim()===v)&&!vals.includes(v))vals.push(v);});}
vals.sort((a,b)=>directorGradeOrder(level,a)-directorGradeOrder(level,b)||a.localeCompare(b));el.innerHTML='<option value="">Todos</option>'+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(vals.includes(old))el.value=old;else el.value='';}
function renderDirectorSectionFilter(){const el=$('dirSectionFilter');if(!el)return;const level=$('dirLevelFilter')?.value||'',grade=$('dirGradeFilter')?.value||'',old=el.value;const vals=[...new Set(directorCache.classrooms.filter(c=>(!level||(c.level||'')===level)&&(!grade||(c.grade||'')===grade)).map(c=>(c.section||c.name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));el.innerHTML='<option value="">Todas</option>'+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(vals.includes(old))el.value=old;else el.value='';}
function directorFilteredBase(){const level=$('dirLevelFilter')?.value||'',grade=$('dirGradeFilter')?.value||'',section=$('dirSectionFilter')?.value||'',uid=$('dirTeacherFilter')?.value||'',from=$('dirFrom')?.value||'',to=$('dirTo')?.value||'';return directorCache.occurrences.filter(o=>(!level||directorOccurrenceLevel(o)===level)&&(!grade||directorOccurrenceGrade(o)===grade)&&(!section||directorOccurrenceSection(o)===section||directorClassroomForOccurrence(o)?.name===section)&&(!uid||o.user_id===uid)&&(!from||o.occurrence_date>=from)&&(!to||o.occurrence_date<=to));}
function directorFiltered(){const type=$('dirTypeFilter')?.value||'',subtype=$('dirSubtypeFilter')?.value||'';return directorFilteredBase().filter(o=>(!type||o.type===type)&&(!subtype||(o.subtype||'')===subtype));}
function renderDirectorSubtypeFilter(){const el=$('dirSubtypeFilter');if(!el)return;const type=$('dirTypeFilter')?.value||'';const vals=[...new Set(directorFilteredBase().filter(o=>!type||o.type===type).map(o=>o.subtype).filter(Boolean))].sort();const old=el.value;el.innerHTML='<option value="">Todos</option>'+vals.map(v=>`<option>${esc(v)}</option>`).join('');if(vals.includes(old))el.value=old;else el.value='';}
function renderDirectorTypeSummary(){const box=$('directorTypeSummary');if(!box)return;const counts={};directorFilteredBase().forEach(o=>{const t=o.type||'Sin tipo';counts[t]=(counts[t]||0)+1});const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));box.innerHTML=entries.length?entries.map(([t,n])=>`<button type="button" class="type-summary-card" onclick="openDirectorTypeDetail(decodeURIComponent('${encodeURIComponent(t)}'))"><strong>${n}</strong><span>${esc(t)}</span><small>Ver detalle →</small></button>`).join(''):'<div class="muted small">Todavía no hay ocurrencias registradas con estos filtros.</div>';}
let directorDrillType='';
function openDirectorTypeDetail(type){directorDrillType=type||'Sin tipo';$('directorTypeTitle').textContent=directorDrillType+' · detalle';const subs=[...new Set(directorFilteredBase().filter(o=>(o.type||'Sin tipo')===directorDrillType).map(o=>o.subtype).filter(Boolean))].sort();$('directorTypeSubtype').innerHTML='<option value="">Todos</option>'+subs.map(v=>`<option value="${escAttr(v)}">${esc(v)}</option>`).join('');$('directorTypeScope').value='classroom';renderDirectorTypeDrilldown();$('directorTypeDialog').showModal();}
function renderDirectorTypeDrilldown(){const box=$('directorTypeDrilldown');if(!box)return;const subtype=$('directorTypeSubtype')?.value||'',scope=$('directorTypeScope')?.value||'classroom';let arr=directorFilteredBase().filter(o=>(o.type||'Sin tipo')===directorDrillType&&(!subtype||(o.subtype||'')===subtype));const counts={};const labels={};arr.forEach(o=>{let key,label;if(scope==='level'){label=directorOccurrenceLevel(o)||'Sin nivel';key=label}else if(scope==='subtype'){label=o.subtype||'Sin subtipo';key=label}else{const level=directorOccurrenceLevel(o)||'Sin nivel',grade=directorOccurrenceGrade(o)||'',section=directorOccurrenceSection(o)||'',room=directorClassroomLabel(o);label=[level,grade,section].filter(Boolean).join(' · ')||room;key=(o.classroom_id||label);labels[key]=label}counts[key]=(counts[key]||0)+1;if(!labels[key])labels[key]=label});const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]||String(labels[a[0]]).localeCompare(String(labels[b[0]])));const breakdown=entries.length?`<div class="drill-grid">${entries.map(([k,n])=>`<div class="drill-card"><strong>${n}</strong><div class="small">${esc(labels[k])}</div></div>`).join('')}</div>`:'<div class="empty">No hay datos para este filtro.</div>';const occs=arr.slice().sort((a,b)=>String(b.occurrence_date||'').localeCompare(String(a.occurrence_date||''))).map(o=>`<div class="drill-occ"><div class="split-head"><div><b>${esc(o.student_name||'Estudiante')}</b><div class="small muted">${esc(directorClassroomLabel(o))} · ${esc(o.occurrence_date||'')}</div></div>${o.subtype?`<span class="subtype-badge">${esc(o.subtype)}</span>`:''}</div><div class="small">${esc((o.description||'').slice(0,120))}${(o.description||'').length>120?'…':''}</div><div class="actions"><button class="btn secondary" type="button" onclick="document.getElementById('directorTypeDialog').close();openDirectorOccurrence('${o.id}')">Ver ocurrencia</button></div></div>`).join('');box.innerHTML=`<div class="small muted"><b>${arr.length}</b> ocurrencia(s) encontradas.</div>${breakdown}<h4 style="margin:16px 0 8px">Ocurrencias</h4><div class="drill-list">${occs||'<div class="empty">Sin ocurrencias.</div>'}</div>`;}
let directorStatsMode='type';
function openDirectorStats(){directorStatsMode='type';const types=[...new Set(directorFilteredBase().map(o=>o.type||'Sin tipo'))].sort();$('statsTypePicker').innerHTML=types.map(t=>`<option value="${escAttr(t)}">${esc(t)}</option>`).join('');setDirectorStatsMode('type');$('directorStatsDialog').showModal();}
function setDirectorStatsMode(mode){directorStatsMode=mode;$('statsByTypeBtn').classList.toggle('active',mode==='type');$('statsBySubtypeBtn').classList.toggle('active',mode==='subtype');$('statsTypePickerWrap').style.display=mode==='subtype'?'block':'none';renderDirectorStats();}
function renderBarChart(rows){const box=$('directorStatsChart');if(!box)return;if(!rows.length){box.innerHTML='<div class="empty">No hay datos para graficar con estos filtros.</div>';return}const max=Math.max(...rows.map(x=>x[1]),1);box.innerHTML='<div class="chart-bars">'+rows.map(([label,val])=>`<div class="chart-row"><div class="chart-label">${esc(label)}</div><div class="chart-track"><div class="chart-fill" style="width:${Math.max(3,(val/max)*100)}%"></div></div><div class="chart-value">${val}</div></div>`).join('')+'</div>';}
function renderDirectorStats(){const base=directorFilteredBase();const counts={};if(directorStatsMode==='type'){base.forEach(o=>{const k=o.type||'Sin tipo';counts[k]=(counts[k]||0)+1})}else{const type=$('statsTypePicker')?.value||'';base.filter(o=>(o.type||'Sin tipo')===type).forEach(o=>{const k=o.subtype||'Sin subtipo';counts[k]=(counts[k]||0)+1})}renderBarChart(Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));} 
function directorTeacherName(uid){const p=directorCache.profiles.find(x=>x.id===uid);return p?.display_name||p?.email||'Responsable';}
function directorClassroomLabel(o){const c=directorCache.classrooms.find(x=>x.id===o.classroom_id);return c?(c.name||[c.grade,c.section].filter(Boolean).join(' ')||'Salón'):[o.grade,o.section].filter(Boolean).join(' ')||'Sin salón';}
function renderDirectorOccurrences(){
  renderDirectorTypeSummary();
  const box=$('directorOccurrences');if(!box)return;const arr=directorFiltered();
  box.innerHTML=arr.length?arr.map(o=>`<div class="director-item"><div class="split-head"><div><strong>${esc(o.student_name||'Estudiante')}</strong><div class="small muted">${esc(o.occurrence_date||'')} ${esc(o.occurrence_time||'')} · ${esc(directorClassroomLabel(o))}</div></div><span class="pill">${esc(o.type||'Sin tipo')}</span>${o.subtype?`<span class="subtype-badge">${esc(o.subtype)}</span>`:''}</div><div class="small muted" style="margin-top:5px">Registrado por: ${esc(directorTeacherName(o.user_id))}${o.requires_follow?' · Seguimiento: '+followStatusLabel(o.follow_status||'pending'):''}</div><p>${esc((o.description||'').slice(0,180))}${(o.description||'').length>180?'…':''}</p><div class="actions"><button type="button" class="btn secondary" onclick="openDirectorOccurrence('${o.id}')">Ver detalle completo</button></div></div>`).join(''):'<div class="card empty">No hay ocurrencias con esos filtros.</div>';
}
function openDirectorOccurrence(id){
  const o=directorCache.occurrences.find(x=>x.id===id);if(!o)return;
  const detail=$('directorOccurrenceDetail');if(!detail)return;
  detail.innerHTML=`<div class="readonly-banner">🔒 Este registro es de solo lectura. El Director puede revisarlo, pero no modificarlo.</div><div class="detail-grid"><div class="detail-box"><b>Estudiante</b><br>${esc(o.student_name||'Estudiante')}</div><div class="detail-box"><b>Nivel educativo</b><br>${esc(directorOccurrenceLevel(o)||'—')}</div><div class="detail-box"><b>Salón</b><br>${esc(directorClassroomLabel(o))}</div><div class="detail-box"><b>Fecha y hora</b><br>${esc(o.occurrence_date||'')} ${esc(o.occurrence_time||'')}</div><div class="detail-box"><b>Lugar</b><br>${esc(o.place||'—')}</div><div class="detail-box"><b>Tipo de ocurrencia</b><br>${esc(o.type||'Sin tipo')}</div><div class="detail-box"><b>Subtipo</b><br>${esc(o.subtype||'—')}</div><div class="detail-box"><b>Registrado por</b><br>${esc(directorTeacherName(o.user_id))}</div></div><div class="detail-section"><h4>Descripción de la ocurrencia</h4><div>${nl(o.description||'—')}</div></div><div class="detail-section"><h4>Intervenciones realizadas por el docente</h4>${bulletHtml(o.actions)}</div><div class="detail-section"><h4>Acuerdos y compromisos</h4>${bulletHtml(o.follow_text)}</div><div class="detail-section"><h4>Seguimiento</h4>${o.requires_follow?`<div class="detail-grid"><div class="detail-box"><b>Estado</b><br>${followStatusLabel(o.follow_status||'pending')}</div><div class="detail-box"><b>Fecha de seguimiento</b><br>${esc(o.follow_date||'—')}</div></div>${o.follow_note?`<p><b>Resultado o nota:</b><br>${nl(o.follow_note)}</p>`:''}`:'<div class="muted small">No requiere seguimiento.</div>'}</div>`;
  $('directorOccurrenceDialog').showModal();
}
function printDirectorReport(){const arr=directorFiltered();if(!arr.length)return alert('No hay registros para generar el reporte.');const inst=accessContext.directorMembership?.institutions?.name||'Institución educativa';const rows=arr.map(o=>`<tr><td>${esc(o.occurrence_date||'')}</td><td>${esc(o.student_name||'')}</td><td>${esc(directorOccurrenceLevel(o)||'')}</td><td>${esc(directorClassroomLabel(o))}</td><td>${esc(directorTeacherName(o.user_id))}</td><td>${esc(o.type||'')}</td><td>${esc(o.subtype||'')}</td><td>${esc(o.description||'')}</td></tr>`).join('');const w=window.open('','_blank');w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Reporte institucional SAGE</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#111}h1,h2{text-align:center}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:7px;vertical-align:top}@media print{button{display:none}}</style></head><body><h1>SAGE</h1><h2>${esc(inst)}</h2><p>Reporte institucional de ocurrencias · ${new Date().toLocaleDateString()}</p><table><thead><tr><th>Fecha</th><th>Estudiante</th><th>Nivel</th><th>Salón</th><th>Registrado por</th><th>Tipo</th><th>Subtipo</th><th>Descripción</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);w.document.close();setTimeout(()=>w.print(),250);}

function newId(){return (crypto&&crypto.randomUUID)?crypto.randomUUID():'id-'+Date.now()+'-'+Math.random().toString(16).slice(2)}
function nowISO(){return new Date().toISOString()}
function normalizeClassKey(level,grade,section){return [level||'',grade||'',section||''].map(x=>String(x).trim().toLowerCase()).join('|')}
function migrateDatabase(raw){
  const x=(raw&&typeof raw==='object')?raw:{};
  x.config=x.config||{}; x.students=Array.isArray(x.students)?x.students:[]; x.occurrences=Array.isArray(x.occurrences)?x.occurrences:[];
  x.meta=x.meta||{};
  x.meta.schemaVersion=SCHEMA_VERSION;
  x.meta.appVersion=APP_VERSION;
  x.meta.installId=x.meta.installId||newId();
  x.meta.createdAt=x.meta.createdAt||nowISO();
  x.meta.updatedAt=nowISO();
  x.meta.deleted=x.meta.deleted||{classrooms:[],students:[],occurrences:[]};
  x.profile=x.profile||{id:'local-'+x.meta.installId,mode:'local',email:null,displayName:x.config.teacher||''};
  x.profile.mode=x.profile.mode||'local'; x.profile.displayName=x.config.teacher||x.profile.displayName||'';
  x.classrooms=Array.isArray(x.classrooms)?x.classrooms:[];
  x.classrooms.forEach(c=>{c.id=c.id||newId();c.ownerId=c.ownerId||x.profile.id;c.level=c.level||x.config.level||'Primaria';c.grade=c.grade||'';c.section=c.section||'';c.name=c.name||[c.grade,c.section].filter(Boolean).join(' ')||'Salón';c.createdAt=c.createdAt||nowISO();c.updatedAt=c.updatedAt||c.createdAt;c.syncState=(c.syncState==='uploaded'?'synced':(c.syncState||'local'))});
  const byKey=new Map(x.classrooms.map(c=>[normalizeClassKey(c.level,c.grade,c.section),c]));
  function ensureClassroom(grade,section){
    const level=x.config.level||'Primaria'; const key=normalizeClassKey(level,grade,section);
    if(!grade&&!section) return null;
    if(!byKey.has(key)){
      const c={id:newId(),ownerId:x.profile.id,level,grade:grade||'',section:section||'',name:[grade,section].filter(Boolean).join(' '),createdAt:nowISO(),updatedAt:nowISO(),syncState:'local'};
      x.classrooms.push(c); byKey.set(key,c);
    }
    return byKey.get(key);
  }
  x.students.forEach(s=>{
    s.id=s.id||newId(); const c=ensureClassroom(s.grade||'',s.section||'');
    s.ownerId=s.ownerId||x.profile.id; s.classroomId=s.classroomId||(c?c.id:null);
    s.createdAt=s.createdAt||nowISO(); s.updatedAt=s.updatedAt||s.createdAt; s.syncState=(s.syncState==='uploaded'?'synced':(s.syncState||'local'));
  });
  x.occurrences.forEach(o=>{
    o.subtype=o.subtype||'';
    o.id=o.id||newId(); const st=x.students.find(s=>s.id===o.studentId); const c=st?x.classrooms.find(c=>c.id===st.classroomId):ensureClassroom(o.grade||'',o.section||'');
    o.ownerId=o.ownerId||x.profile.id; o.classroomId=o.classroomId||(c?c.id:null);
    o.createdAt=o.createdAt||nowISO(); o.updatedAt=o.updatedAt||o.createdAt; o.syncState=(o.syncState==='uploaded'?'synced':(o.syncState||'local'));
  });
  return x;
}
let db;
try{db=migrateDatabase(JSON.parse(localStorage.getItem(DBKEY)||'{}'))}catch(e){db=migrateDatabase({})}
function persist(){db.meta=db.meta||{};db.meta.updatedAt=nowISO();db.meta.appVersion=APP_VERSION;db.meta.schemaVersion=SCHEMA_VERSION;localStorage.setItem(DBKEY,JSON.stringify(db));refreshAll()}
// Guarda la migración inmediatamente sin borrar ni reemplazar los datos existentes.
localStorage.setItem(DBKEY,JSON.stringify(db));
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),1800)}
function go(id){if(!viewAllowed(id)){id=defaultViewForActiveRole();}document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));if(id==='historial')renderHistory();if(id==='administracion'&&activeRole()==='admin_general')loadAdminPanel();if(id==='institucion'&&activeRole()==='director')loadDirectorDashboard()}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>go(b.dataset.view));
function saveConfig(){toast('La institución y el rol se administran desde SAGE. Los salones se configuran en Mis salones.')}
let currentProfile=null;
async function ensureProfileIdentity(forcePrompt=true){
  if(!cloudUser)return null;
  let profile=null;
  try{
    const {data,error}=await supabaseClient.from('profiles').select('id,display_name,email').eq('id',cloudUser.id).maybeSingle();
    if(error)throw error;
    profile=data||null;
    let name=String(profile?.display_name||cloudUser.user_metadata?.display_name||cloudUser.user_metadata?.full_name||'').trim();
    const email=cloudUser.email||profile?.email||null;
    if(name && (!profile || profile.display_name!==name || profile.email!==email)){
      const {data:up,error:upErr}=await supabaseClient.from('profiles').upsert({id:cloudUser.id,email,display_name:name,updated_at:nowISO()},{onConflict:'id'}).select('id,display_name,email').single();
      if(upErr)throw upErr;
      profile=up;
    }
    currentProfile=profile||{id:cloudUser.id,email,display_name:name||null};
    db.profile=db.profile||{};
    if(name){db.profile.displayName=name;db.config=db.config||{};db.config.teacher=name;localStorage.setItem(DBKEY,JSON.stringify(db));}
    updateProfileSummary();
    if(!name && forcePrompt)openProfileDialog(true);
    return currentProfile;
  }catch(e){console.warn('No se pudo verificar el perfil:',e);return null;}
}
function updateProfileSummary(){
  const name=currentProfile?.display_name||db.profile?.displayName||cloudUser?.user_metadata?.display_name||'Perfil pendiente';
  const inst=activeInstitution();
  if($('profileNameHome'))$('profileNameHome').textContent=name;
  if($('profileInstitutionHome'))$('profileInstitutionHome').textContent=inst?.name||'Sin institución asignada';
  if($('profileRoleHome'))$('profileRoleHome').textContent=roleLabel(activeRole());
}
function openProfileDialog(required=false){
  if(!cloudUser)return openLoginGate();
  const d=$('profileDialog');
  $('profileDisplayName').value=currentProfile?.display_name||db.profile?.displayName||cloudUser.user_metadata?.display_name||'';
  $('profileDialogText').textContent=required?'Antes de continuar, escribe tu nombre y apellidos. Así el Administrador general podrá identificarte y asignarte la institución y el rol correctos.':'Actualiza tu nombre y apellidos. Este dato será visible para el Administrador general.';
  $('profileCancelBtn').style.display=required?'none':'';
  d.dataset.required=required?'1':'0';
  if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','open');
  setTimeout(()=>$('profileDisplayName')?.focus(),80);
}
function closeProfileDialog(){const d=$('profileDialog');if(d.dataset.required==='1')return; if(typeof d.close==='function'&&d.open)d.close();else d.removeAttribute('open')}
async function saveProfileIdentity(){
  if(!cloudUser)return;
  const name=$('profileDisplayName').value.trim().replace(/\s+/g,' ');
  if(name.length<5 || !name.includes(' '))return alert('Escribe tus nombres y apellidos completos.');
  const {data,error}=await supabaseClient.from('profiles').upsert({id:cloudUser.id,email:cloudUser.email||null,display_name:name,updated_at:nowISO()},{onConflict:'id'}).select('id,display_name,email').single();
  if(error)return alert('No se pudo guardar tu nombre. '+(error.message||error));
  currentProfile=data;db.profile=db.profile||{};db.profile.displayName=name;db.config=db.config||{};db.config.teacher=name;localStorage.setItem(DBKEY,JSON.stringify(db));
  const d=$('profileDialog');if(typeof d.close==='function'&&d.open)d.close();else d.removeAttribute('open');
  updateProfileSummary();toast('Perfil actualizado');
}

function classroomLabel(c){return c?(c.name||[c.grade,c.section].filter(Boolean).join(' ')||'Salón'):''}
function classroomOptions(includeAll=false){let rows=db.classrooms.slice().sort((a,b)=>classroomLabel(a).localeCompare(classroomLabel(b)));return (includeAll?'<option value="">Todos los salones</option>':'<option value="">Seleccionar salón...</option>')+rows.map(c=>`<option value="${c.id}">${esc(classroomLabel(c))} · ${esc(c.level||'')}</option>`).join('')}
function addClassroom(){let level=$('clLevel').value,grade=$('clGrade').value.trim(),section=$('clSection').value.trim(),name=$('clName').value.trim();if(!grade&&!section&&!name)return alert('Escribe al menos el grado, la sección o un nombre para el salón');let dup=db.classrooms.find(c=>normalizeClassKey(c.level,c.grade,c.section)===normalizeClassKey(level,grade,section));if(dup)return alert('Ya existe un salón con ese nivel, grado y sección. Puedes editarlo.');db.classrooms.push({id:newId(),ownerId:db.profile.id,institutionId:accessContext.institutionId||null,level,grade,section,name:name||[grade,section].filter(Boolean).join(' ')||'Salón',createdAt:nowISO(),updatedAt:nowISO(),syncState:'local'});$('clGrade').value='';$('clSection').value='';$('clName').value='';persist();toast('Salón creado')}
function editClassroom(id){let c=db.classrooms.find(x=>x.id===id);if(!c)return;if(c.sharedReadOnly)return alert('Este salón fue asignado por el Administrador y es de solo consulta.');$('classroomEditId').value=id;$('classroomEditLevel').value=c.level||'Primaria';$('classroomEditGrade').value=c.grade||'';$('classroomEditSection').value=c.section||'';$('classroomEditName').value=c.name||'';$('classroomEditDialog').showModal()}
function closeClassroomEdit(){$('classroomEditDialog').close()}
function saveClassroomEdit(){let c=db.classrooms.find(x=>x.id===$('classroomEditId').value);if(!c)return;let level=$('classroomEditLevel').value,grade=$('classroomEditGrade').value.trim(),section=$('classroomEditSection').value.trim(),name=$('classroomEditName').value.trim();let dup=db.classrooms.some(x=>x.id!==c.id&&normalizeClassKey(x.level,x.grade,x.section)===normalizeClassKey(level,grade,section));if(dup)return alert('Ya existe otro salón con ese nivel, grado y sección.');c.level=level;c.grade=grade;c.section=section;c.name=name||[grade,section].filter(Boolean).join(' ')||'Salón';c.updatedAt=nowISO();c.syncState='local';db.students.forEach(st=>{if(st.classroomId===c.id){st.grade=grade;st.section=section;st.updatedAt=nowISO();st.syncState='local'}});db.occurrences.forEach(o=>{if(o.classroomId===c.id){o.grade=grade;o.section=section;o.updatedAt=nowISO();o.syncState='local'}});closeClassroomEdit();persist();toast('Salón actualizado')}
function deleteClassroom(id){let c=db.classrooms.find(x=>x.id===id);if(!c)return;if(c.sharedReadOnly)return alert('No puedes eliminar un salón asignado.');let n=db.students.filter(s=>s.classroomId===id).length;if(n)return alert(`Este salón tiene ${n} estudiante(s). Mueve o elimina esos estudiantes antes de eliminar el salón.`);if(!confirm('¿Eliminar este salón?'))return;queueCloudDelete('classrooms',id);db.classrooms=db.classrooms.filter(x=>x.id!==id);persist();toast('Salón eliminado')}
function openClassroom(id){go('estudiantes');$('studentClassFilter').value=id;renderStudents();$('stClassroom').value=id;applyClassroomToStudentForm()}
function applyClassroomToStudentForm(){let c=db.classrooms.find(x=>x.id===$('stClassroom').value);if(c){$('stGrade').value=c.grade||'';$('stSection').value=c.section||''}}
function applyClassroomToBulkForm(){let c=db.classrooms.find(x=>x.id===$('bulkClassroom').value);if(c){$('bulkGrade').value=c.grade||'';$('bulkSection').value=c.section||''}}
function applyClassroomToStudentEdit(){let c=db.classrooms.find(x=>x.id===$('studentEditClassroom').value);if(c){$('studentEditGrade').value=c.grade||'';$('studentEditSection').value=c.section||''}}
function renderClassrooms(){let rows=db.classrooms.slice().sort((a,b)=>classroomLabel(a).localeCompare(classroomLabel(b)));$('classroomList').innerHTML=rows.length?`<div class="classroom-grid">${rows.map(c=>{let ns=db.students.filter(st=>st.classroomId===c.id).length,no=db.occurrences.filter(o=>o.classroomId===c.id).length;const shared=!!c.sharedReadOnly,responsible=!!c.responsibleManaged;return `<div class="classroom-card"><h3>🏫 ${esc(classroomLabel(c))}${responsible?'<span class="responsible-badge">Responsable</span>':(shared?'<span class="shared-badge">Asignado</span>':'')}</h3><div class="classroom-meta">${esc(c.level||'')} · ${esc(c.grade||'')} ${esc(c.section||'')}</div><div class="classroom-counts"><span class="classroom-count">👥 ${ns} estudiantes</span><span class="classroom-count">🗂️ ${no} ocurrencias propias</span></div><div class="actions"><button class="btn primary" onclick="openClassroom('${c.id}')">Ver estudiantes</button>${shared?'':`<button class="btn secondary" onclick="editClassroom('${c.id}')">Editar</button><button class="btn danger" onclick="deleteClassroom('${c.id}')">Eliminar</button>`}</div></div>`}).join('')}</div>`:'<div class="empty">Todavía no hay salones. Crea el primero arriba o pide al Administrador que te asigne uno.</div>'}
function renderStudents(){let cid=$('studentClassFilter')?$('studentClassFilter').value:'';let arr=db.students.filter(st=>!cid||st.classroomId===cid).slice().sort((a,b)=>a.name.localeCompare(b.name));$('studentList').innerHTML=arr.length?`<div style="overflow:auto"><table><thead><tr><th>Nombre</th><th>Salón</th><th></th></tr></thead><tbody>${arr.map(st=>{let c=db.classrooms.find(x=>x.id===st.classroomId);const shared=!!(st.sharedReadOnly||c?.sharedReadOnly),responsible=!!(st.responsibleManaged||c?.responsibleManaged),readonly=shared&&!responsible;return `<tr><td><b>${esc(st.name)}</b>${responsible?'<span class="responsible-badge">Responsable</span>':(shared?'<span class="shared-badge">Compartido</span>':'')}<div class="small muted">${db.occurrences.filter(o=>o.studentId===st.id).length} ocurrencia(s) registradas por ti</div></td><td>${esc(c?classroomLabel(c):([st.grade,st.section].filter(Boolean).join(' ')||'Sin salón'))}</td><td>${readonly?'<span class="small muted">Solo consulta</span>':`<div class="actions" style="margin:0"><button type="button" class="btn secondary" onclick="editStudent('${st.id}')">Editar</button><button type="button" class="btn danger" onclick="delStudent('${st.id}')">Eliminar</button></div>`}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No hay estudiantes en este salón.</div>'}
function studentsForClassroom(cid){return db.students.filter(s=>!cid||s.classroomId===cid).slice().sort((a,b)=>a.name.localeCompare(b.name))}
function renderOccurrenceStudents(){let cid=$('ocClassroom').value;let arr=studentsForClassroom(cid);let current=$('ocStudent').value;$('ocStudent').innerHTML='<option value="">Seleccionar...</option>'+arr.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');if(arr.some(s=>s.id===current))$('ocStudent').value=current;$('ocStudentMulti').innerHTML=arr.length?arr.map(s=>`<div class="student-check"><input type="checkbox" id="multi-${s.id}" value="${s.id}" onchange="updateMultiCount()"><label for="multi-${s.id}"><b>${esc(s.name)}</b><br><span class="small muted">${esc(s.grade||'')} ${esc(s.section||'')}</span></label></div>`).join(''):'<div class="empty">No hay estudiantes en este salón.</div>';updateMultiCount()}
function renderFilterStudentOptions(){let cid=$('filterClassroom').value;let cur=$('filterStudent').value;let arr=studentsForClassroom(cid);$('filterStudent').innerHTML='<option value="">Todos</option>'+arr.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');if(arr.some(s=>s.id===cur))$('filterStudent').value=cur}
function renderReportStudentOptions(){let cid=$('repClassroom').value;let cur=$('repStudent').value;let arr=studentsForClassroom(cid);$('repStudent').innerHTML='<option value="">Todos</option>'+arr.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');if(arr.some(s=>s.id===cur))$('repStudent').value=cur}
function ensureLocalClassroom(grade,section){
  db.classrooms=Array.isArray(db.classrooms)?db.classrooms:[];
  const level=(db.config&&db.config.level)||'Primaria';
  const key=normalizeClassKey(level,grade,section);
  let c=db.classrooms.find(x=>normalizeClassKey(x.level,x.grade,x.section)===key);
  if(!c&&(grade||section)){c={id:newId(),ownerId:db.profile.id,level,grade:grade||'',section:section||'',name:[grade,section].filter(Boolean).join(' '),createdAt:nowISO(),updatedAt:nowISO(),syncState:'local'};db.classrooms.push(c)}
  return c||null;
}
function addStudent(again){let selectedCheck=db.classrooms.find(c=>c.id===$('stClassroom').value);if(selectedCheck&&!canManageClassroomStudents(selectedCheck))return alert('La lista de este salón es compartida. Solicita al docente responsable que actualice los estudiantes.');let name=$('stName').value.trim(),grade=$('stGrade').value.trim(),section=$('stSection').value.trim();if(!name)return alert('Escribe el nombre del estudiante');let selected=db.classrooms.find(c=>c.id===$('stClassroom').value);let c=selected||ensureLocalClassroom(grade,section);if(selected){grade=selected.grade||grade;section=selected.section||section}let dup=db.students.some(s=>s.name.toLowerCase()===name.toLowerCase()&&s.classroomId===(c?c.id:null));if(dup&&!confirm('Ya existe un estudiante con el mismo nombre en este salón. ¿Agregar de todos modos?'))return;db.students.push({id:newId(),ownerId:db.profile.id,institutionId:accessContext.institutionId||null,cloudOwnerId:(c?.responsibleManaged?c.cloudOwnerId:null),responsibleManaged:!!c?.responsibleManaged,sharedReadOnly:false,classroomId:c?c.id:null,name,grade,section,createdAt:nowISO(),updatedAt:nowISO(),syncState:'local'});persist();toast('Estudiante guardado');$('stName').value='';if(!again&&!selected){$('stGrade').value='';$('stSection').value=''}$('stName').focus()}
function delStudent(id){let st=db.students.find(x=>x.id===id);if(st?.sharedReadOnly&&!st.responsibleManaged)return alert('Este estudiante pertenece a un salón compartido y no puede modificarse desde tu cuenta.');if(!confirm('¿Eliminar estudiante? Sus ocurrencias conservarán el nombre registrado.'))return;queueCloudDelete('students',id);db.students=db.students.filter(s=>s.id!==id);persist();toast('Estudiante eliminado')}
function editStudent(id){let s=db.students.find(x=>x.id===id);if(!s)return alert('No se encontró al estudiante');if(s.sharedReadOnly&&!s.responsibleManaged)return alert('Este estudiante pertenece a un salón compartido y es de solo consulta.');$('studentEditId').value=id;$('studentEditClassroom').innerHTML=classroomOptions(false);$('studentEditClassroom').value=s.classroomId||'';$('studentEditName').value=s.name||'';$('studentEditGrade').value=s.grade||'';$('studentEditSection').value=s.section||'';let d=$('studentEditDialog');if(typeof d.showModal==='function'){d.showModal()}else{d.setAttribute('open','open')}}
function closeStudentEdit(){let d=$('studentEditDialog');if(typeof d.close==='function'&&d.open)d.close();else d.removeAttribute('open')}
function saveStudentEdit(){let id=$('studentEditId').value;let s=db.students.find(x=>x.id===id);if(!s)return alert('No se encontró al estudiante');let name=$('studentEditName').value.trim();let selected=db.classrooms.find(c=>c.id===$('studentEditClassroom').value);if(selected&&!canManageClassroomStudents(selected))return alert('No puedes mover el estudiante a un salón de solo consulta.');let grade=$('studentEditGrade').value.trim(),section=$('studentEditSection').value.trim();if(selected){grade=selected.grade||grade;section=selected.section||section}if(!name)return alert('El nombre no puede quedar vacío');let c=selected||ensureLocalClassroom(grade,section);let dup=db.students.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase()&&x.classroomId===(c?c.id:null));if(dup&&!confirm('Ya existe otro estudiante con el mismo nombre en este salón. ¿Guardar de todos modos?'))return;s.name=name;s.grade=grade;s.section=section;s.classroomId=c?c.id:null;s.updatedAt=nowISO();s.syncState='local';db.occurrences.forEach(o=>{if(o.studentId===id){o.studentName=name;o.grade=grade;o.section=section;o.classroomId=s.classroomId;o.updatedAt=nowISO();o.syncState='local'}});closeStudentEdit();persist();toast('Estudiante actualizado')}
function importPasted(){let selectedCheck=db.classrooms.find(c=>c.id===$('bulkClassroom').value);if(selectedCheck&&!canManageClassroomStudents(selectedCheck))return alert('La lista de este salón es compartida y no debe volver a importarse.');let names=$('pasteNames').value.split(/\n+/).map(x=>x.trim()).filter(Boolean),grade=$('bulkGrade').value.trim(),section=$('bulkSection').value.trim();if(!names.length)return alert('Pega uno o más nombres');let selected=db.classrooms.find(c=>c.id===$('bulkClassroom').value);let c=selected||ensureLocalClassroom(grade,section);if(selected){grade=selected.grade||grade;section=selected.section||section}names.forEach(name=>db.students.push({id:newId(),ownerId:db.profile.id,institutionId:accessContext.institutionId||null,cloudOwnerId:(c?.responsibleManaged?c.cloudOwnerId:null),responsibleManaged:!!c?.responsibleManaged,sharedReadOnly:false,classroomId:c?c.id:null,name,grade,section,createdAt:nowISO(),updatedAt:nowISO(),syncState:'local'}));$('pasteNames').value='';persist();toast('Lista agregada')}
function normalizeHeaderText(v){
  return String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function findStudentNameColumn(headers){
  const normalized=headers.map(normalizeHeaderText);
  const exact=['apellidos y nombres','nombres y apellidos','nombre del estudiante','nombres del estudiante','estudiante','nombre','nombres'];
  for(const target of exact){const i=normalized.indexOf(target);if(i>=0)return i}
  let i=normalized.findIndex(h=>h.includes('apellido')&&h.includes('nombre'));if(i>=0)return i;
  i=normalized.findIndex(h=>h.includes('estudiante'));if(i>=0)return i;
  i=normalized.findIndex(h=>h.includes('nombre'));return i;
}
async function importStudentFile(){const selectedCheck=db.classrooms.find(c=>c.id===$('bulkClassroom').value);if(selectedCheck&&!canManageClassroomStudents(selectedCheck))return alert('La lista de este salón es compartida y no debe volver a importarse.');
  const input=$('studentFile');
  const f=input&&input.files&&input.files[0];
  if(!f)return alert('Selecciona un archivo Excel (.xlsx) o CSV (.csv).');
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(!['xlsx','csv'].includes(ext))return alert('Formato no admitido. Usa un archivo Excel (.xlsx) o CSV (.csv).');
  const chosen=db.classrooms.find(c=>c.id===$('bulkClassroom').value);
  if(!chosen)return alert('Primero selecciona el salón de destino.');
  if(typeof XLSX==='undefined')return alert('No se pudo cargar el lector de Excel. Verifica tu conexión a internet y vuelve a intentarlo.');
  try{
    const data=await f.arrayBuffer();
    const wb=XLSX.read(data,{type:'array'});
    const first=wb.SheetNames&&wb.SheetNames[0];
    if(!first)return alert('El archivo no contiene una hoja válida.');
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[first],{header:1,defval:'',raw:false,blankrows:false});
    if(!rows.length)return alert('El archivo está vacío.');
    let headerRow=-1,nameCol=-1;
    for(let r=0;r<Math.min(rows.length,10);r++){
      const idx=findStudentNameColumn(rows[r]||[]);
      if(idx>=0){headerRow=r;nameCol=idx;break}
    }
    if(headerRow<0||nameCol<0){
      return alert('No se encontró la columna de estudiantes. Usa un encabezado como “Apellidos y nombres”, “Nombres y apellidos”, “Estudiante” o “Nombre”.');
    }
    const names=[];
    for(let r=headerRow+1;r<rows.length;r++){
      let name=String((rows[r]||[])[nameCol]??'').trim();
      name=name.replace(/^\s*\d+[.)-]?\s+/,'').replace(/\s+/g,' ').trim();
      if(!name)continue;
      const nh=normalizeHeaderText(name);
      if(['apellidos y nombres','nombres y apellidos','estudiante','nombre','nombres'].includes(nh))continue;
      names.push(name);
    }
    const unique=[];const seen=new Set();
    for(const name of names){const k=normalizeHeaderText(name);if(k&&!seen.has(k)){seen.add(k);unique.push(name)}}
    if(!unique.length)return alert('No se encontraron nombres de estudiantes debajo del encabezado.');
    const existing=new Set(db.students.filter(s=>s.classroomId===chosen.id).map(s=>normalizeHeaderText(s.name)));
    const toAdd=unique.filter(name=>!existing.has(normalizeHeaderText(name)));
    const duplicates=unique.length-toAdd.length;
    const preview=unique.slice(0,10).map((n,i)=>`${i+1}. ${n}`).join('\n');
    const more=unique.length>10?`\n… y ${unique.length-10} más.`:'';
    const dupMsg=duplicates?`\n\n${duplicates} estudiante(s) ya existen en este salón y no se volverán a importar.`:'';
    if(!confirm(`Se encontraron ${unique.length} estudiante(s) para ${classroomLabel(chosen)}:\n\n${preview}${more}${dupMsg}\n\nSe importarán ${toAdd.length}. ¿Continuar?`))return;
    const grade=chosen.grade||'',section=chosen.section||'';
    toAdd.forEach(name=>db.students.push({id:newId(),ownerId:db.profile.id,institutionId:accessContext.institutionId||null,cloudOwnerId:(chosen?.responsibleManaged?chosen.cloudOwnerId:null),responsibleManaged:!!chosen?.responsibleManaged,sharedReadOnly:false,classroomId:chosen.id,name,grade,section,createdAt:nowISO(),updatedAt:nowISO(),syncState:'local'}));
    input.value='';
    persist();
    toast(toAdd.length?`${toAdd.length} estudiante(s) importado(s)`:'No había estudiantes nuevos para importar');
  }catch(e){
    console.error(e);
    alert('No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) o CSV (.csv) válido.');
  }
}

let studentMode='one';
function setStudentMode(mode){
  studentMode=mode;
  $('modeOne').classList.toggle('active',mode==='one');
  $('modeMany').classList.toggle('active',mode==='many');
  $('singleStudentBox').style.display=mode==='one'?'block':'none';
  $('multiStudentBox').style.display=mode==='many'?'block':'none';
  updateMultiCount();
}
function getSelectedStudentIds(){
  if(studentMode==='one') return $('ocStudent').value?[$('ocStudent').value]:[];
  return Array.from(document.querySelectorAll('#ocStudentMulti input[type="checkbox"]:checked')).map(x=>x.value);
}
function updateMultiCount(){
  const n=document.querySelectorAll('#ocStudentMulti input[type="checkbox"]:checked').length;
  if($('multiCount')) $('multiCount').textContent=n+' seleccionado'+(n===1?'':'s');
}
function toggleAllStudents(){
  const boxes=Array.from(document.querySelectorAll('#ocStudentMulti input[type="checkbox"]'));
  const all=boxes.length&&boxes.every(x=>x.checked);
  boxes.forEach(x=>x.checked=!all);
  updateMultiCount();
}
function cleanBasicText(text){
  let t=String(text||'')
    .replace(/\s+/g,' ')
    .replace(/\s+([,.;:!?])/g,'$1')
    .replace(/([,.;:!?])(?=[^\s])/g,'$1 ')
    .trim();
  if(!t)return '';
  t=t.charAt(0).toUpperCase()+t.slice(1);
  if(!/[.!?]$/.test(t))t+='.';
  return t;
}

let pendingRedactionTarget=null;

function removeOralFillers(text){
  let t=' '+String(text||'').trim()+' ';
  // Solo muletillas claramente prescindibles. No se eliminan palabras con contenido factual.
  t=t.replace(/\b(eee+|mmm+|eh+)\b[,.]?/gi,' ');
  t=t.replace(/^\s*(bueno|a ver|este)\s*[,.:;-]?\s*/i,'');
  t=t.replace(/\s+/g,' ').trim();
  return t;
}

function removeImmediateWordDuplicates(text){
  // Corrige repeticiones orales simples: "y y", "que que", "el el".
  return String(text||'').replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)(\s+\1\b)+/gi,'$1');
}

function improveSequencing(text){
  let t=String(text||'').trim();
  // Convierte conectores orales de secuencia en límites de oración sin alterar los hechos.
  t=t.replace(/\s+y\s+(luego|después|posteriormente)\s+/gi,(m,c)=>'. '+c.charAt(0).toUpperCase()+c.slice(1)+', ');
  t=t.replace(/\s+(luego|después|posteriormente)\s+/gi,(m,c)=>'. '+c.charAt(0).toUpperCase()+c.slice(1)+', ');
  t=t.replace(/\s+y\s+finalmente\s+/gi,'. Finalmente, ');
  // Si una oración queda excesivamente encadenada con "y", se divide solo una vez por pasada.
  const parts=t.split(/(?<=[.!?])\s+/);
  t=parts.map(sentence=>{
    const words=sentence.trim().split(/\s+/);
    if(words.length<24) return sentence.trim();
    const matches=[...sentence.matchAll(/\s+y\s+/gi)];
    if(matches.length<2) return sentence.trim();
    const idx=matches[Math.floor(matches.length/2)].index;
    if(idx==null) return sentence.trim();
    const left=sentence.slice(0,idx).trim();
    const right=sentence.slice(idx+matches[Math.floor(matches.length/2)][0].length).trim();
    if(!left||!right) return sentence.trim();
    return left+'. '+right.charAt(0).toUpperCase()+right.slice(1);
  }).join(' ');
  return t;
}

function polishPunctuation(text){
  let t=String(text||'')
    .replace(/\s+/g,' ')
    .replace(/\s+([,.;:!?])/g,'$1')
    .replace(/([,.;:!?])(?=[^\s])/g,'$1 ')
    .replace(/\.{2,}/g,'.')
    .trim();
  // Mayúscula después de punto, interrogación o exclamación.
  t=t.replace(/(^|[.!?]\s+)([a-záéíóúüñ])/g,(m,p,c)=>p+c.toUpperCase());
  if(t && !/[.!?]$/.test(t)) t+='.';
  return t;
}

function improveLocalRedaction(text,kind){
  let t=String(text||'').trim();
  t=removeOralFillers(t);
  t=removeImmediateWordDuplicates(t);
  t=improveSequencing(t);
  t=polishPunctuation(t);

  // Ajustes suaves según el campo. No agregan sujetos, causas, acuerdos ni acciones.
  if(kind==='description'){
    t=t.replace(/\bpor eso\b/gi,'por ello');
    t=t.replace(/\by ahí\b/gi,'en ese momento');
  }else if(kind==='actions'){
    t=t.replace(/\by ahí\b/gi,'posteriormente');
    t=t.replace(/\bdespués de eso\b/gi,'posteriormente');
  }else if(kind==='follow'||kind==='followup'){
    t=t.replace(/\by también\b/gi,'Asimismo,');
    t=t.replace(/\bde ahí\b/gi,'posteriormente');
  }
  return polishPunctuation(t);
}

function fieldLabel(kind){
  if(kind==='description') return 'Descripción de la ocurrencia';
  if(kind==='actions') return 'Intervenciones realizadas por el docente';
  if(kind==='followup') return 'Nota del seguimiento';
  return 'Acuerdos y compromisos';
}

function formalizeField(id,kind){
  const el=$(id);
  const original=String(el.value||'').trim();
  if(!original)return alert('Primero escribe o dicta información en este campo.');
  const improved=improveLocalRedaction(original,kind);
  if(!improved)return alert('No se pudo mejorar este texto.');
  pendingRedactionTarget=id;
  $('redactionTitle').textContent='Mejorar: '+fieldLabel(kind);
  $('redactionOriginal').value=original;
  $('redactionImproved').value=improved;
  $('redactionDialog').showModal();
}

function applyImprovedRedaction(){
  if(!pendingRedactionTarget)return;
  const improved=$('redactionImproved').value.trim();
  if(!improved)return alert('La versión mejorada está vacía.');
  $(pendingRedactionTarget).value=improved;
  $('redactionDialog').close();
  pendingRedactionTarget=null;
  toast('Redacción mejorada. Verifica que conserve exactamente los hechos.');
}

let voiceRecognition=null;
let voiceButton=null;
let voiceTargetId=null;

function normalizeSpeech(text){
  return String(text||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9ñü\s]/gi,' ')
    .replace(/\s+/g,' ')
    .trim();
}

// Une un nuevo fragmento sin repetir palabras o frases ya reconocidas.
function mergeSpeechText(current,newChunk){
  current=String(current||'').trim();
  newChunk=String(newChunk||'').trim();
  if(!newChunk) return current;
  if(!current) return newChunk;

  const a=normalizeSpeech(current);
  const b=normalizeSpeech(newChunk);
  if(!b) return current;
  if(a===b) return current;

  // Chrome a veces devuelve de nuevo toda la frase, pero más larga.
  if(b.startsWith(a)) return newChunk;
  // O devuelve una versión más corta de algo que ya confirmó.
  if(a.startsWith(b)) return current;

  const aw=a.split(' '), bw=b.split(' ');
  const curWords=current.split(/\s+/), newWords=newChunk.split(/\s+/);
  const max=Math.min(aw.length,bw.length,20);
  let overlap=0;
  for(let k=max;k>=1;k--){
    const tail=aw.slice(-k).join(' ');
    const head=bw.slice(0,k).join(' ');
    if(tail===head){overlap=k;break;}
  }
  if(overlap>0){
    return (current+' '+newWords.slice(overlap).join(' ')).replace(/\s+/g,' ').trim();
  }

  // Si el navegador reenvía literalmente una frase ya contenida, no la agregamos.
  if(a.includes(b)) return current;

  return (current+' '+newChunk).replace(/\s+/g,' ').trim();
}

function toggleDictation(targetId,btn){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){alert('El dictado por voz no está disponible en este navegador. Prueba con Google Chrome en Android.');return;}
  if(voiceRecognition){voiceRecognition.stop();return;}

  const target=$(targetId);
  const status=$('voiceStatus-'+targetId);
  const base=target.value.trim();
  const rec=new SR();
  let sessionText='';

  voiceRecognition=rec; voiceButton=btn; voiceTargetId=targetId;
  rec.lang='es-PE';
  // Solo usamos resultados definitivos. Los provisionales son la principal causa
  // de duplicados en algunos Chrome/Android.
  rec.interimResults=false;
  rec.continuous=true;
  rec.maxAlternatives=1;
  btn.dataset.label=btn.textContent;
  btn.classList.add('listening');
  btn.textContent='⏹️ Detener';
  status.textContent='Escuchando… habla con naturalidad';

  rec.onresult=(event)=>{
    for(let i=event.resultIndex;i<event.results.length;i++){
      if(!event.results[i].isFinal) continue;
      const chunk=(event.results[i][0].transcript||'').trim();
      if(!chunk) continue;
      sessionText=mergeSpeechText(sessionText,chunk);
    }
    target.value=[base,sessionText].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  };

  rec.onerror=(event)=>{
    if(event.error==='not-allowed'||event.error==='service-not-allowed') alert('No se pudo usar el micrófono. Revisa que hayas permitido el acceso al micrófono para esta app.');
    else if(event.error!=='aborted'&&event.error!=='no-speech') toast('Error de dictado: '+event.error);
  };

  rec.onend=()=>{
    if(voiceButton){
      voiceButton.classList.remove('listening');
      voiceButton.textContent=voiceButton.dataset.label||'🎙️ Dictar';
    }
    if(voiceTargetId){
      const s=$('voiceStatus-'+voiceTargetId);
      if(s)s.textContent='Dictado finalizado';
    }
    voiceRecognition=null; voiceButton=null; voiceTargetId=null;
  };

  try{rec.start()}catch(e){
    voiceRecognition=null;
    btn.classList.remove('listening');
    btn.textContent=btn.dataset.label||'🎙️ Dictar';
    status.textContent='No se pudo iniciar';
  }
}

function subtypeOptions(type){return OCCURRENCE_SUBTYPES[type]||['Otro']}
function renderOccurrenceSubtypes(preserve=false){const el=$('ocSubtype');if(!el)return;const type=$('ocType')?.value||'Otro';const old=preserve?el.value:'';const vals=subtypeOptions(type);el.innerHTML=vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(old&&vals.includes(old))el.value=old;updateSensitiveAlert();}
function updateSensitiveAlert(){const box=$('sensitiveAlert');if(!box)return;box.style.display=SENSITIVE_SUBTYPES.has($('ocSubtype')?.value||'')?'block':'none';}
function renderHistorySubtypeFilter(){const el=$('filterSubtype');if(!el)return;const type=$('filterType')?.value||'';const vals=[...new Set(db.occurrences.filter(o=>!type||o.type===type).map(o=>o.subtype).filter(Boolean))].sort();const old=el.value;el.innerHTML='<option value="">Todos</option>'+vals.map(v=>`<option>${esc(v)}</option>`).join('');if(vals.includes(old))el.value=old;}

function saveOccurrence(){
  let ids=getSelectedStudentIds();
  if(!ids.length)return alert(studentMode==='many'?'Selecciona uno o más estudiantes':'Selecciona un estudiante');
  let desc=$('ocDesc').value.trim();if(!desc)return alert('Escribe la descripción');
  const groupId=ids.length>1?newId():null;
  const common={date:$('ocDate').value,time:$('ocTime').value,place:$('ocPlace').value,type:$('ocType').value,subtype:$('ocSubtype').value||'',description:desc,actions:$('ocActions').value.trim(),followText:$('ocFollowText').value.trim(),requiresFollow:$('ocFollow').checked,followStatus:$('ocFollow').checked?'pending':'',followDate:'',followNote:'',groupId,createdAt:new Date().toISOString()};
  let saved=0;
  ids.forEach(sid=>{let s=db.students.find(x=>x.id===sid);if(!s)return;db.occurrences.push({id:newId(),ownerId:db.profile.id,institutionId:accessContext.institutionId||null,classroomId:s.classroomId||null,studentId:sid,studentName:s.name,grade:s.grade,section:s.section,updatedAt:common.createdAt,syncState:'local',...common});saved++});
  ['ocDesc','ocActions','ocFollowText'].forEach(id=>$(id).value='');$('ocFollow').checked=false;
  document.querySelectorAll('#ocStudentMulti input[type="checkbox"]').forEach(x=>x.checked=false);updateMultiCount();
  setNow();renderOccurrenceSubtypes();persist();toast(saved>1?'Ocurrencia registrada para '+saved+' estudiantes':'Ocurrencia guardada correctamente')
}
function getFiltered(prefix){let sid=$(prefix+'Student').value,cid=$(prefix+'Classroom')?$(prefix+'Classroom').value:'',from=$(prefix+'From').value,to=$(prefix+'To').value;return db.occurrences.filter(o=>(!cid||o.classroomId===cid)&&(!sid||o.studentId===sid)&&(!from||o.date>=from)&&(!to||o.date<=to)).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))}
function followStatusLabel(v){return v==='closed'?'Cerrado':v==='in_progress'?'En proceso':'Pendiente'}
function followStatusClass(v){return v==='closed'?'success':v==='in_progress'?'warning':'pending'}
function ensureFollowFields(o){if(!o)return o;if(o.requiresFollow&&!o.followStatus)o.followStatus='pending';if(!o.followDate)o.followDate='';if(!o.followNote)o.followNote='';return o}
function openFollowups(){db.occurrences.forEach(ensureFollowFields);renderFollowups();$('followupsDialog').showModal()}
function setFollowFilter(v){if($('followFilter'))$('followFilter').value=v;renderFollowups()}
function updateFollowSummary(){const all=db.occurrences.filter(o=>o.requiresFollow).map(ensureFollowFields);const counts={pending:0,in_progress:0,closed:0};all.forEach(o=>counts[o.followStatus||'pending']=(counts[o.followStatus||'pending']||0)+1);if($('followPendingNum'))$('followPendingNum').textContent=counts.pending||0;if($('followProgressNum'))$('followProgressNum').textContent=counts.in_progress||0;if($('followClosedNum'))$('followClosedNum').textContent=counts.closed||0;const f=$('followFilter')?.value||'open';[['followCountPending','pending'],['followCountProgress','in_progress'],['followCountClosed','closed']].forEach(([id,v])=>$(id)?.classList.toggle('active',f===v));}
function renderFollowups(){
  const box=$('followupsList'); if(!box)return;
  updateFollowSummary();
  const filter=$('followFilter')?.value||'open';
  let arr=db.occurrences.filter(o=>o.requiresFollow).map(ensureFollowFields);
  if(filter==='open')arr=arr.filter(o=>o.followStatus!=='closed');
  else if(filter!=='all')arr=arr.filter(o=>o.followStatus===filter);
  arr.sort((a,b)=>((b.followDate||b.date||'')+(b.time||'')).localeCompare((a.followDate||a.date||'')+(a.time||'')));
  box.innerHTML=arr.length?arr.map(o=>`<div class="item"><div class="split-head"><div><strong>${esc(o.studentName||'Estudiante')}</strong> <span class="pill">${esc(o.type||'Sin tipo')}</span>${o.subtype?`<span class="subtype-badge">${esc(o.subtype)}</span>`:''}</div><span class="pill">${followStatusLabel(o.followStatus)}</span></div><div class="small muted">Ocurrencia: ${esc(o.date||'')} ${esc(o.time||'')} · ${esc(o.grade||'')} ${esc(o.section||'')}</div><p style="margin-bottom:6px">${esc(o.description||'')}</p>${o.followText?`<div class="small"><b>Acuerdos y compromisos:</b>${bulletHtml(o.followText)}</div>`:''}${o.followDate?`<p class="small"><b>Última revisión:</b> ${esc(o.followDate)}</p>`:''}${o.followNote?`<p class="small"><b>Nota de seguimiento:</b> ${esc(o.followNote)}</p>`:''}<div class="actions"><button type="button" class="btn primary" onclick="openFollowEdit('${o.id}')">Actualizar seguimiento</button></div></div>`).join(''):'<div class="card empty">No hay casos en esta categoría.</div>';
}
function openFollowEdit(id){
  const o=ensureFollowFields(db.occurrences.find(x=>x.id===id)); if(!o)return;
  $('followEditId').value=id;$('followStatus').value=o.followStatus||'pending';$('followDate').value=o.followDate||new Date().toISOString().slice(0,10);$('followNote').value=o.followNote||'';
  $('followCaseSummary').innerHTML=`<b>${esc(o.studentName||'Estudiante')}</b><br>${esc(o.date||'')} · ${esc(o.type||'Sin tipo')}${o.subtype?' · '+esc(o.subtype):''}<br>${esc(o.description||'')}`;
  $('followEditDialog').showModal();
}
function saveFollowup(){
  const o=db.occurrences.find(x=>x.id===$('followEditId').value); if(!o)return;
  o.requiresFollow=true;o.followStatus=$('followStatus').value||'pending';o.followDate=$('followDate').value||new Date().toISOString().slice(0,10);o.followNote=$('followNote').value.trim();o.updatedAt=nowISO();o.syncState='local';persist();$('followEditDialog').close();refreshAll();renderFollowups();toast(o.followStatus==='closed'?'Seguimiento cerrado':'Seguimiento actualizado');
}
function renderHistory(){let cid=$('filterClassroom').value,sid=$('filterStudent').value,type=$('filterType').value,subtype=$('filterSubtype')?.value||'',from=$('filterFrom').value,to=$('filterTo').value;let arr=db.occurrences.filter(o=>(!cid||o.classroomId===cid)&&(!sid||o.studentId===sid)&&(!type||o.type===type)&&(!subtype||(o.subtype||'')===subtype)&&(!from||o.date>=from)&&(!to||o.date<=to)).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));$('historyList').innerHTML=arr.length?arr.map(o=>`<div class="item"><strong>${esc(o.studentName)} <span class="pill">${esc(o.type)}</span>${o.subtype?`<span class="subtype-badge">${esc(o.subtype)}</span>`:''}${o.groupId?' <span class="pill">Registro grupal</span>':''}</strong><div class="small muted">${o.date||''} ${o.time||''} · ${esc(o.grade||'')} ${esc(o.section||'')} · ${esc(o.place||'')}</div><p>${esc(o.description)}</p>${o.actions?`<div><b>Intervenciones realizadas por el docente:</b>${bulletHtml(o.actions)}</div>`:''}${o.followText?`<div><b>Acuerdos y compromisos:</b>${bulletHtml(o.followText)}</div>`:''}${o.requiresFollow?`<p class="small"><b>Estado de seguimiento:</b> ${followStatusLabel(ensureFollowFields(o).followStatus)}${o.followDate?' · '+esc(o.followDate):''}</p>`:''}${o.followNote?`<p class="small"><b>Nota de seguimiento:</b> ${esc(o.followNote)}</p>`:''}<div class="actions"><button class="btn secondary" onclick="openEdit('${o.id}')">Editar</button><button class="btn danger" onclick="deleteOcc('${o.id}')">Eliminar</button></div></div>`).join(''):'<div class="card empty">No hay ocurrencias con esos filtros.</div>'}
function clearFilters(){['filterClassroom','filterStudent','filterType','filterSubtype','filterFrom','filterTo'].forEach(id=>{if($(id))$(id).value=''});renderFilterStudentOptions();renderHistorySubtypeFilter();renderHistory()}
function openEdit(id){let o=db.occurrences.find(x=>x.id===id);$('editId').value=id;$('editDesc').value=o.description;$('editActions').value=o.actions;$('editFollow').value=o.followText;$('editDialog').showModal()}
function saveEdit(){let o=db.occurrences.find(x=>x.id===$('editId').value);o.description=$('editDesc').value.trim();o.actions=$('editActions').value.trim();o.followText=$('editFollow').value.trim();o.updatedAt=nowISO();o.syncState='local';$('editDialog').close();persist();renderHistory()}
function deleteOcc(id){if(!confirm('¿Eliminar esta ocurrencia?'))return;queueCloudDelete('occurrences',id);db.occurrences=db.occurrences.filter(o=>o.id!==id);persist();renderHistory();toast('Ocurrencia eliminada')}
function generateReport(){let arr=getFiltered('rep');if(!arr.length)return alert('No hay registros para generar el documento');let cfg=db.config||{};const responsibleRole=activeRole()==='auxiliar'?'Auxiliar de educación':'Docente';let body=arr.map((o,i)=>`<section><h2>REGISTRO DE OCURRENCIA ${arr.length>1?i+1:''}</h2><table><tr><td><b>Estudiante:</b> ${esc(o.studentName)}</td><td><b>Grado:</b> ${esc(o.grade||'')}</td><td><b>Sección:</b> ${esc(o.section||'')}</td></tr><tr><td><b>Fecha:</b> ${esc(o.date||'')}</td><td><b>Hora:</b> ${esc(o.time||'')}</td><td><b>Lugar:</b> ${esc(o.place||'')}</td></tr><tr><td colspan="3"><b>Tipo:</b> ${esc(o.type||'')} &nbsp; | &nbsp; <b>Subtipo:</b> ${esc(o.subtype||'—')}</td></tr></table><h3>Descripción de la ocurrencia</h3><p>${nl(o.description)}</p><h3>Intervenciones realizadas por el docente</h3>${bulletHtml(o.actions)}<h3>Acuerdos y compromisos</h3>${bulletHtml(o.followText)}${o.requiresFollow?`<p><b>Estado:</b> ${followStatusLabel(ensureFollowFields(o).followStatus)}${o.followDate?' · <b>Fecha de revisión:</b> '+esc(o.followDate):''}</p>${o.followNote?`<p><b>Resultado del seguimiento:</b> ${nl(o.followNote)}</p>`:''}`:''}<div class="sign"><div>_________________________<br>${responsibleRole}</div><div>_________________________<br>Padre/madre/apoderado</div></div></section>`).join('<div class="pagebreak"></div>');let html=`<!doctype html><html><head><meta charset="utf-8"><title>Reporte de ocurrencias</title><style>body{font-family:Arial,sans-serif;color:#111;margin:32px}h1,h2{text-align:center}h1{font-size:18px;margin-bottom:2px}h2{font-size:17px;margin-top:24px}h3{font-size:14px;margin-top:20px}table{width:100%;border-collapse:collapse}td{border:1px solid #999;padding:8px}p{line-height:1.45}.sign{display:flex;justify-content:space-between;text-align:center;margin-top:70px;gap:30px}.pagebreak{page-break-after:always}@media print{button{display:none}.pagebreak{page-break-after:always}} </style></head><body><h1>${esc(cfg.school||'INSTITUCIÓN EDUCATIVA')}</h1><div style="text-align:center">${esc(cfg.teacher?(responsibleRole+': '+cfg.teacher):'')}</div>${body}</body></html>`;if($('repMode').value==='word'){let blob=new Blob(['\ufeff',html],{type:'application/msword'});downloadBlob(blob,'reporte_ocurrencias.doc')}else{let w=window.open('','_blank');w.document.write(html);w.document.close();setTimeout(()=>w.print(),300)}}
function backupData(){db.meta.updatedAt=nowISO();downloadBlob(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),'respaldo_ocurrencias_v1_8.json')}
function restoreData(e){let f=e.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>{try{let x=JSON.parse(r.result);if(!x.students||!x.occurrences)throw 0;if(confirm('Esto reemplazará los datos actuales. ¿Continuar?')){db=migrateDatabase(x);persist();toast('Respaldo restaurado y actualizado')}}catch{alert('Archivo de respaldo no válido')}};r.readAsText(f)}
function downloadBlob(blob,name){let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function setNow(){let n=new Date();$('ocDate').value=n.toISOString().slice(0,10);$('ocTime').value=n.toTimeString().slice(0,5)}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))} function nl(s){return esc(s).replace(/\n/g,'<br>')} function bulletHtml(text){const items=String(text||'').split(/\n+/).map(x=>x.replace(/^\s*[•\-–—]\s*/, '').trim()).filter(Boolean);return items.length?`<ul class="bullet-list">${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<span class="muted small">—</span>'}
function refreshAll(){let cfg=db.config||{};const assignedInst=activeInstitution();const assignedSchool=assignedInst?.name||'';if(assignedSchool&&cfg.school!==assignedSchool){cfg.school=assignedSchool;db.config=cfg;localStorage.setItem(DBKEY,JSON.stringify(db));}updateProfileSummary();$('schoolHeader').textContent=(assignedSchool?assignedSchool+' · ':'')+'SAGE · Versión '+APP_VERSION;if($('cloudPrepStatus'))$('cloudPrepStatus').textContent=cloudUser?'Cuenta conectada · sincronización disponible':'Estructura lista · cuenta no conectada';if($('schemaVersionLabel'))$('schemaVersionLabel').textContent='v'+(db.meta?.schemaVersion||SCHEMA_VERSION);if($('installIdLabel'))$('installIdLabel').textContent=(db.meta?.installId||'—').slice(0,8)+'…';if(activeRole()==='admin_general'){
  applyAdminHomeStats();
  refreshAdminHomeStats();
}else{
  $('statStudents').textContent=db.students.length;
  $('statOcc').textContent=db.occurrences.length;
  let today=new Date().toISOString().slice(0,10);
  $('statToday').textContent=db.occurrences.filter(o=>o.date===today).length;
  db.occurrences.forEach(ensureFollowFields);
  $('statFollow').textContent=db.occurrences.filter(o=>o.requiresFollow&&o.followStatus!=='closed').length;
}let allOpts=classroomOptions(true),selectOpts=classroomOptions(false);['ocClassroom','filterClassroom','repClassroom','studentClassFilter'].forEach(id=>{let el=$(id);if(el){let old=el.value;el.innerHTML=allOpts;if(db.classrooms.some(c=>c.id===old))el.value=old}});['stClassroom','bulkClassroom'].forEach(id=>{let el=$(id);if(el){let old=el.value;el.innerHTML=id==='bulkClassroom'?'<option value="">Seleccionar salón...</option>'+db.classrooms.slice().sort((a,b)=>classroomLabel(a).localeCompare(classroomLabel(b))).map(c=>`<option value="${c.id}">${esc(classroomLabel(c))}</option>`).join(''):selectOpts;if(db.classrooms.some(c=>c.id===old))el.value=old}});renderClassrooms();renderStudents();renderOccurrenceStudents();renderFilterStudentOptions();renderReportStudentOptions();renderHistorySubtypeFilter();renderOccurrenceSubtypes(true);renderHistory();updateSyncUi()}

let deferredInstallPrompt=null;
function isStandalone(){return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;}
function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent);}
function isAndroid(){return /android/i.test(navigator.userAgent);}
function updateInstallUi(message){
  const card=$('installCard'), btn=$('installAppBtn'), pill=$('installStatePill'), help=$('installHelpText');
  if(!card)return;
  if(isStandalone()){
    card.style.display='none';
    return;
  }
  card.style.display='block';
  if(message)help.textContent=message;
  if(deferredInstallPrompt){
    btn.style.display='inline-block';
    pill.textContent='Lista para instalar';
  }else{
    btn.style.display='inline-block';
    pill.textContent='Instalar / agregar acceso';
  }
}
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  updateInstallUi('La app está lista para instalarse en este dispositivo.');
});
window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  toast('Aplicación instalada correctamente');
  const card=$('installCard'); if(card)card.style.display='none';
});
async function installApp(){
  if(isStandalone()){toast('La app ya está instalada');return;}
  if(deferredInstallPrompt){
    try{
      deferredInstallPrompt.prompt();
      const choice=await deferredInstallPrompt.userChoice;
      if(choice.outcome==='accepted'){
        $('installHelpText').textContent='Android está completando la instalación. Si el ícono no aparece, revisa el cajón de aplicaciones.';
        $('installStatePill').textContent='Instalando…';
      }else{
        $('installHelpText').textContent='Instalación cancelada. Puedes intentarlo nuevamente.';
      }
    }catch(e){showInstallHelp();}
    deferredInstallPrompt=null;
    return;
  }
  showInstallHelp();
}
function showInstallHelp(){
  const box=$('installFallback'); if(!box)return;
  box.style.display='block';
  if(isIOS()){
    box.innerHTML='<b>iPhone/iPad:</b> abre esta página en Safari → botón Compartir → <b>Añadir a pantalla de inicio</b>.';
  }else if(isAndroid()){
    box.innerHTML='<b>Android:</b> abre SAGE en Chrome → toca el menú ⋮ → <b>Instalar aplicación</b> o <b>Agregar a pantalla principal</b>. Si no aparece una opción, actualiza Chrome y vuelve a abrir el enlace.';
  }else{
    box.innerHTML='<b>Computadora:</b> en Chrome o Edge busca el ícono de instalación en la barra de direcciones o usa el menú del navegador → <b>Instalar aplicación</b>.';
  }
}
let latestAvailableVersion=null;
function showUpdateNotice(reg,version){
  swRegistration=reg||swRegistration;
  latestAvailableVersion=version||latestAvailableVersion;
  const card=$('updateCard');if(card)card.style.display='block';
  const txt=$('updateVersionText');
  if(txt)txt.textContent=latestAvailableVersion?` Versión disponible: ${latestAvailableVersion}.`:'';
}
function dismissUpdateNotice(){const card=$('updateCard');if(card)card.style.display='none';}
async function checkPublishedVersion(){
  try{
    const r=await fetch(`version.json?t=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)return;
    const data=await r.json();
    const published=String(data.version||'').trim();
    if(published && published!==APP_VERSION){
      latestAvailableVersion=published;
      showUpdateNotice(swRegistration,published);
      if(swRegistration)swRegistration.update().catch(()=>{});
    }
  }catch(e){}
}
async function updateAppNow(){
  toast('Preparando actualización…');
  try{
    if(swRegistration){
      await swRegistration.update();
      if(swRegistration.waiting){
        swRegistration.waiting.postMessage('SKIP_WAITING');
        return;
      }
    }
    // Si todavía no hay un worker esperando, recarga desde red sin alterar datos locales.
    const url=new URL(location.href);
    url.searchParams.set('appv',latestAvailableVersion||APP_VERSION);
    url.searchParams.set('_refresh',Date.now());
    location.replace(url.toString());
  }catch(e){
    location.reload();
  }
}
function initServiceWorkerUpdates(){
  if(!('serviceWorker' in navigator)){
    checkPublishedVersion();
    return;
  }
  navigator.serviceWorker.register('sw.js?v=2.2.15',{updateViaCache:'none'}).then(reg=>{
    swRegistration=reg;
    if(reg.waiting&&navigator.serviceWorker.controller)showUpdateNotice(reg,latestAvailableVersion);
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;if(!nw)return;
      nw.addEventListener('statechange',()=>{
        if(nw.state==='installed'&&navigator.serviceWorker.controller){
          showUpdateNotice(reg,latestAvailableVersion);
        }
      });
    });
    reg.update().catch(()=>{});
    checkPublishedVersion();
    window.addEventListener('focus',()=>{reg.update().catch(()=>{});checkPublishedVersion();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkPublishedVersion();});
  }).catch(()=>{checkPublishedVersion();});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(refreshingForUpdate)return;
    refreshingForUpdate=true;
    location.reload();
  });
}

function initInstallExperience(){
  if(isStandalone())return;
  updateInstallUi('Puedes instalar la app o agregarla a tu pantalla de inicio.');
  setTimeout(()=>{
    if(!deferredInstallPrompt && !isStandalone()){
      $('installHelpText').textContent='Si “Instalar” no completa el proceso, usa “Cómo instalar” y agrega la app a la pantalla de inicio.';
    }
  },1800);
}

setNow();refreshAll();initAuth();initInstallExperience();initServiceWorkerUpdates();
