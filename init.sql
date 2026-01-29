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
CREATE OR REPLACE VIEW v_monthly_stats AS
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

-- =====================================================
-- VIEW: Daily Statistics
-- =====================================================
CREATE OR REPLACE VIEW v_daily_stats AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_responses,
    SUM(CASE WHEN q5_kepuasan = 'sangat_baik' THEN 1 ELSE 0 END) as satisfied,
    SUM(CASE WHEN q5_kepuasan = 'cukup_baik' THEN 1 ELSE 0 END) as neutral,
    SUM(CASE WHEN q5_kepuasan = 'kurang_baik' THEN 1 ELSE 0 END) as unsatisfied
FROM surveys
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- =====================================================
-- QUESTIONS TABLE - Store customizable survey questions
-- =====================================================
CREATE TABLE IF NOT EXISTS questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_key VARCHAR(20) NOT NULL UNIQUE,
    question_text VARCHAR(500) NOT NULL,
    question_subtitle VARCHAR(200) DEFAULT 'Pilih salah satu penilaian',
    option_positive VARCHAR(50) DEFAULT 'SANGAT BAIK',
    option_neutral VARCHAR(50) DEFAULT 'CUKUP BAIK',
    option_negative VARCHAR(50) DEFAULT 'KURANG BAIK',
    display_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_display_order (display_order),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default questions
INSERT INTO questions (question_key, question_text, option_positive, option_neutral, option_negative, display_order) VALUES
('q1', 'Bagaimana kecepatan pelayanan kami?', 'SANGAT CEPAT', 'CUKUP CEPAT', 'KURANG CEPAT', 1),
('q2', 'Bagaimana keramahan petugas kami?', 'SANGAT RAMAH', 'CUKUP RAMAH', 'KURANG RAMAH', 2),
('q3', 'Bagaimana kejelasan informasi yang diberikan?', 'SANGAT JELAS', 'CUKUP JELAS', 'KURANG JELAS', 3),
('q4', 'Bagaimana kondisi fasilitas kami?', 'SANGAT BAIK', 'CUKUP BAIK', 'KURANG BAIK', 4),
('q5', 'Secara keseluruhan, bagaimana kepuasan Anda?', 'SANGAT PUAS', 'CUKUP PUAS', 'KURANG PUAS', 5)
ON DUPLICATE KEY UPDATE question_text = VALUES(question_text);
