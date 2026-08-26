# Dashboard Absensi Bimtek

Dashboard statis (tanpa backend) yang menampilkan data absensi peserta Bimtek
secara langsung dari Google Sheets:

https://docs.google.com/spreadsheets/d/1U5VCWds37zRfDwAblrBV2kwTPURpR38kZ2Hc-0GYPDc/edit

Kolom yang ditampilkan: **Timestamp, Nama Peserta, Jabatan, Jenis
Bimtek, Kab/Kota, Jenjang Sekolah, NPSN, Nama Sekolah, Nama Gugus** (No Hp
sengaja tidak ditampilkan).

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
`Jabatan`, `Jenis Bimtek`, `Kab/Kota`, `Jenjang Sekolah`, `NPSN`,
`Nama Sekolah`, `Nama Gugus`) — jadi tetap benar walau sheet terus tumbuh.

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
  (nama peserta/sekolah/gugus).
- Tabel data lengkap: bisa diurutkan per kolom, dipaginasi, dan diekspor
  ke CSV (mengikuti filter yang aktif).
- Tampilan default cerah/terang (tombol 🌓 untuk beralih ke gelap).
- Auto-refresh tiap 60 detik + tombol muat ulang manual.
