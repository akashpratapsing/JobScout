// A deliberately broad, editable skill vocabulary. Each entry maps aliases to one
// canonical label. Matching is local and deterministic: no AI call is needed to
// decide whether a job mentions Python.

export const SKILLS = [
  // Languages
  { name: 'JavaScript', category: 'language', aliases: ['javascript', 'js', 'ecmascript'] },
  { name: 'TypeScript', category: 'language', aliases: ['typescript', 'ts'] },
  { name: 'Python', category: 'language', aliases: ['python', 'python3'] },
  { name: 'Java', category: 'language', aliases: ['java'] },
  { name: 'C++', category: 'language', aliases: ['c++', 'cpp'] },
  { name: 'C#', category: 'language', aliases: ['c#', 'csharp', 'c sharp'] },
  { name: 'C', category: 'language', aliases: ['c programming', 'c language', 'c/c++'], ambiguous: true },
  { name: 'Go', category: 'language', aliases: ['golang', 'go lang'], caseAliases: ['Go'] },
  { name: 'Rust', category: 'language', aliases: ['rust'] },
  { name: 'Ruby', category: 'language', aliases: ['ruby', 'ruby on rails', 'rails'] },
  { name: 'PHP', category: 'language', aliases: ['php'] },
  { name: 'Kotlin', category: 'language', aliases: ['kotlin'] },
  { name: 'Swift', category: 'language', aliases: ['swiftui'], caseAliases: ['Swift'] },
  { name: 'Scala', category: 'language', aliases: ['scala'] },
  { name: 'Dart', category: 'language', aliases: ['dart'] },
  { name: 'Elixir', category: 'language', aliases: ['elixir'] },
  { name: 'Erlang', category: 'language', aliases: ['erlang'] },
  { name: 'Haskell', category: 'language', aliases: ['haskell'] },
  { name: 'Clojure', category: 'language', aliases: ['clojure'] },
  { name: 'Perl', category: 'language', aliases: ['perl'] },
  { name: 'MATLAB', category: 'language', aliases: ['matlab'] },
  { name: 'R', category: 'language', aliases: ['r programming', 'rstudio', 'r language'], ambiguous: true },
  { name: 'SQL', category: 'language', aliases: ['sql'] },
  { name: 'Bash', category: 'language', aliases: ['bash', 'shell scripting', 'shell script'] },
  { name: 'PowerShell', category: 'language', aliases: ['powershell'] },
  { name: 'Solidity', category: 'language', aliases: ['solidity'] },

  // Frontend
  { name: 'React', category: 'frontend', aliases: ['react', 'react.js', 'reactjs'] },
  { name: 'React Native', category: 'mobile', aliases: ['react native'] },
  { name: 'Next.js', category: 'frontend', aliases: ['next.js', 'nextjs', 'next js'] },
  { name: 'Angular', category: 'frontend', aliases: ['angular', 'angularjs'] },
  { name: 'Vue.js', category: 'frontend', aliases: ['vue', 'vue.js', 'vuejs'] },
  { name: 'Svelte', category: 'frontend', aliases: ['svelte', 'sveltekit'] },
  { name: 'Redux', category: 'frontend', aliases: ['redux', 'redux toolkit'] },
  { name: 'Tailwind CSS', category: 'frontend', aliases: ['tailwind', 'tailwind css'] },
  { name: 'HTML', category: 'frontend', aliases: ['html', 'html5'] },
  { name: 'CSS', category: 'frontend', aliases: ['css', 'css3'] },
  { name: 'Sass', category: 'frontend', aliases: ['sass', 'scss'] },
  { name: 'Bootstrap', category: 'frontend', aliases: ['bootstrap'] },
  { name: 'jQuery', category: 'frontend', aliases: ['jquery'] },
  { name: 'Webpack', category: 'frontend', aliases: ['webpack'] },
  { name: 'Vite', category: 'frontend', aliases: ['vite'] },
  { name: 'Accessibility', category: 'frontend', aliases: ['accessibility', 'a11y', 'wcag'] },
  { name: 'Responsive Design', category: 'frontend', aliases: ['responsive design', 'responsive ui'] },

  // Backend / architecture
  { name: 'Node.js', category: 'backend', aliases: ['node.js', 'nodejs', 'node js'] },
  { name: 'Express', category: 'backend', aliases: ['express.js', 'expressjs', 'express'] },
  { name: 'NestJS', category: 'backend', aliases: ['nestjs', 'nest.js'] },
  { name: 'Django', category: 'backend', aliases: ['django'] },
  { name: 'Flask', category: 'backend', aliases: ['flask'] },
  { name: 'FastAPI', category: 'backend', aliases: ['fastapi'] },
  { name: 'Spring Boot', category: 'backend', aliases: ['spring boot', 'spring framework', 'spring mvc', 'spring'] },
  { name: 'REST APIs', category: 'backend', aliases: ['rest api', 'restful', 'rest apis', 'rest'] },
  { name: 'GraphQL', category: 'backend', aliases: ['graphql'] },
  { name: 'gRPC', category: 'backend', aliases: ['grpc'] },
  { name: 'Microservices', category: 'backend', aliases: ['microservice', 'microservices'] },
  { name: 'Serverless', category: 'backend', aliases: ['serverless', 'lambda functions'] },
  { name: 'Event-Driven Architecture', category: 'backend', aliases: ['event-driven', 'event driven'] },
  { name: 'WebSockets', category: 'backend', aliases: ['websocket', 'websockets'] },
  { name: 'API Design', category: 'backend', aliases: ['api design', 'api development'] },

  // Data / databases
  { name: 'PostgreSQL', category: 'data', aliases: ['postgresql', 'postgres'] },
  { name: 'MySQL', category: 'data', aliases: ['mysql', 'mariadb'] },
  { name: 'MongoDB', category: 'data', aliases: ['mongodb', 'mongo'] },
  { name: 'Redis', category: 'data', aliases: ['redis'] },
  { name: 'Cassandra', category: 'data', aliases: ['cassandra'] },
  { name: 'DynamoDB', category: 'data', aliases: ['dynamodb'] },
  { name: 'Elasticsearch', category: 'data', aliases: ['elasticsearch', 'opensearch', 'elastic search'] },
  { name: 'Snowflake', category: 'data', aliases: ['snowflake'] },
  { name: 'BigQuery', category: 'data', aliases: ['bigquery'] },
  { name: 'Redshift', category: 'data', aliases: ['redshift'] },
  { name: 'Databricks', category: 'data', aliases: ['databricks'] },
  { name: 'Oracle Database', category: 'data', aliases: ['oracle database', 'oracle db', 'pl/sql', 'plsql'] },
  { name: 'SQL Server', category: 'data', aliases: ['sql server', 'mssql', 't-sql', 'tsql'] },
  { name: 'NoSQL', category: 'data', aliases: ['nosql'] },
  { name: 'Data Modeling', category: 'data', aliases: ['data modeling', 'data modelling', 'dimensional modeling'] },
  { name: 'ETL', category: 'data', aliases: ['etl', 'elt', 'data pipelines', 'data pipeline'] },
  { name: 'Apache Spark', category: 'data', aliases: ['apache spark', 'spark', 'pyspark'] },
  { name: 'Hadoop', category: 'data', aliases: ['hadoop', 'hdfs'] },
  { name: 'Apache Kafka', category: 'data', aliases: ['kafka', 'apache kafka'] },
  { name: 'Airflow', category: 'data', aliases: ['airflow', 'apache airflow'] },
  { name: 'dbt', category: 'data', aliases: ['dbt', 'data build tool'] },
  { name: 'Pandas', category: 'data', aliases: ['pandas'] },
  { name: 'NumPy', category: 'data', aliases: ['numpy'] },
  { name: 'Tableau', category: 'data', aliases: ['tableau'] },
  { name: 'Power BI', category: 'data', aliases: ['power bi', 'powerbi'] },
  { name: 'Looker', category: 'data', aliases: ['looker', 'lookml'] },
  { name: 'Excel', category: 'data', aliases: ['excel', 'spreadsheets'] },
  { name: 'Data Warehousing', category: 'data', aliases: ['data warehouse', 'data warehousing'] },
  { name: 'Data Visualization', category: 'data', aliases: ['data visualization', 'data visualisation'] },
  { name: 'Statistics', category: 'data', aliases: ['statistics', 'statistical analysis', 'statistical modeling'] },
  { name: 'A/B Testing', category: 'data', aliases: ['a/b testing', 'ab testing', 'experimentation'] },

  // AI / ML
  { name: 'Machine Learning', category: 'ai', aliases: ['machine learning', 'ml models', 'ml model'] },
  { name: 'Deep Learning', category: 'ai', aliases: ['deep learning', 'neural network', 'neural networks'] },
  { name: 'TensorFlow', category: 'ai', aliases: ['tensorflow', 'tf.keras'] },
  { name: 'PyTorch', category: 'ai', aliases: ['pytorch', 'torch'] },
  { name: 'scikit-learn', category: 'ai', aliases: ['scikit-learn', 'sklearn', 'scikit learn'] },
  { name: 'Keras', category: 'ai', aliases: ['keras'] },
  { name: 'OpenCV', category: 'ai', aliases: ['opencv'] },
  { name: 'NLP', category: 'ai', aliases: ['natural language processing', 'nlp'] },
  { name: 'Computer Vision', category: 'ai', aliases: ['computer vision', 'cv models'] },
  { name: 'LLMs', category: 'ai', aliases: ['large language model', 'large language models', 'llm', 'llms'] },
  { name: 'LangChain', category: 'ai', aliases: ['langchain', 'langgraph'] },
  { name: 'RAG', category: 'ai', aliases: ['retrieval augmented generation', 'retrieval-augmented generation', 'rag pipeline', 'rag'] },
  { name: 'Prompt Engineering', category: 'ai', aliases: ['prompt engineering', 'prompt design'] },
  { name: 'Generative AI', category: 'ai', aliases: ['generative ai', 'genai', 'gen ai'] },
  { name: 'MLOps', category: 'ai', aliases: ['mlops', 'ml ops', 'model deployment'] },
  { name: 'Hugging Face', category: 'ai', aliases: ['hugging face', 'huggingface', 'transformers library'] },
  { name: 'Recommendation Systems', category: 'ai', aliases: ['recommendation system', 'recommendation systems', 'recommender systems'] },
  { name: 'Data Science', category: 'ai', aliases: ['data science', 'data scientist'] },
  { name: 'Feature Engineering', category: 'ai', aliases: ['feature engineering'] },
  { name: 'Model Evaluation', category: 'ai', aliases: ['model evaluation', 'model validation', 'evaluation metrics'] },

  // Cloud / DevOps
  { name: 'AWS', category: 'cloud', aliases: ['aws', 'amazon web services', 'ec2', 's3', 'eks'] },
  { name: 'Azure', category: 'cloud', aliases: ['azure', 'microsoft azure'] },
  { name: 'Google Cloud', category: 'cloud', aliases: ['google cloud', 'gcp', 'google cloud platform'] },
  { name: 'Docker', category: 'devops', aliases: ['docker', 'containerization', 'containers'] },
  { name: 'Kubernetes', category: 'devops', aliases: ['kubernetes', 'k8s', 'eks', 'gke', 'aks'] },
  { name: 'Terraform', category: 'devops', aliases: ['terraform', 'infrastructure as code', 'iac'] },
  { name: 'Ansible', category: 'devops', aliases: ['ansible'] },
  { name: 'Jenkins', category: 'devops', aliases: ['jenkins'] },
  { name: 'GitLab CI', category: 'devops', aliases: ['gitlab ci', 'gitlab-ci'] },
  { name: 'GitHub Actions', category: 'devops', aliases: ['github actions'] },
  { name: 'CircleCI', category: 'devops', aliases: ['circleci'] },
  { name: 'CI/CD', category: 'devops', aliases: ['ci/cd', 'cicd', 'continuous integration', 'continuous delivery', 'continuous deployment'] },
  { name: 'Linux', category: 'devops', aliases: ['linux', 'unix', 'ubuntu', 'centos'] },
  { name: 'Git', category: 'devops', aliases: ['git', 'github', 'gitlab', 'bitbucket'] },
  { name: 'Helm', category: 'devops', aliases: ['helm'] },
  { name: 'Prometheus', category: 'devops', aliases: ['prometheus'] },
  { name: 'Grafana', category: 'devops', aliases: ['grafana'] },
  { name: 'Datadog', category: 'devops', aliases: ['datadog'] },
  { name: 'New Relic', category: 'devops', aliases: ['new relic'] },
  { name: 'Splunk', category: 'devops', aliases: ['splunk'] },
  { name: 'Observability', category: 'devops', aliases: ['observability', 'monitoring', 'logging', 'telemetry'] },
  { name: 'Site Reliability', category: 'devops', aliases: ['site reliability', 'sre', 'reliability engineering'] },
  { name: 'Incident Response', category: 'devops', aliases: ['incident response', 'on-call', 'incident management'] },
  { name: 'Networking', category: 'devops', aliases: ['networking', 'tcp/ip', 'dns', 'vpn', 'firewall', 'load balancer'] },
  { name: 'RabbitMQ', category: 'backend', aliases: ['rabbitmq'] },
  { name: 'Celery', category: 'backend', aliases: ['celery'] },

  // Mobile
  { name: 'Android', category: 'mobile', aliases: ['android', 'jetpack compose'] },
  { name: 'iOS', category: 'mobile', aliases: ['ios', 'swiftui', 'uikit'] },
  { name: 'Flutter', category: 'mobile', aliases: ['flutter'] },
  { name: 'Unity', category: 'mobile', aliases: ['unity3d', 'unity engine', 'unity'] },
  { name: 'Unreal Engine', category: 'mobile', aliases: ['unreal engine', 'unreal'] },

  // Product / design / process
  { name: 'Product Management', category: 'product', aliases: ['product management', 'product manager', 'product strategy', 'product roadmap'] },
  { name: 'Agile', category: 'process', aliases: ['agile', 'scrum', 'kanban', 'sprint planning'] },
  { name: 'Jira', category: 'process', aliases: ['jira', 'confluence'] },
  { name: 'Figma', category: 'design', aliases: ['figma', 'sketch', 'adobe xd'] },
  { name: 'UI/UX', category: 'design', aliases: ['ui/ux', 'ux design', 'ui design', 'user experience', 'user interface design'] },
  { name: 'Design Systems', category: 'design', aliases: ['design system', 'design systems', 'component library'] },
  { name: 'User Research', category: 'design', aliases: ['user research', 'usability testing'] },
  { name: 'Prototyping', category: 'design', aliases: ['prototyping', 'wireframing'] },
  { name: 'Technical Writing', category: 'process', aliases: ['technical writing', 'documentation'] },
  { name: 'Stakeholder Management', category: 'soft', aliases: ['stakeholder management', 'stakeholder communication'] },
  { name: 'Communication', category: 'soft', aliases: ['communication skills', 'written communication', 'verbal communication'] },
  { name: 'Leadership', category: 'soft', aliases: ['leadership', 'team lead', 'mentoring', 'mentorship'] },
  { name: 'Problem Solving', category: 'soft', aliases: ['problem solving', 'problem-solving', 'analytical skills'] },
  { name: 'Collaboration', category: 'soft', aliases: ['collaboration', 'cross-functional', 'cross functional'] },
  { name: 'Ownership', category: 'soft', aliases: ['ownership', 'self-starter', 'autonomy'] },

  // Business / enterprise
  { name: 'Salesforce', category: 'enterprise', aliases: ['salesforce', 'salesforce crm'] },
  { name: 'SAP', category: 'enterprise', aliases: ['sap', 's/4hana'] },
  { name: 'Oracle', category: 'enterprise', aliases: ['oracle erp', 'oracle cloud', 'oracle fusion'] },
  { name: 'ServiceNow', category: 'enterprise', aliases: ['servicenow'] },
  { name: 'Workday', category: 'enterprise', aliases: ['workday hcm', 'workday'] },
  { name: 'Shopify', category: 'enterprise', aliases: ['shopify', 'liquid theme'] },
  { name: 'WordPress', category: 'enterprise', aliases: ['wordpress', 'woocommerce'] },
  { name: 'HubSpot', category: 'enterprise', aliases: ['hubspot'] },
  { name: 'Zoho', category: 'enterprise', aliases: ['zoho'] },
  { name: 'NetSuite', category: 'enterprise', aliases: ['netsuite'] },
  { name: 'Odoo', category: 'enterprise', aliases: ['odoo'] },
  { name: 'ERP', category: 'enterprise', aliases: ['erp', 'enterprise resource planning'] },
  { name: 'CRM', category: 'enterprise', aliases: ['crm', 'customer relationship management'] },
  { name: 'Business Intelligence', category: 'data', aliases: ['business intelligence', 'bi reporting'] },
  { name: 'Financial Modeling', category: 'business', aliases: ['financial modeling', 'financial modelling'] },
  { name: 'Digital Marketing', category: 'business', aliases: ['digital marketing', 'seo', 'sem', 'performance marketing'] },
  { name: 'Sales', category: 'business', aliases: ['b2b sales', 'sales pipeline', 'account executive'] },
  { name: 'Customer Success', category: 'business', aliases: ['customer success', 'account management'] },
  { name: 'Supply Chain', category: 'business', aliases: ['supply chain', 'procurement', 'logistics'] },
  { name: 'Operations', category: 'business', aliases: ['operations management', 'business operations'] },

  // Security
  { name: 'Cybersecurity', category: 'security', aliases: ['cybersecurity', 'cyber security', 'information security', 'infosec'] },
  { name: 'Penetration Testing', category: 'security', aliases: ['penetration testing', 'pen testing', 'ethical hacking'] },
  { name: 'SOC', category: 'security', aliases: ['security operations center', 'soc analyst', 'soc'] },
  { name: 'SIEM', category: 'security', aliases: ['siem', 'security information and event management'] },
  { name: 'ISO 27001', category: 'security', aliases: ['iso 27001', 'iso27001'] },
  { name: 'GDPR', category: 'security', aliases: ['gdpr', 'data privacy', 'privacy compliance'] },
  { name: 'Cloud Security', category: 'security', aliases: ['cloud security', 'iam policies', 'identity and access management'] },
  { name: 'Application Security', category: 'security', aliases: ['application security', 'appsec', 'secure coding'] },
  { name: 'Cryptography', category: 'security', aliases: ['cryptography', 'encryption'] }
];

