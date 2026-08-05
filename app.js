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
migrateSrs();

function migrateSrs(){
  let changed = false;
  entries.forEach(e => {
    if(!e.srs){
      e.srs = { box: 0, dueAt: e.createdAt || Date.now(), correct: 0, wrong: 0 };
      changed = true;
    }
  });
  if(changed) saveEntries(entries);
}

/* ===================== settings ===================== */
const SETTINGS_KEY = 'koWordLog.settings.v1';
const DEFAULT_SETTINGS = {theme:'auto', sort:'newest', dailyGoal:10, gifApiKey:''};
function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? {...DEFAULT_SETTINGS, ...JSON.parse(raw)} : {...DEFAULT_SETTINGS};
  }catch(e){ return {...DEFAULT_SETTINGS}; }
}
function saveSettings(){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
let settings = loadSettings();

function applyTheme(){
  let actual = settings.theme;
  if(actual === 'auto'){
    actual = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', actual);
}
applyTheme();
if(window.matchMedia){
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if(settings.theme === 'auto') applyTheme();
  });
}

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
  }).sort((a,b) => {
    switch(settings.sort){
      case 'oldest':   return a.createdAt - b.createdAt;
      case 'az':       return a.korean.localeCompare(b.korean, 'ko');
      case 'category': return a.category.localeCompare(b.category) || (b.createdAt - a.createdAt);
      case 'newest':
      default:         return b.createdAt - a.createdAt;
    }
  });

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
        <svg viewBox="0 0 24 24" width="12" height="12"><path d="M4 12l5 5L20 6" stroke="#FFFFFF" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
  updateDueDot();
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
    createdAt: Date.now(),
    srs: { box: 0, dueAt: Date.now(), correct: 0, wrong: 0 }
  };
  entries.push(entry);
  saveEntries(entries);
  phraseInput.value = '';
  manualRow.hidden = true;
  flashHint(`added to ${category}`, false, true);
  renderChips();
  renderLog();
  updateDueDot();
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
    migrateSrs();
    renderChips();
    renderLog();
    updateDueDot();
    showToast(`restored ${valid.length} entries`);
  }catch(err){
    showToast('couldn\'t read that file — is it a word log backup?');
  }finally{
    importFileInput.value = '';
  }
});

/* ===================== settings modal ===================== */
const settingsBtn      = document.getElementById('settingsBtn');
const settingsOverlay  = document.getElementById('settingsOverlay');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const themeSegment     = document.getElementById('themeSegment');
const sortSegment      = document.getElementById('sortSegment');
const goalSegment      = document.getElementById('goalSegment');
const clearAllBtn      = document.getElementById('clearAllBtn');
const gifKeyInput      = document.getElementById('gifKeyInput');

function openSettings(){
  settingsOverlay.hidden = false;
  settingsBtn.classList.add('active');
  syncSegment(themeSegment, settings.theme);
  syncSegment(sortSegment, settings.sort);
  syncSegment(goalSegment, String(settings.dailyGoal));
  gifKeyInput.value = settings.gifApiKey || '';
}
function closeSettings(){
  settingsOverlay.hidden = true;
  settingsBtn.classList.remove('active');
}
function syncSegment(segEl, value){
  segEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.val === value));
}

settingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => { if(e.target === settingsOverlay) closeSettings(); });

themeSegment.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-val]');
  if(!btn) return;
  settings.theme = btn.dataset.val;
  saveSettings();
  applyTheme();
  syncSegment(themeSegment, settings.theme);
});

sortSegment.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-val]');
  if(!btn) return;
  settings.sort = btn.dataset.val;
  saveSettings();
  syncSegment(sortSegment, settings.sort);
  renderLog();
});

goalSegment.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-val]');
  if(!btn) return;
  settings.dailyGoal = parseInt(btn.dataset.val, 10);
  saveSettings();
  syncSegment(goalSegment, String(settings.dailyGoal));
  renderDaily();
});

gifKeyInput.addEventListener('change', () => {
  settings.gifApiKey = gifKeyInput.value.trim();
  saveSettings();
});

