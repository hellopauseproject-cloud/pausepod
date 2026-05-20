import React, { createContext, useContext, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789012';
const CHARACTERISTIC_UUID = 'abcdefab-cdef-abcd-efab-cdefabcdefab';

export type BLEMessage = 'TOUCH_START' | 'TOUCH_END' | 'LID_CLOSED' | 'LID_OPEN';

export const BLEControlContext = createContext<{
  connectToPausePod: () => void;
  disconnect: () => void;
  isConnected: boolean;
  isScanning: boolean;
} | null>(null);

export const BLEMessageContext = createContext<{
  bleMessage: BLEMessage | null;
  resetMessage: () => void;
  sendMessageToDevice: (message: string) => Promise<void>;
} | null>(null);

const manager = new BleManager();
const isConnectingRef = { current: false };
const isConnectedRef = { current: false };
const subscriptionRef = { current: null as any };

export function BLEProvider({ children }: { children: React.ReactNode }) {
  const [bleMessage, setBleMessage] = useState<BLEMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const deviceRef = useRef<Device | null>(null);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
    }
  };

  const connectToPausePod = async () => {
    if (isConnectingRef.current || isConnectedRef.current) return;
    isConnectingRef.current = true;
    await requestPermissions();

    manager.onStateChange((state) => {
      if (state === 'PoweredOn') {
        setIsScanning(true);
        console.log('BLE: Skannar efter PausePod...');

        manager.startDeviceScan(null, null, async (error, device) => {
          if (error) {
            console.log('BLE scan-fel:', error);
            setIsScanning(false);
            isConnectingRef.current = false;
            return;
          }

          if (device?.name === 'PausePod') {
            manager.stopDeviceScan();
            setIsScanning(false);
            console.log('BLE: Hittade PausePod, ansluter...');

            try {
              const connected = await device.connect();
              await connected.discoverAllServicesAndCharacteristics();
              deviceRef.current = connected;
              isConnectedRef.current = true;
              setIsConnected(true);
              console.log('BLE: Ansluten till PausePod');

              subscriptionRef.current = connected.monitorCharacteristicForService(
                SERVICE_UUID,
                CHARACTERISTIC_UUID,
                (err, characteristic) => {
                  if (err) {
                    console.log('BLE monitor-fel:', err);
                    return;
                  }
                  if (characteristic?.value) {
                    const decoded = atob(characteristic.value);
                    const valid: BLEMessage[] = ['TOUCH_START', 'TOUCH_END', 'LID_CLOSED', 'LID_OPEN'];
                    if (valid.includes(decoded as BLEMessage)) {
                      setBleMessage(decoded as BLEMessage);
                    }
                  }
                }
              );
            } catch (e) {
              console.log('BLE anslutningsfel:', e);
              isConnectingRef.current = false;
            }
          }
        });
      }
    }, true);
  };

  const disconnect = () => {
    subscriptionRef.current?.remove();
    deviceRef.current?.cancelConnection();
    deviceRef.current = null;
    isConnectedRef.current = false;
    isConnectingRef.current = false;
    setIsConnected(false);
    setBleMessage(null);
  };

  const resetMessage = () => setBleMessage(null);

  const sendMessageToDevice = async (message: string) => {
    if (!deviceRef.current) {
      console.log('BLE: Kan inte skicka — ingen ansluten enhet');
      return;
    }
    try {
      const base64 = btoa(message);
      await deviceRef.current.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID,
        base64
      );
      console.log('BLE: Skickade till enhet:', message);
    } catch (e) {
      console.log('BLE: Fel vid skrivning:', e);
    }
  };

  const controlValue = { connectToPausePod, disconnect, isConnected, isScanning };
  const messageValue = { bleMessage, resetMessage, sendMessageToDevice };

  return (
    <BLEControlContext.Provider value={controlValue}>
      <BLEMessageContext.Provider value={messageValue}>
        {children}
      </BLEMessageContext.Provider>
    </BLEControlContext.Provider>
  );
}

export function useBLE() {
  const ctx = useContext(BLEMessageContext);
  if (!ctx) throw new Error('useBLE måste användas inom BLEProvider');
  return ctx;
}

export function useBLEControl() {
  const ctx = useContext(BLEControlContext);
  if (!ctx) throw new Error('useBLEControl måste användas inom BLEProvider');
  return ctx;
}
