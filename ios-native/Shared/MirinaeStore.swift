import Foundation

/// 앱과 위젯이 같은 데이터를 보도록 App Group 컨테이너의 UserDefaults 에 상태를 JSON 으로 저장한다.
/// App Group 이 서명에 포함되지 않으면(무료 계정 제약 등) 앱 자체 저장소로 떨어지며, 그땐 위젯이 "설정 필요"만 보여준다.
final class MirinaeStore {
    static let appGroupIdentifier = "group.kr.sseuldon.mirinae"
    static let shared = MirinaeStore()

    private let stateKey = "mirinae.manual-state.v1"
    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(defaults: UserDefaults? = UserDefaults(suiteName: MirinaeStore.appGroupIdentifier)) {
        self.defaults = defaults ?? .standard
    }

    /// 앱 ↔ 위젯 공유가 실제로 되는지 (진단 화면용)
    var isAppGroupAvailable: Bool {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupIdentifier) != nil
    }

    func load() -> MirinaeState {
        guard let data = defaults.data(forKey: stateKey),
              let state = try? decoder.decode(MirinaeState.self, from: data) else {
            return MirinaeState()
        }
        return state
    }

    func save(_ state: MirinaeState) throws {
        defaults.set(try encoder.encode(state), forKey: stateKey)
    }

    func clear() {
        defaults.removeObject(forKey: stateKey)
    }
}
