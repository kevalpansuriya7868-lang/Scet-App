const path = require('path');
const PDFDocument = require('pdfkit');
const { fmt } = require('./dates');
const { gatePassNo } = require('./issues');

const ASSETS = path.join(__dirname, '../../frontend/assets');
const BLUE = '#1E40AF', GOLD = '#D97706', INK = '#0F172A', MUTED = '#475569', LINE = '#CBD5E1';
const M = 36;

function newDoc(title, badge) {
  const doc = new PDFDocument({ size: 'A4', margin: M });
  const W = doc.page.width;
  try { doc.image(path.join(ASSETS, 'sesuni.png'), M, 28, { width: 54 }); } catch {}
  try { doc.image(path.join(ASSETS, 'logo-footer.png'), W - M - 54, 28, { width: 54 }); } catch {}
  doc.font('Helvetica-Bold').fillColor('#334155').fontSize(10).text('SARVAJANIK UNIVERSITY, SURAT', M + 64, 32, { width: W - 2 * M - 128, align: 'center' });
  doc.fillColor(BLUE).fontSize(12.5).text(title, M + 64, 48, { width: W - 2 * M - 128, align: 'center' });
  doc.fillColor(INK).fontSize(9.5).text(badge, M + 64, 66, { width: W - 2 * M - 128, align: 'center' });
  doc.moveTo(M, 92).lineTo(W - M, 92).lineWidth(1.5).strokeColor(BLUE).stroke();
  doc.x = M; doc.y = 106;
  return doc;
}
const COLLEGE = 'SARVAJANIK COLLEGE OF ENGINEERING & TECHNOLOGY (SCET)';
const heading = (doc, t) => doc.font('Helvetica-Bold').fontSize(10).fillColor('#1E293B').text(t, M, doc.y).moveDown(0.4);

function table(doc, cols, rows, fill = BLUE) {
  let y = doc.y;
  const H = 20;
  const drawRow = (cells, head) => {
    if (y + H > doc.page.height - 50) { doc.addPage(); y = 40; }
    let x = M;
    cells.forEach((c, i) => {
      if (head) doc.rect(x, y, cols[i].w, H).fill(fill);
      doc.rect(x, y, cols[i].w, H).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.fillColor(head ? '#FFFFFF' : INK).font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(String(c ?? '-'), x + 4, y + 6, { width: cols[i].w - 8, height: H - 8, ellipsis: true, align: cols[i].align || 'left' });
      x += cols[i].w;
    });
    y += H;
  };
  drawRow(cols.map((c) => c.h), true);
  rows.forEach((r) => drawRow(r, false));
  doc.x = M; doc.y = y + 10;
}

