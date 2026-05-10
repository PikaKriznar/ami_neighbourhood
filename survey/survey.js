/* global Blob, URL */

/** No localStorage: everything resets on full page refresh. */
const OLD_STORAGE_KEY = "ami_neighbourhood_user_testing_v1";

const form = document.getElementById("surveyForm");
const statusEl = document.getElementById("saveStatus");
const logBody = document.getElementById("logBody");
const fileInput = document.getElementById("importFile");

/** Logged rows for this page visit only (cleared on refresh). */
let participants = [];

function getFormData() {
  const fd = new FormData(form);
  const out = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function applyFormData(data) {
  const elements = form.elements;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el.name) continue;
    const val = data[el.name];
    if (el.type === "radio") {
      el.checked = val !== undefined && String(val) === el.value;
    } else if (el.type === "checkbox") {
      el.checked = Boolean(val);
    } else if (val !== undefined) {
      el.value = val;
    }
  }
}

function getSynthesis() {
  return {
    pain1: document.getElementById("synPain1")?.value ?? "",
    pain2: document.getElementById("synPain2")?.value ?? "",
    pain3: document.getElementById("synPain3")?.value ?? "",
    like1: document.getElementById("synLike1")?.value ?? "",
    like2: document.getElementById("synLike2")?.value ?? "",
    like3: document.getElementById("synLike3")?.value ?? "",
    next: document.getElementById("synNext")?.value ?? "",
  };
}

function applySynthesis(s) {
  const map = [
    ["synPain1", "pain1"],
    ["synPain2", "pain2"],
    ["synPain3", "pain3"],
    ["synLike1", "like1"],
    ["synLike2", "like2"],
    ["synLike3", "like3"],
    ["synNext", "next"],
  ];
  map.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.value = (s && s[key]) || "";
  });
}

function q8Short(v) {
  if (v === "too_easy") return "Prelahko";
  if (v === "about_right") return "Primerno";
  if (v === "too_hard") return "Pretesko";
  return v || "—";
}

function flashStatus(text, ok = true) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle("is-saved", ok);
  window.clearTimeout(flashStatus._t);
  flashStatus._t = window.setTimeout(() => {
    statusEl.textContent = "";
    statusEl.classList.remove("is-saved");
  }, 1600);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLog() {
  logBody.innerHTML = "";
  if (!participants.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "empty-log";
    td.textContent =
      "Še ni zabeleženih udeležencev. Izpolnite obrazec in po vsaki seji kliknite »Zabeleži udeleženca«. Ob osvežitvi strani se seznam zbriše.";
    tr.appendChild(td);
    logBody.appendChild(tr);
    return;
  }
  participants.forEach((p, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.participantId || "—")}</td>
      <td>${escapeHtml(p.sessionDate || "—")}</td>
      <td class="num">${escapeHtml(String(p.q4 ?? "—"))}</td>
      <td class="num">${escapeHtml(String(p.q5 ?? "—"))}</td>
      <td class="num">${escapeHtml(String(p.q7 ?? "—"))}</td>
      <td>${escapeHtml(q8Short(p.q8))}</td>
      <td class="num">${escapeHtml(String(p.q10 ?? "—"))}</td>
      <td><button type="button" class="btn btn--danger" data-remove="${idx}">Odstrani</button></td>
    `;
    logBody.appendChild(tr);
  });
  logBody.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-remove"));
      participants.splice(i, 1);
      renderLog();
      flashStatus("Vnos odstranjen iz dnevnika.", true);
    });
  });
}

function logParticipant() {
  const row = getFormData();
  if (!row.participantId?.trim() && !row.q1?.trim()) {
    window.alert("Pred zapisom dodajte vsaj ID udeleženca ali vlogo.");
    return;
  }
  row.loggedAt = new Date().toISOString();
  participants.push(row);
  form.reset();
  renderLog();
  flashStatus("Udeleženec dodan v dnevnik.", true);
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    draft: getFormData(),
    participants: [...participants],
    synthesis: getSynthesis(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ami-neighbourhood-user-testing-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  flashStatus("JSON shranjen (prenos).", true);
}

function importJson(text) {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("Neveljavna datoteka");
    participants = Array.isArray(data.participants) ? [...data.participants] : [];
    applyFormData(data.draft || {});
    applySynthesis(data.synthesis || {});
    renderLog();
    flashStatus("Uvoz uspel (samo ta zavihek; osvežitev pobriše).", true);
  } catch (e) {
    window.alert("Uvoz ni uspel: " + (e.message || "neveljaven JSON"));
  }
}

function clearAll() {
  if (
    !window.confirm(
      "Počistiti obrazec, tabelo zabeleženih udeležencev in polja sinteze?"
    )
  )
    return;
  form.reset();
  participants = [];
  applySynthesis({});
  renderLog();
  flashStatus("Počiščeno.", true);
}

document.getElementById("btnLogParticipant").addEventListener("click", (e) => {
  e.preventDefault();
  logParticipant();
});

document.getElementById("btnExport").addEventListener("click", (e) => {
  e.preventDefault();
  exportJson();
});

document.getElementById("btnImport").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => importJson(String(reader.result || ""));
  reader.readAsText(f);
  fileInput.value = "";
});

document.getElementById("btnClear").addEventListener("click", (e) => {
  e.preventDefault();
  clearAll();
});

(function init() {
  try {
    localStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  renderLog();
})();
