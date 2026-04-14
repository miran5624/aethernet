import { NativeModules, NativeEventEmitter } from 'react-native';
import { savePacket, getAllPackets, deletePacketById, blockPacketId, SosPacket } from './StorageService';

const { NearbyModule } = NativeModules;
const nearbyEmitter = new NativeEventEmitter(NearbyModule);

let connectedEndpoints: string[] = [];

export const ManetService = {
  startMesh: (
    onPacketReceived?: (packet: SosPacket) => void,
    onPeersChanged?: (peers: string[]) => void
  ) => {
    // Start Discovery & Advertising simultaneously
    NearbyModule.startAdvertising("NearHelp_Device_" + Math.floor(Math.random() * 1000))
      .catch((e: any) => console.error("Advertising error:", e));
      
    NearbyModule.startDiscovery()
      .catch((e: any) => console.error("Discovery error:", e));

    nearbyEmitter.addListener('onPayloadReceived', async (event) => {
      try {
        const { endpointId, message } = event;
        console.log(`[ManetService] Raw payload from ${endpointId}: ${message.substring(0, 80)}`);
        const parsed = JSON.parse(message);

        // --- Tombstone (delete) message ---
        if (parsed.__delete__ === true) {
          const { packetId, hopCount } = parsed;
          console.log(`[ManetService] Tombstone received for ${packetId} (hop ${hopCount})`);
          await blockPacketId(packetId);
          await deletePacketById(packetId);
          if (onPacketReceived) onPacketReceived(parsed); // triggers UI refresh
          // Propagate to all OTHER peers (epidemic delete)
          if (hopCount < 200) {
            const tombstone = JSON.stringify({ __delete__: true, packetId, hopCount: hopCount + 1 });
            for (const ep of connectedEndpoints) {
              if (ep !== endpointId) { // don't echo back to sender
                NearbyModule.sendPayload(ep, tombstone)
                  .catch((e: any) => console.error(`[ManetService] Tombstone fwd failed to ${ep}`, e));
              }
            }
          }
          return;
        }

        // --- Normal SOS packet ---
        const packet: SosPacket = parsed;
        const existingPackets = await getAllPackets();
        const isDuplicate = existingPackets.some(p => p.packetId === packet.packetId);
        console.log(`[ManetService] Packet ${packet.packetId} is ${isDuplicate ? 'duplicate' : 'new'}`);

        if (packet.hopCount <= 200) {
          await savePacket(packet);
          console.log(`[ManetService] Relaying packet ${packet.packetId} immediately (hop ${packet.hopCount + 1})`);
          ManetService.broadcastAllPackets();
          if (onPacketReceived) {
            onPacketReceived(packet);
          }
        }
      } catch (err) {
        console.error("[ManetService] Error processing payload:", err);
      }
    });

    nearbyEmitter.addListener('onEndpointFound', (event) => {
       console.log("[ManetService] Endpoint found:", event.endpointId);
    });

    nearbyEmitter.addListener('onConnected', (event) => {
       console.log("[ManetService] Endpoint connected:", event.endpointId);
       if (!connectedEndpoints.includes(event.endpointId)) {
           connectedEndpoints = [...connectedEndpoints, event.endpointId];
           if (onPeersChanged) onPeersChanged(connectedEndpoints);
       }
    });

    nearbyEmitter.addListener('onDisconnected', (event) => {
       console.log("[ManetService] Endpoint disconnected:", event.endpointId);
       connectedEndpoints = connectedEndpoints.filter(id => id !== event.endpointId);
       if (onPeersChanged) onPeersChanged(connectedEndpoints);
    });
  },

  broadcastAllPackets: async () => {
    try {
      const packets = await getAllPackets();
      const validPackets = packets.filter(p => p.hopCount <= 200);
      console.log(`[ManetService] Broadcasting ${validPackets.length} packets to ${connectedEndpoints.length} endpoints`);
      
      for (const packet of validPackets) {
        const outboundPacket = { ...packet, hopCount: packet.hopCount + 1 };
        const messageString = JSON.stringify(outboundPacket);
        
        for (const endpoint of connectedEndpoints) {
            NearbyModule.sendPayload(endpoint, messageString)
              .catch((e: any) => console.error(`[ManetService] Failed to send to ${endpoint}`, e));
        }
      }
    } catch (e) {
      console.error("[ManetService] Broadcast error:", e);
    }
  },

  stopMesh: () => {
    NearbyModule.stopAll()
      .catch((e: any) => console.error("Stop error:", e));
    nearbyEmitter.removeAllListeners('onPayloadReceived');
    nearbyEmitter.removeAllListeners('onEndpointFound');
    nearbyEmitter.removeAllListeners('onConnected');
    nearbyEmitter.removeAllListeners('onDisconnected');
    connectedEndpoints = [];
  },

  /**
   * Sends a tombstone (delete) message to all connected peers.
   * Each peer deletes the packet locally and forwards the tombstone onwards.
   */
  broadcastDelete: (packetId: string) => {
    const tombstone = JSON.stringify({ __delete__: true, packetId, hopCount: 0 });
    console.log(`[ManetService] Broadcasting delete for ${packetId} to ${connectedEndpoints.length} peers`);
    for (const endpoint of connectedEndpoints) {
      NearbyModule.sendPayload(endpoint, tombstone)
        .catch((e: any) => console.error(`[ManetService] Delete broadcast failed to ${endpoint}`, e));
    }
  },

  getConnectedEndpoints: () => connectedEndpoints
};
