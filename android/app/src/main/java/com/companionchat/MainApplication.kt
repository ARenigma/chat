package com.companionchat

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Google Play in-app updates. Not autolinkable because it is this
          // app's own module rather than a node_modules package.
          add(InAppUpdatePackage())
          // Play Billing / UCB. Not autolinkable for the same reason.
          add(BillingPackage())
          // Native Material 3 expressive + circular wait indicators.
          add(MaterialIndicatorPackage())
          // CameraX live-preview tile (PappalCameraPreview native view).
          add(CameraTilePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
