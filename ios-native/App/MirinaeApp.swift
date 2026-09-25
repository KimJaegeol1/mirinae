import SwiftUI

@main
struct MirinaeApp: App {
    @StateObject private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .onChange(of: scenePhase) { phase in
                    // 날짜가 바뀌었거나 위젯 쪽에서 볼 때와 같은 값을 보이도록 다시 읽는다.
                    if phase == .active { appState.reload() }
                }
        }
    }
}
