# IYA Enrollment Dashboard — Spring 2027

A separate Spring 2027 copy of the supplied Fall 2026 dashboard. The original ZIP and Fall 2026 files are unchanged. The ivory, olive, and cardinal dashboard styling is preserved.

## Status: prepared, awaiting first live refresh

No live Spring 2027 snapshot is included. USC's API returned `403 Forbidden. Calls to this URL are not allowed.` from the editing environment. This is an access limitation here, not proof that USC's API is down. The USC endpoint and response field names come from your existing Fall refresh script; the Spring response has not been verified live.

Until a refresh succeeds, the page says **Awaiting the first successful Spring 2027 USC refresh** and does not show enrollment KPIs. It does not relabel Fall 2026 enrollment as Spring 2027. It has not been published or connected to your accounts.

## First steps: publish as a separate spring project

1. Extract this ZIP on your computer.
2. Create a new GitHub repository named `iya-enrollment-spring-2027`.
3. Add the contents of the extracted `spring-2027` folder to the repository root: `index.html`, `data.js`, `netlify.toml`, `scripts`, `tests`, and `.github`. Include the `.github/workflows/refresh-data.yml` file. Do not upload only the ZIP itself.
4. In that repository, open **Actions**, enable workflows if prompted, select **Refresh Spring 2027 enrollment data**, and choose **Run workflow** on the default branch.
5. Check that the run succeeds and commits `data.js`. If it fails, open the job log. HTTP errors and unexpected response fields intentionally stop the refresh and leave the previous file intact.
6. Create a NEW Netlify site/project connected to this new repository. Publish directory: `.`. No build command or package installation is needed. The supplied `netlify.toml` sets the publish directory.
7. Confirm the deployed page shows **Spring 2027** and a real refresh timestamp. Check several sections against USC's schedule, including capacity and any canceled or cross-listed sections, before sharing with leadership.
8. Add the new spring URL to your SharePoint Enrollment Management page. Keep your existing fall link as the previous-semester dashboard when appropriate.

Do not connect the spring copy to the existing fall Netlify project. Netlify deployments and account changes are not performed by this ZIP.

## Automated refresh

The copied GitHub Actions workflow runs daily at **6:00 a.m. America/Los_Angeles**, using two UTC triggers and a Pacific-time check to handle daylight saving time. GitHub scheduling may run late; the workflow must exist on the repository's default branch for scheduled execution. Manual runs are available through Actions. A scheduled Actions job is not yet active until these files are installed in a GitHub repository with workflows enabled.

The workflow tests the refresh logic, fetches all three programs, updates `data.js`, and commits only if the file changes. Netlify can redeploy from those commits. No USC login, API key, or student roster is used.

## USC data source

Endpoint inherited from your Fall refresh code:

`https://classes.usc.edu/api/Courses/CoursesByTermSchoolProgram`

Parameters: `termCode=20271`, `school=ACAD`, and `program=ACAD`, `IDSN`, or `PRIN`.

The dashboard uses the same program scope as your original: sections whose scheduled prefix is ACAD, IDSN, or PRIN. It does not automatically include a partner school's separately scheduled sections. Each SIS section ID is counted once, under its scheduled prefix. Public course data does not establish which individual students have declared a minor.

Data fields inherited from your script: `courses`, `scheduledCourseCode`, `sections`, `sisSectionId`, `registeredSeats`, `totalSeats`, `waitlistedSeats`, and `instructors`. Validate these against the first successful live response. Missing or invalid enrollment/capacity fails the refresh. Missing waitlists stay unknown, not zero. Only explicit `isCancelled`/`isCanceled` boolean flags are currently recognized; if USC supplies cancellation status differently, update the parser before relying on cancellation exclusions. Zero-capacity sections are visible but excluded from metrics.

## What changed

- Spring term code 20271, labels, and browser title.
- Spring calendar: classes January 11–April 30, 2027; study days May 1–4; exams May 5–12. Source: https://www.usc.edu/academic-calendar/ (standard university dates; individual sessions can differ).
- All fall section rows, baseline/trend history, staffing lists, faculty notes, room schedules, course credits, and specific fall cross-list exceptions reset.
- First successful fetch establishes a spring baseline without counting all existing students as new adds.
- Snapshot history records actual per-program totals; chart appears after two successful snapshots. Latest net change resets correctly on an unchanged run.
- Added/removed sections contribute to net registration change; removals are snapshot differences and are not proof of student withdrawals.
- Waitlist totals are labeled **entries**, not unique students.
- Failed fetches keep the last successful snapshot; data writes use a temporary file then atomic rename.

## Pending spring-specific inputs

- Facilities: spring room capacities and actual meeting schedules must be verified before enabling the facilities panel. This copy deliberately displays an unavailable notice instead of fall utilization or fabricated zeros. The old visualization helpers remain for reuse, but are not called until the panel is implemented for spring.
- Student credit hours: marked Pending until spring course-unit metadata is verified. Variable-unit courses need a defined counting rule.
- Course assistant needs and faculty notes: start empty and require spring review.
- Any tuition/revenue estimate requires a separate financial model. The existing program-level capacity table does not estimate tuition revenue.
- Validate current API cancellation fields and program/cross-list coverage against USC before treating the dashboard as a finalized leadership report.

## Local use and validation

Requires Node.js 22 or later for refresh/tests; opening the static page needs only a browser.

```sh
node --test tests/refresh-data.test.js
node scripts/refresh-data.js
```

Open `index.html` afterward. Network access to USC is necessary for the second command. To use another output file, set `DATA_FILE` to a Spring 2027 data file with matching term metadata. The refresher intentionally refuses Fall 2026 data files.

Validation performed during preparation: automated refresh tests; HTML inline-script syntax; simulated DOM initialization with pending and synthetic Spring data. Live USC retrieval and a full browser visual inspection were blocked by this environment and remain unverified. Synthetic test data is never stored in production `data.js`.
