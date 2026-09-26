import {
  usePlugin,
  renderWidget,
  useTrackerPlugin,
  BuiltInPowerupCodes,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import React, { useState } from 'react';
import noteCardsManifestRaw from './note_cards_manifest.json';

const FIXED_STEPS_DAYS = [1, 3, 7, 21, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

interface NoteScheduleState {
  stage: number; // 0 = не изучен, 1 = 1 день, 2 = 3 дня, 3 = 7 дней, 4 = 21 день, 5 = 30 дней, 6 = освоен
  nextReviewDate?: number;
  lastReviewDate?: number;
  cardThemeId?: string | null;
  cardThemeTitle?: string | null;
}

export const NoteSchedulerBar = () => {
  const plugin = usePlugin();
  const [loading, setLoading] = useState(false);

  const data = useTrackerPlugin(async (rp) => {
    try {
      // 1. Надёжное определение открытого документа
      let rem: any = undefined;

      // Способ 1: Контекст виджета
      try {
        const widgetCtx = await rp.widget.getWidgetContext<any>();
        const docId = widgetCtx?.documentId || widgetCtx?.remId;
        if (docId) {
          const r = await rp.rem.findOne(docId);
          if (r && (await r.isDocument())) {
            rem = r;
          }
        }
      } catch (_) {}

      // Способ 2: Открытая панель (Window API)
      if (!rem) {
        try {
          const focusedPaneId = await rp.window.getFocusedPaneId();
          if (focusedPaneId) {
            const paneRemId = await rp.window.getOpenPaneRemId(focusedPaneId);
            if (paneRemId) {
              const r = await rp.rem.findOne(paneRemId);
              if (r && (await r.isDocument())) {
                rem = r;
              }
            }
          }
        } catch (_) {}
      }

      // Способ 3: Список открытых панелей
      if (!rem) {
        try {
          const openRemIds = await rp.window.getOpenPaneRemIds();
          if (openRemIds && openRemIds.length > 0) {
            for (const id of openRemIds) {
              const r = await rp.rem.findOne(id);
              if (r && (await r.isDocument())) {
                rem = r;
                break;
              }
            }
          }
        } catch (_) {}
      }

      // Способ 4: Фокус, поднимаясь к родительскому документу
      if (!rem) {
        try {
          let focused = await rp.focus.getFocusedRem();
          while (focused) {
            if (await focused.isDocument()) {
              rem = focused;
              break;
            }
            focused = await focused.getParentRem();
          }
        } catch (_) {}
      }

      if (!rem) return null;
      const isDoc = await rem.isDocument();
      if (!isDoc) return null;

      // Строгая фильтрация: плашка отображается ТОЛЬКО если внутри есть карточка перечитывания конспекта
      const children = (await rem.getChildrenRem()) || [];
      let isNote = false;
      for (const ch of children) {
        const text = (await rp.richText.toString(ch.text || [])).toLowerCase();
        if (text.includes('перечитать') || text.includes('прочитан') || text.includes('перечитан')) {
          isNote = true;
          break;
        }
      }

      if (!isNote) {
        const descendants = (await rem.getDescendants()) || [];
        for (const ch of descendants.slice(0, 40)) {
          const text = (await rp.richText.toString(ch.text || [])).toLowerCase();
          if (text.includes('перечитать') || text.includes('прочитан') || text.includes('перечитан')) {
            isNote = true;
            break;
          }
        }
      }

      if (!isNote) {
        return null;
      }

      const isPaused = await rem.hasPowerup(BuiltInPowerupCodes.DisableCards);
      const title = await rp.richText.toString(rem.text || []);
      const schedState = (await rp.storage.getSynced<NoteScheduleState>(`note_sched_${rem._id}`)) || {
        stage: 0,
      };

      // Поиск темы в манифесте по ID конспекта
      let manifestEntry = (noteCardsManifestRaw as any)[rem._id];

      // Fallback: поиск темы по совпадению названия конспекта, если ID не совпал
      if (!manifestEntry && title) {
        const cleanTitle = title.toLowerCase().replace(/^\d+[\.\s]+/, '').trim();
        for (const entry of Object.values(noteCardsManifestRaw as Record<string, any>)) {
          const entryClean = (entry.noteTitle || '').toLowerCase().replace(/^\d+[\.\s]+/, '').trim();
          if (cleanTitle && (entryClean.includes(cleanTitle) || cleanTitle.includes(entryClean))) {
            manifestEntry = entry;
            break;
          }
        }
      }

      const cardThemeId = manifestEntry?.cardThemeId || schedState.cardThemeId || null;
      const cardThemeTitle = manifestEntry?.cardThemeTitle || schedState.cardThemeTitle || null;
      const reviewCardId = manifestEntry?.reviewCardId || null;

      return { rem, isDoc, isPaused, title, schedState, cardThemeId, cardThemeTitle, reviewCardId };
    } catch (_) {
      return null;
    }
  });

  if (!data || !data.rem) {
    return null;
  }

  const { rem, isPaused, schedState, cardThemeId, cardThemeTitle, reviewCardId } = data;
  const stage = schedState.stage || 0;

  // Форматирование даты
  const formatNextDate = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const today = new Date();
    const isTomorrow =
      date.getDate() === today.getDate() + 1 &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
    const isToday =
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();

    if (isToday) return 'сегодня';
    if (isTomorrow) return 'завтра';

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
  };

  // Включение карточек и старт повторений конспекта
  const handleStartReview = async () => {
    setLoading(true);
    try {
      // 1. Включаем карточки в конспекте для FSRS
      if (await rem.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
        await rem.removePowerup(BuiltInPowerupCodes.DisableCards);
      }
      await rem.setEnablePractice(true);
      const descendants = (await rem.getDescendants()) || [];
      for (const ch of descendants) {
        if (await ch.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
          await ch.removePowerup(BuiltInPowerupCodes.DisableCards);
        }
        await ch.setEnablePractice(true);
      }

      // 2. Ставим конспект на 1-й шаг (повторение через 1 день)
      const nextDate = Date.now() + FIXED_STEPS_DAYS[0] * DAY_MS;
      const newState: NoteScheduleState = {
        stage: 1,
        nextReviewDate: nextDate,
        lastReviewDate: Date.now(),
      };
      await plugin.storage.setSynced(`note_sched_${rem._id}`, newState);

      // 3. Ищем и активируем парную тему в соседней папке "Карточки" этого же Юнита
      let detailCount = 0;
      let matchedTheme = '';
      try {
        const noteTitle = await plugin.richText.toString(rem.text || []);
        const cleanWords = noteTitle
          .toLowerCase()
          .replace(/^\d+[\.\s]+/, '')
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .split(/\s+/)
          .filter(w => w.length > 2 && !['для', 'как', 'что', 'это', 'или', 'при', 'все', 'другие', 'методы', 'python'].includes(w));

        const parentRem = await rem.getParentRem();
        if (parentRem) {
          const grandParent = await parentRem.getParentRem();
          if (grandParent) {
            const siblingFolders = (await grandParent.getChildrenRem()) || [];
            let cardsRootFolder: any;
            for (const f of siblingFolders) {
              const fTitle = (await plugin.richText.toString(f.text || [])).toLowerCase();
              if (fTitle.includes('карточки') || fTitle.includes('cards')) {
                cardsRootFolder = f;
                break;
              }
            }

            if (cardsRootFolder) {
              const themeFolders = (await cardsRootFolder.getChildrenRem()) || [];
              let bestTheme: any;
              let bestScore = 0;

              for (const theme of themeFolders) {
                const themeTitle = (await plugin.richText.toString(theme.text || [])).toLowerCase();
                const tWords = themeTitle
                  .replace(/[^\p{L}\p{N}]+/gu, ' ')
                  .split(/\s+/)
                  .filter(w => w.length > 2);

                let score = 0;
                for (const cw of cleanWords) {
                  if (tWords.includes(cw) || themeTitle.includes(cw)) {
                    score++;
                  }
                }

                if (score > bestScore) {
                  bestScore = score;
                  bestTheme = theme;
                }
              }

              if (bestTheme && bestScore > 0) {
                matchedTheme = await plugin.richText.toString(bestTheme.text || []);
                if (await bestTheme.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
                  await bestTheme.removePowerup(BuiltInPowerupCodes.DisableCards);
                }
                await bestTheme.setEnablePractice(true);

                const themeDescendants = (await bestTheme.getDescendants()) || [];
                for (const td of themeDescendants) {
                  if (await td.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
                    await td.removePowerup(BuiltInPowerupCodes.DisableCards);
                  }
                  await td.setEnablePractice(true);
                  detailCount++;
                }
              }
            }
          }
        }
      } catch (_) {}

      let toastMsg = `🎯 Конспект изучен! Повтор конспекта: завтра`;
      if (detailCount > 0) {
        toastMsg += ` + ${detailCount} проверочных карточек темы «${matchedTheme}» активированы!`;
      }
      await plugin.app.toast(toastMsg);
    } catch (e) {
      await plugin.app.toast(`Ошибка: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Переход на следующий шаг повторения конспекта
  const handleNextStep = async () => {
    setLoading(true);
    try {
      const nextStage = stage + 1;
      let nextDate: number | undefined;

      if (nextStage <= FIXED_STEPS_DAYS.length) {
        const days = FIXED_STEPS_DAYS[nextStage - 1];
        nextDate = Date.now() + days * DAY_MS;
        await plugin.app.toast(
          `✅ Конспект повторён (шаг ${nextStage}/5)! Следующее повторение через ${days} дн. Карточки тренируются по FSRS.`
        );
      } else {
        await plugin.app.toast(
          `🏆 Поздравляем! Конспект полностью закреплён по графику 1-3-7-21-30 дней! Карточки остаются активными в FSRS.`
        );
      }

      const newState: NoteScheduleState = {
        stage: nextStage,
        nextReviewDate: nextDate,
        lastReviewDate: Date.now(),
      };
      await plugin.storage.setSynced(`note_sched_${rem._id}`, newState);
    } catch (e) {
      await plugin.app.toast(`Ошибка: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Отключить темы, где конспект ещё НЕ был изучен
  const handleFreezeOthers = async () => {
    setLoading(true);
    try {
      await plugin.app.toast('❄️ Проверяем конспекты: отключаем карточки неизученных тем...');
      let frozenCount = 0;
      let activeCount = 0;
      const manifestEntries = Object.entries(noteCardsManifestRaw as Record<string, any>);

      for (const [nId, entry] of manifestEntries) {
        const sState = await plugin.storage.getSynced<{ stage?: number }>(`note_sched_${nId}`);
        const isCurrent = nId === rem._id;
        const isStudied = Boolean((sState?.stage && sState.stage > 0) || isCurrent);

        if (isStudied) {
          activeCount++;
          if (entry.reviewCardId) {
            try {
              const revRem = await plugin.rem.findOne(entry.reviewCardId);
              if (revRem) {
                if (await revRem.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
                  await revRem.removePowerup(BuiltInPowerupCodes.DisableCards);
                }
                await revRem.setEnablePractice(true);
              }
            } catch (_) {}
          }
          if (entry.cardThemeId) {
            try {
              const themeRem = await plugin.rem.findOne(entry.cardThemeId);
              if (themeRem) {
                if (await themeRem.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
                  await themeRem.removePowerup(BuiltInPowerupCodes.DisableCards);
                }
                await themeRem.setEnablePractice(true);
                const descendants = (await themeRem.getDescendants()) || [];
                for (const d of descendants) {
                  if (await d.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
                    await d.removePowerup(BuiltInPowerupCodes.DisableCards);
                  }
                  await d.setEnablePractice(true);
                }
              }
            } catch (_) {}
          }
        } else {
          // НЕ изучен: отключаем
          if (entry.reviewCardId) {
            try {
              const revRem = await plugin.rem.findOne(entry.reviewCardId);
              if (revRem) {
                if (!(await revRem.hasPowerup(BuiltInPowerupCodes.DisableCards))) {
                  await revRem.addPowerup(BuiltInPowerupCodes.DisableCards);
                }
                await revRem.setEnablePractice(false);
              }
            } catch (_) {}
          }
          if (entry.cardThemeId) {
            try {
              const themeRem = await plugin.rem.findOne(entry.cardThemeId);
              if (themeRem) {
                if (!(await themeRem.hasPowerup(BuiltInPowerupCodes.DisableCards))) {
                  await themeRem.addPowerup(BuiltInPowerupCodes.DisableCards);
                }
                await themeRem.setEnablePractice(false);
                frozenCount++;
              }
            } catch (_) {}
          }
        }
      }

      await plugin.app.toast(
        `✅ Очередь очищена! Отключено неизученных тем: ${frozenCount}. Активно изученных тем в FSRS: ${activeCount}.`
      );
    } catch (e) {
      await plugin.app.toast(`Ошибка: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Поставить конспект и карточки на паузу
  const handlePauseCards = async () => {
    setLoading(true);
    try {
      await rem.addPowerup(BuiltInPowerupCodes.DisableCards);
      const descendants = (await rem.getDescendants()) || [];
      for (const ch of descendants) {
        await ch.addPowerup(BuiltInPowerupCodes.DisableCards);
      }
      await plugin.app.toast(`⏸️ Конспект и все его карточки приостановлены (исключены из очередей).`);
    } catch (e) {
      await plugin.app.toast(`Ошибка: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Снять конспект и карточки с паузы
  const handleResumeCards = async () => {
    setLoading(true);
    try {
      if (await rem.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
        await rem.removePowerup(BuiltInPowerupCodes.DisableCards);
      }
      await rem.setEnablePractice(true);
      const descendants = (await rem.getDescendants()) || [];
      for (const ch of descendants) {
        if (await ch.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
          await ch.removePowerup(BuiltInPowerupCodes.DisableCards);
        }
        await ch.setEnablePractice(true);
      }
      await plugin.app.toast(`▶️ Конспект и карточки возобновлены в очередях повторений.`);
    } catch (e) {
      await plugin.app.toast(`Ошибка: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Сброс цикла
  const handleReset = async () => {
    setLoading(true);
    try {
      await rem.addPowerup(BuiltInPowerupCodes.DisableCards);
      const descendants = (await rem.getDescendants()) || [];
      for (const ch of descendants) {
        await ch.addPowerup(BuiltInPowerupCodes.DisableCards);
      }
      await plugin.storage.setSynced(`note_sched_${rem._id}`, { stage: 0 });
      await plugin.app.toast(`Цикл конспекта сброшен. Карточки усыплены до нового изучения.`);
    } catch (e) {
      await plugin.app.toast(`Ошибка: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Открыть тему карточек прямо сейчас
  const handlePracticeTheme = async () => {
    if (!cardThemeId) {
      await plugin.app.toast('Файл карточек для этой темы не найден');
      return;
    }
    try {
      const themeRem = await plugin.rem.findOne(cardThemeId);
      if (themeRem) {
        try {
          await plugin.window.openRem(themeRem);
        } catch (_) {
          await themeRem.openRemAsPage();
        }
        await plugin.app.toast(`📇 Открыт файл карточек: «${cardThemeTitle || 'Карточки темы'}»`);
      }
    } catch (e) {
      await plugin.app.toast(`Ошибка: ${String(e)}`);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 14px',
        margin: '6px 0 12px 0',
        borderRadius: '8px',
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: isPaused
          ? 'rgba(217, 119, 6, 0.08)'
          : stage > 5
          ? 'rgba(20, 90, 70, 0.12)'
          : 'rgba(20, 90, 70, 0.06)',
        border: isPaused
          ? '1px solid rgba(217, 119, 6, 0.25)'
          : stage > 5
          ? '1px solid rgba(20, 90, 70, 0.35)'
          : '1px solid rgba(20, 90, 70, 0.18)',
        backdropFilter: 'blur(12px)',
        color: '#0f172a',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Левая часть: статус конспекта и статус карточек */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '15px' }}>
          {isPaused ? '💤' : stage > 5 ? '🏆' : '📖'}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div>
            <strong>Конспект (1-3-7-21-30):</strong>{' '}
            {stage === 0 ? (
              <span style={{ color: '#d97706' }}>Ещё не изучен (карточки ждут)</span>
            ) : stage <= 5 ? (
              <span>
                Шаг {stage}/5 · След. просмотр:{' '}
                <strong>{formatNextDate(schedState.nextReviewDate)}</strong>{' '}
                <span style={{ color: '#64748b' }}>
                  ({FIXED_STEPS_DAYS[stage - 1]} дн.)
                </span>
              </span>
            ) : (
              <span style={{ color: '#145a46', fontWeight: 600 }}>
                Полностью закреплён по графику 1-3-7-21-30
              </span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            Карточки конспекта:{' '}
            {isPaused ? (
              <span style={{ color: '#d97706' }}>спят (пауза)</span>
            ) : stage === 0 ? (
              <span style={{ color: '#d97706' }}>спят (ждут 1-го прочтения)</span>
            ) : (
              <span style={{ color: '#145a46', fontWeight: 500 }}>активны в FSRS</span>
            )}
          </div>
          {cardThemeTitle ? (
            <div style={{ fontSize: '11px', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ color: '#475569', fontWeight: 500 }}>📁 Файл карточек темы:</span>
              <a
                onClick={(e) => {
                  e.preventDefault();
                  handlePracticeTheme();
                }}
                style={{
                  cursor: 'pointer',
                  color: '#0369a1',
                  background: 'rgba(3, 105, 161, 0.08)',
                  border: '1px solid rgba(3, 105, 161, 0.25)',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  textDecoration: 'none',
                }}
                title="Нажмите, чтобы открыть файл связанных карточек в RemNote"
              >
                <span>🗂️ {cardThemeTitle}</span>
                <span style={{ fontSize: '10px' }}>↗</span>
              </a>
            </div>
          ) : null}
        </div>
      </div>

      {/* Правая часть: кнопки действий */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {stage === 0 ? (
          <button
            onClick={handleStartReview}
            disabled={loading}
            style={{
              cursor: loading ? 'wait' : 'pointer',
              background: '#145a46',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 12px',
              fontWeight: 500,
              fontSize: '11px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            }}
          >
            {loading ? 'Активация…' : '📖 Конспект изучен — включить карточки (FSRS)'}
          </button>
        ) : stage <= 5 ? (
          <>
            <button
              onClick={handleNextStep}
              disabled={loading}
              style={{
                cursor: loading ? 'wait' : 'pointer',
                background: '#145a46',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '5px 10px',
                fontWeight: 500,
                fontSize: '11px',
              }}
              title="Отметить, что конспект перечитан, и перейти к следующему интервалу"
            >
              {loading
                ? '…'
                : `✅ Повторил конспект (${stage < 5 ? `след.: ${FIXED_STEPS_DAYS[stage]}д` : 'финал'})`}
            </button>

            {cardThemeId && (
              <button
                onClick={handlePracticeTheme}
                disabled={loading}
                style={{
                  cursor: loading ? 'wait' : 'pointer',
                  background: '#d97706',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontWeight: 500,
                  fontSize: '11px',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.12)',
                }}
                title={`Открыть карточки темы «${cardThemeTitle || ''}» для тренировки`}
              >
                🎯 Учить эту тему сейчас
              </button>
            )}

            {isPaused ? (
              <button
                onClick={handleResumeCards}
                disabled={loading}
                style={{
                  cursor: loading ? 'wait' : 'pointer',
                  background: 'transparent',
                  color: '#145a46',
                  border: '1px solid rgba(20, 90, 70, 0.3)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11px',
                }}
              >
                ▶️ Разбудить карточки
              </button>
            ) : (
              <button
                onClick={handlePauseCards}
                disabled={loading}
                style={{
                  cursor: loading ? 'wait' : 'pointer',
                  background: 'transparent',
                  color: '#6b1d2f',
                  border: '1px solid rgba(107, 29, 47, 0.25)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11px',
                }}
                title="Временно скрыть карточки этого конспекта из FSRS"
              >
                ⏸️ Пауза карточек
              </button>
            )}

            <button
              onClick={handleFreezeOthers}
              disabled={loading}
              style={{
                cursor: loading ? 'wait' : 'pointer',
                background: 'transparent',
                color: '#2563eb',
                border: '1px solid rgba(37, 99, 235, 0.3)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '11px',
              }}
              title="Отключить карточки всех тем, где конспекты ещё не были изучены (оставить только изученные)"
            >
              ❄️ Отключить неизученное
            </button>
          </>
        ) : (
          <button
            onClick={handleReset}
            disabled={loading}
            style={{
              cursor: loading ? 'wait' : 'pointer',
              background: 'transparent',
              color: '#64748b',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '11px',
            }}
            title="Сбросить цикл повторения конспекта"
          >
            Сбросить цикл
          </button>
        )}
      </div>
    </div>
  );
};

renderWidget(NoteSchedulerBar);
