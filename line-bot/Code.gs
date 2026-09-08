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
    // ใช้สำหรับ "พิมพ์เล่าเป็นประโยคได้เลย" (บันทึก/สั่งงาน) — ไม่ใส่ก็ใช้บอทได้ปกติ แค่ต้องพิมพ์แบบคั่น Tab เท่านั้น
    // เอาจาก console.anthropic.com → Get API Keys (มีค่าใช้จ่ายจริงตามจำนวนข้อความ แต่ถูกมาก ดู SETUP.md ข้อ 11)
    ANTHROPIC_API_KEY: 'วางค่า Anthropic API key จาก console.anthropic.com ตรงนี้ (ไม่บังคับ)',
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
  // จับ groupId ของกลุ่มไว้อัตโนมัติตั้งแต่อีเวนต์แรกที่เจอ (ใช้ตอน push แจ้งเตือนงานเสี่ยงรายวัน)
  // ทำก่อนเช็คชนิดข้อความ เพื่อให้จับได้แม้เป็นอีเวนต์อื่นที่ไม่ใช่ข้อความข้อความ (join/sticker ฯลฯ)
  if (event.source && event.source.type === 'group' && event.source.groupId) {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('LINE_GROUP_ID')) {
      props.setProperty('LINE_GROUP_ID', event.source.groupId);
      console.log('บันทึก LINE_GROUP_ID อัตโนมัติ: ' + event.source.groupId);
    }
  }

  if (event.type !== 'message') return;
  const replyToken = event.replyToken;
  const userId = event.source && event.source.userId;

  // รูปที่ส่งมา — เก็บไว้ชั่วคราว รอผูกกับรีพอร์ตที่พิมพ์ตามมา (ก่อนหรือหลังก็ได้)
  if (event.message.type === 'image') {
    handleImageMessage_(userId, event.message.id, replyToken);
    return;
  }

  if (event.message.type !== 'text') return; // sticker/video/audio/location ฯลฯ — ไม่รองรับ เงียบไว้
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
    const cache = CacheService.getScriptCache();
    cache.remove('pending_' + userId);
    const pendingImgId = cache.get('pending_img_' + userId);
    if (pendingImgId) {
      try { DriveApp.getFileById(pendingImgId).setTrashed(true); } catch (e) { /* ไฟล์อาจถูกลบไปแล้ว ไม่เป็นไร */ }
      cache.remove('pending_img_' + userId);
    }
    replyText_(replyToken, 'ยกเลิกแล้ว ไม่มีอะไรถูกบันทึก');
    return;
  }
  if (trimmed === 'เช็คงานเสี่ยง') {
    replyText_(replyToken, buildAtRiskMessage_());
    return;
  }

  // ข้อความที่มีตัวคั่น Tab (ก๊อปจากชีต/ปั้นตามแพทเทิร์นเดิม) → พาร์สด้วยกฎตายตัว ฟรี ไม่มีค่าใช้จ่าย
  if (text.indexOf('\t') !== -1) {
    handleReportPaste_(userId, text, replyToken);
    return;
  }

  // แพทเทิร์นพิมพ์มีป้ายกำกับ (พิมพ์เองบนมือถือได้ ไม่ต้องคั่น Tab) — ฟรี ไม่ใช้ Claude
  if (/^\s*วันที่\s*[:：]/m.test(text)) {
    handleLabeledReport_(userId, text, replyToken);
    return;
  }

  // ข้อความที่ขึ้นต้นด้วย "บันทึก" หรือ "สั่งงาน" → พิมพ์เล่าเป็นประโยคได้เลย ให้ Claude ช่วยแยกข้อมูล
  // (มีค่าใช้จ่ายจริงต่อข้อความแต่ถูกมาก — ต้องขึ้นต้นด้วยคำนี้เท่านั้นถึงจะเรียก AI กันเรียกพร่ำเพรื่อตอนแชทเล่นปกติ)
  if (trimmed.indexOf('บันทึก') === 0 || trimmed.indexOf('สั่งงาน') === 0) {
    handleFreeTextEntry_(userId, text, replyToken);
    return;
  }

  // เงียบไว้ ไม่ใช่รูปแบบรีพอร์ต ไม่ใช่คำสั่งที่รู้จัก ไม่ใช่แชทที่ตั้งใจส่งให้บอท — กันบอทตอบแชทเล่นปกติในกลุ่ม
}

/* ============================================================
 * งานเสี่ยงไม่ทันเดดไลน์ — เช็คตามคำสั่ง "เช็คงานเสี่ยง" และแจ้งเตือนอัตโนมัติรายวัน
 * (พอร์ตกติกาเดียวกับ getWorkOrderRisk() ในฝั่งแอป app.html)
 * ============================================================ */
