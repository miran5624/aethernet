package com.nearhelpmobile

import android.os.Build
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*

class NearbyModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val SERVICE_ID = "com.nearhelp.mesh"
    private val STRATEGY = Strategy.P2P_CLUSTER

    override fun getName(): String {
        return "NearbyModule"
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } catch (e: Exception) {
            Log.e("NearbyModule", "Failed to send event $eventName", e)
        }
    }

    private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, connectionInfo: ConnectionInfo) {
            Log.d("NearbyModule", "Connection initiated with: $endpointId")
            try {
                Nearby.getConnectionsClient(reactApplicationContext).acceptConnection(endpointId, payloadCallback)
            } catch (e: Exception) {
                Log.e("NearbyModule", "Failed to accept connection", e)
            }
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            val params = Arguments.createMap()
            params.putString("endpointId", endpointId)
            Log.d("NearbyModule", "Connection result for $endpointId: ${result.status.statusCode}")
            when (result.status.statusCode) {
                ConnectionsStatusCodes.STATUS_OK -> {
                    Log.i("NearbyModule", "Connected to endpoint: $endpointId")
                    sendEvent("onConnected", params)
                }
                ConnectionsStatusCodes.STATUS_CONNECTION_REJECTED -> {
                    Log.e("NearbyModule", "Connection rejected by endpoint: $endpointId")
                }
                ConnectionsStatusCodes.STATUS_ERROR -> {
                    Log.e("NearbyModule", "Connection error with endpoint: $endpointId")
                }
            }
        }

        override fun onDisconnected(endpointId: String) {
            Log.d("NearbyModule", "Disconnected from: $endpointId")
            val params = Arguments.createMap()
            params.putString("endpointId", endpointId)
            sendEvent("onDisconnected", params)
        }
    }

    private val endpointDiscoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            val myName = getUniqueName()
            val peerName = info.endpointName
            Log.d("NearbyModule", "Endpoint found: $endpointId ($peerName). My name: $myName")
            
            val params = Arguments.createMap()
            params.putString("endpointId", endpointId)
            params.putString("deviceName", peerName)
            sendEvent("onEndpointFound", params)

            // Tie-breaker: Only one side initiates the connection to avoid collisions.
            // Both sides will still 'accept' in onConnectionInitiated.
            if (myName > peerName) {
                Log.i("NearbyModule", "Initiating connection to $endpointId...")
                try {
                    Nearby.getConnectionsClient(reactApplicationContext)
                        .requestConnection(myName, endpointId, connectionLifecycleCallback)
                } catch (e: Exception) {
                    Log.e("NearbyModule", "Failed to request connection to $endpointId", e)
                }
            } else {
                Log.i("NearbyModule", "Waiting for $endpointId to initiate...")
            }
        }

        override fun onEndpointLost(endpointId: String) {
            Log.i("NearbyModule", "Endpoint lost: $endpointId")
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            if (payload.type == Payload.Type.BYTES) {
                val bytes = payload.asBytes()
                if (bytes != null) {
                    val message = String(bytes, Charsets.UTF_8)
                    Log.d("NearbyModule", "Payload received from $endpointId, size: ${payload.asBytes()?.size} bytes")
                    
                    val params = Arguments.createMap()
                    params.putString("endpointId", endpointId)
                    params.putString("message", message)
                    sendEvent("onPayloadReceived", params)
                }
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
            Log.d("NearbyModule", "Transfer update: ${update.status}")
        }
    }

    private var uniqueEndpointName: String = ""

    private fun getUniqueName(): String {
        if (uniqueEndpointName.isEmpty()) {
            val suffix = (1..4).map { (('A'..'Z') + ('0'..'9')).random() }.joinToString("")
            uniqueEndpointName = "${Build.MODEL}:$suffix"
        }
        return uniqueEndpointName
    }

    @ReactMethod
    fun startAdvertising(deviceName: String, promise: Promise) {
        val name = getUniqueName()
        try {
            val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).build()
            Nearby.getConnectionsClient(reactApplicationContext)
                .startAdvertising(name, SERVICE_ID, connectionLifecycleCallback, options)
                .addOnSuccessListener {
                    Log.i("NearbyModule", "Advertising started as: $name")
                    promise.resolve(null)
                }
                .addOnFailureListener { e ->
                    Log.e("NearbyModule", "Advertising failed", e)
                    promise.reject("ADVERTISE_ERROR", e.message, e)
                }
        } catch (e: Exception) {
            Log.e("NearbyModule", "Exception in startAdvertising", e)
            promise.reject("ADVERTISE_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun startDiscovery(promise: Promise) {
        try {
            val options = DiscoveryOptions.Builder().setStrategy(STRATEGY).build()
            Nearby.getConnectionsClient(reactApplicationContext)
                .startDiscovery(SERVICE_ID, endpointDiscoveryCallback, options)
                .addOnSuccessListener {
                    Log.i("NearbyModule", "Discovery started")
                    promise.resolve(null)
                }
                .addOnFailureListener { e ->
                    Log.e("NearbyModule", "Discovery failed", e)
                    promise.reject("DISCOVERY_ERROR", e.message, e)
                }
        } catch (e: Exception) {
            Log.e("NearbyModule", "Exception in startDiscovery", e)
            promise.reject("DISCOVERY_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun sendPayload(endpointId: String, message: String, promise: Promise) {
        try {
            val bytesPayload = Payload.fromBytes(message.toByteArray(Charsets.UTF_8))
            Nearby.getConnectionsClient(reactApplicationContext)
                .sendPayload(endpointId, bytesPayload)
                .addOnSuccessListener {
                    Log.i("NearbyModule", "Payload sent to $endpointId")
                    promise.resolve(null)
                }
                .addOnFailureListener { e ->
                    Log.e("NearbyModule", "Failed to send payload to $endpointId", e)
                    promise.reject("SEND_ERROR", e.message, e)
                }
        } catch (e: Exception) {
            Log.e("NearbyModule", "Exception in sendPayload", e)
            promise.reject("SEND_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun getDeviceName(promise: Promise) {
        promise.resolve(Build.MODEL)
    }

    @ReactMethod
    fun stopAll(promise: Promise) {
        try {
            Nearby.getConnectionsClient(reactApplicationContext).stopAllEndpoints()
            Log.i("NearbyModule", "Stopped all endpoints")
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e("NearbyModule", "Exception in stopAll", e)
            promise.reject("STOP_ERROR", e.message, e)
        }
    }
}
