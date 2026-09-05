/* ============================================================    My MaNaGeR - Demo Project Data
   ============================================================
   Two demo projects:    1. demo-filled - fully populated 1.5-year construction project       (VIEW ONLY - cannot be edited by visitors)    2. demo-empty - blank template project (editable)

   The filled project is seeded into localStorage on first open.
   ============================================================ */

(function() {
  'use strict';

  window.MMGR_DEMO_FILLED = {
    schemaVersion: 19,
    projectId: 'demo-filled',
    projectName: 'Riverside Tower Renovation',
    methodology: 'waterfall',
    methodologyLocked: false,
    workWeek: 5,
    theme: 'light',
    crosshairOn: false,
    userName: 'Demo User',
    charter: {
      name: 'Riverside Tower Renovation',
      sponsor: 'Meridian Development Group',
      objective: 'Complete a full structural and interior renovation of the 12-story Riverside Tower at 420 River Walk Blvd, including seismic retrofit, MEP overhaul, lobby redesign, and elevator modernization, within 18 months and under $14.2M budget.',
      scope: 'The renovation covers all 12 floors (144,000 sq ft total), including structural reinforcement of columns and beams on floors 1-6, complete demolition and rebuild of mechanical/electrical/plumbing systems, new elevator cabs and control systems (3 elevators), seismic base isolation retrofit, lobby and ground-floor retail space redesign, roof membrane replacement, and exterior facade restoration. Excludes tenant fit-out beyond shell condition, parking garage structural work, and adjacent properties.',       deliverables: '1. Seismic retrofit certification (PE-stamped)\n2. New MEP systems (HVAC, electrical, plumbing) - fully commissioned\n3. Three modernized elevators with destination dispatch\n4. Renovated lobby with ADA-compliant entrance\n5. Restored exterior facade with new waterproofing\n6. New roof membrane with 20-year warranty\n7. Fire alarm and suppression system upgrade\n8. As-built documentation package',
      constraints: 'Building remains partially occupied (floors 9-12) during construction. Work hours restricted to 7AM-6PM weekdays, 8AM-4PM Saturdays. No heavy demolition during occupied hours. Noise must stay below 85 dBA at property line. Crane operations require 48-hour advance notice to city.',
      assumptions: '1. Existing structural drawings from 1987 are accurate\n2. No asbestos in floor tiles below grade (confirmed by survey)\n3. City permits approved within 60 days of submission\n4. Steel delivery lead time is 12-16 weeks\n5. Existing foundation can support additional seismic loads\n6. Tenant cooperation for floor-by-floor phasing',
      exclusions: '1. Tenant fit-out beyond shell condition\n2. Parking garage structural remediation\n3. Adjacent sidewalk and streetscape improvements\n4. Furniture, fixtures, and equipment (FF&E)\n5. Landscaping beyond building perimeter',
      targetStart: '2025-01-06',
      targetCompletion: '2026-06-30',
      budgetEnvelope: 14200000,
      kpis: [
        { name: 'Schedule Performance Index', target: '>=0.95' },
        { name: 'Cost Performance Index', target: '>=0.95' },
        { name: 'Safety: Zero lost-time incidents', target: '0' },
        { name: 'Quality: Punch list items at substantial completion', target: '<=50' },
        { name: 'Client Satisfaction Score', target: '>=4.0/5.0' }
      ],
      categories: { financial: true, schedule: true, quality: true, safety: true, environmental: true }
    },
    tasks: [
      { id: 'T001', name: 'Pre-Construction Planning', startDate: '2025-01-06', endDate: '2025-02-28', status: 'completed', leadDays: 0, phase: 'planning', assignee: 'Marcus Webb', predecessors: [], progress: 100 },
      { id: 'T002', name: 'Permit Applications', startDate: '2025-01-13', endDate: '2025-03-14', status: 'completed', leadDays: 14, phase: 'planning', assignee: 'Diana Chen', predecessors: ['T001'], progress: 100 },
      { id: 'T003', name: 'Structural Assessment', startDate: '2025-02-03', endDate: '2025-03-28', status: 'completed', leadDays: 21, phase: 'planning', assignee: 'James Okonkwo', predecessors: ['T001'], progress: 100 },
      { id: 'T004', name: 'Steel Procurement', startDate: '2025-02-17', endDate: '2025-06-13', status: 'completed', leadDays: 42, phase: 'procurement', assignee: 'Rachel Torres', predecessors: ['T003'], progress: 100 },
      { id: 'T005', name: 'Elevator Equipment Order', startDate: '2025-03-03', endDate: '2025-07-25', status: 'completed', leadDays: 35, phase: 'procurement', assignee: 'Kevin Patel', predecessors: ['T002'], progress: 100 },
      { id: 'T006', name: 'Tenant Relocation (Floors 1-4)', startDate: '2025-03-17', endDate: '2025-04-25', status: 'completed', leadDays: 14, phase: 'demolition', assignee: 'Marcus Webb', predecessors: ['T002'], progress: 100 },
      { id: 'T007', name: 'Demolition Floors 1-4', startDate: '2025-04-28', endDate: '2025-06-06', status: 'completed', leadDays: 0, phase: 'demolition', assignee: 'Luis Ramirez', predecessors: ['T006'], progress: 100 },
      { id: 'T008', name: 'Seismic Retrofit Floors 1-4', startDate: '2025-06-09', endDate: '2025-09-05', status: 'completed', leadDays: 14, phase: 'structural', assignee: 'James Okonkwo', predecessors: ['T004', 'T007'], progress: 100 },
      { id: 'T009', name: 'MEP Rough-In Floors 1-4', startDate: '2025-07-07', endDate: '2025-10-03', status: 'inprogress', leadDays: 7, phase: 'mechanical', assignee: 'Sarah Kim', predecessors: ['T008'], progress: 72 },
      { id: 'T010', name: 'Tenant Relocation (Floors 5-8)', startDate: '2025-06-16', endDate: '2025-07-25', status: 'completed', leadDays: 14, phase: 'demolition', assignee: 'Marcus Webb', predecessors: ['T008'], progress: 100 },
      { id: 'T011', name: 'Demolition Floors 5-8', startDate: '2025-07-28', endDate: '2025-09-05', status: 'completed', leadDays: 0, phase: 'demolition', assignee: 'Luis Ramirez', predecessors: ['T010'], progress: 100 },
      { id: 'T012', name: 'Seismic Retrofit Floors 5-8', startDate: '2025-09-08', endDate: '2025-12-05', status: 'inprogress', leadDays: 14, phase: 'structural', assignee: 'James Okonkwo', predecessors: ['T004', 'T011'], progress: 45 },
      { id: 'T013', name: 'MEP Rough-In Floors 5-8', startDate: '2025-10-06', endDate: '2026-01-09', status: 'todo', leadDays: 7, phase: 'mechanical', assignee: 'Sarah Kim', predecessors: ['T012'], progress: 0 },
      { id: 'T014', name: 'Elevator Modernization (Cab 1)', startDate: '2025-08-04', endDate: '2025-10-31', status: 'completed', leadDays: 21, phase: 'mechanical', assignee: 'Kevin Patel', predecessors: ['T005'], progress: 100 },
      { id: 'T015', name: 'Elevator Modernization (Cab 2)', startDate: '2025-10-06', endDate: '2025-12-26', status: 'inprogress', leadDays: 21, phase: 'mechanical', assignee: 'Kevin Patel', predecessors: ['T014'], progress: 60 },
      { id: 'T016', name: 'Elevator Modernization (Cab 3)', startDate: '2026-01-05', endDate: '2026-03-27', status: 'todo', leadDays: 21, phase: 'mechanical', assignee: 'Kevin Patel', predecessors: ['T015'], progress: 0 },
      { id: 'T017', name: 'Lobby Redesign Construction', startDate: '2025-09-08', endDate: '2025-12-19', status: 'inprogress', leadDays: 28, phase: 'finishes', assignee: 'Diana Chen', predecessors: ['T008', 'T007'], progress: 55 },
      { id: 'T018', name: 'Facade Restoration', startDate: '2025-10-06', endDate: '2026-02-27', status: 'todo', leadDays: 21, phase: 'exterior', assignee: 'Luis Ramirez', predecessors: ['T012'], progress: 0 },
      { id: 'T019', name: 'Roof Membrane Replacement', startDate: '2025-11-03', endDate: '2026-01-16', status: 'todo', leadDays: 14, phase: 'exterior', assignee: 'Rachel Torres', predecessors: ['T004'], progress: 0 },
      { id: 'T020', name: 'Fire Alarm Upgrade', startDate: '2025-12-01', endDate: '2026-03-06', status: 'todo', leadDays: 14, phase: 'safety', assignee: 'Sarah Kim', predecessors: ['T009'], progress: 0 },
      { id: 'T021', name: 'Tenant Relocation (Floors 9-12)', startDate: '2025-12-08', endDate: '2026-01-16', status: 'todo', leadDays: 14, phase: 'demolition', assignee: 'Marcus Webb', predecessors: ['T012'], progress: 0 },
      { id: 'T022', name: 'Demolition Floors 9-12', startDate: '2026-01-19', endDate: '2026-02-27', status: 'todo', leadDays: 0, phase: 'demolition', assignee: 'Luis Ramirez', predecessors: ['T021'], progress: 0 },
      { id: 'T023', name: 'Seismic Retrofit Floors 9-12', startDate: '2026-03-02', endDate: '2026-05-08', status: 'todo', leadDays: 14, phase: 'structural', assignee: 'James Okonkwo', predecessors: ['T004', 'T022'], progress: 0 },
      { id: 'T024', name: 'MEP Rough-In Floors 9-12', startDate: '2026-03-16', endDate: '2026-05-22', status: 'todo', leadDays: 7, phase: 'mechanical', assignee: 'Sarah Kim', predecessors: ['T023'], progress: 0 },
      { id: 'T025', name: 'Interior Finishes Floors 1-4', startDate: '2025-10-06', endDate: '2025-12-19', status: 'todo', leadDays: 14, phase: 'finishes', assignee: 'Diana Chen', predecessors: ['T009'], progress: 0 },
      { id: 'T026', name: 'Interior Finishes Floors 5-8', startDate: '2026-01-12', endDate: '2026-03-27', status: 'todo', leadDays: 14, phase: 'finishes', assignee: 'Diana Chen', predecessors: ['T013'], progress: 0 },
      { id: 'T027', name: 'Interior Finishes Floors 9-12', startDate: '2026-04-06', endDate: '2026-06-05', status: 'todo', leadDays: 14, phase: 'finishes', assignee: 'Diana Chen', predecessors: ['T024'], progress: 0 },
      { id: 'T028', name: 'Commissioning and Testing', startDate: '2026-05-11', endDate: '2026-06-05', status: 'todo', leadDays: 7, phase: 'closeout', assignee: 'Sarah Kim', predecessors: ['T020', 'T024', 'T027'], progress: 0 },
      { id: 'T029', name: 'Punch List and Final Inspection', startDate: '2026-06-08', endDate: '2026-06-26', status: 'todo', leadDays: 0, phase: 'closeout', assignee: 'Marcus Webb', predecessors: ['T028'], progress: 0 },
      { id: 'T030', name: 'Project Closeout and Handover', startDate: '2026-06-29', endDate: '2026-06-30', status: 'todo', leadDays: 0, phase: 'closeout', assignee: 'Marcus Webb', predecessors: ['T029'], progress: 0 }
    ],
    resources: [
      /* 2026-09-05: hoursAllocated populated (availability 100%) so the demo          dashboard shows real utilization instead of a flat 0% - capacity at
         workWeek 5 = 160h/month, so util% ≈ hoursAllocated/160. The legacy
         `util` hint fields are dropped on load; hoursAllocated is the source. */
      { id: 'R001', name: 'Marcus Webb', role: 'Project Manager', availability: 100, rate: 185, hoursAllocated: 160 },
      { id: 'R002', name: 'Diana Chen', role: 'Architect / Interior Designer', availability: 100, rate: 165, hoursAllocated: 128 },
      { id: 'R003', name: 'James Okonkwo', role: 'Structural Engineer', availability: 100, rate: 175, hoursAllocated: 144 },
      { id: 'R004', name: 'Sarah Kim', role: 'MEP Engineer', availability: 100, rate: 170, hoursAllocated: 136 },
      { id: 'R005', name: 'Kevin Patel', role: 'Elevator Specialist', availability: 100, rate: 195, hoursAllocated: 112 },
      { id: 'R006', name: 'Luis Ramirez', role: 'Site Superintendent', availability: 100, rate: 155, hoursAllocated: 160 },
      { id: 'R007', name: 'Rachel Torres', role: 'Procurement Manager', availability: 100, rate: 145, hoursAllocated: 96 },
      { id: 'R008', name: 'Amara Osei', role: 'Safety Officer', availability: 100, rate: 140, hoursAllocated: 80 },
      { id: 'R009', name: 'Tom Brennan', role: 'Quality Inspector', availability: 100, rate: 150, hoursAllocated: 64 },
      { id: 'R010', name: 'Priya Sharma', role: 'Scheduler / Planner', availability: 100, rate: 160, hoursAllocated: 120 }
    ],
    budgetLines: [
      { id: 'B001', category: 'Demolition', planned: 1200000, actual: 1180000 },
      { id: 'B002', category: 'Structural / Seismic', planned: 3800000, actual: 2100000 },
      { id: 'B003', category: 'Mechanical / Electrical / Plumbing', planned: 3200000, actual: 1400000 },
      { id: 'B004', category: 'Elevator Modernization', planned: 1800000, actual: 950000 },
      { id: 'B005', category: 'Interior Finishes', planned: 2100000, actual: 350000 },
      { id: 'B006', category: 'Exterior / Facade', planned: 900000, actual: 0 },
      { id: 'B007', category: 'Fire & Life Safety', planned: 650000, actual: 0 },
      { id: 'B008', category: 'General Conditions', planned: 1850000, actual: 980000 },
      { id: 'B009', category: 'Contingency (10%)', planned: 1420000, actual: 200000 }
    ],
    budgetEnvelope: 14200000,
    spendLog: [
      { id: 'S001', date: '2025-01-31', amount: 85000, note: 'Mobilization and site setup' },
      { id: 'S002', date: '2025-02-28', amount: 145000, note: 'Permit fees and architectural drawings' },
      { id: 'S003', date: '2025-03-31', amount: 220000, note: 'Structural assessment and steel order' },
      { id: 'S004', date: '2025-04-30', amount: 380000, note: 'Demolition floors 1-4, tenant relocation' },
      { id: 'S005', date: '2025-05-31', amount: 420000, note: 'Demolition complete, steel delivery begins' },
      { id: 'S006', date: '2025-06-30', amount: 510000, note: 'Seismic retrofit floors 1-4 started' },
      { id: 'S007', date: '2025-07-31', amount: 480000, note: 'Elevator cab 1 installation, seismic ongoing' },
      { id: 'S008', date: '2025-08-31', amount: 520000, note: 'Elevator 1 complete, MEP rough-in started' },
      { id: 'S009', date: '2025-09-30', amount: 490000, note: 'Lobby demo complete, seismic floors 5-8 started' },
      { id: 'S010', date: '2025-10-31', amount: 465000, note: 'Facade prep, elevator 2 installation' },
      { id: 'S011', date: '2025-11-30', amount: 380000, note: 'MEP floors 1-4 nearing completion' },
      { id: 'S012', date: '2025-12-31', amount: 350000, note: 'Year-end closeout, structural 5-8 45%' }
    ],
    stakeholders: [
      { id: 'SH001', name: 'Patricia Nguyen', role: 'Client / Building Owner', interest: 'high', influence: 'high', sentiment: 'positive' },
      { id: 'SH002', name: 'Marcus Webb', role: 'Project Manager', interest: 'high', influence: 'high', sentiment: 'positive' },
      { id: 'SH003', name: 'Robert Calloway', role: 'City Building Inspector', interest: 'medium', influence: 'high', sentiment: 'neutral' },
      { id: 'SH004', name: 'Tenant Association (Floors 9-12)', role: 'Occupant', interest: 'high', influence: 'medium', sentiment: 'concerned' },
      { id: 'SH005', name: 'Meridian Development Group', role: 'Developer / Sponsor', interest: 'high', influence: 'high', sentiment: 'positive' },
      { id: 'SH006', name: 'Sandra Mitchell', role: 'Insurance Broker', interest: 'low', influence: 'medium', sentiment: 'neutral' },
      { id: 'SH007', name: 'George Hayashi', role: 'Structural PE (Third-Party Reviewer)', interest: 'medium', influence: 'medium', sentiment: 'positive' },
      { id: 'SH008', name: 'Local Neighborhood Council', role: 'Community', interest: 'medium', influence: 'low', sentiment: 'neutral' }
    ],
    risks: [
      { id: 'RK001', name: 'Steel delivery delay', description: 'Structural steel supplier may face 4-6 week delay due to supply chain disruption', severity: 'high', probability: 0.4, impact: 'schedule', mitigation: 'Pre-order with buffer; identify backup supplier (Pacific Steel Co.)', status: 'open' },
      { id: 'RK002', name: 'Asbestos discovery in sub-grade tiles', description: 'Phase 2 survey may find asbestos in basement floor tiles not covered by initial survey', severity: 'high', probability: 0.25, impact: 'cost', mitigation: 'Budget $180K contingency; abatement contractor on retainer (CleanAir Corp)', status: 'open' },
      { id: 'RK003', name: 'Permit delays from city', description: 'Building department backlog could push permits 30+ days past target', severity: 'medium', probability: 0.35, impact: 'schedule', mitigation: 'Pre-application meeting completed; expediter engaged (Diana Chen)', status: 'mitigating' },
      { id: 'RK004', name: 'Elevator equipment shipping damage', description: 'Custom elevator cabs shipped from Germany may arrive damaged', severity: 'medium', probability: 0.15, impact: 'schedule', mitigation: 'Insured shipment; factory inspection before shipping', status: 'open' },
      { id: 'RK005', name: 'Weather delays on exterior work', description: 'Winter weather could delay facade restoration and roof work by 3-4 weeks', severity: 'medium', probability: 0.5, impact: 'schedule', mitigation: 'Schedule exterior work for April-September; weather-day provisions in contract', status: 'open' },
      { id: 'RK006', name: 'Tenant non-cooperation during relocation', description: 'Tenants on floors 9-12 may resist scheduled relocation timeline', severity: 'low', probability: 0.3, impact: 'schedule', mitigation: 'Early engagement; relocation assistance package; flexible phasing', status: 'mitigating' },
      { id: 'RK007', name: 'Labor shortage for specialized trades', description: 'Certified seismic retrofit crews and elevator technicians in short supply', severity: 'high', probability: 0.4, impact: 'cost', mitigation: 'Locked contracts with two subcontractors per trade; labor broker agreement', status: 'open' },
      { id: 'RK008', name: 'Hidden structural deficiencies', description: 'Seismic retrofit may reveal additional structural issues not in original assessment', severity: 'high', probability: 0.2, impact: 'cost', mitigation: 'Comprehensive Phase 2 assessment completed; 10% contingency allocated', status: 'monitoring' }
    ],
    issues: [
      { id: 'ISS001', name: 'Steel beam dimension mismatch', description: 'Delivery of W14x90 beams received as W14x82; structural PE reviewing adequacy', status: 'open', severity: 'medium', raisedDate: '2025-06-20', assignee: 'James Okonkwo' },
      { id: 'ISS002', name: 'Elevator shaft vibration above threshold', description: 'Cab 1 testing showed 0.3g lateral vibration exceeding 0.15g limit during emergency stop', status: 'resolved', severity: 'high', raisedDate: '2025-10-08', assignee: 'Kevin Patel', resolvedDate: '2025-10-22' }
    ],
    changes: [
      { id: 'CH001', name: 'Lobby floor material upgrade', description: 'Changed from polished concrete to porcelain tile (client request)', date: '2025-08-15', costImpact: 45000, scheduleImpact: 0, status: 'approved' },
      { id: 'CH002', name: 'Additional seismic sensors', description: 'Added 12 accelerometers per structural PE recommendation after Phase 1 findings', date: '2025-09-03', costImpact: 28000, scheduleImpact: 5, status: 'approved' }
    ],
    meetings: [       { id: 'M001', kind: 'weekly', title: 'Week 2 - Kickoff Review', startedAt: '2025-01-13T09:00:00', endedAt: '2025-01-13T10:30:00', durationMin: 90, notes: 'Project kickoff complete. Team introduced. Schedule baseline reviewed. Safety protocols established.' },       { id: 'M002', kind: 'weekly', title: 'Week 8 - Structural Assessment Review', startedAt: '2025-02-24T09:00:00', endedAt: '2025-02-24T10:00:00', durationMin: 60, notes: 'Phase 2 structural assessment complete. No major surprises. Steel procurement authorized.' },       { id: 'M003', kind: 'monthly', title: 'Month 4 - Progress Review', startedAt: '2025-04-07T14:00:00', endedAt: '2025-04-07T15:30:00', durationMin: 90, notes: 'Demolition floors 1-4 on schedule. Tenant relocation complete. Budget tracking within 2% of plan.' },       { id: 'M004', kind: 'weekly', title: 'Week 20 - Mid-Project Checkpoint', startedAt: '2025-05-26T09:00:00', endedAt: '2025-05-26T10:00:00', durationMin: 60, notes: 'Demolition complete. Seismic retrofit starting. Steel delivery confirmed for June 13.' },       { id: 'M005', kind: 'weekly', title: 'Week 32 - Seismic Progress', startedAt: '2025-08-18T09:00:00', endedAt: '2025-08-18T09:45:00', durationMin: 45, notes: 'Floors 1-4 seismic 80% complete. Elevator cab 1 installed and testing. Lobby demo started.' },       { id: 'M006', kind: 'monthly', title: 'Month 11 - Year-End Review', startedAt: '2025-12-01T14:00:00', endedAt: '2025-12-01T16:00:00', durationMin: 120, notes: 'Year-end budget review: $7.95M spent of $14.2M (56%). Schedule SPI 0.97. Elevator 2 installation in progress. Weather window planning for Q1 exterior work.' }
    ],
    logEntries: [
      { date: '2025-01-06', text: 'Project commenced. Notice to proceed issued.' },
      { date: '2025-03-14', text: 'Building permits approved. 60-day turnaround as expected.' },
      { date: '2025-04-28', text: 'Demolition commenced floors 1-4.' },       { date: '2025-06-13', text: 'Steel delivery received - all members inspected and accepted.' },
      { date: '2025-07-25', text: 'Elevator cab 1 equipment received from manufacturer.' },
      { date: '2025-08-04', text: 'Elevator modernization cab 1 installation started.' },
      { date: '2025-09-05', text: 'Seismic retrofit floors 1-4 complete. PE inspection passed.' },
      { date: '2025-10-31', text: 'Elevator cab 1 operational. Testing phase complete.' },
      { date: '2025-12-19', text: 'Year-end review. Budget on track. Schedule SPI 0.97.' }
    ],
    commsEntries: [
      { date: '2025-01-10', subject: 'Project Kickoff Notification', to: 'All stakeholders', from: 'Marcus Webb', content: 'Project officially commenced. Weekly status reports begin Week 2.' },
      { date: '2025-03-17', subject: 'Floor 1-4 Tenant Relocation Schedule', to: 'Tenants (Floors 1-4)', from: 'Marcus Webb', content: 'Relocation begins March 17. Temporary workspace available at 420 River Walk Suite 200.' },
      { date: '2025-06-16', subject: 'Floor 5-8 Tenant Relocation Notice', to: 'Tenants (Floors 5-8)', from: 'Marcus Webb', content: 'Relocation begins June 16. Moving assistance provided.' }
    ],
    documents: [
      { id: 'D001', name: 'Seismic Assessment Report (Phase 2)', date: '2025-03-28', type: 'report' },
      { id: 'D002', name: 'Construction Drawings Set A (Floors 1-4)', date: '2025-04-15', type: 'drawing' },
      { id: 'D003', name: 'Elevator Specification & Shop Drawings', date: '2025-03-10', type: 'specification' },
      { id: 'D004', name: 'Safety Plan v2.1', date: '2025-01-20', type: 'plan' },       { id: 'D005', name: 'Monthly Progress Report - December 2025', date: '2025-12-31', type: 'report' }
    ],
    closure: {
      items: [
        { name: 'Final inspection passed', done: false },
        { name: 'As-built drawings delivered', done: false },
        { name: 'Warranties collected', done: false },
        { name: 'Lessons learned documented', done: false },
        { name: 'Financial closeout complete', done: false }
      ],
      well: 'Team coordination was excellent. Early tenant engagement prevented schedule disruptions. Steel procurement on time despite industry challenges.',
      imp: 'Weather delays on exterior work added 2 weeks. Elevator cab 1 vibration issue required redesign of guide rails.',
      rec: 'Start facade restoration earlier in the weather window. Include vibration testing in elevator factory acceptance test.'
    },
    raci: {
      tasks: ['T001', 'T007', 'T008', 'T009', 'T014', 'T017', 'T018', 'T028'],
      persons: ['Marcus Webb', 'James Okonkwo', 'Sarah Kim', 'Kevin Patel', 'Diana Chen', 'Luis Ramirez'],
      matrix: {
        'T001': { 'Marcus Webb': 'R', 'James Okonkwo': 'C', 'Sarah Kim': 'I' },
        'T007': { 'Luis Ramirez': 'R', 'Marcus Webb': 'A', 'James Okonkwo': 'C' },
        'T008': { 'James Okonkwo': 'R', 'Marcus Webb': 'A', 'Luis Ramirez': 'C' },
        'T009': { 'Sarah Kim': 'R', 'Marcus Webb': 'A', 'Luis Ramirez': 'C' },
        'T014': { 'Kevin Patel': 'R', 'Marcus Webb': 'A' },
        'T017': { 'Diana Chen': 'R', 'Marcus Webb': 'A', 'Luis Ramirez': 'C' },
        'T018': { 'Luis Ramirez': 'R', 'Marcus Webb': 'A', 'James Okonkwo': 'C' },
        'T028': { 'Sarah Kim': 'R', 'Marcus Webb': 'A', 'Tom Brennan': 'C' }
      }
    },
    dmaic: {
      active: false,
      define: { problem: 'Elevator cab 1 vibration exceeds safety threshold', goal: 'Reduce lateral vibration to <0.15g during all operating conditions', scope: 'Cab 1 guide rail system and emergency brake', sponsor: 'Kevin Patel', voice: 'Safety inspection report', done: true },
      measure: { baseline: '0.30g lateral during emergency stop', defects: '3 exceedance events in 100 test cycles', unit: 'g (lateral acceleration)', opportunity: '100 test cycles', dpmo: '30000', sigmaNow: '3.4', done: true },
      analyze: { rootCauses: 'Guide rail bracket spacing 20% wider than spec; brake engagement too abrupt', fishbone: 'Material (rail spec), Process (brake timing), Measurement (accelerometer placement)', paretoTop: 'Guide rail bracket spacing (70% of vibration)', done: true },       improve: { solutions: 'Install intermediate brackets every 2m (was 2.5m); reduce brake deceleration rate by 15%', pilot: 'Modified rail section tested on floor 3 shaft - vibration dropped to 0.12g', results: 'Vibration reduced 60%. All 100 test cycles pass <0.15g threshold.', done: true },
      control: { plan: 'Quarterly vibration testing; bracket inspection during annual elevator survey', metrics: 'Lateral acceleration (g), brake stopping distance (m)', handover: 'Maintenance team trained on bracket inspection protocol', done: false }
    },
    baseline: {
      tasks: [
        { id: 'T001', startDate: '2025-01-06', endDate: '2025-02-28' },
        { id: 'T002', startDate: '2025-01-13', endDate: '2025-03-14' },
        { id: 'T008', startDate: '2025-06-09', endDate: '2025-09-05' },
        { id: 'T012', startDate: '2025-09-08', endDate: '2025-12-05' },
        { id: 'T023', startDate: '2026-03-02', endDate: '2026-05-08' },
        { id: 'T030', startDate: '2026-06-29', endDate: '2026-06-30' }
      ]
    },
    weatherRegion: 'northern-temperate',
    siteLat: 40.7128,
    siteLon: -74.0060,
    sitePlace: 'New York, NY',
    wxWindow: { startDate: '2025-11-01', endDate: '2026-03-31', bufferDays: 14 },
    weatherLog: [       { date: '2025-11-15', delay: 1, reason: 'Snow storm - exterior work halted' },       { date: '2025-12-03', delay: 2, reason: 'Freezing rain - crane operations suspended' },       { date: '2025-12-18', delay: 1, reason: 'Heavy snow - site access restricted' },       { date: '2026-01-08', delay: 3, reason: 'Extended freeze - concrete work cannot proceed' }
    ],
    ldRate: 8500,
    wxViewDays: 7,
    flags: { monteCarlo: true, ganttExport: true, leadtimeLane: true, weatherForecast: true },
    config: {},
    scheduleSlips: [],
    slipCauses: {},
    aiOutputs: {},
    fieldTs: {},
    packs: { schedule: true, money: true, governance: true, field: true, quality: false },
    packsCalloutDismissed: true,
    packsEverEnabled: true,
    updatedAt: '2025-12-31T23:59:59.000Z'
  };

  window.MMGR_DEMO_EMPTY = {
    schemaVersion: 19,
    projectId: 'demo-empty',
    projectName: '',
    methodology: 'waterfall',
    methodologyLocked: false,
    workWeek: 5,
    theme: 'light',
    crosshairOn: false,
    userName: '',
    charter: {
      name: '', sponsor: '', objective: '', scope: '', deliverables: '',
      constraints: '', assumptions: '', exclusions: '', targetStart: '', targetCompletion: '',
      budgetEnvelope: 0, kpis: [],
      categories: { financial: true, schedule: true, quality: true, safety: true, environmental: true }
    },
    tasks: [], resources: [], budgetLines: [], budgetEnvelope: 0, spendLog: [],
    stakeholders: [], risks: [], issues: [], changes: [], logEntries: [], commsEntries: [],
    documents: [], closure: { items: [], well: '', imp: '', rec: '' },
    raci: { tasks: [], persons: [], matrix: {} },
    sprint: { name: 'Sprint 1', startDate: '', endDate: '' },
    dailySnapshots: [], defExpanded: {},
    dmaic: { active: false, define: {}, measure: {}, analyze: {}, improve: {}, control: {} },
    baseline: null,
    weatherRegion: 'northern-temperate', siteLat: null, siteLon: null, sitePlace: '',
    wxCache: null, weatherLog: [], ldRate: 0, wxViewDays: 7,
    wxWindow: { startDate: '', endDate: '', bufferDays: 0 },
    kbShowLeadtime: false, hlCritical: false, dailySnapshot: null, focusMode: false,
    streak: { count: 0, lastDate: null }, sentimentHistory: [], lastBackedUpAt: null,
    flags: { monteCarlo: true, ganttExport: true, leadtimeLane: true, weatherForecast: true },
    errorLog: [], config: {}, scheduleSlips: [], slipCauses: {},
    digestSnapshot: null, aiOutputs: {}, fieldTs: {},
    packs: { schedule: false, money: false, governance: false, field: false, quality: false },
    packsCalloutDismissed: false, packsEverEnabled: false,
    updatedAt: new Date().toISOString()
  };
})();
