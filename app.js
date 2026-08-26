// ---- Configuration ----------------------------------------------------
// Ganti sheetId jika ingin memakai Google Sheet lain. Sheet WAJIB dibagikan
// sebagai "Siapa saja yang memiliki link" (Anyone with the link) agar bisa
// dibaca tanpa login.
const CONFIG = {
  sheetId: '1U5VCWds37zRfDwAblrBV2kwTPURpR38kZ2Hc-0GYPDc',
  sheetName: 'Form responses 1', // nama tab persis seperti di Google Sheets
  gid: 0, // fallback jika pencarian berdasarkan nama tab gagal
  refreshIntervalMs: 60000,
  pageSize: 25,
};

// Kolom diambil berdasarkan TEKS HEADER, bukan huruf kolom (A/BE/dst).
// Sheet ini adalah respons Google Form dengan pertanyaan bercabang per
// Jenjang/Kab-Kota, jadi jumlah kolom perantara ("Jenjang", "NPSN - Nama
// Sekolah") terus bertambah setiap kali ada kombinasi baru masuk — artinya
// posisi kolom hasil akhir (Jenjang Sekolah, NPSN, dst) ikut bergeser ke
// kanan seiring waktu. Mencocokkan berdasarkan nama header membuat ini
// tahan terhadap pergeseran tersebut.
const FIELD_LABELS = {
  timestamp: 'Timestamp',
  nama: 'Nama Peserta',
  jabatan: 'Jabatan',
  jenisBimtek: 'Jenis Bimtek',
  kabKota: 'Kab/Kota',
  jenjang: 'Jenjang Sekolah',
  npsn: 'NPSN',
  namaSekolah: 'Nama Sekolah',
  namaGugus: 'Nama Gugus',
};

// ---- State --------------------------------------------------------------
let allRows = [];
let filteredRows = [];
let currentPage = 1;
let sortKey = 'timestamp';
let sortDir = 'desc';
let refreshTimer = null;

// ---- DOM refs -------------------------------------------------------------
const el = (id) => document.getElementById(id);
const sheetLink = el('sheetLink');
sheetLink.href = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit`;

// ---- Theme toggle ---------------------------------------------------------
(function initTheme() {
  // Default tampilan cerah/terang, tidak ikut preferensi gelap sistem,
  // kecuali pengguna pernah memilih gelap secara manual lewat tombol.
  const saved = localStorage.getItem('absensi-theme');
  document.documentElement.setAttribute('data-theme', saved || 'light');
  el('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('absensi-theme', next);
    renderCharts();
  });
})();

// ---- Data loading (JSONP via Google Visualization API, avoids CORS) ------
function fetchGvizOnce(tabParam) {
  return new Promise((resolve, reject) => {
    const callbackName = 'gvizCallback_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Waktu permintaan habis. Periksa koneksi internet Anda.'));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = (json) => {
      cleanup();
      resolve(json);
    };

    // Tidak pakai parameter "tq" (select kolom) — ambil semua kolom apa
    // adanya, lalu cocokkan berdasarkan teks header saat parsing. Ini
    // menghindari ketergantungan pada huruf kolom yang bisa bergeser.
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?${tabParam}&tqx=out:json;responseHandler:${callbackName}`;
    const script = document.createElement('script');
    script.src = url;
    script.onerror = () => {
      cleanup();
      reject(new Error('Gagal memuat data dari Google Sheets. Pastikan sheet dibagikan sebagai "Siapa saja yang memiliki link".'));
    };
    document.body.appendChild(script);
  });
}

// Coba akses tab berdasarkan nama dulu (paling akurat), lalu fallback ke gid
// jika nama tab berubah/tidak ditemukan.
async function loadSheetData() {
  const byName = `sheet=${encodeURIComponent(CONFIG.sheetName)}`;
  try {
    const json = await fetchGvizOnce(byName);
    if (json.status !== 'error') return json;
    console.warn('Gagal ambil data via nama sheet, mencoba via gid…', json);
  } catch (err) {
    console.warn('Gagal ambil data via nama sheet, mencoba via gid…', err);
  }
  const byGid = `gid=${CONFIG.gid}`;
  return fetchGvizOnce(byGid);
}

function cellValue(cell) {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
  if (cell.v === undefined || cell.v === null) return '';
  return String(cell.v).trim();
}

