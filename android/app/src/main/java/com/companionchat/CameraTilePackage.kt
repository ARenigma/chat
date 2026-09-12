package com.companionchat

import android.util.Log
import android.view.View
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp
import java.util.Collections
import java.util.WeakHashMap

/**
 * CameraX live-preview native view, registered as PappalCameraPreview.
 *
 * Renders a TextureView-backed camera preview that can be clipped to rounded
 * corners, composited with Reanimated, and animated as a panel tile. Only the
 * Preview use case is bound — this is a viewfinder, not a capture surface.
 * Capture goes through the existing react-native-image-picker launchCamera path.
 *
 * COMPATIBLE mode (TextureView) is required for the rounded-tile design. The
 * alternative, PERFORMANCE mode (SurfaceView), punches a transparent hole through
 * the view hierarchy and cannot be clipped, rounded, or animated.
 * https://developer.android.com/reference/androidx/camera/view/PreviewView.ImplementationMode
 *
 * Camera lifecycle is tied to the Activity's LifecycleOwner via CameraX. CameraX
 * stops the camera when the activity pauses and restarts it when the activity
 * resumes — handling the app-backgrounding case without any manual observer.
 * https://developer.android.com/training/camerax/lifecycle
 *
 * https://developer.android.com/training/camerax/preview
 */
class CameraTilePackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = emptyList()

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = listOf(CameraPreviewManager())
}

private const val TAG = "PappalCameraPreview"

class CameraPreviewManager : SimpleViewManager<PreviewView>() {

    // Holds the ThemedReactContext per view so we can reach the Activity later.
    // WeakHashMap prevents this manager (a singleton) from leaking view instances.
    private val contextMap = WeakHashMap<PreviewView, ThemedReactContext>()

    // Holds the resolved ProcessCameraProvider per view so unbindAll can be
    // called on the same provider instance that bound the camera.
    private val providerMap = WeakHashMap<PreviewView, ProcessCameraProvider>()

    // Tracks whether a camera bind has been scheduled in this update cycle.
    // Used by onAfterUpdateTransaction to apply the default (back camera) when
    // the facing prop is absent from the JS render.
    private val bindScheduled: MutableSet<PreviewView> =
        Collections.newSetFromMap(WeakHashMap())

    override fun getName(): String = "PappalCameraPreview"

    override fun createViewInstance(context: ThemedReactContext): PreviewView {
        val view = PreviewView(context).apply {
            // COMPATIBLE uses a TextureView internally. SurfaceView (PERFORMANCE)
            // cannot be clipped to a rounded outline, cannot be composited with
            // other layers, and cannot be animated — it punches a hole through
            // the view hierarchy. COMPATIBLE is therefore the only valid mode for
            // a rounded, animatable tile.
            // https://developer.android.com/reference/androidx/camera/view/PreviewView.ImplementationMode
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE

            /*
             * TRANSPARENT, because PreviewView paints itself BLACK otherwise and
             * that black is what a member actually saw.
             *
             * CameraX gives PreviewView an opaque black background of its own, so
             * from the moment this view mounts until the first frame arrives —
             * typically 300ms to 2s, and FOREVER when the capture session fails
             * to negotiate (`Camera2-FrameProcessorBase: Error waiting for new
             * frames: Connection timed out (-110)`, observed on an S22 on
             * 2026-09-12) — the tile is a pure black rectangle with a "Camera"
             * label on it. No placeholder behind it can help, because the black
             * is painted on top of whatever is behind.
             *
             * With the background transparent, the TextureView underneath is
             * itself transparent until it receives buffers, so the tile shows
             * whatever JS renders behind this view (AttachPanel's camera-glyph
             * placeholder) and the live frames simply cover it once they arrive.
             * A failed session now degrades to the placeholder instead of a void.
             *
             * PreviewView.StreamState (IDLE/STREAMING) is the API for observing
             * that moment explicitly, and would be the way to cross-fade rather
             * than cut. Not used here: it needs a LiveData observer and an event
             * back to JS, and this app has no native view that emits events yet
             * — a first one is worth adding deliberately, not as a side effect of
             * a bug fix. See the note in AttachPanel.tsx.
             * https://developer.android.com/reference/androidx/camera/view/PreviewView.StreamState
             */
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
        }
        contextMap[view] = context
        return view
    }

    /**
     * Facing prop: "front" → front camera, anything else → back camera.
     *
     * A facing change requires a new camera session: the old session is unbound
     * before the new one is started so there is never more than one session
     * active for this view.
     *
     * Default is back camera, applied in onAfterUpdateTransaction when the prop
     * is absent from the JS render.
     */
    @ReactProp(name = "facing")
    fun setFacing(view: PreviewView, facing: String?) {
        bindScheduled.add(view)
        val selector = if (facing == "front") {
            CameraSelector.DEFAULT_FRONT_CAMERA
        } else {
            CameraSelector.DEFAULT_BACK_CAMERA
        }
        bindCamera(view, selector)
    }

