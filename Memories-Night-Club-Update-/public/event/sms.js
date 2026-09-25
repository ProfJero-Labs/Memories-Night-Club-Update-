// ============================================================
// SMS MODULE - Simplified & Secured
// ============================================================

// ── Configuration ──
const WORKER_URL = 'https://memories-sms.diamondj04102026.workers.dev';
const DEFAULT_SENDER = 'MEMORIES';
const TICKET_URL_BASE = 'https://memoriesnightclub.com/ticket.html?token=';

const FIXED_MESSAGE_TEMPLATE = `Memories Night Club (Samrit) is covering your entrance this Afahye, no charge, just come and enjoy!

Ticket admits ONE. Valid till 12:25am Saturday and 12:25am Sunday.

View your ticket: {link}

Show your ticket or mention your phone number at the gate.

We appreciate you. Let's make this a night to remember!`;

// ── Firebase Config ──
const firebaseConfig = {
    apiKey: "AIzaSyCkhFjqfTqCIg9ic5Qh63XfWVT4tGWuzpM",
    authDomain: "memoriesnightclub-2717f.firebaseapp.com",
    projectId: "memoriesnightclub-2717f",
    storageBucket: "memoriesnightclub-2717f.firebasestorage.app",
    messagingSenderId: "143491627943",
    appId: "1:143491627943:web:7cb70bfabdefda7e8a5482",
    measurementId: "G-9RQQCZ7EVD"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// ── DOM REFS ──
const toast = document.getElementById('toast');
const sidebarContainer = document.getElementById('sidebar-container');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const overlay = document.getElementById('sidebarOverlay');

const customPhones = document.getElementById('customPhones');
const customCount = document.getElementById('customCount');
const recipientTotal = document.getElementById('recipientTotal');
const sendBtn = document.getElementById('sendBtn');
const historyToggle = document.getElementById('historyToggle');
const historySection = document.getElementById('historySection');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const importCsvBtn = document.getElementById('importCsvBtn');
const csvModal = document.getElementById('csvModal');
const closeCsvModal = document.getElementById('closeCsvModal');
const csvFileInput = document.getElementById('csvFileInput');
const mappingArea = document.getElementById('mappingArea');
const mapPhone = document.getElementById('mapPhone');
const mapFirstName = document.getElementById('mapFirstName');
const mapLastName = document.getElementById('mapLastName');
const csvPreviewHead = document.getElementById('csvPreviewHead');
const csvPreviewBody = document.getElementById('csvPreviewBody');
const csvRowCount = document.getElementById('csvRowCount');
const importContactsBtn = document.getElementById('importContactsBtn');
const exportContactsBtn = document.getElementById('exportContactsBtn');
const exportHistoryBtn = document.getElementById('exportHistoryBtn');
const contactModal = document.getElementById('contactModal');
const closeContactModal = document.getElementById('closeContactModal');
const contactFirstName = document.getElementById('contactFirstName');
const contactLastName = document.getElementById('contactLastName');
const contactPhone = document.getElementById('contactPhone');
const contactEmail = document.getElementById('contactEmail');
const saveContactBtn = document.getElementById('saveContactBtn');
const pageSizeSelect = document.getElementById('pageSizeSelect');
const prevHistoryPage = document.getElementById('prevHistoryPage');
const nextHistoryPage = document.getElementById('nextHistoryPage');
const historyRange = document.getElementById('historyRange');
const ticketTypeSelect = document.getElementById('ticketTypeSelect');
const admitCountInput = document.getElementById('admitCountInput');
const admitDecBtn = document.getElementById('admitDecBtn');
const admitIncBtn = document.getElementById('admitIncBtn');

const totalSent = document.getElementById('totalSent');
const totalFailed = document.getElementById('totalFailed');
const creditsUsed = document.getElementById('creditsUsed');
const smsBalance = document.getElementById('smsBalance');

// ── State ──
let allTickets = [];
let selectedRecipients = [];
let unsubscribeTickets = null;
let unsubscribeHistory = null;
let currentUser = null;
let parsedCsvData = [];
let csvHeaders = [];

let currentPage = 0;
let pageSize = 25;
let lastDoc = null;
let historyItems = [];

const sendBtnOriginal = sendBtn.innerHTML;

// ============================================================
// HELPERS
// ============================================================
function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\s/g, '').replace(/^\+233/, '0').replace(/^233/, '0');
}

