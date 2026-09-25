// ================================================================
// CONFIGURATION
// ================================================================

// 🔥 Replace with your actual Brevo API key (keep it secret in production)
const BREVO_API_KEY = ""; // Removed: this key was public. Email is sent only by the Worker now.
const SENDER_EMAIL = "profjero947@gmail.com"; // Verified sender in Brevo

// Paystack Public Key (test)
const PAYSTACK_PUBLIC_KEY = ""; // Removed (archived site).

// Cloudflare Worker URL
const WORKER_URL = "https://memories-paystack-verify.diamondj04102026.workers.dev";

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyCkhFjqfTqCIg9ic5Qh63XfWVT4tGWuzpM",
  authDomain: "memoriesnightclub-2717f.firebaseapp.com",
  projectId: "memoriesnightclub-2717f",
  storageBucket: "memoriesnightclub-2717f.firebasestorage.app",
  messagingSenderId: "143491627943",
  appId: "1:143491627943:web:7cb70bfabdefda7e8a5482",
  measurementId: "G-9RQQCZ7EVD"
};

// ================================================================
// GLOBALS (declared here, will be initialized inside DOMContentLoaded)
// ================================================================
let db;
let cal;
let selectedDate = null;
let selectedDateObj = null;
let dateUnsubscribe = null;
let currentStep = 1;
const TOTAL_STEPS = 5;
const STEP_LABELS = ["Details", "Concept", "Talent", "Numbers", "Payment"];

