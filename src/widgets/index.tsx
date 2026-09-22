import {
  declareIndexPlugin,
  ReactRNPlugin,
  PluginRem,
  SpecialPluginCallback,
} from '@remnote/plugin-sdk';

// ============================================================
// Часть 1: Жёсткий график повторения 1-3-7-21-30 и далее
// ============================================================

const FIXED_STEPS_DAYS = [1, 3, 7, 21, 30, 60, 90, 180, 360];
const DAY_MS = 24 * 60 * 60 * 1000;

async function registerFixedScheduler(plugin: ReactRNPlugin) {
  // Регистрирует шедулер в Settings > Schedulers
  await plugin.scheduler.registerCustomScheduler('Fixed 1-3-7-21-30', []);

  // Вызывается RemNote при каждом ревью карточки с этим шедулером
  plugin.app.registerCallback(SpecialPluginCallback.SRSScheduleCard, async (args: any) => {
    const repsSoFar = args.history?.length ?? 0; // включая только что прошедшее ревью
    let days: number;
    if (repsSoFar <= FIXED_STEPS_DAYS.length) {
      const stepIndex = Math.max(repsSoFar - 1, 0);
      days = FIXED_STEPS_DAYS[stepIndex];
    } else {
      // Если повторений больше, удваиваем предыдущий интервал
      const extraSteps = repsSoFar - FIXED_STEPS_DAYS.length;
      days = FIXED_STEPS_DAYS[FIXED_STEPS_DAYS.length - 1] * Math.pow(2, extraSteps);
    }
    return { nextDate: Date.now() + days * DAY_MS };
  });
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
  pairs: { front: string; back: string }[],
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

async function onActivate(plugin: ReactRNPlugin) {
  try {
    await registerFixedScheduler(plugin);
  } catch (e) {
    console.warn('[Fixed Scheduler] registerFixedScheduler failed:', e);
  }

  await plugin.settings.registerStringSetting({
    id: API_KEY_SETTING,
    title: 'Anthropic API key (sk-ant-...)',
    description:
      'Хранится локально в настройках плагина. НЕ маскируется в UI RemNote — не используйте это на общем компьютере.',
  });
  await plugin.settings.registerStringSetting({
    id: MODEL_SETTING,
    title: 'Модель Claude',
    defaultValue: 'claude-sonnet-5',
    description: 'См. актуальный список моделей на docs.claude.com',
  });

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

      // Собрать все карточки поддерева
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
          `Обрабатываю карточки ${start + 1}–${Math.min(start + BATCH_SIZE, cards.length)} из ${cards.length}…`,
        );
        try {
          const rewritten = await callClaude(
            apiKey,
            model,
            batch.map((c) => ({ front: c.front, back: c.back })),
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
