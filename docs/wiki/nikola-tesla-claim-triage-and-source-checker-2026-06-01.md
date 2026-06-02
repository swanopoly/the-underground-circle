# Nikola Tesla Claim Triage And Source Checker

Last updated: 2026-06-01

Status: dated research-control guide. Use this whenever Tesla-related claims touch energy, wireless power, medicine, safety, investment, education, or public infrastructure.

## Purpose

Tesla research is valuable, but it attracts unsupported claims. The goal of this checker is to preserve the real engineering value while filtering myth, unsafe advice, and fake certainty.

Every Tesla claim should answer:

- What exactly is being claimed?
- What source supports it?
- What was actually built or measured?
- What inputs, outputs, losses, and safety limits were included?
- Is the claim historical, experimental, deployable, speculative, unsupported, or false?

## Claim classes

| Class | Meaning | Examples |
| --- | --- | --- |
| Proven | historically documented and technically validated | AC induction motor, polyphase AC ideas, radio remote control patent |
| Proven but evolved | original principle was real, modern systems differ | AC transmission, high-frequency resonant circuits, remote-controlled machines |
| Plausible niche | may work in bounded cases but is not a general solution | Tesla turbine, targeted wireless power, special sensing concepts |
| Experimental | active research or prototype with constrained conditions | optical power beaming, dynamic wireless EV charging, remote energy relay systems |
| Uncompleted | historically attempted but not demonstrated at promised scale | Wardenclyffe global wireless power |
| Unsupported | lacks source, measurement, or independent replication | secret free-energy machines, hidden completed global power networks |
| False or unsafe | violates measurement, known physics, safety, or law | perpetual motion, unlimited energy without source/losses, unsafe high-voltage instructions |

## Source quality ladder

| Rank | Source type | How to use it |
| --- | --- | --- |
| 1 | patent, museum collection, official archive, standards body, government technical source | strong for what was filed, displayed, regulated, or measured |
| 2 | peer-reviewed engineering paper or technical report | strong if methods and limits are clear |
| 3 | reputable historical biography or documentary with citations | useful context, not enough for engineering claims alone |
| 4 | company demo, press release, conference talk | useful for current activity, requires technical follow-up |
| 5 | blog, forum, video, social post | lead only; needs stronger confirmation |
| 6 | anonymous claim, miracle device, investment pitch without data | treat as unsupported until independently proven |

## Claim intake form

| Field | Required answer |
| --- | --- |
| Claim | One sentence, no hype words. |
| Claim class | proven, evolved, niche, experimental, uncompleted, unsupported, false/unsafe |
| Source | URL or citation |
| Source type | patent, museum, government, standard, paper, demo, article, blog, unknown |
| Built artifact | what device/system existed |
| Measured input | electrical, mechanical, thermal, chemical, solar, fuel, battery, environmental |
| Measured output | useful load, power, energy, communication range, motion, data, heat |
| Losses included | yes, no, partial, unknown |
| Independent replication | yes, no, partial, unknown |
| Safety limits | electrical, RF, thermal, mechanical, chemical, medical, occupational |
| Deployment boundary | lab, classroom, industrial, grid, medical, public, unknown |
| Recommendation | use, study, prototype cautiously, reject, escalate to expert |

## Red flags

- "free energy" without a defined energy source
- no input measurement
- no useful output measurement
- output measured only as voltage with no load
- hidden circuit or sealed device
- vague references to "a patent" without explaining what the patent actually claims
- "suppressed by industry" as the main evidence
- no safety boundary for high voltage, RF, lasers, rotating machinery, pressure, heat, or batteries
- investment or purchase ask before independent test data
- medical, biological, or healing claims without regulated clinical evidence

## Wireless-power triage

Wireless power needs tighter filtering because it is easy to confuse several different things.