clearAllBtn.addEventListener('click', () => {
  if(entries.length === 0){ showToast('already empty'); return; }
  const ok = confirm(`delete all ${entries.length} entries? this can't be undone unless you have a backup file.`);
  if(!ok) return;
  entries = [];
  saveEntries(entries);
  renderChips();
  renderLog();
  updateDueDot();
  closeSettings();
  showToast('everything cleared');
});

/* ===================== tabs ===================== */
const tabLogBtn   = document.getElementById('tabLogBtn');
const tabTrainBtn = document.getElementById('tabTrainBtn');
const logView     = document.getElementById('logView');
const trainView   = document.getElementById('trainView');
const dueDot      = document.getElementById('dueDot');

function switchTab(tab){
  const isLog = tab === 'log';
  logView.hidden = !isLog;
  trainView.hidden = isLog;
  tabLogBtn.classList.toggle('active', isLog);
  tabTrainBtn.classList.toggle('active', !isLog);
  if(!isLog) resetTrainSetupView();
}
tabLogBtn.addEventListener('click', () => switchTab('log'));
tabTrainBtn.addEventListener('click', () => switchTab('train'));

function countDue(){
  const now = Date.now();
  return entries.filter(e => e.srs && e.srs.dueAt <= now).length;
}
function updateDueDot(){
  dueDot.hidden = countDue() === 0;
}

/* ===================== spaced repetition ===================== */
// grading here is self-reported (you know best whether you got it) rather than
// string-matched — free-form answers have too many valid phrasings to auto-grade fairly.
const BOX_INTERVALS = [0, 86400000, 3*86400000, 7*86400000, 16*86400000, 30*86400000];
const MAX_BOX = BOX_INTERVALS.length - 1;

function applySrsRating(entry, rating){
  entry.srs = entry.srs || { box:0, dueAt: Date.now(), correct:0, wrong:0 };
  const now = Date.now();
  if(rating === 'wrong'){
    entry.srs.box = 0;
    entry.srs.dueAt = now;
    entry.srs.wrong++;
  }else{
    entry.srs.box = Math.min(entry.srs.box + 1, MAX_BOX);
    entry.srs.dueAt = now + BOX_INTERVALS[entry.srs.box];
    entry.srs.correct++;
  }
}

/* ===================== streak ===================== */
const STREAK_KEY = 'koWordLog.streak.v1';
const streakCountEl = document.getElementById('streakCount');
function loadStreak(){
  try{
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : { count: 0, lastDate: null };
  }catch(e){ return { count: 0, lastDate: null }; }
}
function saveStreak(){ localStorage.setItem(STREAK_KEY, JSON.stringify(streak)); }
let streak = loadStreak();

function todayStr(){ return new Date().toISOString().slice(0,10); }
function yesterdayStr(){
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0,10);
}
function bumpStreak(){
  const today = todayStr();
  if(streak.lastDate === today) return;
  streak.count = (streak.lastDate === yesterdayStr()) ? streak.count + 1 : 1;
  streak.lastDate = today;
  saveStreak();
  renderStreak();
}
function renderStreak(){
  // if the streak's last active day isn't today or yesterday, it's effectively broken — show 0
  const today = todayStr();
  const display = (streak.lastDate === today || streak.lastDate === yesterdayStr()) ? streak.count : 0;
  streakCountEl.textContent = display;
}

/* ===================== daily goal progress ===================== */
const DAILY_KEY = 'koWordLog.daily.v1';
const dailyProgressFill = document.getElementById('dailyProgressFill');
const dailyProgressText = document.getElementById('dailyProgressText');
function loadDaily(){
  try{
    const raw = localStorage.getItem(DAILY_KEY);
    const d = raw ? JSON.parse(raw) : { date: todayStr(), count: 0 };
    if(d.date !== todayStr()) return { date: todayStr(), count: 0 };
    return d;
  }catch(e){ return { date: todayStr(), count: 0 }; }
}
function saveDaily(){ localStorage.setItem(DAILY_KEY, JSON.stringify(daily)); }
let daily = loadDaily();
function bumpDaily(){
  if(daily.date !== todayStr()) daily = { date: todayStr(), count: 0 };
  daily.count++;
  saveDaily();
  renderDaily();
}
function renderDaily(){
  const goal = settings.dailyGoal || 10;
  const pct = Math.min(100, Math.round((daily.count / goal) * 100));
  dailyProgressFill.style.width = pct + '%';
  dailyProgressText.textContent = `${daily.count} / ${goal}`;
}

