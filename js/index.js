// ---------- Role tab slider (kept at the very top so nothing further down can stop it) ----------
(function () {
  function setup() {
    var a = document.getElementById('tabSupportingBtn');
    var b = document.getElementById('tabLeadBtn');
    if (!a || !b) {
      console.warn('Role tab slider: could not find #tabSupportingBtn / #tabLeadBtn');
      return;
    }
    var box = a.closest('.role-tabs') || a.parentNode;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';

    var slider = document.createElement('span');
    slider.className = 'role-tab-slider';
    box.insertBefore(slider, box.firstChild);

    var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    var placed = false;
    var current = null;
    var anim = null;

    // where the slider is on screen right now (correct even mid-animation)
    function visualRect() {
      var r = slider.getBoundingClientRect();
      var br = box.getBoundingClientRect();
      return { x: r.left - br.left - box.clientLeft, y: r.top - br.top - box.clientTop, w: r.width, h: r.height };
    }
    function frame(r) {
      return { width: r.w + 'px', height: r.h + 'px', transform: 'translate(' + r.x + 'px,' + r.y + 'px)' };
    }

    function place(animate) {
      var on = box.querySelector('.role-tab.active');
      if (!on || !on.offsetWidth) return;                       // hidden or not laid out yet

      var from = placed ? visualRect() : null;
      var to = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };

      if (anim) { anim.cancel(); anim = null; }
      slider.style.width = to.w + 'px';
      slider.style.height = to.h + 'px';
      slider.style.transform = 'translate(' + to.x + 'px,' + to.y + 'px)';

      if (!placed) {
        placed = true;
        slider.style.opacity = '1';
        box.classList.add('placed');
      } else if (animate && !reduce.matches && slider.animate &&
                 (Math.abs(from.x - to.x) > 1 || Math.abs(from.y - to.y) > 1 || Math.abs(from.w - to.w) > 1)) {
        anim = slider.animate([frame(from), frame(to)], {
          duration: 450,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
        });
      }
      current = to;
    }

    // one observer for both buttons: fires whenever selectRole() changes their class names
    var mo = new MutationObserver(function () { place(true); });
    mo.observe(a, { attributes: true, attributeFilter: ['class'] });
    mo.observe(b, { attributes: true, attributeFilter: ['class'] });

    // clicking also triggers it directly, in case the class change happens a moment later
    [a, b].forEach(function (btn) {
      btn.addEventListener('click', function () { setTimeout(function () { place(true); }, 0); });
    });

    window.addEventListener('resize', function () { place(false); });
    window.addEventListener('load', function () { place(false); });
    if (window.ResizeObserver) new ResizeObserver(function () { place(false); }).observe(box);
    place(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();

// ---------- Session Guard (Redirects to login.html if not signed in) ----------
    const rawSession = sessionStorage.getItem('ubc_invig_session');
    if (!rawSession) {
      window.location.href = './login.html';
    }
    const activeUser = JSON.parse(rawSession || '{}');

    let scheduleData = [];
    let currentRole = 'Supporting Invigilator';
    let lastCheckedKey = '';
    let scheduleLoaded = false;
    let namesLoaded = false;
    let draftRestoreDone = false;

    let weekStore = {};
    let renderedMeta = null;

    const STORAGE_KEY = 'upton_invigilator_draft_v2_' + String(activeUser.email || 'user').toLowerCase();

    const claimDateEl = document.getElementById('claimDate');
    if (claimDateEl) claimDateEl.valueAsDate = new Date();

    const nameInputEl = document.getElementById('invigilatorName');
    if (nameInputEl && activeUser.name) {
      nameInputEl.value = activeUser.name;
    }
    const emailHintEl = document.getElementById('loggedInEmailHint');
    if (emailHintEl && activeUser.email) {
      emailHintEl.textContent = 'Signed in as ' + activeUser.email;
    }
    namesLoaded = true;

    function signOutUser() {
      sessionStorage.removeItem('ubc_invig_session');
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      if (window.google && google.accounts && google.accounts.id) {
        try { google.accounts.id.disableAutoSelect(); } catch (e) {}
      }
      window.location.href = './login.html';
    }

    function cleanPeriodName(rawPeriod) {
      return String(rawPeriod || '').replace(/^\[(Lead|Supporting)\]\s*/i, '').trim();
    }

    // Keeps the styled dropdown buttons in step with the real <select> values
    function refreshDropdowns() {
      if (typeof window.syncFancySelects === 'function') window.syncFancySelects();
    }

    function showSubmitted(msg) {
      const text = (typeof msg === 'string' && msg.trim()) ? msg : 'Thank you. Your time sheet has been sent for authorisation.';
      document.getElementById('submitMsg').textContent = text;
      document.getElementById('submitOverlay').classList.add('show');
      document.getElementById('submitDoneBtn').focus();
    }

    function closeSubmitted() {
      document.getElementById('submitOverlay').classList.remove('show');
      window.scrollTo(0, 0);
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeSubmitted();
    });

    function maybeRestoreDraft() {
      if (scheduleLoaded && namesLoaded && !draftRestoreDone) {
        draftRestoreDone = true;
        restoreLocalDraft();
        autoCheckCloudDraft();
      }
    }

    google.script.run
      .withSuccessHandler(function(data) {
        scheduleData = data || [];
        populatePeriods(true);
        scheduleLoaded = true;
        maybeRestoreDraft();
      })
      .withFailureHandler(function(err) {
        document.getElementById('scheduleBody').innerHTML =
          '<tr><td colspan="8" style="color:#C62828;text-align:center;">Error loading schedule: ' + err.message + '</td></tr>';
      })
      .getExamSchedule();

    function setNameValue(name) {
      const inp = document.getElementById('invigilatorName');
      if (inp && activeUser.name) {
        inp.value = activeUser.name;
      } else if (inp && name) {
        inp.value = String(name).trim();
      }
    }

    function selectRole(role, skipCloudCheck) {
      currentRole = role;
      const isSupporting = role === 'Supporting Invigilator';
      document.getElementById('tabSupportingBtn').className = isSupporting ? 'role-tab active' : 'role-tab';
      document.getElementById('tabLeadBtn').className = isSupporting ? 'role-tab' : 'role-tab active';
      const titleEl = document.getElementById('formMainTitle');
      if (titleEl) titleEl.textContent = role + ' Time Sheet';
      populatePeriods(skipCloudCheck);
      saveLocalDraft();
    }

    function populatePeriods(skipCloudCheck) {
      const roleRows = scheduleData.filter(s => s.role === currentRole);
      const periods = Array.from(new Set(roleRows.map(s => s.period)));
      const periodSelect = document.getElementById('examPeriod');
      const prevPeriod = periodSelect.value;
      periodSelect.innerHTML = '';

      if (periods.length === 0) {
        snapshotRendered();
        renderedMeta = null;
        periodSelect.innerHTML = '<option value="">No schedule found</option>';
        document.getElementById('weekCommencing').innerHTML = '<option value="">-</option>';
        document.getElementById('scheduleBody').innerHTML =
          '<tr><td colspan="8" style="text-align:center;">No sessions listed for ' + currentRole + '.</td></tr>';
        recalculateAll();
        return;
      }

      periods.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        periodSelect.appendChild(opt);
      });

      if (prevPeriod && periods.indexOf(prevPeriod) !== -1) {
        periodSelect.value = prevPeriod;
      }

      onPeriodChange(skipCloudCheck);
    }

    function onPeriodChange(skipCloudCheck) {
      const selectedPeriod = document.getElementById('examPeriod').value;
      const weeks = Array.from(new Set(
        scheduleData
          .filter(s => s.role === currentRole && s.period === selectedPeriod)
          .map(s => s.week)
      ));
      const weekSelect = document.getElementById('weekCommencing');
      weekSelect.innerHTML = '';

      weeks.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = w;
        weekSelect.appendChild(opt);
      });

      renderScheduleRows();

      if (!skipCloudCheck) {
        autoCheckCloudDraft();
      }
    }

    /* ---------- keeping every week's ticks while moving between weeks ---------- */

    function makeKey(role, period, week) {
      return role + '||' + period + '||' + week;
    }

    function roleShort(role) {
      return role === 'Lead Invigilator' ? 'Lead' : 'Supporting';
    }

    function dayHasHours(d) {
      return !!(d.amWorked || d.pmWorked || (parseInt(d.amExtra, 10) || 0) > 0 || (parseInt(d.pmExtra, 10) || 0) > 0);
    }

    function dayMinsFromData(d) {
      let m = 0;
      if (d.amWorked) {
        const s = parseMinutes(d.amStart);
        const f = parseMinutes(d.amFinish);
        if (s !== null && f !== null && f > s) m += (f - s);
      }
      if (d.pmWorked) {
        const s = parseMinutes(d.pmStart);
        const f = parseMinutes(d.pmFinish);
        if (s !== null && f !== null && f > s) m += (f - s);
      }
      m += (parseInt(d.amExtra, 10) || 0) + (parseInt(d.pmExtra, 10) || 0);
      return m;
    }

    function weekDateValue(str) {
      const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(String(str || '').trim());
      if (!m) return 0;
      const y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
      return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
    }

    function readRowsFromDom() {
      const days = [];
      document.querySelectorAll('#scheduleBody tr[data-day]').forEach(tr => {
        days.push({
          day: tr.dataset.day,
          amWorked: tr.querySelector('.am-check').checked,
          amStart: tr.dataset.amStart,
          amFinish: tr.dataset.amFinish,
          pmWorked: tr.querySelector('.pm-check').checked,
          pmStart: tr.dataset.pmStart,
          pmFinish: tr.dataset.pmFinish,
          amExtra: tr.querySelector('.am-extra').value,
          pmExtra: tr.querySelector('.pm-extra').value
        });
      });
      return days;
    }

    function snapshotRendered() {
      if (!renderedMeta) return;
      const days = readRowsFromDom();
      if (days.length === 0) return;
      if (days.some(dayHasHours)) {
        weekStore[renderedMeta.key] = {
          role: renderedMeta.role,
          period: renderedMeta.period,
          week: renderedMeta.week,
          days: days
        };
      } else {
        delete weekStore[renderedMeta.key];
      }
    }

    function restoreRowsFromStore() {
      const saved = renderedMeta && weekStore[renderedMeta.key];
      if (!saved) return;
      document.querySelectorAll('#scheduleBody tr[data-day]').forEach(tr => {
        const match = saved.days.find(d => d.day === tr.dataset.day);
        if (!match) return;
        if (!tr.querySelector('.am-check').disabled) tr.querySelector('.am-check').checked = !!match.amWorked;
        if (!tr.querySelector('.pm-check').disabled) tr.querySelector('.pm-check').checked = !!match.pmWorked;
        tr.querySelector('.am-extra').value = match.amExtra || 0;
        tr.querySelector('.pm-extra').value = match.pmExtra || 0;
      });
    }

    function sortedWeeksForActivePeriod() {
      const activePeriod = cleanPeriodName(document.getElementById('examPeriod').value);
      return Object.keys(weekStore)
        .map(k => Object.assign({ key: k }, weekStore[k]))
        .filter(w => cleanPeriodName(w.period) === activePeriod && w.days.some(dayHasHours))
        .sort((a, b) => a.role.localeCompare(b.role) || weekDateValue(a.week) - weekDateValue(b.week));
    }

    function goToWeek(w) {
      snapshotRendered();
      if (currentRole !== w.role) selectRole(w.role, true);
      document.getElementById('examPeriod').value = w.period;
      onPeriodChange(true);
      document.getElementById('weekCommencing').value = w.week;
      renderScheduleRows();
      const body = document.getElementById('scheduleBody');
      if (body && body.scrollIntoView) body.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function removeWeek(w) {
      if (!confirm('Remove ' + w.period + ' — week com ' + w.week + ' from this submission?')) return;
      delete weekStore[w.key];
      if (renderedMeta && renderedMeta.key === w.key) {
        renderedMeta = null;
        renderScheduleRows();
      } else {
        recalculateAll();
      }
      saveLocalDraft();
    }

    

    
    function renderWeeksSummary() {
      const weeks = sortedWeeksForActivePeriod();
      const box = document.getElementById('weeksBox');
      const onScreenOnly = weeks.length === 1 && renderedMeta && weeks[0].key === renderedMeta.key;
      if (weeks.length === 0 || onScreenOnly) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';

      const list = document.getElementById('weeksList');
      list.innerHTML = '';
      let all = 0;

      weeks.forEach(w => {
        const mins = w.days.reduce((t, d) => t + dayMinsFromData(d), 0);
        all += mins;
        const dayCount = w.days.filter(dayHasHours).length;

        const item = document.createElement('div');
        item.className = 'week-item' + (renderedMeta && renderedMeta.key === w.key ? ' current' : '');

        const info = document.createElement('div');
        const name = document.createElement('span');
        name.className = 'week-name';
        name.textContent = '[' + roleShort(w.role) + '] ' + w.period;
        const sub = document.createElement('span');
        sub.className = 'week-sub';
        sub.textContent = 'Week com ' + w.week + ' · ' + dayCount + ' day' + (dayCount === 1 ? '' : 's');
        info.appendChild(name);
        info.appendChild(sub);
        item.appendChild(info);

        const right = document.createElement('div');
        right.className = 'week-right';

        const hrs = document.createElement('span');
        hrs.className = 'week-hours';
        hrs.textContent = formatHours(mins);
        right.appendChild(hrs);

        const view = document.createElement('button');
        view.type = 'button';
        view.className = 'week-btn';
        view.textContent = 'View';
        view.onclick = function() { goToWeek(w); };
        right.appendChild(view);

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'week-btn danger';
        rm.textContent = 'Remove';
        rm.onclick = function() { removeWeek(w); };
        right.appendChild(rm);

        item.appendChild(right);
        list.appendChild(item);
      });

      document.getElementById('allWeeksTotal').textContent = formatHours(all);
    }

    function renderScheduleRows() {
      snapshotRendered();

      const period = document.getElementById('examPeriod').value;
      const week = document.getElementById('weekCommencing').value;
      const tbody = document.getElementById('scheduleBody');
      tbody.innerHTML = '';

      const rows = scheduleData.filter(s => s.role === currentRole && s.period === period && s.week === week);
      if (rows.length === 0) {
        renderedMeta = null;
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No sessions listed for this week.</td></tr>';
        recalculateAll();
        refreshDropdowns();
        return;
      }

      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.dataset.day = r.day;
        tr.dataset.amStart = r.amStart;
        tr.dataset.amFinish = r.amFinish;
        tr.dataset.pmStart = r.pmStart;
        tr.dataset.pmFinish = r.pmFinish;

        const amLabel = (r.amStart && r.amFinish) ? (r.amStart + ' - ' + r.amFinish) : 'No AM Session';
        const pmLabel = (r.pmStart && r.pmFinish) ? (r.pmStart + ' - ' + r.pmFinish) : 'No PM Session';
        const amDisabled = (!r.amStart || !r.amFinish) ? 'disabled' : '';
        const pmDisabled = (!r.pmStart || !r.pmFinish) ? 'disabled' : '';

        tr.innerHTML =
          '<td>' + r.day + '</td>' +
          '<td><input type="checkbox" class="am-check" ' + amDisabled + ' onchange="onFormInput()"></td>' +
          '<td><span class="time-pill">' + amLabel + '</span></td>' +
          '<td><input type="checkbox" class="pm-check" ' + pmDisabled + ' onchange="onFormInput()"></td>' +
          '<td><span class="time-pill">' + pmLabel + '</span></td>' +
          '<td><input type="number" class="extra-in am-extra" min="0" value="0" inputmode="numeric" oninput="onFormInput()"></td>' +
          '<td><input type="number" class="extra-in pm-extra" min="0" value="0" inputmode="numeric" oninput="onFormInput()"></td>' +
          '<td class="day-total" style="font-weight:700;color:#0D2D6C;">0:00</td>';
        tbody.appendChild(tr);
      });

      renderedMeta = { key: makeKey(currentRole, period, week), role: currentRole, period: period, week: week };
      restoreRowsFromStore();
      recalculateAll();
      refreshDropdowns();
    }

    function onFormInput() {
      recalculateAll();
      saveLocalDraft();
    }

    /* ---------- drafts (local + cloud) scoped strictly to the signed-in user & selected Exam Period ---------- */

    function buildDraft() {
      snapshotRendered();
      const selPeriod = document.getElementById('examPeriod').value;
      const cleanSelPeriod = cleanPeriodName(selPeriod);

      const periodStore = {};
      Object.keys(weekStore).forEach(function(k) {
        const entry = weekStore[k];
        if (entry && cleanPeriodName(entry.period) === cleanSelPeriod) {
          periodStore[k] = entry;
        }
      });

      return {
        invigilatorName: activeUser.name || document.getElementById('invigilatorName').value.trim(),
        email: activeUser.email,
        password: activeUser.password || '',
        authType: activeUser.authType || 'password',
        credential: activeUser.credential || '',
        invigilatorRole: currentRole,
        selPeriod: selPeriod,
        selWeek: document.getElementById('weekCommencing').value,
        examPeriod: cleanSelPeriod,
        weekCommencing: 'ALL',
        certifiedName: document.getElementById('signature').value.trim(),
        signature: document.getElementById('signature').value.trim(),
        claimDate: document.getElementById('claimDate').value,
        store: periodStore
      };
    }

    function collectSubmission() {
      snapshotRendered();
      const weeks = sortedWeeksForActivePeriod().map(w => ({
        invigilatorRole: w.role,
        examPeriod: '[' + roleShort(w.role) + '] ' + w.period,
        weekCommencing: w.week,
        days: w.days.filter(dayHasHours).map(d => ({
          day: d.day,
          amWorked: d.amWorked,
          amStart: d.amStart,
          amFinish: d.amFinish,
          pmWorked: d.pmWorked,
          pmStart: d.pmStart,
          pmFinish: d.pmFinish,
          amExtra: d.amExtra,
          pmExtra: d.pmExtra,
          dailyTotalFormatted: formatHours(dayMinsFromData(d))
        }))
      }));

      return {
        invigilatorName: activeUser.name || document.getElementById('invigilatorName').value.trim(),
        email: activeUser.email,
        password: activeUser.password || '',
        authType: activeUser.authType || 'password',
        credential: activeUser.credential || '',
        certifiedName: document.getElementById('signature').value.trim(),
        signature: document.getElementById('signature').value.trim(),
        claimDate: document.getElementById('claimDate').value,
        weeks: weeks
      };
    }

    function applyDraftToForm(draft) {
      if (!draft) return;
      setNameValue(activeUser.name || draft.invigilatorName);

      renderedMeta = null;
      const targetPeriod = cleanPeriodName(draft.selPeriod || draft.examPeriod);

      Object.keys(weekStore).forEach(function(k) {
        if (!targetPeriod || cleanPeriodName(weekStore[k].period) === targetPeriod) {
          delete weekStore[k];
        }
      });

      if (draft.store && typeof draft.store === 'object') {
        Object.keys(draft.store).forEach(function(k) {
          const entry = draft.store[k];
          if (!targetPeriod || cleanPeriodName(entry.period) === targetPeriod) {
            weekStore[k] = JSON.parse(JSON.stringify(entry));
          }
        });
      } else if (Array.isArray(draft.days) && draft.invigilatorRole && draft.examPeriod && draft.weekCommencing) {
        const period = cleanPeriodName(draft.examPeriod);
        weekStore[makeKey(draft.invigilatorRole, period, draft.weekCommencing)] = {
          role: draft.invigilatorRole,
          period: period,
          week: draft.weekCommencing,
          days: draft.days
        };
      }

      if (draft.invigilatorRole) {
        selectRole(draft.invigilatorRole, true);
      }

      const selPeriod = cleanPeriodName(draft.selPeriod || draft.examPeriod);
      const selWeek = draft.selWeek || draft.weekCommencing;
      if (selPeriod && selPeriod !== 'ALL') {
        document.getElementById('examPeriod').value = selPeriod;
        onPeriodChange(true);
      }
      if (selWeek && selWeek !== 'ALL') {
        document.getElementById('weekCommencing').value = selWeek;
        renderScheduleRows();
      } else {
        renderScheduleRows();
      }

      if (draft.signature) document.getElementById('signature').value = draft.signature;
      if (draft.claimDate) document.getElementById('claimDate').value = draft.claimDate;
      recalculateAll();
    }

    function saveLocalDraft() {
      try {
        const localCopy = buildDraft();
        delete localCopy.password;
        delete localCopy.credential;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(localCopy));
        document.getElementById('draftStatus').textContent = 'Draft auto-saved locally at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (e) {}
    }

    function restoreLocalDraft() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const draft = JSON.parse(raw);
        if (draft && draft.invigilatorName && activeUser.name &&
            draft.invigilatorName.trim().toLowerCase() !== activeUser.name.trim().toLowerCase()) {
          return;
        }
        const hasStore = draft && draft.store && Object.keys(draft.store).length > 0;
        const hasLegacyHours = draft && Array.isArray(draft.days) && draft.days.some(d => d.amWorked || d.pmWorked);
        if (draft && (hasStore || hasLegacyHours)) {
          applyDraftToForm(draft);
          document.getElementById('draftStatus').textContent = 'Restored your previous unsent session';
        }
      } catch (e) {}
    }

    function autoCheckCloudDraft() {
      const name = activeUser.name || document.getElementById('invigilatorName').value.trim();
      const period = cleanPeriodName(document.getElementById('examPeriod').value);
      if (!name || !period) return;

      const checkKey = name.toLowerCase() + '|' + period.toLowerCase();
      if (checkKey === lastCheckedKey) return;
      lastCheckedKey = checkKey;

      fetchCloudDraft(true);
    }

    function manualLoadDraft() {
      lastCheckedKey = '';
      fetchCloudDraft(false);
    }

    function fetchCloudDraft(isSilent) {
      const name = activeUser.name || document.getElementById('invigilatorName').value.trim();
      const period = cleanPeriodName(document.getElementById('examPeriod').value);
      if (!name) {
        signOutUser();
        return;
      }
      if (!period) {
        if (!isSilent) alert('Please select an Exam Period first.');
        return;
      }

      const loadBtn = document.getElementById('loadBtn');
      loadBtn.textContent = 'Checking...';
      loadBtn.disabled = true;

      google.script.run
        .withSuccessHandler(function(draft) {
          loadBtn.textContent = 'Load Saved';
          loadBtn.disabled = false;
          if (draft) {
            applyDraftToForm(draft);
            saveLocalDraft();
            document.getElementById('draftStatus').textContent = 'Loaded saved progress for ' + name + ' (' + period + ')';
          } else {
            renderedMeta = null;
            Object.keys(weekStore).forEach(function(k) {
              if (cleanPeriodName(weekStore[k].period) === period) {
                delete weekStore[k];
              }
            });
            renderScheduleRows();
            if (!isSilent) {
              document.getElementById('draftStatus').textContent = 'No saved cloud draft found for ' + name + ' (' + period + ')';
            }
          }
        })
        .withFailureHandler(function(err) {
          loadBtn.textContent = 'Load Saved';
          loadBtn.disabled = false;
          if (err && /unauthorised|expired/i.test(String(err.message))) {
            alert(err.message);
            signOutUser();
          }
        })
        .loadDraft(
          name,
          period,
          'ALL',
          activeUser.email,
          activeUser.password || '',
          activeUser.authType || 'password',
          activeUser.credential || ''
        );
    }

    function saveCloudDraft() {
      const payload = buildDraft();
      const status = document.getElementById('statusMsg');
      if (!payload.invigilatorName) {
        signOutUser();
        return;
      }
      if (!payload.examPeriod) {
        status.textContent = 'Please select an Exam Period before saving progress.';
        status.className = 'status error';
        status.style.display = 'block';
        return;
      }

      const btn = document.getElementById('saveDraftBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      saveLocalDraft();

      google.script.run
        .withSuccessHandler(function(msg) {
          status.textContent = msg;
          status.className = 'status success';
          status.style.display = 'block';
          document.getElementById('draftStatus').textContent = msg;
          btn.disabled = false;
          btn.textContent = 'Save Progress';
        })
        .withFailureHandler(function(err) {
          status.textContent = 'Error: ' + err.message;
          status.className = 'status error';
          status.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Save Progress';
          if (err && /unauthorised|expired/i.test(String(err.message))) {
            signOutUser();
          }
        })
        .saveDraft(payload);
    }

    function parseMinutes(timeStr) {
      if (!timeStr) return null;
      const clean = String(timeStr).trim().replace('.', ':');
      const parts = clean.split(':');
      if (parts.length !== 2) return null;
      const h = parseInt(parts.at(0), 10);
      const m = parseInt(parts.at(1), 10);
      if (isNaN(h) || isNaN(m)) return null;
      return h * 60 + m;
    }

    function formatHours(totalMins) {
      const mins = Math.max(0, Math.round(totalMins));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h + ':' + (m < 10 ? '0' : '') + m;
    }

    function recalculateAll() {
      let grandMins = 0;
      const rows = document.querySelectorAll('#scheduleBody tr[data-day]');

      rows.forEach(tr => {
        let dayMins = 0;
        const amChecked = tr.querySelector('.am-check').checked;
        const pmChecked = tr.querySelector('.pm-check').checked;

        if (amChecked) {
          const s = parseMinutes(tr.dataset.amStart);
          const f = parseMinutes(tr.dataset.amFinish);
          if (s !== null && f !== null && f > s) dayMins += (f - s);
        }

        if (pmChecked) {
          const s = parseMinutes(tr.dataset.pmStart);
          const f = parseMinutes(tr.dataset.pmFinish);
          if (s !== null && f !== null && f > s) dayMins += (f - s);
        }

        const amExtra = parseInt(tr.querySelector('.am-extra').value, 10) || 0;
        const pmExtra = parseInt(tr.querySelector('.pm-extra').value, 10) || 0;
        dayMins += amExtra + pmExtra;

        tr.querySelector('.day-total').textContent = formatHours(dayMins);
        grandMins += dayMins;
      });

      document.getElementById('grandTotal').textContent = formatHours(grandMins);

      snapshotRendered();
      renderWeeksSummary();
    }

    document.getElementById('timeSheetForm').addEventListener('submit', function(e) {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      const status = document.getElementById('statusMsg');
      const payload = collectSubmission();

      if (payload.weeks.length === 0) {
        status.textContent = 'Please tick at least one AM or PM session (or add extra minutes) before submitting.';
        status.className = 'status error';
        status.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Submitting Time Sheet...';
      status.style.display = 'none';

      google.script.run
        .withSuccessHandler(function(msg) {
          try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
          status.style.display = 'none';
          weekStore = {};
          renderedMeta = null;
          document.getElementById('timeSheetForm').reset();
          setNameValue(activeUser.name);
          lastCheckedKey = '';
          if (claimDateEl) claimDateEl.valueAsDate = new Date();
          document.getElementById('draftStatus').textContent = 'Submitted! Ready for next claim.';
          populatePeriods(true);
          btn.disabled = false;
          btn.textContent = 'Submit Final Time Sheet';
          showSubmitted(msg);
        })
        .withFailureHandler(function(err) {
          status.textContent = 'Error: ' + err.message;
          status.className = 'status error';
          status.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Submit Final Time Sheet';
          if (err && /unauthorised|expired/i.test(String(err.message))) {
            signOutUser();
          }
        })
        .submitTimeSheet(payload);
    });


    /* =========================================================
       FANCY DROPDOWNS
       Upgrades the Exam Period and Week Commencing selects (plus any
       <select class="fancy">) into styled dropdowns. The real <select>
       stays in the page, so every line of code above keeps working.
       ========================================================= */
    (function () {
      var CHEV  = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      var CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      var syncers = [];

      function enhance(sel) {
        if (!sel || sel.dataset.fddDone) return;
        sel.dataset.fddDone = '1';

        // wrap the select
        var wrap = document.createElement('div');
        wrap.className = 'fdd';
        sel.parentNode.insertBefore(wrap, sel);
        wrap.appendChild(sel);
        sel.classList.add('fdd-native');
        sel.tabIndex = -1;

        // button
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fdd-btn';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = '<span class="fdd-label"></span><span class="fdd-chev">' + CHEV + '</span>';
        var labelEl = btn.querySelector('.fdd-label');

        // menu
        var menu = document.createElement('div');
        menu.className = 'fdd-menu';
        var search = document.createElement('input');
        search.type = 'text';
        search.className = 'fdd-search';
        search.placeholder = 'Search...';
        search.autocomplete = 'off';
        var list = document.createElement('ul');
        list.className = 'fdd-list';
        list.setAttribute('role', 'listbox');
        var empty = document.createElement('div');
        empty.className = 'fdd-empty';
        empty.textContent = 'No matches';
        empty.hidden = true;
        menu.append(search, list, empty);
        wrap.append(btn, menu);

        var active = -1;

        function visibleOpts() {
          return Array.prototype.slice.call(list.querySelectorAll('li:not([hidden]) .fdd-opt:not([disabled])'));
        }
        function setActive(i) {
          var v = visibleOpts();
          if (!v.length) { active = -1; return; }
          active = (i + v.length) % v.length;
          v.forEach(function (o, k) { o.classList.toggle('active', k === active); });
          v[active].scrollIntoView({ block: 'nearest' });
        }
        function filter() {
          var q = search.value.trim().toLowerCase();
          var shown = 0;
          list.querySelectorAll('li').forEach(function (li) {
            var match = !q || li.textContent.toLowerCase().indexOf(q) !== -1;
            li.hidden = !match;
            if (match) shown++;
          });
          empty.hidden = shown > 0;
          setActive(0);
        }
        function close() {
          wrap.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
        }
        function open() {
          if (sel.disabled) return;
          wrap.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
          if (!search.hidden) {
            search.value = '';
            filter();
            setTimeout(function () { search.focus(); }, 40);
          }
          var v = visibleOpts();
          var cur = v.findIndex(function (o) { return o.classList.contains('selected'); });
          setActive(cur >= 0 ? cur : 0);
        }
        function pick(value) {
          sel.value = value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));  // fires onchange="renderScheduleRows()" etc.
          close();
          btn.focus();
        }

        // show the select's current value on the button and tick it in the list
        function sync() {
          var cur = sel.options[sel.selectedIndex];
          var has = cur && cur.value !== '';
          labelEl.textContent = has ? cur.textContent : (sel.options[0] ? sel.options[0].textContent : 'Select...');
          labelEl.classList.toggle('placeholder', !has);
          list.querySelectorAll('.fdd-opt').forEach(function (o) {
            var on = o.dataset.value === sel.value && sel.value !== '';
            o.classList.toggle('selected', on);
            o.setAttribute('aria-selected', on);
          });
          wrap.classList.toggle('disabled', sel.disabled);
          btn.disabled = sel.disabled;
        }

        // rebuild the list from the select's options (re-runs whenever the code above refills the select)
        function rebuild() {
          list.innerHTML = '';
          var n = 0;
          Array.prototype.forEach.call(sel.options, function (opt) {
            if (!opt.value) return;                       // skip the placeholder option
            var li = document.createElement('li');
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'fdd-opt';
            b.setAttribute('role', 'option');
            b.dataset.value = opt.value;
            b.disabled = opt.disabled;
            b.style.setProperty('--i', Math.min(n, 12));
            b.innerHTML = '<span></span>' + CHECK;
            b.firstChild.textContent = opt.textContent;
            b.querySelector('svg').classList.add('fdd-check');
            b.addEventListener('click', function () { pick(opt.value); });
            li.appendChild(b);
            list.appendChild(li);
            n++;
          });
          var wantSearch = sel.dataset.search ? sel.dataset.search === 'true' : n > 7;
          search.hidden = !wantSearch;
          sync();
        }

        // events
        btn.addEventListener('click', function () { wrap.classList.contains('open') ? close() : open(); });
        search.addEventListener('input', filter);
        wrap.addEventListener('keydown', function (e) {
          var isOpen = wrap.classList.contains('open');
          if (e.key === 'Escape' && isOpen) { close(); btn.focus(); return; }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen) { open(); return; }
            setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
          } else if (e.key === 'Enter' && isOpen) {
            e.preventDefault();
            var v = visibleOpts();
            if (v[active]) pick(v[active].dataset.value);
          }
        });
        document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
        sel.addEventListener('change', sync);
        new MutationObserver(rebuild).observe(sel, { childList: true, attributes: true, attributeFilter: ['disabled'] });

        rebuild();
        syncers.push(sync);
      }

      function init() {
        document.querySelectorAll('select.fancy, #examPeriod, #weekCommencing').forEach(enhance);
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
      else init();

      window.enhanceSelect = enhance;                                   // enhance a select added later
      window.syncFancySelects = function () { syncers.forEach(function (s) { s(); }); };
    })();