function daysBetweenDates_(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00');
  const b = new Date(toStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function todayBangkokISO_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

function getWorkOrderRisk_(order, today) {
  if (order.status === 'เสร็จ') return 'ok';
  if (!order.deadline) return 'ok';
  const subtaskOverdue = (order.subtasks || []).some(function (s) { return !s.done && s.dueDate && s.dueDate < today; });
  if (subtaskOverdue) return 'overdue';
  if (order.deadline < today) return 'overdue';
  const daysLeft = daysBetweenDates_(today, order.deadline);
  if (daysLeft >= 0 && daysLeft <= 3) return 'urgent';
  return 'ok';
}

function formatThaiDate_(dateStr) {
  const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const parts = (dateStr || '').split('-').map(Number);
  if (parts.length !== 3) return dateStr || '';
  return parts[2] + ' ' + monthNames[parts[1] - 1] + ' ' + (parts[0] + 543);
}

function workOrderRiskReasonText_(order, today) {
  const overdueSubtask = (order.subtasks || []).find(function (s) { return !s.done && s.dueDate && s.dueDate < today; });
  if (overdueSubtask) return 'ยังไม่เสร็จ "' + overdueSubtask.label + '" (ครบกำหนด ' + formatThaiDate_(overdueSubtask.dueDate) + ') — กำหนดส่งงาน ' + formatThaiDate_(order.deadline);
  if (order.deadline < today) return 'เลยกำหนดส่ง ' + formatThaiDate_(order.deadline) + ' แล้ว ยังไม่เสร็จ';
  const daysLeft = daysBetweenDates_(today, order.deadline);
  return 'เหลือ ' + daysLeft + ' วันถึงกำหนดส่ง (' + formatThaiDate_(order.deadline) + ') สถานะยังเป็น "' + order.status + '"';
}

function buildAtRiskMessage_() {
  const payload = fetchSupabasePayload_();
  const workOrders = payload.workOrders || [];
  const today = todayBangkokISO_();
  const risky = workOrders.filter(function (o) { return getWorkOrderRisk_(o, today) !== 'ok'; })
    .sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });

  if (risky.length === 0) return '✅ ไม่มีงานเสี่ยงไม่ทันเดดไลน์ตอนนี้';

  let msg = '🚨 มีงานเสี่ยงไม่ทันเดดไลน์ ' + risky.length + ' รายการ:\n\n';
  risky.forEach(function (o, i) {
    const risk = getWorkOrderRisk_(o, today);
    msg += (i + 1) + '. ' + o.title + (risk === 'overdue' ? ' (เลยกำหนด)' : ' (ใกล้ถึงกำหนด)') + '\n   ' + workOrderRiskReasonText_(o, today) + '\n';
  });
  msg += '\nเข้าไปดู/อัปเดตในแอป ContentFlow ได้เลย';
  return msg;
}

// เรียกโดย time-driven trigger รายวัน (ตั้งค่าครั้งเดียวผ่าน setupDailyTrigger) — แจ้งเข้ากลุ่มเฉพาะตอนมีงานเสี่ยงจริง
// (ไม่ส่งข้อความ "ไม่มีอะไรน่าห่วง" ทุกวัน กันข้อความรบกวนกลุ่ม — อยากเช็คเองพิมพ์ "เช็คงานเสี่ยง" ได้ตลอดเวลา)
function checkAtRiskAndNotify() {
  const groupId = PropertiesService.getScriptProperties().getProperty('LINE_GROUP_ID');
  if (!groupId) { console.log('ยังไม่มี LINE_GROUP_ID (ยังไม่มีใครพิมพ์อะไรในกลุ่มเลยตั้งแต่ติดตั้งบอท) ข้ามการแจ้งเตือนรอบนี้'); return; }

  const payload = fetchSupabasePayload_();
  const workOrders = payload.workOrders || [];
  const today = todayBangkokISO_();
  const riskyCount = workOrders.filter(function (o) { return getWorkOrderRisk_(o, today) !== 'ok'; }).length;
  if (riskyCount === 0) { console.log('ไม่มีงานเสี่ยงวันนี้ ไม่ต้องแจ้ง'); return; }

  pushText_(groupId, buildAtRiskMessage_());
}

// รันครั้งเดียวตอนติดตั้ง (เลือกฟังก์ชันนี้จากดรอปดาวน์ Run แล้วกดรัน) — ตั้งเวลาเช็คงานเสี่ยงทุกวัน 9 โมงเช้า
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkAtRiskAndNotify') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAtRiskAndNotify').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Bangkok').create();
  console.log('ตั้งเวลาแจ้งเตือนงานเสี่ยงทุกวัน 9:00 น. เรียบร้อย');
}

/* ============================================================
 * เตือนคนที่ยังไม่ส่งรีพอร์ตประจำวัน — เช็ครายวันตอนใกล้เลิกงาน
 * (พอร์ตกติกา isReportableMember/isActiveStatus เดียวกับฝั่งแอป app.html)
 * ============================================================ */
