// ---- Configuration ----------------------------------------------------
// Sheet WAJIB dibagikan sebagai "Siapa saja yang memiliki link" (Anyone
// with the link) agar bisa dibaca tanpa login. Setiap halaman (index.html
// untuk Dikdas, dikmen.html untuk Dikmen) menimpa CONFIG lewat
// window.DASHBOARD_CONFIG sebelum memuat app.js ini, jadi satu app.js yang
// sama dipakai untuk kedua halaman.
const CONFIG = Object.assign({
  sheetId: '1U5VCWds37zRfDwAblrBV2kwTPURpR38kZ2Hc-0GYPDc',
  sheetName: 'Form responses 1', // nama tab persis seperti di Google Sheets
  gid: 0, // fallback jika pencarian berdasarkan nama tab gagal
  refreshIntervalMs: 60000,
  pageSize: 25,
}, window.DASHBOARD_CONFIG || {});

// Kolom diambil berdasarkan TEKS HEADER, bukan huruf kolom (A/BE/dst).
// Sheet ini adalah respons Google Form dengan pertanyaan bercabang per
// Jenjang/Kab-Kota, jadi jumlah kolom perantara ("Jenjang", "NPSN - Nama
// Sekolah") terus bertambah setiap kali ada kombinasi baru masuk — artinya
// posisi kolom hasil akhir ikut bergeser ke kanan seiring waktu.
// Mencocokkan berdasarkan nama header membuat ini tahan terhadap
// pergeseran tersebut.
//
// Kolom sederhana (satu label unik, satu nilai per baris):
const SIMPLE_FIELD_LABELS = {
  timestamp: 'Timestamp',
  nama: 'Nama Peserta',
  jabatan: 'Jabatan',
  jenisBimtek: 'Jenis Bimtek',
  tempatBimtek: 'Tempat Pelaksanaan Bimtek',
  kabKota: 'Kab/Kota',
};
// Kolom hasil akhir (Jenjang/NPSN/Nama Sekolah/Nama Gugus) BERBEDA bentuk
// antar sheet: sheet Dikdas punya kolom "Jenjang Sekolah" tersendiri yang
// sudah diresolusi dari cabang form, sedangkan sheet Dikmen memakai label
// "Jenjang" yang sama persis dengan kolom cabangnya (hanya beda posisi),
// dan sebagian sheet mungkin tidak punya kolom hasil akhir sama sekali
// (mis. "Nama Gugus" tidak selalu ada). Fungsi resolveXxx di bawah
// menangani ketiga kemungkinan itu tanpa perlu tahu sheet mana yang
// sedang dibuka.

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

// Peta label -> daftar SEMUA index kolom dengan label itu (bisa lebih
// dari satu, mis. "Jenjang" muncul berkali-kali sebagai kolom cabang).
function buildColumnIndexAll(cols) {
  const index = {};
  (cols || []).forEach((col, i) => {
    if (!col.label) return;
    if (!index[col.label]) index[col.label] = [];
    index[col.label].push(i);
  });
  return index;
}

function firstNonEmpty(byLabel, label, cellArr) {
  const idxs = byLabel[label];
  if (!idxs) return null;
  for (const i of idxs) {
    const v = cellValue(cellArr[i]);
    if (v) return v;
  }
  return null;
}

// Jenjang: pakai kolom hasil akhir "Jenjang Sekolah" jika ada (Dikdas);
// jika tidak ada, kolom hasil akhir Dikmen memakai label "Jenjang" yang
// sama dengan kolom cabangnya, jadi cari nilai pertama yang tidak kosong
// di antara semua kolom berlabel "Jenjang" (cabang + hasil akhir sama-sama
// terisi dengan nilai yang sama untuk baris valid).
function resolveJenjang(byLabel, cellArr) {
  return firstNonEmpty(byLabel, 'Jenjang Sekolah', cellArr) || firstNonEmpty(byLabel, 'Jenjang', cellArr) || '';
}

