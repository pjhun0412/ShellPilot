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
    borderSize: 0,
  },
  borders: [],
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
    return normalizeWorkspaceLayout(initialLayout);
  }

  try {
    return normalizeWorkspaceLayout(JSON.parse(savedLayout) as IJsonModel);
  } catch {
    localStorage.removeItem(layoutStorageKey);
    return normalizeWorkspaceLayout(initialLayout);
  }
}

function normalizeWorkspaceLayout(layout: IJsonModel): IJsonModel {
  return {
    ...layout,
    borders: layout.borders?.filter((border) => {
      return !border.children?.some((child) => child.id === 'logs' || child.config?.panelType === 'logs');
    }),
    global: {
      ...layout.global,
      enableEdgeDock: true,
      enableEdgeDockIndicators: true,
      tabEnableDrag: true,
      tabSetEnableDivide: true,
      tabSetEnableDrag: true,
      tabSetEnableDrop: true,
      borderSize: 0,
    },
  };
}
