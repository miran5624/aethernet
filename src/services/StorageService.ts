import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SosPacket {
  packetId: string;
  originUserId: string;
  location: { lat: number; lng: number; accuracy?: number };
  hopCount: number;
  timestamp: number;
  type: string;
}

const STORAGE_KEY = 'sos_packets';
const STORAGE_KEY_UUID = 'device_uuid';
const DELETED_IDS_KEY = 'sos_deleted_ids'; // Blocklist: IDs explicitly deleted by this device

/** Returns (and creates if missing) a persistent unique ID for this device installation. */
export const getDeviceUuid = async (): Promise<string> => {
  try {
    let uuid = await AsyncStorage.getItem(STORAGE_KEY_UUID);
    if (!uuid) {
      uuid = Math.random().toString(36).substring(2, 8); // unique 6-char id
      await AsyncStorage.setItem(STORAGE_KEY_UUID, uuid);
    }
    return uuid;
  } catch {
    return 'anon';
  }
};

/** Returns the set of packet IDs that this device has explicitly deleted. */
const getDeletedIds = async (): Promise<Set<string>> => {
  try {
    const raw = await AsyncStorage.getItem(DELETED_IDS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};

/** Adds a packetId to the persistent deleted-IDs blocklist. */
export const blockPacketId = async (packetId: string): Promise<void> => {
  try {
    const ids = await getDeletedIds();
    ids.add(packetId);
    await AsyncStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...ids]));
  } catch (err) {
    console.error('Failed to block packet id', err);
  }
};

export const savePacket = async (packet: SosPacket): Promise<void> => {
  try {
    // Reject packets that this device has explicitly deleted — even if peers re-broadcast them
    const deletedIds = await getDeletedIds();
    if (deletedIds.has(packet.packetId)) {
      console.log(`StorageService: ignoring blocklisted packet ${packet.packetId}`);
      return;
    }

    const existingData = await AsyncStorage.getItem(STORAGE_KEY);
    let packets: SosPacket[] = [];
    if (existingData) {
      packets = JSON.parse(existingData);
    }

    const exists = packets.some(p => p.packetId === packet.packetId);
    if (exists) {
      return;
    }

    packets.push(packet);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(packets));
    console.log(`StorageService: saved new packet ${packet.packetId}`);
  } catch (err) {
    console.error('Failed to save packet', err);
  }
};

export const getAllPackets = async (): Promise<SosPacket[]> => {
  try {
    const existingData = await AsyncStorage.getItem(STORAGE_KEY);
    if (existingData) {
      return JSON.parse(existingData);
    }
    return [];
  } catch (err) {
    console.error('Failed to get packets', err);
    return [];
  }
};

export const clearAllPackets = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear packets', err);
  }
};

/**
 * Removes only packets that were originated by this device.
 * Packets received from other mesh nodes are left untouched.
 */
export const clearPacketsByOrigin = async (originUserId: string): Promise<void> => {
  try {
    const existing = await getAllPackets();
    const remaining = existing.filter(p => p.originUserId !== originUserId);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    console.log(`StorageService: cleared ${existing.length - remaining.length} own packets, kept ${remaining.length}`);
  } catch (err) {
    console.error('Failed to clear own packets', err);
  }
};

/**
 * Removes exactly one packet by its packetId AND adds it to the
 * deleted-IDs blocklist so peers cannot re-insert it via epidemic routing.
 */
export const deletePacketById = async (packetId: string): Promise<void> => {
  try {
    // Blocklist first — prevents re-save race conditions
    await blockPacketId(packetId);
    const existing = await getAllPackets();
    const remaining = existing.filter(p => p.packetId !== packetId);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    console.log(`StorageService: deleted + blocklisted packet ${packetId}`);
  } catch (err) {
    console.error('Failed to delete packet', err);
  }
};



/**
 * Returns a single SosPacket by its packetId, or null if not found.
 */
export const getPacketById = async (packetId: string): Promise<SosPacket | null> => {
  try {
    const packets = await getAllPackets();
    return packets.find(p => p.packetId === packetId) ?? null;
  } catch (err) {
    console.error('getPacketById failed', err);
    return null;
  }
};