// NPSN & Nama Sekolah: pakai kolom hasil akhir terpisah jika ada. Jika
// sheet tidak punya kolom hasil akhir sama sekali, jatuh ke kolom cabang
// gabungan "NPSN - Nama Sekolah" dan pisahkan pada " - " pertama.
function resolveNpsnSekolah(byLabel, cellArr) {
  const npsn = firstNonEmpty(byLabel, 'NPSN', cellArr);
  const namaSekolah = firstNonEmpty(byLabel, 'Nama Sekolah', cellArr);
  if (npsn !== null || namaSekolah !== null) {
    return { npsn: npsn || '', namaSekolah: namaSekolah || '' };
  }
  const combined = firstNonEmpty(byLabel, 'NPSN - Nama Sekolah', cellArr);
  if (!combined) return { npsn: '', namaSekolah: '' };
  const sep = combined.indexOf(' - ');
  if (sep === -1) return { npsn: '', namaSekolah: combined };
  return { npsn: combined.slice(0, sep).trim(), namaSekolah: combined.slice(sep + 3).trim() };
}

function parseGvizResponse(json) {
  if (json.status === 'error') {
    const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || 'Format sheet tidak sesuai.';
    throw new Error(msg);
  }
  const table = json.table;
  const byLabel = buildColumnIndexAll(table.cols);
  const missing = Object.entries(SIMPLE_FIELD_LABELS).filter(([, label]) => !byLabel[label]);
  if (missing.length) {
    throw new Error(`Kolom tidak ditemukan di sheet: ${missing.map(([, l]) => l).join(', ')}`);
  }

  const rows = (table.rows || []).map((r) => {
    const c = r.c || [];
    const obj = {};
    Object.entries(SIMPLE_FIELD_LABELS).forEach(([key, label]) => {
      obj[key] = cellValue(c[byLabel[label][0]]);
    });
    obj.jenjang = resolveJenjang(byLabel, c);
    const { npsn, namaSekolah } = resolveNpsnSekolah(byLabel, c);
    obj.npsn = npsn;
    obj.namaSekolah = namaSekolah;
    obj.namaGugus = firstNonEmpty(byLabel, 'Nama Gugus', c) || '';
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
  fillSelect('filterGugus', uniqueSorted(allRows.map((r) => r.namaGugus)));
  fillSelect('filterJenjang', uniqueSorted(allRows.map((r) => r.jenjang)));
  fillSelect('filterBimtek', uniqueSorted(allRows.map((r) => r.jenisBimtek)));
  fillSelect('filterTempat', dedupeSimilarTempat(allRows.map((r) => r.tempatBimtek)));
  fillSelect('filterTanggal', uniqueDatesSorted(allRows.map((r) => r.date)));
}

// Tanggal unik (dd/mm/yyyy) diurutkan secara kronologis, bukan alfabetis,
// dan diformat ulang dari objek Date agar urutannya benar.
function uniqueDatesSorted(dates) {
  const byKey = new Map();
  dates.forEach((d) => {
    if (!d) return;
    const key = formatDateOnly(d);
    if (!byKey.has(key)) byKey.set(key, d.getTime());
  });
  return Array.from(byKey.entries()).sort((a, b) => a[1] - b[1]).map(([key]) => key);
}

function formatDateOnly(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
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
  const gugus = el('filterGugus').value;
  const jenjang = el('filterJenjang').value;
  const bimtek = el('filterBimtek').value;
  const tempat = el('filterTempat').value;
  const tanggal = el('filterTanggal').value;

  filteredRows = allRows.filter((r) => {
    if (kab && r.kabKota !== kab) return false;
    if (gugus && r.namaGugus !== gugus) return false;
    if (jenjang && r.jenjang !== jenjang) return false;
    if (bimtek && r.jenisBimtek !== bimtek) return false;
    if (tempat && normalizeTempatKey(r.tempatBimtek) !== normalizeTempatKey(tempat)) return false;
    if (tanggal && (!r.date || formatDateOnly(r.date) !== tanggal)) return false;
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

// Pencarian NPSN/nama sekolah khusus tabel Data Absensi — tidak
// memengaruhi KPI atau tabel Tempat Pelaksanaan Bimtek Hari Ini.
function getDataTableRows() {
  const q = el('filterDataTable').value.trim().toLowerCase();
  if (!q) return filteredRows;
  return filteredRows.filter((r) => r.npsn.toLowerCase().includes(q) || r.namaSekolah.toLowerCase().includes(q));
}

function renderTable() {
  const rows = getDataTableRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / CONFIG.pageSize));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * CONFIG.pageSize;
  const pageRows = rows.slice(start, start + CONFIG.pageSize);

  el('tableCount').textContent = rows.length;
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
function isSameDay(a, b) {
  return !!a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getTodayRows() {
  const today = new Date();
  return filteredRows.filter((r) => isSameDay(r.date, today));
}

function renderKpis() {
  const todayRows = getTodayRows();

  el('kpiTotal').textContent = filteredRows.length;
  el('kpiSekolah').textContent = uniqueSorted(filteredRows.map((r) => r.namaSekolah)).length;
  el('kpiKabkota').textContent = uniqueSorted(filteredRows.map((r) => r.kabKota)).length;
  el('kpiGugus').textContent = uniqueSorted(filteredRows.map((r) => r.namaGugus)).length;

  el('kpiTotalToday').textContent = todayRows.length;
  el('kpiSekolahToday').textContent = uniqueSorted(todayRows.map((r) => r.namaSekolah)).length;
  el('kpiKabkotaToday').textContent = uniqueSorted(todayRows.map((r) => r.kabKota)).length;
  el('kpiGugusToday').textContent = uniqueSorted(todayRows.map((r) => r.namaGugus)).length;
}

// ---- Diagram lingkaran: peserta per jabatan ------------------------------
const PIE_SLICE_CLASSES = ['pie-slice-1', 'pie-slice-2', 'pie-slice-3', 'pie-slice-4', 'pie-slice-other'];

function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function pieSlicePath(cx, cy, r, startAngle, endAngle) {
  const start = polarToXY(cx, cy, r, startAngle);
  const end = polarToXY(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function renderJabatanChart() {
  const counts = new Map();
  filteredRows.forEach((r) => {
    const label = r.jabatan || '(Tidak diisi)';
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  let items = Array.from(counts, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const MAX_SLICES = 4;
  if (items.length > MAX_SLICES) {
    const head = items.slice(0, MAX_SLICES - 1);
    const restTotal = items.slice(MAX_SLICES - 1).reduce((s, d) => s + d.value, 0);
    items = [...head, { label: 'Lainnya', value: restTotal }];
  }
  const total = items.reduce((s, d) => s + d.value, 0);

  const svg = el('jabatanChart');
  const legend = el('jabatanChartLegend');
  if (total === 0) {
    svg.innerHTML = '';
    legend.innerHTML = '<span>Belum ada data.</span>';
    return;
  }

  const cx = 50, cy = 50, r = 48;
  let angle = -90;
  let svgHtml = '';
  items.forEach((item, i) => {
    const sliceClass = i < MAX_SLICES ? PIE_SLICE_CLASSES[i] : PIE_SLICE_CLASSES[PIE_SLICE_CLASSES.length - 1];
    const fraction = item.value / total;
    const nextAngle = fraction >= 0.9999 ? angle + 359.99 : angle + fraction * 360;
    svgHtml += `<path class="${sliceClass}" d="${pieSlicePath(cx, cy, r, angle, nextAngle)}"><title>${escapeHtml(item.label)}: ${item.value}</title></path>`;
    angle = nextAngle;
  });
  svg.innerHTML = svgHtml;

  legend.innerHTML = items.map((item, i) => {
    const sliceClass = i < MAX_SLICES ? PIE_SLICE_CLASSES[i] : PIE_SLICE_CLASSES[PIE_SLICE_CLASSES.length - 1];
    return `
      <span class="legend-row" title="${escapeHtml(item.label)}: ${item.value}">
        <span class="legend-dot ${sliceClass}"></span>
        <span>${escapeHtml(item.label)}</span>
        <span class="legend-count">${item.value}</span>
      </span>
    `;
  }).join('');
}

// ---- Tempat pelaksanaan bimtek hari ini, per jenis bimtek ----------------
// Diambil dari kolom "Tempat Pelaksanaan Bimtek" di sheet, dibatasi hanya
// data hari berjalan — satu kolom per jenis bimtek, urutan tetap.
const JENIS_BIMTEK_COLUMNS = [
  'Bimtek Tata Kelola (SPMI)',
  'Bimtek Literasi Numerasi',
  'Bimtek Digitalisasi Pembelajaran',
];

// Peserta sering menulis nama tempat/sekolah dengan ejaan berbeda-beda
// (huruf besar/kecil, "SMPN" vs "SMP Negeri" vs "SMP", spasi hilang, dst).
// Fungsi ini meratakan variasi PENULISAN itu ke satu kunci pembanding,
// tapi tetap mempertahankan angka & kata lain apa adanya — jadi tempat
// yang benar-benar berbeda (mis. "Moyo Hilir" vs "Moyo Utara") tidak
// pernah tergabung, hanya ejaan dari tempat yang SAMA yang disatukan.
const SCHOOL_LEVEL_PREFIXES = ['SD', 'SMP', 'SMA', 'SMK', 'MTS', 'MI', 'MA', 'TK', 'PAUD', 'SKB', 'PKBM'];

function normalizeTempatKey(raw) {
  if (!raw) return '';
  let s = raw.toUpperCase();
  s = s.replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2');
  SCHOOL_LEVEL_PREFIXES.forEach((p) => {
    s = s.replace(new RegExp(`\\b${p}N\\b`, 'g'), p);
  });
  s = s.replace(/\bNEGERI\b/g, ' ');
  SCHOOL_LEVEL_PREFIXES.forEach((p) => {
    s = s.replace(new RegExp(`\\b${p}\\s+N\\b`, 'g'), p);
  });
  return s.replace(/[^A-Z0-9]/g, '');
}

// Dari sekelompok ejaan yang dianggap sama, pakai versi yang paling
// sering ditulis sebagai representasi tampilan.
function pickMostFrequent(rawValues) {
  const counts = new Map();
  rawValues.forEach((raw) => counts.set(raw, (counts.get(raw) || 0) + 1));
  let best = rawValues[0];
  let bestCount = -1;
  counts.forEach((count, raw) => {
    if (count > bestCount) { bestCount = count; best = raw; }
  });
  return best;
}

function dedupeSimilarTempat(values) {
  const groups = new Map();
  values.forEach((raw) => {
    if (!raw) return;
    const key = normalizeTempatKey(raw);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(raw);
  });
  const result = [];
  groups.forEach((rawList) => result.push(pickMostFrequent(rawList)));
  return result.sort((a, b) => a.localeCompare(b, 'id'));
}

function renderTodaySchedule() {
  const todayRows = getTodayRows();
  const columns = JENIS_BIMTEK_COLUMNS.map((jenis) => ({
    jenis,
    tempat: dedupeSimilarTempat(todayRows.filter((r) => r.jenisBimtek === jenis).map((r) => r.tempatBimtek)),
  }));
  const maxRows = Math.max(0, ...columns.map((c) => c.tempat.length));
  const totalTempat = dedupeSimilarTempat(todayRows.map((r) => r.tempatBimtek)).length;

  el('todayScheduleCount').textContent = totalTempat;
  el('todayScheduleHead').innerHTML = `<tr>${columns.map((c) => `<th>${escapeHtml(c.jenis)}</th>`).join('')}</tr>`;

  const tbody = el('todayScheduleBody');
  if (maxRows === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length}" style="text-align:center;color:var(--text-muted);padding:24px;">Belum ada bimtek hari ini.</td></tr>`;
    return;
  }
  let rowsHtml = '';
  for (let i = 0; i < maxRows; i++) {
    rowsHtml += `<tr>${columns.map((c) => `<td>${escapeHtml(c.tempat[i] || '')}</td>`).join('')}</tr>`;
  }
  tbody.innerHTML = rowsHtml;
}

// ---- Export CSV --------------------------------------------------------------
function exportCsv() {
  const header = ['Timestamp', 'Nama Peserta', 'Jabatan', 'Jenis Bimtek', 'Kab/Kota', 'Jenjang Sekolah', 'NPSN', 'Nama Sekolah', 'Nama Gugus'];
  const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.map(csvEscape).join(',')];
  getDataTableRows().forEach((r) => {
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
  renderJabatanChart();
  renderTodaySchedule();
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
  el('filterGugus').value = '';
  el('filterJenjang').value = '';
  el('filterBimtek').value = '';
  el('filterTempat').value = '';
  el('filterTanggal').value = '';
  applyFilters();
});
['filterKabkota', 'filterGugus', 'filterJenjang', 'filterBimtek', 'filterTempat', 'filterTanggal'].forEach((id) => el(id).addEventListener('change', applyFilters));

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
el('filterDataTable').addEventListener('input', debounce(() => { currentPage = 1; renderTable(); }, 200));

refresh();
refreshTimer = setInterval(refresh, CONFIG.refreshIntervalMs);
