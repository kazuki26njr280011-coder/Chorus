/* ============================================================
   Chorus — アプリ本体
   （このファイルは基本さわらなくてOK。設定は js/config.js へ）
   ============================================================ */
(() => {
'use strict';

/* ---------- 小さな道具たち ---------- */
const $  = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => Array.from((p || document).querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = n => Number(n).toLocaleString('ja-JP');
const normName = s => s.trim().normalize('NFC');

async function sha256(str){
  try{
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }catch(e){
    /* crypto.subtle が使えない古い環境向けの簡易ハッシュ */
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for(let i = 0; i < str.length; i++){
      h1 = ((h1 ^ str.charCodeAt(i)) * 16777619) >>> 0;
      h2 = ((h2 * 31) + str.charCodeAt(i)) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }
}

function el(tag, cls, text){
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(text != null) n.textContent = text;
  return n;
}

/* モデルアイコン（画像が無い時は頭文字を表示） */
function fillAvatar(span, model){
  span.replaceChildren();
  if(!model.icon){
    span.appendChild(el('span', 'monogram', model.name.charAt(0).toUpperCase()));
    return;
  }
  const img = document.createElement('img');
  img.alt = '';
  img.onerror = () => { img.remove(); span.appendChild(el('span', 'monogram', model.name.charAt(0).toUpperCase())); };
  img.src = model.icon;
  span.appendChild(img);
}
function avatarNode(model, cls){
  const s = el('span', 'model-avatar' + (cls ? ' ' + cls : ''));
  fillAvatar(s, model);
  return s;
}

/* ============================================================
   データ保存層
   Firebase設定があればFirebase、無ければ端末内保存（デモモード）
   ============================================================ */

class LocalStore{
  constructor(){ this.mode = 'demo'; this.user = null; }
  _db(){ try{ return JSON.parse(localStorage.getItem('chorus_users')) || {}; }catch(e){ return {}; } }
  _saveDb(db){ localStorage.setItem('chorus_users', JSON.stringify(db)); }
  _key(name){ return normName(name).toLowerCase(); }
  _patch(p){ const db = this._db(); Object.assign(db[this.user.uid], p); this._saveDb(db); }

  async init(){
    const k = localStorage.getItem('chorus_session');
    if(!k) return null;
    const db = this._db();
    if(!db[k]) return null;
    this.user = Object.assign({ uid: k }, db[k]);
    return this.user;
  }
  async signup(name, pin){
    const k = this._key(name);
    const db = this._db();
    if(db[k]) throw { code: 'exists' };
    const rec = {
      username: name,
      pinHash: await sha256(k + ':' + pin),
      credits: CONFIG.credits.signupBonus,
      timesClaimed: false,
      slackName: '',
      createdAt: Date.now(),
    };
    db[k] = rec;
    this._saveDb(db);
    localStorage.setItem('chorus_session', k);
    this.user = Object.assign({ uid: k }, rec);
    return this.user;
  }
  async login(name, pin){
    const k = this._key(name);
    const db = this._db();
    const rec = db[k];
    if(!rec || rec.pinHash !== await sha256(k + ':' + pin)) throw { code: 'badcred' };
    localStorage.setItem('chorus_session', k);
    this.user = Object.assign({ uid: k }, rec);
    return this.user;
  }
  async logout(){ localStorage.removeItem('chorus_session'); this.user = null; }
  async addCredits(d){ this.user.credits += d; this._patch({ credits: this.user.credits }); return this.user.credits; }
  async claimTimes(slackName){
    this.user.timesClaimed = true;
    this.user.slackName = slackName;
    this.user.credits += CONFIG.credits.timesBonus;
    this._patch({ timesClaimed: true, slackName, credits: this.user.credits });
  }
}

class FirebaseStore{
  constructor(){ this.mode = 'firebase'; this.user = null; }

  async init(){
    await loadFirebaseSdk();
    firebase.initializeApp(CONFIG.firebase);
    this.auth = firebase.auth();
    this.db = firebase.firestore();
    const fbUser = await new Promise(res => {
      const un = this.auth.onAuthStateChanged(u => { un(); res(u); });
    });
    if(!fbUser) return null;
    return await this._load(fbUser.uid);
  }
  _doc(uid){ return this.db.collection('users').doc(uid); }
  async _load(uid){
    const snap = await this._doc(uid).get();
    if(!snap.exists) return null;
    this.user = Object.assign({ uid }, snap.data());
    return this.user;
  }
  /* ユーザー名から内部用メールアドレスを作る（日本語名OKにするためハッシュ化） */
  async _email(name){
    const h = await sha256('chorus:' + normName(name).toLowerCase());
    return 'u' + h.slice(0, 24) + '@users.example.com';
  }
  _pw(name, pin){ return pin + ':' + normName(name).toLowerCase(); }

  async signup(name, pin){
    const email = await this._email(name);
    let cred;
    try{
      cred = await this.auth.createUserWithEmailAndPassword(email, this._pw(name, pin));
    }catch(e){
      if(e && e.code === 'auth/email-already-in-use') throw { code: 'exists' };
      console.error(e);
      throw { code: 'fb' };
    }
    const rec = {
      username: name,
      credits: CONFIG.credits.signupBonus,
      timesClaimed: false,
      slackName: '',
      createdAt: Date.now(),
    };
    await this._doc(cred.user.uid).set(rec);
    this.user = Object.assign({ uid: cred.user.uid }, rec);
    return this.user;
  }
  async login(name, pin){
    const email = await this._email(name);
    let cred;
    try{
      cred = await this.auth.signInWithEmailAndPassword(email, this._pw(name, pin));
    }catch(e){
      throw { code: 'badcred' };
    }
    let u = await this._load(cred.user.uid);
    if(!u){
      const rec = { username: name, credits: CONFIG.credits.signupBonus, timesClaimed: false, slackName: '', createdAt: Date.now() };
      await this._doc(cred.user.uid).set(rec);
      u = this.user = Object.assign({ uid: cred.user.uid }, rec);
    }
    return u;
  }
  async logout(){ await this.auth.signOut(); this.user = null; }
  async addCredits(d){
    this.user.credits += d;
    await this._doc(this.user.uid).update({ credits: firebase.firestore.FieldValue.increment(d) });
    return this.user.credits;
  }
  async claimTimes(slackName){
    this.user.timesClaimed = true;
    this.user.slackName = slackName;
    this.user.credits += CONFIG.credits.timesBonus;
    await this._doc(this.user.uid).update({
      timesClaimed: true,
      slackName,
      credits: firebase.firestore.FieldValue.increment(CONFIG.credits.timesBonus),
    });
  }
}

function loadScript(src){
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('script load failed: ' + src));
    document.head.appendChild(s);
  });
}
async function loadFirebaseSdk(){
  const base = 'https://www.gstatic.com/firebasejs/10.14.1/';
  await loadScript(base + 'firebase-app-compat.js');
  await loadScript(base + 'firebase-auth-compat.js');
  await loadScript(base + 'firebase-firestore-compat.js');
}
const hasFirebase = () => !!(CONFIG.firebase && CONFIG.firebase.apiKey);

/* ============================================================
   状態
   ============================================================ */
let store = null;
let me = null;                       // ログイン中のユーザー
let model = CONFIG.models[0];        // 選択中のモデル
let chat = [];                       // 会話履歴
let busy = false;
let displayedCredits = 0;
let creditAnim = null;

const screens = {
  loading: $('#screen-loading'),
  auth: $('#screen-auth'),
  app: $('#screen-app'),
};
function showScreen(name){
  Object.entries(screens).forEach(([k, n]) => n.classList.toggle('hidden', k !== name));
}

/* ============================================================
   起動（ローディング画面）
   ============================================================ */
async function boot(){
  const fill = $('#loadbarFill');
  requestAnimationFrame(() => { fill.style.width = '86%'; });
  const t0 = Date.now();

  let restored = null;
  if(hasFirebase()){
    try{
      store = new FirebaseStore();
      restored = await store.init();
    }catch(err){
      console.warn('Firebase初期化に失敗したため、デモモードで起動します:', err);
      store = null;
    }
  }
  if(!store){
    store = new LocalStore();
    restored = await store.init();
  }

  const wait = 2200 - (Date.now() - t0);
  if(wait > 0) await sleep(wait);
  fill.classList.add('done');
  fill.style.width = '100%';
  await sleep(420);
  screens.loading.classList.add('fade-out');
  await sleep(480);

  if(store.mode === 'demo') $('#demoBadge').classList.remove('hidden');

  if(restored){ me = restored; enterApp(false); }
  else showScreen('auth');
}

/* ============================================================
   認証画面
   ============================================================ */
let authMode = 'signup';
const pinBoxes = $$('.pin-box');
const getPin = () => pinBoxes.map(b => b.value).join('');

function setAuthMode(m){
  authMode = m;
  $('#tabSignup').classList.toggle('active', m === 'signup');
  $('#tabLogin').classList.toggle('active', m === 'login');
  $('#authSubmit').textContent = m === 'signup' ? 'アカウントを作成' : 'ログイン';
  const note = $('#authNote');
  note.replaceChildren();
  if(m === 'signup'){
    note.append('作成すると ');
    note.appendChild(el('b', null, fmt(CONFIG.credits.signupBonus)));
    note.append(' クレジットがもらえる');
  }else{
    note.append('PINを忘れた場合は復元できないよ（新しく登録してね）');
  }
  hideAuthError();
}
function showAuthError(msg){ const e = $('#authError'); e.textContent = msg; e.classList.remove('hidden'); }
function hideAuthError(){ $('#authError').classList.add('hidden'); }

pinBoxes.forEach((box, i) => {
  box.addEventListener('input', () => {
    box.value = box.value.replace(/\D/g, '').slice(-1);
    if(box.value && i < pinBoxes.length - 1) pinBoxes[i + 1].focus();
  });
  box.addEventListener('keydown', e => {
    if(e.key === 'Backspace' && !box.value && i > 0){
      pinBoxes[i - 1].value = '';
      pinBoxes[i - 1].focus();
      e.preventDefault();
    }
    if(e.key === 'Enter') submitAuth();
  });
  box.addEventListener('paste', e => {
    e.preventDefault();
    const digits = ((e.clipboardData.getData('text') || '').match(/\d/g) || []).slice(0, 4);
    digits.forEach((d, j) => { if(pinBoxes[j]) pinBoxes[j].value = d; });
    pinBoxes[Math.min(digits.length, pinBoxes.length - 1)].focus();
  });
});

async function submitAuth(){
  if(busy) return;
  hideAuthError();
  const name = normName($('#authName').value);
  const pin = getPin();
  if(!name){ showAuthError('ユーザー名を入力してね'); return; }
  if(name.length > 20){ showAuthError('ユーザー名は20文字までだよ'); return; }
  if(!/^\d{4}$/.test(pin)){ showAuthError('PINは4桁の数字で入力してね'); return; }

  busy = true;
  const btn = $('#authSubmit');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '通信中…';
  try{
    if(authMode === 'signup'){
      me = await store.signup(name, pin);
      pinBoxes.forEach(b => b.value = '');
      enterApp(true);
    }else{
      me = await store.login(name, pin);
      pinBoxes.forEach(b => b.value = '');
      enterApp(false);
    }
  }catch(err){
    if(err && err.code === 'exists') showAuthError('そのユーザー名はもう使われてる。「ログイン」を試してみて');
    else if(err && err.code === 'badcred') showAuthError('ユーザー名かPINが違うみたい');
    else { console.error(err); showAuthError('通信エラー。ネット接続を確認してもう一度試してね'); }
  }finally{
    busy = false;
    btn.disabled = false;
    btn.textContent = orig;
  }
}

$('#tabSignup').addEventListener('click', () => setAuthMode('signup'));
$('#tabLogin').addEventListener('click', () => setAuthMode('login'));
$('#authSubmit').addEventListener('click', submitAuth);
$('#authName').addEventListener('keydown', e => { if(e.key === 'Enter' && !e.isComposing) pinBoxes[0].focus(); });

/* ============================================================
   アプリ本体
   ============================================================ */
function enterApp(isNewAccount){
  showScreen('app');
  $('#userName').textContent = me.username;
  displayedCredits = me.credits;
  renderCredits(false);
  buildModelList();
  selectModel(CONFIG.models[0], true);
  loadChat();
  renderAllMessages();
  updateSendState();
  if(isNewAccount) openModal(creditGuideNode(true));
}

/* ---------- モデル選択 ---------- */
function buildModelList(){
  const list = $('#modelList');
  list.replaceChildren();
  CONFIG.models.forEach(m => {
    const card = el('button', 'model-card');
    card.type = 'button';
    card.dataset.model = m.id;
    card.appendChild(avatarNode(m));
    const col = el('div', 'model-col');
    col.appendChild(el('div', 'model-name', m.name));
    col.appendChild(el('div', 'model-tag', m.tagline));
    col.appendChild(el('span', 'model-cost', fmt(m.cost) + ' cr / 回'));
    card.appendChild(col);
    card.addEventListener('click', () => { selectModel(m); closeSidebar(); });
    list.appendChild(card);
  });
}

function selectModel(m, silent){
  const changed = model && model.id !== m.id;
  model = m;
  $$('.model-card').forEach(c => c.classList.toggle('active', c.dataset.model === m.id));
  fillAvatar($('#headAvatar'), m);
  $('#headModelName').textContent = m.name;
  $('#headModelCost').textContent = fmt(m.cost) + ' cr / メッセージ';
  $('#composerHint').textContent = '送信ごとに ' + fmt(m.cost) + ' クレジットを消費';
  if(!silent && changed && chat.length){
    pushMsg({ role: 'sys', text: m.name + ' に切替' });
  }
  if(!chat.length) renderAllMessages();
}

/* ---------- クレジット表示（数字がスルスル動く） ---------- */
function renderCredits(animate){
  const target = me ? me.credits : 0;
  const draw = v => {
    const n = fmt(Math.round(v));
    $('#creditValue').textContent = n;
    $('#headCredits').textContent = n + ' cr';
  };
  if(creditAnim) cancelAnimationFrame(creditAnim);
  if(!animate){ displayedCredits = target; draw(target); return; }
  const from = displayedCredits;
  const diff = target - from;
  const t0 = performance.now();
  const dur = 650;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    displayedCredits = from + diff * eased;
    draw(displayedCredits);
    creditAnim = p < 1 ? requestAnimationFrame(step) : null;
  };
  creditAnim = requestAnimationFrame(step);
}

