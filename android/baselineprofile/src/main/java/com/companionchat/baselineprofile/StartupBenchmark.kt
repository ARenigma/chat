package com.companionchat.baselineprofile

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Measures cold TTID and TTFD both without compilation and with the generated
 * Baseline Profile required. `StartupTimingMetric` reports TTFD because the
 * React boot machine calls Activity.reportFullyDrawn() only when usable.
 *
 * These are benchmarks, not CI pass/fail tests. Record final numbers on a
 * physical mid-range device; emulator runs prove only that the harness works.
 *
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
 */
@LargeTest
@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule
    val rule = MacrobenchmarkRule()

    @Test
    fun coldStartupWithoutCompilation() = measure(CompilationMode.None())

    @Test
    fun coldStartupWithBaselineProfile() =
        measure(
            CompilationMode.Partial(
                baselineProfileMode = BaselineProfileMode.Require,
            ),
        )

    private fun measure(compilationMode: CompilationMode) =
        rule.measureRepeated(
            packageName = PACKAGE_NAME,
            metrics = listOf(StartupTimingMetric()),
            compilationMode = compilationMode,
            startupMode = StartupMode.COLD,
            iterations = 10,
            setupBlock = { pressHome() },
        ) {
            startActivityAndWait()
            // Keep the trace open past TTID so the React boot machine can emit
            // reportFullyDrawn and StartupTimingMetric can capture real TTFD.
            // Match the owned window rather than one auth state: Macrobenchmark
            // preserves package data, so either onboarding or Home can be valid.
            check(device.wait(Until.hasObject(By.pkg(PACKAGE_NAME)), 10_000)) {
                "app window did not appear"
            }
            device.waitForIdle(2_000)
        }

    companion object {
        private const val PACKAGE_NAME = "com.companionchat"
    }
}
