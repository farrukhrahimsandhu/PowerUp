/**
 * BackupBuddy AI - Battery & Load Planning Engine
 *
 * Core Formulas:
 * 1. Estimated AC Energy (Wh) = Voltage (V) * Capacity (Ah) * (DoD % / 100) * (Efficiency % / 100)
 * 2. Estimated Runtime (hours) = Estimated AC Energy (Wh) / Total Load (W)
 */

/**
 * Pure reusable calculation function (Preserved from Stages 1 & 2)
 */
function calculateBackupTime({
  voltage,
  capacityAh,
  dodFraction,
  efficiencyFraction,
  loadWatts,
  inverterRatingWatts
}) {
  const errors = [];
  const warnings = [];

  // Validation checks
  if (isNaN(voltage) || voltage <= 0) {
    errors.push("Please select a valid battery voltage.");
  }
  if (isNaN(capacityAh) || capacityAh <= 0) {
    errors.push("Battery capacity must be greater than 0 Ah.");
  }
  if (isNaN(dodFraction) || dodFraction <= 0 || dodFraction > 1) {
    errors.push("Safe discharge limit must be between 1% and 100%.");
  }
  if (isNaN(efficiencyFraction) || efficiencyFraction <= 0 || efficiencyFraction > 1) {
    errors.push("Inverter efficiency must be between 1% and 100%.");
  }
  if (isNaN(inverterRatingWatts) || inverterRatingWatts <= 0) {
    errors.push("Inverter rated limit must be greater than 0 W.");
  }
  if (isNaN(loadWatts) || loadWatts < 0) {
    errors.push("Appliance load cannot be negative.");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      warnings: [],
      acEnergyWh: 0,
      runtimeHours: 0,
      runtimeFormatted: "--",
      isOverloaded: false
    };
  }

  // Zero load check
  if (loadWatts === 0) {
    return {
      isValid: false,
      errors: ["Please choose at least one active appliance (greater than 0 W) to estimate runtime."],
      warnings: [],
      acEnergyWh: 0,
      runtimeHours: 0,
      runtimeFormatted: "--",
      isOverloaded: false
    };
  }

  // Energy & Runtime Calculations
  const nominalEnergyWh = voltage * capacityAh;
  const acEnergyWh = nominalEnergyWh * dodFraction * efficiencyFraction;
  const runtimeHours = acEnergyWh / loadWatts;

  // Inverter continuous power overload check
  const isOverloaded = loadWatts > inverterRatingWatts;
  if (isOverloaded) {
    warnings.push(
      `⚠️ Inverter Overload: Total load (${loadWatts} W) exceeds your inverter's continuous limit (${inverterRatingWatts} W). Turn off heavy appliances to prevent tripping.`
    );
  }

  // Time formatting
  const totalMinutes = Math.round(runtimeHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const runtimeFormatted = `${hours}h ${minutes.toString().padStart(2, "0")}m`;

  return {
    isValid: true,
    errors: [],
    warnings,
    nominalEnergyWh: Math.round(nominalEnergyWh),
    acEnergyWh: Math.round(acEnergyWh * 100) / 100,
    runtimeHours: Math.round(runtimeHours * 100) / 100,
    runtimeFormatted,
    isOverloaded
  };
}

/**
 * Pure deterministic Smart Load Planner
 */
function planSmartLoadReduction({
  currentLoad,
  targetHours,
  acEnergyWh,
  inverterRatingWatts,
  appliances
}) {
  if (isNaN(targetHours) || targetHours <= 0) {
    return {
      status: "invalid",
      message: "Please enter a valid backup duration greater than 0 hours."
    };
  }

  if (currentLoad <= 0 || acEnergyWh <= 0) {
    return {
      status: "invalid",
      message: "Please choose at least one appliance and battery size to view your plan."
    };
  }

  const targetMaxLoad = acEnergyWh / targetHours;

  // Target already met
  if (currentLoad <= targetMaxLoad) {
    return {
      status: "target-met",
      targetMaxLoad: Math.round(targetMaxLoad),
      message: `Your battery is expected to last through your ${targetHours.toFixed(1)}-hour target with your current appliances. No changes are necessary.`
    };
  }

  // Manual custom load override mode
  if (!appliances || appliances.length === 0) {
    return {
      status: "custom-load-info",
      targetMaxLoad: Math.round(targetMaxLoad),
      message: `To make your battery last ${targetHours.toFixed(1)} hours, your total load must be reduced from ${currentLoad} W to at most ${Math.round(targetMaxLoad)} W (reduce by ${Math.round(currentLoad - targetMaxLoad)} W).`
    };
  }

  // Filter active optional appliances (user chose not to strictly keep running)
  const optionalAppliances = appliances
    .filter(a => !a.isEssential && a.qty > 0 && a.watts > 0)
    .sort((a, b) => b.watts - a.watts);

  let simulatedLoad = currentLoad;
  const recommendations = [];

  for (const app of optionalAppliances) {
    let unitsToShed = 0;
    for (let u = 0; u < app.qty; u++) {
      if (simulatedLoad <= targetMaxLoad) break;
      unitsToShed++;
      simulatedLoad -= app.watts;
    }

    if (unitsToShed > 0) {
      recommendations.push({
        name: app.name,
        unitsShed: unitsToShed,
        wattsPerUnit: app.watts,
        totalSavedWatts: unitsToShed * app.watts
      });
    }

    if (simulatedLoad <= targetMaxLoad) break;
  }

  simulatedLoad = Math.max(0, simulatedLoad);
  const newRuntime = simulatedLoad > 0 ? (acEnergyWh / simulatedLoad) : 0;
  const totalMin = Math.round(newRuntime * 60);
  const newHours = Math.floor(totalMin / 60);
  const newMins = totalMin % 60;
  const newRuntimeFormatted = simulatedLoad > 0 ? `${newHours}h ${newMins.toString().padStart(2, "0")}m` : "--";

  const targetReached = simulatedLoad <= targetMaxLoad;

  return {
    status: targetReached ? "plan-achieved" : "plan-insufficient",
    targetMaxLoad: Math.round(targetMaxLoad),
    recommendations,
    newLoadWatts: simulatedLoad,
    newRuntimeHours: Math.round(newRuntime * 100) / 100,
    newRuntimeFormatted,
    totalWattsSaved: currentLoad - simulatedLoad,
    targetReached
  };
}

