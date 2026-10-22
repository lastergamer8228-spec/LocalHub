package com.localhub.localhub.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle

/**
 * Lightweight Activity that launches the MediaProjection consent prompt and hands
 * the granted result to AppContainer.screenMirror. Started from the web UI via
 * the server, or from the Android settings screen.
 */
class MirrorActivity : Activity() {

    companion object {
        private const val REQUEST_MEDIA = 4001

        /** Start the consent prompt (called from server / Android settings). */
        fun start(context: Context) {
            val i = Intent(context, MirrorActivity::class.java)
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_MEDIA)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_MEDIA) {
            if (resultCode == RESULT_OK && data != null) {
                // Android 14+ requires MediaProjection inside a foreground service.
                com.localhub.localhub.service.MirrorService.startWithResult(this, resultCode, data)
            }
        }
        finish()
    }
}
