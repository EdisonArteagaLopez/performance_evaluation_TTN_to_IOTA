# Oracle TTN → IOTA  
**End-to-End LoRaWAN Data Notarization over IOTA (Mainnet / Testnet)**

This repository implements a **production-grade oracle** that bridges **LoRaWAN IoT data** from **The Things Network (TTN)** to the **IOTA distributed ledger**, enabling **immutable, auditable, and time-stamped notarization** of sensor data.

The system is designed and evaluated as part of an academic research effort focused on **performance, scalability, and economic viability** of Distributed Ledger Technologies (DLT) for **LPWAN-based IoT networks**, particularly **LoRaWAN**.

---

## 1) Research Context

This oracle was developed to support the experimental evaluation presented in:

> **Performance Evaluation of IOTA Tangle and EVM Blockchain over LoRaWAN IoT Access Networks**  
> Edison A. Arteaga López¹, Gustavo A. Ramírez González¹, Carlos A. Astudillo², Andrea Sabbioni³  
> ¹ University of Cauca (UNICAUCA)  
> ² University of Campinas (UNICAMP)  
> ³ University of Bologna (UNIBO)

The oracle enables:
- End-to-end latency measurement (TTN → Oracle → IOTA)
- Transaction cost analysis (gas usage)
- Long-running experiments (24h+)
- Edge vs centralized deployment comparison (Laptop vs Raspberry Pi)

---

## 2) High-Level Architecture

```
LoRa Node
↓ (LoRaWAN)
Gateway
↓
The Things Network (TTN)
↓ (MQTT)
Oracle (Node.js)
↓ (IOTA SDK / CLI)
IOTA Network (Mainnet or Testnet)
```

**Key design principle:**  
LoRaWAN devices never interact directly with the ledger.  
All cryptographic signing and DLT interaction is handled by the oracle.

---

## 3) Repository Structure

```
oracle-ttn-iota/
├── src/                    # Oracle runtime
│   ├── mainnet-notarize.js # Main oracle loop (MQTT → IOTA)
│   ├── ttn-mainnet-runner.js
│   ├── signer-from-cli.js  # Uses IOTA CLI keystore
│   ├── metrics-logger.js   # CSV + JSONL metrics
│   ├── state-store.js
│   └── perf.js
│
├── tools/                  # Offline utilities
│   ├── make-baseline.js
│   ├── analyze-logs.js
│   ├── plot_metrics.py
│   └── smoke*.js
│
├── logs/                   # Runtime metrics (gitignored except .gitkeep)
│   ├── notarize_metrics.csv
│   └── notarize_events.jsonl
│
├── state/                  # Local oracle state
│   └── notarizations.json
│
├── .env.example
├── .gitignore
├── package.json
└── package-lock.json
```

---

## 4) Requirements

### Software
- Node.js **v20+**
- npm
- Python **3.9+** (for analysis only)
- IOTA CLI

### Hardware (tested)
- Laptop (MAC M2, 16 GB RAM)
- Raspberry Pi 4 (2 GB RAM)
- LoRaWAN gateway (e.g., Dragino LPS8)

---

## 5) Installation

### 5.1 Clone repository

```bash
git clone https://github.com/<your-org>/oracle-ttn-iota.git
cd oracle-ttn-iota
```

### 5.2 Install Node dependencies

```bash
npm install
```

---

## 6) Environment Configuration

Create `.env` from template:

```bash
cp .env.example .env
```

Example `.env`:

```env
# TTN
TTN_MQTT_BROKER=eu1.cloud.thethings.network
TTN_APP_ID=your-app-id
TTN_API_KEY=ttn-api-key

# IOTA
IOTA_NETWORK=mainnet
IOTA_GAS_BUDGET=50000000
IOTA_PACKAGE_ID=0x...
IOTA_MODULE=notarization
IOTA_FUNCTION=create
```

---

## 7) IOTA CLI Setup (Mainnet, Wallet & Address)

The oracle relies on the official IOTA CLI for key management and transaction signing.

---

### 7.1 Install IOTA CLI

**Linux / Raspberry Pi (ARM64):**

```bash
curl -L https://github.com/iotaledger/iota/releases/latest/download/iota-linux-aarch64.tgz \
  | tar -xz
sudo mv iota /usr/local/bin/
```

Verify:

```bash
iota --version
```

---

### 7.2 Initialize client configuration

```bash
iota client init
```

Creates:

```
~/.iota/iota_config/
├── client.yaml
└── iota.keystore
```

---

### 7.3 Switch to mainnet

```bash
iota client list
iota client switch --network mainnet
```

Verify:

```bash
iota client active-network
```

---

### 7.4 Import mnemonic (funded account)

```bash
iota keytool import
```

- Paste 24-word mnemonic  
- Assign local alias  

> ⚠️ Never commit mnemonics or keystores.

---

### 7.5 Select active address

```bash
iota client addresses
iota client switch --address 0xYOUR_ADDRESS
```

Verify:

```bash
iota client active-address
iota client balance
```

---

## 8) Running the Oracle

### 8.1 Manual execution

```bash
node src/mainnet-notarize.js
```

---

### 8.2 Run as systemd service (recommended for 24h experiments)

```bash
sudo cp systemd/performance_evaluation_TTN_to_IOTA.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable performance_evaluation_TTN_to_IOTA
sudo systemctl start performance_evaluation_TTN_to_IOTA
```

Check status:

```bash
sudo systemctl status performance_evaluation_TTN_to_IOTA
```

---

## 9) Metrics and Logs

Generated automatically:
- `logs/notarize_metrics.csv`
- `logs/notarize_events.jsonl`
- `state/notarizations.json`

Metrics include:
- End-to-end latency
- IOTA execution time
- Gas usage (computation / storage)
- CPU, memory, load
- RSSI / SNR
- Success & failure counters

---

## 10) Baseline & Analysis

Run locally (recommended on laptop):

```bash
node tools/analyze-logs.js
node tools/make-baseline.js
python tools/plot_metrics.py
```

Typical outputs:
- Summary CSV tables
- Boxplots (latency)
- Time-series figures (RSS, CPU, memory)

---

## 11) Reproducibility Notes

- Use a dedicated IOTA account
- Keep minimal funds
- Run experiments ≥ 24h
- Store raw logs unchanged
- Perform analysis offline

---

## 12) Security Considerations

- No private keys in code
- CLI keystore only
- Oracle signs locally
- No direct device-to-ledger interaction

---

## 13) License & Disclaimer

This repository is intended for research and experimental use.

No warranty is provided.  
Use mainnet responsibly.

---

## 14) Contact

**Edison A. Arteaga López**  
PhD Candidate – Telematics Engineering  
UNICAUCA / UNICAMP  
📧 edarteaga@unicauca.edu.co
