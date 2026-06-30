interface ElectronAPI {
  getBackendUrl: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  getPlatform: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
