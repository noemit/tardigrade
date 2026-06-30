import { contextBridge, ipcRenderer } from "electron";

export interface ElectronAPI {
  getBackendUrl: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  getPlatform: () => Promise<string>;
}

const api: ElectronAPI = {
  getBackendUrl: () => ipcRenderer.invoke("get-backend-url"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
};

contextBridge.exposeInMainWorld("electronAPI", api);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
