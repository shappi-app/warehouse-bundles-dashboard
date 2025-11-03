// dashboard.js

import ambassadorNames from "./ambassadors.js";

const HEADER_ALIASES = {
  "trip id": "Trip ID",
  tripid: "Trip ID",
  "traveler": "Traveler",
  "traveller": "Traveler",
  "usa dest": "USA Dest",
  "usa destination": "USA Dest",
  "items accepted": "Items Accepted",
  "items ready to process": "Items Ready to process",
  "items ready": "Items Ready to process",
  "trip verification status": "Trip Verification Status",
  "ship bundle": "Ship Bundle",
  "total bundle weight": "Total Bundle Weight",
  "latam departure": "LATAM Departure",
  "latam arrival": "LATAM Arrival",
  "max usa date": "Max USA Date",
};

function normalizeHeaderKey(key = "") {
  const cleaned = key.replace(/\ufeff/g, "").trim();
  const lookupKey = cleaned.toLowerCase().replace(/[\s_]+/g, " ");
  return HEADER_ALIASES[lookupKey] || cleaned;
}

function normalizeRow(row = {}) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const header = normalizeHeaderKey(key);
    if (!header) return;
    normalized[header] = typeof value === "string" ? value.trim() : value;
  });
  return normalized;
}

const socket = io();

let cards = {};
const saved = window.localStorage.getItem("bundleBoardCards");
if (saved) {
  try {
    cards = JSON.parse(saved);
  } catch (e) {
    console.warn("Failed to parse saved cards:", e);
  }
}
let currentFilter = "all";
let customStartDate = null;
let customEndDate = null;

// UI references
const csvInput = document.getElementById("csvFileInput");
const filterButtons = document.querySelectorAll("#filter-buttons button");
const showArchiveBtn = document.getElementById("showArchiveBtn");
const archiveSection = document.getElementById("archive-section");
const closeArchiveBtn = document.getElementById("closeArchiveBtn");
const archiveList = document.getElementById("archiveList");
const detailModal = document.getElementById("detail-modal");
const detailBody = document.getElementById("detail-body");
const closeDetailBtn = document.querySelector(".close-detail");
const resetBtn = document.getElementById("reset-assignee-filter");
const assignmentsList = document.getElementById("assignments-list");

// New date filter elements
const startDateInput = document.getElementById("filterStartDate");
const endDateInput = document.getElementById("filterEndDate");
const applyDateFilterBtn = document.getElementById("applyDateFilterBtn");
const clearDateFilterBtn = document.getElementById("clearDateFilterBtn");

// --- Event Listeners ---
csvInput.addEventListener("change", handleFileUpload);

filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentFilter = btn.getAttribute("data-filter");
    customStartDate = null;
    customEndDate = null;
    renderAll();
  });
});

// 📅 Date filter event listeners
applyDateFilterBtn.addEventListener("click", () => {
  const start = startDateInput.value;
  const end = endDateInput.value;

  if (start && end) {
    customStartDate = new Date(start);
    customEndDate = new Date(end);
    currentFilter = "custom-range";
    renderAll();
  } else {
    alert("Please select both start and end dates.");
  }
});

clearDateFilterBtn.addEventListener("click", () => {
  startDateInput.value = "";
  endDateInput.value = "";
  customStartDate = null;
  customEndDate = null;
  currentFilter = "all";
  renderAll();
});

showArchiveBtn.addEventListener("click", () => {
  archiveSection.classList.remove("hidden");
});
closeArchiveBtn.addEventListener("click", () => {
  archiveSection.classList.add("hidden");
});
closeDetailBtn.addEventListener("click", () => {
  detailModal.classList.add("hidden");
});
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    currentFilter = "all";
    renderAll();
    document
      .querySelectorAll("#assignments-list li")
      .forEach((el) => el.classList.remove("selected"));
  });
}

// --- Socket Real‑Time ---
socket.on("card-updated", (card) => {
  cards[card.tripId] = card;
  window.localStorage.setItem("bundleBoardCards", JSON.stringify(cards));
  renderAll();
});

socket.on("clear-completed", () => {
  for (let tid in cards) {
    if (cards[tid].currentBucket === "Bundle Completed") {
      delete cards[tid];
    }
  }
  window.localStorage.setItem("bundleBoardCards", JSON.stringify(cards));
  renderAll();
});

socket.on("card-restored", (card) => {
  if (card) {
    cards[card.tripId] = card;
    window.localStorage.setItem("bundleBoardCards", JSON.stringify(cards));
    renderAll();
  }
});

// --- Load from server on start ---
loadRemoteState();

