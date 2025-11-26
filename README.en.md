# Border Control Intelligence System [BCIS-V15]

![English](https://img.shields.io/badge/lang-en-blue.svg)
[![中文](https://img.shields.io/badge/lang-zh-yellow.svg)](README.md)
[![日本語](https://img.shields.io/badge/lang-ja-green.svg)](README.ja.md)
[![한국어](https://img.shields.io/badge/lang-ko-red.svg)](README.ko.md)



## 1. Project Overview
**BCIS (Border Control Intelligence System)** is an **offline verification toolkit** that runs entirely in the browser (zero network requests) for rapid parsing, validation, and assessment of Machine Readable Zone (MRZ) data from international travel documents.

Beyond standard ICAO 9303 compliance, the system is deeply optimized for **Chinese passports**, **Hong Kong/Macau/Taiwan travel permits**, and identity documents from 20+ major countries worldwide. It can extract administrative codes and sensitive personal information hidden in "optional data fields" and provides automated risk assessment.

---

## 2. Core Features

### 🛡️ 100% Offline Security Architecture
*   **Pure Frontend Execution**: Built with React + TypeScript, no backend services, no data uploads.
*   **Data Sovereignty**: All sensitive data remains in browser memory only, cleared on refresh, fully compliant with air-gapped deployment requirements.

### 🌏 Global Document Standards Support
*   **TD3 (Passports)**: Standard 2 lines × 44 characters (e.g., passports, MRV-A visas).
*   **TD2 (Legacy IDs/Visas)**: Standard 2 lines × 36 characters (e.g., German legacy IDs, MRV-B visas).
*   **TD1 (Card Documents)**: Standard 3 lines × 30 characters (e.g., EU/US card-format documents).
*   **CN_CARD (Chinese Documents)**: Proprietary single-line 30-character format (e.g., Hong Kong/Macau/Taiwan travel permits).

### 🔍 Deep Data Mining & Intelligence Assessment
The system incorporates country-specific "reverse engineering" logic to extract hidden information from MRZ optional fields:
*   **🇨🇳 China (CHN)**:
    *   **GBK Hidden Name Parsing**: Recovers Chinese names from encrypted fields in e-passports.
    *   **Pinyin Cross-Verification**: Auto-compares MRZ pinyin against Chinese names, detecting forged truncation markers (anti-tampering logic).
*   **🇩🇪 Germany (DEU)**: Parses administrative district codes and serial number logic from ID cards.
*   **🇪🇸 Spain (ESP)**: Extracts DNI identity card numbers.
*   **🇵🇱 Poland (POL)**: Extracts PESEL citizen identification numbers.
*   **🇳🇱 Netherlands (NLD)**: Extracts BSN citizen service numbers.
*   **Plus**: Custom logic for France, Belgium, Switzerland, Romania, Bulgaria, Ukraine, Russia, Nordic countries, Israel, and 20+ other regions.

### ⚠️ Automated Risk Assessment
The system automatically calculates and flags the following risks:
*   **Data Integrity**: Full-field Modulus-10 check digit verification.
*   **Document Status**: Expiration alerts and near-expiry warnings.
*   **Logic Vulnerabilities**: Detects common forgery errors (e.g., truncation markers inconsistent with remaining space, insufficient vowels to form claimed Chinese characters).

### 💻 Visual Interface
*   **Terminal-Style View**: Color-coded highlighting of raw MRZ data (issuing country, name, document number, check digits).
*   **Bilingual Support**: One-click language switching (Chinese/English) for international joint law enforcement scenarios.

---

## 3. Technology Stack
*   **Core Framework**: React 19
*   **Language**: TypeScript (strict type safety)
*   **Styling**: Tailwind CSS (responsive industrial design)
*   **Auxiliary Libraries**: `pinyin-pro` (for high-precision Chinese name pinyin comparison)

---

## 4. Deployment & Usage

### System Requirements
*   Modern browser (Chrome, Edge, Firefox).
*   No internet connection required.

### Operation Guide
1.  **Input Data**: In the main interface input box, enter the document's MRZ code via scanner or manually (auto-removes spaces and line breaks).
2.  **Execute Verification**: Click "Execute Verification" button or press Enter.
3.  **View Report**:
    *   **Status Bar**: Displays verification results, validity status, and risk level.
    *   **Identity Information**: Shows parsed name, gender, date of birth, etc. For Chinese passports, attempts to display GBK-decoded Chinese name.
    *   **Technical Parameters**: Shows fine-grained document type (precise to country and format).
    *   **Data Insights**: View underlying check digit calculation logic.

---

## 5. Supported Document Types (Partial List)
The system precisely identifies and classifies the following documents:
*   **Greater China**: PRC ordinary/e-passports, Hong Kong SAR passports, Macau SAR passports, Hong Kong/Macau/Taiwan travel permits.
*   **Americas**: US passports/passport cards, Canadian passports, Brazilian passports.
*   **Europe**: Passports and ID cards from Germany, France, UK, Italy, Spain, Netherlands, Poland, Switzerland, Russia, Ukraine, etc.
*   **Asia-Pacific**: Japan, South Korea, Australia, New Zealand, Singapore, Malaysia, Thailand, India, etc.

---

## 6. Disclaimer
This project is intended for educational or testing environments only. Strictly comply with local laws and data privacy regulations. Not to be used for illegal purposes.

---
*Version 15.0 (Offline Emergency Build)*