function generateToken() {
    return crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0,
                v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
}

function countSmsSegments(text) {
    if (!text) return 0;
    const isUnicode = /[^\x00-\x7F]/.test(text);
    const maxPerSeg = isUnicode ? 70 : 160;
    return Math.ceil(text.length / maxPerSeg);
}

// ============================================================
// ADMIT COUNT CONTROLS
// ============================================================
admitDecBtn.addEventListener('click', () => {
    let val = parseInt(admitCountInput.value) || 1;
    if (val > 1) admitCountInput.value = val - 1;
});
admitIncBtn.addEventListener('click', () => {
    let val = parseInt(admitCountInput.value) || 1;
    if (val < 10) admitCountInput.value = val + 1;
});
admitCountInput.addEventListener('change', function() {
    let val = parseInt(this.value) || 1;
    if (val < 1) val = 1;
    if (val > 10) val = 10;
    this.value = val;
});

// ============================================================
// SIDEBAR LOADER
// ============================================================
async function loadSidebar() {
    try {
        const response = await fetch('sidebar.html');
        if (!response.ok) throw new Error('Sidebar not found');
        const html = await response.text();
        sidebarContainer.innerHTML = html;

        document.querySelectorAll('.nav-link').forEach(link => {
            const href = link.getAttribute('href');
            if (href === 'sms.html') link.classList.add('active');
            else link.classList.remove('active');
        });

        document.getElementById('sidebarLogoutBtn')?.addEventListener('click', async () => {
            await auth.signOut();
            showToast('Logged out', 'info');
            setTimeout(() => window.location.href = 'login.html', 500);
        });

        auth.onAuthStateChanged(user => {
            const nameEl = document.getElementById('sidebarAdminName');
            const emailEl = document.getElementById('sidebarAdminEmail');
            if (user) {
                if (nameEl) nameEl.textContent = user.displayName || 'Admin';
                if (emailEl) emailEl.textContent = user.email || 'Administrator';
            }
        });

        return true;
    } catch (error) {
        console.error('Sidebar load error:', error);
        return false;
    }
}

// ============================================================
// AUTH GUARD
// ============================================================
auth.onAuthStateChanged(async user => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = user;
    await loadSidebar();
    loadTickets();
    loadSmsHistory();
    fetchBalance();
    updateRecipientCount();
});

// ============================================================
// LOAD TICKETS
// ============================================================
function loadTickets() {
    if (unsubscribeTickets) unsubscribeTickets();
    unsubscribeTickets = db.collection('tickets')
        .orderBy('createdAt', 'desc')
        .onSnapshot((snapshot) => {
            allTickets = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                const ticket = { id: doc.id, ...data };
                if (!ticket.token && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(doc.id)) {
                    ticket.token = doc.id;
                }
                allTickets.push(ticket);
            });
            updateRecipientCount();
        }, (error) => {
            console.error('Tickets load error:', error);
        });
}

// ============================================================
// LOAD SMS HISTORY (PAGINATED)
// ============================================================
function loadSmsHistory() {
    pageSize = parseInt(pageSizeSelect.value) || 25;
    currentPage = 0;
    lastDoc = null;
    loadHistoryPage('next');
}

function loadHistoryPage(direction = 'next') {
    let query = db.collection('smsHistory').orderBy('timestamp', 'desc');

    if (direction === 'next' && lastDoc) {
        query = query.startAfter(lastDoc);
    } else if (direction === 'prev' && firstDoc) {
        showToast('Previous page not implemented; adjust page size.', 'warning');
        return;
    }

    query = query.limit(pageSize);

    query.get().then(snapshot => {
        const items = [];
        snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        historyItems = items;
        const start = currentPage * pageSize + 1;
        const end = start + items.length - 1;
        historyRange.textContent = `${start}-${end} of ${items.length || '?'}`;

        if (items.length > 0) {
            lastDoc = snapshot.docs[snapshot.docs.length - 1];
        } else {
            lastDoc = null;
        }

        renderHistoryItems(items);
        updateHistoryPagination(items.length);
        updateStats(); // refresh stats after loading history
    }).catch(err => {
        console.error('History page error:', err);
        showToast('Failed to load history', 'error');
    });
}

