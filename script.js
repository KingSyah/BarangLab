/* =============================================
   LOGBOOK BARANG LABORATORIUM — script.js
   Kolom: Timestamp, Jenis Data, Tanggal, Nama,
   NPM/NIK/NIP, Email, Alamat, Nomor telepon,
   Tanggal Pengembalian, Keterangan Tambahan
   ============================================= */

const CSV_URL   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSwsye1WiUetZ5uSo-TqBKKjgk8y3J0ZWUZKAN25T7i-UgLQeNqmI5AHY4Xxa3aHBVMNhOnhlokAMwj/pub?gid=459706998&single=true&output=csv';
const FORM_URL  = 'https://kingsyah.codeberg.page/lok1/form2.html';
const PAGE_SIZE = 15;

let allData      = [];
let filteredSets = { semua:[], masuk:[], keluar:[], peminjaman:[], perbaikan:[] };
let pages        = { semua:1, masuk:1, keluar:1, peminjaman:1, perbaikan:1 };
let searches     = { semua:'', masuk:'', keluar:'', peminjaman:'', perbaikan:'' };
let filterVals   = { semua:{ jenis:'' }, peminjaman:{ status:'' }, perbaikan:{ status:'' } };

/* ── Theme ── */
function initTheme() {
  const saved = localStorage.getItem('lb-theme') || 'light';
  applyTheme(saved);
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lb-theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.innerHTML = theme === 'dark'
    ? '<i class="fas fa-sun"></i>'
    : '<i class="fas fa-moon"></i>';
  btn && (btn.title = theme === 'dark' ? 'Mode Terang' : 'Mode Gelap');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ── Fetch ── */
async function loadCSV() {
  const bust = '&_=' + Date.now();
  const targets = [
    CSV_URL + bust,
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(CSV_URL),
    'https://corsproxy.io/?url='          + encodeURIComponent(CSV_URL),
  ];
  let lastErr;
  for (const url of targets) {
    try {
      const res = await fetch(url, { cache:'no-store' });
      if (!res.ok) continue;
      const txt = await res.text();
      if (txt && txt.includes(',') && txt.length > 20) return txt;
    } catch(e) { lastErr = e; }
  }
  throw lastErr || new Error('Semua metode fetch gagal. Periksa koneksi internet.');
}

/* ── CSV Parser ── */
function splitLine(line) {
  const cells = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1]==='"') { cur+='"'; i++; } else inQ=!inQ; }
    else if (c===',' && !inQ) { cells.push(cur); cur=''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}
function parseCSV(raw) {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitLine(lines[0]).map(h => h.trim().replace(/^"|"$/g,''));
  return lines.slice(1).map(line => {
    const cells = splitLine(line);
    const obj = {};
    headers.forEach((h,i) => { obj[h] = (cells[i]??'').trim().replace(/^"|"$/g,''); });
    return obj;
  }).filter(row => Object.values(row).some(v=>v!==''));
}