/** Each builder returns an un-ended doc; caller pipes it (HTTP) or collects a buffer (email). */
function gatePass(i) {
  const returned = i.status === 'RETURNED';
  const doc = newDoc(COLLEGE, returned ? 'DEPARTMENT LABORATORY HARDWARE RETURN RECEIPT' : 'DEPARTMENT LABORATORY HARDWARE ISSUE & GATE PASS');
  doc.font('Helvetica').fontSize(9.5).fillColor(INK)
    .text(`PASS NO: ${gatePassNo(i)}`, M, doc.y, { continued: true }).text(`     PRINT DATE: ${fmt(Date.now())}`).moveDown();
  heading(doc, '1. STUDENT CREDENTIALS');
  doc.font('Helvetica').fontSize(9).fillColor(INK)
    .text(`Student Name: ${i.studentName}        Enrollment No: ${i.enrollmentNo}`)
    .text(`Branch / Department: ${i.studentBranch}        Contact No: ${i.studentMobile}`)
    .text(`Student Email: ${i.studentEmail || 'N/A'}        Lab Department: ${i.branchCode}`).moveDown();
  heading(doc, '2. ISSUANCE & HARDWARE DETAILS');

  // Support multi-item issues (items array) and legacy single-component records
  const items = Array.isArray(i.items) && i.items.length > 0
    ? i.items
    : [{ compId: i.compId, compName: i.compName, qty: i.issueQty }];

  const issuedAt = i.issueDate instanceof Date ? i.issueDate : i.issueDate?.toDate?.() || new Date(i.issueDate);
  const dueAt    = i.dueDate   instanceof Date ? i.dueDate   : i.dueDate?.toDate?.()   || new Date(i.dueDate);

  table(doc, [
    { h: '#', w: 22, align: 'center' }, { h: 'COMPONENT ID', w: 90 }, { h: 'COMPONENT NAME', w: 120 },
    { h: 'QTY', w: 30, align: 'center' }, { h: 'ISSUED AT', w: 100 },
    { h: 'DUE AT', w: 100 }, { h: 'STATUS', w: 57, align: 'center' },
  ], items.map((item, idx) => [
    idx + 1, item.compId, item.compName || '-', item.qty,
    idx === 0 ? fmt(issuedAt) : '', idx === 0 ? fmt(dueAt) : '', idx === 0 ? i.status : '',
  ]));

  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    .text(`Issued by: ${i.issuedBy}`, { align: 'right' }).moveDown(0.3);

  const hasReturned = i.status === 'RETURNED' || i.status === 'PARTIAL_RETURN' || (i.returnedQty && i.returnedQty > 0);
  if (hasReturned) {
    heading(doc, '3. RETURN DETAILS');
    const retDate = i.returnDate instanceof Date ? i.returnDate : i.returnDate?.toDate?.() || (i.returnDate ? new Date(i.returnDate) : new Date());
    const formatPdfCond = (it) => {
      const condMap = it.conditions || (items.length === 1 ? i.conditions : null);
      if (condMap && typeof condMap === 'object') {
        const parts = ['Working', 'Damaged', 'Burnt', 'Lost']
          .filter((c) => (condMap[c] || 0) > 0)
          .map((c) => `${condMap[c]} ${c}`);
        if (parts.length > 0) return parts.join(', ');
      }
      return it.returnCondition || ((it.returnedQty > 0 || items.length === 1) ? (i.returnCondition || 'Working') : 'Pending');
    };

    const retRows = items.map((it, idx) => [
      it.compId,
      it.compName || '-',
      it.returnedQty ?? (items.length === 1 ? i.returnedQty : 0),
      formatPdfCond(it),
      idx === 0 ? fmt(retDate) : '',
      idx === 0 ? Number(i.penaltyFee || 0).toFixed(2) : '',
      idx === 0 ? (i.returnedBy || i.issuedBy) : '',
    ]);
    table(doc, [
      { h: 'ITEM CODE', w: 75 }, { h: 'NAME', w: 95 }, { h: 'RET QTY', w: 45, align: 'center' },
      { h: 'CONDITION', w: 75, align: 'center' }, { h: 'RETURN DATE', w: 90 },
      { h: 'FINE (Rs.)', w: 55, align: 'center' }, { h: 'RECEIVED BY', w: 59 },
    ], retRows, '#059669');
  }
  heading(doc, `${returned ? 4 : 3}. UNDERTAKING & LAB POLICIES`);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    .text('- The student is held strictly accountable for any burnt pins, physical damage, or loss of components.')
    .text('- Overdue returns incur an academic penalty per day after the scheduled return time (see lab fine rate).')
    .text(returned ? '- This digital receipt is proof that the components above were returned to the laboratory.' : '- This digital receipt serves as an authorized laboratory pass.');
  return doc;
}

function inventoryReport(code, rows) {
  const doc = newDoc(COLLEGE, `DEPARTMENT HARDWARE FULL STOCK INVENTORY REPORT (${code})`);
  doc.font('Helvetica').fontSize(9).fillColor('#64748B').text(`Department: ${code}   |   Report Date: ${fmt(Date.now())}`).moveDown(0.6);
  table(doc, [
    { h: 'CODE', w: 86 }, { h: 'NAME', w: 150 }, { h: 'CATEGORY', w: 96 }, { h: 'SPECS', w: 107 },
    { h: 'TOT', w: 34, align: 'center' }, { h: 'ISS', w: 34, align: 'center' }, { h: 'AVL', w: 34, align: 'center' },
  ], rows.map((r) => [r.compId, r.name, r.category, r.specifications || '-', r.totalQty, r.issuedQty, r.availableQty]));
  return doc;
}

