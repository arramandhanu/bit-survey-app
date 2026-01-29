const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// JWT Secret
const JWT_SECRET = process.env.ADMIN_SECRET || 'bkpm-survey-secret-key-2024';

// MySQL Connection Pool
let pool;

async function initDatabase() {
    const maxRetries = 30;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            pool = mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 3306,
                user: process.env.DB_USER || 'survey',
                password: process.env.DB_PASSWORD || 'survey123',
                database: process.env.DB_NAME || 'survey_db',
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });

            // Test connection
            const connection = await pool.getConnection();
            console.log('✅ Database connected successfully');
            connection.release();

            // Ensure admin user exists
            await ensureAdminUser();

            return true;
        } catch (error) {
            retries++;
            console.log(`⏳ Waiting for database... (${retries}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    console.error('❌ Failed to connect to database after maximum retries');
    process.exit(1);
}

// Ensure admin user exists with correct password
async function ensureAdminUser() {
    const adminUsername = 'admin';
    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD;

    // Skip if no password configured
    if (!adminPassword) {
        console.log('ℹ️  No ADMIN_DEFAULT_PASSWORD set, skipping admin user setup');
        return;
    }

    try {
        // Hash password with cost factor 12 for production security
        const passwordHash = await bcrypt.hash(adminPassword, 12);

        // Check if admin exists
        const [existing] = await pool.query(
            'SELECT id FROM admin_users WHERE username = ?',
            [adminUsername]
        );

        if (existing.length === 0) {
            // Create admin user
            await pool.query(
                'INSERT INTO admin_users (username, password_hash, name, email) VALUES (?, ?, ?, ?)',
                [adminUsername, passwordHash, 'Administrator', 'admin@bkpm.go.id']
            );
            console.log('✅ Admin user created');
        } else {
            // Update password
            await pool.query(
                'UPDATE admin_users SET password_hash = ? WHERE username = ?',
                [passwordHash, adminUsername]
            );
            console.log('✅ Admin password updated');
        }
    } catch (error) {
        console.error('⚠️ Could not ensure admin user:', error.message);
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middleware
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
}

// =====================================================
// HEALTH CHECK
// =====================================================
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({
            status: 'healthy',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message
        });
    }
});

// =====================================================
// SURVEY ENDPOINTS (Public Kiosk)
// =====================================================

// Submit survey (from kiosk)
app.post('/api/survey', async (req, res) => {
    const { questions } = req.body;

    if (!questions || typeof questions !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'Invalid survey data'
        });
    }

    try {
        const [result] = await pool.query(
            `INSERT INTO surveys (q1_kecepatan, q2_keramahan, q3_kejelasan, q4_fasilitas, q5_kepuasan, user_agent, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                questions.q1 || null,
                questions.q2 || null,
                questions.q3 || null,
                questions.q4 || null,
                questions.q5 || null,
                req.headers['user-agent'] || 'unknown',
                req.ip || req.connection?.remoteAddress || 'unknown'
            ]
        );

        res.status(201).json({
            success: true,
            message: 'Terima kasih atas penilaian Anda!',
            id: result.insertId
        });
    } catch (error) {
        console.error('Error saving survey:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save survey'
        });
    }
});