/* ── Helpers ── */
function esc(str) {
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function col(row, ...keys) {
  for (const k of keys) {
    if (row[k]!==undefined && row[k]!=='') return row[k];
    const found = Object.keys(row).find(rk => rk.toLowerCase()===k.toLowerCase());
    if (found && row[found]!=='') return row[found];
  }
  return '';
}
function e(row, ...keys) { return esc(col(row,...keys)||'–'); }
function setText(id,val) { const el=document.getElementById(id); if(el) el.textContent=val; }
function fmtDate(str) {
  if (!str) return '–';
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
  return esc(str);
}

/* ── Categorise ── */
function categorise(row) {
  const jenis = (col(row,'Jenis Data','Jenis')||'').toLowerCase().trim();
  if (jenis==='barang masuk')  return 'masuk';
  if (jenis==='barang keluar') return 'keluar';
  if (jenis==='peminjaman')    return 'peminjaman';
  if (jenis==='perbaikan')     return 'perbaikan';
  if (jenis==='rusak')         return 'perbaikan';
  if (jenis.includes('masuk'))  return 'masuk';
  if (jenis.includes('keluar')) return 'keluar';
  if (jenis.includes('pinjam')) return 'peminjaman';
  if (jenis.includes('perbaik')||jenis.includes('rusak')) return 'perbaikan';
  return 'masuk';
}

/* ── Peminjaman status detector ── */
// Returns: 'belum' | 'kembali'
function returnStatus(row) {
  const ket = (col(row,'Keterangan Tambahan','Keterangan')||'').toLowerCase().trim();
  if (!ket) return 'belum';
  // Cek kata penolak dulu — "belum kembali", "belum dikembalikan", dll
  const notYet = ['belum kembali','belum dikembalikan','belum','not yet','masih dipinjam','sedang dipinjam'];
  if (notYet.some(k => ket.includes(k))) return 'belum';
  // Baru cek sudah kembali
  const returned = ['sudah kembali','sudah dikembalikan','telah kembali','telah dikembalikan','dikembalikan','returned','selesai'];
  if (returned.some(k => ket.includes(k))) return 'kembali';
  return 'belum';
}

/* ── Badges ── */
const CAT_META = {
  masuk:      {cls:'blue',  icon:'fa-arrow-down',   label:'Barang Masuk'},
  keluar:     {cls:'orange',icon:'fa-arrow-up',     label:'Barang Keluar'},
  peminjaman: {cls:'violet',icon:'fa-exchange-alt', label:'Peminjaman'},
  perbaikan:  {cls:'red',   icon:'fa-tools',        label:'Perbaikan'},
};
function catBadge(cat) {
  const m = CAT_META[cat]||{cls:'gray',icon:'fa-circle',label:esc(cat)};
  return `<span class="badge badge-${m.cls}"><i class="fas ${m.icon}"></i>${m.label}</span>`;
}
function jenisBadge(val) {
  const v = (val||'').toLowerCase();
  if (v.includes('rusak'))     return `<span class="badge badge-red"><i class="fas fa-times-circle"></i>${esc(val)}</span>`;
  if (v.includes('perbaikan')) return `<span class="badge badge-orange"><i class="fas fa-tools"></i>${esc(val)}</span>`;
  return `<span class="badge badge-gray">${esc(val||'–')}</span>`;
}

/* ── Keterangan cell renderer ── */
function noteCell(row) {
  const val = col(row,'Keterangan Tambahan','Keterangan')||'';
  if (!val) return `<td class="td-note">–</td>`;
  return `<td class="td-note has-note">${esc(val)}</td>`;
}

/* ── Fetch & process ── */
async function fetchData() {
  const btn = document.getElementById('refreshBtn');
  if (btn) btn.classList.add('loading');
  try {
    const raw = await loadCSV();
    allData = parseCSV(raw).map(r => ({ ...r, _cat: categorise(r) }));
    buildStats();
    buildRecent();
    ['semua','masuk','keluar','peminjaman','perbaikan'].forEach(applyFilters);
    updateTabCounts();
    updateTimestamp();
    showToast('Data berhasil dimuat — ' + allData.length + ' entri', 'success');
  } catch(err) {
    console.error('[Logbook]', err);
    showToast(err.message, 'error');
    const el = document.getElementById('recentList');
    if (el) el.innerHTML = `<div class="error-banner"><i class="fas fa-exclamation-triangle"></i>
      <div><strong>Gagal memuat data</strong><br><small>${esc(err.message)}</small></div></div>`;
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

function updateTimestamp() {
  const el = document.getElementById('lastUpdated');
  if (!el) return;
  el.innerHTML = `<i class="fas fa-clock" style="margin-right:.3rem;"></i>` +
    new Date().toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'});
}

/* ── Stats ── */
function buildStats() {
  const n = cat => allData.filter(r=>r._cat===cat).length;
  setText('stat-total', allData.length);
  setText('stat-masuk', n('masuk'));
  setText('stat-keluar',n('keluar'));
  setText('stat-pinjam',n('peminjaman'));
  setText('stat-rusak', n('perbaikan'));
}
function updateTabCounts() {
  const n = cat => allData.filter(r=>r._cat===cat).length;
  setText('count-semua',      allData.length);
  setText('count-masuk',      n('masuk'));
  setText('count-keluar',     n('keluar'));
  setText('count-peminjaman', n('peminjaman'));
  setText('count-perbaikan',  n('perbaikan'));
}

/* ── Recent ── */
function buildRecent() {
  const el = document.getElementById('recentList');
  if (!el) return;
  // Pin belum-kembali peminjaman first, then rest by timestamp
  const pinned = allData.filter(r => r._cat==='peminjaman' && returnStatus(r)==='belum');
  const rest   = allData.filter(r => !(r._cat==='peminjaman' && returnStatus(r)==='belum'));
  const recent = [...pinned, ...rest].slice(0, 8);
  if (!recent.length) { el.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>Belum ada aktivitas</p></div>`; return; }
  el.innerHTML = '<div class="activity-list">' + recent.map(r => {
    const m    = CAT_META[r._cat]||{cls:'green',icon:'fa-circle'};
    const name = esc(col(r,'Nama')||'–');
    const date = fmtDate(col(r,'Timestamp','Tanggal'));
    const jenis= esc(col(r,'Jenis Data','Jenis')||'');
    const isPinned = r._cat==='peminjaman' && returnStatus(r)==='belum';
    const pinHtml  = isPinned ? `<span style="font-size:.65rem;font-weight:700;color:var(--accent-pin);margin-right:.4rem;"><i class="fas fa-thumbtack"></i> Belum Kembali</span>` : '';
    return `<div class="activity-item" style="${isPinned ? 'border-left-color:var(--accent-pin);background:var(--pin-bg);' : ''}">
      <div class="activity-icon c-${m.cls}"><i class="fas ${m.icon}"></i></div>
      <div class="activity-body">
        <div class="activity-title">${pinHtml}${name}</div>
        <div class="activity-meta">${date}${jenis?' · '+jenis:''}</div>
      </div>
      ${catBadge(r._cat)}
    </div>`;
  }).join('') + '</div>';
}

/* ── Filter & search ── */
function applyFilters(tab) {
  let data = tab==='semua' ? [...allData] : allData.filter(r=>r._cat===tab);
  const q = (searches[tab]||'').toLowerCase().trim();
  if (q) data = data.filter(r => Object.values(r).some(v=>String(v).toLowerCase().includes(q)));
  const fv = filterVals[tab]||{};
  if (fv.jenis) {
    const map = {'barang masuk':'masuk','barang keluar':'keluar','peminjaman':'peminjaman','perbaikan':'perbaikan'};
    const target = map[fv.jenis.toLowerCase()]||fv.jenis.toLowerCase();
    data = data.filter(r=>r._cat===target);
  }
  if (fv.status) {
    if (fv.status==='belum')   data = data.filter(r=>returnStatus(r)==='belum');
    if (fv.status==='kembali') data = data.filter(r=>returnStatus(r)==='kembali');
  }
  // Sort peminjaman: belum-kembali pinned to top
  if (tab==='peminjaman' || tab==='semua') {
    data.sort((a,b) => {
      if (a._cat==='peminjaman' && b._cat==='peminjaman') {
        const as = returnStatus(a)==='belum' ? 0 : 1;
        const bs = returnStatus(b)==='belum' ? 0 : 1;
        return as - bs;
      }
      return 0;
    });
  }
  filteredSets[tab] = data;
  pages[tab] = 1;
  renderTable(tab);
}

/* ── Render tables ── */
function renderTable(tab) {
  const data  = filteredSets[tab]||[];
  const page  = pages[tab];
  const slice = data.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  const tbody = document.getElementById('tbody-'+tab);
  if (!tbody) return;
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="padding:0;"><div class="empty-state"><i class="fas fa-inbox"></i><p>Tidak ada data</p></div></td></tr>`;
    hidePagination(tab); return;
  }
  const fn = {semua:rowSemua,masuk:rowMasuk,keluar:rowKeluar,peminjaman:rowPeminjaman,perbaikan:rowPerbaikan};
  tbody.innerHTML = slice.map(fn[tab]).join('');
  renderPagination(tab, data.length, page);
}

function rowSemua(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(col(r,'Timestamp'))}</td>
    <td>${catBadge(r._cat)}</td>
    <td class="td-name">${e(r,'Nama')}</td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    ${noteCell(r)}
  </tr>`;
}
function rowMasuk(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(col(r,'Tanggal','Timestamp'))}</td>
    <td class="td-name">${e(r,'Nama')}</td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    <td>${e(r,'Email')}</td>
    ${noteCell(r)}
  </tr>`;
}
function rowKeluar(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(col(r,'Tanggal','Timestamp'))}</td>
    <td class="td-name">${e(r,'Nama')}</td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    <td>${e(r,'Alamat')}</td>
    ${noteCell(r)}
  </tr>`;
}
function rowPeminjaman(r) {
  const status   = returnStatus(r);
  const isPinned = status === 'belum';
  const isBack   = status === 'kembali';
  const rowClass = isPinned ? 'row-pinned' : isBack ? 'row-returned' : '';

  const pinHtml = isPinned
    ? `<div class="pin-icon"><i class="fas fa-thumbtack"></i> Belum Dikembalikan</div>`
    : isBack
    ? `<div class="returned-badge"><i class="fas fa-check-circle"></i> Sudah Dikembalikan</div>`
    : '';

  return `<tr class="${rowClass}">
    <td class="td-mono">${fmtDate(col(r,'Tanggal','Timestamp'))}</td>
    <td>
      ${pinHtml}
      <div class="td-name">${e(r,'Nama')}</div>
    </td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    <td>${e(r,'Email')}</td>
    <td class="td-mono">${fmtDate(col(r,'Tanggal Pengembalian'))}</td>
    ${noteCell(r)}
  </tr>`;
}
function rowPerbaikan(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(col(r,'Tanggal','Timestamp'))}</td>
    <td class="td-name">${e(r,'Nama')}</td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${jenisBadge(col(r,'Jenis Data','Jenis'))}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    ${noteCell(r)}
  </tr>`;
}

/* ── Pagination ── */
function renderPagination(tab, total, cur) {
  const el = document.getElementById('pagination-'+tab);
  if (!el) return;
  const totalPages = Math.ceil(total/PAGE_SIZE);
  if (totalPages<=1) { hidePagination(tab); return; }
  const from = (cur-1)*PAGE_SIZE+1, to = Math.min(cur*PAGE_SIZE,total);
  const btns = pagRange(cur,totalPages).map(p =>
    p==='...' ? `<span class="page-btn" style="pointer-events:none;opacity:.4;">…</span>`
              : `<button class="page-btn${p===cur?' active':''}" data-tab="${tab}" data-page="${p}">${p}</button>`
  ).join('');
  el.style.display='flex';
  el.innerHTML=`<span class="page-info">Menampilkan ${from}–${to} dari ${total}</span>
    <div class="page-btns">
      <button class="page-btn" data-tab="${tab}" data-page="${cur-1}" ${cur===1?'disabled':''}>‹</button>
      ${btns}
      <button class="page-btn" data-tab="${tab}" data-page="${cur+1}" ${cur===totalPages?'disabled':''}>›</button>
    </div>`;
  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', e => {
      const t=e.currentTarget.dataset.tab, p=parseInt(e.currentTarget.dataset.page);
      if (!isNaN(p)&&p>=1&&p<=totalPages) { pages[t]=p; renderTable(t); document.getElementById('tab-'+t)?.scrollIntoView({behavior:'smooth',block:'start'}); }
    });
  });
}
function hidePagination(tab) { const el=document.getElementById('pagination-'+tab); if(el) el.style.display='none'; }
function pagRange(cur,total) {
  if (total<=7) return Array.from({length:total},(_,i)=>i+1);
  const r=[1]; if(cur>3) r.push('...'); for(let i=Math.max(2,cur-1);i<=Math.min(total-1,cur+1);i++) r.push(i); if(cur<total-2) r.push('...'); r.push(total); return r;
}