function checkMissingReportsAndNotify() {
  const groupId = PropertiesService.getScriptProperties().getProperty('LINE_GROUP_ID');
  if (!groupId) { console.log('ยังไม่มี LINE_GROUP_ID ข้ามการแจ้งเตือนรอบนี้'); return; }

  const payload = fetchSupabasePayload_();
  const members = payload.members || [];
  const dailyReports = payload.dailyReports || [];
  const today = todayBangkokISO_();

  const reportable = members.filter(function (m) {
    return m.status !== 'พ้นทีม' && m.department !== 'ผู้จัดการ' && m.department !== 'ผู้บริหาร' && m.department !== 'ทีมงานนอก';
  });
  const submittedIds = {};
  dailyReports.forEach(function (r) { if (r.date === today) submittedIds[r.memberId] = true; });
  const missing = reportable.filter(function (m) { return !submittedIds[m.id]; });

  if (missing.length === 0) { console.log('ทุกคนส่งรีพอร์ตวันนี้ครบแล้ว'); return; }

  let msg = '📝 วันนี้ยังไม่ได้ส่งรีพอร์ตประจำวัน:\n';
  missing.forEach(function (m) { msg += '- ' + m.name + '\n'; });
  msg += '\nอย่าลืมส่งก่อนหมดวันนะ 🙏';
  pushText_(groupId, msg);
}

// รันครั้งเดียวตอนติดตั้ง — ตั้งเวลาเช็ครีพอร์ตค้างทุกวัน 19:00 น. (แก้เวลาในบรรทัด atHour ได้ตามต้องการ)
function setupMissingReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkMissingReportsAndNotify') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkMissingReportsAndNotify').timeBased().everyDays(1).atHour(19).inTimezone('Asia/Bangkok').create();
  console.log('ตั้งเวลาเตือนรีพอร์ตค้างทุกวัน 19:00 น. เรียบร้อย');
}

/* ============================================================
 * แจ้งเตือนงานสั่งใหม่ + คลิปที่เพิ่งเปลี่ยนสถานะเป็น Post — เช็คทุก 15 นาที
 * ใช้วิธีจำ id ที่แจ้งไปแล้วไว้ใน Script Properties กันแจ้งซ้ำ (รอบแรกหลังติดตั้งจะจำไว้เฉยๆ ไม่แจ้งของเก่าทั้งหมด)
 * ============================================================ */
function checkNewWorkOrdersAndNotify_(payload, groupId) {
  const props = PropertiesService.getScriptProperties();
  const workOrders = payload.workOrders || [];
  let known = [];
  try { known = JSON.parse(props.getProperty('KNOWN_WORKORDER_IDS') || '[]'); } catch (e) { known = []; }
  const knownSet = {};
  known.forEach(function (id) { knownSet[id] = true; });

  if (known.length === 0 && workOrders.length > 0) {
    props.setProperty('KNOWN_WORKORDER_IDS', JSON.stringify(workOrders.map(function (o) { return o.id; })));
    return; // รอบแรก — จำของเดิมไว้เฉยๆ ไม่แจ้งย้อนหลัง
  }

  const newOnes = workOrders.filter(function (o) { return !knownSet[o.id]; });
  if (newOnes.length > 0) {
    const brands = payload.brands || [];
    newOnes.forEach(function (o) {
      const brand = o.brandId ? brands.find(function (b) { return b.id === o.brandId; }) : null;
      let msg = '📋 มีงานสั่งใหม่เข้ามา:\n' + o.title + '\n';
      msg += 'ประเภท: ' + o.jobType + ' · กำหนดส่ง: ' + formatThaiDate_(o.deadline) + '\n';
      if (o.requestedBy) msg += 'ใครสั่ง: ' + o.requestedBy + '\n';
      if (brand) msg += 'แบรนด์: ' + brand.name + '\n';
      pushText_(groupId, msg);
    });
    props.setProperty('KNOWN_WORKORDER_IDS', JSON.stringify(workOrders.map(function (o) { return o.id; })));
  }
}

function checkNewPostsAndNotify_(payload, groupId) {
  const props = PropertiesService.getScriptProperties();
  const workItems = payload.workItems || [];
  const posted = workItems.filter(function (w) { return w.status === 'Post'; });
  let known = [];
  try { known = JSON.parse(props.getProperty('KNOWN_POSTED_IDS') || '[]'); } catch (e) { known = []; }
  const knownSet = {};
  known.forEach(function (id) { knownSet[id] = true; });

  if (known.length === 0 && posted.length > 0) {
    props.setProperty('KNOWN_POSTED_IDS', JSON.stringify(posted.map(function (w) { return w.id; })));
    return; // รอบแรก — จำของเดิมไว้เฉยๆ ไม่แจ้งย้อนหลัง
  }

  const newlyPosted = posted.filter(function (w) { return !knownSet[w.id]; });
  if (newlyPosted.length > 0) {
    const members = payload.members || [];
    const brands = payload.brands || [];
    newlyPosted.forEach(function (w) {
      const owner = members.find(function (m) { return m.id === w.ownerId; });
      const brand = w.brandId ? brands.find(function (b) { return b.id === w.brandId; }) : null;
      let msg = '🎉 คลิปลงจริงแล้ว!\n' + (w.title || w.description || '(ไม่มีชื่อ)') + '\n';
      if (brand) msg += 'แบรนด์: ' + brand.name + '\n';
      if (owner) msg += 'โดย: ' + owner.name + '\n';
      if (w.linkPost) msg += 'ลิงก์: ' + w.linkPost + '\n';
      pushText_(groupId, msg);
    });
    props.setProperty('KNOWN_POSTED_IDS', JSON.stringify(posted.map(function (w) { return w.id; })));
  }
}

