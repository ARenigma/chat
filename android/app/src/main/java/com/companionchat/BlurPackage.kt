package com.companionchat

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.util.Log
import android.view.View
import android.view.ViewParent
import android.widget.FrameLayout
import androidx.annotation.RequiresApi
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp

private const val TAG = "PappalBlur"

// Downscale factor: the blur node is recorded at 1/DOWNSCALE of screen resolution
// and drawn back at DOWNSCALE× size. Keeps GPU memory and render cost low while
// preserving perceptually smooth blur at the tint levels we use.
//
// The reference uses AndroidUtilities.density (≈3 on a modern phone) for
// HIGH-class devices (SizeNotifierFrameLayout.java:939-940). We fix at 6 —
// a wider margin that matches visual quality at our default tint alpha.
private const val DOWNSCALE = 6f

/**
 * React Native package registering [PappalBlurRoot] and [PappalBlurSurface].
 *
 * Architecture mirrors the container+surface pattern where a FrameLayout records
 * its own children into a downscaled RenderNode and blur sub-views draw that node
 * (SizeNotifierFrameLayout.java:965-1042). The root carries the GPU blur+saturation
 * chain; surfaces translate and clip the node to their own bounds, then composite
 * a tint over it.
 *
 * WHY — the library being replaced (@sbaiahmed1/react-native-blur) performs a
 * SOFTWARE backdrop capture: Bitmap.createBitmap(ARGB_8888) + Canvas(bitmap)
 * driven by a ViewTreeObserver.OnPreDrawListener on the decor view. Two Frost
 * instances on a scrolling chat screen meant CPU rasterisation on every root
 * pre-draw, which showed up as dropped frames on tab switches.
 *
 * API 31 (Android 12) is required for RenderEffect:
 *   https://developer.android.com/reference/android/graphics/RenderEffect
 * minSdk here is 24 (Android 7), so the solid-colour fallback path WILL run
 * in production for Android 7–11 users.
 */
class BlurPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        emptyList()

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> =
        listOf(PappalBlurRootManager(), PappalBlurSurfaceManager())
}

// ─────────────────────────────────────────────────────────────────────────────
// PappalBlurRoot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Container that records its non-[PappalBlurSurface] children into a downscaled
 * [RenderNode] on each draw so surface children can draw a GPU backdrop blur.
 *
 * Recording skips [PappalBlurSurface] descendants to prevent the blur from
 * sampling its own output — the same skip used in drawListWithCallbacks
 * (SizeNotifierFrameLayout.java:1007-1016 sets drawingBlur = true before
 * recording; blur views check that flag and skip themselves).
 *
 * https://developer.android.com/reference/android/graphics/RenderNode
 * https://developer.android.com/reference/android/graphics/RenderEffect
 */
class PappalBlurRoot(context: Context) : FrameLayout(context) {

    /**
     * The downscaled node carrying the blur+saturation [RenderEffect].
     * Null on API < 31 and until the first hardware-accelerated draw pass.
     * Surfaces read this field; it is internal to the package.
     */
    internal var blurNode: RenderNode? = null
        private set

    // Raised during the recording pass so drawChild skips PappalBlurSurface.
    private var skipSurfaces = false

    /**
     * How many surfaces are currently attached AND asking to be blurred.
     *
     * The recording is skipped entirely at zero. Without this the root would
     * replay its whole child tree into a RenderNode on every frame of every
     * screen, whether or not anything on that screen is blurred — which is the
     * cost the software-capture library was replaced to avoid, in a new shape.
     * The reference gates the same work behind `blurNodeInvalidated`
     * (SizeNotifierFrameLayout.java:994).
     */
    private var activeSurfaces = 0

    internal fun onSurfaceActive(active: Boolean) {
        activeSurfaces = (activeSurfaces + if (active) 1 else -1).coerceAtLeast(0)
    }

    /**
     * The frame the node was last recorded for, so it is recorded AT MOST once
     * per frame.
     *
     * `draw()` runs once per frame for this view, but a `RenderNode` recording
     * can also be triggered by a descendant invalidating mid-pass; the reference
     * carries an explicit `blurNodeInvalidatedThisFrame` flag for it
     * (SizeNotifierFrameLayout.java:994). `getDrawingTime()` is the frame's
     * timestamp, which gives the same guarantee without tracking invalidation.
     */
    private var recordedForFrame = -1L