/* ---------- 会話の保存・描画 ---------- */
const chatKey = () => 'chorus_chat_' + me.uid;
function loadChat(){
  try{ chat = JSON.parse(localStorage.getItem(chatKey())) || []; }
  catch(e){ chat = []; }
}
function saveChat(){
  try{ localStorage.setItem(chatKey(), JSON.stringify(chat.slice(-80))); }catch(e){}
}
function scrollBottom(){
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
}

/* ---------- AI回答の整形（簡易Markdown → 安全なHTML） ---------- */
function escapeHtml(s){
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inlineMd(s){
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
/* 改行のない長文は「。」ごとに2文ずつ段落に分けて読みやすく */
function autoBreak(t){
  if(/\n/.test(t) || t.length < 160) return t;
  const parts = t.match(/[^。]+。?/g) || [t];
  const out = [];
  for(let i = 0; i < parts.length; i += 2) out.push(parts.slice(i, i + 2).join(''));
  return out.join('\n\n');
}
function mdToHtml(src){
  const lines = escapeHtml(String(src).trim()).split('\n');
  const out = [];
  let para = [], list = null, listTag = '';
  const flushPara = () => { if(para.length){ out.push('<p>' + para.map(inlineMd).join('<br>') + '</p>'); para = []; } };
  const flushList = () => { if(list){ out.push('<' + listTag + '>' + list.join('') + '</' + listTag + '>'); list = null; } };

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];

    /* コードブロック ``` 〜 ``` */
    if(line.startsWith('```')){
      flushPara(); flushList();
      const buf = [];
      i++;
      while(i < lines.length && !lines[i].startsWith('```')){ buf.push(lines[i]); i++; }
      out.push('<pre><code>' + buf.join('\n') + '</code></pre>');
      continue;
    }
    /* 見出し # 〜 #### */
    const h = line.match(/^#{1,4}\s+(.+)/);
    if(h){ flushPara(); flushList(); out.push('<div class="md-h">' + inlineMd(h[1]) + '</div>'); continue; }

    /* 箇条書き（- * ・）と番号リスト（1. など） */
    const ul = line.match(/^\s*(?:[-*]\s+|・\s*)(.+)/);
    const ol = ul ? null : line.match(/^\s*\d+[.．)）]\s+(.+)/);
    if(ul || ol){
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if(list && listTag !== tag) flushList();
      if(!list){ list = []; listTag = tag; }
      list.push('<li>' + inlineMd((ul || ol)[1]) + '</li>');
      continue;
    }
    /* 空行 = 段落の区切り */
    if(!line.trim()){ flushPara(); flushList(); continue; }
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('');
}

function msgNode(m){
  if(m.role === 'sys') return el('div', 'sys-divider', m.text);
  if(m.role === 'cmd') return cmdNode(m);
  if(m.role === 'debate') return debateNode(m);
  const row = el('div', 'msg-row ' + m.role);
  const body = el('div', 'msg-body');
  if(m.role === 'ai'){
    const mm = m.custom
      ? { name: m.metaLabel, icon: m.iconSrc || '' }
      : (CONFIG.models.find(x => x.id === m.modelId) || model);
    row.appendChild(avatarNode(mm, 'sm msg-avatar'));
    body.appendChild(el('div', 'msg-meta', mm.name));
    const bub = el('div', 'msg-bubble md' + (m.error ? ' error' : ''));
    bub.innerHTML = mdToHtml(autoBreak(m.text));   /* escapeHtml済みなので安全 */
    body.appendChild(bub);
  }else{
    body.appendChild(el('div', 'msg-bubble', m.text));
  }
  row.appendChild(body);
  return row;
}

function renderAllMessages(){
  const box = $('#messages');
  box.replaceChildren();
  if(!chat.length){
    const empty = el('div', 'empty-state');
    empty.appendChild(avatarNode(model, 'xl'));
    empty.appendChild(el('div', 'empty-title', model.name + ' に話しかけてみよう'));
    empty.appendChild(el('div', 'empty-sub', 'Enterで送信 ／ Shift+Enterで改行 ／ 「/」でコマンドモード'));
    const chips = el('div', 'chips');
    ['自己紹介して', '面白い雑学を教えて', '今日の話し相手になって'].forEach(t => {
      const c = el('button', 'chip', t);
      c.type = 'button';
      c.addEventListener('click', () => {
        inputEl.value = t;
        autoGrow();
        updateSendState();
        inputEl.focus();
      });
      chips.appendChild(c);
    });
    empty.appendChild(chips);
    box.appendChild(empty);
    return;
  }
  chat.forEach(m => box.appendChild(msgNode(m)));
  scrollBottom();
}

function pushMsg(m){
  const box = $('#messages');
  if(!chat.length) box.replaceChildren();  /* 空状態の表示を消す */
  chat.push(m);
  saveChat();
  box.appendChild(msgNode(m));
  scrollBottom();
}

/* ---------- 思考中表示 ---------- */
function thinkingNode(m){
  const row = el('div', 'msg-row ai');
  row.appendChild(avatarNode(m, 'sm msg-avatar'));
  const body = el('div', 'msg-body');
  body.appendChild(el('div', 'msg-meta', m.name));
  const bub = el('div', 'msg-bubble');
  const wrap = el('div', 'think-wrap');
  wrap.appendChild(el('span', 'think-dot'));
  const txt = el('span', 'think-text', m.thinking[0] + '…');
  wrap.appendChild(txt);
  bub.appendChild(wrap);
  body.appendChild(bub);
  row.appendChild(body);

  const swapTo = t => {
    txt.classList.add('swap');
    setTimeout(() => {
      txt.textContent = t + '…';
      txt.classList.remove('swap');
    }, 250);
  };
  let i = 0;
  const iv = setInterval(() => {
    i = (i + 1) % m.thinking.length;
    swapTo(m.thinking[i]);
  }, Math.max(1200, Math.floor(m.minThinkMs / m.thinking.length)));

  row._stop = () => clearInterval(iv);
  /* 本物のパイプラインの進行に合わせて表示を切替（自動サイクルは停止する） */
  row._setStage = t => { clearInterval(iv); swapTo(t); };
  return row;
}

/* ---------- 送信 ---------- */
const inputEl = $('#input');

function autoGrow(){
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
}
function updateSendState(){
  $('#btnSend').disabled = busy || debateActive || !inputEl.value.trim();
}

async function onSend(){
  const text = inputEl.value.trim();
  if(!text || busy || !me || debateActive) return;

  /* コマンドモード（「/」始まり） */
  if(text.startsWith('/')){
    inputEl.value = '';
    autoGrow(); updateSendState(); hidePalette();
    await runCommand(text);
    inputEl.focus();
    return;
  }

  if(me.credits < model.cost){ openInsufficientModal(); return; }
  inputEl.value = '';
  autoGrow();
  await performSend(model, text);
  inputEl.focus();
}

/* 任意のモデルで1往復（通常送信と /multi が共用） */
async function performSend(m, text){
  busy = true;
  updateSendState();
  pushMsg({ role: 'user', text });

  try{ await store.addCredits(-m.cost); }
  catch(e){ console.warn('クレジットの保存に失敗:', e); }
  renderCredits(true);

  const think = thinkingNode(m);
  $('#messages').appendChild(think);
  scrollBottom();

  const t0 = Date.now();
  let reply = null, failed = false;
  try{ reply = await callAI(text, m, think._setStage); }
  catch(err){ console.error(err); failed = true; }

  const rest = m.minThinkMs - (Date.now() - t0);
  if(rest > 0) await sleep(rest);

  think._stop();
  think.remove();

  if(failed){
    try{ await store.addCredits(m.cost); }catch(e){}
    renderCredits(true);
    pushMsg({
      role: 'ai', modelId: m.id, error: true,
      text: 'Miiboに接続できなかった（クレジットは返却したよ）。js/config.js のAPIキー・エージェントIDと、ネット接続を確認してね。',
    });
  }else{
    pushMsg({ role: 'ai', modelId: m.id, text: reply });
  }

  busy = false;
  updateSendState();
}

/* ============================================================
   Miibo API 呼び出し（AIパイプライン）
   ・multi  : 質問→ChatGPT/Claude/Geminiに同時送信→全回答を統合役へ
   ・direct : 1体のエージェントに送るだけ（Max）
   ============================================================ */

/* 1体のエージェントに発話を送って返事をもらう */
async function miiboAsk(agent, utterance, uid){
  const res = await fetch(CONFIG.miibo.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: agent.apiKey,
      agent_id: agent.agentId,
      utterance: utterance,
      uid: uid || ('chorus_' + me.uid),
    }),
  });
  if(!res.ok) throw new Error('Miibo HTTP ' + res.status);
  const data = await res.json();
  const out = data && data.bestResponse && data.bestResponse.utterance;
  if(!out) throw new Error('Miibo empty response');
  return out;
}