const SKILL_BY_NAME = new Map(SKILLS.map((s) => [s.name.toLowerCase(), s]));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasRegex(alias, caseSensitive = false) {
  const escaped = escapeRegex(alias);
  const flags = caseSensitive ? 'g' : 'gi';
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, flags);
}

const COMPILED = SKILLS.map((skill) => ({
  ...skill,
  patterns: [
    ...skill.aliases.map((alias) => ({ regex: aliasRegex(alias), alias })),
    ...(skill.caseAliases || []).map((alias) => ({ regex: aliasRegex(alias, true), alias }))
  ]
}));

export function normalizeSkillName(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const direct = SKILL_BY_NAME.get(text.toLowerCase());
  if (direct) return direct.name;
  for (const skill of SKILLS) {
    if (skill.aliases.some((alias) => alias.toLowerCase() === text.toLowerCase())) return skill.name;
  }
  return text;
}

export function canonicalSkills(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const name = normalizeSkillName(value);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Find skills in text, retaining the sentence that mentioned each one so the
 * required/preferred classifier has context.
 */
export function detectSkills(text) {
  const source = String(text || '');
  if (!source) return [];
  const sentences = splitSentences(source);
  const results = new Map();

  for (const skill of COMPILED) {
    let count = 0;
    let firstIndex = -1;
    let context = '';
    for (const { regex } of skill.patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(source)) !== null) {
        count += 1;
        if (firstIndex === -1) firstIndex = match.index;
        if (!context) context = sentenceAt(sentences, match.index);
        if (count > 12) break;
      }
    }
    if (count > 0) {
      results.set(skill.name, {
        name: skill.name,
        category: skill.category,
        count,
        index: firstIndex,
        context
      });
    }
  }

  // Avoid the classic "R" and "C" false positives when they were picked up from
  // prose. They only survive if the context is genuinely technical.
  for (const name of ['R', 'C']) {
    const hit = results.get(name);
    if (!hit) continue;
    const context = `${hit.context} ${source.slice(Math.max(0, hit.index - 60), hit.index + 80)}`;
    if (!/(programming|developer|engineer|language|studio|analytics|data|code|c\/c\+\+)/i.test(context)) {
      results.delete(name);
    }
  }

  return [...results.values()].sort((a, b) => a.index - b.index);
}

