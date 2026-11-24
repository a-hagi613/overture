import type { RoleGroup } from "../../shared/tag-taxonomy.ts";

/**
 * One human-friendly Level-2 role and the Level-1 category it rolls up to. The rule table is ordered from the most
 * specific title to the most generic, and the first match wins, so `senior backend engineer` reaches
 * `Backend Engineer` before `Software Engineer` ever sees it.
 */
export interface GranularRoleRule {
  readonly role: string;
  readonly category: RoleGroup;
  readonly pattern: RegExp;
}

/**
 * The Level-2 vocabulary. It is deliberately curated rather than generated: every entry is a phrase a job seeker
 * would recognize as a role, and the table has to stay stable because the baked ESCO dataset records the resolved
 * role strings.
 */
export const GRANULAR_ROLE_RULES: readonly GranularRoleRule[] = [
  {
    role: "Executive Assistant",
    category: "Administrative",
    pattern:
      /\b(?:executive (?:assistant|secretary)|personal assistant|management assistant|assistant to (?:the )?(?:ceo|director|management)|board assistant)\b/iu,
  },
  {
    role: "Office Manager",
    category: "Administrative",
    pattern: /\b(?:office (?:manager|administrator|coordinator)|head of office)\b/iu,
  },
  {
    role: "Administrative Assistant",
    category: "Administrative",
    pattern:
      /\b(?:administrative (?:assistant|officer|clerk|secretary|support|worker)|admin assistant|administration (?:assistant|officer|clerk)|back office)\b/iu,
  },
  {
    role: "Receptionist",
    category: "Administrative",
    pattern: /\b(?:receptionist|front desk|front office|telephonist|switchboard operator)\b/iu,
  },
  {
    role: "Data Entry Clerk",
    category: "Administrative",
    pattern: /\b(?:data entry|data captur|keyboard (?:clerk|operator)|typesetter|stenographer)\b/iu,
  },
  {
    role: "Office Clerk",
    category: "Administrative",
    pattern:
      /\b(?:office clerk|general office clerk|records? (?:clerk|manager|officer)|file clerk|mail clerk|coding clerk|archives? clerk|correspondence clerk|clerk)\b/iu,
  },
  {
    role: "Secretary",
    category: "Administrative",
    pattern: /\b(?:secretary|secretarial|transcriptionist|medical secretary|legal secretary)\b/iu,
  },

  {
    role: "Full-stack Engineer",
    category: "Software Engineering",
    pattern: /\b(?:full ?stack|full-stack)\b/iu,
  },
  {
    role: "Frontend Engineer",
    category: "Software Engineering",
    pattern:
      /\b(?:front ?end|front-end|react (?:developer|engineer)|vue (?:developer|engineer)|angular (?:developer|engineer)|web (?:developer|engineer)|ui (?:developer|engineer)|javascript (?:developer|engineer)|typescript (?:developer|engineer))\b/iu,
  },
  {
    role: "Backend Engineer",
    category: "Software Engineering",
    pattern:
      /\b(?:back ?end|back-end|server[- ]side|api (?:developer|engineer)|java (?:developer|engineer)|python (?:developer|engineer)|golang (?:developer|engineer)|rust (?:developer|engineer)|node(?:\.js)? (?:developer|engineer)|c\+\+ (?:developer|engineer)|\.net (?:developer|engineer)|php (?:developer|engineer)|ruby (?:developer|engineer))\b/iu,
  },
  {
    role: "Mobile Engineer",
    category: "Software Engineering",
    pattern:
      /\b(?:mobile (?:developer|engineer|architect)|ios (?:developer|engineer)|android (?:developer|engineer)|flutter (?:developer|engineer)|react native|swift (?:developer|engineer))\b/iu,
  },
  {
    role: "Embedded Engineer",
    category: "Hardware & Embedded",
    pattern:
      /\b(?:embedded (?:engineer|developer|software)|firmware|microcontroller|\brtos\b|bare metal)\b/iu,
  },
  {
    role: "Platform Engineer",
    category: "Software Engineering",
    pattern:
      /\b(?:platform (?:engineer|developer)|developer experience|developer tooling|internal tools)\b/iu,
  },
  {
    role: "DevOps Engineer",
    category: "DevOps & Infrastructure",
    pattern:
      /\b(?:devops|devsecops|\bci\/?cd\b|build (?:engineer|reliability)|release engineer|deployment engineer)\b/iu,
  },
  {
    role: "Site Reliability Engineer",
    category: "DevOps & Infrastructure",
    pattern:
      /\b(?:site reliability|\bsre\b|reliability engineer|infrastructure (?:engineer|architect))\b/iu,
  },
  {
    role: "Security Engineer",
    category: "Security",
    pattern:
      /\b(?:security (?:engineer|analyst|architect|specialist|consultant|officer)|application security|appsec|infosec|information security|cyber ?security|penetration test|ethical hacker|\bsoc analyst\b|threat intelligence)\b/iu,
  },
  {
    role: "QA Engineer",
    category: "QA & Test",
    pattern:
      /\b(?:\bqa\b|quality assurance|quality engineer|test (?:engineer|analyst|automation|manager)|software tester|\bsdet\b|software testing)\b/iu,
  },
  {
    role: "Data Engineer",
    category: "Data & Analytics",
    pattern:
      /\b(?:data engineer|etl (?:developer|engineer)|data warehouse|big data engineer|analytics engineer|data platform)\b/iu,
  },
  {
    role: "Data Scientist",
    category: "Data & Analytics",
    pattern: /\b(?:data scientist|machine learning scientist|decision scientist)\b/iu,
  },
  {
    role: "Machine Learning Engineer",
    category: "Machine Learning & AI",
    pattern:
      /\b(?:machine learning (?:engineer|developer)|ml engineer|mlops|ai engineer|artificial intelligence engineer|deep learning engineer|nlp engineer|computer vision engineer)\b/iu,
  },
  {
    role: "AI Research Scientist",
    category: "Machine Learning & AI",
    pattern:
      /\b(?:ai research|research scientist|applied scientist|machine learning researcher|nlp scientist|computer vision scientist|research engineer)\b/iu,
  },
  {
    role: "Software Architect",
    category: "Software Engineering",
    pattern:
      /\b(?:software architect|solutions architect|enterprise architect|application architect|systems architect)\b/iu,
  },
  {
    role: "Database Administrator",
    category: "DevOps & Infrastructure",
    pattern: /\b(?:database administrator|database engineer|\bdba\b|data administrator)\b/iu,
  },
  {
    role: "Cloud Engineer",
    category: "DevOps & Infrastructure",
    pattern:
      /\b(?:cloud (?:engineer|architect|administrator|specialist)|aws engineer|azure engineer|gcp engineer)\b/iu,
  },
  {
    role: "Systems Administrator",
    category: "IT & Support Engineering",
    pattern:
      /\b(?:systems? administrator|sysadmin|windows administrator|linux administrator|server administrator|system manager)\b/iu,
  },
  {
    role: "Network Engineer",
    category: "DevOps & Infrastructure",
    pattern: /\b(?:network (?:engineer|administrator|architect|technician|manager))\b/iu,
  },
  {
    role: "IT Support Specialist",
    category: "IT & Support Engineering",
    pattern:
      /\b(?:it support|it specialist|it technician|it officer|help ?desk|desktop support|technical support|support technician|workplace technology|ict support|computer support)\b/iu,
  },
  {
    role: "Hardware Engineer",
    category: "Hardware & Embedded",
    pattern:
      /\b(?:hardware (?:engineer|developer|designer)|electrical engineer|electronics engineer|mechanical engineer|silicon engineer|pcb designer|chip designer)\b/iu,
  },
  {
    role: "Game Developer",
    category: "Software Engineering",
    pattern:
      /\b(?:game (?:developer|engineer|programmer|designer)|unity (?:developer|engineer)|unreal (?:developer|engineer))\b/iu,
  },
  {
    role: "Software Engineer",
    category: "Software Engineering",
    pattern:
      /\b(?:software|application|computer|systems) (?:engineer|developer|programmer)|programmer|software development|webmaster|app developer|engineer\b/iu,
  },
  {
    role: "Software Engineer",
    category: "Software Engineering",
    pattern: /\b(?:developer|programmer)\b/iu,
  },

  {
    role: "Data Analyst",
    category: "Data & Analytics",
    pattern:
      /\b(?:data analyst|business intelligence analyst|bi analyst|analytics (?:analyst|specialist|consultant)|reporting analyst)\b/iu,
  },
  {
    role: "Business Intelligence Developer",
    category: "Data & Analytics",
    pattern:
      /\b(?:business intelligence (?:developer|engineer|consultant)|bi developer|power bi|tableau (?:developer|consultant)|qlik)\b/iu,
  },
  {
    role: "Data Architect",
    category: "Data & Analytics",
    pattern: /\b(?:data architect|information architect)\b/iu,
  },
  {
    role: "Statistician",
    category: "Data & Analytics",
    pattern: /\b(?:statistician|actuar|biostatistician|demographer|quantitative analyst)\b/iu,
  },

  {
    role: "Product Manager",
    category: "Product Management",
    pattern:
      /\b(?:product (?:manager|owner|lead|director|management)|technical product manager|product strategy)\b/iu,
  },
  {
    role: "Product Analyst",
    category: "Product Management",
    pattern: /\b(?:product analyst|product specialist|product consultant)\b/iu,
  },
  {
    role: "Technical Program Manager",
    category: "Project & Program Management",
    pattern:
      /\b(?:technical program manager|program(?:me)? (?:manager|director)|delivery manager|portfolio manager)\b/iu,
  },
  {
    role: "Project Manager",
    category: "Project & Program Management",
    pattern:
      /\b(?:project (?:manager|coordinator|lead|engineer|officer)|project management|scrum master|agile coach|pmo)\b/iu,
  },

  {
    role: "Design Manager",
    category: "Design",
    pattern:
      /\b(?:design (?:manager|director|lead)|creative director|art director|head of design)\b/iu,
  },
  {
    role: "Product Designer",
    category: "Design",
    pattern:
      /\b(?:product designer|ux designer|ui\/?ux|user experience designer|interaction designer|design systems?)\b/iu,
  },
  {
    role: "UX Researcher",
    category: "Design",
    pattern: /\b(?:ux research|user research|design research|usability)\b/iu,
  },
  {
    role: "UI Designer",
    category: "Design",
    pattern: /\b(?:ui designer|visual designer|web designer|interface designer)\b/iu,
  },
  {
    role: "Graphic Designer",
    category: "Design",
    pattern: /\b(?:graphic (?:designer|artist)|illustrator|logo designer)\b/iu,
  },
  {
    role: "Brand Designer",
    category: "Design",
    pattern: /\b(?:brand (?:designer|identity|strategist)|corporate identity)\b/iu,
  },
  {
    role: "Motion Designer",
    category: "Design",
    pattern:
      /\b(?:motion (?:designer|graphics)|animator|3d (?:animator|artist|designer)|vfx artist|multimedia designer)\b/iu,
  },
  {
    role: "Interior Designer",
    category: "Design",
    pattern: /\b(?:interior (?:designer|architect)|decorator|spatial designer)\b/iu,
  },
  {
    role: "Fashion Designer",
    category: "Design",
    pattern: /\b(?:fashion designer|clothing designer|textile designer|costume designer)\b/iu,
  },
  {
    role: "Industrial Designer",
    category: "Design",
    pattern:
      /\b(?:industrial designer|product design engineer|furniture designer|jewellery designer)\b/iu,
  },
  {
    role: "Instructional Designer",
    category: "Education",
    pattern: /\b(?:instructional designer|curriculum (?:developer|designer)|learning designer)\b/iu,
  },

  {
    role: "Marketing Manager",
    category: "Marketing",
    pattern:
      /\b(?:marketing (?:manager|director|lead|specialist|consultant)|marketing management|chief marketing|cmo)\b/iu,
  },
  {
    role: "Growth Marketer",
    category: "Marketing",
    pattern:
      /\b(?:growth (?:marketer|hacker|manager|lead)|demand generation|performance marketing)\b/iu,
  },
  {
    role: "Content Marketer",
    category: "Marketing",
    pattern:
      /\b(?:content (?:marketer|strategist|manager|specialist|writer)|content marketing)\b/iu,
  },
  {
    role: "SEO Specialist",
    category: "Marketing",
    pattern: /\b(?:\bseo\b|search engine optimi|sem specialist|paid search)\b/iu,
  },
  {
    role: "Social Media Manager",
    category: "Marketing",
    pattern:
      /\b(?:social media (?:manager|specialist|strategist|coordinator)|community management)\b/iu,
  },
  {
    role: "Marketing Analyst",
    category: "Marketing",
    pattern:
      /\b(?:marketing analyst|market research|market analyst|brand manager|product marketing)\b/iu,
  },
  {
    role: "Email Marketing Specialist",
    category: "Marketing",
    pattern:
      /\b(?:email marketing|crm (?:specialist|manager|marketer)|lifecycle marketing|marketing automation)\b/iu,
  },
  {
    role: "Events Manager",
    category: "Marketing",
    pattern:
      /\b(?:event(?:s)? (?:manager|coordinator|planner|organiser|organizer)|conference manager)\b/iu,
  },
  {
    role: "Public Relations Manager",
    category: "Communications & PR",
    pattern:
      /\b(?:public relations|pr (?:manager|specialist|officer)|communications (?:manager|director|specialist|officer)|corporate communications|press officer|spokesperson|media relations)\b/iu,
  },
  {
    role: "Copywriter",
    category: "Communications & PR",
    pattern: /\b(?:copywriter|copy ?writer|content creator|advertising writer)\b/iu,
  },
  {
    role: "Technical Writer",
    category: "Communications & PR",
    pattern:
      /\b(?:technical writer|documentation (?:specialist|manager|officer)|technical documentation)\b/iu,
  },
  {
    role: "Editor",
    category: "Communications & PR",
    pattern: /\b(?:editor|editorial|proofreader|publisher|journalist|reporter|author|writer)\b/iu,
  },
  {
    role: "Translator",
    category: "Communications & PR",
    pattern: /\b(?:translator|interpreter|translat|localisation|localization)\b/iu,
  },

  {
    role: "Sales Manager",
    category: "Sales",
    pattern:
      /\b(?:sales (?:manager|director|lead)|head of sales|chief sales|chief revenue|sales management)\b/iu,
  },
  {
    role: "Account Executive",
    category: "Sales",
    pattern: /\b(?:account executive|sales executive|\bae\b|enterprise sales)\b/iu,
  },
  {
    role: "Sales Development Representative",
    category: "Sales",
    pattern:
      /\b(?:sales development|\bsdr\b|\bbdr\b|business development representative|inside sales)\b/iu,
  },
  {
    role: "Account Manager",
    category: "Sales",
    pattern: /\b(?:account manager|key account|client manager|customer manager)\b/iu,
  },
  {
    role: "Solutions Engineer",
    category: "Sales",
    pattern: /\b(?:solutions? engineer|sales engineer|pre-?sales|technical sales)\b/iu,
  },
  {
    role: "Sales Representative",
    category: "Sales",
    pattern:
      /\b(?:sales (?:representative|associate|consultant|agent|assistant)|retail sales|shop assistant|salesperson|commercial agent)\b/iu,
  },
  {
    role: "Real Estate Agent",
    category: "Sales",
    pattern: /\b(?:real estate (?:agent|broker)|estate agent|property (?:agent|consultant))\b/iu,
  },
  {
    role: "Business Development Manager",
    category: "Business Development & Partnerships",
    pattern:
      /\b(?:business development (?:manager|director|executive|officer)|business developer)\b/iu,
  },
  {
    role: "Partnership Manager",
    category: "Business Development & Partnerships",
    pattern:
      /\b(?:partner(?:ship)? (?:manager|director|lead)|strategic alliances|channel (?:manager|sales)|partner development)\b/iu,
  },

  {
    role: "Customer Success Manager",
    category: "Customer Success",
    pattern: /\b(?:customer success|client success|technical account manager)\b/iu,
  },
  {
    role: "Onboarding Specialist",
    category: "Customer Success",
    pattern:
      /\b(?:onboarding (?:specialist|manager|coordinator)|implementation (?:specialist|manager|consultant))\b/iu,
  },
  {
    role: "Customer Support Specialist",
    category: "Customer Support",
    pattern:
      /\b(?:customer (?:support|service|care)|support (?:agent|specialist|representative|advisor)|call cent|helpdesk agent|service desk)\b/iu,
  },
  {
    role: "Community Manager",
    category: "Customer Success",
    pattern: /\b(?:community manager|community specialist)\b/iu,
  },
  {
    role: "Client Relationship Manager",
    category: "Customer Success",
    pattern: /\b(?:client relationship|relationship manager|client advisor)\b/iu,
  },

  {
    role: "Accountant",
    category: "Accounting",
    pattern:
      /\b(?:accountant|accounting (?:clerk|specialist|manager|officer|assistant)|bookkeep|ledger|financial accountant)\b/iu,
  },
  {
    role: "Auditor",
    category: "Accounting",
    pattern: /\b(?:auditor|internal audit|audit (?:manager|specialist))\b/iu,
  },
  {
    role: "Financial Controller",
    category: "Finance",
    pattern: /\b(?:financial controller|controller|treasurer|finance manager|head of finance)\b/iu,
  },
  {
    role: "Financial Analyst",
    category: "Finance",
    pattern:
      /\b(?:financial analyst|finance analyst|fp&a|investment analyst|equity analyst|financial planning)\b/iu,
  },
  {
    role: "Tax Advisor",
    category: "Finance",
    pattern:
      /\b(?:tax (?:advisor|adviser|consultant|specialist|preparer|manager)|taxation|fiscal)\b/iu,
  },
  {
    role: "Payroll Specialist",
    category: "Accounting",
    pattern: /\b(?:payroll (?:specialist|administrator|manager|officer)|payroll)\b/iu,
  },
  {
    role: "Accounts Payable Clerk",
    category: "Accounting",
    pattern:
      /\b(?:accounts? (?:payable|receivable)|billing (?:clerk|specialist|officer)|credit control|invoicing)\b/iu,
  },
  {
    role: "Credit Analyst",
    category: "Finance",
    pattern: /\b(?:credit analyst|loan officer|underwriter|credit risk)\b/iu,
  },
  {
    role: "Investment Banker",
    category: "Finance",
    pattern:
      /\b(?:investment bank|merger|acquisition|m&a|private equity|venture capital|portfolio manager)\b/iu,
  },
  {
    role: "Risk Manager",
    category: "Finance",
    pattern: /\b(?:risk (?:manager|analyst|officer|specialist)|actuarial)\b/iu,
  },
  {
    role: "Financial Planner",
    category: "Finance",
    pattern:
      /\b(?:financial (?:planner|advisor|adviser|consultant)|wealth (?:manager|advisor))\b/iu,
  },
  {
    role: "Insurance Agent",
    category: "Finance",
    pattern:
      /\b(?:insurance (?:agent|broker|underwriter|consultant)|claims (?:adjuster|handler))\b/iu,
  },
  {
    role: "Economist",
    category: "Finance",
    pattern: /\b(?:economist|economic analyst|econometrics)\b/iu,
  },

  {
    role: "Lawyer",
    category: "Legal",
    pattern:
      /\b(?:lawyer|attorney|legal counsel|advocate|solicitor|barrister|notary|jurist|legal advisor)\b/iu,
  },
  {
    role: "Paralegal",
    category: "Legal",
    pattern: /\b(?:paralegal|legal assistant|legal secretary|legal clerk)\b/iu,
  },
  {
    role: "Compliance Officer",
    category: "Legal",
    pattern:
      /\b(?:compliance (?:officer|manager|analyst|specialist)|regulatory affairs|regulatory (?:officer|specialist))\b/iu,
  },
  {
    role: "Contract Manager",
    category: "Legal",
    pattern:
      /\b(?:contract (?:manager|specialist|administrator|officer)|contracts? management)\b/iu,
  },
  {
    role: "Judge",
    category: "Legal",
    pattern: /\b(?:judge|magistrate|tribunal)\b/iu,
  },

  {
    role: "HR Manager",
    category: "People & HR",
    pattern:
      /\b(?:hr (?:manager|director|lead)|human resources (?:manager|director)|head of (?:people|hr)|people (?:manager|director)|chief people)\b/iu,
  },
  {
    role: "Recruiter",
    category: "Recruiting",
    pattern:
      /\b(?:recruiter|recruiting|recruitment|talent acquisition|sourcer|talent partner|headhunter|staffing)\b/iu,
  },
  {
    role: "HR Specialist",
    category: "People & HR",
    pattern:
      /\b(?:human resources|hr (?:specialist|officer|generalist|coordinator|assistant)|people operations|personnel)\b/iu,
  },
  {
    role: "Compensation Analyst",
    category: "People & HR",
    pattern:
      /\b(?:compensation (?:analyst|specialist|manager)|benefits (?:analyst|specialist|administrator|manager)|reward (?:analyst|specialist))\b/iu,
  },
  {
    role: "Training Manager",
    category: "People & HR",
    pattern:
      /\b(?:training (?:manager|specialist|coordinator|officer)|learning and development|l&d|talent development)\b/iu,
  },

  {
    role: "Operations Manager",
    category: "Operations",
    pattern:
      /\b(?:operations (?:manager|director|lead|officer|coordinator)|head of operations|chief operating|coo|business operations|bizops)\b/iu,
  },
  {
    role: "Supply Chain Manager",
    category: "Supply Chain & Logistics",
    pattern:
      /\b(?:supply chain (?:manager|planner|analyst|specialist|coordinator)|demand planner|logistics manager)\b/iu,
  },
  {
    role: "Logistician",
    category: "Supply Chain & Logistics",
    pattern:
      /\b(?:logistic|dispatch|freight|shipping|transport (?:planner|coordinator|manager)|customs)\b/iu,
  },
  {
    role: "Warehouse Manager",
    category: "Supply Chain & Logistics",
    pattern:
      /\b(?:warehouse (?:manager|supervisor|worker|operator)|storekeeper|inventory (?:manager|controller|clerk)|stock controller)\b/iu,
  },
  {
    role: "Procurement Specialist",
    category: "Supply Chain & Logistics",
    pattern: /\b(?:procurement|purchasing|buyer|sourcing specialist|supply manager)\b/iu,
  },
  {
    role: "Production Manager",
    category: "Operations",
    pattern:
      /\b(?:production (?:manager|supervisor|planner|engineer)|manufacturing (?:manager|supervisor|engineer)|plant manager|factory manager)\b/iu,
  },
  {
    role: "Facilities Manager",
    category: "Operations",
    pattern:
      /\b(?:facilit(?:y|ies) (?:manager|coordinator|administrator)|building manager|property manager|maintenance manager)\b/iu,
  },
  {
    role: "Quality Manager",
    category: "QA & Test",
    pattern: /\b(?:quality (?:manager|inspector|controller|auditor)|quality assurance manager)\b/iu,
  },
  {
    role: "Health and Safety Officer",
    category: "Operations",
    pattern: /\b(?:health and safety|safety officer|environmental health|\behs\b|ohs officer)\b/iu,
  },
  {
    role: "Chef",
    category: "Operations",
    pattern: /\b(?:chef|cook|culinary|kitchen (?:manager|supervisor))\b/iu,
  },
  {
    role: "Hotel Manager",
    category: "Operations",
    pattern:
      /\b(?:hotel (?:manager|director)|hospitality manager|restaurant manager|resort manager)\b/iu,
  },
  {
    role: "Flight Attendant",
    category: "Operations",
    pattern: /\b(?:flight attendant|cabin crew|air hostess|steward(?:ess)?)\b/iu,
  },
  {
    role: "Cleaner",
    category: "Operations",
    pattern: /\b(?:cleaner|cleaning|janitor|housekeep|custodian|sanitation worker)\b/iu,
  },
  {
    role: "Delivery Driver",
    category: "Supply Chain & Logistics",
    pattern: /\b(?:driver|delivery|courier|truck|van driver|bus driver|taxi driver|chauffeur)\b/iu,
  },
  {
    role: "Farmer",
    category: "Operations",
    pattern: /\b(?:farmer|agricultur|farm worker|horticultur|gardener|livestock)\b/iu,
  },
  {
    role: "Construction Worker",
    category: "Operations",
    pattern:
      /\b(?:construction worker|bricklayer|carpenter|electrician|plumber|welder|painter|roofer|mason|scaffolder|crane operator)\b/iu,
  },
  {
    role: "Machine Operator",
    category: "Operations",
    pattern:
      /\b(?:machine operator|plant operator|assembler|factory worker|production worker|process operator)\b/iu,
  },
  {
    role: "Security Guard",
    category: "Security",
    pattern:
      /\b(?:security guard|security officer|surveillance|bodyguard|doorman|access control)\b/iu,
  },
  {
    role: "Firefighter",
    category: "Security",
    pattern: /\b(?:firefighter|fire fighter|fire service|rescue worker)\b/iu,
  },
  {
    role: "Police Officer",
    category: "Security",
    pattern:
      /\b(?:police officer|detective|patrol|law enforcement|border guard|customs officer)\b/iu,
  },
  {
    role: "Soldier",
    category: "Security",
    pattern: /\b(?:soldier|military|armed forces|army|navy|air force)\b/iu,
  },

  {
    role: "Registered Nurse",
    category: "Healthcare",
    pattern: /\b(?:nurse|nursing|registered nurse|\brn\b|nurse practitioner)\b/iu,
  },
  {
    role: "Physician",
    category: "Healthcare",
    pattern:
      /\b(?:physician|medical doctor|doctor of medicine|general practitioner|surgeon|cardiologist|paediatrician|pediatrician|psychiatrist|oncologist|anaesthetist|anesthesiologist|dermatologist|neurologist|radiologist)\b/iu,
  },
  {
    role: "Pharmacist",
    category: "Healthcare",
    pattern: /\b(?:pharmacist|pharmacy|pharmaceutical (?:advisor|assistant))\b/iu,
  },
  {
    role: "Dentist",
    category: "Healthcare",
    pattern: /\b(?:dentist|dental (?:hygienist|assistant|technician)|orthodontist)\b/iu,
  },
  {
    role: "Physiotherapist",
    category: "Healthcare",
    pattern:
      /\b(?:physiotherapist|physical therapist|occupational therapist|speech therapist|therapist|rehabilitation)\b/iu,
  },
  {
    role: "Psychologist",
    category: "Healthcare",
    pattern: /\b(?:psychologist|psychotherapist|counsell?or|mental health)\b/iu,
  },
  {
    role: "Medical Assistant",
    category: "Healthcare",
    pattern:
      /\b(?:medical assistant|nursing assistant|care assistant|caregiver|healthcare assistant|paramedic|emergency medical)\b/iu,
  },
  {
    role: "Veterinarian",
    category: "Healthcare",
    pattern: /\b(?:veterinar|animal health)\b/iu,
  },
  {
    role: "Midwife",
    category: "Healthcare",
    pattern: /\b(?:midwife|obstetric|maternity)\b/iu,
  },
  {
    role: "Medical Laboratory Technician",
    category: "Healthcare",
    pattern:
      /\b(?:medical laboratory|laboratory technician|lab technician|medical technologist|pathology technician)\b/iu,
  },
  {
    role: "Social Worker",
    category: "Healthcare",
    pattern: /\b(?:social worker|social care|youth worker|community health worker)\b/iu,
  },

  {
    role: "Education Manager",
    category: "Education",
    pattern:
      /\b(?:education (?:manager|administrator|director)|school principal|headteacher|academic director|dean|provost)\b/iu,
  },
  {
    role: "Teacher",
    category: "Education",
    pattern:
      /\b(?:teacher|teaching|professor|lecturer|tutor|instructor|educator|trainer|faculty)\b/iu,
  },
  {
    role: "Teaching Assistant",
    category: "Education",
    pattern: /\b(?:teaching assistant|teacher aide|classroom assistant|education assistant)\b/iu,
  },
  {
    role: "Librarian",
    category: "Education",
    pattern: /\b(?:librarian|archivist|library (?:assistant|manager)|curator)\b/iu,
  },

  {
    role: "Research Scientist",
    category: "Research & Science",
    pattern: /\b(?:research scientist|scientist|researcher|research associate|research fellow)\b/iu,
  },
  {
    role: "Biologist",
    category: "Research & Science",
    pattern: /\b(?:biolog|microbiolog|biochemist|geneticist|ecologist|zoologist|botanist)\b/iu,
  },
  {
    role: "Chemist",
    category: "Research & Science",
    pattern: /\b(?:chemist|chemistry|pharmacologist|toxicologist)\b/iu,
  },
  {
    role: "Physicist",
    category: "Research & Science",
    pattern: /\b(?:physicist|astronom|astrophysicist|geophysicist)\b/iu,
  },
  {
    role: "Geologist",
    category: "Research & Science",
    pattern: /\b(?:geolog|geograph|geodesist|surveyor|cartographer)\b/iu,
  },
  {
    role: "Environmental Scientist",
    category: "Research & Science",
    pattern:
      /\b(?:environmental (?:scientist|engineer|specialist|consultant)|climate|conservation)\b/iu,
  },
  {
    role: "Mathematician",
    category: "Research & Science",
    pattern: /\b(?:mathematician|mathematical|operations research)\b/iu,
  },
  {
    role: "Laboratory Technician",
    category: "Research & Science",
    pattern:
      /\b(?:laboratory (?:technician|assistant|analyst)|lab assistant|chemical technician)\b/iu,
  },
  {
    role: "Social Scientist",
    category: "Research & Science",
    pattern:
      /\b(?:sociolog|anthropolog|historian|philosopher|political scientist|archaeolog|linguist)\b/iu,
  },
];

