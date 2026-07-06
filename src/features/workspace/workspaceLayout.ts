import type { IJsonModel } from 'flexlayout-react';

export const layoutStorageKey = 'shellpilot.layout.v2';

export const initialLayout: IJsonModel = {
  global: {
    enableEdgeDock: true,
    enableEdgeDockIndicators: true,
    tabEnableClose: true,
    tabEnableDrag: true,
    tabEnableRename: false,
    tabSetEnableDivide: true,
    tabSetEnableDrag: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrop: true,
    borderSize: 220,
  },
  borders: [
    {
      type: 'border',
      location: 'bottom',
      size: 180,
      selected: 0,
      children: [
        {
          type: 'tab',
          id: 'logs',
          name: 'Logs',
          component: 'logs',
          config: { panelType: 'logs' },
        },
      ],
    },
  ],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 100,
        active: true,
        selected: -1,
        children: [],
      },
    ],
  },
};

export function loadSavedLayout(): IJsonModel {
  const savedLayout = localStorage.getItem(layoutStorageKey);

  if (!savedLayout) {
    return ensureWorkspaceDragCapabilities(initialLayout);
  }

  try {
    return ensureWorkspaceDragCapabilities(JSON.parse(savedLayout) as IJsonModel);
  } catch {
    localStorage.removeItem(layoutStorageKey);
    return ensureWorkspaceDragCapabilities(initialLayout);
  }
}

function ensureWorkspaceDragCapabilities(layout: IJsonModel): IJsonModel {
  return {
    ...layout,
    global: {
      ...layout.global,
      enableEdgeDock: true,
      enableEdgeDockIndicators: true,
      tabEnableDrag: true,
      tabSetEnableDivide: true,
      tabSetEnableDrag: true,
      tabSetEnableDrop: true,
    },
  };
}