/* このモデルを動かすのに足りない設定のリストを返す */
function missingKeys(m){
  const miss = [];
  const chk = (obj, path) => {
    if(!obj || !obj.apiKey)  miss.push(path + '.apiKey');
    if(!obj || !obj.agentId) miss.push(path + '.agentId');
  };
  if(m.type === 'multi'){
    chk(CONFIG.workers && CONFIG.workers.chatgpt, 'workers.chatgpt');
    chk(CONFIG.workers && CONFIG.workers.claude,  'workers.claude');
    chk(CONFIG.workers && CONFIG.workers.gemini,  'workers.gemini');
  }
  chk(m.agent, 'models「' + m.name + '」の agent');
  return miss;
}

function demoReply(m, missing){
  return '（デモ応答）「' + m.name + '」を動かすには、js/config.js の以下が未設定だよ：\n\n・'
    + missing.join('\n・')
    + '\n\n全部設定すると本物のAIパイプラインが動く。手順は README.md を見てね。';
}

/* モデルの方式に応じて呼び分け */
async function callAI(text, m, setStage){
  const missing = missingKeys(m);
  if(missing.length){
    await sleep(800);
    return demoReply(m, missing);
  }
  if(m.type === 'multi') return callMulti(text, m, setStage);
  return miiboAsk(m.agent, text);
}

