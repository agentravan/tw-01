const $=s=>document.querySelector(s); const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search); const API=params.get('api')||'';
async function api(path,options={}){const r=await fetch(API+path,options);const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;}
let snapshot=null,selected=null;
const statusClass=s=>String(s||'').toLowerCase().replaceAll('_','-');
function employeeCard(e){
 const task=snapshot.tasks.find(t=>t.id===e.currentTaskId);
 return `<button class="employeeCard ${statusClass(e.status)}" data-employee="${esc(e.id)}"><div class="employeeTop"><strong>${esc(e.name)}</strong><span class="status ${statusClass(e.status)}">${esc(e.status)}</span></div><div class="role">${esc(e.role)}</div><div class="current">${task?esc(task.goal):'No active task'}</div><div class="meta">Heartbeat: ${e.lastHeartbeat?new Date(e.lastHeartbeat).toLocaleTimeString('en-IN'):'—'} · Health: ${esc(e.health)}</div></button>`;
}
function render(){
 const es=snapshot?.employees||[], ts=snapshot?.tasks||[], ev=snapshot?.events||[];
 $('#connection').innerHTML='<span class="online">● Runtime API connected</span>';
 $('#kpis').innerHTML=[[''+es.length,'AI Employees'],[''+es.filter(e=>e.status==='WORKING').length,'Working Now'],[''+ts.filter(t=>!['COMPLETED','FAILED','CANCELLED'].includes(t.status)).length,'Open Tasks'],[''+ts.filter(t=>t.status==='COMPLETED').length,'Completed'],[''+es.filter(e=>e.status==='STALLED'||e.status==='ERROR').length,'Attention']].map(x=>`<div class="card"><b>${x[0]}</b><span>${x[1]}</span></div>`).join('');
 $('#employees').innerHTML=es.map(employeeCard).join('');
 $('#tasks').innerHTML=ts.length?ts.map(t=>`<article class="taskRow"><div><strong>${esc(t.goal)}</strong><span class="status ${statusClass(t.status)}">${esc(t.status)}</span></div><div class="progress"><i style="width:${t.progress}%"></i></div><small>Assigned to: ${esc(es.find(e=>e.id===t.assignedTo)?.name||t.assignedTo)} · By: ${esc(es.find(e=>e.id===t.assignedBy)?.name||t.assignedBy)} · ${t.progress}%</small></article>`).join(''):'No tasks yet.';
 $('#events').innerHTML=ev.slice(0,40).map(x=>`<article class="event"><span class="eventTime">${new Date(x.at).toLocaleTimeString('en-IN')}</span><span class="eventType">${esc(x.type)}</span><strong>${esc(es.find(e=>e.id===x.employeeId)?.name||x.employeeId)}</strong><span>${esc(x.message)}</span></article>`).join('')||'No runtime events yet.';
 $('#org').innerHTML=es.map(e=>`<div class="orgNode"><strong>${esc(e.name)}</strong><span>${esc(e.role)}</span><small>Reports to: ${esc(es.find(x=>x.id===e.managerId)?.name||'Owner')}</small></div>`).join('');
 if(selected){renderDetail(selected);}
}
function renderDetail(id){
 const e=snapshot.employees.find(x=>x.id===id); if(!e)return; const task=snapshot.tasks.find(t=>t.id===e.currentTaskId); const runs=snapshot.runs.filter(r=>r.employeeId===id).slice(0,15);
 $('#detail').innerHTML=`<div class="detailHead"><div><h2>${esc(e.name)} <span class="status ${statusClass(e.status)}">${esc(e.status)}</span></h2><p>${esc(e.role)} · Manager: ${esc(snapshot.employees.find(x=>x.id===e.managerId)?.name||'Owner')}</p></div><button id="assignToEmployee" data-id="${esc(e.id)}">Assign Task</button></div>
 <div class="detailGrid"><div><b>Current task</b><p>${task?esc(task.goal):'None'}</p></div><div><b>Last heartbeat</b><p>${e.lastHeartbeat?new Date(e.lastHeartbeat).toLocaleString('en-IN'):'—'}</p></div><div><b>Health</b><p>${esc(e.health)}</p></div><div><b>Outputs</b><p>${e.outputs}</p></div></div>
 <h3>Run history</h3>${runs.length?runs.map(r=>`<div class="runRow"><b>${esc(r.status)}</b> · ${new Date(r.startedAt).toLocaleString('en-IN')} · ${r.durationMs?Math.round(r.durationMs/1000)+'s':'active'}<small> Run ${esc(r.id.slice(0,8))} · heartbeat ${new Date(r.heartbeatAt).toLocaleTimeString('en-IN')}</small></div>`).join(''):'No runs yet.'}`;
}
async function refreshControl(){
 try{snapshot=await api('/api/control-room');render();await refreshBusiness();await refreshSafety();}
 catch(e){$('#connection').innerHTML='<span class="offline">● Runtime not connected</span>';$('#employees').innerHTML='<div class="empty">The Control Room UI is online, but the AI runtime API is not connected. Run TW-01 locally or connect the API deployment using ?api=https://…</div>';}
}
async function refreshBusiness(){try{const p=await api('/api/businesses');$('#businesses').innerHTML=p.businesses.length?p.businesses.map(x=>`<article class="taskRow"><strong>${esc(x.name)}</strong><span class="status ${statusClass(x.status)}">${esc(x.status)}</span><p>${esc(x.hypothesis)}</p><small>Budget ₹${esc(x.max_test_budget)} · Loss periods ${esc(x.consecutive_loss_periods)} · Strategy v${esc(x.strategy_version)}</small></article>`).join(''):'No businesses tracked.'}catch{}}
async function refreshSafety(){try{const s=await api('/api/status');$('#safety').innerHTML=`Paused: <b>${s.paused?'YES':'NO'}</b> · Emergency Stop: <b>${s.emergencyStop?'ACTIVE':'OFF'}</b>`}catch{}}
$('#refreshControl').onclick=refreshControl; setInterval(refreshControl,5000);
$('#employees').addEventListener('click',e=>{const b=e.target.closest('[data-employee]');if(!b)return;selected=b.dataset.employee;renderDetail(selected);document.querySelector('#detail').scrollIntoView({behavior:'smooth'});});
$('#newTask').onclick=async()=>{const goal=prompt('Task goal?');if(!goal)return;const to=prompt('Assign to employee ID (e.g. ai-office, ai-hr, ai-finance):','ai-office');if(!to)return;try{await api('/api/control-room/task',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal,assignedBy:'ai-boss',assignedTo:to})});await refreshControl()}catch(e){alert(e.message)}};
document.addEventListener('click',async e=>{if(e.target.id==='assignToEmployee'){const id=e.target.dataset.id;const goal=prompt('Task for this employee?');if(goal){await api('/api/control-room/task',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal,assignedBy:'ai-boss',assignedTo:id})});await refreshControl();}}});
$('#stop').onclick=async()=>{await api('/api/stop',{method:'POST'});await refreshControl()}; $('#resume').onclick=async()=>{await api('/api/resume',{method:'POST'});await refreshControl()};
$('#dailyReport').onclick=async()=>{try{$('#dailyReportOutput').textContent=JSON.stringify(await api('/api/daily-report'),null,2)}catch(e){$('#dailyReportOutput').textContent=e.message}};
refreshControl();
