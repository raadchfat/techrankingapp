/**
 * BOARD FEED — this replaces the entire Zapier → Drive → Apps Script → Sheets chain.
 *
 * GET /.netlify/functions/board-feed
 *   ?range=mtd   (default) month-to-date
 *   ?range=wtd   week-to-date
 *   ?range=ytd   year-to-date
 *   ?debug=1     include diagnostics about parameter resolution
 *
 * Returns the roster already filtered, assigned to boards, and scored
 * against targets — so the HTML board just paints what it's given.
 */

const { getReportMeta, getReportData } = require('./_st');
const cfg = require('../../config/board-config.json');

const TZ = cfg.timezone || 'America/Chicago';

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const range = (qs.range || 'mtd').toLowerCase();
  const debug = qs.debug === '1';

  try {
    const meta = await getReportMeta(cfg.report.category, cfg.report.id);
    const { parameters, notes } = buildParameters(meta, range);
    const { rows, fields } = await getReportData(
      cfg.report.category,
      cfg.report.id,
      parameters
    );

    const techs = rows.map(normalizeRow).filter(isRealTech).filter(notExcluded);

    const boards = {};
    for (const key of cfg.boards.order) {
      boards[key] = {
        title: cfg.boards.titles[key] || key,
        target: targetFor(key, range),
        rankedBy: (cfg.rankBy || {})[key] || 'pctToGoal',
        techs: techs.filter((t) => boardFor(t) === key),
      };
    }

    addForceShows(boards, range);

    // Score and rank only after force-shows are in, so placeholder techs
    // are ranked alongside everyone else instead of being appended last.
    for (const key of Object.keys(boards)) {
      boards[key].techs = scoreAndSort(boards[key].techs, boards[key].target, key);
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      range,
      periodLabel: labelFor(range),
      source: 'servicetitan-reporting-api',
      boards,
    };

    if (debug) {
      payload.debug = {
        parametersSent: parameters,
        parameterNotes: notes,
        fieldNames: fields.map((f) => f.name),
        rowCount: rows.length,
        droppedRows: rows.length - techs.length,
      };
    }

    return json(200, payload);
  } catch (err) {
    return json(500, { ok: false, error: err.message });
  }
};

/* ---------------- parameter resolution ---------------- */

/**
 * The report defines its own parameter names. We read them from the meta
 * and fill in what we recognize, rather than hardcoding names that will
 * silently break if the report is ever edited.
 */
function buildParameters(meta, range) {
  const defs = meta.parameters || [];
  const { from, to } = dateRange(range);
  const notes = [];
  const parameters = [];

  for (const p of defs) {
    const name = p.name;
    const lower = String(name).toLowerCase();
    const override = cfg.report.parameterOverrides || {};

    if (Object.prototype.hasOwnProperty.call(override, name)) {
      parameters.push({ name, value: override[name] });
      notes.push(`${name}: from config override`);
    } else if (lower === 'from' || lower.includes('start') || lower.includes('datefrom')) {
      parameters.push({ name, value: from });
      notes.push(`${name}: date range start = ${from}`);
    } else if (lower === 'to' || lower.includes('end') || lower.includes('dateto')) {
      parameters.push({ name, value: to });
      notes.push(`${name}: date range end = ${to}`);
    } else if (p.isRequired) {
      // Required but unrecognized — send null and let ST apply its default,
      // and flag it loudly so we can add an override.
      parameters.push({ name, value: null });
      notes.push(`${name}: REQUIRED but unmapped — add to parameterOverrides if wrong`);
    }
  }

  return { parameters, notes };
}

function dateRange(range) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const today = `${y}-${m}-${d}`;

  if (range === 'ytd') return { from: `${y}-01-01`, to: today };
  if (range === 'wtd') {
    const dt = new Date(`${today}T12:00:00Z`);
    const dow = dt.getUTCDay(); // 0 = Sunday
    dt.setUTCDate(dt.getUTCDate() - dow);
    return { from: dt.toISOString().slice(0, 10), to: today };
  }
  return { from: `${y}-${m}-01`, to: today }; // mtd
}

function labelFor(range) {
  return { mtd: 'Month to Date', wtd: 'Week to Date', ytd: 'Year to Date' }[range] || 'Month to Date';
}

/* ---------------- row shaping ---------------- */

