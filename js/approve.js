const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwOrMEX19gFv0YkVnKnimA9lV3B4iFuy9hIFgaS7eCvxyLTD4LAFzzGmktGe7qsbqo-DA/exec';

async function callGas(fn, args = []) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn: fn, args: args })
  });
  if (!res.ok) {
    throw new Error('Network error (' + res.status + ') contacting Apps Script.');
  }
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || ('Error running ' + fn));
  }
  return data.result;
}

let activeAuthToken = ''; // Holds either Google ID token or shared EXAMS_PASSCODE
let activeManagerName = 'Head of Exams';
let allClaimsCache = [];
let editingRowNumber = null;
let refreshTimer;

function hamburgerMenu() {
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const navLinks = document.getElementById('navLinks');

    if (!hamburgerBtn || !navLinks) return;

    const isOpen = navLinks.classList.toggle('open');
    hamburgerBtn.classList.toggle('open');
    hamburgerBtn.setAttribute('aria-expanded', isOpen);
}

function setLoginStatus(msg, isError) {
  const el = document.getElementById('loginErr');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
  el.style.color = isError ? '#b91c1c' : '#0d2d6c';
}

function showPortal(authToken, managerName, claims) {
  activeAuthToken = authToken;
  activeManagerName = managerName || 'Head of Exams';

  sessionStorage.setItem('upton_exams_auth', JSON.stringify({
    token: activeAuthToken,
    name: activeManagerName
  }));

  const lockScreen = document.getElementById('lockScreen');
  const mainPortalCard = document.getElementById('mainPortalCard');
  const welcomeSplash = document.getElementById('welcomeSplash');
  const portalBody = document.getElementById('portalBody');

  if (lockScreen) lockScreen.style.display = 'none';
  if (mainPortalCard) mainPortalCard.style.display = 'block';
  if (welcomeSplash) {
    document.getElementById('splashTitle').textContent = 'Welcome, ' + activeManagerName;
    welcomeSplash.style.display = 'block';
  }
  if (portalBody) portalBody.style.display = 'none';

  document.getElementById('welcomeText').textContent = 'Welcome, ' + activeManagerName;
  allClaimsCache = Array.isArray(claims) ? claims : [];

  setTimeout(function() {
    if (welcomeSplash) welcomeSplash.style.display = 'none';
    if (portalBody) portalBody.style.display = 'block';
    populateDatalists();
    renderTable();
    loadPeopleList();
    loadSchedulesList();
  }, 600);
}

// Google Sign-In Callback
window.handleExamsGoogleSignIn = window.handleGoogleSignIn = async function(response) {
  if (!response || !response.credential) {
    setLoginStatus('Google sign-in did not return a credential.', true);
    return;
  }

  setLoginStatus('Verifying authorised Google account...', false);
  try {
    const res = await callGas('loginExamsManagerWithGoogle', [response.credential]);
    setLoginStatus('', false);
    showPortal(response.credential, res.name || res.email, res.claims);
  } catch (err) {
    console.error('Google Sign-In error:', err);
    setLoginStatus(err && err.message ? err.message : 'Access denied.', true);
  }
};

// Explicitly initialize & render the Google button once GIS loads
function initExamsGoogleButton() {
  const wrap = document.querySelector('.google-wrap');
  const onloadEl = document.getElementById('g_id_onload');
  if (!wrap || !onloadEl) return;

  const clientId = onloadEl.getAttribute('data-client_id');
  if (!clientId) return;

  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: window.handleExamsGoogleSignIn,
      ux_mode: 'popup',
      auto_select: false
    });
    wrap.innerHTML = '';
    google.accounts.id.renderButton(wrap, {
      type: 'standard',
      shape: 'rectangular',
      theme: 'outline',
      text: 'signin_with',
      size: 'large',
      logo_alignment: 'left',
      width: 320
    });
  } else {
    setTimeout(initExamsGoogleButton, 150);
  }
}

// Passcode Fallback Unlock
window.unlockPortal = async function() {
  const nameVal = (document.getElementById('managerName')?.value || '').trim() || 'Head of Exams';
  const passVal = (document.getElementById('passcodeInput')?.value || '').trim();

  if (!passVal) {
    setLoginStatus('Please enter the Exams passcode or sign in with Google.', true);
    return;
  }

  setLoginStatus('Checking passcode...', false);
  try {
    const claims = await callGas('verifyExamsAccess', [passVal]);
    setLoginStatus('', false);
    showPortal(passVal, nameVal, claims);
  } catch (err) {
    setLoginStatus(err && err.message ? err.message : 'Invalid passcode.', true);
  }
};

function handleSessionError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (
    msg.toLowerCase().includes('expired') ||
    msg.toLowerCase().includes('unauthorised') ||
    msg.toLowerCase().includes('access denied')
  ) {
    activeAuthToken = '';
    sessionStorage.removeItem('upton_exams_auth');
    const portalBody = document.getElementById('portalBody');
    const mainPortalCard = document.getElementById('mainPortalCard');
    const lockScreen = document.getElementById('lockScreen');
    if (portalBody) portalBody.style.display = 'none';
    if (mainPortalCard) mainPortalCard.style.display = 'none';
    if (lockScreen) lockScreen.style.display = 'block';
    setLoginStatus(msg, true);
  } else {
    alert(msg);
  }
}

// Tab Switching
window.switchView = function(view) {
  const views = {
    approvals: { el: 'approvalsView', btn: 'tabApprovalsBtn' },
    person: { el: 'personView', btn: 'tabPersonBtn' },
    schedule: { el: 'scheduleView', btn: 'tabScheduleBtn' },
    people: { el: 'peopleView', btn: 'tabPeopleBtn' }
  };

  Object.keys(views).forEach(function(key) {
    const v = document.getElementById(views[key].el);
    const b = document.getElementById(views[key].btn);
    if (v) v.style.display = (key === view) ? 'block' : 'none';
    if (b) b.classList.toggle('active', key === view);
  });
};

window.refreshPortalData = async function() {
  const btn =document.getElementById('refreshBtn');
  const originalText = btn?.dataset.originalText || btn?.textContent;
  if (btn) {
    btn.dataset.originalText = originalText;
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
  }

  try {
    allClaimsCache = await callGas('getAllClaims', [activeAuthToken]);
    populateDatalists();
    renderTable();
    if (document.getElementById('personSearchInput')?.value.trim()) {
      onPersonNameChange();
    }

    if (btn) {
      btn.textContent = 'Refreshed!';
    }
  } catch (err) {
    handleSessionError(err);
    if (btn) {
      btn.textContent = 'Refresh failed';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        btn.textContent = originalText;
      }, 2000); // Resets after 2 seconds
    }
  }
};

function parseHoursToMins(hhmm) {
  const parts = String(hhmm || '').split(':');
  if (parts.length < 2) return 0;
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}

