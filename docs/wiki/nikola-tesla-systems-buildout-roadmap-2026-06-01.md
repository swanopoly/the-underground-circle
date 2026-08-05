# Nikola Tesla Systems Buildout Roadmap

Last updated: 2026-06-01

Status: dated buildout roadmap. Use this with the companion research report: [nikola-tesla-projects-planetary-impact-2026-06-01.md](/Users/cswanson/the-underground-circle/docs/wiki/nikola-tesla-projects-planetary-impact-2026-06-01.md).

Operational extensions:

- [nikola-tesla-motor-efficiency-audit-kit-2026-06-01.md](/Users/cswanson/the-underground-circle/docs/wiki/nikola-tesla-motor-efficiency-audit-kit-2026-06-01.md)
- [nikola-tesla-claim-triage-and-source-checker-2026-06-01.md](/Users/cswanson/the-underground-circle/docs/wiki/nikola-tesla-claim-triage-and-source-checker-2026-06-01.md)
- [nikola-tesla-systems-lab-school-path-2026-06-01.md](/Users/cswanson/the-underground-circle/docs/wiki/nikola-tesla-systems-lab-school-path-2026-06-01.md)

## Purpose

The first Tesla wiki report explains what Tesla worked on and why it still matters. This roadmap turns that research into practical work that can improve lives and the planet without drifting into unsupported "free energy" mythology.

The buildout principle is simple:

> Tesla-inspired work should make useful energy, communication, motion, sensing, and automation cheaper, safer, cleaner, more resilient, and more available.

## Buildout pillars

| Pillar | Tesla root | Modern target | Public benefit |
| --- | --- | --- | --- |
| Clean electrification | Polyphase AC power systems | electrify heat, transport, tools, farms, schools, clinics, and industry where the grid is clean enough or getting cleaner | less pollution, lower fuel dependence, better controllability |
| Motor efficiency | rotating magnetic field and induction motor | motor audits, efficient replacements, variable-speed drives, better pumps/fans/compressors, predictive maintenance | lower bills, lower emissions, less downtime |
| Grid reach and resilience | long-distance power transmission | transmission expansion, HVDC where appropriate, microgrids, storage, demand response | clean power reaches people reliably |
| Universal communication | Wardenclyffe's communications ambition | rural broadband, public alerts, emergency mesh, resilient local networks | access to education, health, coordination, safety |
| Targeted wireless power | high-frequency resonant systems and wireless-power experiments | charging pads, medical devices, sensors, robotics docks, optical or microwave power only where safety and efficiency justify it | power where wires or batteries are limiting |
| Remote control and robotics | radio-controlled teleautomaton | inspection drones, underwater robots, field robots, supervised autonomy | fewer dangerous jobs, faster infrastructure repair |
| Public science education | Tesla coils, motors, lighting, radio demonstrations | safe labs and simulations for electricity, fields, motors, grids, sensors, robotics | better technical literacy and better claims hygiene |

## 1. Motor Efficiency Audit Kit

This is the most practical Tesla-inspired climate project because motors and the systems they drive are a large electricity end use. The IEA reports that electric motor-driven systems account for more than 40% of global electricity consumption, and roughly 25% of that electricity could be saved cost-effectively. EIA reports that machine drives, primarily motors, pumps, and fans, account for about half of delivered electricity use in U.S. manufacturing.

### What to build

- a motor inventory form for facilities, schools, farms, shops, and small manufacturers
- a runtime and load-profile calculator
- a VFD opportunity checklist for variable-flow pumps, fans, compressors, and HVAC
- a maintenance-risk checklist for belts, bearings, alignment, lubrication, heat, vibration, and electrical faults
- a total-cost calculator that treats electricity cost as the main lifetime cost, not just purchase price
- a ranked action list: repair, right-size, add controls, replace, monitor, or leave unchanged

### Data fields

