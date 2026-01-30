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

// Submit survey (from kiosk) - Uses new dynamic schema
app.post('/api/survey', async (req, res) => {
    const { questions, answers } = req.body;

    // Support both old format (questions) and new format (answers)
    const surveyAnswers = answers || questions;

    if (!surveyAnswers || typeof surveyAnswers !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'Invalid survey data'
        });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection?.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';

        // 1. Create submission header
        const [submissionResult] = await connection.query(
            'INSERT INTO survey_submissions (ip_address, user_agent) VALUES (?, ?)',
            [ipAddress, userAgent]
        );
        const submissionId = submissionResult.insertId;

        // 2. Insert individual responses
        // New format: { questionId: optionId } or { questionId: optionValue }
        for (const [key, value] of Object.entries(surveyAnswers)) {
            // Extract question ID (handle both "q1" and "1" formats)
            const questionId = parseInt(key.replace('q', ''));

            if (isNaN(questionId)) continue;

            // Value can be option_id (number) or option_value (string)
            let optionId;
            if (typeof value === 'number') {
                optionId = value;
            } else {
                // Look up option_id by option_value
                const [optionRows] = await connection.query(
                    'SELECT id FROM answer_options WHERE question_id = ? AND option_value = ?',
                    [questionId, value]
                );
                if (optionRows.length > 0) {
                    optionId = optionRows[0].id;
                }
            }

            if (optionId) {
                await connection.query(
                    'INSERT INTO survey_responses (submission_id, question_id, option_id) VALUES (?, ?, ?)',
                    [submissionId, questionId, optionId]
                );
            }
        }

        // 3. Also insert into legacy surveys table for backward compatibility
        await connection.query(
            `INSERT INTO surveys (q1_kecepatan, q2_keramahan, q3_kejelasan, q4_fasilitas, q5_kepuasan, user_agent, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                surveyAnswers.q1 || surveyAnswers['1'] || null,
                surveyAnswers.q2 || surveyAnswers['2'] || null,
                surveyAnswers.q3 || surveyAnswers['3'] || null,
                surveyAnswers.q4 || surveyAnswers['4'] || null,
                surveyAnswers.q5 || surveyAnswers['5'] || null,
                userAgent,
                ipAddress
            ]
        );

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Terima kasih atas penilaian Anda!',
            submissionId: submissionId
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error saving survey:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save survey'
        });
    } finally {
        connection.release();
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
// PUBLIC API: Get all active questions with options
// =====================================================
app.get('/api/questions', async (req, res) => {
    try {
        // Get active questions ordered by question_order
        const [questions] = await pool.query(`
            SELECT id, question_text, question_order, is_required
            FROM questions 
            WHERE is_active = TRUE 
            ORDER BY question_order ASC
        `);

        // Get all options for active questions
        const [options] = await pool.query(`
            SELECT ao.id, ao.question_id, ao.option_value, ao.option_label, ao.option_order, ao.emoji_type
            FROM answer_options ao
            INNER JOIN questions q ON ao.question_id = q.id
            WHERE q.is_active = TRUE
            ORDER BY ao.question_id, ao.option_order ASC
        `);

        // Group options by question_id
        const optionsByQuestion = {};
        options.forEach(opt => {
            if (!optionsByQuestion[opt.question_id]) {
                optionsByQuestion[opt.question_id] = [];
            }
            optionsByQuestion[opt.question_id].push({
                id: opt.id,
                value: opt.option_value,
                label: opt.option_label,
                order: opt.option_order,
                emojiType: opt.emoji_type
            });
        });

        // Combine questions with their options
        const result = questions.map(q => ({
            id: q.id,
            text: q.question_text,
            order: q.question_order,
            required: q.is_required,
            options: optionsByQuestion[q.id] || []
        }));

        res.json({
            success: true,
            questions: result,
            totalQuestions: result.length
        });
    } catch (error) {
        console.error('Error getting questions:', error);
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

// =====================================================
// ADMIN: Question Management (CRUD)
// =====================================================

// Get all questions (admin)
app.get('/admin/api/questions', authMiddleware, async (req, res) => {
    try {
        const [questions] = await pool.query(`
            SELECT id, question_text, question_order, is_active, is_required, created_at, updated_at
            FROM questions 
            ORDER BY question_order ASC
        `);

        const [options] = await pool.query(`
            SELECT id, question_id, option_value, option_label, option_order, emoji_type
            FROM answer_options
            ORDER BY question_id, option_order ASC
        `);

        // Group options by question
        const optionsByQuestion = {};
        options.forEach(opt => {
            if (!optionsByQuestion[opt.question_id]) {
                optionsByQuestion[opt.question_id] = [];
            }
            optionsByQuestion[opt.question_id].push(opt);
        });

        const result = questions.map(q => ({
            ...q,
            options: optionsByQuestion[q.id] || []
        }));

        res.json({ success: true, questions: result });
    } catch (error) {
        console.error('Error getting questions:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Create question
app.post('/admin/api/questions', authMiddleware, async (req, res) => {
    const { question_text, is_active = true, is_required = true, options = [] } = req.body;

    if (!question_text) {
        return res.status(400).json({ success: false, error: 'Question text is required' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Get next order number
        const [maxOrder] = await connection.query('SELECT MAX(question_order) as max_order FROM questions');
        const nextOrder = (maxOrder[0].max_order || 0) + 1;

        // Insert question
        const [result] = await connection.query(
            'INSERT INTO questions (question_text, question_order, is_active, is_required) VALUES (?, ?, ?, ?)',
            [question_text, nextOrder, is_active, is_required]
        );
        const questionId = result.insertId;

        // Insert options if provided
        if (options.length > 0) {
            for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                await connection.query(
                    'INSERT INTO answer_options (question_id, option_value, option_label, option_order, emoji_type) VALUES (?, ?, ?, ?, ?)',
                    [questionId, opt.option_value, opt.option_label, i + 1, opt.emoji_type || 'neutral']
                );
            }
        } else {
            // Add default options
            await connection.query(
                'INSERT INTO answer_options (question_id, option_value, option_label, option_order, emoji_type) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
                [
                    questionId, 'sangat_baik', 'Sangat Baik', 1, 'positive',
                    questionId, 'cukup_baik', 'Cukup Baik', 2, 'neutral',
                    questionId, 'kurang_baik', 'Kurang Baik', 3, 'negative'
                ]
            );
        }

        await connection.commit();
        res.status(201).json({ success: true, questionId, message: 'Question created' });
    } catch (error) {
        await connection.rollback();
        console.error('Error creating question:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    } finally {
        connection.release();
    }
});

// Update question
app.put('/admin/api/questions/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { question_text, is_active, is_required } = req.body;

    try {
        const updates = [];
        const values = [];

        if (question_text !== undefined) {
            updates.push('question_text = ?');
            values.push(question_text);
        }
        if (is_active !== undefined) {
            updates.push('is_active = ?');
            values.push(is_active);
        }
        if (is_required !== undefined) {
            updates.push('is_required = ?');
            values.push(is_required);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No updates provided' });
        }

        values.push(id);
        await pool.query(`UPDATE questions SET ${updates.join(', ')} WHERE id = ?`, values);

        res.json({ success: true, message: 'Question updated' });
    } catch (error) {
        console.error('Error updating question:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Delete question
app.delete('/admin/api/questions/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        // Check if question has responses
        const [responses] = await pool.query(
            'SELECT COUNT(*) as count FROM survey_responses WHERE question_id = ?',
            [id]
        );

        if (responses[0].count > 0) {
            // Soft delete - just deactivate
            await pool.query('UPDATE questions SET is_active = FALSE WHERE id = ?', [id]);
            res.json({ success: true, message: 'Question deactivated (has responses)' });
        } else {
            // Hard delete - no responses
            await pool.query('DELETE FROM questions WHERE id = ?', [id]);
            res.json({ success: true, message: 'Question deleted' });
        }
    } catch (error) {
        console.error('Error deleting question:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Reorder questions
app.put('/admin/api/questions/reorder', authMiddleware, async (req, res) => {
    const { order } = req.body; // Array of { id, order }

    if (!order || !Array.isArray(order)) {
        return res.status(400).json({ success: false, error: 'Invalid order data' });
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

// =====================================================
// ADMIN: Answer Option Management
// =====================================================

// Add option to question
app.post('/admin/api/questions/:questionId/options', authMiddleware, async (req, res) => {
    const { questionId } = req.params;
    const { option_value, option_label, emoji_type = 'neutral' } = req.body;

    if (!option_value || !option_label) {
        return res.status(400).json({ success: false, error: 'Option value and label required' });
    }

    try {
        // Get next order
        const [maxOrder] = await pool.query(
            'SELECT MAX(option_order) as max_order FROM answer_options WHERE question_id = ?',
            [questionId]
        );
        const nextOrder = (maxOrder[0].max_order || 0) + 1;

        const [result] = await pool.query(
            'INSERT INTO answer_options (question_id, option_value, option_label, option_order, emoji_type) VALUES (?, ?, ?, ?, ?)',
            [questionId, option_value, option_label, nextOrder, emoji_type]
        );

        res.status(201).json({ success: true, optionId: result.insertId, message: 'Option added' });
    } catch (error) {
        console.error('Error adding option:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Update option
app.put('/admin/api/options/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { option_value, option_label, emoji_type } = req.body;

    try {
        const updates = [];
        const values = [];

        if (option_value !== undefined) {
            updates.push('option_value = ?');
            values.push(option_value);
        }
        if (option_label !== undefined) {
            updates.push('option_label = ?');
            values.push(option_label);
        }
        if (emoji_type !== undefined) {
            updates.push('emoji_type = ?');
            values.push(emoji_type);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No updates provided' });
        }

        values.push(id);
        await pool.query(`UPDATE answer_options SET ${updates.join(', ')} WHERE id = ?`, values);

        res.json({ success: true, message: 'Option updated' });
    } catch (error) {
        console.error('Error updating option:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Delete option
app.delete('/admin/api/options/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        // Check if option has responses
        const [responses] = await pool.query(
            'SELECT COUNT(*) as count FROM survey_responses WHERE option_id = ?',
            [id]
        );

        if (responses[0].count > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete option with existing responses'
            });
        }

        await pool.query('DELETE FROM answer_options WHERE id = ?', [id]);
        res.json({ success: true, message: 'Option deleted' });
    } catch (error) {
        console.error('Error deleting option:', error);
        res.status(500).json({ success: false, error: 'Database error' });
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

        // Satisfaction breakdown
        const [satisfactionResult] = await pool.query(`
            SELECT 
                SUM(CASE WHEN q5_kepuasan = 'sangat_baik' THEN 1 ELSE 0 END) as sangat_baik,
                SUM(CASE WHEN q5_kepuasan = 'cukup_baik' THEN 1 ELSE 0 END) as cukup_baik,
                SUM(CASE WHEN q5_kepuasan = 'kurang_baik' THEN 1 ELSE 0 END) as kurang_baik
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

        res.json({
            success: true,
            data: {
                total: totalResult[0].total,
                today: todayResult[0].today,
                thisMonth: monthResult[0].month,
                satisfaction: satisfactionResult[0],
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

app.get('/admin/questions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'questions.html'));
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
