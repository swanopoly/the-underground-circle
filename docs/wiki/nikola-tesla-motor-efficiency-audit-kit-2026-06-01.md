# Nikola Tesla Motor Efficiency Audit Kit

Last updated: 2026-06-01

Status: dated operational worksheet. Use this with the companion roadmap: [nikola-tesla-systems-buildout-roadmap-2026-06-01.md](/Users/cswanson/the-underground-circle/docs/wiki/nikola-tesla-systems-buildout-roadmap-2026-06-01.md).

## Purpose

Tesla's induction motor work becomes most useful today when it turns into motor-system efficiency projects. This worksheet helps a user, student, facility operator, or agent identify where motors, pumps, fans, compressors, HVAC, irrigation, and drives waste energy or create reliability risk.

This is not an electrical engineering stamp. It is a structured intake and ranking tool. Any electrical work, lockout/tagout, panel access, wiring change, VFD installation, or high-voltage inspection needs qualified people and local code compliance.

## Why motor systems first

Electric motors often hide in plain sight. They run pumps, fans, compressors, conveyors, machine tools, HVAC equipment, refrigeration, irrigation, and water systems. Better motors help, but the best savings usually come from the whole system: right-sizing, reducing unnecessary load, better controls, fixing mechanical losses, and matching speed to demand.

The DOE Better Buildings / Better Plants motor guidance says efficient operation of industrial motor and drive systems requires attention to the whole system, not only one component. EIA reports that more than 70% of total potential motor-system energy savings can come through system improvements such as reducing loads, controlling motor speed, matching component size to load, upgrading components, better maintenance, and downsizing where appropriate.

## Safety boundary

Before any physical inspection or change:

- do not open electrical panels unless qualified
- do not touch conductors, terminals, drives, or energized equipment
- do not bypass guards, interlocks, overload protection, or emergency stops
- do not use phone photos inside restricted electrical cabinets unless facility policy allows it
- follow OSHA lockout/tagout for service and maintenance where hazardous energy may be released
- record observations from nameplates, displays, utility bills, and operator interviews when safe access is not available

## Intake form

| Field | Example | Notes |
| --- | --- | --- |
| Site | school shop, farm pump house, factory line, apartment HVAC room | Keep private addresses out of public reports. |
| Equipment name | chilled-water pump 2, grain fan, compressor A | Use the facility's label if it has one. |
| Load type | pump, fan, compressor, conveyor, HVAC, refrigeration, irrigation, machine tool | Load type drives the recommendation. |
| Motor rating | hp or kW | Read from nameplate when safe. |
| Voltage and phase | 120 V, 240 V, 480 V, 3-phase | For qualified review only. |
| Runtime | hours/day and days/year | Runtime is the biggest savings multiplier. |
| Load pattern | constant, variable, seasonal, intermittent | Variable loads may be VFD/control candidates. |
| Existing control | on/off, throttled valve, damper, VFD, staged, unknown | Throttling often signals wasted energy. |
| Process need | what the motor actually does | Prevents optimizing the wrong thing. |
| Symptoms | heat, vibration, noise, leaks, trips, belt dust, bearing issues | Reliability clues. |
| Measured data | current, kW, flow, pressure, temperature, vibration | Optional and only by qualified personnel. |
| Utility rate | dollars/kWh | Needed for simple payback. |
| Criticality | low, medium, high, life/safety | Critical loads need conservative plans. |
| Maintenance owner | person/team/vendor | Recommendations need an owner. |

## Quick triage

| Signal | Why it matters | First action |
| --- | --- | --- |
| Runs many hours per year | Savings compound fast | prioritize for metering and review |
| Variable demand but fixed speed | Strong control opportunity | assess VFD or staged control |
| Throttled pump or dampered fan | Energy is being burned to restrict flow | assess speed control and system redesign |
| Oversized motor | Low-load operation can waste energy and hurt power quality | verify load before resizing |
| Hot, loud, vibrating, or tripping | Reliability and efficiency risk | inspect mechanical and electrical health |
| Repeated belt or bearing failures | Mechanical losses or alignment issue | inspect alignment, tension, lubrication |
| No maintenance history | Hidden failure risk | start baseline log |
| Critical load with no spare plan | Operational resilience risk | plan redundancy and outage procedure |

## Scoring rubric

Score each row 0-3.