    override fun draw(canvas: Canvas) {
        // Record BEFORE super.draw() so blurNode is populated when surfaces reach
        // their onDraw() inside super.draw() → dispatchDraw().
        if (
            Build.VERSION.SDK_INT >= 31 &&
            canvas.isHardwareAccelerated &&
            activeSurfaces > 0 &&
            drawingTime != recordedForFrame
        ) {
            recordedForFrame = drawingTime
            recordBlurNode()
        }
        super.draw(canvas)
    }

    /**
     * The subtrees to leave OUT of the recording.
     *
     * Not just the blur-drawing leaves. A frosted bar is a blur surface with the
     * bar's own icons and text drawn OVER it — if that content is captured into
     * the node, the bar blurs a copy of itself and every glyph grows a halo. So
     * each surface registers the direct child of this root that contains it, and
     * the whole of that subtree is excluded. This is the reference's
     * `blurBehindViews` set (SizeNotifierFrameLayout.java:1007-1016), which is
     * likewise a set of chrome VIEWS and not of blur primitives.
     */
    private val excluded = java.util.Collections.newSetFromMap(
        java.util.WeakHashMap<View, Boolean>(),
    )

    internal fun exclude(view: View, on: Boolean) {
        if (on) excluded.add(view) else excluded.remove(view)
    }

    override fun drawChild(canvas: Canvas, child: View, drawingTime: Long): Boolean {
        // During the recording pass, exclude the chrome subtrees so the node
        // captures only the backdrop. Recursing into a surface that reads the
        // very node being recorded would produce undefined output
        // (SizeNotifierFrameLayout.java:1007-1016).
        if (skipSurfaces && (child is PappalBlurSurface || excluded.contains(child))) {
            return false
        }
        return super.drawChild(canvas, child, drawingTime)
    }

    /**
     * Records all non-[PappalBlurSurface] children into [blurNode] at
     * 1/[DOWNSCALE] resolution, with a chained blur+saturation [RenderEffect].
     *
     * Blur+saturation chain reproduces SizeNotifierFrameLayout.java:997-1002:
     *   RenderEffect.createChainEffect(
     *     createBlurEffect(r, r, DECAL),
     *     createColorFilterEffect(ColorMatrixColorFilter(saturation = 2f))
     *   )
     * Saturation is boosted (×2) to compensate for the desaturation that the
     * Gaussian kernel introduces at high radii.
     *
     * https://developer.android.com/reference/android/graphics/RenderEffect#createChainEffect(android.graphics.RenderEffect,android.graphics.RenderEffect)
     * https://developer.android.com/reference/android/graphics/RenderEffect#createBlurEffect(float,float,android.graphics.Shader.TileMode)
     */
    @RequiresApi(31)
    private fun recordBlurNode() {
        val w = width
        val h = height
        if (w <= 0 || h <= 0) return

        val nodeW = (w / DOWNSCALE).toInt().coerceAtLeast(1)
        val nodeH = (h / DOWNSCALE).toInt().coerceAtLeast(1)

        // Create the node once and reuse it. The RenderEffect is immutable after
        // construction, so setRenderEffect is called only on first creation.
        val node = blurNode ?: RenderNode("pappalBlurRoot").also { n ->
            // Blur radius in downscaled-pixel space. Telegram HIGH path: r = 60 at
            // density ≈ 3× scale (SizeNotifierFrameLayout.java:952). We apply the
            // same radius; DOWNSCALE controls the effective screen-space radius.
            val r = DEFAULT_BLUR_RADIUS
            val colorMatrix = ColorMatrix().apply { setSaturation(2f) }
            n.setRenderEffect(
                RenderEffect.createChainEffect(
                    RenderEffect.createBlurEffect(r, r, Shader.TileMode.DECAL),
                    RenderEffect.createColorFilterEffect(ColorMatrixColorFilter(colorMatrix)),
                )
            )
            blurNode = n
        }

        node.setPosition(0, 0, nodeW, nodeH)
        val rc = node.beginRecording()
        // Scale 1/DOWNSCALE so the recording captures the full root content at
        // reduced resolution. Each pixel in the node represents DOWNSCALE screen px.
        // Reference: SizeNotifierFrameLayout.java:1009 — recordingCanvas.scale(1f / scale, 1f / scale)
        rc.scale(1f / DOWNSCALE, 1f / DOWNSCALE)
        skipSurfaces = true
        // dispatchDraw plays back each non-surface child's display list onto rc.
        // On the very first frame a child's display list may be empty; the blur
        // becomes correct on the following frame once display lists are populated.
        dispatchDraw(rc)
        skipSurfaces = false
        node.endRecording()
    }

