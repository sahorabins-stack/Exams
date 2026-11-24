let activeAuthToken = ''; // Holds either Google ID token or shared EXAMS_PASSCODE
let activeManagerName = 'Head of Exams';
let allClaimsCache = [];
let editingRowNumber = null;

function setLoginStatus(msg, isError) {
  const el = document.getElementById('loginErr');
  if (!el) return;
  el.textContent = msg || '';
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

// Google Sign-In Callback (matched to data-callback="handleExamsGoogleSignIn" in approve.html)
window.handleExamsGoogleSignIn = async function(response) {
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
    setLoginStatus(err && err.message ? err.message : 'Access denied.', true);
  }
};

// Passcode Fallback Unlock (called by onclick="unlockPortal()" in approve.html)
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
  try {
    allClaimsCache = await callGas('getAllClaims', [activeAuthToken]);
    populateDatalists();
    renderTable();
    if (document.getElementById('personSearchInput').value.trim()) {
      onPersonNameChange();
    }
  } catch (err) {
    handleSessionError(err);
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

  // Update KPI Cards
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
  document.getElementById('filteredHours').textContent = formatMins(filteredMins);

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

    return `
      <tr>
        <td><strong>${escapeHtml(c.invigilatorName)}</strong></td>
        <td>${escapeHtml(c.examPeriod)}<br><small style="color:#6b7280;">W/C ${escapeHtml(c.weekCommencing)}</small></td>
        <td><strong>${escapeHtml(c.day)}</strong><br><small>${escapeHtml(sessions.join(' | ') || 'Extra mins only')}</small></td>
        <td><strong>${escapeHtml(c.dailyTotal)}</strong></td>
        <td style="color:${isApproved ? '#15803d' : '#b45309'}; font-weight:700;">${escapeHtml(c.status)}</td>
        <td style="white-space:nowrap;">
          ${!isApproved ? `<button type="button" class="bulk-btn" style="padding:5px 10px; font-size:12px;" onclick="approveSingleRow(${c.rowNumber})">Approve</button>` : ''}
          <button type="button" class="edit-btn" style="padding:5px 10px; font-size:12px;" onclick="openEditModal(${c.rowNumber})">Edit</button>
          <button type="button" class="cancel-btn" style="padding:5px 10px; font-size:12px;" onclick="deleteSingleRow(${c.rowNumber})">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
};

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

window.exportFilteredCSV = function() {
  const rows = getFilteredClaims();
  if (!rows.length) {
    alert('No rows to export.');
    return;
  }
  const headers = ['Invigilator', 'Exam Period', 'Week Commencing', 'Day', 'AM Worked', 'AM Start', 'AM Finish', 'PM Worked', 'PM Start', 'PM Finish', 'AM Extra', 'PM Extra', 'Total Hours', 'Status'];
  const csv = [headers.join(',')].concat(rows.map(r => [
    r.invigilatorName, r.examPeriod, r.weekCommencing, r.day,
    r.amWorked, r.amStart, r.amFinish, r.pmWorked, r.pmStart, r.pmFinish,
    r.amExtra, r.pmExtra, r.dailyTotal, r.status
  ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))).join('\n');

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
  document.getElementById('editTotalPreview').textContent = 'New Daily Total: ' + formatMins(mins);
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

// Individual Time Sheet Tab
function populateDatalists() {
  const names = [...new Set(allClaimsCache.map(c => c.invigilatorName).filter(Boolean))].sort();
  const periods = [...new Set(allClaimsCache.map(c => c.examPeriod).filter(Boolean))].sort();

  const invigList = document.getElementById('invigilatorList');
  if (invigList) invigList.innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');

  const periodList = document.getElementById('periodOptionsList');
  if (periodList) periodList.innerHTML = periods.map(p => `<option value="${escapeHtml(p)}"></option>`).join('');
}

window.onPersonNameChange = function() {
  const name = document.getElementById('personSearchInput').value.trim();
  const container = document.getElementById('personSheetContainer');
  if (!name) {
    container.innerHTML = '';
    return;
  }

  const personClaims = allClaimsCache.filter(c => c.invigilatorName.toLowerCase() === name.toLowerCase());
  if (!personClaims.length) {
    container.innerHTML = '<p style="padding:14px; color:#6b7280;">No claims found for this invigilator.</p>';
    return;
  }

  let totalMins = 0;
  const rowsHtml = personClaims.map(c => {
    totalMins += parseHoursToMins(c.dailyTotal);
    return `
      <tr>
        <td>${escapeHtml(c.examPeriod)}</td>
        <td>${escapeHtml(c.weekCommencing)}</td>
        <td>${escapeHtml(c.day)}</td>
        <td>${c.amWorked === 'Yes' ? escapeHtml(c.amStart + '–' + c.amFinish) : '—'}</td>
        <td>${c.pmWorked === 'Yes' ? escapeHtml(c.pmStart + '–' + c.pmFinish) : '—'}</td>
        <td>${(c.amExtra || 0) + (c.pmExtra || 0)}m</td>
        <td><strong>${escapeHtml(c.dailyTotal)}</strong></td>
        <td>${escapeHtml(c.status)}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="margin:12px 0; font-weight:700;">Total Claimed Hours: ${formatMins(totalMins)}</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Exam Period</th><th>Week Com</th><th>Day</th><th>AM</th><th>PM</th><th>Extra</th><th>Total</th><th>Status</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
};

window.exportIndividualTimesheet = function() {
  const name = document.getElementById('personSearchInput').value.trim();
  if (!name) {
    alert('Select an invigilator first.');
    return;
  }
  const personClaims = allClaimsCache.filter(c => c.invigilatorName.toLowerCase() === name.toLowerCase());
  if (!personClaims.length) {
    alert('No claims to export for ' + name);
    return;
  }
  const headers = ['Exam Period', 'Week Commencing', 'Day', 'AM Worked', 'AM Start', 'AM Finish', 'PM Worked', 'PM Start', 'PM Finish', 'AM Extra', 'PM Extra', 'Total Hours', 'Status'];
  const csv = [headers.join(',')].concat(personClaims.map(r => [
    r.examPeriod, r.weekCommencing, r.day, r.amWorked, r.amStart, r.amFinish,
    r.pmWorked, r.pmStart, r.pmFinish, r.amExtra, r.pmExtra, r.dailyTotal, r.status
  ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/\s+/g, '_')}_Timesheet.csv`;
  a.click();
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
          <button type="button" class="cancel-btn" style="padding:4px 10px; font-size:12px;"
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

// Manage Invigilators Tab
async function loadPeopleList() {
  const container = document.getElementById('peopleList');
  if (!container) return;
  try {
    const names = await callGas('getInvigilatorList', []);
    container.innerHTML = names.map(n => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #e5e7eb;">
        <span>${escapeHtml(n)}</span>
        <button type="button" class="cancel-btn" style="padding:4px 10px; font-size:12px;"
          onclick="removePerson('${escapeHtml(n).replace(/'/g, "\\'")}')">Remove</button>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

window.addPerson = async function() {
  const input = document.getElementById('newPersonName');
  const statusEl = document.getElementById('peopleStatusMsg');
  const name = input.value.trim();
  if (!name) return;

  try {
    await callGas('addInvigilator', [activeAuthToken, name, activeManagerName, '', '']);
    input.value = '';
    statusEl.style.color = '#15803d';
    statusEl.textContent = `Added ${name}.`;
    loadPeopleList();
  } catch (err) {
    statusEl.style.color = '#b91c1c';
    statusEl.textContent = err && err.message ? err.message : String(err);
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

// Restore saved session on page load
window.addEventListener('DOMContentLoaded', async function() {
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