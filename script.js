/* =============================================
   LOGBOOK BARANG LABORATORIUM — script.js
   Kolom spreadsheet (dari Google Form):
   Timestamp, Jenis Data, Tanggal, Nama,
   NPM/NIK/NIP, Email, Alamat, Nomor telepon,
   Tanggal Pengembalian, Keterangan Tambahan
   ============================================= */

/* --- Config --- */
const CSV_URL   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSwsye1WiUetZ5uSo-TqBKKjgk8y3J0ZWUZKAN25T7i-UgLQeNqmI5AHY4Xxa3aHBVMNhOnhlokAMwj/pub?gid=459706998&single=true&output=csv';
const FORM_URL  = 'https://docs.google.com/forms/d/e/1FAIpQLSemwwYZyEB0MGCLYaUr8Deyid8qj0PVLKcAVbSf8gTKDt_KOA/viewform';
const PAGE_SIZE = 15;

/* --- State --- */
let allData      = [];
let filteredSets = { semua: [], masuk: [], keluar: [], peminjaman: [], perbaikan: [] };
let pages        = { semua: 1,  masuk: 1,  keluar: 1,  peminjaman: 1,  perbaikan: 1  };
let searches     = { semua: '', masuk: '', keluar: '', peminjaman: '', perbaikan: '' };
let filterVals   = { semua: { jenis: '' }, peminjaman: { status: '' }, perbaikan: { status: '' } };

/* =============================================
   FETCH — direct then CORS proxy fallbacks
   ============================================= */
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
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const txt = await res.text();
      if (txt && txt.includes(',') && txt.length > 20) return txt;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Semua metode fetch gagal. Periksa koneksi internet.');
}

/* =============================================
   CSV PARSER
   ============================================= */
function splitLine(line) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

function parseCSV(raw) {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const cells = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim().replace(/^"|"$/g, ''); });
    return obj;
  }).filter(row => Object.values(row).some(v => v !== ''));
}

/* =============================================
   CATEGORISE
   Berdasarkan kolom "Jenis Data" dari form
   Nilai: Peminjaman | Barang Masuk | Barang Keluar | Perbaikan | Rusak
   ============================================= */
function categorise(row) {
  // Kolom utama dari form baru
  const jenis = (row['Jenis Data'] || row['Jenis'] || '').toLowerCase().trim();

  if (jenis === 'barang masuk')  return 'masuk';
  if (jenis === 'barang keluar') return 'keluar';
  if (jenis === 'peminjaman')    return 'peminjaman';
  if (jenis === 'perbaikan')     return 'perbaikan';
  if (jenis === 'rusak')         return 'perbaikan'; // rusak masuk ke tab perbaikan

  // Fallback fuzzy
  if (jenis.includes('masuk'))   return 'masuk';
  if (jenis.includes('keluar'))  return 'keluar';
  if (jenis.includes('pinjam'))  return 'peminjaman';
  if (jenis.includes('perbaik') || jenis.includes('rusak')) return 'perbaikan';

  return 'masuk';
}

/* =============================================
   HELPERS
   ============================================= */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function col(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  // case-insensitive fallback
  for (const k of keys) {
    const found = Object.keys(row).find(rk => rk.toLowerCase() === k.toLowerCase());
    if (found && row[found] !== '') return row[found];
  }
  return '';
}

function e(row, ...keys) { return esc(col(row, ...keys) || '–'); }