function procurementSlip(code, threshold, rows) {
  const doc = newDoc(COLLEGE, `DEPARTMENT HARDWARE REORDER & PROCUREMENT REQUEST (${code})`);
  doc.font('Helvetica').fontSize(9).fillColor('#64748B').text(`Criterion: Stock <= ${threshold} units   |   Generated: ${fmt(Date.now())}`).moveDown(0.6);
  table(doc, [
    { h: 'ITEM CODE', w: 100 }, { h: 'COMPONENT NAME', w: 200 }, { h: 'CATEGORY', w: 129 },
    { h: 'AVAIL', w: 56, align: 'center' }, { h: 'TOTAL', w: 56, align: 'center' },
  ], rows.map((r) => [r.compId, r.name, r.category, r.availableQty, r.totalQty]), GOLD);
  return doc;
}

function noDues(code, enroll, name, studentBranch) {
  const doc = newDoc(COLLEGE, `DEPARTMENT OF ${code} - LABORATORY NO DUES CERTIFICATE`);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK)
    .text(`Certificate ID: SCET/ND/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/${enroll}`)
    .text(`Issue Date: ${fmt(Date.now())}`)
    .text(`Student Name: ${name}        Enrollment No: ${enroll}`)
    .text(`Academic Branch: ${studentBranch}        Status: VERIFIED & APPROVED`).moveDown(1.5);
  doc.fontSize(10).text(
    `This is to certify that ${name} (Enrollment No: ${enroll}) has returned all borrowed laboratory hardware components, apparatus, and testing kits. There are NO OUTSTANDING DUES recorded in any laboratories under the Department of ${code}.`,
    { lineGap: 4 });
  return doc;
}

function outstandingReport(code, rows) {
  const doc = newDoc(COLLEGE, `CURRENTLY ISSUED & UNRETURNED HARDWARE REPORT (${code})`);
  doc.font('Helvetica').fontSize(9).fillColor('#64748B').text(`Department: ${code}   |   Outstanding Borrowings: ${rows.length}   |   Generated: ${fmt(Date.now())}`).moveDown(0.6);

  const tableRows = rows.map((r) => {
    const items = Array.isArray(r.items) && r.items.length > 0
      ? r.items
      : [{ compId: r.compId, compName: r.compName, qty: r.issueQty, remainingQty: r.remainingQty ?? r.issueQty }];

    const itemsStr = items.map((it) => `${it.compName || it.compId} (${it.remainingQty ?? it.qty} left)`).join(', ');
    const totalRemaining = items.reduce((acc, it) => acc + (it.remainingQty ?? it.qty ?? 0), 0);
    const statusText = r.overdue ? `OVERDUE (+${r.daysLate || 1}d)` : r.status === 'PARTIAL_RETURN' ? 'PARTIAL' : 'ACTIVE';
    const studentStr = `${r.studentName || '-'}\n${r.enrollmentNo || '-'}`;

    return [
      r.gatePassNo || `Issue #${r.seq}`,
      studentStr,
      itemsStr,
      totalRemaining,
      fmt(r.dueDate),
      statusText,
    ];
  });

  table(doc, [
    { h: 'GATE PASS', w: 85 },
    { h: 'STUDENT (NAME / ENROLL)', w: 125 },
    { h: 'UNRETURNED COMPONENTS', w: 155 },
    { h: 'REM', w: 32, align: 'center' },
    { h: 'DUE DATE', w: 75 },
    { h: 'STATUS', w: 56, align: 'center' },
  ], tableRows, BLUE);

  return doc;
}

const toBuffer = (doc) => new Promise((res, rej) => {
  const chunks = [];
  doc.on('data', (c) => chunks.push(c)).on('end', () => res(Buffer.concat(chunks))).on('error', rej);
  doc.end();
});
function send(res, doc, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  doc.end();
}
module.exports = { gatePass, inventoryReport, procurementSlip, outstandingReport, noDues, toBuffer, send };