// Complete Categorized Appliance Catalog
const defaultAppliances = [
  // Basic Essentials
  { id: "ceiling-fan", name: "Ceiling fan", category: "Basic Essentials", watts: 75, qty: 2, isEssential: false },
  { id: "led-light", name: "LED light", category: "Basic Essentials", watts: 12, qty: 4, isEssential: true },
  { id: "wifi-router", name: "Wi-Fi router", category: "Basic Essentials", watts: 15, qty: 1, isEssential: true },
  { id: "phone-charger", name: "Phone charger", category: "Basic Essentials", watts: 10, qty: 0, isEssential: false },
  { id: "laptop", name: "Laptop", category: "Basic Essentials", watts: 65, qty: 0, isEssential: false },
  { id: "tv", name: "Television", category: "Basic Essentials", watts: 100, qty: 0, isEssential: false },

  // Cooling
  { id: "air-cooler", name: "Room air cooler", category: "Cooling", watts: 200, qty: 0, isEssential: false },
  { id: "ac-1ton-inverter", name: "1-ton inverter AC", category: "Cooling", watts: 900, qty: 0, isEssential: false },
  { id: "ac-1.5ton-inverter", name: "1.5-ton inverter AC", category: "Cooling", watts: 1400, qty: 0, isEssential: false },
  { id: "ac-1ton-non-inverter", name: "1-ton non-inverter AC", category: "Cooling", watts: 1200, qty: 0, isEssential: false },
  { id: "exhaust-fan", name: "Exhaust fan", category: "Cooling", watts: 40, qty: 0, isEssential: false },

  // Home and Kitchen
  { id: "refrigerator", name: "Refrigerator", category: "Home and Kitchen", watts: 150, qty: 0, isEssential: false },
  { id: "washing-machine", name: "Washing machine", category: "Home and Kitchen", watts: 500, qty: 0, isEssential: false },
  { id: "water-pump", name: "Water pump", category: "Home and Kitchen", watts: 550, qty: 0, isEssential: false },
  { id: "electric-iron", name: "Electric iron", category: "Home and Kitchen", watts: 1500, qty: 0, isEssential: false },
  { id: "microwave", name: "Microwave", category: "Home and Kitchen", watts: 1200, qty: 0, isEssential: false },
  { id: "electric-kettle", name: "Electric kettle", category: "Home and Kitchen", watts: 1800, qty: 0, isEssential: false },

  // Work and Other Devices
  { id: "desktop-pc", name: "Desktop computer", category: "Work and Other Devices", watts: 200, qty: 0, isEssential: false },
  { id: "printer", name: "Printer", category: "Work and Other Devices", watts: 50, qty: 0, isEssential: false }
];

let appliancesState = JSON.parse(JSON.stringify(defaultAppliances));

