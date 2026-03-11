/* ═══════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════ */
const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSwsye1WiUetZ5uSo-TqBKKjgk8y3J0ZWUZKAN25T7i-UgLQeNqmI5AHY4Xxa3aHBVMNhOnhlokAMwj/pub?gid=459706998&single=true&output=csv';

const PAGE_SIZE = 15;

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let allData = [];
let filteredSets = { semua: [], masuk: [], keluar: [], peminjaman: [], perbaikan: [] };
let pages       = { semua: 1,  masuk: 1,  keluar: 1,  peminjaman: 1,  perbaikan: 1  };
let searches    = { semua: '', masuk: '', keluar: '', peminjaman: '', perbaikan: '' };
let filterVals  = { semua: { jenis: '' }, peminjaman: { status: '' }, perbaikan: { status: '' } };

/* ═══════════════════════════════════════════
   UTIL
═══════════════════════════════════════════ */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
  return lines.slice(1).map(line => {
    // handle quoted fields
    const cells = [];
    let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    cells.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] ?? '').replace(/^"|"$/g,''); });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== ''));
}

function fmtDate(str) {
  if (!str) return '–';
  // try to parse various formats
  const d = new Date(str);
  if (!isNaN(d)) {
    return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
  }
  return esc(str);
}

function getField(row, ...keys) {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (v !== undefined && v !== '') return v;
  }
  // fuzzy match
  for (const k of keys) {
    const match = Object.keys(row).find(rk => rk.toLowerCase().includes(k.toLowerCase()));
    if (match && row[match]) return row[match];
  }
  return '';
}

/* ═══════════════════════════════════════════
   BADGE HELPERS
═══════════════════════════════════════════ */
function jenisBadge(jenis) {
  const map = {
    'barang masuk': ['blue','fa-arrow-down'],
    'masuk':        ['blue','fa-arrow-down'],
    'barang keluar':['orange','fa-arrow-up'],
    'keluar':       ['orange','fa-arrow-up'],
    'peminjaman':   ['violet','fa-exchange-alt'],
    'pinjam':       ['violet','fa-exchange-alt'],
    'perbaikan':    ['red','fa-tools'],
    'rusak':        ['red','fa-tools'],
  };
  const key = String(jenis).toLowerCase().trim();
  const [cls, icon] = map[key] || ['gray','fa-circle'];
  return `<span class="badge badge-${cls}"><i class="fas ${icon}" style="font-size:.6rem;margin-right:.3rem;"></i>${esc(jenis)}</span>`;
}

function statusBadge(status) {
  const s = String(status).toLowerCase();
  if (s.includes('kembali'))  return `<span class="badge badge-green">${esc(status)}</span>`;
  if (s.includes('dipinjam')) return `<span class="badge badge-blue">${esc(status)}</span>`;
  if (s.includes('terlambat'))return `<span class="badge badge-red">${esc(status)}</span>`;
  if (s.includes('selesai'))  return `<span class="badge badge-green">${esc(status)}</span>`;
  if (s.includes('perbaikan'))return `<span class="badge badge-orange">${esc(status)}</span>`;
  if (s.includes('rusak'))    return `<span class="badge badge-red">${esc(status)}</span>`;
  if (s.includes('baik') || s.includes('bagus')) return `<span class="badge badge-green">${esc(status)}</span>`;
  if (!status) return `<span class="badge badge-gray">–</span>`;
  return `<span class="badge badge-gray">${esc(status)}</span>`;
}

/* ═══════════════════════════════════════════
   CATEGORISE ROWS
═══════════════════════════════════════════ */
function categorise(row) {
  // Try to find a "Jenis" or "Kategori" or "Tipe" column
  const jenis = (
    getField(row,'Jenis','Type','Tipe','Kategori Transaksi','Jenis Barang','jenis') ||
    ''
  ).toLowerCase();

  if (jenis.includes('masuk'))       return 'masuk';
  if (jenis.includes('keluar'))      return 'keluar';
  if (jenis.includes('pinjam'))      return 'peminjaman';
  if (jenis.includes('perbaikan') || jenis.includes('rusak')) return 'perbaikan';

  // Fallback: check for return date field or status
  const status = getField(row,'Status','status','Kondisi').toLowerCase();
  if (status.includes('dipinjam') || status.includes('kembali') || status.includes('terlambat'))
    return 'peminjaman';
  if (status.includes('rusak') || status.includes('perbaikan'))
    return 'perbaikan';

  // Check column presence
  if (getField(row,'Tujuan','Penerima','tujuan')) return 'keluar';
  if (getField(row,'Peminjam','peminjam','Jatuh Tempo','Due Date')) return 'peminjaman';

  return 'masuk'; // default
}

