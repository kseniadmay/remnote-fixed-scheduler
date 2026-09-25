// Тест тотальной проверки алгоритмов плагина

const FIXED_STEPS_DAYS = [1, 3, 7, 21, 30, 60, 90, 180, 360];

function calculateNextDays(repsSoFar) {
  if (repsSoFar < FIXED_STEPS_DAYS.length) {
    return FIXED_STEPS_DAYS[repsSoFar];
  } else {
    const extraSteps = repsSoFar - (FIXED_STEPS_DAYS.length - 1);
    return FIXED_STEPS_DAYS[FIXED_STEPS_DAYS.length - 1] * Math.pow(2, extraSteps);
  }
}

function cleanHeadingTitle(raw) {
  let s = raw.trim();
  s = s.replace(/^[#\s]+/, '');
  while (s.startsWith('##') || s.startsWith('#')) {
    s = s.replace(/^[#\s]+/, '');
  }
  s = s.replace(/^[\p{Emoji}\u200d\ufe0f\s]+/u, '');
  s = s.replace(/^[^\w\sа-яА-ЯёЁa-zA-Z0-9]+\s*/, '');
  return s.trim();
}

function checkIsHeading(rawText, cleanTitle, fontSize, isCard) {
  if (isCard) return false;
  if (!cleanTitle || cleanTitle.length < 3) return false;
  if (cleanTitle.length > 65) return false;
  if (cleanTitle.endsWith('.')) return false;
  if (/[.!?]\s+[А-ЯA-Z]/.test(cleanTitle)) return false;
  const words = cleanTitle.split(/\s+/).filter(w => w.length > 0);
  if (words.length > 8) return false;
  const startsWithHash = /^#{1,3}\s+/.test(rawText) || rawText.startsWith('##') || rawText.startsWith('###');
  if (startsWithHash) return true;
  if (fontSize === 'H2') return true;
  return false;
}

function isAsciiDiagram(text) {
  if (!text) return false;
  if (/---|\/|\\|-->|==>|<-|<--/.test(text)) return true;
  if (/\((main|master|feature|origin|head|dev|staging|auth|bugfix)[^)]*\)/i.test(text)) return true;
  if (text.startsWith('|') || text.startsWith('+--') || text.startsWith('+==')) return true;
  if (text.includes('удаляются сборщиком мусора') || text.includes('garbage collect')) return true;
  return false;
}

function cleanProseText(text) {
  let s = text
    .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  // Срезаем любые ложные решётки заголовков в начале абзаца
  s = s.replace(/^[#\s]+/, '').trim();

  // 1. Оборачиваем асимптотику и математические формулы Big-O в LaTeX: $O(...)$
  s = s.replace(/(?<![\$`\w])O\(([^)]+)\)(?![\$`\w])/g, (_match, inner) => {
    let formula = inner.trim();
    formula = formula.replace(/\blog\b/g, '\\log');
    formula = formula.replace(/\s*\+\s*/g, ' + ');
    return `$O(${formula})$`;
  });

  // 2. Оборачиваем CLI команды Git
  s = s.replace(/(?<![`\w])(git\s+(?:checkout|switch|merge|rebase|branch|commit|status|push|pull|add|reset|log|diff|clone|remote|stash|tag|init)(?:\s+-[a-zA-Z0-9_-]+|\s+--[a-zA-Z0-9_-]+|\s+<[^>]+>|\s+[a-zA-Z0-9_./-]+)*)(?![`\w])/g, '`$1`');

  // 3. Отдельные флаги CLI
  s = s.replace(/(?<![`\w])(--(?:abort|continue|skip|hard|soft|mixed|oneline|graph|amend|no-ff|squash|all))(?![`\w])/g, '`$1`');

  // 4. Системные пути и refs
  s = s.replace(/(?<![`\w])(\.git(?:\/[a-zA-Z0-9_.-]+)*)(?![`\w])/g, '`$1`');
  s = s.replace(/(?<![`\w])(refs\/heads(?:\/[a-zA-Z0-9_.-]+)*)(?![`\w])/g, '`$1`');

  // 5. Типографика тире
  s = s.replace(/\s+[-–]\s+/g, ' — ');

  // 6. Устраняем случайные дубликаты обратных кавычек
  s = s.replace(/`{2,}/g, '`');

  return s.trim();
}

function isShortCommandSnippet(text) {
  const clean = text
    .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '')
    .replace(/\n?```$/, '')
    .replace(/^[#\s]+/, '')
    .trim();
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  if (lines.length <= 2 && !isAsciiDiagram(clean)) {
    return true;
  }
  return false;
}

function formatShortCommandAsProse(raw) {
  const clean = raw
    .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '')
    .replace(/\n?```$/, '')
    .replace(/^[#\s]+/, '')
    .trim();
  const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  return lines.map(line => {
    let l = line.replace(/^\$\s*/, '');
    const hashIdx = l.indexOf('#');
    if (hashIdx > 0) {
      const cmd = l.slice(0, hashIdx).trim();
      const comment = l.slice(hashIdx + 1).trim();
      return `\`${cmd}\` — ${comment}`;
    } else {
      return `\`${l}\``;
    }
  }).join('\n');
}

function isCodeSnippet(text) {
  if (!text) return false;
  if (text.startsWith('```')) return true;
  const russianWords = text.match(/[а-яА-ЯёЁ]{3,}/g) || [];
  if (russianWords.length >= 4) {
    return false;
  }
  return (
    text.startsWith('# Старый') ||
    text.startsWith('# Новый') ||
    text.startsWith('#') ||
    text.startsWith('git ') ||
    text.startsWith('def ') ||
    text.startsWith('class ') ||
    text.startsWith('import ') ||
    text.startsWith('from ') ||
    text.startsWith('async def ') ||
    text.startsWith('pip install') ||
    text.startsWith('docker ') ||
    text.startsWith('docker-compose') ||
    text.startsWith('$ ') ||
    text.startsWith('kubectl ') ||
    text.startsWith('python ') ||
    text.startsWith('npm ') ||
    isAsciiDiagram(text)
  ) && !text.includes('::') && !text.includes('?');
}

// ==========================================
// НАБОР ТЕСТОВ
// ==========================================
let totalPassed = 0;
let totalFailed = 0;

function assert(cond, name, details = '') {
  if (cond) {
    totalPassed++;
    console.log(`  ✅ PASS: ${name}`);
  } else {
    totalFailed++;
    console.error(`  ❌ FAIL: ${name} ${details ? '(' + details + ')' : ''}`);
  }
}

console.log('\n--- 1. ТЕСТИРОВАНИЕ РАСЧЕТА ИНТЕРВАЛОВ SRS ---');
assert(calculateNextDays(1) === 3, 'После 1-го ревью: 3 дня');
assert(calculateNextDays(2) === 7, 'После 2-го ревью: 7 дней');
assert(calculateNextDays(3) === 21, 'После 3-го ревью: 21 день');
assert(calculateNextDays(4) === 30, 'После 4-го ревью: 30 дней');
assert(calculateNextDays(5) === 60, 'После 5-го ревью: 60 дней');
assert(calculateNextDays(6) === 90, 'После 6-го ревью: 90 дней');
assert(calculateNextDays(7) === 180, 'После 7-го ревью: 180 дней');
assert(calculateNextDays(8) === 360, 'После 8-го ревью: 360 дней');
assert(calculateNextDays(9) === 720, 'После 9-го ревью: 720 дней (удвоение)');

console.log('\n--- 2. ТЕСТИРОВАНИЕ РАСПОЗНАВАНИЯ ЗАГОЛОВКОВ (checkIsHeading) ---');
const h1 = '## Что такое ветка на уровне Git';
assert(checkIsHeading(h1, cleanHeadingTitle(h1), undefined, false) === true, 'Короткий заголовок ## Что такое ветка на уровне Git');

const h2 = '## 🌿 Что происходит под капотом';
assert(checkIsHeading(h2, cleanHeadingTitle(h2), undefined, false) === true, 'Заголовок с эмодзи ## 🌿 Что происходит под капотом');

const h3 = '## Fast-forward merge';
assert(checkIsHeading(h3, cleanHeadingTitle(h3), undefined, false) === true, 'Английский заголовок ## Fast-forward merge');

const h4 = '## Резюме';
assert(checkIsHeading(h4, cleanHeadingTitle(h4), undefined, false) === true, 'Однословный заголовок ## Резюме');

const falseH1 = '## Ветка в Git – это не папка и не копия файлов. Это просто указатель (pointer) на конкретный коммит.';
assert(checkIsHeading(falseH1, cleanHeadingTitle(falseH1), undefined, false) === false, 'Длинное предложение с точкой НЕ заголовок');

const falseH2 = '## Именно поэтому создание ветки в Git мгновенное – хоть в проекте 100 000 файлов.';
assert(checkIsHeading(falseH2, cleanHeadingTitle(falseH2), undefined, false) === false, 'Предложение с точкой на конце НЕ заголовок');

const falseH3 = '📖 Перечитать конспект Ветки в Git';
assert(checkIsHeading(falseH3, cleanHeadingTitle(falseH3), undefined, true) === false, 'Карточка перечитывания НЕ заголовок');

const falseH4 = '## Прежде чем выбирать между merge и rebase, нужно понять, что делает каждая команда.';
assert(checkIsHeading(falseH4, cleanHeadingTitle(falseH4), undefined, false) === false, 'Сложное предложение НЕ заголовок');

console.log('\n--- 3. ТЕСТИРОВАНИЕ ОЧИСТКИ ПРОЗЫ И LATEX BIG-O ---');
assert(cleanProseText('## Текст с ложной решеткой.') === 'Текст с ложной решеткой.', 'Срезание ложной решетки в начале');
assert(cleanProseText('Сложность алгоритма O(1) и поиск за O(n).') === 'Сложность алгоритма $O(1)$ и поиск за $O(n)$.', 'Замена O(1) и O(n) на $O(1)$ и $O(n)$');
assert(cleanProseText('Сортировка за O(n log n) и дерево за O(log n).') === 'Сортировка за $O(n \\log n)$ и дерево за $O(\\log n)$.', 'Замена log на \\log в Big-O');
assert(cleanProseText('Обход графа за O(V + E).') === 'Обход графа за $O(V + E)$.', 'Сложность O(V + E)');
assert(cleanProseText('Уже в долларах $O(n)$ не удваивается.') === 'Уже в долларах $O(n)$ не удваивается.', 'Защита от повторного оборачивания $O(n)$');
assert(cleanProseText('Команда git checkout feature-auth выполняется быстро.') === 'Команда `git checkout feature-auth` выполняется быстро.', 'Оборачивание git-команды');
assert(cleanProseText('Флаг --abort сбрасывает процесс.') === 'Флаг `--abort` сбрасывает процесс.', 'Оборачивание флага --abort');
assert(cleanProseText('Проверьте файл .git/HEAD в репозитории.') === 'Проверьте файл `.git/HEAD` в репозитории.', 'Оборачивание пути .git/HEAD');
assert(cleanProseText('Тире между словами - заменяется на длинное.') === 'Тире между словами — заменяется на длинное.', 'Типографика тире');

console.log('\n--- 4. ТЕСТИРОВАНИЕ КОРОТКИХ КОМАНД VS МНОГОСТРОЧНЫХ БЛОКОВ ---');
const cmd1 = 'git checkout <ветка>    # переключиться на ветку';
assert(isShortCommandSnippet(cmd1) === true, '1 строка команды -> short');
assert(formatShortCommandAsProse(cmd1) === '`git checkout <ветка>` — переключиться на ветку', 'Форматирование 1 строки команды с комментарием');

const cmd2 = 'git checkout -b feature-auth\ngit status';
assert(isShortCommandSnippet(cmd2) === true, '2 строки команд -> short');

const codeMulti = 'def func():\n    x = 1\n    y = 2\n    return x + y';
assert(isShortCommandSnippet(codeMulti) === false, '4 строки кода -> multi-line block');

const diagram = 'A---B---C (main)\n     \\\n      D---E (feature)';
assert(isAsciiDiagram(diagram) === true, 'ASCII схема распознана');
assert(isShortCommandSnippet(diagram) === false, 'ASCII схема не short, а блок');

console.log('\n--- 5. ТЕСТИРОВАНИЕ ИДЕМПОТЕНТНОСТИ (Idempotence Test) ---');
const rawInput = [
  '## Что такое ветка на уровне Git',
  'Ветка в Git – это не папка. Это указатель за O(1).',
  'git checkout <ветка>    # переключиться'
];

function simulatePass(lines) {
  return lines.map(line => {
    const cleanTitle = cleanHeadingTitle(line);
    const isCard = line.includes('📖 Перечитать') || line.includes('Конспект перечитан');
    const isH = checkIsHeading(line, cleanTitle, undefined, isCard);
    if (isH) {
      return `## ${cleanTitle}`;
    }

    const isCode = isCodeSnippet(line);
    if (isCode) {
      if (isShortCommandSnippet(line)) {
        return formatShortCommandAsProse(line);
      } else {
        return line.trim();
      }
    }

    return cleanProseText(line);
  });
}

const pass1 = simulatePass(rawInput);
const pass2 = simulatePass(pass1);
const pass3 = simulatePass(pass2);

console.log('PASS1:', JSON.stringify(pass1, null, 2));
console.log('PASS2:', JSON.stringify(pass2, null, 2));

assert(JSON.stringify(pass1) === JSON.stringify(pass2), 'Прогон 1 равен Прогону 2 (Idempotence 1->2)');
assert(JSON.stringify(pass2) === JSON.stringify(pass3), 'Прогон 2 равен Прогону 3 (Idempotence 2->3)');
assert(pass1[0] === '## Что такое ветка на уровне Git', 'Заголовок 1 стабилен');
assert(pass1[1] === 'Ветка в Git — это не папка. Это указатель за $O(1)$.', 'Проза 1 стабильна и содержит $O(1)$');
assert(pass1[2] === '`git checkout <ветка>` — переключиться', 'Инлайн-команда стабильна');

console.log(`\n==========================================`);
console.log(`ИТОГО: Успешно: ${totalPassed} | Ошибок: ${totalFailed}`);
console.log(`==========================================\n`);
if (totalFailed > 0) process.exit(1);
