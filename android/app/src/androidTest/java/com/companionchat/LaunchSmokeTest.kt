package com.companionchat

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented smoke: Android can create MainActivity and move it to RESUMED.
 *
 * A debug React Native build loads JavaScript from Metro, so an accessibility
 * assertion here would make this device test depend on a development server and
 * retained auth state. ActivityScenario is the platform-owned lifecycle test
 * boundary; Maestro owns clean-state, bundled-JS user journeys.
 *
 * https://developer.android.com/guide/components/activities/testing
 */
@RunWith(AndroidJUnit4::class)
class LaunchSmokeTest {
    @Test
    fun launchesMainActivityToResumed() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            assertEquals(Lifecycle.State.RESUMED, scenario.state)
        }
    }
}
