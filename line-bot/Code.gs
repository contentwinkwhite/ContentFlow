/**
 * ContentFlow LINE Bot
 * ทีมพิมพ์รีพอร์ตงาน (คั่น Tab แบบเดียวกับที่เคยพิมพ์ส่งกัน) ในกลุ่มไลน์
 * บอทแปลงข้อมูล ตอบกลับให้เช็คก่อน พิมพ์ "ยืนยัน" แล้วค่อยบันทึกเข้าระบบ ContentFlow จริง (Supabase)
 *
 * ตั้งค่าครั้งแรก: ดู SETUP.md ในโฟลเดอร์นี้
 */

/* ============================================================
 * ตั้งค่า — รันฟังก์ชันนี้ครั้งเดียวตอนติดตั้ง (แก้ค่าในนี้ก่อนกดรัน)
 * ============================================================ */
function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    LINE_CHANNEL_ACCESS_TOKEN: 'วางค่า Channel access token (long-lived) จาก developers.line.biz ตรงนี้',
    SUPABASE_URL: 'https://qcrvsskqirlskhcfahno.supabase.co',
    SUPABASE_KEY: 'sb_publishable_wxNJOmMWcBrfgJQsEvIfqQ_UDSZtJG9',
    // แผนที่ "LINE userId ของแต่ละคน" -> "ชื่อสมาชิกในระบบ ContentFlow (ต้องสะกดตรงกับหน้าทีมงานในแอปเป๊ะๆ)"
    // ปล่อยว่าง {} ไว้ก่อนได้ — ให้แต่ละคนพิมพ์ "ไอดีฉัน" ในไลน์เพื่อเอา userId มาใส่ทีหลัง (ดู SETUP.md ข้อ 8)
    LINE_MEMBER_MAP: '{}'
  }, false);
  console.log('ตั้งค่าเรียบร้อย — ไปทำ Deploy ต่อได้เลย (ดู SETUP.md ข้อ 6)');
}

