// ========= Helpers =========
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if(k==='class') n.className=v;
    else if(k==='html') n.innerHTML=v;
    else if(k.startsWith('on') && typeof v==='function') n.addEventListener(k.substring(2), v);
    else n.setAttribute(k,v);
  });
  children.forEach(c => n.append(c));
  return n;
};
const screens = {
  loading: $('#scr-loading'),
  welcome: $('#scr-welcome'),
  quiz: $('#scr-quiz'),
  results: $('#scr-results'),
  review: $('#scr-review'),
};
function show(name){
  Object.values(screens).forEach(sc=>{
    sc.classList.remove('active');
    sc.setAttribute('aria-hidden','true');
  });
  screens[name].classList.add('active');
  screens[name].setAttribute('aria-hidden','false');
}

// ========= Global state =========
const STATE = {
  meta: {},
  all: [],
  picked: [],
  answers: [],
  seed: null,
  timer: null,
  timeLeft: 45*60,
  idx: 0,
  passThreshold: 0.75
};

// ========= Config JSON =========
const JSON_URL = "ifs-questions-full.json";
// Si besoin de charger depuis GitHub brut :
// const JSON_URL = "https://raw.githubusercontent.com/Visitune/QUIZZIFS/main/ifs-questions-full.json";

// ========= Correctif “mojibake” (accents cassés) =========
const AUTO_FIX_MOJIBAKE = true;
function looksMojibake(s){
  // Détection grossière de séquences erronées UTF-8 -> ISO-8859-1
  return /[\u00C2\u00C3\u00E2\uFFFD]/.test(s);
}
function fixStr(str){
  try { return decodeURIComponent(escape(str)); }
  catch { return str; }
}
function deepFix(obj){
  if (obj == null) return obj;
  if (typeof obj === 'string') return looksMojibake(obj) ? fixStr(obj) : obj;
  if (Array.isArray(obj)) return obj.map(deepFix);
  if (typeof obj === 'object'){
    const out = {};
    for (const k of Object.keys(obj)) out[k] = deepFix(obj[k]);
    return out;
  }
  return obj;
}

// ========= Data loading =========
async function loadQuestions(){
  $('#load-error').style.display='none';
  $('#load-msg').textContent = 'Récupération du fichier…';
  const res = await fetch(JSON_URL, { cache: 'no-store' });
  if(!res.ok) throw new Error('HTTP '+res.status);
  let data = await res.json();

  if (!Array.isArray(data)) {
    data = { metadata: data.metadata || {}, questions: data.questions || [] };
  } else {
    data = { metadata: {}, questions: data };
  }

  if (AUTO_FIX_MOJIBAKE) {
    const sample = JSON.stringify(data.questions.slice(0, 5));
    if (looksMojibake(sample)) data = deepFix(data);
  }

  if(!Array.isArray(data.questions) || data.questions.length===0) {
    throw new Error('Aucune question trouvée');
  }
  return data;
}

// ========= RNG =========
function hashSeed(s){
  let h = 2166136261 >>> 0;
  for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t>>>15, t | 1);
    t ^= t + Math.imul(t ^ t>>>7, t | 61);
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  }
}