/* ── Toast ── */
function showToast(msg,type='success') {
  const el=document.getElementById('toast'); if(!el) return;
  el.innerHTML=`<i class="fas ${type==='success'?'fa-check-circle':'fa-exclamation-circle'}"></i> ${esc(msg)}`;
  el.className=`toast toast-${type} show`; clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),4000);
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  // Theme
  initTheme();
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

  // Footer year
  const fy = document.getElementById('footer-year');
  if (fy) fy.textContent = new Date().getFullYear();

  // Update form link
  document.querySelectorAll('.btn-form').forEach(a => { a.href = FORM_URL; });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab)?.classList.add('active');
    });
  });

  // Search
  document.querySelectorAll('.search-input').forEach(inp => {
    inp.addEventListener('input', () => {
      searches[inp.dataset.table]=inp.value; pages[inp.dataset.table]=1;
      applyFilters(inp.dataset.table);
    });
  });

  // Filters
  document.querySelectorAll('.filter-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const tab=sel.dataset.table, key=sel.dataset.filter;
      if (!filterVals[tab]) filterVals[tab]={};
      filterVals[tab][key]=sel.value; pages[tab]=1; applyFilters(tab);
    });
  });

  // Refresh
  document.getElementById('refreshBtn')?.addEventListener('click', fetchData);

  // Load
  fetchData();
});