/**
 * The multi-language hints Tier 1 uses after the ESCO aliases and the English rule table. ESCO is an EU vocabulary,
 * so a Japanese title has no ESCO label; these stems keep the common non-English roles out of Tier 2's way.
 */
export interface MultilingualRoleHint {
  readonly role: string;
  readonly category: RoleGroup;
  readonly pattern: RegExp;
}

export const MULTILINGUAL_ROLE_HINTS: readonly MultilingualRoleHint[] = [
  {
    role: "Database Administrator",
    category: "DevOps & Infrastructure",
    pattern:
      /datenbankadministrator|administrateur de base de données|administrador de bases de datos|データベース管理者|数据库管理员/iu,
  },
  {
    role: "Software Engineer",
    category: "Software Engineering",
    pattern:
      /entwickler|entwicklerin|développeur|développeuse|desarrollador|desarrolladora|programador|programadora|programmeur|エンジニア|開発者|ソフトウェア/iu,
  },
  {
    role: "Office Manager",
    category: "Administrative",
    pattern:
      /büroleiter|büroleiterin|büromanager|responsable de bureau|jefe de oficina|office manager/iu,
  },
  {
    role: "Administrative Assistant",
    category: "Administrative",
    pattern:
      /verwaltungsassistent|verwaltungsassistentin|assistant administratif|assistante administrative|asistente administrativo|事務|管理助手/iu,
  },
  {
    role: "Receptionist",
    category: "Administrative",
    pattern: /empfangsmitarbeiter|empfangsmitarbeiterin|réceptionniste|recepcionista|受付/iu,
  },
  {
    role: "Secretary",
    category: "Administrative",
    pattern: /sekretär|sekretärin|secrétaire|secretaria|秘書/iu,
  },
  {
    role: "Accountant",
    category: "Accounting",
    pattern: /buchhalter|buchhalterin|comptable|contador|contadora|経理/iu,
  },
  {
    role: "Registered Nurse",
    category: "Healthcare",
    pattern: /krankenpfleger|krankenpflegerin|infirmier|infirmière|enfermero|enfermera|看護師/iu,
  },
  {
    role: "Teacher",
    category: "Education",
    pattern: /lehrer|lehrerin|enseignant|enseignante|profesor|profesora|教師/iu,
  },
  {
    role: "Sales Representative",
    category: "Sales",
    pattern: /vertriebsmitarbeiter|vertriebsmitarbeiterin|commercial|vendedor|vendedora|営業/iu,
  },
];

