import { Alert, Platform } from 'react-native';

export function showAlert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

export type ConfirmOptions = {
  title: string;
  message?: string;
  /** Button text for the destructive action. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Button text for the safe/cancel action. Defaults to "Cancel". */
  cancelLabel?: string;
  /** If true, the confirm button is styled as destructive on native. */
  destructive?: boolean;
};

/**
 * Promise-based confirm dialog. Resolves `true` if the user confirmed,
 * `false` on cancel or dismiss. Bridges Web (`window.confirm`) and native
 * (`Alert.alert` with a two-button action sheet).
 *
 * Use for anything irreversible — delete circle, kick member, disconnect
 * wallet, leave circle, revoke invite, clear memory, etc.
 */
export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false } = opts;

  if (Platform.OS === 'web') {
    // window.confirm is synchronous — wrap to keep a uniform await-able API.
    const body = message ? `${title}\n\n${message}` : title;
    return Promise.resolve(window.confirm(body));
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel',                                     onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default',    onPress: () => resolve(true)  },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
