-- copy and paste this into your MySQL client to create the database and tables for the certificate management app
-- start the mysql shell
sudo mysql

-- =============================================
-- CREATE DATABASE
-- =============================================
CREATE DATABASE IF NOT EXISTS certapp;
USE certapp;

-- =============================================
-- USERS TABLE (accounts)
-- Matches server.js /api/auth/login + register
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','manager','user') DEFAULT 'user',
  person_id INT DEFAULT NULL
);

-- =============================================
-- PEOPLE TABLE
-- Linked to training records + 3rd party certs
-- =============================================
CREATE TABLE IF NOT EXISTS people (
  person_id INT AUTO_INCREMENT PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  is_active TINYINT(1) DEFAULT 1
);

-- Link users.person_id → people.person_id
ALTER TABLE users ADD CONSTRAINT fk_users_person
  FOREIGN KEY (person_id) REFERENCES people(person_id)
  ON DELETE SET NULL;

-- =============================================
-- CATEGORIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL
);

-- =============================================
-- PROVIDERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS providers (
  provider_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL
);

-- =============================================
-- COURSES TABLE
-- Matches POST /api/courses
-- =============================================
CREATE TABLE IF NOT EXISTS courses (
  course_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  type VARCHAR(255),
  category_id INT,
  provider_id INT,
  validity_days INT,
  is_active TINYINT(1) DEFAULT 1,
  FOREIGN KEY (category_id) REFERENCES categories(category_id),
  FOREIGN KEY (provider_id) REFERENCES providers(provider_id)
);

-- =============================================
-- TRAINING RECORDS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS training_records (
  training_record_id INT AUTO_INCREMENT PRIMARY KEY,
  person_id INT NOT NULL,
  course_id INT NOT NULL,
  completion_date DATE NOT NULL,
  expiry_date DATE GENERATED ALWAYS AS (
    CASE
      WHEN validity_days IS NULL THEN NULL
      ELSE DATE_ADD(completion_date, INTERVAL validity_days DAY)
    END
  ) VIRTUAL,
  notes TEXT,
  assessor VARCHAR(255),
  status ENUM('current','expired','expiring_soon') NULL,
  FOREIGN KEY (person_id) REFERENCES people(person_id),
  FOREIGN KEY (course_id) REFERENCES courses(course_id)
);

-- =============================================
-- ATTACHMENTS (evidence files)
-- =============================================
CREATE TABLE IF NOT EXISTS attachments (
  attachment_id INT AUTO_INCREMENT PRIMARY KEY,
  training_record_id INT NOT NULL,
  file_name VARCHAR(255),
  file_path VARCHAR(255),
  mime_type VARCHAR(255),
  FOREIGN KEY (training_record_id) REFERENCES training_records(training_record_id)
);

-- =============================================
-- THIRD-PARTY CERTIFICATIONS
-- =============================================
CREATE TABLE IF NOT EXISTS third_party_certifications (
  cert_id INT AUTO_INCREMENT PRIMARY KEY,
  person_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  completion_date DATE NOT NULL,
  expiry_date DATE NULL,
  notes TEXT,
  file_path VARCHAR(255),
  mime_type VARCHAR(255),
  FOREIGN KEY (person_id) REFERENCES people(person_id)
);

-- =============================================
-- CLEAN DEFAULTS
-- =============================================
INSERT IGNORE INTO categories (name) VALUES ('Other'), ('Safety'), ('First Aid'), ('Compliance'), ('Technical');

-- =============================================
-- MYSQL USER (optional but recommended)
-- =============================================
CREATE USER IF NOT EXISTS 'certadmin'@'localhost' IDENTIFIED BY 'password123';
GRANT ALL PRIVILEGES ON certapp.* TO 'certadmin'@'localhost';
FLUSH PRIVILEGES;
