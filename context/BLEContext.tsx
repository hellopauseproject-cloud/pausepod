import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, ConnectionPriority, Device } from 'react-native-ble-plx';
import { BoxMessage, encodePhoneDown, encodeSessionAck, encodeSetMode, encodeTimeSync, parseBoxMessage } from '../lib/bleProtocol';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789012';
const CHARACTERISTIC_UUID = 'abcdefab-cdef-abcd-efab-cdefabcdefab';

// Vilken låda den här telefonen senast parades med. Ett riktigt
// parningsflöde (byta låda från profilen) är utanför scope här —
// första lådan som säger hello blir "vår" tills vidare.
const PAIRED_BOX_KEY = 'paired_box_id';

const REQUESTED_MTU = 185;

export const BLEControlContext = createContext<{
  connectToPausePod: () => void;
  disconnect: () => void;
  isConnected: boolean;
  isScanning: boolean;
  /** Id på den låda vi just nu är anslutna till, om någon. */
  boxId: string | null;
  /** Är den anslutna lådan samma som senast parades med den här telefonen?
   *  Styr om lådans `state`-meddelande får kapa skärmen (se BLEContext). */
  isPairedBox: boolean;
} | null>(null);

export const BLEMessageContext = createContext<{
  boxMessage: BoxMessage | null;
  resetMessage: () => void;
  sendSessionAck: (seq: string) => Promise<void>;
  sendSetMode: (mode: string) => Promise<void>;
  /** Rent kosmetisk signal från appens egen accelerometer — lådan ignorerar den idag. */
  sendPhoneDown: () => Promise<void>;
} | null>(null);

const manager = new BleManager();
const isConnectingRef = { current: false };
const isConnectedRef = { current: false };
const subscriptionRef = { current: null as any };

export function BLEProvider({ children }: { children: React.ReactNode }) {
  const [boxMessage, setBoxMessage] = useState<BoxMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [isPairedBox, setIsPairedBox] = useState(false);
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

  const sendRaw = async (message: string) => {
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
    } catch (e) {
      console.log('BLE: Fel vid skrivning:', e);
    }
  };

  // hello konsumeras här internt — den blir aldrig ett boxMessage som
  // vidarebefordras till SessionContext. time_sync måste ut innan lådan
  // börjar skicka state/backlog, så det sker synkront i samma handler.
  const handleHello = async (boxIdFromDevice: string) => {
    setBoxId(boxIdFromDevice);
    let paired = await AsyncStorage.getItem(PAIRED_BOX_KEY);
    if (!paired) {
      paired = boxIdFromDevice;
      await AsyncStorage.setItem(PAIRED_BOX_KEY, paired);
    }
    setIsPairedBox(paired === boxIdFromDevice);
    sendRaw(encodeTimeSync(Date.now()));
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

              try {
                await connected.requestMTU(REQUESTED_MTU);
              } catch (e) {
                console.log('BLE: MTU-förhandling misslyckades (ok, faller tillbaka på standard):', e);
              }

              // Android-only — begär kort connection interval under incheckning.
              // iOS saknar motsvarande API på central-sidan; där måste lådan
              // själv föreslå parametrarna (esp_ble_gap_update_conn_params).
              if (Platform.OS === 'android') {
                try {
                  await connected.requestConnectionPriority(ConnectionPriority.High);
                } catch (e) {
                  console.log('BLE: connection priority-förfrågan misslyckades:', e);
                }
              }

              subscriptionRef.current = connected.monitorCharacteristicForService(
                SERVICE_UUID,
                CHARACTERISTIC_UUID,
                (err, characteristic) => {
                  if (err) {
                    console.log('BLE monitor-fel:', err);
                    return;
                  }
                  if (!characteristic?.value) return;

                  const decoded = atob(characteristic.value);
                  const parsed = parseBoxMessage(decoded);
                  if (!parsed) return;

                  if (parsed.type === 'hello') {
                    handleHello(parsed.boxId);
                    return;
                  }
                  setBoxMessage(parsed);
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
    setBoxMessage(null);
    setBoxId(null);
    setIsPairedBox(false);
  };

  const resetMessage = () => setBoxMessage(null);
  const sendSessionAck = (seq: string) => sendRaw(encodeSessionAck(seq));
  const sendSetMode = (mode: string) => sendRaw(encodeSetMode(mode));
  const sendPhoneDown = () => sendRaw(encodePhoneDown());

  const controlValue = { connectToPausePod, disconnect, isConnected, isScanning, boxId, isPairedBox };
  const messageValue = { boxMessage, resetMessage, sendSessionAck, sendSetMode, sendPhoneDown };

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
