package com.companionchat.baselineprofile

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frame measurements for the two authenticated critical journeys.
 *
 * These benchmarks intentionally do not manufacture fake Home data. Run them on
 * a physical device where the internal app is already signed in, the directory
 * has enough rows to scroll, and `peerId` names an existing chat in the rail:
 *
 *   ./gradlew :baselineprofile:connectedNonMinifiedInternalAndroidTest \
 *     -Pandroid.testInstrumentationRunnerArguments.class=\
 *com.companionchat.baselineprofile.CriticalJourneyBenchmark \
 *     -Pandroid.testInstrumentationRunnerArguments.androidx.benchmark.enabledRules=Macrobenchmark \
 *     -Pandroid.testInstrumentationRunnerArguments.providerId=<uuid>
 *
 * Setup and fixture checks stay outside the measured block. Only the fling or
 * route transition contributes frames to FrameTimingMetric.
 *
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
 */
@LargeTest
@RunWith(AndroidJUnit4::class)
class CriticalJourneyBenchmark {
    @get:Rule
    val rule = MacrobenchmarkRule()

    private lateinit var providerId: String

    @Before
    fun requireAuthenticatedFixture() {
        providerId =
            InstrumentationRegistry.getArguments().getString("providerId").orEmpty()
        assumeTrue(
            "Pass providerId for a seeded conversation; authenticated frame benchmarks " +
                "do not run against synthetic data.",
            providerId.isNotBlank(),
        )
    }

    @Test
    fun homeScrollFrames() =
        measure(
            // Home is a category pager (one list per page); this is the
            // default page's list, the one on screen at launch.
            requiredObject = By.res("home-scroll-listener"),
        ) { list ->
            check(list.isScrollable) {
                "home-scroll-listener is not scrollable; seed a production-sized provider directory"
            }
            list.setGestureMargin(device.displayWidth / 5)
            list.fling(Direction.DOWN)
            device.waitForIdle(2_000)
            list.fling(Direction.UP)
        }

    /**
     * Open a chat from the Home rail: a native-stack push since navigation
     * step 7 (react-native-screens fragment transition, Home kept mounted
     * underneath). The measured block ends when the push has settled, not on
     * the first frame the chat title exists in, so the whole native animation
     * is in the numbers.
     */
    @Test
    fun openChatFrames() =
        measure(
            requiredObject = By.res("rail-$providerId"),
        ) { conversation ->
            conversation.click()
            check(device.wait(Until.hasObject(By.res("chat-v2-title")), 10_000)) {
                "chat did not become usable"
            }
            device.waitForIdle(1_000)
        }

    private fun measure(
        requiredObject: androidx.test.uiautomator.BySelector,
        interaction: androidx.benchmark.macro.MacrobenchmarkScope.(UiObject2) -> Unit,
    ) {
        lateinit var target: UiObject2
        rule.measureRepeated(
            packageName = PACKAGE_NAME,
            metrics = listOf(FrameTimingMetric()),
            compilationMode =
                CompilationMode.Partial(
                    baselineProfileMode = BaselineProfileMode.Require,
                ),
            iterations = 10,
            startupMode = null,
            setupBlock = {
                // A cold process each iteration: the previous iteration left the
                // chat pushed, and a warm resume would start inside it and never
                // find the rail.
                killProcess()
                pressHome()
                startActivityAndWait()
                target =
                    device.wait(Until.findObject(requiredObject), 20_000)
                        ?: error(
                            "required authenticated fixture is missing: $requiredObject",
                        )
                device.waitForIdle(2_000)
            },
        ) {
            interaction(target)
        }
    }

    companion object {
        private const val PACKAGE_NAME = "com.companionchat"
    }
}
