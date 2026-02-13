/* ============== Mock Data (replace with your backend later) ============== */
const mock = {
  // If you have real signed-in user email, set it here
  currentUserEmail: null, // e.g. "alex.quinn@contoso.com"

  staff: [
    // If you have a people directory, add here; we'll also infer from records
    // { name: "Alex Quinn", email: "alex.quinn@contoso.com" }
  ],
  courses: [
    { id: 1, title: "First Aid L3", active: true },
    { id: 2, title: "Manual Handling", active: true },
    { id: 3, title: "Fire Warden", active: false }
  ],
  records: [
    {
      id: 101,
      employee: "Alex Quinn",
      email: "alex.quinn@contoso.com",
      course: "First Aid L3",
      completed: "2025-10-10",
      expires: "2026-10-10",
      assessor: "J. Smith",
      status: "Valid"
    },
    {
      id: 102,
      employee: "Jamie Lee",
      email: "jamie.lee@contoso.com",
      course: "Manual Handling",
      completed: "2024-12-01",
      expires: "2026-12-01",
      assessor: "J. Smith",
      status: "Valid"
    },
    {
      id: 103,
      employee: "Samir Khan",
      email: "samir.khan@contoso.com",
      course: "Fire Warden",
      completed: "2023-09-18",
      expires: "2025-09-18",
      assessor: "T. Brown",
      status: "Expired"
    }
  ]
};

/* -------- Router helpers ---------- */
const routes = {
  "/dashboard": renderDashboard,
  "/people": renderPeople,
  "/reports": renderReports,
  "/my-training": renderMyTraining
};

function currentRoute() {
  const hash = window.location.hash || "#/dashboard";
  const route = hash.replace("#", "");
  return routes[route] ? route : "/dashboard";
}

