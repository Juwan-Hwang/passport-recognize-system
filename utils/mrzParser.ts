import { MrzResult, Risk } from '../types';
import { pinyin } from 'pinyin-pro';

// --- CONSTANTS & HELPERS ---
const WEIGHTS = [7, 3, 1];

const FIX_NUM: Record<string, string> = { 'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'B': '8' };
const FIX_ALPHA: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B' };

// Normalization map for non-standard or single-letter issuing codes to 3-letter ICAO
const NORMALIZE_ISS: Record<string, string> = {
    'D': 'DEU',
    'F': 'FRA',
    'E': 'ESP',
    'I': 'ITA',
    'A': 'AUT',
    'B': 'BEL',
    'P': 'PRT',
    'N': 'NOR',
    'S': 'SWE',
    'FIN': 'FIN', // Ensure these stay 3 chars if parsed correctly
    'DK': 'DNK',
    'CH': 'CHE',
    'GB': 'GBR',
    'GR': 'GRC',
    'NL': 'NLD'
};

const getCharVal = (c: string): number => {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 65 && code <= 90) return code - 55; // A-Z
  return 0; // < or others
};

const calcCheck = (str: string): number => {
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    sum += getCharVal(str[i]) * WEIGHTS[i % 3];
  }
  return sum % 10;
};

// Permissive Check: Allows '<' to represent 0 if the calculated sum is 0.
const isValidCheck = (calculated: number, actualChar: string): boolean => {
    if (actualChar === '<') return calculated === 0;
    return calculated === parseInt(actualChar);
};

const genLogLine = (label: string, actual: string, calculated: number): string => {
    const ok = isValidCheck(calculated, actual);
    const resText = ok ? "OK" : "FAIL";
    return `> [${label.padEnd(9, ' ')}] Check Digit: ${actual} | Calculated: ${calculated} | Result: ${resText}`;
};

const parseDate = (yymmdd: string, isExpiry: boolean): Date | null => {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = parseInt(yymmdd.substring(2, 4), 10) - 1;
  const dd = parseInt(yymmdd.substring(4, 6), 10);
  const currentYear = new Date().getFullYear();
  let fullYear = (Math.floor(currentYear / 100)) * 100 + yy;
  
  if (isExpiry) {
     fullYear = (yy > 60) ? 1900 + yy : 2000 + yy;
  } else {
     const nowYY = currentYear % 100;
     fullYear = (yy > nowYY) ? 1900 + yy : 2000 + yy;
  }
  const date = new Date(fullYear, mm, dd);
  return isNaN(date.getTime()) ? null : date;
};

const parseGBKName = (optSection: string): { text: string; truncated: number | null; hasFillers: boolean } | null => {
    try {
        if (optSection.length < 13) return null;
        const rawHexSection = optSection.substring(0, 12);
        const hasFillers = rawHexSection.includes('<');
        let s = rawHexSection.replace(/</g, '');
        if (s.length % 2 !== 0) s = s.substring(0, s.length - 1);
        if (s.length === 0) return null;
        const hexArr = [];
        for (const char of s) {
            const val = char.charCodeAt(0) - 65;
            if (val < 0 || val > 15) throw new Error("Invalid hex map");
            hexArr.push(val.toString(16));
        }
        const bytes = new Uint8Array(hexArr.join('').match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || []);
        const text = new TextDecoder('gbk').decode(bytes);
        let truncated: number | null = null;
        const tChar = optSection.charAt(12);
        if (tChar >= 'A' && tChar <= 'Z') truncated = tChar.charCodeAt(0) - 65;
        return { text, truncated, hasFillers };
    } catch (e) { return null; }
};

const cleanName = (str: string) => str.replace(/</g, ' ').trim();

// Helper to normalize country codes (removes filler and maps 1/2 chars to 3 chars)
const normalizeCountry = (code: string): string => {
    let clean = code.replace(/</g, '').trim();
    if (NORMALIZE_ISS[clean]) return NORMALIZE_ISS[clean];
    return clean;
};