function fmtDate(str) {
  if (!str) return '–';
  const d = new Date(str);
  if (!isNaN(d.getTime()))
    return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
  return esc(str);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* =============================================
   BADGES
   ============================================= */
const CAT_META = {
  masuk:      { cls:'blue',   icon:'fa-arrow-down',   label:'Barang Masuk'  },
  keluar:     { cls:'orange', icon:'fa-arrow-up',     label:'Barang Keluar' },
  peminjaman: { cls:'violet', icon:'fa-exchange-alt', label:'Peminjaman'    },
  perbaikan:  { cls:'red',    icon:'fa-tools',        label:'Perbaikan'     },
};

function catBadge(cat) {
  const m = CAT_META[cat] || { cls:'gray', icon:'fa-circle', label: esc(cat) };
  return `<span class="badge badge-${m.cls}"><i class="fas ${m.icon}" style="font-size:.6rem;margin-right:.25rem;"></i>${m.label}</span>`;
}

function jenisBadge(val) {
  const v = (val||'').toLowerCase();
  if (v.includes('rusak'))    return `<span class="badge badge-red"><i class="fas fa-exclamation-circle" style="font-size:.6rem;margin-right:.25rem;"></i>${esc(val)}</span>`;
  if (v.includes('perbaikan'))return `<span class="badge badge-orange"><i class="fas fa-tools" style="font-size:.6rem;margin-right:.25rem;"></i>${esc(val)}</span>`;
  return `<span class="badge badge-gray">${esc(val||'–')}</span>`;
}

/* =============================================
   FETCH & PROCESS
   ============================================= */
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
  } catch (err) {
    console.error('[Logbook]', err);
    showToast(err.message, 'error');
    document.getElementById('recentList').innerHTML =
      `<div class="error-banner"><i class="fas fa-exclamation-triangle"></i>
       <div><strong>Gagal memuat data</strong><br><small>${esc(err.message)}</small></div></div>`;
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

function updateTimestamp() {
  const el = document.getElementById('lastUpdated');
  if (!el) return;
  el.innerHTML = `<i class="fas fa-clock" style="margin-right:.3rem;"></i>` +
    new Date().toLocaleString('id-ID', { dateStyle:'medium', timeStyle:'short' });
}

/* =============================================
   STATS & RECENT
   ============================================= */
function buildStats() {
  const n = cat => allData.filter(r => r._cat === cat).length;
  setText('stat-total',  allData.length);
  setText('stat-masuk',  n('masuk'));
  setText('stat-keluar', n('keluar'));
  setText('stat-pinjam', n('peminjaman'));
  setText('stat-rusak',  n('perbaikan'));
}

function updateTabCounts() {
  const n = cat => allData.filter(r => r._cat === cat).length;
  setText('count-semua',      allData.length);
  setText('count-masuk',      n('masuk'));
  setText('count-keluar',     n('keluar'));
  setText('count-peminjaman', n('peminjaman'));
  setText('count-perbaikan',  n('perbaikan'));
}

function buildRecent() {
  const el = document.getElementById('recentList');
  if (!el) return;
  const recent = [...allData].slice(-8).reverse();
  if (!recent.length) { el.innerHTML = emptyHTML('Belum ada aktivitas'); return; }
  el.innerHTML = '<div class="activity-list">' + recent.map(r => {
    const m    = CAT_META[r._cat] || { cls:'green', icon:'fa-circle' };
    const name = esc(col(r, 'Nama') || '–');
    const date = fmtDate(col(r, 'Timestamp', 'Tanggal'));
    const jenis = esc(col(r, 'Jenis Data', 'Jenis') || '');
    return `<div class="activity-item">
      <div class="activity-icon c-${m.cls}"><i class="fas ${m.icon}"></i></div>
      <div class="activity-body">
        <div class="activity-title">${name}</div>
        <div class="activity-meta">${date}${jenis ? ' · ' + jenis : ''}</div>
      </div>
      ${catBadge(r._cat)}
    </div>`;
  }).join('') + '</div>';
}

/* =============================================
   FILTER & SEARCH
   ============================================= */
function applyFilters(tab) {
  let data = tab === 'semua' ? [...allData] : allData.filter(r => r._cat === tab);

  const q = (searches[tab] || '').toLowerCase().trim();
  if (q) data = data.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));

  const fv = filterVals[tab] || {};
  if (fv.jenis) {
    const map = { 'barang masuk':'masuk', 'barang keluar':'keluar', 'peminjaman':'peminjaman', 'perbaikan':'perbaikan' };
    const target = map[fv.jenis.toLowerCase()] || fv.jenis.toLowerCase();
    data = data.filter(r => r._cat === target);
  }

  filteredSets[tab] = data;
  pages[tab] = 1;
  renderTable(tab);
}

/* =============================================
   RENDER TABLES
   Kolom yang ada: Timestamp, Jenis Data, Tanggal,
   Nama, NPM/NIK/NIP, Email, Nomor telepon,
   Tanggal Pengembalian, Keterangan Tambahan
   ============================================= */
function renderTable(tab) {
  const data  = filteredSets[tab] || [];
  const page  = pages[tab];
  const slice = data.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  const tbody = document.getElementById('tbody-' + tab);
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="padding:0;">${emptyHTML('Tidak ada data')}</td></tr>`;
    hidePagination(tab);
    return;
  }
  const fn = { semua: rowSemua, masuk: rowMasuk, keluar: rowKeluar, peminjaman: rowPeminjaman, perbaikan: rowPerbaikan };
  tbody.innerHTML = slice.map(fn[tab]).join('');
  renderPagination(tab, data.length, page);
}

/* ── Row renderers sesuai kolom form ── */
function rowSemua(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(col(r,'Timestamp'))}</td>
    <td>${catBadge(r._cat)}</td>
    <td class="td-name">${e(r,'Nama')}</td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    <td class="td-trunc" title="${esc(col(r,'Keterangan Tambahan'))}">${e(r,'Keterangan Tambahan')}</td>
  </tr>`;
}

