# PowerUp ⚡

**Know Your Backup. Plan Your Power.**

PowerUp is an AI-powered household energy assistant designed to help Pakistani households make more informed decisions during load-shedding. It estimates battery backup time, helps users prioritize appliances, provides Grid/UPS and solar charging estimates, and uses Google's Gemini API to generate household-specific power advice.

- **Live app:** https://powerup-f17o.onrender.com
- **Source code:** https://github.com/farrukhrahimsandhu/PowerUp

## The Problem

During power outages, households may be unsure how long their battery will last with their current appliances, which devices they should prioritize, or how long recharging may take. PowerUp brings these decisions together in one dashboard.

## Features

### 🔋 Battery Runtime Calculator
- Configure battery voltage and capacity, battery chemistry/depth-of-discharge assumptions, inverter efficiency, and inverter rating.
- Estimate usable energy and backup runtime for the selected household load.
- Display relevant validation and inverter-overload warnings.

### 🏠 Appliance Manager
- Choose from a catalog of 19 household appliances across multiple categories.
- Adjust appliance quantities and wattage.
- Mark appliances as essential or optional.

### ⚡ Smart Load Planner
- Set a target backup duration.
- Get recommendations to turn off optional loads when the current configuration may not meet the target.
- See how changing the selected load affects the estimated runtime.

### ☀️ Recharge Planner
- Estimate charging time using Grid/UPS charger inputs.
- Estimate solar charging time using panel capacity and selected solar conditions.
- Optionally account for the active household load when estimating solar charging surplus.

### 🤖 AI Power Advisor
- Sends the current household configuration to a Node.js backend.
- Uses the Gemini API to produce tailored power-management recommendations.
- Handles common API, malformed-response, and network-error states with user-facing messages.

## How It Works

1. The user enters battery details and selects household appliances.
2. The frontend calculates estimated load, usable battery energy, runtime, and charging estimates using programmed formulas.
3. When requested, the frontend sends the household configuration to the backend's `/api/advisor` endpoint.
4. The Node.js backend calls Gemini and returns AI-generated recommendations to the dashboard.

**Important distinction:** Battery-runtime and charging values come from the application's formulas. Gemini provides contextual advice; it does not measure real-time electricity or battery telemetry.

## Technology Stack

- **Frontend:** HTML, CSS, vanilla JavaScript
- **Backend:** Node.js using built-in server modules
- **AI:** Google Gemini API, accessed through the backend
- **Hosting:** Render
- **Source control:** GitHub

The application does not currently require user accounts, login/signup, or a database.

## Run Locally

### Requirements

- Node.js installed
- A Gemini API key to use the AI Power Advisor

### 1. Clone the repository

```bash
git clone https://github.com/farrukhrahimsandhu/PowerUp.git
cd PowerUp
```

### 2. Configure the environment

Create a local `.env` file from the example.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace the placeholder with your own Gemini API key:

```dotenv
GEMINI_API_KEY=your_actual_key_here
```

Keep `.env` private. It is excluded from Git; do not commit it or share its contents. The `.env.example` file is a template only and should contain no real secret.

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/).

### 3. Start the application

```bash
npm start
```

Alternatively, run `node server.js`.

Open [http://localhost:3000](http://localhost:3000) in your browser. Keep the terminal running while you use the app.

## Deployment

PowerUp is deployed on Render:

**Live URL:** https://powerup-f17o.onrender.com

For a Render Web Service, the key settings are:

- **Branch:** `main`
- **Build command:** `npm install`
- **Start command:** `npm start`
- **Environment variable:** `GEMINI_API_KEY` — configure the actual value in Render's Environment settings, not in source code.

The server uses Render's assigned port when provided and binds to `0.0.0.0` for hosted operation. Free hosting may spin down after inactivity, so the first request after a quiet period can be slower.

## Limitations and Assumptions

- Runtime and recharge outputs are estimates, not guarantees of real-world performance.
- Results depend on the entered battery specifications, battery condition, load, charger, solar conditions, and other real-world factors.
- The solar model uses simplified assumptions for solar conditions, household-load deduction, and charging losses; actual system power flow may differ.
- The app does not currently collect live grid data, real-time battery telemetry, historical consumption, or electricity-bill records.
- There is no database or user account system; the app focuses on calculations and AI advice based on the current configuration.

## Security

- Keep `GEMINI_API_KEY` on the server side.
- Never commit `.env` or expose API keys in screenshots, public issues, or client-side JavaScript.
- Use `.env.example` only as a secret-free configuration template.

## Project Goal

PowerUp aims to help households make more informed decisions about limited backup electricity: estimate how long power may last, prioritize what matters, and plan the next recharge.

---

**PowerUp — Know Your Backup. Plan Your Power.**
