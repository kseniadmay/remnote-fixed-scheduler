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
  s = s.replace(/^#{1,6}\s*/, '');
  s = s.replace(/^[\p{Emoji}\u200d\ufe0f\s]+/u, '');
  s = s.replace(/^[-*•–—.]+\s*/, '');
  return s.trim();
}

function checkIsHeading(rawText, cleanTitle, fontSize, isCard) {
  if (isCard) return false;
  if (!cleanTitle || cleanTitle.length < 2) return false;
  if (cleanTitle.length > 70) return false;
  if (cleanTitle.endsWith('.')) return false;
  if (/[.!?]\s+[А-ЯA-Z]/.test(cleanTitle)) return false;
  const words = cleanTitle.split(/\s+/).filter(w => w.length > 0);
  if (words.length > 10) return false;
  const startsWithHash = /^#{1,6}\s+/.test(rawText) || rawText.startsWith('##') || rawText.startsWith('###') || rawText.startsWith('#');
  if (startsWithHash) return true;
  if (fontSize === 'H1' || fontSize === 'H2' || fontSize === 'H3') return true;
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

function richTextToMarkdown(richText) {
  if (!richText || !Array.isArray(richText)) return '';
  return richText
    .map(elem => {
      if (typeof elem === 'string') return elem;
      if (!elem) return '';
      if (elem.i === 'x' && 'text' in elem && elem.text) {
        return `$${elem.text}$`;
      }
      if (elem.i === 'm' && 'text' in elem) {
        let t = elem.text || '';
        if (elem.q) {
          t = `\`${t}\``;
        }
        if (elem.b) {
          t = `**${t}**`;
        }
        return t;
      }
      if (elem.i === 'q') {
        if ('textOfDeletedRem' in elem && elem.textOfDeletedRem) {
          return richTextToMarkdown(elem.textOfDeletedRem);
        }
        return '';
      }
      if ('text' in elem && typeof elem.text === 'string') {
        return elem.text;
      }
      return '';
    })
    .join('');
}

function parseMarkdownToRichText(text) {
  if (!text) {
    return [{ i: 'm', text: '' }];
  }
  const result = [];
  const regex = /(\$[^$\n]+\$|`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      const plain = text.substring(lastIndex, matchIndex);
      if (plain.length > 0) {
        result.push({ i: 'm', text: plain });
      }
    }

    const token = match[0];
    if (token.startsWith('$') && token.endsWith('$') && token.length > 2) {
      const formula = token.slice(1, -1);
      result.push({ i: 'x', text: formula });
    } else if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      const code = token.slice(1, -1);
      result.push({ i: 'm', text: code, q: true });
    } else if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      const bold = token.slice(2, -2);
      result.push({ i: 'm', text: bold, b: true });
    } else {
      result.push({ i: 'm', text: token });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const tail = text.substring(lastIndex);
    if (tail.length > 0) {
      result.push({ i: 'm', text: tail });
    }
  }

  return result.length > 0 ? result : [{ i: 'm', text: '' }];
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

  const preservedCode = [];
  // Защищаем уже существующие инлайн-блоки кода от повторной обработки
  s = s.replace(/`([^`]+)`/g, (_m, code) => {
    preservedCode.push(code);
    return `__CODE_${preservedCode.length - 1}__`;
  });

  // Вспомогательная функция оборачивания кода с выносом знаков препинания наружу
  function wrapAndPreserve(matched) {
    let code = matched.trim();
    let trailingPunct = '';
    const punctMatch = code.match(/([.,:;!?]+)$/);
    if (punctMatch) {
      trailingPunct = punctMatch[1];
      code = code.slice(0, -trailingPunct.length).trim();
    }
    preservedCode.push(code);
    return `__CODE_${preservedCode.length - 1}__${trailingPunct}`;
  }

  // 2. Оборачиваем CLI команды Git
  s = s.replace(/(?<![\w])(git\s+(?:checkout|switch|merge|rebase|branch|commit|status|push|pull|add|reset|log|diff|clone|remote|stash|tag|init|cherry-pick|restore|show|fetch|rev-parse)(?:\s+-[a-zA-Z0-9_-]+|\s+--[a-zA-Z0-9_-]+|\s+<[^>]+>|\s+[a-zA-Z0-9_./~^@{}-]+)*)(?![\w])/g, wrapAndPreserve);

  // 3. Отдельные флаги CLI: --abort, --continue, --skip, --hard, --soft, --mixed, --oneline, --graph, --amend, --no-ff, --squash, --all, --cached, --staged, --patch, --force, --dry-run
  s = s.replace(/(?<![\w])(--(?:abort|continue|skip|hard|soft|mixed|oneline|graph|amend|no-ff|squash|all|cached|staged|patch|force|dry-run))(?![\w])/g, wrapAndPreserve);

  // 4. Одиночные флаги CLI: -b, -m, -d, -D, -a, -p, -v, -f (только как изолированные флаги с дефисом)
  s = s.replace(/(?<=\s)(-[bmdfapv])(?=[\s.,:;!?]|$)/g, wrapAndPreserve);

  // 5. Системные пути и refs Git
  s = s.replace(/(?<![\w])(\.git(?:\/[a-zA-Z0-9_.-]+)*)(?![\w])/g, wrapAndPreserve);
  s = s.replace(/(?<![\w])(refs\/heads(?:\/[a-zA-Z0-9_.-]+)*)(?![\w])/g, wrapAndPreserve);
  s = s.replace(/(?<![\w])(\.gitignore|\.gitattributes)(?![\w])/g, wrapAndPreserve);
  s = s.replace(/(?<![\w])(HEAD(?:~[0-9]+|\^[0-9]*|)|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD)(?![\w])/g, wrapAndPreserve);

  // 6. Python dunder методы
  s = s.replace(/(?<![\w])(__(?:init|str|repr|eq|len|getitem|enter|exit|call|iter|next|name|main|dict|slots)__)(?![\w])/g, wrapAndPreserve);

  // 7. Встроенные вызовы функций Python
  s = s.replace(/(?<![\w])((?:range|len|isinstance|issubclass|enumerate|zip|sorted|print|type|id|repr|super)\(\))(?![\w])/g, wrapAndPreserve);

  // 8. Литералы и ключевые параметры Python
  s = s.replace(/(?<![\w])(\*args|\*\*kwargs|\bNone\b|\bTrue\b|\bFalse\b|\bself\b|\bcls\b)(?![\w])/g, wrapAndPreserve);

  // 9. Команды терминала Python/DevOps
  s = s.replace(/(?<![\w])(python\s+(?:-m\s+)?[a-zA-Z0-9_.-]+|pip\s+install(?:\s+-[a-zA-Z0-9_-]+|\s+[a-zA-Z0-9_.-]+)+|pytest|docker\s+(?:run|build|ps|stop|exec)|docker-compose(?:\s+[a-zA-Z0-9_-]+)*)(?![\w])/g, wrapAndPreserve);

  // 10. Типографика тире: дефисы между словами заменяем на длинное тире
  s = s.replace(/\s+[-–]\s+/g, ' — ');

  // 11. Восстанавливаем все защищенные блоки кода
  s = s.replace(/__CODE_(\d+)__/g, (_m, idx) => `\`${preservedCode[Number(idx)]}\``);

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
  if (/^#{1,6}\s+/.test(text) || text.startsWith('##') || text.startsWith('###')) {
    return false;
  }
  const russianWords = text.match(/[а-яА-ЯёЁ]{3,}/g) || [];
  if (russianWords.length >= 4) {
    return false;
  }
  return (
    text.startsWith('# Старый') ||
    text.startsWith('# Новый') ||
    (text.startsWith('# ') && !/^[#\s]*[А-ЯA-Z]/.test(text)) ||
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

console.log('\n--- 6. ТЕСТИРОВАНИЕ ВЫПРЯМЛЕНИЯ ИЕРАРХИИ (flattenAndCleanNoteHierarchy) ---');
function simulateFlattenNode(rawText) {
  if (rawText.startsWith('## ') || rawText.startsWith('### ')) {
    const cleanTitle = cleanHeadingTitle(rawText);
    const isRealH = checkIsHeading(rawText, cleanTitle, undefined, false) && !isCodeSnippet(rawText);
    if (isRealH) {
      return { type: 'heading', text: `## ${cleanTitle}`, fontSize: 'H2' };
    } else {
      const fixedText = cleanProseText(rawText);
      return { type: 'prose', text: fixedText, fontSize: undefined };
    }
  }
  return { type: 'prose', text: cleanProseText(rawText), fontSize: undefined };
}

const node1 = simulateFlattenNode('## Что такое ветка на уровне Git');
assert(node1.type === 'heading' && node1.fontSize === 'H2' && node1.text === '## Что такое ветка на уровне Git', 'Истинный заголовок получает H2');

const node2 = simulateFlattenNode('## Ветка в Git – это не папка. Это указатель на коммит.');
assert(node2.type === 'prose' && node2.fontSize === undefined && !node2.text.startsWith('#'), 'Ложный заголовок в иерархии сбрасывается в прозу без H2');

console.log('\n--- 7. ТЕСТИРОВАНИЕ ГРАНИЧНЫХ СЛУЧАЕВ BIG-O И CLI ---');
assert(cleanProseText('Сложность алгоритма O(n^2) и O(2^n).') === 'Сложность алгоритма $O(n^2)$ и $O(2^n)$.', 'Степенные сложности O(n^2) и O(2^n)');
assert(cleanProseText('Факториал за O(n!).') === 'Факториал за $O(n!)$.', 'Факториальная сложность O(n!)');
assert(cleanProseText('Команда git switch -c feature-test.') === 'Команда `git switch -c feature-test`.', 'Команда git switch -c');
assert(cleanProseText('Слияние через git merge --no-ff dev.') === 'Слияние через `git merge --no-ff dev`.', 'Команда git merge --no-ff');
assert(cleanProseText('Продолжение git rebase --continue.') === 'Продолжение `git rebase --continue`.', 'Команда git rebase --continue');

console.log('\n--- 8. ТЕСТИРОВАНИЕ МНОГОКРАТНОЙ ИДЕМПОТЕНТНОСТИ (10 ЦИКЛОВ) ---');
const complexDoc = [
  '📖 Перечитать конспект Ветки в Git: checkout, switch и управление ветками→Конспект перечитан и усвоен. Оцените, насколько хорошо помните материал.',
  '## Что такое ветка на уровне Git',
  'Ветка в Git – это не папка. Это указатель за O(1) на коммит.',
  'git checkout -b feature-auth   # создать и переключиться',
  'def get_branch():\n    return "main"',
  '## Fast-forward слияние',
  'При слиянии git merge --no-ff dev создается коммит.',
  'Файл .git/HEAD указывает на refs/heads/main.'
];

let currentPass = complexDoc;
for (let c = 1; c <= 10; c++) {
  const nextPass = simulatePass(currentPass);
  if (c >= 2) {
    assert(JSON.stringify(currentPass) === JSON.stringify(nextPass), `Идемпотентность цикла ${c - 1} -> ${c}`);
  }
  currentPass = nextPass;
}

console.log('\n--- 9. ТЕСТИРОВАНИЕ КРАЕВЫХ ЗАГОЛОВКОВ ---');
assert(checkIsHeading('## Что такое merge?', cleanHeadingTitle('## Что такое merge?'), undefined, false) === true, 'Вопросительный заголовок ## Что такое merge?');
assert(checkIsHeading('## Зачем нужен rebase: основные причины', cleanHeadingTitle('## Зачем нужен rebase: основные причины'), undefined, false) === true, 'Заголовок с двоеточием');
assert(checkIsHeading('## 1. Заголовок раздела', cleanHeadingTitle('## 1. Заголовок раздела'), undefined, false) === true, 'Нумерованный заголовок раздела');
assert(checkIsHeading('## Как устроен коммит в деталях', cleanHeadingTitle('## Как устроен коммит в деталях'), undefined, false) === true, 'Русский заголовок');
assert(checkIsHeading('## Очень длинный заголовок который намеренно превышает допустимый лимит в шестьдесят пять символов подряд', cleanHeadingTitle('## Очень длинный заголовок который намеренно превышает допустимый лимит в шестьдесят пять символов подряд'), undefined, false) === false, 'Длинная строка > 65 символов отсекается');
assert(checkIsHeading('## Первое предложение. Второе предложение.', cleanHeadingTitle('## Первое предложение. Второе предложение.'), undefined, false) === false, 'Два предложения с точкой отсекаются');
assert(checkIsHeading('## Первый вопрос? Второе предложение.', cleanHeadingTitle('## Первый вопрос? Второе предложение.'), undefined, false) === false, 'Вопрос с продолжением отсекается');
assert(checkIsHeading('## Заголовок с точкой на конце.', cleanHeadingTitle('## Заголовок с точкой на конце.'), undefined, false) === false, 'Заголовок с точкой на конце отсекается');
assert(checkIsHeading('## ', cleanHeadingTitle('## '), undefined, false) === false, 'Пустая решётка отсекается');

console.log('\n--- 10. ТЕСТИРОВАНИЕ КРАЕВЫХ СЛУЧАЕВ СЛОВАРЯ BIG-O И КОМАНД ---');
assert(cleanProseText('Асимптотика O(k) и O(m + n).') === 'Асимптотика $O(k)$ и $O(m + n)$.', 'Сложность O(k) и O(m + n)');
assert(cleanProseText('Команда git stash pop.') === 'Команда `git stash pop`.', 'Команда git stash pop');
assert(cleanProseText('Команда git commit --amend.') === 'Команда `git commit --amend`.', 'Команда git commit --amend');
assert(cleanProseText('Команда git reset --hard HEAD~1.') === 'Команда `git reset --hard HEAD~1`.', 'Команда git reset --hard');
assert(cleanProseText('История git log --oneline --graph.') === 'История `git log --oneline --graph`.', 'Команда git log --oneline --graph');
assert(cleanProseText('Разница git diff HEAD.') === 'Разница `git diff HEAD`.', 'Команда git diff HEAD');

console.log('\n--- 11. ТЕСТИРОВАНИЕ PARSE_MARKDOWN_TO_RICHTEXT ---');
const emptyTokens = parseMarkdownToRichText('');
assert(emptyTokens.length === 1 && emptyTokens[0].text === '', 'Пустая строка -> пустой текстовый токен');

const plainTokens = parseMarkdownToRichText('Простой русский текст.');
assert(plainTokens.length === 1 && plainTokens[0].text === 'Простой русский текст.' && !plainTokens[0].q, 'Простой текст без форматирования');

const codeTokens = parseMarkdownToRichText('Команда `git status` показывает статус.');
assert(codeTokens.length === 3, 'Инлайн-код разбит на 3 токена');
assert(codeTokens[0].text === 'Команда ', 'Первый токен — префикс');
assert(codeTokens[1].text === 'git status' && codeTokens[1].q === true, 'Второй токен — нативный инлайн-код (q: true)');
assert(codeTokens[2].text === ' показывает статус.', 'Третий токен — суффикс');

const latexTokens = parseMarkdownToRichText('Асимптотика $O(1)$ и $O(n)$.');
assert(latexTokens.length === 5, 'LaTeX формулы разбиты на токены (с точкой в конце)');
assert(latexTokens[1].i === 'x' && latexTokens[1].text === 'O(1)', 'Токен 1 — нативный KaTeX { i: "x", text: "O(1)" }');
assert(latexTokens[3].i === 'x' && latexTokens[3].text === 'O(n)', 'Токен 3 — нативный KaTeX { i: "x", text: "O(n)" }');

const boldTokens = parseMarkdownToRichText('Это **очень важно** для понимания.');
assert(boldTokens.length === 3, 'Жирный текст разбит на 3 токена');
assert(boldTokens[1].b === true && boldTokens[1].text === 'очень важно', 'Токен 1 — жирный (b: true)');

console.log('\n--- 12. ТЕСТИРОВАНИЕ RICHTEXT_TO_MARKDOWN И ROUNDTRIP ---');
const sampleRichText = [
  { i: 'm', text: 'Сложность ' },
  { i: 'x', text: 'O(1)' },
  { i: 'm', text: ', а команда ' },
  { i: 'm', text: 'git switch -c new-branch', q: true },
  { i: 'm', text: ' — это ' },
  { i: 'm', text: 'важно', b: true },
  { i: 'm', text: '.' }
];
const serializedMd = richTextToMarkdown(sampleRichText);
assert(serializedMd === 'Сложность $O(1)$, а команда `git switch -c new-branch` — это **важно**.', 'Сериализация RichText в Markdown');

const reParsed = parseMarkdownToRichText(serializedMd);
const reSerialized = richTextToMarkdown(reParsed);
assert(serializedMd === reSerialized, 'Roundtrip: richText -> markdown -> parse -> markdown идентичен');

console.log('\n--- 13. ТЕСТИРОВАНИЕ PYTHON И ДРУГИХ ПАТТЕРНОВ В CLEAN_PROSE_TEXT ---');
assert(cleanProseText('Метод __init__ создает объект.') === 'Метод `__init__` создает объект.', 'Dunder __init__');
assert(cleanProseText('Методы __str__ и __repr__ для строк.') === 'Методы `__str__` и `__repr__` для строк.', 'Dunder __str__ и __repr__');
assert(cleanProseText('Функция len() возвращает размер.') === 'Функция `len()` возвращает размер.', 'Функция len()');
assert(cleanProseText('Итератор range() генерирует числа.') === 'Итератор `range()` генерирует числа.', 'Функция range()');
assert(cleanProseText('Переменная None и флаг True.') === 'Переменная `None` и флаг `True`.', 'Литералы None и True');
assert(cleanProseText('Параметры *args и **kwargs в функции.') === 'Параметры `*args` и `**kwargs` в функции.', 'Параметры *args и **kwargs');
assert(cleanProseText('Команда git cherry-pick abc1234.') === 'Команда `git cherry-pick abc1234`.', 'Команда git cherry-pick');
assert(cleanProseText('Индекс git diff --staged.') === 'Индекс `git diff --staged`.', 'Флаг --staged');
assert(cleanProseText('Флаг -b создает новую ветку.') === 'Флаг `-b` создает новую ветку.', 'Изолированный флаг -b');
assert(cleanProseText('Вся команда git checkout -b feature.') === 'Вся команда `git checkout -b feature`.', 'Команда с флагом целиком');
assert(cleanProseText('Запуск pytest в терминале.') === 'Запуск `pytest` в терминале.', 'Команда pytest');
assert(cleanProseText('Установка pip install requests в venv.') === 'Установка `pip install requests` в venv.', 'Команда pip install');

console.log('\n--- 14. ТЕСТИРОВАНИЕ ПОЛНОГО ПАЙПЛАЙНА (FULL PIPELINE INTEGRITY) ---');
const rawDirtyNote = 'Сложность O(1). Выполните git checkout -b dev и проверьте .git/HEAD. Метод __init__ обязателен.';
const cleanedProse = cleanProseText(rawDirtyNote);
const nativeRichText = parseMarkdownToRichText(cleanedProse);

assert(nativeRichText.some(t => t.i === 'x' && t.text === 'O(1)'), 'Пайплайн создал нативный KaTeX токен');
assert(nativeRichText.some(t => t.q === true && t.text === 'git checkout -b dev'), 'Пайплайн создал нативный inline-code токен');
assert(nativeRichText.some(t => t.q === true && t.text === '.git/HEAD'), 'Пайплайн распознал системный путь .git/HEAD');
assert(nativeRichText.some(t => t.q === true && t.text === '__init__'), 'Пайплайн распознал dunder метод __init__');

console.log('\n--- 15. ТЕСТИРОВАНИЕ ЗАЩИТЫ ЗАГОЛОВКОВ ОТ ПРЕВРАЩЕНИЯ В ИНЛАЙН-КОД ---');
assert(isCodeSnippet('## Fast-forward merge') === false, 'Заголовок ## Fast-forward merge НЕ считается кодом');
assert(isCodeSnippet('## Резюме') === false, 'Заголовок ## Резюме НЕ считается кодом');
assert(isCodeSnippet('## Что такое ветка на уровне Git') === false, 'Заголовок ## Что такое ветка НЕ считается кодом');
assert(isCodeSnippet('## Команды Git: checkout, switch') === false, 'Заголовок с двоеточием НЕ считается кодом');
assert(isCodeSnippet('### Подраздел') === false, 'Заголовок ### Подраздел НЕ считается кодом');

assert(checkIsHeading('## Fast-forward merge', cleanHeadingTitle('## Fast-forward merge'), undefined, false) === true, '## Fast-forward merge признан заголовком');
assert(checkIsHeading('Fast-forward merge', cleanHeadingTitle('Fast-forward merge'), 'H2', false) === true, 'H2 без решеток признан заголовком');
assert(checkIsHeading('Быстрый старт', cleanHeadingTitle('Быстрый старт'), 'H1', false) === true, 'H1 признан заголовком');
assert(checkIsHeading('Важные детали', cleanHeadingTitle('Важные детали'), 'H3', false) === true, 'H3 признан заголовком');

// Симуляция форматирования конспекта с заголовками
const noteWithHeadings = [
  '## Fast-forward merge',
  'При слиянии без конфликтов указатель просто передвигается вперед.',
  '## Резюме',
  'Ветка в Git — это легковесный указатель.'
];
const formattedPass = simulatePass(noteWithHeadings);
assert(formattedPass[0] === '## Fast-forward merge', 'Заголовок 1 остался H2 заголовком, а не инлайном');
assert(formattedPass[2] === '## Резюме', 'Заголовок 2 остался H2 заголовком, а не инлайном');

console.log(`\n==========================================`);
console.log(`ИТОГО: Успешно: ${totalPassed} | Ошибок: ${totalFailed}`);
console.log(`==========================================\n`);
if (totalFailed > 0) process.exit(1);