// ================================================================
// WAIT FOR DOM READY
// ================================================================
document.addEventListener('DOMContentLoaded', function() {

  // ===== FIREBASE INIT =====
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    db.enablePersistence().catch(err => console.warn('Firestore persistence:', err));
    console.log('✅ Firebase initialized');
  } catch (e) {
    console.warn('⚠️ Firebase not available. Bookings will work in demo mode.');
  }

  // ===== CALENDAR ELEMENT =====
  cal = document.getElementById("calendar");
  if (!cal) {
    console.error('❌ Calendar element not found! Check ID "calendar" in HTML.');
    return;
  }

  // ================================================================
  // CALENDAR & BOOKING LOGIC (unchanged)
  // ================================================================
  const monthMap = { "Jan":0, "Feb":1, "Mar":2, "Apr":3, "May":4, "Jun":5,
                     "Jul":6, "Aug":7, "Sep":8, "Oct":9, "Nov":10, "Dec":11 };

  function getToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function isPastDate(day, month) {
    const today = getToday();
    const dateObj = new Date(2026, monthMap[month], day);
    return dateObj < today;
  }

  function isFutureDate(day, month) {
    return !isPastDate(day, month);
  }

  function getFutureDates(data) {
    return data.filter(item => isFutureDate(item.n, item.m));
  }

  const dateData = [
    {d:"Fri", n:4, m:"Sep", status:"booked", note:"72 Hours"},
    {d:"Sat", n:5, m:"Sep", status:"booked", note:"72 Hours"},
    {d:"Fri", n:11, m:"Sep", status:"available"},
    {d:"Sat", n:12, m:"Sep", status:"available"},
    {d:"Fri", n:18, m:"Sep", status:"available"},
    {d:"Sat", n:19, m:"Sep", status:"available"},
    {d:"Fri", n:25, m:"Sep", status:"available"},
    {d:"Sat", n:26, m:"Sep", status:"available"},
    {d:"Fri", n:2, m:"Oct", status:"available"},
    {d:"Sat", n:3, m:"Oct", status:"available"},
    {d:"Fri", n:9, m:"Oct", status:"available"},
    {d:"Sat", n:10, m:"Oct", status:"available"},
    {d:"Fri", n:16, m:"Oct", status:"available"},
    {d:"Sat", n:17, m:"Oct", status:"available"},
    {d:"Fri", n:23, m:"Oct", status:"available"},
    {d:"Sat", n:24, m:"Oct", status:"available"},
    {d:"Fri", n:30, m:"Oct", status:"available"},
    {d:"Sat", n:31, m:"Oct", status:"available"},
    {d:"Fri", n:6, m:"Nov", status:"available"},
    {d:"Sat", n:7, m:"Nov", status:"available"},
    {d:"Fri", n:13, m:"Nov", status:"available"},
    {d:"Sat", n:14, m:"Nov", status:"available"},
    {d:"Fri", n:20, m:"Nov", status:"available"},
    {d:"Sat", n:21, m:"Nov", status:"available"},
    {d:"Fri", n:27, m:"Nov", status:"available"},
    {d:"Sat", n:28, m:"Nov", status:"available"},
    {d:"Fri", n:4, m:"Dec", status:"available"},
    {d:"Sat", n:5, m:"Dec", status:"available"},
    {d:"Fri", n:11, m:"Dec", status:"available"},
    {d:"Sat", n:12, m:"Dec", status:"available"},
    {d:"Fri", n:18, m:"Dec", status:"available"},
    {d:"Sat", n:19, m:"Dec", status:"available"},
    {d:"Fri", n:25, m:"Dec", status:"pending", note:"Holiday — TBC"},
    {d:"Sat", n:26, m:"Dec", status:"pending", note:"Holiday — TBC"},
  ];

  const monthNames = {Sep:"September 2026", Oct:"October 2026", Nov:"November 2026", Dec:"December 2026"};

  function mergeDateStatuses(firestoreDocs) {
    firestoreDocs.forEach(doc => {
      const data = doc.data();
      const idx = dateData.findIndex(d => 
        d.d === data.day && d.n === data.date && d.m === data.month
      );
      if (idx !== -1) {
        dateData[idx].status = data.status || 'available';
        dateData[idx].note = data.note || '';
      }
    });
  }

  function renderCalendar() {
    if (!cal) {
      console.error('Calendar element is null.');
      return;
    }
    const futureDates = getFutureDates(dateData);
    cal.innerHTML = '';
    if (futureDates.length === 0) {
      const msg = document.createElement("p");
      msg.style.color = "var(--text-mute)";
      msg.style.textAlign = "center";
      msg.style.padding = "2rem";
      msg.textContent = "No upcoming dates available for booking.";
      cal.appendChild(msg);
      return;
    }
    const grouped = {};
    futureDates.forEach(item => {
      if (!grouped[item.m]) grouped[item.m] = [];
      grouped[item.m].push(item);
    });
    Object.keys(grouped).forEach(m => {
      const block = document.createElement("div");
      block.className = "month-block";
      const label = document.createElement("div");
      label.className = "month-label";
      label.textContent = monthNames[m] || m + " 2026";
      block.appendChild(label);
      const grid = document.createElement("div");
      grid.className = "date-grid";
      grouped[m].forEach(x => {
        const card = document.createElement("div");
        card.className = "datecard " + x.status;
        const statusLabel = x.status === "available" ? "Available" : (x.status === "booked" ? "Booked" : "Pending");
        const tapLine = x.status === "available" || x.status === "pending" ? `<div class="tapme">Tap to book →</div>` : 
                        (x.note ? `<div class="tapme">${x.note}</div>` : `<div class="tapme">Not available</div>`);
        card.innerHTML = `
          <div class="datebox"><div class="dow">${x.d}</div><div class="dnum">${x.n}</div><div class="mon">${x.m}</div></div>
          <div class="info">
            <div class="statusline"><span class="dot"></span>${statusLabel}</div>
            ${tapLine}
          </div>`;
        if (x.status === "available" || x.status === "pending") {
          card.addEventListener("click", () => openSheet(x.d + " " + x.n + " " + x.m, x));
        } else {
          card.style.cursor = "not-allowed";
        }
        grid.appendChild(card);
      });
      block.appendChild(grid);
      cal.appendChild(block);
    });
  }

  function listenToDates() {
    if (!db) {
      console.warn('⚠️ Firebase not available, using static dates.');
      renderCalendar();
      return;
    }
    if (dateUnsubscribe) {
      dateUnsubscribe();
      dateUnsubscribe = null;
    }
    dateUnsubscribe = db.collection('eventDates')
    .onSnapshot((snapshot) => {
      if (!snapshot.empty) {
        mergeDateStatuses(snapshot.docs);
        console.log('✅ Calendar updated from Firestore');
      } else {
        console.log('📝 No dates in Firestore, using local static data.');
      }
      renderCalendar();
    }, (error) => {
      console.warn('⚠️ Real-time listener error:', error);
      renderCalendar();
    });
  }

  // ===== Sheet Logic =====
  const progressEl = document.getElementById("progress");

  function renderProgress() {
    if (!progressEl) return;
    progressEl.innerHTML = "";
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const stepWrap = document.createElement("div");
      stepWrap.className = "progress-step" + (i < currentStep ? " done" : "") + (i === currentStep ? " active" : "");
      const dotwrap = document.createElement("div");
      dotwrap.className = "progress-dotwrap";
      const dot = document.createElement("div");
      dot.className = "progress-dot";
      dot.textContent = i < currentStep ? "✓" : i;
      const label = document.createElement("div");
      label.className = "progress-label";
      label.textContent = STEP_LABELS[i - 1];
      dotwrap.appendChild(dot);
      dotwrap.appendChild(label);
      stepWrap.appendChild(dotwrap);
      if (i < TOTAL_STEPS) {
        const line = document.createElement("div");
        line.className = "progress-line";
        stepWrap.appendChild(line);
      }
      progressEl.appendChild(stepWrap);
    }
  }

  function showStep(n) {
    document.querySelectorAll(".step-panel").forEach(p => p.classList.toggle("active", Number(p.dataset.step) === n));
    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.dataset.hidden = n === 1 ? "true" : "false";
    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) {
      nextBtn.textContent = n === TOTAL_STEPS ? "Pay & Submit" : "Continue";
    }
    renderProgress();
    const sheetBody = document.querySelector(".sheet-body");
    if (sheetBody) sheetBody.scrollTop = 0;
  }

  function nextStep() {
    if (currentStep < TOTAL_STEPS) {
      currentStep++;
      showStep(currentStep);
      if (currentStep === TOTAL_STEPS) {
        const summaryDate = document.getElementById("summary-date");
        const summaryOrganiser = document.getElementById("summary-organiser");
        const summaryTables = document.getElementById("summary-tables");
        const summaryGate = document.getElementById("summary-gate");
        if (summaryDate) summaryDate.textContent = selectedDate;
        if (summaryOrganiser) summaryOrganiser.textContent = document.getElementById("org-name")?.value || '—';
        if (summaryTables) summaryTables.textContent = counts.tables;
        if (summaryGate) summaryGate.textContent = counts.gate;
        const nextBtn = document.getElementById("nextBtn");
        if (nextBtn) nextBtn.textContent = "Pay & Submit";
      } else {
        const nextBtn = document.getElementById("nextBtn");
        if (nextBtn) nextBtn.textContent = "Continue";
      }
    } else {
      payAndSubmit();
    }
  }

  function prevStep() {
    if (currentStep > 1) {
      currentStep--;
      showStep(currentStep);
    }
  }

  const overlay = document.getElementById("overlay");
  const sheet = document.getElementById("sheet");

  function openSheet(key, x) {
    selectedDate = key;
    selectedDateObj = x;
    const sheetDate = document.getElementById("sheet-date");
    if (sheetDate) sheetDate.textContent = `${x.d} ${x.n} ${x.m} 2026`;
    currentStep = 1;
    showStep(1);
    if (overlay) overlay.classList.add("show");
    if (sheet) sheet.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeSheet() {
    if (overlay) overlay.classList.remove("show");
    if (sheet) sheet.classList.remove("show");
    document.body.style.overflow = "";
  }

  function setDJ(yes) {
    const djYes = document.getElementById("dj-yes");
    const djNo = document.getElementById("dj-no");
    const djDetails = document.getElementById("dj-details");
    if (djYes) djYes.classList.toggle("active", yes);
    if (djNo) djNo.classList.toggle("active", !yes);
    if (djDetails) djDetails.classList.toggle("show", yes);
  }

  let counts = {tables:0, gate:0};

  function changeVal(key, delta) {
    counts[key] = Math.max(0, counts[key] + delta);
    const el = document.getElementById(key);
    if (el) el.textContent = counts[key];
    recalc();
  }

  function recalc() {
    const gateTotal = counts.gate * 50;
    const gateClub = gateTotal * 0.30;
    const gateOrg = gateTotal * 0.70;
    const tableTotal = counts.tables * 3000;
    const tableClub = tableTotal * 0.90;
    const tableOrg = tableTotal * 0.10;
    const orgTotal = gateOrg + tableOrg;

    const fmt = n => "GHS " + n.toLocaleString(undefined, {maximumFractionDigits:0});
    const ids = ['s-gate-total','s-gate-club','s-gate-org','s-table-total','s-table-club','s-table-org','s-org-total'];
    const values = [gateTotal, gateClub, gateOrg, tableTotal, tableClub, tableOrg, orgTotal];
    ids.forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt(values[i]);
    });
  }

  // ================================================================
  // PDF GENERATION (unchanged)
  // ================================================================
  function generateBookingPDF(bookingData) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'pt', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    let y = 40;

    const writeText = (text, fontSize = 14, style = 'normal', align = 'left') => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', style);
      doc.text(String(text), margin, y, { align: align });
      y += fontSize * 1.6;
    };
    const writeHeader = (text, fontSize = 18) => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor('#c8174e');
      doc.text(String(text), margin, y, { align: 'left' });
      y += fontSize * 1.8;
      doc.setDrawColor('#c8174e');
      doc.line(margin, y - 6, pageWidth - margin, y - 6);
      y += 10;
      doc.setTextColor('#000000');
      doc.setFont('helvetica', 'normal');
    };
    const writeRow = (label, value) => {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(String(label), margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(value), pageWidth - margin, y, { align: 'right' });
      y += 18;
    };

    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor('#c8174e');
    doc.text('MEMORIES', margin, y, { align: 'left' });
    y += 20;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor('#666');
    doc.text('Some Nights Are Forever', margin, y);
    y += 30;
    doc.setTextColor('#000000');
    doc.setFont('helvetica', 'normal');

    writeText(`Hi ${bookingData.contactPerson}, we've got your proposal.`, 14, 'bold');
    writeText(`Thanks for submitting an event to Memories. Below is a summary of everything you sent us for ${bookingData.date || 'TBC'}.`, 12);
    y += 10;

    writeHeader('Booking Reference', 16);
    writeText(bookingData.id || 'N/A', 16, 'bold');
    y += 10;

    writeHeader('Proposed Date', 16);
    writeText(bookingData.date || 'TBC', 14, 'bold');
    y += 10;

    writeHeader('What You Submitted', 16);
    const fields = [
      ['Organiser', bookingData.organiser],
      ['Contact', `${bookingData.contactPerson} · ${bookingData.email} · ${bookingData.phone}`],
      ['Event Concept', bookingData.concept || 'Not specified'],
      ['External DJs / MCs', `${bookingData.hasDJ ? 'Yes' : 'No'} — ${bookingData.djDetails || 'None'}`],
      ['Special Requests', bookingData.specialRequests || 'None'],
      ['Tables Requested', String(bookingData.tables || 0)],
      ['Estimated Gate Attendance', String(bookingData.gateAttendance || 0)]
    ];
    fields.forEach(([label, value]) => writeRow(label, value));
    y += 10;

    const fmt = (num) => 'GHS ' + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const gateTotal = bookingData.gateAttendance * 50;
    const gateClub = gateTotal * 0.30;
    const gateOrg = gateTotal * 0.70;
    const tableTotal = bookingData.tables * 3000;
    const tableClub = tableTotal * 0.90;
    const tableOrg = tableTotal * 0.10;
    const orgTotal = gateOrg + tableOrg;

    writeHeader('Projected Revenue Split', 16);
    writeRow('Projected gate revenue', fmt(gateTotal));
    writeRow('— Memories share (30%)', fmt(gateClub));
    writeRow('— Organiser share (70%)', fmt(gateOrg));
    y += 6;
    writeRow('Projected table revenue', fmt(tableTotal));
    writeRow('— Memories share (90%)', fmt(tableClub));
    writeRow('— Organiser share (10%)', fmt(tableOrg));
    y += 6;
    doc.setFont('helvetica', 'bold');
    writeRow('Your estimated payout', fmt(orgTotal));
    doc.setFont('helvetica', 'normal');
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor('#777');
    doc.text('Memories reserves 30 complimentary gate passes per event, honoured at no charge and not deducted from your share.', margin, y);
    y += 16;
    doc.text('These figures are based on your own estimates and are settled against actual gate and table receipts on the night.', margin, y);
    y += 20;
    doc.setTextColor('#000000');

    writeHeader('What Happens Next', 16);
    doc.setFontSize(12);
    doc.text('Memories will review your proposal and get back to you with a decision within 5 business days.', margin, y);
    y += 18;
    doc.text('Your date is held provisionally until then — it is not confirmed until you receive written approval from Memories.', margin, y);
    y += 25;

    doc.setFontSize(10);
    doc.setTextColor('#999');
    doc.text('Dress Well. Behave Well. Make Memories.', margin, y);
    y += 16;
    doc.setFont('helvetica', 'italic');
    doc.text('Memories Night Club · SamRit Hotel, Cape Coast', margin, y);
    y += 14;
    doc.text('info@memoriesnightclub.com · +233 54 232 6579 · +233 24 308 7077', margin, y);
    y += 14;
    doc.text('@memoriesnightclub.gh', margin, y);

    return doc.output('datauristring');
  }

  // ================================================================
  // SEND CONFIRMATION EMAIL VIA BREVO (working version)
  // ================================================================
  async function sendBookingEmail(bookingData) {
    const pdfDataUri = generateBookingPDF(bookingData);
    const base64Pdf = pdfDataUri.split(',')[1];

    const toEmail = bookingData.email;
    const subject = `Your Memories Event Booking Confirmation (Ref: ${bookingData.id || 'N/A'})`;

    const fmt = (num) => 'GHS ' + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const gateTotal = bookingData.gateAttendance * 50;
    const gateClub = gateTotal * 0.30;
    const gateOrg = gateTotal * 0.70;
    const tableTotal = bookingData.tables * 3000;
    const tableClub = tableTotal * 0.90;
    const tableOrg = tableTotal * 0.10;
    const orgTotal = gateOrg + tableOrg;

    const htmlBody = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
        <div style="text-align: center; border-bottom: 2px solid #c8174e; padding-bottom: 20px;">
          <h1 style="font-family: 'Georgia', serif; font-size: 28px; color: #c8174e; letter-spacing: 2px; margin: 0;">MEMORIES</h1>
          <p style="font-style: italic; color: #666; margin: 4px 0 0;">Some Nights Are Forever</p>
        </div>
        <div style="margin: 25px 0 20px;">
          <h2 style="font-size: 20px; margin: 0; color: #1a1a1a;">Hi ${bookingData.contactPerson}, we've got your proposal.</h2>
          <p style="font-size: 15px; color: #333;">Thanks for submitting an event to Memories. Below is a summary of everything you sent us for <strong>${bookingData.date || 'TBC'}</strong>.</p>
        </div>
        <div style="background: #f8f4ee; padding: 12px 16px; border-left: 4px solid #c8174e; margin-bottom: 20px;">
          <strong style="font-size: 14px;">Booking Reference</strong><br>
          <span style="font-size: 16px; font-weight: 600; color: #c8174e;">${bookingData.id || 'N/A'}</span>
        </div>
        <h3 style="font-size: 16px; color: #c8174e; border-bottom: 1px solid #ddd; padding-bottom: 6px;">What You Submitted</h3>
        <table style="width: 100%; font-size: 14px; border-collapse: collapse; margin: 8px 0 20px;">
          <tr><td style="padding: 6px 0; width: 40%;"><strong>Organiser</strong></td><td style="padding: 6px 0;">${bookingData.organiser}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>Contact</strong></td><td style="padding: 6px 0;">${bookingData.contactPerson} · ${bookingData.email} · ${bookingData.phone}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>Event Concept</strong></td><td style="padding: 6px 0;">${bookingData.concept || 'Not specified'}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>External DJs / MCs</strong></td><td style="padding: 6px 0;">${bookingData.hasDJ ? 'Yes' : 'No'} — ${bookingData.djDetails || 'None'}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>Special Requests</strong></td><td style="padding: 6px 0;">${bookingData.specialRequests || 'None'}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>Tables Requested</strong></td><td style="padding: 6px 0;">${bookingData.tables || 0}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>Estimated Gate Attendance</strong></td><td style="padding: 6px 0;">${bookingData.gateAttendance || 0}</td></tr>
        </table>
        <h3 style="font-size: 16px; color: #c8174e; border-bottom: 1px solid #ddd; padding-bottom: 6px;">Projected Revenue Split</h3>
        <table style="width: 100%; font-size: 14px; border-collapse: collapse; margin: 8px 0 20px;">
          <tr><td style="padding: 6px 0; width: 60%;"><strong>Projected gate revenue</strong></td><td style="padding: 6px 0; text-align: right;">${fmt(gateTotal)}</td></tr>
          <tr><td style="padding: 6px 0; padding-left: 20px;">— Memories share (30%)</td><td style="padding: 6px 0; text-align: right;">${fmt(gateClub)}</td></tr>
          <tr><td style="padding: 6px 0; padding-left: 20px;">— Organiser share (70%)</td><td style="padding: 6px 0; text-align: right;">${fmt(gateOrg)}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>Projected table revenue</strong></td><td style="padding: 6px 0; text-align: right;">${fmt(tableTotal)}</td></tr>
          <tr><td style="padding: 6px 0; padding-left: 20px;">— Memories share (90%)</td><td style="padding: 6px 0; text-align: right;">${fmt(tableClub)}</td></tr>
          <tr><td style="padding: 6px 0; padding-left: 20px;">— Organiser share (10%)</td><td style="padding: 6px 0; text-align: right;">${fmt(tableOrg)}</td></tr>
          <tr style="border-top: 2px solid #c8174e;">
            <td style="padding: 8px 0;"><strong>Your estimated payout</strong></td>
            <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #c8174e;">${fmt(orgTotal)}</td>
          </tr>
        </table>
        <p style="font-size: 13px; color: #777; margin: -10px 0 20px;">Memories reserves 30 complimentary gate passes per event, honoured at no charge and not deducted from your share. These figures are based on your own estimates and are settled against actual gate and table receipts on the night.</p>
        <div style="background: #f8f4ee; padding: 16px; border-radius: 6px; margin: 20px 0 24px;">
          <h3 style="font-size: 16px; color: #c8174e; margin: 0 0 6px;">What Happens Next</h3>
          <p style="font-size: 14px; margin: 0;">Memories will review your proposal and get back to you with a decision within <strong>5 business days</strong>. Your date is held provisionally until then — it is <strong>not confirmed</strong> until you receive written approval from Memories.</p>
        </div>
        <div style="text-align: center; border-top: 2px solid #c8174e; padding-top: 18px; font-size: 14px; color: #555;">
          <p style="margin: 0; font-style: italic;">Dress Well. Behave Well. Make Memories.</p>
          <p style="margin: 8px 0 0; font-size: 13px;">
            Memories Night Club · SamRit Hotel, Cape Coast<br>
            info@memoriesnightclub.com · +233 54 232 6579 · +233 24 308 7077<br>
            @memoriesnightclub.gh
          </p>
          <p style="margin: 12px 0 0; font-size: 12px; color: #999;">This is an automated confirmation. Please do not reply directly to this email.</p>
        </div>
      </div>
    `;

    const attachment = {
      name: `Booking_Confirmation_${bookingData.id || Date.now()}.pdf`,
      content: base64Pdf
    };

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: {
            name: 'Memories Night Club',
            email: SENDER_EMAIL
          },
          to: [
            {
              email: toEmail,
              name: bookingData.contactPerson
            }
          ],
          subject: subject,
          htmlContent: htmlBody,
          attachment: [attachment]
        })
      });

      const result = await response.json();
      if (response.ok) {
        console.log('✅ Email sent via Brevo:', result);
        return true;
      } else {
        console.error('❌ Brevo error:', result);
        return false;
      }
    } catch (error) {
      console.error('❌ Brevo request failed:', error);
      return false;
    }
  }

  // ================================================================
  // PAYMENT FLOW
  // ================================================================
  async function payAndSubmit() {
    const orgName = document.getElementById("org-name").value.trim();
    const contactPerson = document.getElementById("contact-person").value.trim();
    const email = document.getElementById("org-email").value.trim();
    const phone = document.getElementById("org-phone").value.trim();
    const concept = document.getElementById("concept-desc").value.trim();
    const hasDJ = document.getElementById("dj-yes").classList.contains("active");
    const djDetails = hasDJ ? document.getElementById("dj-details-text").value.trim() : "";
    const specialRequests = document.getElementById("special-requests").value.trim();

    if (!orgName || !contactPerson || !email || !phone || !concept) {
      alert("Please fill in all required fields (Organiser, Contact, Email, Phone, Concept).");
      return;
    }

    const bookingData = {
      date: selectedDate,
      dateObj: selectedDateObj,
      organiser: orgName,
      contactPerson: contactPerson,
      email: email,
      phone: phone,
      concept: concept,
      hasDJ: hasDJ,
      djDetails: djDetails,
      specialRequests: specialRequests,
      tables: counts.tables,
      gateAttendance: counts.gate,
      estimatedPayout: counts.gate * 50 * 0.70 + counts.tables * 3000 * 0.10,
      submittedAt: new Date().toISOString()
    };

    const handler = PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email: email,
      amount: 500 * 100,
      currency: 'GHS',
      ref: 'BOOK_' + Date.now() + Math.random().toString(36).substring(2, 7),
      callback: function(response) {
        handlePaymentCallback(response, bookingData);
      },
      onClose: function() {
        console.log('Payment modal closed.');
      }
    });
    handler.openIframe();
  }

  function handlePaymentCallback(response, bookingData) {
    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) {
      nextBtn.textContent = "Verifying...";
      nextBtn.disabled = true;
    }

    const pdfDataUri = generateBookingPDF(bookingData);
    const base64Pdf = pdfDataUri.split(',')[1];

    fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: response.reference,
        bookingData: bookingData,
        pdfBase64: base64Pdf
      })
    })
      .then(res => res.json())
      .then(async (result) => {
        if (result.success) {
          bookingData.id = result.bookingId;
          await sendBookingEmail(bookingData);
          const receiptData = { ...bookingData, paidAmount: 500 };
          showReceipt(receiptData);
          closeSheet();
          resetForm();
        } else {
          alert('Payment verification failed. Please contact support and quote reference: ' + response.reference);
        }
      })
      .catch(error => {
        console.error('Verification error:', error);
        alert('Network error. Please try again.');
      })
      .finally(() => {
        if (nextBtn) {
          nextBtn.textContent = "Pay & Submit";
          nextBtn.disabled = false;
        }
      });
  }

  function resetForm() {
    const fields = ['org-name','contact-person','org-email','org-phone','concept-desc','dj-details-text','special-requests'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const tablesEl = document.getElementById('tables');
    const gateEl = document.getElementById('gate');
    if (tablesEl) tablesEl.textContent = '0';
    if (gateEl) gateEl.textContent = '0';
    counts.tables = 0;
    counts.gate = 0;
    recalc();
    setDJ(false);
    currentStep = 1;
    showStep(1);
  }

  // ================================================================
  // RECEIPT MODAL
  // ================================================================
  function showReceipt(data) {
    console.log('📋 showReceipt called with data:', data);

    const elements = {
      date: document.getElementById('receipt-date'),
      organiser: document.getElementById('receipt-organiser'),
      contact: document.getElementById('receipt-contact'),
      email: document.getElementById('receipt-email'),
      phone: document.getElementById('receipt-phone'),
      tables: document.getElementById('receipt-tables'),
      gate: document.getElementById('receipt-gate'),
      payout: document.getElementById('receipt-payout'),
      modal: document.getElementById('receiptModal')
    };

    const missing = Object.keys(elements).filter(key => !elements[key]);
    if (missing.length > 0) {
      console.error('❌ Missing receipt elements:', missing);
      if (!elements.modal) {
        alert('Booking confirmed! Check your email for details.');
        return;
      }
    }

    if (elements.date) elements.date.textContent = data.date || '—';
    if (elements.organiser) elements.organiser.textContent = data.organiser || '—';
    if (elements.contact) elements.contact.textContent = data.contactPerson || '—';
    if (elements.email) elements.email.textContent = data.email || '—';
    if (elements.phone) elements.phone.textContent = data.phone || '—';
    if (elements.tables) elements.tables.textContent = data.tables || 0;
    if (elements.gate) elements.gate.textContent = data.gateAttendance || 0;
    if (elements.payout) {
      elements.payout.textContent = 'GHS ' + (data.estimatedPayout || 0).toLocaleString(undefined, {maximumFractionDigits:0});
    }

    if (elements.modal) {
      elements.modal.classList.add('show');
      document.body.style.overflow = 'hidden';
      console.log('✅ Receipt modal shown');
    }
  }

  function closeReceipt() {
    const modal = document.getElementById('receiptModal');
    if (modal) {
      modal.classList.remove('show');
      document.body.style.overflow = '';
    }
  }

  // ================================================================
  // VENUE FORM (Host Event)
  // ================================================================
  function submitVenueForm() {
    const fname = document.getElementById("vf-fname").value.trim();
    const phone = document.getElementById("vf-phone").value.trim();
    const ename = document.getElementById("vf-name").value.trim();
    if (!fname || !phone || !ename) {
      alert("Please fill in at least your name, phone number, and event name.");
      return;
    }
    const fields = document.getElementById("venue-form-fields");
    const success = document.getElementById("venue-success");
    if (fields) fields.style.display = "none";
    if (success) success.style.display = "block";
  }

  // ================================================================
  // HERO PARTICLES
  // ================================================================
  const particleContainer = document.getElementById("particles");
  if (particleContainer) {
    for (let i = 0; i < 20; i++) {
      const p = document.createElement("div");
      p.className = "particle";
      p.style.left = Math.random() * 100 + "%";
      p.style.bottom = "-10px";
      p.style.animationDuration = 7 + Math.random() * 10 + "s";
      p.style.animationDelay = Math.random() * 9 + "s";
      const size = 1 + Math.random() * 3;
      p.style.width = size + "px";
      p.style.height = size + "px";
      p.style.background = Math.random() > 0.5 ? "#C8174E" : "#E01F5A";
      particleContainer.appendChild(p);
    }
  }

  // ================================================================
  // SMOOTH SCROLLING
  // ================================================================
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === "#") return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // ================================================================
  // START THE CALENDAR LISTENER
  // ================================================================
  listenToDates();

  console.log('✅ Memories script loaded – email via Brevo enabled.');
});