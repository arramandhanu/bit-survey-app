-- =====================================================
-- SURVEY APPLICATION DATABASE SCHEMA
-- MySQL 8.0
-- =====================================================

-- Create database (if not using docker-compose initialization)
-- CREATE DATABASE IF NOT EXISTS survey_db;
-- USE survey_db;

-- =====================================================
-- SURVEYS TABLE - Store all survey responses
-- =====================================================
CREATE TABLE IF NOT EXISTS surveys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    q1_kecepatan ENUM('sangat_baik', 'cukup_baik', 'kurang_baik') NULL,
    q2_keramahan ENUM('sangat_baik', 'cukup_baik', 'kurang_baik') NULL,
    q3_kejelasan ENUM('sangat_baik', 'cukup_baik', 'kurang_baik') NULL,
    q4_fasilitas ENUM('sangat_baik', 'cukup_baik', 'kurang_baik') NULL,
    q5_kepuasan ENUM('sangat_baik', 'cukup_baik', 'kurang_baik') NULL,
    user_agent VARCHAR(500) NULL,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for reporting
    INDEX idx_created_at (created_at),
    INDEX idx_q5_kepuasan (q5_kepuasan),
    INDEX idx_month_year (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ADMIN USERS TABLE - For admin dashboard access
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NULL,
    email VARCHAR(100) NULL,
    last_login TIMESTAMP NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_username (username),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- DEFAULT ADMIN USER
-- Note: Admin user is created by the application on startup
-- using the ADMIN_DEFAULT_PASSWORD environment variable
-- =====================================================

-- =====================================================
-- QUESTIONS TABLE - Dynamic survey questions
-- =====================================================
CREATE TABLE IF NOT EXISTS questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_text VARCHAR(500) NOT NULL,
    question_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    is_required BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_order (question_order),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ANSWER OPTIONS TABLE - Options for each question
-- =====================================================
CREATE TABLE IF NOT EXISTS answer_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_id INT NOT NULL,
    option_value VARCHAR(50) NOT NULL,
    option_label VARCHAR(100) NOT NULL,
    option_order INT NOT NULL DEFAULT 0,
    emoji_type ENUM('positive', 'neutral', 'negative') DEFAULT 'neutral',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_question (question_id),
    INDEX idx_order (option_order),
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- SURVEY SUBMISSIONS TABLE - Header for each submission
-- =====================================================
CREATE TABLE IF NOT EXISTS survey_submissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- SURVEY RESPONSES TABLE - Individual answers (EAV pattern)
-- =====================================================
CREATE TABLE IF NOT EXISTS survey_responses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    submission_id INT NOT NULL,
    question_id INT NOT NULL,
    option_id INT NOT NULL,
    
    INDEX idx_submission (submission_id),
    INDEX idx_question (question_id),
    FOREIGN KEY (submission_id) REFERENCES survey_submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    FOREIGN KEY (option_id) REFERENCES answer_options(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- SEED DEFAULT QUESTIONS
-- =====================================================
INSERT INTO questions (id, question_text, question_order, is_active, is_required) VALUES
(1, 'Bagaimana penilaian Anda terhadap KECEPATAN layanan kami?', 1, TRUE, TRUE),
(2, 'Bagaimana penilaian Anda terhadap KERAMAHAN petugas kami?', 2, TRUE, TRUE),
(3, 'Bagaimana penilaian Anda terhadap KEJELASAN informasi yang diberikan?', 3, TRUE, TRUE),
(4, 'Bagaimana penilaian Anda terhadap FASILITAS yang tersedia?', 4, TRUE, TRUE),
(5, 'Secara keseluruhan, bagaimana KEPUASAN Anda terhadap layanan kami?', 5, TRUE, TRUE)
ON DUPLICATE KEY UPDATE question_text = VALUES(question_text);

-- =====================================================
-- SEED DEFAULT ANSWER OPTIONS
-- =====================================================
-- Options for Question 1
INSERT INTO answer_options (question_id, option_value, option_label, option_order, emoji_type) VALUES
(1, 'sangat_baik', 'Sangat Baik', 1, 'positive'),
(1, 'cukup_baik', 'Cukup Baik', 2, 'neutral'),
(1, 'kurang_baik', 'Kurang Baik', 3, 'negative');

-- Options for Question 2
INSERT INTO answer_options (question_id, option_value, option_label, option_order, emoji_type) VALUES
(2, 'sangat_baik', 'Sangat Baik', 1, 'positive'),
(2, 'cukup_baik', 'Cukup Baik', 2, 'neutral'),
(2, 'kurang_baik', 'Kurang Baik', 3, 'negative');

-- Options for Question 3
INSERT INTO answer_options (question_id, option_value, option_label, option_order, emoji_type) VALUES
(3, 'sangat_baik', 'Sangat Baik', 1, 'positive'),
(3, 'cukup_baik', 'Cukup Baik', 2, 'neutral'),
(3, 'kurang_baik', 'Kurang Baik', 3, 'negative');

-- Options for Question 4
INSERT INTO answer_options (question_id, option_value, option_label, option_order, emoji_type) VALUES
(4, 'sangat_baik', 'Sangat Baik', 1, 'positive'),
(4, 'cukup_baik', 'Cukup Baik', 2, 'neutral'),
(4, 'kurang_baik', 'Kurang Baik', 3, 'negative');

-- Options for Question 5
INSERT INTO answer_options (question_id, option_value, option_label, option_order, emoji_type) VALUES
(5, 'sangat_baik', 'Sangat Baik', 1, 'positive'),
(5, 'cukup_baik', 'Cukup Baik', 2, 'neutral'),
(5, 'kurang_baik', 'Kurang Baik', 3, 'negative');

-- =====================================================
-- VIEW: Monthly Statistics (Updated for new schema)
-- =====================================================
CREATE OR REPLACE VIEW v_monthly_stats AS
SELECT 
    YEAR(ss.created_at) as year,
    MONTH(ss.created_at) as month,
    DATE_FORMAT(ss.created_at, '%Y-%m') as period,
    COUNT(DISTINCT ss.id) as total_responses,
    
    -- Count by emoji type for overall satisfaction
    SUM(CASE WHEN ao.emoji_type = 'positive' THEN 1 ELSE 0 END) as positive_count,
    SUM(CASE WHEN ao.emoji_type = 'neutral' THEN 1 ELSE 0 END) as neutral_count,
    SUM(CASE WHEN ao.emoji_type = 'negative' THEN 1 ELSE 0 END) as negative_count
    
FROM survey_submissions ss
LEFT JOIN survey_responses sr ON ss.id = sr.submission_id
LEFT JOIN answer_options ao ON sr.option_id = ao.id
GROUP BY YEAR(ss.created_at), MONTH(ss.created_at), DATE_FORMAT(ss.created_at, '%Y-%m')
ORDER BY year DESC, month DESC;

-- =====================================================
-- VIEW: Daily Statistics (Updated for new schema)
-- =====================================================
CREATE OR REPLACE VIEW v_daily_stats AS
SELECT 
    DATE(ss.created_at) as date,
    COUNT(DISTINCT ss.id) as total_responses,
    SUM(CASE WHEN ao.emoji_type = 'positive' THEN 1 ELSE 0 END) as satisfied,
    SUM(CASE WHEN ao.emoji_type = 'neutral' THEN 1 ELSE 0 END) as neutral,
    SUM(CASE WHEN ao.emoji_type = 'negative' THEN 1 ELSE 0 END) as unsatisfied
FROM survey_submissions ss
LEFT JOIN survey_responses sr ON ss.id = sr.submission_id
LEFT JOIN answer_options ao ON sr.option_id = ao.id
GROUP BY DATE(ss.created_at)
ORDER BY date DESC;

-- =====================================================
-- LEGACY VIEW: Keep old surveys table working
-- =====================================================
CREATE OR REPLACE VIEW v_monthly_stats_legacy AS
SELECT 
    YEAR(created_at) as year,
    MONTH(created_at) as month,
    DATE_FORMAT(created_at, '%Y-%m') as period,
    COUNT(*) as total_responses,
    
    -- Q1: Kecepatan
    SUM(CASE WHEN q1_kecepatan = 'sangat_baik' THEN 1 ELSE 0 END) as q1_sangat_baik,
    SUM(CASE WHEN q1_kecepatan = 'cukup_baik' THEN 1 ELSE 0 END) as q1_cukup_baik,
    SUM(CASE WHEN q1_kecepatan = 'kurang_baik' THEN 1 ELSE 0 END) as q1_kurang_baik,
    
    -- Q2: Keramahan
    SUM(CASE WHEN q2_keramahan = 'sangat_baik' THEN 1 ELSE 0 END) as q2_sangat_baik,
    SUM(CASE WHEN q2_keramahan = 'cukup_baik' THEN 1 ELSE 0 END) as q2_cukup_baik,
    SUM(CASE WHEN q2_keramahan = 'kurang_baik' THEN 1 ELSE 0 END) as q2_kurang_baik,
    
    -- Q3: Kejelasan
    SUM(CASE WHEN q3_kejelasan = 'sangat_baik' THEN 1 ELSE 0 END) as q3_sangat_baik,
    SUM(CASE WHEN q3_kejelasan = 'cukup_baik' THEN 1 ELSE 0 END) as q3_cukup_baik,
    SUM(CASE WHEN q3_kejelasan = 'kurang_baik' THEN 1 ELSE 0 END) as q3_kurang_baik,
    
    -- Q4: Fasilitas
    SUM(CASE WHEN q4_fasilitas = 'sangat_baik' THEN 1 ELSE 0 END) as q4_sangat_baik,
    SUM(CASE WHEN q4_fasilitas = 'cukup_baik' THEN 1 ELSE 0 END) as q4_cukup_baik,
    SUM(CASE WHEN q4_fasilitas = 'kurang_baik' THEN 1 ELSE 0 END) as q4_kurang_baik,
    
    -- Q5: Kepuasan Keseluruhan
    SUM(CASE WHEN q5_kepuasan = 'sangat_baik' THEN 1 ELSE 0 END) as q5_sangat_baik,
    SUM(CASE WHEN q5_kepuasan = 'cukup_baik' THEN 1 ELSE 0 END) as q5_cukup_baik,
    SUM(CASE WHEN q5_kepuasan = 'kurang_baik' THEN 1 ELSE 0 END) as q5_kurang_baik
    
FROM surveys
GROUP BY YEAR(created_at), MONTH(created_at), DATE_FORMAT(created_at, '%Y-%m')
ORDER BY year DESC, month DESC;