| Field | Why it matters |
| --- | --- |
| motor horsepower / kW | baseline capacity and replacement comparison |
| load type | pumps, fans, compressors, conveyors, mixers, HVAC, tools, irrigation |
| annual runtime | high-runtime motors deserve earlier attention |
| load variability | variable loads are stronger VFD candidates |
| existing controls | across-the-line, throttling, dampers, VFD, soft start, process controls |
| maintenance symptoms | heat, vibration, noise, repeated trips, bearing issues, leaks, belt wear |
| utility rate | converts energy savings to dollars |
| criticality | separates climate savings from operational risk |

### Output

The output should be a plain recommendation:

- expected savings category: low, medium, high
- confidence: measured, estimated, unknown
- first action: meter, inspect, tune, install VFD, replace motor, repair mechanical load
- safety note: licensed electrical work required where applicable
- source note: do not claim savings without load and runtime assumptions

## 2. Clean Electrification Map

Tesla's AC system was valuable because it moved energy from source to user. The modern version is a map that shows where electrification improves human life and climate outcomes.

### What to build

- a local load map: homes, schools, clinics, farms, transit, workshops, water systems, and public buildings
- a clean-power readiness score: grid emissions, renewable access, reliability, peak constraints, local storage, and backup needs
- a replacement opportunity score for diesel generators, propane heating, inefficient cooling, gas equipment, and fossil-powered tools
- a justice and access score: who benefits, who pays, and who is at risk of being left behind

### Evaluation questions

- Does electrification reduce emissions now, or only after grid improvements?
- Does it lower total cost of ownership?
- Does it improve indoor air, noise, safety, comfort, or reliability?
- Does it increase peak-load stress, and can demand response or storage help?
- Can the community maintain the equipment?
- Are incentives, financing, or training needed?

## 3. Transmission And Resilience Planner

Tesla's AC work helped make long-distance electricity practical. Today's grid problem is different: renewable-rich areas often sit far from major load centers, extreme weather stresses networks, and distributed resources need better coordination.

NREL transmission research focuses on integrating energy technologies into the bulk-power system while maintaining safe, efficient, cost-effective grids. NREL also notes that the U.S. transmission system needs upgrades and expansion to carry larger amounts of clean energy across longer distances, and that HVDC can reduce losses by as much as 50% in certain long-distance comparisons with HVAC.

### What to build

- a grid bottleneck explainer for non-experts
- a transmission-benefit checklist: reliability, congestion relief, clean-energy access, resilience, customer cost
- a microgrid planner for remote, rural, campus, clinic, school, and disaster-response use
- an outage-response map that pairs distributed energy with critical services
- a grid-enhancing technology index: dynamic line ratings, power-flow control, advanced conductors, storage, demand response, virtual power plants

### Product idea

Build a "lights stay on" scenario tool:

- choose a community type
- choose the failure event: storm, heat wave, fire, flood, fuel shortage, cyber event
- choose assets: solar, wind, battery, generator, microgrid controller, critical loads, communications
- generate a ranked resilience plan with limits and assumptions

## 4. Universal Communication And Emergency Mesh

Wardenclyffe was not completed, but the communication ambition was legitimate: make information travel widely and quickly. The planet-scale version today is not one tower. It is many resilient communication paths.

### What to build

- a public communication stack map: fiber, cellular, satellite, Wi-Fi, radio, LoRa, mesh, local servers
- emergency notification workflows for disaster zones
- low-bandwidth education packs for disconnected communities
- local-first knowledge mirrors for schools and clinics
- community training for radio, batteries, antennas, and basic network troubleshooting

### Safety and governance

- emergency systems need test schedules, not only hardware
- public alerts must handle false alarms and accessibility
- local mesh networks should define moderation, privacy, and emergency override rules
- medical, legal, financial, and safety guidance needs source quality and human review

## 5. Targeted Wireless Power Research

Tesla's wireless-power dreams should become careful engineering research, not broad claims. Wireless power is useful when a wire is impossible, unsafe, expensive, or operationally limiting.

