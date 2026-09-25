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

    const nextDate = Date.now() + days * DAY_MS;

    // Авто-разблокировка карточек конспекта в FSRS после 1-го прочтения
    try {
      if (args.remId) {
        const cardRem = await plugin.rem.findOne(args.remId);
        if (cardRem) {
          let parentDoc: PluginRem | undefined = cardRem;
          while (parentDoc && !(await parentDoc.isDocument())) {
            parentDoc = (await parentDoc.getParentRem()) as PluginRem | undefined;
          }

          if (parentDoc) {
            // Обновляем состояние планировщика конспекта
            const newState = {
              stage: Math.min(repsSoFar + 1, 6),
              nextReviewDate: nextDate,
              lastReviewDate: Date.now(),
            };
            await plugin.storage.setSynced(`note_sched_${parentDoc._id}`, newState);

            // Если это 1-е ревью (или более) — разблокируем все детальные карточки конспекта для FSRS!
            if (repsSoFar >= 1) {
              if (await parentDoc.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
                await parentDoc.removePowerup(BuiltInPowerupCodes.DisableCards);
              }
              const descendants = (await parentDoc.getDescendants()) || [];
              for (const child of descendants) {
                if (child._id !== cardRem._id && (await child.hasPowerup(BuiltInPowerupCodes.DisableCards))) {
                  await child.removePowerup(BuiltInPowerupCodes.DisableCards);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Error auto-unlocking cards in SRSScheduleCard:', e);
    }

    return { nextDate };
  });
}

// Вспомогательная функция: активировать повторение для конспекта
async function activateNoteRepetition(plugin: ReactRNPlugin, rem: PluginRem) {
  // 1. Снимаем статус отключения карточек с документа
  if (await rem.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
    await rem.removePowerup(BuiltInPowerupCodes.DisableCards);
  }

  // 2. Снимаем паузу со всех дочерних карточек
  const descendants = (await rem.getDescendants()) || [];
  for (const child of descendants) {
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
  const descendants = (await rem.getDescendants()) || [];
  for (const child of descendants) {
    await child.addPowerup(BuiltInPowerupCodes.DisableCards);
  }
  const title = (await plugin.richText.toString(rem.text || [])).slice(0, 50);
  await plugin.app.toast(`⏸️ Конспект «${title}» и все его карточки приостановлены и исключены из очередей.`);
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

  // 10. Форматирование одного конспекта
  async function tidyUpSingleNote(plugin: ReactRNPlugin, target: PluginRem): Promise<{ headingsCount: number; codeBlocksCount: number }> {
    const allRemList = await target.getDescendants();
    if (!allRemList || allRemList.length === 0) {
      return { headingsCount: 0, codeBlocksCount: 0 };
    }

    const docTitle = (await plugin.richText.toString(target.text || [])).trim();
    const expectedCardFront = `📖 Перечитать конспект ${docTitle}`;
    const expectedCardBack = `Конспект перечитан и усвоен. Оцените, насколько хорошо помните материал.`;
    const expectedCardFullText = `${expectedCardFront}→${expectedCardBack}`;

    function cleanHeadingTitle(raw: string): string {
      let s = raw.trim();
      s = s.replace(/^[#\s]+/, '');
      while (s.startsWith('##') || s.startsWith('#')) {
        s = s.replace(/^[#\s]+/, '');
      }
      // Удаляем любые эмодзи в начале заголовка (строгий академический стиль)
      s = s.replace(/^[\p{Emoji}\u200d\ufe0f\s]+/u, '');
      s = s.replace(/^[^\w\sа-яА-ЯёЁa-zA-Z0-9]+\s*/, '');
      return s.trim();
    }

    function isAsciiDiagram(text: string): boolean {
      if (!text) return false;
      if (/---|\/|\\|-->|==>|<-|<--/.test(text)) return true;
      if (/\((main|master|feature|origin|head|dev|staging|auth|bugfix)[^)]*\)/i.test(text)) return true;
      if (text.startsWith('|') || text.startsWith('+--') || text.startsWith('+==')) return true;
      if (text.includes('удаляются сборщиком мусора') || text.includes('garbage collect')) return true;
      return false;
    }

    function checkIsHeading(rawText: string, cleanTitle: string, fontSize: 'H1' | 'H2' | 'H3' | undefined, isCard: boolean): boolean {
      if (isCard) return false;
      if (!cleanTitle || cleanTitle.length < 3) return false;
      // Настоящие заголовки разделов в конспектах компактны (не длиннее 65 символов)
      if (cleanTitle.length > 65) return false;

      // Заголовки разделов в русском языке никогда не заканчиваются точкой
      if (cleanTitle.endsWith('.')) return false;

      // Заголовок не должен содержать несколько предложений (например: "Текст. Еще текст.")
      if (/[.!?]\s+[А-ЯA-Z]/.test(cleanTitle)) return false;

      // Количество слов в заголовке раздела обычно не более 8
      const words = cleanTitle.split(/\s+/).filter(w => w.length > 0);
      if (words.length > 8) return false;

      // Проверяем: начинается ли с # или имел реальный H2
      const startsWithHash = /^#{1,3}\s+/.test(rawText) || rawText.startsWith('##') || rawText.startsWith('###');
      if (startsWithHash) {
        return true;
      }

      if (fontSize === 'H2') {
        return true;
      }

      return false;
    }

    function cleanProseText(text: string): string {
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

      // 3. Отдельные флаги CLI: --abort, --continue, --skip, --hard, --soft, --mixed, --oneline, --graph, -b, -m, -d, -D
      s = s.replace(/(?<![`\w])(--(?:abort|continue|skip|hard|soft|mixed|oneline|graph|amend|no-ff|squash|all))(?![`\w])/g, '`$1`');

      // 4. Системные пути и refs: .git/HEAD, .git/refs/heads/, refs/heads/, .gitignore
      s = s.replace(/(?<![`\w])(\.git(?:\/[a-zA-Z0-9_.-]+)*)(?![`\w])/g, '`$1`');
      s = s.replace(/(?<![`\w])(refs\/heads(?:\/[a-zA-Z0-9_.-]+)*)(?![`\w])/g, '`$1`');

      // 5. Типографика тире: дефисы между словами заменяем на длинное тире
      s = s.replace(/\s+[-–]\s+/g, ' — ');

      // 6. Устраняем случайные дубликаты обратных кавычек
      s = s.replace(/`{2,}/g, '`');

      return s.trim();
    }

    function isShortCommandSnippet(text: string): boolean {
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

    function formatShortCommandAsProse(raw: string): string {
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

    function isCodeSnippet(text: string): boolean {
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

    type RemEntry = {
      rem: PluginRem;
      text: string;
      isCode: boolean;
      isCard: boolean;
      isHeading: boolean;
      cleanTitle: string;
      isDot: boolean;
      isCodeCandidate: boolean;
      isProseInCode: boolean;
    };

    const entries: RemEntry[] = [];
    for (const rem of allRemList) {
      let text = '';
      try {
        text = (await plugin.richText.toString(rem.text || [])).trim();
      } catch (_) {}
      const isCode = (await rem.hasPowerup(BuiltInPowerupCodes.Code)) || (await rem.isCode());
      const isCard = text.includes('📖 Перечитать') || text.includes('Конспект перечитан');
      const russianWords = text.match(/[а-яА-ЯёЁ]{3,}/g) || [];
      const cleanTitle = cleanHeadingTitle(text);
      const fontSize = await rem.getFontSize();

      const isHeading = checkIsHeading(text, cleanTitle, fontSize, isCard) && !isCodeSnippet(text);
      const isDot = text === '.' || text === '# .' || text === '•';
      const isProseInCode = (isCode || text.startsWith('```')) && russianWords.length >= 4;
      const isCodeCandidate = !isHeading && !isCard && !isDot && (isCode || isCodeSnippet(text)) && !isProseInCode;

      entries.push({
        rem,
        text,
        isCode,
        isCard,
        isHeading,
        cleanTitle,
        isDot,
        isCodeCandidate,
        isProseInCode,
      });
    }

    type PlanAction =
      | { type: 'card'; rem: PluginRem; text: string }
      | { type: 'create_card'; text: string }
      | { type: 'spacer' }
      | { type: 'heading'; rem: PluginRem; title: string }
      | { type: 'prose'; rem: PluginRem; text: string }
      | { type: 'code_block'; rem: PluginRem; code: string };

    const plan: PlanAction[] = [];

    // 1. Карточка в начале конспекта
    const cardEntry = entries.find(e => e.isCard);
    if (cardEntry) {
      plan.push({ type: 'card', rem: cardEntry.rem, text: expectedCardFullText });
    } else {
      plan.push({ type: 'create_card', text: expectedCardFullText });
    }
    // Ровно 3 пустые строки после карточки
    plan.push({ type: 'spacer' });
    plan.push({ type: 'spacer' });
    plan.push({ type: 'spacer' });

    // 2. Обходим остальные элементы с дедупликацией
    let isFirstSection = true;
    const seenHeadings = new Set<string>();
    const seenProse = new Set<string>();
    const seenCode = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.isCard) continue;

      if (entry.isHeading) {
        if (seenHeadings.has(entry.cleanTitle)) {
          continue;
        }
        seenHeadings.add(entry.cleanTitle);

        // Перед каждым разделом (начиная со второго) ровно 2 пустые строки
        if (!isFirstSection) {
          plan.push({ type: 'spacer' });
          plan.push({ type: 'spacer' });
        }
        plan.push({ type: 'heading', rem: entry.rem, title: entry.cleanTitle });
        isFirstSection = false;
        continue;
      }

      if (entry.isProseInCode) {
        const prose = cleanProseText(entry.text);
        if (prose.length > 0 && !seenProse.has(prose)) {
          seenProse.add(prose);
          plan.push({ type: 'prose', rem: entry.rem, text: prose });
        }
        continue;
      }

      if (entry.isCodeCandidate) {
        const cleanCode = entry.text
          .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '')
          .replace(/\n?```$/, '')
          .trim();

        if (isShortCommandSnippet(cleanCode)) {
          // Короткие команды (1-2 строки) -> инлайн-код в обычном тексте
          const prose = formatShortCommandAsProse(cleanCode);
          if (prose.length > 0 && !seenProse.has(prose)) {
            seenProse.add(prose);
            plan.push({ type: 'prose', rem: entry.rem, text: prose });
          }
        } else {
          // Многострочный код или ASCII-диаграмма -> полноценный блок кода
          if (cleanCode.length > 0 && !seenCode.has(cleanCode)) {
            seenCode.add(cleanCode);
            plan.push({ type: 'code_block', rem: entry.rem, code: cleanCode });
          }
        }
        continue;
      }

      if (!entry.isDot && entry.text.length > 0) {
        const prose = cleanProseText(entry.text);
        if (prose.length > 0 && !seenProse.has(prose)) {
          seenProse.add(prose);
          plan.push({ type: 'prose', rem: entry.rem, text: prose });
        }
      }
    }

    // 3. Пул свободных узлов
    const usedRemIds = new Set<string>();
    for (const p of plan) {
      if ('rem' in p && p.rem) {
        usedRemIds.add(p.rem._id);
      }
    }
    const remPool = entries.filter(e => !usedRemIds.has(e.rem._id)).map(e => e.rem);
    let poolIdx = 0;

    async function getSpareRem(): Promise<PluginRem | undefined> {
      if (poolIdx < remPool.length) {
        return remPool[poolIdx++];
      }
      return await plugin.rem.createRem();
    }

    // 4. Применяем план
    let currentPos = 0;
    let headingsCount = 0;
    let codeBlocksCount = 0;

    for (const action of plan) {
      if (action.type === 'card') {
        await action.rem.setText(await plugin.richText.text(action.text).value());
        await action.rem.setIsCode(false);
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Code); } catch (_) {}
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Divider); } catch (_) {}
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Header); } catch (_) {}
        await action.rem.setFontSize(undefined);
        await action.rem.setParent(target, currentPos++);
      } else if (action.type === 'create_card') {
        const cardRem = (await getSpareRem()) || (await plugin.rem.createRem());
        if (cardRem) {
          await cardRem.setText(await plugin.richText.text(action.text).value());
          await cardRem.setIsCode(false);
          try { await cardRem.removePowerup(BuiltInPowerupCodes.Code); } catch (_) {}
          try { await cardRem.removePowerup(BuiltInPowerupCodes.Divider); } catch (_) {}
          try { await cardRem.removePowerup(BuiltInPowerupCodes.Header); } catch (_) {}
          await cardRem.setFontSize(undefined);
          await cardRem.setParent(target, currentPos++);
        }
      } else if (action.type === 'spacer') {
        const spacer = await getSpareRem();
        if (spacer) {
          await spacer.setText(await plugin.richText.text('').value());
          await spacer.setIsCode(false);
          try { await spacer.removePowerup(BuiltInPowerupCodes.Code); } catch (_) {}
          try { await spacer.removePowerup(BuiltInPowerupCodes.Divider); } catch (_) {}
          try { await spacer.removePowerup(BuiltInPowerupCodes.Header); } catch (_) {}
          await spacer.setFontSize(undefined);
          await spacer.setParent(target, currentPos++);
        }
      } else if (action.type === 'heading') {
        await action.rem.setText(await plugin.richText.text(`## ${action.title}`).value());
        await action.rem.setFontSize('H2');
        await action.rem.setIsCode(false);
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Code); } catch (_) {}
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Divider); } catch (_) {}
        await action.rem.setParent(target, currentPos++);
        headingsCount++;
      } else if (action.type === 'prose') {
        await action.rem.setText(await plugin.richText.text(action.text).value());
        await action.rem.setIsCode(false);
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Code); } catch (_) {}
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Divider); } catch (_) {}
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Header); } catch (_) {}
        await action.rem.setFontSize(undefined);
        await action.rem.setParent(target, currentPos++);
      } else if (action.type === 'code_block') {
        // Нативный блок кода прямо на верхнем уровне, без обёртки точкой
        await action.rem.setText(await plugin.richText.text(action.code).value());
        await action.rem.setIsCode(true);
        await action.rem.addPowerup(BuiltInPowerupCodes.Code);
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Divider); } catch (_) {}
        try { await action.rem.removePowerup(BuiltInPowerupCodes.Header); } catch (_) {}
        await action.rem.setFontSize(undefined);
        await action.rem.setParent(target, currentPos++);
        codeBlocksCount++;
      }
    }

    // 5. Очищаем лишние узлы
    while (poolIdx < remPool.length) {
      const leftover = remPool[poolIdx++];
      try {
        await leftover.setText(await plugin.richText.text('').value());
        await leftover.setIsCode(false);
        await leftover.setFontSize(undefined);
        try { await leftover.removePowerup(BuiltInPowerupCodes.Code); } catch (_) {}
        try { await leftover.removePowerup(BuiltInPowerupCodes.Divider); } catch (_) {}
        try { await leftover.removePowerup(BuiltInPowerupCodes.Header); } catch (_) {}
        try { await leftover.remove(); } catch (_) {}
      } catch (_) {}
    }

    // 6. Управление спящими карточками для FSRS:
    try {
      const schedState = (await plugin.storage.getSynced<any>(`note_sched_${target._id}`)) || { stage: 0 };
      if ((schedState.stage || 0) === 0) {
        if (await target.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
          await target.removePowerup(BuiltInPowerupCodes.DisableCards);
        }
        for (const entry of entries) {
          if (!entry.isCard) {
            let isCard = false;
            try {
              const cards = await entry.rem.getCards();
              isCard = (cards && cards.length > 0) || false;
            } catch (_) {}
            if (!isCard) {
              isCard = entry.text.includes('::') || entry.text.includes('==');
            }
            if (isCard) {
              await entry.rem.addPowerup(BuiltInPowerupCodes.DisableCards);
            }
          }
        }
      }
    } catch (_) {}

    return { headingsCount, codeBlocksCount };
  }

  // 11. Единая суперкоманда: "🪄 Причесать конспект" (с поддержкой пакетной обработки папок)
  async function tidyUpNote(plugin: ReactRNPlugin, rootRem?: PluginRem) {
    const target = rootRem || (await plugin.focus.getFocusedRem());
    if (!target) {
      await plugin.app.toast('Откройте конспект или выберите папку и повторите команду');
      return;
    }

    try {
      // Рекурсивный поиск листовых конспектов
      async function collectNoteDocuments(root: PluginRem): Promise<PluginRem[]> {
        const children = (await root.getChildrenRem()) || [];
        const childDocs: PluginRem[] = [];
        for (const ch of children) {
          if (await ch.isDocument()) {
            childDocs.push(ch);
          }
        }

        if (childDocs.length > 0) {
          const result: PluginRem[] = [];
          for (const doc of childDocs) {
            const subNotes = await collectNoteDocuments(doc);
            result.push(...subNotes);
          }
          return result;
        } else {
          return [root];
        }
      }

      // Проверка, является ли документ конспектом
      async function isEligibleNote(doc: PluginRem): Promise<boolean> {
        const parent = await doc.getParentRem();
        if (parent) {
          const parentTitle = (await plugin.richText.toString(parent.text || [])).toLowerCase();
          if (parentTitle.includes('конспект')) return true;
        }
        const title = (await plugin.richText.toString(doc.text || [])).trim();
        if (/^\d{2}\./.test(title)) return true;

        const descendants = (await doc.getDescendants()) || [];
        for (const d of descendants) {
          const t = (await plugin.richText.toString(d.text || [])).trim();
          if (t.includes('📖 Перечитать') || t.includes('Конспект перечитан')) {
            return true;
          }
        }
        return false;
      }

      const allLeafDocs = await collectNoteDocuments(target);

      // Если найдено больше одного документа, фильтруем по признаку конспекта
      let notesToProcess: PluginRem[] = allLeafDocs;
      if (allLeafDocs.length > 1) {
        const filtered: PluginRem[] = [];
        for (const d of allLeafDocs) {
          if (await isEligibleNote(d)) {
            filtered.push(d);
          }
        }
        if (filtered.length > 0) {
          notesToProcess = filtered;
        }
      }

      if (notesToProcess.length === 0) {
        await plugin.app.toast('Конспекты для обработки не найдены');
        return;
      }

      if (notesToProcess.length === 1) {
        const singleNote = notesToProcess[0];
        const title = (await plugin.richText.toString(singleNote.text || [])).slice(0, 40);
        await plugin.app.toast(`🪄 Причесываем конспект «${title}»...`);
        const res = await tidyUpSingleNote(plugin, singleNote);
        await plugin.app.toast(
          `✨ Конспект идеально оформлен! Разделов: ${res.headingsCount}, блоков кода: ${res.codeBlocksCount}`
        );
      } else {
        await plugin.app.toast(
          `🪄 Найдено конспектов для пакетной обработки: ${notesToProcess.length}. Начинаем...`
        );
        let successCount = 0;
        for (let i = 0; i < notesToProcess.length; i++) {
          const note = notesToProcess[i];
          const title = (await plugin.richText.toString(note.text || [])).slice(0, 30);
          await plugin.app.toast(`🪄 [${i + 1}/${notesToProcess.length}] «${title}»...`);
          try {
            await tidyUpSingleNote(plugin, note);
            successCount++;
          } catch (err) {
            console.error(`Ошибка при причесывании конспекта ${title}:`, err);
          }
        }
        await plugin.app.toast(
          `✨ Пакетная обработка завершена! Успешно причёсано: ${successCount} из ${notesToProcess.length} конспектов`
        );
      }
    } catch (e) {
      console.error('tidyUpNote failed:', e);
      await plugin.app.toast(`Ошибка при оформлении: ${String(e)}`);
    }
  }

  // Регистрация команд палитры (Ctrl+K)
  await plugin.app.registerCommand({
    id: 'tidy-up-note',
    name: '🪄 Причесать конспект(ы) (пакетно для папки или в 1 клик для документа)',
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
    name: '✨ Полное оформление конспекта (пакетно для папки или в 1 клик)',
    action: async () => {
      await tidyUpNote(plugin);
    },
  });

  // Регистрация команд в меню документа (...)
  try {
    await plugin.app.registerMenuItem({
      id: 'menu-tidy-up-note',
      name: '🪄 Причесать конспект(ы) (пакетно / в 1 клик)',
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
