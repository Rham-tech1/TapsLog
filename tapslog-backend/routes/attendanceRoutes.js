const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const { decryptCardUid } = require('../utils/security');
const { generateAndSendAttendanceReport } = require('../utils/emailReport');
const { v4: uuidv4 } = require('uuid');

/**
 * Utility to resolve card_uid against active NFC card records
 */
async function resolveCardUid(cardUid) {
  const cardsRes = await db.query("SELECT * FROM nfc_cards WHERE status = 'ACTIVE'");
  for (const card of cardsRes.rows) {
    try {
      const decrypted = decryptCardUid(card.encrypted_card_uid, card.iv, card.auth_tag);
      if (decrypted.toUpperCase() === cardUid.toUpperCase()) {
        return {
          card_id: card.card_id,
          student_id: card.student_id,
          teacher_id: card.teacher_id
        };
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

// Teacher Schedule Dashboard API
router.get('/teacher/schedule/:teacher_id', async (req, res) => {
  const { teacher_id } = req.params;
  try {
    const result = await db.query(
      `SELECT * FROM attendance_sessions WHERE teacher_id = $1 ORDER BY scheduled_start ASC`,
      [teacher_id]
    );

    const now = new Date();
    let currentClass = null;
    let nextClass = null;

    for (const session of result.rows) {
      const start = new Date(session.scheduled_start || session.start_time);
      const end = new Date(session.scheduled_end || session.end_time);
      const earlyBuffer = new Date(start.getTime() - 15 * 60 * 1000);

      if (now >= earlyBuffer && now <= end && session.status !== 'CLOSED') {
        currentClass = session;
      } else if (now < start && !nextClass) {
        nextClass = session;
      }
    }

    res.json({
      success: true,
      current_class: currentClass,
      next_class: nextClass,
      all_schedules: result.rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Smart Tap Ingestion Engine
router.post('/attendance/scan', async (req, res) => {
  const { session_id, card_uid } = req.body;

  if (!session_id || !card_uid) {
    return res.status(400).json({ error: 'session_id and card_uid are required' });
  }

  try {
    // 1. Fetch Attendance Session
    const sessionRes = await db.query('SELECT * FROM attendance_sessions WHERE session_id = $1', [session_id]);
    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionRes.rows[0];
    const now = new Date();
    const scheduledStart = new Date(session.scheduled_start || session.start_time);
    const scheduledEnd = new Date(session.scheduled_end || session.end_time);

    // 2. Resolve Card Holder
    const resolvedCard = await resolveCardUid(card_uid);
    if (!resolvedCard) {
      return res.status(404).json({ error: 'Unregistered or invalid NFC Card tapped' });
    }

    const cardHolderId = resolvedCard.student_id || resolvedCard.teacher_id;

    // 3. User & Section Lookup
    const userCheck = await db.query(
      `SELECT u.user_id, u.email, u.role, s.first_name, s.last_name, 
              s.section_id, sec.section_name AS section
       FROM users u 
       LEFT JOIN students s ON s.user_id = u.user_id 
       LEFT JOIN sections sec ON s.section_id = sec.section_id 
       WHERE s.student_id = $1 OR u.user_id = $1`,
      [cardHolderId]
    );

    const userData = userCheck.rows[0] || {};
    const isTeacher = userData.role === 'TEACHER' || 
                      userData.role === 'ADMIN' || 
                      userData.role === 'SCANNER' || 
                      session.teacher_id === cardHolderId;

    // ==========================================
    // 1. TEACHER TAP LOGIC
    // ==========================================
    if (isTeacher) {
      const earlyBufferMs = 15 * 60 * 1000;
      const earliestAllowed = new Date(scheduledStart.getTime() - earlyBufferMs);

      if (now < earliestAllowed) {
        const diffMinutes = Math.ceil((scheduledStart.getTime() - now.getTime()) / (1000 * 60));
        return res.status(400).json({
          error: `Class session is too early. Next class "${session.title}" starts in ${diffMinutes} minute(s).`,
        });
      }

      if (now > scheduledEnd && session.status !== 'ACTIVE') {
        const diffMinutes = Math.floor((now.getTime() - scheduledEnd.getTime()) / (1000 * 60));
        return res.status(400).json({
          error: `Class session is too late. Scheduled class time ended ${diffMinutes} minute(s) ago.`,
        });
      }

      // Activate Session
      if (session.status === 'SCHEDULED' || !session.teacher_time_in) {
        await db.query(
          `UPDATE attendance_sessions SET status = 'ACTIVE', teacher_time_in = $1 WHERE session_id = $2`,
          [now, session_id]
        );

        await db.query(
          `INSERT INTO nfc_scan_logs (log_id, session_id, card_id, scan_result, message)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv4(), session_id, resolvedCard.card_id, 'SESSION_ACTIVATED', 'Teacher activated session']
        );

        return res.status(200).json({
          success: true,
          role: 'TEACHER',
          action: 'SESSION_ACTIVATED',
          message: `Class "${session.title}" activated successfully. Ready for student scanning.`,
        });
      }

      // Close Session
      if (session.status === 'ACTIVE') {
        const isEarly = now < scheduledEnd;

        await db.query(
          `UPDATE attendance_sessions SET status = 'CLOSED', teacher_time_out = $1, is_early_dismissal = $2 WHERE session_id = $3`,
          [now, isEarly, session_id]
        );

        // Update active records status to COMPLETED
        await db.query(
          `UPDATE attendance_records SET status = 'COMPLETED' WHERE session_id = $1`,
          [session_id]
        );

        // Auto-mark absent students for this section
        await db.query(
          `INSERT INTO attendance_records (record_id, session_id, student_id, scanned_at, status)
           SELECT $1, $2, s.student_id, $3, 'ABSENT'
           FROM students s
           WHERE (s.section_id = $4 OR s.section = $5) 
             AND s.student_id NOT IN (
               SELECT student_id FROM attendance_records WHERE session_id = $2
             )`,
          [uuidv4(), session_id, now, session.section_id, session.target_section || '3A']
        );

        const reportRecords = await db.query(
          `SELECT s.student_number, s.first_name, s.last_name, s.program, ar.scanned_at, ar.status
           FROM attendance_records ar 
           JOIN students s ON s.student_id = ar.student_id 
           WHERE ar.session_id = $1`,
          [session_id]
        );

        const recipientEmail = userData.email || process.env.EMAIL_USER;
        generateAndSendAttendanceReport(
          { ...session, teacher_time_in: session.teacher_time_in, teacher_time_out: now, is_early_dismissal: isEarly },
          reportRecords.rows,
          recipientEmail
        ).catch(err => console.error('Email Report Error:', err));

        return res.status(200).json({
          success: true,
          role: 'TEACHER',
          action: 'SESSION_CLOSED',
          message: `Session closed. Attendance report generated.`,
        });
      }
    }

    // ==========================================
    // 2. STUDENT TAP LOGIC
    // ==========================================
    if (session.status !== 'ACTIVE') {
      return res.status(400).json({
        error: 'Session is inactive. Teacher has not activated this class or it is suspended.',
      });
    }

    const studentSection = userData.section || userData.section_id;
    const targetSection = session.target_section || session.section_id;

    if (targetSection && studentSection && studentSection !== targetSection) {
      return res.status(403).json({
        error: `Access Denied: ${userData.first_name} ${userData.last_name} (Section ${studentSection}) does not belong to this class section (${targetSection}).`,
      });
    }

    const existingRecord = await db.query(
      'SELECT * FROM attendance_records WHERE session_id = $1 AND student_id = $2',
      [session_id, cardHolderId]
    );

    // Duplicate Tap Prevention / Second Tap Checkout
    if (existingRecord.rows.length > 0) {
      const rec = existingRecord.rows[0];
      if (rec.status === 'COMPLETED') {
        return res.status(409).json({ error: 'Already completed attendance for this class.' });
      }

      await db.query(
        `UPDATE attendance_records SET status = 'COMPLETED' WHERE record_id = $1`,
        [rec.record_id]
      );

      await db.query(
        `INSERT INTO nfc_scan_logs (log_id, session_id, card_id, scan_result, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), session_id, resolvedCard.card_id, 'STUDENT_TIME_OUT', 'Student checked out']
      );

      return res.status(200).json({
        success: true,
        action: 'STUDENT_TIME_OUT',
        student: `${userData.first_name} ${userData.last_name}`,
        status: 'COMPLETED',
      });
    }

    // New Tap In
    const lateThresholdMs = (session.late_threshold_minutes || 15) * 60 * 1000;
    const isLate = now.getTime() > (scheduledStart.getTime() + lateThresholdMs);
    const initialStatus = isLate ? 'LATE' : 'PRESENT';

    const recordId = uuidv4();
    await db.query(
      `INSERT INTO attendance_records (record_id, session_id, student_id, scanned_at, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [recordId, session_id, cardHolderId, now, initialStatus]
    );

    await db.query(
      `INSERT INTO nfc_scan_logs (log_id, session_id, card_id, scan_result, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), session_id, resolvedCard.card_id, 'SUCCESS', 'Student checked in']
    );

    return res.status(201).json({
      success: true,
      action: 'STUDENT_TIME_IN',
      status: initialStatus,
      student: `${userData.first_name} ${userData.last_name}`,
      scanned_at: now,
    });

  } catch (error) {
    console.error('Scan Error:', error);
    return res.status(500).json({ error: 'Server error processing scan' });
  }
});

module.exports = router;