function buildColumnIndex(cols) {
  const index = {};
  (cols || []).forEach((col, i) => {
    if (col.label && !(col.label in index)) index[col.label] = i;
  });
  return index;
}

function parseGvizResponse(json) {
  if (json.status === 'error') {
    const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || 'Format sheet tidak sesuai.';
    throw new Error(msg);
  }
  const table = json.table;
  const colIndex = buildColumnIndex(table.cols);
  const missing = Object.entries(FIELD_LABELS).filter(([, label]) => !(label in colIndex));
  if (missing.length) {
    throw new Error(`Kolom tidak ditemukan di sheet: ${missing.map(([, l]) => l).join(', ')}`);
  }

  const rows = (table.rows || []).map((r) => {
    const obj = {};
    Object.entries(FIELD_LABELS).forEach(([key, label]) => {
      obj[key] = cellValue(r.c && r.c[colIndex[label]]);
    });
    obj.date = parseTimestamp(obj.timestamp);
    return obj;
  }).filter((row) => row.nama); // buang baris kosong
  return { rows, label: table.label || '' };
}

// Format timestamp Google Form Indonesia: dd/mm/yyyy HH:mm:ss
function parseTimestamp(str) {
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  const [, dd, mm, yyyy, hh, min, ss] = m;
  return new Date(+yyyy, +mm - 1, +dd, +hh, +min, ss ? +ss : 0);
}

