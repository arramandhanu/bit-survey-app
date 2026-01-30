# 🏛️ Survey Kepuasan Layanan - BKPM

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)

**Aplikasi Survey Kepuasan Layanan Mode Kiosk dengan Dashboard Analitik Real-time**
<br>
_Dikembangkan untuk Kementerian Investasi dan Hilirisasi / BKPM_

</div>

---

## ✨ Fitur Utama

### 🖥️ Kiosk Survey Interface
*   **Immersive Experience**: Tampilan fullscreen dengan slideshow otomatis saat idle.
*   **Touch Optimised**: Antarmuka ramah sentuhan dengan animasi emoji interaktif.
*   **Dynamic Questions**: Mendukung 5+ pertanyaan yang dapat dikustomisasi sepenuhnya via admin.
*   **Simple Rating**: 3 Opsi rating intuitif (Sangat Baik, Cukup Baik, Kurang Baik).

### 📊 Admin Dashboard & Analytics
*   **Real-time Stats**: Pantau total responden hari ini, bulan ini, dan tren mingguan.
*   **Dynamic Heatmap**: Visualisasi intensitas submission dalam grid 7x24 jam (Hari/Jam).
*   **Question Breakdown**: Analisis performa per butir pertanyaan.
*   **Recent Activity**: Feed 10 submission terakhir dengan update otomatis.

### 🛠️ Manajemen & Laporan
*   **Question Editor**: Tambah, edit, hapus, dan atur urutan pertanyaan via GUI.
*   **Professional Reports**: Export laporan bulanan siap cetak (PDF) dan data mentah (CSV).
*   **Audit Logging**: Riwayat lengkap setiap submission dengan filter tanggal.
*   **Security**: JWT Authentication, bcrypt password hashing, dan proteksi API.

---

## 🚀 Installation & Setup

Pilih metode instalasi yang sesuai dengan kebutuhan environment Anda.

### 🔧 Metode 1: Local Development (Node.js)
*Direkomendasikan untuk pengembangan dan debugging.*

#### Prasyarat
*   Node.js (v16 atau terbaru)
*   MySQL Server

#### Langkah Instalasi

1.  **Clone Repository**
    ```bash
    git clone git@github.com:arramandhanu/bit-survey-app.git
    cd bit-survey-app
    ```

2.  **Setup Database**
    Buat database dan import schema awal:
    ```sql
    -- Login ke MySQL Shell
    mysql -u root -p

    -- Jalankan perintah berikut:
    CREATE DATABASE survey_app;
    USE survey_app;
    SOURCE init.sql;
    ```

3.  **Install Dependencies**
    ```bash
    npm install
    ```

4.  **Konfigurasi Environment**
    Copy file template `.env`:
    ```bash
    cp .env.example .env
    ```
    Sesuaikan `.env` dengan kredensial database lokal Anda:
    ```ini
    DB_HOST=127.0.0.1
    DB_USER=root
    DB_PASSWORD=your_local_password
    DB_NAME=survey_app
    ```

5.  **Jalankan Aplikasi**
    ```bash
    # Mode Development (dengan auto-reload)
    npm run dev

    # Mode Production
    npm start
    ```
    Aplikasi dapat diakses di: `http://localhost:3000`

<br>

### 🐳 Metode 2: Docker Deployment
*Direkomendasikan untuk deployment production yang konsisten.*

#### Prasyarat
*   Docker Desktop / Docker Engine
*   Docker Compose

#### Langkah Deployment

1.  **Konfigurasi Environment**
    ```bash
    cp .env.example .env
    ```
    Edit `.env` dan atur password yang aman untuk production:
    ```ini
    MYSQL_ROOT_PASSWORD=secure_root_password
    DB_PASSWORD=secure_db_password
    ADMIN_SECRET=generate_strong_secret
    ADMIN_DEFAULT_PASSWORD=admin_initial_password
    ```
    > 💡 **Tip:** Generate strong secret dengan `openssl rand -base64 32`

2.  **Build & Run**
    ```bash
    docker compose up -d --build
    ```

3.  **Maintenance**
    ```bash
    # Lihat logs
    docker compose logs -f survey-app

    # Stop services
    docker compose down
    ```

---

## 🔗 Akses Aplikasi

| Modul | URL | Deskripsi |
| :--- | :--- | :--- |
| **Kiosk UI** | `http://localhost:3000` | Interface survey untuk publik/pengunjung |
| **Dashboard** | `http://localhost:3000/admin` | Dashboard analitik admin |
| **Laporan** | `http://localhost:3000/admin/reports` | Download Laporan PDF/CSV |
| **Pertanyaan** | `http://localhost:3000/admin/questions` | Editor Pertanyaan Survey |
| **Logs** | `http://localhost:3000/admin/logs` | Audit Log Data Mentah |

---

## 🔌 API Reference

### Public Endpoints
| Method | Endpoint | Kegunaan |
| :--- | :--- | :--- |
| `GET` | `/api/questions` | Mengambil daftar pertanyaan aktif |
| `POST` | `/api/survey` | Mengirim data hasil survey |
| `GET` | `/api/survey/stats` | Mengambil statistik ringkas (untuk public display) |

### Protected Admin Endpoints
*Memerlukan Header: `Authorization: Bearer <token>`*

| Method | Endpoint | Kegunaan |
| :--- | :--- | :--- |
| `GET` | `/admin/api/dashboard` | Data agregat dashboard |
| `GET` | `/admin/api/heatmap` | Data visualisasi heatmap grid |
| `GET` | `/admin/api/questions` | Manajemen CRUD pertanyaan |
| `POST` | `/admin/api/reports/reset` | Reset pertanyaan ke default template |

---

## 🗄️ Database Schema

### `surveys`
Tabel utama penyimpan transaksi survey.
*   **q1..q5**: Kolom dinamis (enum: 'sangat_baik', 'cukup_baik', 'kurang_baik') yang memetakan jawaban user.

### `questions`
Tabel konfigurasi pertanyaan dinamis.
*   **question_key**: ID Unik (q1, q2...)
*   **question_text**: Label pertanyaan yang tampil di kiosk.
*   **option_***: Label kustom untuk opsi jawaban (Positif/Netral/Negatif).
*   **display_order**: Integer untuk sorting urutan di UI.

---

## 🔧 Troubleshooting

### Q: Bagaimana cara mereset pertanyaan yang sudah terhapus/berantakan?
1. Login ke **Admin Panel**.
2. Masuk ke menu **Question Editor**.
3. Klik tombol **"Reset ke Default"** di pojok kanan atas.
4. Konfirmasi aksi tersebut.

### Q: Waktu di laporan tidak sesuai WIB?
Pastikan konfigurasi Timezone di `.env` (untuk local) atau `docker-compose.yml` (untuk docker) sudah diset:
```yaml
environment:
  - TZ=Asia/Jakarta
```

---

<div align="center">
  <p>Made with 🧠 by <b>Bintang Inovasi Teknologi Dev Team</b></p>
</div>
