import {
  declareIndexPlugin,
  ReactRNPlugin,
  PluginRem,
  SetRemType,
  SpecialPluginCallback,
} from '@remnote/plugin-sdk';

// ============================================================
// Часть 0 — новое: жёсткий график повторения теории 1-3-5-7-21-30
// (игнорирует оценку ответа — карточка всегда идёт по этой сетке)
// ============================================================

const FIXED_STEPS_DAYS = [1, 3, 7, 21, 30, 60, 90, 180, 360];
const DAY_MS = 24 * 60 * 60 * 1000;

async function registerFixedScheduler(plugin: ReactRNPlugin) {
  // регистрирует новый тип шедулера — он появится в Settings > Schedulers
  await plugin.scheduler.registerCustomScheduler('Fixed 1-3-7-21-30', []);

  // вызывается RemNote при каждом ревью карточки, которой назначен этот шедулер
  plugin.app.registerCallback(SpecialPluginCallback.SRSScheduleCard, async (args: any) => {
    const repsSoFar = args.history?.length ?? 0; // включая только что прошедшее ревью
    let days: number;
    if (repsSoFar <= FIXED_STEPS_DAYS.length) {
      const stepIndex = Math.max(repsSoFar - 1, 0);
      days = FIXED_STEPS_DAYS[stepIndex];
    } else {
      // если повторений больше, удваиваем предыдущий максимальный интервал
      const extraSteps = repsSoFar - FIXED_STEPS_DAYS.length;
      days = FIXED_STEPS_DAYS[FIXED_STEPS_DAYS.length - 1] * Math.pow(2, extraSteps);
    }
    return { nextDate: Date.now() + days * DAY_MS };
  });
}

// ============================================================
// Часть 1 — уже был: расстановка тегов по уровням (без изменений)
// ============================================================

const TAGS = {
  warm: { name: 'Разминка', color: 'Green' as const },
  core: { name: 'Ядро', color: 'Blue' as const },
  challenge: { name: 'Челлендж', color: 'Red' as const },
  review: { name: 'Ревью', color: 'Orange' as const },
  final: { name: 'Финал', color: 'Purple' as const },
};

function tierForLevel(level: number): keyof typeof TAGS {
  if (level <= 2) return 'warm';
  if (level <= 4) return 'core';
  return 'challenge';
}

async function getOrCreateColoredTag(
  plugin: ReactRNPlugin,
  name: string,
  color: 'Red' | 'Orange' | 'Yellow' | 'Green' | 'Blue' | 'Purple',
): Promise<PluginRem | undefined> {
  let tagRem = await plugin.rem.findByName([name], null);
  if (!tagRem) {
    tagRem = await plugin.rem.createRem();
    await tagRem?.setText([name]);
  }
  await tagRem?.setHighlightColor(color);
  return tagRem;
}

async function applyTag(PluginRem: PluginRem, tagRem: PluginRem) {
  const existing = await PluginRem.getTagRems();
  if (!existing.some((t) => t._id === tagRem._id)) {
    await PluginRem.addTag(tagRem);
  }
}

async function walkTagLevels(
  plugin: ReactRNPlugin,
  PluginRem: PluginRem,
  tagRems: Record<keyof typeof TAGS, PluginRem | undefined>,
  stats: { tagged: number },
) {
  const text = await plugin.richText.toString(PluginRem.text || []);
  const levelMatch = text.match(/Уровень\s*(\d+)/u);
  if (levelMatch) {
    const tagRem = tagRems[tierForLevel(parseInt(levelMatch[1], 10))];
    if (tagRem) {
      await applyTag(PluginRem, tagRem);
      stats.tagged++;
    }
  }
  if (/REVIEW/i.test(text) && tagRems.review) await applyTag(PluginRem, tagRems.review);
  if (/ФИНАЛ/i.test(text) && tagRems.final) await applyTag(PluginRem, tagRems.final);

  for (const child of await PluginRem.getChildrenRem()) {
    await walkTagLevels(plugin, child, tagRems, stats);
  }
}

// ============================================================
// Часть 2 — новое: переформулировка карточек через Claude API
// ============================================================

const API_KEY_SETTING = 'anthropic-api-key';
const MODEL_SETTING = 'anthropic-model';
const BATCH_SIZE = 12; // сколько карточек уходит в одном запросе — меньше запросов, меньше накладных расходов

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
    console.warn('[Schedule Auto-Tagger] registerFixedScheduler failed (scheduler API unavailable?):', e);
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
    id: 'auto-tag-schedule-levels',
    name: 'Расставить теги по уровням расписания',
    action: async () => {
      const root = await plugin.focus.getFocusedRem();
      if (!root) {
        await plugin.app.toast('Откройте корневой PluginRem расписания и повторите команду');
        return;
      }
      const tagRems: Record<keyof typeof TAGS, PluginRem | undefined> = {
        warm: await getOrCreateColoredTag(plugin, TAGS.warm.name, TAGS.warm.color),
        core: await getOrCreateColoredTag(plugin, TAGS.core.name, TAGS.core.color),
        challenge: await getOrCreateColoredTag(plugin, TAGS.challenge.name, TAGS.challenge.color),
        review: await getOrCreateColoredTag(plugin, TAGS.review.name, TAGS.review.color),
        final: await getOrCreateColoredTag(plugin, TAGS.final.name, TAGS.final.color),
      };
      const stats = { tagged: 0 };
      await walkTagLevels(plugin, root, tagRems, stats);
      await plugin.app.toast(`Готово: проставлено тегов — ${stats.tagged}`);
    },
  });

  await plugin.app.registerCommand({
    id: 'smart-edit-cards',
    name: 'Переформулировать карточки в этой папке (Claude)',
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

      // 1. собрать все карточки поддерева
      const raw: PluginRem[] = [];
      await (async function collect(PluginRem: PluginRem) {
        if (PluginRem.backText && PluginRem.backText.length > 0) raw.push(PluginRem);
        for (const child of await PluginRem.getChildrenRem()) await collect(child);
      })(root);

      if (raw.length === 0) {
        await plugin.app.toast('В этой папке не нашлось карточек (front/back)');
        return;
      }

      const cards: CardPair[] = [];
      for (const PluginRem of raw) {
        cards.push({
          PluginRem,
          front: await plugin.richText.toString(PluginRem.text || []),
          back: await plugin.richText.toString(PluginRem.backText || []),
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
        // небольшая пауза между батчами, чтобы не упереться в rate limit
        await new Promise((r) => setTimeout(r, 500));
      }

      await plugin.app.toast(`Готово: переформулировано карточек — ${done} из ${cards.length}`);
    },
  });
}

async function onDeactivate(_plugin: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);

