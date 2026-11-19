const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TERM_CODE = 20271;
const SCHOOL_CODE = 'ACAD';
const PROGRAM_CODES = ['ACAD', 'IDSN', 'PRIN'];
const API_URL = 'https://classes.usc.edu/api/Courses/CoursesByTermSchoolProgram';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data.js');
const PROGRAM_NAMES = { ACAD: 'Undergraduate ACAD', IDSN: 'Graduate IDSN', PRIN: 'Product Innovation' };

function readState(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { timeout: 1000 });
  if (context.window.dashboardData?.termCode !== TERM_CODE) {
    throw new Error('Refusing to refresh a file that is not explicitly Spring 2027 (20271).');
  }
  return context.window;
}

function seatCount(value, field, sectionId, optional = false) {
  if (optional && (value === null || value === undefined)) return null;
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    throw new Error(`Missing ${field} for USC section ${sectionId}; keeping previous snapshot.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Invalid ${field} for USC section ${sectionId}; keeping previous snapshot.`);
  }
  return number;
}

async function fetchProgram(program, fetcher = fetch) {
  const url = new URL(API_URL);
  url.searchParams.set('termCode', TERM_CODE);
  url.searchParams.set('school', SCHOOL_CODE);
  url.searchParams.set('program', program);
  const response = await fetcher(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'iya-spring-2027-enrollment-refresh' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`USC ${program} request failed: HTTP ${response.status}. Previous data was not changed.`);
  const data = await response.json();
  if (!Array.isArray(data.courses)) throw new Error(`USC ${program} response is missing the courses array.`);
  return data.courses.map(course => ({ ...course, requestedProgram: program }));
}

function buildSections(courseLists) {
  const records = new Map();
  for (const course of courseLists.flat()) {
    const prefix = course.scheduledCourseCode?.prefix;
    if (!PROGRAM_CODES.includes(prefix)) continue; // Non-IYA scheduled cross-listings are not duplicated.
    if (!Array.isArray(course.sections)) throw new Error('USC course is missing its sections array.');
    for (const section of course.sections) {
      if (!/^\d+$/.test(String(section.sisSectionId ?? ''))) throw new Error('USC section is missing a valid SIS section ID.');
      const sectionId = String(section.sisSectionId);
      const previous = records.get(sectionId);
      if (!previous || course.requestedProgram === prefix) records.set(sectionId, { course, section, prefix });
    }
  }
  if (!records.size) throw new Error('USC returned no tracked sections; refusing to replace the snapshot with an empty data set.');
  return [...records.values()].map(({ course, section, prefix }) => {
    const sectionId = String(section.sisSectionId);
    const enrolled = seatCount(section.registeredSeats, 'registeredSeats', sectionId);
    const capacity = seatCount(section.totalSeats, 'totalSeats', sectionId);
    const waitlisted = seatCount(section.waitlistedSeats, 'waitlistedSeats', sectionId, true);
    // Only explicit boolean cancellation flags are trusted; other API status schemas require review.
    const cancelled = section.isCancelled === true || section.isCanceled === true;
    return {
      program: PROGRAM_NAMES[prefix],
      course: `${course.scheduledCourseCode.courseSpace || prefix} ${course.name || ''}`.trim(),
      section: sectionId,
      instructor: (section.instructors || []).map(i => [i.firstName, i.lastName].filter(Boolean).join(' ')).filter(Boolean).join(', ') || 'TBD',
      enrolled, capacity, waitlisted,
      metrics: !cancelled && capacity > 0,
      ...(cancelled ? { note: 'Cancelled — excluded from metrics' } : capacity === 0 ? { note: 'No offered capacity — excluded from metrics' } : {})
    };
  }).sort((a, b) => a.program.localeCompare(b.program) || a.course.localeCompare(b.course) || a.section.localeCompare(b.section));
}

function createSnapshot(state, sections, now = new Date()) {
  const previous = state.dashboardData;
  const baseline = previous.dataStatus !== 'ready';
  const iso = now.toISOString();
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }).format(now) + ' PT';
  const oldById = new Map(previous.sections.map(row => [row.section, row]));
  const newById = new Map(sections.map(row => [row.section, row]));
  const latestChanges = baseline ? [] : sections.flatMap(row => {
    const old = oldById.get(row.section);
    const was = old?.metrics !== false ? (old?.enrolled || 0) : 0;
    const current = row.metrics !== false ? row.enrolled : 0;
    return was === current ? [] : [{ date: iso, course: row.course, section: row.section, previous: was, current }];
  });
  if (!baseline) {
    for (const old of previous.sections) {
      if (!newById.has(old.section) && old.metrics !== false && old.enrolled) latestChanges.push({ date: iso, course: old.course, section: old.section, previous: old.enrolled, current: 0 });
    }
  }
  const counted = sections.filter(row => row.metrics !== false);
  const totals = Object.fromEntries(Object.values(PROGRAM_NAMES).map(program => [program, counted.filter(row => row.program === program).reduce((sum, row) => sum + row.enrolled, 0)]));
  const added = latestChanges.reduce((sum, change) => sum + Math.max(0, change.current - change.previous), 0);
  const dropped = latestChanges.reduce((sum, change) => sum + Math.max(0, change.previous - change.current), 0);
  return { ...state, dashboardData: { ...previous,
    dataStatus: 'ready', termCode: TERM_CODE, termLabel: 'Spring 2027', refreshedAt: iso,
    sourceUrl: API_URL, currentSnapshot: label + ' — ACAD + IDSN + PRIN',
    baselineSnapshot: baseline ? label : previous.baselineSnapshot,
    sections, latestChanges, trendLog: [...latestChanges, ...previous.trendLog],
    history: [...previous.history, { date: label, capturedAt: iso, snapshot: baseline ? 'Spring 2027 baseline' : 'USC refresh', added, dropped, totals, fullSections: counted.filter(row => row.enrolled >= row.capacity).length }],
    netChangeLabel: baseline ? 'First spring snapshot; no previous comparison' : `Since ${previous.currentSnapshot}`
  } };
}

async function main() {
  const state = readState(fs.readFileSync(DATA_FILE, 'utf8'));
  const courses = await Promise.all(PROGRAM_CODES.map(program => fetchProgram(program)));
  const sections = buildSections(courses);
  const updated = createSnapshot(state, sections);
  const output = '// Spring 2027 public USC SOC data. Generated by scripts/refresh-data.js.\n' + Object.entries(updated).map(([key, value]) => `window.${key} = ${JSON.stringify(value, null, 2)};`).join('\n') + '\n';
  const temporary = DATA_FILE + '.tmp';
  fs.writeFileSync(temporary, output);
  fs.renameSync(temporary, DATA_FILE);
  console.log(`Spring 2027: refreshed ${sections.length} unique USC sections. ${updated.dashboardData.currentSnapshot}`);
}

module.exports = { readState, seatCount, fetchProgram, buildSections, createSnapshot, main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
