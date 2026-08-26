# Dashboard Absensi Bimtek

Dashboard statis (tanpa backend) yang menampilkan data absensi peserta Bimtek
secara langsung dari Google Sheets:

https://docs.google.com/spreadsheets/d/1U5VCWds37zRfDwAblrBV2kwTPURpR38kZ2Hc-0GYPDc/edit

Kolom yang ditampilkan: **Timestamp, Nama Peserta, Jabatan, No Hp, Jenis
Bimtek, Kab/Kota, Jenjang Sekolah, NPSN, Nama Sekolah, Nama Gugus**.

## Cara kerja

Halaman ini membaca data langsung dari Google Sheets di sisi browser (JSONP
ke Google Visualization API), jadi tidak perlu server/backend maupun API key.
Setiap kali dibuka (atau setiap 60 detik / tombol "Muat Ulang"), dashboard
mengambil data terbaru dari sheet.

Sheet responnya memiliki banyak kolom perantara akibat logika form
bercabang per jenjang sekolah, tapi kolom hasil akhir yang sudah bersih
(`Jenjang Sekolah`, `NPSN`, `Nama Sekolah`, `Nama Gugus`) berada di 4 kolom
terakhir — itulah yang diambil aplikasi ini (kolom `BE:BH`), digabung dengan
6 kolom awal (`A:F`).

## Syarat sheet

Sheet **wajib** dibagikan sebagai "Siapa saja yang memiliki link" (Anyone
with the link — minimal Viewer), karena data diambil langsung dari browser
pengunjung tanpa login.

## Menjalankan secara lokal

Karena mengambil data lintas domain, buka lewat server HTTP lokal (bukan
`file://`):

```bash
python3 -m http.server 8080
# buka http://localhost:8080
```

## Deploy

Ini adalah situs statis murni (`index.html`, `styles.css`, `app.js`) — bisa
langsung di-deploy ke GitHub Pages, Netlify, Vercel, atau hosting statis
apa pun tanpa build step.

## Konfigurasi

Semua konfigurasi ada di bagian atas `app.js`:

```js
const CONFIG = {
  sheetId: '1U5VCWds37zRfDwAblrBV2kwTPURpR38kZ2Hc-0GYPDc',
  gid: 0,                // ganti jika data pindah ke tab/sheet lain
  refreshIntervalMs: 60000,
  pageSize: 25,
};
```

## Fitur

- KPI ringkasan: total peserta, jumlah sekolah, jumlah kab/kota, jumlah
  gugus, dan peserta hari ini.
- Grafik: peserta per Kab/Kota, per Jenjang Sekolah, per Jenis Bimtek, dan
  10 sekolah dengan peserta terbanyak.
- Filter: Kab/Kota, Jenjang Sekolah, Jenis Bimtek, dan pencarian bebas
  (nama peserta/sekolah/gugus/no HP).
- Tabel data lengkap: bisa diurutkan per kolom, dipaginasi, dan diekspor
  ke CSV (mengikuti filter yang aktif).
- Mode gelap/terang (tombol 🌓), otomatis mengikuti preferensi sistem.
- Auto-refresh tiap 60 detik + tombol muat ulang manual.
