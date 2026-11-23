let savedPasscode = "";
     let managerFullName = "";
     let allClaims = [];
     let currentFiltered = [];
     let allSchedules = [];
     let editingRowNumber = null;
     const DAY_INDEX = {
         MONDAY: 0,
         TUESDAY: 1,
         WEDNESDAY: 2,
         THURSDAY: 3,
         FRIDAY: 4,
         SATURDAY: 5,
         SUNDAY: 6
     };
     /* ---------- helpers ---------- */
     function esc(s) {
         return String(s == null ? "" : s).replace(/[&<>"']/g, function(m) {
             return {
                 "&": "&amp;",
                 "<": "&lt;",
                 ">": "&gt;",
                 '"': "&quot;",
                 "'": "&#39;"
             } [m];
         });
     }

     function isApprovedStatus(status) {
         return String(status || "").trim().toLowerCase().startsWith("approved");
     }

     function isPendingStatus(status) {
         return String(status || "").trim().toLowerCase() === "pending";
     }

     function extraMinsOf(c) {
         return Number(c.amExtra || 0) + Number(c.pmExtra || 0);
     }

     function parseHoursToMins(str) {
         const parts = String(str || "0:00").split(":");
         if (parts.length !== 2) return 0;
         return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
     }

     function sessionMins(startStr, finishStr, extraMins) {
         let total = Number(extraMins) || 0;
         if (startStr && finishStr) {
             const s = parseHoursToMins(String(startStr).replace(".", ":"));
             const f = parseHoursToMins(String(finishStr).replace(".", ":"));
             if (f > s) total += f - s;
         }
         return total;
     }

     function formatMins(mins) {
         const h = Math.floor(mins / 60);
         const m = mins % 60;
         return h + ":" + (m < 10 ? "0" : "") + m;
     }

     function normaliseWeek(w) {
         const raw = String(w == null ? "" : w).trim();
         const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(raw);
         if (!m) return raw;
         return m[1].padStart(2, "0") + "/" + m[2].padStart(2, "0") + "/" + m[3].slice(-2);
     }

     function claimDayDate(c) {
         const wk = normaliseWeek(c.weekCommencing);
         const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(wk);
         if (!m) return null;
         const d = new Date(2000 + parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
         const off = DAY_INDEX[String(c.day || "").trim().toUpperCase()];
         if (off) d.setDate(d.getDate() + off);
         return isNaN(d.getTime()) ? null : d;
     }

     function monthKey(d) {
         return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
     }

     function monthLabel(key) {
         const p = key.split("-");
         return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("en-GB", {
             month: "long",
             year: "numeric"
         });
     }
     /* ---------- sign-in ---------- */
     function unlockPortal() {
         const nameVal = document.getElementById("managerName").value.trim();
         const passVal = document.getElementById("passcodeInput").value.trim();
         const errEl = document.getElementById("loginErr");
         const btn = document.getElementById("unlockBtn");
         if (!nameVal || !passVal) {
             errEl.textContent = "Please enter both your name and the passcode.";
             errEl.style.display = "block";
             return;
         }
         btn.disabled = true;
         btn.textContent = "Verifying...";
         errEl.style.display = "none";
         google.script.run.withSuccessHandler(function(data) {
             savedPasscode = passVal;
             managerFullName = nameVal;
             allClaims = data || [];
             document.getElementById("splashTitle").textContent = "Welcome, " + managerFullName;
             document.getElementById("welcomeText").textContent = "Welcome, " + managerFullName;
             document.getElementById("lockScreen").style.display = "none";
             document.getElementById("welcomeSplash").style.display = "block";
             populateNameDatalist();
             updateSummary();
             renderTable();
             setTimeout(function() {
                 document.getElementById("welcomeSplash").style.display = "none";
                 document.getElementById("portalBody").style.display = "block";
             }, 1700);
         }).withFailureHandler(function(err) {
             btn.disabled = false;
             btn.textContent = "Unlock Approval Portal";
             errEl.textContent = err.message;
             errEl.style.display = "block";
         }).verifyExamsAccess(passVal);
     }

     function refreshPortalData() {
         const btn = document.getElementById("refreshBtn");
         btn.disabled = true;
         btn.textContent = "Refreshing...";
         google.script.run.withSuccessHandler(function(data) {
             allClaims = data || [];
             populateNameDatalist();
             updateSummary();
             renderTable();
             onPersonNameChange();
             btn.disabled = false;
             btn.textContent = "Refresh";
         }).withFailureHandler(function(err) {
             alert("Error: " + err.message);
             btn.disabled = false;
             btn.textContent = "Refresh";
         }).verifyExamsAccess(savedPasscode);
     }
     /* ---------- tabs ---------- */
     function switchView(viewName) {
         document.getElementById("approvalsView").style.display = viewName === "approvals" ? "block" : "none";
         document.getElementById("personView").style.display = viewName === "person" ? "block" : "none";
         document.getElementById("scheduleView").style.display = viewName === "schedule" ? "block" : "none";
         document.getElementById("peopleView").style.display = viewName === "people" ? "block" : "none";
         document.getElementById("tabApprovalsBtn").className = viewName === "approvals" ? "tab-btn active" : "tab-btn";
         document.getElementById("tabPersonBtn").className = viewName === "person" ? "tab-btn active" : "tab-btn";
         document.getElementById("tabScheduleBtn").className = viewName === "schedule" ? "tab-btn active" : "tab-btn";
         document.getElementById("tabPeopleBtn").className = viewName === "people" ? "tab-btn active" : "tab-btn";
         if (viewName === "person") onPersonNameChange();
         if (viewName === "people") loadPeople();
         if (viewName === "schedule") {
             google.script.run.withSuccessHandler(function(sched) {
                 allSchedules = sched || [];
                 renderExistingSchedules();
             }).getExamSchedule();
         }
     }
     /* ---------- approvals view ---------- */
     function populateNameDatalist() {
         const names = Array.from(new Set(allClaims.map(function(c) {
             return c.invigilatorName;
         }).filter(Boolean))).sort();
         const dl = document.getElementById("invigilatorList");
         dl.innerHTML = "";
         names.forEach(function(n) {
             const opt = document.createElement("option");
             opt.value = n;
             dl.appendChild(opt);
         });
     }

     function updateSummary() {
         document.getElementById("totalEntries").textContent = allClaims.length;
         document.getElementById("pendingCount").textContent = allClaims.filter(function(c) {
             return isPendingStatus(c.status);
         }).length;
         document.getElementById("approvedCount").textContent = allClaims.filter(function(c) {
             return isApprovedStatus(c.status);
         }).length;
     }
     let currentGroups = [];
     const expandedGroups = new Set();

     function toggleGroup(gi) {
         const g = currentGroups[gi];
         if (!g) return;
         if (expandedGroups.has(g.key)) expandedGroups.delete(g.key);
         else expandedGroups.add(g.key);
         renderTable();
     }

     function groupKeyOf(c) {
         return (String(c.invigilatorName || "").trim().toLowerCase() + "||" + String(c.examPeriod || "").trim().toLowerCase() + "||" + normaliseWeek(c.weekCommencing));
     }

     function dayOrder(c) {
         const i = DAY_INDEX[String(c.day || "").trim().toUpperCase()];
         return i === undefined ? 99 : i;
     }

     function renderTable() {
         const statusVal = document.getElementById("statusFilter").value;
         const query = document.getElementById("searchBox").value.toLowerCase();
         const tbody = document.getElementById("tableBody");
         tbody.innerHTML = "";
         let totalMins = 0;
         currentFiltered = allClaims.filter(function(c) {
             const approved = isApprovedStatus(c.status);
             const matchesStatus = !statusVal || (statusVal === "Approved" ? approved : isPendingStatus(c.status));
             const matchesSearch = !query || [c.invigilatorName, c.examPeriod, c.weekCommencing, c.day].some(function(v) {
                 return String(v == null ? "" : v).toLowerCase().includes(query);
             });
             return matchesStatus && matchesSearch;
         });
         currentFiltered.forEach(function(c) {
             totalMins += parseHoursToMins(c.dailyTotal);
         });
         document.getElementById("filteredHours").textContent = formatMins(totalMins);
         currentGroups = [];
         if (currentFiltered.length === 0) {
             tbody.innerHTML = '<tr><td colspan="6">No matching claims found.</td></tr>';
             return;
         }
         const map = {};
         currentFiltered.forEach(function(c) {
             const k = groupKeyOf(c);
             if (!map[k]) {
                 map[k] = {
                     key: k,
                     name: c.invigilatorName,
                     period: c.examPeriod,
                     week: normaliseWeek(c.weekCommencing),
                     rows: [],
                 };
                 currentGroups.push(map[k]);
             }
             map[k].rows.push(c);
         });
         currentGroups.forEach(function(g, gi) {
             g.rows.sort(function(a, b) {
                 return dayOrder(a) - dayOrder(b) || Number(a.rowNumber) - Number(b.rowNumber);
             });
             let gMins = 0;
             let pending = 0;
             g.rows.forEach(function(c) {
                 gMins += parseHoursToMins(c.dailyTotal);
                 if (!isApprovedStatus(c.status)) pending++;
             });
             const approvedN = g.rows.length - pending;
             const open = expandedGroups.has(g.key);
             let badge;
             if (pending === 0) badge = '<span class="badge-approved">Approved</span>';
             else if (approvedN === 0) badge = '<span class="badge-pending">Pending</span>';
             else badge = '<span class="badge-pending">' + pending + " pending / " + approvedN + " approved</span>";
             const action = pending > 0 ? '<button type="button" class="approve-btn" onclick="event.stopPropagation(); approveWeek(' + gi + ', this)">Approve Week (' + pending + ")</button>" : '<span style="color:#64748B;font-size:12px;">Authorised</span>';
             const tr = document.createElement("tr");
             tr.className = "group-row";
             tr.title = open ? "Click to hide days" : "Click to show days";
             tr.onclick = function() {
                 toggleGroup(gi);
             };
             tr.innerHTML = '<td><span class="chev">' + (open ? "&#9660;" : "&#9654;") + '</span><strong class="group-name">' + esc(g.name) + "</strong></td>" + "<td>" + esc(g.period) + " (" + esc(g.week) + ")</td>" + "<td>" + g.rows.length + " day" + (g.rows.length === 1 ? "" : "s") + "</td>" + "<td><strong>" + formatMins(gMins) + "</strong></td>" + "<td>" + badge + "</td>" + "<td>" + action + "</td>";
             tbody.appendChild(tr);
             if (!open) return;
             let dayHtml = "";
             g.rows.forEach(function(c) {
                 const approved = isApprovedStatus(c.status);
                 const badgeClass = approved ? "badge-approved" : "badge-pending";
                 const sigDisplay = c.signatureText || c.certifiedName || "Signed";
                 const editBtn = '<button type="button" class="edit-btn" onclick="openEdit(' + Number(c.rowNumber) + ')">Edit</button>' + '<button type="button" class="delete-btn" onclick="deleteClaim(' + Number(c.rowNumber) + ')">Delete</button>';
                 const actionHtml = approved ? '<span style="color:#64748B;font-size:12px;">Authorised</span> ' + editBtn : '<button class="approve-btn" onclick="approveSingle(' + Number(c.rowNumber) + ', this)">Approve</button> ' + editBtn;
                 dayHtml += "<tr>" + "<td><strong>" + esc(c.day) + "</strong></td>" + "<td>" + (c.amWorked === "Yes" ? esc(c.amStart) + "-" + esc(c.amFinish) : "-") + "</td>" + "<td>" + (c.pmWorked === "Yes" ? esc(c.pmStart) + "-" + esc(c.pmFinish) : "-") + "<td>" + extraMinsOf(c) + "m</td>" + "<td><strong>" + esc(c.dailyTotal) + "</strong></td>" + '<td><span class="sig-text">' + esc(sigDisplay) + "</span></td>" + '<td><span class="' + badgeClass + '">' + esc(c.status) + "</span></td>" + '<td class="day-actions">' + actionHtml + "</td>" + "</tr>";
             });
             const detail = document.createElement("tr");
             detail.className = "detail-row";
             detail.innerHTML = '<td colspan="6"><div class="day-wrap"><table class="day-table">' + "<thead><tr><th>Day</th><th>AM</th><th>PM</th><th>ET/RB</th><th>Total</th><th>Signed</th><th>Status</th><th>Action</th></tr></thead>" + "<tbody>" + dayHtml + "</tbody></table></div></td>";
             tbody.appendChild(detail);
         });
     }
     /* ---------- approve / edit / delete actions ---------- */
     function runBatchApprove(rowNumbers, btn, labelText) {
         if (!rowNumbers || rowNumbers.length === 0) return;
         if (btn) {
             btn.disabled = true;
             btn.textContent = "Approving...";
         }
         google.script.run.withSuccessHandler(function(updated) {
             allClaims = updated || [];
             updateSummary();
             renderTable();
             onPersonNameChange();
         }).withFailureHandler(function(err) {
             alert("Error: " + err.message);
             if (btn) {
                 btn.disabled = false;
                 btn.textContent = labelText;
             }
         }).approveMultipleRows(savedPasscode, rowNumbers, managerFullName);
     }

     function approveSingle(rowNumber, btn) {
         runBatchApprove([rowNumber], btn, "Approve");
     }

     function approveWeek(gi, btn) {
         const g = currentGroups[gi];
         if (!g) return;
         const rows = g.rows.filter(function(c) {
             return isPendingStatus(c.status);
         }).map(function(c) {
             return Number(c.rowNumber);
         });
         runBatchApprove(rows, btn, "Approve Week (" + rows.length + ")");
     }

     function approveAllFiltered() {
         const rows = currentFiltered.filter(function(c) {
             return isPendingStatus(c.status);
         }).map(function(c) {
             return Number(c.rowNumber);
         });
         if (rows.length === 0) {
             alert("There are no pending rows in the current filter.");
             return;
         }
         if (!confirm("Approve all " + rows.length + " filtered pending day(s)?")) return;
         const btn = document.getElementById("bulkApproveBtn");
         runBatchApprove(rows, btn, "Approve All Filtered Pending");
     }

     function openEdit(rowNumber) {
         const claim = allClaims.find(function(c) {
             return Number(c.rowNumber) === Number(rowNumber);
         });
         if (!claim) return;
         editingRowNumber = Number(rowNumber);
         document.getElementById("editModalWho").textContent = claim.invigilatorName + " — " + claim.day + " (" + normaliseWeek(claim.weekCommencing) + ")";
         document.getElementById("editApprovedNote").style.display = isApprovedStatus(claim.status) ? "block" : "none";
         document.getElementById("editAmWorked").checked = claim.amWorked === "Yes";
         document.getElementById("editAmStart").value = claim.amStart || "";
         document.getElementById("editAmFinish").value = claim.amFinish || "";
         document.getElementById("editAmExtra").value = Number(claim.amExtra) || 0;
         document.getElementById("editPmWorked").checked = claim.pmWorked === "Yes";
         document.getElementById("editPmStart").value = claim.pmStart || "";
         document.getElementById("editPmFinish").value = claim.pmFinish || "";
         document.getElementById("editPmExtra").value = Number(claim.pmExtra) || 0;
         document.getElementById("editErr").textContent = "";
         recalcEditTotal();
         document.getElementById("editModal").style.display = "flex";
     }

     function closeEditModal() {
         document.getElementById("editModal").style.display = "none";
         editingRowNumber = null;
     }

     function recalcEditTotal() {
         const amW = document.getElementById("editAmWorked").checked;
         const amS = document.getElementById("editAmStart").value;
         const amF = document.getElementById("editAmFinish").value;
         const amE = document.getElementById("editAmExtra").value;
         const pmW = document.getElementById("editPmWorked").checked;
         const pmS = document.getElementById("editPmStart").value;
         const pmF = document.getElementById("editPmFinish").value;
         const pmE = document.getElementById("editPmExtra").value;
         const total = (amW ? sessionMins(amS, amF, amE) : Number(amE) || 0) + (pmW ? sessionMins(pmS, pmF, pmE) : Number(pmE) || 0);
         document.getElementById("editTotalPreview").textContent = "New Daily Total: " + formatMins(total);
     }

     function saveEdit() {
         if (!editingRowNumber) return;
         const errEl = document.getElementById("editErr");
         const btn = document.getElementById("saveEditBtn");
         errEl.textContent = "";
         const payload = {
             amWorked: document.getElementById("editAmWorked").checked ? "Yes" : "No",
             amStart: document.getElementById("editAmStart").value.trim(),
             amFinish: document.getElementById("editAmFinish").value.trim(),
             amExtra: Number(document.getElementById("editAmExtra").value) || 0,
             pmWorked: document.getElementById("editPmWorked").checked ? "Yes" : "No",
             pmStart: document.getElementById("editPmStart").value.trim(),
             pmFinish: document.getElementById("editPmFinish").value.trim(),
             pmExtra: Number(document.getElementById("editPmExtra").value) || 0,
         };
         btn.disabled = true;
         btn.textContent = "Saving...";
         google.script.run.withSuccessHandler(function(updated) {
             allClaims = updated || [];
             btn.disabled = false;
             btn.textContent = "Save Changes";
             closeEditModal();
             updateSummary();
             renderTable();
             onPersonNameChange();
         }).withFailureHandler(function(err) {
             btn.disabled = false;
             btn.textContent = "Save Changes";
             errEl.textContent = err.message;
         }).updateClaimRow(savedPasscode, editingRowNumber, payload, managerFullName);
     }

     function deleteClaim(rowNumber) {
         const claim = allClaims.find(function(c) {
             return Number(c.rowNumber) === Number(rowNumber);
         });
         if (!claim) return;
         if (!confirm("Delete " + claim.invigilatorName + " — " + claim.day + " (" + normaliseWeek(claim.weekCommencing) + ")?\n\nA backup copy is saved to Deleted_Claims.")) {
             return;
         }
         google.script.run.withSuccessHandler(function(updated) {
             allClaims = updated || [];
             updateSummary();
             renderTable();
             onPersonNameChange();
         }).withFailureHandler(function(err) {
             alert("Error: " + err.message);
         }).deleteClaimRow(savedPasscode, Number(rowNumber), claim, managerFullName);
     }

     function exportFilteredCSV() {
         if (currentFiltered.length === 0) {
             alert("No rows to export.");
             return;
         }
         const headers = ["Invigilator", "Exam Period", "Week Commencing", "Day", "AM Worked", "AM Start", "AM Finish", "PM Worked", "PM Start", "PM Finish", "AM ET/RB", "PM ET/RB", "Daily Total", "Status", ];
         const lines = [headers.join(",")];
         currentFiltered.forEach(function(c) {
             const row = [
                 c.invigilatorName,
                 c.examPeriod,
                 c.weekCommencing,
                 c.day,
                 c.amWorked,
                 c.amStart,
                 c.amFinish,
                 c.pmWorked,
                 c.pmStart,
                 c.pmFinish,
                 c.amExtra,
                 c.pmExtra,
                 c.dailyTotal,
                 c.status,
             ].map(function(v) {
                 return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
             });
             lines.push(row.join(","));
         });
         const blob = new Blob([lines.join("\n")], {
             type: "text/csv;charset=utf-8;"
         });
         const a = document.createElement("a");
         a.href = URL.createObjectURL(blob);
         a.download = "Invigilator_Claims_Export.csv";
         a.click();
     }
     /* ---------- individual time sheet view ---------- */
     function onPersonNameChange() {
         const nameInput = document.getElementById("personSearchInput").value.trim().toLowerCase();
         const monthSelect = document.getElementById("personMonthFilter");
         const selectedMonth = monthSelect.value;
         const container = document.getElementById("personSheetContainer");
         container.innerHTML = "";
         if (!nameInput) {
             container.innerHTML = '<p style="color:#475569;">Enter or select an invigilator name above.</p>';
             return;
         }
         const personRows = allClaims.filter(function(c) {
             return String(c.invigilatorName || "").trim().toLowerCase() === nameInput;
         });
         if (personRows.length === 0) {
             container.innerHTML = '<p style="color:#475569;">No claims found for that name.</p>';
             return;
         }
         // Populate month filter
         const months = new Set();
         personRows.forEach(function(c) {
             const d = claimDayDate(c);
             if (d) months.add(monthKey(d));
         });
         const prevMonth = selectedMonth;
         monthSelect.innerHTML = '<option value="">All Months</option>';
         Array.from(months).sort().forEach(function(mk) {
             const opt = document.createElement("option");
             opt.value = mk;
             opt.textContent = monthLabel(mk);
             monthSelect.appendChild(opt);
         });
         monthSelect.value = months.has(prevMonth) ? prevMonth : "";
         const filtered = personRows.filter(function(c) {
             if (!monthSelect.value) return true;
             const d = claimDayDate(c);
             return d && monthKey(d) === monthSelect.value;
         });
         const weeks = {};
         filtered.forEach(function(c) {
             const wk = normaliseWeek(c.weekCommencing) + " (" + c.examPeriod + ")";
             if (!weeks[wk]) weeks[wk] = [];
             weeks[wk].push(c);
         });
         let grandMins = 0;
         Object.entries(weeks).forEach(function(entry) {
             const wkTitle = entry[0];
             const rows = entry[1];
             rows.sort(function(a, b) {
                 return dayOrder(a) - dayOrder(b);
             });
             let wkMins = 0;
             let rowsHtml = "";
             rows.forEach(function(c) {
                 wkMins += parseHoursToMins(c.dailyTotal);
                 const approved = isApprovedStatus(c.status);
                 rowsHtml += "<tr>" + "<td><strong>" + esc(c.day) + "</strong></td>" + "<td>" + (c.amWorked === "Yes" ? esc(c.amStart) + " - " + esc(c.amFinish) : "-") + "</td>" + "<td>" + (c.pmWorked === "Yes" ? esc(c.pmStart) + " - " + esc(c.pmFinish) : "-") + "</td>" + "<td>" + extraMinsOf(c) + "m</td>" + "<td><strong>" + esc(c.dailyTotal) + "</strong></td>" + '<td><span class="' + (approved ? "badge-approved" : "badge-pending") + '">' + esc(c.status) + "</span></td>" + "</tr>";
             });
             grandMins += wkMins;
             const block = document.createElement("div");
             block.className = "week-block";
             block.innerHTML = '<div class="week-banner"><span>WEEK COM ' + esc(wkTitle) + "</span><span>Week Total: " + formatMins(wkMins) + "</span></div>" + '<div class="table-wrap" style="border:none;border-radius:0;"><table>' + "<thead><tr><th>Day</th><th>AM</th><th>PM</th><th>ET/RB</th><th>Total</th><th>Status</th></tr></thead>" + "<tbody>" + rowsHtml + "</tbody></table></div>";
             container.appendChild(block);
         });
         const footer = document.createElement("div");
         footer.className = "person-footer";
         footer.innerHTML = "<strong>" + esc(personRows[0].invigilatorName) + " — Total Hours Shown:</strong>" + '<span style="font-size:20px;font-weight:800;color:var(--forest);">' + formatMins(grandMins) + "</span>";
         container.appendChild(footer);
     }
     /* ---------- schedule builder ---------- */
     function copyMondayTimes() {
         const rows = Array.from(document.querySelectorAll("#schedBuilderBody tr"));
         if (rows.length < 2) return;
         const mon = rows[0];
         const amS = mon.querySelector(".sb-am-s").value;
         const amF = mon.querySelector(".sb-am-f").value;
         const pmS = mon.querySelector(".sb-pm-s").value;
         const pmF = mon.querySelector(".sb-pm-f").value;
         for (let i = 1; i < rows.length; i++) {
             rows[i].querySelector(".sb-am-s").value = amS;
             rows[i].querySelector(".sb-am-f").value = amF;
             rows[i].querySelector(".sb-pm-s").value = pmS;
             rows[i].querySelector(".sb-pm-f").value = pmF;
         }
     }

     function normaliseTime(str) {
         const t = String(str || "").trim().replace(".", ":");
         if (!t) return "";
         const m = /^(\d{1,2}):(\d{2})$/.exec(t);
         if (!m) return null;
         const h = parseInt(m[1], 10);
         const min = parseInt(m[2], 10);
         if (h > 23 || min > 59) return null;
         return (h < 10 ? "0" : "") + h + ":" + m[2];
     }

     function submitNewSchedule() {
         const role = document.getElementById("schedRoleInput").value;
         const period = document.getElementById("schedPeriodInput").value.trim();
         const rawWeek = document.getElementById("schedWeekInput").value.trim();
         const statusEl = document.getElementById("schedStatusMsg");
         const btn = document.getElementById("saveSchedBtn");

         function fail(msg) {
             statusEl.style.color = "#B91C1C";
             statusEl.textContent = msg;
         }
         if (!period) return fail("Please enter an Exam Period.");
         if (!rawWeek) return fail("Please choose a Week Commencing date.");
         let week = rawWeek;
         if (/^\d{4}-\d{2}-\d{2}$/.test(rawWeek)) {
             const parts = rawWeek.split("-");
             week = parts[2] + "/" + parts[1] + "/" + parts[0].slice(2);
         }
         const days = [];
         let problem = "";
         let anyTimes = false;
         document.querySelectorAll("#schedBuilderBody tr").forEach(function(tr) {
             const day = tr.dataset.day;
             const amS = normaliseTime(tr.querySelector(".sb-am-s").value);
             const amF = normaliseTime(tr.querySelector(".sb-am-f").value);
             const pmS = normaliseTime(tr.querySelector(".sb-pm-s").value);
             const pmF = normaliseTime(tr.querySelector(".sb-pm-f").value);
             if ([amS, amF, pmS, pmF].indexOf(null) !== -1) {
                 problem = problem || day + ": times must look like 08:00.";
                 return;
             }
             if ((amS && !amF) || (!amS && amF)) problem = problem || day + ": AM needs both a start and finish.";
             if ((pmS && !pmF) || (!pmS && pmF)) problem = problem || day + ": PM needs both a start and finish.";
             if (amS && amF && parseHoursToMins(amF) <= parseHoursToMins(amS)) problem = problem || day + ": AM finish must be after AM start.";
             if (pmS && pmF && parseHoursToMins(pmF) <= parseHoursToMins(pmS)) problem = problem || day + ": PM finish must be after PM start.";
             if (amS || pmS) anyTimes = true;
             days.push({
                 day: day,
                 amStart: amS,
                 amFinish: amF,
                 pmStart: pmS,
                 pmFinish: pmF
             });
         });
         if (problem) return fail(problem);
         if (!anyTimes) return fail("Please enter at least one session time.");
         btn.disabled = true;
         btn.textContent = "Saving Schedule...";
         statusEl.textContent = "";
         google.script.run.withSuccessHandler(function(updatedSched) {
             allSchedules = updatedSched || [];
             renderExistingSchedules();
             statusEl.style.color = "#1B5E20";
             statusEl.textContent = 'Saved! "' + period + " — Week Com " + week + '" (' + role + ") is now live on the form.";
             btn.disabled = false;
             btn.textContent = "Save Exam Schedule to Form";
         }).withFailureHandler(function(err) {
             fail("Error: " + err.message);
             btn.disabled = false;
             btn.textContent = "Save Exam Schedule to Form";
         }).saveExamSchedule(savedPasscode, {
             role: role,
             period: period,
             week: week,
             days: days
         });
     }

     function renderExistingSchedules() {
         const dl = document.getElementById("periodOptionsList");
         const periods = Array.from(new Set(allSchedules.map(function(s) {
             return s.period;
         })));
         dl.innerHTML = "";
         periods.forEach(function(p) {
             const opt = document.createElement("option");
             opt.value = p;
             dl.appendChild(opt);
         });
         const container = document.getElementById("existingSchedulesList");
         container.innerHTML = "";
         const grouped = {};
         allSchedules.forEach(function(s) {
             const key = (s.role || "Supporting Invigilator") + "||" + s.period + "||" + s.week + "||" + (s.source || "sheet");
             if (!grouped[key]) grouped[key] = [];
             grouped[key].push(s);
         });
         const entries = Object.entries(grouped);
         if (entries.length === 0) {
             const p = document.createElement("p");
             p.style.color = "#475569";
             p.style.fontSize = "13.5px";
             p.textContent = "No exam schedules found.";
             container.appendChild(p);
             return;
         }
         entries.forEach(function(entry) {
             const key = entry[0];
             const rows = entry[1];
             const parts = key.split("||");
             const role = parts[0];
             const period = parts[1];
             const week = parts[2];
             const source = parts[3];
             const box = document.createElement("div");
             box.style.cssText = "border:1.5px solid #D0D9E8; border-left:4px solid #0D2D6C; border-radius:8px; padding:12px 14px; margin-bottom:10px; background:#fff; display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px;";
             const info = document.createElement("div");
             const badge = document.createElement("span");
             badge.textContent = role;
             badge.style.cssText = "display:inline-block; background:#0D2D6C; color:#fff; font-size:11px; font-weight:700; padding:2px 7px; border-radius:4px; margin-right:8px;";
             info.appendChild(badge);
             const titleSpan = document.createElement("span");
             titleSpan.style.fontWeight = "700";
             titleSpan.style.color = "#1E293B";
             titleSpan.textContent = period + " — Week Com " + week + " (" + rows.length + " day(s))";
             info.appendChild(titleSpan);
             box.appendChild(info);
             if (source === "portal") {
                 const delBtn = document.createElement("button");
                 delBtn.type = "button";
                 delBtn.textContent = "Delete Week";
                 delBtn.style.cssText = "padding:6px 12px; background:#DC2626; color:#fff; border:none; border-radius:5px; font-size:12px; font-weight:700; cursor:pointer;";
                 delBtn.onclick = function() {
                     if (!confirm("Delete " + period + " — Week Com " + week + " (" + role + ")?")) return;
                     delBtn.disabled = true;
                     delBtn.textContent = "Deleting...";
                     google.script.run.withSuccessHandler(function(updated) {
                         allSchedules = updated || [];
                         renderExistingSchedules();
                     }).withFailureHandler(function(err) {
                         alert("Error: " + err.message);
                         delBtn.disabled = false;
                         delBtn.textContent = "Delete Week";
                     }).deleteExamWeek(savedPasscode, role, period, week);
                 };
                 box.appendChild(delBtn);
             } else {
                 const tag = document.createElement("span");
                 tag.textContent = "From Sheet Tab";
                 tag.style.cssText = "font-size:11.5px; background:#E2E8F0; color:#334155; padding:4px 8px; border-radius:4px; font-weight:600;";
                 box.appendChild(tag);
             }
             container.appendChild(box);
         });
     }
     /* ---------- invigilator list & credential generator ---------- */
     let allPeople = [];

     function generatePortalPassword() {
         const digits = Math.floor(1000 + Math.random() * 9000);
         return "Upton" + digits;
     }

     function copyGeneratedCreds(text, btnEl) {
         navigator.clipboard.writeText(text).then(function() {
             btnEl.textContent = "Copied!";
             setTimeout(function() {
                 btnEl.textContent = "Copy Login Details";
             }, 2000);
         });
     }

     function loadPeople() {
         google.script.run.withSuccessHandler(function(list) {
             allPeople = list || [];
             renderPeople();
         }).withFailureHandler(function(err) {
             const el = document.getElementById("peopleStatusMsg");
             el.style.color = "#B91C1C";
             el.textContent = "Error: " + err.message;
         }).getInvigilatorList();
     }

     function renderPeople() {
         const box = document.getElementById("peopleList");
         box.innerHTML = "";
         document.getElementById("peopleHeading").textContent = "Invigilators on the Portal (" + allPeople.length + ")";
         if (allPeople.length === 0) {
             const p = document.createElement("p");
             p.style.color = "#475569";
             p.style.fontSize = "13.5px";
             p.textContent = "No invigilators added yet.";
             box.appendChild(p);
             return;
         }
         allPeople.forEach(function(name) {
             const row = document.createElement("div");
             row.style.cssText = "border:1.5px solid #D0D9E8; border-left:4px solid #78BE20; border-radius:8px; padding:10px 14px; margin-bottom:8px; background:#fff; display:flex; justify-content:space-between; align-items:center; gap:10px;";
             const label = document.createElement("span");
             label.style.fontWeight = "700";
             label.style.color = "#1E293B";
             label.textContent = name;
             row.appendChild(label);
             const btn = document.createElement("button");
             btn.type = "button";
             btn.className = "delete-btn";
             btn.textContent = "Remove";
             btn.onclick = function() {
                 removePerson(name, btn);
             };
             row.appendChild(btn);
             box.appendChild(row);
         });
     }

     function addPerson() {
         const nameInput = document.getElementById("newPersonName");
         const emailInput = document.getElementById("newPersonEmail");
         const statusEl = document.getElementById("peopleStatusMsg");
         const credsBox = document.getElementById("generatedCredsBox");
         const btn = document.getElementById("addPersonBtn");

         const name = nameInput.value.replace(/\s+/g, " ").trim();
         const email = emailInput.value.trim().toLowerCase();

         if (name.length < 2) {
             statusEl.style.color = "#B91C1C";
             statusEl.textContent = "Please enter the invigilator's full name.";
             nameInput.focus();
             return;
         }
         if (!email || email.indexOf("@") === -1) {
             statusEl.style.color = "#B91C1C";
             statusEl.textContent = "Please enter a valid school email address.";
             emailInput.focus();
             return;
         }

         const generatedPassword = generatePortalPassword();
         btn.disabled = true;
         btn.textContent = "Adding...";
         statusEl.textContent = "";
         credsBox.style.display = "none";

         google.script.run.withSuccessHandler(function(list) {
             allPeople = list || [];
             renderPeople();
             nameInput.value = "";
             emailInput.value = "";
             statusEl.style.color = "#1B5E20";
             statusEl.textContent = 'Added "' + name + '" to the portal.';

             const shareText = "Invigilator Time Sheet Portal — Email: " + email + " | Portal Password: " + generatedPassword;
             credsBox.innerHTML =
                 "<strong>Login Created for " + esc(name) + "</strong><br>" +
                 "School Email: <code>" + esc(email) + "</code> &nbsp;|&nbsp; " +
                 "Portal Password: <code style='font-size:1.05em;font-weight:700;'>" + esc(generatedPassword) + "</code> " +
                 "<button type='button' id='copyCredsBtn' style='margin-left:10px;padding:4px 10px;border:1px solid #166534;border-radius:4px;background:#fff;color:#166534;font-weight:700;cursor:pointer;'>Copy Login Details</button>";
             credsBox.style.display = "block";
             document.getElementById("copyCredsBtn").onclick = function() {
                 copyGeneratedCreds(shareText, this);
             };

             btn.disabled = false;
             btn.textContent = "Add Person & Generate Password";
             nameInput.focus();
         }).withFailureHandler(function(err) {
             statusEl.style.color = "#B91C1C";
             statusEl.textContent = "Error: " + err.message;
             btn.disabled = false;
             btn.textContent = "Add Person & Generate Password";
         }).addInvigilator(savedPasscode, name, managerFullName, email, generatedPassword);
     }

     function removePerson(name, btn) {
         if (!confirm('Remove "' + name + '" from the portal?\n\nTheir existing claims and time sheet are not affected.')) return;
         btn.disabled = true;
         btn.textContent = "Removing...";
         google.script.run.withSuccessHandler(function(list) {
             allPeople = list || [];
             renderPeople();
         }).withFailureHandler(function(err) {
             alert("Error: " + err.message);
             btn.disabled = false;
             btn.textContent = "Remove";
         }).removeInvigilator(savedPasscode, name);
     }

     async function exportIndividualTimesheet() {
       const personName = String(document.getElementById('personSearchInput').value || '').trim();
       if (!personName) {
         alert('Please type or select an invigilator name first.');
         return;
       }

       const sourceClaims = (typeof allClaims !== 'undefined' && Array.isArray(allClaims))
         ? allClaims
         : (typeof claimsData !== 'undefined' && Array.isArray(claimsData) ? claimsData : []);

       let claims = sourceClaims.filter(
         c => String(c.invigilatorName || '').trim().toLowerCase() === personName.toLowerCase()
       );

       const filterVal = String(document.getElementById('personMonthFilter').value || '').trim();
       if (filterVal) {
         claims = claims.filter(c => {
           if (String(c.examPeriod || '').trim() === filterVal) return true;
           const wkParts = String(c.weekCommencing || '').trim().split(/[\/\-.]/);
           if (wkParts.length === 3) {
             const y = wkParts[2].length === 2 ? '20' + wkParts[2] : wkParts[2];
             const ym = y + '-' + wkParts[1].padStart(2, '0');
             if (ym === filterVal || wkParts[1].padStart(2, '0') === filterVal) return true;
           }
           return false;
         });
       }

       if (claims.length === 0) {
         alert('No claims found to export for ' + personName + '.');
         return;
       }

       const rawPeriod = String(claims[0].examPeriod || '').trim();
       const isLead = /^\[Lead\]/i.test(rawPeriod);
       const roleTitle = isLead ? 'LEAD INVIGILATOR' : 'SUPPORTING INVIGILATOR';
       const cleanPeriod = rawPeriod.replace(/^\[(Lead|Supporting)\]\s*/i, '').trim() || rawPeriod;

       function minsToHms(mins) {
         const m = Math.max(0, Math.round(Number(mins) || 0));
         const h = Math.floor(m / 60);
         const rem = m % 60;
         return h + ':' + String(rem).padStart(2, '0') + ':00';
       }

       function parseTimeMins(t) {
         const p = String(t || '').trim().replace('.', ':').split(':');
         if (p.length < 2) return null;
         const h = parseInt(p[0], 10), m = parseInt(p[1], 10);
         return (isNaN(h) || isNaN(m)) ? null : (h * 60 + m);
       }

       const wb = new ExcelJS.Workbook();
       const ws = wb.addWorksheet('Time Sheet');

       // Column widths matching your template (Cols A - J)
       ws.columns = [
         { width: 22 }, // A: EXAM SESSIONS / Day
         { width: 15 }, // B: AM START
         { width: 19 }, // C: AM FINISH
         { width: 17 }, // D: SESSIONS WORKED (AM)
         { width: 15 }, // E: PM START
         { width: 19 }, // F: PM FINISH
         { width: 17 }, // G: SESSIONS WORKED (PM)
         { width: 18 }, // H: ADDITIONAL HOURS AM
         { width: 6 },  // I: Green divider column
         { width: 18 }  // J: ADDITIONAL HOURS PM
       ];

       const thinBorder = {
         top: { style: 'thin', color: { argb: 'FF000000' } },
         left: { style: 'thin', color: { argb: 'FF000000' } },
         bottom: { style: 'thin', color: { argb: 'FF000000' } },
         right: { style: 'thin', color: { argb: 'FF000000' } }
       };
       const sideBorder = {
         left: { style: 'thin', color: { argb: 'FF000000' } },
         right: { style: 'thin', color: { argb: 'FF000000' } }
       };
       const sageFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA9C79B' } };
       const greyFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };

       // Title, Exam Period, and Name rows
       ws.getCell('A1').value = 'UPTON-BY-CHESTER HIGH SCHOOL- ' + roleTitle + ' TIME SHEET';
       ws.getCell('A1').font = { name: 'Arial', size: 12, bold: true };

       ws.getCell('A2').value = cleanPeriod;
       ws.getCell('A2').font = { name: 'Arial', size: 11, bold: true };

       ws.getCell('A4').value = 'NAME';
       ws.getCell('A4').font = { name: 'Arial', size: 10, bold: true };
       ws.getCell('B4').value = personName;
       ws.getCell('B4').font = { name: 'Arial', size: 10, bold: true };

       // Group claims by Week Commencing
       const weekMap = new Map();
       claims.forEach(c => {
         const wk = String(c.weekCommencing || '').trim();
         if (!weekMap.has(wk)) weekMap.set(wk, []);
         weekMap.get(wk).push(c);
       });

       let r = 6;
       let grandTotalMins = 0;
       const defaultDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

       weekMap.forEach((weekClaims, weekCom) => {
         // Header Row
         const hdrRow = ws.getRow(r);
         hdrRow.values = [
           'EXAM SESSIONS',
           'AM START\nINC SET UP',
           'AM FINISH\nINC PACK UP/SET UP',
           'SESSIONS WORKED',
           'PM START\nINC SET UP',
           'PM FINISH\nINC PACK UP/SET UP',
           'SESSIONS WORKED',
           'ADDITIONAL HOURS AGREED WITH EXAM TEAM DUE TO ET / RB',
           '',
           ''
         ];
         hdrRow.height = 30;
         ws.mergeCells(r, 8, r, 10);
         for (let c = 1; c <= 10; c++) {
           const cell = hdrRow.getCell(c);
           cell.font = { name: 'Arial', size: 9, bold: true };
           cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
           cell.border = thinBorder;
         }
         r++;

         // Sub-header Row (WEEK COM + AM/PM)
         const subRow = ws.getRow(r);
         subRow.values = ['WEEK COM ' + weekCom, '', '', '', '', '', '', 'AM', '', 'PM'];
         ws.mergeCells(r, 2, r, 7);
         for (let c = 1; c <= 10; c++) {
           const cell = subRow.getCell(c);
           cell.font = { name: 'Arial', size: 9, bold: true };
           if (c === 1) {
             cell.border = thinBorder;
           } else if (c >= 2 && c <= 7) {
             cell.fill = sageFill;
             cell.border = { top: thinBorder.top, bottom: thinBorder.bottom };
           } else if (c === 9) {
             cell.fill = sageFill;
             cell.border = sideBorder;
           } else {
             cell.border = thinBorder;
           }
         }
         r++;

         // 5 Day Rows (MONDAY - FRIDAY)
         defaultDays.forEach(dayName => {
           const match = weekClaims.find(c => String(c.day || '').trim().toUpperCase() === dayName);
           const dayRow = ws.getRow(r);

           let amStart = '', amFinish = '', amBox = '☐';
           let pmStart = '', pmFinish = '', pmBox = '☐';
           let amExtraStr = '', pmExtraStr = '';

           if (match) {
             const amWorked = match.amWorked === 'Yes';
             const pmWorked = match.pmWorked === 'Yes';
             const amExtra = Number(match.amExtra) || 0;
             const pmExtra = Number(match.pmExtra) || 0;

             let dayMins = amExtra + pmExtra;
             if (amWorked) {
               amStart = match.amStart || '';
               amFinish = match.amFinish || '';
               amBox = '☑';
               const s = parseTimeMins(match.amStart), f = parseTimeMins(match.amFinish);
               if (s !== null && f !== null && f > s) dayMins += (f - s);
             }
             if (pmWorked) {
               pmStart = match.pmStart || '';
               pmFinish = match.pmFinish || '';
               pmBox = '☑';
               const s = parseTimeMins(match.pmStart), f = parseTimeMins(match.pmFinish);
               if (s !== null && f !== null && f > s) dayMins += (f - s);
             }
             if (amExtra > 0) amExtraStr = minsToHms(amExtra);
             if (pmExtra > 0) pmExtraStr = minsToHms(pmExtra);
             grandTotalMins += dayMins;
           }

           dayRow.values = [dayName, amStart, amFinish, amBox, pmStart, pmFinish, pmBox, amExtraStr, '', pmExtraStr];
           for (let c = 1; c <= 10; c++) {
             const cell = dayRow.getCell(c);
             cell.font = { name: 'Arial', size: c === 4 || c === 7 ? 12 : 10 };
             if (c === 1) {
               cell.fill = greyFill;
               cell.border = thinBorder;
               cell.alignment = { horizontal: 'left', vertical: 'middle' };
             } else if (c === 9) {
               cell.fill = sageFill;
               cell.border = sideBorder;
             } else {
               cell.border = thinBorder;
               cell.alignment = { horizontal: 'center', vertical: 'middle' };
             }
           }
           r++;
         });

         // Sage green separator bar after each week
         const sepRow = ws.getRow(r);
         sepRow.height = 14;
         for (let c = 1; c <= 10; c++) {
           const cell = sepRow.getCell(c);
           cell.fill = sageFill;
           cell.border = c === 9 ? sideBorder : { top: thinBorder.top, bottom: thinBorder.bottom, left: c === 1 ? thinBorder.left : undefined, right: c === 10 ? thinBorder.right : undefined };
         }
         r++;
       });

       // Total Hours Claimed Row (Cols H & I)
       const totRow = ws.getRow(r);
       totRow.getCell(8).value = 'TOTAL HOURS CLAIMED';
       totRow.getCell(8).font = { name: 'Arial', size: 9, bold: true };
       totRow.getCell(8).border = thinBorder;

       totRow.getCell(9).value = minsToHms(grandTotalMins);
       totRow.getCell(9).font = { name: 'Arial', size: 10, bold: true };
       totRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };
       totRow.getCell(9).border = thinBorder;
       r++;

       // Decimal Hours Row for Finance (Cols H & I)
       const decimalHours = Number((grandTotalMins / 60).toFixed(2));
       const decRow = ws.getRow(r);
       decRow.getCell(8).value = 'TOTAL HOURS (DECIMAL)';
       decRow.getCell(8).font = { name: 'Arial', size: 9, bold: true };
       decRow.getCell(8).border = thinBorder;

       decRow.getCell(9).value = decimalHours;
       decRow.getCell(9).numFmt = '0.00';
       decRow.getCell(9).font = { name: 'Arial', size: 10, bold: true };
       decRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };
       decRow.getCell(9).border = thinBorder;
       r += 2;

       // Certification & Authorisation Footer
       const latest = claims[claims.length - 1];
       const isApproved = String(latest.status || '').toLowerCase().startsWith('approved');

       ws.getCell(r, 1).value = 'I certify that I have worked the hours claimed above:';
       ws.getCell(r, 1).font = { name: 'Arial', size: 10, bold: true };
       r++;

       const certFields = [
         ['Name', latest.certifiedName || personName, false],
         ['signed', latest.signatureText || '', true],
         ['Date', latest.claimDate || '', false]
       ];
       certFields.forEach(([label, val, italic]) => {
         ws.getCell(r, 1).value = label;
         ws.getCell(r, 1).font = { name: 'Arial', size: 10, bold: true };
         ws.getCell(r, 1).border = thinBorder;

         ws.mergeCells(r, 2, r, 3);
         ws.getCell(r, 2).value = val;
         ws.getCell(r, 2).font = { name: 'Arial', size: 10, italic: italic };
         ws.getCell(r, 2).border = thinBorder;
         ws.getCell(r, 3).border = thinBorder;
         r++;
       });

       r++;
       ws.getCell(r, 1).value = 'AUTHORISED BY EXAMINATIONS MANAGER';
       ws.getCell(r, 1).font = { name: 'Arial', size: 10, bold: true };
       r++;

       ws.getCell(r, 1).value = 'NAME';
       ws.getCell(r, 1).font = { name: 'Arial', size: 10, bold: true };
       ws.getCell(r, 1).border = thinBorder;

       ws.mergeCells(r, 2, r, 3);
       ws.getCell(r, 2).value = isApproved ? latest.status : 'Pending';
       ws.getCell(r, 2).font = { name: 'Arial', size: 10 };
       ws.getCell(r, 2).border = thinBorder;
       ws.getCell(r, 3).border = thinBorder;

       // Write true .xlsx binary buffer and download
       const buffer = await wb.xlsx.writeBuffer();
       const blob = new Blob([buffer], {
         type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       });
       const url = URL.createObjectURL(blob);

       const link = document.createElement('a');
       const safeName = personName.replace(/[^a-z0-9_-]/gi, '_');
       const safePeriod = cleanPeriod.replace(/[^a-z0-9_-]/gi, '_');
       link.href = url;
       link.download = `${safeName}_${safePeriod}_TimeSheet.xlsx`;
       document.body.appendChild(link);
       link.click();
       document.body.removeChild(link);
       URL.revokeObjectURL(url);
     }