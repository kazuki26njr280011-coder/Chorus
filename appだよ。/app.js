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

function msgNode(m){
  if(m.role === 'sys') return el('div', 'sys-divider', m.text);
  const row = el('div', 'msg-row ' + m.role);
  const body = el('div', 'msg-body');
  if(m.role === 'ai'){
    const mm = CONFIG.models.find(x => x.id === m.modelId) || model;
    row.appendChild(avatarNode(mm, 'sm msg-avatar'));
    body.appendChild(el('div', 'msg-meta', mm.name));
    body.appendChild(el('div', 'msg-bubble' + (m.error ? ' error' : ''), m.text));
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
    empty.appendChild(el('div', 'empty-sub', 'Enterで送信 ／ Shift+Enterで改行'));
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

  let i = 0;
  const iv = setInterval(() => {
    i = (i + 1) % m.thinking.length;
    txt.classList.add('swap');
    setTimeout(() => {
      txt.textContent = m.thinking[i] + '…';
      txt.classList.remove('swap');
    }, 250);
  }, Math.max(1200, Math.floor(m.minThinkMs / m.thinking.length)));

  row._stop = () => clearInterval(iv);
  return row;
}

/* ---------- 送信 ---------- */
const inputEl = $('#input');

function autoGrow(){
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
}
function updateSendState(){
  $('#btnSend').disabled = busy || !inputEl.value.trim();
}

async function onSend(){
  const text = inputEl.value.trim();
  if(!text || busy || !me) return;
  if(me.credits < model.cost){ openInsufficientModal(); return; }

  busy = true;
  updateSendState();
  inputEl.value = '';
  autoGrow();

  const m = model;  /* 送信時点のモデルで固定 */
  pushMsg({ role: 'user', text });

  try{ await store.addCredits(-m.cost); }
  catch(e){ console.warn('クレジットの保存に失敗:', e); }
  renderCredits(true);

  const think = thinkingNode(m);
  $('#messages').appendChild(think);
  scrollBottom();

  const t0 = Date.now();
  let reply = null, failed = false;
  try{ reply = await callAI(text, m); }
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
  inputEl.focus();
}

/* ---------- Miibo API 呼び出し ---------- */
async function callAI(text, m){
  const { apiKey, endpoint } = CONFIG.miibo;
  if(!apiKey || !m.agentId){
    await sleep(500);
    return '（デモ応答）まだMiiboに接続されてないよ。\n'
      + 'js/config.js の miibo.apiKey と、モデル「' + m.name + '」の agentId を設定すると、'
      + 'ここに本物のAIの返事が届く。手順は README.md を見てね。';
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      agent_id: m.agentId,
      utterance: text,
      uid: 'chorus_' + me.uid,
    }),
  });
  if(!res.ok) throw new Error('Miibo HTTP ' + res.status);
  const data = await res.json();
  const out = data && data.bestResponse && data.bestResponse.utterance;
  if(!out) throw new Error('Miibo empty response');
  return out;
}

inputEl.addEventListener('input', () => { autoGrow(); updateSendState(); });
inputEl.addEventListener('keydown', e => {
  if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
    e.preventDefault();
    onSend();
  }
});
$('#btnSend').addEventListener('click', onSend);

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
function openSettings(highlightTimes){
  const box = el('div');
  box.appendChild(el('div', 'modal-eyebrow', 'SETTINGS'));
  box.appendChild(el('div', 'modal-title', '設定'));

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
