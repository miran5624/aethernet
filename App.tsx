import React, { useState, useEffect, useMemo } from 'react';
import { Text, View, ActivityIndicator, TouchableOpacity, NativeModules } from 'react-native';
// Bypass unused online connectivity hooks for mesh ops
import { requestAllPermissions } from './src/hooks/usePermissions';
import { savePacket, getAllPackets, clearPacketsByOrigin, deletePacketById, getDeviceUuid, SosPacket } from './src/services/StorageService';

// OnlineScreen bypassed

import { useKeepAwake } from '@sayem314/react-native-keep-awake';
import { ManetService } from './src/services/ManetService';
import { FlatList } from 'react-native';

import Geolocation from '@react-native-community/geolocation';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { getDistanceKm } from './src/utils/GeoUtils';
import { WebView } from 'react-native-webview';

const OfflineScreen = () => {
  useKeepAwake();

  const [permissionsGranted, setPermissionsGranted] = useState<boolean | null>(null);
  const [packetCount, setPacketCount] = useState(0);
  const [peersCount, setPeersCount] = useState(0);
  const [allPackets, setAllPackets] = useState<SosPacket[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number, accuracy: number } | null>(null);
  const [showLocationWarning, setShowLocationWarning] = useState(false);
  const [deviceName, setDeviceName] = useState<string>('...');
  const [deviceUuid, setDeviceUuid] = useState<string>('');

  // Fetch device identity once on mount
  useEffect(() => {
    NativeModules.NearbyModule.getDeviceName()
      .then((name: string) => setDeviceName(name))
      .catch(() => setDeviceName('Unknown'));

    getDeviceUuid().then(uuid => setDeviceUuid(uuid));
  }, []);

  // Packets enriched with distance and sorted nearest-first
  const sortedPackets = useMemo(() => {
    return allPackets
      .map(p => ({
        ...p,
        distanceKm: userLocation
          ? getDistanceKm(userLocation.lat, userLocation.lng, p.location.lat, p.location.lng)
          : 999,
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [allPackets, userLocation]);

  const nearestPacket = sortedPackets[0] ?? null;

  // The SOS packet created by THIS device (null if none active)
  const myActiveSos = useMemo(
    () => allPackets.find(p => p.originUserId === deviceUuid) ?? null,
    [allPackets, deviceUuid]
  );

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;
    let watchId: number | null = null;

    const startOfflineMesh = async () => {
      const granted = await requestAllPermissions();
      setPermissionsGranted(granted);

      if (granted) {
        // Start GPS
        Geolocation.getCurrentPosition(
          (position) => {
            setUserLocation({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
            });
          },
          (error) => console.log(error.code, error.message),
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 10000 }
        );

        watchId = Geolocation.watchPosition(
          (position) => {
            setUserLocation({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
            });
          },
          (error) => console.log(error.code, error.message),
          { enableHighAccuracy: true, distanceFilter: 10 }
        );

        ManetService.startMesh(
          async (packet) => {
            const packets = await getAllPackets();
            setAllPackets(packets);
            setPacketCount(packets.length);
          },
          (peers) => {
            setPeersCount(peers.length);
          }
        );

        intervalId = setInterval(() => {
          ManetService.broadcastAllPackets();
        }, 10000);
      }

      const packets = await getAllPackets();
      setAllPackets(packets);
      setPacketCount(packets.length);
    };

    startOfflineMesh();

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (watchId !== null) Geolocation.clearWatch(watchId);
      ManetService.stopMesh();
    };
  }, []);

  const handleSimulateSOS = async () => {
    // One SOS per device — block if already active
    if (myActiveSos) { return; }

    let loc = userLocation;
    let fallback = false;
    if (!loc) {
      loc = { lat: 0, lng: 0, accuracy: -1 };
      fallback = true;
      setShowLocationWarning(true);
    } else {
      setShowLocationWarning(false);
    }

    // Find the next SOS number not already present in local storage.
    // Because received packets from other devices are also stored here,
    // this guarantees no two devices in the mesh pick the same number.
    const existingPackets = await getAllPackets();
    const usedNumbers = new Set(
      existingPackets
        .map(p => p.type.match(/^SOS (\d+)$/))
        .filter(Boolean)
        .map(m => parseInt(m![1], 10))
    );
    let nextNum = 1;
    while (usedNumbers.has(nextNum)) { nextNum++; }
    const sosLabel = `SOS ${nextNum}`;

    const newPacket: SosPacket = {
      packetId: Math.random().toString(36).substring(2),
      originUserId: deviceUuid,
      location: { lat: fallback ? 0 : loc.lat, lng: fallback ? 0 : loc.lng, accuracy: loc.accuracy },
      hopCount: 0,
      timestamp: Date.now(),
      type: sosLabel,
    };

    await savePacket(newPacket);
    const packets = await getAllPackets();
    setAllPackets(packets);
    setPacketCount(packets.length);
    ManetService.broadcastAllPackets();
  };

  const handleDeleteSos = async () => {
    if (!myActiveSos) { return; }
    const packetId = myActiveSos.packetId;
    await deletePacketById(packetId);
    // Tell all connected peers to delete it too — tombstone spreads epidemically
    ManetService.broadcastDelete(packetId);
    const remaining = await getAllPackets();
    setAllPackets(remaining);
    setPacketCount(remaining.length);
    setShowLocationWarning(false);
  };

  return (
    <View style={{ flex: 1, paddingTop: 30, alignItems: 'center', backgroundColor: '#000000' }}>
      <Text style={{ backgroundColor: '#ffff00', color: 'black', padding: 5, fontWeight: 'bold', marginBottom: 4 }}>
        ⚡ Stay Awake Active
      </Text>
      <Text style={{ backgroundColor: '#003300', color: '#00ff41', padding: 4, fontWeight: 'bold', marginBottom: 10, fontSize: 12 }}>
        🔗 This Device: {deviceName}
      </Text>

      {permissionsGranted === true ? (
        <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#ff4444', marginBottom: 10 }}>🔴 MESH ACTIVE</Text>
      ) : (
        <Text style={{ fontSize: 20, fontWeight: 'bold', color: 'gray', marginBottom: 10 }}>OFFLINE MODE</Text>
      )}

      {permissionsGranted === true && (
        <View style={{ height: '45%', width: '100%', marginBottom: 10 }}>
          <MapView
            style={{ flex: 1 }}
            showsUserLocation={true}
            followsUserLocation={false}
            initialRegion={{
              latitude: userLocation ? userLocation.lat : 20.5937,
              longitude: userLocation ? userLocation.lng : 78.9629,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            }}
          >
            {userLocation && nearestPacket && (
              <Polyline
                coordinates={[
                  { latitude: userLocation.lat, longitude: userLocation.lng },
                  { latitude: nearestPacket.location.lat, longitude: nearestPacket.location.lng },
                ]}
                strokeColor="#00ff41"
                strokeWidth={3}
              />
            )}

            {sortedPackets.map(packet => (
              <Marker
                key={packet.packetId}
                coordinate={{ latitude: packet.location.lat, longitude: packet.location.lng }}
                pinColor="red"
                title={`🆘 ${packet.type}`}
                description={`${packet.distanceKm} km away | Relayed via ${packet.hopCount} node${packet.hopCount !== 1 ? 's' : ''}`}
              />
            ))}
          </MapView>
        </View>
      )}

      {permissionsGranted === false && (
        <Text style={{ color: 'red', fontWeight: 'bold', textAlign: 'center', marginHorizontal: 20, marginBottom: 20 }}>
          PERMISSIONS DENIED — Mesh network cannot start.
        </Text>
      )}

      {permissionsGranted === true && (
        <View style={{ width: '80%', marginBottom: 10 }}>
          {userLocation ? (
            <Text style={{ fontSize: 14, color: '#add8e6', fontWeight: 'bold', marginBottom: 5 }}>
              📍 Your Location: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)} | Accuracy: {Math.round(userLocation.accuracy)}m
            </Text>
          ) : (
            <Text style={{ fontSize: 14, color: '#add8e6', fontWeight: 'bold', marginBottom: 5 }}>
              📍 Acquiring GPS... <ActivityIndicator size="small" color="#add8e6" />
            </Text>
          )}

          {showLocationWarning && (
            <Text style={{ color: 'yellow', fontWeight: 'bold', marginBottom: 5, fontSize: 12 }}>
              ⚠️ Location unavailable — SOS sent without coordinates
            </Text>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14, color: '#00ff00', fontWeight: 'bold' }}>Peers in range: {peersCount}</Text>
            <Text style={{ fontSize: 14, color: '#ffffff', fontWeight: 'bold' }}>Stored Packets: {packetCount}</Text>
          </View>
        </View>
      )}

      {permissionsGranted === true && (
        <View style={{ flex: 1, width: '92%', marginBottom: 10 }}>
          <Text style={{ color: '#666', marginBottom: 4, fontWeight: 'bold', fontSize: 12 }}>VICTIMS (nearest first):</Text>
          <FlatList
            data={sortedPackets}
            keyExtractor={item => item.packetId}
            renderItem={({ item }) => {
              let emoji = '🆘';
              const time = new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              }).format(new Date(item.timestamp));
              return (
                <Text style={{ color: '#fff', fontSize: 12, paddingVertical: 3, fontFamily: 'monospace' }}>
                  {emoji} {item.type} | {item.distanceKm} km away | Hop {item.hopCount} | {time}
                </Text>
              );
            }}
          />
        </View>
      )}

      {permissionsGranted === true && (
        <View style={{ flexDirection: 'row', gap: 15, marginBottom: 10 }}>
          {/* Raise SOS — disabled if this device already has an active SOS */}
          <TouchableOpacity
            onPress={handleSimulateSOS}
            disabled={!!myActiveSos}
            style={{
              backgroundColor: myActiveSos ? '#7a2222' : '#ff4444',
              paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
              opacity: myActiveSos ? 0.5 : 1,
            }}>
            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>
              {myActiveSos ? `Active: ${myActiveSos.type}` : 'Raise SOS'}
            </Text>
          </TouchableOpacity>

          {/* Delete SOS — disabled if no active SOS from this device */}
          <TouchableOpacity
            onPress={handleDeleteSos}
            disabled={!myActiveSos}
            style={{
              backgroundColor: myActiveSos ? '#cc4400' : '#555',
              paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
              opacity: myActiveSos ? 1 : 0.4,
            }}>
            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>Delete SOS</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const App = () => {
  const [showWebView, setShowWebView] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      {/* Offline mesh — always mounted so mesh keeps running in background */}
      <View style={{ flex: 1, display: showWebView ? 'none' : 'flex' }}>
        <OfflineScreen />
      </View>

      {/* WebView — only shown when toggled */}
      {showWebView && (
        <View style={{ flex: 1 }}>
          <WebView
            source={{ uri: 'https://nearhelp-frontend.vercel.app/' }}
            style={{ flex: 1 }}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
                <ActivityIndicator size="large" color="#00ff41" />
                <Text style={{ color: '#00ff41', marginTop: 10, fontWeight: 'bold' }}>Loading NearHelp...</Text>
              </View>
            )}
          />
        </View>
      )}

      {/* Floating toggle button — always visible in top-right corner */}
      <TouchableOpacity
        onPress={() => setShowWebView(v => !v)}
        style={{
          position: 'absolute',
          top: 36,
          right: 16,
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: showWebView ? '#ff4444' : '#00aa55',
          justifyContent: 'center',
          alignItems: 'center',
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.4,
          shadowRadius: 4,
          zIndex: 999,
        }}>
        <Text style={{ fontSize: 20 }}>{showWebView ? '📡' : '🌐'}</Text>
      </TouchableOpacity>
    </View>
  );
};

export default App;