async function loadRemoteState() {
  try {
    const resp = await fetch("/api/cards");
    const j = await resp.json();
    const obj = j.cards || {};
    Object.values(obj).forEach((c) => {
      cards[c.tripId] = c;
    });
    window.localStorage.setItem("bundleBoardCards", JSON.stringify(cards));
    renderAll();
  } catch (err) {
    console.error("Failed to load cards:", err);
  }
}

// --- CSV Upload Handling ---
function handleFileUpload(evt) {
  const file = evt.target.files[0];
  if (!file) return;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (res) => {
      const rows = res.data.map(normalizeRow);
      console.log("📥 Parsed CSV rows:", rows.length);
      const errors = mergeCsv(rows);
      if (errors.length) alert("CSV Warnings:\n" + errors.join("\n"));

      // Send the entire rows array to the server
      try {
        const resp = await fetch("/api/uploadCsv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows })
        });
        const j = await resp.json();
        console.log("📤 Server responded to uploadCsv:", j);
      } catch (err) {
        console.error("❌ uploadCsv failed:", err);
      }

      window.localStorage.setItem("bundleBoardCards", JSON.stringify(cards));
      renderAll();
    }
  });
}

// --- Merge CSV Data ---
function mergeCsv(rows) {
  const errors = [];
  rows.forEach((row, idx) => {
    const tripIdValue = row["Trip ID"];
    const tripId =
      typeof tripIdValue === "string"
        ? tripIdValue.trim()
        : tripIdValue != null
        ? String(tripIdValue).trim()
        : "";
    if (!tripId) {
      errors.push(`Row ${idx + 1}: missing Trip ID`);
      return;
    }

    const traveler = (row["Traveler"] || "").trim();
    const usaDest = (row["USA Dest"] || "").trim();
    const itemsAcceptedRaw = row["Items Accepted"];
    const itemsReadyRaw = row["Items Ready to process"];
    const status = (row["Trip Verification Status"] || "").trim();
    const shipBundle = (row["Ship Bundle"] || "").trim();
    const totalBundleWeight = (row["Total Bundle Weight"] || "").trim();
    const latamDeparture = (row["LATAM Departure"] || "").trim();
    const latamArrival = (row["LATAM Arrival"] || "").trim();
    const maxUSADate = (row["Max USA Date"] || "").trim();

    let accepted = parseInt(itemsAcceptedRaw || "0", 10);
    if (isNaN(accepted)) accepted = 0;
    let ready = parseInt(itemsReadyRaw || "0", 10);
    if (isNaN(ready)) ready = 0;
    if (ready > accepted) ready = accepted;

    if (!cards[tripId]) {
      cards[tripId] = {
        tripId,
        traveler,
        usaDest,
        itemsAccepted: accepted,
        itemsReadyToProcess: ready,
        totalBundleWeight,
        tripVerificationStatus: status,
        latamDeparture,
        latamArrival,
        shipBundle,
        maxUSADate,
        assignedTo: null,
        currentBucket: computeInitialBucket(status, accepted, ready),
        manuallyMoved: false,
      };
    } else {
      const c = cards[tripId];
      c.traveler = traveler;
      c.usaDest = usaDest;
      c.itemsAccepted = accepted;
      c.itemsReadyToProcess = ready;
      c.totalBundleWeight = totalBundleWeight;
      c.tripVerificationStatus = status;
      c.latamDeparture = latamDeparture;
      c.latamArrival = latamArrival;
      c.shipBundle = shipBundle;
      c.maxUSADate = maxUSADate;
      if (!c.manuallyMoved) {
        c.currentBucket = computeInitialBucket(status, accepted, ready);
      }
    }
  });
  return errors;
}

function computeInitialBucket(status, accepted, ready) {
  if (status !== "TX Approved") return "Pending/In Progress";
  if (ready === 0) return "Approved, Not TA'd";
  if (ready > 0 && ready < accepted) return "Approved, TA in progress";
  if (ready === accepted) return "TA Completed, Ready for bundle";
  return "Pending/In Progress";
}

// --- Assignments Panel ---
function updateAssignmentsPanel() {
  const counts = { Greg: 0, Caz: 0, Justin: 0, Ansley: 0 };

  Object.values(cards).forEach((card) => {
    const ass = card.assignedTo;
    if (ass && counts.hasOwnProperty(ass)) counts[ass]++;
  });

  assignmentsList.innerHTML = "";
  Object.entries(counts).forEach(([name, count]) => {
    const li = document.createElement("li");
    li.innerText = `${name}: ${count} bundles`;
    li.dataset.assignee = name;
    li.addEventListener("click", () => {
      filterByAssignee(name);
      document
        .querySelectorAll("#assignments-list li")
        .forEach((el) => el.classList.remove("selected"));
      li.classList.add("selected");
    });
    assignmentsList.appendChild(li);
  });
}

