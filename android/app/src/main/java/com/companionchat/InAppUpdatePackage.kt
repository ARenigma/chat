package com.companionchat

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/**
 * The custom native modules. Registered in MainApplication.
 *
 * Two unrelated modules share one package rather than each getting their own,
 * because a `ReactPackage` is pure registration boilerplate and a second copy of
 * it would carry no information. The name is now narrower than its contents;
 * renaming it would touch MainApplication and a contract test for no behavioural
 * gain, so it stays and says so here instead.
 */
class InAppUpdatePackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(
        InAppUpdateModule(reactContext),
        GoogleCredentialModule(reactContext),
        ConversationsModule(reactContext),
        StartupTimingModule(reactContext),
        WindowChromeModule(reactContext),
    )

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<out View, out ReactShadowNode<*>>> = emptyList()
}