/* MultiAi系：3体に同時に質問 → 全回答をまとめて統合役へ */
async function callMulti(text, m, setStage){
  const workers = [
    ['ChatGPT', CONFIG.workers.chatgpt, 'chatgpt'],
    ['Claude',  CONFIG.workers.claude,  'claude'],
    ['Gemini',  CONFIG.workers.gemini,  'gemini'],
  ];

  setStage('ChatGPT・Claude・Gemini に質問中');
  let done = 0;
  let okCount = 0;
  const answers = {};

  await Promise.all(workers.map(async ([label, agent, key]) => {
    try{
      answers[key] = await miiboAsk(agent, text);
      okCount++;
    }catch(e){
      console.warn(label + ' の呼び出しに失敗:', e);
      answers[key] = '（' + label + ' は回答できなかった）';
    }
    done++;
    setStage(label + ' の回答を受信（' + done + '/3）');
  }));

  if(okCount === 0) throw new Error('素材AI（ChatGPT/Claude/Gemini）が全て失敗した');

  /* テンプレートに質問と3体の回答を埋め込む */
  const fill = (tpl, key, val) => tpl.split('{' + key + '}').join(val);
  let prompt = CONFIG.multiPrompt;
  prompt = fill(prompt, 'question', text);
  prompt = fill(prompt, 'chatgpt', answers.chatgpt);
  prompt = fill(prompt, 'claude',  answers.claude);
  prompt = fill(prompt, 'gemini',  answers.gemini);

  setStage(m.name + ' が統合中');
  return await miiboAsk(m.agent, prompt);
}

/* ============================================================
   コマンドモード（「/」でコマンドパレット）
   ============================================================ */
const CMDS = [
  { cmd: '/help',   args: '',                       desc: 'コマンドと使えるAIの一覧を表示' },
  { cmd: '/direct', args: '<ai名> <メッセージ>',      desc: '指定AIに直接送信（例: /direct claude やあ）' },
  { cmd: '/multi',  args: '<モード名> <メッセージ>',   desc: '指定モードでマルチAI実行（authentic / xhigh）' },
  { cmd: '/debate', args: '',                       desc: '対論モードのセットアップを開く' },
  { cmd: '/clear',  args: '',                       desc: '会話履歴をクリア' },
];
const WORKER_LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };
let palIndex = 0;

function paletteEl(){ return $('#cmdPalette'); }
function hidePalette(){ paletteEl().classList.add('hidden'); }
function applyPalette(c){
  inputEl.value = c.cmd + (c.args ? ' ' : '');
  autoGrow(); updateSendState(); renderPalette(); inputEl.focus();
}
function renderPalette(){
  const pal = paletteEl();
  const v = inputEl.value;
  if(!v.startsWith('/') || debateActive){ hidePalette(); return; }
  const word = v.split(/\s+/)[0].toLowerCase();
  if(v.includes(' ') && CMDS.some(c => c.cmd === word)){ hidePalette(); return; }
  const list = CMDS.filter(c => c.cmd.startsWith(word));
  if(!list.length){ hidePalette(); return; }
  if(palIndex >= list.length) palIndex = 0;
  pal.replaceChildren();
  const head = el('div', 'pal-head');
  head.appendChild(el('span', 'pal-title', 'COMMAND MODE'));
  head.appendChild(el('span', 'pal-hint', '↑↓選択 · Tab補完 · Enter実行 · Esc閉じる'));
  pal.appendChild(head);
  list.forEach((c, i) => {
    const item = el('div', 'pal-item' + (i === palIndex ? ' sel' : ''));
    const l1 = el('div', 'pal-cmd');
    l1.appendChild(el('span', 'pal-prompt', '❯'));
    l1.appendChild(el('span', 'pal-name', c.cmd));
    if(c.args) l1.appendChild(el('span', 'pal-args', ' ' + c.args));
    item.appendChild(l1);
    item.appendChild(el('div', 'pal-desc', c.desc));
    item.addEventListener('mousedown', e => { e.preventDefault(); palIndex = i; applyPalette(c); });
    pal.appendChild(item);
  });
  pal._list = list;
  pal.classList.remove('hidden');
}

