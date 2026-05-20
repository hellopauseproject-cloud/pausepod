import { useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789012';
const CHARACTERISTIC_UUID = 'abcdefab-cdef-abcd-efab-cdefabcdefab';

// Global singleton — skapas en gång, förstörs aldrig
const manager = new BleManager();

export type BLEMessage = 'TOUCH_START' | 'TOUCH_END' | 'LID_CLOSED' | 'LID_OPEN';

export function useBLE() {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [bleMessage, setBleMessage] = useState<BLEMessage | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const subscriptionRef = useRef<any>(null);
  const stateSubscriptionRef = useRef<any>(null);
  const isConnectingRef = useRef(false);
  const isConnectedRef = useRef(false);

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
    console.log('BLE: Väntar på PoweredOn...');

    stateSubscriptionRef.current?.remove();
    stateSubscriptionRef.current = manager.onStateChange((state) => {
      console.log('BLE state:', state);
      if (state === 'PoweredOn') {
        stateSubscriptionRef.current?.remove();
        stateSubscriptionRef.current = null;
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
              isConnectedRef.current = true;
              setConnectedDevice(connected);
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
                    console.log('BLE meddelande:', decoded);
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

  const resetMessage = () => setBleMessage(null);

  const disconnect = () => {
    isConnectedRef.current = false;
    isConnectingRef.current = false;
    subscriptionRef.current?.remove();
    connectedDevice?.cancelConnection();
    setConnectedDevice(null);
    setBleMessage(null);
  };

  // Ingen destroy() — managern lever hela appens livstid
  return {
    connectToPausePod,
    disconnect,
    resetMessage,
    connectedDevice,
    bleMessage,
    isScanning,
  };
}