    /**
     * Apply the default back camera when the facing prop was not included in
     * the current React render. onAfterUpdateTransaction runs once per update
     * batch, after all props have been set.
     */
    override fun onAfterUpdateTransaction(view: PreviewView) {
        super.onAfterUpdateTransaction(view)
        if (!bindScheduled.contains(view)) {
            bindScheduled.add(view)
            bindCamera(view, CameraSelector.DEFAULT_BACK_CAMERA)
        }
    }

    /**
     * Called by React Native when it is done with this view. Unbind the camera
     * here so the OS camera-in-use indicator (green dot, API 29+) is dismissed
     * and the camera hardware is released. A camera left bound after the view is
     * gone is a privacy problem and a battery problem.
     * https://developer.android.com/training/camerax/lifecycle
     */
    override fun onDropViewInstance(view: PreviewView) {
        unbindCamera(view)
        contextMap.remove(view)
        bindScheduled.remove(view)
        super.onDropViewInstance(view)
    }

    private fun bindCamera(view: PreviewView, selector: CameraSelector) {
        // Release any running camera session before starting a new one. This
        // covers both the facing-change and the re-bind-on-resume paths.
        // A camera left bound shows the OS camera-in-use indicator indefinitely.
        unbindCamera(view)

        val reactContext = contextMap[view] ?: return

        val activity = reactContext.currentActivity ?: run {
            // The activity is not attached yet (unusual but possible during
            // animated transitions). Leave the preview blank rather than crash.
            Log.w(TAG, "currentActivity is null; camera preview left blank.")
            return
        }

        // CameraX requires a LifecycleOwner to manage the camera session.
        // ThemedReactContext.currentActivity is a FragmentActivity / AppCompatActivity
        // on all standard React Native hosts, both of which implement LifecycleOwner.
        // The cast is defensive: a non-standard host would not implement it, and in
        // that case we leave the view blank rather than crash the app.
        // https://developer.android.com/training/camerax/lifecycle
        val lifecycleOwner = activity as? LifecycleOwner ?: run {
            Log.w(TAG, "Activity does not implement LifecycleOwner; camera preview left blank.")
            return
        }

        // Do NOT request CAMERA permission here. Permission flow is owned entirely
        // by the JS layer via src/lib/permissions.ts (requestAndroidPermission).
        // If the permission is absent, ProcessCameraProvider.bindToLifecycle throws
        // a SecurityException; we catch it below and leave the preview blank so
        // the view degrades gracefully rather than crashing the host Activity.
        val providerFuture = ProcessCameraProvider.getInstance(reactContext)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                providerMap[view] = provider

                // Detach any previous surface provider before rebinding so the
                // old frame arrives at the right surface after a facing change.
                val preview = Preview.Builder().build().also { p ->
                    p.surfaceProvider = view.surfaceProvider
                }

                // Preview is the only use case. ImageCapture, ImageAnalysis, and
                // VideoCapture are deliberately excluded: this tile is a viewfinder.
                // Capture goes through the existing react-native-image-picker
                // launchCamera path, which opens its own camera session.
                provider.bindToLifecycle(lifecycleOwner, selector, preview)

                // Register a detach listener as a belt-and-suspenders unbind path.
                // onDropViewInstance covers the normal React Native teardown path;
                // this catches detachment that bypasses the view manager (e.g. the
                // window being torn down before React can call onDropViewInstance).
                view.addOnAttachStateChangeListener(
                    object : View.OnAttachStateChangeListener {
                        override fun onViewAttachedToWindow(v: View) = Unit
                        override fun onViewDetachedFromWindow(v: View) {
                            unbindCamera(view)
                            view.removeOnAttachStateChangeListener(this)
                        }
                    },
                )
            } catch (e: SecurityException) {
                // CAMERA permission is absent. The view renders blank. The JS caller
                // is responsible for requesting the permission before mounting this
                // view (src/lib/permissions.ts → requestAndroidPermission).
                Log.w(TAG, "CAMERA permission denied; preview will be blank.", e)
            } catch (e: Exception) {
                Log.e(TAG, "bindToLifecycle failed unexpectedly.", e)
            }
        }, ContextCompat.getMainExecutor(reactContext))
    }

    private fun unbindCamera(view: PreviewView) {
        // Remove first so a concurrent bind does not double-unbind the same
        // provider. unbindAll stops all use cases on this provider.
        providerMap.remove(view)?.unbindAll()
    }
}