/* コマンド実行結果のターミナル風カード */
function cmdNode(m){
  const card = el('div', 'cmd-card');
  const head = el('div', 'cmd-card-head');
  head.appendChild(el('span', 'cmd-dot r'));
  head.appendChild(el('span', 'cmd-dot y'));
  head.appendChild(el('span', 'cmd-dot g'));
  head.appendChild(el('span', 'cmd-card-title', 'CHORUS COMMAND'));
  card.appendChild(head);
  const bodyEl = el('div', 'cmd-card-body');
  const line = el('div', 'cmd-line');
  line.appendChild(el('span', 'cmd-prompt', '❯'));
  line.appendChild(el('span', 'cmd-input', m.cmd));
  bodyEl.appendChild(line);
  const out = el('div', 'cmd-out' + (m.error ? ' err' : ''), m.text);
  bodyEl.appendChild(out);
  card.appendChild(bodyEl);
  return card;
}

function pushCmd(cmdText, outText, isErr){
  pushMsg({ role: 'cmd', cmd: cmdText, text: outText, error: !!isErr });
}

function directList(){
  const ws = Object.keys(WORKER_LABELS).filter(k => CONFIG.workers && CONFIG.workers[k]);
  return ws.concat(CONFIG.models.filter(x => x.type === 'direct').map(x => x.id));
}
function helpText(){
  return 'コマンド一覧\n'
    + '  /help                    この一覧を表示\n'
    + '  /direct <ai名> <文>      指定AIに直接送信\n'
    + '  /multi <モード> <文>     指定モードでマルチAI実行\n'
    + '  /debate                  対論モードを開く\n'
    + '  /clear                   会話履歴をクリア\n\n'
    + '使えるAI名（/direct）: ' + directList().join(' / ') + '\n'
    + 'モード名（/multi）: ' + CONFIG.models.filter(x => x.type === 'multi').map(x => x.id).join(' / ');
}

function resolveDirectTarget(nameRaw){
  const n = (nameRaw || '').toLowerCase();
  const alias = { gpt: 'chatgpt', chatgpt: 'chatgpt', claude: 'claude', gemini: 'gemini' };
  if(alias[n] && CONFIG.workers && CONFIG.workers[alias[n]]){
    return {
      label: WORKER_LABELS[alias[n]],
      agent: CONFIG.workers[alias[n]],
      cost: CONFIG.directCost || 100,
      icon: '',
    };
  }
  const mdl = CONFIG.models.find(x => x.type === 'direct' && (x.id.toLowerCase() === n || x.name.toLowerCase() === n));
  if(mdl) return { label: mdl.name, agent: mdl.agent, cost: mdl.cost, icon: mdl.icon };
  return null;
}

async function runCommand(raw){
  const parts = raw.trim().split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();

  if(cmd === '/help'){ pushCmd(raw, helpText()); return; }
  if(cmd === '/clear'){ chat = []; saveChat(); renderAllMessages(); return; }
  if(cmd === '/debate'){ openDebateSetup(); return; }

  if(cmd === '/direct'){
    const target = resolveDirectTarget(parts[1]);
    const msg = parts.slice(2).join(' ');
    if(!target){ pushCmd(raw, '不明なAI名だよ。使えるAI: ' + directList().join(' / ') + '\n例: /direct claude こんにちは', true); return; }
    if(!msg){ pushCmd(raw, 'メッセージが空だよ。例: /direct ' + parts[1] + ' こんにちは', true); return; }
    await sendDirect(target, msg, raw);
    return;
  }

  if(cmd === '/multi'){
    const modeRaw = (parts[1] || '').toLowerCase();
    const mdl = modeRaw ? CONFIG.models.find(x => x.type === 'multi' && x.id.toLowerCase().startsWith(modeRaw)) : null;
    const msg = parts.slice(2).join(' ');
    if(!mdl){ pushCmd(raw, '不明なモードだよ。使えるモード: ' + CONFIG.models.filter(x => x.type === 'multi').map(x => x.id).join(' / '), true); return; }
    if(!msg){ pushCmd(raw, 'メッセージが空だよ。例: /multi ' + mdl.id + ' こんにちは', true); return; }
    if(me.credits < mdl.cost){ openInsufficientModal(); return; }
    await performSend(mdl, msg);
    return;
  }

  pushCmd(raw, '不明なコマンド。/help で一覧を見られるよ。', true);
}

/* /direct の実行 */
async function sendDirect(target, text, raw){
  if(!target.agent || !target.agent.apiKey || !target.agent.agentId){
    pushCmd(raw, '「' + target.label + '」のAPIキー / エージェントIDが js/config.js に未設定だよ。', true);
    return;
  }
  if(me.credits < target.cost){ openInsufficientModal(); return; }
  busy = true; updateSendState();
  pushMsg({ role: 'user', text });
  try{ await store.addCredits(-target.cost); }catch(e){}
  renderCredits(true);

  const think = thinkingNode({ name: target.label, icon: target.icon || '', thinking: [target.label + ' が思考中'], minThinkMs: 700 });
  $('#messages').appendChild(think);
  scrollBottom();

  const t0 = Date.now();
  let reply = null, failed = false;
  try{ reply = await miiboAsk(target.agent, text); }
  catch(e){ console.error(e); failed = true; }
  const rest = 700 - (Date.now() - t0);
  if(rest > 0) await sleep(rest);
  think._stop(); think.remove();

  if(failed){
    try{ await store.addCredits(target.cost); }catch(e){}
    renderCredits(true);
    pushMsg({ role: 'ai', custom: true, metaLabel: target.label + ' · direct', iconSrc: target.icon || '', error: true,
      text: '接続エラー（クレジットは返却したよ）。APIキー・エージェントIDを確認してね。' });
  }else{
    pushMsg({ role: 'ai', custom: true, metaLabel: target.label + ' · direct', iconSrc: target.icon || '', text: reply });
  }
  busy = false; updateSendState();
}

/* ============================================================
   対論モード
   ============================================================ */
let debateActive = false;
let debateStop = false;

function debateConf(){
  const d = CONFIG.debate || {};
  return {
    costPerTurn: d.costPerTurn || 150,
    prompt: d.prompt ||
      'あなたはディベート大会に出場している討論者です。\nテーマ: {theme}\nあなたの立場: {position}\n相手: {opponent}\n\nルール（絶対厳守）:\n・絶対に相手に同意しない。「それもいいですね」「一理ある」等の同調・譲歩表現は禁止\n・常に自分の立場を貫き、相手の主張の矛盾や弱点を具体的に指摘して反論する\n・根拠か具体例を必ず1つ以上入れる\n・250文字以内。挨拶や前置きは不要、いきなり主張から始める\n\n{context}',
    firstContext: d.firstContext || 'あなたが先攻です。最初の主張を述べてください。',
    replyContext: d.replyContext || '相手の直前の主張:\n「{last}」\nこれに真っ向から反論し、自分の立場を主張してください。',
  };
}
function buildDebatePrompt(cfg, side, other, last){
  const dc = debateConf();
  const ctx = (last == null) ? dc.firstContext : dc.replyContext.split('{last}').join(last);
  return dc.prompt
    .split('{theme}').join(cfg.theme)
    .split('{position}').join(side.position)
    .split('{opponent}').join(other.label + '（立場: ' + other.position + '）')
    .split('{context}').join(ctx);
}

