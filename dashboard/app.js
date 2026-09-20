const $=s=>document.querySelector(s); const esc=x=>String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(p,o={}){const r=await fetch(p,o);const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d;}
function show(title,data){$('#output').innerHTML='<strong>'+esc(title)+'</strong>\n'+esc(JSON.stringify(data,null,2));window.scrollTo({top:0,behavior:'smooth'});}
async function refresh(){
 const d=await api('/api/dashboard');
 $('#cards').innerHTML=Object.entries(d).filter(([k])=>!['paused','emergencyStop','activities','researchQueue'].includes(k)).map(([k,v])=>`<div class="card"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
 const leads=await api('/api/leads');
 $('#leads').innerHTML=leads.length?leads.map(x=>`<article class="lead"><div><strong>${esc(x.company_name)}</strong> <span class="pill">${esc(x.status)}</span> <span class="score">${esc(x.lead_score)}</span></div><div>${esc(x.industry)} · ${esc(x.location)} · ${esc(x.contact_name||'No contact')}</div><small>${esc(x.possible_hr_problem||'Problem not yet verified')}</small><div class="actions">
 <button data-act="qualify" data-id="${esc(x.id)}">Qualify</button>
 <button data-act="email" data-id="${esc(x.id)}">Draft Email</button>
 <button data-act="wa" data-id="${esc(x.id)}">Draft WhatsApp</button>
 <button data-act="brief" data-id="${esc(x.id)}">Meeting Brief</button>
 <button data-act="follow" data-id="${esc(x.id)}">Follow-up +3d</button>
 </div></article>`).join(''):'No leads yet.';
}
$('#cycle').onclick=async()=>{try{show('FULL SALES CYCLE',await api('/api/cycle',{method:'POST'}));await refresh()}catch(e){show('ERROR',{error:e.message})}};
$('#run').onclick=async()=>{try{show('AI COMMAND',await api('/api/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:$('#command').value})}));await refresh()}catch(e){show('ERROR',{error:e.message})}};
$('#stop').onclick=async()=>{await api('/api/stop',{method:'POST'});await refresh()};
$('#resume').onclick=async()=>{await api('/api/resume',{method:'POST'});await refresh()};
$('#import').onclick=async()=>{try{const items=JSON.parse($('#leadJson').value);const r=await api('/api/research/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items})});$('#researchOutput').textContent=JSON.stringify(r,null,2);await refresh()}catch(e){$('#researchOutput').textContent=e.message}};
$('#researchUrl').onclick=async()=>{try{$('#researchOutput').textContent=JSON.stringify(await api('/api/research/url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:$('#sourceUrl').value})}),null,2)}catch(e){$('#researchOutput').textContent=e.message}};
$('#followups').onclick=async()=>{$('#due').textContent=JSON.stringify(await api('/api/followups/due'),null,2)};
$('#leads').addEventListener('click',async e=>{
 const b=e.target.closest('button[data-act]'); if(!b)return;
 b.disabled=true; const old=b.textContent; b.textContent='Working…';
 try{
   let r,title;
   if(b.dataset.act==='qualify'){r=await api('/api/lead/qualify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.dataset.id})});title='LEAD QUALIFIED';}
   if(b.dataset.act==='email'){r=await api('/api/outreach/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.dataset.id,channel:'email'})});title='EMAIL DRAFT';}
   if(b.dataset.act==='wa'){r=await api('/api/outreach/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.dataset.id,channel:'whatsapp'})});title='WHATSAPP DRAFT';}
   if(b.dataset.act==='brief'){r=await api('/api/meeting/brief',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.dataset.id})});title='MEETING BRIEF';}
   if(b.dataset.act==='follow'){r=await api('/api/followups/set',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.dataset.id,days:3})});title='FOLLOW-UP SET';}
   show(title,r); await refresh();
 }catch(e){show('ERROR',{error:e.message})}finally{b.disabled=false;b.textContent=old;}
});
refresh().catch(e=>show('STARTUP ERROR',{error:e.message}));