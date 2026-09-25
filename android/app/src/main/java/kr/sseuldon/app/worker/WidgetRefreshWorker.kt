package kr.sseuldon.app.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.Constraints
import androidx.work.BackoffPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kr.sseuldon.app.data.SseuldonRepository
import kr.sseuldon.app.remote.SseuldonApiClient
import kr.sseuldon.app.widget.SseuldonWidget
import java.util.concurrent.TimeUnit

class WidgetRefreshWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(appContext, parameters) {
    override suspend fun doWork(): Result {
        val repository = SseuldonRepository.get(applicationContext)
        val session = repository.apiSession()
        var failed = false
        if (session != null) {
            val client = SseuldonApiClient(session.apiBaseUrl)
            runCatching { client.balance(session, inputData.getBoolean("force", false)) }
                .onSuccess {
                    repository.applyApiBalance(it)
                    runCatching { client.budget(session) }
                        .onSuccess(repository::applyApiBudget)
                }
                .onFailure {
                    failed = true
                    repository.markSyncError(it.message ?: "자동 잔액 조회에 실패했어요.")
                }
        }
        SseuldonWidget.update(applicationContext)
        return if (failed) Result.retry() else Result.success()
    }

    companion object {
        private const val PERIODIC_WORK = "sseuldon-twenty-minute-sync"
        private const val LEGACY_PERIODIC_WORK = "sseuldon-thirty-minute-sync"
        private const val IMMEDIATE_WORK = "sseuldon-immediate-sync"

        fun schedule(context: Context) {
            val workManager = WorkManager.getInstance(context)
            workManager.cancelUniqueWork(LEGACY_PERIODIC_WORK)
            val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(20, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
                .build()
            workManager.enqueueUniquePeriodicWork(
                PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        fun now(context: Context, force: Boolean = true) {
            val data = androidx.work.workDataOf("force" to force)
            val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setInputData(data)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                IMMEDIATE_WORK,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}
