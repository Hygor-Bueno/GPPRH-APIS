/**
 * @fileoverview Constantes globais do serviço de upload de arquivos.
 *
 * Porta fiel de `PHP/GLOBAL/Utils/file/Constants.php` adaptada para Node.js.
 *
 * @module utils/file/constants
 */

/** Tamanho máximo permitido por arquivo: 50 MB. @constant {number} */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Limite de leitura para scans anti-DoS: 5 MB. @constant {number} */
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

/** Dimensão máxima de imagem (px) em qualquer eixo. @constant {number} */
const MAX_IMAGE_DIMENSION = 8000;

/** Tamanho máximo descomprimido para DOCX/XLSX (zip bomb): 50 MB. @constant {number} */
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/** Razão máxima de compressão permitida (zip bomb). @constant {number} */
const MAX_COMPRESSION_RATIO = 50;

// ─── MIME whitelist → extensão salva em disco ─────────────────────────────────

/**
 * Mapa de MIME type real (detectado por magic bytes) para extensão normalizada.
 * @type {Object.<string, string>}
 */
const MIME_TO_EXT = {
    'image/png':                                                                           'png',
    'image/jpeg':                                                                          'jpg',
    'image/webp':                                                                          'webp',
    'application/pdf':                                                                     'pdf',
    'text/plain':                                                                          'txt',
    'text/csv':                                                                            'csv',
    'application/msword':                                                                  'doc',
    'application/vnd.ms-excel':                                                            'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':                  'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':            'docx',
    'application/vnd.ms-powerpoint':                                                     'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':         'pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.slideshow':            'ppsx',
    'application/vnd.openxmlformats-officedocument.presentationml.template':             'potx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template':           'dotx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.template':              'xltx',
    'application/xml':                                                                   'xml',
    'text/xml':                                                                          'xml',
};

/**
 * Mapa de extensão → MIME types aceitos (verificação bidirecional).
 * Impede o bypass de um EXE renomeado para .pdf que cai em text/plain.
 * @type {Object.<string, string[]>}
 */
