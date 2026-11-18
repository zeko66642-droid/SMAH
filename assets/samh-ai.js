(() => {
  const css = [
    '#samh-ai-launcher{position:fixed;right:24px;bottom:24px;z-index:3000;border:0;border-radius:999px;padding:13px 19px;background:linear-gradient(135deg,#0A1931,#1A3D63);color:#fff;font:700 14px sans-serif;box-shadow:0 12px 32px #0a193133;cursor:pointer}',
    '#samh-ai-panel{position:fixed;right:24px;bottom:82px;z-index:3001;width:min(390px,calc(100vw - 28px));height:min(560px,calc(100vh - 110px));background:#F6FAFD;border:1px solid #B3CFE5;border-radius:22px;box-shadow:0 24px 70px #0a193133;display:none;overflow:hidden;direction:rtl;font-family:sans-serif}',
    '#samh-ai-panel.open{display:flex;flex-direction:column}',
    '#samh-ai-head{padding:16px;background:linear-gradient(120deg,#0A1931,#1A3D63);color:white;display:flex;justify-content:space-between;align-items:center}',
    '#samh-ai-head small{display:block;color:#B3CFE5;font-size:11px;margin-top:3px}',
    '#samh-ai-close{border:0;background:#ffffff22;color:white;border-radius:9px;width:32px;height:32px;font-size:20px;cursor:pointer}',
    '#samh-ai-messages{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}',
    '.samh-ai-msg{max-width:88%;padding:10px 13px;border-radius:14px;font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.samh-ai-msg.user{align-self:flex-start;background:#1A3D63;color:white}',
    '.samh-ai-msg.model{align-self:flex-end;background:white;color:#0A1931;border:1px solid #D5E4F0}',
    '.samh-ai-msg.notice{align-self:stretch;max-width:100%;background:#EDF5FC;color:#3E5975;text-align:center;font-size:12px}',
    '#samh-ai-form{padding:11px;border-top:1px solid #D5E4F0;background:white;display:flex;gap:8px}',
    '#samh-ai-input{min-width:0;flex:1;resize:none;border:1px solid #D5E4F0;border-radius:12px;padding:10px;font:13px sans-serif;outline:none}',
    '#samh-ai-send{border:0;border-radius:12px;padding:0 14px;background:#1A3D63;color:white;font-weight:bold;cursor:pointer}',
    '#samh-ai-send:disabled{opacity:.55}',
    '@media(max-width:480px){#samh-ai-launcher{right:14px;bottom:14px}#samh-ai-panel{right:14px;bottom:70px}}'
  ].join('');
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const launcher = document.createElement('button'); launcher.id='samh-ai-launcher'; launcher.type='button'; launcher.textContent='✦ اسأل SAMH AI';
  const panel = document.createElement('section'); panel.id='samh-ai-panel';
  panel.innerHTML='<header id="samh-ai-head"><div><strong>سَمْح AI</strong><small>مساعدك الذكي</small></div><button id="samh-ai-close" type="button">×</button></header><div id="samh-ai-messages"><div class="samh-ai-msg notice">أهلًا! أنا مساعد سَمْح الذكي. كيف أقدر أساعدك؟</div></div><form id="samh-ai-form"><textarea id="samh-ai-input" rows="1" maxlength="5000" placeholder="اكتب سؤالك هنا..."></textarea><button id="samh-ai-send" type="submit">إرسال</button></form>';
  document.body.append(launcher,panel);
  const list=panel.querySelector('#samh-ai-messages'), form=panel.querySelector('#samh-ai-form'), input=panel.querySelector('#samh-ai-input'), send=panel.querySelector('#samh-ai-send');
  const history=[];
  function add(text,role){const el=document.createElement('div');el.className='samh-ai-msg '+role;el.textContent=text;list.appendChild(el);list.scrollTop=list.scrollHeight;return el;}
  launcher.addEventListener('click',()=>{panel.classList.toggle('open');if(panel.classList.contains('open'))input.focus();});
  panel.querySelector('#samh-ai-close').addEventListener('click',()=>panel.classList.remove('open'));
  form.addEventListener('submit',async e=>{
    e.preventDefault(); const prompt=input.value.trim(); if(!prompt||send.disabled)return;
    input.value='';add(prompt,'user');history.push({role:'user',text:prompt});send.disabled=true;send.textContent='...';const wait=add('سَمْح يفكر...','notice');
    try{const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history.slice(-12)})});const data=await response.json().catch(()=>({}));wait.remove();if(!response.ok)throw new Error(data.error||'تعذر الحصول على رد.');add(data.answer,'model');history.push({role:'model',text:data.answer});}
    catch(error){wait.remove();add(error.message||'حدث خطأ غير متوقع.','notice');}
    finally{send.disabled=false;send.textContent='إرسال';input.focus();}
  });
})();