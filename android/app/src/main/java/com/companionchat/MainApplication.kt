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
          // GPU hardware blur: PappalBlurRoot + PappalBlurSurface.
          add(BlurPackage())
          // Device performance class (low / average / high) for blur quality.
          add(DeviceClassPackage())
          // Recent photos for the attach panel, under Android 14 PARTIAL access
          // only — never the Play-restricted READ_MEDIA_IMAGES. See the module.
          add(RecentMediaPackage())
          // Platform date and time pickers for the birth-details card.
          add(BirthPickerPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