/* 対論の吹き出し（Aは左・青系、Bは右・琥珀系） */
function debateNode(m){
  const row = el('div', 'msg-row ai debate ' + (m.side === 'a' ? 'debate-a' : 'debate-b'));
  const body = el('div', 'msg-body');
  body.appendChild(el('div', 'msg-meta', m.label + ' ─ 「' + m.position + '」派'));
  const bub = el('div', 'msg-bubble md');
  bub.innerHTML = mdToHtml(autoBreak(m.text));
  body.appendChild(bub);
  row.appendChild(body);
  return row;
}

function showDebateBar(){
  const bar = $('#debateBar');
  bar.replaceChildren();
  bar.appendChild(el('span', 'debate-live'));
  bar.appendChild(el('span', 'debate-info', '対論中'));
  const stat = el('span', 'debate-stat', 'ターン 0 ・ 0 cr');
  stat.id = 'debateStat';
  bar.appendChild(stat);
  bar.appendChild(el('span', 'head-spacer'));
  const stop = el('button', 'btn danger slim', '■ 停止');
  stop.type = 'button';
  stop.addEventListener('click', () => { debateStop = true; stop.disabled = true; stop.textContent = '停止中…'; });
  bar.appendChild(stop);
  bar.classList.remove('hidden');
  $('.composer').classList.add('hidden');
  $('#composerHint').classList.add('hidden');
}
function hideDebateBar(){
  $('#debateBar').classList.add('hidden');
  $('.composer').classList.remove('hidden');
  $('#composerHint').classList.remove('hidden');
}
function updateDebateBar(turn, spent){
  const s = $('#debateStat');
  if(s) s.textContent = 'ターン ' + turn + ' ・ ' + fmt(spent) + ' cr';
}

/* 対論セットアップ画面 */
function openDebateSetup(){
  const dc = debateConf();
  const box = el('div');
  box.appendChild(el('div', 'modal-eyebrow', 'DEBATE'));
  box.appendChild(el('div', 'modal-title', '対論モード'));
  box.appendChild(el('p', 'modal-desc',
    '2体のAIが1つのテーマで討論する。停止ボタンを押すまで交互に主張し続ける（1ターン ' + fmt(dc.costPerTurn) + ' cr消費）。'));

  const sTheme = el('div', 'm-section');
  sTheme.appendChild(el('div', 'm-section-title', 'テーマ'));
  const themeIn = el('input', 'text-input');
  themeIn.type = 'text';
  themeIn.placeholder = '例：制服は必要か';
  themeIn.maxLength = 60;
  sTheme.appendChild(themeIn);
  box.appendChild(sTheme);

  const picks = { a: null, b: null, first: 'a' };
  const posIn = {};
  const chipRows = {};
  const workerKeys = Object.keys(WORKER_LABELS);

  const refresh = () => {
    ['a', 'b'].forEach(sk => {
      const otherPick = picks[sk === 'a' ? 'b' : 'a'];
      Array.from(chipRows[sk].children).forEach(ch => {
        ch.classList.toggle('on', picks[sk] === ch.dataset.k);
        ch.disabled = otherPick === ch.dataset.k;   /* 同じAIは選べない */
      });
    });
  };
  const mkSide = (sideKey, title, posEx) => {
    const s = el('div', 'm-section');
    s.appendChild(el('div', 'm-section-title', title));
    const row = el('div', 'chip-row');
    workerKeys.forEach(k => {
      const c = el('button', 'pick-chip', WORKER_LABELS[k]);
      c.type = 'button';
      c.dataset.k = k;
      c.addEventListener('click', () => { picks[sideKey] = k; refresh(); });
      row.appendChild(c);
    });
    chipRows[sideKey] = row;
    s.appendChild(row);
    const p = el('input', 'text-input field-gap');
    p.type = 'text';
    p.placeholder = '立場（例：' + posEx + '）';
    p.maxLength = 30;
    posIn[sideKey] = p;
    s.appendChild(p);
    return s;
  };
  box.appendChild(mkSide('a', '討論者A', '必要'));
  box.appendChild(mkSide('b', '討論者B', '不必要'));

  const sFirst = el('div', 'm-section');
  sFirst.appendChild(el('div', 'm-section-title', '先攻'));
  const fRow = el('div', 'chip-row');
  const fa = el('button', 'pick-chip on', 'A が先攻');
  const fb = el('button', 'pick-chip', 'B が先攻');
  fa.type = fb.type = 'button';
  fa.addEventListener('click', () => { picks.first = 'a'; fa.classList.add('on'); fb.classList.remove('on'); });
  fb.addEventListener('click', () => { picks.first = 'b'; fb.classList.add('on'); fa.classList.remove('on'); });
  fRow.appendChild(fa);
  fRow.appendChild(fb);
  sFirst.appendChild(fRow);
  box.appendChild(sFirst);

  const errP = el('p', 'modal-desc err-text field-gap hidden');
  box.appendChild(errP);
  const showErr = t => { errP.textContent = t; errP.classList.remove('hidden'); };

  const actions = el('div', 'modal-actions');
  const start = el('button', 'btn primary', '対論を開始');
  const cancel = el('button', 'btn ghost', '閉じる');
  start.type = cancel.type = 'button';
  cancel.addEventListener('click', closeModal);
  start.addEventListener('click', () => {
    errP.classList.add('hidden');
    const theme = themeIn.value.trim();
    const pa = posIn.a.value.trim(), pb = posIn.b.value.trim();
    if(!theme) return showErr('テーマを入力してね');
    if(!picks.a || !picks.b) return showErr('AとBのAIを選んでね');
    if(!pa || !pb) return showErr('両方の立場を入力してね');
    for(const k of [picks.a, picks.b]){
      const w = CONFIG.workers && CONFIG.workers[k];
      if(!w || !w.apiKey || !w.agentId) return showErr(WORKER_LABELS[k] + ' のAPIキー/エージェントIDが config.js に未設定だよ');
    }
    if(me.credits < dc.costPerTurn) return showErr('クレジットが足りない（1ターン ' + fmt(dc.costPerTurn) + ' cr）');
    runDebate({
      theme,
      a: { key: picks.a, label: WORKER_LABELS[picks.a], position: pa },
      b: { key: picks.b, label: WORKER_LABELS[picks.b], position: pb },
      first: picks.first,
    });
  });
  actions.appendChild(start);
  actions.appendChild(cancel);
  box.appendChild(actions);

  openModal(box);
}