    companion object {
        // Default blur radius in downscaled-pixel space.
        // Mirrors Telegram HIGH-class value (SizeNotifierFrameLayout.java:952).
        internal const val DEFAULT_BLUR_RADIUS = 60f
    }
}

/*
 * BlurRoot accepts React children, so Fabric must receive the view-manager
 * children contract. SimpleViewManager marks the native view as a leaf even
 * when the Android class happens to extend FrameLayout, causing Fabric to cast
 * this manager to IViewManagerWithChildren when mounting the first child.
 * https://reactnative.dev/docs/legacy/native-components-android#3-implement-the-view-manager
 */
class PappalBlurRootManager : ViewGroupManager<PappalBlurRoot>() {
    override fun getName(): String = "PappalBlurRoot"

    override fun createViewInstance(context: ThemedReactContext): PappalBlurRoot =
        PappalBlurRoot(context)
}

// ─────────────────────────────────────────────────────────────────────────────
// PappalBlurSurface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A child view that draws [PappalBlurRoot]'s downscaled [RenderNode] translated
 * to show the root content behind this surface's own bounds, then composites a
 * tint colour over it.
 *
 * Fallback paths (solid rect of [tintColor] at full opacity):
 *   – API < 31 (Android < 12): RenderEffect unavailable. minSdk is 24 so this
 *     WILL run in production for Android 7–11 users.
 *   – [enabled] == false: explicit opt-out (e.g. during animation).
 *   – No [PappalBlurRoot] ancestor found: logs once, renders solid.
 *   – Canvas not hardware-accelerated: drawRenderNode requires hw acceleration.
 *
 * Fallback matches Telegram's own path: canvas.drawRect(rectTmp, blurScrimPaint)
 * (SizeNotifierFrameLayout.java:976-979).
 *
 * https://developer.android.com/reference/android/graphics/RenderNode#drawRenderNode(android.graphics.RenderNode)
 */
class PappalBlurSurface(context: Context) : View(context) {

    // ── Props ───────────────────────────────────────────────────────────────

    /**
     * ARGB integer colour of the tint rect drawn over the blur.
     *
     * TRANSPARENT, not BLACK. This surface's whole job is to be invisible until
     * JS tells it what to be, and BLACK made every failure mode a solid black
     * slab instead of nothing: an unset prop, a JS bundle predating the prop, a
     * `tint="none"` caller. Seen on the S22 (API 36) 2026-09-05 - the chat
     * header and composer rendered as black bars with light-theme content on
     * them, because the tint never arrived and the fallback painted the default.
     *
     * The right degradation for a decoration is to disappear, which is also what
     * the Frost docstring on the JS side already claims happens.
     */
    var tintColor: Int = Color.TRANSPARENT

    /**
     * Opacity of the tint overlay in [0.0, 1.0]. Default 0.70 matches
     * Telegram's key_chat_BlurAlpha = 0xB2000000 (alpha 178/255 ≈ 70%)
     * (ThemeColors.java:660). At 70% tint the blur is only ~30% visible;
     * the surface reads as a tinted plate, not a lens. Getting this wrong in
     * the wrong direction makes the blur look like a rendering fault.
     */
    var tintAlpha: Float = 0.70f