function formatMins(totalMins) {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h + ':' + String(m).padStart(2, '0');
}

function minsToDecimal(totalMins) {
  return (totalMins / 60).toFixed(2);
}

function getFilteredClaims() {
  const statusFilter = document.getElementById('statusFilter').value;
  const query = document.getElementById('searchBox').value.trim().toLowerCase();

  return allClaimsCache.filter(function(c) {
    const isApproved = String(c.status || '').toLowerCase().startsWith('approved');
    if (statusFilter === 'Pending' && isApproved) return false;
    if (statusFilter === 'Approved' && !isApproved) return false;

    if (query) {
      const hay = `${c.invigilatorName} ${c.examPeriod} ${c.weekCommencing} ${c.day}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

window.renderTable = function() {
  const filtered = getFilteredClaims();

  let pendingCount = 0;
  let approvedCount = 0;
  allClaimsCache.forEach(function(c) {
    if (String(c.status || '').toLowerCase().startsWith('approved')) approvedCount++;
    else pendingCount++;
  });

  let filteredMins = 0;
  filtered.forEach(function(c) {
    filteredMins += parseHoursToMins(c.dailyTotal);
  });

  document.getElementById('totalEntries').textContent = allClaimsCache.length;
  document.getElementById('pendingCount').textContent = pendingCount;
  document.getElementById('approvedCount').textContent = approvedCount;
  document.getElementById('filteredHours').textContent = `${formatMins(filteredMins)} (${minsToDecimal(filteredMins)}h)`;

  const tbody = document.getElementById('tableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:18px; color:#6b7280;">No matching claims found.</td></tr>';
    return;
  }

tbody.innerHTML = filtered.map(function(c) {
    const isApproved = String(c.status || '').toLowerCase().startsWith('approved');
    const sessions = [];
    if (c.amWorked === 'Yes') sessions.push(`AM ${c.amStart}–${c.amFinish}${c.amExtra ? ' (+' + c.amExtra + 'm)' : ''}`);
    if (c.pmWorked === 'Yes') sessions.push(`PM ${c.pmStart}–${c.pmFinish}${c.pmExtra ? ' (+' + c.pmExtra + 'm)' : ''}`);
    const rowMins = parseHoursToMins(c.dailyTotal);

    // Strip everything from the '@' symbol onwards (e.g., "j.smith@school.ac.uk" -> "j.smith")
    const rawName = String(c.invigilatorName || '');
    const displayName = rawName.includes('@') ? rawName.split('@')[0] : rawName;

    return `
      <tr>
        <td><strong>${escapeHtml(displayName)}</strong></td>
        <td>${escapeHtml(c.examPeriod)}<br><small style="color:#6b7280;">W/C ${escapeHtml(c.weekCommencing)}</small></td>
        <td><strong>${escapeHtml(c.day)}</strong><br><small>${escapeHtml(sessions.join(' | ') || 'Extra mins only')}</small></td>
        <td><strong>${escapeHtml(c.dailyTotal)}</strong> <small style="color:#6b7280;">(${minsToDecimal(rowMins)})</small></td>
        <td style="color:${isApproved ? '#15803d' : '#b45309'}; font-weight:700;">${escapeHtml(c.status)}</td>
        <td style="white-space:nowrap;">
          ${!isApproved ? `<button type="button" class="approve-btn" onclick="approveSingleRow(${c.rowNumber})">Approve</button>` : ''}
          <button type="button" class="edit-btn" onclick="openEditModal(${c.rowNumber})">Edit</button>
          <button type="button" class="delete-btn" onclick="deleteSingleRow(${c.rowNumber})">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}
window.approveSingleRow = async function(rowNumber) {
  try {
    allClaimsCache = await callGas('approveMultipleRows', [activeAuthToken, [rowNumber], activeManagerName]);
    renderTable();
  } catch (err) {
    handleSessionError(err);
  }
};

window.approveAllFiltered = async function() {
  const pendingRows = getFilteredClaims()
    .filter(c => !String(c.status || '').toLowerCase().startsWith('approved'))
    .map(c => c.rowNumber);

  if (pendingRows.length === 0) {
    alert('There are no pending claims in the current filter.');
    return;
  }
  if (!confirm(`Approve ${pendingRows.length} pending claim(s)?`)) return;

  try {
    allClaimsCache = await callGas('approveMultipleRows', [activeAuthToken, pendingRows, activeManagerName]);
    renderTable();
  } catch (err) {
    handleSessionError(err);
  }
};

window.deleteSingleRow = async function(rowNumber) {
  const claim = allClaimsCache.find(c => c.rowNumber === rowNumber);
  if (!claim) return;
  if (!confirm(`Delete ${claim.invigilatorName}'s claim for ${claim.day} (W/C ${claim.weekCommencing})?`)) return;

  try {
    allClaimsCache = await callGas('deleteClaimRow', [activeAuthToken, rowNumber, claim, activeManagerName]);
    renderTable();
  } catch (err) {
    handleSessionError(err);
  }
};

// Restored Filtered CSV Export with HH:MM, Decimal Hours, and Totals Row
window.exportFilteredCSV = function() {
  const rows = getFilteredClaims();
  if (!rows.length) {
    alert('No rows to export.');
    return;
  }

  let grandMins = 0;
  const headers = [
    'Invigilator', 'Exam Period', 'Week Commencing', 'Day',
    'AM Worked', 'AM Start', 'AM Finish',
    'PM Worked', 'PM Start', 'PM Finish',
    'AM Extra (mins)', 'PM Extra (mins)',
    'Total Hours (HH:MM)', 'Decimal Hours', 'Status'
  ];

  const dataLines = rows.map(r => {
    const mins = parseHoursToMins(r.dailyTotal);
    grandMins += mins;
    const decHours = minsToDecimal(mins);

    return [
      r.invigilatorName, r.examPeriod, r.weekCommencing, r.day,
      r.amWorked, r.amStart, r.amFinish,
      r.pmWorked, r.pmStart, r.pmFinish,
      r.amExtra || 0, r.pmExtra || 0,
      r.dailyTotal, decHours, r.status
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
  });

  const totalLine = [
    'TOTAL', '', '', '', '', '', '', '', '', '', '', '',
    formatMins(grandMins), minsToDecimal(grandMins), `${rows.length} entries`
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');

  const csv = '\uFEFF' + [headers.join(','), ...dataLines, '', totalLine].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Invigilator_Claims_Export.csv';
  a.click();
};

// Edit Modal
window.openEditModal = function(rowNumber) {
  const c = allClaimsCache.find(item => item.rowNumber === rowNumber);
  if (!c) return;
  editingRowNumber = rowNumber;

  document.getElementById('editModalWho').textContent = `${c.invigilatorName} — ${c.examPeriod} (W/C ${c.weekCommencing}, ${c.day})`;
  document.getElementById('editApprovedNote').style.display = String(c.status || '').toLowerCase().startsWith('approved') ? 'block' : 'none';

  document.getElementById('editAmWorked').checked = c.amWorked === 'Yes';
  document.getElementById('editAmStart').value = c.amStart || '';
  document.getElementById('editAmFinish').value = c.amFinish || '';
  document.getElementById('editAmExtra').value = c.amExtra || 0;

  document.getElementById('editPmWorked').checked = c.pmWorked === 'Yes';
  document.getElementById('editPmStart').value = c.pmStart || '';
  document.getElementById('editPmFinish').value = c.pmFinish || '';
  document.getElementById('editPmExtra').value = c.pmExtra || 0;

  document.getElementById('editErr').textContent = '';
  recalcEditTotal();
  document.getElementById('editModal').style.display = 'flex';
};

window.closeEditModal = function() {
  editingRowNumber = null;
  document.getElementById('editModal').style.display = 'none';
};

window.recalcEditTotal = function() {
  let mins = (Number(document.getElementById('editAmExtra').value) || 0) + (Number(document.getElementById('editPmExtra').value) || 0);
  if (document.getElementById('editAmWorked').checked) {
    const s = parseHoursToMins(document.getElementById('editAmStart').value);
    const f = parseHoursToMins(document.getElementById('editAmFinish').value);
    if (f > s) mins += (f - s);
  }
  if (document.getElementById('editPmWorked').checked) {
    const s = parseHoursToMins(document.getElementById('editPmStart').value);
    const f = parseHoursToMins(document.getElementById('editPmFinish').value);
    if (f > s) mins += (f - s);
  }
  document.getElementById('editTotalPreview').textContent = `New Daily Total: ${formatMins(mins)} (${minsToDecimal(mins)} hrs)`;
};

window.saveEdit = async function() {
  if (!editingRowNumber) return;
  const payload = {
    amWorked: document.getElementById('editAmWorked').checked ? 'Yes' : 'No',
    amStart: document.getElementById('editAmStart').value.trim(),
    amFinish: document.getElementById('editAmFinish').value.trim(),
    amExtra: Number(document.getElementById('editAmExtra').value) || 0,
    pmWorked: document.getElementById('editPmWorked').checked ? 'Yes' : 'No',
    pmStart: document.getElementById('editPmStart').value.trim(),
    pmFinish: document.getElementById('editPmFinish').value.trim(),
    pmExtra: Number(document.getElementById('editPmExtra').value) || 0
  };

  try {
    allClaimsCache = await callGas('updateClaimRow', [activeAuthToken, editingRowNumber, payload, activeManagerName]);
    closeEditModal();
    renderTable();
  } catch (err) {
    document.getElementById('editErr').textContent = err && err.message ? err.message : String(err);
  }
};

// Individual Time Sheet Tab (Restored Table with Decimal Column & Summary Footer)
function populateDatalists() {
  const names = [...new Set(allClaimsCache.map(c => c.invigilatorName).filter(Boolean))].sort();
  const periods = [...new Set(allClaimsCache.map(c => c.examPeriod).filter(Boolean))].sort();

  const invigList = document.getElementById('invigilatorList');
  if (invigList) invigList.innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');

  const periodList = document.getElementById('periodOptionsList');
  if (periodList) periodList.innerHTML = periods.map(p => `<option value="${escapeHtml(p)}"></option>`).join('');

  populateAllExportFilters();
}

// ---------- Month filter helpers for the Individual Time Sheet ----------

const DAY_INDEX = { MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3, FRIDAY: 4, SATURDAY: 5, SUNDAY: 6 };

// The real date of a claim row = Week Commencing + the weekday.
// Accepts 14/04/2027, 14/4/27, 14-04-2027 ...
function claimDayDate(c) {
  const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(String(c.weekCommencing || '').trim());
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  const d = new Date(year, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  const offset = DAY_INDEX[String(c.day || '').trim().toUpperCase()];
  if (offset) d.setDate(d.getDate() + offset);
  return isNaN(d.getTime()) ? null : d;
}

function monthKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function monthLabel(key) {
  const p = key.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// Fills the month drop-down with only the months this person has claims in. Keeps the current choice if still valid.
function setPersonMonthOptions(claims) {
  const sel = document.getElementById('personMonthFilter');
  if (!sel) return;
  const previous = sel.value;
  const keys = [...new Set(claims.map(claimDayDate).filter(Boolean).map(monthKey))].sort();

  sel.innerHTML = '<option value="">All Months</option>' +
    keys.map(k => `<option value="${k}">${escapeHtml(monthLabel(k))}</option>`).join('');
  sel.value = keys.includes(previous) ? previous : '';
}

// Name + month selection, used by the on-screen table AND the export.
function getPersonSelection() {
  const name = document.getElementById('personSearchInput').value.trim();
  const month = document.getElementById('personMonthFilter').value;
  const all = name
    ? allClaimsCache.filter(c => String(c.invigilatorName || '').toLowerCase() === name.toLowerCase())
    : [];
  const claims = month
    ? all.filter(c => { const d = claimDayDate(c); return d && monthKey(d) === month; })
    : all;
  return { name, month, all, claims };
}

window.onPersonNameChange = function() {
  const container = document.getElementById('personSheetContainer');
  const name = document.getElementById('personSearchInput').value.trim();

  if (!name) {
    setPersonMonthOptions([]);
    container.innerHTML = '';
    return;
  }

  // Build the month list from ALL of this person's claims first, then apply the chosen month.
  const everyClaim = allClaimsCache.filter(c => String(c.invigilatorName || '').toLowerCase() === name.toLowerCase());
  setPersonMonthOptions(everyClaim);

  const { month, claims: personClaims } = getPersonSelection();

  if (!everyClaim.length) {
    container.innerHTML = '<p style="padding:14px; color:#6b7280;">No claims found for this invigilator.</p>';
    return;
  }
  if (!personClaims.length) {
    container.innerHTML = '<p style="padding:14px; color:#6b7280;">No claims found for this invigilator in that month.</p>';
    return;
  }

  let totalMins = 0;
  let approvedMins = 0;
  let pendingMins = 0;

  const rowsHtml = personClaims.map(c => {
    const mins = parseHoursToMins(c.dailyTotal);
    totalMins += mins;
    if (String(c.status || '').toLowerCase().startsWith('approved')) approvedMins += mins;
    else pendingMins += mins;

    return `
      <tr>
        <td>${escapeHtml(c.examPeriod)}</td>
        <td>${escapeHtml(c.weekCommencing)}</td>
        <td>${escapeHtml(c.day)}</td>
        <td>${c.amWorked === 'Yes' ? escapeHtml(c.amStart + '–' + c.amFinish) : '—'}</td>
        <td>${c.pmWorked === 'Yes' ? escapeHtml(c.pmStart + '–' + c.pmFinish) : '—'}</td>
        <td>${(c.amExtra || 0) + (c.pmExtra || 0)}m</td>
        <td><strong>${escapeHtml(c.dailyTotal)}</strong></td>
        <td><strong>${minsToDecimal(mins)}</strong></td>
        <td>${escapeHtml(c.status)}</td>
      </tr>
    `;
  }).join('');

  const monthTitle = month ? ` — ${escapeHtml(monthLabel(month))}` : '';

  container.innerHTML = `
    <div style="display:flex; gap:16px; flex-wrap:wrap; margin:12px 0; padding:10px 14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; font-size:13px;">
      <span><strong>Total Claimed${monthTitle}:</strong> ${formatMins(totalMins)} (${minsToDecimal(totalMins)} hrs)</span>
      <span style="color:#15803d;"><strong>Approved:</strong> ${formatMins(approvedMins)} (${minsToDecimal(approvedMins)} hrs)</span>
      <span style="color:#b45309;"><strong>Pending:</strong> ${formatMins(pendingMins)} (${minsToDecimal(pendingMins)} hrs)</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Exam Period</th>
            <th>Week Com</th>
            <th>Day</th>
            <th>AM</th>
            <th>PM</th>
            <th>Extra</th>
            <th>HH:MM</th>
            <th>Decimal</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr style="background:#f1f5f9; font-weight:700;">
            <td colspan="6" style="text-align:right;">Total Hours:</td>
            <td>${formatMins(totalMins)}</td>
            <td>${minsToDecimal(totalMins)}</td>
            <td>${personClaims.length} shift(s)</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
};

window.exportIndividualTimesheet = async function() {
  const { name, month, claims: personClaims } = getPersonSelection();
  if (!name) {
    alert('Select an invigilator first.');
    return;
  }
  if (!personClaims.length) {
    alert('No claims to export for ' + name + (month ? ' in ' + monthLabel(month) : '') + '.');
    return;
  }

  // Group claims by Week Commencing (preserving chronological order)
  const weeksMap = new Map();
  personClaims.forEach(c => {
    const wk = String(c.weekCommencing || 'TBC').trim();
    if (!weeksMap.has(wk)) weeksMap.set(wk, []);
    weeksMap.get(wk).push(c);
  });

  // Initialise ExcelJS Workbook & Worksheet
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Timesheet', {
    views: [{ showGridLines: true }]
  });

  // Column widths matching your screenshot layout (Cols A to J)
  ws.columns = [
    { width: 22 }, // A: EXAM SESSIONS / Day
    { width: 16 }, // B: AM START INC SET UP
    { width: 22 }, // C: AM FINISH INC PACK UP/SET UP
    { width: 18 }, // D: SESSIONS WORKED (AM)
    { width: 16 }, // E: PM START INC SET UP
    { width: 22 }, // F: PM FINISH INC PACK UP/SET UP
    { width: 18 }, // G: SESSIONS WORKED (PM)
    { width: 22 }, // H: ADDITIONAL HOURS AM
    { width: 10 }, // I: Sage Green Spacer Column
    { width: 22 }  // J: ADDITIONAL HOURS PM
  ];

  // Styling matching your screenshot
  const sageGreenFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFA9C49A' }
  };
  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } }
  };
  const headerFont = { name: 'Arial', size: 10, bold: true };
  const bodyFont = { name: 'Arial', size: 10, bold: false };
  const boldFont = { name: 'Arial', size: 10, bold: true };

  // Invigilator & Period Banner at top
  ws.mergeCells('A1:J1');
  const titleCell = ws.getCell('A1');
  const periodSuffix = month ? ` — ${monthLabel(month).toUpperCase()}` : '';
  titleCell.value = `UPTON-BY-CHESTER HIGH SCHOOL — INVIGILATOR: ${name.toUpperCase()}${periodSuffix}`;
  titleCell.font = { name: 'Arial', size: 11, bold: true };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 24;

  let currentRow = 3;
  let grandTotalMins = 0;
  const DAYS_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

  // Build one table block per Week Commencing
  weeksMap.forEach((weekClaims, weekLabel) => {
    // 1. Header Row
    const hdrRow = ws.getRow(currentRow);
    hdrRow.height = 30;
    ws.mergeCells(`H${currentRow}:J${currentRow}`);

    const headers = {
      1: 'EXAM SESSIONS',
      2: 'AM START\nINC SET UP',
      3: 'AM FINISH\nINC PACK UP/SET UP',
      4: 'SESSIONS WORKED',
      5: 'PM START\nINC SET UP',
      6: 'PM FINISH\nINC PACK UP/SET UP',
      7: 'SESSIONS WORKED',
      8: 'ADDITIONAL HOURS AGREED WITH EXAM TEAM DUE TO ET / RB'
    };

    for (let col = 1; col <= 10; col++) {
      const cell = hdrRow.getCell(col);
      if (headers[col]) cell.value = headers[col];
      cell.font = headerFont;
      cell.border = thinBorder;
      cell.alignment = {
        vertical: 'bottom',
        horizontal: col === 1 ? 'left' : 'center',
        wrapText: true
      };
    }
    currentRow++;

    // 2. Sub-header Row ("WEEK COM ...")
    const subRow = ws.getRow(currentRow);
    subRow.height = 20;

    subRow.getCell(1).value = `WEEK COM ${weekLabel}`;
    subRow.getCell(1).font = bodyFont;
    subRow.getCell(1).border = thinBorder;
    subRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

    for (let col = 2; col <= 7; col++) {
      const c = subRow.getCell(col);
      c.fill = sageGreenFill;
      c.border = thinBorder;
    }

    subRow.getCell(8).value = 'AM';
    subRow.getCell(8).font = bodyFont;
    subRow.getCell(8).border = thinBorder;
    subRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'left' };

    subRow.getCell(9).fill = sageGreenFill;
    subRow.getCell(9).border = thinBorder;

    subRow.getCell(10).value = 'PM';
    subRow.getCell(10).font = bodyFont;
    subRow.getCell(10).border = thinBorder;
    subRow.getCell(10).alignment = { vertical: 'middle', horizontal: 'left' };

    currentRow++;

    // 3. Monday – Friday Rows
    DAYS_ORDER.forEach(dayName => {
      const match = weekClaims.find(c => String(c.day || '').trim().toUpperCase() === dayName);
      const r = ws.getRow(currentRow);
      r.height = 19;

      if (match) {
        grandTotalMins += parseHoursToMins(match.dailyTotal);
      }

      const amWorked = match && match.amWorked === 'Yes';
      const pmWorked = match && match.pmWorked === 'Yes';
      const amExtraMins = match ? Number(match.amExtra || 0) : 0;
      const pmExtraMins = match ? Number(match.pmExtra || 0) : 0;

      r.getCell(1).value = dayName;
      r.getCell(2).value = amWorked ? (match.amStart || '') : '';
      r.getCell(3).value = amWorked ? (match.amFinish || '') : '';
      r.getCell(4).value = amWorked ? '☑' : '☐';
      r.getCell(5).value = pmWorked ? (match.pmStart || '') : '';
      r.getCell(6).value = pmWorked ? (match.pmFinish || '') : '';
      r.getCell(7).value = pmWorked ? '☑' : '☐';
      r.getCell(8).value = amExtraMins > 0 ? formatMins(amExtraMins) : '';
      r.getCell(9).value = ''; // Sage green vertical spacer
      r.getCell(10).value = pmExtraMins > 0 ? formatMins(pmExtraMins) : '';

      for (let col = 1; col <= 10; col++) {
        const cell = r.getCell(col);
        cell.font = bodyFont;
        cell.border = thinBorder;

        if (col === 9) {
          cell.fill = sageGreenFill;
        } else if (col === 1) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }
      currentRow++;
    });

    // 4. Full-width Sage Green Divider Row between weeks
    const sepRow = ws.getRow(currentRow);
    sepRow.height = 14;
    for (let col = 1; col <= 10; col++) {
      const cell = sepRow.getCell(col);
      cell.fill = sageGreenFill;
      cell.border = thinBorder;
    }
    currentRow++;
  });

  // 5. Footer Totals (HH:MM:SS + Decimal Hours for Finance)
  const formattedHHMMSS = `${formatMins(grandTotalMins)}:00`;
  const decimalHours = Number(minsToDecimal(grandTotalMins));

  // Row 1: TOTAL HOURS CLAIMED (HH:MM:SS) + Certification statement
  const totalRow = ws.getRow(currentRow);
  totalRow.height = 20;

  totalRow.getCell(1).value = 'I certify that I have worked the hours claimed above:';
  totalRow.getCell(1).font = boldFont;
  totalRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

  totalRow.getCell(8).value = 'TOTAL HOURS CLAIMED';
  totalRow.getCell(8).font = boldFont;
  totalRow.getCell(8).border = thinBorder;
  totalRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'left' };

  ws.mergeCells(`I${currentRow}:J${currentRow}`);
  const hhmmCell = totalRow.getCell(9);
  hhmmCell.value = formattedHHMMSS;
  hhmmCell.font = boldFont;
  hhmmCell.alignment = { horizontal: 'center', vertical: 'middle' };
  totalRow.getCell(9).border = thinBorder;
  totalRow.getCell(10).border = thinBorder;
  currentRow++;

  // Row 2: TOTAL HOURS (DECIMAL) for Finance
  const decimalRow = ws.getRow(currentRow);
  decimalRow.height = 20;

  decimalRow.getCell(8).value = 'TOTAL HOURS (DECIMAL)';
  decimalRow.getCell(8).font = boldFont;
  decimalRow.getCell(8).border = thinBorder;
  decimalRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'left' };

  ws.mergeCells(`I${currentRow}:J${currentRow}`);
  const decCell = decimalRow.getCell(9);
  decCell.value = decimalHours;
  decCell.numFmt = '0.00'; // Formats cleanly to 2 decimal places (e.g. 14.75) for Finance
  decCell.font = boldFont;
  decCell.alignment = { horizontal: 'center', vertical: 'middle' };
  decimalRow.getCell(9).border = thinBorder;
  decimalRow.getCell(10).border = thinBorder;

  // 6. Download .xlsx file
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/\s+/g, '_')}${month ? '_' + month : ''}_Timesheet.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- Export ALL invigilators to ONE Excel sheet (for Finance to print) ----------

const XL_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const XL_SAGE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA9C49A' } };
const XL_NAVY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D2D6C' } };
const XL_GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const XL_BORDER = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } }
};
const XL_BODY_FONT = { name: 'Arial', size: 10, bold: false };
const XL_BOLD_FONT = { name: 'Arial', size: 10, bold: true };

// "[Lead] PPE" and "[Supporting] PPE" are both the exam period "PPE".
function basePeriodName(p) {
  return String(p || '').replace(/^\[(Lead|Supporting)\]\s*/i, '').trim();
}

// Week-commencing text -> a sortable number (so 16/11/26 and 16/11/2026 sort and group together).
function weekSortValue(label) {
  const d = claimDayDate({ weekCommencing: label, day: 'MONDAY' });
  return d ? d.getTime() : 0;
}

// Fills the Exam Period drop-down, then the Month drop-down for that period.
function populateAllExportFilters() {
  const periodSel = document.getElementById('allExportPeriod');
  if (!periodSel) return;
  const previous = periodSel.value;
  const periods = [...new Set(allClaimsCache.map(c => basePeriodName(c.examPeriod)).filter(Boolean))].sort();
  periodSel.innerHTML = '<option value="">All Exam Periods</option>' +
    periods.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  periodSel.value = periods.includes(previous) ? previous : '';
  refreshAllExportMonths();
}

// Months offered = only months that have claims in the chosen exam period.
function refreshAllExportMonths() {
  const periodSel = document.getElementById('allExportPeriod');
  const monthSel = document.getElementById('allExportMonth');
  if (!periodSel || !monthSel) return;
  const previous = monthSel.value;
  const period = periodSel.value;
  const pool = period ? allClaimsCache.filter(c => basePeriodName(c.examPeriod) === period) : allClaimsCache;
  const keys = [...new Set(pool.map(claimDayDate).filter(Boolean).map(monthKey))].sort();
  monthSel.innerHTML = '<option value="">All Months</option>' +
    keys.map(k => `<option value="${k}">${escapeHtml(monthLabel(k))}</option>`).join('');
  monthSel.value = keys.includes(previous) ? previous : '';
}

// One Mon-Fri row. Used for real claims and for empty days.
function xlWriteDayRow(ws, rowIdx, label, claim) {
  const r = ws.getRow(rowIdx);
  r.height = 19;

  const amWorked = claim && claim.amWorked === 'Yes';
  const pmWorked = claim && claim.pmWorked === 'Yes';
  const amExtraMins = claim ? Number(claim.amExtra || 0) : 0;
  const pmExtraMins = claim ? Number(claim.pmExtra || 0) : 0;

  r.getCell(1).value = label;
  r.getCell(2).value = amWorked ? (claim.amStart || '') : '';
  r.getCell(3).value = amWorked ? (claim.amFinish || '') : '';
  r.getCell(4).value = amWorked ? '☑' : '☐';
  r.getCell(5).value = pmWorked ? (claim.pmStart || '') : '';
  r.getCell(6).value = pmWorked ? (claim.pmFinish || '') : '';
  r.getCell(7).value = pmWorked ? '☑' : '☐';
  r.getCell(8).value = amExtraMins > 0 ? formatMins(amExtraMins) : '';
  r.getCell(9).value = '';
  r.getCell(10).value = pmExtraMins > 0 ? formatMins(pmExtraMins) : '';

  for (let col = 1; col <= 10; col++) {
    const cell = r.getCell(col);
    cell.font = XL_BODY_FONT;
    cell.border = XL_BORDER;
    if (col === 9) cell.fill = XL_SAGE;
    else if (col === 1) cell.alignment = { horizontal: 'left', vertical: 'middle' };
    else cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
}

// One week table (header, WEEK COM row, Mon-Fri, green divider). Returns the next free row and the week's minutes.
function xlWriteWeekBlock(ws, startRow, weekLabel, weekClaims) {
  let row = startRow;
  let mins = 0;

  const hdrRow = ws.getRow(row);
  hdrRow.height = 30;
  ws.mergeCells(`H${row}:J${row}`);
  const headers = {
    1: 'EXAM SESSIONS',
    2: 'AM START\nINC SET UP',
    3: 'AM FINISH\nINC PACK UP/SET UP',
    4: 'SESSIONS WORKED',
    5: 'PM START\nINC SET UP',
    6: 'PM FINISH\nINC PACK UP/SET UP',
    7: 'SESSIONS WORKED',
    8: 'ADDITIONAL HOURS AGREED WITH EXAM TEAM DUE TO ET / RB'
  };
  for (let col = 1; col <= 10; col++) {
    const cell = hdrRow.getCell(col);
    if (headers[col]) cell.value = headers[col];
    cell.font = XL_BOLD_FONT;
    cell.border = XL_BORDER;
    cell.alignment = { vertical: 'bottom', horizontal: col === 1 ? 'left' : 'center', wrapText: true };
  }
  row++;

  const subRow = ws.getRow(row);
  subRow.height = 20;
  subRow.getCell(1).value = `WEEK COM ${weekLabel}`;
  subRow.getCell(1).font = XL_BODY_FONT;
  subRow.getCell(1).border = XL_BORDER;
  subRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  for (let col = 2; col <= 7; col++) {
    subRow.getCell(col).fill = XL_SAGE;
    subRow.getCell(col).border = XL_BORDER;
  }
  subRow.getCell(8).value = 'AM';
  subRow.getCell(8).font = XL_BODY_FONT;
  subRow.getCell(8).border = XL_BORDER;
  subRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'left' };
  subRow.getCell(9).fill = XL_SAGE;
  subRow.getCell(9).border = XL_BORDER;
  subRow.getCell(10).value = 'PM';
  subRow.getCell(10).font = XL_BODY_FONT;
  subRow.getCell(10).border = XL_BORDER;
  subRow.getCell(10).alignment = { vertical: 'middle', horizontal: 'left' };
  row++;

  // Mon-Fri. If someone has two claims for the same day, both are shown so no hours are hidden.
  XL_DAYS.forEach(dayName => {
    const matches = weekClaims.filter(c => String(c.day || '').trim().toUpperCase() === dayName);
    if (!matches.length) {
      xlWriteDayRow(ws, row++, dayName, null);
      return;
    }
    matches.forEach((m, i) => {
      xlWriteDayRow(ws, row++, i === 0 ? dayName : `${dayName} (${i + 1})`, m);
      mins += parseHoursToMins(m.dailyTotal);
    });
  });

  // Anything not Mon-Fri (e.g. a Saturday session) is still listed.
  weekClaims
    .filter(c => !XL_DAYS.includes(String(c.day || '').trim().toUpperCase()))
    .forEach(c => {
      xlWriteDayRow(ws, row++, String(c.day || '').toUpperCase(), c);
      mins += parseHoursToMins(c.dailyTotal);
    });

  const sepRow = ws.getRow(row);
  sepRow.height = 14;
  for (let col = 1; col <= 10; col++) {
    sepRow.getCell(col).fill = XL_SAGE;
    sepRow.getCell(col).border = XL_BORDER;
  }
  row++;

  return { nextRow: row, mins: mins };
}

window.exportAllTimesheets = async function() {
  const period = document.getElementById('allExportPeriod').value;
  const month = document.getElementById('allExportMonth').value;
  const approvedOnly = document.getElementById('allExportStatus').value === 'Approved';

  const claims = allClaimsCache.filter(c => {
    if (period && basePeriodName(c.examPeriod) !== period) return false;
    if (approvedOnly && !String(c.status || '').toLowerCase().startsWith('approved')) return false;
    if (month) {
      const d = claimDayDate(c);
      if (!d || monthKey(d) !== month) return false;
    }
    return true;
  });

  if (!claims.length) {
    alert('No ' + (approvedOnly ? 'approved ' : '') + 'claims match those filters.');
    return;
  }

  // invigilator -> exam period -> week
  const people = new Map();
  claims.forEach(c => {
    const name = String(c.invigilatorName || 'Unknown').trim();
    const pKey = name.toLowerCase();
    if (!people.has(pKey)) people.set(pKey, { name: name, periods: new Map(), mins: 0 });
    const person = people.get(pKey);
    person.mins += parseHoursToMins(c.dailyTotal);

    const examPeriod = String(c.examPeriod || '').trim() || 'Exam Period';
    if (!person.periods.has(examPeriod)) person.periods.set(examPeriod, new Map());
    const weeks = person.periods.get(examPeriod);

    const label = String(c.weekCommencing || 'TBC').trim();
    const wKey = weekSortValue(label) || label;
    if (!weeks.has(wKey)) weeks.set(wKey, { label: label, claims: [] });
    weeks.get(wKey).claims.push(c);
  });

  const sortedPeople = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
  const grandMins = sortedPeople.reduce((t, p) => t + p.mins, 0);

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('All Timesheets', { views: [{ showGridLines: true }] });

  ws.columns = [
    { width: 22 }, { width: 16 }, { width: 22 }, { width: 18 }, { width: 16 },
    { width: 22 }, { width: 18 }, { width: 22 }, { width: 10 }, { width: 22 }
  ];

  // Print setup: A4 landscape, one page wide, page numbers in the footer.
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 }
  };
  ws.headerFooter.oddFooter = '&LUpton-by-Chester High School - Invigilator Time Sheets&CPage &P of &N&R&D';

  // ---- Page 1: title, filters and a summary of every invigilator's hours ----
  ws.mergeCells('A1:J1');
  const title = ws.getCell('A1');
  title.value = 'UPTON-BY-CHESTER HIGH SCHOOL — ALL INVIGILATOR TIME SHEETS';
  title.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = XL_NAVY;
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 28;

  ws.mergeCells('A2:J2');
  const info = ws.getCell('A2');
  info.value =
    `Exam period: ${period || 'All'}   |   Month: ${month ? monthLabel(month) : 'All'}   |   Hours: ${approvedOnly ? 'Approved only' : 'All claimed (including pending)'}   |   Printed: ${new Date().toLocaleDateString('en-GB')}`;
  info.font = XL_BODY_FONT;
  info.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(2).height = 20;

  let row = 4;
  ws.mergeCells(`A${row}:C${row}`);
  ws.getCell(`A${row}`).value = 'INVIGILATOR';
  ws.getCell(`D${row}`).value = 'TOTAL (HH:MM:SS)';
  ws.getCell(`E${row}`).value = 'DECIMAL HOURS';
  for (let col = 1; col <= 5; col++) {
    const cell = ws.getRow(row).getCell(col);
    cell.font = XL_BOLD_FONT;
    cell.fill = XL_GREY;
    cell.border = XL_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center', wrapText: true };
  }
  ws.getRow(row).height = 22;
  row++;

  sortedPeople.forEach(p => {
    ws.mergeCells(`A${row}:C${row}`);
    ws.getCell(`A${row}`).value = p.name;
    ws.getCell(`D${row}`).value = `${formatMins(p.mins)}:00`;
    const dec = ws.getCell(`E${row}`);
    dec.value = Number(minsToDecimal(p.mins));
    dec.numFmt = '0.00';
    for (let col = 1; col <= 5; col++) {
      const cell = ws.getRow(row).getCell(col);
      cell.font = XL_BODY_FONT;
      cell.border = XL_BORDER;
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center' };
    }
    ws.getRow(row).height = 19;
    row++;
  });

  ws.mergeCells(`A${row}:C${row}`);
  ws.getCell(`A${row}`).value = 'GRAND TOTAL';
  ws.getCell(`D${row}`).value = `${formatMins(grandMins)}:00`;
  const grandDec = ws.getCell(`E${row}`);
  grandDec.value = Number(minsToDecimal(grandMins));
  grandDec.numFmt = '0.00';
  for (let col = 1; col <= 5; col++) {
    const cell = ws.getRow(row).getCell(col);
    cell.font = XL_BOLD_FONT;
    cell.fill = XL_SAGE;
    cell.border = XL_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center' };
  }
  ws.getRow(row).height = 21;
  ws.getRow(row).addPageBreak();
  row += 2;

  // ---- Then each invigilator's time sheet, starting on a new printed page ----
  sortedPeople.forEach((p, idx) => {
    ws.mergeCells(`A${row}:J${row}`);
    const banner = ws.getCell(`A${row}`);
    banner.value = `INVIGILATOR: ${p.name.toUpperCase()}`;
    banner.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    banner.fill = XL_NAVY;
    banner.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(row).height = 24;
    row += 2;

    [...p.periods.keys()].sort().forEach(examPeriod => {
      ws.mergeCells(`A${row}:J${row}`);
      const sub = ws.getCell(`A${row}`);
      sub.value = `EXAM PERIOD: ${examPeriod.toUpperCase()}`;
      sub.font = XL_BOLD_FONT;
      sub.fill = XL_GREY;
      sub.border = XL_BORDER;
      sub.alignment = { vertical: 'middle', horizontal: 'left' };
      ws.getRow(row).height = 20;
      row++;

      const weeks = [...p.periods.get(examPeriod).entries()]
        .sort((a, b) => (typeof a[0] === 'number' && typeof b[0] === 'number') ? a[0] - b[0] : String(a[0]).localeCompare(String(b[0])));

      weeks.forEach(entry => {
        const block = xlWriteWeekBlock(ws, row, entry[1].label, entry[1].claims);
        row = block.nextRow;
      });
    });

    // Invigilator totals, in the same layout as the individual time sheet
    const totalRow = ws.getRow(row);
    totalRow.height = 20;
    totalRow.getCell(1).value = 'I certify that I have worked the hours claimed above:';
    totalRow.getCell(1).font = XL_BOLD_FONT;
    totalRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    totalRow.getCell(8).value = 'TOTAL HOURS CLAIMED';
    totalRow.getCell(8).font = XL_BOLD_FONT;
    totalRow.getCell(8).border = XL_BORDER;
    totalRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'left' };
    ws.mergeCells(`I${row}:J${row}`);
    totalRow.getCell(9).value = `${formatMins(p.mins)}:00`;
    totalRow.getCell(9).font = XL_BOLD_FONT;
    totalRow.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
    totalRow.getCell(9).border = XL_BORDER;
    totalRow.getCell(10).border = XL_BORDER;
    row++;

    const decRow = ws.getRow(row);
    decRow.height = 20;
    decRow.getCell(8).value = 'TOTAL HOURS (DECIMAL)';
    decRow.getCell(8).font = XL_BOLD_FONT;
    decRow.getCell(8).border = XL_BORDER;
    decRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'left' };
    ws.mergeCells(`I${row}:J${row}`);
    decRow.getCell(9).value = Number(minsToDecimal(p.mins));
    decRow.getCell(9).numFmt = '0.00';
    decRow.getCell(9).font = XL_BOLD_FONT;
    decRow.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
    decRow.getCell(9).border = XL_BORDER;
    decRow.getCell(10).border = XL_BORDER;

    if (idx < sortedPeople.length - 1) ws.getRow(row).addPageBreak();
    row += 3;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const safe = s => String(s).replace(/[^\w\-]+/g, '_');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `All_Invigilator_Timesheets${period ? '_' + safe(period) : ''}${month ? '_' + month : ''}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// Schedule Builder Tab
window.copyMondayTimes = function() {
  const rows = document.querySelectorAll('#schedBuilderBody tr');
  if (rows.length < 2) return;
  const mon = rows[0];
  const vals = {
    amS: mon.querySelector('.sb-am-s').value,
    amF: mon.querySelector('.sb-am-f').value,
    pmS: mon.querySelector('.sb-pm-s').value,
    pmF: mon.querySelector('.sb-pm-f').value
  };
  for (let i = 1; i < rows.length; i++) {
    rows[i].querySelector('.sb-am-s').value = vals.amS;
    rows[i].querySelector('.sb-am-f').value = vals.amF;
    rows[i].querySelector('.sb-pm-s').value = vals.pmS;
    rows[i].querySelector('.sb-pm-f').value = vals.pmF;
  }
};

window.submitNewSchedule = async function() {
  const role = document.getElementById('schedRoleInput').value;
  const period = document.getElementById('schedPeriodInput').value.trim();
  const rawDate = document.getElementById('schedWeekInput').value;
  const statusEl = document.getElementById('schedStatusMsg');

  if (!period || !rawDate) {
    statusEl.style.color = '#b91c1c';
    statusEl.textContent = 'Please enter both an Exam Period and a Week Commencing date.';
    return;
  }

  const parts = rawDate.split('-');
  const formattedWeek = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : rawDate;

  const days = Array.from(document.querySelectorAll('#schedBuilderBody tr')).map(tr => ({
    day: tr.getAttribute('data-day'),
    amStart: tr.querySelector('.sb-am-s').value.trim(),
    amFinish: tr.querySelector('.sb-am-f').value.trim(),
    pmStart: tr.querySelector('.sb-pm-s').value.trim(),
    pmFinish: tr.querySelector('.sb-pm-f').value.trim()
  }));

  try {
    await callGas('saveExamSchedule', [activeAuthToken, { role, period, week: formattedWeek, days }]);
    statusEl.style.color = '#15803d';
    statusEl.textContent = 'Schedule saved successfully.';
    loadSchedulesList();
  } catch (err) {
    statusEl.style.color = '#b91c1c';
    statusEl.textContent = err && err.message ? err.message : String(err);
  }
};

async function loadSchedulesList() {
  const container = document.getElementById('existingSchedulesList');
  if (!container) return;
  try {
    const sched = await callGas('getExamSchedule', []);
    const customWeeks = {};
    sched.filter(s => s.source === 'portal').forEach(s => {
      const k = `${s.role}|${s.period}|${s.week}`;
      customWeeks[k] = s;
    });

    const keys = Object.keys(customWeeks);
    if (!keys.length) {
      container.innerHTML = '<p style="color:#6b7280;">No custom portal schedules added yet.</p>';
      return;
    }

    container.innerHTML = keys.map(k => {
      const s = customWeeks[k];
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #e5e7eb;">
          <span><strong>${escapeHtml(s.period)}</strong> — ${escapeHtml(s.role)} (W/C ${escapeHtml(s.week)})</span>
          <button type="button" class="delete-btn"
            onclick="deleteCustomWeek('${escapeHtml(s.role).replace(/'/g, "\\'")}', '${escapeHtml(s.period).replace(/'/g, "\\'")}', '${escapeHtml(s.week).replace(/'/g, "\\'")}')">
            Delete
          </button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

window.deleteCustomWeek = async function(role, period, week) {
  if (!confirm(`Delete schedule for ${period} (${role}, W/C ${week})?`)) return;
  try {
    await callGas('deleteExamWeek', [activeAuthToken, role, period, week]);
    loadSchedulesList();
  } catch (err) {
    handleSessionError(err);
  }
};

// Manage Invigilators Tab (School Email + Auto-Generated 2-Colour + 3-Digit Password)
async function loadPeopleList() {
  const container = document.getElementById('peopleList');
  if (!container) return;
  try {
    const people = await callGas('getInvigilatorsDetailed', [activeAuthToken]);
    if (!people || !people.length) {
      container.innerHTML = '<p style="color:#6b7280;">No invigilators added yet.</p>';
      return;
    }

    container.innerHTML = `
      <div class="table-wrap" style="margin-top:8px;">
        <table>
          <thead>
            <tr>
              <th>Invigilator Name</th>
              <th>School Email</th>
              <th>Portal Password</th>
              <th style="width:200px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${people.map(p => {
              const name = typeof p === 'string' ? p : p.name;
              const email = typeof p === 'string' ? '—' : (p.email || '—');
              const password = typeof p === 'string' ? '' : (p.password || '');
              return `
                <tr>
                  <td><strong>${escapeHtml(name)}</strong></td>
                  <td>${escapeHtml(email)}</td>
                  <td>
                    ${password
                      ? `<span style="background:#f1f5f9; border:1px solid #cbd5e1; padding:3px 9px; border-radius:6px; font-family:monospace; font-weight:700; color:#0d2d6c;">${escapeHtml(password)}</span>`
                      : `<span style="color:#b45309; font-weight:700;">No password yet</span>`}
                  </td>
                  <td style="white-space:nowrap;">
                    <button type="button" class="edit-btn" data-name="${escapeHtml(name)}"
                      onclick="resetPersonPassword(this.dataset.name)">New password</button>
                    <button type="button" class="delete-btn" data-name="${escapeHtml(name)}"
                      onclick="removePerson(this.dataset.name)">Remove</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error(err);
  }
}

window.addPerson = async function() {
  const nameInput = document.getElementById('newPersonName');
  const emailInput = document.getElementById('newPersonEmail');
  const statusEl = document.getElementById('peopleStatusMsg');

  const name = nameInput.value.trim();
  const email = (emailInput?.value || '').trim().toLowerCase();

  if (!name) {
    statusEl.style.color = '#b91c1c';
    statusEl.textContent = 'Please enter the invigilator’s full name.';
    return;
  }
  if (!email || !email.includes('@')) {
    statusEl.style.color = '#b91c1c';
    statusEl.textContent = 'Please enter a valid school email address.';
    return;
  }

  statusEl.style.color = '#0d2d6c';
  statusEl.textContent = 'Adding invigilator and generating portal password...';

  try {
    const created = await callGas('addInvigilator', [activeAuthToken, name, activeManagerName, email]);
    nameInput.value = '';
    if (emailInput) emailInput.value = '';

    statusEl.style.color = '#15803d';
    statusEl.textContent = `Added ${created.name} (${created.email}) — Portal Password: ${created.password}`;
    loadPeopleList();
  } catch (err) {
    statusEl.style.color = '#b91c1c';
    statusEl.textContent = err && err.message ? err.message : String(err);
  }
};

window.resetPersonPassword = async function(name) {
  if (!confirm(`Generate a new portal password for ${name}?\n\nTheir old password will stop working straight away.`)) return;
  const statusEl = document.getElementById('peopleStatusMsg');
  try {
    const updated = await callGas('resetInvigilatorPassword', [activeAuthToken, name]);
    statusEl.style.color = '#15803d';
    statusEl.textContent = `New password for ${updated.name}: ${updated.password}`;
    loadPeopleList();
  } catch (err) {
    handleSessionError(err);
  }
};

window.removePerson = async function(name) {
  if (!confirm(`Remove ${name} from the invigilator list?`)) return;
  try {
    await callGas('removeInvigilator', [activeAuthToken, name]);
    loadPeopleList();
  } catch (err) {
    handleSessionError(err);
  }
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Initialize Google button & restore saved session on page load
window.addEventListener('DOMContentLoaded', async function() {
  initExamsGoogleButton();

  const saved = sessionStorage.getItem('upton_exams_auth');
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    if (parsed && parsed.token) {
      setLoginStatus('Restoring session...', false);
      const claims = await callGas('verifyExamsAccess', [parsed.token]);
      setLoginStatus('', false);
      showPortal(parsed.token, parsed.name, claims);
    }
  } catch (err) {
    sessionStorage.removeItem('upton_exams_auth');
    setLoginStatus('', false);
  }
});