// DOM Initializer
document.addEventListener("DOMContentLoaded", () => {
  // Inputs
  const voltageInput = document.getElementById("battery-voltage");
  const capacityInput = document.getElementById("battery-capacity");
  const batteryTypeSelect = document.getElementById("battery-type");
  const dodInput = document.getElementById("usable-discharge");
  const efficiencyInput = document.getElementById("inverter-efficiency");
  const inverterRatingInput = document.getElementById("inverter-rating");
  const targetHoursInput = document.getElementById("target-hours");

  // Summary Displays
  const activeLoadDisplayEl = document.getElementById("active-load-display");
  const runtimeFormattedEl = document.getElementById("runtime-formatted");
  const runtimeDecimalEl = document.getElementById("runtime-decimal");
  const targetDisplayEl = document.getElementById("target-display");

  // Custom load elements
  const customLoadToggle = document.getElementById("custom-load-toggle");
  const customLoadContainer = document.getElementById("custom-load-container");
  const customLoadInput = document.getElementById("custom-load-input");

  // Banners
  const warningBannerEl = document.getElementById("warning-banner");
  const statusBannerEl = document.getElementById("status-banner");

  // Catalog container
  const appliancesContainer = document.getElementById("appliances-container");
  const plannerResultBoxEl = document.getElementById("planner-result-box");

  // Recharge Planner Elements
  const rechargeCurrentSocInput  = document.getElementById("recharge-current-soc");
  const rechargeTargetSocInput   = document.getElementById("recharge-target-soc");
  const gridInputsPanel          = document.getElementById("grid-inputs-panel");
  const solarInputsPanel         = document.getElementById("solar-inputs-panel");
  const gridChargeCurrentInput   = document.getElementById("grid-charge-current");
  const solarTotalWattsInput     = document.getElementById("solar-total-watts");
  const solarConditionSelect     = document.getElementById("solar-condition");
  const solarDeductLoadCheckbox  = document.getElementById("solar-deduct-load");
  const rechargeTimeDisplay      = document.getElementById("recharge-time-display");
  const rechargeTimeSubtext      = document.getElementById("recharge-time-subtext");
  const rechargeDetailsBox       = document.getElementById("recharge-details-box");
  const rechargeWarningBox       = document.getElementById("recharge-warning-box");
  const rechargeBankSummary      = document.getElementById("recharge-bank-summary");

  // Categories list in preferred display order
  const categories = [
    { title: "💡 Basic Essentials", name: "Basic Essentials" },
    { title: "❄️ Cooling", name: "Cooling" },
    { title: "🍳 Home and Kitchen", name: "Home and Kitchen" },
    { title: "🖥️ Work and Other Devices", name: "Work and Other Devices" }
  ];

  // Render Appliance Catalog Cards
  function renderApplianceCatalog() {
    appliancesContainer.innerHTML = "";

    categories.forEach(cat => {
      const catBlock = document.createElement("div");
      catBlock.className = "category-block";

      const catItems = appliancesState.filter(a => a.category === cat.name);
      const catWatts = catItems.reduce((sum, a) => sum + (a.qty * a.watts), 0);

      catBlock.innerHTML = `
        <div class="category-header">
          <h3 class="category-title">${cat.title}</h3>
          <span class="category-subtotal" id="cat-subtotal-${cat.name.replace(/\s+/g, '-')}">Category load: <strong>${catWatts} W</strong></span>
        </div>
        <div class="category-grid" id="grid-${cat.name.replace(/\s+/g, '-')}"></div>
      `;

      const gridEl = catBlock.querySelector(".category-grid");

      catItems.forEach(app => {
        const globalIdx = appliancesState.findIndex(a => a.id === app.id);
        const card = document.createElement("div");
        card.className = `appliance-card ${app.qty > 0 ? 'active' : ''}`;
        card.id = `card-${app.id}`;

        const subtotal = app.qty * app.watts;

        card.innerHTML = `
          <div class="card-top">
            <span class="appliance-name">${app.name}</span>
            <div class="card-wattage-wrap">
              <input type="number" class="card-watt-input" data-index="${globalIdx}" value="${app.watts}" min="1" step="1" title="Estimated running watts">
              <span>W</span>
            </div>
          </div>
          <div class="card-controls">
            <div class="qty-stepper">
              <button type="button" class="stepper-btn minus-btn" data-index="${globalIdx}" aria-label="Decrease ${app.name} quantity">−</button>
              <input type="number" class="stepper-input qty-input" data-index="${globalIdx}" value="${app.qty}" min="0" step="1">
              <button type="button" class="stepper-btn plus-btn" data-index="${globalIdx}" aria-label="Increase ${app.name} quantity">+</button>
            </div>
            <label class="priority-toggle" title="Check if your household prioritizes keeping this appliance on">
              <input type="checkbox" class="essential-check" data-index="${globalIdx}" ${app.isEssential ? "checked" : ""}>
              <span class="priority-tag ${app.isEssential ? 'essential' : 'optional'}">
                ${app.isEssential ? 'Keep Running' : 'Can Turn Off'}
              </span>
            </label>
          </div>
          <div class="card-bottom">
            <span>Running subtotal:</span>
            <span class="card-subtotal-val" id="subtotal-${app.id}">${subtotal} W</span>
          </div>
        `;

        gridEl.appendChild(card);
      });

      appliancesContainer.appendChild(catBlock);
    });

    attachCatalogEventListeners();
    attachTouchpadScrollFix();
  }

  // Attach interactive listeners to cards
  function attachCatalogEventListeners() {
    // Stepper Minus Buttons
    appliancesContainer.querySelectorAll(".minus-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        if (appliancesState[idx].qty > 0) {
          appliancesState[idx].qty -= 1;
          updateCardDOM(idx);
          updateEstimates();
        }
      });
    });

    // Stepper Plus Buttons
    appliancesContainer.querySelectorAll(".plus-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        appliancesState[idx].qty += 1;
        updateCardDOM(idx);
        updateEstimates();
      });
    });

    // Direct Quantity Typing
    appliancesContainer.querySelectorAll(".qty-input").forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        const val = parseInt(e.target.value, 10);
        appliancesState[idx].qty = isNaN(val) || val < 0 ? 0 : val;
        updateCardDOM(idx);
        updateEstimates();
      });
    });

    // Direct Wattage Typing
    appliancesContainer.querySelectorAll(".card-watt-input").forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        const val = parseFloat(e.target.value);
        appliancesState[idx].watts = isNaN(val) || val < 0 ? 0 : val;
        updateCardDOM(idx);
        updateEstimates();
      });
    });

    // Priority (Keep Running) Toggle
    appliancesContainer.querySelectorAll(".essential-check").forEach(check => {
      check.addEventListener("change", (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        appliancesState[idx].isEssential = e.target.checked;
        const app = appliancesState[idx];
        const card = document.getElementById(`card-${app.id}`);
        if (card) {
          const tag = card.querySelector(".priority-tag");
          if (e.target.checked) {
            tag.textContent = "Keep Running";
            tag.className = "priority-tag essential";
          } else {
            tag.textContent = "Can Turn Off";
            tag.className = "priority-tag optional";
          }
        }
        updateEstimates();
      });
    });
  }

  // Update card subtotal and active state without re-creating DOM
  function updateCardDOM(idx) {
    const app = appliancesState[idx];
    const card = document.getElementById(`card-${app.id}`);
    if (card) {
      if (app.qty > 0) {
        card.classList.add("active");
      } else {
        card.classList.remove("active");
      }

      const qtyInput = card.querySelector(".qty-input");
      if (qtyInput && parseInt(qtyInput.value, 10) !== app.qty) {
        qtyInput.value = app.qty;
      }

      const subtotalEl = document.getElementById(`subtotal-${app.id}`);
      if (subtotalEl) {
        subtotalEl.textContent = `${app.qty * app.watts} W`;
      }

      // Update category subtotal display
      const catSlug = app.category.replace(/\s+/g, '-');
      const catSubtotalEl = document.getElementById(`cat-subtotal-${catSlug}`);
      if (catSubtotalEl) {
        const catItems = appliancesState.filter(a => a.category === app.category);
        const totalCatWatts = catItems.reduce((sum, a) => sum + (a.qty * a.watts), 0);
        catSubtotalEl.innerHTML = `Category load: <strong>${totalCatWatts} W</strong>`;
      }
    }
  }

  // Compute total load across all catalog items
  function getTotalApplianceWatts() {
    return appliancesState.reduce((sum, a) => sum + (a.qty * a.watts), 0);
  }

  // Custom load toggle
  customLoadToggle.addEventListener("change", (e) => {
    if (e.target.checked) {
      customLoadContainer.classList.remove("hidden");
    } else {
      customLoadContainer.classList.add("hidden");
    }
    updateEstimates();
  });

  // Battery type preset defaults
  batteryTypeSelect.addEventListener("change", (e) => {
    if (e.target.value === "lead-acid") {
      dodInput.value = 50;
    } else if (e.target.value === "lithium") {
      dodInput.value = 80;
    }
    updateEstimates();
  });

  // Touchpad scrolling fix: prevents trackpad two-finger scrolls from changing numeric values
  function attachTouchpadScrollFix() {
    document.querySelectorAll('input[type="number"]').forEach(input => {
      input.removeEventListener("wheel", handleWheelBlur);
      input.addEventListener("wheel", handleWheelBlur);
    });
  }

  function handleWheelBlur(e) {
    e.target.blur();
  }

  // Master calculation updater
  function updateEstimates() {
    const voltage = parseFloat(voltageInput.value);
    const capacityAh = parseFloat(capacityInput.value);
    const dodFraction = parseFloat(dodInput.value) / 100;
    const efficiencyFraction = parseFloat(efficiencyInput.value) / 100;
    const inverterRatingWatts = parseFloat(inverterRatingInput.value);
    const targetHours = parseFloat(targetHoursInput.value);

    // Active load calculation
    const isCustom = customLoadToggle.checked;
    const applianceWattsSum = getTotalApplianceWatts();

    let activeWatts = 0;
    if (isCustom) {
      const customVal = parseFloat(customLoadInput.value);
      activeWatts = isNaN(customVal) ? 0 : customVal;
    } else {
      activeWatts = applianceWattsSum;
    }

    // Top Summary Bar Updates
    activeLoadDisplayEl.textContent = `${activeWatts} W`;
    targetDisplayEl.textContent = isNaN(targetHours) ? "--" : `${targetHours.toFixed(1)} hrs`;

    // 1. Run Calculations
    const result = calculateBackupTime({
      voltage,
      capacityAh,
      dodFraction,
      efficiencyFraction,
      loadWatts: activeWatts,
      inverterRatingWatts
    });

    // Reset alert banners
    warningBannerEl.className = "banner banner-warning hidden";
    warningBannerEl.textContent = "";
    statusBannerEl.className = "banner banner-error hidden";
    statusBannerEl.textContent = "";

    if (!result.isValid) {
      runtimeFormattedEl.textContent = "--";
      runtimeDecimalEl.textContent = "(Invalid details)";

      statusBannerEl.textContent = result.errors.join(" ");
      statusBannerEl.classList.remove("hidden");

      plannerResultBoxEl.innerHTML = `
        <div class="plan-box warning">
          <strong>Cannot generate plan:</strong> ${result.errors[0]}
        </div>
      `;

      // Update real-data visual indicators and dashboard metrics for invalid/zero state
      updateDashboardVisuals({
        result,
        activeWatts,
        inverterRatingWatts,
        targetHours,
        voltage,
        capacityAh
      });

      // Clear AI advisor calculation cache so it doesn't advise on invalid state
      currentCalcState = {
        result,
        plan: null,
        activeWatts,
        targetHours
      };

      updateRecharge();
      return;
    }

    // Display valid runtime
    runtimeFormattedEl.textContent = result.runtimeFormatted;
    runtimeDecimalEl.textContent = `(~${result.runtimeHours.toFixed(2)} hours)`;

    // Check inverter overload
    if (result.warnings.length > 0) {
      warningBannerEl.textContent = result.warnings.join(" ");
      warningBannerEl.classList.remove("hidden");
    }

    // 2. Generate Easy-to-Understand Backup Plan
    const plan = planSmartLoadReduction({
      currentLoad: activeWatts,
      targetHours,
      acEnergyWh: result.acEnergyWh,
      inverterRatingWatts,
      appliances: isCustom ? [] : appliancesState
    });

    renderEasyBackupPlan(result, plan, targetHours, activeWatts);

    // Update real-data visual indicators and dashboard KPIs
    updateDashboardVisuals({
      result,
      activeWatts,
      inverterRatingWatts,
      targetHours,
      voltage,
      capacityAh
    });

    // Save active state for AI advisor
    currentCalcState = {
      result,
      plan,
      activeWatts,
      targetHours
    };

    // Keep recharge planner in sync when load or battery bank changes
    updateRecharge();
  }

  // Update real-data visual indicators and dashboard metrics
  function updateDashboardVisuals({ result, activeWatts, inverterRatingWatts, targetHours, voltage, capacityAh }) {
    // 1. Inverter Headroom & Nav Pill
    const navInverterEl = document.getElementById("nav-inverter-limit");
    if (navInverterEl && !isNaN(inverterRatingWatts)) {
      navInverterEl.textContent = `${inverterRatingWatts} W`;
    }

    // 2. KPI 1: Load % tag
    const kpiLoadPercentEl = document.getElementById("kpi-load-percent");
    if (kpiLoadPercentEl) {
      if (inverterRatingWatts > 0) {
        const pct = ((activeWatts / inverterRatingWatts) * 100).toFixed(1);
        kpiLoadPercentEl.textContent = `${pct}% of Limit`;
        kpiLoadPercentEl.style.color = activeWatts > inverterRatingWatts ? "var(--danger-red)" : "inherit";
      } else {
        kpiLoadPercentEl.textContent = "--";
      }
    }

    // 3. KPI 3: Target difference
    const kpiTargetDiffEl = document.getElementById("kpi-target-diff");
    if (kpiTargetDiffEl) {
      if (result.isValid && !isNaN(targetHours) && targetHours > 0) {
        const diff = result.runtimeHours - targetHours;
        if (diff >= 0) {
          kpiTargetDiffEl.textContent = `+${diff.toFixed(1)}h Surplus`;
          kpiTargetDiffEl.style.color = "var(--emerald-success)";
        } else {
          kpiTargetDiffEl.textContent = `-${Math.abs(diff).toFixed(1)}h Deficit`;
          kpiTargetDiffEl.style.color = "var(--solar-amber-dark)";
        }
      } else {
        kpiTargetDiffEl.textContent = "Target Goal";
        kpiTargetDiffEl.style.color = "inherit";
      }
    }

    // 4. KPI 4: Battery Bank specs & usable energy
    const kpiBatterySpecsEl = document.getElementById("kpi-battery-specs");
    const kpiBatteryTypeTagEl = document.getElementById("kpi-battery-type-tag");
    const kpiUsableEnergyEl = document.getElementById("kpi-usable-energy");

    if (kpiBatterySpecsEl) {
      const v = isNaN(voltage) ? "?" : voltage;
      const ah = isNaN(capacityAh) ? "?" : capacityAh;
      kpiBatterySpecsEl.textContent = `${v}V ${ah}Ah`;
    }
    if (kpiBatteryTypeTagEl) {
      kpiBatteryTypeTagEl.textContent = batteryTypeSelect.value === "lead-acid" ? "Tubular / Lead-Acid" : "Lithium LiFePO4";
    }
    if (kpiUsableEnergyEl) {
      if (result.isValid) {
        kpiUsableEnergyEl.textContent = `~${Math.round(result.acEnergyWh).toLocaleString()} Wh usable AC energy`;
      } else {
        kpiUsableEnergyEl.textContent = "--";
      }
    }

    // 5. Visual Inverter Capacity Gauge
    const meterInverterFill = document.getElementById("meter-inverter-fill");
    const meterInverterVal = document.getElementById("meter-inverter-val");
    const meterInverterHeadroom = document.getElementById("meter-inverter-headroom");

    if (meterInverterFill && meterInverterVal) {
      const pct = inverterRatingWatts > 0 ? (activeWatts / inverterRatingWatts) * 100 : 0;
      meterInverterFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;

      if (activeWatts > inverterRatingWatts) {
        meterInverterFill.className = "meter-fill meter-red";
        meterInverterVal.textContent = `OVERLOAD: ${activeWatts} W / ${inverterRatingWatts} W (${Math.round(pct)}%)`;
        meterInverterVal.style.color = "var(--danger-red)";
      } else if (pct >= 80) {
        meterInverterFill.className = "meter-fill meter-amber";
        meterInverterVal.textContent = `${activeWatts} W / ${inverterRatingWatts} W (${Math.round(pct)}%)`;
        meterInverterVal.style.color = "var(--solar-amber-dark)";
      } else {
        meterInverterFill.className = "meter-fill meter-teal";
        meterInverterVal.textContent = `${activeWatts} W / ${inverterRatingWatts} W (${Math.round(pct)}%)`;
        meterInverterVal.style.color = "inherit";
      }

      if (meterInverterHeadroom) {
        if (activeWatts > inverterRatingWatts) {
          meterInverterHeadroom.textContent = `Exceeded limit by ${activeWatts - inverterRatingWatts} W!`;
          meterInverterHeadroom.style.color = "var(--danger-red)";
        } else {
          meterInverterHeadroom.textContent = `Headroom: ${inverterRatingWatts - activeWatts} W remaining`;
          meterInverterHeadroom.style.color = "inherit";
        }
      }
    }

    // 6. Visual Runtime vs Target Goal Progress
    const meterRuntimeFill = document.getElementById("meter-runtime-fill");
    const meterRuntimeVal = document.getElementById("meter-runtime-val");
    const meterRuntimeStatus = document.getElementById("meter-runtime-status");

    if (meterRuntimeFill && meterRuntimeVal) {
      if (result.isValid && !isNaN(targetHours) && targetHours > 0) {
        const pct = (result.runtimeHours / targetHours) * 100;
        meterRuntimeFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
        meterRuntimeVal.textContent = `${result.runtimeHours.toFixed(1)}h / ${targetHours.toFixed(1)}h (${Math.round(pct)}%)`;

        if (result.runtimeHours >= targetHours) {
          meterRuntimeFill.className = "meter-fill meter-teal";
          if (meterRuntimeStatus) {
            meterRuntimeStatus.textContent = `Goal Met (+${(result.runtimeHours - targetHours).toFixed(1)}h surplus)`;
            meterRuntimeStatus.style.color = "var(--emerald-success)";
          }
        } else {
          meterRuntimeFill.className = "meter-fill meter-amber";
          if (meterRuntimeStatus) {
            meterRuntimeStatus.textContent = `Deficit: ${(targetHours - result.runtimeHours).toFixed(1)}h short`;
            meterRuntimeStatus.style.color = "var(--solar-amber-dark)";
          }
        }
      } else {
        meterRuntimeFill.style.width = "0%";
        meterRuntimeVal.textContent = "--";
        if (meterRuntimeStatus) meterRuntimeStatus.textContent = "--";
      }
    }

    // 7. Visual Category Load Breakdown
    const catSummaryEl = document.getElementById("category-breakdown-summary");
    if (catSummaryEl) {
      catSummaryEl.textContent = `Total: ${activeWatts} Watts`;
    }

    const catWattsMap = {
      "Basic Essentials": 0,
      "Cooling": 0,
      "Home and Kitchen": 0,
      "Work and Other Devices": 0
    };

    if (!customLoadToggle.checked) {
      appliancesState.forEach(a => {
        if (catWattsMap.hasOwnProperty(a.category)) {
          catWattsMap[a.category] += (a.qty * a.watts);
        }
      });
    } else {
      catWattsMap["Basic Essentials"] = activeWatts;
    }

    const totalW = activeWatts > 0 ? activeWatts : 1;
    const segEssentials = document.getElementById("seg-essentials");
    const segCooling = document.getElementById("seg-cooling");
    const segKitchen = document.getElementById("seg-kitchen");
    const segWork = document.getElementById("seg-work");

    if (segEssentials && segCooling && segKitchen && segWork) {
      if (activeWatts > 0) {
        segEssentials.style.width = `${(catWattsMap["Basic Essentials"] / totalW) * 100}%`;
        segCooling.style.width = `${(catWattsMap["Cooling"] / totalW) * 100}%`;
        segKitchen.style.width = `${(catWattsMap["Home and Kitchen"] / totalW) * 100}%`;
        segWork.style.width = `${(catWattsMap["Work and Other Devices"] / totalW) * 100}%`;
      } else {
        segEssentials.style.width = "0%";
        segCooling.style.width = "0%";
        segKitchen.style.width = "0%";
        segWork.style.width = "0%";
      }
    }

    const legEssentials = document.getElementById("leg-essentials-val");
    const legCooling = document.getElementById("leg-cooling-val");
    const legKitchen = document.getElementById("leg-kitchen-val");
    const legWork = document.getElementById("leg-work-val");

    if (legEssentials) legEssentials.textContent = `${catWattsMap["Basic Essentials"]} W`;
    if (legCooling) legCooling.textContent = `${catWattsMap["Cooling"]} W`;
    if (legKitchen) legKitchen.textContent = `${catWattsMap["Home and Kitchen"]} W`;
    if (legWork) legWork.textContent = `${catWattsMap["Work and Other Devices"]} W`;
  }

  // Render Step 3 User-Friendly Plan
  function renderEasyBackupPlan(result, plan, targetHours, currentLoad) {
    if (plan.status === "invalid") {
      plannerResultBoxEl.innerHTML = `
        <div class="plan-box warning">${plan.message}</div>
      `;
      return;
    }

    // Target already met
    if (plan.status === "target-met") {
      plannerResultBoxEl.innerHTML = `
        <div class="plan-box success">
          <div class="plan-headline">🎉 Your battery may last about ${result.runtimeFormatted} (~${result.runtimeHours} hours).</div>
          <p>${plan.message}</p>
        </div>
        <div class="plan-stats-grid">
          <div class="stat-item">
            <span class="stat-label">Current power in use</span>
            <span class="stat-val">${currentLoad} W</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Usable battery energy</span>
            <span class="stat-val">${result.acEnergyWh.toFixed(0)} Wh</span>
          </div>
        </div>
      `;
      return;
    }

    // Custom load notice
    if (plan.status === "custom-load-info") {
      plannerResultBoxEl.innerHTML = `
        <div class="plan-box info">
          <div class="plan-headline">Your battery may last about ${result.runtimeFormatted} (~${result.runtimeHours} hours).</div>
          <p>${plan.message}</p>
        </div>
      `;
      return;
    }

    // Recommendations available
    if (plan.recommendations && plan.recommendations.length > 0) {
      const recItemsHtml = plan.recommendations
        .map(r => `
          <li class="rec-item">
            <span>Switch off <strong>${r.unitsShed}x ${r.name}</strong></span>
            <span class="rec-save">Saves ${r.totalSavedWatts} W</span>
          </li>
        `).join("");

      if (plan.targetReached) {
        plannerResultBoxEl.innerHTML = `
          <div class="plan-headline">Your battery may last about ${result.runtimeFormatted} (~${result.runtimeHours} hours).</div>
          <div class="plan-box info">
            <strong>To make it last longer (reach your ${targetHours.toFixed(1)}-hour target):</strong>
            <div class="plan-rec-title">Switch off these appliances first:</div>
            <ul class="rec-list">${recItemsHtml}</ul>
          </div>
          <div class="plan-stats-grid">
            <div class="stat-item">
              <span class="stat-label">New power after changes</span>
              <span class="stat-val">${plan.newLoadWatts} W (Reduced by ${plan.totalWattsSaved} W)</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">New estimated backup time</span>
              <span class="stat-val" style="color: var(--accent-primary);">${plan.newRuntimeFormatted} (~${plan.newRuntimeHours} hours)</span>
            </div>
          </div>
        `;
      } else {
        // Target cannot be fully reached with optional appliances
        plannerResultBoxEl.innerHTML = `
          <div class="plan-headline">Your battery may last about ${result.runtimeFormatted} (~${result.runtimeHours} hours).</div>
          <div class="plan-box warning">
            <strong>⚠️ Your requested backup time may not be achievable with your current battery and appliances:</strong>
            <p style="margin-top: 0.35rem; font-size: 0.85rem;">
              Even after switching off all optional appliances, your essential appliances require ${plan.newLoadWatts} W (maximum allowed load for ${targetHours.toFixed(1)} hours is ${plan.targetMaxLoad} W).
            </p>
            <div class="plan-rec-title">To get the maximum possible backup, switch off these appliances first:</div>
            <ul class="rec-list">${recItemsHtml}</ul>
          </div>
          <div class="plan-stats-grid">
            <div class="stat-item">
              <span class="stat-label">Best reduced power</span>
              <span class="stat-val">${plan.newLoadWatts} W</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Extended backup time achievable</span>
              <span class="stat-val">${plan.newRuntimeFormatted} (~${plan.newRuntimeHours} hours)</span>
            </div>
          </div>
        `;
      }
    } else {
      plannerResultBoxEl.innerHTML = `
        <div class="plan-headline">Your battery may last about ${result.runtimeFormatted} (~${result.runtimeHours} hours).</div>
        <div class="plan-box warning">
          <strong>⚠️ All active appliances are marked as "Keep Running":</strong>
          <p style="margin-top: 0.35rem; font-size: 0.85rem;">
            To extend backup time toward ${targetHours.toFixed(1)} hours, uncheck "Keep Running" on some appliances or reduce appliance count.
          </p>
        </div>
      `;
    }
  }

  // Active state cache
  let currentCalcState = null;
  let isAiRequestPending = false;

  const btnGenerateAi = document.getElementById("btn-generate-ai");
  const aiAdvisorOutput = document.getElementById("ai-advisor-output");

  if (btnGenerateAi && aiAdvisorOutput) {
    btnGenerateAi.addEventListener("click", () => {
      triggerAiAdvisor();
    });
  }

  // Safe, robust line-based formatting of AI advice
  function formatAiAdviceHtml(text) {
    if (!text || typeof text !== "string") return "";

    const escapeHtml = (str) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const formatInline = (str) => {
      const escaped = escapeHtml(str);
      return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    };

    const lines = text.split(/\r?\n/);
    const htmlBlocks = [];
    let currentList = [];

    const flushList = () => {
      if (currentList.length > 0) {
        htmlBlocks.push(`<ul class="ai-list">${currentList.join("")}</ul>`);
        currentList = [];
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i].trim();

      if (!rawLine) {
        flushList();
        continue;
      }

      // Detect section headings like "### 1. YOUR CURRENT SITUATION" or "1. YOUR CURRENT SITUATION"
      if (/^(?:#{1,4}\s+|\d+\.\s+)[A-Z\s]{4,}/.test(rawLine) || rawLine.startsWith("###") || rawLine.startsWith("##")) {
        flushList();
        const cleanTitle = rawLine.replace(/^#+\s*/, "");
        htmlBlocks.push(`<h4 class="ai-section-heading">${formatInline(cleanTitle)}</h4>`);
        continue;
      }

      // Detect bullet points
      const bulletMatch = rawLine.match(/^[-*•]\s+(.+)$/);
      if (bulletMatch) {
        currentList.push(`<li>${formatInline(bulletMatch[1])}</li>`);
        continue;
      }

      // Regular paragraph line
      flushList();
      htmlBlocks.push(`<p class="ai-paragraph">${formatInline(rawLine)}</p>`);
    }

    flushList();
    return htmlBlocks.join("");
  }

  async function triggerAiAdvisor() {
    if (isAiRequestPending) return;

    if (!currentCalcState || !currentCalcState.result || !currentCalcState.result.isValid) {
      aiAdvisorOutput.classList.remove("hidden");
      aiAdvisorOutput.innerHTML = `
        <div class="ai-error-box">
          <strong>Cannot Generate AI Plan:</strong> Please enter valid battery details and select at least one active appliance first.
        </div>
      `;
      return;
    }

    isAiRequestPending = true;
    btnGenerateAi.disabled = true;
    btnGenerateAi.innerHTML = `⏳ Generating AI Power Plan...`;

    aiAdvisorOutput.classList.remove("hidden");
    aiAdvisorOutput.innerHTML = `
      <div class="ai-loading-box">
        <div class="ai-spinner"></div>
        <div>
          <strong>Generating Your AI Power Plan...</strong>
          <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 0.15rem;">Analyzing your active household appliances and load-shedding target...</div>
        </div>
      </div>
    `;

    const payload = {
      battery: {
        voltage: parseFloat(voltageInput.value),
        capacityAh: parseFloat(capacityInput.value),
        type: batteryTypeSelect.value === "lead-acid" ? "Tubular / Lead-Acid" : "Lithium LiFePO4",
        dodPercent: parseFloat(dodInput.value),
        efficiencyPercent: parseFloat(efficiencyInput.value),
        inverterRatingWatts: parseFloat(inverterRatingInput.value),
        acEnergyWh: currentCalcState.result.acEnergyWh
      },
      loadWatts: currentCalcState.activeWatts,
      runtimeHours: currentCalcState.result.runtimeHours,
      runtimeFormatted: currentCalcState.result.runtimeFormatted,
      targetHours: currentCalcState.targetHours,
      appliances: customLoadToggle.checked
        ? []
        : appliancesState.filter(a => a.qty > 0).map(a => ({
            name: a.name,
            watts: a.watts,
            qty: a.qty,
            isEssential: a.isEssential
          })),
      plan: currentCalcState.plan
    };

    try {
      let response;
      try {
        response = await fetch("/api/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (networkErr) {
        console.error("AI Advisor Network Error:", networkErr);
        throw {
          userMessage: "Unable to connect to the advisor service. Please check your internet connection or verify the server is running.",
          technicalDetails: networkErr.message || String(networkErr)
        };
      }

      let data = null;
      const rawText = await response.text();
      try {
        data = JSON.parse(rawText);
      } catch (jsonErr) {
        console.error("AI Advisor Malformed JSON Response:", jsonErr, rawText);
        throw {
          userMessage: "The server returned an invalid or unreadable response. Please try again shortly.",
          technicalDetails: `HTTP ${response.status}: Failed to parse JSON response. Response starts with: "${rawText.substring(0, 80)}"`
        };
      }

      if (!response.ok) {
        const serverMsg = data && data.error ? data.error : `Server returned HTTP status ${response.status}.`;
        console.error("AI Advisor Server Error:", response.status, serverMsg);
        throw {
          userMessage: serverMsg,
          technicalDetails: `HTTP ${response.status}: ${serverMsg}`
        };
      }

      if (!data || !data.advice) {
        throw {
          userMessage: "No advice text was returned by the advisor service.",
          technicalDetails: "Response body was missing the 'advice' property."
        };
      }

      if (data.finishReason === "MAX_TOKENS") {
        throw {
          userMessage: "The AI power plan was interrupted before completion. Please click Try Again.",
          technicalDetails: "Gemini generation stopped with finishReason: MAX_TOKENS."
        };
      }

      aiAdvisorOutput.innerHTML = `
        <div class="ai-advice-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.4rem;">
            <strong style="color: #60a5fa; font-size: 0.95rem;">💡 Your AI Power Plan</strong>
            <span style="font-size: 0.75rem; color: #94a3b8;">Grounded in live calculations</span>
          </div>
          ${formatAiAdviceHtml(data.advice)}
        </div>
      `;
    } catch (err) {
      const displayMessage = err.userMessage || err.message || "An unexpected error occurred while generating your AI plan.";
      const techDetails = err.technicalDetails || err.stack || String(err);

      aiAdvisorOutput.innerHTML = `
        <div class="ai-error-box">
          <strong>⚠️ AI Advisor Notice:</strong>
          <div style="margin-top: 0.25rem;">${displayMessage}</div>
          ${techDetails ? `
            <details style="margin-top: 0.5rem; font-size: 0.75rem; opacity: 0.85;">
              <summary style="cursor: pointer; text-decoration: underline;">Technical diagnostics</summary>
              <pre style="margin-top: 0.35rem; font-size: 0.72rem; white-space: pre-wrap; word-break: break-all; background: rgba(0,0,0,0.05); padding: 0.35rem; border-radius: 4px;">${techDetails}</pre>
            </details>
          ` : ""}
          <button type="button" class="ai-retry-btn" id="btn-retry-ai">Try Again</button>
        </div>
      `;

      const retryBtn = document.getElementById("btn-retry-ai");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => {
          triggerAiAdvisor();
        });
      }
    } finally {
      isAiRequestPending = false;
      btnGenerateAi.disabled = false;
      btnGenerateAi.innerHTML = `✨ Generate AI Power Plan`;
    }
  }

  // Listen to changes on battery & step 1 controls
  const batteryInputs = [
    voltageInput,
    capacityInput,
    dodInput,
    efficiencyInput,
    inverterRatingInput,
    targetHoursInput,
    customLoadInput
  ];

  batteryInputs.forEach(input => {
    input.addEventListener("input", updateEstimates);
  });

  // Initial catalog render and estimate calculation
  renderApplianceCatalog();
  updateEstimates();

  // ─────────────────────────────────────────────
  // BATTERY RECHARGE PLANNER
  // ─────────────────────────────────────────────

  /** Returns the currently selected charging method ("grid" or "solar"). */
  function getChargeMethod() {
    const checked = document.querySelector('input[name="charge-method"]:checked');
    return checked ? checked.value : "grid";
  }

  /** Show/hide the correct method panel and recalculate. */
  function onChargeMethodChange() {
    const method = getChargeMethod();
    if (method === "grid") {
      gridInputsPanel.classList.remove("hidden");
      solarInputsPanel.classList.add("hidden");
    } else {
      gridInputsPanel.classList.add("hidden");
      solarInputsPanel.classList.remove("hidden");
    }
    updateRecharge();
  }

  /** Format decimal hours into "Xh YYm" string. */
  function formatHours(h) {
    const totalMin = Math.round(h * 60);
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return `${hrs}h ${mins.toString().padStart(2, "0")}m`;
  }

  /** Master recharge calculation and DOM update. */
  function updateRecharge() {
    // Read battery bank parameters from the main calculator inputs
    const bankVoltage  = parseFloat(voltageInput.value);
    const bankAh       = parseFloat(capacityInput.value);

    // Update the bank summary text in the disclaimer
    if (rechargeBankSummary) {
      const vLabel = isNaN(bankVoltage) ? "?" : bankVoltage;
      const ahLabel = isNaN(bankAh) ? "?" : bankAh;
      rechargeBankSummary.textContent = `${vLabel}V ${ahLabel}Ah`;
    }

    // Read SOC values
    const currentSoc = parseFloat(rechargeCurrentSocInput.value);
    const targetSoc  = parseFloat(rechargeTargetSocInput.value);
    const method     = getChargeMethod();

    // ── Validation ──────────────────────────────
    const errors = [];
    if (isNaN(bankVoltage) || bankVoltage <= 0) errors.push("Battery voltage is not set. Configure it in Step 1.");
    if (isNaN(bankAh)      || bankAh      <= 0) errors.push("Battery capacity is not set. Configure it in Step 1.");
    if (isNaN(currentSoc)  || currentSoc  <  0 || currentSoc  >= 100) errors.push("Current charge must be between 0% and 99%.");
    if (isNaN(targetSoc)   || targetSoc   <= 0 || targetSoc   > 100)  errors.push("Target charge must be between 1% and 100%.");
    if (!isNaN(currentSoc) && !isNaN(targetSoc) && currentSoc >= targetSoc) {
      errors.push("Target charge must be higher than the current charge level.");
    }

    if (errors.length > 0) {
      showRechargeResult("--", errors.join(" "), "", "error");
      return;
    }

    // Energy needed (Wh) to go from currentSoc to targetSoc
    const socDelta      = (targetSoc - currentSoc) / 100;        // e.g. 0.50
    const energyNeededWh = bankVoltage * bankAh * socDelta;       // nominal Wh

    // ── Grid / UPS Charger ───────────────────────
    if (method === "grid") {
      const chargeCurrent = parseFloat(gridChargeCurrentInput.value);
      if (isNaN(chargeCurrent) || chargeCurrent <= 0) {
        showRechargeResult("--", "Please enter a valid charger current (Amperes).", "", "error");
        return;
      }

      // Charging power = V × I; accounts for ~90% battery electrochemical charging efficiency
      const chargerPowerW  = bankVoltage * chargeCurrent * 0.90;
      const chargeTimeHours = energyNeededWh / chargerPowerW;

      const details = [
        `Energy to restore: <strong>${Math.round(energyNeededWh)} Wh</strong>`,
        `Charger output: <strong>${bankVoltage}V × ${chargeCurrent}A = ${Math.round(bankVoltage * chargeCurrent)} W</strong> (~90% battery charge efficiency: <strong>${Math.round(chargerPowerW)} W effective</strong>)`,
        `SOC change: <strong>${currentSoc}% → ${targetSoc}% (+${Math.round(socDelta * 100)}%)</strong>`,
        `Assumes constant-current phase only. Actual time is longer due to absorption/float stage above ~85% SOC.`
      ].join("<br>");

      const warning = targetSoc > 85
        ? "⚠️ Charging to above 85% enters the slow absorption stage. Actual time to reach 100% may be 20–40% longer."
        : "";

      showRechargeResult(
        formatHours(chargeTimeHours),
        `(~${chargeTimeHours.toFixed(2)} hours, constant-current phase estimate)`,
        details,
        "ok",
        warning
      );
      return;
    }

    // ── Solar Panels ─────────────────────────────
    const solarWatts      = parseFloat(solarTotalWattsInput.value);
    const conditionFactor = parseFloat(solarConditionSelect.value);
    const deductLoad      = solarDeductLoadCheckbox.checked;

    if (isNaN(solarWatts) || solarWatts <= 0) {
      showRechargeResult("--", "Please enter a valid total solar panel rating (Watts).", "", "error");
      return;
    }
    if (isNaN(conditionFactor)) {
      showRechargeResult("--", "Please select a sunlight condition.", "", "error");
      return;
    }

    const effectiveSolarW    = solarWatts * conditionFactor;         // W available from panels
    const currentLoadW       = deductLoad ? getTotalApplianceWatts() : 0;
    const netChargingW       = effectiveSolarW - currentLoadW;       // W actually going to battery

    if (netChargingW <= 0) {
      const shortfall = Math.round(currentLoadW - effectiveSolarW);
      showRechargeResult(
        "Not enough solar",
        `Your solar panels produce ~${Math.round(effectiveSolarW)} W under current conditions, but your active appliances use ${currentLoadW} W — leaving nothing to charge the battery (${shortfall} W shortfall). Turn off appliances or uncheck the load-deduction option to estimate panel-only charging.`,
        "",
        "error"
      );
      return;
    }

    // Account for typical MPPT/PWM controller + battery charging efficiency (~85%)
    const netChargingWEff  = netChargingW * 0.85;
    const chargeTimeHours  = energyNeededWh / netChargingWEff;

    const conditionLabels = { "0.8": "Strong Sun", "0.5": "Moderate / Hazy", "0.25": "Overcast / Low" };
    const condLabel = conditionLabels[String(conditionFactor)] || `${Math.round(conditionFactor * 100)}%`;

    const details = [
      `Energy to restore: <strong>${Math.round(energyNeededWh)} Wh</strong>`,
      `Solar output (${condLabel}): <strong>${Math.round(solarWatts)} W × ${Math.round(conditionFactor * 100)}% = ${Math.round(effectiveSolarW)} W</strong>`,
      deductLoad
        ? `Minus active appliance load: <strong>−${currentLoadW} W</strong>`
        : `Active load not deducted (charging panel assumed dedicated).`,
      `Net to battery (85% controller efficiency): <strong>${Math.round(netChargingWEff)} W</strong>`,
      `SOC change: <strong>${currentSoc}% → ${targetSoc}% (+${Math.round(socDelta * 100)}%)</strong>`,
      `Solar times are in equivalent peak-sun hours — actual calendar time depends on daily sun availability.`
    ].join("<br>");

    const warning = targetSoc > 85
      ? "⚠️ Charging to above 85% enters the slow absorption stage. Actual time may be noticeably longer."
      : "";

    showRechargeResult(
      formatHours(chargeTimeHours),
      `(~${chargeTimeHours.toFixed(2)} peak-sun hours)`,
      details,
      "ok",
      warning
    );
  }

  /**
   * Update all recharge result DOM elements.
   * @param {string} timeText   - Primary display (e.g. "3h 20m" or "Not enough solar")
   * @param {string} subText    - Secondary line below time
   * @param {string} detailsHtml - Inner HTML for the details box (empty to hide)
   * @param {"ok"|"error"} status
   * @param {string} [warningText] - Optional amber warning text
   */
  function showRechargeResult(timeText, subText, detailsHtml, status, warningText = "") {
    rechargeTimeDisplay.textContent = timeText;
    rechargeTimeSubtext.textContent = subText;

    // Colour the time display
    rechargeTimeDisplay.style.color = status === "error" ? "var(--accent-danger, #f87171)" : "var(--accent-primary, #10b981)";

    // Details box
    if (detailsHtml) {
      rechargeDetailsBox.innerHTML = detailsHtml;
      rechargeDetailsBox.style.display = "";
    } else {
      rechargeDetailsBox.innerHTML = "";
      rechargeDetailsBox.style.display = "none";
    }

    // Warning box
    if (warningText) {
      rechargeWarningBox.textContent = warningText;
      rechargeWarningBox.classList.remove("hidden");
    } else {
      rechargeWarningBox.textContent = "";
      rechargeWarningBox.classList.add("hidden");
    }
  }

  // Wire up all recharge-planner inputs
  document.querySelectorAll('input[name="charge-method"]').forEach(radio => {
    radio.addEventListener("change", onChargeMethodChange);
  });

  [rechargeCurrentSocInput, rechargeTargetSocInput,
   gridChargeCurrentInput, solarTotalWattsInput, solarConditionSelect,
   solarDeductLoadCheckbox].forEach(el => {
    if (el) el.addEventListener("change", updateRecharge);
    if (el && el.type === "number") el.addEventListener("input", updateRecharge);
  });

  // Recharge result should also refresh when battery bank changes
  [voltageInput, capacityInput].forEach(el => {
    el.addEventListener("input", updateRecharge);
  });

  // Run once on load to show initial result and correct panel visibility
  onChargeMethodChange();
});
