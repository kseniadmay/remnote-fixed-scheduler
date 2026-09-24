import {
  declareIndexPlugin,
  ReactRNPlugin,
  PluginRem,
  SpecialPluginCallback,
  BuiltInPowerupCodes,
  WidgetLocation,
  PluginCommandMenuLocation,
} from '@remnote/plugin-sdk';

// ============================================================
// Часть 1: Жёсткий график повторения 1-3-7-21-30 и далее
// ============================================================

// Шаги интервалов (в днях):
// Исходное добавление в цикл: через 1 день (завтра)
// После 1-го ревью: через 3 дня
// После 2-го ревью: через 7 дней
// После 3-го ревью: через 21 день
// После 4-го ревью: через 30 дней
// Далее: 60, 90, 180, 360 дней
const FIXED_STEPS_DAYS = [1, 3, 7, 21, 30, 60, 90, 180, 360];
const DAY_MS = 24 * 60 * 60 * 1000;

async function registerFixedScheduler(plugin: ReactRNPlugin) {
  // Регистрирует планировщик (основное имя) и синонимы в настройках RemNote
  await plugin.scheduler.registerCustomScheduler('Планировщик повторений 1-3-7-21-30', []);
  try {
    await plugin.scheduler.registerCustomScheduler('Расписание повторений 1-3-7-21-30', []);
    await plugin.scheduler.registerCustomScheduler('Fixed 1-3-7-21-30', []);
  } catch (_) {}

  // Вызывается RemNote при каждом ревью карточки с этим планировщиком
  plugin.app.registerCallback(SpecialPluginCallback.SRSScheduleCard, async (args: any) => {
    // repsSoFar включает только что завершённое ревью
    const repsSoFar = args.history?.length ?? 1;
    let days: number;

    if (repsSoFar < FIXED_STEPS_DAYS.length) {
      days = FIXED_STEPS_DAYS[repsSoFar];
    } else {
      const extraSteps = repsSoFar - (FIXED_STEPS_DAYS.length - 1);
      days = FIXED_STEPS_DAYS[FIXED_STEPS_DAYS.length - 1] * Math.pow(2, extraSteps);
    }

    return { nextDate: Date.now() + days * DAY_MS };
  });
}

// Вспомогательная функция: активировать повторение для конспекта
async function activateNoteRepetition(plugin: ReactRNPlugin, rem: PluginRem) {
  // 1. Снимаем статус отключения карточек с документа
  if (await rem.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
    await rem.removePowerup(BuiltInPowerupCodes.DisableCards);
  }

  // 2. Снимаем паузу со всех дочерних карточек
  const children = await rem.getChildrenRem();
  for (const child of children) {
    if (await child.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
      await child.removePowerup(BuiltInPowerupCodes.DisableCards);
    }
  }

  const title = (await plugin.richText.toString(rem.text || [])).slice(0, 50);
  await plugin.app.toast(
    `✅ Конспект «${title}» активирован! Первое повторение запланировано на завтра (1-3-7-21-30).`
  );
}

// Вспомогательная функция: приостановить повторение конспекта
async function pauseNoteRepetition(plugin: ReactRNPlugin, rem: PluginRem) {
  await rem.addPowerup(BuiltInPowerupCodes.DisableCards);
  const title = (await plugin.richText.toString(rem.text || [])).slice(0, 50);
  await plugin.app.toast(`⏸️ Конспект «${title}» приостановлен и исключён из очереди повторений.`);
}

// ============================================================
// Часть 2: Обновление описаний и формулировок карточек (Claude)
// ============================================================

const API_KEY_SETTING = 'anthropic-api-key';
const MODEL_SETTING = 'anthropic-model';
const BATCH_SIZE = 12;

type CardPair = { PluginRem: PluginRem; front: string; back: string };

function buildPrompt(pairs: { front: string; back: string }[]): string {
  return [
    'Ты помогаешь готовить флеш-карточки для джуна, который готовится стать',
    'Junior+ Python Backend Developer. Ниже даны пары «вопрос-ответ».',
    'Переформулируй каждую пару так, чтобы формулировка была технически',
    'точной и однозначной, но при этом понятной новичку: без двусмысленностей,',
    'без лишней воды, без усложнения там, где можно сказать проще.',
    'Не меняй смысл и не добавляй факты, которых не было в исходнике.',
    '',
    'Верни ТОЛЬКО валидный JSON-массив вида',
    '[{"i": 0, "front": "...", "back": "..."}, ...]',
    'без markdown-обёртки и без пояснений.',
    '',
    'Карточки:',
    JSON.stringify(pairs.map((p, i) => ({ i, front: p.front, back: p.back }))),
  ].join('\n');
}

