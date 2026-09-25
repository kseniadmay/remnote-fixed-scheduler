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
  // 0. Регистрация CSS-стилей для скрытия буллетов у блоков кода
  try {
    await plugin.app.registerCSS(
      'clean-code-blocks-no-bullet',
      `
      /* Полное скрытие буллетов и стрелок сворачивания для блоков кода */
      .rem-container:has(.rn-code-node) > .TreeNode > .rem-bullet__container,
      .rem-container:has(.rn-code-node) > .rem-bullet__container,
      .rem-container:has(.rn-code-node) .rem-bullet,
      .rem-container:has(.rn-code-node) .rem-bullet__container,
      .rem-container:has(.rn-code-node) .toggle-collapse-button,
      .rem-container:has(.rn-code-node) .collapsedButton,
      .rem-container:has(.rn-fast-rem-code-node-editor-container) .rem-bullet,
      .rem-container:has(.rn-fast-rem-code-node-editor-container) .rem-bullet__container,
      .rem-container:has(.rn-fast-rem-code-node-editor-container) .toggle-collapse-button,
      .rn-editor__rem:has(.rn-code-node) .rem-bullet,
      .rn-editor__rem:has(.rn-code-node) .rem-bullet__container,
      .rn-editor__rem:has(.rn-code-node) .toggle-collapse-button,
      div:has(> .rn-code-node) .rem-bullet,
      div:has(> .rn-code-node) .toggle-collapse-button,
      div:has(> * > .rn-code-node) .rem-bullet,
      div:has(> * > .rn-code-node) .toggle-collapse-button,
      [data-rem-tags*="cd"] .rem-bullet,
      [data-rem-tags*="cd"] .toggle-collapse-button,
      [data-rem-container-tags*="cd"] .rem-bullet,
      [data-rem-container-tags*="cd"] .toggle-collapse-button {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        width: 0 !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        pointer-events: none !important;
      }

      /* Выравнивание блока кода без буллета */
      .rem-container:has(.rn-code-node) {
        margin-left: 0 !important;
      }
      .rem-container:has(.rn-code-node) .rn-code-node {
        margin-top: 6px !important;
        margin-bottom: 6px !important;
        border-radius: 8px !important;
        border: 1px solid rgba(0, 0, 0, 0.08) !important;
      }

      /* Скрытие пустых узлов/буллетов (чтобы не оставалось висящих пустых точек) */
      .rem-container:has(> .TreeNode > .rem-text:empty):not(:has(.rn-divider)),
      .rem-container:has(> .TreeNode > .rem-text > .RichTextViewer:empty):not(:has(.rn-divider)),
      .rem-container:has(> .TreeNode > .rem-text > .rich-text-editor:empty):not(:has(.rn-divider)) {
        display: none !important;
      }
      `
    );
  } catch (e) {
    console.warn('[Fixed Scheduler] registerCSS failed:', e);
  }

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

  // 6. Оформление заголовков юнитов и подтем с эмодзи
  const UNIT_EMOJIS: Record<string, string> = {
    // Модуль 1
    '1.1': '🐍', '1.2': '⚙️', '1.3': '🔁', '1.4': '📦', '1.5': '🏗️',
    '1.6': '🏷️', '1.7': '🧠', '1.8': '⚡', '1.9': '🛠️',
    // Модуль 2
    '2.1': '🌐', '2.2': '📡', '2.3': '🔌', '2.4': '🎸', '2.5': '⚡',
    '2.6': '🔐', '2.7': '🛡️',
    // Модуль 3
    '3.1': '⏱️', '3.2': '🧵', '3.3': '🔗', '3.4': '🌳', '3.5': '🕸️', '3.6': '🎯',
    // Модуль 4
    '4.1': '🗄️', '4.2': '🔍', '4.3': '📐', '4.4': '💎', '4.5': '🔄', '4.6': '🔴',
    // Модуль 5
    '5.1': '🧭', '5.2': '🍰', '5.3': '🏭', '5.4': '🎭', '5.5': '🧩', '5.6': '🏛️',
    // Модуль 6
    '6.1': '🐙', '6.2': '🐳', '6.3': '🐋', '6.4': '🚀', '6.5': '🐧', '6.6': '🐇',
  };

  function getThematicEmoji(title: string): string | null {
    const lower = title.toLowerCase();
    if (lower.includes('под капотом') || lower.includes('капот') || lower.includes('механик') || lower.includes('устройств')) return '⚙️';
    if (lower.includes('golden rule') || lower.includes('золотое правил')) return '👑';
    if (lower.includes('правил') || lower.includes('best practice') || lower.includes('практик')) return '📜';
    if (lower.includes('когда использовать merge') || lower.includes('когда merge')) return '🔀';
    if (lower.includes('когда использовать rebase') || lower.includes('когда rebase')) return '🚀';
    if (lower.includes('когда использовать') || lower.includes('когда применять') || lower.includes('выбор')) return '⚖️';
    if (lower.includes('шпаргалк') || lower.includes('команд') || lower.includes('чит-шит') || lower.includes('cheatsheet')) return '🛠️';
    if (lower.includes('таблиц') || lower.includes('сравнен') || lower.includes('vs')) return '📊';
    if (lower.includes('ветк') || lower.includes('branch')) return '🌿';
    if (lower.includes('коммит') || lower.includes('commit')) return '📝';
    if (lower.includes('merge') || lower.includes('слияни')) return '🔀';
    if (lower.includes('rebase') || lower.includes('перебазир')) return '🔄';
    if (lower.includes('конфликт') || lower.includes('conflict')) return '⚡';
    if (lower.includes('stash') || lower.includes('тайник')) return '📦';
    if (lower.includes('reset') || lower.includes('откат')) return '⏮️';
    if (lower.includes('checkout') || lower.includes('switch')) return '🎯';
    if (lower.includes('docker') && (lower.includes('продвинут') || lower.includes('compose'))) return '🐋';
    if (lower.includes('docker')) return '🐳';
    if (lower.includes('git')) return '🐙';
    if (lower.includes('ci') || lower.includes('cd')) return '🚀';
    if (lower.includes('linux') || lower.includes('unix') || lower.includes('bash')) return '🐧';
    if (lower.includes('очеред') || lower.includes('celery') || lower.includes('rabbitmq')) return '🐇';
    if (lower.includes('мониторинг') || lower.includes('prometheus') || lower.includes('grafana')) return '📈';
    if (lower.includes('тест') || lower.includes('pytest')) return '🧪';
    if (lower.includes('django')) return '🎸';
    if (lower.includes('fastapi') || lower.includes('asyncio')) return '⚡';
    if (lower.includes('postgres') || lower.includes('sql') || lower.includes('баз данных') || lower.includes('бд')) return '🗄️';
    if (lower.includes('redis')) return '🔴';
    if (lower.includes('сеть') || lower.includes('network') || lower.includes('tcp') || lower.includes('ip')) return '🌐';
    if (lower.includes('http') || lower.includes('rest') || lower.includes('api')) return '🔌';
    if (lower.includes('безопасн') || lower.includes('security')) return '🛡️';
    if (lower.includes('jwt') || lower.includes('auth') || lower.includes('парол') || lower.includes('авториз')) return '🔐';
    if (lower.includes('алгоритм') || lower.includes('структур')) return '🧩';
    if (lower.includes('архитектур')) return '🏛️';
    if (lower.includes('паттерн')) return '🎭';
    if (lower.includes('памят') || lower.includes('gc') || lower.includes('garbage')) return '🧠';
    if (lower.includes('типизац') || lower.includes('type')) return '🏷️';
    if (lower.includes('ооп') || lower.includes('класс')) return '📦';
    if (lower.includes('итератор') || lower.includes('генератор')) return '🔁';
    if (lower.includes('декоратор')) return '🎀';
    if (lower.includes('функци')) return '⚙️';
    if (lower.includes('python')) return '🐍';
    return null;
  }

  async function formatUnitHeaders(plugin: ReactRNPlugin, rootRem?: PluginRem) {
    const target = rootRem || (await plugin.focus.getFocusedRem());
    if (!target) {
      await plugin.app.toast('Откройте модуль или список юнитов и повторите команду');
      return;
    }

    let formattedCount = 0;
    const children = await target.getChildrenRem();

    for (const child of children) {
      const rawText = (await plugin.richText.toString(child.text || [])).trim();
      if (!rawText) continue;

      const unitMatch = rawText.match(/^(?:[^\w\sа-яА-ЯёЁ]*\s*)?(?:Юнит\s+(\d+\.\d+))\s*[·:-]?\s*(.*)$/i);
      if (unitMatch) {
        const unitNum = unitMatch[1];
        let unitTitle = unitMatch[2].trim();
        unitTitle = unitTitle.replace(/^[^\w\sа-яА-ЯёЁ]+\s*/, '').trim();

        const emoji = UNIT_EMOJIS[unitNum] || getThematicEmoji(unitTitle) || '📘';
        const formattedTitle = `${emoji} Юнит ${unitNum} · ${unitTitle}`;

        if (formattedTitle !== rawText) {
          await child.setText(await plugin.richText.text(formattedTitle).value());
          formattedCount++;
        }
      } else {
        const emoji = getThematicEmoji(rawText);
        if (emoji && !rawText.startsWith(emoji)) {
          const cleanText = rawText.replace(/^[^\w\sа-яА-ЯёЁ]+\s*/, '').trim();
          const formattedTitle = `${emoji} ${cleanText}`;
          await child.setText(await plugin.richText.text(formattedTitle).value());
          formattedCount++;
        }
      }
    }

    await plugin.app.toast(`🎨 Готово! Красиво оформлено заголовков юнитов: ${formattedCount}`);
  }

  // 7. Форматирование блоков кода (убрать bullet • и включить Code Rem)
  async function formatCodeBlocks(plugin: ReactRNPlugin, rootRem?: PluginRem) {
    const target = rootRem || (await plugin.focus.getFocusedRem());
    if (!target) {
      await plugin.app.toast('Откройте конспект и повторите команду');
      return;
    }

    let codeCount = 0;
    let revertedCount = 0;

    async function processRem(rem: PluginRem) {
      const text = (await plugin.richText.toString(rem.text || [])).trim();
      if (!text) {
        return;
      }

      // Подсчёт русских слов длиной >= 3 символа
      const russianWords = text.match(/[а-яА-ЯёЁ]{3,}/g) || [];
      const hasCyrillicProse = russianWords.length >= 3 && !text.startsWith('#') && !text.startsWith('//');

      // 1. Если Rem был ошибочно помечен кодом, но на самом деле это русский текст/пояснение:
      const isAlreadyCode = (await rem.hasPowerup(BuiltInPowerupCodes.Code)) || (await rem.isCode());
      if (isAlreadyCode && hasCyrillicProse && !text.includes('\n')) {
        try {
          await rem.setIsCode(false);
          await rem.removePowerup(BuiltInPowerupCodes.Code);
          revertedCount++;
        } catch (_) {}
      }

      // 2. Проверка, является ли текст кодом:
      const hasCodeMarker = text.startsWith('```');

      // Строка git-команды: только если это реальная команда CLI, а не русское предложение
      const isGitCommand = /^git\s+(checkout|switch|branch|status|commit|add|push|pull|rebase|merge|reset|log|diff|clone|remote|stash|tag|init)\b/i.test(text);

      const isCodeLine = (
        hasCodeMarker ||
        isGitCommand ||
        text.startsWith('def ') ||
        text.startsWith('class ') ||
        text.startsWith('import ') ||
        text.startsWith('from ') ||
        text.startsWith('async def ') ||
        text.startsWith('pip install') ||
        text.startsWith('docker run') ||
        text.startsWith('docker build') ||
        text.startsWith('docker-compose') ||
        text.startsWith('docker ') ||
        text.startsWith('$ ') ||
        text.startsWith('kubectl ') ||
        text.startsWith('python ') ||
        text.startsWith('npm ') ||
        text.includes('if __name__ ==')
      ) && !hasCyrillicProse && !text.includes('::') && !text.includes('?');

      if (hasCodeMarker || isCodeLine) {
        const isCodePowerup = await rem.hasPowerup(BuiltInPowerupCodes.Code);
        if (!isCodePowerup) {
          let cleanCode = text
            .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '')
            .replace(/\n?```$/, '')
            .trim();

          await rem.setText(await plugin.richText.text(cleanCode).value());
          await rem.setIsCode(true);
          await rem.addPowerup(BuiltInPowerupCodes.Code);
          codeCount++;
        }
      }

      const children = await rem.getChildrenRem();
      for (const ch of children) {
        await processRem(ch);
      }
    }

    try {
      await processRem(target);
      const msg = `💻 Готово! Оформлено блоков кода: ${codeCount}` + (revertedCount > 0 ? `, возвращено в текст: ${revertedCount}` : '');
      await plugin.app.toast(msg);
    } catch (e) {
      console.error('formatCodeBlocks failed:', e);
      await plugin.app.toast(`Ошибка при форматировании кода: ${String(e)}`);
    }
  }

  // 8. Оформление структуры конспекта (пустая строка + разделитель + пустая строка)
  async function formatNoteLayout(plugin: ReactRNPlugin, rootRem?: PluginRem) {
    const target = rootRem || (await plugin.focus.getFocusedRem());
    if (!target) {
      await plugin.app.toast('Откройте конспект и повторите команду');
      return;
    }

    try {
      const rawChildren = await target.getChildrenRem();
      if (rawChildren.length === 0) {
        await plugin.app.toast('В документе не найдено абзацев для разделения');
        return;
      }

      // Собираем информацию о текущих дочерних элементах
      type ChildInfo = {
        rem: PluginRem;
        isDivider: boolean;
        isEmpty: boolean;
        text: string;
      };

      const childrenInfo: ChildInfo[] = [];
      for (const ch of rawChildren) {
        const isDivider = await ch.hasPowerup(BuiltInPowerupCodes.Divider);
        const text = (await plugin.richText.toString(ch.text || [])).trim();
        childrenInfo.push({
          rem: ch,
          isDivider,
          isEmpty: !isDivider && text.length === 0,
          text,
        });
      }

      let addedDividers = 0;

      for (let i = 0; i < childrenInfo.length; i++) {
        const current = childrenInfo[i];

        // Пропускаем уже существующие разделители и пустые строки
        if (current.isDivider || current.isEmpty) {
          continue;
        }

        // Проверяем, есть ли уже разделитель непосредственно перед этим элементом
        let hasDividerBefore = false;
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
          if (childrenInfo[j].isDivider) {
            hasDividerBefore = true;
            break;
          }
          if (!childrenInfo[j].isEmpty) {
            break;
          }
        }

        if (hasDividerBefore) {
          continue;
        }

        // Вставляем аккуратный разделитель (Divider) перед элементом
        const pos = await current.rem.positionAmongstSiblings();
        const currentPos = typeof pos === 'number' ? pos : 0;

        const dividerRem = await plugin.rem.createRem();
        if (dividerRem) {
          await dividerRem.setText(await plugin.richText.text('').value());
          await dividerRem.addPowerup(BuiltInPowerupCodes.Divider);
          await dividerRem.setParent(target, currentPos);
          addedDividers++;
        }
      }

      await plugin.app.toast(`📑 Готово! Оформлено разделителей абзацев: ${addedDividers}`);
    } catch (e) {
      console.error('formatNoteLayout failed:', e);
      await plugin.app.toast(`Ошибка при оформлении абзацев: ${String(e)}`);
    }
  }

  // 9. Выпрямление и очистка иерархии конспекта (устранение лесенки вложенности и пустых буллетов)
  async function flattenAndCleanNoteHierarchy(plugin: ReactRNPlugin, rootRem?: PluginRem) {
    const target = rootRem || (await plugin.focus.getFocusedRem());
    if (!target) {
      await plugin.app.toast('Откройте конспект и повторите команду');
      return;
    }

    let unnestedCount = 0;

    // Рекурсивный проход для устранения мусорных обёрток и лишней вложенности
    async function normalizeTree(currentParent: PluginRem) {
      const children = await currentParent.getChildrenRem();
      if (!children || children.length === 0) return;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const rawText = (await plugin.richText.toString(child.text || [])).trim();
        const isDivider = await child.hasPowerup(BuiltInPowerupCodes.Divider);

        // 1. Проверяем, является ли узел мусорной обёрткой (например ".", "# .", "#", "•")
        const isDummyWrapper = !isDivider && (rawText === '.' || rawText === '# .' || rawText === '#' || rawText === '•');

        if (isDummyWrapper) {
          // Вытаскиваем всех детей мусорного узла на уровень currentParent
          const grandChildren = await child.getChildrenRem();
          for (const gc of grandChildren) {
            await gc.setParent(currentParent);
            unnestedCount++;
          }
          // Очищаем мусорный узел
          await child.setText(await plugin.richText.text('').value());
          try {
            await child.remove();
          } catch (_) {}
          continue;
        }

        // 2. Блок кода НЕ ДОЛЖЕН иметь дочерних узлов (вложенности)!
        // Все абзацы и подпункты, случайно затянутые внутрь кода, вытаскиваем наружу
        const isCode = (await child.hasPowerup(BuiltInPowerupCodes.Code)) || (await child.isCode()) || rawText.startsWith('```');
        if (isCode) {
          const codeChildren = await child.getChildrenRem();
          if (codeChildren.length > 0) {
            for (const cc of codeChildren) {
              await cc.setParent(currentParent);
              unnestedCount++;
            }
          }
        }

        // 3. Заголовки разделов (## или ###) должны быть на верхнем уровне (в корне документа target)
        if (rawText.startsWith('## ') || rawText.startsWith('### ')) {
          if (target && currentParent?._id !== target._id) {
            await child.setParent(target);
            unnestedCount++;
            const cleanTitle = rawText.replace(/^#{2,3}\s*/, '');
            await child.setText(await plugin.richText.text(cleanTitle).value());
            await child.setFontSize('H2');
          }
        }

        // Рекурсивная обработка вложенных узлов
        await normalizeTree(child);
      }
    }

    try {
      // 3 прохода для распутывания глубоких многоуровневых цепочек
      for (let pass = 0; pass < 3; pass++) {
        await normalizeTree(target);
      }
      await plugin.app.toast(`🧹 Иерархия выпрямлена! Перемещено узлов на правильный уровень: ${unnestedCount}`);
    } catch (e) {
      console.error('flattenAndCleanNoteHierarchy failed:', e);
      await plugin.app.toast(`Ошибка при выпрямлении иерархии: ${String(e)}`);
    }
  }

  // 10. Единая суперкоманда: "🪄 Причесать конспект" в один клик
  async function tidyUpNote(plugin: ReactRNPlugin, rootRem?: PluginRem) {
    const target = rootRem || (await plugin.focus.getFocusedRem());
    if (!target) {
      await plugin.app.toast('Откройте конспект и повторите команду');
      return;
    }

    try {
      await plugin.app.toast('🪄 Начинаем причесывать конспект...');

      // 1. Получаем все узлы конспекта на любой глубине (снимок дерева)
      const allRemList = await target.getDescendants();
      if (!allRemList || allRemList.length === 0) {
        await plugin.app.toast('Конспект пуст');
        return;
      }

      function isAsciiDiagramLine(text: string): boolean {
        if (!text) return false;
        if (/---|\/|\\|-->|==>|<-|<--/.test(text)) return true;
        if (/\((main|master|feature|origin|head|dev|staging|auth|bugfix)[^)]*\)/i.test(text)) return true;
        if (text.startsWith('|') || text.startsWith('+--') || text.startsWith('+==')) return true;
        if (text.includes('удаляются сборщиком мусора') || text.includes('garbage collect')) return true;
        return false;
      }

      function checkIsCode(text: string): boolean {
        if (text.startsWith('```')) return true;
        const russianWords = text.match(/[а-яА-ЯёЁ]{3,}/g) || [];
        if (russianWords.length >= 3 && !text.startsWith('#') && !text.startsWith('//')) {
          return false;
        }
        const isGit = /^git\s+(checkout|switch|branch|status|commit|add|push|pull|rebase|merge|reset|log|diff|clone|remote|stash|tag|init)\b/i.test(text);
        return (
          isGit ||
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
          text.startsWith('curl ') ||
          text.startsWith('uvicorn ') ||
          text.startsWith('alembic ') ||
          isAsciiDiagramLine(text)
        ) && !text.includes('::') && !text.includes('?');
      }

      // Структура для каждого элемента конспекта
      type ParsedItem = {
        rem: PluginRem;
        text: string;
        isDivider: boolean;
        isCard: boolean;
        isDeleted: boolean;
      };

      const items: ParsedItem[] = [];
      for (const rem of allRemList) {
        let text = '';
        try {
          text = (await plugin.richText.toString(rem.text || [])).trim();
        } catch (_) {}
        const isDivider = await rem.hasPowerup(BuiltInPowerupCodes.Divider);
        let hasCards = false;
        try {
          const cards = await rem.getCards();
          hasCards = Boolean(cards && cards.length > 0);
        } catch (_) {}

        const isCard =
          text.includes('📖 Перечитать') ||
          text.includes('Конспект перечитан') ||
          text.includes('::') ||
          text.includes('->') ||
          text.includes('→') ||
          hasCards;
        items.push({
          rem,
          text,
          isDivider,
          isCard,
          isDeleted: false,
        });
      }

      // Безопасное удаление с проверкой прав Delete
      let hasDeletePermission = true;

      async function safeDeleteRem(rem: PluginRem) {
        try {
          await rem.setText(await plugin.richText.text('').value());
        } catch (_) {}

        if (!hasDeletePermission) {
          return;
        }

        try {
          await rem.remove();
        } catch (err: any) {
          hasDeletePermission = false;
        }
      }

      // Предварительная очистка старых разделителей и пустых узлов
      for (const item of items) {
        if (item.isDivider) {
          item.isDeleted = true;
          await safeDeleteRem(item.rem);
          continue;
        }

        if (item.text.length === 0 && !item.isCard) {
          item.isDeleted = true;
          await safeDeleteRem(item.rem);
          continue;
        }

        if ((item.text === '.' || item.text === '# .' || item.text === '#' || item.text === '•') && !item.isCard) {
          item.isDeleted = true;
          await safeDeleteRem(item.rem);
          continue;
        }
      }

      let currentSection: PluginRem | null = null;
      let currentSubSection: PluginRem | null = null;
      let sectionsCount = 0;
      let codeCount = 0;
      let itemsCount = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.isDeleted) continue;

        const rawText = item.text;

        // 1. Карточка повторения (всегда на самом верху конспекта, позиция 0)
        if (item.isCard) {
          try {
            await item.rem.setParent(target, 0);
          } catch (_) {}
          continue;
        }

        // 2. Проверка на фиктивный заголовок-обертку (## . или ### .)
        const isDummyHeading = rawText === '## .' || rawText === '### .' || rawText === '##' || rawText === '###';
        if (isDummyHeading) {
          let foundTitle = '';
          for (let j = i + 1; j < items.length && j <= i + 3; j++) {
            if (!items[j].isDeleted && items[j].text.length > 0) {
              const candidate = items[j].text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').trim();
              const firstLine = candidate.split('\n')[0].trim();
              if (firstLine.length > 0 && firstLine.length < 50 && !firstLine.startsWith('#') && !isAsciiDiagramLine(firstLine)) {
                foundTitle = firstLine;
                const remainingLines = candidate.split('\n').slice(1).join('\n').trim();
                if (remainingLines.length > 0) {
                  items[j].text = remainingLines;
                } else {
                  items[j].isDeleted = true;
                  await safeDeleteRem(items[j].rem);
                }
              }
              break;
            }
          }

          if (foundTitle) {
            const emoji = getThematicEmoji(foundTitle) || '🔹';
            const cleanTitle = foundTitle.replace(/^[^\w\sа-яА-ЯёЁ]+\s*/, '').trim();
            const formattedTitle = `${emoji} ${cleanTitle}`;
            await item.rem.setText(await plugin.richText.text(formattedTitle).value());
            await item.rem.setFontSize('H3');
            await item.rem.setIsCode(false);
            await item.rem.removePowerup(BuiltInPowerupCodes.Code);
            await item.rem.setParent(currentSection || target);
            currentSubSection = item.rem;
            continue;
          } else {
            item.isDeleted = true;
            await safeDeleteRem(item.rem);
            continue;
          }
        }

        // 3. Распознавание подзаголовка темы (Git Merge, Git Rebase и т.д.)
        const isKnownSubHeading = /^```[a-zA-Z0-9_-]*\s*\n?(Git Merge|Git Rebase)$/i.test(rawText.trim()) ||
          rawText.trim() === 'Git Merge' ||
          rawText.trim() === 'Git Rebase';

        if (isKnownSubHeading) {
          const title = rawText.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').trim();
          const emoji = getThematicEmoji(title) || '🔹';
          const cleanTitle = title.replace(/^[^\w\sа-яА-ЯёЁ]+\s*/, '').trim();
          const formattedH3 = `${emoji} ${cleanTitle}`;
          await item.rem.setText(await plugin.richText.text(formattedH3).value());
          await item.rem.setFontSize('H3');
          await item.rem.setIsCode(false);
          await item.rem.removePowerup(BuiltInPowerupCodes.Code);
          await item.rem.setParent(currentSection || target);
          currentSubSection = item.rem;
          continue;
        }

        // 4. Основные разделы H2 (начинаются с ## или уже H2/H1)
        const isH2 = rawText.startsWith('## ') || ((await item.rem.getFontSize()) === 'H2' && !checkIsCode(rawText) && !rawText.startsWith('### '));
        if (isH2) {
          currentSubSection = null; // сбрасываем подраздел
          const cleanTitle = rawText.replace(/^#{2,3}\s*/, '').replace(/^[^\w\sа-яА-ЯёЁ]+\s*/, '').trim();
          const emoji = getThematicEmoji(cleanTitle) || '📌';
          const formattedH2 = `## ${emoji} ${cleanTitle}`;
          await item.rem.setText(await plugin.richText.text(formattedH2).value());
          await item.rem.setFontSize('H2');
          await item.rem.setIsCode(false);
          await item.rem.removePowerup(BuiltInPowerupCodes.Code);
          await item.rem.setParent(target);
          currentSection = item.rem;
          sectionsCount++;
          continue;
        }

        // 5. Подразделы H3 (начинаются с ### )
        const isH3 = rawText.startsWith('### ');
        if (isH3) {
          const cleanTitle = rawText.replace(/^#{2,3}\s*/, '').replace(/^[^\w\sа-яА-ЯёЁ]+\s*/, '').trim();
          const emoji = getThematicEmoji(cleanTitle) || '🔹';
          const formattedH3 = `${emoji} ${cleanTitle}`;
          await item.rem.setText(await plugin.richText.text(formattedH3).value());
          await item.rem.setFontSize('H3');
          await item.rem.setIsCode(false);
          await item.rem.removePowerup(BuiltInPowerupCodes.Code);
          await item.rem.setParent(currentSection || target);
          currentSubSection = item.rem;
          continue;
        }

        // 6. Склейка многострочных блоков кода и ASCII-диаграмм веток
        const startsWithCodeFence = rawText.startsWith('```');
        const isAsciiStart = isAsciiDiagramLine(rawText);

        if (startsWithCodeFence || isAsciiStart) {
          const hasClosingFence = startsWithCodeFence && rawText.slice(3).includes('```');

          if (!hasClosingFence) {
            const gatheredLines: string[] = [];
            const initialText = rawText.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').trim();
            if (initialText.length > 0) {
              gatheredLines.push(initialText);
            }

            for (let j = i + 1; j < items.length; j++) {
              if (items[j].isDeleted) continue;
              const nextText = items[j].text;

              if (nextText.startsWith('## ') || nextText.startsWith('### ')) {
                break;
              }

              if (nextText.endsWith('```')) {
                const content = nextText.replace(/\n?```$/, '').trim();
                if (content.length > 0) {
                  gatheredLines.push(content);
                }
                items[j].isDeleted = true;
                await safeDeleteRem(items[j].rem);
                break;
              }

              if (nextText.startsWith('```')) {
                break;
              }

              if (startsWithCodeFence || isAsciiDiagramLine(nextText) || nextText.startsWith('(')) {
                gatheredLines.push(nextText);
                items[j].isDeleted = true;
                await safeDeleteRem(items[j].rem);
              } else {
                break;
              }
            }

            if (gatheredLines.length > 0) {
              const fullCode = gatheredLines.join('\n');
              await item.rem.setText(await plugin.richText.text(fullCode).value());
              await item.rem.setIsCode(true);
              await item.rem.addPowerup(BuiltInPowerupCodes.Code);
              const desiredParent = currentSubSection || currentSection || target;
              await item.rem.setParent(desiredParent);
              codeCount++;
              continue;
            }
          } else {
            const cleanCode = rawText
              .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '')
              .replace(/\n?```$/, '')
              .trim();
            await item.rem.setText(await plugin.richText.text(cleanCode).value());
            await item.rem.setIsCode(true);
            await item.rem.addPowerup(BuiltInPowerupCodes.Code);
            const desiredParent = currentSubSection || currentSection || target;
            await item.rem.setParent(desiredParent);
            codeCount++;
            continue;
          }
        }

        // 7. Однострочные команды кода (git, python, docker и т.д.)
        if (checkIsCode(rawText)) {
          const cleanCode = rawText
            .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '')
            .replace(/\n?```$/, '')
            .trim();
          await item.rem.setText(await plugin.richText.text(cleanCode).value());
          await item.rem.setIsCode(true);
          await item.rem.addPowerup(BuiltInPowerupCodes.Code);
          const desiredParent = currentSubSection || currentSection || target;
          await item.rem.setParent(desiredParent);
          codeCount++;
          continue;
        }

        // 8. Обычный пояснительный текст
        if (rawText.length > 0) {
          const hasCodePowerup = await item.rem.hasPowerup(BuiltInPowerupCodes.Code);
          if (hasCodePowerup) {
            try {
              await item.rem.setIsCode(false);
              await item.rem.removePowerup(BuiltInPowerupCodes.Code);
            } catch (_) {}
          }
          const desiredParent = currentSubSection || currentSection || target;
          await item.rem.setParent(desiredParent);
          itemsCount++;
        }
      }

      // 9. Расставляем чистые разделители между разделами H2
      const topChildren = await target.getChildrenRem();
      for (let i = 0; i < topChildren.length; i++) {
        const topChild = topChildren[i];
        const isH2 = (await topChild.getFontSize()) === 'H2';
        if (isH2 && i > 0) {
          const prevChild = topChildren[i - 1];
          const prevIsDivider = prevChild ? await prevChild.hasPowerup(BuiltInPowerupCodes.Divider) : false;
          if (!prevIsDivider) {
            const pos = await topChild.positionAmongstSiblings();
            const currentPos = typeof pos === 'number' ? pos : 0;
            const dividerRem = await plugin.rem.createRem();
            if (dividerRem) {
              await dividerRem.setText(await plugin.richText.text('').value());
              await dividerRem.addPowerup(BuiltInPowerupCodes.Divider);
              await dividerRem.setParent(target, currentPos);
            }
          }
        }
      }

      await plugin.app.toast(
        `✨ Конспект причесан в 1 клик! Разделов: ${sectionsCount}, кода: ${codeCount}, пунктов: ${itemsCount}`
      );

      if (!hasDeletePermission) {
        await plugin.app.toast(
          'ℹ️ Для полного удаления пустых буллетов обновите плагин в Settings -> Plugins (кнопка Reload) и подтвердите право Delete.'
        );
      }
    } catch (e) {
      console.error('tidyUpNote failed:', e);
      await plugin.app.toast(`Ошибка при оформлении конспекта: ${String(e)}`);
    }
  }

  // Регистрация команд палитры (Ctrl+K)
  await plugin.app.registerCommand({
    id: 'tidy-up-note',
    name: '🪄 Причесать конспект (выпрямить и оформить всё в 1 клик)',
    action: async () => {
      await tidyUpNote(plugin);
    },
  });

  await plugin.app.registerCommand({
    id: 'format-unit-headers',
    name: '🎨 Оформить заголовки юнитов и добавить эмодзи',
    action: async () => {
      await formatUnitHeaders(plugin);
    },
  });

  await plugin.app.registerCommand({
    id: 'flatten-note-hierarchy',
    name: '🧹 Выпрямить иерархию конспекта (убрать лесенку вложенности и пустые буллеты)',
    action: async () => {
      await flattenAndCleanNoteHierarchy(plugin);
    },
  });

  await plugin.app.registerCommand({
    id: 'format-code-blocks',
    name: '💻 Превратить код в блоки кода (убрать bullet •)',
    action: async () => {
      await formatCodeBlocks(plugin);
    },
  });

  await plugin.app.registerCommand({
    id: 'format-note-layout',
    name: '📑 Оформить абзацы конспекта (пустая строка + разделитель)',
    action: async () => {
      await formatNoteLayout(plugin);
    },
  });

  await plugin.app.registerCommand({
    id: 'format-full-note',
    name: '✨ Полное оформление конспекта (выпрямление лесенки + разделители + код без bullet)',
    action: async () => {
      await tidyUpNote(plugin);
    },
  });

  // Регистрация команд в меню документа (...)
  try {
    await plugin.app.registerMenuItem({
      id: 'menu-tidy-up-note',
      name: '🪄 Причесать конспект (в 1 клик)',
      location: PluginCommandMenuLocation.DocumentMenu,
      action: async (args: any) => {
        const remId = args?.remId;
        const rem = remId ? await plugin.rem.findOne(remId) : await plugin.focus.getFocusedRem();
        if (rem) await tidyUpNote(plugin, rem);
      },
    });

    await plugin.app.registerMenuItem({
      id: 'menu-format-unit-headers',
      name: '🎨 Оформить заголовки юнитов (эмодзи)',
      location: PluginCommandMenuLocation.DocumentMenu,
      action: async (args: any) => {
        const remId = args?.remId;
        const rem = remId ? await plugin.rem.findOne(remId) : await plugin.focus.getFocusedRem();
        if (rem) await formatUnitHeaders(plugin, rem);
      },
    });

    await plugin.app.registerMenuItem({
      id: 'menu-flatten-note',
      name: '🧹 Выпрямить иерархию (убрать лесенку вложенности)',
      location: PluginCommandMenuLocation.DocumentMenu,
      action: async (args: any) => {
        const remId = args?.remId;
        const rem = remId ? await plugin.rem.findOne(remId) : await plugin.focus.getFocusedRem();
        if (rem) await flattenAndCleanNoteHierarchy(plugin, rem);
      },
    });

    await plugin.app.registerMenuItem({
      id: 'menu-format-full-note',
      name: '✨ Оформить конспект (выпрямление + разделители + код)',
      location: PluginCommandMenuLocation.DocumentMenu,
      action: async (args: any) => {
        const remId = args?.remId;
        const rem = remId ? await plugin.rem.findOne(remId) : await plugin.focus.getFocusedRem();
        if (rem) await tidyUpNote(plugin, rem);
      },
    });
  } catch (_) {}
}

async function onDeactivate(_plugin: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