// Helper to determine precise document type key
const getDetailedType = (iss: string, typeCode: string, format: string, docNum: string = '') => {
    const cleanIss = normalizeCountry(iss);

    // 1. Visas
    if (typeCode.startsWith('V')) return 'type_visa';

    // 2. Specific Chinese/HK/Macau logic
    if (cleanIss === 'CHN' || cleanIss === 'HKG' || cleanIss === 'MAC' || cleanIss === 'CHN (NIA)') {
        if (typeCode === 'PO') return 'type_chn_po';
        if (typeCode.startsWith('P')) {
            if (cleanIss === 'HKG') return 'type_hkg';
            if (cleanIss === 'MAC') return 'type_mac';
            if (docNum.startsWith('H') || docNum.startsWith('K')) return 'type_hkg';
            if (docNum.startsWith('M') && docNum.length > 8) return 'type_mac'; 
            return 'type_chn_pe'; 
        }
        if (typeCode === 'CS') return 'type_eep_hk';
        if (typeCode === 'CD') return 'type_eep_tw';
    }

    // 3. General Country + Doc Class Pattern
    let docClass = 'p';
    if (format === 'TD1' || format === 'TD2' || format === 'CN_CARD') docClass = 'id';
    if (typeCode.startsWith('I') || typeCode.startsWith('C')) docClass = 'id';
    
    const country = cleanIss.toLowerCase();
    return `type_${country}_${docClass}`;
};

// --- UNIVERSAL PARSER ENGINES ---

export const processMRZ = (rawInput: string, autoFix: boolean): MrzResult => {
  const lines = rawInput.toUpperCase().split('\n').map(l => l.replace(/\s/g, '')).filter(l => l.length > 5);
  let format: MrzResult['format'] = 'UNKNOWN';
  
  // Format Detection
  if (lines.length === 2 && lines[0].length === 44 && lines[1].length === 44) format = 'TD3';
  else if (lines.length === 3 && lines[0].length === 30 && lines[1].length === 30 && lines[2].length === 30) format = 'TD1';
  else if (lines.length === 2 && lines[0].length === 36 && lines[1].length === 36) format = 'TD2';
  else if (lines.length === 1 && lines[0].length === 30) format = 'CN_CARD'; 

  if (format === 'UNKNOWN') {
      return {
          valid: false, format: 'UNKNOWN', type: 'UNKNOWN', rawLines: lines, logs: ['Unrecognized Format'], calcLogs: [], risks: [],
          fields: { documentNumber: null, documentNumberCheck: null, birthDate: null, birthDateCheck: null, expiryDate: null, expiryDateCheck: null, nationality: null, issuingState: null, sex: null, surname: null, givenNames: null, optionalData: null, optionalDataCheck: null, documentTypeRaw: null, detailedType: null, compositeCheck: null },
          validations: { documentNumber: false, birthDate: false, expiryDate: false, optionalData: false, composite: false },
          parsed: { birthDate: null, expiryDate: null, daysRemaining: null, age: null }
      };
  }

  if (format === 'TD3') return parseTD3(lines, autoFix);
  if (format === 'TD2') return parseTD2(lines, autoFix);
  if (format === 'TD1') return parseTD1(lines, autoFix);
  if (format === 'CN_CARD') return parseCard30(lines, autoFix);

  return parseTD3(lines, autoFix);
};

