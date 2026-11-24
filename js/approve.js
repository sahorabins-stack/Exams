let activeAuthToken = ''; // Holds either Google ID token or shared EXAMS_PASSCODE
let activeManagerName = 'Head of Exams';
let allClaimsCache = [];

function setLockMessage(msg, type) {
  const el = document.getElementById('lockStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'auth-status-msg ' + (type || '');
}

window.handleExamsGoogleSignIn = async function(response) {
  const errEl = document.getElementById('loginErr');
  if (!response || !response.credential) {
    if (errEl) errEl.textContent = 'Google sign-in did not return a credential.';
    return;
  }

  if (errEl) errEl.textContent = 'Verifying authorised Google account...';

  try {
    const res = await callGas('loginExamsManagerWithGoogle', [response.credential]);

    // Populate your existing inputs so every existing call in approve.js uses the verified Google token & name
    const nameInput = document.getElementById('managerName');
    const passInput = document.getElementById('passcodeInput');
    if (nameInput) nameInput.value = res.name || res.email || 'Head of Exams';
    if (passInput) passInput.value = response.credential;

    if (errEl) errEl.textContent = '';

    // Trigger your existing portal unlock flow
    if (typeof unlockPortal === 'function') {
      unlockPortal();
    }
  } catch (err) {
    if (errEl) errEl.textContent = err.message || 'Access denied.';
  }
};

function setBannerMessage(msg, type) {
  const el = document.getElementById('portalBanner');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'auth-status-msg ' + (type || '');
}

function handleAuthError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (
    msg.toLowerCase().includes('expired') ||
    msg.toLowerCase().includes('unauthorised') ||
    msg.toLowerCase().includes('access denied')
  ) {
    activeAuthToken = '';
    sessionStorage.removeItem('upton_exams_auth');
    document.getElementById('portalSection').style.display = 'none';
    document.getElementById('lockSection').style.display = 'block';
    setLockMessage(msg, 'error');
  } else {
    setBannerMessage(msg, 'error');
  }
}

function unlockPortal(authToken, managerName, claims) {
  activeAuthToken = authToken;
  activeManagerName = managerName || 'Head of Exams';
  sessionStorage.setItem('upton_exams_auth', JSON.stringify({
    token: activeAuthToken,
    name: activeManagerName
  }));

  document.getElementById('activeManagerDisplay').textContent = activeManagerName;
  document.getElementById('lockSection').style.display = 'none';
  document.getElementById('portalSection').style.display = 'block';
  setLockMessage('', '');

  allClaimsCache = Array.isArray(claims) ? claims : [];
  populateFilters(allClaimsCache);
  renderClaimsTable();
  loadRoster();
}

// Exposed globally so Google Identity Services data-callback can invoke it
window.handleExamsGoogleSignIn = async function(response) {
  if (!response || !response.credential) {
    setLockMessage('Google sign-in did not return a credential.', 'error');
    return;
  }
  setLockMessage('Verifying authorised Google account...', 'info');
  try {
    const res = await callGas('loginExamsManagerWithGoogle', [response.credential]);
    unlockPortal(response.credential, res.name || res.email, res.claims);
  } catch (err) {
    setLockMessage(err.message || 'Google sign-in failed.', 'error');
  }
};

function populateFilters(claims) {
  const invigSel = document.getElementById('filterInvigilator');
  const periodSel = document.getElementById('filterPeriod');
  const prevInvig = invigSel.value;
  const prevPeriod = periodSel.value;

  const invigs = [...new Set(claims.map(c => c.invigilatorName).filter(Boolean))].sort();
  const periods = [...new Set(claims.map(c => c.examPeriod).filter(Boolean))].sort();

  invigSel.innerHTML = '<option value="ALL">All Invigilators</option>' +
    invigs.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  periodSel.innerHTML = '<option value="ALL">All Exam Periods</option>' +
    periods.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');

  if (invigs.includes(prevInvig)) invigSel.value = prevInvig;
  if (periods.includes(prevPeriod)) periodSel.value = prevPeriod;
}

