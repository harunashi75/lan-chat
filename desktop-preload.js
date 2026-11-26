const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  sources:() => ipcRenderer.invoke('capture-sources'),
  select:selection => ipcRenderer.invoke('capture-select',selection),
  saveRole:data => ipcRenderer.invoke('save-role',data)
});
