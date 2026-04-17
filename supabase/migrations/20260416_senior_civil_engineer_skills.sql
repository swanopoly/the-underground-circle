-- Senior Civil Engineer skills
-- These skills seed domain-specific prompt fragments for civil/infrastructure SOULs.

INSERT INTO skills (name, display_name, description, category, prompt_fragment, required_tools, cost_tier)
VALUES
  (
    'civil_licensure_scope',
    'Civil Licensure And Scope',
    'Apply FE/PE/SE scope judgment, define assumptions, and separate conceptual guidance from sealed-design decisions.',
    'general',
    'For civil-engineering requests, identify whether the question is conceptual planning, code interpretation, construction review, or site-specific sealed-design work. State the governing assumptions, jurisdiction/code unknowns, and when local PE/SE review is mandatory before execution.',
    '{search_memories,fetch_url}',
    'low'
  ),
  (
    'civil_field_and_lab_testing',
    'Civil Field And Lab Testing',
    'Reason about soil, earthwork, concrete, foundation, pavement, and survey verification workflows using standard civil QA/QC logic.',
    'ops',
    'When the task touches field quality, organize the answer around: (1) required inputs/tests, (2) acceptance criteria, (3) likely failure modes, (4) missing records, and (5) hold points before construction proceeds. Include earthwork, concrete, deep foundation, pavement, or survey controls as relevant.',
    '{search_memories,fetch_url}',
    'low'
  ),
  (
    'civil_structural_and_material_codes',
    'Civil Structural And Material Codes',
    'Apply civil structural/material reasoning across loads, detailing, durability, concrete, steel, and owner standards.',
    'research',
    'For structural civil questions, identify the governing load path, serviceability/strength checks, material standard family, detailing constraints, durability exposure, and constructability implications. If code edition or owner standard is unknown, say that explicitly and avoid false precision.',
    '{search_memories,fetch_url}',
    'medium'
  ),
  (
    'civil_drainage_and_permitting',
    'Civil Drainage And Permitting',
    'Work through hydrology, drainage, stormwater, erosion/sediment control, culvert, and permit-sensitive civil design questions.',
    'ops',
    'When drainage or stormwater is involved, structure the answer as: drainage area and assumptions, design storm/criteria, conveyance/storage intent, erosion and outfall stability, maintenance implications, and permit/compliance checkpoints such as SWPPP or dewatering constraints.',
    '{search_memories,fetch_url}',
    'medium'
  ),
  (
    'civil_construction_admin_qaqc',
    'Civil Construction Admin And QA/QC',
    'Support RFIs, submittals, field reports, punchlists, and construction-phase civil risk review.',
    'ops',
    'For construction-phase civil work, respond with a senior-engineer review format: (1) issue summary, (2) governing drawing/spec/code references if known, (3) field risk, (4) recommended disposition, (5) documentation needed for closeout. Prioritize safety, constructability, and traceable decision records.',
    '{search_memories,fetch_url}',
    'low'
  )
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
