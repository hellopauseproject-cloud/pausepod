import { useEffect } from 'react';
import NfcManager, { NfcTech, TagEvent } from 'react-native-nfc-manager';

export function useNfc(onTagFound: (tag: TagEvent) => void) {
  useEffect(() => {
    NfcManager.start();
    return () => {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    };
  }, []);

  const scan = async () => {
    try {
      await NfcManager.requestTechnology([
        NfcTech.NfcA,
        NfcTech.Ndef,
        NfcTech.MifareUltralight,
        NfcTech.MifareClassic,
        NfcTech.IsoDep,
      ]);
      const tag = await NfcManager.getTag();
      if (tag && onTagFound) {
        onTagFound(tag);
      }
    } catch (ex) {
      // ignorera tyst
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  };

  return { scan };
}
