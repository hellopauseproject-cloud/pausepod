import { useEffect } from 'react';
import NfcManager, { NfcTech, TagEvent } from 'react-native-nfc-manager';

export function useNfc(onTagFound: (tag: TagEvent) => void) {
  useEffect(() => {
    NfcManager.start();
    return () => {
      NfcManager.cancelTechnologyRequest();
    };
  }, []);

  const scan = async () => {
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      if (tag && onTagFound) {
        onTagFound(tag);
      }
    } catch (ex) {
      console.warn('NFC scan failed:', ex);
    } finally {
      NfcManager.cancelTechnologyRequest();
    }
  };

  return { scan };
}