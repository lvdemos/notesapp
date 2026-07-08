/* ===================== storage ===================== */
const STORAGE_KEY = 'koWordLog.v1';

function loadEntries(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}
function saveEntries(entries){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}
let entries = loadEntries();

/* ===================== hangul detection ===================== */
function hasHangul(str){
  return /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/.test(str);
}

/* ===================== romanization (Revised Romanization, simplified) ===================== */
const ONSETS = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const VOWELS = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const FINALS = ['','k','k','k','n','n','n','t','l','k','m','l','l','l','p','l','m','p','p','t','t','ng','t','t','k','t','p','t'];
// finals that can "link" onto a following null-onset syllable as a fresh onset sound
const LINK_ONSET = {1:'g',2:'kk',4:'n',7:'d',8:'r',16:'m',17:'b',19:'s',20:'ss',22:'j',23:'ch',24:'k',25:'t',26:'p',27:'h'};

function decompose(codePoint){
  const base = codePoint - 0xAC00;
  if(base < 0 || base > 11171) return null;
  const final = base % 28;
  const medial = ((base - final) / 28) % 21;
  const initial = Math.floor((base - final) / 28 / 21);
  return {initial, medial, final};
}

function romanize(str){
  const chars = Array.from(str);
  const syll = chars.map(c => {
    const d = decompose(c.codePointAt(0));
    return d ? {...d, char: c, hangul: true} : {char: c, hangul: false};
  });

  let out = '';
  let pendingLinkOnset = null;

  for(let i = 0; i < syll.length; i++){
    const s = syll[i];
    if(!s.hangul){
      out += s.char;
      pendingLinkOnset = null;
      continue;
    }

    let onsetStr;
    if(pendingLinkOnset !== null){
      onsetStr = pendingLinkOnset;
    }else{
      onsetStr = ONSETS[s.initial];
    }
    pendingLinkOnset = null;

    out += onsetStr + VOWELS[s.medial];

    if(s.final !== 0){
      const next = syll[i+1];
      if(next && next.hangul && next.initial === 11 && (LINK_ONSET[s.final] || s.final === 21)){
        pendingLinkOnset = (s.final === 21) ? 'ng' : LINK_ONSET[s.final];
      }else{
        out += FINALS[s.final];
      }
    }
  }
  return out;
}

/* ===================== auto categorization ===================== */
const CATEGORIES = ['greetings','food & drink','travel','numbers','time','family','emotions','questions','shopping','work & study','other'];

const CATEGORY_KEYWORDS = {
  'greetings': ['hello','hi','bye','goodbye','nice to meet','good morning','good night','see you','thanks','thank you','sorry','excuse me','welcome'],
  'food & drink': ['eat','food','drink','water','rice','coffee','tea','restaurant','delicious','hungry','thirsty','meal','soup','meat','fruit','menu'],
  'travel': ['airport','train','bus','ticket','hotel','taxi','subway','directions','map','left','right','straight','station','flight','passport','luggage'],
  'numbers': ['one','two','three','four','five','six','seven','eight','nine','ten','number','count','age','how many','how much'],
  'time': ['today','tomorrow','yesterday','morning','afternoon','evening','night','hour','minute','week','month','year','time','o\'clock','now','later'],
  'family': ['mother','father','sister','brother','family','parents','grandmother','grandfather','son','daughter','husband','wife','friend'],
  'emotions': ['happy','sad','angry','tired','excited','scared','love','hate','miss you','worried','nervous','bored','proud','feel'],
  'questions': ['what','where','who','why','how','when','which','can you','do you','is it','are you'],
  'shopping': ['buy','price','money','store','cash','discount','expensive','cheap','pay','receipt','size','clothes'],
  'work & study': ['work','job','study','school','homework','meeting','office','class','test','exam','teacher','student','project']
};

function autoCategorize(meaningText){
  if(!meaningText) return 'other';
  const lower = meaningText.toLowerCase();
  for(const [cat, words] of Object.entries(CATEGORY_KEYWORDS)){
    if(words.some(w => lower.includes(w))) return cat;
  }
  return 'other';
}

/* ===================== translation (best-effort, client-side, no key) ===================== */
async function translate(text, from, to){
  try{
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    const t = data?.responseData?.translatedText;
    if(!t || /invalid|error/i.test(t)) return null;
    return t;
  }catch(e){ return null; }
}