/* ===================== word gifs (klipy) ===================== */
// Tenor's API was fully shut down by Google on 2026-06-30, so this uses Klipy
// (the community-recommended replacement — WhatsApp/Discord/Bluesky all migrated
// to it). Klipy's exact response schema isn't fully confirmed here, so instead of
// hardcoding a guessed field path, we walk the JSON and grab the first thing that
// looks like an image/video URL — resilient to minor shape differences.
function findMediaUrl(node){
  if(!node) return null;
  if(typeof node === 'string'){
    return /^https?:\/\/\S+\.(gif|webp|mp4)(\?\S*)?$/i.test(node) ? node : null;
  }
  if(Array.isArray(node)){
    for(const item of node){
      const found = findMediaUrl(item);
      if(found) return found;
    }
    return null;
  }
  if(typeof node === 'object'){
    if(typeof node.url === 'string' && findMediaUrl(node.url)) return node.url;
    for(const key of Object.keys(node)){
      const found = findMediaUrl(node[key]);
      if(found) return found;
    }
  }
  return null;
}

async function fetchWordGif(query){
  if(!settings.gifApiKey || !query) return null;
  const url = `https://api.klipy.com/api/v1/${encodeURIComponent(settings.gifApiKey)}/gifs/search?q=${encodeURIComponent(query)}&per_page=8&rating=g`;
  try{
    const res = await fetch(url);
    if(!res.ok){
      console.warn(`[word gif] request failed: ${res.status} ${res.statusText}`, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    const results = data?.data?.data || data?.data || data?.results || [];
    for(const item of Array.isArray(results) ? results : []){
      const found = findMediaUrl(item.file || item.files || item.media || item);
      if(found) return found;
    }
    console.warn('[word gif] got a response but could not find an image/video url in it — raw response:', data);
    return null;
  }catch(e){
    console.warn('[word gif] fetch threw (likely CORS or network) —', e);
    return null;
  }
}

/* ===================== training session ===================== */
const trainSetup       = document.getElementById('trainSetup');
const trainSessionEl   = document.getElementById('trainSession');
const trainSummaryEl   = document.getElementById('trainSummary');
const trainLead        = document.getElementById('trainLead');
const trainSub         = document.getElementById('trainSub');
const dirSegment       = document.getElementById('dirSegment');
const sizeSegment      = document.getElementById('sizeSegment');
const startTrainBtn    = document.getElementById('startTrainBtn');
const trainProgressFill= document.getElementById('trainProgressFill');
const trainProgressText= document.getElementById('trainProgressText');
const shuffleBtn       = document.getElementById('shuffleBtn');
const flashCard        = document.getElementById('flashCard');
const flashTag         = document.getElementById('flashTag');
const flashPrompt      = document.getElementById('flashPrompt');
const flashSub         = document.getElementById('flashSub');
const flashReveal      = document.getElementById('flashReveal');
const revealAnswer     = document.getElementById('revealAnswer');
const revealNote       = document.getElementById('revealNote');
const answerGif        = document.getElementById('answerGif');
const answerGifImg     = document.getElementById('answerGifImg');
const hintBtn          = document.getElementById('hintBtn');
const feedbackBurst    = document.getElementById('feedbackBurst');
const trainAnswerForm  = document.getElementById('trainAnswerForm');
const trainAnswerInput = document.getElementById('trainAnswerInput');
const ratingRow        = document.getElementById('ratingRow');
const summaryHeadline  = document.getElementById('summaryHeadline');
const summarySub       = document.getElementById('summarySub');
const backToLogBtn     = document.getElementById('backToLogBtn');
const trainAgainBtn    = document.getElementById('trainAgainBtn');

let trainPrefs = { dir: 'mixed', size: '10', shuffle: false };
let session = null; // { queue:[{id,direction}], index, tally:{correct,wrong}, total, requeued }

function resetTrainSetupView(){
  trainSetup.hidden = false;
  trainSessionEl.hidden = true;
  trainSummaryEl.hidden = true;
  const due = countDue();
  trainLead.textContent = entries.length === 0 ? 'nothing to train yet' : 'ready to drill your log';
  trainSub.textContent = entries.length === 0
    ? 'add a few words first'
    : `${due} due for review · ${entries.length} words total`;
  startTrainBtn.disabled = entries.length === 0;
  startTrainBtn.style.opacity = entries.length === 0 ? .5 : 1;
}

dirSegment.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-val]');
  if(!btn) return;
  trainPrefs.dir = btn.dataset.val;
  syncSegment(dirSegment, btn.dataset.val);
});
sizeSegment.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-val]');
  if(!btn) return;
  trainPrefs.size = btn.dataset.val;
  syncSegment(sizeSegment, btn.dataset.val);
});
shuffleBtn.addEventListener('click', () => {
  trainPrefs.shuffle = !trainPrefs.shuffle;
  shuffleBtn.classList.toggle('active', trainPrefs.shuffle);
  if(session) shuffleRemainingQueue();
});
function shuffleRemainingQueue(){
  const head = session.queue.slice(0, session.index + 1);
  const tail = session.queue.slice(session.index + 1);
  for(let i = tail.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  session.queue = head.concat(tail);
}

startTrainBtn.addEventListener('click', () => {
  if(entries.length === 0) return;
  startSession();
});

function buildSessionQueue(size){
  const now = Date.now();
  const due  = entries.filter(e => e.srs.dueAt <= now).sort((a,b) => a.srs.dueAt - b.srs.dueAt);
  const rest = entries.filter(e => e.srs.dueAt > now).sort((a,b) => a.srs.dueAt - b.srs.dueAt);
  let pool = due.concat(rest);
  if(size !== 'all') pool = pool.slice(0, Math.min(parseInt(size, 10), pool.length));
  if(trainPrefs.shuffle){
    for(let i = pool.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  return pool.map(e => ({ id: e.id, direction: pickDirection() }));
}
function pickDirection(){
  if(trainPrefs.dir === 'mixed') return Math.random() < 0.5 ? 'ko-en' : 'en-ko';
  return trainPrefs.dir;
}

function startSession(){
  const queue = buildSessionQueue(trainPrefs.size);
  session = { queue, index: 0, tally: {correct:0,wrong:0}, total: queue.length, requeued: {} };
  shuffleBtn.classList.toggle('active', trainPrefs.shuffle);
  trainSetup.hidden = true;
  trainSummaryEl.hidden = true;
  trainSessionEl.hidden = false;
  showCard();
}

function currentEntry(){
  const item = session.queue[session.index];
  if(!item) return null;
  const entry = entries.find(e => e.id === item.id);
  return entry ? { entry, direction: item.direction } : null;
}

function showCard(){
  flashReveal.hidden = true;
  ratingRow.hidden = true;
  trainAnswerForm.hidden = false;
  trainAnswerInput.value = '';
  trainAnswerInput.disabled = false;
  hintBtn.hidden = false;
  feedbackBurst.hidden = true;
  flashCard.classList.remove('shake');
  ratingRow.style.pointerEvents = '';
  answerGif.hidden = true;
  answerGifImg.src = '';

  const cur = currentEntry();
  if(!cur){ finishSession(); return; }
  const { entry, direction } = cur;

  const pct = Math.round((session.index / session.total) * 100);
  trainProgressFill.style.width = pct + '%';
  trainProgressText.textContent = `${session.index + 1} / ${session.total}`;

  if(direction === 'ko-en'){
    flashTag.textContent = '한국어 → english';
    flashPrompt.style.fontFamily = "'Noto Sans KR', sans-serif";
    flashPrompt.textContent = entry.korean;
    flashSub.textContent = entry.romanized || '';
    trainAnswerInput.placeholder = 'type the english meaning';
  }else{
    flashTag.textContent = 'english → 한국어';
    flashPrompt.style.fontFamily = "'Inter', sans-serif";
    flashPrompt.textContent = entry.meaning;
    flashSub.textContent = '';
    trainAnswerInput.placeholder = 'type it in korean';
  }
  setTimeout(() => trainAnswerInput.focus(), 50);
}

// reveal the answer without judging it — free-form phrasing has too many valid
// answers to auto-grade reliably, so you decide for yourself with the check/x buttons.
function revealCard(){
  const cur = currentEntry();
  if(!cur) return;
  const { entry, direction } = cur;
  const isKorean = direction === 'en-ko';
  const typed = trainAnswerInput.value.trim();

  bumpDaily();
  bumpStreak();

  revealAnswer.textContent = isKorean ? `${entry.korean}  ·  ${entry.romanized}` : entry.meaning;
  revealAnswer.style.fontFamily = isKorean ? "'Noto Sans KR', sans-serif" : "'Inter', sans-serif";
  revealNote.textContent = typed ? `you typed: "${typed}"` : '';
  flashReveal.hidden = false;

  trainAnswerForm.hidden = true;
  hintBtn.hidden = true;
  ratingRow.hidden = false;

  ratingRow.dataset.entryId = entry.id;
  ratingRow.dataset.direction = direction;

  answerGif.hidden = true;
  answerGifImg.src = '';
  const gifQuery = (entry.meaning || entry.korean).split(/[\/,;]/)[0].trim();
  fetchWordGif(gifQuery).then(gifUrl => {
    // the session may have already moved to a different card by the time this resolves
    if(gifUrl && ratingRow.dataset.entryId === entry.id){
      answerGifImg.src = gifUrl;
      answerGifImg.alt = gifQuery;
      answerGif.hidden = false;
    }
  });
}

trainAnswerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  revealCard();
});
hintBtn.addEventListener('click', revealCard);

function playFeedback(rating){
  const isCorrect = rating === 'correct';
  feedbackBurst.className = 'feedback-burst ' + (isCorrect ? 'correct' : 'wrong');
  feedbackBurst.innerHTML = isCorrect
    ? '<svg viewBox="0 0 24 24" width="68" height="68"><path d="M4 12.5l5.5 5.5L20 6.5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24" width="68" height="68"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';
  feedbackBurst.hidden = false;
  if(!isCorrect){
    flashCard.classList.remove('shake');
    void flashCard.offsetWidth;
    flashCard.classList.add('shake');
  }
}

ratingRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.rating-btn');
  if(!btn) return;
  const rating = btn.dataset.rating; // 'correct' | 'wrong'
  const cur = currentEntry();
  if(!cur) return;
  const { entry, direction } = cur;

  ratingRow.style.pointerEvents = 'none';
  applySrsRating(entry, rating);
  saveEntries(entries);
  session.tally[rating]++;
  playFeedback(rating);

  if(rating === 'wrong'){
    const key = session.queue[session.index].id;
    const timesRequeued = session.requeued[key] || 0;
    if(timesRequeued < 1){
      session.requeued[key] = timesRequeued + 1;
      session.queue.push({ id: entry.id, direction });
      session.total++;
    }
  }

  setTimeout(() => {
    session.index++;
    showCard();
  }, 480);
});

function finishSession(){
  trainSessionEl.hidden = true;
  trainSummaryEl.hidden = false;
  const t = session.tally;
  const attempted = t.correct + t.wrong;
  const pct = attempted ? Math.round((t.correct / attempted) * 100) : 0;
  summaryHeadline.textContent = pct >= 80 ? 'excellent run' : pct >= 50 ? 'good progress' : 'keep at it';
  summarySub.textContent = `${t.correct} correct · ${t.wrong} missed`;
  updateDueDot();
}

backToLogBtn.addEventListener('click', () => switchTab('log'));
trainAgainBtn.addEventListener('click', () => { resetTrainSetupView(); });

/* ===================== init ===================== */
updateDueDot();
renderStreak();
renderDaily();
renderChips();
renderLog();
