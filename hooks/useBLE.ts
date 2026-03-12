import { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

const bleManager = new BleManager();

export type TouchEvent = 'TOUCH_START' | 'TOUCH_END' | null;

export function useBLE() {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [touchEvent, setTouchEvent] = useState<TouchEvent>(null);
  const [isScanning, setIsScanning] = useState(false);

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
    await requestPermissions();
    setIsScanning(true);

    bleManager.startDeviceScan(null, null, async (error, device) => {
      if (error) {
        console.log('Scan error:', error);
        setIsScanning(false);
        return;
      }

      if (device?.name === 'PausePod') {
        bleManager.stopDeviceScan();
        setIsScanning(false);

        try {
          const connected = await device.connect();
          await connected.discoverAllServicesAndCharacteristics();
          setConnectedDevice(connected);

          connected.monitorCharacteristicForService(
            SERVICE_UUID,
            CHARACTERISTIC_UUID,
            (error, characteristic) => {
              if (error) {
                console.log('Monitor error:', error);
                return;
              }
              if (characteristic?.value) {
                const decoded = atob(characteristic.value);
                console.log('BLE meddelande:', decoded);
                if (decoded === 'TOUCH_START') {
                  setTouchEvent('TOUCH_START');
                } else if (decoded === 'TOUCH_END') {
                  setTouchEvent('TOUCH_END');
                }
              }
            }
          );
        } catch (e) {
          console.log('Connection error:', e);
        }
      }
    });
  };

  const disconnect = () => {
    connectedDevice?.cancelConnection();
    setConnectedDevice(null);
    setTouchEvent(null);
  };

  useEffect(() => {
    return () => {
      bleManager.destroy();
    };
  }, []);

  return {
    connectToPausePod,
    disconnect,
    connectedDevice,
    touchEvent,
    isScanning,
  };
}