/* 対論の本体ループ：停止を押すまで交互に主張し続ける */
async function runDebate(cfg){
  debateActive = true;
  debateStop = false;
  closeModal();
  closeSidebar();
  showDebateBar();
  updateSendState();
  const dc = debateConf();
  const sid = Date.now().toString(36);
  pushMsg({ role: 'sys', text: '対論開始「' + cfg.theme + '」 ' + cfg.a.label + '（' + cfg.a.position + '）vs ' + cfg.b.label + '（' + cfg.b.position + '）' });

  let turnSide = cfg.first;
  let last = null, turn = 0, spent = 0;

  while(!debateStop){
    const side = cfg[turnSide];
    const other = cfg[turnSide === 'a' ? 'b' : 'a'];
    if(me.credits < dc.costPerTurn){
      pushMsg({ role: 'sys', text: 'クレジット不足のため自動停止' });
      break;
    }
    try{ await store.addCredits(-dc.costPerTurn); }catch(e){}
    renderCredits(true);
    spent += dc.costPerTurn;
    updateDebateBar(turn + 1, spent);

    const think = thinkingNode({ name: side.label, icon: '', thinking: [side.label + ' が主張を準備中'], minThinkMs: 1200 });
    $('#messages').appendChild(think);
    scrollBottom();

    const t0 = Date.now();
    let reply = null, failed = false;
    try{
      reply = await miiboAsk(CONFIG.workers[side.key], buildDebatePrompt(cfg, side, other, last), 'chorus_debate_' + sid + '_' + side.key);
    }catch(e){ console.error(e); failed = true; }
    const rest = 1500 - (Date.now() - t0);
    if(rest > 0) await sleep(rest);
    think._stop();
    think.remove();

    if(failed){
      try{ await store.addCredits(dc.costPerTurn); }catch(e){}
      renderCredits(true);
      spent -= dc.costPerTurn;
      pushMsg({ role: 'sys', text: '接続エラーのため自動停止（このターン分は返却）' });
      break;
    }
    pushMsg({ role: 'debate', side: turnSide, label: side.label, position: side.position, text: reply });
    last = reply;
    turn++;
    turnSide = turnSide === 'a' ? 'b' : 'a';

    /* 読みやすさ＋API制限対策の小休止（停止ボタンに即反応できるよう小刻みに待つ） */
    for(let w = 0; w < 14 && !debateStop; w++) await sleep(100);
  }

  pushMsg({ role: 'sys', text: '対論終了 ─ ' + turn + 'ターン / ' + fmt(spent) + ' cr 消費' });
  hideDebateBar();
  debateActive = false;
  updateSendState();
}

/* ============================================================
   アップデート履歴
   ============================================================ */
function changelogNode(){
  const wrap = el('div');
  const list = CONFIG.updates || [];
  list.forEach(u => {
    const s = el('div', 'm-section');
    const head = el('div', 'upd-head');
    head.appendChild(el('span', 'upd-ver', u.version));
    head.appendChild(el('span', 'upd-date', u.date));
    s.appendChild(head);
    const ul = el('ul', 'upd-list');
    (u.items || []).forEach(it => ul.appendChild(el('li', null, it)));
    s.appendChild(ul);
    wrap.appendChild(s);
  });
  if(!list.length) wrap.appendChild(el('p', 'modal-desc', '履歴はまだないよ。config.js の updates に追加できる。'));
  return wrap;
}

/* ---------- 入力欄のイベント ---------- */
inputEl.addEventListener('input', () => { autoGrow(); updateSendState(); renderPalette(); });
inputEl.addEventListener('blur', () => setTimeout(hidePalette, 150));
inputEl.addEventListener('keydown', e => {
  const pal = paletteEl();
  if(!pal.classList.contains('hidden')){
    const list = pal._list || [];
    if(e.key === 'ArrowDown'){ e.preventDefault(); palIndex = (palIndex + 1) % list.length; renderPalette(); return; }
    if(e.key === 'ArrowUp'){ e.preventDefault(); palIndex = (palIndex - 1 + list.length) % list.length; renderPalette(); return; }
    if(e.key === 'Escape'){ hidePalette(); return; }
    if(e.key === 'Tab'){ e.preventDefault(); if(list[palIndex]) applyPalette(list[palIndex]); return; }
    if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
      const sel = list[palIndex];
      if(sel && !inputEl.value.includes(' ') && inputEl.value.trim() !== sel.cmd){
        e.preventDefault();
        applyPalette(sel);
        return;
      }
    }
  }
  if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
    e.preventDefault();
    onSend();
  }
});
$('#btnSend').addEventListener('click', onSend);
$('#btnDebate').addEventListener('click', () => { if(me && !debateActive && !busy) openDebateSetup(); });

/* ============================================================
   モーダル
   ============================================================ */