// --- TD3 ENGINE (Passport / MRV-A) ---
const parseTD3 = (lines: string[], autoFix: boolean): MrzResult => {
    let [l1, l2] = lines;
    const logs: string[] = [];
    
    if (autoFix) {
        if (l1.startsWith('P0')) { l1 = 'PO' + l1.substring(2); logs.push('L1 Type [P0 -> PO]'); }
        const l1a = l1.split(''); const l2a = l2.split('');
        for(let i=5; i<44; i++) if(FIX_ALPHA[l1a[i]]) l1a[i] = FIX_ALPHA[l1a[i]];
        [[9,10],[13,20],[21,28],[42,44]].forEach(([s,e]) => { for(let i=s; i<e; i++) if(FIX_NUM[l2a[i]]) l2a[i]=FIX_NUM[l2a[i]]; });
        for(let i=10; i<13; i++) if(FIX_ALPHA[l2a[i]]) l2a[i]=FIX_ALPHA[l2a[i]];
        l1 = l1a.join(''); l2 = l2a.join('');
    }

    const typeCode = l1.substring(0, 2);
    const iss = l1.substring(2, 5);
    const docNum = l2.substring(0, 9); const docNumC = l2[9];
    const nat = l2.substring(10, 13);
    const dob = l2.substring(13, 19); const dobC = l2[19];
    const sex = l2[20];
    const exp = l2.substring(21, 27); const expC = l2[27];
    const opt = l2.substring(28, 42); const optC = l2[42];
    const finalC = l2[43];

    const cDoc = calcCheck(docNum); const vDoc = isValidCheck(cDoc, docNumC);
    const cDob = calcCheck(dob); const vDob = isValidCheck(cDob, dobC);
    const cExp = calcCheck(exp); const vExp = isValidCheck(cExp, expC);
    const cOpt = calcCheck(opt); const vOpt = isValidCheck(cOpt, optC);
    const compStr = l2.substring(0, 10) + l2.substring(13, 20) + l2.substring(21, 43);
    const cFinal = calcCheck(compStr); const vFinal = isValidCheck(cFinal, finalC);

    const calcLogs = [
        genLogLine("DOC_NUM", docNumC, cDoc), genLogLine("DOB", dobC, cDob),
        genLogLine("EXPIRY", expC, cExp), genLogLine("OPT_DATA", optC, cOpt),
        genLogLine("FINAL", finalC, cFinal)
    ];

    const nameRaw = l1.substring(5, 44);
    const [sur, given] = nameRaw.split('<<');
    const detailedType = getDetailedType(iss, typeCode, 'TD3', docNum);

    const result: MrzResult = {
        // FIXED: Added vOpt to the validation chain.
        valid: vDoc && vDob && vExp && vOpt && vFinal, 
        format: typeCode.startsWith('V') ? 'MRV_A' : 'TD3', type: typeCode.startsWith('V') ? 'VISA' : 'PASSPORT',
        rawLines: [l1, l2],
        fields: {
            documentNumber: docNum, documentNumberCheck: docNumC, 
            nationality: normalizeCountry(nat), 
            birthDate: dob, birthDateCheck: dobC, sex,
            expiryDate: exp, expiryDateCheck: expC, optionalData: opt, optionalDataCheck: optC,
            documentTypeRaw: typeCode, detailedType, 
            issuingState: normalizeCountry(iss),
            surname: cleanName(sur), givenNames: cleanName(given || ''),
            compositeCheck: finalC
        },
        validations: { documentNumber: vDoc, birthDate: vDob, expiryDate: vExp, optionalData: vOpt, composite: vFinal },
        parsed: { birthDate: parseDate(dob, false), expiryDate: parseDate(exp, true), daysRemaining: null, age: null },
        logs, calcLogs, risks: []
    };

    calculateDates(result);
    enrichUniversalData(result, iss, opt);
    return result;
};

// --- TD2 ENGINE (ID Card / MRV-B) ---
const parseTD2 = (lines: string[], autoFix: boolean): MrzResult => {
    let [l1, l2] = lines;
    const logs: string[] = [];

    const typeCode = l1.substring(0, 2);
    const iss = l1.substring(2, 5);
    const nameRaw = l1.substring(5, 36);
    const [sur, given] = nameRaw.split('<<');

    const docNum = l2.substring(0, 9); const docNumC = l2[9];
    const nat = l2.substring(10, 13);
    const dob = l2.substring(13, 19); const dobC = l2[19];
    const sex = l2[20];
    const exp = l2.substring(21, 27); const expC = l2[27];
    const opt = l2.substring(28, 35);
    const finalC = l2[35];

    const cDoc = calcCheck(docNum); const vDoc = isValidCheck(cDoc, docNumC);
    const cDob = calcCheck(dob); const vDob = isValidCheck(cDob, dobC);
    const cExp = calcCheck(exp); const vExp = isValidCheck(cExp, expC);
    const compStr = l2.substring(0, 10) + l2.substring(13, 20) + l2.substring(21, 35);
    const cFinal = calcCheck(compStr); const vFinal = isValidCheck(cFinal, finalC);

    const calcLogs = [
        genLogLine("DOC_NUM", docNumC, cDoc), genLogLine("DOB", dobC, cDob),
        genLogLine("EXPIRY", expC, cExp), genLogLine("FINAL", finalC, cFinal)
    ];

    const detailedType = getDetailedType(iss, typeCode, 'TD2', docNum);

    const result: MrzResult = {
        valid: vDoc && vDob && vExp && vFinal, format: typeCode.startsWith('V') ? 'MRV_B' : 'TD2', type: typeCode.startsWith('V') ? 'VISA' : 'CARD',
        rawLines: [l1, l2],
        fields: {
            documentNumber: docNum, documentNumberCheck: docNumC, 
            nationality: normalizeCountry(nat), 
            birthDate: dob, birthDateCheck: dobC, sex,
            expiryDate: exp, expiryDateCheck: expC, optionalData: opt, optionalDataCheck: null,
            documentTypeRaw: typeCode, detailedType, 
            issuingState: normalizeCountry(iss), 
            surname: cleanName(sur), givenNames: cleanName(given || ''),
            compositeCheck: finalC
        },
        validations: { documentNumber: vDoc, birthDate: vDob, expiryDate: vExp, optionalData: true, composite: vFinal },
        parsed: { birthDate: parseDate(dob, false), expiryDate: parseDate(exp, true), daysRemaining: null, age: null },
        logs, calcLogs, risks: []
    };
    calculateDates(result);
    enrichUniversalData(result, iss, opt);
    return result;
};

