// ---- Configuration ----------------------------------------------------
// Halaman ini terpisah dari app.js karena bentuk datanya beda: bukan
// menampilkan satu sheet respons apa adanya, melainkan menggabungkan sheet
// referensi sekolah ("ref") dengan hasil hitung dari sheet Form Responses.
// Sama seperti app.js, setiap halaman (rekap-dikdas.html / rekap-dikmen.html)
// menimpa CONFIG lewat window.DASHBOARD_CONFIG sebelum memuat skrip ini.
const CONFIG = Object.assign({
  sheetId: '1U5VCWds37zRfDwAblrBV2kwTPURpR38kZ2Hc-0GYPDc',
  sheetName: 'Form responses 1', // nama tab respons, persis seperti di Google Sheets
  gid: 0, // fallback jika pencarian berdasarkan nama tab respons gagal
  refSheetName: 'ref', // nama tab referensi sekolah
  refreshIntervalMs: 60000,
  pageSize: 25,
}, window.DASHBOARD_CONFIG || {});

const JENIS_BIMTEK_COLUMNS = ['Bimtek Tata Kelola (SPMI)', 'Bimtek Literasi Numerasi', 'Bimtek Digitalisasi Pembelajaran'];

// ---- State --------------------------------------------------------------
let allSchools = [];
let currentPage = 1;
let sortKey = 'kabKota';
let sortDir = 'asc';
let refreshTimer = null;

