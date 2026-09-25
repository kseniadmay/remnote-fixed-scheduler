import {
  usePlugin,
  renderWidget,
  useTrackerPlugin,
  BuiltInPowerupCodes,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import React, { useState } from 'react';

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
      return { rem, isDoc, isPaused, title };
    } catch (_) {
      return null;
    }
  });

  if (!data || !data.rem) {
    return null;
  }

  const handleActivate = async () => {
    setLoading(true);
    try {
      await data.rem.removePowerup(BuiltInPowerupCodes.DisableCards);
      // Также снимем паузу с прямых потомков, если они были отключены
      const children = await data.rem.getChildrenRem();
      for (const ch of children) {
        if (await ch.hasPowerup(BuiltInPowerupCodes.DisableCards)) {
          await ch.removePowerup(BuiltInPowerupCodes.DisableCards);
        }
      }
      await plugin.app.toast(
        `✅ Конспект изучен! Запущен цикл повторений 1 → 3 → 7 → 21 → 30. Первое повторение: завтра.`
      );
    } catch (e) {
      await plugin.app.toast(`Ошибка активации: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    setLoading(true);
    try {
      await data.rem.addPowerup(BuiltInPowerupCodes.DisableCards);
      await plugin.app.toast(`⏸️ Конспект приостановлен и исключён из очереди повторений.`);
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
        padding: '6px 12px',
        margin: '6px 0 10px 0',
        borderRadius: '8px',
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: data.isPaused ? 'rgba(217, 119, 6, 0.08)' : 'rgba(20, 90, 70, 0.08)',
        border: data.isPaused ? '1px solid rgba(217, 119, 6, 0.2)' : '1px solid rgba(20, 90, 70, 0.2)',
        backdropFilter: 'blur(12px)',
        color: '#0f172a',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '14px' }}>{data.isPaused ? '💤' : '⚡'}</span>
        <span>
          <strong>Планировщик 1-3-7-21-30:</strong>{' '}
          {data.isPaused
            ? 'Конспект спит (не попадает в повторения)'
            : 'Активен в цикле повторений (1 → 3 → 7 → 21 → 30 дн.)'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {data.isPaused ? (
          <button
            onClick={handleActivate}
            disabled={loading}
            style={{
              cursor: loading ? 'wait' : 'pointer',
              background: '#145a46',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontWeight: 500,
              fontSize: '11px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            }}
          >
            {loading ? 'Активация…' : '📖 Конспект изучен — поставить на повторение'}
          </button>
        ) : (
          <button
            onClick={handlePause}
            disabled={loading}
            style={{
              cursor: loading ? 'wait' : 'pointer',
              background: 'transparent',
              color: '#6b1d2f',
              border: '1px solid rgba(107, 29, 47, 0.3)',
              borderRadius: '6px',
              padding: '3px 8px',
              fontSize: '11px',
            }}
            title="Приостановить карточки этого конспекта"
          >
            {loading ? '…' : '⏸️ Приостановить'}
          </button>
        )}
      </div>
    </div>
  );
};

renderWidget(NoteSchedulerBar);
