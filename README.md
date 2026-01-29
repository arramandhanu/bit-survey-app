# 🏛️ Survey Kepuasan Layanan - BKPM

![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)

Aplikasi survey kepuasan layanan untuk mode kiosk dengan dashboard admin yang komprehensif.

## ✨ Fitur

### 🖥️ Kiosk Survey
- Tampilan fullscreen dengan slideshow otomatis
- Touch-friendly interface dengan emoji animasi
- 5 Pertanyaan survey (dapat dikustomisasi)
- 3 Opsi rating: Sangat Baik, Cukup Baik, Kurang Baik
- Pertanyaan dimuat dinamis dari database

### � Admin Dashboard
- Statistik real-time (total, hari ini, bulan ini)
- Trend mingguan dengan visualisasi grafik
- Breakdown per pertanyaan
- **Heatmap** - Pola submission per jam (7x24 grid)
- **Recent Activity** - 10 submission terakhir dengan auto-refresh

### 📑 Laporan
- Laporan bulanan dengan statistik lengkap
- Export PDF dengan desain profesional
- Export CSV untuk analisis lebih lanjut

### 📝 Audit Log
- Riwayat semua submission survey
- Filter berdasarkan tanggal
- Pagination untuk navigasi mudah
- Tampilan waktu zona Asia/Jakarta

### ✏️ Question Editor
- Kelola pertanyaan survey dari admin panel
- Edit teks pertanyaan dan opsi jawaban
- Aktifkan/nonaktifkan pertanyaan
- **Reset ke Default** - Kembalikan semua pertanyaan ke template awal

### 🔐 Keamanan
- JWT Authentication untuk admin
- Password hashing dengan bcrypt (cost 12)
- MySQL tidak di-expose ke host
- Kredensial via environment variables

## 🚀 Quick Start

### Prasyarat

- Docker & Docker Compose
- Port 3000 tersedia

### 1. Clone & Setup

```bash
git clone <repository-url>
cd survey
cp .env.example .env
```

### 2. Konfigurasi Environment

Edit file `.env`:

```env
DB_PASSWORD=your_secure_password
MYSQL_ROOT_PASSWORD=your_root_password
ADMIN_SECRET=your_jwt_secret
ADMIN_DEFAULT_PASSWORD=your_admin_password
```

> 💡 Generate JWT secret: `openssl rand -base64 32`

### 3. Deploy

```bash
docker compose up -d --build
```

### 4. Akses Aplikasi

| URL | Deskripsi |
|-----|-----------|
| http://<ip/domain.com>:3000 | 🖥️ Kiosk Survey |
| http://<ip/domain.com>:3000/admin | 📊 Admin Dashboard |
| http://<ip/domain.com>:3000/admin/reports | 📑 Laporan Bulanan |
| http://<ip/domain.com>:3000/admin/logs | 📝 Audit Log |
| http://<ip/domain.com>:3000/admin/questions | ✏️ Question Editor |

## 📁 Struktur Proyek

```
survey/
├── server.js              # Express.js backend
├── init.sql               # Database schema + default questions
├── Dockerfile             # Container image
├── docker-compose.yml     # Service orchestration
├── .env.example           # Environment template
└── public/
    ├── index.html         # Kiosk survey UI
    ├── css/style.css      # Survey styles
    ├── js/app.js          # Survey logic (dynamic questions)
    └── admin/
        ├── login.html     # Admin login
        ├── dashboard.html # Dashboard + Heatmap
        ├── reports.html   # Laporan bulanan
        ├── logs.html      # Audit log viewer
        ├── questions.html # Question editor
        └── css/admin.css  # Admin styles
```

## 🔌 API Endpoints

### Public (Kiosk)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/questions` | Ambil pertanyaan aktif |
| POST | `/api/survey` | Submit survey |
| GET | `/api/survey/stats` | Statistik publik |
| GET | `/health` | Health check |

### Admin (Protected)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/admin/login` | Login admin |
| GET | `/admin/api/dashboard` | Data dashboard |
| GET | `/admin/api/recent` | 10 submission terakhir |
| GET | `/admin/api/heatmap` | Data heatmap 7x24 |
| GET | `/admin/api/logs` | Audit log (paginated) |
| GET | `/admin/api/questions` | Semua pertanyaan |
| GET | `/admin/api/questions/:id` | Detail pertanyaan |
| PUT | `/admin/api/questions/:id` | Update pertanyaan |
| POST | `/admin/api/questions/reset` | Reset ke default |
| GET | `/admin/api/reports/months` | Bulan yang tersedia |
| GET | `/admin/api/reports/monthly` | Laporan bulanan |
| GET | `/admin/api/reports/pdf` | Export PDF |
| GET | `/admin/api/reports/csv` | Export CSV |

## �️ Database Schema

### Tabel `surveys`
Menyimpan hasil survey dengan kolom q1-q5 untuk setiap pertanyaan.

### Tabel `questions`
Menyimpan pertanyaan yang dapat dikustomisasi:
- `question_key` - Identifier (q1, q2, q3, q4, q5)
- `question_text` - Teks pertanyaan
- `question_subtitle` - Subtitle pertanyaan
- `option_positive/neutral/negative` - Teks opsi jawaban
- `is_active` - Status aktif/nonaktif
- `display_order` - Urutan tampil

## ⚙️ Environment Variables

| Variable | Required | Deskripsi |
|----------|----------|-----------|
| `DB_PASSWORD` | ✅ | Password MySQL |
| `MYSQL_ROOT_PASSWORD` | ✅ | Password root MySQL |
| `ADMIN_SECRET` | ✅ | JWT signing secret |
| `ADMIN_DEFAULT_PASSWORD` | ✅ | Password admin awal |
| `TZ` | ❌ | Timezone (default: Asia/Jakarta) |

> ⚠️ Hapus `ADMIN_DEFAULT_PASSWORD` dari `.env` setelah login pertama

## 🐳 Docker Commands

```bash
# Start services
docker compose up -d

# View logs
docker compose logs -f survey-app

# Rebuild
docker compose up -d --build

# Stop
docker compose down

# Reset database (hapus semua data)
docker compose down -v
```

## 🔧 Troubleshooting

### Reset Questions ke Default
Jika pertanyaan sudah diubah dan ingin kembali ke template:
1. Login ke admin panel
2. Buka Question Editor (`/admin/questions`)
3. Klik tombol "Reset ke Default"

### Timezone Salah
Pastikan `TZ=Asia/Jakarta` ada di docker-compose.yml environment.

---

Made by **Bintang Inovasi Teknologi Dev** with ❤️ for Kementerian Investasi dan Hilirisasi/BKPM