    /**
     * Whether to use the hardware blur path. false → [drawSolidFallback].
     * Telegram always draws a rect on this path (SizeNotifierFrameLayout.java:976-979).
     */
    /*
     * Named `blurEnabled`, not `enabled`: a `var enabled` on a View subclass
     * compiles to `setEnabled(Z)V`, which accidentally overrides
     * `View.setEnabled` and fails the Kotlin compiler with "same JVM
     * signature". The React prop is still called `enabled`.
     */
    var blurEnabled: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            syncRootCount()
            invalidate()
        }

    /**
     * Blur radius stored for documentation and future per-surface reconfiguration.
     * Currently, the actual radius is set on the root's shared RenderNode
     * ([PappalBlurRoot.DEFAULT_BLUR_RADIUS]). Surfaces on the same screen
     * typically share the same radius; the default matches Telegram HIGH
     * (SizeNotifierFrameLayout.java:952).
     */
    var blurRadius: Float = PappalBlurRoot.DEFAULT_BLUR_RADIUS

    // ── Internal state ──────────────────────────────────────────────────────

    private var cachedRoot: PappalBlurRoot? = null
    private var loggedNoRoot = false
    private val tintPaint = Paint(Paint.ANTI_ALIAS_FLAG)

    init {
        // ViewGroup descendants default to willNotDraw = true. A plain View
        // already defaults to false, but set it explicitly for clarity.
        setWillNotDraw(false)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        cachedRoot = findBlurRootAncestor()
        if (cachedRoot == null && !loggedNoRoot) {
            Log.w(TAG, "PappalBlurSurface: no PappalBlurRoot ancestor found — " +
                    "falling back to solid colour for this surface")
            loggedNoRoot = true
        }
        // Tell the root it has work to do. Its recording is skipped entirely
        // while no surface is asking for a blur, so this count is what keeps a
        // screen with no frosted bar from paying for one.
        if (blurring) {
            cachedRoot?.onSurfaceActive(true)
            countedOnRoot = true
        }
        // Register the chrome subtree this surface belongs to, so the recording
        // leaves the bar's own content out of its own backdrop.
        excludedBranch = branchUnderRoot()
        excludedBranch?.let { cachedRoot?.exclude(it, true) }
    }

    /**
     * The direct child of the blur root on this surface's ancestor path.
     *
     * That is the granularity the root can act on in `drawChild`, and it is the
     * whole frosted bar rather than only the pixel-drawing leaf.
     */
    private fun branchUnderRoot(): View? {
        val root = cachedRoot ?: return null
        var v: View = this
        var parent = v.parent
        while (parent is View && parent !== root) {
            v = parent
            parent = v.parent
        }
        return if (parent === root) v else null
    }

    private var excludedBranch: View? = null

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        if (countedOnRoot) {
            cachedRoot?.onSurfaceActive(false)
            countedOnRoot = false
        }
        excludedBranch?.let { cachedRoot?.exclude(it, false) }
        excludedBranch = null
        cachedRoot = null
    }

    /** Whether this surface would actually draw a blur if it were asked to. */
    private val blurring: Boolean
        get() = blurEnabled && Build.VERSION.SDK_INT >= 31

    /** Whether this surface is currently counted in the root's active total. */
    private var countedOnRoot = false

    /**
     * Keep the root's count in step when `enabled` is toggled at runtime.
     *
     * The dock turns its blur off while the composer has focus, so this is not a
     * hypothetical: without it the root would keep recording for a surface that
     * has stopped drawing one.
     */
    private fun syncRootCount() {
        val want = blurring && isAttachedToWindow
        if (want == countedOnRoot) return
        cachedRoot?.onSurfaceActive(want)
        countedOnRoot = want
    }

    override fun onDraw(canvas: Canvas) {
        // minSdk is 24 (Android 7). This early-return is the production path
        // for Android 7–11 (API 24–30) where RenderEffect does not exist.
        val useBlur = blurEnabled && Build.VERSION.SDK_INT >= 31 && canvas.isHardwareAccelerated
        if (!useBlur) {
            drawSolidFallback(canvas)
            return
        }
        if (Build.VERSION.SDK_INT >= 31) {
            // The SDK_INT check is repeated so the compiler and lint can verify
            // that the @RequiresApi(31) call is guarded (the useBlur branch
            // above is not always recognised by static analysis alone).
            drawBlurred(canvas)
        }
    }

    // ── Drawing helpers ─────────────────────────────────────────────────────

    /**
     * Draws a solid rect of [tintColor] at full opacity — the fallback for all
     * paths where the hardware blur is unavailable or disabled.
     * Telegram draws canvas.drawRect(rectTmp, blurScrimPaint) on this path
     * (SizeNotifierFrameLayout.java:976-979).
     */
    private fun drawSolidFallback(canvas: Canvas) {
        /*
         * Nothing to draw beats something wrong.
         *
         * A fully transparent tint means either "this bar is a lens, not a
         * surface" (`tint="none"`) or "the prop never arrived". Both must paint
         * NOTHING. Forcing alpha to 255 below without this guard is what turned
         * a transparent tint into an opaque black rect.
         */
        if (Color.alpha(tintColor) == 0) {
            return
        }
        tintPaint.color = tintColor
        /*
         * Opaque on purpose for a real colour: with no blur behind it, the 55%
         * glass token would let the transcript read straight through the bar.
         * Telegram draws a solid rect on this path too
         * (SizeNotifierFrameLayout.java:976-979).
         */
        tintPaint.alpha = 255
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), tintPaint)
    }

    /**
     * Draws [PappalBlurRoot.blurNode] clipped and translated to show the root
     * content behind this surface, then composites the tint on top.
     *
     * Translation pattern reproduces SizeNotifierFrameLayout.java:1033-1039:
     *   canvas.translate(0, -y - getTranslationY())
     *   canvas.scale(scale, scale)
     *   canvas.drawRenderNode(blurNodes[a])
     *
     * Math (why translate(-dx,-dy) then scale(DOWNSCALE)):
     *   The node was recorded at 1/DOWNSCALE scale, so a node coordinate (nx, ny)
     *   represents screen coordinate (nx*DOWNSCALE, ny*DOWNSCALE) in root space.
     *   To show root content at offset (dx, dy) at surface origin (0, 0):
     *     screen_pos = node_coord * DOWNSCALE - (dx, dy)
     *   Setting screen_pos = (0, 0) solves to node_coord = (dx/DOWNSCALE, dy/DOWNSCALE),
     *   which is exactly the content behind the surface. ✓
     *
     * https://developer.android.com/reference/android/graphics/Canvas#drawRenderNode(android.graphics.RenderNode)
     */
    @RequiresApi(31)
    private fun drawBlurred(canvas: Canvas) {
        val root = cachedRoot
        if (root == null) {
            drawSolidFallback(canvas)
            return
        }
        val node = root.blurNode
        if (node == null) {
            // Root has not completed its first recording pass (first frame only).
            // Solid for this frame; blur appears on the next frame.
            drawSolidFallback(canvas)
            return
        }

        val (dx, dy) = offsetFromRoot(root)

        canvas.save()
        canvas.clipRect(0f, 0f, width.toFloat(), height.toFloat())
        // Reference: SizeNotifierFrameLayout.java:1033-1039
        canvas.translate(-dx, -dy)
        canvas.scale(DOWNSCALE, DOWNSCALE)
        canvas.drawRenderNode(node)
        canvas.restore()

        // Tint overlay. Alpha encodes the "plate" opacity over the blur.
        // Telegram key_chat_BlurAlpha 0xB2000000 = 178 alpha = 70% (ThemeColors.java:660).
        tintPaint.color = tintColor
        tintPaint.alpha = (tintAlpha * 255f).toInt().coerceIn(0, 255)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), tintPaint)
    }

    /**
     * Walks the view tree upward from this surface to find the nearest
     * [PappalBlurRoot] ancestor. Returns null if none is found.
     *
     * Called once in [onAttachedToWindow]; the result is cached in [cachedRoot].
     * No system calls, no reflection.
     */
    private fun findBlurRootAncestor(): PappalBlurRoot? {
        var p: ViewParent? = parent
        while (p != null) {
            if (p is PappalBlurRoot) return p
            p = (p as? View)?.parent
        }
        return null
    }

    /**
     * Computes this view's top-left offset (in pixels) relative to [root] by
     * walking the view tree and accumulating [View.getLeft]/[View.getTop] plus
     * translation at each step.
     *
     * Avoids [View.getLocationInWindow] (a system call) on every draw frame.
     */
    private fun offsetFromRoot(root: PappalBlurRoot): Pair<Float, Float> {
        var dx = 0f
        var dy = 0f
        var v: View = this
        while (v !== root) {
            dx += v.left.toFloat() + v.translationX
            dy += v.top.toFloat() + v.translationY
            val p = v.parent
            if (p !is View) break
            v = p
        }
        return Pair(dx, dy)
    }
}

class PappalBlurSurfaceManager : SimpleViewManager<PappalBlurSurface>() {
    override fun getName(): String = "PappalBlurSurface"

    override fun createViewInstance(context: ThemedReactContext): PappalBlurSurface =
        PappalBlurSurface(context)

    @ReactProp(name = "tintColor", customType = "Color")
    fun setTintColor(view: PappalBlurSurface, color: Int?) {
        view.tintColor = color ?: Color.BLACK
        view.invalidate()
    }

    @ReactProp(name = "tintAlpha", defaultFloat = 0.70f)
    fun setTintAlpha(view: PappalBlurSurface, alpha: Float) {
        view.tintAlpha = alpha
        view.invalidate()
    }

    @ReactProp(name = "blurRadius", defaultFloat = PappalBlurRoot.DEFAULT_BLUR_RADIUS)
    fun setBlurRadius(view: PappalBlurSurface, radius: Float) {
        view.blurRadius = radius
        view.invalidate()
    }

    @ReactProp(name = "enabled", defaultBoolean = true)
    fun setEnabled(view: PappalBlurSurface, enabled: Boolean) {
        view.blurEnabled = enabled
        view.invalidate()
    }
}
