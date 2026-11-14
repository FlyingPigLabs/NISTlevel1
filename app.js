const PROMPTS = [
  ["Launch to 10 feet and pitch forward over stand 1.", "Take a picture of bucket 1."],
  ["Gimbal up.", "Take a picture of bucket 2A."],
  ["Yaw left 360° over stand 1.", "Take a picture of bucket 1."],
  ["Gimbal up.", "Take a picture of bucket 2A."],
  ["Yaw right 360° over stand 1.", "Take a picture of bucket 1."],
  ["Gimbal up.", "Take a picture of bucket 2A."],
  ["Climb to 20 feet.", "Take a picture of bucket 1."],
  ["Gimbal up.", "Take a picture of bucket 3A."],
  ["Descend to 10 feet.", "Take a picture of bucket 1."],
  ["Gimbal up.", "Take a picture of bucket 2A."],
  ["Pitch forward over stand 2.", "Take a picture of bucket 2."],
  ["Gimbal up.", "Take a picture of bucket 3A."],
  ["Pitch backward over stand 1.", "Take a picture of bucket 1."],
  ["Gimbal up.", "Take a picture of bucket 2A."],
  ["Pitch forward over stand 2, then yaw left 180°.", "Take a picture of upside-down bucket 2."],
  ["Gimbal up.", "Take a picture of bucket 1C."],
  ["Pitch forward over the landing pad, then yaw right 180°.", "Take a picture of the landing pad."],
  ["Gimbal up.", "Take a picture of bucket 1A."],
  ["Land and launch to 10 feet.", "Continue when the drone is airborne."],
  ["Once at 10 feet, take a picture of bucket 1A.", ""],
  ["Orbit left 90°.", "Take a picture of bucket 1B."],
  ["Roll left.", "Take a picture of bucket 2B."],
  ["Roll left.", "Take a picture of bucket 3B."],
  ["Orbit left 90°.", "Take a picture of bucket 3C."],
  ["Orbit left 90°.", "Take a picture of bucket 3D."],
  ["Roll left.", "Take a picture of bucket 2D."],
  ["Roll left.", "Take a picture of bucket 1D."],
  ["Orbit left 90°.", "Take a picture of bucket 1A."],
  ["Land and launch to 10 feet.", "Continue when the drone is airborne."],
  ["Once at 10 feet, take a picture of bucket 1A.", ""],
  ["Orbit right 90°.", "Take a picture of bucket 1D."],
  ["Roll right.", "Take a picture of bucket 2D."],
  ["Roll right.", "Take a picture of bucket 3D."],
  ["Orbit right 90°.", "Take a picture of bucket 3C."],
  ["Orbit right 90°.", "Take a picture of bucket 3B."],
  ["Roll right.", "Take a picture of bucket 2B."],
  ["Roll right.", "Take a picture of bucket 1B."],
  ["Orbit right 90°.", "Take a picture of bucket 1A."],
  ["Land.", "The test ends when landing is complete."]
];

const DB_NAME = "open-lane-level-one";
const STORE_NAME = "tests";
const DB_VERSION = 1;
let db;
let currentTest = null;
let pendingTest = null;
let timerHandle = null;
let wakeLock = null;
let reviewSteps = [];
let reviewIndex = 0;