function formatTimestamp(date) {
  if (!date) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---- Filters --------------------------------------------------------------
function populateFilterOptions() {
  fillSelect('filterKabkota', uniqueSorted(allRows.map((r) => r.kabKota)));
  fillSelect('filterJenjang', uniqueSorted(allRows.map((r) => r.jenjang)));
  fillSelect('filterBimtek', uniqueSorted(allRows.map((r) => r.jenisBimtek)));
}

function uniqueSorted(list) {
  return Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id'));
}

function fillSelect(id, options) {
  const select = el(id);
  const current = select.value;
  select.innerHTML = '<option value="">Semua</option>' + options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  if (options.includes(current)) select.value = current;
}

function applyFilters() {
  const kab = el('filterKabkota').value;
  const jenjang = el('filterJenjang').value;
  const bimtek = el('filterBimtek').value;
  const q = el('filterSearch').value.trim().toLowerCase();

  filteredRows = allRows.filter((r) => {
    if (kab && r.kabKota !== kab) return false;
    if (jenjang && r.jenjang !== jenjang) return false;
    if (bimtek && r.jenisBimtek !== bimtek) return false;
    if (q) {
      const hay = `${r.nama} ${r.namaSekolah} ${r.namaGugus}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  sortRows();
  currentPage = 1;
  renderAll();
}

// ---- Sorting & table --------------------------------------------------------------
function sortRows() {
  filteredRows.sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (sortKey === 'timestamp') {
      av = a.date ? a.date.getTime() : 0;
      bv = b.date ? b.date.getTime() : 0;
    } else {
      av = (av || '').toString().toLowerCase();
      bv = (bv || '').toString().toLowerCase();
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderTable() {
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / CONFIG.pageSize));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * CONFIG.pageSize;
  const pageRows = filteredRows.slice(start, start + CONFIG.pageSize);

  el('tableCount').textContent = filteredRows.length;
  el('pageInfo').textContent = `Halaman ${currentPage} dari ${totalPages}`;

  const tbody = el('tableBody');
  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px;">Tidak ada data yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows.map((r) => `
    <tr>
      <td>${escapeHtml(formatTimestamp(r.date))}</td>
      <td>${escapeHtml(r.nama)}</td>
      <td>${escapeHtml(r.jabatan)}</td>
      <td>${escapeHtml(r.jenisBimtek)}</td>
      <td>${escapeHtml(r.kabKota)}</td>
      <td>${escapeHtml(r.jenjang)}</td>
      <td>${escapeHtml(r.npsn)}</td>
      <td>${escapeHtml(r.namaSekolah)}</td>
      <td>${escapeHtml(r.namaGugus)}</td>
    </tr>
  `).join('');
}

document.querySelectorAll('#dataTable th').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    sortRows();
    renderTable();
  });
});

el('prevPage').addEventListener('click', () => { currentPage--; renderTable(); });
el('nextPage').addEventListener('click', () => { currentPage++; renderTable(); });

// ---- KPIs --------------------------------------------------------------
function renderKpis() {
  const today = new Date();
  const isToday = (d) => d && d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();

  el('kpiTotal').textContent = filteredRows.length;
  el('kpiSekolah').textContent = uniqueSorted(filteredRows.map((r) => r.namaSekolah)).length;
  el('kpiKabkota').textContent = uniqueSorted(filteredRows.map((r) => r.kabKota)).length;
  el('kpiGugus').textContent = uniqueSorted(filteredRows.map((r) => r.namaGugus)).length;
  el('kpiToday').textContent = filteredRows.filter((r) => isToday(r.date)).length;
}

// ---- Charts (hand-rolled horizontal bar charts, dataviz-skill compliant) --
function countBy(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const label = r[key] || '(Tidak diisi)';
    map.set(label, (map.get(label) || 0) + 1);
  });
  return Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function renderBarChart(containerId, data, opts = {}) {
  const container = el(containerId);
  const topN = opts.topN || Infinity;
  let items = data;
  if (data.length > topN) {
    const head = data.slice(0, topN - 1);
    const restTotal = data.slice(topN - 1).reduce((s, d) => s + d.value, 0);
    items = [...head, { label: 'Lainnya', value: restTotal }];
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="chart-empty">Belum ada data.</div>';
    return;
  }

  const max = Math.max(...items.map((d) => d.value));
  container.innerHTML = items.map((d) => {
    const pct = max > 0 ? Math.round((d.value / max) * 100) : 0;
    return `
      <div class="bar-row" title="${escapeHtml(d.label)}: ${d.value}">
        <span class="bar-label">${escapeHtml(d.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
        <span class="bar-value">${d.value}</span>
      </div>
    `;
  }).join('');
}

function renderCharts() {
  renderBarChart('chartKabkota', countBy(filteredRows, 'kabKota'));
  renderBarChart('chartJenjang', countBy(filteredRows, 'jenjang'));
  renderBarChart('chartBimtek', countBy(filteredRows, 'jenisBimtek'));
  renderBarChart('chartSekolah', countBy(filteredRows, 'namaSekolah'), { topN: 10 });
}

// ---- Export CSV --------------------------------------------------------------
function exportCsv() {
  const header = ['Timestamp', 'Nama Peserta', 'Jabatan', 'Jenis Bimtek', 'Kab/Kota', 'Jenjang Sekolah', 'NPSN', 'Nama Sekolah', 'Nama Gugus'];
  const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.map(csvEscape).join(',')];
  filteredRows.forEach((r) => {
    lines.push([
      formatTimestamp(r.date), r.nama, r.jabatan, r.jenisBimtek, r.kabKota, r.jenjang, r.npsn, r.namaSekolah, r.namaGugus,
    ].map(csvEscape).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `absensi-bimtek-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Misc --------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showError(message) {
  const banner = el('errorBanner');
  banner.textContent = message;
  banner.hidden = false;
}
function hideError() {
  el('errorBanner').hidden = true;
}

function renderAll() {
  renderKpis();
  renderCharts();
  renderTable();
}

// ---- Main refresh cycle --------------------------------------------------------------
async function refresh() {
  el('refreshBtn').disabled = true;
  el('syncStatus').textContent = 'Menyinkronkan…';
  try {
    const json = await loadSheetData();
    const { rows, label } = parseGvizResponse(json);
    allRows = rows;
    hideError();
    el('sheetTitle').textContent = label ? label : 'Data absensi peserta bimtek';
    populateFilterOptions();
    applyFilters();
    el('syncStatus').textContent = `Tersinkron ${formatTimestamp(new Date())}`;
  } catch (err) {
    console.error(err);
    showError(err.message || 'Terjadi kesalahan saat memuat data.');
    el('syncStatus').textContent = 'Gagal sinkron';
  } finally {
    el('refreshBtn').disabled = false;
  }
}

el('refreshBtn').addEventListener('click', refresh);
el('exportBtn').addEventListener('click', exportCsv);
el('resetFilters').addEventListener('click', () => {
  el('filterKabkota').value = '';
  el('filterJenjang').value = '';
  el('filterBimtek').value = '';
  el('filterSearch').value = '';
  applyFilters();
});
['filterKabkota', 'filterJenjang', 'filterBimtek'].forEach((id) => el(id).addEventListener('change', applyFilters));
el('filterSearch').addEventListener('input', debounce(applyFilters, 200));

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

refresh();
refreshTimer = setInterval(refresh, CONFIG.refreshIntervalMs);
