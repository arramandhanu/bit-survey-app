const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// JWT Secret
const JWT_SECRET = process.env.ADMIN_SECRET || 'bkpm-survey-secret-key-2024';

// Rate limiting storage (in-memory)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5; // Max 5 submissions per window

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
app.set('trust proxy', true); // Trust Nginx proxy
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Helper function to get real client IP behind proxy
function getClientIp(req) {
    // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
    // The real client IP is the first one
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const ips = forwarded.split(',').map(ip => ip.trim());
        return ips[0]; // Return the first (original client) IP
    }
    // Fallback to X-Real-IP (set by Nginx)
    if (req.headers['x-real-ip']) {
        return req.headers['x-real-ip'];
    }
    // Final fallback
    return req.ip || req.connection?.remoteAddress || 'unknown';
}

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

// Session token middleware for survey protection (Full Protection)
function sessionMiddleware(req, res, next) {
    const clientIp = getClientIp(req);

    // 1. RATE LIMITING - Check if IP exceeded limit
    const now = Date.now();
    const ipData = rateLimitStore.get(clientIp) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

    // Reset if window expired
    if (now > ipData.resetTime) {
        ipData.count = 0;
        ipData.resetTime = now + RATE_LIMIT_WINDOW;
    }

    if (ipData.count >= RATE_LIMIT_MAX) {
        const retryAfter = Math.ceil((ipData.resetTime - now) / 1000);
        console.log('[RATE_LIMIT] Blocked:', clientIp, 'Retry after:', retryAfter, 'seconds');
        return res.status(429).json({
            success: false,
            error: `Terlalu banyak request. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit.`,
            retryAfter
        });
    }

    // 2. ORIGIN/REFERER CHECK - Must come from browser with valid origin
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const host = req.headers.host;

    // Check if request has valid origin (browsers send this, curl doesn't by default)
    const validOrigin = origin && (
        origin.includes(host) ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1')
    );
    const validReferer = referer && (
        referer.includes(host) ||
        referer.includes('localhost') ||
        referer.includes('127.0.0.1')
    );

    if (!validOrigin && !validReferer) {
        console.log('[SECURITY] Blocked - No valid Origin/Referer:', { origin, referer, host, ip: clientIp });
        return res.status(403).json({
            success: false,
            error: 'Request harus dari browser. Akses API langsung tidak diizinkan.'
        });
    }

    // 3. SESSION TOKEN - Check HttpOnly cookie
    const token = req.cookies.survey_session;

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Session tidak valid. Silakan mulai survey dari awal.'
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'survey_session') {
            throw new Error('Invalid token type');
        }

        // Update rate limit count (only after all checks pass)
        ipData.count++;
        rateLimitStore.set(clientIp, ipData);

        req.sessionData = decoded;
        next();
    } catch (error) {
        console.log('[SESSION] Invalid token:', error.message);
        res.clearCookie('survey_session');
        return res.status(401).json({
            success: false,
            error: 'Session expired. Silakan mulai survey dari awal.'
        });
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
// SURVEY ENDPOINTS (Protected with Session Token)
// =====================================================

// Get session token for survey (called when user starts survey)
// Sets HttpOnly cookie - token is NOT visible to JavaScript, preventing theft
app.get('/api/session', (req, res) => {
    const ipAddress = getClientIp(req);

    const token = jwt.sign(
        {
            type: 'survey_session',
            ip: ipAddress,
            createdAt: new Date().toISOString()
        },
        JWT_SECRET,
        { expiresIn: '10m' }
    );

    // Set HttpOnly cookie - secure, not accessible via JS
    res.cookie('survey_session', token, {
        httpOnly: true,         // Not accessible via JavaScript
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'strict',     // Prevent CSRF
        maxAge: 10 * 60 * 1000  // 10 minutes
    });

    console.log('[SESSION] New survey session created:', {
        ip: ipAddress,
        timestamp: new Date().toISOString()
    });

    res.json({
        success: true,
        message: 'Session started',
        expiresIn: '10 minutes'
    });
});

// Submit survey (from kiosk) - PROTECTED with session token
app.post('/api/survey', sessionMiddleware, async (req, res) => {
    const { questions } = req.body;

    if (!questions || typeof questions !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'Invalid survey data'
        });
    }

    const timestamp = new Date().toISOString();
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

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
                userAgent,
                ipAddress
            ]
        );

        // ========== AUDIT LOG ==========
        const auditLog = {
            event: 'SURVEY_SUBMITTED',
            timestamp: timestamp,
            surveyId: result.insertId,
            ip: ipAddress,
            userAgent: userAgent,
            answers: {
                q1_kecepatan: questions.q1,
                q2_keramahan: questions.q2,
                q3_kejelasan: questions.q3,
                q4_fasilitas: questions.q4,
                q5_kepuasan: questions.q5
            }
        };
        console.log('[AUDIT]', JSON.stringify(auditLog));
        // ================================

        res.status(201).json({
            success: true,
            message: 'Terima kasih atas penilaian Anda!',
            id: result.insertId
        });
    } catch (error) {
        console.error('[ERROR] Survey submission failed:', {
            timestamp: timestamp,
            ip: ipAddress,
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: 'Failed to save survey'
        });
    }
});

