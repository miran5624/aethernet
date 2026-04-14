import { PermissionsAndroid, Platform, Permission } from 'react-native';

export const requestAllPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;

  try {
    let permissionsToRequest: Permission[] = [];

    if (Platform.Version >= 31) {
      permissionsToRequest = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ];
    } else {
      permissionsToRequest = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];
    }

    const granted = await PermissionsAndroid.requestMultiple(permissionsToRequest);

    const allGranted = permissionsToRequest.every(
      (permission) => granted[permission] === PermissionsAndroid.RESULTS.GRANTED
    );

    return allGranted;
  } catch (err) {
    console.warn(err);
    return false; // Safely return false if permission check crashes
  }
};
