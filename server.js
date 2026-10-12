/**
 * BackupBuddy AI - Local Server & Gemini API Gateway
 * Built strictly with Node.js built-in modules (no external framework dependencies).
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// Load .env file if present
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, "utf8");
      content.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const match = trimmed.match(/^([^=]+)=(.*)$/);
          if (match) {
            const key = match[1].trim();
            let val = match[2].trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      });
    } catch (err) {
      console.warn("Could not read local .env file:", err.message);
    }
  }
}

loadEnv();

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const MAX_REQUEST_BYTES = 50 * 1024; // 50 KB safety limit

// MIME types for static assets
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

/**
 * Handle POST /api/advisor
 */
function handleAdvisorRequest(req, res) {
  let bodyStr = "";
  let receivedBytes = 0;

  req.on("data", (chunk) => {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_REQUEST_BYTES) {
      req.destroy();
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Payload too large. Request exceeded 50 KB." }));
    } else {
      bodyStr += chunk;
    }
  });

  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(bodyStr);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid JSON in request body." }));
    }

    // Check GEMINI_API_KEY presence
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          error:
            "GEMINI_API_KEY is not configured on the server. Please add your key to a .env file (GEMINI_API_KEY=your_key) or set it in your environment variables, then restart server.js."
        })
      );
    }

    // Validate essential fields
    const { battery, loadWatts, runtimeHours, runtimeFormatted, targetHours, appliances, plan } = payload;
    if (!battery || loadWatts === undefined || !targetHours) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Missing required battery or load parameters." }));
    }

    // Construct prompt strictly grounded in calculated numbers
    const activeAppliances = Array.isArray(appliances)
      ? appliances
          .filter((a) => a.qty > 0)
          .map((a) => `- ${a.qty}x ${a.name} (${a.watts} W each, subtotal: ${a.qty * a.watts} W, priority: ${a.isEssential ? "Keep Running / Essential" : "Optional"})`)
          .join("\n")
      : "Custom manual load specified.";

    const promptText = `
You are the AI Power Advisor inside BackupBuddy AI, a practical assistant for Pakistani households dealing with load-shedding.
Analyze the following household UPS and battery configuration and provide clear, reassuring, and practical advice.

=== HARDWARE & BACKUP METRICS (Pre-Calculated - Source of Truth) ===
- Battery Bank: ${battery.voltage}V, ${battery.capacityAh}Ah (${battery.type}, ${battery.dodPercent}% usable discharge)
- Inverter Continuous Limit: ${battery.inverterRatingWatts} W
- Inverter Efficiency: ${battery.efficiencyPercent}%
- Estimated Usable AC Energy: ${battery.acEnergyWh} Wh
- Current Active Load: ${loadWatts} W
- Current Estimated Runtime: ${runtimeFormatted} (~${runtimeHours} hours)
- Desired Backup Target: ${targetHours} hours
- Inverter Overload Status: ${loadWatts > battery.inverterRatingWatts ? "OVERLOADED" : "Safe continuous load"}

=== ACTIVE APPLIANCES ===
${activeAppliances}

=== DETERMINISTIC OPTIMIZER RESULTS ===
- Target Met with Current Load: ${plan && plan.targetReached ? "Yes" : "No"}
- Target Maximum Allowed Load for ${targetHours}h: ${plan ? plan.targetMaxLoad : "N/A"} W
- Suggested Sheddings: ${
      plan && plan.recommendations && plan.recommendations.length > 0
        ? plan.recommendations.map((r) => `${r.unitsShed}x ${r.name} (saves ${r.totalSavedWatts} W)`).join(", ")
        : "None or not applicable"
    }
- Optimized Runtime if suggested appliances are switched off: ${plan ? plan.newRuntimeFormatted : "N/A"}

=== GUIDELINES FOR YOUR RESPONSE ===
You must structure your response into these 4 concise sections:

### 1. YOUR CURRENT SITUATION
Summarize the actual current load in Watts (${loadWatts} W), estimated backup runtime (${runtimeFormatted}), requested backup duration (${targetHours} hours), and clearly state whether the target is achievable with the current appliances.

### 2. WHAT YOU SHOULD DO
Provide 2 or 3 prioritized actions based on the user's active appliances, explicitly keeping essential appliances running and identifying which optional appliances to turn off.

### 3. YOUR ALTERNATIVE PLAN
- If the target cannot be met: explain which optional appliances to switch off, referencing the exact calculated reduction (${plan && plan.totalWattsSaved ? plan.totalWattsSaved + " W" : "from the plan"}), and state the calculated new backup time (${plan ? plan.newRuntimeFormatted : "N/A"}).
- If the target is already met: clearly state that no reduction is necessary, and give 1 optional tip to extend backup time even further.

### 4. SAFETY NOTE
Include a brief, relevant safety reminder about motor/compressor starting surges (for ACs, fridges, or water pumps if active), continuous inverter limits, or battery ventilation.

STRICT ACCURACY RULES:
- Use only the actual numbers supplied above (${loadWatts} W load, ${runtimeFormatted} runtime, ${targetHours}h target).
- Never invent battery capacities, runtime estimates, solar panels, or electricity outage schedules.
- Keep the overall response direct, friendly, and complete.
`.trim();

    const requestData = JSON.stringify({
      contents: [
        {
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    const options = {
      hostname: "generativelanguage.googleapis.com",
      port: 443,
      path: `/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestData)
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let responseBody = "";

      apiRes.on("data", (chunk) => {
        responseBody += chunk;
      });

      apiRes.on("end", () => {
        if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
          try {
            const parsed = JSON.parse(responseBody);
            const candidates = parsed.candidates;
            if (!candidates || candidates.length === 0) {
              res.writeHead(502, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ error: "No response candidates returned by Gemini API." }));
            }

            const candidate = candidates[0];

            // Detect incomplete generation due to token limits or stop reasons
            if (candidate.finishReason === "MAX_TOKENS") {
              res.writeHead(502, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: "The AI advice response was interrupted due to length constraints. Please try generating again."
                })
              );
            }

            if (candidate.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)) {
              res.writeHead(502, { "Content-Type": "application/json" });
              return res.end(
                JSON.stringify({
                  error: `AI response ended prematurely (${candidate.finishReason}). Please try again.`
                })
              );
            }

            if (!candidate.content || !Array.isArray(candidate.content.parts)) {
              res.writeHead(502, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ error: "No content parts received from Gemini API." }));
            }

            const text = candidate.content.parts
              .filter((p) => typeof p.text === "string")
              .map((p) => p.text)
              .join("")
              .trim();

            if (!text) {
              res.writeHead(502, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ error: "Empty advice text received from Gemini API." }));
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ advice: text, finishReason: candidate.finishReason || "STOP" }));
          } catch {
            res.writeHead(502, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Failed to parse response from Gemini API." }));
          }
        } else {
          // Clean error message without exposing the API key
          let errMsg = `Gemini API returned status ${apiRes.statusCode}.`;
          try {
            const errObj = JSON.parse(responseBody);
            if (errObj.error && errObj.error.message) {
              errMsg = errObj.error.message.replace(new RegExp(apiKey, "g"), "[REDACTED]");
            }
          } catch {
            // Keep generic errMsg
          }
          res.writeHead(apiRes.statusCode === 429 ? 429 : 502, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: errMsg }));
        }
      });
    });

    apiReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Network error connecting to Gemini API: " + err.message }));
    });

    apiReq.write(requestData);
    apiReq.end();
  });
}

/**
 * Static file server
 */
function serveStaticFile(req, res) {
  let reqPath = req.url.split("?")[0];
  if (reqPath === "/" || reqPath === "") {
    reqPath = "/index.html";
  }

  // Prevent directory traversal
  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, "");
  const filePath = path.join(__dirname, safePath);

  // Ensure filePath stays within root directory
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Access Denied");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("404 Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Create HTTP server
const server = http.createServer((req, res) => {
  // Enable local CORS if needed
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === "/api/advisor" && req.method === "POST") {
    return handleAdvisorRequest(req, res);
  }

  if (req.method === "GET") {
    return serveStaticFile(req, res);
  }

  res.writeHead(405, { "Content-Type": "text/plain" });
  res.end("Method Not Allowed");
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`BackupBuddy AI running at http://localhost:${PORT}`);
    console.log(`Gemini Model: ${GEMINI_MODEL}`);
    console.log(`GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? "Configured" : "Missing (Add to .env)"}`);
  });
}

module.exports = { server, loadEnv };
