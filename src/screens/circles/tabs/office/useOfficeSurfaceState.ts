import { useState } from 'react';

export function useOfficeSurfaceState() {
  const [showCustomize, setShowCustomize] = useState(false);
  const [showMcpHub, setShowMcpHub] = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showConnectAgent, setShowConnectAgent] = useState(false);
  const [showGitHubFeed, setShowGitHubFeed] = useState(false);
  const [showSoundMixer, setShowSoundMixer] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [placingType, setPlacingType] = useState<string | null>(null);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);

  const [terminalSize, setTerminalSize] = useState<'closed' | 'half' | 'full'>('closed');
  const [terminalInitialTab, setTerminalInitialTab] = useState<'commands' | 'automations'>('commands');
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalTargetId, setTerminalTargetId] = useState<string | null>('blackswan-default');
  const [terminalTargetName, setTerminalTargetName] = useState('@BlackSwan');
  const [terminalModel, setTerminalModel] = useState<string | null>('blackswan');
  const [terminalTargetIds, setTerminalTargetIds] = useState<string[] | null>(['blackswan-default']);

  const [nftPickerVisible, setNftPickerVisible] = useState(false);
  const [stickyEditorVisible, setStickyEditorVisible] = useState(false);
  const [emulatorVisible, setEmulatorVisible] = useState(false);
  const [scrabbleVisible, setScrabbleVisible] = useState(false);
  const [pokerVisible, setPokerVisible] = useState(false);
  const [phoneVisible, setPhoneVisible] = useState(false);
  const [hfExplorerVisible, setHfExplorerVisible] = useState(false);
  const [hfRunnerVisible, setHfRunnerVisible] = useState(false);
  const [serviceModalVisible, setServiceModalVisible] = useState(false);

  return {
    showCustomize, setShowCustomize,
    showMcpHub, setShowMcpHub,
    showRewards, setShowRewards,
    showSetupWizard, setShowSetupWizard,
    showConnectAgent, setShowConnectAgent,
    showGitHubFeed, setShowGitHubFeed,
    showSoundMixer, setShowSoundMixer,
    showPublishModal, setShowPublishModal,
    editMode, setEditMode,
    placingType, setPlacingType,
    selectedFurnitureId, setSelectedFurnitureId,
    terminalSize, setTerminalSize,
    terminalInitialTab, setTerminalInitialTab,
    terminalInput, setTerminalInput,
    terminalTargetId, setTerminalTargetId,
    terminalTargetName, setTerminalTargetName,
    terminalModel, setTerminalModel,
    terminalTargetIds, setTerminalTargetIds,
    nftPickerVisible, setNftPickerVisible,
    stickyEditorVisible, setStickyEditorVisible,
    emulatorVisible, setEmulatorVisible,
    scrabbleVisible, setScrabbleVisible,
    pokerVisible, setPokerVisible,
    phoneVisible, setPhoneVisible,
    hfExplorerVisible, setHfExplorerVisible,
    hfRunnerVisible, setHfRunnerVisible,
    serviceModalVisible, setServiceModalVisible,
  };
}
