/**
 * Wedding RSVP backend (Google Apps Script web app). See README.md.
 * POST  payload=<JSON>            -> upserts Responses/Households, appends History
 * GET   ?action=get&code=CODE     -> { ok, P }
 * GET   ?action=summary&key=KEY   -> { ok, households, responses, counts, dietary, meals }
 */
var CODE_RE = /^[A-Z2-9]{10}$/;
var SHEETS = {
  Responses: ['code', 'household', 'memberId', 'name', 'eventId', 'attending', 'meal', 'dietary', 'updatedAt'],
  Households: ['code', 'household', 'hotel', 'arrival', 'departure', 'flight', 'flightTime', 'address', 'shuttle', 'phone', 'song', 'message', 'submittedAt'],
  History: ['receivedAt', 'code', 'payload']
};
var LIMITS = { members: 12, responses: 120, str: 500, long: 2000, payload: 60000 };

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var headers = SHEETS[name];
  if (sh.getLastRow() === 0) {
    // Plain-text columns: stops Sheets turning "2027-07-22" / "14:05" into dates and times (which then come back as shifted ISO
    // timestamps in the summary) and keeps "=..." as text. Applied once, when the tab is first created.
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function str_(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  if (s.length > max) throw new Error('Field too long');
  return s;
}

/** Validate the payload shape and sizes; returns a cleaned copy or throws. */
function validate_(P) {
  if (!P || typeof P !== 'object') throw new Error('Bad payload');
  if (typeof P.code !== 'string' || !CODE_RE.test(P.code)) throw new Error('Bad code');
  if (!Array.isArray(P.members) || P.members.length < 1 || P.members.length > LIMITS.members) throw new Error('Bad members');
  if (!Array.isArray(P.responses) || P.responses.length > LIMITS.responses) throw new Error('Bad responses');
  var ids = {};
  var members = P.members.map(function (m) {
    if (!m || typeof m !== 'object') throw new Error('Bad member');
    var id = str_(m.id, 20);
    if (!/^[mp]\d{1,3}$/.test(id)) throw new Error('Bad member id');
    ids[id] = true;
    return { id: id, name: str_(m.name, 120), meal: str_(m.meal, LIMITS.str), dietary: str_(m.dietary, LIMITS.str) };
  });
  var responses = P.responses.map(function (r) {
    if (!r || !ids[r.memberId]) throw new Error('Response for unknown member');
    if (r.attending !== 'yes' && r.attending !== 'no') throw new Error('Bad attending');
    var eventId = str_(r.eventId, 40);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(eventId)) throw new Error('Bad event id');
    return { memberId: r.memberId, eventId: eventId, attending: r.attending };
  });
  // The same (member, event) twice would otherwise append duplicate rows; the last answer wins.
  var seen = {};
  responses = responses.filter(function (r, i) {
    var k = r.memberId + '|' + r.eventId;
    var last = true;
    for (var j = i + 1; j < responses.length; j++) if (responses[j].memberId + '|' + responses[j].eventId === k) { last = false; break; }
    if (!last || seen[k]) return false;
    seen[k] = true;
    return true;
  });
  var x = P.extras || {};
  var shuttle = {};
  var sh = x.shuttle && typeof x.shuttle === 'object' ? x.shuttle : {};
  Object.keys(sh).slice(0, 20).forEach(function (k) {
    var n = Number(sh[k]);
    if (n > 0 && n <= 50) shuttle[str_(k, 40)] = Math.floor(n);
  });
  return {
    code: P.code,
    household: str_(P.household, 120),
    submittedAt: str_(P.submittedAt, 40) || new Date().toISOString(),
    members: members,
    responses: responses,
    extras: {
      hotel: str_(x.hotel, 20), arrival: str_(x.arrival, 20), departure: str_(x.departure, 20),
      flight: str_(x.flight, 80), flightTime: str_(x.flightTime, 20), address: str_(x.address, LIMITS.long),
      shuttle: shuttle, phone: str_(x.phone, 40), song: str_(x.song, 200), message: str_(x.message, LIMITS.long)
    }
  };
}

