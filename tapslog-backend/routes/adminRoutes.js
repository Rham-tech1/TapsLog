const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');

// Create Room
router.post('/admin/rooms', async (req, res) => {
  const { room_name, building } = req.body;
  try {
    const roomId = crypto.randomUUID();
    const result = await db.query(
      'INSERT INTO rooms (room_id, room_name, building) VALUES ($1, $2, $3) RETURNING *',
      [roomId, room_name, building]
    );
    res.status(201).json({ success: true, room: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Section
router.post('/admin/sections', async (req, res) => {
  const { section_name, program } = req.body;
  try {
    const sectionId = crypto.randomUUID();
    const result = await db.query(
      'INSERT INTO sections (section_id, section_name, program) VALUES ($1, $2, $3) RETURNING *',
      [sectionId, section_name, program]
    );
    res.status(201).json({ success: true, section: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Schedule Session
router.post('/admin/sessions', async (req, res) => {
  const { title, teacher_id, room_id, section_id, scheduled_start, scheduled_end, late_threshold_minutes, target_section } = req.body;
  try {
    const sessionId = crypto.randomUUID();
    const result = await db.query(
      `INSERT INTO attendance_sessions 
       (session_id, title, teacher_id, room_id, section_id, scheduled_start, scheduled_end, start_time, end_time, late_threshold_minutes, target_section, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $7, $8, $9, 'SCHEDULED') RETURNING *`,
      [sessionId, title, teacher_id || null, room_id || null, section_id || null, scheduled_start, scheduled_end, late_threshold_minutes || 15, target_section || '3A']
    );
    res.status(201).json({ success: true, session: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;