const EXT_TO_EXPECTED_MIME = {
    pdf:  ['application/pdf'],
    png:  ['image/png'],
    jpg:  ['image/jpeg'],
    jpeg: ['image/jpeg'],
    webp: ['image/webp'],
    doc:  ['application/msword'],
    xls:  ['application/msword', 'application/vnd.ms-excel'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ppt:  ['application/vnd.ms-powerpoint'],
    pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ppsx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    potx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    dotx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    xltx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    xml:  ['application/xml', 'text/xml'],
    txt:  ['text/plain'],
    csv:  ['text/plain', 'text/csv'],
};

/** Formato válido para nome de módulo: somente letras maiúsculas, 2–8 chars. */
const MODULE_PATTERN = /^[A-Z]{2,8}$/;

// ─── Extensões bloqueadas ─────────────────────────────────────────────────────

/**
 * Lista completa de extensões proibidas.
 * Cobre executáveis, scripts, código-fonte, configs e binários do sistema.
 * @type {string[]}
 */
const BLOCKED_EXTENSIONS = [
    // Web / frontend
    'js','mjs','cjs','jsx','ts','tsx','html','htm','xhtml','vue','svelte',
    // Backend
    'php','php3','php4','php5','phtml','phar',
    'py','pyc','pyo','pyw',
    'rb','ru','rake',
    'java','class','jar',
    'go','rs','cs','vb','vbs','pl','pm','lua','r',
    'swift','kt','kts','scala','groovy',
    'asp','aspx','jsp','cfm',
    // Shell / scripts
    'sh','bash','zsh','fish','ksh','csh',
    'bat','cmd','ps1','psm1','psd1','ps2',
    // C / C++ / sistema
    'c','cpp','cc','cxx','h','hpp',
    // Banco de dados
    'sql',
    // Config / infra
    'json','yaml','yml','toml',
    'env','ini','cfg','conf','config',
    'htaccess','dockerfile','makefile',
    // Executáveis
    'exe','dll','so','bin','com','msi',
    'apk','ipa','dmg','pkg','deb','rpm',
    // Kernel Linux / libs
    'ko','o','a',
];

/**
 * Nomes de arquivo de sistema proibidos (dotfiles e configs críticos).
 * @type {string[]}
 */
const BLOCKED_FILENAMES = [
    '.bashrc','.bash_profile','.bash_login','.profile',
    '.zshrc','.zprofile','.zshenv',
    '.cshrc','.tcshrc','.kshrc','.fishrc',
    '.bash_history','.zsh_history','.sh_history',
    '.ssh','authorized_keys','known_hosts','id_rsa','id_ed25519',
    '.env','.env.local','.env.production',
    '.htaccess','.htpasswd',
    '.gitconfig','.gitcredentials',
    'crontab','sudoers',
    'hosts','resolv.conf','passwd','shadow','group',
];

// ─── Padrões de código (text/plain e CSV) ─────────────────────────────────────

/**
 * Padrões regex que detectam código em arquivos text/plain e CSV.
 * Cada entrada: `[regex, label_legível]`.
 * @type {Array<[RegExp, string]>}
 */
const CODE_CONTENT_PATTERNS = [
    // Shell
    [/^#!\//m,                                              'script shebang'],
    // PHP
    [/<\?php/i,                                             'PHP code'],
    // JavaScript
    [/^(import|export)\s+[\w{*'"]/m,                        'ES module (import/export)'],
    [/^(const|let|var)\s+\w+\s*=/m,                         'JS variable declaration'],
    [/^function\s+\w+\s*\(/m,                               'function declaration'],
    [/^class\s+\w+/m,                                       'class declaration'],
    [/require\s*\(\s*['"]/i,                                'Node.js require()'],
    // Python
    [/^def\s+\w+\s*\(/m,                                    'Python function'],
    [/^(from|import)\s+\w+/m,                               'Python/Java import'],
    // C / C++
    [/^#\s*(include|define|ifdef|pragma)/im,                'C/C++ preprocessor directive'],
    // Go / Java
    [/^package\s+\w+/m,                                     'package declaration'],
    // SQL
    [/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\s+/im,'SQL statement'],
    // Chamadas perigosas
    [/eval\s*\(/,                                           'eval() call'],
    [/exec\s*\(/,                                           'exec() call'],
    [/system\s*\(/,                                         'system() call'],
    [/\$_(GET|POST|REQUEST|SERVER|ENV|COOKIE)\[/i,          'PHP superglobal'],
    // HTML
    [/<!doctype\s+html/i,                                   'HTML document (DOCTYPE)'],
    [/<html[\s>]/i,                                         '<html> tag'],
    [/<script[\s>]/i,                                       '<script> tag'],
    [/\son\w+\s*=/i,                                        'HTML inline event handler'],
    [/javascript\s*:/i,                                     'javascript: URI'],
    [/vbscript\s*:/i,                                       'vbscript: URI'],
    // CSV Formula Injection
    [/^=/m,                                                 'CSV Injection (= formula)'],
    [/^[+@][\w(]/m,                                         'CSV Injection (+ or @ formula)'],
    [/^-\d/m,                                               'CSV Injection (- numeric formula)'],
    [/=\s*cmd\s*\|/i,                                       'CSV Injection (cmd exec)'],
    [/=\s*DDE\s*\(/i,                                       'CSV Injection (DDE)'],
    [/=\s*SHELL\s*\(/i,                                     'CSV Injection (SHELL)'],
    [/=\s*(IMPORTRANGE|IMAGE|HYPERLINK|WEBSERVICE)\s*\(/i,  'CSV Injection (remote formula)'],
    // Caminhos de sistema Linux
    [/\/bin\/(sh|bash|dash|csh|ksh|zsh)\b/i,               'Linux shell reference'],
    [/\/etc\/(passwd|shadow|sudoers)\b/i,                   'system file reference'],
    [/\/proc\/self\//,                                       '/proc/self reference'],
    [/\/usr\/bin\/env\s+\w/,                                'env shebang reference'],
];

/**
 * Keywords perigosas em PDFs (podem executar código no leitor).
 * @type {string[]}
 */
const PDF_DANGEROUS_KEYS = [
    '/JavaScript',
    '/OpenAction',
    '/AA',
    '/Launch',
    '/EmbeddedFile',
    '/XFA',
    '/RichMedia',
    '/GoToE',
    '/SubmitForm',
    '/ImportData',
];

module.exports = {
    MAX_FILE_BYTES,
    MAX_SCAN_BYTES,
    MAX_IMAGE_DIMENSION,
    MAX_UNCOMPRESSED_BYTES,
    MAX_COMPRESSION_RATIO,
    MIME_TO_EXT,
    EXT_TO_EXPECTED_MIME,
    MODULE_PATTERN,
    BLOCKED_EXTENSIONS,
    BLOCKED_FILENAMES,
    CODE_CONTENT_PATTERNS,
    PDF_DANGEROUS_KEYS,
};