/** Neutralise spreadsheet formula injection (=, +, -, @, and leading tab/CR, which Excel also treats as formula starts). */
function safe_(v) {
  v = v === null || v === undefined ? '' : v;
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

/** Undo safe_ when reading back, so the editor sees the guest's real text. */
function unsafe_(v) {
  return typeof v === 'string' && /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  // waitLock throws when another submission holds the lock for 20 s; answer with JSON instead of Apps Script's HTML error page.
  try { lock.waitLock(20000); } catch (err) { return json_({ ok: false, error: 'Busy, please try again' }); }
  try {
    var raw = e && e.parameter && e.parameter.payload;
    if (!raw || raw.length > LIMITS.payload) return json_({ ok: false, error: 'Bad request' });
    var P;
    try { P = validate_(JSON.parse(raw)); } catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
    var now = new Date().toISOString();

    // Responses: upsert by (code, memberId, eventId); rows for removed members/events are deleted.
    var rs = sheet_('Responses');
    var data = rs.getLastRow() > 1 ? rs.getRange(2, 1, rs.getLastRow() - 1, SHEETS.Responses.length).getValues() : [];
    var existing = {};
    data.forEach(function (row, i) { if (String(row[0]) === P.code) existing[row[2] + '|' + row[4]] = i + 2; });
    var names = {};
    P.members.forEach(function (m) { names[m.id] = m; });
    var keep = {};
    var appendRows = [];
    P.responses.forEach(function (r) {
      var m = names[r.memberId];
      var key = r.memberId + '|' + r.eventId;
      keep[key] = true;
      var vals = [P.code, safe_(P.household), r.memberId, safe_(m.name), safe_(r.eventId), r.attending, safe_(m.meal), safe_(m.dietary), now];
      if (existing[key]) rs.getRange(existing[key], 1, 1, vals.length).setValues([vals]);
      else appendRows.push(vals);
    });
    Object.keys(existing).filter(function (k) { return !keep[k]; })
      .map(function (k) { return existing[k]; })
      .sort(function (a, b) { return b - a; })
      .forEach(function (rowNo) { rs.deleteRow(rowNo); });
    if (appendRows.length) rs.getRange(rs.getLastRow() + 1, 1, appendRows.length, SHEETS.Responses.length).setValues(appendRows);

    // Households: one row per code.
    var hs = sheet_('Households');
    var x = P.extras;
    var hrow = [P.code, safe_(P.household), safe_(x.hotel), safe_(x.arrival), safe_(x.departure), safe_(x.flight), safe_(x.flightTime), safe_(x.address), JSON.stringify(x.shuttle), safe_(x.phone), safe_(x.song), safe_(x.message), safe_(P.submittedAt)];
    var codes = hs.getLastRow() > 1 ? hs.getRange(2, 1, hs.getLastRow() - 1, 1).getValues() : [];
    var at = -1;
    for (var i = 0; i < codes.length; i++) if (String(codes[i][0]) === P.code) { at = i + 2; break; }
    if (at > 0) hs.getRange(at, 1, 1, hrow.length).setValues([hrow]);
    else hs.getRange(hs.getLastRow() + 1, 1, 1, hrow.length).setValues([hrow]);

    // History: raw audit trail.
    var hist = sheet_('History');
    hist.getRange(hist.getLastRow() + 1, 1, 1, 3).setValues([[now, P.code, JSON.stringify(P)]]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: 'Server error' });
  } finally {
    lock.releaseLock();
  }
}

function latest_(code) {
  var hist = sheet_('History');
  var last = hist.getLastRow();
  if (last < 2) return null;
  // One read of the code column (not one read per row), then one read of the matching row.
  var codes = hist.getRange(2, 2, last - 1, 1).getValues();
  for (var i = codes.length - 1; i >= 0; i--) {
    if (String(codes[i][0]) === code) {
      try { return JSON.parse(hist.getRange(i + 2, 3, 1, 1).getValues()[0][0]); } catch (e) { return null; }
    }
  }
  return null;
}

function doGet(e) {
  try { return doGet_(e); } catch (err) { return json_({ ok: false, error: 'Server error' }); }
}

function doGet_(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'get') {
    var code = String(p.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return json_({ ok: false, P: null });
    return json_({ ok: true, P: latest_(code) });
  }
  if (p.action === 'summary') {
    var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
    if (!key || p.key !== key) return json_({ ok: false, error: 'Unauthorized' });
    var rs = sheet_('Responses'), hs = sheet_('Households');
    var rv = rs.getLastRow() > 1 ? rs.getRange(2, 1, rs.getLastRow() - 1, SHEETS.Responses.length).getValues() : [];
    var hv = hs.getLastRow() > 1 ? hs.getRange(2, 1, hs.getLastRow() - 1, SHEETS.Households.length).getValues() : [];
    var toObj = function (cols) { return function (r) { var o = {}; cols.forEach(function (h, i) { o[h] = unsafe_(r[i]); }); return o; }; };
    var responses = rv.map(toObj(SHEETS.Responses));
    var households = hv.map(toObj(SHEETS.Households));
    var counts = {}, dietary = {}, meals = {};
    responses.forEach(function (r) {
      var c = counts[r.eventId] || (counts[r.eventId] = { yes: 0, no: 0 });
      if (r.attending === 'yes') {
        c.yes++;
        if (r.meal) meals[r.meal] = (meals[r.meal] || 0) + 1;
        String(r.dietary || '').split(';').forEach(function (d) { d = d.trim(); if (d) dietary[d] = (dietary[d] || 0) + 1; });
      } else c.no++;
    });
    return json_({ ok: true, households: households, responses: responses, counts: counts, dietary: dietary, meals: meals });
  }
  return ContentService.createTextOutput('ok');
}
