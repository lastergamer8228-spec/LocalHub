package com.localhub.localhub.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.localhub.localhub.util.AppLogger

/**
 * Advertises LocalHub over mDNS (Bonjour / ZeroConf) so the phone can be reached
 * with a friendly hostname instead of a raw IP, e.g. `http://localhub.local:9090`.
 *
 * Two things are advertised:
 *   1. A resolvable **hostname** `localhub.local` -> this device's IP, so
 *      mDNS-aware clients (macOS, iOS, Linux/avahi, Android) can resolve it.
 *      Android does not expose the hostname field publicly, so it is set through
 *      the hidden `NsdServiceInfo#setHostname` API via reflection (best-effort).
 *   2. A `_http._tcp` **service** whose display name is the user's Server Name,
 *      so the server shows up in mDNS service-discovery lists.
 *
 * Registration is fully best-effort: if mDNS is unavailable on the network or the
 * device, it fails silently and the IP-based URL (always shown on the dashboard)
 * remains the fallback. No Windows hosts file editing is required or attempted.
 */
class NsdHelper(private val context: Context, private val logger: AppLogger) {

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var registeredService: String? = null
    private var registeredHostname: String? = null
    private var registeredPort: Int = 0
    private var listener: NsdManager.RegistrationListener? = null

    /** Fixed, predictable hostname so `http://localhub.local` always works. */
    private val hostname = "localhub"

    /**
     * Registers (or re-registers) mDNS. No-op if nothing changed. [serverName]
     * becomes the human-friendly service display name.
     */
    fun register(serverName: String, port: Int) {
        val serviceName = sanitize(serverName)
        if (registeredService == serviceName && registeredPort == port) return

        unregister()

        val info = NsdServiceInfo().apply {
            setServiceName(serviceName)
            setServiceType("_http._tcp.")
            setPort(port)
            applyHostname(this)
        }

        val reg = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {
                registeredService = serviceInfo.serviceName
                registeredPort = port
                logger.info("Nsd", "mDNS registered: http://$hostname.local:$port")
            }
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                logger.error("Nsd", "mDNS registration failed (code $errorCode)")
            }
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {
                registeredService = null
            }
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                logger.error("Nsd", "mDNS unregistration failed (code $errorCode)")
            }
        }
        listener = reg
        runCatching {
            nsdManager.registerService(info, NsdManager.PROTOCOL_DNS_SD, reg)
        }.onFailure {
            logger.error("Nsd", "mDNS error: ${it.message}")
            listener = null
        }
    }

    fun unregister() {
        val reg = listener ?: return
        listener = null
        registeredService = null
        runCatching { nsdManager.unregisterService(reg) }
    }

    /** The advertised hostname (without the `.local` suffix). */
    fun hostname(): String = hostname

    /**
     * Sets the hidden hostname field on [NsdServiceInfo] so the mDNS responder
     * advertises `localhub.local` as a resolvable A-record. Hidden API access is
     * best-effort; if it is blocked the service registration still succeeds but
     * only service-discovery (not hostname resolution) is available.
     */
    private fun applyHostname(info: NsdServiceInfo) {
        runCatching {
            val method = NsdServiceInfo::class.java.getMethod("setHostname", String::class.java)
            method.invoke(info, hostname)
            registeredHostname = hostname
            logger.info("Nsd", "Hostname set to $hostname.local")
        }.onFailure {
            registeredHostname = null
            logger.error("Nsd", "Could not set mDNS hostname via reflection: ${it.message}")
        }

        runCatching {
            val addrs = getLocalAddresses()
            if (addrs.isNotEmpty()) {
                if (android.os.Build.VERSION.SDK_INT >= 34) {
                    info.setHostAddresses(addrs)
                    logger.info("Nsd", "Host addresses set via API 34: $addrs")
                } else {
                    val m = NsdServiceInfo::class.java.getMethod("setHost", java.net.InetAddress::class.java)
                    m.invoke(info, addrs.first())
                    logger.info("Nsd", "Host address set via reflection: ${addrs.first()}")
                }
            }
        }.onFailure {
            logger.warn("Nsd", "Could not set host address on service info: ${it.message}")
        }
    }

    private fun getLocalAddresses(): List<java.net.InetAddress> = runCatching {
        val list = mutableListOf<java.net.InetAddress>()
        val interfaces = java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())
        for (intf in interfaces) {
            if (!intf.isUp || intf.isLoopback) continue
            for (addr in java.util.Collections.list(intf.inetAddresses)) {
                if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) {
                    list.add(addr)
                }
            }
        }
        list
    }.getOrDefault(emptyList())

    companion object {
        /** Converts a friendly server name into a valid mDNS service label. */
        fun sanitize(name: String): String {
            var n = name.trim().lowercase().replace(Regex("[^a-z0-9-]"), "-")
            n = n.trim('-')
            return if (n.isEmpty()) "localhub" else n
        }
    }
}