function checkUpdatesAndNotify() {
  const groupId = PropertiesService.getScriptProperties().getProperty('LINE_GROUP_ID');
  if (!groupId) { console.log('ยังไม่มี LINE_GROUP_ID ข้ามการแจ้งเตือนรอบนี้'); return; }
  const payload = fetchSupabasePayload_();
  checkNewWorkOrdersAndNotify_(payload, groupId);
  checkNewPostsAndNotify_(payload, groupId);
}

// รันครั้งเดียวตอนติดตั้ง — เช็คงานสั่งใหม่/คลิป Post ใหม่ทุก 15 นาที
function setupUpdatesTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkUpdatesAndNotify') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkUpdatesAndNotify').timeBased().everyMinutes(15).create();
  console.log('ตั้งเวลาเช็คงานสั่งใหม่/คลิป Post ใหม่ทุก 15 นาที เรียบร้อย');
}

function pushText_(to, text) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/json',
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) console.error('push ข้อความไม่สำเร็จ: ' + res.getResponseCode() + ' ' + res.getContentText());
}

/* ============================================================
 * "บันทึก"/"สั่งงาน" — พิมพ์เล่าเป็นประโยคภาษาไทยอิสระ ให้ Claude ช่วยแยกข้อมูล
 * (มีค่าใช้จ่ายจริงต่อครั้งที่เรียก แต่ถูกมาก ~0.02-0.05 บาท/ข้อความ — ดู SETUP.md ข้อ 11)
 * ============================================================ */
function isAnthropicKeyConfigured_() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || '';
  return key && key.indexOf('วางค่า') !== 0;
}

// เรียก Claude (Haiku 4.5 — ถูกและเร็วพอสำหรับงานแยกข้อมูลสั้นๆ แบบนี้) ให้แยกข้อความเป็น JSON โครงสร้างตายตัว
// คืนค่า null ถ้าเรียกไม่สำเร็จ (โควตาหมด/คีย์ผิด/เน็ตมีปัญหา ฯลฯ) — ผู้เรียกต้องเช็ค null เอง
function callClaudeExtract_(text, todayStr) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const tool = {
    name: 'extract_contentflow_entry',
    description: 'แยกข้อมูลจากข้อความภาษาไทยที่พนักงานพิมพ์ในไลน์ ให้เป็น "รีพอร์ตงานประจำวัน" (daily_report) หรือ "การสั่งงานใหม่" (work_order)',
    input_schema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: ['daily_report', 'work_order', 'unknown'], description: 'unknown ถ้าข้อความนี้ไม่ใช่การรายงานงานหรือสั่งงานจริงๆ' },
        date: { type: 'string', description: 'วันที่ของรีพอร์ต รูปแบบ YYYY-MM-DD เท่านั้น (ถ้าไม่ระบุให้ใช้วันนี้ ถ้าพูดว่าเมื่อวานให้ลบ 1 วันจากวันนี้)' },
        brand_name: { type: 'string', description: 'ชื่อแบรนด์ที่พูดถึง (เช่น HADA, WinkWhite, Dermedy, VitaSoul) ถ้าไม่มีให้เว้นว่าง' },
        work_type: { type: 'string', enum: WORK_TYPES_, description: 'เฉพาะ daily_report — ประเภทงานที่ทำ' },
        quantity: { type: 'number', description: 'เฉพาะ daily_report — จำนวนชิ้น ถ้าไม่ระบุใช้ 1' },
        status: { type: 'string', enum: WORKITEM_STATUS_LIST_, description: 'เฉพาะ daily_report — สถานะงาน ถ้าไม่ระบุให้เดาจากบริบท (เช่น "เสร็จแล้ว"→สำเร็จ)' },
        description: { type: 'string', description: 'รายละเอียดงานสั้นๆ' },
        person_name: { type: 'string', description: 'ชื่อคนที่ทำงานนี้ ถ้าข้อความไม่ได้ระบุชื่อคนอื่นชัดเจนให้เว้นว่าง (จะถือว่าเป็นคนที่พิมพ์เอง)' },
        drive_link: { type: 'string', description: 'ลิงก์ไดรฟ์/URL ถ้ามีในข้อความ' },
        title: { type: 'string', description: 'เฉพาะ work_order — หัวข้อ/รายละเอียดงานที่สั่ง' },
        job_type: { type: 'string', enum: WORKORDER_TYPE_LIST_, description: 'เฉพาะ work_order' },
        deadline: { type: 'string', description: 'เฉพาะ work_order — กำหนดส่ง รูปแบบ YYYY-MM-DD เท่านั้น' },
        requested_by: { type: 'string', description: 'เฉพาะ work_order — ใครเป็นคนสั่งงานนี้ ถ้าไม่ระบุให้เว้นว่าง' }
      },
      required: ['intent']
    }
  };

  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'extract_contentflow_entry' },
    messages: [{
      role: 'user',
      content: 'วันนี้คือวันที่ ' + todayStr + ' (ค.ศ., รูปแบบ YYYY-MM-DD)\n\nข้อความจากพนักงาน:\n' + text
    }]
  };

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    console.error('Claude API error: ' + res.getResponseCode() + ' ' + res.getContentText());
    return null;
  }
  const data = JSON.parse(res.getContentText());
  const toolUse = (data.content || []).find(function (b) { return b.type === 'tool_use'; });
  return toolUse ? toolUse.input : null;
}

