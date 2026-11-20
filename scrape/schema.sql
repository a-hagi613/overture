-- HiringCafe seed data — relational schema (SQLite)
--
-- Design notes
-- ------------
-- * `jobs`            one row per posting HiringCafe indexes (natural key = objectID).
-- * `job_facets`      1:1 with jobs: the categorisation the site computes per posting
--                     (shifts, physical demand, degrees, clearance, perks). Split out so
--                     `jobs` stays the "identity + pay + where + when" table.
-- * `descriptions`    1:1 with jobs but fetched later and large, hence its own table.
-- * `companies`       deduped employer dimension referenced by jobs.company_id.
-- * everything that is a list in the source lives in a junction table:
--                     locations, commitments, tools, licences, languages, degree fields,
--                     role activities, plus company industries / activities / aliases /
--                     subsidiaries / funding investors.
-- * enum-ish text is stored verbatim except for the site's own "no signal" markers
--   ("None", "Not Indicated"), which are normalised to NULL.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- employers
CREATE TABLE IF NOT EXISTS companies (
    id                  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,
    website             TEXT,
    tagline             TEXT,
    industry            TEXT,          -- company_sector_and_industry
    organization_type   TEXT,          -- Private / Public / Nonprofit / Government ...
    org_classification  TEXT,          -- direct_employer / staffing_agency ...
    board_classification TEXT,
    employee_count      INTEGER,
    founded_year        INTEGER,
    hq_country          TEXT,
    parent_company      TEXT,
    stock_symbol        TEXT,
    stock_exchange      TEXT,
    funding_type        TEXT,
    funding_year        INTEGER,
    funding_amount      INTEGER,
    org_entity_id       TEXT,
    external_id         TEXT,
    enriched_at         TEXT,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_industries (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    industry   TEXT NOT NULL,
    PRIMARY KEY (company_id, industry)
);

CREATE TABLE IF NOT EXISTS company_activities (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    activity   TEXT NOT NULL,
    PRIMARY KEY (company_id, activity)
);

CREATE TABLE IF NOT EXISTS company_aliases (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    alias      TEXT NOT NULL,
    PRIMARY KEY (company_id, alias)
);

CREATE TABLE IF NOT EXISTS company_subsidiaries (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    PRIMARY KEY (company_id, name)
);

CREATE TABLE IF NOT EXISTS company_funding_investors (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    investor   TEXT NOT NULL,
    PRIMARY KEY (company_id, investor)
);

-- -------------------------------------------------------------------- jobs
CREATE TABLE IF NOT EXISTS jobs (
    object_id            TEXT PRIMARY KEY,     -- HiringCafe objectID (source ___ board ___ req)
    requisition_id       TEXT UNIQUE,          -- key of https://hiringcafe.com/job/<id>
    company_id           INTEGER REFERENCES companies(id),
    title                TEXT NOT NULL,
    core_job_title       TEXT,
    job_url              TEXT,
    apply_url            TEXT,
    -- provenance
    source               TEXT,                 -- ATS slug: workday, greenhouse, adp, ...
    board_token          TEXT,
    collapse_key         TEXT,
    strict_dedup_cluster_id TEXT,
    liberal_dedup_cluster TEXT,
    original_source_id   TEXT,
    attributed_org_name  TEXT,                 -- employer the site attributed the posting to
    attributed_org_id    TEXT,                 -- org_entity_id of that employer
    -- where
    location_raw         TEXT,                 -- "Austin, Texas, United States"
    workplace_type       TEXT,                 -- Onsite | Hybrid | Remote
    latitude             REAL,
    longitude            REAL,
    -- what
    department           TEXT,                 -- job_category
    role_type            TEXT,                 -- Individual Contributor | People Manager
    seniority_level      TEXT,                 -- Entry / Mid / Senior / ...
    yoe_min              INTEGER,
    management_yoe_min   INTEGER,
    requirements_summary TEXT,
    -- pay
    salary_currency      TEXT,
    salary_frequency     TEXT,                 -- Yearly | Hourly | Monthly | Weekly | Daily | Bi-weekly
    salary_min           REAL,                 -- in the listed frequency
    salary_max           REAL,
    salary_yearly_min    REAL,                 -- normalised, for sorting / filters
    salary_yearly_max    REAL,
    is_compensation_transparent INTEGER,
    visa_sponsorship     INTEGER,              -- 1 = offered, 0 = not offered, NULL = unknown
    -- when
    published_at         TEXT,                 -- ISO-8601 UTC, site's estimated publish date
    first_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
    is_expired           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_jobs_company     ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_department  ON jobs(department);
CREATE INDEX IF NOT EXISTS idx_jobs_seniority   ON jobs(seniority_level);
CREATE INDEX IF NOT EXISTS idx_jobs_published   ON jobs(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_salary      ON jobs(salary_yearly_min, salary_yearly_max);
CREATE INDEX IF NOT EXISTS idx_jobs_source      ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_workplace   ON jobs(workplace_type);

-- ------------------------------------------------------------ job facets
CREATE TABLE IF NOT EXISTS job_facets (
    job_id TEXT PRIMARY KEY REFERENCES jobs(object_id) ON DELETE CASCADE,
    -- physical / cognitive demands
    workplace_physical_environment  TEXT,   -- Office | Warehouse | Outdoor ...
    physical_labor_intensity        TEXT,   -- Low | Medium | High
    physical_position               TEXT,   -- Sitting | Standing | Walking ...
    computer_usage                  TEXT,   -- Low | Medium | High
    cognitive_demand                TEXT,
    oral_communication_level        TEXT,
    -- schedule
    morning_shift_work              TEXT,
    evening_shift_work              TEXT,
    overnight_work                  TEXT,
    weekend_availability_required   INTEGER,
    holiday_availability_required   INTEGER,
    overtime_required               INTEGER,
    on_call_requirement             TEXT,
    four_day_work_week              INTEGER,
    -- travel
    air_travel_requirement          TEXT,
    land_travel_requirement         TEXT,
    -- eligibility / requirements
    security_clearance              TEXT,
    is_high_school_required         INTEGER,
    is_driver_license_required      INTEGER,
    associates_degree_requirement   TEXT,
    bachelors_degree_requirement    TEXT,
    masters_degree_requirement      TEXT,
    doctorate_degree_requirement    TEXT,
    licenses_or_certifications_not_mentioned INTEGER,
    is_industry_and_role_yoe_not_mentioned    INTEGER,
    is_management_yoe_not_mentioned           INTEGER,
    relocation_assistance           INTEGER,
    -- perks
    "401k_matching"                 INTEGER,
    retirement_plan                 INTEGER,
    tuition_reimbursement           INTEGER,
    generous_paid_time_off          INTEGER,
    generous_parental_leave         INTEGER,
    fair_chance                     INTEGER,
    military_veterans               INTEGER,
    -- misc
    is_workplace_worldwide_ok       INTEGER,
    position_employer_type          TEXT,   -- Internal Position | ...
    num_language_requirements       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_facets_clearance ON job_facets(security_clearance);
CREATE INDEX IF NOT EXISTS idx_facets_physical  ON job_facets(workplace_physical_environment);

-- ------------------------------------------------------------- junction
CREATE TABLE IF NOT EXISTS job_locations (
    job_id       TEXT NOT NULL REFERENCES jobs(object_id) ON DELETE CASCADE,
    scope        TEXT NOT NULL,    -- 'workplace' | 'boundless'
    level        TEXT NOT NULL,    -- continent | country | state | county | city
    value        TEXT NOT NULL,    -- as shown by HiringCafe ("Ontario, CA")
    country_code TEXT,
    PRIMARY KEY (job_id, scope, level, value)
);

CREATE TABLE IF NOT EXISTS job_commitments (
    job_id     TEXT NOT NULL REFERENCES jobs(object_id) ON DELETE CASCADE,
    commitment TEXT NOT NULL,      -- Full Time | Part Time | Contract | Internship | Temporary | Seasonal
    PRIMARY KEY (job_id, commitment)
);

CREATE TABLE IF NOT EXISTS job_tools (
    job_id TEXT NOT NULL REFERENCES jobs(object_id) ON DELETE CASCADE,
    tool   TEXT NOT NULL,
    PRIMARY KEY (job_id, tool)
);

CREATE TABLE IF NOT EXISTS job_licenses (
    job_id  TEXT NOT NULL REFERENCES jobs(object_id) ON DELETE CASCADE,
    license TEXT NOT NULL,
    PRIMARY KEY (job_id, license)
);

CREATE TABLE IF NOT EXISTS job_languages (
    job_id   TEXT NOT NULL REFERENCES jobs(object_id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    PRIMARY KEY (job_id, language)
);

CREATE TABLE IF NOT EXISTS job_degree_fields (
    job_id TEXT NOT NULL REFERENCES jobs(object_id) ON DELETE CASCADE,
    level  TEXT NOT NULL,          -- associates | bachelors | masters | doctorate
    field  TEXT NOT NULL,
    PRIMARY KEY (job_id, level, field)
);

CREATE TABLE IF NOT EXISTS job_role_activities (
    job_id   TEXT NOT NULL REFERENCES jobs(object_id) ON DELETE CASCADE,
    activity TEXT NOT NULL,
    PRIMARY KEY (job_id, activity)
);

-- ----------------------------------------------------------- descriptions
CREATE TABLE IF NOT EXISTS descriptions (
    job_id      TEXT PRIMARY KEY REFERENCES jobs(object_id) ON DELETE CASCADE,
    html        TEXT,
    text        TEXT,
    word_count  INTEGER,
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | done | gone | error
    http_status INTEGER,
    fetched_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_desc_status ON descriptions(status);

-- --------------------------------------------------------- crawl progress
CREATE TABLE IF NOT EXISTS shards (
    id      INTEGER PRIMARY KEY,
    dfrom   TEXT NOT NULL,
    dto     TEXT NOT NULL,
    filters TEXT,                                    -- extra searchState JSON: workplace/role splits
    total   INTEGER,
    status  TEXT NOT NULL DEFAULT 'pending'          -- pending | done | split
);

CREATE TABLE IF NOT EXISTS pages (
    shard_id INTEGER NOT NULL REFERENCES shards(id) ON DELETE CASCADE,
    page     INTEGER NOT NULL,
    hits     INTEGER,
    PRIMARY KEY (shard_id, page)
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

-- ---------------------------------------------------------------- views
DROP VIEW IF EXISTS v_jobs;
CREATE VIEW v_jobs AS
SELECT
    j.object_id,
    j.requisition_id,
    j.title,
    j.core_job_title,
    c.name                AS company,
    c.website             AS company_website,
    c.industry            AS company_industry,
    c.employee_count      AS company_size,
    j.location_raw        AS location,
    j.workplace_type,
    j.department,
    j.role_type,
    j.seniority_level,
    j.yoe_min,
    j.salary_currency,
    j.salary_frequency,
    j.salary_min,
    j.salary_max,
    j.salary_yearly_min,
    j.salary_yearly_max,
    j.visa_sponsorship,
    j.published_at,
    j.source,
    j.apply_url,
    j.job_url,
    f.security_clearance,
    f.workplace_physical_environment,
    f.physical_labor_intensity,
    f.morning_shift_work,
    f.evening_shift_work,
    f.overnight_work,
    f.weekend_availability_required,
    f.bachelors_degree_requirement,
    f."401k_matching",
    d.status              AS description_status,
    length(d.text)        AS description_chars
FROM jobs j
LEFT JOIN companies  c ON c.id = j.company_id
LEFT JOIN job_facets f ON f.job_id = j.object_id
LEFT JOIN descriptions d ON d.job_id = j.object_id;
