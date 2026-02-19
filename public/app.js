const API = "http://127.0.0.1:5000";

/* ----------------------- Utilities ----------------------- */
const $ = (s, r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));

function fmt(d){ if(!d)return""; const dt=new Date(d); return isNaN(dt)? "": dt.toLocaleDateString(); }
function esc(s=""){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function n0(v){ return v==null?0:v; }

/* Populate courses for selects */
async function populateCourseSelect(selector) {
  const sel = document.querySelector(selector);
  if (!sel) return;

  sel.innerHTML = `<option value="">Loading…</option>`;

  try {
    const courses = await fetchJSON(`${API}/api/courses`);
    if (!Array.isArray(courses) || courses.length === 0) {
      sel.innerHTML = `<option value="">No courses available</option>`;
      return;
    }

    sel.innerHTML = courses
      .map(c => `<option value="${c.course_id}">${esc(c.name)}</option>`)
      .join("");
  } catch (err) {
    console.error("Populate courses failed:", err);
    sel.innerHTML = `<option value="">Failed to load courses</option>`;
  }
}

function statusBadge(status) {
  // Normalize
  const s = (status || "").toLowerCase();

  // Map to Bootstrap badge variants + readable label
  const MAP = {
    "current":        { cls: "success",  text: "Current" },
    "expiring_soon":  { cls: "warning",  text: "Expiring Soon" },
    "expired":        { cls: "danger",   text: "Expired" }
  };

  const m = MAP[s] || { cls: "secondary", text: s || "—" };
  return `<span class="badge text-bg-${m.cls}">${esc(m.text)}</span>`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row =>
    row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")
  ).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* -------------------- fetchJSON helper ------------------ */
async function fetchJSON(url, options={}) {
  options.credentials = "include";
  options.cache = "no-store";   // ⬅ IMPORTANT
  const res = await fetch(url, options);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch(e) { return text; }
}

/* ========================================================
   ROLE HELPERS — REQUIRED FOR STRICT RBAC
======================================================== */
function account() {
  try { return JSON.parse(sessionStorage.getItem("account")||"{}"); }
  catch { return {}; }
}
function isAdmin(){ return account().role==="admin"; }
function isManager(){ return account().role==="manager"; }
function isAdminOrManager(){ return isAdmin() || isManager(); }
function isUser(){ return !isAdmin() && !isManager(); }

/* ========================================================
   UI HIDING ACCORDING TO ROLE
======================================================== */
function applyRoleUIRestrictions() {
  const acc = account();

  // Topnav items
  const peopleNav = document.querySelector('[data-route="/people"]')?.closest("li");
  const reportsNav = document.querySelector('[data-route="/reports"]')?.closest("li");
  const newCourseBtn = $("#btnNewCourse");

  if (isUser()) {
    peopleNav?.classList.add("d-none");
    reportsNav?.classList.add("d-none");
  }

  if (!isAdminOrManager()) {
    newCourseBtn?.classList.add("d-none");
  }
}

/* ---------------- Toasts ---------------- */
function showToast(title,message,variant="primary"){
  const host=$("#toastHost"); if(!host){alert(message); return;}
  const el=document.createElement("div");
  el.className=`toast align-items-center text-bg-${variant}`;
  el.innerHTML=`
    <div class="d-flex">
      <div class="toast-body"><strong>${esc(title)}</strong><div class="small">${esc(message)}</div></div>
      <button class="btn-close me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
  host.appendChild(el);
  new bootstrap.Toast(el,{delay:2800}).show();
  el.addEventListener("hidden.bs.toast",()=>el.remove());
}
function show(el){el?.classList.remove("d-none");}
function hide(el){el?.classList.add("d-none");}

/* ---------------- Router ---------------- */
const routes = {
  "/dashboard": renderDashboard,
  "/people": renderPeople,
  "/reports": renderReports,
  "/my-training": renderMyTraining,
};

function currentRoute(){
  const hash=location.hash||"#/dashboard";
  const route=hash.replace("#","");
  return routes[route]?route:"/dashboard";
}

function setActiveNav(route){
  $$("#mainNav .nav-link").forEach(a=>a.classList.toggle("active",a.dataset.route===route));
}

function navigate(route){
  // STRICT RBAC : forbid some routes
  if (route==="/people" && isUser()) {
    showToast("Forbidden","You do not have permission to view People","danger");
    return navigate("/dashboard");
  }
  if (route==="/reports" && isUser()) {
    showToast("Forbidden","You do not have permission to view Reports","danger");
    return navigate("/dashboard");
  }

  const tplId={
    "/dashboard":"tpl-dashboard",
    "/people":"tpl-people",
    "/reports":"tpl-reports",
    "/my-training":"tpl-mytraining"
  }[route];
  const tpl=document.getElementById(tplId);
  const root=$("#app-root");
  root.innerHTML=tpl?tpl.innerHTML:`<p class="text-danger">Page not found</p>`;

  applyRoleUIRestrictions();
  (routes[route]||(()=>{}))();
  setActiveNav(route);
}

window.addEventListener("hashchange",()=>navigate(currentRoute()));

/* ========================================================
   BOOTSTRAP
======================================================== */
document.addEventListener("DOMContentLoaded", () => {
  const acc = sessionStorage.getItem("account");
  if (!acc && !location.pathname.toLowerCase().includes("login")) {
    location.href="Login.html"; return;
  }

  navigate(currentRoute());

  $("#mainNav")?.addEventListener("click",e=>{
    const link=e.target.closest("a.nav-link");
    if(!link)return;
    e.preventDefault();
    location.hash=link.dataset.route;
  });

  // Modal handlers
  $("#courseForm")?.addEventListener("submit", handleCourseSubmit);
  $("#recordForm")?.addEventListener("submit", handleRecordSubmit);
  $("#thirdPartyForm")?.addEventListener("submit", handleThirdPartySubmit);

  document.addEventListener("click",(e)=>{
    if(e.target.id==="btnAddThirdParty") openThirdPartyModal();
  });
});

document.addEventListener("click", async (e) => {
  if (e.target.closest("#btnSaveRole")) {
    const select = document.querySelector("#personRoleSelect");
    const personId = Number(select.dataset.personId);
    const newRole = select.value;

    try {
      await fetchJSON(`${API}/api/people/${personId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole })
      });

      showToast("Updated", "Role updated successfully", "success");
      // Reload profile so the UI reflects changes
      openPersonProfile(personId);

    } catch (err) {
      console.error(err);
      showToast("Error", "Failed to save role", "danger");
    }
  }
});