/* ============================================================
 * ทางเข้า webhook — LINE ยิง POST มาทุกครั้งที่มีข้อความ/อีเวนต์
 * ============================================================ */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(handleEvent_); // LINE ส่งมาเป็น array เสมอ ต่อให้มีอีเวนต์เดียว
  } catch (err) {
    console.error('doPost พัง: ' + err.stack); // ห้ามปล่อย throw ออกไป ไม่งั้นฝั่ง LINE เงียบสนิทหาสาเหตุไม่ได้
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/*
 * หมายเหตุความปลอดภัย: Apps Script Web App ไม่ส่ง HTTP header (X-Line-Signature) มาให้ตรวจใน `e`
 * เลยตรวจลายเซ็นแบบมาตรฐานไม่ได้ — เรื่องนี้เป็นข้อจำกัดของแพลตฟอร์ม ไม่ใช่ช่องโหว่ที่ลืมปิด
 * แนวป้องกันที่ใช้แทน: (1) URL ของ /exec ไม่เปิดเผยที่ไหน (2) กลุ่มไลน์เป็นกลุ่มปิดของทีมเท่านั้น
 * เทียบเท่าระดับความปลอดภัยกับรหัสผ่านทีมที่ใช้เข้าแอป ContentFlow เอง (ไม่ได้ auth ต่อคนเหมือนกัน)
 */

function handleEvent_(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const replyToken = event.replyToken;
  const userId = event.source && event.source.userId;
  const text = event.message.text || '';
  const trimmed = text.trim();

  if (!userId) {
    replyText_(replyToken, 'ระบบไม่พบ userId ของคุณ (การตั้งค่ากลุ่มอาจปิดสิทธิ์นี้ไว้) กรุณาติดต่อแอดมิน');
    return;
  }

  if (trimmed === 'ไอดีฉัน') {
    replyText_(replyToken, 'LINE user ID ของคุณคือ:\n' + userId + '\n\nส่งข้อความนี้ให้แอดมินเพื่อผูกกับชื่อในระบบ ContentFlow ครั้งเดียวจบ');
    return;
  }
  if (trimmed === 'ยืนยัน') {
    confirmPendingBatch_(userId, replyToken);
    return;
  }
  if (trimmed === 'ยกเลิก') {
    CacheService.getScriptCache().remove('pending_' + userId);
    replyText_(replyToken, 'ยกเลิกแล้ว ไม่มีอะไรถูกบันทึก');
    return;
  }

  // เฉพาะข้อความที่มีตัวคั่น Tab เท่านั้นถึงจะพยายามแปลงเป็นรีพอร์ต — กันบอทตอบแชทเล่นปกติในกลุ่ม
  // (มือถือพิมพ์ Tab ไม่ได้อยู่แล้ว ข้อความที่มี Tab จริงคือก๊อปมาจากชีต/ปั้นตามแพทเทิร์นเท่านั้น)
  if (text.indexOf('\t') === -1) return; // เงียบไว้ ไม่ใช่รูปแบบรีพอร์ต ไม่ใช่คำสั่งที่รู้จัก

  handleReportPaste_(userId, text, replyToken);
}

/* ============================================================
 * รับข้อความรีพอร์ต -> พาร์ส -> เก็บพักไว้รอยืนยัน -> ตอบสรุปกลับ
 * ============================================================ */
function handleReportPaste_(userId, text, replyToken) {
  const payloadNow = fetchSupabasePayload_();
  const members = payloadNow.members || [];
  const brands = payloadNow.brands || [];
  const myMemberName = lookupMemberNameForLineUser_(userId);
  const fallbackMember = myMemberName ? members.find(function (m) { return m.name === myMemberName; }) : null;

  const parsed = parseLinePasteText_(text, members, brands);
  if (parsed.entries.length === 0) {
    replyText_(replyToken, 'แปลงข้อมูลไม่ได้ ตรวจรูปแบบข้อความอีกครั้ง (ต้องมีวันที่นำหน้าแต่ละกลุ่ม คั่นด้วย Tab)');
    return;
  }

  parsed.entries.forEach(function (entry) {
    if (!entry.personId && fallbackMember) {
      entry.personId = fallbackMember.id;
      entry.personName = fallbackMember.name;
    }
  });

  const stillUnresolved = parsed.entries.some(function (en) { return !en.personId; });
  if (stillUnresolved && !fallbackMember) {
    replyText_(replyToken, 'ระบบยังไม่รู้จักคุณ (หาชื่อคนบางแถวไม่เจอ) — พิมพ์ "ไอดีฉัน" แล้วส่งให้แอดมินผูกชื่อก่อน หรือพิมพ์ชื่อคนในระบบต่อท้ายให้ครบทุกแถว');
    return;
  }

  CacheService.getScriptCache().put('pending_' + userId, JSON.stringify(parsed), 600); // เก็บไว้ 10 นาที

  let msg = 'แปลงได้ ' + parsed.entries.length + ' งาน:\n';
  parsed.entries.forEach(function (en, i) {
    const brandName = en.brandId ? ((brands.find(function (b) { return b.id === en.brandId; }) || {}).name || '?') : 'ไม่ระบุแบรนด์';
    const personName = en.personName || ((members.find(function (m) { return m.id === en.personId; }) || {}).name) || '?';
    msg += (i + 1) + '. ' + en.date + ' · ' + brandName + ' · ' + (en.description || '(ไม่มีรายละเอียด)') + ' · ' + personName + ' · ' + en.status + '\n';
  });
  if (parsed.skipped.length) {
    const reasons = uniq_(parsed.skipped.map(function (s) { return s.reason; }));
    msg += '\nข้าม ' + parsed.skipped.length + ' ส่วน (' + reasons.join(', ') + ') — กรุณาเพิ่มเองในแอป\n';
  }
  const warnCount = parsed.entries.reduce(function (n, en) { return n + (en.warnings ? en.warnings.length : 0); }, 0);
  if (warnCount) msg += '\n⚠️ มี ' + warnCount + ' จุดที่จับคู่แบรนด์/ชื่อคนไม่ชัดเจน — เช็คในรายการข้างบนอีกที ระบบจะบันทึกตามที่จับคู่ได้ไปก่อน แก้ทีหลังในแอปได้\n';
  msg += '\nพิมพ์ "ยืนยัน" เพื่อบันทึกเข้าระบบ หรือ "ยกเลิก" (หมดอายุอัตโนมัติใน 10 นาที)';

  replyText_(replyToken, msg);
}

/* ============================================================
 * ยืนยัน -> บันทึกจริงเข้า Supabase
 * ============================================================ */
function confirmPendingBatch_(userId, replyToken) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get('pending_' + userId);
  if (!raw) {
    replyText_(replyToken, 'ไม่พบรายการที่ค้างยืนยัน (อาจหมดอายุแล้ว) กรุณาพิมพ์รีพอร์ตส่งใหม่อีกครั้ง');
    return;
  }
  const parsed = JSON.parse(raw);
  cache.remove('pending_' + userId);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const result = commitEntriesToSupabase_(parsed.entries);
    if (result.ok) {
      replyText_(replyToken, 'บันทึกเรียบร้อย ' + parsed.entries.length + ' งาน ✅ เข้าไปดูในแอป ContentFlow ได้เลย');
    } else {
      replyText_(replyToken, 'บันทึกไม่สำเร็จ: ' + result.error + '\nลองพิมพ์รีพอร์ตส่งใหม่อีกครั้ง หรือกรอกเองในแอปแทน');
    }
  } catch (err) {
    console.error('confirmPendingBatch_ พัง: ' + err.stack);
    replyText_(replyToken, 'บันทึกไม่สำเร็จ (ระบบขัดข้อง) กรุณาลองใหม่หรือกรอกเองในแอป');
  } finally {
    lock.releaseLock();
  }
}

