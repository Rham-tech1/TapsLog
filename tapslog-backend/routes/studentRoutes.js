const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const { encryptCardUid } = require('../utils/security');

// 1. Create a Student Profile
router.post('/students', async (req, res) => {
  const { student_number, first_name, last_name, program, year_level, email, password } = req.body;

  try {
    const userId = crypto.randomUUID();
    const studentId = crypto.randomUUID();

    // Create User account record
    await db.query(
      `INSERT INTO users (user_id, email, password_hash, role) VALUES ($1, $2, $3, 'STUDENT')`,
      [userId, email, password || 'hashed_default_password']
    );

    // Create linked Student profile
    const studentResult = await db.query(
      `INSERT INTO students (student_id, user_id, student_number, first_name, last_name, program, year_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [studentId, userId, student_number, first_name, last_name, program, year_level]
    );

    res.status(201).json({
      success: true,
      message: 'Student created successfully',
      student: studentResult.rows[0],
    });
  } catch (error) {
    console.error('Create Student Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Tap-to-Enroll: Register an NFC Card UID for a Student
router.post('/cards/register', async (req, res) => {
  const { student_id, card_uid } = req.body;

  if (!student_id || !card_uid) {
    return res.status(400).json({ error: 'student_id and card_uid are required' });
  }

  try {
    // Encrypt Card UID using AES-256-GCM
    const encryptedPayload = encryptCardUid(card_uid);
    const cardId = crypto.randomUUID();

    await db.query(
      `INSERT INTO nfc_cards (card_id, student_id, encrypted_card_uid, iv, auth_tag, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
      [cardId, student_id, encryptedPayload.encryptedData, encryptedPayload.iv, encryptedPayload.authTag]
    );

    res.status(201).json({
      success: true,
      message: 'NFC Card registered and encrypted successfully',
      card_id: cardId,
      student_id: student_id,
    });
  } catch (error) {
    console.error('Card Registration Error:', error);
    res.status(500).json({ error: 'Failed to register card or student already has an assigned card.' });
  }
});

module.exports = router;