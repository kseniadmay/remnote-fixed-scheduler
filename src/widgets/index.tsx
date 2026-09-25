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

  // 5. Команда: Выровнять нумерацию конспектов (01, 02, 03...) без изменения структуры папок
  async function renumberNotes(plugin: ReactRNPlugin, rootRem?: PluginRem) {
    const target = rootRem || (await plugin.focus.getFocusedRem());
    if (!target) {
      await plugin.app.toast('Откройте папку с конспектами или модуль и повторите команду');
      return;
    }

    let renumberedCount = 0;
    await plugin.app.toast('Выравниваю нумерацию конспектов (01, 02, 03...)...');

    async function processNode(rem: PluginRem) {
      const textStr = (await plugin.richText.toString(rem.text || [])).trim();
      const children = await rem.getChildrenRem();

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
          idx++;
        }
      } else {
        for (const child of children) {
          await processNode(child);
        }
      }
    }

    try {
      await processNode(target);
      await plugin.app.toast(
        `✅ Готово! Выровнено номеров конспектов: ${renumberedCount}`
      );
    } catch (e) {
      console.error('renumberNotes failed:', e);
      await plugin.app.toast(`Ошибка при нумерации: ${String(e)}`);
    }
  }

  // Регистрация команды в палитре (Ctrl+K)
  await plugin.app.registerCommand({
    id: 'renumber-notes',
    name: '🔢 Выровнять нумерацию конспектов (01, 02, 03...)',
    action: async () => {
      await renumberNotes(plugin);
    },
  });

  // Меню документа
  try {
    await plugin.app.registerMenuItem({
      id: 'menu-renumber-notes',
      name: '🔢 Выровнять нумерацию конспектов (01, 02, 03...)',
      location: PluginCommandMenuLocation.DocumentMenu,
      action: async (args: any) => {
        const remId = args?.remId;
        const rem = remId ? await plugin.rem.findOne(remId) : await plugin.focus.getFocusedRem();
        if (rem) await renumberNotes(plugin, rem);
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

}

async function onDeactivate(_plugin: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
