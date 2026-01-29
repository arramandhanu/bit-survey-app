# 🏛️ Survey Kepuasan Layanan - BKPM

![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)

Aplikasi survey kepuasan layanan untuk mode kiosk dengan dashboard admin.

## ✨ Fitur

- 🖥️ **Kiosk Mode** - Tampilan fullscreen dengan slideshow, touch-friendly
- 📊 **5 Pertanyaan Survey** - Kecepatan, Keramahan, Kejelasan, Fasilitas, Kepuasan
- 🎯 **3 Opsi Rating** - Sangat Baik, Cukup Baik, Kurang Baik dengan emoji
- 📈 **Admin Dashboard** - Statistik real-time, trend mingguan
- 📄 **Export Laporan** - PDF dan CSV untuk laporan bulanan
- 🔐 **JWT Authentication** - Keamanan admin dengan token
- 🐳 **Docker Ready** - Deployment dengan Docker Compose

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
| http://localhost:3000 | 🖥️ Kiosk Survey |
| http://localhost:3000/admin | 📊 Admin Dashboard |

## 📁 Struktur Proyek

```
survey/
├── server.js              # Express.js backend
├── init.sql               # Database schema
├── Dockerfile             # Container image
├── docker-compose.yml     # Service orchestration
├── .env.example           # Environment template
└── public/
    ├── index.html         # Kiosk survey UI
    ├── css/style.css      # Survey styles
    ├── js/app.js          # Survey logic
    └── admin/
        ├── login.html     # Admin login
        ├── dashboard.html # Dashboard
        └── reports.html   # Laporan bulanan
```

## 🔌 API Endpoints

### Public (Kiosk)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/survey` | Submit survey |
| GET | `/api/survey/stats` | Statistik publik |
| GET | `/health` | Health check |

### Admin (Protected)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/admin/login` | Login admin |
| GET | `/admin/api/dashboard` | Data dashboard |
| GET | `/admin/api/reports/monthly` | Laporan bulanan |
| GET | `/admin/api/reports/pdf` | Export PDF |
| GET | `/admin/api/reports/csv` | Export CSV |

## 🔒 Keamanan

- ✅ Password hashing dengan bcrypt (cost 12)
- ✅ JWT untuk autentikasi admin
- ✅ MySQL tidak di-expose ke host
- ✅ Kredensial via environment variables

##  Environment Variables

| Variable | Required | Deskripsi |
|----------|----------|-----------|
| `DB_PASSWORD` | ✅ | Password MySQL |
| `MYSQL_ROOT_PASSWORD` | ✅ | Password root MySQL |
| `ADMIN_SECRET` | ✅ | JWT signing secret |
| `ADMIN_DEFAULT_PASSWORD` | ✅ | Password admin awal |

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

# Reset database
docker compose down -v
```

---

Made by Bintang Inovasi Teknologi Dev with ❤️ for Kementerian Investasi/BKPM