/* ═══════════════════════════════════════════
   FETCH WITH CORS PROXY FALLBACKS
═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   FETCH  — Google Published Sheet CSV
   (Google sends Access-Control-Allow-Origin: *
    on /pub?output=csv so no proxy needed)
═══════════════════════════════════════════ */
const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/' +
  '2PACX-1vSwsye1WiUetZ5uSo-TqBKKjgk8y3J0ZWUZKAN25T7i-UgLQeNqmI5AHY4Xxa3aHBVMNhOnhlokAMwj' +
  '/pub?gid=459706998&single=true&output=csv';

async function loadCSV() {
  // Try direct fetch first — works in real browsers
  const urls = [
    CSV_URL + '&_=' + Date.now(),
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(CSV_URL),
    'https://corsproxy.io/?url='          + encodeURIComponent(CSV_URL),
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      if (txt && txt.trim().length > 10) return txt;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Semua metode fetch gagal.');
}

async function fetchData() {
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.classList.add('loading');
  try {
    const text = await loadCSV();
    allData = parseCSV(text);
    // tag each row
    allData = allData.map(r => ({ ...r, _cat: categorise(r) }));

    buildStats();
    buildRecent();
    applyFilters('semua');
    applyFilters('masuk');
    applyFilters('keluar');
    applyFilters('peminjaman');
    applyFilters('perbaikan');
    updateTabCounts();
    updateTimestamp();
    showToast('Data berhasil dimuat', 'success');
  } catch (err) {
    console.error(err);
    showToast('Gagal memuat data: ' + err.message, 'error');
    showDashboardError();
  } finally {
    refreshBtn.classList.remove('loading');
  }
}

function showDashboardError() {
  document.getElementById('recentList').innerHTML =
    `<div class="error-banner"><i class="fas fa-exclamation-triangle"></i>
    Gagal memuat data dari Google Sheets. Pastikan koneksi internet aktif lalu klik Refresh.</div>`;
}

function updateTimestamp() {
  const el = document.getElementById('lastUpdated');
  const now = new Date().toLocaleString('id-ID', { dateStyle:'medium', timeStyle:'short' });
  el.innerHTML = `<i class="fas fa-clock" style="margin-right:.3rem;"></i>Update: ${now}`;
}

/* ═══════════════════════════════════════════
   STATS
═══════════════════════════════════════════ */
function buildStats() {
  const cats = allData.map(r => r._cat);
  const count = cat => cats.filter(c => c === cat).length;

  setText('stat-total',     allData.length);
  setText('stat-masuk',     count('masuk'));
  setText('stat-keluar',    count('keluar'));
  setText('stat-pinjam',    count('peminjaman'));
  setText('stat-rusak',     count('perbaikan'));
}

function updateTabCounts() {
  const set = cat => allData.filter(r => r._cat === cat).length;
  setText('count-semua',      allData.length);
  setText('count-masuk',      set('masuk'));
  setText('count-keluar',     set('keluar'));
  setText('count-peminjaman', set('peminjaman'));
  setText('count-perbaikan',  set('perbaikan'));
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ═══════════════════════════════════════════
   RECENT ACTIVITY (last 8 entries)
═══════════════════════════════════════════ */
function buildRecent() {
  const recent = [...allData].slice(-8).reverse();
  const list = document.getElementById('recentList');
  if (!recent.length) {
    list.innerHTML = emptyHTML('Belum ada aktivitas');
    return;
  }
  const iconMap = {
    masuk:      ['c-blue',   'fa-arrow-down'],
    keluar:     ['c-orange', 'fa-arrow-up'],
    peminjaman: ['c-violet', 'fa-exchange-alt'],
    perbaikan:  ['c-red',    'fa-tools'],
  };
  list.innerHTML = `<div class="activity-list">${recent.map(r => {
    const [cls, icon] = iconMap[r._cat] || ['c-green','fa-circle'];
    const name = esc(getField(r,'Nama Barang','Barang','nama barang','Item','barang') || 'Barang');
    const date = fmtDate(getField(r,'Timestamp','Tanggal','Date','tanggal'));
    const who  = esc(getField(r,'Peminjam','PIC','Penanggung Jawab','Nama','Operator','peminjam') || '');
    return `
      <div class="activity-item">
        <div class="activity-icon ${cls}"><i class="fas ${icon}"></i></div>
        <div class="activity-body">
          <div class="activity-title">${name}</div>
          <div class="activity-meta">${date}${who ? ' · ' + who : ''}</div>
        </div>
        ${jenisBadge(r._cat === 'masuk' ? 'Barang Masuk' : r._cat === 'keluar' ? 'Barang Keluar' : r._cat === 'peminjaman' ? 'Peminjaman' : 'Perbaikan')}
      </div>`;
  }).join('')}</div>`;
}

/* ═══════════════════════════════════════════
   FILTER & SEARCH
═══════════════════════════════════════════ */
function applyFilters(tab) {
  let data = tab === 'semua' ? [...allData] : allData.filter(r => r._cat === tab);

  // search
  const q = (searches[tab] || '').toLowerCase();
  if (q) {
    data = data.filter(r =>
      Object.values(r).some(v => String(v).toLowerCase().includes(q))
    );
  }

  // extra filters
  const fv = filterVals[tab] || {};
  if (fv.jenis) {
    data = data.filter(r =>
      (getField(r,'Jenis','Type','Tipe','jenis') || r._cat || '').toLowerCase()
        .includes(fv.jenis.toLowerCase())
    );
  }
  if (fv.status) {
    data = data.filter(r =>
      (getField(r,'Status','Kondisi','status') || '').toLowerCase()
        .includes(fv.status.toLowerCase())
    );
  }

  filteredSets[tab] = data;
  pages[tab] = 1;
  renderTable(tab);
}

/* ═══════════════════════════════════════════
   RENDER TABLES
═══════════════════════════════════════════ */
function renderTable(tab) {
  const data = filteredSets[tab] || [];
  const page = pages[tab];
  const start = (page - 1) * PAGE_SIZE;
  const slice = data.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById(`tbody-${tab}`);
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="10">${emptyHTML('Tidak ada data yang cocok')}</td></tr>`;
    hidePagination(tab);
    return;
  }

  if (tab === 'semua')      tbody.innerHTML = slice.map(rowSemua).join('');
  else if (tab === 'masuk') tbody.innerHTML = slice.map(rowMasuk).join('');
  else if (tab === 'keluar')tbody.innerHTML = slice.map(rowKeluar).join('');
  else if (tab === 'peminjaman') tbody.innerHTML = slice.map(rowPeminjaman).join('');
  else if (tab === 'perbaikan')  tbody.innerHTML = slice.map(rowPerbaikan).join('');

  renderPagination(tab, data.length, page);
}

function g(row, ...keys) { return esc(getField(row, ...keys) || '–'); }

function rowSemua(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(getField(r,'Timestamp','Tanggal','Date'))}</td>
    <td>${jenisBadge(r._cat === 'masuk' ? 'Barang Masuk' : r._cat === 'keluar' ? 'Barang Keluar' : r._cat === 'peminjaman' ? 'Peminjaman' : 'Perbaikan')}</td>
    <td class="td-name">${g(r,'Nama Barang','Barang','Item','nama barang')}</td>
    <td class="td-mono">${g(r,'Jumlah','Qty','qty','jumlah')}</td>
    <td class="td-trunc" title="${esc(getField(r,'Keterangan','Catatan','Deskripsi','keterangan'))}">
      ${g(r,'Keterangan','Catatan','Deskripsi','keterangan')}</td>
    <td>${g(r,'Peminjam','PIC','Penanggung Jawab','Nama','peminjam','pic')}</td>
  </tr>`;
}

function rowMasuk(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(getField(r,'Timestamp','Tanggal','Date'))}</td>
    <td class="td-name">${g(r,'Nama Barang','Barang','Item','nama barang')}</td>
    <td>${g(r,'Kategori','Jenis Barang','kategori')}</td>
    <td class="td-mono">${g(r,'Jumlah','Qty','jumlah')}</td>
    <td>${statusBadge(getField(r,'Kondisi','Kondisi Barang','kondisi'))}</td>
    <td class="td-trunc">${g(r,'Keterangan','Catatan','keterangan')}</td>
  </tr>`;
}

function rowKeluar(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(getField(r,'Timestamp','Tanggal','Date'))}</td>
    <td class="td-name">${g(r,'Nama Barang','Barang','Item','nama barang')}</td>
    <td class="td-mono">${g(r,'Jumlah','Qty','jumlah')}</td>
    <td>${g(r,'Tujuan','Penerima','tujuan')}</td>
    <td>${g(r,'PIC','Penanggung Jawab','Operator','pic')}</td>
    <td class="td-trunc">${g(r,'Keterangan','Catatan','keterangan')}</td>
  </tr>`;
}

function rowPeminjaman(r) {
  const status = getField(r,'Status','status') || 'Dipinjam';
  return `<tr>
    <td class="td-mono">${fmtDate(getField(r,'Timestamp','Tanggal Pinjam','Tanggal','Date'))}</td>
    <td class="td-name">${g(r,'Nama Barang','Barang','Item','nama barang')}</td>
    <td>${g(r,'Peminjam','Nama Peminjam','peminjam')}</td>
    <td class="td-mono">${g(r,'Jumlah','Qty','jumlah')}</td>
    <td class="td-mono">${fmtDate(getField(r,'Jatuh Tempo','Due Date','Tanggal Kembali','jatuh tempo'))}</td>
    <td>${statusBadge(status)}</td>
  </tr>`;
}

function rowPerbaikan(r) {
  return `<tr>
    <td class="td-mono">${fmtDate(getField(r,'Timestamp','Tanggal','Date'))}</td>
    <td class="td-name">${g(r,'Nama Barang','Barang','Item','nama barang')}</td>
    <td>${statusBadge(getField(r,'Kondisi','Kondisi Barang','kondisi'))}</td>
    <td class="td-trunc" title="${esc(getField(r,'Deskripsi','Kerusakan','Keterangan','deskripsi'))}">${g(r,'Deskripsi','Kerusakan','Keterangan','deskripsi')}</td>
    <td>${statusBadge(getField(r,'Status','status'))}</td>
  </tr>`;
}

function emptyHTML(msg) {
  return `<div class="empty-state"><i class="fas fa-inbox"></i><p>${msg}</p></div>`;
}

/* ═══════════════════════════════════════════
   PAGINATION
═══════════════════════════════════════════ */
function renderPagination(tab, total, cur) {
  const el = document.getElementById(`pagination-${tab}`);
  if (!el) return;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) { hidePagination(tab); return; }

  const from = (cur - 1) * PAGE_SIZE + 1;
  const to   = Math.min(cur * PAGE_SIZE, total);

  let btns = '';
  const range = pagRange(cur, totalPages);
  range.forEach(p => {
    if (p === '…') btns += `<span class="page-btn" style="pointer-events:none;">…</span>`;
    else btns += `<button class="page-btn${p === cur ? ' active' : ''}" data-tab="${tab}" data-page="${p}">${p}</button>`;
  });

  el.style.display = 'flex';
  el.innerHTML = `
    <span class="page-info">Menampilkan ${from}–${to} dari ${total} data</span>
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
        pages[t] = p; renderTable(t);
        document.getElementById(`tab-${t}`).scrollIntoView({ behavior:'smooth', block:'start' });
      }
    });
  });
}

function hidePagination(tab) {
  const el = document.getElementById(`pagination-${tab}`);
  if (el) el.style.display = 'none';
}

function pagRange(cur, total) {
  if (total <= 7) return Array.from({length:total},(_,i)=>i+1);
  const r = [];
  r.push(1);
  if (cur > 3) r.push('…');
  for (let i = Math.max(2, cur-1); i <= Math.min(total-1, cur+1); i++) r.push(i);
  if (cur < total - 2) r.push('…');
  r.push(total);
  return r;
}

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
  el.innerHTML = `<i class="fas ${icon}"></i> ${esc(msg)}`;
  el.className = `toast toast-${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ═══════════════════════════════════════════
   EVENT WIRING
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      const sec = document.getElementById(`tab-${tab}`);
      if (sec) sec.classList.add('active');
    });
  });

  // Search inputs
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
      const tab = sel.dataset.table;
      const key = sel.dataset.filter;
      if (!filterVals[tab]) filterVals[tab] = {};
      filterVals[tab][key] = sel.value;
      pages[tab] = 1;
      applyFilters(tab);
    });
  });

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', fetchData);

  // Auto-update footer year
  const fyEl = document.getElementById('footer-year');
  if (fyEl) fyEl.textContent = new Date().getFullYear();

  // Initial load
  fetchData();
});