function rowMasuk(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(col(r,'Tanggal','Timestamp'))}</td>
    <td class="td-name">${e(r,'Nama')}</td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    <td>${e(r,'Email')}</td>
    <td class="td-trunc">${e(r,'Keterangan Tambahan')}</td>
  </tr>`;
}

function rowKeluar(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(col(r,'Tanggal','Timestamp'))}</td>
    <td class="td-name">${e(r,'Nama')}</td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    <td>${e(r,'Alamat')}</td>
    <td class="td-trunc">${e(r,'Keterangan Tambahan')}</td>
  </tr>`;
}

function rowPeminjaman(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(col(r,'Tanggal','Timestamp'))}</td>
    <td class="td-name">${e(r,'Nama')}</td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    <td>${e(r,'Email')}</td>
    <td class="td-mono">${fmtDate(col(r,'Tanggal Pengembalian'))}</td>
    <td class="td-trunc">${e(r,'Keterangan Tambahan')}</td>
  </tr>`;
}

function rowPerbaikan(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(col(r,'Tanggal','Timestamp'))}</td>
    <td class="td-name">${e(r,'Nama')}</td>
    <td class="td-mono">${e(r,'NPM/NIK/NIP')}</td>
    <td>${jenisBadge(col(r,'Jenis Data','Jenis'))}</td>
    <td>${e(r,'Nomor telepon','Nomor Telepon')}</td>
    <td class="td-trunc">${e(r,'Keterangan Tambahan')}</td>
  </tr>`;
}

function emptyHTML(msg) {
  return `<div class="empty-state"><i class="fas fa-inbox"></i><p>${esc(msg)}</p></div>`;
}

/* =============================================
   PAGINATION
   ============================================= */
function renderPagination(tab, total, cur) {
  const el = document.getElementById('pagination-' + tab);
  if (!el) return;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) { hidePagination(tab); return; }

  const from = (cur-1)*PAGE_SIZE + 1;
  const to   = Math.min(cur*PAGE_SIZE, total);
  const btns = pagRange(cur, totalPages).map(p =>
    p === '...'
      ? `<span class="page-btn" style="pointer-events:none;opacity:.4;">…</span>`
      : `<button class="page-btn${p===cur?' active':''}" data-tab="${tab}" data-page="${p}">${p}</button>`
  ).join('');

  el.style.display = 'flex';
  el.innerHTML = `
    <span class="page-info">Menampilkan ${from}–${to} dari ${total}</span>
    <div class="page-btns">
      <button class="page-btn" data-tab="${tab}" data-page="${cur-1}" ${cur===1?'disabled':''}>‹</button>
      ${btns}
      <button class="page-btn" data-tab="${tab}" data-page="${cur+1}" ${cur===totalPages?'disabled':''}>›</button>
    </div>`;

  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', e => {
      const t = e.currentTarget.dataset.tab;
      const p = parseInt(e.currentTarget.dataset.page);
      if (!isNaN(p) && p >= 1 && p <= totalPages) {
        pages[t] = p;
        renderTable(t);
        document.getElementById('tab-'+t)?.scrollIntoView({ behavior:'smooth', block:'start' });
      }
    });
  });
}

function hidePagination(tab) {
  const el = document.getElementById('pagination-'+tab);
  if (el) el.style.display = 'none';
}

function pagRange(cur, total) {
  if (total <= 7) return Array.from({length:total},(_,i)=>i+1);
  const r = [1];
  if (cur > 3) r.push('...');
  for (let i = Math.max(2,cur-1); i <= Math.min(total-1,cur+1); i++) r.push(i);
  if (cur < total-2) r.push('...');
  r.push(total);
  return r;
}

/* =============================================
   TOAST
   ============================================= */
function showToast(msg, type='success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':'fa-exclamation-circle'}"></i> ${esc(msg)}`;
  el.className = `toast toast-${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 4000);
}

/* =============================================
   INIT
   ============================================= */
document.addEventListener('DOMContentLoaded', () => {

  // Footer year
  const fy = document.getElementById('footer-year');
  if (fy) fy.textContent = new Date().getFullYear();

  // Update form link ke form baru
  document.querySelectorAll('.btn-form').forEach(a => { a.href = FORM_URL; });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active');
    });
  });

  // Search
  document.querySelectorAll('.search-input').forEach(inp => {
    inp.addEventListener('input', () => {
      searches[inp.dataset.table] = inp.value;
      pages[inp.dataset.table] = 1;
      applyFilters(inp.dataset.table);
    });
  });

  // Filter selects
  document.querySelectorAll('.filter-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const tab = sel.dataset.table, key = sel.dataset.filter;
      if (!filterVals[tab]) filterVals[tab] = {};
      filterVals[tab][key] = sel.value;
      pages[tab] = 1;
      applyFilters(tab);
    });
  });

  // Refresh
  document.getElementById('refreshBtn')?.addEventListener('click', fetchData);

  // Load
  fetchData();
});