function pick(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== null) return row[c];
  }
  return null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[$,%,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Field names below are the ServiceTitan API names (camelCase), confirmed
 * against /api/report-meta. The Excel export shows *labels*, which are
 * different strings — each pick() lists the API name first, then the label
 * as a fallback so a hand-pasted export still parses.
 */
function normalizeRow(row) {
  const name = String(pick(row, ['Name']) || '').trim();
  const unit = String(
    pick(row, ['TechnicianBusinessUnit', 'Technician Business Unit']) || ''
  ).trim();

  return {
    name,
    unit,
    dailyGoal: num(pick(row, ['DailyGoal', 'Daily Goal'])),
    revenue: num(pick(row, ['CompletedRevenueWithAdjustments', 'Completed Revenue with Adjustments'])),
    completedJobs: num(pick(row, ['CompletedJobs', 'Completed Jobs'])),
    opportunity: num(pick(row, ['Opportunity'])),
    convertedJobs: num(pick(row, ['ConvertedJobs', 'Converted Jobs'])),
    jobAverage: num(pick(row, ['TotalJobAverage', 'Total Job Average'])),
    conversionRate: num(pick(row, ['TotalConversionRate', 'Total Conversion Rate'])),
    closeRate: num(pick(row, ['CloseRate', 'Close Rate'])),
    totalSales: num(pick(row, ['TotalSales', 'Total Sales'])),
    avgSale: num(pick(row, ['ClosedAverageSale', 'Closed Average Sale'])),
    optionsPerOpp: num(pick(row, ['OptionsPerOpportunity', 'Options per Opportunity'])),
    leadsSet: num(pick(row, ['LeadsSet', 'Leads Set'])),
    onTimePct: num(pick(row, ['OnTimePercentage', 'Appts On Time Percentage'])),
    billableEfficiency: num(pick(row, ['BillableEfficiency', 'Billable Efficiency'])),
    membershipConv: num(pick(row, ['MembershipConversionRate', 'Tech Membership Conversion Rate'])),
    techLeadJobs: num(pick(row, ['TechLeadJobs', 'Tech Lead Jobs'])),
    marketingLeadJobs: num(pick(row, ['MarketingLeadJobs', 'Marketing Lead Jobs'])),
    tglSales: num(pick(row, ['TotalSalesFromTgl', 'Total Sales from TGL'])),
    tglCloseRate: num(pick(row, ['CloseRateFromTgl', 'Close Rate from TGL'])),
    marketingSales: num(pick(row, ['TotalSalesFromMarketingLeads', 'Total Sales from Marketing Leads'])),
    photo: (cfg.photos || {})[name] || null,
    role: (cfg.roles || {})[name] || cfg.roleDefault || 'Technician',
  };
}

/**
 * The Excel export carries a trailing total row (a bare count in the Name
 * column). Anything without a real name or business unit is not a technician.
 */
function isRealTech(t) {
  if (!t.name) return false;
  if (/^\d+$/.test(t.name)) return false;
  if (!t.unit) return false;
  return true;
}

function notExcluded(t) {
  return !(cfg.exclude || []).includes(t.name);
}

/* ---------------- board assignment ---------------- */

function boardFor(t) {
  const assign = cfg.assign || {};
  if (assign[t.name]) return assign[t.name];

  const unit = t.unit.toLowerCase();
  for (const [key, patterns] of Object.entries(cfg.boards.unitMatch || {})) {
    if (patterns.some((p) => unit.includes(p.toLowerCase()))) return key;
  }
  return (cfg.homeBoard || {})[t.name] || null;
}

/**
 * Force-show keeps the board populated from day one of the month, before
 * any ServiceTitan activity has posted.
 */
function addForceShows(boards, range) {
  for (const [name, boardKey] of Object.entries(cfg.forceShow || {})) {
    const b = boards[boardKey];
    if (!b) continue;
    if (b.techs.some((t) => t.name === name)) continue;
    const blank = normalizeRow({ Name: name });
    b.techs.push({ ...blank, noActivity: true });
  }
}

/* ---------------- targets ---------------- */

/**
 * Per-tech prorated targets.
 *
 * Each board carries one monthly revenue goal that applies to every tech on
 * it. Prorating to elapsed business days stops the first two weeks of every
 * month from being uniformly red, which is what trains a team to ignore the
 * colors entirely.
 *
 * Note: because the goal is uniform within a board, ranking by percent-to-goal
 * produces the same order as ranking by revenue. It changes what the number
 * *means* (pace vs. raw dollars), not who sits where.
 */
function targetFor(boardKey, range) {
  const t = (cfg.targets || {})[boardKey];
  if (!t) return null;

  const monthly = t.perTechMonthlyRevenue || 0;
  if (!cfg.prorateTargets || range !== 'mtd') {
    return { perTechMonthly: monthly, perTechToDate: monthly, prorated: false };
  }

  const { elapsed, total } = businessDayProgress();
  const toDate = total > 0 ? Math.round((monthly * elapsed) / total) : monthly;
  return {
    perTechMonthly: monthly,
    perTechToDate: toDate,
    prorated: true,
    businessDaysElapsed: elapsed,
    businessDaysInMonth: total,
  };
}

/** Attach percent-to-goal to each tech and sort by the board's chosen metric. */
function scoreAndSort(techs, target, boardKey) {
  const goal = target && target.perTechToDate ? target.perTechToDate : 0;

  const scored = techs.map((t) => ({
    ...t,
    goalToDate: goal,
    goalMonthly: target ? target.perTechMonthly : 0,
    pctToGoal: goal > 0 ? t.revenue / goal : 0,
    onTarget: goal > 0 ? t.revenue >= goal : false,
  }));

  const metric = (cfg.rankBy || {})[boardKey] || 'pctToGoal';
  const key = {
    pctToGoal: (t) => t.pctToGoal,
    revenue: (t) => t.revenue,
    jobAverage: (t) => t.jobAverage,
    completedJobs: (t) => t.completedJobs,
  }[metric] || ((t) => t.pctToGoal);

  scored.sort((a, b) => key(b) - key(a));
  scored.forEach((t, i) => {
    t.rank = i + 1;
  });
  return scored;
}

function businessDayProgress() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const y = get('year');
  const m = get('month');
  const today = get('day');

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const workDays = cfg.workDays || [1, 2, 3, 4, 5, 6]; // Mon–Sat

  let elapsed = 0;
  let total = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (!workDays.includes(dow)) continue;
    total++;
    if (d <= today) elapsed++;
  }
  return { elapsed, total };
}

/* ---------------- response ---------------- */

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
    body: JSON.stringify(body),
  };
}