function updateHistoryPagination(itemsCount) {
    const hasMore = itemsCount >= pageSize;
    nextHistoryPage.disabled = !hasMore;
    prevHistoryPage.disabled = currentPage === 0;
}

function renderHistoryItems(items) {
    if (items.length === 0) {
        historyList.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>No SMS history</p></div>`;
        return;
    }

    let html = '';
    items.forEach(item => {
        const time = item.timestamp?.toDate?.()?.toLocaleString() || 'Just now';
        const status = item.status || 'sent';
        const statusClass = status === 'sent' ? 'sent' :
            status === 'scheduled' ? 'scheduled' :
            status === 'failed' ? 'failed' : 'pending';

        const recipients = item.recipients || [];
        const recipientCount = recipients.length;
        const successCount = recipients.filter(r => r.status === 'sent').length;
        const failCount = recipients.filter(r => r.status === 'failed').length;
        const pendingCount = recipients.filter(r => r.status === 'pending').length;

        const message = item.message || '';
        const truncated = message.length > 120 ? message.substring(0, 120) + '...' : message;
        const fullMsg = escapeHtml(message);
        const safeTruncated = escapeHtml(truncated);

        let summary = `${successCount} sent`;
        if (failCount > 0) summary += `, ${failCount} failed`;
        if (pendingCount > 0) summary += `, ${pendingCount} pending`;

        const credits = item.totalCredits || 0;

        html += `
            <div class="history-item" data-fullmsg="${fullMsg.replace(/"/g, '&quot;')}">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-sm text-on-surface font-medium">${escapeHtml(item.sender || 'MEMORIES')}</span>
                            <span class="status-badge ${statusClass}">${status}</span>
                            <span class="text-xs text-on-surface-variant">${escapeHtml(time)}</span>
                            ${credits > 0 ? `<span class="text-xs text-on-surface-variant">${credits} credits</span>` : ''}
                        </div>
                        <p class="text-sm text-on-surface-variant mt-0.5 message-text">${safeTruncated}</p>
                        <span class="text-xs text-on-surface-variant block mt-0.5">${recipientCount} recipients · ${summary}</span>
                    </div>
                    ${item.status === 'failed' ? `<i class="fas fa-triangle-exclamation text-error" title="${escapeHtml(item.error || 'Failed')}"></i>` : ''}
                </div>
            </div>
        `;
    });

    historyList.innerHTML = html;

    document.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', function() {
            const msg = this.dataset.fullmsg || '';
            if (msg) {
                alert(`Full Message:\n\n${msg}`);
            }
        });
    });
}

// ============================================================
// FETCH SMS BALANCE
// ============================================================
async function fetchBalance() {
    try {
        const response = await fetch(`${WORKER_URL}/balance`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to fetch balance');
        }
        const data = await response.json();
        if (data.success) {
            smsBalance.textContent = data.balance || 'N/A';
        } else {
            throw new Error(data.error || 'Unknown error');
        }
    } catch (error) {
        console.warn('Balance fetch error:', error);
        smsBalance.textContent = '--';
        setTimeout(fetchBalance, 30000);
    }
}

// ============================================================
// RECIPIENT COUNTER
// ============================================================
function updateRecipientCount() {
    const lines = customPhones.value.split('\n').map(s => s.trim()).filter(s => s);
    selectedRecipients = lines;
    customCount.textContent = lines.length;
    recipientTotal.textContent = lines.length;
}

customPhones.addEventListener('input', updateRecipientCount);

closeContactModal.addEventListener('click', () => contactModal.classList.remove('active'));
contactModal.addEventListener('click', (e) => {
    if (e.target === contactModal) contactModal.classList.remove('active');
});

saveContactBtn.addEventListener('click', async () => {
    const firstName = contactFirstName.value.trim();
    const lastName = contactLastName.value.trim();
    const phone = normalizePhone(contactPhone.value.trim());
    const email = contactEmail.value.trim();

    if (!firstName || !phone) {
        showToast('First Name and Phone are required', 'warning');
        return;
    }

    try {
        await db.collection('contacts').add({
            firstName,
            lastName,
            phone,
            email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: currentUser?.email || 'Admin'
        });
        showToast(`✅ Contact "${firstName} ${lastName}" saved!`, 'success');
        contactModal.classList.remove('active');

        const existing = customPhones.value.split('\n').map(s => normalizePhone(s.trim())).filter(s => s);
        if (!existing.includes(phone)) {
            customPhones.value = [...existing, phone].join('\n');
            updateRecipientCount();
        }
    } catch (error) {
        console.error('Save contact error:', error);
        showToast('Failed to save contact', 'error');
    }
});

// ============================================================
// CSV IMPORT
// ============================================================
importCsvBtn.addEventListener('click', () => {
    csvModal.classList.add('active');
    mappingArea.classList.add('hidden');
    csvFileInput.value = '';
    csvPreviewHead.innerHTML = '';
    csvPreviewBody.innerHTML = '';
    csvRowCount.textContent = '0 rows parsed';
    parsedCsvData = [];
    csvHeaders = [];
    importContactsBtn.disabled = true;
});

closeCsvModal.addEventListener('click', () => csvModal.classList.remove('active'));
csvModal.addEventListener('click', (e) => {
    if (e.target === csvModal) csvModal.classList.remove('active');
});

csvFileInput.addEventListener('change', function(e) {
    const file = this.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(ev) {
        const csv = ev.target.result;
        const results = Papa.parse(csv, {
            header: true,
            skipEmptyLines: true,
            trimHeaders: true
        });

        if (results.errors.length > 0) {
            showToast('Error parsing CSV: ' + results.errors[0].message, 'error');
            return;
        }

        parsedCsvData = results.data.filter(row => Object.values(row).some(val => val && val.trim() !== ''));
        csvHeaders = results.meta.fields || [];

        if (parsedCsvData.length === 0) {
            showToast('No data found in CSV', 'warning');
            return;
        }

        [mapPhone, mapFirstName, mapLastName].forEach(select => {
            select.innerHTML = '<option value="">— Select —</option>';
            csvHeaders.forEach(header => {
                const opt = document.createElement('option');
                opt.value = header;
                opt.textContent = header;
                select.appendChild(opt);
            });
        });

        const phoneKeywords = ['phone', 'mobile', 'contact', 'cell', 'telephone', 'whatsapp'];
        const headerLower = csvHeaders.map(h => h.toLowerCase());
        for (const keyword of phoneKeywords) {
            const idx = headerLower.findIndex(h => h.includes(keyword));
            if (idx !== -1) {
                mapPhone.value = csvHeaders[idx];
                break;
            }
        }

        const firstNameKeywords = ['first', 'firstname', 'fname', 'given'];
        const lastNameKeywords = ['last', 'lastname', 'lname', 'surname', 'family'];
        for (const keyword of firstNameKeywords) {
            const idx = headerLower.findIndex(h => h.includes(keyword));
            if (idx !== -1) {
                mapFirstName.value = csvHeaders[idx];
                break;
            }
        }
        for (const keyword of lastNameKeywords) {
            const idx = headerLower.findIndex(h => h.includes(keyword));
            if (idx !== -1) {
                mapLastName.value = csvHeaders[idx];
                break;
            }
        }

        renderCsvPreview();
        mappingArea.classList.remove('hidden');
        importContactsBtn.disabled = false;
        csvRowCount.textContent = `${parsedCsvData.length} rows parsed`;
        showToast(`✅ Parsed ${parsedCsvData.length} rows`, 'success');
    };
    reader.readAsText(file);
});

function renderCsvPreview() {
    let headHtml = '<tr>';
    csvHeaders.forEach(header => headHtml += `<th>${escapeHtml(header)}</th>`);
    headHtml += '</tr>';
    csvPreviewHead.innerHTML = headHtml;

    let bodyHtml = '';
    const previewRows = parsedCsvData.slice(0, 5);
    previewRows.forEach(row => {
        bodyHtml += '<tr>';
        csvHeaders.forEach(header => {
            const val = row[header] || '';
            bodyHtml += `<td>${escapeHtml(val)}</td>`;
        });
        bodyHtml += '</tr>';
    });
    csvPreviewBody.innerHTML = bodyHtml;
}

importContactsBtn.addEventListener('click', function() {
    const phoneCol = mapPhone.value;
    if (!phoneCol) {
        showToast('Please map the Phone Number column', 'warning');
        return;
    }

    let phoneNumbers = [];
    parsedCsvData.forEach(row => {
        const phone = row[phoneCol]?.trim();
        if (phone) {
            const normalized = normalizePhone(phone);
            if (normalized.length > 5) phoneNumbers.push(normalized);
        }
    });

    if (phoneNumbers.length === 0) {
        showToast('No valid phone numbers found in the mapped column', 'warning');
        return;
    }

    const existing = customPhones.value.split('\n').map(s => normalizePhone(s.trim())).filter(s => s);
    const allNumbers = [...existing, ...phoneNumbers];
    const uniqueNumbers = [...new Set(allNumbers)];
    customPhones.value = uniqueNumbers.join('\n');

    updateRecipientCount();
    showToast(`✅ Imported ${phoneNumbers.length} contacts successfully!`, 'success');
    csvModal.classList.remove('active');
});

// ============================================================
// SEND SMS VIA WORKER
// ============================================================
async function sendSmsViaWorker(payload) {
    const response = await fetch(`${WORKER_URL}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error || 'SMS sending failed');
    }
    return data;
}