// ---- DOM refs -------------------------------------------------------------
const el = (id) => document.getElementById(id);
el('sheetLink').href = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit`;

// ---- Theme toggle (sama seperti app.js) -----------------------------------
(function initTheme() {
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

// Coba akses tab berdasarkan nama dulu, lalu fallback ke gid jika ada.
async function fetchSheetByName(sheetName, gidFallback) {
  try {
    const json = await fetchGvizOnce(`sheet=${encodeURIComponent(sheetName)}`);
    if (json.status !== 'error') return json;
    console.warn(`Gagal ambil sheet "${sheetName}" via nama tab…`, json);
  } catch (err) {
    console.warn(`Gagal ambil sheet "${sheetName}" via nama tab…`, err);
  }
  if (gidFallback === null || gidFallback === undefined) {
    throw new Error(`Sheet "${sheetName}" tidak ditemukan.`);
  }
  return fetchGvizOnce(`gid=${gidFallback}`);
}

function cellValue(cell) {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
  if (cell.v === undefined || cell.v === null) return '';
  return String(cell.v).trim();
}

// Peta label -> daftar SEMUA index kolom dengan label itu (bisa lebih dari
// satu, mis. "Jenjang" muncul berkali-kali sebagai kolom cabang form).
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

// NPSN peserta dari sheet Form Responses: sama seperti app.js — pakai kolom
// hasil akhir "NPSN" jika ada, atau pisahkan dari kolom cabang gabungan
// "NPSN - Nama Sekolah" pada " - " pertama. Dicocokkan berdasarkan teks
// header (bukan huruf kolom), karena kolom cabang form terus bertambah.
function resolveNpsn(byLabel, cellArr) {
  const npsn = firstNonEmpty(byLabel, 'NPSN', cellArr);
  if (npsn !== null) return npsn;
  const combined = firstNonEmpty(byLabel, 'NPSN - Nama Sekolah', cellArr);
  if (!combined) return '';
  const sep = combined.indexOf(' - ');
  return sep === -1 ? '' : combined.slice(0, sep).trim();
}

function normalizeNpsn(v) {
  return (v || '').trim().toUpperCase();
}

// Hitung jumlah peserta per NPSN per jenis bimtek dari sheet Form Responses.
function countAttendanceByNpsn(json) {
  const table = json.table;
  const byLabel = buildColumnIndexAll(table.cols);
  if (!byLabel['Jenis Bimtek']) {
    throw new Error('Kolom "Jenis Bimtek" tidak ditemukan di sheet Form Responses.');
  }
  const counts = new Map(); // npsn (normal) -> { [jenisBimtek]: jumlah }
  (table.rows || []).forEach((r) => {
    const c = r.c || [];
    const npsn = normalizeNpsn(resolveNpsn(byLabel, c));
    const jenisBimtek = firstNonEmpty(byLabel, 'Jenis Bimtek', c);
    if (!npsn || !jenisBimtek) return;
    if (!counts.has(npsn)) counts.set(npsn, {});
    const bucket = counts.get(npsn);
    bucket[jenisBimtek] = (bucket[jenisBimtek] || 0) + 1;
  });
  return counts;
}

// Sheet ref: data referensi sekolah pada kolom D-H yang tetap (Kab/Kota,
// NPSN, Jenjang, Status, Nama Sekolah) — bukan hasil form bercabang, jadi
// posisinya stabil dan aman diambil berdasarkan huruf kolom. Kolom "Gugus
// Belajar" (R) dipakai sebagai Nama Gugus, dan kolom U/V/W dipakai sebagai
// Tanggal Bimtek per jenis (Tata Kelola/Literasi Numerasi/Digitalisasi
// Pembelajaran). Sebagian sheet ref punya baris header, sebagian tidak;
// baris yang NPSN-nya bukan angka (atau "P" + angka untuk PKBM) — misalnya
// baris header "NPSN" — otomatis dibuang, begitu juga duplikat NPSN yang
// sama.
function parseRefSheet(json) {
  const table = json.table;
  const rows = (table.rows || []).map((r) => {
    const c = r.c || [];
    return {
      kabKota: cellValue(c[3]),
      npsn: cellValue(c[4]),
      jenjang: cellValue(c[5]),
      status: cellValue(c[6]),
      namaSekolah: cellValue(c[7]),
      namaGugus: cellValue(c[17]),
      tanggalSpmi: cellValue(c[20]),
      tanggalLiterasi: cellValue(c[21]),
      tanggalDigitalisasi: cellValue(c[22]),
    };
  });
  const valid = rows.filter((r) => /^(P\d{4,}|\d{4,})$/i.test(r.npsn));
  const seen = new Set();
  return valid.filter((r) => {
    const key = normalizeNpsn(r.npsn);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function showError(message) {
  const banner = el('errorBanner');
  banner.textContent = message;
  banner.hidden = false;
}

function hideError() {
  el('errorBanner').hidden = true;
}

// ---- Tabel: filter, sort, paginasi -----------------------------------------
function getRows() {
  const q = el('filterSekolah').value.trim().toLowerCase();
  let rows = allSchools;
  if (q) {
    rows = rows.filter((r) =>
      r.npsn.toLowerCase().includes(q) ||
      r.namaSekolah.toLowerCase().includes(q)
    );
  }
  return [...rows].sort((a, b) => {
    let va, vb;
    if (sortKey.startsWith('c')) {
      const idx = Number(sortKey.slice(1));
      va = a.counts[idx];
      vb = b.counts[idx];
    } else {
      va = a[sortKey] || '';
      vb = b[sortKey] || '';
    }
    if (typeof va === 'number' && typeof vb === 'number') {
      return sortDir === 'asc' ? va - vb : vb - va;
    }
    return sortDir === 'asc'
      ? String(va).localeCompare(String(vb), 'id')
      : String(vb).localeCompare(String(va), 'id');
  });
}

function renderTable() {
  const rows = getRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / CONFIG.pageSize));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * CONFIG.pageSize;
  const pageRows = rows.slice(start, start + CONFIG.pageSize);

  el('tableCount').textContent = rows.length;
  el('pageInfo').textContent = `Halaman ${currentPage} dari ${totalPages}`;

  const tbody = el('tableBody');
  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:24px;">Tidak ada data yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows.map((r) => `
    <tr>
      <td class="wrap-col">${escapeHtml(r.kabKota)}</td>
      <td>${escapeHtml(r.namaGugus)}</td>
      <td>${escapeHtml(r.npsn)}</td>
      <td class="wrap-col">${escapeHtml(r.namaSekolah)}</td>
      <td>${escapeHtml(r.jenjang)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td class="count-col">${escapeHtml(r.tanggalSpmi)}</td>
      <td class="count-col">${r.counts[0]}</td>
      <td class="count-col">${escapeHtml(r.tanggalLiterasi)}</td>
      <td class="count-col">${r.counts[1]}</td>
      <td class="count-col">${escapeHtml(r.tanggalDigitalisasi)}</td>
      <td class="count-col">${r.counts[2]}</td>
    </tr>
  `).join('');
}

// Ekspor ke format CSV (dibuka langsung oleh Excel) — mengikuti pencarian
// aktif tapi tidak dibatasi paginasi, hanya berjalan saat tombol diklik.
function exportExcel() {
  const header = [
    'Kabupaten', 'Nama Gugus', 'NPSN', 'Nama Sekolah', 'Jenjang', 'Status',
    'Tanggal Bimtek Tata Kelola (SPMI)', 'Jumlah Peserta Bimtek Tata Kelola (SPMI)',
    'Tanggal Bimtek Literasi Numerasi', 'Jumlah Peserta Bimtek Literasi Numerasi',
    'Tanggal Bimtek Digitalisasi Pembelajaran', 'Jumlah Peserta Bimtek Digitalisasi Pembelajaran',
  ];
  const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.map(csvEscape).join(',')];
  getRows().forEach((r) => {
    lines.push([
      r.kabKota, r.namaGugus, r.npsn, r.namaSekolah, r.jenjang, r.status,
      r.tanggalSpmi, r.counts[0], r.tanggalLiterasi, r.counts[1], r.tanggalDigitalisasi, r.counts[2],
    ].map(csvEscape).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rekap-sekolah-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.querySelectorAll('#rekapTable th').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    currentPage = 1;
    renderTable();
  });
});

el('filterSekolah').addEventListener('input', () => {
  currentPage = 1;
  renderTable();
});
el('exportBtn').addEventListener('click', exportExcel);
el('prevPage').addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    renderTable();
  }
});
el('nextPage').addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(getRows().length / CONFIG.pageSize));
  if (currentPage < totalPages) {
    currentPage += 1;
    renderTable();
  }
});

// ---- Main refresh cycle --------------------------------------------------------------
async function refresh() {
  el('refreshBtn').disabled = true;
  el('syncStatus').textContent = 'Menyinkronkan…';
  try {
    const [formJson, refJson] = await Promise.all([
      fetchSheetByName(CONFIG.sheetName, CONFIG.gid),
      fetchSheetByName(CONFIG.refSheetName, null),
    ]);
    const counts = countAttendanceByNpsn(formJson);
    const schools = parseRefSheet(refJson);
    allSchools = schools.map((s) => {
      const bucket = counts.get(normalizeNpsn(s.npsn)) || {};
      return { ...s, counts: JENIS_BIMTEK_COLUMNS.map((jenis) => bucket[jenis] || 0) };
    });
    hideError();
    currentPage = 1;
    renderTable();
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

refresh();
refreshTimer = setInterval(refresh, CONFIG.refreshIntervalMs);