function handleFreeTextEntry_(userId, text, replyToken) {
  if (!isAnthropicKeyConfigured_()) {
    replyText_(replyToken, 'ฟีเจอร์นี้ยังไม่ได้ตั้งค่า (ต้องใส่ ANTHROPIC_API_KEY ก่อน) — ให้แอดมินดู SETUP.md ข้อ 11 หรือพิมพ์รีพอร์ตแบบคั่น Tab แทนไปก่อน');
    return;
  }

  const today = todayBangkokISO_();
  const extracted = callClaudeExtract_(text, today);
  if (!extracted || extracted.intent === 'unknown') {
    replyText_(replyToken, 'ไม่เข้าใจข้อความนี้ว่าเป็นรีพอร์ตงานหรือสั่งงาน ลองพิมพ์ให้ชัดเจนขึ้น เช่น\n"บันทึก ตัดคลิป HADA 1 ชิ้น เสร็จแล้ว"\n"สั่งงาน ถ่ายอีเว้นท์เปิดตัว กำหนดส่ง 20 ก.ย."');
    return;
  }

  const payloadNow = fetchSupabasePayload_();
  const members = payloadNow.members || [];
  const brands = payloadNow.brands || [];
  const myMemberName = lookupMemberNameForLineUser_(userId);
  const fallbackMember = myMemberName ? members.find(function (m) { return m.name === myMemberName; }) : null;

  if (extracted.intent === 'work_order') {
    if (!extracted.title || !extracted.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(extracted.deadline)) {
      replyText_(replyToken, 'ต้องระบุอย่างน้อยชื่องานและกำหนดส่งให้ชัดเจน ลองพิมพ์ใหม่ เช่น "สั่งงาน ถ่ายอีเว้นท์เปิดตัว กำหนดส่ง 20 ก.ย."');
      return;
    }
    const brandMatch = extracted.brand_name ? matchBrandByRawName_(extracted.brand_name, brands) : null;
    const order = {
      title: extracted.title, requestedBy: extracted.requested_by || '', brandId: brandMatch ? brandMatch.id : '',
      jobType: WORKORDER_TYPE_LIST_.indexOf(extracted.job_type) >= 0 ? extracted.job_type : 'อื่นๆ',
      deadline: extracted.deadline, status: 'รับทราบ', note: ''
    };
    CacheService.getScriptCache().put('pending_' + userId, JSON.stringify({
      kind: 'workorder', order: order, actorMemberId: fallbackMember ? fallbackMember.id : null
    }), 600);

    let msg = 'แปลงเป็น "สั่งงาน" ได้:\n';
    msg += 'หัวข้อ: ' + order.title + '\n';
    msg += 'ประเภท: ' + order.jobType + ' · กำหนดส่ง: ' + order.deadline + '\n';
    if (order.requestedBy) msg += 'ใครสั่ง: ' + order.requestedBy + '\n';
    if (brandMatch) msg += 'แบรนด์: ' + brandMatch.name + '\n';
    else if (extracted.brand_name) msg += '⚠️ ไม่พบแบรนด์ "' + extracted.brand_name + '" ในระบบ — จะบันทึกแบบไม่ระบุแบรนด์\n';
    msg += '\nพิมพ์ "ยืนยัน" เพื่อบันทึกเข้าระบบ หรือ "ยกเลิก"';
    replyText_(replyToken, msg);
    return;
  }

  // daily_report
  const brandMatch = extracted.brand_name ? matchBrandByRawName_(extracted.brand_name, brands) : null;
  let personMatch = extracted.person_name ? matchMemberByRawName_(extracted.person_name, members) : null;
  if (!personMatch) personMatch = fallbackMember;
  if (!personMatch) {
    replyText_(replyToken, 'ระบบยังไม่รู้จักคุณ — พิมพ์ "ไอดีฉัน" แล้วส่งให้แอดมินผูกชื่อก่อน หรือระบุชื่อคนในข้อความให้ชัดเจน');
    return;
  }

  const entry = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(extracted.date || '') ? extracted.date : today,
    brandId: brandMatch ? brandMatch.id : '',
    description: extracted.description || '',
    driveLink: extracted.drive_link || '',
    status: WORKITEM_STATUS_LIST_.indexOf(extracted.status) >= 0 ? extracted.status : WORKITEM_STATUS_LIST_[0],
    workType: WORK_TYPES_.indexOf(extracted.work_type) >= 0 ? extracted.work_type : 'ตัดคลิป',
    quantity: Number(extracted.quantity) > 0 ? Number(extracted.quantity) : 1,
    personId: personMatch.id, personName: personMatch.name, warnings: []
  };
  if (extracted.brand_name && !brandMatch) entry.warnings.push('ไม่พบแบรนด์ "' + extracted.brand_name + '" ในระบบ');

  CacheService.getScriptCache().put('pending_' + userId, JSON.stringify({ kind: 'report', entries: [entry] }), 600);

  const brandLabel = brandMatch ? brandMatch.name : 'ไม่ระบุแบรนด์';
  let msg = 'แปลงได้:\n' + entry.date + ' · ' + brandLabel + ' · ' + entry.workType + ' ' + entry.quantity + ' ชิ้น · ' +
    (entry.description || '(ไม่มีรายละเอียด)') + ' · ' + entry.personName + ' · ' + entry.status + '\n';
  if (entry.warnings.length) msg += '\n⚠️ ' + entry.warnings.join(', ') + '\n';
  msg += '\nพิมพ์ "ยืนยัน" เพื่อบันทึกเข้าระบบ หรือ "ยกเลิก"';
  replyText_(replyToken, msg);
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

  CacheService.getScriptCache().put('pending_' + userId, JSON.stringify({ kind: 'report', entries: parsed.entries }), 600); // เก็บไว้ 10 นาที

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

    if (parsed.kind === 'workorder') {
      const result = commitWorkOrderToSupabase_(parsed.order, parsed.actorMemberId);
      if (result.ok) {
        replyText_(replyToken, 'บันทึกงาน "' + parsed.order.title + '" เรียบร้อย ✅ ดูได้ที่หน้า "สั่งงาน" ในแอป ContentFlow');
      } else {
        replyText_(replyToken, 'บันทึกไม่สำเร็จ: ' + result.error + '\nลองพิมพ์ใหม่อีกครั้ง หรือกรอกเองในแอปแทน');
      }
      return;
    }

    // แนบรูปที่ค้างไว้ (ถ้ามี) — เฉพาะตอนมีงานเดียวในชุดนี้ กันรูปเดียวไปแปะซ้ำหลายชิ้นงานตอนวางจากชีตทีละหลายแถว
    if (parsed.entries.length === 1) {
      const imgDataUrl = resolvePendingImageDataUrl_(userId);
      if (imgDataUrl) parsed.entries[0].coverImageDataUrl = imgDataUrl;
    }

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
      const workType = entry.workType || 'ตัดคลิป';
      const quantity = entry.quantity > 0 ? entry.quantity : 1;
      const report = {
        id: genId_(), memberId: entry.personId, date: entry.date, workType: workType,
        quantity: quantity, contentPlanId: null, brandId: entry.brandId || '', note: entry.description
      };
      payload.dailyReports.push(report);
      payload.workItems.push({
        id: workId, title: entry.description, date: entry.date, ownerId: entry.personId, brandId: entry.brandId || '',
        workType: workType, quantity: quantity, product: '', description: entry.description,
        location: '', channel: '', coverImageDataUrl: entry.coverImageDataUrl || '', status: entry.status || 'รอตรวจ',
        imageNote: '', driveLink: entry.driveLink || '', postDate: '', linkPost: '', postCoverImageDataUrl: '',
        revisions: [], reportId: report.id
      });
      payload.activityLog.push({
        id: genId_(), memberId: entry.personId, timestamp: new Date().toISOString(),
        module: 'รายงานการทำงาน', action: 'เพิ่มงานผ่านไลน์: ' + workType + ' ' + quantity + ' ชิ้น'
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

// เขียน "สั่งงาน" ใหม่เข้า Supabase แบบกันชนข้อมูล เหมือน commitEntriesToSupabase_
function commitWorkOrderToSupabase_(order, actorMemberId) {
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

    payload.workOrders = payload.workOrders || [];
    payload.activityLog = payload.activityLog || [];
    payload.workOrders.push({
      id: genId_(), title: order.title, requestedBy: order.requestedBy || '', brandId: order.brandId || '',
      jobType: order.jobType, deadline: order.deadline, status: order.status || 'รับทราบ', note: order.note || '', subtasks: []
    });
    payload.activityLog.push({
      id: genId_(), memberId: actorMemberId || null, timestamp: new Date().toISOString(),
      module: 'สั่งงาน', action: 'เพิ่มงานผ่านไลน์: ' + order.title
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

    console.log('รอบที่ ' + attempt + ' (สั่งงาน): มีคนแก้ไขข้อมูลพร้อมกัน code=' + code);
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
const WORK_TYPES_ = ['ตัดคลิป', 'ลงคลิป', 'ถ่ายฟุตเทจ', 'ออกกอง', 'อีเว้นท์', 'พากย์เสียง', 'เขียนสคริปต์', 'อื่นๆ'];
const WORKORDER_TYPE_LIST_ = ['อีเว้นท์', 'งานเพิ่ม', 'อื่นๆ'];

// คำที่คนมักพิมพ์แทนสถานะจริงในระบบ (ใช้กับแพทเทิร์นพิมพ์มีป้ายกำกับด้านล่าง)
const STATUS_ALIASES_ = {
  'เสร็จ': 'สำเร็จ', 'เสร็จแล้ว': 'สำเร็จ', 'สำเร็จแล้ว': 'สำเร็จ',
  'กำลังทำ': 'ดำเนินการ', 'ทำอยู่': 'ดำเนินการ', 'กำลังดำเนินการ': 'ดำเนินการ',
  'รอตรวจงาน': 'รอตรวจ', 'ส่งตรวจ': 'รอตรวจ', 'ตรวจ': 'รอตรวจ',
  'ลงแล้ว': 'Post', 'โพสต์แล้ว': 'Post', 'โพสแล้ว': 'Post', 'โพสต์': 'Post', 'โพส': 'Post', 'post': 'Post'
};

function matchStatusAlias_(raw) {
  const clean = (raw || '').trim();
  if (!clean) return '';
  const exact = WORKITEM_STATUS_LIST_.find(function (s) { return s.toLowerCase() === clean.toLowerCase(); });
  if (exact) return exact;
  return STATUS_ALIASES_[clean] || '';
}

/* ============================================================
 * แพทเทิร์นพิมพ์มีป้ายกำกับ — สำหรับพิมพ์ตรงในไลน์บนมือถือ (ไม่ต้องคั่น Tab ที่พิมพ์เองไม่ได้)
 * ตัวอย่าง (ทำหลายงานในวันเดียวกัน พิมพ์ต่อกันได้เลย เว้นบรรทัดว่างคั่นระหว่างงาน):
 *   วันที่: 8/09/26
 *   แบรนด์: HADA
 *   งาน: ตัดคลิปรีวิวสินค้าใหม่
 *   จำนวน: 1
 *   สถานะ: เสร็จ
 *
 *   วันที่: 8/09/26
 *   แบรนด์: WinkWhite
 *   งาน: ถ่ายฟุตเทจ
 *   จำนวน: 2
 *   สถานะ: ดำเนินการ
 * ฟรี ไม่ใช้ Claude — จับคู่ป้ายกำกับด้วยกฎตายตัวเหมือนแพทเทิร์นคั่น Tab
 * ============================================================ */
function parseLabeledReportBlocks_(text, members, brands) {
  const blocks = text.split(/\n\s*\n+/).map(function (b) { return b.trim(); }).filter(function (b) { return b !== ''; });
  const entries = [];
  let skippedCount = 0;
  blocks.forEach(function (block) {
    const entry = parseLabeledReportText_(block, members, brands);
    if (entry) entries.push(entry);
    else skippedCount++;
  });
  return { entries: entries, skippedCount: skippedCount };
}

function parseLabeledReportText_(text, members, brands) {
  const lines = text.split('\n');
  const fields = {};
  lines.forEach(function (line) {
    const m = line.match(/^\s*([ก-๙A-Za-z]+)\s*[:：]\s*(.*)$/);
    if (!m) return;
    const label = m[1].trim();
    const value = m[2].trim();
    if (/^วันที่/.test(label)) fields.date = value;
    else if (/^แบรนด์/.test(label)) fields.brand = value;
    else if (/^(งาน|รายละเอียด)/.test(label)) fields.description = value;
    else if (/^จำนวน/.test(label)) fields.quantity = value;
    else if (/^สถานะ/.test(label)) fields.status = value;
    else if (/^(คน|ผู้ทำ)/.test(label)) fields.person = value;
    else if (/^(ลิงก์|ไดร์ฟ|ไดรฟ์)/.test(label)) fields.link = value;
    else if (/^ประเภท/.test(label)) fields.workType = value;
  });

  if (!fields.date && !fields.description && !fields.brand) return null; // ไม่เข้าแพทเทิร์นนี้จริงๆ

  const dateVal = fields.date ? parseLinePasteDate_(fields.date) : null;
  const brandMatch = fields.brand ? matchBrandByRawName_(fields.brand, brands) : null;
  const personMatch = fields.person ? matchMemberByRawName_(fields.person, members) : null;

  const warnings = [];
  if (fields.brand && !brandMatch) warnings.push('ไม่พบแบรนด์ "' + fields.brand + '" ในระบบ');
  if (fields.person && !personMatch) warnings.push('ไม่พบชื่อคน "' + fields.person + '"');

  return {
    date: dateVal || todayBangkokISO_(),
    brandId: brandMatch ? brandMatch.id : '',
    description: fields.description || '',
    driveLink: fields.link || '',
    status: matchStatusAlias_(fields.status) || WORKITEM_STATUS_LIST_[0],
    workType: WORK_TYPES_.indexOf(fields.workType) >= 0 ? fields.workType : 'ตัดคลิป',
    quantity: Number(fields.quantity) > 0 ? Number(fields.quantity) : 1,
    personId: personMatch ? personMatch.id : '',
    personName: personMatch ? personMatch.name : '',
    warnings: warnings
  };
}

function handleLabeledReport_(userId, text, replyToken) {
  const payloadNow = fetchSupabasePayload_();
  const members = payloadNow.members || [];
  const brands = payloadNow.brands || [];
  const myMemberName = lookupMemberNameForLineUser_(userId);
  const fallbackMember = myMemberName ? members.find(function (m) { return m.name === myMemberName; }) : null;

  const parsed = parseLabeledReportBlocks_(text, members, brands);
  if (parsed.entries.length === 0) {
    replyText_(replyToken, 'พิมพ์ไม่ครบตามแพทเทิร์น ลองพิมพ์แบบนี้:\nวันที่: 8/09/26\nแบรนด์: HADA\nงาน: ตัดคลิปรีวิวสินค้าใหม่\nจำนวน: 1\nสถานะ: เสร็จ\n\nทำหลายงานวันเดียวกัน พิมพ์ต่อกันได้เลย เว้นบรรทัดว่างคั่นระหว่างงาน');
    return;
  }

  let anyMissingPerson = false;
  parsed.entries.forEach(function (entry) {
    if (!entry.personId) {
      if (fallbackMember) { entry.personId = fallbackMember.id; entry.personName = fallbackMember.name; }
      else anyMissingPerson = true;
    }
  });
  if (anyMissingPerson) {
    replyText_(replyToken, 'ระบบยังไม่รู้จักคุณ — พิมพ์ "ไอดีฉัน" แล้วส่งให้แอดมินผูกชื่อก่อน หรือเพิ่มบรรทัด "คน: ชื่อของคุณ" ในแต่ละงาน');
    return;
  }

  // แนบรูปได้เฉพาะตอนมีงานเดียวในข้อความนี้ (หลายงานแล้วไม่รู้จะแนบรูปให้ชิ้นไหน)
  const hasPendingImage = parsed.entries.length === 1 && !!CacheService.getScriptCache().get('pending_img_' + userId);

  CacheService.getScriptCache().put('pending_' + userId, JSON.stringify({ kind: 'report', entries: parsed.entries }), 600);

  let msg = 'แปลงได้ ' + parsed.entries.length + ' งาน:\n';
  parsed.entries.forEach(function (entry, i) {
    const brandLabel = entry.brandId ? (brands.find(function (b) { return b.id === entry.brandId; }) || {}).name : 'ไม่ระบุแบรนด์';
    msg += (i + 1) + '. ' + entry.date + ' · ' + brandLabel + ' · ' + entry.workType + ' ' + entry.quantity + ' ชิ้น · ' +
      (entry.description || '(ไม่มีรายละเอียด)') + ' · ' + entry.personName + ' · ' + entry.status + '\n';
  });
  if (hasPendingImage) msg += '📷 แนบรูปที่เพิ่งส่งให้ด้วย\n';
  if (parsed.skippedCount > 0) msg += '\n⚠️ ข้ามไป ' + parsed.skippedCount + ' บล็อกที่พิมพ์ไม่ครบตามแพทเทิร์น\n';
  const allWarnings = parsed.entries.reduce(function (arr, en) { return arr.concat(en.warnings); }, []);
  if (allWarnings.length) msg += '\n⚠️ ' + allWarnings.join(', ') + '\n';
  msg += '\nพิมพ์ "ยืนยัน" เพื่อบันทึกเข้าระบบ หรือ "ยกเลิก"';
  replyText_(replyToken, msg);
}

/* ============================================================
 * รูปที่ส่งมาในไลน์ — เก็บชั่วคราวใน Drive (Cache เก็บรูปใหญ่ไม่ได้ จำกัด 100KB/ค่า)
 * ผูกกับรีพอร์ตที่กำลังจะยืนยันโดยอัตโนมัติ ไม่ว่าจะส่งรูปก่อนหรือหลังพิมพ์รีพอร์ตก็ได้ (ภายใน 10 นาที)
 * ============================================================ */
function handleImageMessage_(userId, messageId, replyToken) {
  if (!userId) return;
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + messageId + '/content', {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('ดึงรูปจากไลน์ไม่สำเร็จ: ' + res.getResponseCode());
    replyText_(replyToken, 'ดึงรูปไม่สำเร็จ ลองส่งใหม่อีกครั้ง');
    return;
  }
  const blob = res.getBlob();
  let file;
  try {
    file = DriveApp.createFile(blob).setName('linebot_tmp_' + userId + '_' + Date.now());
  } catch (e) {
    console.error('บันทึกรูปชั่วคราวไม่สำเร็จ: ' + e.message);
    replyText_(replyToken, 'บันทึกรูปไม่สำเร็จ (ปัญหาสิทธิ์ Google Drive) ลองใหม่หรือแนบรูปในแอปแทน');
    return;
  }
  CacheService.getScriptCache().put('pending_img_' + userId, file.getId(), 600);
  replyText_(replyToken, '📷 ได้รับรูปแล้ว พิมพ์รายงานงานตามมาได้เลย (แบบมีป้าย "วันที่: ...") จะแนบรูปนี้ให้อัตโนมัติ');
}

// เรียกตอนจะยืนยันบันทึกจริง — แปลงรูปที่ค้างไว้ใน Drive กลับเป็น base64 แล้วลบไฟล์ชั่วคราวทิ้ง
function resolvePendingImageDataUrl_(userId) {
  const cache = CacheService.getScriptCache();
  const fileId = cache.get('pending_img_' + userId);
  if (!fileId) return '';
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const mimeType = blob.getContentType() || 'image/jpeg';
    const base64 = Utilities.base64Encode(blob.getBytes());
    file.setTrashed(true);
    cache.remove('pending_img_' + userId);
    return 'data:' + mimeType + ';base64,' + base64;
  } catch (e) {
    console.error('resolvePendingImageDataUrl_ พัง: ' + e.message);
    return '';
  }
}
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