### Practical lanes

- short-range inductive charging for phones, tools, sensors, robots, and medical devices
- resonant charging for fixed docks and sealed environments
- dynamic wireless charging research for specialty vehicles or controlled routes
- optical or microwave power beaming for specialized unmanned systems, remote sensors, or space/defense applications
- wireless-power education labs that measure distance, alignment, losses, heat, shielding, and exposure limits

### Reality checks

- efficiency must be measured from wall plug to useful load
- safety must include bystanders, implants, animals, heat, fire, and electromagnetic interference
- receivers matter as much as transmitters
- public spectrum and regulatory constraints matter
- line-of-sight systems are not general grid replacements
- atmospheric losses, weather, aiming, and interruption risks must be modeled

DARPA's 2025 POWER demonstration shows that serious power beaming research is active, with more than 800 watts delivered for 30 seconds from 8.6 kilometers away in a controlled test. That is meaningful research progress, but it is not evidence for unlimited public wireless grid power.

## 6. Remote Inspection And Repair Robotics

Tesla's radio-controlled boat matters because it separated human intent from machine location. That idea can reduce risk anywhere the work is dangerous, remote, repetitive, or time-sensitive.

### What to build

- inspection workflows for power lines, substations, bridges, roofs, solar farms, pipelines, tunnels, farms, ports, and flood zones
- robot task cards: observe, measure, photograph, sample, carry, mark, repair, return
- fail-safe requirements: geofencing, emergency stop, battery reserve, communication loss behavior, human override
- evidence package: before/after images, GPS or map position, sensor readings, operator, timestamp, confidence, warnings
- training simulator for students and operators

### Public benefits

- fewer workers sent into confined, high-voltage, flooded, burning, or unstable environments
- faster post-disaster assessment
- lower inspection cost for small utilities and municipalities
- better environmental monitoring for rivers, coasts, forests, farms, and mines

## 7. Safe Public Science Labs

Tesla's demonstrations are useful because they make invisible fields visible. The wiki should turn that into safe education, not dangerous imitation.

### Lab modules

| Module | Teaches | Safer activity |
| --- | --- | --- |
| rotating magnetic field | induction motor basics | low-voltage three-phase simulation or animation |
| motor efficiency | load, speed, torque, losses | compare small DC/AC motors with measured input/output limits |
| transformer action | voltage, current, turns ratio | low-voltage transformer demo with supervision |
| resonance | frequency, coupling, Q factor | audio-frequency LC simulation before any high-voltage hardware |
| wireless power | alignment, distance, losses | low-power inductive charging experiment |
| radio control | signals and actuation | microcontroller robot with fail-safe stop |
| grid resilience | loads, storage, priority circuits | microgrid board game or spreadsheet simulation |

### Rules

- no high-voltage builds without trained supervision
- no unshielded RF experiments that can interfere with communications
- no medical-device-adjacent experiments
- no claims of "free energy" without a measured source, load, losses, and independent replication
- every lab ends with a source, uncertainty, and deployment discussion

## 8. Claims Triage System

Tesla content needs a built-in truth filter.

| Claim class | Meaning | Example handling |
| --- | --- | --- |
| Proven | historically documented and technically validated | AC induction motor, polyphase AC concepts, radio remote control patent |
| Proven but evolved | real concept, modern version differs | AC transmission, high-frequency resonant circuits, remote control |
| Plausible niche | possible in constrained cases, not universal | bladeless turbine, targeted wireless power, atmospheric sensing |
| Experimental | active research with limited deployment | optical power beaming, dynamic wireless EV charging |
| Uncompleted | historically attempted but not demonstrated at promised scale | Wardenclyffe global wireless power |
| Unsupported | lacks source, measurement, or replication | over-unity machines, secret completed free-energy grid |
| False or unsafe | violates known physics, safety, or evidence | perpetual motion, unlimited extraction without source or losses |

