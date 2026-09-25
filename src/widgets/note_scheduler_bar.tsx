import {
  usePlugin,
  renderWidget,
  useTrackerPlugin,
  BuiltInPowerupCodes,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import React, { useState } from 'react';

const FIXED_STEPS_DAYS = [1, 3, 7, 21, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

interface NoteScheduleState {
  stage: number; // 0 = не изучен, 1 = 1 день, 2 = 3 дня, 3 = 7 дней, 4 = 21 день, 5 = 30 дней, 6 = освоен
  nextReviewDate?: number;
  lastReviewDate?: number;
}

export const NoteSchedulerBar = () => {
  const plugin = usePlugin();
  const [loading, setLoading] = useState(false);

  const data = useTrackerPlugin(async () => {
    try {
      const widgetCtx = await plugin.widget.getWidgetContext<WidgetLocation.DocumentBelowTitle>();
      const docId = widgetCtx?.documentId;
      const rem = docId ? await plugin.rem.findOne(docId) : await plugin.focus.getFocusedRem();
      if (!rem) return null;
      const isDoc = await rem.isDocument();
      const isPaused = await rem.hasPowerup(BuiltInPowerupCodes.DisableCards);
      const title = await plugin.richText.toString(rem.text || []);
      const schedState = (await plugin.storage.getSynced<NoteScheduleState>(`note_sched_${rem._id}`)) || {
        stage: 0,
      };
      return { rem, isDoc, isPaused, title, schedState };
    } catch (_) {
      return null;
    }
  });

  if (!data || !data.rem) {
    return null;
  }

  const { rem, isPaused, schedState } = data;
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
      const descendants = (await rem.getDescendants()) || [];
      for (const ch of descendants) {
        if (await ch.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
          await ch.removePowerup(BuiltInPowerupCodes.DisableCards);
        }
      }

      // 2. Ставим конспект на 1-й шаг (повторение через 1 день)
      const nextDate = Date.now() + FIXED_STEPS_DAYS[0] * DAY_MS;
      const newState: NoteScheduleState = {
        stage: 1,
        nextReviewDate: nextDate,
        lastReviewDate: Date.now(),
      };
      await plugin.storage.setSynced(`note_sched_${rem._id}`, newState);

      await plugin.app.toast(
        `✅ Конспект изучен! Детальные карточки разблокированы и отданы в FSRS. Первое повторение конспекта: завтра.`
      );
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
      const descendants = (await rem.getDescendants()) || [];
      for (const ch of descendants) {
        if (await ch.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
          await ch.removePowerup(BuiltInPowerupCodes.DisableCards);
        }
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
