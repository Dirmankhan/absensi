# Dashboard Absensi Bimtek

Dashboard statis (tanpa backend) yang menampilkan data absensi peserta Bimtek
secara langsung dari Google Sheets. Ada dua halaman dengan tampilan identik,
masing-masing membaca sheet sumber yang berbeda:

- **index.html** — Jenjang **Dikdas** (PAUD, SD, SMP, SKB, PKBM):
  https://docs.google.com/spreadsheets/d/1U5VCWds37zRfDwAblrBV2kwTPURpR38kZ2Hc-0GYPDc/edit
- **dikmen.html** — Jenjang **Dikmen** (SMA, SMK, SLB):
  https://docs.google.com/spreadsheets/d/10q5lThIX8ZQSNzLjgharF95ah0MUKxNSKFC4YbDMBEQ/edit

Kolom yang ditampilkan: **Timestamp, Nama Peserta, Jabatan, Jenis
Bimtek, Tempat Pelaksanaan Bimtek, Kab/Kota, Jenjang Sekolah, NPSN,
Nama Sekolah, Nama Gugus** (No Hp sengaja tidak ditampilkan).

## Cara kerja

Halaman ini membaca data langsung dari Google Sheets di sisi browser (JSONP
ke Google Visualization API), jadi tidak perlu server/backend maupun API key.
Setiap kali dibuka (atau setiap 60 detik / tombol "Muat Ulang"), dashboard
mengambil data terbaru dari sheet.

Sheet responnya memiliki banyak kolom perantara akibat logika form
bercabang per jenjang sekolah dan kab/kota — setiap kali ada kombinasi baru
yang belum pernah muncul, Google Form menambah kolom baru, sehingga jumlah
kolom (dan posisi kolom hasil akhir) terus bertambah seiring waktu. Karena
itu aplikasi ini **tidak** mengacu ke huruf kolom (mis. `BE`, `BH`), tapi
mencocokkan kolom berdasarkan teks header-nya (`Timestamp`, `Nama Peserta`,
`Jabatan`, `Jenis Bimtek`, `Tempat Pelaksanaan Bimtek`, `Kab/Kota`) — jadi
tetap benar walau sheet terus tumbuh.

Kolom hasil akhir (Jenjang/NPSN/Nama Sekolah/Nama Gugus) bentuknya
**berbeda antar sheet**: sheet Dikdas punya kolom "Jenjang Sekolah"
tersendiri, sedangkan sheet Dikmen memakai label "Jenjang" yang sama
persis dengan kolom cabangnya (hanya beda posisi, di paling akhir), dan
sebagian sheet mungkin tidak punya kolom hasil akhir sama sekali. `app.js`
menangani ketiganya: coba kolom hasil akhir bernama khusus dulu, kalau
tidak ada baru cari nilai pertama yang tidak kosong di antara semua kolom
cabang dengan label yang sama — jadi satu `app.js` yang sama dipakai kedua
halaman tanpa perlu tahu bentuk sheet mana yang sedang dibuka.

## Syarat sheet

Kedua sheet **wajib** dibagikan sebagai "Siapa saja yang memiliki link"
(Anyone with the link — minimal Viewer), karena data diambil langsung dari
browser pengunjung tanpa login.

## Menjalankan secara lokal

Karena mengambil data lintas domain, buka lewat server HTTP lokal (bukan
`file://`):

```bash
python3 -m http.server 8080
# buka http://localhost:8080/index.html (Dikdas) atau /dikmen.html (Dikmen)
```

## Deploy

Ini adalah situs statis murni (`index.html`, `dikmen.html`, `styles.css`,
`app.js`) — bisa langsung di-deploy ke GitHub Pages, Netlify, Vercel, atau
hosting statis apa pun tanpa build step.

## Konfigurasi

`app.js` dipakai bersama oleh kedua halaman. Tiap halaman menimpa sheet
sumbernya lewat `window.DASHBOARD_CONFIG`, ditulis di `<script>` sebelum
tag `<script src="app.js">`:

```html
<script>
  window.DASHBOARD_CONFIG = {
    sheetId: '...ID Google Sheet...',
    sheetName: 'Form responses 1', // nama tab persis seperti di sheet
  };
</script>
```

Untuk menambah halaman jenjang baru: salin `dikmen.html`, ganti `sheetId`
di skrip tersebut, dan tambahkan tautan ke `<nav class="page-nav">` di
setiap halaman (termasuk halaman baru itu sendiri).

## Fitur

- Dua halaman dengan tampilan identik untuk Dikdas dan Dikmen, dengan
  navigasi tab di bagian atas.
- KPI ringkasan dalam dua baris: **Akumulasi Keseluruhan** (total peserta,
  sekolah, kab/kota, gugus) dan **Data Hari Ini** (metrik yang sama, hanya
  untuk hari berjalan). Di sebelah kiri baris Akumulasi Keseluruhan terdapat
  diagram lingkaran jumlah peserta per jabatan (mengikuti filter yang aktif).
- Filter: Kab/Kota, Nama Gugus, Jenjang Sekolah, Jenis Bimtek, Tempat
  Pelaksanaan Bimtek, dan Tanggal Pelaksanaan (berdasarkan tanggal pada
  Timestamp).
- Tabel "Tempat Pelaksanaan Bimtek Hari Ini": satu kolom per Jenis Bimtek
  (Bimtek Tata Kelola (SPMI), Bimtek Literasi Numerasi, Bimtek Digitalisasi
  Pembelajaran), berisi daftar unik Tempat Pelaksanaan Bimtek untuk hari
  berjalan saja (mengikuti filter aktif).
- Tabel data lengkap: bisa dicari (NPSN/nama sekolah), diurutkan per kolom,
  dipaginasi, dan diekspor ke CSV (mengikuti filter yang aktif).
- Tampilan default cerah/terang dengan tema biru muda (tombol 🌓 untuk
  beralih ke gelap).
- Auto-refresh tiap 60 detik + tombol muat ulang manual.