// เขียนเข้า Supabase แบบกันชนข้อมูล (ดึงข้อมูลล่าสุดมาก่อนเสมอ แล้วค่อยรวม ถ้ามีคนแก้พร้อมกันจะลองใหม่อัตโนมัติ)
// ใช้หลักการเดียวกับ saveDataAppend() ในฝั่งแอป app.html — กันข้อมูลหายตอนบันทึกชนกัน
function commitEntriesToSupabase_(entries) {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_KEY');
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  const rowUrl = baseUrl + '/rest/v1/contentflow_data?id=eq.main';

  for (let attempt = 0; attempt < 3; attempt++) {
    const getRes = UrlFetchApp.fetch(rowUrl + '&select=payload,updated_at', { headers: headers, muteHttpExceptions: true });
    if (getRes.getResponseCode() !== 200) {
      console.error('โหลดข้อมูลไม่สำเร็จ: ' + getRes.getResponseCode() + ' ' + getRes.getContentText());
      return { ok: false, error: 'โหลดข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ' };
    }
    const rows = JSON.parse(getRes.getContentText());
    if (!rows.length) return { ok: false, error: 'ไม่พบข้อมูลระบบ' };
    const payload = rows[0].payload;
    const updatedAt = rows[0].updated_at;

    payload.workItems = payload.workItems || [];
    payload.dailyReports = payload.dailyReports || [];
    payload.activityLog = payload.activityLog || [];

    entries.forEach(function (entry) {
      const workId = genId_();
      const report = {
        id: genId_(), memberId: entry.personId, date: entry.date, workType: 'ตัดคลิป',
        quantity: 1, contentPlanId: null, brandId: entry.brandId || '', note: entry.description
      };
      payload.dailyReports.push(report);
      payload.workItems.push({
        id: workId, title: entry.description, date: entry.date, ownerId: entry.personId, brandId: entry.brandId || '',
        workType: 'ตัดคลิป', quantity: 1, product: '', description: entry.description,
        location: '', channel: '', coverImageDataUrl: '', status: entry.status || 'รอตรวจ',
        imageNote: '', driveLink: entry.driveLink || '', postDate: '', linkPost: '', postCoverImageDataUrl: '',
        revisions: [], reportId: report.id
      });
      payload.activityLog.push({
        id: genId_(), memberId: entry.personId, timestamp: new Date().toISOString(),
        module: 'รายงานการทำงาน', action: 'เพิ่มงานผ่านไลน์: ตัดคลิป 1 ชิ้น'
      });
    });

    const patchRes = UrlFetchApp.fetch(rowUrl + '&updated_at=eq.' + encodeURIComponent(updatedAt), {
      method: 'patch',
      headers: Object.assign({ Prefer: 'return=representation' }, headers),
      contentType: 'application/json',
      payload: JSON.stringify({ payload: payload }),
      muteHttpExceptions: true
    });
    const code = patchRes.getResponseCode();
    const resultRows = code === 200 ? JSON.parse(patchRes.getContentText()) : [];
    if (code === 200 && resultRows.length > 0) return { ok: true };

    console.log('รอบที่ ' + attempt + ': มีคนแก้ไขข้อมูลพร้อมกัน (หรือบันทึกไม่ผ่าน) code=' + code + ' body=' + patchRes.getContentText());
    Utilities.sleep(300);
  }
  return { ok: false, error: 'มีคนแก้ไขข้อมูลพร้อมกันหลายรอบติดกัน' };
}

