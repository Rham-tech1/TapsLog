const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function generateAndSendAttendanceReport(session, records, recipientEmail) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Attendance Summary');

  worksheet.columns = [
    { header: 'Student ID', key: 'student_number', width: 18 },
    { header: 'Full Name', key: 'full_name', width: 25 },
    { header: 'Program', key: 'program', width: 15 },
    { header: 'Time In', key: 'time_in', width: 22 },
    { header: 'Time Out', key: 'time_out', width: 22 },
    { header: 'Status', key: 'status', width: 15 },
  ];

  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '003366' },
  };

  records.forEach((rec) => {
    worksheet.addRow({
      student_number: rec.student_number,
      full_name: `${rec.last_name}, ${rec.first_name}`,
      program: rec.program,
      time_in: rec.scanned_at ? new Date(rec.scanned_at).toLocaleString('en-PH') : 'N/A',
      time_out: rec.time_out ? new Date(rec.time_out).toLocaleString('en-PH') : 'N/A',
      status: rec.status,
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();

  const mailOptions = {
    from: `"TapsLog System" <${process.env.EMAIL_USER}>`,
    to: recipientEmail,
    subject: `[TapsLog Report] Attendance Summary - ${session.title}`,
    html: `
      <h2>TapsLog Attendance Report</h2>
      <p><strong>Class/Event:</strong> ${session.title}</p>
      <p><strong>Instructor Time-In:</strong> ${session.teacher_time_in ? new Date(session.teacher_time_in).toLocaleString('en-PH') : 'N/A'}</p>
      <p><strong>Instructor Time-Out:</strong> ${session.teacher_time_out ? new Date(session.teacher_time_out).toLocaleString('en-PH') : 'N/A'}</p>
      <p><strong>Early Dismissal:</strong> ${session.is_early_dismissal ? 'Yes' : 'No'}</p>
      <p>Please find attached the complete Excel attendance sheet for this session.</p>
    `,
    attachments: [
      {
        filename: `${session.title.replace(/\s+/g, '_')}_Attendance.xlsx`,
        content: buffer,
      },
    ],
  };

  await transporter.sendMail(mailOptions);
}

module.exports = { generateAndSendAttendanceReport };