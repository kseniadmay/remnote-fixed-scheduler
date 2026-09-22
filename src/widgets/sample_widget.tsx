import { usePlugin, renderWidget, useTrackerPlugin } from '@remnote/plugin-sdk';

export const SampleWidget = () => {
  const plugin = usePlugin();

  let name = useTrackerPlugin(() => plugin.settings.getSetting<string>('name'));
  let likesPizza = useTrackerPlugin(() => plugin.settings.getSetting<boolean>('pizza'));
  let favoriteNumber = useTrackerPlugin(() => plugin.settings.getSetting<number>('favorite-number'));

  return (
    <div className="p-2 m-2 rounded-lg rn-clr-background-light-positive rn-clr-content-positive">
      <h1 className="text-xl">Sample Plugin</h1>
      <div>
        Hi {name}, you {!!likesPizza ? 'do' : "don't"} like pizza and your favorite number is{' '}
        {favoriteNumber}!
      </div>
    </div>
  );
};

renderWidget(SampleWidget);