function setActiveNav(route) {
  document.querySelectorAll('#mainNav .nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });
}

function navigate(route) {
  const tplId = {
    "/dashboard": "tpl-dashboard",
    "/people": "tpl-people",
    "/reports": "tpl-reports",
    "/my-training": "tpl-mytraining"
  }[route];

  const tpl = document.getElementById(tplId);
  const container = document.getElementById('app-root');

  container.innerHTML = tpl ? tpl.innerHTML : "<p class='text-danger'>Page not found</p>";

  // render page
  (routes[route] || (()=>{}))();

  setActiveNav(route);

  // Accessibility: move focus into the main region
  container.setAttribute("tabindex", "-1");
  container.focus();
}

// When the hash changes (e.g., user manually edits URL or uses browser back/forward)
function onHashChange() {
  navigate(currentRoute());
}

/* -------- Bootstrap the app and wire navigation ---------- */
document.addEventListener("DOMContentLoaded", () => {
  // 1) Initial render
  navigate(currentRoute());

  // 2) React to URL hash changes (back/forward/manual edits)
  window.addEventListener("hashchange", onHashChange);

  // 3) Instant nav on click (does not rely on hashchange timing)
  const mainNav = document.getElementById('mainNav');
  mainNav.addEventListener('click', (e) => {
    const link = e.target.closest('a.nav-link');
    if (!link) return;

    const route = link.dataset.route;
    if (!route) return;

    e.preventDefault();               // don't let browser scroll to top
    if (window.location.hash !== `#${route}`) {
      // update the hash so the URL stays in sync (also enables back/forward)
      window.location.hash = route;
    }
    // render immediately so user sees the change without needing a refresh
    navigate(route);
  });
});

/* ========================== Utilities =================================== */
function withinDays(dateStr, days) {
  const now = new Date();
  const dt = new Date(dateStr + "T00:00:00");
  const diffDays = (dt - now) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= days;
}

function fmt(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt)) return "";
  return dt.toLocaleDateString();
}

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(v => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* =========================== Dashboard ================================== */
function renderDashboard() {
  // Stats
  const totalStaff = new Set(mock.records.map(r => r.email)).size || mock.staff.length;
  const activeCourses = mock.courses.filter(c => c.active).length;
  const expiringSoon = mock.records.filter(r => withinDays(r.expires, 90)).length;
  const currentCerts = mock.records.filter(r => r.status.toLowerCase() === "valid").length;

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setText("statStaff", totalStaff);
  setText("statCourses", activeCourses);
  setText("statExpiring", expiringSoon);
  setText("statCerts", currentCerts);

  // Records table
  const tbody = document.getElementById("recordsTbody");
  const buildRows = (filter = "") => {
    const q = filter.trim().toLowerCase();
    const rows = mock.records
      .filter(r =>
        !q || r.employee.toLowerCase().includes(q) ||
        r.course.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      )
      .map(r => {
        const statusBadge = r.status === "Valid"
          ? `<span class="badge text-bg-success-subtle text-success border border-success-subtle">Valid</span>`
          : `<span class="badge text-bg-warning-subtle text-warning border border-warning-subtle">Expired</span>`;
        return `
          <tr>
            <td>${r.employee}</td>
            <td>${r.course}</td>
            <td>${fmt(r.completed)}</td>
            <td>${fmt(r.expires)}</td>
            <td>${statusBadge}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-secondary me-1" aria-label="View record ${r.id}">
                <i class="bi bi-eye"></i>
              </button>
              <button class="btn btn-sm btn-outline-primary" aria-label="Edit record ${r.id}">
                <i class="bi bi-pencil"></i>
              </button>
            </td>
          </tr>
        `;
      }).join("");

    tbody.innerHTML = rows || `
      <tr><td colspan="6" class="text-center text-secondary small py-4">No records found</td></tr>
    `;
  };
  buildRows();

  const searchInput = document.getElementById("recordSearch");
  if (searchInput) searchInput.addEventListener("input", () => buildRows(searchInput.value));

  // Courses list
  const list = document.getElementById("courseList");
  if (list) {
    list.innerHTML = mock.courses.map(c => `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <span>${c.title}</span>
        <span class="badge ${c.active ? 'text-bg-success' : 'text-bg-secondary'}">
          ${c.active ? 'Active' : 'Inactive'}
        </span>
      </li>
    `).join("");
  }

  // Action buttons (placeholders)
  const btnNew = document.getElementById("btnNewCourse");
  const btnAdd = document.getElementById("btnAddTraining");
  bindDashboardActions();
}

/* ============================= People =================================== */
function renderPeople() {
  // Combine explicit staff list with staff inferred from records
  const inferred = Array.from(new Map(mock.records.map(r => [r.email, { name: r.employee, email: r.email }])).values());
  const directory = Array.from(new Map([...mock.staff, ...inferred].map(p => [p.email || p.name, p])).values());

  const byPerson = directory.map(p => {
    const recs = mock.records.filter(r => r.email === p.email || r.employee === p.name);
    const total = recs.length;
    const current = recs.filter(r => r.status.toLowerCase() === "valid").length;
    const expSoon = recs.filter(r => withinDays(r.expires, 90)).length;
    const expired = recs.filter(r => r.status.toLowerCase() === "expired").length;
    let status = "No Records";
    if (total) status = expired ? "Expired" : expSoon ? "Expiring Soon" : "Good";
    return { ...p, total, current, expSoon, expired, status };
  });

  document.getElementById("peopleCount").textContent = byPerson.length;

  const tbody = document.getElementById("peopleTbody");
  const empty = document.getElementById("peopleEmpty");

  if (!byPerson.length) {
    tbody.innerHTML = "";
    empty.classList.remove("d-none");
    return;
  }
  empty.classList.add("d-none");

  tbody.innerHTML = byPerson.map(p => `
    <tr>
      <td>${p.name || ""}</td>
      <td>${p.email || ""}</td>
      <td>${p.total}</td>
      <td>${p.current}</td>
      <td>${p.expSoon}</td>
      <td>${p.expired}</td>
      <td>
        ${p.status === "Good" ? '<span class="badge text-bg-success-subtle text-success border border-success-subtle">Good</span>' :
          p.status === "Expiring Soon" ? '<span class="badge text-bg-warning-subtle text-warning border border-warning-subtle">Expiring Soon</span>' :
          p.status === "Expired" ? '<span class="badge text-bg-danger-subtle text-danger border border-danger-subtle">Expired</span>' :
          '<span class="badge text-bg-secondary">No Records</span>'}
      </td>
    </tr>
  `).join("");
}

/* ============================= Reports ================================== */
function filteredRecords(kind) {
  switch (kind) {
    case "valid": return mock.records.filter(r => r.status.toLowerCase() === "valid");
    case "expired": return mock.records.filter(r => r.status.toLowerCase() === "expired");
    case "expiring": return mock.records.filter(r => withinDays(r.expires, 90));
    default: return mock.records.slice();
  }
}

function renderReports() {
  const select = document.getElementById("reportType");
  const tbody = document.getElementById("reportTbody");
  const empty = document.getElementById("reportEmpty");
  const count = document.getElementById("reportCount");
  const btnCsv = document.getElementById("btnExportCsv");

  const draw = () => {
    const data = filteredRecords(select.value);
    count.textContent = data.length;

    if (!data.length) {
      tbody.innerHTML = "";
      empty.classList.remove("d-none");
    } else {
      empty.classList.add("d-none");
      tbody.innerHTML = data.map(r => `
        <tr>
          <td>${r.employee}</td>
          <td>${r.email || ""}</td>
          <td>${r.course}</td>
          <td>${fmt(r.completed)}</td>
          <td>${fmt(r.expires)}</td>
          <td>${r.assessor || ""}</td>
          <td>${r.status}</td>
        </tr>
      `).join("");
    }
  };

  select.addEventListener("change", draw);
  draw();

  btnCsv.addEventListener("click", () => {
    const data = filteredRecords(select.value);
    const rows = [
      ["Staff Name", "Email", "Course", "Completed", "Expires", "Assessor", "Status"],
      ...data.map(r => [r.employee, r.email || "", r.course, fmt(r.completed), fmt(r.expires), r.assessor || "", r.status])
    ];
    downloadCsv("training-report.csv", rows);
  });
}

/* =========================== My Training ================================ */
function renderMyTraining() {
  const userEmail = mock.currentUserEmail;
  const my = userEmail
    ? mock.records.filter(r => (r.email || "").toLowerCase() === userEmail.toLowerCase())
    : []; // if you don’t set currentUserEmail, it will show the empty state

  const total = my.length;
  const current = my.filter(r => r.status.toLowerCase() === "valid").length;
  const expSoon = my.filter(r => withinDays(r.expires, 90)).length;
  const expired = my.filter(r => r.status.toLowerCase() === "expired").length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("myTotal", total);
  set("myCurrent", current);
  set("myExpiring", expSoon);
  set("myExpired", expired);

  const tbody = document.getElementById("myTbody");
  const empty = document.getElementById("myEmpty");

  if (!my.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  tbody.innerHTML = my.map(r => `
    <tr>
      <td>${r.course}</td>
      <td>${fmt(r.completed)}</td>
      <td>${fmt(r.expires)}</td>
      <td>${r.status}</td>
    </tr>
  `).join("");
}

/* =========================== App Bootstrap ============================== */
function initRouter() {
  // initial navigation based on hash (or default)
  navigate(currentRoute());
  window.addEventListener("hashchange", onHashChange);
}

document.addEventListener("DOMContentLoaded", () => {
  initRouter();
});

/* ========================== Modal helpers =============================== */
let courseModal, recordModal;

function ensureModals() {
  // Create Bootstrap Modal instances once
  const c = document.getElementById('courseModal');
  const r = document.getElementById('recordModal');
  courseModal = courseModal || (c ? new bootstrap.Modal(c) : null);
  recordModal = recordModal || (r ? new bootstrap.Modal(r) : null);
}

/* ---------- OPEN: Create Course ---------- */
function openCourseModal() {
  ensureModals();

  // reset form
  document.getElementById('courseForm').reset();

  // optional defaults
  document.getElementById('courseType').value = 'Individual Training';
  document.getElementById('courseCategory').value = 'Other';

  courseModal?.show();
}

/* ---------- SUBMIT: Create Course ---------- */
function handleCourseSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('courseName').value.trim();
  const desc = document.getElementById('courseDesc').value.trim();
  const type = document.getElementById('courseType').value;
  const category = document.getElementById('courseCategory').value;
  const validDaysRaw = document.getElementById('courseValidDays').value.trim();
  const provider = document.getElementById('courseProvider').value.trim();

  if (!name) {
    document.getElementById('courseName').focus();
    return;
  }

  const validDays = validDaysRaw === "" ? null : Math.max(0, parseInt(validDaysRaw, 10));

  const nextId = (mock.courses.reduce((m, c) => Math.max(m, c.id || 0), 0) || 0) + 1;

  const newCourse = {
    id: nextId,
    title: name,
    description: desc,
    type,
    category,
    validDays,       // null means no expiry
    provider,
    active: true
  };

  mock.courses.push(newCourse);

  // Close modal & refresh current view
  courseModal?.hide();
  navigate(currentRoute());
}

/* ---------- OPEN: Add Training Record ---------- */
function openRecordModal() {
  ensureModals();

  // reset form
  document.getElementById('recordForm').reset();

  // populate course select with ACTIVE courses
  const sel = document.getElementById('recCourse');
  sel.innerHTML = mock.courses
    .filter(c => c.active)
    .map(c => `<option value="${c.id}">${c.title}</option>`)
    .join("");

  // if there are no active courses, disable the select
  sel.disabled = sel.options.length === 0;

  // default "today" for completion
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('recCompleted').value = `${yyyy}-${mm}-${dd}`;

  recordModal?.show();
}

/* ---------- SUBMIT: Add Training Record ---------- */
function handleRecordSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('recName').value.trim();
  const email = document.getElementById('recEmail').value.trim();
  const courseId = parseInt(document.getElementById('recCourse').value, 10);
  const completed = document.getElementById('recCompleted').value;
  const file = document.getElementById('recFile').files[0];
  const notes = document.getElementById('recNotes').value.trim();

  if (!name || !email || !courseId || !completed) return;

  const course = mock.courses.find(c => c.id === courseId);
  // compute expiry from course.validDays (if provided)
  let expires = null;
  if (course?.validDays != null) {
    const dt = new Date(completed + "T00:00:00");
    dt.setDate(dt.getDate() + Number(course.validDays));
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    expires = `${yyyy}-${mm}-${dd}`;
  }

  // determine status
  let status = "Valid";
  if (expires) {
    const now = new Date();
    const exp = new Date(expires + "T00:00:00");
    status = exp < now ? "Expired" : "Valid";
  }

  const nextId = (mock.records.reduce((m, r) => Math.max(m, r.id || 0), 0) || 0) + 1;

  mock.records.push({
    id: nextId,
    employee: name,
    email,
    course: course ? course.title : "(Unknown Course)",
    completed,
    expires,            // may be null
    assessor: "",       // empty for now
    notes,
    fileName: file ? file.name : null,
    status
  });

  // also seed staff directory if new
  if (!mock.staff.some(p => (p.email || "").toLowerCase() === email.toLowerCase())) {
    mock.staff.push({ name, email });
  }

  recordModal?.hide();
  navigate(currentRoute());
}

/* ================= Wire the buttons & form submits ====================== */
// Called each time Dashboard renders (buttons live on that page)
function bindDashboardActions() {
  const btnNew = document.getElementById("btnNewCourse");
  const btnAdd = document.getElementById("btnAddTraining");

  btnNew?.removeEventListener('click', openCourseModal);
  btnAdd?.removeEventListener('click', openRecordModal);

  btnNew?.addEventListener('click', openCourseModal);
  btnAdd?.addEventListener('click', openRecordModal);
}

// Hook form submits once (modals are global)
document.addEventListener('DOMContentLoaded', () => {
  ensureModals();

  const courseForm = document.getElementById('courseForm');
  const recordForm = document.getElementById('recordForm');

  courseForm?.addEventListener('submit', handleCourseSubmit);
  recordForm?.addEventListener('submit', handleRecordSubmit);
});