function filterByAssignee(name) {
  currentFilter = "all";
  const originalPassesFilter = passesFilter;
  passesFilter = (card) => card.assignedTo === name;
  renderAll();
  passesFilter = originalPassesFilter;
}

// --- Utility: Format time remaining ---
function formatTimeRemaining(ms) {
  if (ms < 0) return "0d 0h 0m";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

// --- Render All ---
function renderAll() {
  document.querySelectorAll(".bucket").forEach((b) => {
    const name = b.getAttribute("data-bucket");
    const inner =
      name === "Bundle Completed"
        ? `<h3>${name}</h3><button id="clearCompletedBtn">Clear Completed</button><div class="bucket-content"></div>`
        : `<h3>${name}</h3><div class="bucket-content"></div>`;
    b.innerHTML = inner;
  });

  document
    .getElementById("clearCompletedBtn")
    ?.addEventListener("click", () => {
      fetch("/api/clearCompleted", { method: "POST" });
    });

  const allCards = Object.values(cards).sort((a, b) => {
    const da = new Date(a.shipBundle || "");
    const db = new Date(b.shipBundle || "");
    return da - db;
  });

  allCards.forEach((card) => {
    if (!passesFilter(card)) return;
    const bucketContent = document.querySelector(
      `.bucket[data-bucket="${card.currentBucket}"] .bucket-content`
    );
    if (!bucketContent) return;

    const cardDiv = document.createElement("div");
    cardDiv.className = "bundle-card";
    cardDiv.dataset.tripId = card.tripId;

    // Ambassador highlight
    const travelerNorm = (card.traveler || "").trim().toLowerCase();
    if (
      ambassadorNames.has(travelerNorm) ||
      ambassadorNames.has(card.traveler?.trim())
    ) {
      cardDiv.classList.add("ambassador");
    }

    // Date badge
    const today = new Date();
    const sbDate = new Date(card.shipBundle || "");
    let badgeClass = "later";
    let badgeText = "";
    if (!isNaN(sbDate)) {
      const diff = Math.ceil((sbDate - today) / (1000 * 60 * 60 * 24));
      if (diff <= 0) {
        badgeClass = "today";
        badgeText = "Leaves Today";
      } else if (diff === 1) {
        badgeClass = "tomorrow";
        badgeText = "Leaves Tomorrow";
      } else {
        badgeText = `Leaves in ${diff} days`;
      }
    }
    const badge = document.createElement("span");
    badge.className = `badge-date ${badgeClass}`;
    badge.textContent = badgeText;
    cardDiv.appendChild(badge);

    // Countdown
    const timer = document.createElement("span");
    timer.className = "timer-countdown";
    cardDiv.appendChild(timer);

    // Traveler name
    const lbl = document.createElement("div");
    lbl.className = "card-label";
    lbl.textContent = card.traveler || "";
    cardDiv.appendChild(lbl);

    // Info list
    const ul = document.createElement("ul");
    [
      `Trip ID: ${card.tripId}`,
      `Destination: ${card.usaDest || ""}`,
      `Ship Bundle: ${card.shipBundle || ""}`,
      `Status: ${card.tripVerificationStatus}`,
      `Accepted: ${card.itemsAccepted}`,
      `Ready: ${card.itemsReadyToProcess}`,
    ].forEach((txt) => {
      const li = document.createElement("li");
      li.innerText = txt;
      ul.appendChild(li);
    });
    cardDiv.appendChild(ul);

    // Bucket select
    const bucketSelect = document.createElement("select");
    const bucketNames = [
      "Pending/In Progress",
      "Approved, Not TA'd",
      "Approved, TA in progress",
      "TA Completed, Ready for bundle",
      "Bundling in Progress",
      "Bundle Completed",
      "Labeled",
    ];
    bucketNames.forEach((bn) => {
      const opt = document.createElement("option");
      opt.value = bn;
      opt.text = bn;
      if (card.currentBucket === bn) opt.selected = true;
      bucketSelect.appendChild(opt);
    });
    bucketSelect.addEventListener("change", () => {
      card.currentBucket = bucketSelect.value;
      card.manuallyMoved = true;
      fetch("/api/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card }),
      }).then(() => {
        window.localStorage.setItem("bundleBoardCards", JSON.stringify(cards));
        renderAll();
      });
    });
    cardDiv.appendChild(bucketSelect);

    // Assignment select
    const assignSelect = document.createElement("select");
    ["", "Greg", "Caz", "Justin", "Ansley"].forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.text = name === "" ? "Assign..." : name;
      if (card.assignedTo === name) opt.selected = true;
      assignSelect.appendChild(opt);
    });
    assignSelect.addEventListener("change", () => {
      card.assignedTo = assignSelect.value || null;
      card.manuallyMoved = true;
      fetch("/api/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card }),
      }).then(() => {
        window.localStorage.setItem("bundleBoardCards", JSON.stringify(cards));
        updateAssignmentsPanel();
      });
    });
    cardDiv.appendChild(assignSelect);

    // Details button
    const btn = document.createElement("button");
    btn.textContent = "Details";
    btn.onclick = () => showDetails(card);
    cardDiv.appendChild(btn);

    bucketContent.appendChild(cardDiv);

    if (!card._timerInterval) {
      card._timerInterval = setInterval(() => {
        const now = new Date();
        const sb2 = new Date(card.shipBundle || "");
        const diffMs = sb2 - now;
        timer.textContent = formatTimeRemaining(diffMs);
        if (diffMs < 0) timer.classList.add("expired");
      }, 1000);
    }
  });

  drawChart();
  updateSummary();
  updateAssignmentsPanel();
}

