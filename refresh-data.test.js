const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { readState, fetchProgram, buildSections, createSnapshot } = require('../scripts/refresh-data');
const dataPath = path.join(__dirname, '..', 'data.js');
const base = () => ({dashboardData:{termCode:20271,dataStatus:'awaiting-refresh',sections:[],history:[],trendLog:[],currentSnapshot:'Pending'}});
const course = (prefix='ACAD', id='10001', enrolled=12, capacity=20) => ({ requestedProgram:prefix, scheduledCourseCode:{prefix,courseSpace:`${prefix} 100`}, name:'Test course', sections:[{sisSectionId:id,registeredSeats:enrolled,totalSeats:capacity,waitlistedSeats:0,instructors:[{firstName:'Test',lastName:'Instructor'}]}] });

test('refuses fall data even when section IDs happen to be reused', () => {
  assert.throws(() => readState('window.dashboardData={termCode:20263}'), /not explicitly Spring/);
});
test('requests only Spring 2027 with the correct school and program', async () => {
  let requested;
  const rows = await fetchProgram('IDSN', async url => {
    requested = url;
    return {ok:true,json:async()=>({courses:[course('IDSN')]})};
  });
  assert.equal(requested.searchParams.get('termCode'),'20271');
  assert.equal(requested.searchParams.get('school'),'ACAD');
  assert.equal(requested.searchParams.get('program'),'IDSN');
  assert.equal(rows[0].requestedProgram,'IDSN');
});
test('rejects failed API requests and changed response schemas', async () => {
  await assert.rejects(fetchProgram('ACAD', async()=>({ok:false,status:403})), /403/);
  await assert.rejects(fetchProgram('ACAD', async()=>({ok:true,json:async()=>({unexpected:[]})})), /courses array/);
});
test('counts a cross-listed SIS section once under its scheduled prefix', () => {
  const canonical=course('PRIN','34782');
  const duplicate={...canonical,requestedProgram:'IDSN'};
  const rows=buildSections([[duplicate],[canonical]]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].program,'Product Innovation');
});
test('rejects empty or invalid enrollment instead of manufacturing zeros', () => {
  assert.throws(()=>buildSections([[]]),/no tracked sections/);
  const bad=course(); bad.sections[0].registeredSeats=null;
  assert.throws(()=>buildSections([[bad]]),/Missing registeredSeats/);
  bad.sections[0].registeredSeats=-1;
  assert.throws(()=>buildSections([[bad]]),/Invalid registeredSeats/);
});
test('missing waitlist stays unknown; cancellation and zero capacity excluded', () => {
  const missing=course(); delete missing.sections[0].waitlistedSeats;
  assert.equal(buildSections([[missing]])[0].waitlisted,null);
  const cancelled=course();cancelled.sections[0].isCancelled=true;
  assert.equal(buildSections([[cancelled]])[0].metrics,false);
  assert.equal(buildSections([[course('ACAD','10002',0,0)]])[0].metrics,false);
});
test('first spring refresh establishes baseline without imaginary adds', () => {
  const fresh=createSnapshot(base(),buildSections([[course()]]),new Date('2026-11-19T00:00:00Z'));
  assert.equal(fresh.dashboardData.history.length,1);
  assert.equal(fresh.dashboardData.latestChanges.length,0);
  assert.equal(fresh.dashboardData.history[0].totals['Undergraduate ACAD'],12);
});
test('changes include new and removed sections; unchanged run resets latest changes', () => {
  const first=createSnapshot(base(),buildSections([[course('ACAD','10001',12)]]));
  const second=createSnapshot(first,buildSections([[course('ACAD','10002',8)]]));
  assert.equal(second.dashboardData.latestChanges.reduce((n,c)=>n+c.current-c.previous,0),-4);
  const third=createSnapshot(second,buildSections([[course('ACAD','10002',8)]]));
  assert.equal(third.dashboardData.latestChanges.length,0);
  assert.equal(third.dashboardData.history.length,3);
});
test('API failure leaves previous data file byte-for-byte unchanged', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iya-refresh-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'data.js');
  const before='window.dashboardData='+JSON.stringify(base().dashboardData)+';';fs.writeFileSync(file,before);
  const script=path.join(__dirname,'..','scripts','refresh-data.js');
  const run=spawnSync(process.execPath,['-e',`global.fetch=async()=>({ok:false,status:503});require(${JSON.stringify(script)}).main().catch(()=>process.exitCode=1)`],{env:{...process.env,DATA_FILE:file}});
  assert.equal(run.status,1);
  assert.equal(fs.readFileSync(file,'utf8'),before);
});