// ========= Picking =========
function pickQuestions(all, k, seedStr){
  const seed = seedStr ? hashSeed(String(seedStr)) : Math.floor(Math.random()*1e9);
  const rng = mulberry32(seed);
  const idxs = all.map((_,i)=>i);
  for(let i=idxs.length-1;i>0;i--){
    const j = Math.floor(rng()*(i+1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  const chosen = idxs.slice(0, Math.min(k, idxs.length)).map(i=>all[i]);
  return { chosen, seed };
}

// ========= Welcome render =========
function renderWelcome(meta, picked){
  $('#stat-total').textContent = STATE.all.length.toString();
  $('#stat-picked').textContent = picked.length.toString();
  $('#stat-seed').textContent = STATE.seed;
  const cats = [...new Set(picked.map(q=>q.category).filter(Boolean))];
  $('#stat-cats').textContent = cats.length.toString();
  const chips = $('#chips'); chips.innerHTML = '';
  cats.slice(0, 30).forEach(c=>{
    const t = el('span', {class:'tag', style:'background:#eef6ff; color:#024eb8;'});
    t.textContent = c; chips.append(t);
  });
}

// ========= Question render =========
function renderQuestion(){
  const i = STATE.idx;
  const q = STATE.picked[i];
  $('#q-cat').textContent = q.category || 'Sans catégorie';
  $('#q-num').textContent = `Question ${i+1} / ${STATE.picked.length}`;
  $('#hint').textContent = `Question ${i+1} / ${STATE.picked.length}`;
  $('#q-text').textContent = q.question || '—';
  const opts = $('#q-opts'); opts.innerHTML='';
  (q.options || []).forEach((txt, k)=>{
    const id = `opt-${i}-${k}`;
    const wrap = el('label', {class:'opt', for:id});
    const input = el('input', {type:'radio', name:`q-${i}`, id, 'aria-label':`Option ${k+1}`});
    input.checked = (STATE.answers[i] === k);
    input.addEventListener('change', ()=>{ STATE.answers[i] = k; markSelected(); });
    const span = el('div', {class:'opt-text'});
    span.textContent = txt;
    wrap.append(input, span);
    opts.append(wrap);
  });
  markSelected();
  const pct = Math.round((i)/STATE.picked.length*100);
  $('#bar').style.width = pct+'%';
  $('#btn-prev').disabled = (i===0);
  $('#btn-next').disabled = (i===STATE.picked.length-1);
}
function markSelected(){
  document.querySelectorAll('.opt').forEach(l=>l.classList.remove('selected'));
  const i = STATE.idx;
  const val = STATE.answers[i];
  if(Number.isInteger(val)){
    const id = `opt-${i}-${val}`;
    const lab = document.querySelector(`label[for="${id}"]`);
    if(lab) lab.classList.add('selected');
  }
}

// ========= Navigation =========
function prev(){ if(STATE.idx>0){ STATE.idx--; renderQuestion(); } }
function next(){ if(STATE.idx<STATE.picked.length-1){ STATE.idx++; renderQuestion(); } }

// ========= Timer =========
function startTimer(){
  updateTimerText();
  STATE.timer = setInterval(()=>{
    STATE.timeLeft--;
    if(STATE.timeLeft<=0){
      clearInterval(STATE.timer);
      submit();
    }
    updateTimerText();
  }, 1000);
}
function updateTimerText(){
  const m = Math.floor(STATE.timeLeft/60);
  const s = STATE.timeLeft%60;
  $('#timer').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ========= Scoring =========
function submit(){
  if(screens.results.classList.contains('active')) return;
  document.querySelectorAll('.opt').forEach(l=>l.classList.remove('selected','correct','incorrect'));

  let good=0,bad=0,blank=0, points=0;
  STATE.picked.forEach((q,i)=>{
    const a = STATE.answers[i];
    if(a==null){ blank++; return; }
    const isGood = (a === q.correctAnswer);
    if(isGood){ good++; points += 1; }
    else { bad++; points -= 0.5; }
  });
  const total = STATE.picked.length;
  const pass = (points/total) >= STATE.passThreshold;

  $('#res-score').textContent = points.toFixed(2);
  $('#res-total').textContent = '/ ' + total;
  $('#stat-good').textContent = good;
  $('#stat-bad').textContent = bad;
  $('#stat-blank').textContent = blank;
  $('#res-msg').textContent = pass ? '✅ Réussi — Bravo !' : '❌ Non atteint — Réessaie avec une nouvelle sélection';

  clearInterval(STATE.timer);
  show('results');
}

// ========= Review =========
function renderReview(){
  const box = $('#review-list'); box.innerHTML='';
  STATE.picked.forEach((q,i)=>{
    const it = el('div', {class:'rev-item'});
    it.append(el('div', {class:'q-num', html:`<strong>Q${i+1}.</strong> <span class="tag" style="background:#0f6; color:#053"> ${q.category || '—'} </span>`}));
    it.append(el('div', {style:'margin:8px 0 10px;'}, q.question || '—'));

    const wrap = el('div');
    (q.options||[]).forEach((t,k)=>{
      const cls = ['rev-opt'];
      if(k === q.correctAnswer) cls.push('correct');
      if(STATE.answers[i] === k) cls.push('user');
      if(STATE.answers[i] === k && k !== q.correctAnswer) cls.push('incorrect');
      const line = el('div', {class:cls.join(' ')});
      line.innerHTML = `<i class="fa-regular fa-circle-check"></i> ${t}`;
      wrap.append(line);
    });
    it.append(wrap);

    if(q.explanation || q.regulation || (q.reference && (q.reference.source || q.reference.section))){
      const exp = el('div', {class:'exp'});
      if(q.explanation) exp.append(el('div', {}, q.explanation));
      if(q.regulation) exp.append(el('div', {style:'font-style:italic; color:#555'}, `Référence : ${q.regulation}`));
      if(q.reference && (q.reference.source || q.reference.section)){
        const r = q.reference;
        exp.append(el('div', {style:'font-style:italic; color:#555'}, `Source : ${[r.source, r.section].filter(Boolean).join(' – ')}`));
      }
      it.append(exp);
    }
    box.append(it);
  });
}

// ========= Export =========
function downloadResults(){
  const payload = {
    seed: STATE.seed,
    timeUsedSec: 45*60 - STATE.timeLeft,
    answers: STATE.answers,
    picked: STATE.picked.map(q=>({ id:q.id, category:q.category, correctAnswer:q.correctAnswer })),
    ts: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ifs-quiz-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ========= New session =========
function newSelection(meta){
  const url = new URL(location.href);
  const seedParam = url.searchParams.get('seed');
  const { chosen, seed } = pickQuestions(STATE.all, 20, seedParam || undefined);
  STATE.picked = chosen;
  STATE.answers = Array(STATE.picked.length).fill(null);
  STATE.seed = seed;
  STATE.idx = 0;
  STATE.timeLeft = 45*60;
  renderWelcome(meta, STATE.picked);
}

// ========= UI bindings =========
$('#btn-prev').addEventListener('click', prev);
$('#btn-next').addEventListener('click', next);
$('#btn-clear').addEventListener('click', ()=>{ STATE.answers[STATE.idx] = null; renderQuestion(); });
$('#btn-submit').addEventListener('click', submit);
$('#btn-review').addEventListener('click', ()=>{ renderReview(); show('review'); });
$('#btn-back-results').addEventListener('click', ()=> show('results'));
$('#btn-again').addEventListener('click', ()=>{ newSelection(STATE.meta); show('welcome'); });
$('#btn-new').addEventListener('click', ()=> newSelection(STATE.meta));
$('#btn-new2').addEventListener('click', ()=>{ newSelection(STATE.meta); show('welcome'); });
$('#btn-dl').addEventListener('click', downloadResults);

$('#btn-start').addEventListener('click', ()=>{
  show('quiz');
  startTimer();
  renderQuestion();
});

$('#btn-retry').addEventListener('click', async ()=>{
  $('#load-error').style.display='none';
  tryInit();
});

// ========= Init =========
async function tryInit(){
  show('loading');
  try{
    const data = await loadQuestions();
    STATE.meta = data.metadata || {};
    STATE.all = data.questions || [];
    newSelection(STATE.meta);
    show('welcome');
  }catch(err){
    console.error(err);
    $('#err-text').textContent = `Impossible de charger les questions (${err.message}). Assure-toi que "ifs-questions-full.json" est bien à la racine du dépôt et que GitHub Pages est activé.`;
    $('#load-error').style.display='inline-block';
    $('#load-msg').textContent = 'Échec du chargement.';
  }
}
tryInit();

// ========= Keyboard A11y =========
document.addEventListener('keydown', (e)=>{
  if(!screens.quiz.classList.contains('active')) return;
  if(e.key === 'ArrowRight') next();
  if(e.key === 'ArrowLeft') prev();
});