/**
 * @param text A posting title plus department.
 * @returns The first multilingual hint that matches, or null.
 */
export function multilingualRoleHint(text: string) {
  return MULTILINGUAL_ROLE_HINTS.find((hint) => hint.pattern.test(text)) ?? null;
}

/**
 * The broad-category answer for a role rule, or null when no granular rule recognizes the title.
 * @param text A normalized title plus department, ideally in English.
 * @returns The matched granular role rule, if any.
 */
export function granularRoleFor(text: string) {
  return GRANULAR_ROLE_RULES.find((rule) => rule.pattern.test(text)) ?? null;
}

const ISCO_CATEGORY_RULES: readonly (readonly [string, RoleGroup])[] = [
  ["1221", "Sales"],
  ["1222", "Marketing"],
  ["1223", "Research & Science"],
  ["132", "Supply Chain & Logistics"],
  ["133", "IT & Support Engineering"],
  ["1341", "Education"],
  ["1342", "Healthcare"],
  ["1343", "Education"],
  ["1344", "Finance"],
  ["1345", "Finance"],
  ["1346", "Operations"],
  ["1349", "Operations"],
  ["141", "Operations"],
  ["142", "Operations"],
  ["143", "Operations"],
  ["211", "Research & Science"],
  ["212", "Data & Analytics"],
  ["213", "Research & Science"],
  ["214", "Hardware & Embedded"],
  ["215", "Hardware & Embedded"],
  ["216", "Design"],
  ["22", "Healthcare"],
  ["23", "Education"],
  ["241", "Finance"],
  ["2421", "Operations"],
  ["2422", "Operations"],
  ["2423", "People & HR"],
  ["2424", "Education"],
  ["2431", "Marketing"],
  ["2432", "Communications & PR"],
  ["2433", "Sales"],
  ["2434", "Sales"],
  ["251", "Software Engineering"],
  ["252", "DevOps & Infrastructure"],
  ["261", "Legal"],
  ["262", "Administrative"],
  ["263", "Research & Science"],
  ["264", "Communications & PR"],
  ["265", "Design"],
  ["311", "Research & Science"],
  ["312", "Operations"],
  ["313", "Operations"],
  ["314", "Research & Science"],
  ["315", "Supply Chain & Logistics"],
  ["321", "Healthcare"],
  ["322", "Healthcare"],
  ["323", "Healthcare"],
  ["324", "Healthcare"],
  ["325", "Healthcare"],
  ["331", "Finance"],
  ["332", "Sales"],
  ["333", "Operations"],
  ["334", "Administrative"],
  ["335", "Legal"],
  ["341", "Legal"],
  ["342", "Operations"],
  ["343", "Design"],
  ["351", "IT & Support Engineering"],
  ["352", "IT & Support Engineering"],
  ["4", "Administrative"],
  ["51", "Operations"],
  ["52", "Sales"],
  ["531", "Education"],
  ["532", "Healthcare"],
  ["54", "Security"],
  ["6", "Operations"],
  ["7", "Operations"],
  ["8", "Operations"],
  ["9", "Operations"],
  ["1", "Operations"],
  ["2", "Operations"],
  ["3", "Operations"],
  ["5", "Operations"],
];