| Factor | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| Runtime | rare | weekly | daily | nearly continuous |
| Load variability | constant | slight | moderate | highly variable |
| Control mismatch | already optimized | unknown | on/off only | throttled/dampered fixed speed |
| Mechanical symptoms | none | minor | recurring | severe or unsafe |
| Energy cost exposure | low | moderate | high | major bill driver |
| Criticality | low | medium | high | life/safety or production-critical |

Interpretation:

- 0-5: document and revisit
- 6-10: basic inspection and maintenance review
- 11-14: meter or estimate energy use, then rank improvements
- 15-18: high-priority engineering review

## Recommendation engine

| Condition | Candidate recommendation | Notes |
| --- | --- | --- |
| High runtime plus poor maintenance | tune and repair first | Maintenance may be cheaper than replacement. |
| Variable flow pump/fan with throttling | VFD or variable-speed control review | Verify minimum flow, cooling, and process constraints. |
| Oversized motor with low actual load | right-size only after measurement | Avoid under-sizing critical equipment. |
| Old motor, high runtime, standard efficiency | premium/high-efficiency replacement review | Compare lifetime cost, not only purchase price. |
| Bad belts, bearings, vibration | mechanical repair | Motor replacement alone will not fix system losses. |
| Compressed air leaks or pressure abuse | leak repair and pressure optimization | Compressors are often strong savings targets. |
| Unknown load and high bills | temporary metering | Measurement beats guesswork. |
| Life/safety or critical equipment | reliability review first | Savings cannot outrank safety. |

## Simple estimation

Use this only as a rough screen:

```text
estimated annual kWh = input kW x annual runtime hours
estimated annual cost = annual kWh x electricity rate
estimated savings = annual cost x expected savings fraction
simple payback = installed project cost / annual savings
```

For motor output conversion:

```text
1 horsepower = 0.746 kW mechanical output
input kW = mechanical output kW / efficiency
```

Do not claim savings without stating assumptions. A 10% savings claim on a continuously running motor may be meaningful. A 30% savings claim on a rarely used motor may not matter.

## Agent output format

When an agent summarizes a motor audit, it should return:

```text
Motor System Audit Summary
Site:
Equipment:
Load type:
Confidence: measured | estimated | unknown
Priority score:
Top issue:
Recommended first action:
Expected benefit:
Safety boundary:
Data needed next:
Sources:
```

## Example

```text
Equipment: chilled-water pump 2
Load type: centrifugal pump
Runtime: 12 hours/day, 220 days/year
Control: fixed speed with throttled discharge valve
Symptoms: vibration and warm bearing housing
Priority score: 14
First action: qualified inspection plus short-term metering
Likely opportunity: repair mechanical issue, then assess VFD/control strategy
Safety boundary: do not open panels or work on pump until lockout/tagout is handled by qualified staff
```

## Implementation backlog

- Add a motor audit form in the app wiki or schools section.
- Add an input calculator for hp, kW, runtime, rate, and savings fraction.
- Add a printable worksheet for students and facility walkthroughs.
- Add an agent prompt block that produces the audit summary format above.
- Add a "needs qualified electrician" warning when voltage, panel, drive, or wiring changes are involved.
- Add a source-backed facility energy recommendation mode that uses the claim triage rules.

## Source list

- DOE Better Buildings / Better Plants, Motors: https://betterbuildingssolutioncenter.energy.gov/better-plants/motors
- U.S. DOE Motor System Market Assessment: https://www.energy.gov/eere/ammto/us-doe-motor-system-market-assessment
- U.S. DOE Pump Systems: https://www.energy.gov/eere/ito/pump-systems
- EIA, Minimum efficiency standards for electric motors: https://www.eia.gov/todayinenergy/detail.cfm?id=18151
- EIA, Machine drives in manufacturing: https://www.eia.gov/todayinenergy/detail.php?id=13431
- IEA, Energy-Efficiency Policy Opportunities for Electric Motor-Driven Systems: https://www.iea.org/reports/energy-efficiency-policy-opportunities-for-electric-motor-driven-systems
- OSHA, Lockout/Tagout fact sheet: https://www.osha.gov/sites/default/files/publications/OSHAFS3529.pdf
- Companion Tesla report: /Users/cswanson/the-underground-circle/docs/wiki/nikola-tesla-projects-planetary-impact-2026-06-01.md