function genId_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function lookupMemberNameForLineUser_(userId) {
  const raw = PropertiesService.getScriptProperties().getProperty('LINE_MEMBER_MAP') || '{}';
  let map = {};
  try { map = JSON.parse(raw); } catch (e) { /* ปล่อยเป็น {} ถ้า JSON เพี้ยน */ }
  return map[userId] || null;
}

function fetchSupabasePayload_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_KEY');
  const res = UrlFetchApp.fetch(url + '/rest/v1/contentflow_data?id=eq.main&select=payload', {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('fetchSupabasePayload_ ล้มเหลว: ' + res.getResponseCode() + ' ' + res.getContentText());
    return {};
  }
  const rows = JSON.parse(res.getContentText());
  return rows[0] ? rows[0].payload : {};
}

function replyText_(replyToken, text) {
  if (!replyToken) return;
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/json',
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) console.error('ตอบกลับไลน์ไม่สำเร็จ: ' + res.getResponseCode() + ' ' + res.getContentText());
}

function uniq_(arr) {
  const seen = {};
  const out = [];
  arr.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
  return out;
}

/* ============================================================
 * พาร์สข้อความคั่น Tab เป็นรายการงาน
 * (พอร์ตมาจาก parseLinePasteText ในฝั่งแอป app.html ให้พฤติกรรมตรงกัน)
 * ============================================================ */
const THAI_DAY_NAMES_ = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'พฤหัส', 'ศุกร์', 'เสาร์'];
const WORKITEM_STATUS_LIST_ = ['ดำเนินการ', 'รอตรวจ', 'แก้ไข', 'สำเร็จ', 'Post', 'ยกเลิก'];
const LINE_PASTE_NAME_ALIASES_ = {
  'นิว': 'New', 'โอปอ': 'Opor', 'การ์ตูน': 'Cartoon', 'แป้ง': 'Pang', 'นิ้ง': 'Ning', 'ดิว': 'Dew'
};

function unquoteLinePasteCell_(s) {
  s = (s || '').trim();
  if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
    s = s.slice(1, -1).replace(/""/g, '"');
  }
  return s.trim();
}

