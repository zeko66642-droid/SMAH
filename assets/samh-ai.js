(() => {
  // SAMH AI is added to the existing navigation; the downloader layout stays untouched.
  const nav = document.querySelector('.nav-links');
  const mobileDrawer = document.getElementById('mobileDrawer');
  if (!nav) return;

  const css = [
    '#samh-ai-nav-button,#samh-ai-mobile-button{border:0;background:transparent;color:var(--c-ocean-deep);font:600 14.5px var(--font-body);cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 0}',
    '#samh-ai-nav-button:hover,#samh-ai-mobile-button:hover{color:var(--c-slate-blue)}',
    '#samh-ai-panel{position:fixed;top:96px;right:50%;transform:translateX(50%);z-index:3001;width:min(440px,calc(100vw - 28px));height:min(570px,calc(100vh - 120px));background:var(--c-bg-ice);border:1px solid var(--c-soft-sky);border-radius:22px;box-shadow:0 24px 70px rgba(10,25,49,.2);display:none;overflow:hidden;direction:rtl;font-family:var(--font-body)}',
    '#samh-ai-panel.open{display:flex;flex-direction:column}',
    '#samh-ai-head{padding:16px 18px;background:linear-gradient(120deg,var(--c-dark-navy),var(--c-ocean-deep));color:white;display:flex;justify-content:space-between;align-items:center}',
    '#samh-ai-head small{display:block;color:var(--c-soft-sky);font-size:11px;margin-top:3px}',
    '#samh-ai-close{border:0;background:#ffffff22;color:white;border-radius:9px;width:32px;height:32px;font-size:20px;cursor:pointer}',
    '#samh-ai-messages{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px}',
    '.samh-ai-msg{max-width:88%;padding:11px 14px;border-radius:14px;font-size:13px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.samh-ai-msg.user{align-self:flex-start;background:var(--c-ocean-deep);color:white}',
    '.samh-ai-msg.model{align-self:flex-end;background:white;color:var(--c-dark-navy);border:1px solid var(--border-subtle)}',
    '.samh-ai-msg.notice{align-self:stretch;max-width:100%;background:#EDF5FC;color:var(--text-muted);text-align:center;font-size:12px}',
    '#samh-ai-form{padding:12px;border-top:1px solid var(--border-subtle);background:white;display:flex;gap:8px}',
    '#samh-ai-input{min-width:0;flex:1;resize:none;border:1px solid var(--border-subtle);border-radius:12px;padding:11px;font:13px var(--font-body);outline:none}',
    '#samh-ai-send{border:0;border-radius:12px;padding:0 16px;background:var(--c-ocean-deep);color:white;font:700 13px var(--font-body);cursor:pointer}',
    '#samh-ai-send:disabled{opacity:.55}',
    '#samh-ai-backdrop{position:fixed;inset:0;background:rgba(10,25,49,.12);z-index:3000;display:none}',
    '#samh-ai-backdrop.open{display:block}',
    '@media(max-width:900px){#samh-ai-panel{top:88px}}'
  ].join('');
  const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);

  const item=document.createElement('li');
  const navButton=document.createElement('button');
  navButton.id='samh-ai-nav-button';navButton.type='button';navButton.innerHTML='<i data-lucide="sparkles" style="width:15px;height:15px"></i><span>سَمْح AI</span>';
  item.appendChild(navButton);nav.appendChild(item);

  if(mobileDrawer){
    const mobileButton=document.createElement('button');
    mobileButton.id='samh-ai-mobile-button';mobileButton.type='button';mobileButton.textContent='✦ سَمْح AI';
    mobileDrawer.appendChild(mobileButton);
    mobileButton.addEventListener('click',()=>{mobileDrawer.classList.remove('open');openPanel();});
  }

  const backdrop=document.createElement('div');backdrop.id='samh-ai-backdrop';
  const panel=document.createElement('section');panel.id='samh-ai-panel';
  panel.setAttribute('aria-label','مساعد سَمْح الذكي');
  panel.innerHTML='<header id="samh-ai-head"><div><strong>سَمْح AI</strong><small>مساعدك الذكي</small></div><button id="samh-ai-close" type="button" aria-label="إغلاق">×</button></header><div id="samh-ai-messages"><div class="samh-ai-msg notice">أهلًا! أنا مساعد سَمْح الذكي. كيف أقدر أساعدك؟</div></div><form id="samh-ai-form"><textarea id="samh-ai-input" rows="1" maxlength="5000" placeholder="اكتب سؤالك هنا..." aria-label="رسالتك"></textarea><button id="samh-ai-send" type="submit">إرسال</button></form>';
  document.body.append(backdrop,panel);

  const list=panel.querySelector('#samh-ai-messages');
  const form=panel.querySelector('#samh-ai-form');
  const input=panel.querySelector('#samh-ai-input');
  const send=panel.querySelector('#samh-ai-send');
  const history=[];
  function add(message,role){const el=document.createElement('div');el.className='samh-ai-msg '+role;el.textContent=message;list.appendChild(el);list.scrollTop=list.scrollHeight;return el;}
  function openPanel(){panel.classList.add('open');backdrop.classList.add('open');input.focus();}
  function closePanel(){panel.classList.remove('open');backdrop.classList.remove('open');}
  navButton.addEventListener('click',openPanel);
  panel.querySelector('#samh-ai-close').addEventListener('click',closePanel);
  backdrop.addEventListener('click',closePanel);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closePanel();});
  form.addEventListener('submit',async e=>{
    e.preventDefault();const prompt=input.value.trim();if(!prompt||send.disabled)return;
    input.value='';add(prompt,'user');history.push({role:'user',text:prompt});send.disabled=true;send.textContent='...';const wait=add('سَمْح يفكر...','notice');
    try{
      const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history.slice(-12)})});
      const data=await response.json().catch(()=>({}));wait.remove();
      if(!response.ok)throw new Error(data.error||'تعذر الحصول على رد.');
      add(data.answer,'model');history.push({role:'model',text:data.answer});
    }catch(error){wait.remove();add(error.message||'حدث خطأ غير متوقع.','notice');}
    finally{send.disabled=false;send.textContent='إرسال';input.focus();}
  });
  if(typeof lucide!=='undefined')lucide.createIcons();
})();