const $ = (id) => document.getElementById(id);
const views = ["setupView", "briefingView", "testView", "resultsView", "reviewView"];
const LANDING_STEP_NUMBERS = new Set([19, 29, 39]);

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveTest(test) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(test);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function getAllTests() {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function showView(id) {
  views.forEach((view) => $(view).classList.toggle("is-active", view === id));
  document.body.classList.toggle("test-running", id === "testView");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (error) {
    console.info("Screen wake lock unavailable", error);
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch (error) { console.info(error); }
  wakeLock = null;
}

function makeId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const tail = crypto.getRandomValues(new Uint16Array(1))[0].toString(16).padStart(4, "0");
  return `L1-${stamp}-${tail}`;
}

function formatDuration(ms, tenths = true) {
  const safe = Math.max(0, ms || 0);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const tenth = Math.floor((safe % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${tenths ? `.${tenth}` : ""}`;
}

function formatClock(iso) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

function formatDate(iso) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function splitPrompt(index) {
  return PROMPTS[index] || ["", ""];
}

function fullPrompt(index) {
  return splitPrompt(index).filter(Boolean).join(" ");
}

function renderBriefing(test) {
  $("briefingMeta").innerHTML = "";
  [["Pilot", test.pilot], ["Proctor", test.instructor], ["Aircraft", test.drone]].forEach(([term, value]) => {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    div.append(dt, dd);
    $("briefingMeta").append(div);
  });
}

function renderCurrentStep() {
  if (!currentTest || currentTest.status !== "active") return;
  const index = currentTest.currentStepIndex;
  const [title, detail] = splitPrompt(index);
  $("pilotLabel").textContent = currentTest.pilot;
  $("testIdentity").textContent = currentTest.drone;
  $("stepProgress").textContent = `Step ${index + 1} of ${PROMPTS.length}`;
  const percent = Math.round(((index + 1) / PROMPTS.length) * 100);
  $("progressPercent").textContent = `${percent}%`;
  $("progressBar").style.width = `${percent}%`;
  $("promptNumber").textContent = String(index + 1).padStart(2, "0");
  $("promptTitle").textContent = title;
  $("promptDetail").textContent = detail;
  const isFinal = index === PROMPTS.length - 1;
  const isLanding = LANDING_STEP_NUMBERS.has(index + 1);
  $("nextPrompt").textContent = isFinal ? "Results and export options" : fullPrompt(index + 1);
  $("nextStepButton").querySelector("strong").textContent = isFinal ? "Complete test" : "Continue";
  $("nextStepButton").querySelector(".button-arrow").textContent = isFinal ? "✓" : "→";
  $("nextStepButton").classList.toggle("is-hidden", isLanding);
  $("landingActions").classList.toggle("is-hidden", !isLanding);
}

function updateTimers() {
  if (!currentTest || currentTest.status !== "active") return;
  const now = Date.now();
  $("stepTimer").textContent = formatDuration(now - new Date(currentTest.stepStartedAt).getTime());
  $("totalTimer").textContent = formatDuration(now - new Date(currentTest.startedAt).getTime());
}

function startTimerLoop() {
  clearInterval(timerHandle);
  updateTimers();
  timerHandle = setInterval(updateTimers, 100);
}

async function startTest() {
  const transition = new Date().toISOString();
  currentTest = {
    ...pendingTest,
    status: "active",
    startedAt: transition,
    stepStartedAt: transition,
    currentStepIndex: 0,
    steps: []
  };
  await saveTest(currentTest);
  pendingTest = null;
  renderCurrentStep();
  showView("testView");
  startTimerLoop();
  requestWakeLock();
}

async function completeCurrentStep(landingResult = null) {
  const buttons = [$("nextStepButton"), $("landingSuccessButton"), $("landingFailureButton")];
  buttons.forEach((button) => { button.disabled = true; });
  const transitionMs = Date.now();
  const completedAt = new Date(transitionMs).toISOString();
  const startedMs = new Date(currentTest.stepStartedAt).getTime();
  const cumulativeMs = transitionMs - new Date(currentTest.startedAt).getTime();
  currentTest.steps.push({
    number: currentTest.currentStepIndex + 1,
    prompt: fullPrompt(currentTest.currentStepIndex),
    startedAt: currentTest.stepStartedAt,
    completedAt,
    durationMilliseconds: transitionMs - startedMs,
    cumulativeMilliseconds: cumulativeMs,
    landingResult,
    photoRequired: /take a picture/i.test(fullPrompt(currentTest.currentStepIndex)),
    photoReview: null
  });

  if (currentTest.currentStepIndex === PROMPTS.length - 1) {
    currentTest.status = "completed";
    currentTest.completedAt = completedAt;
    currentTest.totalMilliseconds = cumulativeMs;
    await saveTest(currentTest);
    clearInterval(timerHandle);
    releaseWakeLock();
    renderResults(currentTest);
    showView("resultsView");
    await renderHistory();
  } else {
    currentTest.currentStepIndex += 1;
    currentTest.stepStartedAt = completedAt;
    await saveTest(currentTest);
    renderCurrentStep();
    updateTimers();
    $("saveConfirmation").textContent = `Step ${currentTest.currentStepIndex} saved · Step ${currentTest.currentStepIndex + 1} started at ${formatClock(completedAt)}`;
  }
  setTimeout(() => buttons.forEach((button) => { button.disabled = false; }), 250);
}

function addMeta(container, pairs, className = "") {
  container.innerHTML = "";
  pairs.forEach(([term, value]) => {
    const div = document.createElement("div");
    if (className) div.className = className;
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    div.append(dt, dd);
    container.append(div);
  });
}

function normalizeTestRecord(test) {
  test.steps = (test.steps || []).map((step) => ({
    ...step,
    landingResult: step.landingResult || null,
    photoRequired: step.photoRequired ?? /take a picture/i.test(step.prompt || ""),
    photoReview: step.photoReview || null
  }));
  return test;
}

function getOutcome(test) {
  const steps = test.steps || [];
  if (steps.some((step) => step.landingResult === "unsuccessful") || steps.some((step) => step.photoReview === "fail")) {
    return { label: "Failed", className: "outcome-fail" };
  }
  const photos = steps.filter((step) => step.photoRequired);
  if (photos.length && photos.every((step) => step.photoReview === "pass")) {
    return { label: "Passed", className: "outcome-pass" };
  }
  return { label: "Pending photo review", className: "outcome-pending" };
}

function stepResultText(step) {
  if (step.landingResult === "successful") return "Landing: successful";
  if (step.landingResult === "unsuccessful") return "Landing: unsuccessful";
  if (step.photoRequired && step.photoReview === "pass") return "Photo: pass";
  if (step.photoRequired && step.photoReview === "fail") return "Photo: fail";
  if (step.photoRequired) return "Photo: not reviewed";
  return "—";
}

function renderResults(test) {
  currentTest = normalizeTestRecord(test);
  const outcome = getOutcome(currentTest);
  $("outcomeBadge").textContent = outcome.label;
  $("outcomeBadge").className = `outcome-badge ${outcome.className}`;
  $("resultsSubtitle").textContent = `${test.pilot} · ${test.drone} · ${formatDate(test.completedAt)}`;
  $("resultTotal").textContent = formatDuration(test.totalMilliseconds);
  $("reportTotal").textContent = formatDuration(test.totalMilliseconds);
  $("reportId").textContent = test.id;
  addMeta($("reportMeta"), [
    ["Pilot", test.pilot],
    ["Proctor", test.instructor],
    ["Aircraft", test.drone],
    ["Started", formatDate(test.startedAt)],
    ["Completed", formatDate(test.completedAt)],
    ["Timed prompts", String(test.steps.length)],
    ["Outcome", outcome.label]
  ]);

  const tbody = $("resultsTableBody");
  tbody.innerHTML = "";
  test.steps.forEach((step) => {
    const tr = document.createElement("tr");
    [step.number, step.prompt, formatClock(step.completedAt), formatDuration(step.durationMilliseconds), formatDuration(step.cumulativeMilliseconds), stepResultText(step)].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    });
    tbody.append(tr);
  });
}

function downloadBlob(name, content, type) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  downloadBlob(`${currentTest.id}.json`, JSON.stringify(currentTest, null, 2), "application/json");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  const outcome = getOutcome(currentTest).label;
  const rows = [
    ["Test ID", currentTest.id], ["Pilot", currentTest.pilot], ["Proctor", currentTest.instructor],
    ["Drone", currentTest.drone], ["Started", currentTest.startedAt], ["Completed", currentTest.completedAt],
    ["Total milliseconds", currentTest.totalMilliseconds], ["Outcome", outcome], [],
    ["Step", "Prompt", "Started", "Completed", "Duration ms", "Cumulative ms", "Landing result", "Photo review"],
    ...currentTest.steps.map((s) => [s.number, s.prompt, s.startedAt, s.completedAt, s.durationMilliseconds, s.cumulativeMilliseconds, s.landingResult || "", s.photoReview || ""])
  ];
  downloadBlob(`${currentTest.id}.csv`, rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8");
}

function startPhotoReview(test) {
  currentTest = normalizeTestRecord(test);
  reviewSteps = currentTest.steps.filter((step) => step.photoRequired);
  const firstUnreviewed = reviewSteps.findIndex((step) => !step.photoReview);
  reviewIndex = firstUnreviewed >= 0 ? firstUnreviewed : 0;
  renderPhotoReview();
  showView("reviewView");
}

function renderPhotoReview() {
  const step = reviewSteps[reviewIndex];
  if (!step) {
    renderResults(currentTest);
    showView("resultsView");
    return;
  }
  const percent = Math.round(((reviewIndex + 1) / reviewSteps.length) * 100);
  $("reviewProgress").textContent = `Photo ${reviewIndex + 1} of ${reviewSteps.length}`;
  $("reviewProgressBar").style.width = `${percent}%`;
  $("reviewStep").textContent = `Step ${step.number}`;
  $("reviewTitle").textContent = step.prompt;
  $("reviewContext").textContent = `${currentTest.pilot} · ${currentTest.drone}`;
  $("reviewChoice").textContent = step.photoReview ? `Marked ${step.photoReview}` : "Not reviewed";
  $("reviewChoice").className = `review-choice ${step.photoReview ? `is-${step.photoReview}` : ""}`;
  $("previousPhotoButton").disabled = reviewIndex === 0;
  $("nextPhotoButton").textContent = reviewIndex === reviewSteps.length - 1 ? "Finish review →" : "Next →";
}

async function markPhotoReview(result) {
  reviewSteps[reviewIndex].photoReview = result;
  currentTest.reviewUpdatedAt = new Date().toISOString();
  await saveTest(currentTest);
  if (reviewIndex < reviewSteps.length - 1) {
    reviewIndex += 1;
    renderPhotoReview();
  } else {
    renderResults(currentTest);
    showView("resultsView");
    await renderHistory();
  }
}

async function importCompletedTest(file) {
  const imported = normalizeTestRecord(JSON.parse(await file.text()));
  if (!imported.id || imported.status !== "completed" || !Array.isArray(imported.steps)) throw new Error("This is not a completed test record.");
  imported.importedAt = new Date().toISOString();
  await saveTest(imported);
  $("importStatus").textContent = `Imported ${imported.pilot}'s completed test.`;
  await renderHistory();
}

async function renderHistory() {
  const tests = (await getAllTests()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const active = tests.find((test) => test.status === "active");
  if (active) {
    $("resumePanel").classList.remove("is-hidden");
    $("resumeTitle").textContent = `Resume ${active.pilot}'s test`;
    $("resumeMeta").textContent = `${active.drone} · Step ${active.currentStepIndex + 1} of ${PROMPTS.length} · started ${formatDate(active.startedAt)}`;
    $("resumeButton").onclick = () => resumeTest(active);
  } else {
    $("resumePanel").classList.add("is-hidden");
  }

  const completed = tests.filter((test) => test.status === "completed");
  const list = $("historyList");
  list.innerHTML = "";
  if (!completed.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Completed tests will appear here.";
    list.append(empty);
    return;
  }
  completed.forEach((test) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const identity = document.createElement("div");
    const name = document.createElement("strong");
    const drone = document.createElement("span");
    name.textContent = test.pilot;
    drone.textContent = test.drone;
    identity.append(name, drone);
    const date = document.createElement("div");
    const dateStrong = document.createElement("strong");
    const id = document.createElement("span");
    dateStrong.textContent = formatDate(test.completedAt);
    id.textContent = test.id;
    date.append(dateStrong, id);
    const total = document.createElement("div");
    const totalStrong = document.createElement("strong");
    const totalLabel = document.createElement("span");
    totalStrong.textContent = formatDuration(test.totalMilliseconds);
    totalLabel.textContent = "Total time";
    total.append(totalStrong, totalLabel);
    const view = document.createElement("button");
    view.type = "button";
    view.textContent = "View results →";
    view.onclick = () => { renderResults(test); showView("resultsView"); };
    item.append(identity, date, total, view);
    list.append(item);
  });
}

function resumeTest(test) {
  currentTest = test;
  renderCurrentStep();
  showView("testView");
  startTimerLoop();
  requestWakeLock();
}

function resetToSetup() {
  clearInterval(timerHandle);
  releaseWakeLock();
  currentTest = null;
  pendingTest = null;
  $("setupForm").reset();
  $("customDroneLabel").classList.add("is-hidden");
  showView("setupView");
  renderHistory();
}

$("dronePlatform").addEventListener("change", (event) => {
  const custom = event.target.value === "Other";
  $("customDroneLabel").classList.toggle("is-hidden", !custom);
  $("customDrone").required = custom;
});

$("setupForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const selectedDrone = form.get("drone");
  pendingTest = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    status: "briefing",
    instructor: String(form.get("instructor")).trim(),
    pilot: String(form.get("pilot")).trim(),
    drone: selectedDrone === "Other" ? String(form.get("customDrone")).trim() : selectedDrone
  };
  renderBriefing(pendingTest);
  showView("briefingView");
});

$("backToSetup").addEventListener("click", () => showView("setupView"));
$("startTestButton").addEventListener("click", startTest);
$("nextStepButton").addEventListener("click", () => completeCurrentStep());
$("landingSuccessButton").addEventListener("click", () => completeCurrentStep("successful"));
$("landingFailureButton").addEventListener("click", () => completeCurrentStep("unsuccessful"));
$("printButton").addEventListener("click", () => window.print());
$("reviewButton").addEventListener("click", () => startPhotoReview(currentTest));
$("jsonButton").addEventListener("click", exportJson);
$("csvButton").addEventListener("click", exportCsv);
$("newTestButton").addEventListener("click", resetToSetup);
$("backToResultsButton").addEventListener("click", () => { renderResults(currentTest); showView("resultsView"); });
$("photoPassButton").addEventListener("click", () => markPhotoReview("pass"));
$("photoFailButton").addEventListener("click", () => markPhotoReview("fail"));
$("previousPhotoButton").addEventListener("click", () => { if (reviewIndex > 0) { reviewIndex -= 1; renderPhotoReview(); } });
$("nextPhotoButton").addEventListener("click", () => {
  if (reviewIndex < reviewSteps.length - 1) { reviewIndex += 1; renderPhotoReview(); }
  else { renderResults(currentTest); showView("resultsView"); }
});
$("importButton").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { await importCompletedTest(file); }
  catch (error) { $("importStatus").textContent = error.message || "Unable to import this test."; }
  event.target.value = "";
});
$("homeButton").addEventListener("click", () => {
  if (currentTest?.status === "active") return;
  showView("setupView");
  renderHistory();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentTest?.status === "active") requestWakeLock();
});

window.addEventListener("DOMContentLoaded", async () => {
  try {
    db = await openDatabase();
    await renderHistory();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (error) {
    console.error(error);
    $("historyList").innerHTML = '<div class="empty-state">Local storage is unavailable in this browser.</div>';
  }
});