/* ===================== DOM refs ===================== */
const phraseInput   = document.getElementById('phraseInput');
const addBtn         = document.getElementById('addBtn');
const statusHint     = document.getElementById('statusHint');
const manualRow      = document.getElementById('manualRow');
const meaningInput   = document.getElementById('meaningInput');
const koreanInput    = document.getElementById('koreanInput');
const romInput       = document.getElementById('romInput');
const chipsBar       = document.getElementById('categoryChips');
const searchInput    = document.getElementById('searchInput');
const logList        = document.getElementById('logList');
const emptyState     = document.getElementById('emptyState');
const countBadge     = document.getElementById('countBadge');
const toastEl        = document.getElementById('toast');

let activeCategory = 'all';
let searchTerm = '';
let selectMode = false;
let selectedIds = new Set();

const shareToggleBtn = document.getElementById('shareToggleBtn');
const selectBar       = document.getElementById('selectBar');
const selectAllBtn    = document.getElementById('selectAllBtn');
const selectCount     = document.getElementById('selectCount');
const cancelSelectBtn = document.getElementById('cancelSelectBtn');
const shareSelectedBtn= document.getElementById('shareSelectedBtn');

/* ===================== toast ===================== */
let toastTimer;
function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* ===================== chips ===================== */
function renderChips(){
  const counts = {};
  entries.forEach(e => counts[e.category] = (counts[e.category]||0) + 1);
  const cats = ['all', ...CATEGORIES.filter(c => counts[c])];
  chipsBar.innerHTML = '';
  cats.forEach(cat => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (cat === activeCategory ? ' active' : '');
    chip.textContent = cat === 'all' ? `all · ${entries.length}` : `${cat} · ${counts[cat]}`;
    chip.addEventListener('click', () => { activeCategory = cat; renderChips(); renderLog(); });
    chipsBar.appendChild(chip);
  });
}

/* ===================== render log ===================== */
function renderLog(){
  const filtered = entries.filter(e => {
    const matchesCat = activeCategory === 'all' || e.category === activeCategory;
    const s = searchTerm.toLowerCase();
    const matchesSearch = !s || e.korean.toLowerCase().includes(s) || e.romanized.toLowerCase().includes(s) || e.meaning.toLowerCase().includes(s);
    return matchesCat && matchesSearch;
  }).sort((a,b) => b.createdAt - a.createdAt);

  logList.innerHTML = '';
  countBadge.textContent = entries.length;
  logList.classList.toggle('has-select-bar', selectMode);

  if(entries.length === 0){
    logList.appendChild(emptyState);
    return;
  }
  if(filtered.length === 0){
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML = '<p>no matches</p><span>try a different search or category</span>';
    logList.appendChild(div);
    return;
  }

  filtered.forEach(entry => logList.appendChild(buildEntryCard(entry)));
}