async function callClaude(
  apiKey: string,
  model: string,
  pairs: { front: string; back: string }[]
): Promise<{ i: number; front: string; back: string }[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildPrompt(pairs) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude API вернул ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const raw: string = data.content?.[0]?.text ?? '[]';
  const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();
  return JSON.parse(cleaned);
}

// ============================================================
// Точка входа плагина
// ============================================================

async function onActivate(plugin: ReactRNPlugin) {
  // 1. Регистрация алгоритма повторения
  try {
    await registerFixedScheduler(plugin);
  } catch (e) {
    console.warn('[Fixed Scheduler] registerFixedScheduler failed:', e);
  }

  // 2. Регистрация виджета в шапке открытого документа
  try {
    await plugin.app.registerWidget(
      'note_scheduler_bar',
      WidgetLocation.DocumentBelowTitle,
      {
        dimensions: { height: 'auto', width: '100%' },
      }
    );
  } catch (e) {
    console.warn('[Fixed Scheduler] registerWidget failed:', e);
  }

  // 3. Команда: Отметить конспект прочитанным (запустить повторение)
  await plugin.app.registerCommand({
    id: 'activate-note-spaced-repetition',
    name: 'Конспект прочитан — поставить на повторение (1-3-7-21-30)',
    action: async () => {
      const root = await plugin.focus.getFocusedRem();
      if (!root) {
        await plugin.app.toast('Откройте конспект и повторите команду');
        return;
      }
      await activateNoteRepetition(plugin, root);
    },
  });

  // Меню документа: Запустить повторение
  try {
    await plugin.app.registerMenuItem({
      id: 'menu-activate-note-spaced-repetition',
      name: '📖 Конспект прочитан — запустить повторение (1-3-7-21-30)',
      location: PluginCommandMenuLocation.DocumentMenu,
      action: async (args: any) => {
        const remId = args?.remId;
        const rem = remId ? await plugin.rem.findOne(remId) : await plugin.focus.getFocusedRem();
        if (rem) await activateNoteRepetition(plugin, rem);
      },
    });
  } catch (_) {}

  // 4. Команда: Приостановить повторение конспекта
  await plugin.app.registerCommand({
    id: 'pause-note-spaced-repetition',
    name: 'Приостановить повторение конспекта',
    action: async () => {
      const root = await plugin.focus.getFocusedRem();
      if (!root) {
        await plugin.app.toast('Откройте конспект и повторите команду');
        return;
      }
      await pauseNoteRepetition(plugin, root);
    },
  });

  // Меню документа: Приостановить повторение
  try {
    await plugin.app.registerMenuItem({
      id: 'menu-pause-note-spaced-repetition',
      name: '⏸️ Приостановить повторение конспекта',
      location: PluginCommandMenuLocation.DocumentMenu,
      action: async (args: any) => {
        const remId = args?.remId;
        const rem = remId ? await plugin.rem.findOne(remId) : await plugin.focus.getFocusedRem();
        if (rem) await pauseNoteRepetition(plugin, rem);
      },
    });
  } catch (_) {}

  // 5. Настройки Claude AI
  await plugin.settings.registerStringSetting({
    id: API_KEY_SETTING,
    title: 'Anthropic API key (для ИИ Claude)',
    description:
      'Требуется ТОЛЬКО для функции обновления описаний карточек через Claude AI. Доступ к API Claude платный (тарифицируется по токенам на console.anthropic.com). Для работы самого планировщика повторений ключ НЕ нужен.',
  });
  await plugin.settings.registerStringSetting({
    id: MODEL_SETTING,
    title: 'Модель Claude',
    defaultValue: 'claude-sonnet-5',
    description: 'См. актуальный список моделей на docs.claude.com',
  });

  // 6. Команда: Сделать папки папками, а конспекты документами (и исправить нумерацию)
  async function organizeRemStructure(plugin: ReactRNPlugin, rootRem?: PluginRem) {
    const target = rootRem || (await plugin.focus.getFocusedRem());
    if (!target) {
      await plugin.app.toast('Откройте папку или конспект и повторите команду');
      return;
    }

    let foldersCount = 0;
    let docsCount = 0;
    let renumberedCount = 0;

    await plugin.app.toast('Начинаю организацию структуры: папки -> папки, конспекты -> документы...');

    async function processNode(rem: PluginRem, depth: number) {
      const textStr = (await plugin.richText.toString(rem.text || [])).trim();
      const children = await rem.getChildrenRem();

      const isFolderContainer =
        /^(?:0\d\s*·|\d+\s*·|Модуль|Юнит|📚|📇|База|Собеседован|Конспект|Карточ)/i.test(textStr) ||
        (children.length > 0 && depth <= 3);

      if (isFolderContainer) {
        await rem.setIsFolder(true);
        await rem.setIsDocument(false);
        foldersCount++;
      } else {
        if (!rem.backText || rem.backText.length === 0) {
          await rem.setIsDocument(true);
          await rem.setIsFolder(false);
          docsCount++;
        }
      }

      // Если это папка конспектов (или юнит с конспектами) — выравниваем нумерацию
      if (textStr.includes('Конспект') || textStr.includes('Теория')) {
        let idx = 1;
        for (const child of children) {
          const cText = (await plugin.richText.toString(child.text || [])).trim();
          if (!cText || cText === '📚 Конспекты' || cText === 'Конспекты') continue;

          const match = cText.match(/^(\d+)\.\s*(.+)$/);
          const titleBody = match ? match[2].trim() : cText;
          const oldNum = match ? parseInt(match[1], 10) : null;
          const newNumStr = String(idx).padStart(2, '0');

          if (oldNum !== idx) {
            const newTitle = `${newNumStr}. ${titleBody}`;
            await child.setText(await plugin.richText.text(newTitle).value());
            renumberedCount++;
          }
          await child.setIsDocument(true);
          await child.setIsFolder(false);
          docsCount++;
          idx++;
        }
      } else {

        for (const child of children) {
          await processNode(child, depth + 1);
        }
      }
    }

    try {
      await processNode(target, 0);
      await plugin.app.toast(
        `✅ Готово! Организовано папок: ${foldersCount}, документов: ${docsCount}, исправлено номеров: ${renumberedCount}`
      );
    } catch (e) {
      console.error('organizeRemStructure failed:', e);
      await plugin.app.toast(`Ошибка при организации: ${String(e)}`);
    }
  }

  // Регистрация команды в палитре (Ctrl+K)
  await plugin.app.registerCommand({
    id: 'organize-folders-and-docs',
    name: '📁 Организовать: сделать папки папками, а конспекты документами (исправить номера)',
    action: async () => {
      await organizeRemStructure(plugin);
    },
  });

  // Меню документа
  try {
    await plugin.app.registerMenuItem({
      id: 'menu-organize-folders-and-docs',
      name: '📁 Организовать папки и документы (исправить номера)',
      location: PluginCommandMenuLocation.DocumentMenu,
      action: async (args: any) => {
        const remId = args?.remId;
        const rem = remId ? await plugin.rem.findOne(remId) : await plugin.focus.getFocusedRem();
        if (rem) await organizeRemStructure(plugin, rem);
      },
    });
  } catch (_) {}

  // 7. Команда: Сделать ссылки программы рабочими (привязать к конспектам и карточкам)
  async function fixProgramLinks(plugin: ReactRNPlugin, rootRem?: PluginRem) {
    const target = rootRem || (await plugin.focus.getFocusedRem());
    if (!target) {
      await plugin.app.toast('Откройте Программу подготовки и повторите команду');
      return;
    }

    await plugin.app.toast('Начинаю привязку ссылок к реальным конспектам и карточкам...');
    let fixedTheoryCount = 0;
    let fixedPracticeCount = 0;

    async function processRem(rem: PluginRem) {
      const textStr = (await plugin.richText.toString(rem.text || [])).trim();
      const children = await rem.getChildrenRem();

      // Проверяем, является ли это пунктом практики (по эмодзи уровня)
      const practiceMatch = textStr.match(/^([🥚🐣🦊🐺🐯🐉👑]\s*Уровень\s*\d+\s*·\s*)(.*?)(\s*#\w+)?$/);
      if (practiceMatch) {
        let taskBody = practiceMatch[2].trim();
        const emojiPrefix = practiceMatch[1];
        const tag = practiceMatch[3] ? practiceMatch[3].trim() : '';

        // Очищаем от возможных артефактов markdown/about:blank
        taskBody = taskBody
          .replace(/\[([^\]]+)\]\(about:blank\)/g, '$1')
          .replace(/\[([^\]]+)\]\(\)/g, '$1')
          .replace(/about:blank/g, '')
          .trim();

        const newRich = await plugin.richText
          .text(`${emojiPrefix}${taskBody}${tag ? '  ' + tag : ''}`)
          .value();
        await rem.setText(newRich);
        fixedPracticeCount++;
      } else if (
        textStr.length > 5 &&
        !textStr.startsWith('#') &&
        !textStr.startsWith('**') &&
        !textStr.startsWith('##')
      ) {
        // Проверяем, это теория?
        let cleanTopic = textStr
          .replace(/\[([^\]]+)\]\(about:blank\)/g, '$1')
          .replace(/\[([^\]]+)\]\(\)/g, '$1')
          .replace(/about:blank/g, '')
          .trim();

        if (cleanTopic.length > 5) {
          try {
            const queryStr = cleanTopic.slice(0, 30);
            const searchResults = await plugin.search.search(
              await plugin.richText.text(queryStr).value(),
              undefined,
              { numResults: 6 }
            );

            let matchedDoc: PluginRem | undefined;
            const normSearch = cleanTopic.toLowerCase().replace(/[\s_:\-]+/g, '');
            for (const res of searchResults) {
              const resTitle = (await plugin.richText.toString(res.text || [])).toLowerCase();
              const normRes = resTitle.replace(/[\s_:\-]+/g, '');
              const normCleanRes = normRes.replace(/^\d+[\.\s]*/, '');
              if (
                normRes.includes(normSearch) ||
                normSearch.includes(normCleanRes) ||
                (normCleanRes.length > 8 && normSearch.includes(normCleanRes.slice(0, 15)))
              ) {
                matchedDoc = res;
                break;
              }
            }

            if (matchedDoc) {
              await rem.setText(await plugin.richText.rem(matchedDoc).value());
              fixedTheoryCount++;
            }
          } catch (_) {}
        }
      }

      for (const child of children) {
        await processRem(child);
      }
    }

    try {
      await processRem(target);
      await plugin.app.toast(
        `✅ Готово! Привязано конспектов: ${fixedTheoryCount}, обновлено задач: ${fixedPracticeCount}`
      );
    } catch (e) {
      console.error('fixProgramLinks failed:', e);
      await plugin.app.toast(`Ошибка при привязке ссылок: ${String(e)}`);
    }
  }

  // Регистрация команды привязки ссылок в палитре (Ctrl+K)
  await plugin.app.registerCommand({
    id: 'fix-program-links',
    name: '🔗 Сделать все ссылки программы рабочими (привязать к конспектам)',
    action: async () => {
      await fixProgramLinks(plugin);
    },
  });

  // Меню документа: Привязать ссылки программы
  try {
    await plugin.app.registerMenuItem({
      id: 'menu-fix-program-links',
      name: '🔗 Привязать ссылки программы к конспектам',
      location: PluginCommandMenuLocation.DocumentMenu,
      action: async (args: any) => {
        const remId = args?.remId;
        const rem = remId ? await plugin.rem.findOne(remId) : await plugin.focus.getFocusedRem();
        if (rem) await fixProgramLinks(plugin, rem);
      },
    });
  } catch (_) {}

  // 8. Команда Claude AI

  await plugin.app.registerCommand({
    id: 'smart-edit-cards',
    name: 'Обновить описания карточек в этой папке (Claude)',
    action: async () => {
      const apiKey = await plugin.settings.getSetting<string>(API_KEY_SETTING);
      const model = (await plugin.settings.getSetting<string>(MODEL_SETTING)) || 'claude-sonnet-5';

      if (!apiKey) {
        await plugin.app.toast('Сначала укажите Anthropic API key в настройках плагина');
        return;
      }
      const root = await plugin.focus.getFocusedRem();
      if (!root) {
        await plugin.app.toast('Откройте папку с карточками и повторите команду');
        return;
      }

      const raw: PluginRem[] = [];
      await (async function collect(r: PluginRem) {
        if (r.backText && r.backText.length > 0) raw.push(r);
        for (const child of await r.getChildrenRem()) await collect(child);
      })(root);

      if (raw.length === 0) {
        await plugin.app.toast('В этой папке не нашлось карточек (front/back)');
        return;
      }

      const cards: CardPair[] = [];
      for (const r of raw) {
        cards.push({
          PluginRem: r,
          front: await plugin.richText.toString(r.text || []),
          back: await plugin.richText.toString(r.backText || []),
        });
      }

      let done = 0;
      for (let start = 0; start < cards.length; start += BATCH_SIZE) {
        const batch = cards.slice(start, start + BATCH_SIZE);
        await plugin.app.toast(
          `Обрабатываю карточки ${start + 1}–${Math.min(start + BATCH_SIZE, cards.length)} из ${cards.length}…`
        );
        try {
          const rewritten = await callClaude(
            apiKey,
            model,
            batch.map((c) => ({ front: c.front, back: c.back }))
          );
          for (const item of rewritten) {
            const card = batch[item.i];
            if (!card) continue;
            await card.PluginRem.setText(await plugin.richText.text(item.front).value());
            await card.PluginRem.setBackText(await plugin.richText.text(item.back).value());
            done++;
          }
        } catch (e) {
          console.error('smart-edit-cards batch failed', e);
          await plugin.app.toast(`Ошибка на батче ${start + 1}: ${String(e)}`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      await plugin.app.toast(`Готово: обновлено описаний карточек — ${done} из ${cards.length}`);
    },
  });
}

async function onDeactivate(_plugin: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
