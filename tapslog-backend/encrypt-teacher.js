const { encryptCardUid } = require('./utils/security');
const db = require('./config/db');

async function fixTeacherCard() {
  try {
    const res = encryptCardUid('TEACHER_CARD_01');
    
    // Explicitly grab encryptedData from the returned object
    const cipherText = res.encryptedData;
    const iv = res.iv;
    const authTag = res.authTag;

    await db.query(
      `UPDATE nfc_cards 
       SET encrypted_card_uid = $1, iv = $2, auth_tag = $3 
       WHERE card_id = $4`,
      [cipherText, iv, authTag, 'card-teacher-01']
    );

    console.log('SUCCESS: Teacher card encrypted and saved to database!');
    process.exit(0);
  } catch (err) {
    console.error('ERROR updating card:', err);
    process.exit(1);
  }
}

fixTeacherCard();