// ... (rest of your utility functions remain unchanged)

// --- Details Modal ---
function showDetails(card) {
  detailBody.innerHTML = `
    <p><strong>Trip ID:</strong> ${card.tripId}</p>
    <p><strong>Traveler:</strong> ${card.traveler || ""}</p>
    <p><strong>Destination:</strong> ${card.usaDest || ""}</p>
    <p><strong>Status:</strong> ${card.tripVerificationStatus}</p>
    <p><strong>Items Accepted:</strong> ${card.itemsAccepted}</p>
    <p><strong>Items Ready:</strong> ${card.itemsReadyToProcess}</p>
    <p><strong>Total Weight:</strong> ${card.totalBundleWeight}</p>
    <p><strong>Ship Bundle:</strong> ${card.shipBundle}</p>
    <p><strong>Assigned To:</strong> ${card.assignedTo || "(none)"}</p>
    <p><strong>Bucket:</strong> ${card.currentBucket}</p>
  `;
  detailModal.classList.remove("hidden");
}

// --- Filters ---
function passesFilter(card) {
  const shipDate = card.shipBundle ? new Date(card.shipBundle) : null;

  if (currentFilter === "custom-range") {
    if (!customStartDate || !customEndDate || !shipDate || isNaN(shipDate)) return false;
    return shipDate >= customStartDate && shipDate <= customEndDate;
  }

  if (currentFilter === "all") return true;

  // (rest of your filter logic remains unchanged)


  if (currentFilter === "ambassadors") {
    const travelerNorm = (card.traveler || "").trim().toLowerCase();
    return (
      ambassadorNames.has(travelerNorm) ||
      ambassadorNames.has(card.traveler?.trim())
    );
  }

  if (!shipDate || isNaN(shipDate)) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek + 1);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const nextWeekStart = new Date(endOfWeek);
  nextWeekStart.setDate(endOfWeek.getDate() + 1);
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

  if (currentFilter === "today")
    return shipDate.toDateString() === today.toDateString();
  if (currentFilter === "this-week")
    return shipDate >= startOfWeek && shipDate <= endOfWeek;
  if (currentFilter === "next-week")
    return shipDate >= nextWeekStart && shipDate <= nextWeekEnd;

  return true;
}

// --- Charts ---
let chart = null;
function drawChart() {
  const bucketNames = [
    "Pending/In Progress",
    "Approved, Not TA'd",
    "Approved, TA in progress",
    "TA Completed, Ready for bundle",
    "Bundling in Progress",
    "Bundle Completed",
    "Labeled",
  ];
  const counts = bucketNames.map(
    (bn) =>
      Object.values(cards).filter(
        (c) => c.currentBucket === bn && passesFilter(c)
      ).length
  );
  const ctx = document.getElementById("bucketChart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: bucketNames,
      datasets: [
        {
          label: "# of Trips",
          data: counts,
          backgroundColor: "rgba(99, 0, 255, 0.6)",
        },
      ],
    },
    options: { indexAxis: "y", scales: { x: { beginAtZero: true } } },
  });
}

// --- Summary ---
function updateSummary() {
  const visible = Object.values(cards).filter((c) => passesFilter(c));
  const totalTrips = visible.length;
  const sumItems = visible.reduce(
    (acc, c) => acc + (c.itemsAccepted || 0),
    0
  );
  const sumWeight = visible.reduce(
    (acc, c) => acc + (parseFloat(c.totalBundleWeight) || 0),
    0
  );
  document.getElementById(
    "summary"
    ).innerText = `Total Trips: ${totalTrips} | Items Accepted: ${sumItems} | Total Bundle Weight: ${sumWeight.toFixed(2)} lbs`;
}