/* ========================================================
   DASHBOARD
======================================================== */
async function renderDashboard() {

  /* ---------- TOP STATS ---------- */
  try {
    const s = await fetchJSON(`${API}/api/stats`);
    $("#statStaff").textContent = s.totalStaff;
    $("#statCourses").textContent = s.activeCourses;
    $("#statExpiring").textContent = s.expiringSoon;
    $("#statCerts").textContent = s.currentCerts;
  } catch (err) {
    console.warn("Stats load failed:", err);
  }

  /* =====================================================
     HIDE "ALL RECORDS" TAB FOR NORMAL USERS
  ====================================================== */
  const allRecordsTab = document.querySelector('#tabAllRecordsWrapper');
  if (isUser()) {
    allRecordsTab?.classList.add("d-none");
  } else {
    allRecordsTab?.classList.remove("d-none");
  }

  // Hide All Records tab + pane for normal users
  if (isUser()) {
    document.querySelector('#tabAllRecordsWrapper')?.classList.add("d-none");
    document.querySelector('#records')?.classList.add("d-none");
  } else {
    document.querySelector('#tabAllRecordsWrapper')?.classList.remove("d-none");
    document.querySelector('#records')?.classList.remove("d-none");
  }

  /* ---------- UPCOMING EXPIRIES (Calendar Tab) ---------- */
  async function loadUpcoming() {
    const container = document.querySelector("#calendar .card-body");

    try {
      let rows = await fetchJSON(`${API}/api/expiring`);

      /* ==============================================
         USERS ONLY SEE THEIR OWN UPCOMING EXPIRATIONS
      =============================================== */
      if (isUser()) {
        const acc = account();
        rows = rows.filter(r => r.email === acc.email);
      }

      if (!rows.length) {
        container.innerHTML = `
          <h2 class="h6 mb-3 d-flex align-items-center gap-2">
            <i class="bi bi-calendar-event text-primary"></i>
            Upcoming Certification Expiries
          </h2>
          <div class="empty-state text-secondary small">
            No upcoming expiries in the next 90 days
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <h2 class="h6 mb-3 d-flex align-items-center gap-2">
          <i class="bi bi-calendar-event text-primary"></i>
          Upcoming Certification Expiries
        </h2>
        <ul class="list-group list-group-flush">
          ${rows
            .map(
              (r) => `
            <li class="list-group-item d-flex justify-content-between">
              <span>
                <strong>${esc(r.employee)}</strong><br>
                ${esc(r.course)}
              </span>
              <span>${fmt(r.expiry_date)}</span>
            </li>
          `
            )
            .join("")}
        </ul>
      `;
    } catch (err) {
      console.error("Failed to load upcoming expiries:", err);
      container.innerHTML = `
        <div class="text-secondary small">Failed to load upcoming expiries.</div>
      `;
    }
  }
  await loadUpcoming();


  /* ---------- ALL RECORDS TABLE ---------- */
  const tB = $("#recordsTbody");

  async function loadRecords(q = "") {
    try {
      const url = new URL(`${API}/api/records`);
      if (q) url.searchParams.set("q", q);

      const rows = await fetchJSON(url.toString());

      tB.innerHTML =
        rows
          .map(
            (r) => `
        <tr>
          <td>${esc(r.employee)}<br><small class="text-secondary">${esc(r.email || "")}</small></td>
          <td>${esc(r.course)}</td>
          <td>${fmt(r.completed)}</td>
          <td>${fmt(r.expires)}</td>
          <td>${esc(r.assessor || "")}</td>
          <td>${statusBadge(r.status)}</td>
          <td class="text-end"></td>
        </tr>`
          )
          .join("") ||
        `<tr><td colspan="7" class="text-center">No records</td></tr>`;
    } catch (err) {
      console.error(err);
      tB.innerHTML = `<tr><td colspan="7" class="text-center">Failed</td></tr>`;
    }
  }

  $("#recordSearch")?.addEventListener("input", (e) =>
    loadRecords(e.target.value)
  );

  /* =====================================================
     ONLY LOAD RECORDS IF NOT USER
     (users cannot access the tab anyway)
  ====================================================== */
  if (!isUser()) await loadRecords("");


  /* ---------- COURSES TAB ---------- */
  const ct = $("#courseTbody");
  const courses = await fetchJSON(`${API}/api/courses`).catch(() => []);

  ct.innerHTML = courses
    .map(
      (c) => `
      <tr data-course-id="${c.course_id}" class="course-row" style="cursor:pointer;">
        <td>${esc(c.name)}</td>
        <td>${esc(c.type)}</td>
        <td>${esc(c.category)}</td>
        <td>${esc(c.provider)}</td>
        <td>${c.validity_days || ""}</td>
      </tr>`
    )
    .join("");

  ct.onclick = (e) => {
    const row = e.target.closest("tr[data-course-id]");
    if (!row) return;
    openCourseView(row.dataset.courseId);
  };

  /* ---------- BUTTONS ---------- */
  if (!isAdminOrManager()) $("#btnNewCourse")?.classList.add("d-none");

  $("#btnNewCourse")?.addEventListener("click", openCourseModal);

  $("#btnAddTraining")?.addEventListener("click", async () => {
    await populateCourseSelect("#recCourse");
    openRecordModal();
  });
}
/* ========================================================
   PEOPLE (ADMIN/MANAGER ONLY)
======================================================== */
let personModal, editRecordModal, editThirdModal, confirmModal;
let currentProfilePersonId = null;

async function renderPeople(){
  if (isUser()) return navigate("/dashboard");

  const tbody=$("#peopleTbody");
  const count=$("#peopleCount");
  const empty=$("#peopleEmpty");

  try{
    const people=await fetchJSON(`${API}/api/people`);
    count.textContent=people.length;
    empty.classList.toggle("d-none",people.length>0);

    tbody.innerHTML = people.map(p=>`
      <tr data-person-id="${p.person_id}">
        <td>${esc(p.name)}</td>
        <td>${esc(p.email)}</td>
        <td>${n0(p.total_training)}</td>
        <td>${n0(p.current)}</td>
        <td>${n0(p.expiring_soon)}</td>
        <td>${n0(p.expired)}</td>
        <td>${
          p.expired>0?'<span class="badge text-bg-danger-subtle text-danger">Expired</span>':
          p.expiring_soon>0?'<span class="badge text-bg-warning-subtle text-warning">Expiring Soon</span>':
          p.total_training>0?'<span class="badge text-bg-success-subtle text-success">Good</span>':
          '<span class="badge text-bg-secondary">No Records</span>'
        }</td>
      </tr>`).join("");

    tbody.onclick=(e)=>{
      const tr=e.target.closest("tr[data-person-id]");
      if(!tr)return;
      openPersonProfile(+tr.dataset.personId);
    };

  }catch(err){
    tbody.innerHTML="";
    count.textContent="0";
    empty.classList.remove("d-none");
  }
}

let courseViewModal;

async function openCourseView(id) {
  courseViewModal = courseViewModal || new bootstrap.Modal("#courseViewModal");

  // Reset UI while loading
  $("#cvTitle").textContent = "Loading…";
  $("#cvType").textContent = "";
  $("#cvDescription").textContent = "";
  $("#cvCategory").textContent = "—";
  $("#cvProvider").textContent = "—";
  $("#cvValid").textContent = "";
  $("#cvTbody").innerHTML = `
    <tr><td colspan="4" class="text-secondary">Loading…</td></tr>
  `;

  try {
    const data = await fetchJSON(`${API}/api/course/${id}/details`);
    const c = data.course;

    // Fill course info
    $("#cvTitle").textContent = c.name;
    $("#cvType").textContent = c.type || "";
    $("#cvDescription").textContent = c.description || "No description provided.";
    $("#cvCategory").textContent = c.category || "—";
    $("#cvProvider").textContent = c.provider || "—";
    $("#cvValid").textContent = c.validity_days ?? "No expiry";

    /* ------------------------------------------------------
       SHOW OR HIDE TRAINING RECORDS (RBAC ENFORCED)
       ------------------------------------------------------ */
    if (!isAdminOrManager()) {
      $("#cvTbody").innerHTML = `
        <tr>
          <td colspan="4" class="text-center text-secondary">
            Training records are only visible to managers and admins
          </td>
        </tr>
      `;
    } else {
      $("#cvTbody").innerHTML =
        data.records.length
          ? data.records
              .map(
                (r) => `
                <tr>
                  <td>${esc(r.person)}</td>
                  <td>${fmt(r.completed)}</td>
                  <td>${fmt(r.expires)}</td>
                  <td>${statusBadge(r.status)}</td>
                </tr>`
              )
              .join("")
          : `<tr><td colspan="4" class="text-center text-secondary">No training records</td></tr>`;
    }

    /* ------------------------------------------------------
       EDIT COURSE BUTTON (ADMIN/MANAGER ONLY)
       ------------------------------------------------------ */
    const btnEdit = document.getElementById("btnEditCourse");
    if (isAdminOrManager()) {
      btnEdit.classList.remove("d-none");
      btnEdit.onclick = () => openEditCourseModal(id);
    } else {
      btnEdit.classList.add("d-none");
    }

    /* ------------------------------------------------------ */
    courseViewModal.show();
    /* ------------------------------------------------------ */

  } catch (err) {
    console.error(err);
    showToast("Error", "Failed to load course", "danger");
  }
}


let editCourseModal;

async function openEditCourseModal(id) {
  editCourseModal = editCourseModal || new bootstrap.Modal("#editCourseModal");

  const data = await fetchJSON(`${API}/api/course/${id}/details`);
  const c = data.course;

  $("#editCourseId").value = id;
  $("#editCourseName").value = c.name;
  $("#editCourseDesc").value = c.description || "";
  $("#editCourseType").value = c.type || "";
  $("#editCourseProvider").value = c.provider || "";
  $("#editCourseValid").value = c.validity_days ?? "";

  editCourseModal.show();
}

document.getElementById("editCourseForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = $("#editCourseId").value;

  const payload = {
    name: $("#editCourseName").value.trim(),
    description: $("#editCourseDesc").value.trim(),
    type: $("#editCourseType").value.trim(),
    providerName: $("#editCourseProvider").value.trim(),
    validityDays: $("#editCourseValid").value || null,
  };

  try {
    await fetchJSON(`${API}/api/courses/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    editCourseModal.hide();
    showToast("Saved", "Course updated", "success");

    // Refresh course view
    openCourseView(id);

  } catch (err) {
    console.error(err);
    showToast("Error", "Failed to update course", "danger");
  }
});

/* ========================================================
   PROFILE MODAL (STRICT RBAC)
======================================================== */
async function openPersonProfile(personId) {
  const acc = account();

  // USERS CAN ONLY VIEW THEIR OWN PROFILE
  if (isUser() && acc.person_id !== personId) {
    showToast("Forbidden","You can only view your own profile","danger");
    return;
  }

  if (!personModal) personModal = new bootstrap.Modal("#personModal");
  currentProfilePersonId = personId;

  $("#personName").textContent = "Loading...";
  $("#personEmail").textContent = "";

  $("#personTrainingTbody").innerHTML = "";
  $("#personThirdTbody").innerHTML = "";
  show($("#personTrainingSpinner"));
  show($("#personThirdSpinner"));

  try {
    const data = await fetchJSON(`${API}/api/person/${personId}/summary`);

    /* ---------- BASIC INFO ---------- */
    $("#personName").textContent = data.person.name;
    $("#personEmail").textContent = data.person.email;

    /* ---------- ROLE SELECTOR ---------- */
    if (isAdmin()) {
      $("#roleControl").classList.remove("d-none");
      $("#personRoleSelect").value = data.person.role ?? "user";
      $("#personRoleSelect").dataset.personId = personId;
    } else {
      $("#roleControl").classList.add("d-none");
    }

    /* ---------- ICS BUTTONS ---------- */
    $("#profileBtnSubscribe").href = `${API}/api/person/${personId}/calendar.ics`;
    $("#profileBtnExport").href = `${API}/api/person/${personId}/export.ics`;

    /* ---------- TRAINING LIST ---------- */
    hide($("#personTrainingSpinner"));
    const tB = $("#personTrainingTbody");

    if (!data.training.length) {
      show($("#personTrainingEmpty"));
      tB.innerHTML = "";
    } else {
      hide($("#personTrainingEmpty"));

      tB.innerHTML = data.training.map(r => `
        <tr data-record-id="${r.training_record_id}">
          <td>${esc(r.course)}</td>
          <td>${fmt(r.completed)}</td>
          <td>${fmt(r.expires)}</td>
          <td>${esc(r.assessor || "")}</td>
          <td>${statusBadge(r.status)}</td>
          <td class="text-end">
            ${r.file_path ? `
              <button class="btn btn-sm btn-outline-secondary me-1" 
                      data-action="view-evidence" 
                      data-path="${r.file_path}"
                      title="View evidence">
                <i class="bi bi-file-earmark-text"></i>
              </button>
            ` : ""}
            ${isAdminOrManager() ? `
              <button class="btn btn-sm btn-outline-primary me-1" data-action="edit-record">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger" data-action="delete-record">
                <i class="bi bi-trash"></i>
              </button>
            ` : ""}
          </td>
        </tr>
      `).join("");
    }

    /* ---------- THIRD-PARTY LIST ---------- */
    hide($("#personThirdSpinner"));
    const t3 = $("#personThirdTbody");

    if (!data.thirdparty.length) {
      show($("#personThirdEmpty"));
      t3.innerHTML = "";
    } else {
      hide($("#personThirdEmpty"));
      t3.innerHTML = data.thirdparty.map(c => `
        <tr data-cert-id="${c.cert_id}">
          <td>${esc(c.title)}</td>
          <td>${esc(c.provider)}</td>
          <td>${fmt(c.completion_date)}</td>
          <td>${fmt(c.expiry_date)}</td>
          <td class="text-end">

            ${c.file_path ? `
              <button class="btn btn-sm btn-outline-secondary me-1"
                      data-action="view-evidence"
                      data-path="${c.file_path}"
                      title="View evidence">
                <i class="bi bi-file-earmark-text"></i>
              </button>
            ` : ""}

            ${isAdminOrManager() ? `
              <a class="btn btn-sm btn-outline-secondary me-1" 
                 href="${API}/api/thirdparty/${c.cert_id}/ics" 
                 target="_blank">
                 <i class="bi bi-calendar-plus"></i>
              </a>

              <button class="btn btn-sm btn-outline-primary me-1" data-action="edit-third">
                <i class="bi bi-pencil"></i>
              </button>

              <button class="btn btn-sm btn-outline-danger" data-action="delete-third">
                <i class="bi bi-trash"></i>
              </button>
            ` : ""}
          </td>
        </tr>
      `).join("");
    }

    /* ---------- TRAINING ACTION HANDLERS ---------- */
    $("#personTrainingTbody").onclick = (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;

      const row = e.target.closest("tr[data-record-id]");
      if (!row) return;
      const recordId = row.dataset.recordId;

      if (btn.dataset.action === "view-evidence") {
        openEvidenceViewer(btn.dataset.path); 
        return;
      }

      if (!isAdminOrManager()) return;

      if (btn.dataset.action === "edit-record") openEditRecordModal(recordId);
      if (btn.dataset.action === "delete-record") {
        confirmDelete("record", recordId, () => deleteRecord(recordId, personId));
      }
    };

    /* ---------- THIRD-PARTY ACTION HANDLERS ---------- */
    $("#personThirdTbody").onclick = (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;

      const row = e.target.closest("tr[data-cert-id]");
      if (!row) return;

      if (btn.dataset.action === "view-evidence") {
        openEvidenceViewer(btn.dataset.path);
        return;
      }

      if (!isAdminOrManager()) return;

      const certId = row.dataset.certId;
      if (btn.dataset.action === "edit-third") openEditThirdModal(certId, personId);
      if (btn.dataset.action === "delete-third") {
        confirmDelete("third", certId, () => deleteThird(certId, personId));
      }
    };

    /* ---------- ADD 3rd PARTY BUTTON ---------- */
    if (isUser() && acc.person_id !== personId) {
      $("#btnProfileAddThird")?.classList.add("d-none");
    } else {
      $("#btnProfileAddThird")?.classList.remove("d-none");
    }

    $("#btnProfileAddThird").onclick = () => {
      openThirdPartyModal();
      $("#thirdPartyForm").dataset.personId = personId;
    };

    personModal.show();

  } catch (err) {
    console.error(err);
    showToast("Error","Failed to load profile","danger");
  }
}
/* ========================================================
   REPORTS (ADMIN/MANAGER ONLY)
======================================================== */
async function renderReports(){
  if (isUser()) return navigate("/dashboard");

  const selectType  = $("#reportType");
  const selectPerson = $("#reportPerson"); // 🔽 new
  const tbody = $("#reportTbody");
  const empty = $("#reportEmpty");
  const count = $("#reportCount");

  // 🔽 Populate people (admin/manager can call /api/people)
  async function populatePeople() {
    try {
      const people = await fetchJSON(`${API}/api/people`);
      // Keep the default "All people"
      const opts = ['<option value="">All people</option>'].concat(
        people.map(p => `<option value="${p.person_id}">${esc(p.name)} (${esc(p.email)})</option>`)
      );
      selectPerson.innerHTML = opts.join("");
    } catch (err) {
      // If it fails, keep an "All" only
      selectPerson.innerHTML = '<option value="">All people</option>';
      console.warn("Failed to load people for report filter:", err);
    }
  }


  
  // Core loader with filters
  async function load(){
    try{
      const url = new URL(`${API}/api/reports`);
      url.searchParams.set("type", selectType.value || "all");
      const pid = selectPerson.value;
      if (pid) url.searchParams.set("person_id", pid);

      const rows = await fetchJSON(url.toString());
      count.textContent = Array.isArray(rows) ? rows.length : 0;
      empty.classList.toggle("d-none", Array.isArray(rows) && rows.length > 0);

      if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = "";
        return;
      }

      tbody.innerHTML = rows.map(r=>`
        <tr>
          <td>${esc(r.staff_name)}</td>
          <td>${esc(r.email)}</td>
          <td>${esc(r.course)}</td>
          <td>${fmt(r.completed)}</td>
          <td>${fmt(r.expires)}</td>
          <td>${esc(r.assessor || "")}</td>
          <td>${statusBadge(r.status)}</td>
        </tr>`).join("");
    }catch(err){
      console.error("Reports load failed:", err);
      tbody.innerHTML="";
      empty.classList.remove("d-none");
      count.textContent="0";
    }
  }

  // Wire events
  selectType.addEventListener("change", load);
  selectPerson.addEventListener("change", load);

  // Init sequence
  await populatePeople();
  await load();

  // CSV export includes the Person column already
  document.querySelector("#btnExportCsv")?.addEventListener("click", () => {
  const rows = [
    ["Staff Name","Email","Course","Completed","Expires","Assessor","Status"]
  ];

  document.querySelectorAll("#reportTbody tr").forEach(tr => {
    const cols = [...tr.children].map(td => td.textContent.trim());
    rows.push(cols);
  });

  downloadCsv(`report-${new Date().toISOString().slice(0,10)}.csv`, rows);
});

}

/* ========================================================
   MY TRAINING
======================================================== */
async function renderMyTraining(){
  const acc = account();
  if (!acc.person_id) return location.href="Login.html";

  try{
    const {list,counts}=await fetchJSON(`${API}/api/my?person_id=${acc.person_id}`);
    $("#myTotal").textContent=counts.total;
    $("#myCurrent").textContent=counts.current;
    $("#myExpiring").textContent=counts.expiring_soon;
    $("#myExpired").textContent=counts.expired;

    const tbody=$("#myTbody");
    const empty=$("#myEmpty");

    if(!list.length){
      empty.hidden=false;
      tbody.innerHTML="";
      return;
    }

    empty.hidden=true;
    tbody.innerHTML=list.map(r=>`
      <tr>
        <td>${esc(r.course)}</td>
        <td>${fmt(r.completed)}</td>
        <td>${fmt(r.expires)}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`).join("");

    /* ---------- ICS BUTTON WIRING ---------- */
    const pid = acc.person_id;

    // Subscribe to live calendar feed (internal + 3rd-party)
    $("#btnSubCalendar").href = `${API}/api/person/${pid}/calendar.ics`;

    // Download all ICS (single file with internal + 3rd-party)
    $("#btnExportCalendar").href = `${API}/api/person/${pid}/export.ics`;

  }catch(err){
    $("#myTbody").innerHTML="";
    $("#myEmpty").hidden=false;
  }
}

/* ========================================================
   CREATE COURSE (ADMIN/MANAGER ONLY)
======================================================== */
function openCourseModal(){
  if (!isAdminOrManager()) return showToast("Forbidden","Only managers/admin can create courses","danger");
  new bootstrap.Modal("#courseModal").show();
}

async function handleCourseSubmit(e){
  e.preventDefault();
  if (!isAdminOrManager()) return showToast("Forbidden","Not allowed","danger");

  const payload={
    name: $("#courseName").value.trim(),
    description: $("#courseDesc").value.trim(),
    type: $("#courseType").value,
    categoryName: $("#courseCategory").value,
    providerName: $("#courseProvider").value.trim()||null,
    validityDays: $("#courseValidDays").value||null
  };
  try{
    await fetchJSON(`${API}/api/courses`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    bootstrap.Modal.getInstance("#courseModal")?.hide();
    showToast("Saved","Course created","success");
    navigate("/dashboard");
  }catch(_){
    showToast("Error","Failed to create","danger");
  }
}

/* ========================================================
   ADD TRAINING (ALL ROLES) — but user = self only
======================================================== */
function openRecordModal(){
  const acc = account();
  const m = new bootstrap.Modal("#recordModal");
  $("#recordForm").reset();
  $("#recName").value=acc.username;
  $("#recEmail").value=acc.email;
  $("#recName").readOnly=true;
  $("#recEmail").readOnly=true;
  $("#recCompleted").value=new Date().toISOString().slice(0,10);
  m.show();
}

async function handleRecordSubmit(e){
  e.preventDefault();

  const fd=new FormData();
  fd.append("name", $("#recName").value.trim());
  fd.append("email", $("#recEmail").value.trim());
  fd.append("course_id", $("#recCourse").value);
  fd.append("completion_date", $("#recCompleted").value);
  fd.append("notes", $("#recNotes").value.trim());
  fd.append("assessor", $("#recAssessor")?.value?.trim() || "");
  const file=$("#recFile").files[0];
  if(file) fd.append("file",file);

  try{
    const res=await fetch(`${API}/api/records`,{method:"POST", credentials:"include", body:fd});
    if(!res.ok) throw new Error();
    bootstrap.Modal.getInstance("#recordModal").hide();
    showToast("Saved","Training added","success");
    navigate("/dashboard");
  }catch(err){
    showToast("Error","Failed","danger");
  }
}

/* ========================================================
   3rd PARTY CERTIFICATE — user=self only
======================================================== */
function openThirdPartyModal(){
  const acc=account();
  const m=new bootstrap.Modal("#thirdPartyModal");
  $("#thirdPartyForm").reset();
  $("#tpCompleted").value=new Date().toISOString().slice(0,10);
  $("#thirdPartyForm").dataset.personId = acc.person_id;
  m.show();
}

async function handleThirdPartySubmit(e){
  e.preventDefault();
  const f=$("#thirdPartyForm");
  const personId = +f.dataset.personId;

  const fd=new FormData();
  fd.append("person_id",personId);
  fd.append("title",$("#tpTitle").value);
  fd.append("provider",$("#tpProvider").value);
  fd.append("completion_date",$("#tpCompleted").value);
  fd.append("expiry_date",$("#tpExpiry").value);
  fd.append("notes",$("#tpNotes").value);
  const file=$("#tpFile").files[0];
  if(file) fd.append("file",file);

  try{
    await fetchJSON(`${API}/api/thirdparty`,{method:"POST",body:fd});
    bootstrap.Modal.getInstance("#thirdPartyModal").hide();
    showToast("Saved","Certification added","success");
    navigate("/my-training");
  }catch(err){
    showToast("Error","Failed","danger");
  }
}

/* ========================================================
   EDIT / DELETE (MANAGER/ADMIN ONLY)
======================================================== */
async function openEditRecordModal(id){
  if (!isAdminOrManager()) return showToast("Forbidden","Not allowed","danger");
  editRecordModal = editRecordModal || new bootstrap.Modal("#editRecordModal");
  $("#editRecordForm").reset();
  $("#editRecId").value=id;

  try{
    const rec=await fetchJSON(`${API}/api/records/${id}`);
    const courses=await fetchJSON(`${API}/api/courses`);
    $("#editRecCourse").innerHTML=courses.map(c=>`
      <option value="${c.course_id}" ${c.course_id===rec.course_id?"selected":""}>${esc(c.name)}</option>
    `).join("");
    $("#editRecCompleted").value=(rec.completion_date||"").slice(0,10);
    $("#editRecNotes").value=rec.notes||"";
    $("#editRecAssessor").value = rec.assessor || "";
    editRecordModal.show();
  }catch(err){
    showToast("Error","Cannot open","danger");
  }
}

$("#editRecordForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const id=$("#editRecId").value;
  const fd=new FormData();
  fd.append("course_id",$("#editRecCourse").value);
  fd.append("completion_date",$("#editRecCompleted").value);
  fd.append("notes",$("#editRecNotes").value);
  fd.append("assessor", $("#editRecAssessor").value.trim());
  const file=$("#editRecFile").files[0];
  if(file) fd.append("file",file);

  try{
    await fetchJSON(`${API}/api/records/${id}`,{method:"PUT", body:fd});
    editRecordModal.hide();
    showToast("Saved","Record updated","success");
    openPersonProfile(currentProfilePersonId);
  }catch(err){
    showToast("Error","Failed","danger");
  }
});

function confirmDelete(kind,id,onConfirm){
  if (!isAdminOrManager()) return showToast("Forbidden","Not allowed","danger");
  confirmModal = confirmModal || new bootstrap.Modal("#confirmDeleteModal");
  $("#confirmDeleteTitle").textContent=`Delete ${kind==="record"?"Training":"Certification"}`;
  $("#confirmDeleteText").textContent="This action cannot be undone.";
  $("#confirmDeleteBtn").onclick=async()=>{
    try{ await onConfirm(); confirmModal.hide(); showToast("Deleted","Success","success"); }
    catch(err){ showToast("Error","Failed","danger"); }
  };
  confirmModal.show();
}

async function deleteRecord(id,pid){
  await fetchJSON(`${API}/api/records/${id}`,{method:"DELETE"});
  openPersonProfile(pid);
}

async function openEditThirdModal(certId, pid){
  if (!isAdminOrManager()) return showToast("Forbidden","Not allowed","danger");
  
  editThirdModal = editThirdModal || new bootstrap.Modal("#editThirdPartyModal");
  $("#editThirdForm").reset();
  $("#editThirdId").value = certId;
  $("#editThirdPartyModal").dataset.personId = pid;

  try {
    // Load ALL certs for the person
    const list = await fetchJSON(`${API}/api/thirdparty?person_id=${pid}`);
    const item = list.find(x => x.cert_id == certId);
    if (!item) throw new Error("Certificate not found");

    // Populate fields
    $("#editThirdTitle").value = item.title;
    $("#editThirdProvider").value = item.provider;
    $("#editThirdCompleted").value = (item.completion_date || "").slice(0,10);
    $("#editThirdExpiry").value = (item.expiry_date || "").slice(0,10);
    $("#editThirdNotes").value = item.notes || "";

    editThirdModal.show();

  } catch(err) {
    console.error(err);
    showToast("Error","Cannot open certificate","danger");
  }
}

$("#editThirdForm")?.addEventListener("submit", async e=>{
  e.preventDefault();
  const id = $("#editThirdId").value;
  const pid = $("#editThirdPartyModal").dataset.personId;

  const fd = new FormData();
  fd.append("title", $("#editThirdTitle").value);
  fd.append("provider", $("#editThirdProvider").value);
  fd.append("completion_date", $("#editThirdCompleted").value);
  fd.append("expiry_date", $("#editThirdExpiry").value);
  fd.append("notes", $("#editThirdNotes").value);

  const file = $("#editThirdFile").files[0];
  if (file) fd.append("file", file);

  try {
    await fetchJSON(`${API}/api/thirdparty/${id}`, {
      method: "PUT",
      body: fd
    });

    editThirdModal.hide();
    showToast("Saved","Certification updated","success");

    // Refresh the profile section
    openPersonProfile(pid);

  } catch(err) {
    console.error(err);
    showToast("Error","Failed to save certificate","danger");
  }
});

async function deleteThird(id,pid){
  await fetchJSON(`${API}/api/thirdparty/${id}`,{method:"DELETE"});
  openPersonProfile(pid);
}

function openEvidenceViewer(path) {
  const modal = new bootstrap.Modal("#evidenceModal");
  const body = document.querySelector("#evidenceBody");

  if (!path) {
    body.innerHTML = `<div class="text-danger">No evidence available</div>`;
    return modal.show();
  }

  const url = `${API}${path}`;
  const lower = url.toLowerCase();

  if (lower.endsWith(".pdf")) {
    body.innerHTML = `<iframe src="${url}" style="width:100%; height:78vh;" frameborder="0"></iframe>`;
  } else if (/\.(jpg|jpeg|png|gif|webp)$/i.test(lower)) {
    body.innerHTML = `<img src="${url}" class="img-fluid" />`;
  } else {
    body.innerHTML = `<a href="${url}" target="_blank" class="btn btn-primary">Download File</a>`;
  }

  modal.show();
}