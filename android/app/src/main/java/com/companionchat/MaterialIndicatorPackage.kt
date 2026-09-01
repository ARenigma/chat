package com.companionchat

import android.graphics.Color
import android.view.ContextThemeWrapper
import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp
import com.google.android.material.loadingindicator.LoadingIndicator
import com.google.android.material.progressindicator.CircularProgressIndicator

/**
 * Material's own Android Views rendered inside React Native.
 *
 * Short waits use the expressive shape-morph LoadingIndicator. Once a wait
 * exceeds five seconds, JavaScript swaps it for CircularProgressIndicator's
 * indeterminate sweep. This is the distinction required by the M3 guidance;
 * neither shape is approximated with React Native borders.
 *
 * https://m3.material.io/components/loading-indicator/overview
 * https://developer.android.com/develop/ui/compose/components/progress
 */
class MaterialIndicatorPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = emptyList()

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> =
        listOf(MaterialLoadingIndicatorManager(), MaterialCircularProgressManager())
}

private fun materialContext(context: ThemedReactContext): ContextThemeWrapper =
    ContextThemeWrapper(
        context,
        com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar,
    )

private fun dp(view: View, value: Float): Int =
    (value * view.resources.displayMetrics.density).toInt()

class MaterialLoadingIndicatorManager : SimpleViewManager<LoadingIndicator>() {
    override fun getName(): String = "PappalMaterialLoadingIndicator"

    override fun createViewInstance(context: ThemedReactContext): LoadingIndicator =
        LoadingIndicator(materialContext(context)).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            show()
        }

    @ReactProp(name = "indicatorColor", customType = "Color")
    fun setIndicatorColor(view: LoadingIndicator, color: Int?) {
        view.setIndicatorColor(color ?: Color.GRAY)
    }

    @ReactProp(name = "containerColor", customType = "Color")
    fun setContainerColor(view: LoadingIndicator, color: Int?) {
        view.setContainerColor(color ?: Color.TRANSPARENT)
    }

    @ReactProp(name = "indicatorSize", defaultFloat = 48f)
    fun setIndicatorSize(view: LoadingIndicator, size: Float) {
        val container = dp(view, size)
        view.setContainerWidth(container)
        view.setContainerHeight(container)
        view.setIndicatorSize((container * 38f / 48f).toInt())
    }
}

class MaterialCircularProgressManager : SimpleViewManager<CircularProgressIndicator>() {
    override fun getName(): String = "PappalMaterialCircularProgress"

    override fun createViewInstance(context: ThemedReactContext): CircularProgressIndicator =
        CircularProgressIndicator(materialContext(context)).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            isIndeterminate = true
        }

    @ReactProp(name = "indicatorColor", customType = "Color")
    fun setIndicatorColor(view: CircularProgressIndicator, color: Int?) {
        view.setIndicatorColor(color ?: Color.GRAY)
    }

    @ReactProp(name = "trackColor", customType = "Color")
    fun setTrackColor(view: CircularProgressIndicator, color: Int?) {
        view.trackColor = color ?: Color.TRANSPARENT
    }

    @ReactProp(name = "indicatorSize", defaultFloat = 48f)
    fun setIndicatorSize(view: CircularProgressIndicator, size: Float) {
        val px = dp(view, size)
        view.indicatorSize = px
        view.trackThickness = maxOf(dp(view, 4f), (px * 4f / 48f).toInt())
        view.trackCornerRadius = view.trackThickness / 2
    }
}
