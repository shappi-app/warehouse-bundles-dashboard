// server.js

const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

const CARDS_FILE = path.join(__dirname, "data", "cards.json");

// Load cards from JSON file
function loadCards() {
  try {
    const raw = fs.readFileSync(CARDS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

// Save cards to JSON file
function saveCards(cards) {
  fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2), "utf8");
}

let cards = loadCards();

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
    if (header.length === 0) return;
    normalized[header] = typeof value === "string" ? value.trim() : value;
  });
  return normalized;
}

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Debug log
console.log("✅ Server script loaded.");

io.on("connection", (socket) => {
  console.log("🔌 Client connected", socket.id);
  socket.on("disconnect", () => {
    console.log("🔌 Client disconnected", socket.id);
  });
});

// API: get all cards
app.get("/api/cards", (req, res) => {
  res.json({ cards });
});

// API: upload CSV rows
app.post("/api/uploadCsv", (req, res) => {
  const incomingRows = req.body.rows;
  if (!Array.isArray(incomingRows)) {
    console.log("❌ uploadCsv: invalid rows format", req.body);
    return res.status(400).json({ error: "Invalid rows format" });
  }
  const rows = incomingRows.map(normalizeRow);
  console.log("📥 Received CSV rows:", rows.length);
  rows.forEach((row, idx) => {
    const tripIdValue = row["Trip ID"];
    const tripId =
      typeof tripIdValue === "string"
        ? tripIdValue.trim()
        : tripIdValue != null
        ? String(tripIdValue).trim()
        : "";
    if (!tripId) {
      console.log(`⚠️ Row ${idx+1} missing Trip ID, skipping`);
      return;
      
    // Compute initial bucket (replicate frontend logic)
    let bucket;
    if (row["Trip Verification Status"] !== "TX Approved") {
      bucket = "Pending/In Progress";
    } else if (ready === 0) {
      bucket = "Approved, Not TA'd";
    } else if (ready > 0 && ready < accepted) {
      bucket = "Approved, TA in progress";
    } else if (ready === accepted) {
      bucket = "TA Completed, Ready for bundle";
    } else {
      bucket = "Pending/In Progress";
    }
bucket = "Approved, TA in progress";
    } else if (ready === accepted) {
      bucket = "TA Completed, Ready for bundle";
    } else {
      bucket = "Pending/In Progress";
    }

    const card = {
      tripId: tripId,
      traveler: (row["Traveler"] || "").trim(),
      usaDest: row["USA Dest"] || "",
      itemsAccepted: accepted,
      itemsReadyToProcess: ready,
      totalBundleWeight: row["Total Bundle Weight"] || "",
      tripVerificationStatus: row["Trip Verification Status"] || "",
      latamDeparture: row["LATAM Departure"] || "",
      latamArrival: row["LATAM Arrival"] || "",
      shipBundle: row["Ship Bundle"] || "",
      maxUSADate: row["Max USA Date"] || "",
      assignedTo: null,
      currentBucket: bucket,
      manuallyMoved: false,
    };
    cards[tripId] = card;
    console.log(`→ Card set: ${tripId} → bucket: ${bucket}`);
    io.emit("card-updated", card);
  });
  saveCards(cards);
  console.log("✅ Cards after CSV merge:", Object.keys(cards).length);
  res.json({ success: true, count: Object.keys(cards).length });
});


// API: update/add a card
app.post("/api/card", (req, res) => {
  const card = req.body.card;
  if (!card || !card.tripId) {
    console.log("❌ Invalid card received:", card);
    return res.status(400).json({ error: "Invalid card" });
  }
  cards[card.tripId] = card;
  saveCards(cards);
  console.log("✅ Card saved:", card.tripId);
  io.emit("card-updated", card);
  return res.json({ success: true });
});

// API: clear completed bucket
app.post("/api/clearCompleted", (req, res) => {
  Object.keys(cards).forEach((tid) => {
    if (cards[tid].currentBucket === "Bundle Completed") {
      console.log("🧹 Clearing completed card:", tid);
      delete cards[tid];
    }
  });
  saveCards(cards);
  io.emit("clear-completed");
  res.json({ success: true });
});

// Serve index.html on root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