function splitSentences(text) {
  const out = [];
  const regex = /[^.!?\n]+[.!?]?/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].trim()) out.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return out;
}

function sentenceAt(sentences, index) {
  for (const sentence of sentences) {
    if (index >= sentence.start && index <= sentence.end) return sentence.text.trim();
  }
  return '';
}

export function suggestTitles(skills = [], experienceYears = 0) {
  const names = new Set(skills.map((s) => normalizeSkillName(s).toLowerCase()));
  const has = (...values) => values.some((v) => names.has(v.toLowerCase()));
  const titles = [];
  const senior = experienceYears >= 8 ? 'Senior ' : experienceYears >= 4 ? '' : experienceYears >= 1 ? 'Junior ' : '';

  if (has('Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'LLMs', 'Generative AI', 'NLP')) {
    titles.push(`${senior}Machine Learning Engineer`, 'AI Engineer', 'Data Scientist');
  }
  if (has('React', 'Next.js', 'Vue.js', 'Angular', 'TypeScript', 'JavaScript', 'HTML', 'CSS')) {
    titles.push(`${senior}Frontend Engineer`, 'Full Stack Engineer', 'Software Engineer');
  }
  if (has('Node.js', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Java', 'Python', 'Go', 'Rust', 'C#', 'PHP')) {
    titles.push(`${senior}Backend Engineer`, 'Software Engineer', 'Full Stack Engineer');
  }
  if (has('AWS', 'Azure', 'Google Cloud', 'Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'Linux')) {
    titles.push('DevOps Engineer', 'Site Reliability Engineer', 'Platform Engineer', 'Cloud Engineer');
  }
  if (has('Android', 'iOS', 'Flutter', 'React Native', 'Kotlin', 'Swift')) {
    titles.push('Mobile Engineer', 'Android Developer', 'iOS Developer');
  }
  if (has('SQL', 'Pandas', 'Tableau', 'Power BI', 'ETL', 'Apache Spark', 'Snowflake', 'BigQuery', 'Airflow')) {
    titles.push('Data Engineer', 'Data Analyst', 'Analytics Engineer');
  }
  if (has('Cybersecurity', 'Penetration Testing', 'SOC', 'SIEM', 'Cloud Security')) {
    titles.push('Security Engineer', 'Security Analyst');
  }
  if (has('Product Management', 'Agile', 'Stakeholder Management')) {
    titles.push('Product Manager', 'Associate Product Manager');
  }
  if (has('UI/UX', 'Figma', 'Design Systems', 'User Research')) {
    titles.push('Product Designer', 'UI/UX Designer');
  }
  if (!titles.length) titles.push('Software Engineer', 'Business Analyst');
  return [...new Set(titles)].slice(0, 8);
}

export function skillCategory(name) {
  return SKILL_BY_NAME.get(String(name).toLowerCase())?.category || 'other';
}

export function skillsFromCategories(categories = []) {
  const wanted = new Set(categories);
  return SKILLS.filter((s) => wanted.has(s.category)).map((s) => s.name);
}
