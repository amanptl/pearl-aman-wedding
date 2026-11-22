/**
 * Wedding RSVP backend (Google Apps Script web app). See README.md.
 * POST  payload=<JSON>            -> upserts Responses (one row per household and event: how many are coming) and
 *                                    Households (names, food counts, travel), appends History
 * Payload (v2): { v, code, household, seats, eventSeats:{eventId:n}, submittedAt, counts:{eventId:n},
 *                 namesByEvent:{eventId:string[]}, names, diet:{label:n}, dietNote, extras }
 * GET   ?action=get&code=CODE     -> { ok, P }
 * GET   ?action=summary&key=KEY   -> { ok, households, responses, counts, dietary, meals }
 */
var CODE_RE = /^[A-Z2-9]{10}$/;
var SHEETS = {
  Responses: ['code', 'household', 'eventId', 'invited', 'attending', 'updatedAt'],
  Households: ['code', 'household', 'invited', 'names', 'dietary', 'dietNote', 'hotel', 'arrival', 'departure', 'flight', 'flightTime', 'address', 'shuttle', 'phone', 'song', 'message', 'submittedAt'],
  History: ['receivedAt', 'code', 'payload']
};
var LIMITS = { events: 30, seats: 50, diet: 30, str: 500, long: 2000, payload: 60000 };
var EVENT_RE = /^[A-Za-z0-9_-]{1,40}$/;

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
  var seats = Number(P.seats);
  if (!(seats >= 1 && seats <= LIMITS.seats && Math.floor(seats) === seats)) throw new Error('Bad seats');
  var count = function (v) {
    var n = Number(v);
    if (!(n >= 0 && n <= LIMITS.seats && Math.floor(n) === n)) throw new Error('Bad count');
    return n;
  };
  if (!P.counts || typeof P.counts !== 'object' || Array.isArray(P.counts)) throw new Error('Bad counts');
  var evIds = Object.keys(P.counts);
  if (evIds.length < 1 || evIds.length > LIMITS.events) throw new Error('Bad counts');
  var eventSeatsIn = P.eventSeats && typeof P.eventSeats === 'object' && !Array.isArray(P.eventSeats) ? P.eventSeats : {};
  var eventSeats = {};
  Object.keys(eventSeatsIn).forEach(function (id) {
    if (!EVENT_RE.test(id)) throw new Error('Bad event id');
    var n = count(eventSeatsIn[id]);
    if (n > 0) eventSeats[id] = Math.min(n, LIMITS.seats);
  });
  var counts = {};
  evIds.forEach(function (id) {
    if (!EVENT_RE.test(id)) throw new Error('Bad event id');
    var cap = eventSeats[id] != null ? eventSeats[id] : seats;
    counts[id] = Math.min(count(P.counts[id]), cap);
    if (eventSeats[id] == null) eventSeats[id] = seats;
  });
  var top = 0;
  evIds.forEach(function (id) { top = Math.max(top, counts[id]); });
  var namesByEvent = {};
  var namesIn = P.namesByEvent && typeof P.namesByEvent === 'object' && !Array.isArray(P.namesByEvent) ? P.namesByEvent : null;
  if (namesIn) {
    Object.keys(namesIn).forEach(function (id) {
      if (!EVENT_RE.test(id)) throw new Error('Bad event id');
      var attending = counts[id] || 0;
      var list = namesIn[id];
      if (!Array.isArray(list)) throw new Error('Bad namesByEvent');
      if (list.length > attending) throw new Error('Too many names');
      namesByEvent[id] = list.slice(0, attending).map(function (n) { return str_(n, 80); });
    });
  }
  var dietIn = P.diet && typeof P.diet === 'object' && !Array.isArray(P.diet) ? P.diet : {};
  var labels = Object.keys(dietIn);
  if (labels.length > LIMITS.diet) throw new Error('Bad diet');
  var diet = {};
  labels.forEach(function (k) {
    var label = str_(k, 60).replace(/[:;\r\n]/g, ' ').trim();
    var n = Math.min(count(dietIn[k]), top);
    if (label && n > 0) diet[label] = n;
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
    v: 2,
    household: str_(P.household, 120),
    submittedAt: str_(P.submittedAt, 40) || new Date().toISOString(),
    seats: seats,
    eventSeats: eventSeats,
    counts: counts,
    namesByEvent: namesByEvent,
    names: str_(P.names, 1000),
    diet: diet,
    dietNote: str_(P.dietNote, LIMITS.str),
    extras: {
      hotel: str_(x.hotel, 20), arrival: str_(x.arrival, 20), departure: str_(x.departure, 20),
      flight: str_(x.flight, 80), flightTime: str_(x.flightTime, 20), address: str_(x.address, LIMITS.long),
      shuttle: shuttle, phone: str_(x.phone, 40), song: str_(x.song, 200), message: str_(x.message, LIMITS.long)
    }
  };
}

/** {Jain: 2, Vegetarian: 3} -> "Jain: 2; Vegetarian: 3" (readable in the Sheet; parsed back by the summary). */
function dietText_(d) {
  return safe_(Object.keys(d || {}).map(function (k) { return k + ': ' + d[k]; }).join('; '));
}
function dietParse_(s) {
  var out = {};
  String(s || '').split(';').forEach(function (part) {
    var m = /^\s*(.+?):\s*(\d+)\s*$/.exec(part);
    if (m) out[m[1]] = (out[m[1]] || 0) + Number(m[2]);
  });
  return out;
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

    // Responses: upsert by (code, eventId); rows for events no longer in the payload are deleted.
    var rs = sheet_('Responses');
    var data = rs.getLastRow() > 1 ? rs.getRange(2, 1, rs.getLastRow() - 1, SHEETS.Responses.length).getValues() : [];
    var existing = {};
    data.forEach(function (row, i) { if (String(row[0]) === P.code) existing[unsafe_(String(row[2]))] = i + 2; });
    var keep = {};
    var appendRows = [];
    Object.keys(P.counts).forEach(function (eventId) {
      keep[eventId] = true;
      var invited = (P.eventSeats && P.eventSeats[eventId] != null) ? P.eventSeats[eventId] : P.seats;
      var vals = [P.code, safe_(P.household), safe_(eventId), invited, P.counts[eventId], now];
      if (existing[eventId]) rs.getRange(existing[eventId], 1, 1, vals.length).setValues([vals]);
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
    var hrow = [P.code, safe_(P.household), P.seats, safe_(P.names), dietText_(P.diet), safe_(P.dietNote), safe_(x.hotel), safe_(x.arrival), safe_(x.departure), safe_(x.flight), safe_(x.flightTime), safe_(x.address), JSON.stringify(x.shuttle), safe_(x.phone), safe_(x.song), safe_(x.message), safe_(P.submittedAt)];
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
    // counts[eventId] = { coming: people, invited: seats of replying households, households: replies, declined: replies with 0 }
    var counts = {}, dietary = {};
    responses.forEach(function (r) {
      var c = counts[r.eventId] || (counts[r.eventId] = { coming: 0, invited: 0, households: 0, declined: 0 });
      var n = Number(r.attending) || 0;
      c.coming += n; c.invited += Number(r.invited) || 0; c.households++;
      if (!n) c.declined++;
    });
    households.forEach(function (h) {
      var d = dietParse_(h.dietary);
      Object.keys(d).forEach(function (k) { dietary[k] = (dietary[k] || 0) + d[k]; });
    });
    return json_({ ok: true, households: households, responses: responses, counts: counts, dietary: dietary });
  }
  return ContentService.createTextOutput('ok');
}