// --- TD1 ENGINE (ID Card / US Passport Card) ---
const parseTD1 = (lines: string[], autoFix: boolean): MrzResult => {
    let [l1, l2, l3] = lines;
    if (!l3) { l3 = "______________________________"; }

    const typeCode = l1.substring(0, 2);
    const iss = l1.substring(2, 5);
    const docNum = l1.substring(5, 14); const docNumC = l1[14];
    const opt1 = l1.substring(15, 30);

    const dob = l2.substring(0, 6); const dobC = l2[6];
    const sex = l2[7];
    const exp = l2.substring(8, 14); const expC = l2[14];
    const nat = l2.substring(15, 18);
    const opt2 = l2.substring(18, 29);
    const finalC = l2[29];

    const [sur, given] = l3.split('<<');

    const cDoc = calcCheck(docNum); const vDoc = isValidCheck(cDoc, docNumC);
    const cDob = calcCheck(dob); const vDob = isValidCheck(cDob, dobC);
    const cExp = calcCheck(exp); const vExp = isValidCheck(cExp, expC);
    const compStr = l1.substring(5, 30) + l2.substring(0, 29);
    const cFinal = calcCheck(compStr); const vFinal = isValidCheck(cFinal, finalC);

    const calcLogs = [
        genLogLine("DOC_NUM", docNumC, cDoc), genLogLine("DOB", dobC, cDob),
        genLogLine("EXPIRY", expC, cExp), genLogLine("FINAL", finalC, cFinal)
    ];

    const detailedType = getDetailedType(iss, typeCode, 'TD1', docNum);

    const result: MrzResult = {
        valid: vDoc && vDob && vExp && vFinal, format: 'TD1', type: 'CARD',
        rawLines: lines,
        fields: {
            documentNumber: docNum, documentNumberCheck: docNumC, 
            nationality: normalizeCountry(nat), 
            birthDate: dob, birthDateCheck: dobC, sex,
            expiryDate: exp, expiryDateCheck: expC, optionalData: opt1, optionalDataCheck: null, optionalData2: opt2,
            documentTypeRaw: typeCode, detailedType, 
            issuingState: normalizeCountry(iss), 
            surname: cleanName(sur), givenNames: cleanName(given || ''),
            compositeCheck: finalC
        },
        validations: { documentNumber: vDoc, birthDate: vDob, expiryDate: vExp, optionalData: true, composite: vFinal },
        parsed: { birthDate: parseDate(dob, false), expiryDate: parseDate(exp, true), daysRemaining: null, age: null },
        logs: [], calcLogs, risks: []
    };
    calculateDates(result);
    enrichUniversalData(result, iss, opt1 + " " + opt2);
    return result;
};