### Claim review checklist

- What is the primary source?
- Is it a patent, demonstration, article, biography, reconstruction, or fan claim?
- What was actually built?
- What was measured?
- What was the input energy?
- What was the useful output energy?
- What losses were included?
- Was it independently replicated?
- What safety standard or exposure limit applies?
- What would make the claim false?

## App integration ideas

### Wiki

- add linked Tesla pages for AC systems, induction motors, wireless power, remote control, and claim hygiene
- make "proven / experimental / unsupported" visible on every Tesla-related article
- connect Tesla content to energy-materials, infrastructure, future-cities, and science categories

### Schools

- build a Tesla systems lesson path:
  - lesson 1: energy source to useful work
  - lesson 2: rotating magnetic fields
  - lesson 3: motor audit
  - lesson 4: grid resilience
  - lesson 5: wireless communication versus wireless power
  - lesson 6: remote control and robotics safety
  - lesson 7: claim triage

### Agents

- add prompt blocks for motor-efficiency audits
- add a source-backed Tesla claim checker
- add project templates for microgrids, emergency mesh, and inspection robots
- require claim class, source quality, measured inputs/outputs, and safety notes before a Tesla-inspired recommendation is marked ready

## Minimal next implementation

1. Add a Tesla search bundle in the app wiki article. Status: started.
2. Add a "Tesla Systems Lab" school track. Status: drafted as a wiki curriculum blueprint.
3. Add a motor-audit worksheet. Status: drafted as a wiki operational worksheet.
4. Add a claim-triage helper in the research UI. Status: drafted as a wiki checker.
5. Add a microgrid and emergency-communications scenario template. Status: still open.

## Source list

- Companion report, Nikola Tesla Projects And Planetary Impact: /Users/cswanson/the-underground-circle/docs/wiki/nikola-tesla-projects-planetary-impact-2026-06-01.md
- Smithsonian National Museum of American History, Westinghouse alternating current induction motor: https://americanhistory.si.edu/collections/object/nmah_713594
- U.S. Energy Information Administration, Nikola Tesla energy history page: https://www.eia.gov/kids/history-of-energy/famous-people/tesla.php
- International Energy Agency, Energy-Efficiency Policy Opportunities for Electric Motor-Driven Systems: https://www.iea.org/reports/energy-efficiency-policy-opportunities-for-electric-motor-driven-systems
- U.S. Energy Information Administration, Electricity use by machine drives varies significantly by manufacturing industry: https://www.eia.gov/todayinenergy/detail.php?id=13431
- National Renewable Energy Laboratory, Transmission Planning: https://www.nrel.gov/grid/transmission-planning.html
- National Renewable Energy Laboratory, On the Road to Increased Transmission: High-Voltage Direct Current: https://www.nrel.gov/news/detail/program/2024/on-the-road-to-increased-transmission-high-voltage-direct-current
- Department of Energy, Grid Deployment and Transmission: https://www.energy.gov/topics/grid-deployment-and-transmission
- International Energy Agency, Electricity Grids and Secure Energy Transitions: https://www.iea.org/reports/electricity-grids-and-secure-energy-transitions
- DARPA, POWER program distance record for power beaming: https://www.darpa.mil/news/2025/darpa-program-distance-record-power-beaming
- DARPA, Persistent Optical Wireless Energy Relay program: https://www.darpa.mil/research/programs/power
- Tesla Science Center at Wardenclyffe, The Tower: https://teslasciencecenter.org/history/tower/
- PBS, Tesla: Master of Lightning, Remote Control: https://www.pbs.org/tesla/ins/lab_remotec.html
- Google Patents, US381968A, Electro-magnetic motor: https://patents.google.com/patent/US381968A/en
- Google Patents, US613809A, Method of and apparatus for controlling mechanism of moving vessels or vehicles: https://patents.google.com/patent/US613809A/en