function buildEntryCard(entry){
  const card = document.createElement('div');
  card.className = 'entry' + (selectMode ? ' select-mode' : '');
  card.dataset.id = entry.id;

  const checkedClass = selectedIds.has(entry.id) ? ' checked' : '';
  const checkboxHtml = selectMode ? `
      <div class="entry-check${checkedClass}" data-check>
        <svg viewBox="0 0 24 24" width="12" height="12"><path d="M4 12l5 5L20 6" stroke="#04141A" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>` : '';

  card.innerHTML = `
    <div class="entry-top">
      ${checkboxHtml}
      <div class="entry-main">
        <p class="ko-text">${escapeHtml(entry.korean)}</p>
        <p class="rom-text">${escapeHtml(entry.romanized)}</p>
        <p class="meaning-text">${escapeHtml(entry.meaning)}</p>
      </div>
      <div class="entry-actions">
        <button class="icon-btn speak" title="pronounce" aria-label="pronounce">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 8a5 5 0 010 8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>
        </button>
        <button class="icon-btn edit" title="edit" aria-label="edit">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>
        </button>
        <button class="icon-btn del" title="delete" aria-label="delete">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="entry-footer">
      <span class="cat-tag">${escapeHtml(entry.category)}</span>
    </div>
  `;

  if(selectMode){
    card.querySelector('[data-check]').addEventListener('click', () => toggleSelect(entry.id));
    card.querySelector('.entry-main').addEventListener('click', () => toggleSelect(entry.id));
  }else{
    card.querySelector('.speak').addEventListener('click', () => speak(entry.korean));
    card.querySelector('.del').addEventListener('click', () => deleteEntry(entry.id));
    card.querySelector('.edit').addEventListener('click', () => enterEditMode(card, entry));
  }

  return card;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/* ===================== edit mode ===================== */
function enterEditMode(card, entry){
  card.classList.add('editing');
  const catOptions = CATEGORIES.map(c => `<option value="${c}" ${c===entry.category?'selected':''}>${c}</option>`).join('');
  card.innerHTML = `
    <input type="text" class="ko" value="${escapeHtml(entry.korean)}" data-field="korean" placeholder="한국어">
    <input type="text" value="${escapeHtml(entry.romanized)}" data-field="romanized" placeholder="romanization">
    <input type="text" value="${escapeHtml(entry.meaning)}" data-field="meaning" placeholder="meaning">
    <select class="cat-select" data-field="category">${catOptions}</select>
    <div class="edit-actions">
      <button class="cancel-btn">cancel</button>
      <button class="save-btn">save</button>
    </div>
  `;
  card.querySelector('.cancel-btn').addEventListener('click', () => renderLog());
  card.querySelector('.save-btn').addEventListener('click', () => {
    entry.korean    = card.querySelector('[data-field="korean"]').value.trim() || entry.korean;
    entry.romanized = card.querySelector('[data-field="romanized"]').value.trim();
    entry.meaning   = card.querySelector('[data-field="meaning"]').value.trim();
    entry.category  = card.querySelector('[data-field="category"]').value;
    saveEntries(entries);
    renderChips();
    renderLog();
    showToast('saved');
  });
}

/* ===================== delete ===================== */
function deleteEntry(id){
  entries = entries.filter(e => e.id !== id);
  saveEntries(entries);
  renderChips();
  renderLog();
  showToast('deleted');
}

/* ===================== speech ===================== */
function speak(text){
  if(!('speechSynthesis' in window)){
    showToast('speech not supported on this device');
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ko-KR';
  utter.rate = 0.85;
  const voices = window.speechSynthesis.getVoices();
  const koVoice = voices.find(v => v.lang === 'ko-KR') || voices.find(v => v.lang.startsWith('ko'));
  if(koVoice) utter.voice = koVoice;
  window.speechSynthesis.speak(utter);
}
// warm up voice list (some browsers load async)
if('speechSynthesis' in window){
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

/* ===================== add flow ===================== */
addBtn.addEventListener('click', handleAdd);
phraseInput.addEventListener('keydown', e => { if(e.key === 'Enter') handleAdd(); });

async function handleAdd(){
  const raw = phraseInput.value.trim();
  if(!raw){ flashHint('type something first', true); return; }

  addBtn.disabled = true;
  flashHint('working on it…');

  let korean, romanized, meaning;

  if(hasHangul(raw)){
    korean = raw;
    romanized = romanize(raw);
    meaning = await translate(raw, 'ko', 'en');
    if(!meaning || hasHangul(meaning)){
      meaning = '';
      flashHint('couldn\'t auto-translate — add the meaning below', true);
      openManualRow(korean, romanized, '');
      addBtn.disabled = false;
      return;
    }
  }else{
    meaning = raw;
    const koTranslated = await translate(raw, 'en', 'ko');
    if(!koTranslated || !hasHangul(koTranslated)){
      flashHint('couldn\'t auto-translate — fill in korean below', true);
      openManualRow('', '', meaning);
      addBtn.disabled = false;
      return;
    }
    korean = koTranslated;
    romanized = romanize(korean);
  }

  commitEntry(korean, romanized, meaning);
  addBtn.disabled = false;
}

function openManualRow(korean, rom, meaning){
  manualRow.hidden = false;
  koreanInput.value = korean;
  romInput.value = rom;
  meaningInput.value = meaning;
  const target = korean ? meaningInput : koreanInput;
  target.focus();

  // swap add button to a one-time confirm for manual entry
  addBtn.onclick = () => {
    const k = koreanInput.value.trim();
    const r = romInput.value.trim() || romanize(k);
    const m = meaningInput.value.trim();
    if(!k || !m){ flashHint('need both korean and meaning', true); return; }
    commitEntry(k, r, m);
    manualRow.hidden = true;
    koreanInput.value = ''; romInput.value = ''; meaningInput.value = '';
    addBtn.onclick = handleAdd;
  };
}

function commitEntry(korean, romanized, meaning){
  const category = autoCategorize(meaning);
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2,7),
    korean, romanized, meaning, category,
    createdAt: Date.now()
  };
  entries.push(entry);
  saveEntries(entries);
  phraseInput.value = '';
  manualRow.hidden = true;
  flashHint(`added to ${category}`, false, true);
  renderChips();
  renderLog();
}

function flashHint(msg, isError, isOk){
  statusHint.textContent = msg;
  statusHint.classList.toggle('error', !!isError);
  statusHint.classList.toggle('ok', !!isOk);
}

/* ===================== search ===================== */
searchInput.addEventListener('input', e => {
  searchTerm = e.target.value;
  renderLog();
});

/* ===================== select & share ===================== */
function toggleSelect(id){
  if(selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateSelectBar();
  renderLog();
}

function updateSelectBar(){
  const n = selectedIds.size;
  selectCount.textContent = `${n} selected`;
  shareSelectedBtn.disabled = n === 0;
  selectAllBtn.textContent = (n === entries.length && n > 0) ? 'deselect all' : 'select all';
}

function enterSelectMode(){
  selectMode = true;
  selectedIds.clear();
  shareToggleBtn.classList.add('active');
  selectBar.hidden = false;
  updateSelectBar();
  renderLog();
}

function exitSelectMode(){
  selectMode = false;
  selectedIds.clear();
  shareToggleBtn.classList.remove('active');
  selectBar.hidden = true;
  renderLog();
}

shareToggleBtn.addEventListener('click', () => {
  if(entries.length === 0){ showToast('nothing to share yet'); return; }
  selectMode ? exitSelectMode() : enterSelectMode();
});

cancelSelectBtn.addEventListener('click', exitSelectMode);

selectAllBtn.addEventListener('click', () => {
  if(selectedIds.size === entries.length){
    selectedIds.clear();
  }else{
    entries.forEach(e => selectedIds.add(e.id));
  }
  updateSelectBar();
  renderLog();
});

shareSelectedBtn.addEventListener('click', shareSelected);

function buildExportText(list){
  const lines = list.map(e => `${e.korean}  (${e.romanized})\n${e.meaning}  —  ${e.category}`);
  const header = `단어장 — ${list.length} word${list.length === 1 ? '' : 's'} — ${new Date().toLocaleDateString()}`;
  return `${header}\n\n${lines.join('\n\n')}`;
}

async function shareSelected(){
  const list = entries
    .filter(e => selectedIds.has(e.id))
    .sort((a,b) => a.createdAt - b.createdAt);
  if(list.length === 0) return;

  const text = buildExportText(list);
  const fileName = `korean-words-${new Date().toISOString().slice(0,10)}.txt`;
  const file = new File([text], fileName, {type: 'text/plain'});

  try{
    if(navigator.canShare && navigator.canShare({files: [file]})){
      await navigator.share({files: [file], title: '단어장', text: `${list.length} words from my korean log`});
    }else if(navigator.share){
      await navigator.share({title: '단어장', text});
    }else{
      await navigator.clipboard.writeText(text);
      showToast('share not supported — copied to clipboard instead');
    }
    exitSelectMode();
  }catch(err){
    if(err.name !== 'AbortError'){
      try{
        await navigator.clipboard.writeText(text);
        showToast('share failed — copied to clipboard instead');
      }catch(_){
        showToast('couldn\'t share or copy');
      }
    }
  }
}

/* ===================== full backup export / import ===================== */
const exportBackupBtn = document.getElementById('exportBackupBtn');
const importBackupBtn = document.getElementById('importBackupBtn');
const importFileInput = document.getElementById('importFileInput');

exportBackupBtn.addEventListener('click', () => {
  if(entries.length === 0){ showToast('nothing to back up yet'); return; }
  const payload = {
    app: 'koWordLog',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `word-log-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('backup downloaded — save it somewhere safe');
});

importBackupBtn.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file) return;
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data.entries;
    if(!Array.isArray(incoming)) throw new Error('bad format');

    const valid = incoming.filter(x => x && x.korean && x.id);
    if(valid.length === 0) throw new Error('no valid entries');

    const existingIds = new Set(entries.map(e => e.id));
    const merged = incoming.some(x => x.id && existingIds.has(x.id)) && entries.length > 0
      ? confirm(`found ${valid.length} entries in this backup. merge with your current ${entries.length}? cancel to replace everything instead.`)
      : true;

    if(merged){
      valid.forEach(v => { if(!existingIds.has(v.id)) entries.push(v); });
    }else{
      entries = valid;
    }

    saveEntries(entries);
    renderChips();
    renderLog();
    showToast(`restored ${valid.length} entries`);
  }catch(err){
    showToast('couldn\'t read that file — is it a word log backup?');
  }finally{
    importFileInput.value = '';
  }
});

/* ===================== init ===================== */
renderChips();
renderLog();