function mergeQuotedMultilineRows_(text) {
  const rawLines = text.split('\n');
  const merged = [];
  let buffer = null;
  function countQuotes(s) { const m = s.match(/"/g); return m ? m.length : 0; }
  rawLines.forEach(function (line) {
    if (buffer === null) {
      if (countQuotes(line) % 2 !== 0) buffer = line;
      else merged.push(line);
    } else {
      buffer += '\n' + line;
      if (countQuotes(buffer) % 2 === 0) { merged.push(buffer); buffer = null; }
    }
  });
  if (buffer !== null) merged.push(buffer);
  return merged;
}

function parseLinePasteDate_(raw) {
  const m = (raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (y < 100) y = 2000 + y;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function matchMemberByRawName_(raw, members) {
  const clean = (raw || '').replace(/\(.*?\)/g, '').trim();
  if (!clean) return null;
  let m = members.find(function (x) { return x.name.trim() === clean; });
  if (m) return m;
  const alias = LINE_PASTE_NAME_ALIASES_[clean];
  if (alias) {
    m = members.find(function (x) { return x.name.trim() === alias; });
    if (m) return m;
  }
  m = members.find(function (x) { return clean.includes(x.name.trim()) || x.name.trim().includes(clean); });
  return m || null;
}

function matchBrandByRawName_(raw, brands) {
  const clean = (raw || '').trim();
  if (!clean) return null;
  let b = brands.find(function (x) { return x.name.trim().toLowerCase() === clean.toLowerCase(); });
  if (b) return b;
  b = brands.find(function (x) {
    return clean.toLowerCase().includes(x.name.trim().toLowerCase()) || x.name.trim().toLowerCase().includes(clean.toLowerCase());
  });
  return b || null;
}

function parseLinePasteDataRow_(cells, fallbackPersonName, members, brands) {
  const nonEmpty = cells.map(function (c) { return (c || '').trim(); });
  const brandRaw = (nonEmpty[0] || '').replace(/^[*\-•]\s*/, '').trim();
  const rest = nonEmpty.slice(1).filter(function (c) { return c !== ''; });

  let statusIdx = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (WORKITEM_STATUS_LIST_.some(function (s) { return s.toLowerCase() === rest[i].toLowerCase(); })) { statusIdx = i; break; }
  }
  const status = statusIdx >= 0 ? WORKITEM_STATUS_LIST_.find(function (s) { return s.toLowerCase() === rest[statusIdx].toLowerCase(); }) : '';

  const linkIdx = rest.findIndex(function (c) { return /^https?:\/\//i.test(c); });
  const link = linkIdx >= 0 ? rest[linkIdx] : '';

  let personIdx = -1, personMatch = null;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (i === statusIdx || i === linkIdx) continue;
    const m = matchMemberByRawName_(rest[i], members);
    if (m) { personIdx = i; personMatch = m; break; }
  }

  const description = rest.filter(function (c, i) { return i !== statusIdx && i !== linkIdx && i !== personIdx; }).join(' ').trim();

  let personRaw = personIdx >= 0 ? rest[personIdx] : '';
  if (!personMatch && fallbackPersonName) {
    personMatch = matchMemberByRawName_(fallbackPersonName, members);
    personRaw = personRaw || fallbackPersonName;
  }

  const brandMatch = matchBrandByRawName_(brandRaw, brands);
  const warnings = [];
  if (brandRaw && !brandMatch) warnings.push('ไม่พบแบรนด์ "' + brandRaw + '" ในระบบ');
  if (!personMatch) warnings.push('ไม่พบชื่อคน' + (personRaw ? ' "' + personRaw + '"' : ''));

  return {
    brandId: brandMatch ? brandMatch.id : '', description: description.replace(/\s*\n\s*/g, ' ').trim(),
    driveLink: link, status: status || WORKITEM_STATUS_LIST_[0],
    personId: personMatch ? personMatch.id : '', personName: personMatch ? personMatch.name : '', warnings: warnings
  };
}

function parseLinePasteText_(text, members, brands) {
  const lines = mergeQuotedMultilineRows_(text);
  const entries = [];
  const skipped = [];
  let currentDate = null;
  let currentPersonHeader = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].replace(/\r$/, '');
    if (!rawLine.trim()) continue;
    if (/^[-=_*\s]{3,}$/.test(rawLine.trim())) continue;

    const personHeaderMatch = rawLine.trim().match(/^📌\s*(.+)$/);
    if (personHeaderMatch) { currentPersonHeader = personHeaderMatch[1].trim(); continue; }

    const cells = rawLine.split('\t').map(unquoteLinePasteCell_);
    const first = cells[0] || '';
    const dateVal = parseLinePasteDate_(first);

    if (dateVal) {
      currentDate = dateVal;
      const contentCells = cells.slice(2);
      if (contentCells.some(function (c) { return c !== ''; })) {
        const row = parseLinePasteDataRow_(contentCells, currentPersonHeader, members, brands);
        row.date = currentDate;
        entries.push(row);
      }
      continue;
    }

    const stripped = first.replace(/^[*\-•]\s*/, '');
    if (/พากย์เสียง\s*\d+\s*คลิป/.test(stripped)) {
      const block = [rawLine];
      let j = i + 1;
      while (j < lines.length && /^\s+[*\-•]/.test(lines[j])) { block.push(lines[j]); j++; }
      skipped.push({ reason: 'พากย์เสียงรวมหลายคน/หลายคลิป — ต้องกรอกเองทีละคน', text: block.join('\n') });
      i = j - 1;
      continue;
    }

    if (!currentDate) {
      skipped.push({ reason: 'ไม่พบวันที่กำกับบรรทัดนี้', text: rawLine });
      continue;
    }

    const row = parseLinePasteDataRow_(cells, currentPersonHeader, members, brands);
    row.date = currentDate;
    entries.push(row);
  }

  return { entries: entries, skipped: skipped };
}
