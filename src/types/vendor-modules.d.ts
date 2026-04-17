declare module 'expo-camera' {
  export const Camera: any;
  export const CameraView: any;
  export type CameraType = 'front' | 'back';
  export function useCameraPermissions(): [
    { granted?: boolean } | null,
    () => Promise<{ granted?: boolean }>
  ];
}

declare module 'expo-media-library' {
  export function usePermissions(): [
    { granted?: boolean } | null,
    () => Promise<{ granted?: boolean }>
  ];
  export function saveToLibraryAsync(uri: string): Promise<void>;
}

declare module 'tweetnacl' {
  const nacl: any;
  export default nacl;
}