// --- CN_CARD ENGINE (Single Line 30 chars - EEP HK/TW) ---
const parseCard30 = (lines: string[], autoFix: boolean): MrzResult => {
    let l1 = lines[0];
    const logs: string[] = [];
    
    if (autoFix) {
        let arr = l1.split('');
        const numIdx = [...Array(9).keys()].map(i=>i+2).concat([...Array(6).keys()].map(i=>i+13)).concat([...Array(6).keys()].map(i=>i+21)).concat([29]);
        numIdx.forEach(i => { if(FIX_NUM[arr[i]]) arr[i]=FIX_NUM[arr[i]]; });
        l1 = arr.join('');
    }

    const typeCode = l1.substring(0, 2);
    const docNum = l1.substring(2, 11); const docNumC = l1[11];
    const exp = l1.substring(13, 19); const expC = l1[19];
    const dob = l1.substring(21, 27); const dobC = l1[27];
    const finalC = l1[29];

    const cDoc = calcCheck(docNum); const vDoc = isValidCheck(cDoc, docNumC);
    const cExp = calcCheck(exp); const vExp = isValidCheck(cExp, expC);
    const cDob = calcCheck(dob); const vDob = isValidCheck(cDob, dobC);
    
    const compStr = l1.substring(2, 12) + l1.substring(13, 20) + l1.substring(21, 28);
    const cFinal = calcCheck(compStr); const vFinal = isValidCheck(cFinal, finalC);

    const calcLogs = [
        genLogLine("DOC_NUM", docNumC, cDoc), genLogLine("EXPIRY", expC, cExp), 
        genLogLine("DOB", dobC, cDob), genLogLine("FINAL", finalC, cFinal)
    ];

    const iss = "CHN"; 
    const detailedType = getDetailedType(iss, typeCode, 'CN_CARD', docNum);

    const result: MrzResult = {
        valid: vDoc && vDob && vExp && vFinal, format: 'CN_CARD', type: 'CARD', // Correct format CN_CARD
        rawLines: [l1],
        fields: {
            documentNumber: docNum, documentNumberCheck: docNumC, 
            nationality: 'CHN', 
            birthDate: dob, birthDateCheck: dobC, sex: null,
            expiryDate: exp, expiryDateCheck: expC, optionalData: null, optionalDataCheck: null,
            documentTypeRaw: typeCode, detailedType, 
            issuingState: iss, // Keep implicit CHN
            surname: null, givenNames: null,
            compositeCheck: finalC
        },
        validations: { documentNumber: vDoc, birthDate: vDob, expiryDate: vExp, optionalData: true, composite: vFinal },
        parsed: { birthDate: parseDate(dob, false), expiryDate: parseDate(exp, true), daysRemaining: null, age: null },
        logs, calcLogs, risks: []
    };
    calculateDates(result);
    return result;
};


const calculateDates = (res: MrzResult) => {
    if (res.parsed.expiryDate) {
        const diff = res.parsed.expiryDate.getTime() - Date.now();
        res.parsed.daysRemaining = Math.ceil(diff / (1000 * 3600 * 24));
    }
    if (res.parsed.birthDate) {
        res.parsed.age = Math.abs(new Date(Date.now() - res.parsed.birthDate.getTime()).getUTCFullYear() - 1970);
    }
};

