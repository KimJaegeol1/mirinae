package kr.sseuldon.app

import android.app.Application
import kr.sseuldon.app.worker.WidgetRefreshWorker

class SseuldonApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        WidgetRefreshWorker.schedule(this)
    }
}

