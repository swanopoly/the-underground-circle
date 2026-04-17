import { Platform } from 'react-native';

export const ROOM_WORKSPACE_OPEN_EVENT = 'uc:open-room-workspace';
export const ROOM_WORKSPACE_FOCUS_FILE_EVENT = 'uc:focus-room-workspace-file';

type LaunchRoomWorkspaceArgs = {
  circleId: string;
  roomId: string;
  primaryFileId?: string | null;
  preferredPanel?: 'chat' | 'playground';
};

export function primeRoomWorkspaceLaunch({
  circleId,
  roomId,
  primaryFileId = null,
  preferredPanel = 'playground',
}: LaunchRoomWorkspaceArgs): void {
  if (Platform.OS !== 'web') return;

  try {
    localStorage.setItem(`uc_selected_room_${circleId}`, roomId);
    localStorage.setItem(`uc_room_selected_${circleId}`, roomId);
    localStorage.setItem(`uc_room_panel_${roomId}`, preferredPanel);

    if (primaryFileId) {
      localStorage.setItem(`uc_room_active_tab_${roomId}`, primaryFileId);
      localStorage.setItem(`uc_room_tabs_${roomId}`, JSON.stringify([primaryFileId]));
    }

    window.dispatchEvent(new CustomEvent(ROOM_WORKSPACE_OPEN_EVENT, {
      detail: {
        circleId,
        roomId,
        primaryFileId,
        preferredPanel,
      },
    }));
  } catch {}
}

type FocusRoomWorkspaceFileArgs = {
  roomId: string;
  primaryFileId?: string | null;
  preferredPanel?: 'chat' | 'playground';
};

export function focusRoomWorkspaceFile({
  roomId,
  primaryFileId = null,
  preferredPanel = 'playground',
}: FocusRoomWorkspaceFileArgs): void {
  if (Platform.OS !== 'web') return;

  try {
    localStorage.setItem(`uc_room_panel_${roomId}`, preferredPanel);

    if (primaryFileId) {
      localStorage.setItem(`uc_room_active_tab_${roomId}`, primaryFileId);
      localStorage.setItem(`uc_room_tabs_${roomId}`, JSON.stringify([primaryFileId]));
    }

    window.dispatchEvent(new CustomEvent(ROOM_WORKSPACE_FOCUS_FILE_EVENT, {
      detail: {
        roomId,
        primaryFileId,
        preferredPanel,
      },
    }));
  } catch {}
}