// --- UNIVERSAL DATA MINING & DEEP ANALYSIS ---
const enrichUniversalData = (res: MrzResult, iss: string, rawOpt: string) => {
    const cleanIss = normalizeCountry(iss);
    const clean = rawOpt ? rawOpt.replace(/</g, '').trim() : '';
    
    if (!clean) {
        res.parsed.extendedData = { titleKey: 'lbl_struct_check', text: "ICAO COMPLIANT", truncated: null };
        return;
    }

    // 1. CHINA GBK - FULL LOGIC RESTORED
    if ((cleanIss === 'CHN' || cleanIss === 'HKG' || cleanIss === 'MAC') && res.format === 'TD3') {
        const gbk = parseGBKName(res.fields.optionalData || '');
        if (gbk) {
             res.parsed.extendedData = { titleKey: 'lbl_chn_id', text: gbk.text, truncated: gbk.truncated };
             
             // --- PINYIN CROSS-VALIDATION (RESTORED) ---
             try {
                const pyArr = pinyin(gbk.text, { toneType: 'none', type: 'array', v: true });
                const pyStr = pyArr.join('').toUpperCase().replace(/V/g, 'U').replace(/Ü/g, 'U');
                
                const sur = res.fields.surname || '';
                const given = res.fields.givenNames || '';
                // Normalize MRZ name for strict comparison
                const mrzName = (sur + given).replace(/\s/g, '').replace(/V/g, 'U').replace(/Ü/g, 'U');
                
                const trunc = gbk.truncated || 0;

                // Logic 1: Truncation Flag vs Buffer Capacity
                if (trunc > 0 && gbk.hasFillers) {
                        res.risks.push({
                        level: 'critical',
                        messageKey: 'risk_truncation_logic',
                        details: `Tag:${trunc}, Fillers:YES`
                    });
                }

                // Logic 2: Pinyin Prefix Matching
                if (!mrzName.startsWith(pyStr)) {
                    res.risks.push({
                        level: 'critical',
                        messageKey: 'risk_name_mismatch',
                        details: `CN:${pyStr} !~ MRZ:${mrzName}`
                    });
                } else {
                    // Logic 3: Suffix Analysis (Hidden Part)
                    const suffix = mrzName.substring(pyStr.length);
                    
                    if (trunc === 0) {
                        if (suffix.length > 0) {
                             res.risks.push({
                                 level: 'warn',
                                 messageKey: 'risk_name_mismatch',
                                 details: `Tag=0 but Extra MRZ`
                             });
                        }
                    } else {
                        // Tag > 0: Must have hidden chars
                        if (suffix.length === 0) {
                             res.risks.push({
                                 level: 'critical',
                                 messageKey: 'risk_truncation_len_mismatch',
                                 details: `Tag=${trunc} but MRZ Ends`
                             });
                        } else {
                             // Vowel heuristic: Hidden part must be Pinyin syllables
                             const vowelCount = (suffix.match(/[AEIOU]/g) || []).length;
                             if (vowelCount < trunc) {
                                 res.risks.push({
                                     level: 'critical',
                                     messageKey: 'risk_truncation_vowel',
                                     details: `Tag=${trunc}, SuffixVowels=${vowelCount}`
                                 });
                             }
                        }
                    }
                }
             } catch (e) { /* ignore pinyin errors */ }
             return;
        }
    }

    // 2. SPAIN DNI
    if (cleanIss === 'ESP') {
        res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `DNI: ${clean}`, truncated: null };
        return;
    }

    // 3. GERMANY
    if (cleanIss === 'DEU') {
        if (res.format === 'TD2') {
             res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `Serial/Auth: ${clean}`, truncated: null };
        } else {
             res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `Admin: ${clean}`, truncated: null };
        }
        return;
    }

    // 4. NETHERLANDS
    if (cleanIss === 'NLD' && /^\d{9}$/.test(clean)) {
         res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `BSN: ${clean}`, truncated: null };
         return;
    }
    
    // 5. CZECHIA / SLOVAKIA
    if ((cleanIss === 'CZE' || cleanIss === 'SVK') && clean.length >= 9) {
        res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `RČ: ${clean}`, truncated: null };
        return;
    }

    // 6. SLOVENIA
    if (cleanIss === 'SVN' && clean.length >= 13) {
        res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `EMŠO: ${clean}`, truncated: null };
        return;
    }

    // 7. SOUTH AFRICA
    if (cleanIss === 'ZAF') {
         res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `ID No: ${clean}`, truncated: null };
         return;
    }

    // 8. POLAND (PESEL)
    if (cleanIss === 'POL') {
        const peselMatch = clean.match(/\d{11}/);
        if (peselMatch) {
            res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `PESEL: ${peselMatch[0]}`, truncated: null };
            return;
        }
    }

    // 9. ROMANIA (CNP)
    if (cleanIss === 'ROU') {
        const cnpMatch = clean.match(/\d{13}/);
        if (cnpMatch) {
            res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `CNP: ${cnpMatch[0]}`, truncated: null };
            return;
        }
    }

    // 10. BELGIUM (National Number)
    if (cleanIss === 'BEL') {
        const nnMatch = clean.match(/\d{11}/);
        if (nnMatch) {
            res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `Nat. No: ${nnMatch[0]}`, truncated: null };
            return;
        }
    }

    // 11. SWITZERLAND (AHV)
    if (cleanIss === 'CHE') {
         const ahvMatch = clean.match(/\d{13}/);
         if (ahvMatch) {
             res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `AHV: ${ahvMatch[0]}`, truncated: null };
             return;
         }
    }

    // 12. ISRAEL
    if (cleanIss === 'ISR') {
        const idMatch = clean.match(/\d{9}/);
        if (idMatch) {
            res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `ID No: ${idMatch[0]}`, truncated: null };
            return;
        }
    }
    
    // 13. PORTUGAL (NIF/SNS)
    if (cleanIss === 'PRT') {
         // Portugal Citizen Card often has multiple numbers, simplified display
         res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `Civil ID/Tax: ${clean}`, truncated: null };
         return;
    }

    // 14. NORDICS (SWE, FIN, NOR, ISL) - Personal IDs
    if (['SWE', 'FIN', 'NOR', 'ISL'].includes(cleanIss)) {
        res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `Personal ID: ${clean}`, truncated: null };
        return;
    }

    // 15. BALTICS (EST, LVA, LTU)
    if (['EST', 'LVA', 'LTU'].includes(cleanIss)) {
         res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `Personal Code: ${clean}`, truncated: null };
         return;
    }

    // 16. UKRAINE
    if (cleanIss === 'UKR') {
        res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: `Record No: ${clean}`, truncated: null };
        return;
    }

    // FALLBACK
    res.parsed.extendedData = { titleKey: 'lbl_personal_no', text: clean, truncated: null };
};