/**
 * @param iscoCode An ISCO-08 code, read from the first four digits of an ESCO occupation code.
 * @returns The broad category the code rolls up to, defaulting to Operations.
 */
export function iscoCategoryFor(iscoCode: string) {
  const match = ISCO_CATEGORY_RULES.find(([prefix]) => iscoCode.startsWith(prefix));

  return match?.[1] ?? "Operations";
}

/**
 * The Level-1 category for an ESCO occupation. The granular-role rule wins when it recognizes the title, so the
 * occupation's category always agrees with its Level-2 role.
 * @param input The English label and the ISCO-08 code.
 * @returns The broad category.
 */
export function categoryFor(input: { readonly en: string; readonly isco: string }) {
  const granular = granularRoleFor(input.en);

  return granular?.category ?? iscoCategoryFor(input.isco);
}

/**
 * The ESCO occupation code's ISCO-08 unit group, the first dot-separated segment.
 * @param escoCode A code such as `2166.3.1`.
 * @returns The four-digit ISCO group, or the code itself when it has no separator.
 */
export function iscoFromEscoCode(escoCode: string) {
  return escoCode.split(".")[0] ?? escoCode;
}

/**
 * The Level-2 role for an ESCO occupation, falling back to the category name when no granular rule matches.
 * @param input The English label and the broad category.
 * @returns The granular role string.
 */
export function granularRoleNameFor(input: { readonly en: string; readonly category: RoleGroup }) {
  return granularRoleFor(input.en)?.role ?? input.category;
}