function renderClaimsTable() {
  const statusFilter = document.getElementById('filterStatus').value;
  const invigFilter = document.getElementById('filterInvigilator').value;
  const periodFilter = document.getElementById('filterPeriod').value;

  const filtered = allClaimsCache.filter(function(c) {
    const isApproved = String(c.status || '').toLowerCase().startsWith('approved');
    if (statusFilter === 'Pending' && isApproved) return false;
    if (statusFilter === 'Approved' && !isApproved) return false;
    if (invigFilter !== 'ALL' && c.invigilatorName !== invigFilter) return false;
    if (periodFilter !== 'ALL' && c.examPeriod !== periodFilter) return false;
    return true;
  });

  const tbody = document.getElementById('claimsTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding:18px; color:#6b7280;">No matching claims found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(function(c) {
    const isApproved = String(c.status || '').toLowerCase().startsWith('approved');
    const amTxt = c.amWorked === 'Yes' ? `${c.amStart}–${c.amFinish}` : '—';
    const pmTxt = c.pmWorked === 'Yes' ? `${c.pmStart}–${c.pmFinish}` : '—';
    const extraTxt = (c.amExtra || c.pmExtra) ? `AM:${c.amExtra}m / PM:${c.pmExtra}m` : '0';

    return `
      <tr>
        <td><input type="checkbox" class="row-check" value="${c.rowNumber}" ${isApproved ? 'disabled' : ''} /></td>
        <td><strong>${escapeHtml(c.invigilatorName)}</strong></td>
        <td>${escapeHtml(c.examPeriod)}</td>
        <td>${escapeHtml(c.weekCommencing)}</td>
        <td>${escapeHtml(c.day)}</td>
        <td>${escapeHtml(amTxt)}</td>
        <td>${escapeHtml(pmTxt)}</td>
        <td>${escapeHtml(extraTxt)}</td>
        <td><strong>${escapeHtml(c.dailyTotal)}</strong></td>
        <td style="color: ${isApproved ? '#15803d' : '#b45309'}; font-weight: 600;">${escapeHtml(c.status)}</td>
        <td>
          <button type="button" class="btn btn-outline delete-claim-btn" data-row="${c.rowNumber}"
            style="padding:4px 8px; font-size:0.8rem; color:#b91c1c;">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleDeleteClaim(rowNumber) {
  const claim = allClaimsCache.find(c => c.rowNumber === rowNumber);
  if (!claim) return;
  if (!confirm(`Delete ${claim.invigilatorName}'s claim for ${claim.day} (${claim.weekCommencing})?`)) return;

  setBannerMessage('Deleting row...', 'info');
  try {
    allClaimsCache = await callGas('deleteClaimRow', [activeAuthToken, rowNumber, claim, activeManagerName]);
    populateFilters(allClaimsCache);
    renderClaimsTable();
    setBannerMessage('Claim deleted and archived.', 'info');
  } catch (err) {
    handleAuthError(err);
  }
}

async function loadRoster() {
  try {
    const names = await callGas('getInvigilatorList', []);
    const listEl = document.getElementById('invigilatorRosterList');
    listEl.innerHTML = names.map(function(n) {
      return `
        <li style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #e5e7eb;">
          <span>${escapeHtml(n)}</span>
          <button type="button" class="btn btn-outline remove-invig-btn" data-name="${escapeHtml(n)}"
            style="padding:4px 10px; font-size:0.85rem; color:#b91c1c;">Remove</button>
        </li>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

async function handleRemoveInvigilator(name) {
  if (!confirm(`Remove ${name} from the Invigilators roster?`)) return;
  try {
    await callGas('removeInvigilator', [activeAuthToken, name]);
    loadRoster();
  } catch (err) {
    handleAuthError(err);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', async function() {
  // Restore existing session on page reload if still valid
  const saved = sessionStorage.getItem('upton_exams_auth');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.token) {
        setLockMessage('Restoring session...', 'info');
        const claims = await callGas('verifyExamsAccess', [parsed.token]);
        unlockPortal(parsed.token, parsed.name, claims);
      }
    } catch (err) {
      sessionStorage.removeItem('upton_exams_auth');
      setLockMessage('', '');
    }
  }

  // Fallback Passcode Unlock
  document.getElementById('passcodeForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const nameVal = document.getElementById('managerNameInput').value.trim();
    const passVal = document.getElementById('passcodeInput').value.trim();
    if (!nameVal || !passVal) return;

    setLockMessage('Checking passcode...', 'info');
    try {
      const claims = await callGas('verifyExamsAccess', [passVal]);
      unlockPortal(passVal, nameVal, claims);
    } catch (err) {
      setLockMessage(err.message || 'Invalid passcode.', 'error');
    }
  });

  // Sign Out / Lock
  document.getElementById('lockPortalBtn').addEventListener('click', function() {
    activeAuthToken = '';
    sessionStorage.removeItem('upton_exams_auth');
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
    document.getElementById('portalSection').style.display = 'none';
    document.getElementById('lockSection').style.display = 'block';
    setLockMessage('Signed out.', 'info');
  });

  // Portal Tab Switching
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-btn').forEach(function(b) {
        b.classList.remove('btn-primary');
        b.classList.add('btn-secondary');
      });
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');

      const targetId = btn.getAttribute('data-tab');
      document.querySelectorAll('.portal-tab').forEach(function(tab) {
        tab.style.display = (tab.id === targetId) ? 'block' : 'none';
      });
    });
  });

  // Refresh Claims
  document.getElementById('refreshClaimsBtn').addEventListener('click', async function() {
    setBannerMessage('Refreshing claims...', 'info');
    try {
      allClaimsCache = await callGas('getAllClaims', [activeAuthToken]);
      populateFilters(allClaimsCache);
      renderClaimsTable();
      setBannerMessage('Claims refreshed.', 'info');
    } catch (err) {
      handleAuthError(err);
    }
  });

  // Filters
  ['filterStatus', 'filterInvigilator', 'filterPeriod'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', renderClaimsTable);
  });

  // Select All Checkboxes
  document.getElementById('selectAllRows').addEventListener('change', function(e) {
    document.querySelectorAll('.row-check:not(:disabled)').forEach(function(cb) {
      cb.checked = e.target.checked;
    });
  });

  // Delegated Delete Claim Button
  document.getElementById('claimsTableBody').addEventListener('click', function(e) {
    const btn = e.target.closest('.delete-claim-btn');
    if (btn) {
      handleDeleteClaim(Number(btn.getAttribute('data-row')));
    }
  });

  // Approve Selected Rows
  document.getElementById('approveSelectedBtn').addEventListener('click', async function() {
    const selected = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => Number(cb.value));
    if (selected.length === 0) {
      setBannerMessage('Please tick at least one pending claim to approve.', 'error');
      return;
    }
    setBannerMessage(`Approving ${selected.length} row(s) and syncing to invigilator tabs...`, 'info');
    try {
      allClaimsCache = await callGas('approveMultipleRows', [activeAuthToken, selected, activeManagerName]);
      document.getElementById('selectAllRows').checked = false;
      populateFilters(allClaimsCache);
      renderClaimsTable();
      setBannerMessage(`Approved ${selected.length} claim(s).`, 'info');
    } catch (err) {
      handleAuthError(err);
    }
  });

  // Add Invigilator
  document.getElementById('addInvigilatorForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('newInvigName').value.trim();
    const email = document.getElementById('newInvigEmail').value.trim();
    const pass = document.getElementById('newInvigPass').value.trim();
    try {
      await callGas('addInvigilator', [activeAuthToken, name, activeManagerName, email, pass]);
      document.getElementById('addInvigilatorForm').reset();
      loadRoster();
      alert(`Added ${name} to the Invigilators roster.`);
    } catch (err) {
      handleAuthError(err);
    }
  });

  // Delegated Remove Invigilator Button
  document.getElementById('invigilatorRosterList').addEventListener('click', function(e) {
    const btn = e.target.closest('.remove-invig-btn');
    if (btn) {
      handleRemoveInvigilator(btn.getAttribute('data-name'));
    }
  });

  // Save Custom Exam Schedule
  document.getElementById('scheduleForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const days = Array.from(document.querySelectorAll('#scheduleDaysInput tr')).map(function(tr) {
      return {
        day: tr.getAttribute('data-day'),
        amStart: tr.querySelector('.am-s').value.trim(),
        amFinish: tr.querySelector('.am-f').value.trim(),
        pmStart: tr.querySelector('.pm-s').value.trim(),
        pmFinish: tr.querySelector('.pm-f').value.trim()
      };
    });

    const payload = {
      role: document.getElementById('schedRole').value,
      period: document.getElementById('schedPeriod').value.trim(),
      week: document.getElementById('schedWeek').value.trim(),
      days: days
    };

    try {
      await callGas('saveExamSchedule', [activeAuthToken, payload]);
      alert('Exam week saved successfully.');
    } catch (err) {
      handleAuthError(err);
    }
  });
});