// ============================================================
// SEND SMS (IMPROVED)
// ============================================================
async function sendSms() {
    const rawPhones = customPhones.value.split('\n').map(s => s.trim()).filter(s => s);
    if (rawPhones.length === 0) {
        showToast('Please enter at least one phone number', 'warning');
        return;
    }

    const phones = rawPhones.map(p => normalizePhone(p));
    const uniquePhones = [...new Set(phones)];
    if (uniquePhones.length !== rawPhones.length) {
        showToast(`Duplicate numbers detected. Sending to ${uniquePhones.length} unique recipients.`, 'warning');
    }

    const confirmMsg = `Send SMS to ${uniquePhones.length} recipients?`;
    if (!confirm(confirmMsg)) return;

    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spinner"></span> Sending...';

    const results = [];
    let successCount = 0;
    let failCount = 0;
    let totalCredits = 0;

    const ticketType = ticketTypeSelect.value;
    const admitCount = parseInt(admitCountInput.value) || 1;

    try {
        for (const phone of uniquePhones) {
            let ticket = allTickets.find(t => normalizePhone(t.phone) === phone);
            let token;
            let ticketId;

            if (ticket) {
                token = ticket.token;
                ticketId = ticket.ticketId || ticket.id;
            } else {
                token = generateToken();
                ticketId = `MEM-${token.substring(0, 8).toUpperCase()}`;
                const newTicket = {
                    phone,
                    ticketId,
                    token,
                    customerName: 'Guest',
                    eventName: '72HOURS AFAHYE PARTY',
                    day1Date: 'FRI. 04 SEPT 2026',
                    day2Date: 'SAT. 05 SEPT 2026',
                    venue: 'Memories Night Club, Cape Coast',
                    doors: 'Open 10:00PM',
                    checkedInDay1: false,
                    checkedInDay2: false,
                    type: ticketType,
                    admitCount: admitCount,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await db.collection('tickets').doc(token).set(newTicket);
                ticket = { id: token, ...newTicket };
                allTickets.push(ticket);
                token = ticket.token;
                ticketId = ticket.ticketId;
            }

            if (ticket.type !== ticketType || ticket.admitCount !== admitCount) {
                await db.collection('tickets').doc(ticket.id).update({
                    type: ticketType,
                    admitCount: admitCount,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                ticket.type = ticketType;
                ticket.admitCount = admitCount;
                const idx = allTickets.findIndex(t => t.id === ticket.id);
                if (idx !== -1) allTickets[idx] = ticket;
            }

            const link = TICKET_URL_BASE + token;
            const personalizedMessage = FIXED_MESSAGE_TEMPLATE.replace('{link}', link);
            const segments = countSmsSegments(personalizedMessage);

            try {
                const payload = {
                    sender: DEFAULT_SENDER,
                    recipients: [phone],
                    message: personalizedMessage,
                };
                const response = await sendSmsViaWorker(payload);
                results.push({
                    phone,
                    status: 'sent',
                    messageId: response?.data?.message_id || response?.data?.msg_id || null,
                    error: null,
                    token,
                    ticketId,
                    credits: segments
                });
                successCount++;
                totalCredits += segments;
            } catch (err) {
                console.error(`Failed to send to ${phone}:`, err);
                results.push({
                    phone,
                    status: 'failed',
                    messageId: null,
                    error: err.message || 'Unknown error',
                    token,
                    ticketId,
                    credits: 0
                });
                failCount++;
            }
        }

        const historyDoc = {
            recipients: results,
            message: FIXED_MESSAGE_TEMPLATE,
            sender: DEFAULT_SENDER,
            status: failCount === 0 ? 'sent' : (successCount > 0 ? 'partial' : 'failed'),
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            sentBy: currentUser?.email || 'Admin',
            successCount,
            failCount,
            total: uniquePhones.length,
            totalCredits: totalCredits
        };
        await db.collection('smsHistory').add(historyDoc);

        if (failCount > 0) {
            showToast(`✅ Sent ${successCount}, ❌ Failed ${failCount}`, 'error');
        } else {
            showToast(`✅ Sent to ${successCount} recipients!`, 'success');
        }

        if (successCount > 0) {
            customPhones.value = '';
            updateRecipientCount();
        }

        await loadSmsHistory();
        fetchBalance();

    } catch (error) {
        console.error('Send SMS error:', error);
        showToast('Failed to send SMS: ' + error.message, 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = sendBtnOriginal;
    }
}

sendBtn.addEventListener('click', sendSms);

// ============================================================
// EXPORT CONTACTS
// ============================================================
exportContactsBtn.addEventListener('click', function() {
    const phones = customPhones.value.split('\n').map(s => s.trim()).filter(s => s);
    if (phones.length === 0) {
        showToast('No contacts to export', 'warning');
        return;
    }

    let csv = 'Phone Number,Ticket ID,Token,Type,Admit Count\n';
    phones.forEach(phone => {
        const ticket = allTickets.find(t => normalizePhone(t.phone) === normalizePhone(phone));
        const ticketId = ticket?.ticketId || ticket?.id || '';
        const token = ticket?.token || '';
        const type = ticket?.type || '';
        const admit = ticket?.admitCount || '';
        csv += `${phone},${ticketId},${token},${type},${admit}\n`;
    });

    downloadCSV(csv, `contacts_${new Date().toISOString().slice(0,10)}.csv`);
    showToast(`✅ Exported ${phones.length} contacts`, 'success');
});

// ============================================================
// EXPORT HISTORY
// ============================================================
exportHistoryBtn.addEventListener('click', async function() {
    const originalText = this.innerHTML;
    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Exporting...';

    try {
        const snapshot = await db.collection('smsHistory').orderBy('timestamp', 'desc').get();
        const history = [];
        snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));

        if (history.length === 0) {
            showToast('No history to export', 'warning');
            this.disabled = false;
            this.innerHTML = originalText;
            return;
        }

        let csv = 'Date,Status,Total,Success,Failed,Credits,Message,Sender,Error\n';
        history.forEach(item => {
            const date = item.timestamp?.toDate?.()?.toISOString() || 'N/A';
            const recipients = item.recipients || [];
            const total = recipients.length || item.total || 0;
            const success = recipients.filter(r => r.status === 'sent').length || item.successCount || 0;
            const failed = recipients.filter(r => r.status === 'failed').length || item.failCount || 0;
            const credits = item.totalCredits || 0;
            const message = (item.message || '').replace(/"/g, '""');
            const status = item.status || 'sent';
            const error = (item.error || '').replace(/"/g, '""');
            csv += `"${date}","${status}","${total}","${success}","${failed}","${credits}","${message}","${item.sender || 'MEMORIES'}","${error}"\n`;
        });

        downloadCSV(csv, `sms_history_${new Date().toISOString().slice(0,10)}.csv`);
        showToast(`✅ Exported ${history.length} history entries`, 'success');
    } catch (error) {
        console.error('Export history error:', error);
        showToast('Failed to export history: ' + error.message, 'error');
    } finally {
        this.disabled = false;
        this.innerHTML = originalText;
    }
});

// ============================================================
// CSV DOWNLOAD HELPER
// ============================================================
function downloadCSV(csv, filename) {
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

// ============================================================
// HISTORY TOGGLE
// ============================================================
historyToggle.addEventListener('click', function() {
    historySection.classList.toggle('hidden');
    this.querySelector('span').textContent = historySection.classList.contains('hidden') ? 'History' : 'Hide History';
});

// ── Pagination Controls ──
pageSizeSelect.addEventListener('change', function() {
    pageSize = parseInt(this.value);
    currentPage = 0;
    lastDoc = null;
    loadHistoryPage('next');
});

nextHistoryPage.addEventListener('click', () => {
    currentPage++;
    loadHistoryPage('next');
});

prevHistoryPage.addEventListener('click', () => {
    if (currentPage > 0) {
        currentPage--;
        showToast('Previous page not implemented; adjust page size.', 'warning');
    }
});

// ============================================================
// CLEAR HISTORY
// ============================================================
clearHistoryBtn.addEventListener('click', async function() {
    if (!confirm('Clear all SMS history? This cannot be undone.')) return;
    try {
        const snapshot = await db.collection('smsHistory').get();
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        showToast('History cleared', 'success');
        loadSmsHistory();
    } catch (error) {
        console.error('Clear history error:', error);
        showToast('Failed to clear history', 'error');
    }
});

// ============================================================
// UPDATE STATS (FIXED)
// ============================================================
async function updateStats() {
    try {
        const snapshot = await db.collection('smsHistory').get();
        let totalSentCount = 0;
        let totalFailedCount = 0;
        let totalCredits = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            const recipients = data.recipients || [];

            // Case 1: recipients is an array of objects (new format)
            if (Array.isArray(recipients) && recipients.length > 0 && typeof recipients[0] === 'object') {
                recipients.forEach(r => {
                    if (r.status === 'sent') {
                        totalSentCount++;
                        totalCredits += (r.credits || 0);
                    } else if (r.status === 'failed') {
                        totalFailedCount++;
                    }
                });
            } else {
                // Case 2: recipients is array of strings (old format) or undefined
                const success = data.successCount || 0;
                const fail = data.failCount || 0;
                totalSentCount += success;
                totalFailedCount += fail;
                // Estimate credits
                if (data.totalCredits) {
                    totalCredits += data.totalCredits;
                } else if (data.message) {
                    const segments = countSmsSegments(data.message);
                    totalCredits += segments * success;
                } else {
                    // fallback: assume 2 credits per message
                    totalCredits += success * 2;
                }
            }
        });

        totalSent.textContent = totalSentCount;
        totalFailed.textContent = totalFailedCount;
        creditsUsed.textContent = totalCredits;

    } catch (error) {
        console.error('Update stats error:', error);
    }
}

// ============================================================
// MOBILE SIDEBAR
// ============================================================
function openSidebar() {
    sidebarContainer.classList.add('open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    sidebarContainer.classList.remove('open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

hamburgerBtn.addEventListener('click', () => {
    if (sidebarContainer.classList.contains('open')) closeSidebar();
    else openSidebar();
});

overlay.addEventListener('click', closeSidebar);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
});
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeSidebar();
});

// ============================================================
// INIT
// ============================================================
console.log('✅ SMS page ready – Firebase connected.');
console.log('📱 Arkesel integration ready via Cloudflare Worker.');