// Get survey statistics (public)
app.get('/api/survey/stats', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN q5_kepuasan = 'sangat_baik' THEN 1 ELSE 0 END) as satisfied,
                SUM(CASE WHEN q5_kepuasan = 'cukup_baik' THEN 1 ELSE 0 END) as neutral,
                SUM(CASE WHEN q5_kepuasan = 'kurang_baik' THEN 1 ELSE 0 END) as unsatisfied
            FROM surveys
        `);

        res.json({
            success: true,
            stats: rows[0],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// =====================================================
// ADMIN ENDPOINTS
// =====================================================

// Admin login
app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Username and password required'
        });
    }

    try {
        const [users] = await pool.query(
            'SELECT * FROM admin_users WHERE username = ? AND is_active = 1',
            [username]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Update last login
        await pool.query(
            'UPDATE admin_users SET last_login = NOW() WHERE id = ?',
            [user.id]
        );

        // Generate JWT
        const token = jwt.sign(
            { id: user.id, username: user.username, name: user.name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                name: user.name
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Get dashboard stats (protected)
app.get('/admin/api/dashboard', authMiddleware, async (req, res) => {
    try {
        // Total surveys
        const [totalResult] = await pool.query('SELECT COUNT(*) as total FROM surveys');

        // Today's surveys
        const [todayResult] = await pool.query(
            'SELECT COUNT(*) as today FROM surveys WHERE DATE(created_at) = CURDATE()'
        );

        // This month's surveys
        const [monthResult] = await pool.query(
            'SELECT COUNT(*) as month FROM surveys WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())'
        );

        // Per-question breakdown
        const [questionsBreakdown] = await pool.query(`
            SELECT 
                -- Q1 Kecepatan
                SUM(CASE WHEN q1_kecepatan = 'sangat_baik' THEN 1 ELSE 0 END) as q1_sangat_baik,
                SUM(CASE WHEN q1_kecepatan = 'cukup_baik' THEN 1 ELSE 0 END) as q1_cukup_baik,
                SUM(CASE WHEN q1_kecepatan = 'kurang_baik' THEN 1 ELSE 0 END) as q1_kurang_baik,
                -- Q2 Keramahan
                SUM(CASE WHEN q2_keramahan = 'sangat_baik' THEN 1 ELSE 0 END) as q2_sangat_baik,
                SUM(CASE WHEN q2_keramahan = 'cukup_baik' THEN 1 ELSE 0 END) as q2_cukup_baik,
                SUM(CASE WHEN q2_keramahan = 'kurang_baik' THEN 1 ELSE 0 END) as q2_kurang_baik,
                -- Q3 Kejelasan
                SUM(CASE WHEN q3_kejelasan = 'sangat_baik' THEN 1 ELSE 0 END) as q3_sangat_baik,
                SUM(CASE WHEN q3_kejelasan = 'cukup_baik' THEN 1 ELSE 0 END) as q3_cukup_baik,
                SUM(CASE WHEN q3_kejelasan = 'kurang_baik' THEN 1 ELSE 0 END) as q3_kurang_baik,
                -- Q4 Fasilitas
                SUM(CASE WHEN q4_fasilitas = 'sangat_baik' THEN 1 ELSE 0 END) as q4_sangat_baik,
                SUM(CASE WHEN q4_fasilitas = 'cukup_baik' THEN 1 ELSE 0 END) as q4_cukup_baik,
                SUM(CASE WHEN q4_fasilitas = 'kurang_baik' THEN 1 ELSE 0 END) as q4_kurang_baik,
                -- Q5 Kepuasan
                SUM(CASE WHEN q5_kepuasan = 'sangat_baik' THEN 1 ELSE 0 END) as q5_sangat_baik,
                SUM(CASE WHEN q5_kepuasan = 'cukup_baik' THEN 1 ELSE 0 END) as q5_cukup_baik,
                SUM(CASE WHEN q5_kepuasan = 'kurang_baik' THEN 1 ELSE 0 END) as q5_kurang_baik
            FROM surveys
        `);

        // Last 7 days trend
        const [trendResult] = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as count
            FROM surveys 
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `);

        const breakdown = questionsBreakdown[0];

        res.json({
            success: true,
            data: {
                total: totalResult[0].total,
                today: todayResult[0].today,
                thisMonth: monthResult[0].month,
                questions: {
                    q1_kecepatan: {
                        sangat_baik: parseInt(breakdown.q1_sangat_baik) || 0,
                        cukup_baik: parseInt(breakdown.q1_cukup_baik) || 0,
                        kurang_baik: parseInt(breakdown.q1_kurang_baik) || 0
                    },
                    q2_keramahan: {
                        sangat_baik: parseInt(breakdown.q2_sangat_baik) || 0,
                        cukup_baik: parseInt(breakdown.q2_cukup_baik) || 0,
                        kurang_baik: parseInt(breakdown.q2_kurang_baik) || 0
                    },
                    q3_kejelasan: {
                        sangat_baik: parseInt(breakdown.q3_sangat_baik) || 0,
                        cukup_baik: parseInt(breakdown.q3_cukup_baik) || 0,
                        kurang_baik: parseInt(breakdown.q3_kurang_baik) || 0
                    },
                    q4_fasilitas: {
                        sangat_baik: parseInt(breakdown.q4_sangat_baik) || 0,
                        cukup_baik: parseInt(breakdown.q4_cukup_baik) || 0,
                        kurang_baik: parseInt(breakdown.q4_kurang_baik) || 0
                    },
                    q5_kepuasan: {
                        sangat_baik: parseInt(breakdown.q5_sangat_baik) || 0,
                        cukup_baik: parseInt(breakdown.q5_cukup_baik) || 0,
                        kurang_baik: parseInt(breakdown.q5_kurang_baik) || 0
                    }
                },
                trend: trendResult
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Get monthly report data (protected)
app.get('/admin/api/reports/monthly', authMiddleware, async (req, res) => {
    const { year, month } = req.query;

    const targetYear = year || new Date().getFullYear();
    const targetMonth = month || new Date().getMonth() + 1;

    try {
        // Get monthly stats
        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN q1_kecepatan = 'sangat_baik' THEN 1 ELSE 0 END) as q1_sangat_baik,
                SUM(CASE WHEN q1_kecepatan = 'cukup_baik' THEN 1 ELSE 0 END) as q1_cukup_baik,
                SUM(CASE WHEN q1_kecepatan = 'kurang_baik' THEN 1 ELSE 0 END) as q1_kurang_baik,
                SUM(CASE WHEN q2_keramahan = 'sangat_baik' THEN 1 ELSE 0 END) as q2_sangat_baik,
                SUM(CASE WHEN q2_keramahan = 'cukup_baik' THEN 1 ELSE 0 END) as q2_cukup_baik,
                SUM(CASE WHEN q2_keramahan = 'kurang_baik' THEN 1 ELSE 0 END) as q2_kurang_baik,
                SUM(CASE WHEN q3_kejelasan = 'sangat_baik' THEN 1 ELSE 0 END) as q3_sangat_baik,
                SUM(CASE WHEN q3_kejelasan = 'cukup_baik' THEN 1 ELSE 0 END) as q3_cukup_baik,
                SUM(CASE WHEN q3_kejelasan = 'kurang_baik' THEN 1 ELSE 0 END) as q3_kurang_baik,
                SUM(CASE WHEN q4_fasilitas = 'sangat_baik' THEN 1 ELSE 0 END) as q4_sangat_baik,
                SUM(CASE WHEN q4_fasilitas = 'cukup_baik' THEN 1 ELSE 0 END) as q4_cukup_baik,
                SUM(CASE WHEN q4_fasilitas = 'kurang_baik' THEN 1 ELSE 0 END) as q4_kurang_baik,
                SUM(CASE WHEN q5_kepuasan = 'sangat_baik' THEN 1 ELSE 0 END) as q5_sangat_baik,
                SUM(CASE WHEN q5_kepuasan = 'cukup_baik' THEN 1 ELSE 0 END) as q5_cukup_baik,
                SUM(CASE WHEN q5_kepuasan = 'kurang_baik' THEN 1 ELSE 0 END) as q5_kurang_baik
            FROM surveys
            WHERE YEAR(created_at) = ? AND MONTH(created_at) = ?
        `, [targetYear, targetMonth]);

        // Get daily breakdown
        const [dailyStats] = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as total,
                SUM(CASE WHEN q5_kepuasan = 'sangat_baik' THEN 1 ELSE 0 END) as satisfied
            FROM surveys
            WHERE YEAR(created_at) = ? AND MONTH(created_at) = ?
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `, [targetYear, targetMonth]);

        res.json({
            success: true,
            data: {
                year: parseInt(targetYear),
                month: parseInt(targetMonth),
                stats: stats[0],
                daily: dailyStats
            }
        });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Get available months for reports
app.get('/admin/api/reports/months', authMiddleware, async (req, res) => {
    try {
        const [months] = await pool.query(`
            SELECT DISTINCT 
                YEAR(created_at) as year,
                MONTH(created_at) as month,
                COUNT(*) as count
            FROM surveys
            GROUP BY YEAR(created_at), MONTH(created_at)
            ORDER BY year DESC, month DESC
            LIMIT 24
        `);

        res.json({ success: true, months });
    } catch (error) {
        console.error('Error getting months:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Generate PDF Report (protected)
app.get('/admin/api/reports/pdf', authMiddleware, async (req, res) => {
    const { year, month } = req.query;

    const targetYear = year || new Date().getFullYear();
    const targetMonth = month || new Date().getMonth() + 1;

    const monthNames = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    try {
        // Get data
        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN q1_kecepatan = 'sangat_baik' THEN 1 ELSE 0 END) as q1_sangat_baik,
                SUM(CASE WHEN q1_kecepatan = 'cukup_baik' THEN 1 ELSE 0 END) as q1_cukup_baik,
                SUM(CASE WHEN q1_kecepatan = 'kurang_baik' THEN 1 ELSE 0 END) as q1_kurang_baik,
                SUM(CASE WHEN q2_keramahan = 'sangat_baik' THEN 1 ELSE 0 END) as q2_sangat_baik,
                SUM(CASE WHEN q2_keramahan = 'cukup_baik' THEN 1 ELSE 0 END) as q2_cukup_baik,
                SUM(CASE WHEN q2_keramahan = 'kurang_baik' THEN 1 ELSE 0 END) as q2_kurang_baik,
                SUM(CASE WHEN q3_kejelasan = 'sangat_baik' THEN 1 ELSE 0 END) as q3_sangat_baik,
                SUM(CASE WHEN q3_kejelasan = 'cukup_baik' THEN 1 ELSE 0 END) as q3_cukup_baik,
                SUM(CASE WHEN q3_kejelasan = 'kurang_baik' THEN 1 ELSE 0 END) as q3_kurang_baik,
                SUM(CASE WHEN q4_fasilitas = 'sangat_baik' THEN 1 ELSE 0 END) as q4_sangat_baik,
                SUM(CASE WHEN q4_fasilitas = 'cukup_baik' THEN 1 ELSE 0 END) as q4_cukup_baik,
                SUM(CASE WHEN q4_fasilitas = 'kurang_baik' THEN 1 ELSE 0 END) as q4_kurang_baik,
                SUM(CASE WHEN q5_kepuasan = 'sangat_baik' THEN 1 ELSE 0 END) as q5_sangat_baik,
                SUM(CASE WHEN q5_kepuasan = 'cukup_baik' THEN 1 ELSE 0 END) as q5_cukup_baik,
                SUM(CASE WHEN q5_kepuasan = 'kurang_baik' THEN 1 ELSE 0 END) as q5_kurang_baik
            FROM surveys
            WHERE YEAR(created_at) = ? AND MONTH(created_at) = ?
        `, [targetYear, targetMonth]);

        const data = stats[0];
        const total = data.total || 0;

        // Create PDF
        const doc = new PDFDocument({ size: 'A4', margin: 50 });

        // Set headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-survey-${targetYear}-${targetMonth}.pdf`);

        doc.pipe(res);

        // Header
        doc.fontSize(20).font('Helvetica-Bold')
            .text('LAPORAN SURVEY KEPUASAN LAYANAN', { align: 'center' });
        doc.fontSize(14).font('Helvetica')
            .text('Kementerian Investasi/BKPM', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12)
            .text(`Periode: ${monthNames[targetMonth - 1]} ${targetYear}`, { align: 'center' });

        doc.moveDown(2);

        // Divider
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown();

        // Summary
        doc.fontSize(14).font('Helvetica-Bold').text('RINGKASAN');
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica');
        doc.text(`Total Responden: ${total}`);

        if (total > 0) {
            const satisfiedPct = Math.round((data.q5_sangat_baik / total) * 100);
            doc.text(`Tingkat Kepuasan (Sangat Puas): ${satisfiedPct}%`);
        }

        doc.moveDown(2);

        // Questions
        const questions = [
            { name: 'Kecepatan Pelayanan', prefix: 'q1' },
            { name: 'Keramahan Petugas', prefix: 'q2' },
            { name: 'Kejelasan Informasi', prefix: 'q3' },
            { name: 'Kondisi Fasilitas', prefix: 'q4' },
            { name: 'Kepuasan Keseluruhan', prefix: 'q5' }
        ];

        doc.fontSize(14).font('Helvetica-Bold').text('HASIL PER PERTANYAAN');
        doc.moveDown();

        questions.forEach((q, index) => {
            const sangat = data[`${q.prefix}_sangat_baik`] || 0;
            const cukup = data[`${q.prefix}_cukup_baik`] || 0;
            const kurang = data[`${q.prefix}_kurang_baik`] || 0;
            const qTotal = sangat + cukup + kurang;

            doc.fontSize(11).font('Helvetica-Bold')
                .text(`${index + 1}. ${q.name}`);

            if (qTotal > 0) {
                doc.fontSize(10).font('Helvetica');
                doc.text(`   • Sangat Baik: ${sangat} (${Math.round((sangat / qTotal) * 100)}%)`);
                doc.text(`   • Cukup Baik: ${cukup} (${Math.round((cukup / qTotal) * 100)}%)`);
                doc.text(`   • Kurang Baik: ${kurang} (${Math.round((kurang / qTotal) * 100)}%)`);
            } else {
                doc.fontSize(10).font('Helvetica').text('   Tidak ada data');
            }
            doc.moveDown(0.5);
        });

        doc.moveDown(2);

        // Footer
        doc.fontSize(9).font('Helvetica')
            .text(`Digenerate pada: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });

        doc.end();
    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate PDF' });
    }
});

// Export CSV (protected)
app.get('/admin/api/reports/csv', authMiddleware, async (req, res) => {
    const { year, month } = req.query;

    try {
        let query = 'SELECT * FROM surveys';
        const params = [];

        if (year && month) {
            query += ' WHERE YEAR(created_at) = ? AND MONTH(created_at) = ?';
            params.push(year, month);
        }

        query += ' ORDER BY created_at DESC';

        const [rows] = await pool.query(query, params);

        // Generate CSV
        const headers = ['ID', 'Kecepatan', 'Keramahan', 'Kejelasan', 'Fasilitas', 'Kepuasan', 'Tanggal'];
        let csv = headers.join(',') + '\n';

        rows.forEach(row => {
            csv += [
                row.id,
                row.q1_kecepatan || '',
                row.q2_keramahan || '',
                row.q3_kejelasan || '',
                row.q4_fasilitas || '',
                row.q5_kepuasan || '',
                row.created_at.toISOString()
            ].join(',') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=survey-data-${year || 'all'}-${month || 'all'}.csv`);
        res.send(csv);
    } catch (error) {
        console.error('CSV export error:', error);
        res.status(500).json({ success: false, error: 'Failed to export CSV' });
    }
});

// Get all responses with pagination (protected)
app.get('/admin/api/responses', authMiddleware, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    try {
        const [countResult] = await pool.query('SELECT COUNT(*) as total FROM surveys');
        const total = countResult[0].total;

        const [rows] = await pool.query(
            'SELECT * FROM surveys ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [limit, offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error getting responses:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// =====================================================
// STATIC ROUTES
// =====================================================

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve admin pages
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

app.get('/admin/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
});

app.get('/admin/reports', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'reports.html'));
});

// =====================================================
// START SERVER
// =====================================================
async function start() {
    await initDatabase();

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Survey Kiosk running on http://0.0.0.0:${PORT}`);
        console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin`);
        console.log(`🔧 Adminer (DB): http://localhost:8080`);
    });
}

start();