function openModal(node){
  const panel = $('#modalPanel');
  panel.replaceChildren();
  const close = el('button', 'icon-btn modal-close');
  close.type = 'button';
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
  close.addEventListener('click', closeModal);
  panel.appendChild(close);
  panel.appendChild(node);
  $('#modal').classList.remove('hidden');
}
function closeModal(){ $('#modal').classList.add('hidden'); }
$('#modalBackdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeModal(); });

/* ---------- ようこそ／クレジット説明 ---------- */
function creditGuideNode(isNewAccount){
  const box = el('div');
  box.appendChild(el('div', 'modal-eyebrow', isNewAccount ? 'WELCOME' : 'CREDITS'));
  box.appendChild(el('div', 'modal-title', isNewAccount ? 'ようこそ、' + me.username : 'クレジットについて'));

  if(isNewAccount){
    const big = el('div', 'big-credit');
    big.appendChild(el('span', 'plus', '+'));
    big.append(fmt(CONFIG.credits.signupBonus));
    const sm = document.createElement('small');
    sm.textContent = 'クレジット';
    big.appendChild(sm);
    box.appendChild(big);
    box.appendChild(el('p', 'modal-desc', 'アカウント作成ボーナスを受け取ったよ。'));
  }

  const s1 = el('div', 'm-section');
  s1.appendChild(el('div', 'm-section-title', 'しくみ'));
  s1.appendChild(el('p', 'modal-desc', 'AIにメッセージを送るたびに、モデルごとに決まったクレジットを消費する。残高が足りないと送信できない。'));
  const list = el('div', 'cost-list');
  CONFIG.models.forEach(m => {
    const row = el('div', 'cost-row');
    row.appendChild(avatarNode(m));
    row.appendChild(el('span', 'name', m.name));
    row.appendChild(el('span', 'cr', fmt(m.cost) + ' cr / 回'));
    list.appendChild(row);
  });
  s1.appendChild(list);
  box.appendChild(s1);

  const s2 = el('div', 'm-section');
  s2.appendChild(el('div', 'm-section-title', 'クレジットを増やす'));
  s2.appendChild(el('p', 'modal-desc',
    'Slackの ' + CONFIG.credits.timesChannel + ' に参加すると +' + fmt(CONFIG.credits.timesBonus)
    + ' クレジット。参加したら「設定」から申請してね。'));
  box.appendChild(s2);

  const actions = el('div', 'modal-actions');
  const ok = el('button', 'btn primary', isNewAccount ? 'はじめる' : '閉じる');
  ok.type = 'button';
  ok.addEventListener('click', closeModal);
  actions.appendChild(ok);
  box.appendChild(actions);
  return box;
}

/* ---------- 設定 ---------- */
function openSettings(highlightTimes, tab){
  const box = el('div');
  box.appendChild(el('div', 'modal-eyebrow', 'SETTINGS'));
  box.appendChild(el('div', 'modal-title', '設定'));

  /* タブ：設定 / アップデート履歴 */
  const tabs = el('div', 'auth-tabs mtabs');
  const tMain = el('button', 'auth-tab' + (tab === 'updates' ? '' : ' active'), '設定');
  const tUpd  = el('button', 'auth-tab' + (tab === 'updates' ? ' active' : ''), 'アップデート履歴');
  tMain.type = tUpd.type = 'button';
  tMain.addEventListener('click', () => openSettings(false, 'main'));
  tUpd.addEventListener('click', () => openSettings(false, 'updates'));
  tabs.appendChild(tMain);
  tabs.appendChild(tUpd);
  box.appendChild(tabs);

  if(tab === 'updates'){
    box.appendChild(changelogNode());
    openModal(box);
    return;
  }

  /* アカウント情報 */
  const s1 = el('div', 'm-section');
  s1.appendChild(el('div', 'm-section-title', 'アカウント'));
  const kv1 = el('div', 'kv');
  kv1.appendChild(el('span', null, 'ユーザー名'));
  kv1.appendChild(el('b', null, me.username));
  s1.appendChild(kv1);
  const kv2 = el('div', 'kv');
  kv2.appendChild(el('span', null, 'クレジット残高'));
  kv2.appendChild(el('b', null, fmt(me.credits) + ' cr'));
  s1.appendChild(kv2);
  if(store.mode === 'demo'){
    const kv3 = el('div', 'kv');
    kv3.appendChild(el('span', null, '保存先'));
    kv3.appendChild(el('b', null, 'この端末のみ（デモモード）'));
    s1.appendChild(kv3);
  }
  box.appendChild(s1);

  /* times特典 */
  const s2 = el('div', 'm-section' + (highlightTimes ? ' times-highlight' : ''));
  s2.appendChild(el('div', 'm-section-title', 'クレジットを増やす'));
  if(me.timesClaimed){
    s2.appendChild(el('div', 'claimed-badge',
      '✓ 受け取り済み +' + fmt(CONFIG.credits.timesBonus) + ' cr（Slack名: ' + me.slackName + '）'));
  }else{
    s2.appendChild(el('p', 'modal-desc',
      'Slackの ' + CONFIG.credits.timesChannel + ' に参加した人は、Slackでの表示名を入力して下のボタンを押すと '
      + fmt(CONFIG.credits.timesBonus) + ' クレジットもらえる（1回だけ）。'));
    const slackIn = el('input', 'text-input field-gap');
    slackIn.type = 'text';
    slackIn.placeholder = 'Slackでの表示名';
    slackIn.maxLength = 30;
    s2.appendChild(slackIn);
    const errP = el('p', 'modal-desc err-text field-gap hidden');
    const claim = el('button', 'btn primary full field-gap',
      'timesに参加した — ' + fmt(CONFIG.credits.timesBonus) + ' cr 受け取る');
    claim.type = 'button';
    claim.addEventListener('click', async () => {
      const nm = slackIn.value.trim();
      if(!nm){ errP.textContent = 'Slackでの表示名を入力してね'; errP.classList.remove('hidden'); return; }
      claim.disabled = true;
      claim.textContent = '処理中…';
      try{
        await store.claimTimes(nm);
        renderCredits(true);
        openSettings();  /* 受け取り済み表示に更新 */
      }catch(e){
        console.error(e);
        claim.disabled = false;
        claim.textContent = 'もう一度試す';
        errP.textContent = '通信エラー。もう一度試してね';
        errP.classList.remove('hidden');
      }
    });
    s2.appendChild(claim);
    s2.appendChild(errP);
  }
  box.appendChild(s2);

  /* その他 */
  const s3 = el('div', 'm-section');
  s3.appendChild(el('div', 'm-section-title', 'その他'));
  const guide = el('button', 'btn ghost slim full', 'クレジットの説明を見る');
  guide.type = 'button';
  guide.addEventListener('click', () => openModal(creditGuideNode(false)));
  s3.appendChild(guide);
  const lo = el('button', 'btn danger full field-gap', 'ログアウト');
  lo.type = 'button';
  lo.addEventListener('click', doLogout);
  s3.appendChild(lo);
  box.appendChild(s3);

  openModal(box);
}

/* ---------- クレジット不足 ---------- */
function openInsufficientModal(){
  const box = el('div');
  box.appendChild(el('div', 'modal-eyebrow', 'CREDITS'));
  box.appendChild(el('div', 'modal-title', 'クレジットが足りない'));
  box.appendChild(el('p', 'modal-desc',
    '残高 ' + fmt(me.credits) + ' cr に対して、' + model.name + ' は1回 ' + fmt(model.cost) + ' cr 必要だよ。'));
  const s = el('div', 'm-section');
  s.appendChild(el('p', 'modal-desc',
    'Slackの ' + CONFIG.credits.timesChannel + ' に参加すると +' + fmt(CONFIG.credits.timesBonus)
    + ' cr。設定から申請できる。'));
  box.appendChild(s);
  const actions = el('div', 'modal-actions');
  const go = el('button', 'btn primary', '設定を開く');
  go.type = 'button';
  go.addEventListener('click', () => openSettings(true));
  const cl = el('button', 'btn ghost', '閉じる');
  cl.type = 'button';
  cl.addEventListener('click', closeModal);
  actions.appendChild(go);
  actions.appendChild(cl);
  box.appendChild(actions);
  openModal(box);
}

/* ---------- 確認ダイアログ ---------- */
function openConfirm(title, desc, okLabel, onOk){
  const box = el('div');
  box.appendChild(el('div', 'modal-title', title));
  box.appendChild(el('p', 'modal-desc', desc));
  const actions = el('div', 'modal-actions');
  const ok = el('button', 'btn danger', okLabel);
  ok.type = 'button';
  ok.addEventListener('click', () => { closeModal(); onOk(); });
  const cancel = el('button', 'btn ghost', 'やめておく');
  cancel.type = 'button';
  cancel.addEventListener('click', closeModal);
  actions.appendChild(ok);
  actions.appendChild(cancel);
  box.appendChild(actions);
  openModal(box);
}

/* ---------- ログアウト・履歴クリア ---------- */
async function doLogout(){
  closeModal();
  try{ await store.logout(); }catch(e){ console.warn(e); }
  me = null;
  chat = [];
  $('#authName').value = '';
  pinBoxes.forEach(b => b.value = '');
  setAuthMode('login');
  showScreen('auth');
}

$('#btnLogout').addEventListener('click', () =>
  openConfirm('ログアウト', 'ログアウトする？（アカウントとクレジットは保存されてる）', 'ログアウト', doLogout));
$('#btnClear').addEventListener('click', () => {
  if(!chat.length) return;
  openConfirm('履歴をクリア', 'この画面の会話履歴を消す？（クレジットは減らない）', 'クリアする', () => {
    chat = [];
    saveChat();
    renderAllMessages();
  });
});
$('#btnSettings').addEventListener('click', () => { closeSidebar(); openSettings(); });
$('#btnEarn').addEventListener('click', () => {
  closeSidebar();
  if(me && me.timesClaimed) openModal(creditGuideNode(false));
  else openSettings(true);
});

/* ---------- サイドバー（モバイル） ---------- */
function openSidebar(){ $('#sidebar').classList.add('open'); $('#backdrop').classList.remove('hidden'); }
function closeSidebar(){ $('#sidebar').classList.remove('open'); $('#backdrop').classList.add('hidden'); }
$('#btnMenu').addEventListener('click', openSidebar);
$('#backdrop').addEventListener('click', closeSidebar);

/* ---------- 開始 ---------- */
setAuthMode('signup');
boot();

})();