| Claim | Likely class | Required evidence |
| --- | --- | --- |
| Short-range inductive charging | proven/evolved | wall-to-load efficiency, coil distance, alignment, heat, device compatibility |
| Resonant charging across a room | experimental/niche | field strength, bystander exposure, receiver efficiency, interference, repeatability |
| Dynamic EV road charging | experimental/niche | route design, vehicle receiver, power level, grid impact, maintenance, cost |
| Optical or microwave power beaming | experimental | line of sight, aiming safety, exposure limits, weather effects, conversion efficiency |
| Global broadcast power replacing the grid | unsupported/uncompleted | independent full-system demonstration, losses, receiver design, safety, interference, governance |
| Unlimited power from the air | false or unsupported | defined source, measured input, measured output, independent replication |

## Safety references to check

- OSHA lockout/tagout for hazardous energy during service and maintenance
- OSHA RF and microwave exposure evaluation resources for occupational RF work
- FCC RF exposure compliance resources for radio transmitters and devices in the United States
- ICNIRP RF EMF guidelines for 100 kHz to 300 GHz exposure references
- FDA wireless medical device guidance when RF, wireless control, monitoring, coexistence, or electromagnetic compatibility can affect health devices
- local electrical code, fire code, lab rules, and school policy

## Output format for agents

```text
Tesla Claim Review
Claim:
Claim class:
Primary source:
Source quality:
Built artifact:
Measured input:
Measured output:
Losses included:
Replication status:
Safety boundary:
Decision:
Reason:
Next evidence needed:
```

## Examples

### AC induction motor

```text
Claim class: proven
Primary source: patents, Smithsonian collection, energy-history sources
Decision: use as a historical and engineering foundation
Reason: documented invention family and durable deployed motor technology
```

### Wardenclyffe global wireless power

```text
Claim class: uncompleted
Primary source: Tesla Science Center historical record and Tesla patents
Decision: study as historical ambition; do not present as completed grid technology
Reason: tower was not completed as promised infrastructure and was demolished in 1917
```

### Over-unity generator

```text
Claim class: unsupported or false
Primary source: usually weak or absent
Decision: reject until independent measurement proves source, load, losses, and replication
Reason: no deployable energy system can skip conservation, losses, safety, and measurement
```

## Product integration

- Add this checker to the research UI for Tesla topics.
- Require claim class and source quality before agent-generated Tesla content is marked ready.
- Show a warning when a claim mentions free energy, over-unity, healing, anti-gravity, weapon, high voltage, RF exposure, or investment.
- Let users convert a weak claim into a research task instead of deleting it.
- Store "uncompleted" separately from "false" so ambitious historical projects are not misrepresented.

## Source list

- Smithsonian National Museum of American History, Westinghouse alternating current induction motor: https://americanhistory.si.edu/collections/object/nmah_713594
- Tesla Science Center at Wardenclyffe, The Tower: https://teslasciencecenter.org/history/tower/
- Tesla Museum, Tesla patents: https://tesla-museum.org/en/nikola-tesla-2/patents/
- Google Patents, US381968A, Electro-magnetic motor: https://patents.google.com/patent/US381968A/en
- Google Patents, US613809A, Method of and apparatus for controlling mechanism of moving vessels or vehicles: https://patents.google.com/patent/US613809A/en
- DARPA POWER program distance record: https://www.darpa.mil/news/2025/darpa-program-distance-record-power-beaming
- DARPA Persistent Optical Wireless Energy Relay: https://www.darpa.mil/research/programs/power
- OSHA lockout/tagout fact sheet: https://www.osha.gov/sites/default/files/publications/OSHAFS3529.pdf
- OSHA RF and microwave exposure evaluation: https://www.osha.gov/radiofrequency-and-microwave-radiation/exposure-evaluation
- ICNIRP RF EMF guidelines: https://www.icnirp.org/en/frequencies/radiofrequenc
- FDA wireless medical devices: https://www.fda.gov/medical-devices/digital-health-center-excellence/wireless-medical-devices