// Get survey statistics (public - for real-time counter)
app.get('/api/survey/stats', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today,
                SUM(CASE WHEN q5_kepuasan = 'sangat_baik' THEN 1 ELSE 0 END) as satisfied,
                SUM(CASE WHEN q5_kepuasan = 'cukup_baik' THEN 1 ELSE 0 END) as neutral,
                SUM(CASE WHEN q5_kepuasan = 'kurang_baik' THEN 1 ELSE 0 END) as unsatisfied
            FROM surveys
        `);

        res.json({
            success: true,
            stats: {
                total: rows[0].total || 0,
                today: rows[0].today || 0,
                satisfied: rows[0].satisfied || 0,
                neutral: rows[0].neutral || 0,
                unsatisfied: rows[0].unsatisfied || 0
            },
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

        // Get all active questions
        const [questions] = await pool.query(`
            SELECT id, question_key, question_text, option_positive, option_neutral, option_negative, display_order 
            FROM questions 
            WHERE is_active = 1 
            ORDER BY display_order ASC
        `);

        // Per-question breakdown (legacy - for backward compatibility)
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

        // Build dynamic questions stats array
        const questionStats = questions.map((q, index) => {
            const qNum = index + 1;
            const prefix = `q${qNum}`;
            return {
                id: q.id,
                key: q.question_key,
                text: q.question_text,
                option_positive: q.option_positive,
                option_neutral: q.option_neutral,
                option_negative: q.option_negative,
                order: q.display_order,
                stats: {
                    sangat_baik: parseInt(breakdown[`${prefix}_sangat_baik`]) || 0,
                    cukup_baik: parseInt(breakdown[`${prefix}_cukup_baik`]) || 0,
                    kurang_baik: parseInt(breakdown[`${prefix}_kurang_baik`]) || 0
                }
            };
        });

        res.json({
            success: true,
            data: {
                total: totalResult[0].total,
                today: todayResult[0].today,
                thisMonth: monthResult[0].month,
                questionsList: questionStats, // New dynamic list
                questions: { // Legacy format for backward compatibility
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

// Get recent submissions with suspicious activity detection (protected)
app.get('/admin/api/recent', authMiddleware, async (req, res) => {
    try {
        // Get last 15 submissions
        const [recent] = await pool.query(`
            SELECT 
                id,
                q1_kecepatan,
                q2_keramahan,
                q3_kejelasan,
                q4_fasilitas,
                q5_kepuasan,
                ip_address,
                created_at
            FROM surveys
            ORDER BY created_at DESC
            LIMIT 15
        `);

        // Detect suspicious activity: same IP submitting 3+ times in 10 minutes
        const [suspicious] = await pool.query(`
            SELECT 
                ip_address,
                COUNT(*) as count,
                MIN(created_at) as first_submission,
                MAX(created_at) as last_submission
            FROM surveys
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
            GROUP BY ip_address
            HAVING COUNT(*) >= 3
        `);

        // Get unique IPs today
        const [uniqueIps] = await pool.query(`
            SELECT COUNT(DISTINCT ip_address) as unique_ips
            FROM surveys
            WHERE DATE(created_at) = CURDATE()
        `);

        res.json({
            success: true,
            data: {
                recent: recent.map(r => ({
                    ...r,
                    isSuspicious: suspicious.some(s => s.ip_address === r.ip_address)
                })),
                suspicious: suspicious,
                uniqueIpsToday: uniqueIps[0].unique_ips || 0,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Recent submissions error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Get monthly report data (protected)
app.get('/admin/api/reports/monthly', authMiddleware, async (req, res) => {
    const { year, month } = req.query;

    const targetYear = year || new Date().getFullYear();
    const targetMonth = month || new Date().getMonth() + 1;

    try {
        // Get all active questions
        const [questions] = await pool.query(`
            SELECT id, question_key, question_text, option_positive, option_neutral, option_negative, display_order 
            FROM questions 
            WHERE is_active = 1 
            ORDER BY display_order ASC
        `);

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

        // Build dynamic questions list for frontend
        const questionsList = questions.map((q, index) => ({
            id: q.id,
            key: q.question_key,
            name: q.question_text.replace(/\?$/, '').replace(/^Bagaimana /, '').replace(/^Secara keseluruhan, bagaimana /, ''),
            text: q.question_text,
            prefix: `q${index + 1}`,
            option_positive: q.option_positive,
            option_neutral: q.option_neutral,
            option_negative: q.option_negative
        }));

        res.json({
            success: true,
            data: {
                year: parseInt(targetYear),
                month: parseInt(targetMonth),
                stats: stats[0],
                daily: dailyStats,
                questionsList: questionsList // New dynamic questions list
            }
        });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Heatmap API - Hourly submission patterns
app.get('/admin/api/heatmap', authMiddleware, async (req, res) => {
    try {
        // Get hourly data for the last 30 days grouped by day of week and hour
        const [heatmapData] = await pool.query(`
            SELECT 
                DAYOFWEEK(created_at) as day_of_week,
                HOUR(created_at) as hour,
                COUNT(*) as count
            FROM surveys
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DAYOFWEEK(created_at), HOUR(created_at)
            ORDER BY day_of_week, hour
        `);

        // Transform to 7x24 matrix (days x hours)
        // DAYOFWEEK: 1=Sunday, 2=Monday, ..., 7=Saturday
        const matrix = Array(7).fill(null).map(() => Array(24).fill(0));
        let maxCount = 0;

        heatmapData.forEach(row => {
            const dayIndex = row.day_of_week - 1; // 0-indexed
            matrix[dayIndex][row.hour] = row.count;
            if (row.count > maxCount) maxCount = row.count;
        });

        res.json({
            success: true,
            data: {
                matrix,
                maxCount,
                days: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
            }
        });
    } catch (error) {
        console.error('Heatmap error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Audit Logs API - Paginated submission history
app.get('/admin/api/logs', authMiddleware, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const date = req.query.date; // Optional date filter YYYY-MM-DD

    try {
        let whereClause = '';
        let params = [];

        if (date) {
            whereClause = 'WHERE DATE(created_at) = ?';
            params.push(date);
        }

        // Get total count
        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM surveys ${whereClause}`,
            params
        );
        const total = countResult[0].total;

        // Get paginated data
        const [submissions] = await pool.query(`
            SELECT 
                id,
                created_at,
                q1_kecepatan,
                q2_keramahan,
                q3_kejelasan,
                q4_fasilitas,
                q5_kepuasan
            FROM surveys
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        res.json({
            success: true,
            data: {
                submissions,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Logs error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// =====================================================
// QUESTIONS API - CRUD for survey questions
// =====================================================

// Get all questions (public - for kiosk)
app.get('/api/questions', async (req, res) => {
    try {
        const [questions] = await pool.query(`
            SELECT id, question_key, question_text, question_subtitle,
                   option_positive, option_neutral, option_negative, display_order
            FROM questions
            WHERE is_active = 1
            ORDER BY display_order ASC
        `);
        res.json({ success: true, questions });
    } catch (error) {
        console.error('Error getting questions:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Get all questions (admin - includes inactive)
app.get('/admin/api/questions', authMiddleware, async (req, res) => {
    try {
        const [questions] = await pool.query(`
            SELECT * FROM questions ORDER BY display_order ASC
        `);
        res.json({ success: true, questions });
    } catch (error) {
        console.error('Error getting questions:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Get single question
app.get('/admin/api/questions/:id', authMiddleware, async (req, res) => {
    try {
        const [questions] = await pool.query(
            'SELECT * FROM questions WHERE id = ?',
            [req.params.id]
        );
        if (questions.length === 0) {
            return res.status(404).json({ success: false, error: 'Question not found' });
        }
        res.json({ success: true, question: questions[0] });
    } catch (error) {
        console.error('Error getting question:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Update question
app.put('/admin/api/questions/:id', authMiddleware, async (req, res) => {
    const { question_text, question_subtitle, option_positive, option_neutral, option_negative, is_active } = req.body;

    try {
        await pool.query(`
            UPDATE questions SET
                question_text = ?,
                question_subtitle = ?,
                option_positive = ?,
                option_neutral = ?,
                option_negative = ?,
                is_active = ?
            WHERE id = ?
        `, [question_text, question_subtitle, option_positive, option_neutral, option_negative, is_active ? 1 : 0, req.params.id]);

        res.json({ success: true, message: 'Question updated' });
    } catch (error) {
        console.error('Error updating question:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Reset questions to defaults
app.post('/admin/api/questions/reset', authMiddleware, async (req, res) => {
    const defaults = [
        { key: 'q1', text: 'Bagaimana kecepatan pelayanan kami?', positive: 'SANGAT CEPAT', neutral: 'CUKUP CEPAT', negative: 'KURANG CEPAT' },
        { key: 'q2', text: 'Bagaimana keramahan petugas kami?', positive: 'SANGAT RAMAH', neutral: 'CUKUP RAMAH', negative: 'KURANG RAMAH' },
        { key: 'q3', text: 'Bagaimana kejelasan informasi yang diberikan?', positive: 'SANGAT JELAS', neutral: 'CUKUP JELAS', negative: 'KURANG JELAS' },
        { key: 'q4', text: 'Bagaimana kondisi fasilitas kami?', positive: 'SANGAT BAIK', neutral: 'CUKUP BAIK', negative: 'KURANG BAIK' },
        { key: 'q5', text: 'Secara keseluruhan, bagaimana kepuasan Anda?', positive: 'SANGAT PUAS', neutral: 'CUKUP PUAS', negative: 'KURANG PUAS' }
    ];

    try {
        for (const q of defaults) {
            await pool.query(`
                UPDATE questions SET
                    question_text = ?,
                    option_positive = ?,
                    option_neutral = ?,
                    option_negative = ?,
                    is_active = 1
                WHERE question_key = ?
            `, [q.text, q.positive, q.neutral, q.negative, q.key]);
        }
        res.json({ success: true, message: 'Questions reset to defaults' });
    } catch (error) {
        console.error('Error resetting questions:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// CREATE new question
app.post('/admin/api/questions', authMiddleware, async (req, res) => {
    const { question_text, option_positive, option_neutral, option_negative, is_active } = req.body;

    if (!question_text) {
        return res.status(400).json({ success: false, error: 'Question text is required' });
    }

    try {
        // Get next question key
        const [maxKey] = await pool.query('SELECT MAX(CAST(SUBSTRING(question_key, 2) AS UNSIGNED)) as max_num FROM questions');
        const nextNum = (maxKey[0].max_num || 0) + 1;
        const questionKey = `q${nextNum}`;

        // Get next order
        const [maxOrder] = await pool.query('SELECT MAX(display_order) as max_order FROM questions');
        const nextOrder = (maxOrder[0].max_order || 0) + 1;

        const [result] = await pool.query(`
            INSERT INTO questions (question_key, question_text, option_positive, option_neutral, option_negative, display_order, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [questionKey, question_text, option_positive || 'SANGAT BAIK', option_neutral || 'CUKUP BAIK', option_negative || 'KURANG BAIK', nextOrder, is_active !== false ? 1 : 0]);

        res.json({
            success: true,
            message: 'Question created',
            question: {
                id: result.insertId,
                question_key: questionKey,
                question_text,
                option_positive: option_positive || 'SANGAT BAIK',
                option_neutral: option_neutral || 'CUKUP BAIK',
                option_negative: option_negative || 'KURANG BAIK',
                display_order: nextOrder,
                is_active: is_active !== false
            }
        });
    } catch (error) {
        console.error('Error creating question:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// DELETE question
app.delete('/admin/api/questions/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await pool.query('DELETE FROM questions WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Question not found' });
        }

        res.json({ success: true, message: 'Question deleted' });
    } catch (error) {
        console.error('Error deleting question:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Reorder questions
app.put('/admin/api/questions/reorder', authMiddleware, async (req, res) => {
    const { order } = req.body; // Array of { id, order }

    if (!Array.isArray(order)) {
        return res.status(400).json({ success: false, error: 'Order must be an array' });
    }

    try {
        for (const item of order) {
            await pool.query('UPDATE questions SET question_order = ? WHERE id = ?', [item.order, item.id]);
        }

        res.json({ success: true, message: 'Questions reordered' });
    } catch (error) {
        console.error('Error reordering questions:', error);
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
        // 1. Get Active Questions from DB
        const [questionsList] = await pool.query(`
            SELECT * FROM questions 
            WHERE is_active = 1 
            ORDER BY display_order ASC
        `);

        // 2. Get Statistics
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

        // Colors
        const primaryColor = '#0F2E5C';
        const greenColor = '#28A745';
        const orangeColor = '#F39C12';
        const redColor = '#DC3545';
        const grayColor = '#6C757D';

        // ========== HEADER - Professional text-only layout ==========
        doc.rect(0, 0, 595, 90).fill(primaryColor);

        // Logo commented out for cleaner look
        /*
        const logoPath = path.join(__dirname, 'public/admin/img/logo.png');
        let logoLoaded = false;
        try {
            if (fs.existsSync(logoPath)) {
                const buffer = fs.readFileSync(logoPath);
                const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
                if (isPNG && buffer.length > 100) {
                    doc.image(logoPath, 20, 10, { height: 60 });
                    logoLoaded = true;
                }
            }
        } catch (logoErr) {
            console.error('Logo loading error:', logoErr.message);
        }
        */

        // Professional centered header text
        doc.fillColor('#FFFFFF')
            .fontSize(22).font('Helvetica-Bold')
            .text('LAPORAN SURVEY KEPUASAN LAYANAN', 50, 22, { width: 495, align: 'center' });

        doc.fontSize(11).font('Helvetica')
            .text('Kementerian Investasi dan Hilirisasi/BKPM', 50, 52, { width: 495, align: 'center' });

        doc.fontSize(12).font('Helvetica-Bold')
            .text(`Periode: ${monthNames[targetMonth - 1]} ${targetYear}`, 50, 70, { width: 495, align: 'center' });

        doc.fillColor('#000000');
        doc.y = 105;

        // ========== SUMMARY CARDS ==========
        const cardY = doc.y;
        const cardWidth = 120;
        const cardHeight = 70;
        const startX = 50;
        // Determine the last question prefix for overall satisfaction summary
        const numQuestions = questionsList.length;
        const lastQPrefix = `q${numQuestions}`;

        // Get counts from the last question (overall satisfaction)
        const sangat = data[`${lastQPrefix}_sangat_baik`] || 0;
        const cukup = data[`${lastQPrefix}_cukup_baik`] || 0;
        const kurang = data[`${lastQPrefix}_kurang_baik`] || 0;
        const gap = 15;

        // Card backgrounds
        const cards = [
            { label: 'Total Responden', value: total, color: primaryColor },
            { label: 'Sangat Puas', value: sangat, color: greenColor },
            { label: 'Cukup Puas', value: cukup, color: orangeColor },
            { label: 'Kurang Puas', value: kurang, color: redColor }
        ];

        cards.forEach((card, i) => {
            const x = startX + (i * (cardWidth + gap));

            // Card background
            doc.rect(x, cardY, cardWidth, cardHeight).fill('#F8F9FA');

            // Top colored bar
            doc.rect(x, cardY, cardWidth, 5).fill(card.color);

            // Value
            doc.fillColor(card.color)
                .fontSize(24).font('Helvetica-Bold')
                .text(card.value.toString(), x, cardY + 20, { width: cardWidth, align: 'center' });

            // Label
            doc.fillColor(grayColor)
                .fontSize(9).font('Helvetica')
                .text(card.label, x, cardY + 48, { width: cardWidth, align: 'center' });
        });

        doc.y = cardY + cardHeight + 30;
        doc.fillColor('#000000');

        // ========== SATISFACTION METER ==========
        if (total > 0) {
            const satisfiedPct = Math.round((sangat / total) * 100);

            doc.fontSize(12).font('Helvetica-Bold')
                .text('TINGKAT KEPUASAN KESELURUHAN', 50, doc.y);
            doc.moveDown(0.5);

            // Progress bar background
            const barY = doc.y;
            const barWidth = 495;
            const barHeight = 20;

            doc.rect(50, barY, barWidth, barHeight).fill('#E9ECEF');
            doc.rect(50, barY, (barWidth * satisfiedPct / 100), barHeight).fill(greenColor);

            // Percentage text
            doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
                .text(`${satisfiedPct}%`, 55, barY + 4);

            doc.fillColor('#000000');
            doc.y = barY + barHeight + 20;
        }

        // ========== QUESTIONS TABLE ==========
        doc.fontSize(12).font('Helvetica-Bold').fillColor(primaryColor)
            .text('HASIL PER PERTANYAAN', 50, doc.y);
        doc.moveDown(0.5);

        const questions = [
            { name: 'Kecepatan Pelayanan', prefix: 'q1' },
            { name: 'Keramahan Petugas', prefix: 'q2' },
            { name: 'Kejelasan Informasi', prefix: 'q3' },
            { name: 'Kondisi Fasilitas', prefix: 'q4' },
            { name: 'Kepuasan Keseluruhan', prefix: 'q5' }
        ];

        // Table header - use dynamic option labels from last question
        const lastQ = questionsList[questionsList.length - 1];
        const tableY = doc.y;
        // Adjusted column positions for better layout
        const colX = [50, 260, 350, 455];
        const questionColWidth = 200; // Width for question text

        doc.rect(50, tableY, 495, 25).fill(primaryColor);
        doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
        doc.text('Pertanyaan', colX[0] + 5, tableY + 7, { width: questionColWidth });
        doc.text(lastQ ? lastQ.option_positive : 'Sangat Baik', colX[1], tableY + 7, { width: 85 });
        doc.text(lastQ ? lastQ.option_neutral : 'Cukup Baik', colX[2], tableY + 7, { width: 85 });
        doc.text(lastQ ? lastQ.option_negative : 'Kurang Baik', colX[3], tableY + 7, { width: 85 });

        doc.fillColor('#000000');
        let rowY = tableY + 25;

        // Use questionsList for dynamic rendering
        questionsList.forEach((q, index) => {
            const sangat = data[`${q.question_key}_sangat_baik`] || 0;
            const cukup = data[`${q.question_key}_cukup_baik`] || 0;
            const kurang = data[`${q.question_key}_kurang_baik`] || 0;
            const qTotal = sangat + cukup + kurang;

            const sangatPct = qTotal > 0 ? Math.round((sangat / qTotal) * 100) : 0;
            const cukupPct = qTotal > 0 ? Math.round((cukup / qTotal) * 100) : 0;
            const kurangPct = qTotal > 0 ? Math.round((kurang / qTotal) * 100) : 0;

            // Alternating row background
            if (index % 2 === 0) {
                doc.rect(50, rowY, 495, 25).fill('#F8F9FA');
            }

            doc.fillColor('#000000').fontSize(9).font('Helvetica');
            // Use question_text from DB with width constraint
            const cleanText = q.question_text.replace(/\?$/, '');
            doc.text(`${index + 1}. ${cleanText}`, colX[0] + 5, rowY + 7, { width: questionColWidth });

            doc.fillColor(greenColor).text(`${sangat} (${sangatPct}%)`, colX[1], rowY + 7, { width: 85 });
            doc.fillColor(orangeColor).text(`${cukup} (${cukupPct}%)`, colX[2], rowY + 7, { width: 85 });
            doc.fillColor(redColor).text(`${kurang} (${kurangPct}%)`, colX[3], rowY + 7, { width: 85 });

            rowY += 25;
        });

        // Table border
        doc.rect(50, tableY, 495, rowY - tableY).stroke('#DEE2E6');

        doc.fillColor('#000000');
        doc.y = rowY + 30;

        // ========== FOOTER ==========
        const now = new Date();
        const jakartaTime = now.toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#DEE2E6');
        doc.moveDown();

        doc.fontSize(9).font('Helvetica').fillColor(grayColor)
            .text(`Laporan ini digenerate secara otomatis pada: ${jakartaTime} WIB`, { align: 'center' });
        doc.text('Survey Kepuasan Layanan - Kementerian Investasi/BKPM', { align: 'center' });

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
        // 1. Get Active Questions
        const [questionsList] = await pool.query(`
            SELECT * FROM questions 
            WHERE is_active = 1 
            ORDER BY display_order ASC
        `);

        // 2. Build query
        let query = 'SELECT * FROM surveys';
        const params = [];

        if (year && month) {
            query += ' WHERE YEAR(created_at) = ? AND MONTH(created_at) = ?';
            params.push(year, month);
        }

        query += ' ORDER BY created_at DESC';

        const [rows] = await pool.query(query, params);

        // 3. Generate CSV with dynamic headers
        let csv = 'ID,Tanggal';
        questionsList.forEach(q => {
            csv += `,"${q.question_text.replace(/"/g, '""')}"`;
        });
        csv += '\n';

        // Column mapping for legacy DB columns
        const colMap = {
            'q1': 'q1_kecepatan',
            'q2': 'q2_keramahan',
            'q3': 'q3_kejelasan',
            'q4': 'q4_fasilitas',
            'q5': 'q5_kepuasan'
        };

        rows.forEach(row => {
            // Format date in Jakarta timezone
            const dateFormatted = new Date(row.created_at).toLocaleString('id-ID', {
                timeZone: 'Asia/Jakarta',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            csv += `${row.id},"${dateFormatted}"`;

            // Add each question's response with proper label
            questionsList.forEach(q => {
                const colName = colMap[q.question_key];
                const rawVal = row[colName];
                let label = '-';
                if (rawVal === 'sangat_baik') label = q.option_positive;
                else if (rawVal === 'cukup_baik') label = q.option_neutral;
                else if (rawVal === 'kurang_baik') label = q.option_negative;
                csv += `,"${label}"`;
            });

            csv += '\n';
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

app.get('/admin/logs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'logs.html'));
});

app.get('/admin/questions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'questions.html'));
});

// =====================================================
// START SERVER
// =====================================================
async function start() {
    await initDatabase();

    app.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║                                                          ║');
        console.log('║    SURVEY KEPUASAN LAYANAN - BKPM                        ║');
        console.log('║    Bintang Inovasi Teknologi                             ║');
        console.log('║                                                          ║');
        console.log('╚══════════════════════════════════════════════════════════╝');
        console.log('');
        console.log('┌──────────────────────────────────────────────────────────┐');
        console.log('│ Environment                                              │');
        console.log('├──────────────────────────────────────────────────────────┤');
        const nodeEnv = (process.env.NODE_ENV || 'development').substring(0, 20);
        const dbHost = (process.env.DB_HOST || 'localhost').substring(0, 20);
        const tz = (process.env.TZ || 'Asia/Jakarta').substring(0, 20);
        console.log('│ NODE_ENV : ' + nodeEnv.padEnd(46) + '│');
        console.log('│ PORT     : ' + String(PORT).padEnd(46) + '│');
        console.log('│ DB_HOST  : ' + dbHost.padEnd(46) + '│');
        console.log('│ TIMEZONE : ' + tz.padEnd(46) + '│');
        console.log('└──────────────────────────────────────────────────────────┘');
        console.log('');
        console.log('┌──────────────────────────────────────────────────────────┐');
        console.log('│ Routes                                                   │');
        console.log('├──────────────────────────────────────────────────────────┤');
        console.log('│ Kiosk     : http://0.0.0.0:' + String(PORT).padEnd(29) + '│');
        console.log('│ Dashboard : http://0.0.0.0:' + (PORT + '/admin/dashboard').padEnd(29) + '│');
        console.log('│ Reports   : http://0.0.0.0:' + (PORT + '/admin/reports').padEnd(29) + '│');
        console.log('│ Questions : http://0.0.0.0:' + (PORT + '/admin/questions').padEnd(29) + '│');
        console.log('│ Logs      : http://0.0.0.0:' + (PORT + '/admin/logs').padEnd(29) + '│');
        console.log('│ Health    : http://0.0.0.0:' + (PORT + '/health').padEnd(29) + '│');
        console.log('└──────────────────────────────────────────────────────────┘');
        console.log('');
        console.log('┌──────────────────────────────────────────────────────────┐');
        console.log('│ Commands                                                 │');
        console.log('├──────────────────────────────────────────────────────────┤');
        console.log('│ docker compose logs -f survey-app # View logs            │');
        console.log('│ docker compose restart survey-app # Restart app          │');
        console.log('│ ./deploy.sh dev                   # Deploy dev           │');
        console.log('│ ./deploy.sh prod                  # Deploy prod          │');
        console.log('└──────────────────────────────────────────────────────────┘');
        console.log('');
        console.log('Server is ready and listening...');
        console.log('');
    });
}

start();
